// dissPICable - real object cut-out in the browser (MediaPipe InteractiveSegmenter, magic_touch).
// cutout(img, {x,y}) -> { maskCanvas, borderCanvas, bbox, face } in 0..1 image coords, or null on any failure.
const VER = "0.10.14";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
const MAX_SIDE = 512, LOAD_MS = 15000, RUN_MS = 2000;

let segP = null;
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

async function create() {
  const { FilesetResolver, InteractiveSegmenter } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, outputCategoryMask: false, outputConfidenceMasks: true });
  try { return await InteractiveSegmenter.createFromOptions(fileset, opts("GPU")); }
  catch (e) { console.warn("[segment] GPU delegate failed, using CPU", e?.message); return InteractiveSegmenter.createFromOptions(fileset, opts("CPU")); }
}
/** First segment() compiles GPU shaders (~5s, blocks the thread): do it at preload, not on the first snap. */
async function warm(seg) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"); g.fillStyle = "#777"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#fff"; g.fillRect(96, 48, 64, 160);
    await new Promise((r) => setTimeout(r, 50));
    seg.segment(c, { keypoint: { x: 0.5, y: 0.5 } }, (res) => (res.confidenceMasks || []).forEach((m) => m.close?.()));
  } catch (e) { console.warn("[segment] warm-up failed", e?.message); }
  return seg;
}
/** Start loading the model (call on the 'start the show' click). Safe to call repeatedly. */
export function preloadSegmenter() {
  if (!segP) segP = timeout(create().then(warm), LOAD_MS, "segmenter load").catch((e) => { console.warn("[segment] load failed", e?.message); segP = null; return null; });
  return segP;
}

export async function cutout(img, hint) {
  try {
    const seg = await preloadSegmenter();
    if (!seg || !img?.naturalWidth) return null;
    const t0 = performance.now();
    const out = await timeout(Promise.resolve().then(() => run(seg, img, hint)), RUN_MS, "cutout");
    if (out) console.info(`[segment] cut-out in ${Math.round(performance.now() - t0)}ms`);
    return out;
  } catch (e) { console.warn("[segment] cutout failed", e?.message); return null; }
}

function run(seg, img, hint) {
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(8, Math.round(img.naturalWidth * s)), H = Math.max(8, Math.round(img.naturalHeight * s));
  const src = document.createElement("canvas"); src.width = W; src.height = H;
  src.getContext("2d").drawImage(img, 0, 0, W, H);
  const kx = clamp01(+hint?.x || 0.5), ky = clamp01(+hint?.y || 0.5);
  let conf = null;
  seg.segment(src, { keypoint: { x: kx, y: ky } }, (r) => {
    const ms = r.confidenceMasks || [];
    const arrs = ms.map((m) => m.getAsFloat32Array().slice());
    const ki = Math.min(H - 1, Math.round(ky * H)) * W + Math.min(W - 1, Math.round(kx * W));
    // Pick whichever mask is "on" at the keypoint (foreground); single-mask models give fg directly
    conf = arrs.length > 1 ? arrs.reduce((a, b) => (b[ki] > a[ki] ? b : a)) : arrs[0] || null;
    ms.forEach((m) => m.close?.());
  });
  if (!conf || conf.length !== W * H) return null;
  return postProcess(conf, W, H, kx, ky);
}

