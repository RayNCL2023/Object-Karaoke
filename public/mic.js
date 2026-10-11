// Duet Anything - phone mic. Snap an object, then sing your lines into the phone when the stage says so.
const $ = (id) => document.getElementById(id);
const QUIPS = [
  "Giving it a brew...", "Asking our Nan...", "Proper waking it up, our kid...", "Putting the kettle on...",
  "Teaching it Wonderwall...", "Finding its best side...", "Warming up the vocal cords...", "It's buzzin', hang on...",
  "Getting it a pint...", "Telling it to stop mitherin'...",
];
const DONE_QUIPS = ["Sound!", "Mint!", "Proper!", "Buzzin'!", "Nailed it (maybe)."];

const state = {
  id: null, session: null, screen: "snapScreen",
  stream: null, micAsked: false, micUnavailableSent: false,
  recording: false, quipTimer: null,
};

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
async function ensureMic() {
  if (state.stream) return state.stream;
  if (!micSupported()) {
    if (!state.micUnavailableSent) { state.micUnavailableSent = true; broadcast({ type: "mic-unavailable", reason: window.isSecureContext ? "no-recorder" : "insecure" }); }
    micTip(`Mic needs USB: plug in and open <code>localhost:5173/mic.html</code><br>The stage will use the laptop mic instead.`);
    return null;
  }
  if (state.micAsked && !state.stream) return null;
  state.micAsked = true;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    return state.stream;
  } catch (e) {
    if (!state.micUnavailableSent) { state.micUnavailableSent = true; broadcast({ type: "mic-unavailable", reason: e.name || "denied" }); }
    micTip("No mic access (permission blocked). The stage will use the laptop mic instead.");
    return null;
  }
}

// ---------- 1. Snap ----------
$("snapBtn").addEventListener("click", () => { ensureMic(); }); // label click still opens the camera
$("cam").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
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
    const session = await postJson(`/api/object${mock}`, { image });
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
  $("charName").textContent = session.character?.name || session.object || "Your duet partner";
  $("songTitle").textContent = session.song?.title ? `"${session.song.title}"${session.song.genre ? " · " + session.song.genre : ""}` : "";
  $("readyHint").textContent = session.returning ? "Back for more, are we? Watch the big screen." : "Watch the big screen. Your lines pop up here.";
  buzz(mine ? [80, 60, 80] : 60);
  show("readyScreen");
  ensureMic();
}

// ---------- 3. Record ----------
let ctx, analyser, raf;
function lineTextFor(ev) {
  if (typeof ev.text === "string") return ev.text;
  if (typeof ev.line === "string") return ev.line;
  return state.session?.song?.lines?.[ev.line]?.text || "Sing your heart out!";
}
async function onRecordStart(ev) {
  if (state.recording) return;
  const ms = Math.max(1000, Number(ev.ms) || 4000);
  const lineIndex = typeof ev.line === "number" ? ev.line : ev.index;
  if (ev.id) state.id = ev.id;
  buzz([60, 40, 60]);
  $("lineText").textContent = lineTextFor(ev);
  show("recScreen");
  const stream = await ensureMic();
  // Timer bar runs either way so the singer knows how long they've got.
  const bar = $("timer");
  bar.style.transition = "none"; bar.style.transform = "scaleX(1)";
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `transform ${ms}ms linear`; bar.style.transform = "scaleX(0)"; }));
  if (!stream) { setTimeout(() => sent("Laptop's got this one.", "Sing at the laptop - it's listening."), ms); return; }

  state.recording = true;
  startMeter(stream);
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  setTimeout(() => rec.state !== "inactive" && rec.stop(), ms + 300);
  await stopped;
  stopMeter();
  state.recording = false;
  const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
  sent(DONE_QUIPS[Math.floor(Math.random() * DONE_QUIPS.length)], "Sending your bit...");
  try {
    const audio = await toBase64(blob);
    const r = await postJson("/api/take", { id: state.id, line: lineIndex, audio, mime: blob.type });
    if (state.screen === "sentScreen") $("sentText").textContent = r?.accuracy != null ? `Heard ${Math.round(r.accuracy * 100)}% of it. Keep watching the stage.` : "Got your bit. Keep watching the stage.";
  } catch (err) {
    if (state.screen === "sentScreen") $("sentText").textContent = "Couldn't send that one - carry on!";
  }
}
function sent(title, text) { $("sentTitle").textContent = title; $("sentText").textContent = text; show("sentScreen"); }

function startMeter(stream) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      $("meter").style.transform = `scaleX(${level})`;
      $("ring").style.transform = `scale(${1 + level * 0.6})`;
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* meter is decoration; recording still works */ }
}
function stopMeter() { cancelAnimationFrame(raf); try { analyser?.disconnect(); } catch { /* ignore */ } $("meter").style.transform = "scaleX(0)"; $("ring").style.transform = "scale(1)"; }

function toBase64(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(blob); });
}

// ---------- 4. Verdict / reset ----------
function onVerdict(ev) {
  const score = Math.max(0, Math.min(100, Math.round(Number(ev.score) || 0)));
  $("roast").textContent = ev.roast || "";
  show("verdictScreen");
  const el = $("score");
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 1200); el.innerHTML = `${Math.round(score * (1 - Math.pow(1 - k, 3)))}<small>/100</small>`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { el.innerHTML = `${score}<small>/100</small>`; }, 1300); // in case rAF is throttled
  buzz(score >= 70 ? [100, 50, 100, 50, 300] : score >= 40 ? [200, 100, 200] : [600]);
}
function reset() {
  state.session = null; state.id = null;
  if (!state.recording) show("snapScreen");
}
$("againBtn").addEventListener("click", () => { broadcast({ type: "reset" }); reset(); });
function showError(msg) { $("errText").textContent = msg || "Give it another go."; show("errScreen"); }
$("errBtn").addEventListener("click", () => show(state.session ? "readyScreen" : "snapScreen"));

// ---------- events ----------
function connect() {
  const es = new EventSource("/api/events");
  es.onopen = () => $("dot").classList.add("on");
  es.onerror = () => $("dot").classList.remove("on"); // EventSource reconnects by itself
  es.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    switch (ev.type) {
      case "song-ready": onSongReady(ev.session); break;
      case "record-start": onRecordStart(ev); break;
      case "verdict": onVerdict(ev); break;
      case "reset": reset(); break;
      case "photo-received": if (state.screen === "snapScreen") { show("wakeScreen"); } break;
    }
  };
}
connect();
if (!micSupported()) micTip(`Mic needs USB: plug in and open <code>localhost:5173/mic.html</code><br>The stage will use the laptop mic instead.`);
