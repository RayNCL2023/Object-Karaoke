// Duet Anything - stage (laptop / projector). Owns index.html + stage.css.
import { onPhone, status } from "./api.js";

// ---------- beats.js (written by another bot) - every call guarded ----------
let beats = {};
try { beats = await import("./beats.js"); } catch (e) { console.warn("[stage] beats.js not available yet:", e.message); }
let fallbackBpm = 0, fallbackStart = 0;
const Beat = {
  async start(o) { fallbackBpm = o.bpm || 100; fallbackStart = performance.now(); try { await beats.startBeat?.(o); } catch (e) { console.warn("[stage] startBeat", e); } },
  stop() { fallbackBpm = 0; try { beats.stopBeat?.(); } catch (e) { console.warn("[stage] stopBeat", e); } },
  pulse() {
    if (typeof beats.getBeatPulse === "function") { try { return +beats.getBeatPulse() || 0; } catch { return 0; } }
    if (!fallbackBpm) return 0; // fake pulse so the character still bobs without beats.js
    const phase = (((performance.now() - fallbackStart) / 60000) * fallbackBpm) % 1;
    return Math.pow(1 - phase, 4);
  },
  sting(n) { try { beats.playSting?.(n); } catch (e) { console.warn("[stage] sting", e); } },
  duck(on) { try { beats.setDuck?.(on); } catch (e) { console.warn("[stage] duck", e); } },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  gate: $("gate"), gateBtn: $("gateBtn"), qr: $("qr"), phoneUrl: $("phoneUrl"), idleCta: $("idleCta"), idleCtaText: $("idleCtaText"), idleBoard: $("idleBoard"),
  show: $("show"), charWrap: $("charWrap"), charImg: $("charImg"), mouth: $("mouth"), charName: $("charName"), charObject: $("charObject"), charCatch: $("charCatch"),
  songGenre: $("songGenre"), songTitle: $("songTitle"), track: $("track"), lyrics: $("lyrics"),
  rec: $("rec"), count: $("count"), recState: $("recState"), got: $("got"), judging: $("judging"),
  scoreNum: $("scoreNum"), roast: $("roast"), bw: $("bw"), board: $("board"), againBtn: $("againBtn"),
  confetti: $("confetti"), toast: $("toast"), beatRing: $("beatRing"),
};
const glow = el.charWrap.querySelector(".char-glow");
const eyes = [...document.querySelectorAll(".eye")];
const pupils = [...document.querySelectorAll(".pupil")];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setScreen = (s) => { document.body.dataset.screen = s; state = s; };
function toast(msg, ms = 2600) { el.toast.textContent = msg; el.toast.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.toast.classList.remove("on"), ms); }
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json().catch(() => ({}));
}
const broadcast = (ev) => (session?.demo && ev.type !== "reset") ? Promise.resolve() : postJson("/api/broadcast", ev).catch(() => postJson("/api/phone", ev)).catch(() => {});

// ---------- Audio: one context, analyser feeds the mouth ----------
let ctx = null, analyser = null, levelBuf = null, unlocked = false;
let fakeTalk = 0; // >0 while speechSynthesis fallback is talking
function ensureAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  analyser.connect(ctx.destination);
  levelBuf = new Uint8Array(analyser.fftSize);
  return ctx;
}
async function unlock() {
  if (unlocked) return;
  unlocked = true;
  ensureAudio();
  try { await ctx.resume(); } catch {}
  try { if (window.Tone) await window.Tone.start(); } catch {}
  el.gate.classList.add("hide");
}
el.gateBtn.addEventListener("click", unlock);

function voiceLevel() {
  if (fakeTalk > 0) { const t = performance.now() / 1000; return 0.35 + 0.35 * Math.abs(Math.sin(t * 11)) * (0.6 + 0.4 * Math.sin(t * 3.7)); }
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) { const v = (levelBuf[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4.5);
}

/** Play an MP3 through the analyser. Resolves when it ends (or times out). onMeta gets the real duration in ms. */
function playMp3(url, maxMs, onMeta) {
  return new Promise((resolve, reject) => {
    ensureAudio();
    const a = new Audio();
    a.src = url;
    a.preload = "auto";
    let done = false, timer;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); try { src.disconnect(); } catch {} err ? reject(err) : resolve(); };
    const src = ctx.createMediaElementSource(a);
    src.connect(analyser);
    a.addEventListener("loadedmetadata", () => { if (isFinite(a.duration)) { onMeta?.(a.duration * 1000); clearTimeout(timer); timer = setTimeout(() => finish(), a.duration * 1000 + 1500); } });
    a.addEventListener("ended", () => finish());
    a.addEventListener("error", () => finish(new Error("audio error")));
    timer = setTimeout(() => finish(), (maxMs || 6000) + 2500);
    playing.add(a);
    a.play().catch(finish);
    a.addEventListener("ended", () => playing.delete(a));
  });
}
const playing = new Set();
function stopAllAudio() { for (const a of playing) { try { a.pause(); } catch {} } playing.clear(); try { speechSynthesis.cancel(); } catch {} fakeTalk = 0; }

