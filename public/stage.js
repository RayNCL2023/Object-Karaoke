// dissPICable - stage (laptop / projector). Owns index.html + stage.css.
import { onPhone, status } from "./api.js";
import { refreshRoster, renderGallery, pickCrowd, createCrowd } from "./crowd.js";
import { createCaptions } from "./captions.js";

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
  bpm() { try { return +beats.getBpm?.() || 0; } catch { return 0; } },
  nextBarMs() { try { return Math.max(0, Math.min(4000, +beats.msToNextBar?.() || 0)); } catch { return 0; } },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  gate: $("gate"), gateBtn: $("gateBtn"), qr: $("qr"), phoneUrl: $("phoneUrl"), phoneHint: $("phoneHint"), idleCta: $("idleCta"), idleCtaText: $("idleCtaText"), idleBoard: $("idleBoard"),
  show: $("show"), charWrap: $("charWrap"), charImg: $("charImg"), mouth: $("mouth"), charName: $("charName"), charObject: $("charObject"), charCatch: $("charCatch"),
  songGenre: $("songGenre"), songTitle: $("songTitle"), track: $("track"), lyrics: $("lyrics"),
  rec: $("rec"), count: $("count"), recState: $("recState"), got: $("got"), judging: $("judging"),
  scoreNum: $("scoreNum"), roast: $("roast"), bw: $("bw"), board: $("board"), againBtn: $("againBtn"),
  confetti: $("confetti"), toast: $("toast"), beatRing: $("beatRing"),
  joinCode: $("joinCode"), joinMic: $("joinMic"), recTitle: $("recTitle"), turnClock: $("turnClock"), cooking: $("cooking"), vclose: $("vclose"), vcloseN: $("vcloseN"),
  winner: $("winner"), memcard: $("memcard"), help: $("help"),
};
const glow = el.charWrap.querySelector(".char-glow");
const eyeEls = [$("eyeL"), $("eyeR")];
const gmouth = $("gmouth"), mouthSmile = $("mouthSmile");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setScreen = (s) => { document.body.dataset.screen = s; state = s; };
function toast(msg, ms = 2600) { el.toast.textContent = msg; el.toast.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.toast.classList.remove("on"), ms); }
// Host-only endpoints need localhost or x-host-token (/api/status gives hostToken on localhost; kept for tunnel use).
let hostToken = "", demoCfg = { rounds: 3, youMs: 6000 };
try { hostToken = new URLSearchParams(location.search).get("token") || sessionStorage.getItem("duetHostToken") || ""; } catch {}
function rememberStatus(s) {
  if (s?.hostToken) { hostToken = s.hostToken; try { sessionStorage.setItem("duetHostToken", hostToken); } catch {} }
  if (s?.battle?.rounds) demoCfg = { rounds: Math.max(1, Math.min(3, +s.battle.rounds || 3)), youMs: 6000 };
}
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(hostToken ? { "x-host-token": hostToken } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json().catch(() => ({}));
}
const broadcast = (ev) => { if (session?.demo && ev.type !== "reset") ev = { ...ev, demo: true, id: ev.id || session.id }; return postJson("/api/broadcast", ev).catch(() => postJson("/api/phone", ev)).catch(() => {}); };

// ---------- Audio: one context, analyser feeds the mouth ----------
let ctx = null, analyser = null, levelBuf = null, unlocked = false;
let fakeTalk = 0; // >0 while speechSynthesis fallback is talking
let freqBuf = null, fakeRound = 0.3; // mouth "O" vs wide: low vs high energy in the voice
function ensureAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  analyser.connect(ctx.destination);
  levelBuf = new Uint8Array(analyser.fftSize);
  freqBuf = new Uint8Array(analyser.frequencyBinCount);
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
// The Edge app window allows autoplay (--autoplay-policy): unlock straight away, no button. Elsewhere any click / key unlocks.
try { const probe = new (window.AudioContext || window.webkitAudioContext)(); if (probe.state === "running") { probe.close(); unlock().then(() => el.gateBtn.click()); } else probe.close(); } catch { /* no audio */ }
["pointerdown", "keydown"].forEach((t) => addEventListener(t, () => { if (!unlocked) el.gateBtn.click(); }, { capture: true }));
el.gateBtn.addEventListener("click", () => loadSeg().then((m) => m?.preloadSegmenter()), { once: true }); // warm the cut-out model

/** 0..1 how rounded the current sound is (low-heavy = "O", bright = wide). */
function voiceRound() {
  if (fakeTalk > 0) return fakeRound;
  if (!analyser || !freqBuf) return 0.3;
  analyser.getByteFrequencyData(freqBuf);
  let lo = 0, hi = 0;
  for (let i = 3; i < 12; i++) lo += freqBuf[i];
  for (let i = 30; i < 90; i++) hi += freqBuf[i];
  lo /= 9; hi /= 60;
  return lo + hi > 1 ? lo / (lo + hi * 1.7) : 0.3;
}
function voiceLevel() {
  if (fakeTalk > 0) { const t = performance.now() / 1000; return 0.3 + 0.45 * Math.abs(Math.sin(t * 10.5)) * (0.55 + 0.45 * Math.sin(t * 3.7)); }
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) { const v = (levelBuf[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4.5);
}

/** Play an MP3 through the analyser. Resolves when it ends (or times out). onMeta gets the real duration in ms. */
// lock = beat-locked: start on the next bar downbeat and nudge playbackRate (+/-6%, pitch kept) so the clip spans whole bars.
function playMp3(url, maxMs, onMeta, onEl, lock = false) {
  return new Promise((resolve, reject) => {
    ensureAudio();
    const a = new Audio();
    a.src = url;
    a.preload = "auto";
    let done = false, timer;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); try { src.disconnect(); } catch {} err ? reject(err) : resolve(); };
    const src = ctx.createMediaElementSource(a);
    src.connect(analyser);
    const go = () => { if (!done) a.play().catch(finish); };
    a.addEventListener("loadedmetadata", () => {
      if (!isFinite(a.duration)) { if (lock) go(); return; }
      let wait = 0;
      const bpm = lock ? Beat.bpm() : 0;
      if (bpm) {
        const bar = 240 / bpm, bars = Math.max(1, Math.round(a.duration / bar));
        a.preservesPitch = true;
        a.playbackRate = Math.max(0.94, Math.min(1.06, a.duration / (bars * bar)));
        wait = Beat.nextBarMs();
      }
      const real = (a.duration * 1000) / (a.playbackRate || 1);
      onMeta?.(real); clearTimeout(timer); timer = setTimeout(() => finish(), real + wait + 1500);
      if (lock) setTimeout(go, wait);
    });
    a.addEventListener("ended", () => finish());
    a.addEventListener("error", () => finish(new Error("audio error")));
    timer = setTimeout(() => finish(), (maxMs || 6000) + 2500 + (lock ? 3000 : 0));
    playing.add(a);
    try { onEl?.(a); } catch {}
    if (!lock) a.play().catch(finish);
    a.addEventListener("ended", () => playing.delete(a));
  });
}
const playing = new Set();
function stopAllAudio() { for (const a of playing) { try { a.pause(); } catch {} } playing.clear(); try { speechSynthesis.cancel(); } catch {} fakeTalk = 0; }

/** Free fallback voice (MOCK / missing audio): browser speech + fake mouth. */
function speakFallback(text, ms, colourSeed = 0, hooks = null) {
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
      if (hooks) { u.onstart = () => hooks.start?.(); u.onboundary = (e) => { if (!e.name || e.name === "word") hooks.boundary?.(e.charIndex); }; }
      speechSynthesis.speak(u);
    } catch { /* no speech: mouth still flaps for ms */ }
    setTimeout(end, (ms || 3000) + 1500);
  });
}

