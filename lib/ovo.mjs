// dissPICable - OBJECT vs OBJECT. Two snaps (two trainers' phones, or one phone twice) each run the normal
// character pipeline (lib/duet.mjs buildSong: Gemma character + cut-out + designed ElevenLabs voice) in parallel.
// Then the two objects rap battle EACH OTHER: one intro line each, then verses A -> B -> A -> B (BATTLE_ROUNDS rounds),
// every verse answering the opponent's last one. Verses are generated in a chain as soon as both objects are awake,
// so verse N+1 is cooking while verse N plays. Crowd votes per round (values ovo_a / ovo_b) decide 70% of the verdict,
// the AI judge (rubric + Gemma wit) 30%. Trainers' phones send HYPE (visual meter + tiebreak).
// Events: ovo-photo, ovo-slot-ready, ovo-slot-failed, ovo-ready, ovo-hype, ovo-vote (sent by the stage), ovo-verdict.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { mask } from "./safety.mjs";
import { scoreBattle, rubricText } from "./rubric.mjs";

const INTRO_CHARS = 90;
const VERSE_CHARS = 240;
const ROAST_CHARS = 150;
const AI_DELIVERY = 7; // both rappers are AI voices: delivery is fixed, not judged
const CROWD_SHARE = 0.7;

const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const normObject = (s) => words(s).filter((w) => !["a", "an", "the", "my", "some"].includes(w)).join(" ");
const capChars = (s, n) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : s.slice(0, n)).replace(/[,;:\-\s]+$/, "");
};
function silentMp3(ms) {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0xc4;
  return Buffer.concat(Array(Math.max(4, Math.ceil(ms / 26.122))).fill(frame));
}
const newId = () => "o_" + crypto.randomBytes(5).toString("hex");
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const possessive = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

// MOCK: the second object (the first is lib/duet.mjs's Mug Jagger).
const MOCK_B = { object: "lanyard", character: { name: "Lanyard Lil", personality: "a VIP-pass lanyard who thinks she runs every event", voiceStyle: "young Mancunian woman, sharp, sarcastic", catchphrase: "Not on the list, love", colour: "#4da3ff" },
  face: { leftEye: { x: 0.4, y: 0.34 }, rightEye: { x: 0.6, y: 0.34 }, eyeSize: 0.12, mouth: { x: 0.5, y: 0.56, width: 0.22 } },
  bbox: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } };
const MOCK_INTRO = (A, B) => [`[scoffs] ${B.character.name}? I've had teabags with more presence, love.`, `[laughs] Big talk from a chipped ${A.object}. Let's have it then.`];
const MOCK_VERSES = (tA, tB) => [
  `[rapping] Look at this lanyard, hanging round like a noose / I'm a mug full of bars, you're a string on the loose / you open doors for a living, mate, that's not a career / I'm the hottest thing in Manc, get your badge out of HERE`,
  `[rapping] Hottest thing in Manc? You're a cup of cold tea / string on the loose? I hold the keys, you hold PG / your handle's chipped, your rim's stained, ${tA} is in denial / I'm hanging round a neck, our kid, cos I hang out in STYLE`,
  `[rapping] Hang out in style? You're a ribbon on a hook / ${tB} wears you to a hack day, never once took a look / I'm on every desk in the building, warm in every hand / you're a cheap bit of polyester, I'm the brew of the LAND`,
  `[rapping] Brew of the land? You're a souvenir from Blackpool / chipped since ninety-six, the mug that time forgot, fool / ${tA} sips from you daily and he still can't spit a bar / I'm the VIP pass, you're stuck queuing at the BAR`,
  `[rapping] Queuing at the bar? I AM the bar, love, pour me / you're a plastic clip with a photo nobody wants to see / I've got steam, I've got heat, I've got Mancunian soul / you've got a barcode and a lanyard-shaped HOLE`,
  `[rapping] Lanyard-shaped hole? That's the gap in your rhyme / you're a mug that got mugged, mate, wasting my time / I'm the pass to the party, you're the cup in the sink / go and sit on the side, love, and have a long THINK`,
];