/** Free fallback voice (MOCK / missing audio): browser speech + fake mouth. */
function speakFallback(text, ms, colourSeed = 0) {
  return new Promise((resolve) => {
    let done = false;
    const end = () => { if (done) return; done = true; fakeTalk = Math.max(0, fakeTalk - 1); resolve(); };
    fakeTalk++;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const gb = speechSynthesis.getVoices().filter((v) => /en-GB/i.test(v.lang));
      if (gb.length) u.voice = gb[colourSeed % gb.length];
      u.rate = 1.05; u.pitch = 0.8 + (colourSeed % 5) * 0.12;
      u.onend = end; u.onerror = end;
      speechSynthesis.speak(u);
    } catch { /* no speech: mouth still flaps for ms */ }
    setTimeout(end, (ms || 3000) + 1500);
  });
}

// ---------- Render loop: mouth, bounce, glow, beat ring (transform/opacity only) ----------
let mouthLvl = 0, bounce = 0, ringT = 0, lastPulse = 0;
function frame() {
  const target = voiceLevel();
  mouthLvl += (target - mouthLvl) * (target > mouthLvl ? 0.55 : 0.25);
  el.mouth.style.transform = `scaleY(${(0.12 + mouthLvl * 0.95).toFixed(3)}) scaleX(${(1 - mouthLvl * 0.12).toFixed(3)})`;

  const p = Beat.pulse();
  bounce += (p - bounce) * 0.35;
  el.charWrap.style.transform = `translate3d(0, ${(-bounce * 16).toFixed(2)}px, 0) scale(${(1 + bounce * 0.025 + mouthLvl * 0.015).toFixed(4)}) rotate(${(Math.sin(performance.now() / 900) * 1.4).toFixed(2)}deg)`;
  glow.style.opacity = (0.55 + bounce * 0.35 + mouthLvl * 0.3).toFixed(3);

  if (p > 0.85 && lastPulse <= 0.85) ringT = 1; // new beat: fire the background ring
  lastPulse = p;
  ringT = Math.max(0, ringT - 0.025);
  el.beatRing.style.opacity = (ringT * 0.5).toFixed(3);
  el.beatRing.style.transform = `scale(${(0.6 + (1 - ringT) * 0.7).toFixed(3)})`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Blinking + wandering pupils
(function blinkLoop() {
  setTimeout(() => {
    eyes.forEach((e) => { e.classList.remove("blink"); void e.offsetWidth; e.classList.add("blink"); });
    if (Math.random() < 0.2) setTimeout(() => eyes.forEach((e) => { e.classList.remove("blink"); void e.offsetWidth; e.classList.add("blink"); }), 260);
    blinkLoop();
  }, 1800 + Math.random() * 3200);
})();
(function lookLoop() {
  const x = (Math.random() - 0.5) * 40, y = (Math.random() - 0.5) * 30;
  pupils.forEach((p) => (p.style.transform = `translate3d(${x}%, ${y}%, 0)`));
  setTimeout(lookLoop, 1200 + Math.random() * 2400);
})();

// ---------- Accent colour ----------
function setAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const h = m ? m[1] : "ff5a36";
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  document.documentElement.style.setProperty("--accent", `#${h}`);
  document.documentElement.style.setProperty("--accent-rgb", rgb.join(", "));
}