// ---------- Character rig: cut-out sticker of the real object + googly face + rubber-hose limbs ----------
const DEFAULT_FACE = { leftEye: { x: 0.38, y: 0.38 }, rightEye: { x: 0.62, y: 0.38 }, eyeSize: 0.14, mouth: { x: 0.5, y: 0.62, width: 0.28 } };
const DEFAULT_BBOX = { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };
const ellipseOutline = (b) => Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2 - Math.PI / 2; return { x: b.x + b.w / 2 + Math.cos(a) * b.w / 2, y: b.y + b.h / 2 + Math.sin(a) * b.h / 2 }; });
const rigEl = { rig: $("rig"), body: $("body"), sticker: $("sticker"), clipPoly: $("clipPoly"), outlinePoly: $("outlinePoly"), stickerImg: $("stickerImg"), mic: $("micProp") };
const limbs = Object.fromEntries(["armL", "armR", "legL", "legR"].map((id) => { const n = $(id); const [a, b] = n.querySelectorAll(".seg"); return [id, { n, a, b, foot: n.querySelector(".shoe") }]; }));
let face = DEFAULT_FACE, shape = { bbox: DEFAULT_BBOX, outline: ellipseOutline(DEFAULT_BBOX) }, photoAr = 1, U = 4, eyeTravel = 0;
const okPt = (p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y);
function setCharacterShape(s) {
  const f = s.face || s.character?.face;
  face = f && okPt(f.leftEye) && okPt(f.rightEye) && okPt(f.mouth) ? f : DEFAULT_FACE;
  const b = s.bbox && [s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h].every((v) => Number.isFinite(+v)) && s.bbox.w > 0.05 && s.bbox.h > 0.05 ? s.bbox : null;
  const pts = Array.isArray(s.outline) ? s.outline.filter(okPt) : [];
  if (pts.length >= 3) {
    const xs = pts.map((p) => +p.x), ys = pts.map((p) => +p.y);
    shape = { outline: pts, bbox: b || { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
  } else {
    const bb = b || DEFAULT_BBOX;
    shape = { bbox: bb, outline: b ? [{ x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h }] : ellipseOutline(bb) };
  }
  cut = null; cutSrc = ""; cutHint = b || pts.length >= 3 ? { x: shape.bbox.x + shape.bbox.w / 2, y: shape.bbox.y + shape.bbox.h / 2 } : { x: 0.5, y: 0.5 };
  layoutChar();
}
function layoutChar() {
  const S = el.charWrap.offsetWidth; // layout size, ignores transforms
  if (!S) return;
  U = S / 100;
  el.charWrap.style.setProperty("--u", `${U.toFixed(2)}px`);
  const IW = 1000, IH = 1000 / photoAr, bb = shape.bbox;
  const bx = bb.x * IW, by = bb.y * IH, bw = Math.max(20, bb.w * IW), bh = Math.max(20, bb.h * IH);
  const pad = Math.max(bw, bh) * 0.05;
  const vb = [bx - pad, by - pad, bw + pad * 2, bh + pad * 2];
  const scale = Math.min((58 * U) / vb[2], (54 * U) / vb[3]);
  const boxW = vb[2] * scale, boxH = vb[3] * scale, left = 50 * U - boxW / 2, top = 76 * U - boxH;
  Object.assign(rigEl.body.style, { left: `${left.toFixed(1)}px`, top: `${top.toFixed(1)}px`, width: `${boxW.toFixed(1)}px`, height: `${boxH.toFixed(1)}px` });
  rigEl.sticker.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
  const pts = shape.outline.map((p) => `${(p.x * IW).toFixed(1)},${(p.y * IH).toFixed(1)}`).join(" ");
  rigEl.clipPoly.setAttribute("points", pts);
  rigEl.outlinePoly.setAttribute("points", pts);
  rigEl.outlinePoly.setAttribute("stroke-width", ((2.6 * U) / scale).toFixed(1));
  rigEl.stickerImg.setAttribute("width", IW); rigEl.stickerImg.setAttribute("height", IH.toFixed(1));
  applyCutMode(IW, IH);
  const mx = (x) => (x * IW - vb[0]) * scale, my = (y) => (y * IH - vb[1]) * scale;
  // Googly eyes + mouth: positions stay relative to the original photo, so they land on the object
  const D = Math.max(10, (+face.eyeSize || 0.14) * IW * scale);
  eyeTravel = D * 0.17;
  [face.leftEye, face.rightEye].forEach((p, i) => {
    const e = eyeEls[i];
    e.style.width = e.style.height = e.style.fontSize = `${D.toFixed(1)}px`;
    e.style.left = `${(mx(p.x) - D / 2).toFixed(1)}px`; e.style.top = `${(my(p.y) - D / 2).toFixed(1)}px`;
  });
  const mw = Math.max(18, (+face.mouth.width || 0.28) * IW * scale), mh = mw * 0.62;
  Object.assign(gmouth.style, { width: `${mw.toFixed(1)}px`, height: `${mh.toFixed(1)}px`, fontSize: `${mw.toFixed(1)}px`, left: `${(mx(face.mouth.x) - mw / 2).toFixed(1)}px`, top: `${(my(face.mouth.y) - mh * 0.3).toFixed(1)}px` });
  // Arms on the bbox sides (inside .body so they squash with it); legs on the bbox bottom (in .rig)
  const shY = my(bb.y + bb.h * 0.52);
  Object.assign(limbs.armL.n.style, { left: `${(mx(bb.x) + U * 1.2).toFixed(1)}px`, top: `${shY.toFixed(1)}px` });
  Object.assign(limbs.armR.n.style, { left: `${(mx(bb.x + bb.w) - U * 1.2).toFixed(1)}px`, top: `${shY.toFixed(1)}px` });
  const hipY = top + my(bb.y + bb.h) - U * 2.5;
  Object.assign(limbs.legL.n.style, { left: `${(left + mx(bb.x + bb.w * 0.32)).toFixed(1)}px`, top: `${hipY.toFixed(1)}px` });
  Object.assign(limbs.legR.n.style, { left: `${(left + mx(bb.x + bb.w * 0.68)).toFixed(1)}px`, top: `${hipY.toFixed(1)}px` });
  rigEl.rig.style.transformOrigin = `${(50 * U).toFixed(1)}px ${(hipY + 19 * U).toFixed(1)}px`; // pivot between the feet
}
function onPhotoLoad() {
  const w = el.charImg.naturalWidth, h = el.charImg.naturalHeight;
  photoAr = w && h ? w / h : 1;
  layoutChar();
  runCutout();
}
// Real segmentation cut-out (segment.js / MediaPipe): replaces Gemma's traced outline + face when it works
let cut = null, cutSrc = "", cutHint = { x: 0.5, y: 0.5 }, segMod = null;
const loadSeg = () => (segMod ||= import("./segment.js").catch((e) => { console.warn("[stage] segment.js", e); return null; }));
const SVGNS = "http://www.w3.org/2000/svg";
const cutMaskImg = document.createElementNS(SVGNS, "image"), cutBorderImg = document.createElementNS(SVGNS, "image");
{
  const m = document.createElementNS(SVGNS, "mask");
  m.id = "stickerMask"; m.setAttribute("maskUnits", "userSpaceOnUse"); m.appendChild(cutMaskImg);
  rigEl.sticker.querySelector("defs").appendChild(m);
  rigEl.sticker.insertBefore(cutBorderImg, rigEl.stickerImg);
  for (const n of [cutMaskImg, cutBorderImg]) { n.setAttribute("x", 0); n.setAttribute("y", 0); n.setAttribute("preserveAspectRatio", "none"); }
  m.setAttribute("x", -5000); m.setAttribute("y", -5000); m.setAttribute("width", 20000); m.setAttribute("height", 20000);
  cutBorderImg.style.display = "none";
}
function applyCutMode(IW, IH) {
  const on = !!cut;
  rigEl.outlinePoly.style.display = on ? "none" : "";
  cutBorderImg.style.display = on ? "" : "none";
  if (on) {
    for (const n of [cutMaskImg, cutBorderImg]) { n.setAttribute("width", IW); n.setAttribute("height", IH.toFixed(1)); }
    rigEl.stickerImg.removeAttribute("clip-path"); rigEl.stickerImg.setAttribute("mask", "url(#stickerMask)");
  } else { rigEl.stickerImg.removeAttribute("mask"); rigEl.stickerImg.setAttribute("clip-path", "url(#stickerClip)"); }
}
async function runCutout() {
  const img = el.charImg, src = img.currentSrc || img.src;
  if (!src || !img.naturalWidth || src === cutSrc) return;
  cutSrc = src;
  const mod = await loadSeg();
  const r = mod ? await mod.cutout(img, cutHint) : null;
  if (!r || cutSrc !== src || (el.charImg.currentSrc || el.charImg.src) !== src) return; // failed, or photo changed meanwhile
  cutMaskImg.setAttribute("href", r.maskCanvas.toDataURL("image/png"));
  cutBorderImg.setAttribute("href", r.borderCanvas.toDataURL("image/png"));
  cut = r; face = r.face; shape = { ...shape, bbox: r.bbox };
  layoutChar();
}
el.charImg.addEventListener("load", onPhotoLoad);
try { new ResizeObserver(layoutChar).observe(el.charWrap); } catch { addEventListener("resize", layoutChar); }
requestAnimationFrame(layoutChar);

// ---------- Pupil physics in eye-radius units (rim = 1): gravity, damping, rim bounce, kicks ----------
const pupilsP = eyeEls.map((e) => ({ node: e.querySelector(".pupil"), lid: e.querySelector(".lid"), x: 0, y: 1, vx: 0, vy: 0 }));
const GRAV = 14, DAMP = 1.6, REST = 0.55;
let blinkT = -1, nextBlink = performance.now() + 2500;
let gaze = null, nextGlance = performance.now() + 4000; // { x, y, until } in eye-radius units
function lookAt(x, y, ms = 600) { const r = Math.hypot(x, y) || 1, k = Math.min(1, r) * 0.9 / r; gaze = { x: x * k, y: y * k, until: performance.now() + ms }; }
/** Point the pupils at a DOM element (the word being said, the singer...). */
function lookAtEl(node, ms) {
  try {
    const e = eyeEls[0].getBoundingClientRect(), t = node.getBoundingClientRect();
    lookAt((t.left + t.width / 2) - (e.left + e.width / 2), (t.top + t.height / 2) - (e.top + e.height / 2), ms);
  } catch {}
}
function stepPupils(dt, accPx, kick, now) {
  const k = eyeTravel > 0 ? 1 / eyeTravel : 0;
  for (let i = 0; i < pupilsP.length; i++) {
    const p = pupilsP[i];
    // Inertia: when the body accelerates up the pupil feels pushed down, and vice versa (x too)
    const g = gaze && now < gaze.until ? gaze : null;
    const inX = Math.max(-120, Math.min(120, -accPx.x * k * 0.6)), inY = Math.max(-120, Math.min(120, accPx.y * k * 0.6));
    // Looking at something: a stiff, damped pull toward the target (eyes dart, then settle). Otherwise: googly gravity.
    const ax = g ? (g.x - p.x) * 160 + inX * 0.25 : inX + Math.sin(now / 900 + i) * 1.2;
    const ay = g ? (g.y - p.y) * 160 - inY * 0.25 : GRAV - inY;
    const damp = g ? 16 : DAMP;
    if (kick) { p.vx += (Math.random() - 0.5) * 7 * kick * (g ? 0.3 : 1); p.vy -= (2.5 + Math.random() * 4) * kick * (g ? 0.3 : 1); }
    p.vx += (ax - p.vx * damp) * dt; p.vy += (ay - p.vy * damp) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const r = Math.hypot(p.x, p.y);
    if (r > 1) {
      const nx = p.x / r, ny = p.y / r;
      p.x = nx; p.y = ny;
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) { p.vx -= (1 + REST) * vn * nx; p.vy -= (1 + REST) * vn * ny; p.vx *= 0.94; p.vy *= 0.94; }
    }
    p.node.style.transform = `translate3d(${(p.x * eyeTravel).toFixed(2)}px, ${(p.y * eyeTravel).toFixed(2)}px, 0)`;
  }
  // Natural blinks: every 3-6s, sometimes a quick double-blink
  if (blinkT < 0 && now > nextBlink) { blinkT = 0; nextBlink = now + 3000 + Math.random() * 3000; if (Math.random() < 0.18) nextBlink = now + 240; }
  let lid = 0;
  if (blinkT >= 0) { blinkT += dt; const q = blinkT / 0.15; lid = q >= 1 ? 0 : q < 0.4 ? q / 0.4 : 1 - (q - 0.4) / 0.6; if (q >= 1) blinkT = -1; }
  // Occasional glances: toward the lyrics, down at the crowd, or straight at the player
  if (now > nextGlance) {
    nextGlance = now + 3500 + Math.random() * 4000;
    if (!gaze || now > gaze.until) { const r = Math.random(); r < 0.45 ? lookAt(0.95, -0.15, 900) : r < 0.75 ? lookAt(0.25, 0.95, 700) : lookAt(0, 0.05, 1000); }
  }
  const lidS = `scaleY(${lid.toFixed(3)})`;
  for (const p of pupilsP) p.lid.style.transform = lidS;
}

// ---------- Poses. Angles in degrees, "outward" convention (mirrored for the right side). ----------
// Arms: [shoulder, elbow]; 0 = hanging down, + swings outward/up, - folds inward across the body.
// Legs: [hip, knee, toe]; body: x/y in U units, rot deg, sx/sy squash.
let charMode = { singing: false, listening: false, verdict: null, verdictAt: 0 };
const TAU = Math.PI * 2;
const pose = (o) => ({ bx: 0, by: 0, br: 0, sx: 1, sy: 1, aL1: 12, aL2: 8, aR1: 12, aR2: 8, lL1: 4, lL2: -4, lL3: 0, lR1: 4, lR2: -4, lR3: 0, mic: 0, ...o });
function idlePose(t, nervous) {
  const sp = nervous ? 2.4 : 1;
  const breathe = Math.sin(t * 2.1 * sp) * 0.025;
  const tap = Math.max(0, Math.sin(t * TAU * (nervous ? 2.6 : 1.5)));
  return pose({ br: Math.sin(t * 1.1 * sp) * 3, bx: Math.sin(t * 1.1 * sp) * 1.2, sy: 1 + breathe, sx: 1 - breathe * 0.8,
    aL1: 12 + Math.sin(t * 1.1 * sp) * 6, aR1: 12 - Math.sin(t * 1.1 * sp) * 6, aL2: 14, aR2: 14, lR3: tap * 16 });
}
/** Main dance: clear key poses that HIT on beats 1 and 3, grooves on 2 and 4, a dip of anticipation before each hit,
 *  a head-nod snap on every beat and a kick-drum squash. Every 4th bar group swaps in the Madchester shuffle. */
function dancePose(b, pulse) {
  if (Math.floor(b / 16) % 3 === 2) return dancePoseOld(b, pulse);
  const bar = Math.floor(b / 4), beat = ((b % 4) + 4) % 4, bi = Math.floor(beat), ph = beat - bi;
  const alt = bar % 2 ? -1 : 1;
  let p;
  if (bi === 0) p = pose({ bx: 3 * alt, br: -7 * alt, by: -1.5, aL1: 150, aL2: 22, aR1: 150, aR2: 22, lL1: 18, lL2: -12, lR1: 6, lR2: -4 }); // arms-up V
  else if (bi === 2) p = pose({ bx: -3 * alt, br: 8 * alt, by: 0.5, aL1: 100, aL2: -110, aR1: 75, aR2: 28, lL1: 4, lL2: -4, lR1: 26, lR2: -44, lR3: 10 }); // point + knee up
  else p = pose({ bx: 0, br: 2 * alt, by: -0.5, aL1: 38, aL2: 52, aR1: 38, aR2: 52, lL1: 6, lL2: -6, lR1: 6, lR2: -6 }); // groove
  const nod = Math.pow(1 - ph, 3); // snap down on the beat, ease back up
  p.br += nod * 3.5 * alt; p.by += nod * 1.4;
  const antic = ph > 0.8 ? (ph - 0.8) / 0.2 : 0; // gather before the next beat
  p.by += antic * 2.2; p.sy -= antic * 0.07; p.sx += antic * 0.05; p.aL1 *= 1 - antic * 0.25; p.aR1 *= 1 - antic * 0.25;
  const sq = pulse * 0.13; // kick drum squash
  p.sy -= sq; p.sx += sq * 0.75;
  return p;
}
function dancePoseOld(b, pulse) {
  const move = Math.floor(b / 8) % 4, ph = b % 1, side = Math.floor(b) % 2 ? 1 : -1;
  const sq = pulse * 0.09;
  const base = { sy: 1 - sq, sx: 1 + sq * 0.8, by: -Math.abs(Math.sin(Math.PI * b)) * 2.5 };
  if (move === 0) { // side-step
    const s = Math.sin(Math.PI * b), lift = Math.sin(Math.PI * ph);
    return pose({ ...base, bx: s * 6, br: s * 4, aL1: 25 - s * 22, aR1: 25 + s * 22, aL2: 40, aR2: 40,
      lL1: side < 0 ? 26 * lift : 2, lL2: side < 0 ? -40 * lift : -2,
      lR1: side > 0 ? 26 * lift : 2, lR2: side > 0 ? -40 * lift : -2 });
  }
  if (move === 1) { // Madchester baggy shuffle: arms up, loose sway
    const s = Math.sin(TAU * b * 0.5);
    return pose({ ...base, bx: s * 3, br: s * 6, by: base.by - 1, aL1: 150 + s * 18, aR1: 150 - s * 18, aL2: 25 + s * 20, aR2: 25 - s * 20,
      lL1: 10 + Math.max(0, s) * 18, lL2: -Math.max(0, s) * 30, lR1: 10 + Math.max(0, -s) * 18, lR2: -Math.max(0, -s) * 30, lL3: Math.max(0, s) * 14, lR3: Math.max(0, -s) * 14 });
  }
  if (move === 2) { // point at the crowd, pumping on the beat, other hand on hip
    const pump = Math.pow(1 - ph, 3);
    return pose({ ...base, br: -5, bx: -2, aR1: 95 + pump * 25, aR2: 5 - pump * 10, aL1: 38, aL2: -95,
      lL1: 6, lL2: -6, lR1: 6 + pump * 6, lR2: -6, lR3: pump * 22 });
  }
  // spin-wiggle: one quick fake spin per bar, wiggle the rest
  const bar = b % 4, spin = bar < 1 ? Math.cos(TAU * bar) : 1, wig = Math.sin(TAU * b);
  return pose({ ...base, sx: (1 + sq * 0.8) * spin, br: wig * 9, bx: wig * 2, aL1: 70 + wig * 30, aR1: 70 - wig * 30, aL2: 60 + wig * 30, aR2: 60 - wig * 30,
    lL1: 8 + wig * 6, lR1: 8 - wig * 6, lL2: -10, lR2: -10, lL3: Math.max(0, wig) * 18, lR3: Math.max(0, -wig) * 18 });
}
function singArms(p, t, lvl) { // mic hand (left) to the mouth; right hand raps along with every word (see gestures)
  const reach = 0.5 + Math.min(1, lvl * 1.6) * 0.5;
  const out = { ...p, aL1: 14, aL2: -140, aR1: 55 + reach * 40, aR2: 30 - reach * 20, br: p.br * 0.6 + 3 * reach, mic: 1 };
  return applyGesture(out, true);
}
// Word-synced gestures from the captions: point at the player on "you", hands up on the punchline, a chop otherwise.
let gesture = null; // { type, at, ms }
function setGesture(type, ms) { gesture = { type, at: performance.now(), ms }; }
function applyGesture(p, singing) {
  if (!gesture) return p;
  const k = (performance.now() - gesture.at) / gesture.ms;
  if (k >= 1) { gesture = null; return p; }
  const env = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4); // snap in, hold, release
  const mix = (a, b) => a + (b - a) * env;
  if (gesture.type === "point") return { ...p, aR1: mix(p.aR1, 92), aR2: mix(p.aR2, -6), br: mix(p.br, p.br - 5), bx: mix(p.bx, p.bx + 1.5) };
  if (gesture.type === "hands") return { ...p, aR1: mix(p.aR1, 168), aR2: mix(p.aR2, 8), aL1: singing ? mix(p.aL1, 150) : mix(p.aL1, 168), aL2: singing ? p.aL2 : mix(p.aL2, 8), sy: mix(p.sy, p.sy + 0.06), by: mix(p.by, p.by - 2) };
  if (gesture.type === "chop") return { ...p, aR1: mix(p.aR1, p.aR1 + 28), aR2: mix(p.aR2, p.aR2 - 34) };
  return p;
}
function listenPose(t, b) { // hand cupped to ear, leaning in, foot tapping impatiently
  const tap = Math.max(0, Math.sin(TAU * (b ?? t * 1.7) * 2));
  return pose({ br: 8 + Math.sin(t * 1.3) * 1.5, bx: 3, sy: 1 + Math.sin(t * 2) * 0.015, aR1: 150, aR2: -220, aL1: 38, aL2: -95,
    lL1: 3, lL2: -3, lL3: tap * 26, lR1: 6, lR2: -8 });
}
function celebratePose(t, since = 9) {
  if (since < 0.3) { const k = since / 0.3; return pose({ by: 3 * k, sy: 1 - 0.18 * k, sx: 1 + 0.13 * k, aL1: 20, aR1: 20, aL2: 70, aR2: 70, lL1: 16 * k, lL2: -34 * k, lR1: 16 * k, lR2: -34 * k }); } // crouch
  if (since < 1.1) { const k = (since - 0.3) / 0.8, air = Math.sin(Math.PI * k); // big jump with a fake 360 spin
    return pose({ by: -air * 24, sy: 1 + air * 0.12, sx: (1 - air * 0.05) * Math.cos(TAU * Math.min(1, k * 1.15)), aL1: 172, aR1: 172, aL2: 8, aR2: 8, lL1: 10 + air * 30, lL2: -air * 85, lR1: 10 + air * 30, lR2: -air * 85 }); }
  const ph = (t * 1.6) % 1, air = Math.sin(Math.PI * ph);
  const land = ph < 0.12 ? 1 - ph / 0.12 : ph > 0.9 ? (ph - 0.9) / 0.1 : 0;
  return pose({ by: -air * 14, sy: 1 + air * 0.08 - land * 0.14, sx: 1 - air * 0.05 + land * 0.12, br: Math.sin(t * 3.2) * 5,
    aL1: 160 + Math.sin(t * 9) * 8, aR1: 160 - Math.sin(t * 9) * 8, aL2: 12, aR2: 12, lL1: 10 + air * 28, lL2: -air * 70, lR1: 10 + air * 28, lR2: -air * 70 });
}
function facepalmPose(t, since = 9) {
  if (since < 0.35) { const k = since / 0.35; return pose({ br: 12 * k, by: -2 * k, sy: 1 + 0.05 * k, aL1: 120, aL2: 40, aR1: 120, aR2: 40, lL1: 8, lR1: 8 }); } // recoil "oh no"
  if (since < 3) return pose({ br: -6 + Math.sin(t * 6.5) * 4, by: 2, sy: 0.9, sx: 1.06, aL1: 10, aL2: -165, aR1: 4, aR2: 4, lL1: 2, lL2: -2, lR1: 8, lR2: -12 }); // head-shake into the hand
  return pose({ br: -5, by: 1.5, sy: 0.94, sx: 1.04, bx: Math.sin(t * 2.4) * 1.5, aL1: 10, aL2: -165, aR1: 4, aR2: 4, lL1: 2, lL2: -2, lR1: 8, lR2: -12 });
}
function laughPose(t) { // doubling over, holding the belly, shaking with laughter
  const hehe = Math.abs(Math.sin(t * 13));
  return pose({ br: 10 + Math.sin(t * 2) * 4, by: 1 - hehe * 1.2, sy: 0.88 + hehe * 0.05, sx: 1.08 - hehe * 0.04, bx: Math.sin(t * 2) * 2,
    aL1: 18, aL2: -110, aR1: 18 + hehe * 6, aR2: -110, lL1: 4, lL2: -4, lR1: 14 + hehe * 10, lR2: -24, lR3: hehe * 20 });
}

