// Duet Anything - TEST MIC overlay (phone). Big live level meter, "SAY SOMETHING... / GOT YOU!", records ~2.5 s and
// plays it back, plain fixes if silent. Passing marks the phone "MIC OK" (localStorage) and tells the stage
// ({type:'mic-check', client, player, playerName, ok}). Used by mic.html (shared stream) and play.html (own stream).
const OK_KEY = "duetMicOk";
const PASS_LEVEL = 0.08, PASS_MS = 500, REC_MS = 2500, FAIL_MS = 6000;

export const micPassed = () => { try { return Number(localStorage.getItem(OK_KEY) || 0) > Date.now() - 6 * 3600e3; } catch { return false; } };
const setPassed = (ok) => { try { ok ? localStorage.setItem(OK_KEY, String(Date.now())) : localStorage.removeItem(OK_KEY); } catch { /* private mode */ } };

/** RMS level 0-1 of an analyser (x4 so speech fills the bar). */
export function levelOf(analyser, buf) {
  analyser.getByteTimeDomainData(buf);
  let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

const CSS = `
.mt-wrap { position:fixed; inset:0; z-index:50; background:rgba(17,17,17,.82); display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; padding:16px 16px calc(24px + env(safe-area-inset-bottom)); font-family:"Space Mono","Courier New",monospace; }
.mt-card { margin:auto 0; width:min(100%, 420px); background:#ece6d6; color:#111; border:5px solid #111; box-shadow:10px 10px 0 #ff4f9a; padding:18px 16px; display:flex; flex-direction:column; gap:14px; text-align:left; }
.mt-card h2 { font:400 clamp(40px, 13vw, 56px)/.95 "Anton", Impact, sans-serif; text-transform:uppercase; margin:0; }
.mt-status { font:400 clamp(26px, 8vw, 34px)/1.05 "Anton", Impact, sans-serif; text-transform:uppercase; background:#111; color:#ffd400; padding:8px 10px; }
.mt-status.ok { background:#1f9d55; color:#fff; }
.mt-status.bad { background:#ff4f9a; color:#111; }
.mt-meter { height:44px; border:5px solid #111; background:#fff; overflow:hidden; position:relative; }
.mt-meter b { position:absolute; inset:0; background:repeating-linear-gradient(-45deg,#111 0 14px,#ffd400 14px 28px); transform-origin:left; transform:scaleX(0); transition:transform .06s linear; }
.mt-meter i { position:absolute; top:0; bottom:0; left:${PASS_LEVEL * 100}%; width:4px; background:#ff4f9a; }
.mt-fix { margin:0; padding:10px 12px 10px 28px; background:#ffd400; border:4px solid #111; font-size:15px; line-height:1.4; }
.mt-fix li + li { margin-top:6px; }
.mt-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.mt-btn { font:400 24px/1 "Anton", Impact, sans-serif; text-transform:uppercase; padding:14px 10px; border:4px solid #111; background:#ffd400; color:#111; box-shadow:5px 5px 0 #111; border-radius:0; cursor:pointer; }
.mt-btn.alt { background:#fff; }
.mt-btn:active { transform:translate(3px,3px); box-shadow:2px 2px 0 #111; }
.mt-note { font-size:13px; margin:0; }
.mt-chip { display:inline-block; font:700 12px "Space Mono", monospace; letter-spacing:.06em; text-transform:uppercase; padding:1px 7px; border:2px solid #111; margin-left:6px; vertical-align:1px; }
.mt-chip.ok { background:#1f9d55; color:#fff; }
.mt-chip.no { background:#fff; color:#111; }
.mt-test { font:700 15px "Space Mono", monospace; text-transform:uppercase; letter-spacing:.06em; background:#fff; color:#111; border:4px solid #111; box-shadow:4px 4px 0 #111; padding:10px 14px; border-radius:0; cursor:pointer; }
.mt-test:active { transform:translate(2px,2px); box-shadow:2px 2px 0 #111; }
`;
let styled = false;
function style() { if (styled) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); }

const FIXES = `<ol class="mt-fix">
  <li>Allow the mic: tap the <b>lock icon</b> by the address → <b>Permissions</b> → <b>Microphone → Allow</b>, then reload.</li>
  <li>Close other apps using the mic (calls, voice notes, camera, other browser tabs).</li>
  <li>iPhone: flick the <b>silent switch</b> off and turn the volume up. Don't cover the bottom mic.</li>
  <li>Use the <b>https://</b> link from the big screen (tap Advanced → Proceed once).</li>
</ol>`;

/** Update every [data-mic-chip] element: MIC OK (green) / MIC ? */
export function paintChips() {
  style();
  const ok = micPassed();
  document.querySelectorAll("[data-mic-chip]").forEach((el) => { el.className = `mt-chip ${ok ? "ok" : "no"}`; el.textContent = ok ? "MIC OK ✓" : "MIC ?"; });
}

