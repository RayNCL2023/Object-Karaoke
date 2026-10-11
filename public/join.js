// dissPICable - audience phone: join the crowd with the room code, react during the show, vote on battle rounds.
import { PLACEHOLDERS } from "./placeholders.js";
import { listen as listenEvents } from "./events.js";

const $ = (id) => document.getElementById(id);
const COLOURS = ["#ff4f9a", "#ffd400", "#3b6fe0", "#2f8f6a", "#ff7a1a", "#8a5cff", "#e23b4e", "#111111"];
const STORE = "duetAudience";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* private mode */ } };
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const art = (id) => { const p = PLACEHOLDERS.find((x) => x.id === id) || PLACEHOLDERS[0]; return `<svg viewBox="0 0 200 200" aria-hidden="true">${p.art}</svg>`; };

let me = load();          // { audienceId, code, name, avatar, colour }
let pick = { avatar: me.avatar || PLACEHOLDERS[(Math.random() * PLACEHOLDERS.length) | 0].id, colour: me.colour || COLOURS[(Math.random() * COLOURS.length) | 0] };
let session = null;       // current battle { id, name }
let voteRound = 0, myVotes = {};

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `${res.status}`); e.status = res.status; throw e; }
  return data;
}
function show(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("show", s.id === id)); }

// ---------- join form ----------
function renderPickers() {
  $("avatars").innerHTML = PLACEHOLDERS.map((p) => `<button type="button" class="av${p.id === pick.avatar ? " on" : ""}" data-id="${p.id}" aria-label="${esc(p.name)}">${art(p.id)}</button>`).join("");
  $("colours").innerHTML = COLOURS.map((c) => `<button type="button" class="sw${c === pick.colour ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="colour ${c}"></button>`).join("");
}
$("avatars").addEventListener("click", (e) => { const b = e.target.closest(".av"); if (b) { pick.avatar = b.dataset.id; renderPickers(); buzz(10); } });
$("colours").addEventListener("click", (e) => { const b = e.target.closest(".sw"); if (b) { pick.colour = b.dataset.c; renderPickers(); buzz(10); } });

async function join(auto = false) {
  const code = (auto ? me.code : $("code").value).trim().toUpperCase();
  const name = (auto ? me.name : $("name").value).trim();
  if (!auto && (!code || !name)) { $("joinErr").textContent = "Need the room code and a nickname"; return; }
  $("joinBtn").disabled = true;
  try {
    const r = await post("/api/audience/join", { code, name, avatar: pick.avatar, colour: pick.colour, audienceId: me.audienceId });
    me = { audienceId: r.audienceId, code, name: r.member.name, avatar: r.member.avatar, colour: r.member.colour };
    save(me);
    enterCrowd();
  } catch (e) {
    if (!auto) $("joinErr").textContent = e.message;
    show("joinScreen");
  } finally { $("joinBtn").disabled = false; }
}
$("joinBtn").addEventListener("click", () => join(false));
$("code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });

function enterCrowd() {
  document.documentElement.style.setProperty("--me", me.colour);
  $("meFace").innerHTML = art(me.avatar);
  $("meName").textContent = me.name;
  $("roomTag").textContent = `ROOM ${me.code}`;
  show("crowdScreen");
  buzz([20, 40, 20]);
  syncState();
}

$("leaveBtn").addEventListener("click", async () => {
  try { await post("/api/audience/leave", { audienceId: me.audienceId }); } catch { /* gone anyway */ }
  me = { name: me.name, code: me.code, avatar: me.avatar, colour: me.colour };
  save(me);
  $("name").value = me.name || ""; $("code").value = me.code || "";
  show("joinScreen");
});

// ---------- reactions (server allows one per 700 ms) ----------
let coolUntil = 0;
$("pads").addEventListener("click", async (e) => {
  const b = e.target.closest(".pad");
  if (!b) return;
  const now = Date.now();
  if (now < coolUntil) return;
  coolUntil = now + 720;
  b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 140);
  document.querySelectorAll(".pad").forEach((p) => p.classList.add("cool"));
  setTimeout(() => document.querySelectorAll(".pad").forEach((p) => p.classList.remove("cool")), 720);
  buzz(25);
  try { await post("/api/audience/react", { audienceId: me.audienceId, type: b.dataset.r }); }
  catch (err) { if (err.status === 404) join(true); }
});

