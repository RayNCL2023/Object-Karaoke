// Duet Anything - kinetic captions (rap-video / TikTok style) for the stage lyrics area.
// One chunk (max ~6 words) at a time, big and centred. Words pop in exactly when spoken; the punchline word
// slams in on a yellow sticker block. "You said" transcripts type out on a white torn-paper strip instead.
// Timing: audio element currentTime (real MP3s), speechSynthesis word boundaries, or a per-word estimate.
// Only transform/opacity animate (CSS keyframes in stage.css: .cap ...).

const INSULTS = /^(melt|muppet|weapon|mingin|gobshite|plum|apeth|pathetic|rubbish|nowt|bottled|embarrass|embarrassed|mingers?|clown|pants|shambles|tragic|bin|melts|muppets)$/i;
const clean = (w) => w.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Split a line into word records + chunks. */
function layout(text, maxWords, punctBreaks = true) {
  const raw = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const words = [];
  let chunk = 0, inChunk = 0, char = 0;
  const src = String(text || "");
  raw.forEach((w, i) => {
    const at = src.indexOf(w, char); char = at >= 0 ? at + w.length : char;
    const endS = /[.!?]["”']?$/.test(w), endC = /[,;:—-]["”']?$/.test(w);
    words.push({ w, i, chunk, at: at >= 0 ? at : char, endS, endC, punch: false, t: 0 });
    inChunk++;
    const last = i === raw.length - 1;
    if (!last && (inChunk >= maxWords || (punctBreaks && inChunk >= 3 && (endS || (endC && inChunk >= 4))))) { chunk++; inChunk = 0; }
  });
  // Punchline words: end of each sentence-chunk, the line's last word, and Manc insults
  const chunks = [];
  for (const w of words) (chunks[w.chunk] ||= []).push(w);
  for (const c of chunks) { const l = c[c.length - 1]; if (l.endS || c === chunks[chunks.length - 1]) l.punch = true; }
  for (const w of words) if (INSULTS.test(clean(w.w))) w.punch = true;
  // Relative timing weights: longer words take longer, punctuation adds a breath
  let acc = 0;
  for (const w of words) { w.t = acc; acc += clean(w.w).length + 2.2 + (w.endC ? 2.5 : 0) + (w.endS ? 4 : 0); }
  for (const w of words) w.t /= acc || 1; // 0..1 start fraction
  return { words, chunks };
}

export function createCaptions({ lyrics, track, onWord }) {
  const lines = []; // { who, text, name, kind }
  let cur = null;
  const nextEl = document.createElement("div");
  nextEl.className = "cap-next";
  lyrics.appendChild(nextEl);

  function reset(newLines = [], name = "") {
    lines.length = 0;
    newLines.forEach((l) => lines.push({ who: l.who === "you" ? "you" : "obj", text: l.text, name, kind: l.who === "you" ? "sing" : "obj" }));
    track.innerHTML = "";
    cur = null;
    nextEl.textContent = "";
    nextEl.classList.remove("on");
  }
  function add(who, text, name) {
    lines.push({ who: who === "you" ? "you" : "obj", text, name, kind: who === "you" ? "said" : "obj" });
    return lines.length - 1;
  }

  /** Make line i the live caption (nothing pops until its clock starts). */
  function focus(i) {
    const line = lines[i];
    if (!line) return;
    if (cur && cur.i === i) return;
    if (cur) { const old = cur.el; old.classList.remove("current"); old.classList.add("gone"); setTimeout(() => old.remove(), 600); }
    const kind = line.kind;
    const { words, chunks } = layout(line.text, kind === "said" ? 14 : 6, kind !== "said");
    const el = document.createElement("div");
    el.className = `cap current ${kind}`;
    el.dataset.i = i;
    const label = kind === "obj" ? esc(line.name || "") : kind === "said" ? "&#127908; You said" : "&#127908; Your line";
    el.innerHTML = `<div class="cap-who">${label}</div>` + chunks.map((c, ci) =>
      `<div class="chunk" data-c="${ci}">${c.map((w) => `<span class="w${w.punch ? " punch" : ""}" data-k="${w.i}"><span class="wi">${esc(w.w)}</span></span>`).join(" ")}</div>`).join("");
    track.appendChild(el);
    const chunkEls = [...el.querySelectorAll(".chunk")];
    words.forEach((w) => { w.el = el.querySelector(`.w[data-k="${w.i}"]`); });
    cur = { i, el, kind, words, chunkEls, shown: -1, revealed: 0, mode: "wait", start: 0, dur: 0, audio: null, boundary: -1, boundaryAt: 0, punchFired: false };
    // Karaoke: you need to read ahead, so the first chunk shows (grey) straight away, plus a next-line preview
    if (kind === "sing") { showChunk(0); const nx = lines[i + 1]; nextEl.textContent = nx ? nx.text : ""; nextEl.classList.toggle("on", !!nx); }
    else { nextEl.classList.remove("on"); }
    if (kind === "said") start(i, Math.max(900, words.length * 140), "type");
  }

  function showChunk(ci) {
    if (!cur || ci === cur.shown) return;
    const prev = cur.chunkEls[cur.shown];
    if (prev) { prev.classList.remove("in"); prev.classList.add("out"); setTimeout(() => { if (prev.classList.contains("out")) prev.classList.add("done"); }, 380); }
    cur.shown = ci;
    const c = cur.chunkEls[ci];
    if (c) { c.classList.remove("out", "done"); c.classList.add("in"); }
  }

  /** Start line i's clock: estimated over ms (karaoke + fallback), or "type" for transcripts. */
  function start(i, ms, mode = "est") {
    if (!cur || cur.i !== i) focus(i);
    if (!cur) return;
    cur.mode = mode; cur.start = performance.now(); cur.dur = Math.max(400, ms || 3000);
    cur.boundary = -1;
  }
  function retime(ms) { if (cur && cur.mode === "est" && ms > 0) cur.dur = ms; }
  /** Real MP3 playing: follow its currentTime/duration. */
  function attachAudio(a) { if (!cur) return; cur.audio = a; cur.mode = "audio"; }
  /** Browser speech: word boundary at charIndex (speechSynthesis 'boundary' event). */
  function boundary(charIndex) {
    if (!cur) return;
    let k = 0;
    for (const w of cur.words) if (w.at <= charIndex + 1) k = w.i;
    cur.boundary = Math.max(cur.boundary, k); cur.boundaryAt = performance.now();
    if (cur.mode === "est") cur.mode = "speech";
  }
  function speechStart() { if (cur && (cur.mode === "est" || cur.mode === "speech")) cur.start = performance.now(); }
  /** Line finished: reveal anything left (audio ended early etc). */
  function finish() {
    if (!cur) return;
    revealTo(cur.words.length);
    const c = cur; // object line done: hold the last chunk a beat, then flick it up and away
    if (c.kind === "obj") setTimeout(() => { if (cur === c) { const el = c.chunkEls[c.shown]; if (el) { el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.classList.add("done"), 380); } } }, 1400);
  }

  function revealTo(n) {
    n = Math.min(cur.words.length, n);
    while (cur.revealed < n) {
      const w = cur.words[cur.revealed++];
      showChunk(w.chunk);
      w.el.classList.add("on");
      const lastWord = w.i === cur.words.length - 1;
      try { onWord?.({ word: w.w, punch: w.punch, last: lastWord, kind: cur.kind, el: w.el }); } catch (e) { console.warn("[captions] onWord", e); }
    }
  }

  /** Call every animation frame. */
  function tick(now) {
    if (!cur || cur.mode === "wait") return;
    let frac = 0;
    if (cur.mode === "audio" && cur.audio) {
      const a = cur.audio, d = isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : cur.dur;
      // v3 audio tends to have ~150ms of lead-in; words land slightly ahead of the voice feels right
      frac = ((a.currentTime * 1000) + 120) / (d * 0.94);
      if (a.ended) frac = 1;
    } else if (cur.mode === "type") {
      frac = (now - cur.start) / cur.dur;
    } else {
      frac = (now - cur.start) / (cur.dur * 0.94);
    }
    let n = 0;
    for (const w of cur.words) if (w.t <= frac) n = w.i + 1;
    if (cur.mode === "speech") n = Math.max(cur.boundary + 1, Math.min(n, cur.boundary + 2)); // boundaries lead, estimate fills gaps
    if (n > cur.revealed) revealTo(n);
  }

  return { reset, add, focus, start, retime, attachAudio, boundary, speechStart, finish, tick, current: () => cur };
}
