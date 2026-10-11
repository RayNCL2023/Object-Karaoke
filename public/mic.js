// Duet Anything - phone mic. Snap an object, then sing your lines into the phone when the stage says so.
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
    micTip(`Mic blocked on this link. Open the <b>https://</b> link shown on the stage (tap Advanced → Proceed once).<br>The stage will use the laptop mic for now.`);
    return null;
  }
  if (state.micAsked && !state.stream) return null;
  state.micAsked = true;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    return state.stream;
  } catch (e) {
    if (!state.micUnavailableSent) { state.micUnavailableSent = true; broadcast({ type: "mic-unavailable", reason: e.name || "denied" }); }
    micTip("Mic permission was blocked. Tap the lock icon in the address bar → Permissions → Microphone → Allow, then reload.<br>The stage will use the laptop mic for now.");
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
  const battle = session.mode !== "karaoke";
  $("readyHint").textContent = session.returning ? "Back for more, are we? Watch the big screen." : battle ? "Roast battle! Listen to its opener, then freestyle back into this phone. No lyrics, make it up." : "Karaoke! Lyrics are on the big screen. This phone is your mic.";
  buzz(mine ? [80, 60, 80] : 60);
  show("readyScreen");
  ensureMic();
}

// ---------- 3. Record ----------
let ctx, analyser, raf;
// Phone never shows lyrics: battle = freestyle (no lyrics at all), karaoke = lyrics live on the big screen.
const isBattle = () => state.session?.mode !== "karaoke";
let countdownTimer = null;
async function onRecordStart(ev) {
  if (state.recording) return;
  const ms = Math.max(1000, Number(ev.ms) || 4000);
  const lineIndex = typeof ev.line === "number" ? ev.line : ev.index;
  if (ev.id) state.id = ev.id;
  buzz([60, 40, 60]);
  const yl = document.querySelector("#recScreen .yourline");
  if (yl) yl.textContent = isBattle() ? (ev.round ? `ROUND ${String(ev.round).padStart(2, "0")} · SPIT` : "FREESTYLE") : "SING";
  clearInterval(countdownTimer);
  if (isBattle()) { // big seconds countdown instead of lyrics
    const end = Date.now() + ms;
    const tick = () => { const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)); $("lineText").textContent = left ? String(left) : "TIME!"; if (!left) clearInterval(countdownTimer); };
    tick(); countdownTimer = setInterval(tick, 250);
  } else $("lineText").textContent = "";
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
  state.rec = rec; // small Stop button on the mic screen can end the take early
  setTimeout(() => rec.state !== "inactive" && rec.stop(), isBattle() ? ms + 300 : ms + 50); // karaoke: free the mic before the next line starts
  await stopped;
  state.rec = null;
  stopMeter();
  state.recording = false;
  const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
  const battle = isBattle();
  clearInterval(countdownTimer);
  if (battle) sent("Bars sent!", "It's cooking up a comeback... watch the stage.");
  try {
    const audio = await toBase64(blob);
    const r = await postJson("/api/take", { id: state.id, line: lineIndex, round: lineIndex, audio, mime: blob.type });
    if (battle && state.screen === "sentScreen") $("sentText").textContent = r?.transcript ? `It heard: "${String(r.transcript).slice(0, 120)}". Brace yourself.` : "It heard... nothing. It's going to destroy you for that.";
  } catch (err) {
    if (battle && state.screen === "sentScreen") $("sentText").textContent = "Couldn't send that one - carry on!";
  }
}
$("stopBtn")?.addEventListener("click", () => { if (state.rec && state.rec.state !== "inactive") state.rec.stop(); });
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
// The phone only allows the mic on a secure page: jump from the plain Wi-Fi link to the HTTPS one (port + 1).
if (!window.isSecureContext && location.protocol === "http:") {
  location.replace(`https://${location.hostname}:${Number(location.port || 80) + 1}${location.pathname}${location.search}`);
} else {
  connect();
  if (!micSupported()) micTip(`Mic blocked on this link. Open the <b>https://</b> link shown on the stage (tap Advanced → Proceed once).<br>The stage will use the laptop mic for now.`);
}