function postProcess(conf, W, H, kx, ky) {
  const N = W * H, bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = conf[i] > 0.5 ? 1 : 0;
  // Connected components: keep the blob under the keypoint, else the largest
  const lab = new Int32Array(N), stack = new Int32Array(N);
  let best = 0, bestN = 0, n = 0;
  const ki = Math.min(H - 1, Math.round(ky * H)) * W + Math.min(W - 1, Math.round(kx * W));
  for (let i = 0; i < N; i++) {
    if (!bin[i] || lab[i]) continue;
    n++; let sp = 0, cnt = 0; stack[sp++] = i; lab[i] = n;
    while (sp) {
      const p = stack[--sp]; cnt++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = n; stack[sp++] = p - 1; }
      if (x < W - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = n; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - W] && !lab[p - W]) { lab[p - W] = n; stack[sp++] = p - W; }
      if (y < H - 1 && bin[p + W] && !lab[p + W]) { lab[p + W] = n; stack[sp++] = p + W; }
    }
    if (cnt > bestN) { bestN = cnt; best = n; }
  }
  const keep = lab[ki] || best;
  if (!keep) return null;
  for (let i = 0; i < N; i++) bin[i] = lab[i] === keep ? 1 : 0;
  // Fill holes: flood the background in from the borders; anything unreached becomes object
  const out = new Uint8Array(N); let sp = 0;
  const push = (p) => { if (!bin[p] && !out[p]) { out[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const p = stack[--sp], x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
  }
  let area = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) {
    bin[i] = out[i] ? 0 : 1;
    if (bin[i]) { area++; const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (area < N * 0.015 || area > N * 0.92 || x1 - x0 < 6 || y1 - y0 < 6) return null; // nothing / everything = failed

  const sideMax = Math.max(x1 - x0, y1 - y0);
  const maskCanvas = drawMask(bin, W, H, 1, 1.1);                                // slight dilate + feather
  const borderCanvas = drawMask(bin, W, H, Math.max(3, sideMax * 0.035), 1.5);   // white sticker border
  const bbox = { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
  return { maskCanvas, borderCanvas, bbox, face: faceFromMask(bin, W, H, x0, y0, x1, y1) };
}

/** White-on-transparent mask canvas, dilated by r px (blur + hard threshold) and feathered by f px. */
function drawMask(bin, W, H, r, f) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), id = g.createImageData(W, H);
  for (let i = 0; i < bin.length; i++) { const j = i * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = bin[i] ? 255 : 0; }
  g.putImageData(id, 0, 0);
  const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
  const g2 = c2.getContext("2d");
  if (r > 0) { // dilate: blur, then any alpha > small threshold -> solid
    g2.filter = `blur(${r.toFixed(1)}px)`; g2.drawImage(c, 0, 0); g2.filter = "none";
    const d = g2.getImageData(0, 0, W, H);
    for (let j = 3; j < d.data.length; j += 4) d.data[j] = d.data[j] > 20 ? 255 : 0;
    g2.putImageData(d, 0, 0);
  } else g2.drawImage(c, 0, 0);
  g.clearRect(0, 0, W, H); g.filter = `blur(${f}px)`; g.drawImage(c2, 0, 0); g.filter = "none";
  return c;
}

/** Eyes ~35% down the object, mouth ~55%, sized from the mask's width at that row (so they sit on the object). */
function faceFromMask(bin, W, H, x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2;
  const span = (fy) => {
    const y = Math.round(y0 + (y1 - y0) * fy);
    let best = null, run = null;
    for (let x = x0; x <= x1 + 1; x++) {
      const on = x <= x1 && bin[y * W + x];
      if (on && !run) run = { a: x, b: x };
      else if (on) run.b = x;
      else if (run) { // prefer the run containing the centre line, else the widest
        const sc = (run.a <= cx && run.b >= cx ? 1e6 : 0) + (run.b - run.a);
        if (!best || sc > best.sc) best = { ...run, sc };
        run = null;
      }
    }
    return best ? { y: y / H, a: best.a / W, b: (best.b + 1) / W } : { y: y / H, a: x0 / W, b: (x1 + 1) / W };
  };
  const e = span(0.35), m = span(0.55);
  const lw = Math.max(0.02, e.b - e.a), ex = (e.a + e.b) / 2;
  let eyeSize = Math.min(0.2, Math.max(0.045, lw * 0.22));
  let gap = Math.min(0.32, Math.max(eyeSize * 1.12, lw * 0.26));
  if (gap + eyeSize > lw * 1.1) { eyeSize = Math.max(0.035, lw * 0.42); gap = eyeSize * 1.12; } // very narrow (bottle)
  const mw = Math.min(0.3, Math.max(0.06, (m.b - m.a) * 0.4));
  return { leftEye: { x: ex - gap / 2, y: e.y }, rightEye: { x: ex + gap / 2, y: e.y }, eyeSize, mouth: { x: (m.a + m.b) / 2, y: m.y, width: mw } };
}
const clamp01 = (v) => Math.min(0.99, Math.max(0.01, v));