let open = null;
export const micTestOpen = () => !!open;
export function closeMicTest() { open?.close(); }

/**
 * Show the test. opts: { getStream: async () => MediaStream|null (shared, not stopped), audioCtx: () => AudioContext,
 *   report: (ok) => void, auto: bool (prompted, not tapped) }.
 */
export function openMicTest(opts = {}) {
  style();
  if (open) return open;
  const wrap = document.createElement("div");
  wrap.className = "mt-wrap";
  wrap.innerHTML = `<div class="mt-card">
    <h2>Mic test</h2>
    <p class="mt-note">${opts.auto ? "Quick check before your first turn: " : ""}tap START, then say anything out loud.</p>
    <div class="mt-status" id="mtStatus">Ready?</div>
    <div class="mt-meter"><b id="mtBar"></b><i></i></div>
    <div id="mtFix"></div>
    <div class="mt-row"><button class="mt-btn" id="mtGo" type="button">Start</button><button class="mt-btn alt" id="mtDone" type="button">Close</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector("#" + id);
  let raf = 0, rec = null, own = null, nodes = [], timers = [], passed = false, running = false;
  const status = (t, cls = "") => { const el = $("mtStatus"); el.textContent = t; el.className = `mt-status ${cls}`; };
  function cleanup() {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch { /* ignore */ }
    nodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } }); nodes = [];
    if (own) { own.getTracks().forEach((t) => t.stop()); own = null; }
    running = false;
  }
  async function start() {
    if (running) return;
    cleanup(); running = true; passed = false;
    $("mtFix").innerHTML = ""; $("mtGo").textContent = "Again";
    let ctx;
    try { ctx = opts.audioCtx?.() || new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume?.(); } catch { /* no Web Audio */ }
    status("Asking for the mic…");
    let stream = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      stream = opts.getStream ? await opts.getStream() : (own = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    } catch { stream = null; }
    if (!stream) return fail(window.isSecureContext ? "Mic blocked" : "Mic needs the https link");
    status("Say something…");
    let above = 0, last = performance.now();
    if (ctx) {
      try {
        const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512;
        const sink = ctx.createGain(); sink.gain.value = 0; src.connect(an); an.connect(sink); sink.connect(ctx.destination);
        nodes = [src, an, sink];
        const buf = new Uint8Array(an.fftSize);
        const tick = (t) => {
          const lv = levelOf(an, buf);
          $("mtBar").style.transform = `scaleX(${lv})`;
          if (lv > PASS_LEVEL) above += t - last;
          last = t;
          if (!passed && above >= PASS_MS) pass();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { /* meter failed; the recording still tells us */ }
    }
    // Record ~2.5 s and play it back so they hear themselves.
    try {
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => window.MediaRecorder?.isTypeSupported?.(m) && (/iP(hone|ad|od)/.test(navigator.userAgent) || !m.includes("mp4"))) || "";
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: rec?.mimeType || mime || "audio/webm" });
        console.log(`[mic test] ${blob.size} bytes ${blob.type}`);
        if (!running) return;
        if (blob.size < 2048 && !passed) return fail("Empty recording");
        status(passed ? "Got you! ✓ Playing it back…" : "Playing it back…", passed ? "ok" : "");
        try {
          if (!ctx) throw new Error("no ctx");
          const ab = await ctx.decodeAudioData(await blob.arrayBuffer());
          const s = ctx.createBufferSource(); s.buffer = ab; s.connect(ctx.destination); s.start();
          s.onended = () => running && done();
        } catch {
          try { const a = new Audio(URL.createObjectURL(blob)); a.onended = () => running && done(); await a.play(); } catch { done(); }
        }
      };
      rec.start();
      timers.push(setTimeout(() => { try { rec.state !== "inactive" && rec.stop(); } catch { /* ignore */ } }, REC_MS));
    } catch { /* no recorder: the meter alone decides */ }
    timers.push(setTimeout(() => { if (!passed) fail("Can't hear you"); }, FAIL_MS));
  }
  function done() { if (passed) status("Mic OK ✓ You're good to go", "ok"); else if (running) fail("Can't hear you"); running = false; cancelAnimationFrame(raf); }
  function pass() {
    passed = true; setPassed(true); paintChips();
    status("Got you! ✓", "ok");
    try { navigator.vibrate?.([60, 40, 60]); } catch { /* ignore */ }
    opts.report?.(true);
  }
  function fail(why) {
    if (passed) return;
    cleanup();
    setPassed(false); paintChips();
    status(`${why} ✗`, "bad");
    $("mtFix").innerHTML = FIXES;
    opts.report?.(false);
  }
  function close() { cleanup(); wrap.remove(); open = null; opts.onClose?.(); }
  $("mtGo").addEventListener("click", start);
  $("mtDone").addEventListener("click", close);
  open = { close };
  return open;
}
