// Duet Anything - TEST MIC overlay (phone). Big live level meter, "SAY SOMETHING... / GOT YOU!", records ~2.5 s and
// plays it back, plain fixes if silent. Passing marks the phone "MIC OK" (localStorage) and tells the stage
// ({type:'mic-check', client, player, playerName, ok}). Used by mic.html (shared stream) and play.html (own stream).
const OK_KEY = "duetMicOk";
const PASS_LEVEL = 0.05, PASS_MS = 500, REC_MS = 2500, FAIL_MS = 6000;

/** Phone mic constraints: echo cancellation off (on Android it flips audio into call mode, which can freeze Web Audio
 *  and hand back near-silence on Samsung), noise suppression off, auto gain on so quiet voices still register. */
export const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } };
export async function getMicStream() {
  try { return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS); }
  catch (e) { if (e?.name === "NotAllowedError" || e?.name === "SecurityError") throw e; return navigator.mediaDevices.getUserMedia({ audio: true }); }
}
/** Raw RMS (0-1) of a recorded blob, decoded offline: proves sound even when the live meter can't run. 0 on failure. */
async function blobLevel(blob) {
  try {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const dec = new AC(1, 1, 44100);
    const bytes = await blob.arrayBuffer();
    const ab = await new Promise((res, rej) => { const p = dec.decodeAudioData(bytes, res, rej); p?.then?.(res, rej); });
    const d = ab.getChannelData(0); let sum = 0, n = 0;
    for (let i = Math.floor(d.length * 0.1); i < d.length; i++) { sum += d[i] * d[i]; n++; } // skip the start click
    return n ? Math.sqrt(sum / n) : 0;
  } catch { return 0; }
}
/** 0.1 s silent WAV, played inside the tap so iPhone lets the same <audio> play the recording later. */
const SILENT_WAV = (() => {
  const n = 4410, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 44100, true); b.setUint32(28, 88200, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
  let bin = ""; new Uint8Array(b.buffer).forEach((x) => { bin += String.fromCharCode(x); });
  return "data:audio/wav;base64," + btoa(bin);
})();

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
.mt-dbg { font:400 11px/1.35 "Space Mono", monospace; color:#777; margin:0; word-break:break-word; }
.mt-card .hidden { display:none; }
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
    <button class="mt-btn alt hidden" id="mtPlay" type="button">▶ Play it back</button>
    <div class="mt-row"><button class="mt-btn" id="mtGo" type="button">Start</button><button class="mt-btn alt" id="mtDone" type="button">Close</button></div>
    <p class="mt-dbg" id="mtDbg"></p>
  </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector("#" + id);
  let raf = 0, rec = null, own = null, nodes = [], timers = [], passed = false, running = false, ctx = null, dbg = 0, player = null, playUrl = "";
  let rawNow = 0, rawPeak = 0, curStream = null, lastCt = -1, stalls = 0;
  const status = (t, cls = "") => { const el = $("mtStatus"); el.textContent = t; el.className = `mt-status ${cls}`; };
  function paintDebug() {
    const t = curStream?.getAudioTracks?.()[0];
    const s = t?.getSettings?.() || {};
    $("mtDbg").textContent = `audio ${ctx ? ctx.state + " " + Math.round(ctx.sampleRate) + "Hz t=" + ctx.currentTime.toFixed(1) : "none"} | track ${t ? t.readyState + (t.muted ? " MUTED" : "") + (t.enabled ? "" : " disabled") : "none"}`
      + `${s.sampleRate ? " " + s.sampleRate + "Hz" : ""} ec:${s.echoCancellation ? 1 : 0} ns:${s.noiseSuppression ? 1 : 0} | rms ${rawNow.toFixed(3)} peak ${rawPeak.toFixed(3)} (need ${(PASS_LEVEL / 4).toFixed(3)})`;
  }
  function cleanup() {
    if (dbg) { try { paintDebug(); } catch { /* ignore */ } } // freeze the last reading on screen
    clearInterval(raf); clearInterval(dbg); timers.forEach(clearTimeout); timers = [];
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch { /* ignore */ }
    rec = null;
    nodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } }); nodes = [];
    if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; }
    if (own) { own.getTracks().forEach((t) => t.stop()); own = null; }
    try { player?.pause(); } catch { /* ignore */ }
    if (playUrl) { URL.revokeObjectURL(playUrl); playUrl = ""; }
    $("mtPlay").classList.add("hidden");
    running = false;
  }
  /** Analyser on the CURRENT live stream, BEFORE the zero-gain sink (Safari only runs nodes that reach the speakers). */
  function wire(stream) {
    nodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } }); nodes = [];
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 1024;
    const sink = ctx.createGain(); sink.gain.value = 0; src.connect(an); an.connect(sink); sink.connect(ctx.destination);
    nodes = [src, an, sink];
    return an;
  }
  /** Brand-new context (the old one stalled / stayed suspended) wired to the live stream. */
  function rebuild(stream) {
    if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== "running") ctx.resume?.().catch(() => {});
    lastCt = -1;
    return wire(stream);
  }
  let runId = 0;
  async function start() { // START / AGAIN: always a clean restart
    const my = ++runId;
    cleanup(); running = true; passed = false; rawNow = rawPeak = 0;
    $("mtFix").innerHTML = ""; $("mtGo").textContent = "Again";
    // Inside the tap: unlock the page's shared context (used for the take meter), our own context and an <audio> for playback.
    try { opts.audioCtx?.(); } catch { /* ignore */ }
    player = new Audio(); player.playsInline = true; player.setAttribute("playsinline", "");
    try { player.src = SILENT_WAV; player.play().catch(() => {}); } catch { /* ignore */ }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume?.().catch(() => {}); } catch { ctx = null; }
    dbg = setInterval(paintDebug, 250);
    status("Asking for the mic…");
    let stream = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      stream = opts.getStream ? await opts.getStream() : (own = await getMicStream());
    } catch { stream = null; }
    if (!running || my !== runId) return;
    if (!stream) return fail(window.isSecureContext ? "Mic blocked" : "Mic needs the https link");
    curStream = stream;
    status("Say something…");
    let above = 0, last = performance.now();
    if (ctx) {
      try {
        let an = ctx.state === "running" ? wire(stream) : rebuild(stream); // capture is live now, so a new context may run
        let buf = new Float32Array(an.fftSize), checkAt = performance.now() + 700;
        const tick = () => { // timer, not rAF: keeps measuring even if the browser throttles animation frames
          const t = performance.now();
          if (!running || !ctx) return;
          an.getFloatTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          rawNow = Math.sqrt(sum / buf.length); rawPeak = Math.max(rawPeak, rawNow);
          const lv = Math.min(1, rawNow * 4);
          $("mtBar").style.transform = `scaleX(${lv})`;
          if (lv > PASS_LEVEL) above += t - last;
          last = t;
          if (!passed && above >= PASS_MS) pass();
          // Suspended or frozen context (Android re-routes audio when the mic opens): resume, then rebuild on the live stream.
          if (t > checkAt) {
            checkAt = t + 700;
            const ct = ctx.currentTime;
            if ((ctx.state !== "running" || ct === lastCt) && stalls < 4) {
              stalls++;
              if (stalls === 1) ctx.resume?.().catch(() => {});
              else if (curStream?.getAudioTracks?.()[0]?.readyState === "live") { an = rebuild(curStream); buf = new Float32Array(an.fftSize); }
            }
            lastCt = ctx.currentTime;
          }
        };
        raf = setInterval(tick, 40);
      } catch (e) { console.warn("[mic test] meter", e); /* the recording still tells us */ }
    }
    // Record ~2.5 s, check the recording itself for sound (works even if the meter can't), then play it back.
    try {
      const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const mime = (ios ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]).find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
      const r = rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        const blob = new Blob(chunks, { type: r.mimeType || mime || "audio/webm" });
        if (!running || my !== runId) return;
        const lvRec = await blobLevel(blob);
        console.log(`[mic test] ${blob.size} bytes ${blob.type}, recording rms ${lvRec.toFixed(4)}`);
        if (!running || my !== runId) return;
        if (!passed && lvRec > PASS_LEVEL / 4) pass();
        if (blob.size < 1024 && !passed) return fail("Empty recording");
        status(passed ? "Got you! ✓ Playing it back…" : "Playing it back…", passed ? "ok" : "");
        playUrl = URL.createObjectURL(blob);
        const p = player || (player = new Audio());
        p.onended = () => running && done();
        p.src = playUrl;
        try { await p.play(); } catch {
          $("mtPlay").classList.remove("hidden"); // autoplay blocked: one tap plays it
          status(passed ? "Got you! ✓ Tap PLAY to hear it" : "Tap PLAY to hear it", passed ? "ok" : "");
        }
      };
      r.start(250);
      timers.push(setTimeout(() => { try { r.state !== "inactive" && r.stop(); } catch { /* ignore */ } }, REC_MS));
    } catch (e) { console.warn("[mic test] recorder", e); /* no recorder: the meter alone decides */ }
    timers.push(setTimeout(() => { if (!passed && my === runId) fail("Can't hear you"); }, FAIL_MS));
  }
  function done() { if (passed) status("Mic OK ✓ You're good to go", "ok"); else if (running) fail("Can't hear you"); running = false; clearInterval(raf); }
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
  $("mtPlay").addEventListener("click", () => { if (!player || !playUrl) return; $("mtPlay").classList.add("hidden"); player.currentTime = 0; player.play().catch(() => {}); });
  open = { close };
  return open;
}
