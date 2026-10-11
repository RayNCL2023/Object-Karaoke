// dissPICable - OBJECT vs OBJECT on the trainer's phone (mic.html; lib/ovo.mjs). mic.js posts the snap as usual;
// an OvO reply comes here ("ovo-snapped"). Same phone snapping both: "NOW SNAP OBJECT 2". Then the trainers get a big
// HYPE button for their own object (cheer bursts + hype meter on that side of the stage), and the result at the end.
import { listen } from "./events.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };
const me = (() => { try { return JSON.parse(localStorage.getItem("duetMicPlayer") || "null"); } catch { return null; } })();
const pid = new URLSearchParams(location.search).get("pid") || me?.id || "";
const myName = new URLSearchParams(location.search).get("name") || me?.name || "";
const client = (() => { try { return localStorage.getItem("duetClientId") || ""; } catch { return ""; } })();

const css = document.createElement("style");
css.textContent = `
.ovp { position: fixed; inset: 0; z-index: 90; display: none; flex-direction: column; gap: 16px; padding: 22px 18px; background: #ece6d6; color: #111; font-family: "Space Mono", monospace; overflow: auto; }
.ovp.on { display: flex; }
.ovp-tag { align-self: flex-start; font-weight: 700; font-size: 13px; background: #111; color: #ffd400; padding: 2px 8px; text-transform: uppercase; letter-spacing: .08em; }
.ovp h2 { margin: 0; font: 400 clamp(36px, 11vw, 56px)/1 "Anton", sans-serif; text-transform: uppercase; }
.ovp p { margin: 0; font-weight: 700; font-size: 16px; text-transform: uppercase; }
.ovp-hype { flex: 1 1 0; min-height: 150px; border: 6px solid #111; box-shadow: 10px 10px 0 #111; font: 400 clamp(40px, 13vw, 70px)/1 "Anton", sans-serif; text-transform: uppercase; color: #111; border-radius: 0; touch-action: manipulation; transition: transform .08s; }
.ovp-hype small { display: block; font: 700 16px "Space Mono", monospace; margin-top: 6px; }
.ovp-hype:active, .ovp-hype.hit { transform: translate(6px, 6px); box-shadow: 4px 4px 0 #111; }
.ovp-banner { position: fixed; left: 0; right: 0; top: 0; z-index: 91; display: none; padding: 10px 14px; background: #ffd400; border-bottom: 5px solid #111; font: 400 26px/1.05 "Anton", sans-serif; text-transform: uppercase; color: #111; text-align: center; }
.ovp-banner.on { display: block; }
`;
document.head.appendChild(css);
const root = document.createElement("div");
root.className = "ovp";
document.body.appendChild(root);
const bannerEl = document.createElement("div");
bannerEl.className = "ovp-banner";
document.body.appendChild(bannerEl);

let cur = null; // { id, mySides:Set, session }
function screen(html) { root.innerHTML = `<span class="ovp-tag">Object vs object</span>${html}`; root.classList.add("on"); }
function hide() { root.classList.remove("on"); bannerEl.classList.remove("on"); }
function showSnap() { document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("show", s.id === "snapScreen")); }

window.addEventListener("ovo-snapped", (e) => {
  const r = e.detail || {};
  if (!cur || cur.id !== r.id) cur = { id: r.id, mySides: new Set() };
  cur.mySides.add(r.slot);
  buzz([40, 60, 40]);
  if (r.snapAgain) {
    hide(); showSnap();
    bannerEl.textContent = `Object ${r.slot + 1} locked in ✓ — now snap object ${2 - r.slot}!`;
    bannerEl.classList.add("on");
  } else {
    bannerEl.classList.remove("on");
    screen(`<h2>Object ${r.slot + 1} locked in ✓</h2><p>${r.waitingFor ? `Waiting for ${esc(r.waitingFor)} to snap object ${2 - r.slot}…` : "Waking them both up… watch the stage!"}</p>`);
  }
});

function hypeScreen(s) {
  const sides = [...cur.mySides];
  screen(`<h2>${esc(s.title || "Object vs object")}</h2><p>Tap to hype your object! Everyone else votes.</p>
    ${sides.map((i) => { const x = s.sides[i]; return `<button type="button" class="ovp-hype" data-side="${i}" style="background:${esc(x.character?.colour || (i ? "#4da3ff" : "#ffd400"))}">Hype ${esc(x.character?.name || `object ${i + 1}`)}!<small>${esc(x.object || "")} · tap tap tap</small></button>`; }).join("")}`);
}
root.addEventListener("click", (e) => {
  const b = e.target.closest(".ovp-hype");
  if (!b || !cur) return;
  b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 90);
  buzz(15);
  fetch("/api/ovo/hype", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cur.id, side: Number(b.dataset.side), client, player: pid, name: myName }) }).catch(() => {});
});

listen((ev) => {
  switch (ev.type) {
    case "ovo-slot-failed":
      if (cur?.id === ev.id && cur.mySides.has(ev.slot)) { cur.mySides.delete(ev.slot); hide(); showSnap(); bannerEl.textContent = `Couldn't wake object ${ev.slot + 1} — snap it again`; bannerEl.classList.add("on"); }
      break;
    case "ovo-ready": {
      const s = ev.session || {};
      const mine = new Set(cur?.id === s.id ? cur.mySides : []);
      (s.trainers || []).forEach((t, i) => { if (t && pid && t.id === pid) mine.add(i); });
      if (!mine.size) break;
      cur = { id: s.id, mySides: mine, session: s };
      bannerEl.classList.remove("on");
      hypeScreen(s);
      buzz([60, 40, 60]);
      break;
    }
    case "ovo-verdict": {
      if (!cur || cur.id !== ev.id) break;
      const won = cur.mySides.has(ev.winner), both = cur.mySides.size === 2;
      screen(`<h2>${esc(ev.winnerName)} wins!</h2><p>${both ? "Both were yours - you win either way" : won ? "Your object WON. Proper buzzin'." : "Your object lost. Absolute melt."}</p>
        <p>${(ev.sides || []).map((x) => `${esc(x.name)} ${x.score}`).join(" · ")}</p><p style="text-transform:none;font-weight:400">"${esc(ev.roast || "")}"</p>`);
      buzz(won ? [100, 50, 100, 50, 300] : [600]);
      break;
    }
    case "reset": cur = null; hide(); break;
  }
});
