// Duet Anything - OBJECT vs OBJECT stage (lib/ovo.mjs). Self-contained overlay over the stage (stage.js never sees
// OvO events, so VS THE OBJECT / PvP are untouched). Two cut-out characters LEFT vs RIGHT facing each other (the right
// one's pose/eyes face left; the photo itself is never mirrored so its text stays readable), googly eyes, mouths driven by their own audio, rubber-hose limbs, kinetic captions on the speaker's
// side, hype meters fed by the trainers' phones, round votes, verdict. Key O = offline demo with two placeholder objects.
import * as beats from "./beats.js";
import("./segment.js").then((m) => m.preloadSegmenter?.()).catch(() => {}); // warm the cut-out model early (safe to call repeatedly)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostTok = () => { try { return sessionStorage.getItem("duetHostToken") || ""; } catch { return ""; } };
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(hostTok() ? { "x-host-token": hostTok() } : {}) }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
const B = { start: (o) => { try { return beats.startBeat?.(o); } catch { return null; } }, stop: () => { try { beats.stopBeat?.(); } catch {} }, pulse: () => { try { return +beats.getBeatPulse?.() || 0; } catch { return 0; } },
  bpm: () => { try { return +beats.getBpm?.() || 0; } catch { return 0; } }, nextBar: () => { try { return Math.max(0, Math.min(4000, +beats.msToNextBar?.() || 0)); } catch { return 0; } },
  sfx: (n) => { try { return beats.playSfx?.(n); } catch { return false; } }, duck: (on) => { try { beats.setDuck?.(on); } catch {} } };
const upper = (s) => String(s || "").toUpperCase();
const possessive = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const sideTag = (x) => upper(`${x.trainerName ? possessive(x.trainerName) + " " : ""}${x.object || "object"}`);

