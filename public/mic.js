// dissPICable - phone mic. Snap an object, then sing your lines into the phone when the stage says so.
import { openMicTest, micPassed, paintChips, micTestOpen, closeMicTest, getMicStream } from "./mictest.js";
import { listen as listenEvents } from "./events.js";
const $ = (id) => document.getElementById(id);
const QUIPS = [
  "CUTTING YOU OUT...", "GIVING IT A VOICE...", "TEACHING IT TO SWEAR (POLITELY)...", "ASKING OUR NAN...",
  "WARMING UP THE BARS...", "PUTTING THE KETTLE ON...", "TELLING IT TO STOP MITHERIN'...",
];
const DONE_QUIPS = ["Sound!", "Mint!", "Proper!", "Buzzin'!", "Nailed it (maybe)."];

const state = {
  id: null, session: null, screen: "snapScreen",
  stream: null, micAsked: false, micUnavailableSent: false,
  recording: false, quipTimer: null,
};

// ---------- player identity (from /play: ?code=&name=&pid=). No pid = the old single-phone flow, records every turn. ----------
const PSTORE = "duetMicPlayer";
const player = (() => {
  const q = new URLSearchParams(location.search);
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PSTORE) || "null"); } catch { /* private mode */ }
  if (q.get("pid")) p = { id: q.get("pid"), name: q.get("name") || "Player", code: (q.get("code") || "").toUpperCase(), colour: q.get("colour") || "" };
  if (p?.id) { try { localStorage.setItem(PSTORE, JSON.stringify(p)); } catch { /* ignore */ } }
  return p?.id ? p : null;
})();
if (player) {
  const tag = document.getElementById("hdrRight");
  if (tag) tag.textContent = `${player.name} · on the mic`;
  // Heartbeat every 10 s. A new server "boot" id = the server restarted, so any battle this phone was in is gone: back to the start.
  let boot = null;
  const ping = () => fetch("/api/players/ping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: player.id, name: player.name, code: player.code }) })
    .then((r) => r.json()).then((r) => { if (r?.boot && boot && r.boot !== boot && !state.recording) reset(); if (r?.boot) boot = r.boot; if (r?.player) window.duetPending?.(!!r.player.pending); }).catch(() => {});
  ping(); setInterval(ping, 10000);
  // Leaving the page (closed tab / switched to judging) frees the slot straight away.
  addEventListener("pagehide", () => { try { navigator.sendBeacon("/api/players/leave", new Blob([JSON.stringify({ playerId: player.id })], { type: "application/json" })); } catch { /* ignore */ } });
}
// Stable per-phone id: sent with /api/object, /api/take and mic-unavailable so the server knows which phone is which.
const CLIENT = (() => {
  let c = null;
  try { c = localStorage.getItem("duetClientId"); } catch { /* private mode */ }
  if (!c) { c = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); try { localStorage.setItem("duetClientId", c); } catch { /* ignore */ } }
  return c;
})();
// Clock sync with the server (record-start carries startAt in server time): offset = server - phone, best of 3 by round trip.
let clockOffset = 0;
async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    try { const t0 = Date.now(); const r = await fetch("/api/time", { cache: "no-store" }); const { now } = await r.json(); const t1 = Date.now(); if (Number.isFinite(now) && t1 - t0 < best) { best = t1 - t0; clockOffset = now - (t0 + t1) / 2; } } catch { /* offline: keep the last offset */ }
  }
}
syncClock(); setInterval(syncClock, 60000);
let armedRound = null; // a record-start we're counting down to (stops a duplicate starting twice)
// A record-start aimed at another phone (by client id or player id) is not ours. No target = everyone records (old flow).
const forOther = (ev) => !!((ev.client && ev.client !== CLIENT) || (player && ev.player && ev.player !== player.id));

