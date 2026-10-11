// Duet Anything - stage side of multi-player (loaded after stage.js; lib/players.mjs + lib/pvp.mjs on the server).
// Idle: player lobby (zine chips), audience count, match picker (VS THE OBJECT / PLAYER vs PLAYER).
// Show: PvP banner (both names, whose turn, their latest bars) + relabels "You said" cards with the player's name.
// Result: PvP verdict panel (winner + both players' marks and roasts).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hostTok = () => { try { return new URLSearchParams(location.search).get("token") || sessionStorage.getItem("duetHostToken") || ""; } catch { return ""; } }; // stage.js stores it from /api/status
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(hostTok() ? { "x-host-token": hostTok() } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const micOk = new Map(); // player id -> latest mic-check ok (phones broadcast { type: "mic-check", client, ok, pid })

const css = document.createElement("style");
css.textContent = `
#idle .phone-card { display: none; }
.lob { justify-self: stretch; align-self: center; min-width: 0; max-width: 560px; position: relative; display: flex; flex-direction: column; gap: 12px; padding: 50px 20px 18px; background: #ece6d6; color: #111; border: 5px solid #111; box-shadow: 10px 10px 0 #111; transform: rotate(1.2deg); font-family: "Space Mono", monospace; }
.lob::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 30px; background: repeating-linear-gradient(-45deg,#111 0 14px,#ffd400 14px 28px); border-bottom: 5px solid #111; }
.lob-head { display: flex; justify-content: space-between; align-items: baseline; }
.lob-head b { font-family: "Anton", sans-serif; font-weight: 400; font-size: 44px; line-height: .9; text-transform: uppercase; }
.lob-head span { font-weight: 700; font-size: 15px; text-transform: uppercase; background: #111; color: #ffd400; padding: 2px 8px; }
.lob-chips { display: flex; flex-wrap: wrap; gap: 10px; min-height: 52px; align-content: flex-start; }
.lob-chip { position: relative; font-family: "Anton", sans-serif; font-size: 24px; text-transform: uppercase; padding: 6px 14px; border: 4px solid #111; background: #fff; color: #111; box-shadow: 4px 4px 0 #111; cursor: pointer; border-radius: 0; transition: transform .15s ease, box-shadow .15s ease; }
.lob-chip i { display: inline-block; width: 14px; height: 14px; border: 3px solid #111; margin-right: 8px; vertical-align: 1px; }
.lob-chip.on { background: #111; color: #ffd400; transform: translate(-2px,-2px) rotate(-2deg); box-shadow: 6px 6px 0 #ff4f9a; }
.lob-chip em { position: absolute; top: -13px; right: -8px; font: 700 11px "Space Mono", monospace; font-style: normal; background: #ff4f9a; color: #111; border: 2px solid #111; padding: 0 5px; }
.lob-empty { font-weight: 700; font-size: 14px; text-transform: uppercase; color: #8a8478; margin: 0; align-self: center; }
.lob-aud { margin: 0; font-weight: 700; font-size: 14px; text-transform: uppercase; }
.lob-aud b { background: #ffd400; padding: 0 5px; }
.lob-modes { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 10px; }
.lob-modes button { font-family: "Anton", sans-serif; font-size: 22px; line-height: 1; text-transform: uppercase; padding: 12px 8px; border: 4px solid #111; background: #fff; color: #111; cursor: pointer; border-radius: 0; }
.lob-modes button.on { background: #ff4f9a; box-shadow: 5px 5px 0 #111; transform: translate(-2px,-2px); }
.lob-hint { margin: 0; font-weight: 700; font-size: 15px; text-transform: uppercase; border-left: 6px solid #ff4f9a; padding-left: 8px; }
.lob-micok { display: inline-block; margin-left: 8px; font: 700 12px "Space Mono", monospace; padding: 1px 5px; border: 2px solid #111; vertical-align: 3px; }
.lob-micok.y { background: #9fe8b0; color: #111; } .lob-micok.n { background: #ff4f9a; color: #111; }
.lob-mic { margin: 0; font-size: 12px; color: #8a8478; font-weight: 700; word-break: break-all; }
.pvb { position: fixed; left: 50%; top: 14px; z-index: 31; display: none; gap: 10px; align-items: stretch; font-family: "Space Mono", monospace; color: #111; pointer-events: none; width: min(760px, 56vw); }
.pvb.on { display: flex; }
.pvb-p { flex: 1 1 0; min-width: 0; background: #ece6d6; border: 4px solid #111; box-shadow: 6px 6px 0 #111; padding: 6px 10px 8px; transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s; opacity: .72; }
.pvb-p.live { opacity: 1; transform: translateY(4px) scale(1.04); box-shadow: 8px 8px 0 #ff4f9a; }
.pvb-p b { font-family: "Anton", sans-serif; font-weight: 400; font-size: 28px; line-height: 1; text-transform: uppercase; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pvb-p b i { display: inline-block; width: 16px; height: 16px; border: 3px solid #111; margin-right: 8px; vertical-align: 2px; }
.pvb-p small { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #111; color: #ece6d6; padding: 0 6px; }
.pvb-p.live small { background: #ff4f9a; color: #111; }
.pvb-p p { margin: 5px 0 0; font-size: 13px; font-weight: 700; line-height: 1.25; max-height: 2.5em; overflow: hidden; }
.pvb-vs { align-self: center; font-family: "Rubik Mono One", monospace; font-size: 20px; background: #ffd400; border: 4px solid #111; padding: 4px 8px; transform: rotate(-6deg); }
.pvv { position: fixed; left: 50%; top: 12vh; z-index: 32; transform: translateX(-50%) translateY(30px); opacity: 0; width: min(1000px, 92vw); display: none; flex-direction: column; gap: 14px; background: #ece6d6; border: 5px solid #111; box-shadow: 12px 12px 0 #111; padding: 18px 18px 14px; font-family: "Space Mono", monospace; color: #111; transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .45s; }
.pvv.on { display: flex; }
.pvv.in { opacity: 1; transform: translateX(-50%) translateY(0); }
.pvv.placed, .pvv.placed.in { transform: translateY(0); }
.pvv.placed:not(.in) { transform: translateY(30px); }
.pvv-again { margin: 0; align-self: flex-end; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #8a8478; }
.pvv-win { align-self: center; font-family: "Anton", sans-serif; font-size: clamp(40px, 5vw, 76px); line-height: 1; text-transform: uppercase; background: #ff4f9a; border: 5px solid #111; box-shadow: 10px 10px 0 #111; padding: 6px 22px; transform: rotate(-2deg); }
.pvv-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; }
.pvv-card { background: #ece6d6; border: 5px solid #111; box-shadow: 8px 8px 0 #111; padding: 10px 14px; min-width: 0; }
.pvv-card.w { background: #ffd400; }
.pvv-card h3 { margin: 0; display: flex; justify-content: space-between; align-items: baseline; font-family: "Anton", sans-serif; font-weight: 400; font-size: 34px; text-transform: uppercase; line-height: 1; gap: 8px; }
.pvv-card h3 span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pvv-card h3 b { font-weight: 400; font-size: 46px; }
.pvv-cats { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.pvv-cats { flex-direction: column; align-items: flex-start; }
.pvv-cats span { font-size: 13px; font-weight: 400; border: 2px solid #111; background: #fff; padding: 1px 6px; max-width: 100%; }
.pvv-cats span b { font-weight: 700; text-transform: uppercase; }
.pvv-card p { margin: 4px 0 0; font-size: 15px; font-weight: 700; line-height: 1.3; }
.pvv-card .best { font-size: 13px; color: #444; font-weight: 400; }
`;
document.head.appendChild(css);

// ---------- idle lobby ----------
const lob = document.createElement("div");
lob.className = "lob";
lob.innerHTML = `<div class="lob-head"><b>Players</b><span id="lobN">0/8</span></div>
  <div class="lob-chips" id="lobChips"></div>
  <p class="lob-aud" id="lobAud"></p>
  <div class="lob-modes" id="lobModes"><button type="button" data-m="object">VS the object</button><button type="button" data-m="pvp">Player vs player</button></div>
  <p class="lob-hint" id="lobHint"></p>
  <p class="lob-mic" id="lobMic"></p>`;
const pc = document.querySelector("#idle .phone-card");
if (pc) pc.after(lob); else ($("idle") || document.body).appendChild(lob);

let players = [], match = { type: "object", current: null }, audience = 0, max = 8;
function renderLobby() {
  $("lobN").textContent = `${players.length}/${max}`;
  const sel = match.type === "pvp" ? match.players || [] : [match.current];
  $("lobChips").innerHTML = players.length
    ? players.map((p) => {
      const k = sel.indexOf(p.id);
      const tag = k < 0 ? "" : match.type === "pvp" ? `P${k + 1}` : "UP NEXT";
      return `<button type="button" class="lob-chip${k >= 0 ? " on" : ""}" data-id="${esc(p.id)}"><i style="background:${esc(p.colour)}"></i>${esc(p.name)}${micOk.has(p.id) ? `<b class="lob-micok ${micOk.get(p.id) ? "y" : "n"}">${micOk.get(p.id) ? "&#10003; MIC" : "&#10007; MIC"}</b>` : ""}${tag ? `<em>${tag}</em>` : ""}</button>`;
    }).join("")
    : `<p class="lob-empty">Nobody yet. Scan the QR &rarr; PLAYER &rarr; BATTLE</p>`;
  $("lobAud").innerHTML = `<b>${audience}</b> ${audience === 1 ? "judge" : "judges"} in the crowd`;
  for (const b of $("lobModes").children) b.classList.toggle("on", b.dataset.m === match.type);
  const byId = (id) => players.find((p) => p.id === id);
  let hint;
  if (match.type === "pvp") {
    const [a, b] = (match.players || []).map(byId);
    hint = players.length < 2 ? "Need 2 players for PvP. Get a mate on!" : a && b ? `${a.name} vs ${b.name}. Snap an object: it's the MC.` : "Tap two players to battle";
  } else {
    const c = byId(match.current);
    hint = c ? `${c.name} is up. Snap an object to start.` : "Snap anything to start";
  }
  $("lobHint").textContent = hint;
}
$("lobChips").addEventListener("click", (e) => {
  const b = e.target.closest(".lob-chip");
  if (!b) return;
  e.stopPropagation();
  const id = b.dataset.id;
  if (match.type === "pvp") {
    let sel = (match.players || []).filter((x) => x !== id);
    if (sel.length === (match.players || []).length) sel = [...sel, id].slice(-2); // not selected yet: add (max 2)
    setMatch({ type: "pvp", players: sel });
  } else setMatch({ type: "object", current: id });
});
$("lobModes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-m]");
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.m === "pvp") setMatch({ type: "pvp", players: match.type === "pvp" ? match.players : players.slice(0, 2).map((p) => p.id) });
  else setMatch({ type: "object" });
});
async function setMatch(m) {
  match = { ...match, ...m }; renderLobby(); // optimistic
  try { const r = await post("/api/match", m); if (r?.match) { match = r.match; players = r.players || players; renderLobby(); } } catch { /* event will fix it */ }
}
function applyPlayers(r) { if (!r) return; players = r.players || []; match = r.match || match; max = r.max || max; renderLobby(); }
async function loadLobby() {
  try { applyPlayers(await (await fetch("/api/players")).json()); } catch { /* old server */ }
  try { audience = (await (await fetch("/api/audience")).json()).count || 0; } catch { /* ignore */ }
  try { const s = await (await fetch("/api/status")).json(); if (s.micUrl) $("lobMic").textContent = `Single phone? Mic direct: ${String(s.micUrl).replace(/^https?:\/\//, "")}`; } catch { /* ignore */ }
  renderLobby();
}