// Damped springs per joint; lower segments are softer so they lag = secondary motion.
const SPR = { bx: 300, by: 420, br: 260, sx: 620, sy: 620, aL1: 300, aR1: 300, aL2: 190, aR2: 190, lL1: 380, lR1: 380, lL2: 300, lR2: 300, lL3: 420, lR3: 420, mic: 90 };
const ZETA = { bx: 0.55, by: 0.5, br: 0.5, sx: 0.32, sy: 0.32, aL1: 0.52, aR1: 0.52, aL2: 0.58, aR2: 0.58, mic: 0.9 }; // damping ratio (default 0.6)
const springs = Object.fromEntries(Object.keys(SPR).map((k) => [k, { x: pose({})[k], v: 0 }]));
function stepSprings(target, dt) {
  const out = {};
  for (const k in springs) {
    const s = springs[k], K = SPR[k], C = 2 * Math.sqrt(K) * (ZETA[k] ?? 0.6);
    s.v += ((target[k] - s.x) * K - s.v * C) * dt;
    s.x += s.v * dt;
    out[k] = s.x;
  }
  return out;
}
function applyLimb(l, a1, a2, a3, mirror) {
  const m = mirror ? -1 : 1;
  l.a.style.transform = `rotate(${(a1 * m).toFixed(2)}deg)`;
  l.b.style.transform = `rotate(${(a2 * m).toFixed(2)}deg)`;
  if (l.foot) l.foot.style.transform = `rotate(${(a3 * m).toFixed(2)}deg)`;
}
function thinkingPose(t) { // "wait for it": hand on chin, head tilted, foot tapping, little hum-bob
  const tap = Math.max(0, Math.sin(t * TAU * 2.2));
  return pose({ br: -7 + Math.sin(t * 1.6) * 2, bx: -1.5, by: Math.sin(t * 3) * 0.4, sy: 1 + Math.sin(t * 2.4) * 0.02, aR1: 30, aR2: -150, aL1: 24, aL2: -100,
    lL1: 4, lL2: -4, lR1: 5, lR2: -5, lR3: tap * 22 });
}
/** Timeline hook: force a pose. 'listening'|'thinking'|'singing'|'idle'|'dance'|'laugh'|'celebrate'|'facepalm'; null/'auto' = automatic. */
let poseOverride = null;
export function setPose(name) { poseOverride = name && name !== "auto" ? String(name) : null; }
window.setPose = setPose;
function overridePose(name, t, b, pulse, lvl) {
  switch (name) {
    case "listening": return listenPose(t, b);
    case "thinking": return thinkingPose(t);
    case "singing": return singArms(b != null ? dancePose(b, pulse) : idlePose(t), t, lvl);
    case "dance": return b != null ? dancePose(b, pulse) : dancePose(t * 1.8, pulse);
    case "laugh": return laughPose(t);
    case "celebrate": return celebratePose(t);
    case "facepalm": return facepalmPose(t);
    default: return idlePose(t);
  }
}
function targetPose(t, pulse, lvl) {
  const b = fallbackBpm ? ((performance.now() - fallbackStart) / 60000) * fallbackBpm : null;
  if (poseOverride && state !== "idle") return overridePose(poseOverride, t, b, pulse, lvl);
  if (state === "result" && charMode.verdict) {
    const since = (performance.now() - charMode.verdictAt) / 1000;
    if (since < 3.6 || charMode.verdict === "laugh") return charMode.verdict === "celebrate" ? celebratePose(t, since) : charMode.verdict === "facepalm" ? facepalmPose(t, since) : laughPose(t);
    return lvl > 0.05 || fakeTalk > 0 ? laughPose(t) : idlePose(t);
  }
  if (state === "show" && charMode.listening) return listenPose(t, b);
  if (state === "show" && el.judging.classList.contains("on")) return idlePose(t, true);
  const base = state === "show" && b != null ? dancePose(b, pulse) : idlePose(t);
  return charMode.singing ? singArms(base, t, lvl) : applyGesture(base, false);
}