// ---------- Idle ----------
let state = "idle";
async function loadIdle() {
  try {
    const s = await status();
    let url = s.phoneUrl || `${location.origin}/mic.html`;
    try { const u = new URL(url); u.pathname = "/mic.html"; url = u.toString(); } catch {}
    el.phoneUrl.textContent = url.replace(/^https?:\/\//, "");
    drawQr(url);
  } catch {
    el.phoneUrl.textContent = `${location.host}/mic.html`;
    drawQr(`${location.origin}/mic.html`);
  }
  refreshBoard();
}
function drawQr(url) {
  try {
    const q = window.qrcode(0, "M");
    q.addData(url); q.make();
    el.qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  } catch { el.qr.classList.add("empty"); }
}
async function getBoard() {
  try { const r = await fetch(`/api/leaderboard${session?.mock ? "?mock=1" : ""}`); if (!r.ok) throw 0; const b = await r.json(); return Array.isArray(b) ? b : []; } catch { return []; }
}
async function refreshBoard(highlight) {
  const b = await getBoard();
  el.idleBoard.innerHTML = b.slice(0, 3).map((r, i) => `<li>${["1st", "2nd", "3rd"][i]} <b>${esc(r.name)}</b> ${Math.round(r.score)}</li>`).join("");
  el.board.innerHTML = b.length
    ? b.slice(0, 6).map((r, i) => `<li class="${highlight && r.name === highlight.name && Math.round(r.score) === Math.round(highlight.score) ? "me" : ""}" style="animation-delay:${0.15 + i * 0.08}s"><span class="nm">${esc(r.name)} <i>the ${esc(r.object || "thing")}</i></span><b>${Math.round(r.score)}</b></li>`).join("")
    : `<li style="animation-delay:.1s"><span class="nm">No scores yet. Be the first.</span><b></b></li>`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function goIdle() {
  run++;
  stopAllAudio(); Beat.stop(); stopConfetti();
  el.rec.classList.remove("live"); el.got.classList.remove("show"); el.judging.classList.remove("on");
  el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
  session = null;
  setAccent("#ff5a36");
  setScreen("idle");
  refreshBoard();
}

// ---------- Show ----------
let session = null, run = 0, phoneMicOk = true;
const takes = new Map();          // line index -> {transcript, accuracy}
const takeWaiters = new Map();    // line index -> resolve
class Aborted extends Error {}
const guard = (myRun) => { if (myRun !== run) throw new Aborted(); };

function buildLyrics(lines, name) {
  el.track.innerHTML = lines.map((l, i) => `
    <div class="ln ${l.who === "you" ? "you" : "obj"}" data-i="${i}">
      <div class="who">${l.who === "you" ? "&#127908; You" : esc(name)}</div>
      <div class="txt"><span class="base">${esc(l.text)}</span><span class="wipe"><span class="wipe-in">${esc(l.text)}</span></span></div>
    </div>`).join("");
  el.track.style.transform = "translate3d(0,0,0)";
}
let wipeAnims = [];
function focusLine(i) {
  const rows = [...el.track.children];
  rows.forEach((r, k) => { r.classList.toggle("past", k < i); r.classList.toggle("current", k === i); r.classList.toggle("next", k === i + 1); });
  const row = rows[i];
  if (!row) return;
  const slot = el.lyrics.clientHeight * 0.3;
  el.track.style.transform = `translate3d(0, ${(slot - row.offsetTop).toFixed(1)}px, 0)`;
}
function wipe(i, ms) {
  const row = el.track.children[i];
  if (!row) return;
  const w = row.querySelector(".wipe"), wi = row.querySelector(".wipe-in");
  wipeAnims.forEach((a) => a.cancel?.());
  wipeAnims = [
    w.animate([{ transform: "translate3d(-101%,0,0)" }, { transform: "translate3d(0,0,0)" }], { duration: ms, easing: "linear", fill: "forwards" }),
    wi.animate([{ transform: "translate3d(101%,0,0)" }, { transform: "translate3d(0,0,0)" }], { duration: ms, easing: "linear", fill: "forwards" }),
  ];
}
function retimeWipe(ms) { // real MP3 duration arrived: stretch the running wipe
  for (const a of wipeAnims) { try { const t = a.currentTime || 0; a.effect.updateTiming({ duration: Math.max(ms, t + 50) }); } catch {} }
}

async function startShow(s) {
  if (!s || !s.song || !Array.isArray(s.song.lines)) return;
  if (state === "show" && session && session.id === s.id) return; // duplicate event
  if (!unlocked) { pendingSession = s; toast("Click 'start the show' to hear it"); return; }
  const myRun = ++run;
  stopAllAudio(); stopConfetti();
  session = s; takes.clear(); takeWaiters.clear(); phoneMicOk = true;

  const c = s.character || {};
  setAccent(c.colour);
  el.charImg.classList.remove("broken");
  el.charImg.onerror = () => el.charImg.classList.add("broken");
  el.charImg.src = s.photo || "";
  el.charName.textContent = c.name || "Mystery Object";
  el.charObject.textContent = s.object ? `the ${s.object}` : "";
  el.charCatch.textContent = c.catchphrase ? `"${c.catchphrase}"` : "";
  el.songGenre.textContent = [s.song.genre, s.song.bpm && `${s.song.bpm} bpm`].filter(Boolean).join(" · ");
  el.songTitle.textContent = s.song.title || "Untitled Banger";
  el.show.classList.toggle("is-returning", !!s.returning);
  buildLyrics(s.song.lines, c.name || "Object");
  el.rec.classList.remove("live"); el.got.classList.remove("show"); el.judging.classList.remove("on");
  setScreen("show");
  requestAnimationFrame(() => focusLine(0));

  try {
    await sleep(900); guard(myRun);
    await Beat.start({ genre: s.song.genre || "pop", bpm: s.song.bpm || 100, key: s.song.key || "C" });
    guard(myRun);
    await sleep(Math.round((60000 / (s.song.bpm || 100)) * 2)); guard(myRun); // two beats of intro
    for (let i = 0; i < s.song.lines.length; i++) {
      guard(myRun);
      const line = s.song.lines[i];
      focusLine(i);
      broadcast({ type: "line", index: i });
      if (line.who === "you") await youLine(i, line, myRun);
      else await objectLine(i, line, myRun, c);
      guard(myRun);
      await sleep(250);
    }
    guard(myRun);
    await judge(myRun);
  } catch (e) {
    if (!(e instanceof Aborted)) { console.error("[stage] show failed", e); toast("Something went wrong - press Space to reset"); }
  }
}
let pendingSession = null;

async function objectLine(i, line, myRun, c) {
  const ms = line.ms || 3500;
  wipe(i, ms);
  const seed = [...(c.name || "x")].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  // MOCK sessions and failed TTS lines carry silent MP3s: use the free browser voice so the demo is audible.
  const silent = session?.mock || line.ttsFailed;
  Beat.duck(true);
  try {
    if (line.audio && !silent) {
      try { await playMp3(line.audio, ms, retimeWipe); return; } catch (e) { console.warn("[stage] line audio failed, using fallback voice", e.message); }
    }
    guard(myRun);
    await speakFallback(line.text, ms, seed);
  } finally { Beat.duck(false); }
}

async function youLine(i, line, myRun) {
  const ms = line.ms || 4000;
  // 3-2-1 countdown on the beat
  const beatMs = Math.min(700, Math.max(380, 60000 / (session.song.bpm || 100)));
  for (const n of ["3", "2", "1"]) {
    el.count.textContent = n; el.count.classList.remove("go"); void el.count.offsetWidth; el.count.classList.add("go");
    await sleep(beatMs); guard(myRun);
  }
  el.count.textContent = "SING!"; el.count.classList.remove("go"); void el.count.offsetWidth; el.count.classList.add("go");

  el.got.classList.remove("show");
  el.rec.classList.add("live");
  el.recState.textContent = phoneMicOk ? "Listening on your phone…" : "Listening on the laptop mic…";
  wipe(i, ms);
  broadcast({ type: "record-start", line: i, ms });
  if (!phoneMicOk) laptopTake(i, ms).catch((e) => console.warn("[stage] laptop take", e));

  const take = await Promise.race([
    new Promise((r) => takeWaiters.set(i, r)),
    sleep(ms + 5000).then(() => null), // phone records ms+300, then upload + speech-to-text
  ]);
  takeWaiters.delete(i);
  guard(myRun);
  el.rec.classList.remove("live");
  if (take) {
    const acc = Math.round((take.accuracy ?? 0) * 100);
    el.got.innerHTML = `${acc >= 70 ? "Mint!" : acc >= 40 ? "Sound." : "Erm... brave."} ${acc}% <small>${esc(take.transcript ? `"${String(take.transcript).slice(0, 80)}"` : "heard you")}</small>`;
  } else {
    el.got.innerHTML = `Didn't catch that, our kid <small>moving on...</small>`;
  }
  el.got.classList.add("show");
  setTimeout(() => el.got.classList.remove("show"), 2200);
}

function gotTake(line, data) {
  const t = { transcript: data.transcript || "", accuracy: typeof data.accuracy === "number" ? data.accuracy : 0 };
  takes.set(line, t);
  takeWaiters.get(line)?.(t);
}

// Laptop mic fallback when the phone can't record
let micStream = null;
async function laptopTake(line, ms) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
  micStream = micStream || (await navigator.mediaDevices.getUserMedia({ audio: true }));
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
  const rec = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  await sleep(ms);
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
  const audio = await blobToBase64(blob);
  const sid = session?.id;
  if (!sid) return;
  const r = await postJson("/api/take", { id: sid, line, audio, mime: blob.type });
  if (session?.id === sid) gotTake(line, r); // server also broadcasts take-received; gotTake is idempotent
}
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

// ---------- Judge + verdict ----------
async function judge(myRun) {
  Beat.stop();
  Beat.sting("drumroll");
  el.judging.classList.add("on");
  const started = performance.now();
  let v;
  try { v = await postJson("/api/judge", { id: session.id }); }
  catch (e) {
    console.warn("[stage] judge failed, local verdict", e.message);
    const accs = [...takes.values()].map((t) => t.accuracy);
    const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0.5;
    v = { score: Math.round(40 + avg * 55), roast: "Our Nan sings better than that and she's been gone since 2009. Still, proper effort, our kid." };
  }
  await sleep(Math.max(0, 2200 - (performance.now() - started)));
  guard(myRun);
  showVerdict(v, myRun);
}

async function showVerdict(v, myRun) {
  const score = Math.max(0, Math.min(100, Math.round(+v.score || 0)));
  el.judging.classList.remove("on");
  el.roast.textContent = "";
  el.bw.innerHTML = [v.best && `<span>Best: ${esc(v.best)}</span>`, v.worst && `<span>Worst: ${esc(v.worst)}</span>`].filter(Boolean).join("");
  el.scoreNum.textContent = "0";
  setScreen("result");
  refreshBoard({ name: session?.character?.name, score });

  // Count up
  const sc = el.scoreNum.parentElement;
  sc.classList.remove("pop"); void sc.offsetWidth; sc.classList.add("pop");
  const dur = 1600, t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      el.scoreNum.textContent = String(Math.round(score * (1 - Math.pow(1 - k, 3))));
      k < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });
  if (myRun !== run) return;
  Beat.sting(score >= 85 ? "airhorn" : score >= 50 ? "applause" : "fail");
  if (score >= 50) burstConfetti(score >= 85 ? 260 : 160);
  else burstConfetti(40);

  // Roast: type the text while the object speaks it
  typeText(el.roast, v.roast || "", 2800);
  const roastMs = Math.max(2500, (v.roast || "").length * 60);
  if (v.audio && !session?.mock) { try { await playMp3(v.audio, roastMs); return; } catch {} }
  if (myRun === run && v.roast) speakFallback(v.roast, roastMs, 3);
}
function typeText(node, text, ms) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    node.textContent = text.slice(0, Math.ceil(text.length * k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Confetti (canvas) ----------
const cv = el.confetti, cx = cv.getContext("2d");
let parts = [], confRaf = 0;
function sizeCanvas() { const d = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener("resize", () => { sizeCanvas(); if (session && state === "show") focusLine([...el.track.children].findIndex((r) => r.classList.contains("current"))); });
sizeCanvas();
function burstConfetti(n) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const colours = [accent, "#ffffff", "#ffd23f", "#9fe8ff", "#b18cff"];
  for (let i = 0; i < n; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? -10 : innerWidth + 10, y: innerHeight * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10), vy: -(12 + Math.random() * 12),
      w: 6 + Math.random() * 8, h: 10 + Math.random() * 12, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colours[(Math.random() * colours.length) | 0], life: 0,
    });
  }
  if (!confRaf) confRaf = requestAnimationFrame(tickConfetti);
}
function tickConfetti() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.y < innerHeight + 40 && p.life < 600);
  for (const p of parts) {
    p.life++; p.vy += 0.35; p.vx *= 0.985; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.cos(p.life * 0.12));
    cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
  }
  confRaf = parts.length ? requestAnimationFrame(tickConfetti) : 0;
  if (!confRaf) cx.clearRect(0, 0, innerWidth, innerHeight);
}
function stopConfetti() { parts = []; }