// ---------- keep the screen awake (Wake Lock API; tiny muted looping video only if unsupported) ----------
const wakeSupported = "wakeLock" in navigator;
let wakeLock = null, wakeWanted = false, wakeVideo = null;
async function keepAwake() {
  wakeWanted = true;
  if (wakeSupported) {
    if (wakeLock && !wakeLock.released) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener?.("release", () => { wakeLock = null; }); } catch { /* denied / low battery */ }
    return;
  }
  try {
    if (!wakeVideo) {
      const c = document.createElement("canvas"); c.width = c.height = 2;
      const g = c.getContext("2d"); let f = 0;
      setInterval(() => { g.fillStyle = (f++ % 2) ? "#000" : "#010101"; g.fillRect(0, 0, 2, 2); }, 1000);
      wakeVideo = document.createElement("video");
      Object.assign(wakeVideo, { muted: true, loop: true, playsInline: true });
      wakeVideo.setAttribute("muted", ""); wakeVideo.setAttribute("playsinline", "");
      wakeVideo.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      if (c.captureStream) wakeVideo.srcObject = c.captureStream(1);
      document.body.appendChild(wakeVideo);
    }
    await wakeVideo.play();
  } catch { /* best effort */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wakeWanted) keepAwake(); });

// iPhone Safari: the AudioContext must be created/resumed inside a tap or the level meter stays flat.
let ctx;
function unlockAudio() {
  try {
    if (ctx?.state === "closed") ctx = null;
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== "running") ctx.resume?.();
  } catch { /* no Web Audio */ }
}
document.addEventListener("pointerdown", () => { unlockAudio(); keepAwake(); }, { capture: true });

// ---------- screens ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("show", s.id === id));
  state.screen = id;
  if (id !== "wakeScreen") clearInterval(state.quipTimer);
}
function setAccent(c) { if (/^#[0-9a-f]{3,8}$/i.test(c || "")) document.documentElement.style.setProperty("--accent", c); }
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };

// ---------- net ----------
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${url} ${res.status}`);
  return data;
}
async function broadcast(event) {
  try { return await postJson("/api/broadcast", event); }
  catch { return postJson("/api/phone", event).catch(() => null); } // older server: /api/phone is the same thing
}

// ---------- mic permission (asked on the first tap so it never interrupts the song) ----------
const micSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
function micTip(text) {
  for (const id of ["micTip", "micTip2"]) { $(id).innerHTML = text; $(id).classList.remove("hidden"); }
}
// A mic track can die (camera app took the mic on Android, phone slept): treat ended or muted tracks as dead.
const streamLive = (s) => { const t = s?.getAudioTracks?.() || []; return t.length > 0 && t.every((x) => x.readyState === "live" && !x.muted); };
function releaseMic() {
  if (!state.stream) return;
  try { state.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  state.stream = null; state.micAsked = false; // permission is already granted, so asking again is silent
}
function ensureMic() {
  if (state.stream && streamLive(state.stream)) return Promise.resolve(state.stream);
  if (state.stream) releaseMic(); // dead stream: drop it and grab a fresh one
  if (state.micPending) return state.micPending;
  state.micPending = askMic().finally(() => { state.micPending = null; });
  return state.micPending;
}
async function askMic() {
  if (!micSupported()) {
    if (!state.micUnavailableSent) { state.micUnavailableSent = true; broadcast({ type: "mic-unavailable", reason: window.isSecureContext ? "no-recorder" : "insecure", client: CLIENT, player: player?.id }); }
    micTip(`Mic blocked on this link. Open the <b>https://</b> link shown on the stage (tap Advanced → Proceed once).<br>The stage will use the laptop mic for now.`);
    return null;
  }
  if (state.micAsked && !state.stream) return null;
  state.micAsked = true;
  try {
    state.stream = await getMicStream(); // echoCancellation off: on Android it switches to call audio and the meter/take go flat
    return state.stream;
  } catch (e) {
    if (!state.micUnavailableSent) { state.micUnavailableSent = true; broadcast({ type: "mic-unavailable", reason: e.name || "denied", client: CLIENT, player: player?.id }); }
    micTip("Mic permission was blocked. Tap the lock icon in the address bar → Permissions → Microphone → Allow, then reload.<br>The stage will use the laptop mic for now.");
    return null;
  }
}