// ---------- styles ----------
const css = document.createElement("style");
css.textContent = `
.ovo { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; z-index: 48; display: none; overflow: hidden; color: #111; font-family: "Space Mono", monospace;
  background: radial-gradient(circle at 50% 120%, #ffd40055 0, transparent 55%), repeating-linear-gradient(90deg, #ece6d6 0 959px, #111 959px 961px, #ece6d6 961px 1920px); }
.ovo.on { display: block; }
.ovo-top { position: absolute; left: 0; right: 0; top: 0; height: 104px; display: flex; align-items: center; justify-content: center; gap: 24px; background: #111; color: #ece6d6; border-bottom: 6px solid #111; }
.ovo-top::after { content: ""; position: absolute; left: 0; right: 0; bottom: -22px; height: 16px; background: repeating-linear-gradient(-45deg,#111 0 14px,#ffd400 14px 28px); }
.ovo-title { font-family: "Anton", sans-serif; font-size: 50px; line-height: 1; text-transform: uppercase; white-space: nowrap; max-width: 1500px; overflow: hidden; text-overflow: ellipsis; }
.ovo-title i { font-style: normal; color: #111; background: #ffd400; padding: 0 12px; margin: 0 14px; display: inline-block; transform: rotate(-4deg); }
.ovo-round:empty { display: none; }
.ovo-round { position: absolute; right: 26px; top: 30px; font: 700 20px "Space Mono", monospace; background: #ff4f9a; color: #111; padding: 4px 10px; border: 3px solid #ece6d6; }
.ovo-tag { position: absolute; left: 26px; top: 30px; font: 700 18px "Space Mono", monospace; color: #ffd400; letter-spacing: .08em; }
.ovo-side { position: absolute; top: 130px; width: 960px; height: 950px; }
.ovo-side.L { left: 0; } .ovo-side.R { left: 960px; }
.ovo-cap { position: absolute; left: 70px; right: 70px; top: 22px; height: 210px; display: flex; flex-wrap: wrap; align-content: center; justify-content: center; gap: 4px 14px; font-family: "Anton", sans-serif; font-size: 62px; line-height: 1.05; text-transform: uppercase; text-align: center; }
.ovo-cap span { display: inline-block; opacity: 0; transform: translateY(26px) scale(.7); transition: opacity .14s ease-out, transform .22s cubic-bezier(.2,1.6,.4,1); }
.ovo-cap span.in { opacity: 1; transform: none; }
.ovo-cap span.p { background: #ffd400; padding: 0 10px; border: 4px solid #111; box-shadow: 5px 5px 0 #111; transform-origin: center; }
.ovo-cap span.p.in { transform: rotate(-3deg); }
.ovo-side.R .ovo-cap span.p { background: #4da3ff; }
.ovo-stagearea { position: absolute; left: 0; right: 0; top: 230px; height: 520px; }
.ovo-flip { position: absolute; left: 50%; bottom: 40px; width: 0; height: 0; }
.ovo-limbs { position: absolute; inset: 0; pointer-events: none; }
.ovo-side.R .ovo-limbs { transform: scaleX(-1); } /* only the pose faces left; the photo/sticker never mirrors (text stays readable) */
.ovo-bob { position: absolute; left: 0; bottom: 0; will-change: transform; transform-origin: 50% 100%; }
.ovo-body { position: absolute; }
.ovo-body svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ovo-body .ol { fill: #fff; stroke: #fff; stroke-width: 26; stroke-linejoin: round; filter: drop-shadow(8px 10px 0 #111); }
.ovo-body .bd { filter: drop-shadow(8px 10px 0 #111); }
.ovo-limb { position: absolute; width: 16px; margin-left: -8px; background: #111; border-radius: 9px; transform-origin: 50% 0; will-change: transform; }
.ovo-limb::after { content: ""; position: absolute; left: 50%; bottom: -16px; width: 38px; height: 38px; margin-left: -19px; background: #fff; border: 6px solid #111; border-radius: 50%; }
.ovo-limb.leg::after { width: 56px; height: 26px; margin-left: -12px; bottom: -14px; background: #111; border-radius: 26px 26px 10px 10px; border: 0; }
.ovo-eye { position: absolute; background: #fff; border: 5px solid #111; border-radius: 50%; overflow: hidden; }
.ovo-eye b { position: absolute; left: 50%; top: 50%; width: 46%; height: 46%; margin: -23% 0 0 -23%; background: #111; border-radius: 50%; will-change: transform; }

.ovo-eye.blink { transform: scaleY(.12); }
.ovo-mouth { position: absolute; background: #2a0b0b; border: 5px solid #111; border-radius: 45% 45% 50% 50% / 30% 30% 70% 70%; overflow: hidden; transform-origin: 50% 0; will-change: transform; }
.ovo-mouth::after { content: ""; position: absolute; left: 22%; right: 22%; bottom: -30%; height: 60%; background: #e2445c; border-radius: 50%; }
.ovo-name { position: absolute; left: 50%; top: 770px; transform: translateX(-50%) rotate(-1.5deg); min-width: 420px; max-width: 820px; background: #ece6d6; border: 6px solid #111; box-shadow: 10px 10px 0 #111; padding: 8px 22px 10px; text-align: center; }
.ovo-side.R .ovo-name { transform: translateX(-50%) rotate(1.5deg); }
.ovo-name b { display: block; font-family: "Anton", sans-serif; font-weight: 400; font-size: 52px; line-height: 1; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ovo-name small { display: inline-block; margin-top: 6px; font-weight: 700; font-size: 20px; background: #111; color: #ffd400; padding: 1px 10px; text-transform: uppercase; }
.ovo-side.live .ovo-name { background: #ffd400; box-shadow: 12px 12px 0 #ff4f9a; }
.ovo-hype { position: absolute; left: 50%; top: 905px; transform: translateX(-50%); width: 420px; height: 26px; border: 4px solid #111; background: #fff; }
.ovo-hype i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: repeating-linear-gradient(-45deg,#ff4f9a 0 12px,#ffd400 12px 24px); transition: width .3s cubic-bezier(.2,.8,.2,1); }
.ovo-hype span { position: absolute; left: -96px; top: -4px; font: 700 18px "Space Mono", monospace; }
.ovo-burst { position: absolute; left: 0; right: 0; top: 230px; height: 600px; pointer-events: none; }
.ovo-burst em { position: absolute; bottom: 0; font: 400 46px "Anton", sans-serif; font-style: normal; color: #111; background: #ffd400; border: 4px solid #111; padding: 0 10px; animation: ovoUp 1.6s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes ovoUp { 0% { transform: translateY(0) scale(.5); opacity: 0; } 15% { opacity: 1; transform: translateY(-60px) scale(1.1); } 100% { transform: translateY(-520px) scale(.9) rotate(var(--r)); opacity: 0; } }
.ovo-wake { position: absolute; left: 130px; right: 130px; top: 200px; height: 560px; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px; border: 6px dashed #111; background: #fff8; }
.ovo-side.waiting .ovo-wake, .ovo-side.waking .ovo-wake { display: flex; }
.ovo-wake h3 { margin: 0; font-family: "Anton", sans-serif; font-weight: 400; font-size: 84px; line-height: .95; text-transform: uppercase; text-align: center; }
.ovo-wake p { margin: 0; font-weight: 700; font-size: 24px; text-transform: uppercase; background: #111; color: #ffd400; padding: 2px 12px; }
.ovo-wake img { width: 300px; height: 300px; object-fit: cover; border: 6px solid #111; box-shadow: 10px 10px 0 #111; transform: rotate(-3deg); animation: ovoWob 1.2s ease-in-out infinite alternate; }
.ovo-wake img[src=""], .ovo-wake img:not([src]) { display: none; }
@keyframes ovoWob { from { transform: rotate(-4deg) scale(.98); } to { transform: rotate(3deg) scale(1.02); } }
.ovo-side.waiting .ovo-stagearea, .ovo-side.waking .ovo-stagearea, .ovo-side.waiting .ovo-name, .ovo-side.waking .ovo-name, .ovo-side.waiting .ovo-hype, .ovo-side.waking .ovo-hype { visibility: hidden; }
.ovo-ready { position: absolute; left: 50%; top: 168px; transform: translateX(-50%); font: 400 30px "Anton", sans-serif; text-transform: uppercase; background: #9fe8b0; border: 4px solid #111; padding: 2px 14px; white-space: nowrap; display: none; }
.ovo-side.ready .ovo-ready { display: block; }
.ovo-vs { position: absolute; left: 960px; top: 560px; transform: translate(-50%, -50%) rotate(-8deg); font-family: "Rubik Mono One", monospace; font-size: 76px; background: #ffd400; border: 7px solid #111; box-shadow: 10px 10px 0 #111; padding: 6px 22px; }
.ovo-status { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); font: 700 26px "Space Mono", monospace; text-transform: uppercase; background: #111; color: #ece6d6; padding: 6px 18px; white-space: nowrap; }
.ovo-status:empty { display: none; }
.ovo-banner { position: absolute; left: 50%; top: 470px; transform: translate(-50%, -50%) scale(.6); opacity: 0; z-index: 3; font-family: "Anton", sans-serif; font-size: 86px; line-height: 1; text-transform: uppercase; background: #ff4f9a; border: 7px solid #111; box-shadow: 14px 14px 0 #111; padding: 14px 34px; text-align: center; transition: opacity .25s, transform .35s cubic-bezier(.2,1.4,.4,1); pointer-events: none; white-space: nowrap; }
.ovo-banner small { display: block; font: 700 26px "Space Mono", monospace; margin-top: 8px; }
.ovo-banner.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.ovo-verdict { position: absolute; left: 50%; top: 150px; width: 1500px; transform: translateX(-50%) translateY(40px); opacity: 0; z-index: 4; display: none; flex-direction: column; align-items: center; gap: 20px; transition: opacity .45s, transform .45s cubic-bezier(.2,.8,.2,1); }
.ovo-verdict.on { display: flex; } .ovo-verdict.in { opacity: 1; transform: translateX(-50%) translateY(0); }
.ovo-win { font-family: "Anton", sans-serif; font-size: 96px; line-height: 1; text-transform: uppercase; background: #ffd400; border: 8px solid #111; box-shadow: 16px 16px 0 #111; padding: 10px 34px; transform: rotate(-2deg); text-align: center; max-width: 1500px; }
.ovo-win small { display: block; font-size: 40px; margin-top: 6px; }
.ovo-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; width: 100%; }
.ovo-card { background: #ece6d6; border: 6px solid #111; box-shadow: 10px 10px 0 #111; padding: 12px 18px; min-width: 0; }
.ovo-card.ow { background: #fff; box-shadow: 10px 10px 0 #ff4f9a; }
.ovo-card h4 { margin: 0; display: flex; justify-content: space-between; gap: 10px; align-items: baseline; font-family: "Anton", sans-serif; font-weight: 400; font-size: 40px; text-transform: uppercase; line-height: 1; }
.ovo-card h4 span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ovo-card h4 b { font-weight: 400; font-size: 64px; }
.ovo-card ul { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 16px; }
.ovo-card li b { text-transform: uppercase; }
.ovo-card p { margin: 8px 0 0; font-size: 17px; font-weight: 700; }
.ovo-roast { max-width: 1400px; font: 700 30px "Space Mono", monospace; background: #111; color: #ffd400; padding: 10px 20px; text-align: center; }
.ovo-again { font: 700 16px "Space Mono", monospace; text-transform: uppercase; color: #555; }
.ovo.ovo-done .ovo-cap, .ovo.ovo-done .ovo-name, .ovo.ovo-done .ovo-hype, .ovo.ovo-done .ovo-vs { visibility: hidden; }
.ovo.ovo-done .ovo-stagearea { top: 440px; }
.ovo.ovo-done .ovo-flip { transform: scale(.6); transform-origin: 0 0; }
.ovo.ovo-done .ovo-side.L .ovo-stagearea { left: -300px; } .ovo.ovo-done .ovo-side.R .ovo-stagearea { left: 300px; }
`;
document.head.appendChild(css);

