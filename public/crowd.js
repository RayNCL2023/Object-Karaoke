// Duet Anything - character roster: idle gallery + animated karaoke crowd.
// Real saved characters (GET /api/characters) first, topped up with placeholders to 12.
// Crowd motion is transform/opacity only; one rAF tick (driven by stage.js) for all members.
import { PLACEHOLDERS } from "./placeholders.js";

const MAX = 12;
let roster = [];       // real characters, newest first
let uid = 0;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const okPt = (p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y);
const DEFAULT_FACE = { leftEye: { x: 0.38, y: 0.38 }, rightEye: { x: 0.62, y: 0.38 }, eyeSize: 0.14, mouth: { x: 0.5, y: 0.62, width: 0.28 } };

// One shared SVG filter: white sticker outline + soft shadow for the placeholder art.
(function injectDefs() {
  if (document.getElementById("rosterDefs")) return;
  const d = document.createElement("div");
  d.id = "rosterDefs";
  d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  d.innerHTML = `<svg width="0" height="0" aria-hidden="true"><defs><filter id="phSticker" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/>
    <feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg>`;
  document.body.appendChild(d);
})();

export async function refreshRoster(mock) {
  try {
    const r = await fetch(`/api/characters${mock ? "?mock=1" : ""}`);
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    const ok = await Promise.all((Array.isArray(list) ? list : []).filter((c) => c && c.photo).map((c) => loadAr(c.photo).then((ar) => (ar ? c : null))));
    roster = ok.filter(Boolean); // drop unreadable photos so placeholders fill the gap
  } catch { /* keep the last roster; placeholders cover an empty one */ }
  return roster;
}
export const getRoster = () => roster;

/** Gallery list: real first (newest), topped up with placeholders to 12. */
export function galleryList() {
  const real = roster.slice(0, 16);
  return real.length >= MAX ? real : [...real, ...PLACEHOLDERS.slice(0, MAX - real.length)];
}
/** Crowd list: <=12 real -> all real + placeholders; >12 real -> weighted random 12 (recent + high scores). */
export function pickCrowd() {
  const real = roster.slice();
  if (real.length <= MAX) return shuffle([...real, ...PLACEHOLDERS.slice(0, MAX - real.length)]);
  const pool = real.map((c, i) => ({ c, w: 1 + 2 * (1 - i / real.length) + (Number(c.bestScore) || 0) / 40 }));
  const out = [];
  while (out.length < MAX && pool.length) {
    let r = Math.random() * pool.reduce((a, p) => a + p.w, 0), k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    out.push(pool.splice(k, 1)[0].c);
  }
  return out;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- Sticker element (real photo cut-out or placeholder art) ----------
function loadAr(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1); im.onerror = () => res(0); im.src = src; });
}
/** Builds <div class="cm"> with body (svg + eyes), two little arms, a speech bubble and an optional name. */
export function stickerEl(c, { name = false } = {}) {
  const n = document.createElement("div");
  n.className = "cm";
  n.innerHTML = `<div class="cm-body"></div><div class="cm-bubble"></div>${name ? `<p class="cm-name">${esc(c.name)}</p>` : ""}`;
  const body = n.firstChild;
  const build = (IW, IH, inner) => {
    const f = c.face && okPt(c.face.leftEye) && okPt(c.face.rightEye) ? c.face : DEFAULT_FACE;
    const b = c.bbox && c.bbox.w > 0.05 && c.bbox.h > 0.05 ? c.bbox : { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };
    const bw = b.w * IW, bh = b.h * IH, pad = Math.max(bw, bh) * 0.08;
    const vb = [b.x * IW - pad, b.y * IH - pad, bw + pad * 2, bh + pad * 2];
    const px = (x) => (((x * IW - vb[0]) / vb[2]) * 100).toFixed(2) + "%", py = (y) => (((y * IH - vb[1]) / vb[3]) * 100).toFixed(2) + "%";
    const eyeW = (((+f.eyeSize || 0.14) * IW) / vb[2]) * 100;
    body.style.aspectRatio = (vb[2] / vb[3]).toFixed(4);
    const eye = (p) => `<i class="cm-eye" style="left:${px(p.x)};top:${py(p.y)};width:${eyeW.toFixed(2)}%"><b></b></i>`;
    const armY = py(b.y + b.h * 0.55);
    body.innerHTML = `<svg viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" preserveAspectRatio="none">${inner(vb)}</svg>${eye(f.leftEye)}${eye(f.rightEye)}
      <i class="cm-arm l" style="left:${px(b.x)};top:${armY}"><u></u></i><i class="cm-arm r" style="left:${px(b.x + b.w)};top:${armY}"><u></u></i>`;
    n._arms = body.querySelectorAll(".cm-arm");
    n._pupils = body.querySelectorAll(".cm-eye b");
  };
  if (c.art) build(200, 200, () => `<g filter="url(#phSticker)">${c.art}</g>`);
  else {
    loadAr(c.photo).then((ar) => {
      if (!ar) { n.classList.add("cm-broken"); return; }
      const IW = 1000, IH = 1000 / ar, id = `cmc${++uid}`;
      const pts = (Array.isArray(c.outline) && c.outline.length >= 3 ? c.outline : [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }])
        .map((p) => `${(p.x * IW).toFixed(1)},${(p.y * IH).toFixed(1)}`).join(" ");
      build(IW, IH, (vb) => `<defs><clipPath id="${id}"><polygon points="${pts}"/></clipPath></defs>
        <polygon points="${pts}" fill="#fff" stroke="#fff" stroke-width="${(vb[2] * 0.07).toFixed(1)}" stroke-linejoin="round"/>
        <image href="${esc(c.photo)}" x="0" y="0" width="${IW}" height="${IH.toFixed(1)}" preserveAspectRatio="none" clip-path="url(#${id})"/>`);
    });
  }
  return n;
}