export function createOvo({ here, env, gemma, remember, duet, players, broadcast, readJson, sendJson, crowdTally }) {
  const cacheDir = path.join(process.env.DUET_DATA_DIR || here, "cache");
  const H = duet.helpers;
  const sessions = new Map();
  let cur = null; // the OvO match being snapped / played
  const quiet = (p, what) => p.catch((e) => { console.warn(`[ovo] ${what}`, e.message); return null; });
  const tone = (d) => duet.toneBlock?.(d) || "Tone: cheeky Manc battle-rap roasting. No slurs, nothing about protected traits or real people, no strong swearing.";
  const tags = (d) => duet.tagRule?.(d) || "Delivery tags: 1-2 Eleven v3 audio tags like [laughs] in square brackets.";
  const RAP_RULE = H.RAP_RULE || `exactly 4 bars separated by " / ", strong end rhymes.`;
  const split = (t, cap) => H.splitTags(t, cap);
  const rounds = () => Math.max(1, Math.min(3, Number(duet.battleCfg?.().rounds) || 2));
  const sideKey = (i) => (i === 0 ? "ovo_a" : "ovo_b");

  /** Public view of a session (no promises). */
  function pub(s) {
    return {
      id: s.id, ovo: true, mock: !!s.mock, difficulty: s.difficulty, rounds: s.rounds, title: s.title || "",
      trainers: s.trainers, hype: s.hype, intro: s.intro || [],
      sides: s.sides.map((x) => ({ slot: x.slot, status: x.status, photo: x.photo, object: x.object, character: x.character, face: x.face, outline: x.outline, bbox: x.bbox, trainerName: x.trainerName, value: sideKey(x.slot), rematch: x.rematch || null })),
      verdict: s.verdict || null,
    };
  }
  async function voice(name, said, s, voiceId) {
    const fallback = () => ({ ...H.publishAudio(name, silentMp3(1200 + said.display.length * 55)), ...(s.mock ? {} : { ttsFailed: true }) });
    if (s.mock) return fallback();
    try { return H.publishAudio(name, fs.readFileSync(await H.tts(said.speech, voiceId))); }
    catch (e) { console.warn("[ovo] tts", e.message); return fallback(); }
  }
  const label = (x) => `${x.character.name} (a ${x.object}${x.trainerName ? `, snapped by ${x.trainerName}` : ""}; ${x.character.personality})`;
  function log(s, upTo) {
    const out = [];
    s.intro?.forEach((l, i) => out.push(`${s.sides[i].character.name} (intro): "${l.text}"`));
    for (let n = 1; n < upTo; n++) { const v = s.verses[n]; if (v) out.push(`${s.sides[v.side].character.name} (verse ${n}): "${v.text}"`); }
    return out.join("\n");
  }

  // ---------- snapping ----------
  function newSession(mock) {
    const trainers = players.ovoTrainers?.() || null;
    const s = { id: newId(), mock, difficulty: duet.getDifficulty?.() || "spicy", rounds: rounds(), trainers, hype: [0, 0], started: false, verses: [], versePs: [],
      sides: [0, 1].map((slot) => ({ slot, status: "waiting", trainerName: trainers?.[slot]?.name || "" })), at: Date.now() };
    sessions.set(s.id, s);
    if (sessions.size > 30) sessions.delete(sessions.keys().next().value);
    return s;
  }

  async function object(req, res) {
    const b = await readJson(req);
    const mock = env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url || "");
    if (!b.image?.data) return sendJson(res, 400, { error: "send { image: { data: base64, mime } }" });
    if (!cur || cur.started || cur.verdict || Date.now() - cur.at > 10 * 60 * 1000) cur = newSession(mock);
    const s = cur;
    const pid = typeof b.player === "string" ? b.player : "";
    let slot = [0, 1].find((i) => pid && s.trainers?.[i]?.id === pid && s.sides[i].status === "waiting") ?? -1;
    if (slot < 0) slot = s.sides.findIndex((x) => x.status === "waiting");
    if (slot < 0) return sendJson(res, 409, { error: "Both objects are already snapped - watch the stage!" });
    const side = s.sides[slot];
    const sid = `${s.id}_${slot ? "b" : "a"}`;
    fs.writeFileSync(path.join(cacheDir, `${sid}.jpg`), Buffer.from(b.image.data, "base64"));
    Object.assign(side, { status: "waking", photo: `/api/photo/${sid}.jpg`, sid });
    if (!side.trainerName) side.trainerName = (pid && players.get?.(pid)?.name) || "";
    broadcast({ type: "ovo-photo", id: s.id, slot, photo: side.photo, trainerName: side.trainerName, at: Date.now() });
    const other = 1 - slot;
    const snapAgain = s.sides[other].status === "waiting" && (!s.trainers?.[other] || s.trainers[other].id === pid);
    sendJson(res, 200, { ovo: true, id: s.id, slot, snapAgain, photo: side.photo, waitingFor: snapAgain ? null : s.trainers?.[other]?.name || null });
    wake(s, slot, b.image).catch((e) => console.warn("[ovo] wake", e.message));
  }

  async function wake(s, slot, image) {
    const side = s.sides[slot];
    let made = null;
    try { made = await withTimeout(H.buildSong({ id: side.sid, image: { data: image.data, mime: image.mime || "image/jpeg" }, mock: s.mock, mode: "battle", difficulty: s.difficulty, noMusic: true }), 70000); }
    catch (e) { console.warn("[ovo] buildSong", e.message); }
    if (s.dead || s.verdict) return;
    if (!made) {
      Object.assign(side, { status: "waiting", photo: null });
      broadcast({ type: "ovo-slot-failed", id: s.id, slot, at: Date.now() });
      return;
    }
    if (s.mock && slot === 1) made = { ...made, ...MOCK_B, character: { ...MOCK_B.character }, voiceId: "mock" };
    Object.assign(side, { status: "ready", object: made.object, character: made.character, face: made.face, outline: s.mock && slot === 1 ? undefined : made.outline, bbox: made.bbox, voiceId: made.voiceId });
    side.charId = H.upsertRoster?.({ mock: s.mock, sessionId: side.sid, made }) || null;
    const k = H.loadKnown?.() || {};
    const key = (s.mock ? "mock|" : "") + normObject(made.object);
    k[key] = { ...(k[key] || {}), object: made.object, character: made.character, face: made.face, voiceId: made.voiceId, seen: (k[key]?.seen || 0) + 1, at: Date.now() };
    side.history = k[key].ovo || [];
    try { H.saveKnown?.(k); } catch { /* read-only */ }
    broadcast({ type: "ovo-slot-ready", id: s.id, slot, side: pub(s).sides[slot], at: Date.now() });
    if (s.sides.every((x) => x.status === "ready") && !s.started) start(s).catch((e) => console.warn("[ovo] start", e.message));
  }

  // ---------- the battle ----------
  async function start(s) {
    s.started = true;
    const [A, B] = s.sides;
    if (A.character.name === B.character.name && !s.mock) B.character = { ...B.character, name: `${B.character.name} II` };
    // Rematch? (who beat whom last time, from cache/characters.json)
    [A, B].forEach((x, i) => {
      const o = s.sides[1 - i];
      const last = (x.history || []).find((h) => h.vs === o.character.name);
      if (last) x.rematch = { won: !!last.won, best: last.best || "" };
    });
    s.title = `${A.trainerName ? possessive(A.trainerName) + " " : ""}${A.object} vs ${B.trainerName ? possessive(B.trainerName) + " " : ""}${B.object}`;
    for (let n = 1; n <= s.rounds * 2; n++) s.versePs[n] = deferred();
    // Intro: one line each, one Gemma call.
    let lines = null;
    if (!s.mock) {
      const re = [A, B].map((x, i) => (x.rematch ? `${x.character.name} ${x.rematch.won ? "BEAT" : "LOST TO"} ${s.sides[1 - i].character.name} last time${x.rematch.best ? ` (best line: "${x.rematch.best}")` : ""}: mention it.` : "")).filter(Boolean).join(" ");
      const r = await quiet(withTimeout(gemma({ prompt: `Two snapped objects come alive for an OBJECT vs OBJECT rap battle at a Manchester hack day.
A: ${label(A)}. Catchphrase: "${A.character.catchphrase}".
B: ${label(B)}. Catchphrase: "${B.character.catchphrase}".
${re}
Write ONE trash-talk intro line for each (max ${INTRO_CHARS} characters each), A squaring up to B, then B firing back at A's line. In character, cheeky Manc.
${tags(s.difficulty)}
${tone(s.difficulty)}
Return JSON: {"a":"","b":""}`, json: true, temperature: 1, maxTokens: 400 }), 9000), "intro");
      if (r?.json?.a && r?.json?.b) lines = [String(r.json.a), String(r.json.b)];
    }
    if (!lines) lines = s.mock ? MOCK_INTRO(A, B) : [`[scoffs] ${B.character.name}? Is that it? I've seen scarier things in a cupboard.`, `[laughs] Big words from a ${A.object}. Go on then, let's have it.`];
    const saids = lines.map((t) => split(t, INTRO_CHARS));
    s.intro = await Promise.all(saids.map(async (said, i) => ({ side: i, text: said.display, ...(await voice(`${s.id}_intro${i}.mp3`, said, s, s.sides[i].voiceId)) })));
    s.chain = verseChain(s); // verse 1 starts cooking while the stage plays the intro
    broadcast({ type: "ovo-ready", session: pub(s), at: Date.now() });
  }

  async function verseChain(s) {
    const tA = s.sides[0].trainerName || "your owner", tB = s.sides[1].trainerName || "your owner";
    const canned = MOCK_VERSES(tA, tB);
    for (let n = 1; n <= s.rounds * 2; n++) {
      if (s.verdict || s.dead) return;
      const t0 = Date.now();
      const side = (n - 1) % 2, me = s.sides[side], them = s.sides[1 - side];
      const prev = n === 1 ? s.intro[1]?.text : s.verses[n - 1]?.text;
      let text = "";
      if (!s.mock) {
        const r = await quiet(withTimeout(gemma({ prompt: `You are ${label(me)}, in an OBJECT vs OBJECT rap battle against ${label(them)}. Round ${Math.ceil(n / 2)} of ${s.rounds}.
Battle so far:
${log(s, n)}
${them.character.name}'s last line: "${prev || ""}"
Write YOUR verse. It MUST answer that line: quote or twist at least one of their actual words back at them, then roast the ${them.object} (what it is, what it does, how it looks as an object)${them.trainerName ? ` and lightly tease ${them.trainerName}, who snapped it` : ""}. Big yourself up as a ${me.object}. Max ${VERSE_CHARS} characters.
${RAP_RULE}
${tags(s.difficulty)}
${tone(s.difficulty)}
Return JSON: {"text":""}`, json: true, temperature: 1, maxTokens: 500 }), 12000), `verse ${n}`);
        text = String(r?.json?.text || "").trim();
      }
      if (!text) text = canned[(n - 1) % canned.length];
      if (!s.mock && text === canned[(n - 1) % canned.length]) text = text.replace(/lanyard|mug/gi, (w) => (w.toLowerCase() === "mug" ? me.object.split(" ").pop() : them.object.split(" ").pop()));
      const said = split(text, VERSE_CHARS);
      const v = { n, side, text: said.display, speech: said.speech, ...(await voice(`${s.id}_v${n}.mp3`, said, s, me.voiceId)), cookMs: Date.now() - t0 };
      s.verses[n] = v;
      console.log(`[ovo] verse ${n} (${me.character.name}) ready in ${v.cookMs} ms`);
      s.versePs[n].resolve(v);
    }
  }

  async function verse(req, res) {
    const b = await readJson(req);
    const s = sessions.get(String(b.id || ""));
    if (!s || !s.started) return sendJson(res, 404, { error: "no OvO battle" });
    const n = Math.round(Number(b.n));
    if (!s.versePs[n]) return sendJson(res, 400, { error: "no such verse" });
    try { const { speech: _s, ...v } = await withTimeout(s.versePs[n].promise, 45000); sendJson(res, 200, v); }
    catch { sendJson(res, 504, { error: "verse took too long" }); }
  }

  const hypeAt = new Map();
  async function hype(req, res) {
    const b = await readJson(req);
    const s = sessions.get(String(b.id || ""));
    const side = Number(b.side);
    if (!s || !(side === 0 || side === 1)) return sendJson(res, 404, { error: "no OvO battle" });
    if (s.verdict) return sendJson(res, 409, { error: "battle's over" });
    const k = `${String(b.client || b.player || "x").slice(0, 40)}|${side}`, now = Date.now();
    if (now - (hypeAt.get(k) || 0) < 250) return sendJson(res, 429, { error: "easy, tiger" });
    hypeAt.set(k, now);
    if (hypeAt.size > 500) hypeAt.delete(hypeAt.keys().next().value);
    s.hype[side]++;
    broadcast({ type: "ovo-hype", id: s.id, side, hype: s.hype, name: String(b.name || "").slice(0, 16), at: now });
    sendJson(res, 200, { ok: true, hype: s.hype });
  }

  // ---------- verdict ----------
  async function judge(b, req, res) {
    const s = sessions.get(String(b.id || ""));
    if (!s || !s.started) return sendJson(res, 404, { error: "no OvO battle" });
    if (s.verdict) return sendJson(res, 200, s.verdict);
    await Promise.race([s.chain, new Promise((r) => setTimeout(r, 20000))]);
    const [A, B] = s.sides;
    const marks = [0, 1].map((i) => {
      const rs = [];
      for (let n = i + 1; n <= s.rounds * 2; n += 2) rs.push({ transcript: s.verses[n]?.text || "", prev: n === 1 ? s.intro?.[1]?.text || "" : s.verses[n - 1]?.text || "" });
      return { rs, best: capChars([...rs].sort((x, y) => words(y.transcript).length - words(x.transcript).length)[0]?.transcript || "", 120) };
    });
    const score = (m, wit) => {
      const rub = scoreBattle(m.rs, { turnMs: 8000, difficulty: "spicy", wit });
      const c = { ...rub.categories, delivery: AI_DELIVERY };
      const ai = Math.round(Math.max(0, Math.min(100, c.delivery * 3 + c.rhymes * 2.5 + c.comebacks * 2.5 + c.wit * 2)));
      return { rub, categories: c, reasons: { ...rub.reasons, delivery: "AI voice - fixed for both" }, ai };
    };
    let res0 = marks.map((m) => score(m, null));
    let roasts = null, why = ["", ""];
    if (!s.mock) {
      const r = await quiet(withTimeout(gemma({ prompt: `Judge an OBJECT vs OBJECT rap battle between A: ${label(A)} and B: ${label(B)}.
${log(s, s.rounds * 2 + 1)}

Already measured in code (do not change): A: ${rubricText(res0[0].rub)} | B: ${rubricText(res0[1].rub)}
For each: wit 0-10 (how funny/clever, and how well they flipped the other's lines), why (max 70 chars, one reason), best (their best bar VERBATIM).
Also write two FINAL ROASTS, each max ${ROAST_CHARS} characters, spoken by the winner to the loser: "ab" = A won and roasts B, "ba" = B won and roasts A. ${tags(s.difficulty)}
${tone(s.difficulty)}
Return JSON: {"a":{"wit":5,"why":"","best":""},"b":{"wit":5,"why":"","best":""},"ab":"","ba":""}`, json: true, temperature: 0.9, maxTokens: 900 }), 12000), "judge");
      const j = r?.json || {};
      ["a", "b"].forEach((k, i) => {
        const x = j[k];
        if (!x || typeof x !== "object") return;
        if (Number.isFinite(Number(x.wit))) res0[i] = score(marks[i], Number(x.wit));
        if (x.why) why[i] = capChars(mask(x.why), 90);
        if (x.best && words(x.best).length > 2) marks[i].best = capChars(mask(x.best), 120);
      });
      if (j.ab && j.ba) roasts = [String(j.ab), String(j.ba)];
    }
    const tally = crowdTally ? crowdTally(s.id) : null;
    const by = tally?.byValue || {};
    const va = by.ovo_a || 0, vb = by.ovo_b || 0, vt = va + vb;
    const crowdPct = vt ? [Math.round((va / vt) * 100), Math.round((vb / vt) * 100)] : [50, 50];
    const final = [0, 1].map((i) => Math.round(CROWD_SHARE * crowdPct[i] + (1 - CROWD_SHARE) * res0[i].ai));
    let w = final[0] === final[1] ? (res0[0].ai === res0[1].ai ? (s.hype[1] > s.hype[0] ? 1 : 0) : res0[1].ai > res0[0].ai ? 1 : 0) : final[1] > final[0] ? 1 : 0;
    const win = s.sides[w], lose = s.sides[1 - w];
    let roastText = roasts?.[w];
    if (!roastText) roastText = `[laughs] ${lose.character.name}, go back to being a ${lose.object}, love. ${win.character.catchphrase}!`;
    const said = split(roastText, ROAST_CHARS);
    const audio = await voice(`${s.id}_final.mp3`, said, s, win.voiceId);
    const list = [0, 1].map((i) => ({ side: i, value: sideKey(i), name: s.sides[i].character.name, object: s.sides[i].object, trainerName: s.sides[i].trainerName, score: final[i], ai: res0[i].ai, crowd: { votes: [va, vb][i], pct: crowdPct[i] }, hype: s.hype[i], categories: res0[i].categories, reasons: res0[i].reasons, why: why[i], best: marks[i].best, winner: i === w }));
    const out = { id: s.id, winner: w, winnerName: win.character.name, winnerObject: win.object, winnerTrainer: win.trainerName, loserName: lose.character.name, roast: said.display, audio: audio.audio, ms: audio.ms, sides: list, votes: vt, crowdShare: CROWD_SHARE };
    s.verdict = out;
    // Memory: both characters remember who beat whom (disk now, NMAFC in the background).
    try {
      const k = H.loadKnown?.() || {};
      [0, 1].forEach((i) => {
        const x = s.sides[i], o = s.sides[1 - i];
        const key = (s.mock ? "mock|" : "") + normObject(x.object);
        if (!k[key]) return;
        k[key].ovo = [{ vs: o.character.name, vsObject: o.object, won: i === w, score: final[i], best: marks[i].best, at: Date.now() }, ...(k[key].ovo || [])].slice(0, 5);
        Object.assign(k[key], { lastWinner: i === w ? x.character.name : o.character.name, lastBest: marks[i].best });
        H.rosterScore?.(x.charId, final[i]);
      });
      H.saveKnown?.(k);
    } catch (e) { console.warn("[ovo] known", e.message); }
    if (!s.mock && remember) quiet(remember(`OBJECT vs OBJECT rap battle: ${A.character.name} the ${A.object}${A.trainerName ? ` (${possessive(A.trainerName)})` : ""} vs ${B.character.name} the ${B.object}${B.trainerName ? ` (${possessive(B.trainerName)})` : ""}. Winner: ${win.character.name} beat ${lose.character.name} ${final[w]}-${final[1 - w]}. ${A.character.name}'s best line: "${marks[0].best}". ${B.character.name}'s best line: "${marks[1].best}".`), "remember");
    broadcast({ type: "ovo-verdict", ...out, at: Date.now() });
    sendJson(res, 200, out);
  }

  return {
    object, judge,
    routes: {
      "POST /api/ovo/verse": verse,
      "POST /api/ovo/hype": hype,
      "GET /api/ovo/state": async (req, res) => sendJson(res, 200, cur ? pub(cur) : { id: null }),
    },
    has: (id) => sessions.has(String(id || "")),
    info: (id) => { const s = sessions.get(String(id || "")); return s ? { rounds: s.rounds, done: !!s.verdict } : null; },
    /** reset from the stage: drop a half-snapped match, stop a running chain. */
    reset() { if (cur) { cur.dead = true; for (const d of cur.versePs) d?.resolve?.(null); } cur = null; },
  };
}