// ---------- DOM ----------
const root = document.createElement("div");
root.className = "ovo";
const sideHtml = (i) => `<div class="ovo-side ${i ? "R" : "L"} waiting" data-side="${i}">
  <div class="ovo-cap"></div>
  <div class="ovo-stagearea"><div class="ovo-flip"><div class="ovo-bob"></div></div></div>
  <div class="ovo-burst"></div>
  <div class="ovo-wake"><img alt=""><h3>Snap object ${i + 1}</h3><p></p></div>
  <div class="ovo-ready">Object ${i + 1} ready &#10003;</div>
  <div class="ovo-name"><b></b><small></small></div>
  <div class="ovo-hype"><span>HYPE</span><i></i></div>
</div>`;
root.innerHTML = `<div class="ovo-top"><span class="ovo-tag">OBJECT vs OBJECT</span><div class="ovo-title"></div><span class="ovo-round"></span></div>
  ${sideHtml(0)}${sideHtml(1)}<div class="ovo-vs">VS</div><div class="ovo-banner"></div><div class="ovo-verdict"></div><div class="ovo-status"></div>`;
document.body.appendChild(root);
const q = (s, r = root) => r.querySelector(s);
const sideEl = [0, 1].map((i) => q(`.ovo-side[data-side="${i}"]`));
const titleEl = q(".ovo-title"), roundEl = q(".ovo-round"), bannerEl = q(".ovo-banner"), verdictEl = q(".ovo-verdict"), statusEl = q(".ovo-status");

// ---------- audio (own context; one analyser per side drives that side's mouth) ----------
let ctx = null;
const an = [null, null], buf = [null, null], fake = [0, 0];
function audio() {
  if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); for (const i of [0, 1]) { an[i] = ctx.createAnalyser(); an[i].fftSize = 1024; an[i].connect(ctx.destination); buf[i] = new Uint8Array(1024); } }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}
function level(i) {
  if (fake[i] > 0) { const t = performance.now() / 1000; return 0.3 + 0.5 * Math.abs(Math.sin(t * (10 + i * 1.7))) * (0.55 + 0.45 * Math.sin(t * 3.3)); }
  if (!an[i]) return 0;
  an[i].getByteTimeDomainData(buf[i]);
  let s = 0; for (let k = 0; k < buf[i].length; k++) { const v = (buf[i][k] - 128) / 128; s += v * v; }
  return Math.min(1, Math.sqrt(s / buf[i].length) * 4.5);
}
const playing = new Set();
let runId = 0;
/** Play one side's MP3, beat-locked (starts on the next bar, nudged to whole bars). onTime(frac) drives captions. */
function playMp3(i, url, onTime) {
  return new Promise((resolve) => {
    audio();
    const a = new Audio(); a.src = url; a.preload = "auto"; a.crossOrigin = "anonymous";
    let done = false, timer;
    const src = ctx.createMediaElementSource(a); src.connect(an[i]);
    const fin = () => { if (done) return; done = true; clearTimeout(timer); clearInterval(tick); playing.delete(a); try { src.disconnect(); } catch {} onTime?.(1); resolve(); };
    const tick = setInterval(() => { if (a.duration && isFinite(a.duration)) onTime?.(a.currentTime / a.duration); }, 50);
    a.addEventListener("loadedmetadata", () => {
      let wait = 0; const bpm = B.bpm();
      if (bpm && isFinite(a.duration)) { const bar = 240 / bpm, bars = Math.max(1, Math.round(a.duration / bar)); a.preservesPitch = true; a.playbackRate = Math.max(0.94, Math.min(1.06, a.duration / (bars * bar))); wait = B.nextBar(); }
      clearTimeout(timer); timer = setTimeout(fin, (a.duration * 1000) / (a.playbackRate || 1) + wait + 2000);
      setTimeout(() => { if (!done) a.play().catch(fin); }, wait);
    });
    a.addEventListener("ended", fin); a.addEventListener("error", fin);
    timer = setTimeout(fin, 30000);
    playing.add(a);
  });
}
/** Free voice (MOCK / demo / missing audio): browser speech, a different pitch per side, fake mouth. */
function speakFree(i, text, onTime) {
  return new Promise((resolve) => {
    const est = Math.max(2500, text.length * 62);
    const t0 = performance.now();
    let done = false;
    fake[i]++;
    const tick = setInterval(() => onTime?.(Math.min(1, (performance.now() - t0) / est)), 50);
    const end = () => { if (done) return; done = true; clearInterval(tick); fake[i] = Math.max(0, fake[i] - 1); onTime?.(1); resolve(); };
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/\[[^\]]*\]/g, ""));
      const gb = speechSynthesis.getVoices().filter((v) => /en-GB/i.test(v.lang));
      if (gb.length) u.voice = gb[(i * 3) % gb.length];
      u.rate = 1.1; u.pitch = i ? 1.35 : 0.75; u.volume = 1;
      u.onend = end; u.onerror = () => setTimeout(end, est);
      speechSynthesis.speak(u);
    } catch { setTimeout(end, est); }
    setTimeout(end, est + 4000);
  });
}
function stopAll() { for (const a of playing) { try { a.pause(); } catch {} } playing.clear(); try { speechSynthesis.cancel(); } catch {} fake[0] = fake[1] = 0; }