// ---------- Roster gallery (idle) + karaoke crowd (crowd.js) ----------
el.rosterRow = $("rosterRow"); el.rosterCount = $("rosterCount");
const crowd = createCrowd($("crowd"));
let crowdFor = null, crowdLine = null, crowdLineCheck = 0;
const isKaraoke = () => session?.mode === "karaoke" || session?.song?.mode === "karaoke" || session?.karaoke === true || document.body.dataset.mode === "karaoke";
/** Timeline hooks: window.crowd.show(true|false|null = auto), .cheer() for a burst of arms-up. */
window.crowd = { show: (v) => crowd.show(v), cheer: () => crowd.cheer(),
  // Audience phones (public/audience-stage.js): named members ahead of placeholders, reaction bubbles.
  addMember: (m) => crowd.addMember(m), removeMember: (id) => crowd.removeMember(id), react: (id, type) => crowd.react(id, type), audienceCount: () => crowd.audienceCount() };
function crowdTick(now, dt, pulse) {
  if (session?.id && session.id !== crowdFor) { crowdFor = session.id; crowd.setMembers(pickCrowd()); } // reshuffle each song
  if (!session) crowdFor = null;
  if (now > crowdLineCheck) { // which lyric line is live (for chorus), checked a few times a second
    crowdLineCheck = now + 250;
    const cur = el.track?.querySelector(".current");
    crowdLine = cur && session?.song?.lines ? session.song.lines[+cur.dataset.i] : null;
  }
  const chorus = !!(crowdLine && (crowdLine.chorus || crowdLine.who === "both"));
  const mood = state === "result" ? ({ celebrate: "cheer", laugh: "laugh", facepalm: "boo" }[charMode.verdict] || null) : null;
  const excite = Math.max(chorus ? 1 : 0, Math.min(1, mouthLvl * 1.4), charMode.listening ? 0.45 : 0);
  const beat = fallbackBpm ? ((now - fallbackStart) / 60000) * fallbackBpm : null;
  crowd.tick({ now, dt, beat, pulse, excite, mood, visible: state === "result" || (state === "show" && (isKaraoke() || crowd.audienceCount() > 0)) });
}