// ---------- PvP banner during the show ----------
const pvb = document.createElement("div");
pvb.className = "pvb";
document.body.appendChild(pvb);
let pvp = null, lastSaid = {}, livePlayer = null, lastHeardName = "";
function renderBanner() {
  if (!pvp) { pvb.classList.remove("on"); return; }
  const card = (p, i) => `<div class="pvb-p${livePlayer === p.id ? " live" : ""}"><b><i style="background:${esc(p.colour)}"></i>${esc(p.name)}</b><small>${livePlayer === p.id ? "On the mic" : `P${i + 1}`}</small><p>${lastSaid[p.id] != null ? esc(lastSaid[p.id] ? `"${lastSaid[p.id]}"` : "(silence)") : "&nbsp;"}</p></div>`;
  pvb.innerHTML = `${card(pvp.players[0], 0)}<span class="pvb-vs">VS</span>${card(pvp.players[1], 1)}`;
  pvb.classList.toggle("on", document.body.dataset.screen !== "idle");
  placeBanner();
}
// Sit just under the song title in the right column (clear of the logo and the crowd HUD).
function placeBanner() {
  const head = document.querySelector(".song-head"), col = document.querySelector(".right-col");
  const h = head?.getBoundingClientRect(), c = col?.getBoundingClientRect();
  if (!h || !c || !h.width) { Object.assign(pvb.style, { left: "50%", top: "14px", transform: "translateX(-50%)" }); return; }
  const hud = document.querySelector(".aud-hud.on")?.getBoundingClientRect();
  const right = hud && hud.bottom > h.bottom ? hud.left - 16 : c.right - 24;
  Object.assign(pvb.style, { left: `${Math.round(h.left)}px`, top: `${Math.round(h.bottom + 12)}px`, transform: "none", width: `${Math.max(320, Math.round(Math.min(760, right - h.left)))}px` });
}
addEventListener("resize", placeBanner);
// "You said" cards on the stage: label them with the player's name (stage.js builds them; we only relabel).
const track = $("track");
if (track) new MutationObserver((muts) => {
  if (!lastHeardName) return;
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1 || !n.classList.contains("you")) continue;
    const who = n.querySelector(".who");
    if (who && !who.dataset.named) { who.dataset.named = "1"; who.textContent = `🎤 ${lastHeardName} said`; }
  }
}).observe(track, { childList: true });