// ---------- captions (one chunk at a time, on the speaker's side) ----------
function captions(i, text) {
  const capEl = q(".ovo-cap", sideEl[i]);
  sideEl[1 - i].querySelector(".ovo-cap").innerHTML = "";
  const ws = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let acc = 0;
  const recs = ws.map((w, k) => { const r = { w, t: acc, punch: /[,.!?]$/.test(w) || w === upper(w) && /[A-Z]{3,}/.test(w) || k === ws.length - 1 }; acc += w.replace(/[^a-z0-9]/gi, "").length + 2.4 + (/[,.!?]$/.test(w) ? 3 : 0); return r; });
  recs.forEach((r) => { r.t /= acc || 1; });
  const chunks = []; let c = [];
  recs.forEach((r) => { c.push(r); if (c.length >= 6 || (c.length >= 3 && /[,.!?]$/.test(r.w))) { chunks.push(c); c = []; } });
  if (c.length) chunks.push(c);
  let shown = -1;
  return (frac) => {
    const lead = Math.min(1, frac + 0.03);
    const ci = Math.max(0, chunks.findIndex((ch, k) => k === chunks.length - 1 || chunks[k + 1][0].t > lead));
    if (ci !== shown) { shown = ci; capEl.innerHTML = chunks[ci].map((r) => `<span class="${r.punch ? "p" : ""}">${esc(r.w.replace(/[,]$/, ""))}</span>`).join(""); }
    chunks[ci].forEach((r, k) => { if (r.t <= lead) capEl.children[k]?.classList.add("in"); });
  };
}