// ---------- Render loop: pose springs, mouth, googly eyes, glow, beat ring (transform/opacity only) ----------
let mouthLvl = 0, bounce = 0, ringT = 0, lastPulse = 0, lastT = performance.now();
// Mouth shapes [scaleX, scaleY]: closed, small, wide, "O". Picked from loudness + how rounded the sound is.
const MOUTH = { closed: [0.9, 0], small: [0.72, 0.34], wide: [1.08, 0.58], o: [0.62, 0.98] };
let mShape = "closed", mShapeAt = 0, mS = [0.9, 0], jaw = 0, jawV = 0;
let entrance = null; // { y, v, bounces } in U units, the character drops in from the top
function startEntrance() { entrance = { y: -150, v: 0, bounces: 0 }; }
function dustPuff() {
  const d = document.createElement("div");
  d.className = "dust";
  d.innerHTML = Array.from({ length: 7 }, (_, i) => { const a = Math.PI * (0.05 + (i / 6) * 0.9); return `<i style="--dx:${(-Math.cos(a) * 150).toFixed(0)}px;--dy:${(-Math.sin(a) * 50 - 10).toFixed(0)}px;animation-delay:${(i % 3) * 30}ms"></i>`; }).join("");
  el.charWrap.appendChild(d);
  setTimeout(() => d.remove(), 900);
}
let lastBody = { x: 0, y: 0 }, lastBodyV = { x: 0, y: 0 }, micOn = false;
function frame() {
  const now = performance.now(), t = now / 1000;
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
  caps.tick(now);
  const target = voiceLevel();
  mouthLvl += (target - mouthLvl) * (target > mouthLvl ? 0.6 : 0.3);
  const want = mouthLvl < 0.07 ? "closed" : mouthLvl < 0.26 ? "small" : (mouthLvl > 0.75 || voiceRound() > 0.62) ? "o" : "wide";
  if (want !== mShape && now - mShapeAt > 55) { // hold each shape briefly: crisp flaps, no flicker
    if ((MOUTH[want][1] - MOUTH[mShape][1]) > 0.25) jawV += 9; // louder syllable: little jaw bounce
    mShape = want; mShapeAt = now;
  }
  const mt = MOUTH[mShape];
  mS[0] += (mt[0] - mS[0]) * 0.5; mS[1] += (mt[1] - mS[1]) * 0.5;
  jawV += (-jaw * 260 - jawV * 18) * dt; jaw += jawV * dt;
  el.mouth.style.transform = `scale(${mS[0].toFixed(3)}, ${Math.max(0, mS[1]).toFixed(3)})`;
  gmouth.style.transform = `translate3d(0, ${(jaw * 2.2 + mS[1] * 3).toFixed(2)}px, 0)`;
  mouthSmile.style.opacity = Math.max(0, 1 - mS[1] * 6).toFixed(3);

  const p = Beat.pulse();
  bounce += (p - bounce) * 0.35;
  const q = stepSprings(targetPose(t, bounce, mouthLvl), dt);
  let dropY = 0;
  if (entrance) { // gravity drop, one bounce, squash + dust on landing
    entrance.v += 900 * dt; entrance.y += entrance.v * dt;
    if (entrance.y >= 0) {
      entrance.y = 0;
      if (entrance.bounces++ < 1) { springs.sy.v -= 10; springs.sx.v += 8; springs.by.v += 40; dustPuff(); stepPupils(0.001, { x: 0, y: 0 }, 1.5, now); entrance.v = -entrance.v * 0.28; }
      else entrance = null;
    }
    if (entrance) { dropY = entrance.y; const st = Math.min(0.14, Math.abs(entrance.v) * 0.0006); q.sy += st; q.sx -= st * 0.7; }
  }
  rigEl.rig.style.transform = `translate3d(${(q.bx * U).toFixed(2)}px, ${((q.by + dropY) * U).toFixed(2)}px, 0) rotate(${q.br.toFixed(2)}deg)`;
  rigEl.body.style.transform = `scale(${q.sx.toFixed(4)}, ${q.sy.toFixed(4)})`;
  applyLimb(limbs.armL, q.aL1, q.aL2, 0, false); applyLimb(limbs.armR, q.aR1, q.aR2, 0, true);
  applyLimb(limbs.legL, q.lL1, q.lL2, q.lL3, false); applyLimb(limbs.legR, q.lR1, q.lR2, q.lR3, true);
  if ((q.mic > 0.5) !== micOn) { micOn = q.mic > 0.5; rigEl.mic.classList.toggle("on", micOn); }
  glow.style.opacity = (0.55 + bounce * 0.35 + mouthLvl * 0.3).toFixed(3);

  const newBeat = p > 0.85 && lastPulse <= 0.85;
  if (newBeat) ringT = 1; // new beat: fire the background ring
  lastPulse = p;
  // Body acceleration (px/s^2) drives the googly pupils
  const bxp = q.bx * U, byp = q.by * U;
  const vx = (bxp - lastBody.x) / dt, vy = (byp - lastBody.y) / dt;
  const acc = { x: (vx - lastBodyV.x) / dt, y: (vy - lastBodyV.y) / dt };
  lastBody = { x: bxp, y: byp }; lastBodyV = { x: vx, y: vy };
  stepPupils(dt, acc, newBeat ? 1 : (mouthLvl > 0.5 && Math.random() < 0.04 ? 0.35 : 0), now);
  crowdTick(now, dt, p);
  ringT = Math.max(0, ringT - 0.025);
  el.beatRing.style.opacity = (ringT * 0.5).toFixed(3);
  el.beatRing.style.transform = `scale(${(0.6 + (1 - ringT) * 0.7).toFixed(3)})`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

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
  try { // fast path: /api/audience answers instantly (/api/status pings memory, up to 3 s)
    const a = await (await fetch("/api/audience")).json();
    if (a?.code && a.joinUrl && el.joinCode.textContent === "----") {
      el.joinCode.textContent = String(a.code).toUpperCase();
      el.phoneUrl.textContent = String(a.joinUrl).replace(/^https?:\/\//, "");
      drawQr(`${a.joinUrl}?code=${encodeURIComponent(a.code)}`);
    }
  } catch {}
  try {
    const s = await status();
    rememberStatus(s);
    const code = String(s.roomCode || "").toUpperCase();
    const play = String(s.playUrl || (s.publicUrl ? `${s.publicUrl}/play` : `${location.origin}/play`));
    const url = code ? `${play}?code=${encodeURIComponent(code)}` : play;
    el.joinCode.textContent = code || "----";
    // Easy-to-type short link (is.gd/duet<code>) when the tunnel is up; QR still carries the full link.
    el.phoneUrl.textContent = s.shortUrl ? String(s.shortUrl) : play.replace(/^https?:\/\//, "");
    el.phoneUrl.classList.toggle("short", !!s.shortUrl);
    el.phoneHint.textContent = s.shortUrl ? "or type it in any browser" : "";
    let mic = s.micUrl ? String(s.micUrl) : "";
    if (!mic) { mic = s.phoneUrl || `${location.origin}/mic.html`; try { const u = new URL(mic); u.pathname = "/mic.html"; mic = u.toString(); } catch {} }
    el.joinMic.innerHTML = `Single phone, mic only: <b>${esc(mic.replace(/^https?:\/\//, ""))}</b>${/^https:\/\/\d/.test(mic) ? " (tap Advanced → Proceed)" : ""}`;
    drawQr(url);
  } catch {
    el.phoneUrl.textContent = `${location.host}/play`;
    drawQr(`${location.origin}/play`);
  }
  refreshBoard();
}
function drawQr(url) {
  try {
    const q = window.qrcode(0, "M");
    q.addData(url); q.make();
    el.qr.innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  } catch { el.qr.classList.add("empty"); }
}
async function getBoard() {
  try { const r = await fetch(`/api/leaderboard${session?.mock ? "?mock=1" : ""}`); if (!r.ok) throw 0; const b = await r.json(); return Array.isArray(b) ? b : []; } catch { return []; }
}
async function refreshBoard(highlight) {
  refreshRoster(!!session?.mock).then(() => renderGallery(el.rosterRow, el.rosterCount)).catch(() => {});
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
  for (const n of [el.turnClock, el.cooking, el.vclose, el.memcard]) n.classList.remove("on");
  el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
  session = null; poseOverride = null;
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

// Kinetic captions (captions.js): one chunk at a time, each word pops exactly when it's said.
const caps = createCaptions({ lyrics: el.lyrics, track: el.track, onWord: onCaptionWord });
function buildLyrics(lines, name) { caps.reset(lines, name); }
function focusLine(i) { caps.focus(i); }
function wipe(i, ms) { caps.start(i, ms); }          // start the line's word clock (estimate until real audio attaches)
function retimeWipe(ms) { caps.retime(ms); }         // real MP3 duration arrived
const YOU_WORD = /^(you|your|youre|yours|ya|yer|yourself)$/;
let lastPunchSfx = 0;
function onCaptionWord({ word, punch, last, kind, el: wordEl }) {
  if (state !== "show") return;
  const w = word.toLowerCase().replace(/[’']/g, "").replace(/[^a-z]/g, "");
  if (Math.random() < 0.7 || punch) lookAtEl(wordEl, 450); // eyes dart to the word
  if (kind === "said") return; // the player's own words: just watch them
  if (kind === "obj") {
    if (punch) setGesture("hands", 560);
    else if (YOU_WORD.test(w)) setGesture("point", 480);
    else setGesture("chop", 240);
    if (!session?.mock || fakeTalk) { fakeRound = punch ? 0.9 : Math.random(); }
  } else if (punch) setGesture("hands", 520); // karaoke hype man
  if (punch) {
    el.lyrics.classList.remove("shake"); void el.lyrics.offsetWidth; el.lyrics.classList.add("shake");
    if (last && kind === "obj") { // the line's final punchline: camera punch-in (+ crowd "ooooh" unless mild)
      const diff = session?.difficulty || gameDifficulty;
      try { el.show.animate([{ transform: `scale(${diff === "savage" ? 1.045 : 1.025})` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" }); } catch {}
      if (diff !== "mild" && performance.now() - lastPunchSfx > 4000) { lastPunchSfx = performance.now(); window.playSfx?.("ooooh"); }
    }
  }
}

async function startShow(s) {
  if (!s || !s.song || !Array.isArray(s.song.lines)) return;
  if (state === "show" && session && session.id === s.id) return; // duplicate event
  if (!unlocked) { pendingSession = s; toast("Click 'start the show' to hear it"); return; }
  const myRun = ++run;
  stopAllAudio(); stopConfetti();
  session = s; takes.clear(); takeWaiters.clear(); roundData.clear(); phoneMicOk = true;

  const c = s.character || {};
  setAccent(c.colour);
  el.charImg.classList.remove("broken");
  el.charImg.onerror = () => el.charImg.classList.add("broken");
  charMode = { singing: false, listening: false, verdict: null, verdictAt: 0 }; poseOverride = null;
  setCharacterShape(s);
  el.charImg.src = s.photo || "";
  rigEl.stickerImg.setAttribute("href", s.photo || "");
  if (el.charImg.complete && el.charImg.naturalWidth) onPhotoLoad();
  el.charName.textContent = c.name || "Mystery Object";
  el.charObject.textContent = s.object ? `the ${s.object}` : "";
  el.charCatch.textContent = c.catchphrase ? `"${c.catchphrase}"` : "";
  el.songGenre.textContent = [s.song.genre, s.song.bpm && `${s.song.bpm} bpm`].filter(Boolean).join(" · ");
  el.songTitle.textContent = s.song.title || "Untitled Banger";
  setFac(s.mode === "battle" || s.battle ? "ROAST BATTLE" : s.mode === "karaoke" ? "KARAOKE" : "DUET");
  el.show.classList.toggle("is-returning", !!s.returning);
  { const fac = $("facLabel"); if (fac) fac.dataset.diff = String(s.difficulty || gameDifficulty || "spicy").toUpperCase(); }
  startEntrance();
  buildLyrics(s.song.lines, c.name || "Object");
  el.rec.classList.remove("live"); el.got.classList.remove("show"); el.judging.classList.remove("on");
  setScreen("show");
  requestAnimationFrame(() => focusLine(0));
  if (s.demo) broadcast({ type: "song-ready", session: { id: s.id, demo: true, mode: s.mode || "duet", battle: s.battle, object: s.object, character: s.character, song: s.song, photo: "" } });

  try {
    if (s.returning) { await memoryCard(s, myRun); guard(myRun); }
    await sleep(900); guard(myRun);
    await Beat.start({ genre: s.song.genre || "pop", bpm: s.song.bpm || 100, key: s.song.key || "C" });
    guard(myRun);
    await sleep(Math.round((60000 / (s.song.bpm || 100)) * 2)); guard(myRun); // two beats of intro
    if (s.mode === "battle" || s.battle) await battleRounds(s, myRun, c);
    else if (s.mode === "karaoke") await karaokeLines(s, myRun);
    else for (let i = 0; i < s.song.lines.length; i++) { // legacy scripted duet (offline demo key D)
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

/** OPENLOFT MEMORY FOUND: full-screen zine card for ~3s before a returning object's opener. */
async function memoryCard(s, myRun) {
  const m = s.memory || {}, c = s.character || {};
  const img = $("memPhoto");
  img.onerror = () => { img.onerror = null; img.src = s.photo || ""; };
  img.src = m.photo || s.photo || "";
  $("memName").textContent = `${c.name || "This one"}${s.object ? ` the ${s.object}` : ""}`;
  const when = m.lastAt ? new Date(m.lastAt) : null;
  const day = when && when.toDateString() === new Date().toDateString() ? "today" : when ? when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  $("memWhen").textContent = when ? `LAST TIME: ${day} ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "LAST TIME: we've met before";
  $("memScore").textContent = m.lastScore != null ? `SCORE: ${Math.round(m.lastScore)}/100${m.lastWinner ? ` · WINNER: ${String(m.lastWinner).toUpperCase()}` : ""}` : (m.seen ? `MET ${m.seen} TIME${m.seen === 1 ? "" : "S"} BEFORE` : "");
  $("memBest").textContent = m.lastBest && m.lastBest !== "silence" ? `BEST LINE: '${m.lastBest}'` : "";
  el.memcard.classList.add("on");
  try { window.playSfx?.("ooooh"); } catch {}
  try { await sleep(3200); guard(myRun); } finally { el.memcard.classList.remove("on"); }
  await sleep(350);
}

async function objectLine(i, line, myRun, c) {
  const ms = line.ms || 3500;
  wipe(i, ms);
  const seed = [...(c.name || "x")].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  // MOCK sessions and failed TTS lines carry silent MP3s: use the free browser voice so the demo is audible.
  const silent = session?.mock || line.ttsFailed;
  Beat.duck(true);
  charMode.singing = true;
  try {
    // Opener as a real rap track (ElevenLabs Music API, has its own beat): pause the Tone beat, then bring it back.
    if (line.rapAudio && !silent) {
      const sg = session?.song || {};
      Beat.stop();
      try { await playMp3(line.rapAudio, line.rapMs || ms, retimeWipe, (a) => caps.attachAudio(a)); return; }
      catch (e) { console.warn("[stage] rap track failed, using TTS", e.message); }
      finally { if (session?.song === sg) Beat.start({ genre: sg.genre || "pop", bpm: sg.bpm || 100, key: sg.key || "C" }); }
    }
    if (line.audio && !silent) {
      try { await playMp3(line.audio, ms, retimeWipe, (a) => caps.attachAudio(a), true); return; } catch (e) { console.warn("[stage] line audio failed, using fallback voice", e.message); }
    }
    guard(myRun);
    await speakFallback(line.text, ms, seed, { start: () => caps.speechStart(), boundary: (ci) => caps.boundary(ci) });
  } finally { caps.finish(); Beat.duck(false); charMode.singing = false; }
}

async function youLine(i, line, myRun) {
  const ms = line.ms || 4000;
  charMode.listening = true;
  try { await youLineInner(i, line, myRun, ms); } finally { charMode.listening = false; }
}
async function youLineInner(i, line, myRun, ms) {
  // 3-2-1 countdown on the beat
  const beatMs = Math.min(700, Math.max(380, 60000 / (session.song.bpm || 100)));
  for (const n of ["3", "2", "1"]) {
    bigCount(n);
    await sleep(beatMs); guard(myRun);
  }
  bigCount("SING!");

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
  if (session?.battle) setRound(data.round ?? line, { transcript: t.transcript, heard: true, done: true, comeback: data.comeback || null });
  takeWaiters.get(line)?.(t);
}

// ---------- Freestyle roast battle (main mode) ----------
const roundData = new Map(); // round -> { transcript, heard, done, comeback }
let roundPing = [];
function setRound(r, patch) { roundData.set(r, { ...(roundData.get(r) || {}), ...patch }); const p = roundPing; roundPing = []; p.forEach((fn) => fn()); }
async function waitRound(r, pred, ms, myRun) {
  const end = performance.now() + ms;
  while (!pred(roundData.get(r) || {})) {
    const left = end - performance.now();
    if (left <= 0) return null;
    await Promise.race([new Promise((res) => roundPing.push(res)), sleep(Math.min(left, 400))]);
    guard(myRun);
  }
  return roundData.get(r);
}
function addLyric(who, text, name) { return caps.add(who, text, name); }
function bigCount(text) { el.count.classList.toggle("word", String(text).length > 3); el.count.textContent = text; el.count.classList.remove("go"); void el.count.offsetWidth; el.count.classList.add("go"); }

// Speech bubble from the character (heckles during your turn, reactions after)
const HECKLES = {
  mild: ["Go on then!", "Ooh, okay!", "Is that a rhyme?", "Keep going!", "Not bad...", "I'm listening!"],
  spicy: ["Is that it?", "Go on, our kid!", "Weak!", "Yawn...", "Bars? Where?", "My kettle raps better", "Speak up!"],
  savage: ["Pathetic.", "Is that ALL?", "Booo!", "Get off!", "My nan's harder", "Embarrassing.", "Try again."],
};
let heckleEl = null;
function heckle(text) {
  if (!heckleEl) { heckleEl = document.createElement("div"); heckleEl.className = "heckle"; document.getElementById("show")?.appendChild(heckleEl); }
  heckleEl.textContent = text;
  heckleEl.classList.remove("on"); void heckleEl.offsetWidth; heckleEl.classList.add("on");
  clearTimeout(heckle.t); heckle.t = setTimeout(() => heckleEl.classList.remove("on"), 2200);
}
const COOK = ["Cooking a comeback...", "Sharpening bars...", "Finding a rhyme...", "Loading the diss...", "Warming up the voice..."];
function cookQuips() {
  const p = el.cooking.querySelector("p"); let i = 0;
  const t = setInterval(() => { i = (i + 1) % COOK.length; if (p) p.textContent = COOK[i]; }, 1600);
  return () => { clearInterval(t); if (p) p.textContent = COOK[0]; };
}
async function battleRounds(s, myRun, c) {
  const rounds = s.battle?.rounds || 3, youMs = s.battle?.youMs || 12000, name = c.name || "Object";
  focusLine(0);
  broadcast({ type: "line", index: 0 });
  await objectLine(0, s.song.lines[0], myRun, c); // the object's opener (its lyrics show)
  guard(myRun);
  for (let r = 1; r <= rounds; r++) {
    await sleep(300); guard(myRun);
    window.playSfx?.("scratch"); // ElevenLabs record scratch at each round change (fire-and-forget)
    await freestyleTurn(r, rounds, youMs, myRun);
    // What the user ACTUALLY said (arrives right after speech-to-text, before the comeback is ready)
    setPose("thinking");
    const heard = await waitRound(r, (d) => d.heard, 9000, myRun);
    const said = heard?.transcript || "";
    // The room heard the player live: no read-back of their bars on screen, just the object reacting.
    if (r >= rounds) { setPose("laugh"); heckle(said ? "Right. Judges?" : "Nothing?! Judges..."); await sleep(1600); guard(myRun); setPose(null); break; }
    // "Wait for it" beat while the comeback is written + voiced: rotating quips so the stage never feels empty
    const t0 = performance.now();
    if (!roundData.get(r)?.done) el.cooking.classList.add("on");
    const stopQuips = cookQuips();
    let done;
    try { done = await waitRound(r, (d) => d.done, 16000, myRun); } finally { stopQuips(); el.cooking.classList.remove("on"); }
    await sleep(Math.max(0, 1100 - (performance.now() - t0))); guard(myRun);
    setPose(null);
    el.got.classList.remove("show");
    const cb = done?.comeback?.text ? done.comeback : { text: said ? `"${said.split(" ").slice(0, 5).join(" ")}"? Is that it, you plonker?` : "Cat got your tongue? Absolute weapon." };
    const ci = addLyric("object", cb.text, name);
    focusLine(ci);
    await objectLine(ci, cb, myRun, c);
    window.playSfx?.(Math.random() < 0.6 ? "ooooh" : "laugh"); // crowd reacts to the comeback
    guard(myRun);
  }
}
function setFac(t) { const f = $("facLabel"); if (f) f.textContent = `FAC 51 · ${t}`; } // zine catalogue label
const pad2 = (n) => String(n).padStart(2, "0");
let turnExtend = 0; // set by a phone mic-silent event during a live turn
async function freestyleTurn(r, rounds, ms, myRun) {
  setFac(`ROAST BATTLE · ROUND ${pad2(r)}/${pad2(rounds)}`);
  charMode.listening = true;
  try {
    // record-start goes out BEFORE the 3-2-1 (leadMs): the server stamps startAt, the phone mirrors the countdown and opens its mic on time
    broadcast({ type: "record-start", line: r, round: r, ms, leadMs: 1650, ...(session?.demo ? { player: "demo" } : {}) });
    for (const n of ["3", "2", "1"]) { bigCount(n); await sleep(550); guard(myRun); }
    bigCount("FREESTYLE!");
    el.got.classList.remove("show");
    el.rec.classList.add("live");
    takeWaiters.set(r, () => {}); // lets the laptop-mic fallback find the live round
    el.recTitle.textContent = "YOUR TURN";
    if (!phoneMicOk) laptopTake(r, ms).catch((e) => console.warn("[stage] laptop take", e));
    let end = performance.now() + ms;
    turnExtend = 0;
    while (performance.now() < end) {
      if (turnExtend) { end += turnExtend; turnExtend = 0; } // phone mic was silent: a few more seconds
      const left = Math.ceil((end - performance.now()) / 1000);
      el.recState.textContent = `Round ${r} of ${rounds} · roast it back! · ${phoneMicOk ? "phone mic" : "laptop mic"}`;
      if (el.turnClock.textContent !== String(left)) { el.turnClock.textContent = String(left); el.turnClock.classList.toggle("hot", left <= 5); el.turnClock.classList.remove("tick"); void el.turnClock.offsetWidth; el.turnClock.classList.add("tick"); }
      el.turnClock.classList.add("on");
      if (left > 1 && left % 3 === 0 && heckle.last !== left) { heckle.last = left; const list = HECKLES[document.body.dataset.difficulty] || HECKLES[typeof gameDifficulty === "string" ? gameDifficulty : "spicy"] || HECKLES.spicy; heckle(list[(r * 7 + left) % list.length]); setGesture?.(left % 2 ? "point" : "hands", 500); }
      await sleep(Math.min(1000, Math.max(50, end - performance.now() - (left - 1) * 1000)));
      guard(myRun);
    }
    bigCount("TIME!"); window.playSfx?.(Math.random() < 0.5 ? "cheer" : "ooooh"); // crowd reacts to your bars
  } finally { charMode.listening = false; takeWaiters.delete(r); el.rec.classList.remove("live"); el.turnClock.classList.remove("on", "hot"); el.turnClock.textContent = ""; }
}

// ---------- Karaoke (secondary mode): user sings every line, object is the hype man ----------
async function karaokeLines(s, myRun) {
  // REAL SONGS: an embedded official YouTube karaoke video (public/karaoke.js runs it; phones record in chunks).
  if (s.youtube && window.KaraokeYT) {
    Beat.stop();
    return window.KaraokeYT.run(s, { guard: () => guard(myRun), broadcast, sleep, bigCount, toast, playMp3, speak: speakFallback, sing: (on) => { charMode.singing = on; }, listen: (on) => { charMode.listening = on; }, el });
  }
  const lines = s.song.lines;
  const parted = !!s.parts; // karaoke parts: P1..P4 / ALL / AI (lib/karaoke.mjs)
  for (const n of ["3", "2", "1"]) { bigCount(n); await sleep(Math.min(700, Math.max(380, 60000 / (s.song.bpm || 100)))); guard(myRun); }
  bigCount("SING!");
  el.recTitle.textContent = "SING IT";
  el.rec.classList.add("live");
  for (let i = 0; i < lines.length; i++) {
    guard(myRun);
    const L = lines[i];
    const ms = L.ms || 4000;
    focusLine(i);
    broadcast({ type: "line", index: i });
    if (parted && L.who === "object") { // the AI sings this one (eleven_v3 [sings], beat-locked) and the character animates
      el.recState.textContent = `${L.singerName || s.character?.name || "The AI"} is singing…`;
      await objectLine(i, L, myRun, s.character || {});
      guard(myRun); await sleep(120); continue;
    }
    wipe(i, ms);
    // Target the phones: one player's part -> only their phone; ALL -> every phone; old flow -> untargeted.
    const target = !parted ? {} : L.part === "ALL" ? { all: true } : L.singer && L.singer !== "ai" ? { player: L.singer, playerName: L.singerName, playerColour: L.singerColour } : {};
    el.recState.textContent = parted ? `${L.part === "ALL" ? "EVERYONE" : String(L.singerName || "You").toUpperCase()}: sing it!` : phoneMicOk ? "Sing it! Listening on your phone…" : "Sing it! Listening on the laptop mic…";
    broadcast({ type: "record-start", line: i, ms, id: s.id, ...target });
    takeWaiters.set(i, () => {});
    if (!phoneMicOk) laptopTake(i, ms - 150).catch((e) => console.warn("[stage] laptop take", e));
    if (parted && L.aiAlong && L.audio && !(s.mock || L.ttsFailed)) { charMode.singing = true; playMp3(L.audio, ms).catch(() => {}).finally(() => { charMode.singing = false; }); } // 1 player: the AI sings the chorus with you
    await sleep(ms + 350);
    takeWaiters.delete(i);
  }
  el.rec.classList.remove("live");
  const want = lines.filter((l) => l.who === "you").length;
  const t0 = performance.now();
  while (takes.size < want && performance.now() - t0 < 5000) { await sleep(250); guard(myRun); } // last takes still uploading
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
  const r = await postJson("/api/take", { id: sid, line, round: line, audio, mime: blob.type });
  if (session?.id === sid) gotTake(line, r); // server also broadcasts take-received; gotTake is idempotent
}
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

// ---------- Judge + verdict ----------
async function voteClosing(myRun) {
  el.vclose.classList.add("on"); window.playSfx?.("drumroll");
  try {
    for (const n of ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]) {
      el.vcloseN.textContent = n;
      el.vcloseN.classList.remove("go"); void el.vcloseN.offsetWidth; el.vcloseN.classList.add("go");
      await sleep(1000); guard(myRun);
    }
  } finally { el.vclose.classList.remove("on"); }
}
async function judge(myRun) {
  Beat.stop();
  let crowdTally = null;
  const voting = (session.battle || session.mode === "battle") && (crowd.audienceCount() > 0 || session.pvp); // let the crowd's last votes land
  // Real sessions: the server waits waitVotesMs, then closes voting and judges, while the stage shows VOTE CLOSING 3..2..1.
  const judgeP = session.demo ? Promise.reject(new Error("offline demo")) : postJson("/api/judge", { id: session.id, ...(voting ? { waitVotesMs: 10000 } : {}), ...(session.youtube && window.KaraokeYT ? { asked: window.KaraokeYT.asked() } : {}) });
  judgeP.catch(() => {});
  if (voting) await voteClosing(myRun);
  if (session.demo && voting) { try { crowdTally = (await postJson("/api/audience/close", { id: session.id })).tally || null; } catch {} }
  Beat.sting("drumroll");
  el.judging.classList.add("on");
  const started = performance.now();
  let v;
  try { v = await judgeP; }
  catch (e) {
    console.warn("[stage] judge failed, local verdict", e.message);
    const accs = [...takes.values()].map((t) => t.accuracy);
    const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0.5;
    v = { score: Math.round(30 + avg * 50), roast: "Is that it? Absolute shambles. My kettle's got better bars than you." };
    if (session?.demo && session.battle) {
      v = { score: 58 + Math.round(Math.random() * 20), roast: "Hold my tea? You couldn't hold a tune. Best line was the dust one, our kid, and even that was dusty.", best: DEMO_BARS[2][0], worst: "(silence)", categories: { wit: 6, rhymes: 4, comebacks: 5, confidence: 7 } };
      if (crowdTally?.total) { v.score = Math.max(0, Math.min(100, v.score + crowdTally.bonus)); v.crowd = { player: crowdTally.player, object: crowdTally.object, bonus: crowdTally.bonus }; }
    }
  }
  await sleep(Math.max(0, 2200 - (performance.now() - started)));
  guard(myRun);
  showVerdict(v, myRun);
}

async function showVerdict(v, myRun) {
  const score = Math.max(0, Math.min(100, Math.round(+v.score || 0)));
  el.judging.classList.remove("on");
  el.roast.textContent = "";
  // Rubric categories with their one-line reason ("Rhymes 6/10 - 3 rhyming pairs: mug/thug...")
  const why = v.reasons && typeof v.reasons === "object" ? v.reasons : {};
  const cat = v.categories && typeof v.categories === "object" ? Object.entries(v.categories).map(([k, n]) => `<span class="cat"><b>${esc(k[0].toUpperCase() + k.slice(1))}</b> ${Math.round(+n || 0)}/10${why[k] ? `<small class="why"> — ${esc(why[k])}</small>` : ""}</span>`) : [];
  el.bw.innerHTML = [...cat, v.best && `<span>Best: ${esc(v.best)}</span>`, v.worst && `<span>Worst: ${esc(v.worst)}</span>`].filter(Boolean).join("");
  el.scoreNum.textContent = "0";
  const battleish = session?.battle || session?.mode === "battle" || v.mode === "battle";
  el.winner.textContent = v.pvp?.winnerName ? `WINNER: ${v.pvp.winnerName}` : battleish ? (score >= 60 ? "WINNER: YOU" : `WINNER: THE ${String(session?.object || session?.character?.name || "object").toUpperCase()}`) : (score >= 70 ? "PROPER SINGER" : "BRAVE EFFORT");
  el.winner.classList.toggle("you", !!battleish && score >= 60);
  if (session?.demo) broadcast({ type: "verdict", score, roast: v.roast || "", best: v.best, worst: v.worst, categories: v.categories, crowd: v.crowd });
  charMode.verdict = score >= 80 ? "celebrate" : score < 40 ? "facepalm" : "laugh";
  charMode.verdictAt = performance.now();
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
  if (score >= 85) window.playSfx?.("cheer"); else if (score < 50) window.playSfx?.("boo"); // ElevenLabs crowd on the verdict
  if (score >= 50) burstConfetti(score >= 85 ? 260 : 160);
  else burstConfetti(40);

  // Roast: type the text while the object speaks it
  typeText(el.roast, v.roast || "", 2800);
  const roastMs = Math.max(2500, (v.roast || "").length * 60);
  if (v.audio && !session?.mock) { try { await playMp3(v.audio, roastMs); if (myRun === run) window.playSfx?.("micdrop"); return; } catch {} }
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
const CW = 1920, CH = 1080; // design canvas (index.html scales it to the window)
function sizeCanvas() { const d = Math.min(2, (devicePixelRatio || 1) * (window.stageScale || 1)); cv.width = CW * d; cv.height = CH * d; cx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener("resize", () => sizeCanvas());
sizeCanvas();
function burstConfetti(n) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const colours = [accent, "#ffffff", "#ffd23f", "#9fe8ff", "#b18cff"];
  for (let i = 0; i < n; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? -10 : CW + 10, y: CH * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10), vy: -(12 + Math.random() * 12),
      w: 6 + Math.random() * 8, h: 10 + Math.random() * 12, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colours[(Math.random() * colours.length) | 0], life: 0,
    });
  }
  if (!confRaf) confRaf = requestAnimationFrame(tickConfetti);
}
function tickConfetti() {
  cx.clearRect(0, 0, CW, CH);
  parts = parts.filter((p) => p.y < CH + 40 && p.life < 600);
  for (const p of parts) {
    p.life++; p.vy += 0.35; p.vx *= 0.985; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.cos(p.life * 0.12));
    cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
  }
  confRaf = parts.length ? requestAnimationFrame(tickConfetti) : 0;
  if (!confRaf) cx.clearRect(0, 0, CW, CH);
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
    case "take-heard": // battle: transcript is in, comeback still cooking
      if (session?.battle && ev.id === session.id) setRound(ev.round ?? ev.line, { transcript: ev.transcript || "", heard: true });
      break;
    case "take-received":
      if (typeof ev.line === "number" && (!ev.id || ev.id === session?.id)) gotTake(ev.line, ev);
      break;
    case "mode":
      setModeUi(ev.mode);
      break;
    case "difficulty":
      setDifficultyUi(ev.difficulty);
      break;
    case "mic-unavailable":
      if (phoneMicOk) {
        phoneMicOk = false;
        toast("Phone can't record - using the laptop mic");
        // If a line is being recorded right now, take over for it
        const cur = [...takeWaiters.keys()][0];
        if (cur !== undefined && session) {
          el.recState.textContent = "Listening on the laptop mic…";
          laptopTake(cur, Math.max(1500, (session.battle?.youMs || session.song.lines[cur]?.ms || 4000) - 500)).catch((e) => console.warn(e));
        }
      }
      break;
    case "mic-silent": // phone mic hears nothing even after re-grabbing it
      if (el.rec.classList.contains("live")) turnExtend = Math.min(4000, Math.max(0, Number(ev.extendMs) || 3000));
      toast(`CAN'T HEAR ${ev.playerName ? String(ev.playerName).toUpperCase() : "THE RAPPER"} — check the phone mic`);
      break;
    case "mic-check": // phone ran TEST MIC
      toast(`${ev.playerName || "Phone"}: mic ${ev.ok ? "OK ✓" : "not hearing anything ✗"}`);
      break;
    case "reset":
      if (performance.now() - ownResetAt < 1500) break; // our own Esc/Again echo: never kill a show started right after
      if (state !== "idle") goIdle();
      el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
      break;
    case "error":
      if (state !== "idle") goIdle();
      el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
      toast("SNAP FAILED — TRY AGAIN", 4200);
      break;
    case "public-url":
      loadIdle();
      break;
  }
});

// ---------- Controls ----------
let ownResetAt = -1e9;
function again() { ownResetAt = performance.now(); broadcast({ type: "reset" }); goIdle(); }
el.againBtn.addEventListener("click", again);
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!unlocked) return unlock();
    if (state === "result" || state === "show") again();
  } else if (e.key === "d" || e.key === "D") {
    if (!unlocked) unlock().then(() => startShow(demoSession())); else if (state === "idle") startShow(demoSession());
  } else if (e.key === "b" || e.key === "B") {
    if (!unlocked) unlock().then(() => startShow(demoBattle())); else if (state === "idle") startShow(demoBattle());
  } else if (["1", "2", "3"].includes(e.key) && state === "idle") {
    setDifficulty(DIFFS[+e.key - 1]);
  } else if ((e.key === "m" || e.key === "M") && state === "idle" && !document.body.classList.contains("solo")) {
    setMode(gameMode === "battle" ? "karaoke" : "battle");
  } else if (e.key === "Escape") {
    hardReset();
  } else if (e.key === "h" || e.key === "H" || e.key === "?") {
    el.help.classList.toggle("on");
  } else if (e.key === "q" || e.key === "Q") {
    document.body.classList.toggle("show-mic");
  } else if (e.key === "n" || e.key === "N") {
    nextPlayer();
  }
});
/** Esc: always back to idle, close every overlay, and tell the phones to reset too. */
function hardReset() {
  el.help.classList.remove("on");
  ownResetAt = performance.now();
  broadcast({ type: "reset", reason: "stage-esc" });
  goIdle();
  el.idleCta.classList.remove("waking"); el.idleCtaText.textContent = "Snap anything to start";
}
/** N: next player - reset + rotate the VS THE OBJECT queue (lib/players.mjs via /api/match). */
async function nextPlayer() {
  hardReset();
  try {
    const r = await (await fetch("/api/players")).json();
    const list = r.players || [];
    if (r.match?.type === "pvp" || list.length < 2) { toast(list.length ? "Next up!" : "Reset - next player, snap away"); return; }
    const i = list.findIndex((p) => p.id === r.match?.current);
    const next = list[(i + 1) % list.length];
    await postJson("/api/match", { type: "object", current: next.id });
    toast(`Next up: ${next.name}`);
  } catch { toast("Reset - next player, snap away"); }
}
// Gate unlock replays a song that arrived before the click
el.gateBtn.addEventListener("click", () => { if (pendingSession) { const s = pendingSession; pendingSession = null; setTimeout(() => startShow(s), 300); } });

/** Offline demo (key D): no server routes needed, free speech voice, takes simulated. */
function demoSession() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><radialGradient id='g' cx='.35' cy='.3'><stop offset='0' stop-color='#ffd2a8'/><stop offset='1' stop-color='#c2551f'/></radialGradient></defs><rect width='400' height='400' fill='#3a1a10'/><rect x='95' y='110' width='190' height='210' rx='26' fill='url(#g)'/><path d='M285 160 q70 0 70 60 t-70 60' stroke='#c2551f' stroke-width='26' fill='none'/><ellipse cx='190' cy='118' rx='95' ry='18' fill='#5a2a14'/></svg>`;
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
    face: { leftEye: { x: 0.37, y: 0.44 }, rightEye: { x: 0.55, y: 0.44 }, eyeSize: 0.12, mouth: { x: 0.46, y: 0.63, width: 0.2 } },
    bbox: { x: 0.23, y: 0.25, w: 0.67, h: 0.56 },
    outline: [[0.24, 0.27], [0.475, 0.252], [0.71, 0.27], [0.72, 0.37], [0.82, 0.385], [0.89, 0.46], [0.89, 0.6], [0.82, 0.68], [0.72, 0.7], [0.71, 0.77], [0.68, 0.8], [0.27, 0.8], [0.24, 0.77]].map(([x, y]) => ({ x, y })),
    character: { name: "Mug Jagger", personality: "washed-up rock star mug", catchphrase: "Pour us another, our kid", colour: "#ff5a36" },
    song: { title: "Brew Me Tender", genre: "britpop", bpm: 112, key: "C", lines },
  };
}
const demoTakes = new Map();
/** Offline battle demo (key B): canned freestyles + comebacks, browser voice. */
function demoBattle() {
  const d = demoSession();
  d.mode = "battle"; d.battle = { ...demoCfg };
  d.song = { title: "Brew Beef", genre: "hip hop", bpm: 92, key: "C", lines: [{ who: "object", text: "Look at you, our kid, stood there like a muppet. I've held better bars in me since 1996. Go on then, you numpty.", ms: 6000 }] };
  return d;
}
const DEMO_BARS = [
  ["you're just a mug, you hold my tea, nobody even knows your name", "Hold your tea? You couldn't hold a tune, you wet wipe. Nobody knows my name? Mate, nobody's asked for yours."],
  ["", "Cat got your tongue? Proper silence, absolute weapon. Even the kettle's louder than you, muppet."],
  ["at least I can walk, you sit on a desk all day collecting dust", ""],
];
setInterval(() => {
  if (!session?.demo || !session.battle) return;
  for (const r of takeWaiters.keys()) {
    if (roundData.get(r)?.pending) continue;
    setRound(r, { pending: true });
    const [said, cb] = DEMO_BARS[(r - 1) % DEMO_BARS.length];
    const sid = session.id;
    setTimeout(() => {
      if (session?.id !== sid) return;
      setRound(r, { transcript: said, heard: true });
      broadcast({ type: "take-heard", round: r, line: r, transcript: said });
      setTimeout(() => {
        if (session?.id !== sid) return;
        setRound(r, { done: true, comeback: cb ? { text: cb } : null });
        broadcast({ type: "take-received", round: r, line: r, transcript: said, comeback: cb ? { text: cb } : null, last: r >= session.battle.rounds });
      }, 2200);
    }, session.battle.youMs + 300);
  }
}, 200);

// ---------- Game mode (battle default | karaoke), set on the server so the phone + /api/object agree ----------
let gameMode = "battle", modeBtn = null;
function setModeUi(m) {
  gameMode = m === "karaoke" ? "karaoke" : "battle";
  if (!modeBtn) {
    modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "mode-btn";
    modeBtn.addEventListener("click", (e) => { e.stopPropagation(); setMode(gameMode === "battle" ? "karaoke" : "battle"); });
    (el.idleCta?.parentElement || document.body).appendChild(modeBtn);
  }
  modeBtn.innerHTML = gameMode === "battle" ? "Mode: <b>ROAST BATTLE</b> · M for Karaoke" : "Mode: <b>KARAOKE</b> · M for Roast Battle";
}
// ---------- Difficulty (mild | spicy default | savage), server-side like the mode ----------
const DIFFS = ["mild", "spicy", "savage"];
const DIFF_LABEL = { mild: ["Mild", "Light roast"], spicy: ["Spicy", "Cheeky bars"], savage: ["Savage", "No mercy"] };
let gameDifficulty = "spicy", diffSeg = null;
function setDifficultyUi(d) {
  gameDifficulty = DIFFS.includes(d) ? d : "spicy";
  if (!diffSeg) {
    diffSeg = document.createElement("div");
    diffSeg.className = "diff-seg";
    diffSeg.setAttribute("role", "radiogroup");
    diffSeg.innerHTML = DIFFS.map((k, i) => `<button type="button" role="radio" data-d="${k}"><kbd>${i + 1}</kbd>${DIFF_LABEL[k][0]}<small>${DIFF_LABEL[k][1]}</small></button>`).join("");
    diffSeg.addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (b) { e.stopPropagation(); setDifficulty(b.dataset.d); } });
    if (modeBtn?.parentElement) modeBtn.after(diffSeg); else (el.idleCta?.parentElement || document.body).appendChild(diffSeg);
  }
  for (const b of diffSeg.querySelectorAll("button")) { const on = b.dataset.d === gameDifficulty; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); }
}
async function setDifficulty(d) {
  setDifficultyUi(d);
  try { const r = await postJson("/api/difficulty", { difficulty: d }); setDifficultyUi(r.difficulty); } catch { toast("Couldn't change difficulty"); }
}
async function setMode(m) {
  setModeUi(m);
  try { const r = await postJson("/api/mode", { mode: m }); setModeUi(r.mode); } catch { toast("Couldn't change mode"); }
}
status().then((st) => { rememberStatus(st); setModeUi(st?.mode); setDifficultyUi(st?.difficulty); }).catch(() => { setModeUi("battle"); setDifficultyUi("spicy"); });
// In demo mode, answer our own record-start after the line finishes
setInterval(() => {
  if (!session?.demo || session.battle) return; // the battle demo has its own canned bars (DEMO_BARS)
  for (const [line, resolve] of takeWaiters) {
    const t = demoTakes.get(line);
    const ms = session.song.lines[line]?.ms || 3000;
    if (t && !t.pending) { t.pending = true; setTimeout(() => { if (takeWaiters.get(line) === resolve) gotTake(line, t); }, ms + 400); }
  }
}, 200);

loadIdle();
