// Duet Anything - stage "waking up" moment (photo-received -> song-ready).
// The snapped photo gets cut out like a zine sticker (dashed scissor line), googly eyes pop on, limbs doodle in,
// Manc status lines type out, and a hazard-tape progress bar creeps toward 90% until the song is ready.
// Transform/opacity animations only. Styles live in stage.css (.wk-*). Self-contained: listens to /api/events itself.
const LINES = [
  "CUTTING YOU OUT…", "GIVING IT A VOICE…", "TEACHING IT TO SWEAR (POLITELY)…", "ASKING OUR NAN…",
  "WARMING UP THE BARS…", "PUTTING THE KETTLE ON…", "TELLING IT TO STOP MITHERIN'…",
];

const root = document.createElement("div");
root.className = "wk";
root.setAttribute("aria-live", "polite");
root.innerHTML = `
  <div class="wk-band"></div>
  <div class="wk-stage">
    <div class="wk-sticker">
      <img class="wk-photo" alt="">
      <i class="wk-cut t"></i><i class="wk-cut r"></i><i class="wk-cut b"></i><i class="wk-cut l"></i>
      <span class="wk-scissors" aria-hidden="true">&#9986;</span>
      <i class="wk-limb al"></i><i class="wk-limb ar"></i><i class="wk-limb ll"></i><i class="wk-limb lr"></i>
      <span class="wk-eye e1"><b></b></span><span class="wk-eye e2"><b></b></span>
    </div>
  </div>
  <div class="wk-copy">
    <p class="wk-fac">FAC 51 · NEW OBJECT · WAKING UP</p>
    <h2 class="wk-line"></h2>
    <div class="wk-bar"><div class="wk-fill"><i></i></div></div>
    <p class="wk-sub">A brand-new object takes about 15 seconds to wake up. Proper worth it.</p>
    <p class="wk-crowd"></p>
  </div>`;
document.body.appendChild(root);
const q = (s) => root.querySelector(s);
const photo = q(".wk-photo"); photo.onerror = () => photo.removeAttribute("src");
const lineEl = q(".wk-line"), fill = q(".wk-fill"), crowdEl = q(".wk-crowd");

let on = false, lineTimer = 0, typeTimer = 0, li = 0;
function typeLine(text) {
  clearInterval(typeTimer);
  let n = 0;
  lineEl.textContent = "";
  typeTimer = setInterval(() => { n++; lineEl.textContent = text.slice(0, n); if (n >= text.length) clearInterval(typeTimer); }, 38);
}
function start(src) {
  if (on) return;
  on = true; li = 0;
  if (src) photo.src = src; else photo.removeAttribute("src");
  root.classList.remove("done", "go");
  fill.style.transition = "none"; fill.style.transform = "translateX(-98%)";
  void root.offsetWidth;
  root.classList.add("on", "go");
  requestAnimationFrame(() => { fill.style.transition = "transform 15s cubic-bezier(.12,.62,.28,1)"; fill.style.transform = "translateX(-10%)"; });
  typeLine(LINES[0]);
  clearInterval(lineTimer);
  lineTimer = setInterval(() => { li = (li + 1) % LINES.length; typeLine(LINES[li]); }, 2600);
  const n = window.crowd?.audienceCount?.() || 0;
  crowdEl.textContent = n ? `${n} in the crowd · ooooh…` : "";
  if (n) { try { window.crowd?.cheer?.(); window.playSfx?.("ooooh"); } catch { /* decoration */ } }
}
function finish(fast) {
  if (!on) return;
  on = false;
  clearInterval(lineTimer); clearInterval(typeTimer);
  fill.style.transition = fast ? "none" : "transform .35s cubic-bezier(.22,1,.36,1)";
  fill.style.transform = "translateX(0)";
  if (!fast) lineEl.textContent = "IT'S ALIVE!";
  setTimeout(() => root.classList.add("done"), fast ? 0 : 420);
  setTimeout(() => root.classList.remove("on", "go", "done"), fast ? 400 : 1000);
}

const es = new EventSource("/api/events");
es.onmessage = (e) => {
  let ev; try { ev = JSON.parse(e.data); } catch { return; }
  if (!ev?.type) return;
  if (ev.type === "photo-received" && document.body.dataset.screen === "idle") start(ev.photo);
  else if (ev.type === "song-ready") finish(!!(ev.session || ev).returning);
  else if (ev.type === "error" || ev.type === "reset") finish(true);
};