// ---------- Idle gallery ----------
export function renderGallery(row, countEl) {
  if (!row) return;
  const list = galleryList();
  const key = list.map((c) => c.id + (c.updatedAt || "")).join("|");
  if (row._key === key) return;
  row._key = key;
  row.innerHTML = "";
  list.forEach((c, i) => { const s = stickerEl(c, { name: true }); s.style.setProperty("--i", i); row.appendChild(s); });
  if (countEl) countEl.textContent = roster.length ? `${roster.length} met so far` : "snap something to join them";
}

// ---------- Karaoke crowd ----------
const BUBBLES = { cheer: ["woo!", "get in!", "tune!", "mint!", "go on!", "proper!", "encore!", "buzzin'!"], boo: ["boo!", "ouch", "nah mate", "my ears!", "oof"], laugh: ["haha!", "savage!", "ooooh!", "roasted!"] };
export function createCrowd(host) {
  let members = [], visible = false, nextBubble = 0, forced = null;
  const S = { setMembers, tick, show: (v) => { forced = v === null || v === undefined ? null : !!v; }, cheer: () => { burst = 1; } };
  let burst = 0;
  function setMembers(list) {
    host.innerHTML = "";
    members = list.slice(0, MAX).map((c, i) => {
      const n = stickerEl(c);
      host.appendChild(n);
      return { n, c, d: Math.random() * 0.6, wob: Math.random() * 6.28, arm: 20, armR: 20, px: 0, py: 1, vx: 0, vy: 0, bubbleUntil: 0, i };
    });
  }
  function bubble(m, mood, now) {
    const b = m.n.querySelector(".cm-bubble");
    const set = BUBBLES[mood] || BUBBLES.cheer;
    b.textContent = set[(Math.random() * set.length) | 0];
    b.classList.add("on");
    m.bubbleUntil = now + 1300;
  }
  /** ctx: { now, dt, beat (beats, or null), pulse, excite 0-1, mood: null|'cheer'|'laugh'|'boo', visible } */
  function tick(ctx) {
    const want = forced ?? ctx.visible;
    if (want !== visible) { visible = want; host.classList.toggle("on", visible); }
    if (!visible || !members.length) return;
    const { now, dt, pulse, mood } = ctx;
    const b = ctx.beat ?? now / 600;
    burst = Math.max(0, burst - dt * 0.8);
    const excite = Math.min(1, Math.max(ctx.excite || 0, burst, mood === "cheer" ? 1 : 0));
    for (const m of members) {
      const ph = b + m.d;
      let y, rot, armT, armRT;
      if (mood === "boo") { // slump, sway, one arm up to the face (facepalm), the other limp
        y = 0.04 + Math.sin(now / 700 + m.wob) * 0.01; rot = Math.sin(now / 900 + m.wob) * 6;
        armT = m.i % 2 ? -150 : 8; armRT = m.i % 2 ? 8 : -150;
      } else {
        const hop = Math.abs(Math.sin(Math.PI * ph));
        y = -hop * (0.07 + excite * 0.12) - (mood === "laugh" ? Math.abs(Math.sin(now / 90 + m.wob)) * 0.03 : 0);
        rot = Math.sin(Math.PI * ph * 0.5 + m.wob) * (4 + excite * 6);
        const wave = Math.sin(now / 160 + m.wob) * 25;
        armT = 25 + excite * (115 + wave); armRT = 25 + excite * (115 - wave);
        if (mood === "laugh") { armT = -100; armRT = -100; } // holding their bellies
      }
      m.arm += (armT - m.arm) * Math.min(1, dt * 9); m.armR += (armRT - m.armR) * Math.min(1, dt * 9);
      m.n.style.transform = `translate3d(0, ${(y * 100).toFixed(2)}%, 0) rotate(${rot.toFixed(2)}deg)`;
      if (m.n._arms) {
        m.n._arms[0].style.transform = `rotate(${m.arm.toFixed(1)}deg)`;
        m.n._arms[1].style.transform = `rotate(${(-m.armR).toFixed(1)}deg)`;
      }
      // Light googly pupils: gravity + rim + kick on the beat
      if (m.n._pupils) {
        if (pulse > 0.85 && !m.kicked) { m.vx += (Math.random() - 0.5) * 6; m.vy -= 2 + Math.random() * 4; m.kicked = true; } else if (pulse < 0.5) m.kicked = false;
        m.vx += (-m.vx * 1.6) * dt; m.vy += (14 - m.vy * 1.6) * dt;
        m.px += m.vx * dt; m.py += m.vy * dt;
        const r = Math.hypot(m.px, m.py);
        if (r > 1) { m.px /= r; m.py /= r; const vn = m.vx * m.px + m.vy * m.py; if (vn > 0) { m.vx -= 1.5 * vn * m.px; m.vy -= 1.5 * vn * m.py; } }
        const tf = `translate3d(${(m.px * 34).toFixed(1)}%, ${(m.py * 34).toFixed(1)}%, 0)`;
        m.n._pupils[0].style.transform = tf; if (m.n._pupils[1]) m.n._pupils[1].style.transform = tf;
      }
      if (m.bubbleUntil && now > m.bubbleUntil) { m.bubbleUntil = 0; m.n.querySelector(".cm-bubble").classList.remove("on"); }
    }
    if (now > nextBubble) { // random "woo!" pops, more often when it's lively
      const m = members[(Math.random() * members.length) | 0];
      if (!m.bubbleUntil) bubble(m, mood || "cheer", now);
      nextBubble = now + (mood ? 500 : 1800 - excite * 1200) + Math.random() * 900;
    }
  }
  return S;
}