// ---------- character rigs ----------
const DEFAULT_FACE = { leftEye: { x: 0.38, y: 0.38 }, rightEye: { x: 0.62, y: 0.38 }, eyeSize: 0.14, mouth: { x: 0.5, y: 0.62, width: 0.28 } };
const okPt = (p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y);
const rigs = [null, null];
let pose = ["idle", "idle"], live = -1;
function loadImg(src) { return new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
// Real segmentation cut-out (segment.js / MediaPipe), same as the main stage. Cached per photo; null = use the fallback shape.
let segMod = null;
const loadSeg = () => (segMod ||= import("./segment.js").then((m) => { m.preloadSegmenter?.(); return m; }).catch((e) => { console.warn("[ovo] segment.js", e); return null; }));
const cutCache = new Map();
function getCut(x, im) {
  const key = x.photo;
  if (!cutCache.has(key)) {
    const bb = x.bbox && x.bbox.w > 0.05 && x.bbox.h > 0.05 ? x.bbox : null;
    const hint = bb ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : { x: 0.5, y: 0.5 };
    const p = loadSeg().then((m) => (m && im ? m.cutout(im, hint) : null)).then((r) => {
      if (!r) return null;
      return { bbox: r.bbox, face: r.face, mask: r.maskCanvas.toDataURL("image/png"), border: r.borderCanvas.toDataURL("image/png") };
    }).catch(() => null);
    p.then((r) => { p.done = true; p.val = r; if (!r) setTimeout(() => cutCache.get(key) === p && cutCache.delete(key), 20000); }); // retry later if it failed
    cutCache.set(key, p);
  }
  return cutCache.get(key);
}
const rigTok = [0, 0];
async function buildRig(i, x) {
  const tok = ++rigTok[i];
  const im = await loadImg(x.photo);
  if (tok !== rigTok[i]) return;
  const cp = getCut(x, im);
  // Give a warm segmenter a moment so the first render is already cut out; otherwise draw the fallback and swap in later
  await Promise.race([cp, sleep(cp.done ? 0 : 700)]);
  if (tok !== rigTok[i]) return;
  drawRig(i, x, im, cp.done ? cp.val : null);
  if (!cp.done) cp.then((cut) => { if (cut && tok === rigTok[i] && rigs[i]) drawRig(i, x, im, cut); });
}
function drawRig(i, x, im, cut) {
  const host = q(".ovo-bob", sideEl[i]);
  host.innerHTML = "";
  const ar = im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : 1;
  const IW = 1000, IH = 1000 / ar;
  const bb = cut ? cut.bbox : x.bbox && x.bbox.w > 0.05 && x.bbox.h > 0.05 ? x.bbox : { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };
  const pad = Math.max(bb.w * IW, bb.h * IH) * 0.06;
  const vb = [bb.x * IW - pad, bb.y * IH - pad, bb.w * IW + pad * 2, bb.h * IH + pad * 2];
  const k = Math.min(430 / vb[2], 400 / vb[3]);
  const W = vb[2] * k, Hh = vb[3] * k;
  const P = (p) => ({ x: (p.x * IW - vb[0]) * k, y: (p.y * IH - vb[1]) * k });
  const f = cut ? cut.face : x.face && okPt(x.face.leftEye) && okPt(x.face.rightEye) && okPt(x.face.mouth) ? x.face : { leftEye: { x: bb.x + bb.w * 0.36, y: bb.y + bb.h * 0.38 }, rightEye: { x: bb.x + bb.w * 0.64, y: bb.y + bb.h * 0.38 }, eyeSize: bb.w * 0.2, mouth: { x: bb.x + bb.w / 2, y: bb.y + bb.h * 0.62, width: bb.w * 0.36 } };
  const id = `ovoCut${i}_${Date.now()}`;
  const legH = 70;
  const body = document.createElement("div");
  body.className = "ovo-body";
  Object.assign(body.style, { left: `${-W / 2}px`, top: `${-Hh - legH}px`, width: `${W}px`, height: `${Hh}px` });
  const imgAttrs = `x="0" y="0" width="${IW}" height="${IH.toFixed(1)}" preserveAspectRatio="none"`;
  let art;
  if (cut) {
    art = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="20000" height="20000"><image href="${cut.mask}" ${imgAttrs}/></mask></defs>
    <image class="bd" href="${cut.border}" ${imgAttrs}/><image href="${esc(x.photo)}" ${imgAttrs} mask="url(#${id})"/>`;
  } else {
    let pts = Array.isArray(x.outline) ? x.outline.filter(okPt) : [];
    if (pts.length < 3) pts = Array.from({ length: 28 }, (_, n) => { const a = (n / 28) * Math.PI * 2; return { x: bb.x + bb.w / 2 + Math.cos(a) * bb.w / 2, y: bb.y + bb.h / 2 + Math.sin(a) * bb.h / 2 }; });
    const poly = pts.map((p) => `${(p.x * IW).toFixed(1)},${(p.y * IH).toFixed(1)}`).join(" ");
    art = `<defs><clipPath id="${id}"><polygon points="${poly}"/></clipPath></defs>
    <polygon class="ol" points="${poly}" style="stroke-width:${(14 / k).toFixed(1)}"/><image href="${esc(x.photo)}" ${imgAttrs} clip-path="url(#${id})"/>`;
  }
  body.innerHTML = `<svg viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${art}</svg>`;
  const eyeD = Math.max(40, Math.min(96, (+f.eyeSize || 0.14) * IW * k));
  const eyes = [f.leftEye, f.rightEye].map((e) => { const p = P(e); const d = document.createElement("div"); d.className = "ovo-eye"; Object.assign(d.style, { left: `${p.x - eyeD / 2}px`, top: `${p.y - eyeD / 2}px`, width: `${eyeD}px`, height: `${eyeD}px` }); d.innerHTML = "<b></b>"; body.appendChild(d); return d; });
  const mp = P(f.mouth), mw = Math.max(50, Math.min(150, (+f.mouth.width || 0.28) * IW * k));
  const mouth = document.createElement("div"); mouth.className = "ovo-mouth";
  Object.assign(mouth.style, { left: `${mp.x - mw / 2}px`, top: `${mp.y - 8}px`, width: `${mw}px`, height: `${Math.max(36, mw * 0.55)}px` });
  body.appendChild(mouth);
  // Limbs live in their own layers (legs behind, arms in front); on the right side only these layers mirror
  const limb = (cls, lx, ly, len) => { const d = document.createElement("div"); d.className = `ovo-limb ${cls}`; Object.assign(d.style, { left: `${lx}px`, top: `${ly}px`, height: `${len}px` }); return d; };
  const bx0 = P({ x: bb.x, y: 0 }).x, bx1 = P({ x: bb.x + bb.w, y: 0 }).x, byB = P({ x: 0, y: bb.y + bb.h }).y, bw = bx1 - bx0;
  const armY = P({ x: 0, y: bb.y + bb.h * 0.55 }).y, armL = limb("arm", bx0 + 6, armY, 120), armR = limb("arm", bx1 - 6, armY, 120);
  const legL = limb("leg", bx0 + bw * 0.36, byB - 6, legH + 8 + (Hh - byB)), legR = limb("leg", bx0 + bw * 0.64, byB - 6, legH + 8 + (Hh - byB));
  const back = document.createElement("div"), front = document.createElement("div");
  back.className = front.className = "ovo-limbs";
  back.append(legL, legR); front.append(armL, armR);
  body.prepend(back); body.appendChild(front);
  host.appendChild(body);
  rigs[i] = { host, body, eyes, pupils: eyes.map((e) => e.querySelector("b")), mouth, armL, armR, legL, legR, eyeD, look: { x: 0, y: 0 }, nextLook: 0, nextBlink: performance.now() + 1500 + Math.random() * 2500 };
}
function frame(t) {
  const pulse = B.pulse();
  for (const i of [0, 1]) {
    const r = rigs[i]; if (!r) continue;
    const lv = level(i), talking = lv > 0.06, ps = pose[i], s = t / 1000;
    let y = -pulse * 14 - (talking ? lv * 10 : 0), rot = Math.sin(s * 1.3 + i) * 2, sc = live === i ? 1.06 : live >= 0 ? 0.94 : 1;
    let aL = 18 + Math.sin(s * 2 + i) * 6, aR = -18 - Math.sin(s * 2.2 + i) * 6, lL = 4, lR = -4;
    if (talking) { aL = 40 + lv * 70 + Math.sin(s * 9) * 18; aR = -60 - lv * 60 + Math.sin(s * 7) * 22; rot += Math.sin(s * 6) * lv * 6; }
    if (ps === "celebrate") { y = -40 - Math.abs(Math.sin(s * 6)) * 60; aL = 150 + Math.sin(s * 12) * 15; aR = -150 - Math.sin(s * 12) * 15; lL = 20; lR = -20; rot = Math.sin(s * 6) * 8; sc = 1.1; }
    if (ps === "facepalm") { y = 10; rot = -10; aL = 10; aR = -165; sc = 0.9; }
    if (ps === "listen") { rot = -4; aL = 12; aR = -30; }
    r.host.style.transform = `translate3d(0,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc})`;
    r.armL.style.transform = `rotate(${aL.toFixed(1)}deg)`; r.armR.style.transform = `rotate(${aR.toFixed(1)}deg)`;
    r.legL.style.transform = `rotate(${(lL + pulse * 8).toFixed(1)}deg)`; r.legR.style.transform = `rotate(${(lR - pulse * 8).toFixed(1)}deg)`;
    r.mouth.style.transform = `scale(${(0.9 + lv * 0.25).toFixed(3)}, ${(ps === "facepalm" ? 0.15 : talking ? 0.25 + lv * 1.1 : 0.22).toFixed(3)})`;
    if (t > r.nextLook) { r.look = { x: (Math.random() - 0.3) * 0.5, y: (Math.random() - 0.5) * 0.4 }; if (live === 1 - i || live < 0 && Math.random() < 0.6) r.look = { x: 0.55, y: -0.05 }; r.nextLook = t + 600 + Math.random() * 1600; }
    const jig = pulse * 0.12;
    const dir = i ? -1 : 1; // eyes dart toward the opponent (right object faces left without mirroring the photo)
    r.pupils.forEach((p) => { p.style.transform = `translate(${(dir * r.look.x * r.eyeD * 0.28).toFixed(1)}px, ${((r.look.y + jig) * r.eyeD * 0.28).toFixed(1)}px)`; });
    if (t > r.nextBlink) { r.blinkUntil = t + 130; r.nextBlink = t + 2200 + Math.random() * 3000; }
    const shut = t < (r.blinkUntil || 0) || ps === "facepalm";
    if (shut !== !!r.shut) { r.shut = shut; r.eyes.forEach((e) => e.classList.toggle("blink", shut)); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- UI helpers ----------
let session = null;
function open() { root.classList.add("on"); root.classList.remove("ovo-done"); }
function close() {
  runId++; stopAll(); B.stop(); session = null; live = -1; pose = ["idle", "idle"];
  root.classList.remove("on", "ovo-done"); verdictEl.classList.remove("on", "in"); banner("");
  sideEl.forEach((el, i) => { el.className = `ovo-side ${i ? "R" : "L"} waiting`; q(".ovo-cap", el).innerHTML = ""; q(".ovo-bob", el).innerHTML = ""; q(".ovo-wake img", el).removeAttribute("src"); q(".ovo-burst", el).innerHTML = ""; rigs[i] = null; rigTok[i]++; });
  titleEl.textContent = ""; roundEl.textContent = ""; statusEl.textContent = "";
}
function banner(html, ms) { clearTimeout(banner.t); if (!html) { bannerEl.classList.remove("on"); return; } bannerEl.innerHTML = html; bannerEl.classList.add("on"); if (ms) banner.t = setTimeout(() => bannerEl.classList.remove("on"), ms); }
function setSide(i, x, state) {
  const el = sideEl[i];
  el.className = `ovo-side ${i ? "R" : "L"} ${state}`;
  if (x?.photo) q(".ovo-wake img", el).src = x.photo;
  q(".ovo-wake h3", el).textContent = state === "waking" ? "Waking up…" : `Snap object ${i + 1}`;
  q(".ovo-wake p", el).textContent = state === "waking" ? `object ${i + 1}${x?.trainerName ? " · " + x.trainerName : ""}` : x?.trainerName ? `${x.trainerName}, snap it!` : "any phone, snap it!";
  if (x?.character) { q(".ovo-name b", el).textContent = x.character.name; q(".ovo-name small", el).textContent = sideTag(x); }
}
function waitingStatus() {
  if (!session) return;
  const st = session.sides.map((x) => x.status);
  statusEl.textContent = st.map((s, i) => `Object ${i + 1} ${s === "ready" ? "ready ✓" : s === "waking" ? "waking…" : "—"}`).join(" · ") + (st.every((s) => s === "ready") ? " · Writing the bars…" : st.some((s) => s === "waiting") ? ` · Waiting for object ${st.indexOf("waiting") + 1}…` : "");
}
function setHype(h) { const tot = Math.max(10, h[0] + h[1]); sideEl.forEach((el, i) => { q(".ovo-hype i", el).style.width = `${Math.min(100, (h[i] / tot) * 100)}%`; q(".ovo-hype span", el).textContent = `HYPE ${h[i]}`; }); }
const HYPE_WORDS = ["HYPE!", "🔥", "GET IN!", "COME ON!", "MINT!", "🔥🔥"];
function burst(i, word) {
  const host = q(".ovo-burst", sideEl[i]);
  const e = document.createElement("em");
  e.textContent = word || HYPE_WORDS[(Math.random() * HYPE_WORDS.length) | 0];
  e.style.left = `${120 + Math.random() * 640}px`; e.style.setProperty("--r", `${(Math.random() - 0.5) * 30}deg`);
  host.appendChild(e); setTimeout(() => e.remove(), 1700);
  if (host.children.length > 14) host.firstChild.remove();
}

// ---------- the show ----------
async function say(i, line, mock) {
  live = i; pose = i ? ["listen", "idle"] : ["idle", "listen"];
  sideEl.forEach((el, k) => el.classList.toggle("live", k === i));
  const cap = captions(i, line.text);
  if (mock || !line.audio || line.ttsFailed) await speakFree(i, line.text, cap);
  else await playMp3(i, line.audio, cap);
  live = -1; pose = ["idle", "idle"];
  sideEl.forEach((el) => el.classList.remove("live"));
}
async function getVerse(s, n) {
  if (s.demo) return { n, side: (n - 1) % 2, text: DEMO_VERSES[(n - 1) % DEMO_VERSES.length] };
  for (let tries = 0; tries < 2; tries++) { try { return await post("/api/ovo/verse", { id: s.id, n }); } catch (e) { console.warn("[ovo] verse", e.message); } }
  return { n, side: (n - 1) % 2, text: "[scoffs] I've got nowt to say to you, and that's still better than your bars.", ttsFailed: true };
}
async function battle(s) {
  const my = ++runId;
  const alive = () => my === runId;
  session = s; open(); root.classList.remove("ovo-done"); verdictEl.classList.remove("on", "in");
  const [A, Bs] = s.sides;
  titleEl.innerHTML = `${esc(sideTag(A))}<i>VS</i>${esc(sideTag(Bs))}`;
  statusEl.textContent = "";
  for (const i of [0, 1]) { setSide(i, s.sides[i], ""); await buildRig(i, s.sides[i]); }
  setHype(s.hype || [0, 0]);
  if (!s.demo) audio();
  await B.start({ genre: "hip hop", bpm: 92 });
  banner(`${esc(upper(A.character.name))} <span style="color:#fff">vs</span> ${esc(upper(Bs.character.name))}<small>${s.rounds} round${s.rounds > 1 ? "s" : ""} · vote on your phones</small>`, 2600);
  B.sfx("airhorn");
  await sleep(2800); if (!alive()) return;
  roundEl.textContent = "INTRO";
  for (const l of s.intro || []) { await say(l.side, l, s.mock || s.demo); if (!alive()) return; await sleep(250); }
  const total = s.rounds * 2;
  let next = getVerse(s, 1);
  for (let n = 1; n <= total; n++) {
    const r = Math.ceil(n / 2);
    roundEl.textContent = `ROUND ${r}/${s.rounds}`;
    let v = null;
    const ready = next.then((x) => (v = x));
    await Promise.race([ready, sleep(350)]);
    if (!v) { banner(`Cooking…<small>${esc(s.sides[(n - 1) % 2].character.name)} is writing bars</small>`); pose[(n - 1) % 2] = "listen"; await ready; banner(""); }
    if (!alive()) return;
    if (n < total) next = getVerse(s, n + 1); // pipeline: N+1 cooks while N plays (server already chains it)
    await say(v.side ?? (n - 1) % 2, v, s.mock || s.demo);
    if (!alive()) return;
    if (n % 2 === 0) {
      if (!s.demo) post("/api/broadcast", { type: "ovo-vote", id: s.id, round: r }).catch(() => {});
      B.sfx(Math.random() < 0.5 ? "ooooh" : "cheer");
      banner(`Round ${r}: who won?<small>Vote on your phones · ${esc(A.character.name)} or ${esc(Bs.character.name)}</small>`);
      await sleep(n === total ? 3000 : 5000); banner("");
    } else await sleep(400);
    if (!alive()) return;
  }
  banner("Judging…<small>70% crowd · 30% AI judge</small>");
  B.sfx("drumroll"); B.duck(true);
  let v;
  if (s.demo) { await sleep(2500); v = demoVerdict(s); }
  else { try { v = await post("/api/ovo/judge", { id: s.id, waitVotesMs: 3500 }); } catch (e) { banner(`Judge failed<small>${esc(e.message)}</small>`, 4000); return; } }
  if (!alive()) return;
  banner("");
  showVerdict(s, v);
}
function showVerdict(s, v) {
  root.classList.add("ovo-done");
  const w = v.winner, win = s.sides[w];
  const card = (x) => `<div class="ovo-card${x.winner ? " ow" : ""}"><h4><span>${esc(x.name)}</span><b>${Math.round(x.score)}</b></h4>
    <ul><li><b>Crowd</b> ${x.crowd.votes} vote${x.crowd.votes === 1 ? "" : "s"} (${x.crowd.pct}%) · <b>AI judge</b> ${x.ai}/100 · <b>Hype</b> ${x.hype}</li>
    ${Object.entries(x.categories || {}).map(([k, n]) => `<li><b>${esc(k)} ${Math.round(n)}/10</b>${x.reasons?.[k] ? ` — ${esc(x.reasons[k])}` : ""}</li>`).join("")}</ul>
    ${x.why ? `<p>${esc(x.why)}</p>` : ""}${x.best ? `<p style="font-weight:400">Best bar: "${esc(x.best)}"</p>` : ""}</div>`;
  verdictEl.innerHTML = `<div class="ovo-win">Winner: ${esc(v.winnerName)}<small>(${esc(sideTag(win))})</small></div>
    <div class="ovo-cards">${card(v.sides[0])}${card(v.sides[1])}</div><div class="ovo-roast"></div><div class="ovo-again">Space = again · Esc = back</div>`;
  verdictEl.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => verdictEl.classList.add("in")));
  pose[w] = "celebrate"; pose[1 - w] = "facepalm";
  B.sfx("cheer"); setTimeout(() => B.sfx("boo"), 900);
  for (let k = 0; k < 8; k++) setTimeout(() => burst(w, k % 2 ? "WINNER!" : "🏆"), k * 180);
  setTimeout(async () => {
    if (session !== s) return;
    const roastEl = q(".ovo-roast", verdictEl);
    roastEl.textContent = `${win.character.name}: "${v.roast}"`;
    const keep = pose.slice();
    const cap = captions(w, v.roast);
    live = w;
    if (s.mock || s.demo || !v.audio) await speakFree(w, v.roast, cap); else await playMp3(w, v.audio, cap);
    live = -1; pose = keep; B.duck(false);
  }, 2200);
}

// ---------- events ----------
const es = new EventSource("/api/events");
es.onmessage = (m) => {
  let ev; try { ev = JSON.parse(m.data); } catch { return; }
  switch (ev.type) {
    case "ovo-photo":
      if (!session || session.id !== ev.id) { close(); session = { id: ev.id, sides: [{ status: "waiting" }, { status: "waiting" }] }; open(); titleEl.innerHTML = `Object 1 <i>VS</i> Object 2`; }
      session.sides[ev.slot] = { ...session.sides[ev.slot], status: "waking", photo: ev.photo, trainerName: ev.trainerName };
      setSide(ev.slot, session.sides[ev.slot], "waking");
      { const o = 1 - ev.slot; if (session.sides[o].status === "waiting") setSide(o, session.sides[o], "waiting"); }
      waitingStatus();
      break;
    case "ovo-slot-ready":
      if (!session || session.id !== ev.id || session.started) break;
      session.sides[ev.slot] = { ...ev.side, status: "ready" };
      setSide(ev.slot, ev.side, "ready");
      buildRig(ev.slot, ev.side);
      waitingStatus();
      break;
    case "ovo-slot-failed":
      if (!session || session.id !== ev.id) break;
      session.sides[ev.slot] = { status: "waiting", trainerName: session.sides[ev.slot].trainerName };
      setSide(ev.slot, session.sides[ev.slot], "waiting");
      statusEl.textContent = `Couldn't wake object ${ev.slot + 1} — snap it again`;
      break;
    case "ovo-ready":
      if (session?.started && session.id === ev.session.id) break;
      session = { ...ev.session, started: true };
      battle(session);
      break;
    case "ovo-hype":
      if (session && ev.id === session.id) { session.hype = ev.hype; setHype(ev.hype); burst(ev.side); }
      break;
    case "reset":
      if (root.classList.contains("on") && !session?.demo) close();
      break;
  }
};
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const on = root.classList.contains("on");
  if (on && (e.code === "Space" || e.key === "Escape")) {
    e.preventDefault(); e.stopImmediatePropagation();
    const demo = session?.demo;
    close();
    if (!demo) post("/api/broadcast", { type: "reset", reason: "ovo-stage" }).catch(() => {});
  } else if ((e.key === "o" || e.key === "O") && !on && document.body.dataset.screen === "idle" && !document.body.classList.contains("solo")) {
    try { document.getElementById("gate")?.classList.contains("hide") || document.getElementById("gateBtn")?.click(); } catch {}
    battle(demoSession());
  }
}, true);