// ---------- Events from the server / phone ----------
onPhone((ev) => {
  if (!ev || !ev.type) return;
  switch (ev.type) {
    case "photo-received":
      if (state === "idle") { el.idleCta.classList.add("waking"); el.idleCtaText.textContent = "Waking it up…"; }
      break;
    case "song-ready":
      if (state !== "show") startShow(ev.session || ev);
      break;
    case "take-received":
      if (typeof ev.line === "number") gotTake(ev.line, ev);
      break;
    case "mic-unavailable":
      if (phoneMicOk) {
        phoneMicOk = false;
        toast("Phone can't record - using the laptop mic");
        // If a line is being recorded right now, take over for it
        const cur = [...takeWaiters.keys()][0];
        if (cur !== undefined && session) {
          el.recState.textContent = "Listening on the laptop mic…";
          laptopTake(cur, Math.max(1500, (session.song.lines[cur]?.ms || 4000) - 500)).catch((e) => console.warn(e));
        }
      }
      break;
    case "reset":
      if (state !== "idle") goIdle();
      break;
    case "error":
      el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
      toast(ev.message || "That one didn't wake up - try another snap");
      break;
  }
});

// ---------- Controls ----------
function again() { broadcast({ type: "reset" }); goIdle(); }
el.againBtn.addEventListener("click", again);
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!unlocked) return unlock();
    if (state === "result" || state === "show") again();
  } else if (e.key === "d" || e.key === "D") {
    if (!unlocked) unlock().then(() => startShow(demoSession())); else if (state === "idle") startShow(demoSession());
  } else if (e.key === "Escape") {
    goIdle();
  }
});
// Gate unlock replays a song that arrived before the click
el.gateBtn.addEventListener("click", () => { if (pendingSession) { const s = pendingSession; pendingSession = null; setTimeout(() => startShow(s), 300); } });