// ---------- PvP verdict ----------
const pvv = document.createElement("div");
pvv.className = "pvv";
document.body.appendChild(pvv);
function showPvpVerdict(v) {
  const cards = v.players.map((p) => `<div class="pvv-card${p.winner ? " w" : ""}"><h3><span>${esc(p.name)}</span><b>${Math.round(p.score)}</b></h3>
    <div class="pvv-cats">${Object.entries(p.categories || {}).map(([k, n]) => `<span><b>${esc(k)} ${Math.round(n)}/10</b>${p.reasons?.[k] ? ` — ${esc(p.reasons[k])}` : ""}</span>`).join("")}${p.crowd ? `<span>crowd ${p.crowd.bonus >= 0 ? "+" : ""}${p.crowd.bonus}</span>` : ""}</div>
    <p>${esc(p.roast)}</p>${p.best && p.best !== "silence" ? `<p class="best">Best bar: "${esc(p.best)}"</p>` : ""}</div>`).join("");
  pvv.innerHTML = `<div class="pvv-win">${esc(v.winnerName)} wins!</div><div class="pvv-row">${cards}</div><p class="pvv-again">Space = again</p>`;
  pvv.classList.add("on");
  // Cover the right column (the stage's single-player verdict) and leave the MC visible on the left.
  const c = document.querySelector(".right-col")?.getBoundingClientRect();
  if (c && innerWidth - c.left > 560) { pvv.classList.add("placed"); Object.assign(pvv.style, { left: `${Math.round(c.left + 24)}px`, width: `${Math.round(innerWidth - c.left - 56)}px`, top: "12vh" }); }
  requestAnimationFrame(() => requestAnimationFrame(() => pvv.classList.add("in")));
}
function hideVerdict() { pvv.classList.remove("in", "on"); }