// ---------- offline demo (key O): two placeholder objects, browser voices, canned bars ----------
const svgUrl = (s) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
const MUG = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><defs><radialGradient id='g' cx='.35' cy='.3'><stop offset='0' stop-color='#ffd2a8'/><stop offset='1' stop-color='#c2551f'/></radialGradient></defs><rect width='400' height='400' fill='#3a1a10'/><rect x='95' y='110' width='190' height='210' rx='26' fill='url(#g)'/><path d='M285 160 q70 0 70 60 t-70 60' stroke='#c2551f' stroke-width='26' fill='none'/><ellipse cx='190' cy='118' rx='95' ry='18' fill='#5a2a14'/></svg>`);
const LANYARD = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='#14243a'/><path d='M120 20 L190 230 M280 20 L210 230' stroke='#4da3ff' stroke-width='26' stroke-linecap='round'/><rect x='130' y='220' width='140' height='160' rx='14' fill='#f4f4f4' stroke='#222' stroke-width='6'/><rect x='150' y='245' width='100' height='60' fill='#ffd400'/><rect x='150' y='320' width='100' height='12' fill='#888'/><rect x='150' y='342' width='70' height='12' fill='#888'/></svg>`);
const DEMO_VERSES = [
  "Look at this lanyard, hanging round like a noose, I'm a mug full of bars, you're a string on the loose, you open doors for a living, mate, that's not a career, I'm the hottest thing in Manc, get your badge out of HERE",
  "Hottest thing in Manc? You're a cup of cold tea, string on the loose? I hold the keys, you hold PG, your handle's chipped, your rim's stained, your owner's in denial, I'm hanging round a neck, our kid, cos I hang out in STYLE",
  "Hang out in style? You're a ribbon on a hook, they wear you to a hack day, never once took a look, I'm on every desk in the building, warm in every hand, you're a cheap bit of polyester, I'm the brew of the LAND",
  "Brew of the land? You're a souvenir from Blackpool, chipped since ninety-six, the mug that time forgot, fool, they sip from you daily and they still can't spit a bar, I'm the VIP pass, you're stuck queuing at the BAR",
];
function demoSession() {
  return {
    id: "demo_" + Date.now(), demo: true, mock: true, rounds: 2, hype: [0, 0],
    sides: [
      { slot: 0, photo: MUG, object: "coffee mug", trainerName: "Kaif", character: { name: "Mug Jagger", catchphrase: "Pour us another, our kid" }, face: { leftEye: { x: 0.37, y: 0.44 }, rightEye: { x: 0.55, y: 0.44 }, eyeSize: 0.12, mouth: { x: 0.46, y: 0.63, width: 0.2 } }, bbox: { x: 0.23, y: 0.25, w: 0.67, h: 0.56 },
        outline: [[0.24, 0.27], [0.475, 0.252], [0.71, 0.27], [0.72, 0.37], [0.82, 0.385], [0.89, 0.46], [0.89, 0.6], [0.82, 0.68], [0.72, 0.7], [0.71, 0.77], [0.68, 0.8], [0.27, 0.8], [0.24, 0.77]].map(([x, y]) => ({ x, y })) },
      { slot: 1, photo: LANYARD, object: "lanyard", trainerName: "Debs", character: { name: "Lanyard Lil", catchphrase: "Not on the list, love" }, face: { leftEye: { x: 0.42, y: 0.66 }, rightEye: { x: 0.58, y: 0.66 }, eyeSize: 0.09, mouth: { x: 0.5, y: 0.86, width: 0.16 } }, bbox: { x: 0.3, y: 0.53, w: 0.4, h: 0.44 } },
    ],
    intro: [{ side: 0, text: "Lanyard Lil? I've had teabags with more presence, love." }, { side: 1, text: "Big talk from a chipped coffee mug. Let's have it then." }],
  };
}
function demoVerdict(s) {
  const crowd = [40 + ((Math.random() * 20) | 0), 0]; crowd[1] = 100 - crowd[0];
  const ai = [72, 78];
  const sides = [0, 1].map((i) => ({ side: i, name: s.sides[i].character.name, score: Math.round(0.7 * crowd[i] + 0.3 * ai[i]), ai: ai[i], crowd: { votes: Math.round(crowd[i] / 10), pct: crowd[i] }, hype: s.hype[i], categories: { delivery: 7, rhymes: 8 + i, comebacks: 6 + i, wit: 7 }, reasons: { delivery: "AI voice - fixed for both" }, best: DEMO_VERSES[i].split(",")[0] }));
  const w = sides[1].score >= sides[0].score ? 1 : 0;
  sides[w].winner = true;
  return { winner: w, winnerName: s.sides[w].character.name, roast: w ? "Mug Jagger, go back to the cupboard, love. Not on the list!" : "Lanyard Lil, you're a shoelace with a photo. Pour us another!", sides };
}
// Debug hook (console): __ovo.verdict() shows the verdict screen with the demo objects.
window.__ovo = { verdict: async () => { const s = demoSession(); session = s; open(); for (const i of [0, 1]) { setSide(i, s.sides[i], ""); await buildRig(i, s.sides[i]); } titleEl.innerHTML = `${esc(sideTag(s.sides[0]))}<i>VS</i>${esc(sideTag(s.sides[1]))}`; showVerdict(s, demoVerdict(s)); } };