// ---------- round votes ----------
function openVote(round) {
  if (!session) return;
  voteRound = round;
  $("voteTitle").textContent = `Round ${round}: who won?`;
  if (session.pvp) { // PLAYER vs PLAYER: vote for one of the two players (value = player id)
    [["votePlayer", 0], ["voteObject", 1]].forEach(([id, i]) => { $(id).dataset.v = session.pvp[i].id; $(id).textContent = session.pvp[i].name; });
  } else {
    $("votePlayer").dataset.v = "player"; $("votePlayer").textContent = "The human";
    $("voteObject").dataset.v = "object";
  }
  if (!session.pvp) $("voteObject").textContent = session.name || "The object";
  $("voteTally").textContent = "";
  for (const b of $("vote").querySelectorAll("button")) b.classList.toggle("on", myVotes[`${session.id}|${round}`] === b.dataset.v);
  $("vote").classList.add("show");
  buzz([30, 60, 30]);
}
$("vote").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b || !session || !voteRound) return;
  myVotes[`${session.id}|${voteRound}`] = b.dataset.v;
  for (const x of $("vote").querySelectorAll("button")) x.classList.toggle("on", x === b);
  buzz(20);
  try { await post("/api/audience/vote", { audienceId: me.audienceId, id: session.id, round: voteRound, value: b.dataset.v }); }
  catch (err) { if (err.status === 404) join(true); else $("voteTally").textContent = err.message; }
});