// ---------- 1. Snap ----------
// Label click still opens the camera. First time: ask for the mic (permission sticks), then let go of it so the
// camera app on Android doesn't kill our track (that made the 2nd snap silent). We grab it again after the photo.
$("snapBtn").addEventListener("click", () => {
  keepAwake(); unlockAudio();
  if (!state.micAsked) ensureMic().then((s) => { if (s && state.screen === "snapScreen") releaseMic(); });
  else releaseMic();
});
$("cam").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  ensureMic();
  buzz(30);
  show("wakeScreen");
  let i = Math.floor(Math.random() * QUIPS.length);
  $("quip").textContent = QUIPS[i];
  state.quipTimer = setInterval(() => {
    $("quip").style.opacity = 0;
    setTimeout(() => { i = (i + 1) % QUIPS.length; $("quip").textContent = QUIPS[i]; $("quip").style.opacity = 1; }, 300);
  }, 2200);
  try {
    const image = await shrink(file);
    $("wakeThumb").src = `data:${image.mime};base64,${image.data}`;
    $("wakeThumb").classList.remove("hidden");
    const mock = new URLSearchParams(location.search).has("mock") ? "?mock=1" : "";
    const session = await postJson(`/api/object${mock}`, { image, client: CLIENT, ...(player ? { player: player.id } : {}) });
    if (session?.ovo) { clearInterval(state.quipTimer); window.dispatchEvent(new CustomEvent("ovo-snapped", { detail: session })); return; } // OBJECT vs OBJECT: ovo-phone.js
    onSongReady(session, true);
  } catch (err) {
    showError(err.message);
  }
});

/** Downscale to max 1024px JPEG (q 0.82). Returns {data: base64, mime}. */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error("Couldn't read that photo")); im.src = url; });
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", 0.82).split(",")[1], mime: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- 2. Song ready ----------
function onSongReady(session, mine = false) {
  if (!session?.id) return;
  state.id = session.id; state.session = session;
  if (state.recording) return; // keep the id, don't yank the screen mid-take
  setAccent(session.character?.colour);
  const pic = session.photo || $("wakeThumb").getAttribute("src");
  if (pic) $("avatar").src = pic; else $("avatar").removeAttribute("src");
  $("charName").textContent = session.character?.name || session.object || (session.mode === "karaoke" ? "Your partner" : "Your opponent");
  $("songTitle").textContent = session.song?.title ? `"${session.song.title}"${session.song.genre ? " · " + session.song.genre : ""}` : "";
  { // difficulty chip (MILD / SPICY / SAVAGE) under the song title
    let chip = $("diffChip");
    if (!chip) { chip = document.createElement("div"); chip.id = "diffChip"; chip.style.cssText = "display:inline-block;margin-top:8px;padding:2px 10px;border:3px solid #111;background:#ffd400;color:#111;font-weight:700;font-size:14px;letter-spacing:.08em;text-transform:uppercase"; $("songTitle").after(chip); }
    const d = ["mild", "spicy", "savage"].includes(session.difficulty) ? session.difficulty : "spicy";
    chip.textContent = { mild: "Mild · light roast", spicy: "Spicy", savage: "Savage · no mercy" }[d];
    chip.style.background = { mild: "#9fe8b0", spicy: "#ffd400", savage: "#ff4f9a" }[d];
  }
  const battle = session.mode !== "karaoke";
  const pv = session.pvp?.players, mineP = player && pv?.find((p) => p.id === player.id);
  if (pv) $("readyHint").textContent = mineP ? `PLAYER vs PLAYER! ${pv[0].name} vs ${pv[1].name}. Wait for your turn, then spit.` : `${pv[0].name} vs ${pv[1].name}! Watch the big screen.`;
  else if (player && session.player && session.player !== player.id) $("readyHint").textContent = `${session.playerName || "Someone else"} is up this time. Watch the big screen.`;
  else $("readyHint").textContent = session.returning ? "Back for more, are we? Watch the big screen." : battle ? "Roast battle! Listen to its opener, then freestyle back into this phone. No lyrics, make it up." : "Karaoke! Lyrics are on the big screen. This phone is your mic.";
  buzz(mine ? [80, 60, 80] : 60);
  show("readyScreen");
  ensureMic();
  // Mic never passed on this phone: prompt the test before the first turn (if it isn't someone else's battle).
  const notMine = (pv && !mineP) || (player && session.player && session.player !== player.id);
  markJudgeOut(notMine);
  if (!notMine && !micPassed() && !micTestOpen()) runMicTest(true);
}
// Way out to the crowd page (someone who meant to JUDGE but tapped Battle); big + yellow when it is not their battle.
{
  const q = new URLSearchParams(location.search);
  const link = document.getElementById("judgeOut");
  if (link) link.href = `/join.html?${new URLSearchParams({ code: q.get("code") || "", name: q.get("name") || player?.name || "" })}`;
}
function markJudgeOut(notMine) { document.getElementById("judgeOut")?.classList.toggle("big", !!notMine); }

