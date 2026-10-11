// dissPICable - stage side of the Jackbox-style audience (loaded after stage.js).
// Idle: room code + join QR + a tiny Keys corner (localhost only). Show: phone members in the crowd (window.crowd),
// reaction bubbles, a crowd energy meter and a live "who won that round?" tally.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);

const css = document.createElement("style");
css.textContent = `
.aud-card { margin-top: 18px; display: flex; align-items: center; gap: 16px; padding: 12px 14px; background: #ece6d6; color: #111; border: 5px solid #111; box-shadow: 8px 8px 0 #ff4f9a; transform: rotate(-1.5deg); font-family: "Space Mono", monospace; max-width: 520px; }
.aud-card .aud-qr { width: 104px; height: 104px; flex: 0 0 auto; background: #fff; border: 4px solid #111; padding: 5px; }
.aud-card .aud-qr svg { width: 100%; height: 100%; display: block; }
.aud-card small { display: block; font-size: 13px; font-weight: 700; text-transform: uppercase; }
.aud-card .aud-code { font-family: "Anton", "Bricolage Grotesque", sans-serif; font-size: 58px; line-height: .95; letter-spacing: .12em; background: #ffd400; padding: 0 8px; display: inline-block; margin: 2px 0; }
.aud-card .aud-url { font-size: 14px; font-weight: 700; word-break: break-all; }
.aud-card .aud-n { font-size: 13px; color: #8a8478; text-transform: uppercase; font-weight: 700; }
.aud-keys { position: fixed; right: 12px; bottom: 10px; z-index: 40; font: 700 12px "Space Mono", monospace; text-transform: uppercase; color: #111; background: #ece6d6; border: 3px solid #111; padding: 3px 8px; text-decoration: none; opacity: .7; }
.aud-keys:hover { opacity: 1; box-shadow: 4px 4px 0 #111; }
body:not([data-screen="idle"]) .aud-keys { display: none; }
.aud-hud { position: fixed; top: 14px; right: 14px; z-index: 30; width: 250px; display: none; flex-direction: column; gap: 10px; font-family: "Space Mono", monospace; color: #111; pointer-events: none; }
.aud-hud.on { display: flex; }
.aud-box { background: #ece6d6; border: 4px solid #111; box-shadow: 6px 6px 0 #111; padding: 8px 10px; }
.aud-box small { font-size: 12px; font-weight: 700; text-transform: uppercase; display: flex; justify-content: space-between; }
.aud-meter { height: 18px; border: 3px solid #111; background: #fff; margin-top: 5px; overflow: hidden; }
.aud-meter i { display: block; height: 100%; width: 100%; background: repeating-linear-gradient(-45deg,#111 0 10px,#ffd400 10px 20px); transform-origin: 0 50%; transform: scaleX(0); transition: transform .25s cubic-bezier(.2,.8,.2,1); }
.aud-tally { display: none; transform: rotate(1.5deg); background: #ffd400; }
.aud-tally.on { display: block; }
.aud-tally b { font-family: "Anton", sans-serif; font-weight: 400; font-size: 24px; text-transform: uppercase; display: block; line-height: 1.05; }
.aud-bar { display: flex; height: 22px; border: 3px solid #111; margin-top: 6px; background: #fff; }
.aud-bar i { display: block; height: 100%; transition: flex-grow .3s; }
.aud-bar .p { background: #ff4f9a; } .aud-bar .o { background: #111; }
.aud-tally .aud-legend { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
.aud-feed { font-size: 13px; font-weight: 700; text-transform: uppercase; min-height: 1.2em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
document.head.appendChild(css);

// ---------- idle: room code card + Keys corner ----------
const card = document.createElement("div");
card.className = "aud-card";
card.innerHTML = `<div class="aud-qr" id="audQr"></div><div><small>Scan to play: battle or judge</small><span class="aud-code" id="audCode">----</span><p class="aud-url" id="audUrl"></p><p class="aud-n" id="audN"></p></div>`;
(document.querySelector(".idle-left") || $("idle") || document.body).appendChild(card);
if (isLocal) {
  const k = document.createElement("a");
  k.className = "aud-keys"; k.href = "/setup.html?force=1"; k.textContent = "Keys"; k.title = "Change the Gemini / ElevenLabs keys";
  document.body.appendChild(k);
}

// ---------- show HUD: energy meter + live round tally ----------
const hud = document.createElement("div");
hud.className = "aud-hud";
hud.innerHTML = `<div class="aud-box"><small><span>Crowd energy</span><span id="audCount">0</span></small><div class="aud-meter"><i id="audMeter"></i></div><p class="aud-feed" id="audFeed"></p></div>
  <div class="aud-box aud-tally" id="audTally"><b id="audTallyTitle">Round 1: who won?</b><div class="aud-bar"><i class="p" id="audP"></i><i class="o" id="audO"></i></div><div class="aud-legend"><span id="audPL">Human 0</span><span id="audOL">0 Object</span></div></div>`;
document.body.appendChild(hud);

const members = new Map();
let energy = 0, objName = "Object", sessionId = null, tallyTimer = 0;
function setCount() {
  $("audCount").textContent = `${members.size} in`;
  $("audN").textContent = members.size ? `${members.size} in the crowd` : "nobody yet - be first";
  hud.classList.toggle("on", members.size > 0 && document.body.dataset.screen !== "idle");
}
new MutationObserver(setCount).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });

function drawQr(url) {
  try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); $("audQr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch { /* QR lib missing: the URL is still shown */ }
}
async function load() {
  try {
    const r = await (await fetch("/api/audience")).json();
    const url = `${r.joinUrl}?code=${r.code}`;
    $("audCode").textContent = r.code;
    $("audUrl").textContent = r.joinUrl.replace(/^https?:\/\//, "");
    drawQr(url);
    for (const m of r.members || []) { members.set(m.id, m); window.crowd?.addMember?.(m); }
    setCount();
  } catch { card.style.display = "none"; }
}

// Energy decays smoothly; reactions push it up (transform-only meter).
setInterval(() => { energy = Math.max(0, energy - 0.02); $("audMeter").style.transform = `scaleX(${energy.toFixed(3)})`; }, 100);
const BUMP = { cheer: 0.12, fire: 0.16, laugh: 0.1, boo: 0.05 };
const WORD = { cheer: "cheers", fire: "is on FIRE", laugh: "is crying laughing", boo: "boos" };

let pvpPair = null; // PLAYER vs PLAYER: [p1, p2] (votes are player ids)
function showTally(ev) {
  if (pvpPair) ev = { ...ev, player: ev.counts?.[pvpPair[0].id] || 0, object: ev.counts?.[pvpPair[1].id] || 0 };
  const p = ev.player || 0, o = ev.object || 0, t = Math.max(1, p + o);
  $("audTallyTitle").textContent = `Round ${ev.round}: who won?`;
  $("audP").style.flexGrow = p / t; $("audO").style.flexGrow = o / t;
  if (!p && !o) { $("audP").style.flexGrow = 1; $("audO").style.flexGrow = 1; }
  $("audPL").textContent = `${pvpPair ? pvpPair[0].name : "Human"} ${p}`; $("audOL").textContent = `${o} ${pvpPair ? pvpPair[1].name : objName}`;
  $("audTally").classList.add("on");
  clearTimeout(tallyTimer); tallyTimer = setTimeout(() => $("audTally").classList.remove("on"), 12000);
}

const es = new EventSource("/api/events");
es.onmessage = (m) => {
  let ev; try { ev = JSON.parse(m.data); } catch { return; }
  switch (ev.type) {
    case "audience-joined":
      members.set(ev.member.id, ev.member); window.crowd?.addMember?.(ev.member); setCount();
      $("audFeed").textContent = `${ev.member.name} joined`;
      break;
    case "audience-left":
      members.delete(ev.id); window.crowd?.removeMember?.(ev.id); setCount();
      break;
    case "audience-react":
      window.crowd?.react?.(ev.id, ev.reaction);
      { const now = performance.now(); if (now - (window.__lastCrowdSfx || 0) > 900) { window.__lastCrowdSfx = now; window.playSfx?.({ cheer: "cheer", fire: "airhorn", laugh: "laugh", boo: "boo" }[ev.reaction] || "cheer"); } } // crowd phones -> room sound
      if (ev.reaction === "cheer" || ev.reaction === "fire") window.crowd?.cheer?.();
      energy = Math.min(1, energy + (BUMP[ev.reaction] || 0.08));
      $("audFeed").textContent = `${ev.name} ${WORD[ev.reaction] || ""}`;
      break;
    case "song-ready":
      pvpPair = ev.session?.pvp?.players || null;
      sessionId = ev.session?.id || null; objName = (ev.session?.character?.name || "Object").split(" ")[0];
      $("audTally").classList.remove("on");
      break;
    case "take-received":
      if (pvpPair && !ev.voteOpen) break;
      if (ev.round && (!ev.id || ev.id === sessionId) && members.size) showTally({ round: ev.pvpRound || ev.round, player: 0, object: 0 });
      break;
    case "audience-tally":
      if (!sessionId || ev.id === sessionId) showTally(ev);
      break;
    case "verdict":
      if (ev.crowd) { $("audTallyTitle").textContent = `Crowd vote ${ev.crowd.bonus >= 0 ? "+" : ""}${ev.crowd.bonus} pts`; $("audTally").classList.add("on"); clearTimeout(tallyTimer); }
      break;
    case "reset":
      sessionId = null; $("audTally").classList.remove("on");
      break;
  }
};
load();