new MutationObserver(() => {
  if (document.body.dataset.screen === "idle") { pvp = null; livePlayer = null; lastHeardName = ""; hideVerdict(); }
  renderBanner();
}).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });

const es = new EventSource("/api/events");
es.onmessage = (m) => {
  let ev; try { ev = JSON.parse(m.data); } catch { return; }
  switch (ev.type) {
    case "players": applyPlayers(ev); break;
    case "mic-check": if (ev.pid) { micOk.set(ev.pid, !!ev.ok); renderLobby(); } break;
    case "audience-joined": case "audience-left": audience = ev.count ?? audience; renderLobby(); break;
    case "song-ready":
      pvp = ev.session?.pvp || null; lastSaid = {}; livePlayer = null; hideVerdict();
      lastHeardName = pvp ? "" : ev.session?.playerName || ""; // VS the object: label with who's up
      renderBanner();
      break;
    case "record-start": if (pvp) { livePlayer = ev.player || null; renderBanner(); } break;
    case "take-heard":
      if (pvp && ev.player) { lastSaid[ev.player] = ev.transcript || ""; lastHeardName = ev.playerName || ""; livePlayer = null; renderBanner(); }
      break;
    case "verdict": if (ev.pvp) { livePlayer = null; renderBanner(); setTimeout(() => showPvpVerdict(ev.pvp), 2400); } break;
    case "reset": pvp = null; hideVerdict(); renderBanner(); break;
  }
};
loadLobby();