// ---------- TEST MIC (any [data-mic-test] button, auto-prompted on get-ready) ----------
function runMicTest(auto = false) {
  if (state.recording) return;
  openMicTest({
    auto,
    // Fresh stream from this tap: the one grabbed right after the camera can be live-but-silent on Samsung.
    getStream: () => { releaseMic(); return ensureMic(); },
    audioCtx: () => { unlockAudio(); return ctx; },
    report: (ok) => broadcast({ type: "mic-check", client: CLIENT, player: player?.id, playerName: player?.name, ok }),
  });
}
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-mic-test]")) { unlockAudio(); runMicTest(false); } });
paintChips();

// ---------- 3. Record ----------
let analyser, raf, meterSrc, meterSink;
// Phone never shows lyrics: battle = freestyle (no lyrics at all), karaoke = lyrics live on the big screen.
const isBattle = () => state.session?.mode !== "karaoke";
let countdownTimer = null;
async function onRecordStart(ev) {
  if (forOther(ev)) { // someone else's turn: stay put, show who's on
    if (!state.recording && state.session) { $("readyHint").textContent = `WAITING — ${String(ev.playerName || "the other player").toUpperCase()}'S TURN. Watch the big screen and get your comeback ready...`; show("readyScreen"); }
    return;
  }
  if (state.recording) return;
  const ms = Math.max(1000, Number(ev.ms) || 4000);
  const lineIndex = typeof ev.line === "number" ? ev.line : ev.index;
  if (ev.id) state.id = ev.id;
  const armKey = `${ev.id || state.id}:${lineIndex}`;
  if (armedRound === armKey) return;
  // Stage sends record-start at the start of its 3-2-1 (leadMs): mirror the countdown, open the mic exactly at startAt.
  const startLocal = ev.leadMs && Number(ev.startAt) ? Number(ev.startAt) - clockOffset : Date.now();
  const lateBy = Math.max(0, Date.now() - startLocal); // arrived after the window opened: record the rest of it
  if (startLocal - Date.now() > 150) {
    armedRound = armKey;
    buzz([60, 40, 60]);
    if (micTestOpen()) closeMicTest();
    ensureMic(); // warm the mic during the countdown
    const yl0 = document.querySelector("#recScreen .yourline");
    if (yl0) yl0.textContent = "YOUR TURN IN";
    $("lineText").textContent = "";
    const cb0 = $("countBig");
    clearInterval(countdownTimer);
    const tick0 = () => { const left = Math.max(0, Math.ceil((startLocal - Date.now()) / 550)); cb0.textContent = left ? String(Math.min(3, left)) : "GO!"; cb0.classList.remove("small"); };
    tick0(); countdownTimer = setInterval(tick0, 100);
    show("recScreen");
    while (Date.now() < startLocal - 20) await new Promise((r) => setTimeout(r, Math.min(50, Math.max(5, startLocal - Date.now()))));
    clearInterval(countdownTimer);
    if (armedRound !== armKey) return; // reset during the countdown
  } else buzz([60, 40, 60]);
  armedRound = null;
  const yl = document.querySelector("#recScreen .yourline");
  if (yl) yl.textContent = isBattle() ? (ev.round ? `ROUND ${String(ev.round).padStart(2, "0")} · SPIT` : "FREESTYLE") : "SING";
  clearInterval(countdownTimer);
  $("lineText").textContent = "";
  const cb = $("countBig");
  if (isBattle()) { // huge seconds countdown over the mic head instead of lyrics
    const end = Date.now() + ms - lateBy;
    const tick = () => { const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)); cb.textContent = left ? String(left) : "TIME!"; cb.classList.toggle("small", !left); if (!left) clearInterval(countdownTimer); };
    tick(); countdownTimer = setInterval(tick, 250);
  } else { cb.textContent = ""; cb.classList.remove("small"); }
  if (micTestOpen()) closeMicTest(); // the turn wins over a half-done mic test
  deaf(null);
  show("recScreen");
  const stream = await ensureMic();
  // Timer bar runs either way so the singer knows how long they've got.
  const bar = $("timer");
  bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${Math.max(500, ms - lateBy)}ms linear`; bar.style.transform = "scaleX(0)"; }));
  if (!stream) { setTimeout(() => sent("Laptop's got this one.", "Sing at the laptop - it's listening."), ms); return; }

  state.recording = true;
  const battle = isBattle();
  const mime = pickMime();
  let take = null, cur = stream, peak = 0, refixed = false, stopEarly = false;
  /** Start a MediaRecorder on a LIVE stream. */
  const begin = (s) => {
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    const t = { rec: r, chunks: [], t0: Date.now() };
    r.ondataavailable = (e) => e.data.size && t.chunks.push(e.data);
    t.stopped = new Promise((res) => (r.onstop = res));
    r.start(250);
    return t;
  };
  try { take = begin(cur); } catch (e) { console.warn("[mic] recorder", e); }
  startMeter(cur, (lv) => { peak = Math.max(peak, lv); });
  state.rec = take?.rec; // small Stop button on the mic screen can end the take early
  state.stopTake = () => { stopEarly = true; };
  let endAt = Math.max(Date.now() + 1500, startLocal + (battle ? ms + 300 : ms + 50)); // karaoke: free the mic before the next line starts
  const audioRunning = () => !!ctx && ctx.state === "running";
  // Silence watchdog: flat level for the first 2.5 s -> re-grab the mic once, then tell the stage if still silent.
  const fix = async () => {
    if (refixed || !state.recording) return;
    refixed = true;
    deaf("WE CAN'T HEAR YOU — FIXING THE MIC…");
    try { if (take && take.rec.state !== "inactive") take.rec.stop(); } catch { /* ignore */ }
    stopMeter(); releaseMic();
    try { ctx?.close(); } catch { /* ignore */ } ctx = null; unlockAudio(); // a frozen context reads flat forever: start a new one
    try { await ctx?.resume?.(); } catch { /* ignore */ }
    const s2 = await ensureMic();
    if (!s2 || !state.recording) return;
    cur = s2; peak = 0;
    try { take = begin(cur); state.rec = take.rec; } catch (e) { console.warn("[mic] recorder retry", e); }
    startMeter(cur, (lv) => { peak = Math.max(peak, lv); });
    if (battle) endAt = Math.max(endAt, Date.now() + 2500) + 3000; // stage extends the turn too (mic-silent)
    setTimeout(() => {
      if (!state.recording) return;
      if (peak >= SILENT_LEVEL) { deaf(null); return; }
      deaf("STILL CAN'T HEAR YOU — check mic permission & the silent switch, then TEST MIC");
      broadcast({ type: "mic-silent", client: CLIENT, player: player?.id, playerName: player?.name, id: state.id, round: ev.round ?? lineIndex, extendMs: 3000 });
    }, 2000);
  };
  state.deafTap = () => { unlockAudio(); if (audioRunning() && peak < SILENT_LEVEL) fix(); else if (peak >= SILENT_LEVEL) deaf(null); };
  const watchdog = setTimeout(() => {
    if (!state.recording || peak >= SILENT_LEVEL) return;
    if (!audioRunning()) { deaf("WE CAN'T HEAR YOU — TAP TO FIX"); return; } // can't measure until a tap wakes audio
    fix();
  }, 2500);
  while (Date.now() < endAt && !stopEarly) await new Promise((r) => setTimeout(r, 100));
  clearTimeout(watchdog);
  try { if (take && take.rec.state !== "inactive") take.rec.stop(); } catch { /* ignore */ }
  if (take) await take.stopped;
  state.rec = null; state.stopTake = null; state.deafTap = null;
  stopMeter(); deaf(null);
  state.recording = false;
  const blob = take ? new Blob(take.chunks, { type: take.rec.mimeType || mime || "audio/webm" }) : new Blob([]);
  const durationMs = take ? Date.now() - take.t0 : 0;
  const silent = blob.size < 2048; // no real audio in it
  console.log(`[mic] take r${ev.round ?? lineIndex}: ${blob.size} bytes, ${durationMs} ms, ${blob.type}, peak ${peak.toFixed(2)}${silent ? " (SILENT)" : ""}`);
  clearInterval(countdownTimer);
  // Final round (PvP: either player's last turn) goes to the judges, not a comeback.
  const totalRounds = Number(state.session?.battle?.rounds) || 3;
  const roundNo = Number(ev.round ?? lineIndex) || 0;
  const lastRound = roundNo > 0 && roundNo >= (state.session?.pvp ? totalRounds - 1 : totalRounds);
  if (battle) lastRound ? sent("JUDGING…", "Last bars in. The judges are deciding... watch the stage.") : sent("Bars sent!", state.session?.pvp ? "Over to your rival... watch the stage." : "It's cooking up a comeback... watch the stage.");
  if (silent) { // tell them straight away, and send the take as silent so the judges score it as silence
    sent("WE HEARD NOTHING", "Your phone sent an empty recording. Tap TEST MIC below before your next turn.");
    try { await postJson("/api/take", { id: state.id, line: lineIndex, round: lineIndex, silent: true, durationMs, bytes: blob.size, client: CLIENT, ...(player ? { player: player.id } : {}) }); } catch { /* carry on */ }
    return;
  }
  try {
    const audio = await toBase64(blob);
    const r = await postJson("/api/take", { id: state.id, line: lineIndex, round: lineIndex, audio, mime: blob.type, durationMs, bytes: blob.size, client: CLIENT, ...(player ? { player: player.id } : {}) });
    if (battle && state.screen === "sentScreen") $("sentText").textContent = r?.transcript ? `It heard: "${String(r.transcript).slice(0, 120)}". Brace yourself.` : "It heard... nothing. It's going to destroy you for that. Tap TEST MIC below.";
  } catch (err) {
    if (battle && state.screen === "sentScreen") $("sentText").textContent = "Couldn't send that one - carry on!";
  }
}
$("stopBtn")?.addEventListener("click", () => {
  broadcast({ type: "verse-done", client: CLIENT, player: player?.id, id: state.id }); /* stage ends the turn now */ if (state.stopTake) state.stopTake(); else if (state.rec && state.rec.state !== "inactive") state.rec.stop(); });
const SILENT_LEVEL = 0.03; // meter level (RMS x4) below this the whole time = we hear nothing
/** Supported recording type: iPhone = audio/mp4, everyone else = webm/opus. */
function pickMime() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const order = ios ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return order.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
}
/** Big "WE CAN'T HEAR YOU" overlay on the record screen (null hides it). */
function deaf(text) {
  let el = $("deafBtn");
  if (!el && text) {
    el = document.createElement("button"); el.id = "deafBtn"; el.type = "button"; el.className = "deaf";
    el.addEventListener("click", () => state.deafTap?.());
    $("recScreen").appendChild(el);
  }
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  if (text) buzz([200, 100, 200]);
}
function sent(title, text) { $("sentTitle").textContent = title; $("sentText").textContent = text; show("sentScreen"); }

function startMeter(stream, onLevel) {
  try {
    unlockAudio();
    const src = meterSrc = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    // Safari only runs nodes that reach the speakers: route through a silent gain.
    meterSink = ctx.createGain(); meterSink.gain.value = 0; analyser.connect(meterSink); meterSink.connect(ctx.destination);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      $("meter").style.transform = `scaleX(${level})`;
      $("ring").style.transform = `scale(${1 + level * 0.6})`;
      onLevel?.(level);
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* meter is decoration; recording still works */ }
}
function stopMeter() { cancelAnimationFrame(raf); for (const n of [meterSrc, analyser, meterSink]) { try { n?.disconnect(); } catch { /* ignore */ } } meterSrc = meterSink = null; $("meter").style.transform = "scaleX(0)"; $("ring").style.transform = "scale(1)"; }

function toBase64(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(blob); });
}

// ---------- 4. Verdict / reset ----------
function onVerdict(ev) {
  const mine = player && ev.pvp?.players?.find((p) => p.id === player.id); // PvP: my own score + roast
  const score = Math.max(0, Math.min(100, Math.round(Number(mine ? mine.score : ev.score) || 0)));
  $("roast").textContent = mine ? `${mine.winner ? "YOU WON! " : `${ev.pvp.winnerName} won. `}${mine.roast || ""}` : ev.roast || "";
  show("verdictScreen");
  const el = $("score");
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 1200); el.innerHTML = `${Math.round(score * (1 - Math.pow(1 - k, 3)))}<small>/100</small>`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { el.innerHTML = `${score}<small>/100</small>`; }, 1300); // in case rAF is throttled
  buzz(score >= 70 ? [100, 50, 100, 50, 300] : score >= 40 ? [200, 100, 200] : [600]);
}
function reset() {
  state.session = null; state.id = null; armedRound = null;
  if (!state.recording) show("snapScreen");
}
$("againBtn").addEventListener("click", () => { broadcast({ type: "reset" }); reset(); });
function showError(msg) { $("errText").textContent = msg || "Give it another go."; show("errScreen"); }
$("errBtn").addEventListener("click", () => show(state.session ? "readyScreen" : "snapScreen"));

// ---------- events ----------
function connect() {
  listenEvents((ev) => { // SSE on Wi-Fi, long-poll on the tunnel (events.js)
    switch (ev.type) {
      case "song-ready": onSongReady(ev.session); break;
      case "record-start": onRecordStart(ev); break;
      case "verdict": onVerdict(ev); break;
      case "reset": reset(); break;
      case "players": if (player) { const me = (ev.players || []).find((p) => p.id === player.id); if (me) window.duetPending?.(!!me.pending); } break;
      case "player-declined": if (player && ev.playerId === player.id) goJudge(); break;
      case "photo-received": if (state.screen === "snapScreen") { show("wakeScreen"); } break;
    }
  }, { onOpen: () => $("dot").classList.add("on"), onError: () => $("dot").classList.remove("on") });
}
// The phone only allows the mic on a secure page: jump from the plain Wi-Fi link to the HTTPS one (port + 1).
// Only on a plain-http LAN IP (never on a tunnel like *.trycloudflare.com, which is already https).
const lanHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+(\.\d+)?$/.test(location.hostname);
if (!window.isSecureContext && location.protocol === "http:" && lanHost) {
  location.replace(`https://${location.hostname}:${Number(location.port || 80) + 1}${location.pathname}${location.search}`);
} else {
  connect();
  if (!wakeSupported) $("wakeTip")?.classList.remove("hidden");
  if (!micSupported()) micTip(`Mic blocked on this link. Open the <b>https://</b> link shown on the stage (tap Advanced → Proceed once).<br>The stage will use the laptop mic for now.`);
}

// ---------- Host approval: new players wait until the laptop lets them in; declined = off to the judges ----------
function goJudge() {
  const q = new URLSearchParams(location.search);
  location.href = `/join.html?${new URLSearchParams({ code: q.get("code") || player?.code || "", name: q.get("name") || player?.name || "" })}`;
}
window.duetPending = (on) => {
  let ov = document.getElementById("pendingOv");
  if (!on) { ov?.remove(); return; }
  if (ov) return;
  ov = document.createElement("div"); ov.id = "pendingOv";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;background:#e9e4d6;color:#111;font-family:Anton,Impact,sans-serif";
  ov.innerHTML = `<div style="font-size:44px;line-height:1;text-transform:uppercase">Waiting for the host</div><div style="font:700 18px/1.4 monospace">The big screen has to let you in to battle.</div><button type="button" id="pendJudge" style="font:700 18px monospace;padding:12px 18px;border:4px solid #111;background:#ffd400;color:#111;box-shadow:5px 5px 0 #111">Judge instead &rarr;</button>`;
  document.body.appendChild(ov);
  ov.querySelector("#pendJudge").addEventListener("click", goJudge);
};