// ---------- show phase from the server's event stream ----------
function phase(title, sub) { $("phaseTitle").textContent = title; $("phaseSub").textContent = sub || ""; }
// Late / reloaded judges: catch up with the show (and an open vote) instead of waiting for the next event.
async function syncState() {
  if (!me.audienceId) return;
  try {
    const res = await fetch("/api/audience/state", { cache: "no-store" });
    if (!res.ok) return;
    const st = await res.json();
    if (!st.session) { session = null; voteRound = 0; $("vote").classList.remove("show"); phase("Waiting for a battle", "Someone's snapping an object..."); return; }
    const s = st.session;
    session = { id: s.id, name: s.name || "The object", battle: !!s.battle, pvp: s.pvp || null };
    if (st.phase === "verdict") phase("The judges have spoken", "Watch the big screen");
    else if (st.phase === "record") phase(st.playerName ? `${st.playerName} on the mic!` : st.round ? `Round ${st.round}: freestyle!` : "Their turn!", "Make some noise");
    else if (session.pvp) phase(`${session.pvp[0].name} vs ${session.pvp[1].name}`, "You judge!");
    else phase(`${session.name} is up!`, session.battle ? "roast battle - you judge" : "karaoke time - hype them up");
    if (st.voteOpen && st.voteRound) openVote(st.voteRound); else $("vote").classList.remove("show");
  } catch { /* offline: the event stream will catch us up */ }
}
function listen() {
  listenEvents((ev) => {
    switch (ev.type) {
      case "photo-received": phase("Something's waking up", "Hold tight..."); break;
      case "song-ready": {
        const s = ev.session || {};
        session = { id: s.id, name: s.character?.name || "The object", battle: s.mode === "battle" || !!s.battle, pvp: s.pvp?.players || null };
        $("vote").classList.remove("show");
        if (session.pvp) { phase(`${session.pvp[0].name} vs ${session.pvp[1].name}`, `${session.name} the ${s.object || "object"} is hosting. You judge!`); break; }
        phase(`${session.name} is up!`, session.battle ? `the ${s.object || "object"} wants a roast battle` : "karaoke time - hype them up");
        break;
      }
      // OBJECT vs OBJECT (lib/ovo.mjs): votes are for the two objects (values ovo_a / ovo_b), shaped like PvP
      case "ovo-photo": if (!session?.ovo) phase("Two objects are waking up", "Object vs object - get ready to judge"); break;
      case "ovo-ready": {
        const s = ev.session || {};
        session = { id: s.id, name: s.title || "Object vs Object", battle: true, ovo: true, pvp: (s.sides || []).map((x) => ({ id: x.value, name: x.character?.name || "Object" })) };
        $("vote").classList.remove("show");
        phase(`${session.pvp[0].name} vs ${session.pvp[1].name}`, `${s.title || "Object vs object"} - you judge!`);
        break;
      }
      case "ovo-vote": if (session?.ovo && ev.id === session.id) { phase(`Round ${ev.round}: who won?`, "Vote now!"); openVote(Number(ev.round) || 1); } break;
      case "ovo-verdict":
        if (session?.ovo) { phase(`${ev.winnerName} wins!`, (ev.sides || []).map((x) => `${x.name} ${x.score}`).join(" · ")); setTimeout(() => $("vote").classList.remove("show"), 4000); }
        break;
      case "record-start":
        $("vote").classList.remove("show");
        phase(ev.playerName ? `${ev.playerName} on the mic!` : ev.round ? `Round ${ev.round}: freestyle!` : "Their turn to sing!", "Make some noise");
        break;
      case "take-heard": if (session?.battle) phase(`Round ${ev.round}`, `They said: "${String(ev.transcript || "...").slice(0, 80)}"`); break;
      case "take-received":
        if (session?.pvp && ev.round) { phase(`${ev.playerName || "They"} said it`, ev.comeback ? "The MC reacts..." : "Off to the judges"); if (ev.voteOpen) openVote(ev.pvpRound); break; }
        if (session?.battle && ev.round) { phase(`Round ${ev.round}`, ev.comeback ? "Comeback incoming..." : "Off to the judges"); openVote(ev.round); }
        break;
      case "audience-tally":
        if (session?.pvp && ev.id === session.id && ev.round === voteRound) { const c = ev.counts || {}; $("voteTally").textContent = `${session.pvp[0].name} ${c[session.pvp[0].id] || 0} - ${c[session.pvp[1].id] || 0} ${session.pvp[1].name}`; break; }
        if (session && ev.id === session.id && ev.round === voteRound) $("voteTally").textContent = `Human ${ev.player} - ${ev.object} ${session.name}`;
        break;
      case "verdict":
        if (ev.pvp) { phase(`${ev.pvp.winnerName} wins!`, ev.pvp.players.map((x) => `${x.name} ${x.score}`).join(" · ")); setTimeout(() => $("vote").classList.remove("show"), 4000); break; }
        phase(`Score: ${ev.score}/100`, ev.crowd ? `crowd vote ${ev.crowd.bonus >= 0 ? "+" : ""}${ev.crowd.bonus}` : "the judges have spoken");
        setTimeout(() => $("vote").classList.remove("show"), 4000);
        break;
      case "reset":
        session = null; voteRound = 0; $("vote").classList.remove("show");
        phase("Waiting for a battle", "Someone's snapping an object...");
        break;
    }
  }, { onOpen: () => { $("dot").classList.add("on"); syncState(); }, onError: () => $("dot").classList.remove("on") });
}

// ---------- boot ----------
const qsCode = new URLSearchParams(location.search).get("code");
$("code").value = (qsCode || me.code || "").toUpperCase().slice(0, 4);
$("name").value = new URLSearchParams(location.search).get("name") || me.name || ""; // prefilled from /play
renderPickers();
listen();
if (me.audienceId && me.name && me.code && (!qsCode || qsCode.toUpperCase() === me.code)) join(true);