/** Offline demo (key D): no server routes needed, free speech voice, takes simulated. */
function demoSession() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><radialGradient id='g' cx='.35' cy='.3'><stop offset='0' stop-color='#ffd2a8'/><stop offset='1' stop-color='#c2551f'/></radialGradient></defs><rect width='400' height='400' fill='#3a1a10'/><rect x='95' y='110' width='190' height='210' rx='26' fill='url(#g)'/><path d='M285 160 q70 0 70 60 t-70 60' stroke='#c2551f' stroke-width='26' fill='none'/><ellipse cx='190' cy='118' rx='95' ry='18' fill='#5a2a14'/></svg>`;
  const id = "demo_" + Date.now();
  const lines = [
    { who: "object", text: "Alright our kid, I'm Mug Jagger and I've been brewing since '83", ms: 3600 },
    { who: "you", text: "Pour us a brew, you mardy mug", ms: 3000 },
    { who: "object", text: "Mardy? I'm buzzin', I'm the finest mug in all of Manc", ms: 3400 },
    { who: "you", text: "Rain on the window, tea in my hand", ms: 3200 },
    { who: "object", text: "Proper duet this, our Nan would be well chuffed", ms: 3000 },
    { who: "you", text: "Mint", ms: 1700 },
  ];
  setTimeout(() => { // simulate the phone sending takes during demo
    lines.forEach((l, i) => { if (l.who === "you") demoTakes.set(i, { transcript: l.text.toLowerCase(), accuracy: 0.6 + Math.random() * 0.4 }); });
  });
  return {
    id, demo: true, photo: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), returning: false, object: "coffee mug",
    character: { name: "Mug Jagger", personality: "washed-up rock star mug", catchphrase: "Pour us another, our kid", colour: "#ff5a36" },
    song: { title: "Brew Me Tender", genre: "britpop", bpm: 112, key: "C", lines },
  };
}
const demoTakes = new Map();
// In demo mode, answer our own record-start after the line finishes
setInterval(() => {
  if (!session?.demo) return;
  for (const [line, resolve] of takeWaiters) {
    const t = demoTakes.get(line);
    const ms = session.song.lines[line]?.ms || 3000;
    if (t && !t.pending) { t.pending = true; setTimeout(() => { if (takeWaiters.get(line) === resolve) gotTake(line, t); }, ms + 400); }
  }
}, 200);

loadIdle();
