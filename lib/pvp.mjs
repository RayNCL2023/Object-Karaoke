// dissPICable - PLAYER vs PLAYER battles. The snapped object becomes the MC (same googly-eyed character as
// the normal battle), introduces both players, then turns alternate P1 -> P2 for 3 rounds each (6 turns).
// The stage drives it with its normal battle loop (battle.rounds = 6); server.mjs routes /api/object, /api/take
// and /api/judge here for PvP sessions and tags each record-start with the player whose turn it is.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { mask, cleanSpeech } from "./safety.mjs";
import { scoreBattle, rubricText } from "./rubric.mjs";

const ROUNDS_EACH = 3;
const TURNS = ROUNDS_EACH * 2;
const YOU_MS = 12000;
const INTRO_CHARS = 200;
const REACT_CHARS = 120;
const ROAST_EACH = 90;

const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const capChars = (s, n) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : s.slice(0, n)).replace(/[,;:\-\s]+$/, "");
};
const stripTags = (s) => String(s || "").replace(/\[[^\]]*\]?/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\s+/g, " ").trim();
/** Cap a line that may carry Eleven v3 [audio tags]. Returns { speech (tags kept), display (tags stripped) }. */
function splitTags(raw, cap) {
  let speech = capChars(String(raw || "").replace(/\(([a-z ]{3,24})\)/gi, "[$1]"), cap).replace(/\[[^\]]*$/, "").trim();
  let n = 0;
  speech = speech.replace(/\[([^\]]*)\]/g, (m, t) => (t.trim().length && t.length <= 30 && ++n <= 3 ? `[${t.trim().toLowerCase()}]` : " ")).replace(/\s+/g, " ").trim();
  return { speech: cleanSpeech(speech), display: mask(stripTags(speech)) }; // swear/slur filter
}
function silentMp3(ms) {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0xc4;
  return Buffer.concat(Array(Math.max(4, Math.ceil(ms / 26.122))).fill(frame));
}
const newId = () => "s_" + crypto.randomBytes(5).toString("hex");
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

const MOCK_BARS = [
  ["you rap like a microwave, all hum and no heat, mate", "you call that a bar? my nan spits harder than you"],
  ["heat? you're colder than Piccadilly in January our kid", ""],
  ["silent again? you froze harder than my overdraft", "at least I turned up, you've been reading off your phone"],
];

export function createPvp({ here, env, gemma, remember, duet, players, broadcast, readJson, sendJson, crowdTally }) {
  const cacheDir = path.join(process.env.DUET_DATA_DIR || here, "cache");
  const sessions = new Map();
  const H = duet.helpers;
  const quiet = (p, what) => p.catch((e) => { console.warn(`[pvp] ${what}`, e.message); return null; });
  const difficulty = () => duet.getDifficulty?.() || "spicy";
  const tone = (d) => duet.toneBlock?.(d) || "Tone: cheeky Manc battle-rap roasting of the PERFORMANCE only. No slurs, nothing about protected traits, appearance or real people, no strong swearing.";
  const tags = (d) => duet.tagRule?.(d) || "Delivery tags: put 1-2 Eleven v3 audio tags like [laughs] or [scoffs] in square brackets. No other brackets.";

  /** Speak a line in the MC's voice (silent MP3 in MOCK / on failure). */
  async function voice(name, said, s) {
    const fallback = () => ({ ...H.publishAudio(name, silentMp3(1200 + said.display.length * 55)), ...(s.mock ? {} : { ttsFailed: true }) });
    if (s.mock) return fallback();
    try { return H.publishAudio(name, fs.readFileSync(await H.tts(said.speech, s.voiceId))); }
    catch (e) { console.warn("[pvp] tts", e.message); return fallback(); }
  }
  const turnPlayer = (s, turn) => s.pvp.players[(turn - 1) % 2];
  function log(s) {
    const out = [`MC ${s.character.name} (intro): "${s.song.lines[0]?.text || ""}"`];
    for (let t = 1; t <= TURNS; t++) {
      const r = s.turns[t];
      if (!r) continue;
      out.push(`${turnPlayer(s, t).name} (round ${Math.ceil(t / 2)}): ${r.transcript ? `"${r.transcript}"` : "(silence, they froze)"}`);
      if (r.comeback?.text) out.push(`MC: "${r.comeback.text}"`);
    }
    return out.join("\n");
  }
  const mcIntro = (s) => `You are ${s.character.name}, a ${s.object} (${s.character.personality}), the MC and host of a live PLAYER vs PLAYER freestyle roast battle at a Manchester hack day. Two humans battle each other, you host and stir it up.`;

  /** Heuristic per-player marks (MOCK + fallback if Gemma fails). */
  // Transparent rubric (lib/rubric.mjs). COMEBACKS = overlap with the OTHER player's previous verse (turn 1: the MC intro).
  function heuristic(s, idx, wit = null) {
    const said = [], rounds = [];
    for (let t = idx + 1; t <= TURNS; t += 2) {
      const tr = s.turns[t]?.transcript || "";
      if (words(tr).length) said.push(tr);
      rounds.push({ transcript: tr, prev: t === 1 ? s.song.lines[0]?.text || "" : s.turns[t - 1]?.transcript || "" });
    }
    const rub = scoreBattle(rounds, { turnMs: YOU_MS, difficulty: s.difficulty, wit });
    const sorted = [...said].sort((a, b) => words(b).length - words(a).length);
    return { categories: rub.categories, reasons: rub.reasons, silent: rub.silent, rub, score: rub.score, best: capChars(sorted[0] || "silence", 120), roast: "" };
  }

  async function object(req, res) {
    const mock = env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url || "");
    const pair = players.pvpPair();
    const { image } = await readJson(req);
    if (!image?.data) return sendJson(res, 400, { error: "send { image: { data: base64, mime } }" });
    if (!pair) return sendJson(res, 409, { error: "Host hasn't picked two players yet" });
    const id = newId();
    fs.writeFileSync(path.join(cacheDir, `${id}.jpg`), Buffer.from(image.data, "base64"));
    const photo = `/api/photo/${id}.jpg`;
    broadcast({ type: "photo-received", id, photo, pvp: true, at: Date.now() });
    const d = difficulty();
    // Same character pipeline as the normal battle (name, voice, googly-eye face, cut-out), then a PvP intro.
    const made = await H.buildSong({ id, image: { data: image.data, mime: image.mime || "image/jpeg" }, mock, mode: "battle", difficulty: d });
    const s = { id, photo, returning: false, object: made.object, character: made.character, face: made.face, outline: made.outline, bbox: made.bbox, voiceId: made.voiceId, mode: "battle", difficulty: d, battle: { rounds: TURNS, youMs: YOU_MS }, pvp: { players: pair, roundsEach: ROUNDS_EACH }, ...(mock ? { mock: true } : {}) };
    s.turns = {};
    const [p1, p2] = pair;
    let text = "";
    if (!mock) {
      const r = await quiet(withTimeout(gemma({ prompt: `${mcIntro(s)}
Introduce the two players, ${p1.name} and ${p2.name}, with ONE savage hype intro: 2-3 short rhyming bars, max ${INTRO_CHARS} characters total, roasting BOTH of them by name (their nerve, their chances, stood at a hack day rapping at each other in front of a ${s.object}), bigging yourself up as the host, and telling ${p1.name} to go first. Rappable out loud.
${tags(d)}
${tone(d)}
Return JSON: {"text":""}`, json: true, temperature: 1, maxTokens: 400 }), 9000), "intro");
      text = String(r?.json?.text || "").trim();
    }
    if (!text) text = `[scoffs] ${p1.name} versus ${p2.name}? Two muppets, one mic, and me, the finest ${s.object} in Manchester. [laughs] ${p1.name}, you're up, don't bottle it.`;
    const said = splitTags(text, INTRO_CHARS);
    const genre = made.song?.genre || "hip hop";
    s.song = { title: capChars(`${p1.name} vs ${p2.name}`, 60), genre, bpm: made.song?.bpm || 92, key: made.song?.key || "C", battle: s.battle, lines: [{ who: "object", text: said.display, speech: said.speech, ...(await voice(`${id}_0.mp3`, said, s)) }] };
    sessions.set(id, s);
    const { turns: _t, ...session } = s;
    broadcast({ type: "song-ready", session, at: Date.now() });
    sendJson(res, 200, session);
  }

  async function take(body, req, res) {
    const s = sessions.get(body.id);
    const turn = Math.max(1, Math.min(TURNS, Math.round(Number(body.round ?? body.line)) || 1));
    const who = turnPlayer(s, turn), other = turnPlayer(s, turn + 1);
    const t0 = Date.now();
    let transcript = "";
    const takeBytes = body.audio ? Math.floor(String(body.audio).length * 3 / 4) : 0;
    const silentTake = !s.mock && (body.silent === true || (!!body.audio && takeBytes < 2048)); // < 2 KB = no real audio
    if (body.audio || body.silent) console.log(`[pvp] take ${s.id} t${turn}: ${takeBytes} B, ${Math.round(Number(body.durationMs) || 0)} ms${silentTake ? " (silent)" : ""}`);
    if (s.mock) transcript = typeof body.transcript === "string" ? body.transcript : MOCK_BARS[Math.ceil(turn / 2) - 1]?.[(turn - 1) % 2] || ""; // MOCK test hook
    else if (body.audio && !silentTake) { try { transcript = await H.stt(body.audio, body.mime); } catch (e) { console.warn("[pvp] stt", e.message); } }
    transcript = mask(capChars(transcript, 400));
    const base = { round: turn, line: turn, player: who.id, playerName: who.name, pvpRound: Math.ceil(turn / 2), voteOpen: turn % 2 === 0 };
    broadcast({ type: "take-heard", id: s.id, ...base, transcript, at: Date.now() });
    s.turns[turn] = { transcript, comeback: null };
    const last = turn >= TURNS;
    let comeback = null;
    if (!last) { // the MC's one-liner: hype or diss what was just said, then hand over
      let text = "";
      if (!s.mock) {
        const r = await quiet(withTimeout(gemma({ prompt: `${mcIntro(s)} Turn ${turn} of ${TURNS}.
Battle so far:
${log(s)}
${who.name} just spat: ${transcript ? `"${transcript}"` : "NOTHING, they froze."}
Write ONE short MC reaction, max ${REACT_CHARS} characters: hype or diss ${who.name}'s bar (quote or twist their actual words${transcript ? "" : ", mock the silence"}), then hand the mic to ${other.name}. Punchy, spoken out loud.
${tags(s.difficulty)}
${tone(s.difficulty)}
Return JSON: {"text":""}`, json: true, temperature: 1, maxTokens: 250 }), 7000), "react");
        text = String(r?.json?.text || "").trim();
      }
      if (!text) text = transcript ? `[laughs] "${capChars(transcript, 40)}"? Ooh, ${who.name}! ${other.name}, answer that.` : `[scoffs] Nowt from ${who.name}! ${other.name}, put them out of their misery.`;
      const said = splitTags(text, REACT_CHARS);
      comeback = { text: said.display, ...(await voice(`${s.id}_mc${turn}.mp3`, said, s)) };
      s.turns[turn].comeback = comeback;
    }
    const out = { ...base, transcript, comeback, last, ms: Date.now() - t0 };
    broadcast({ type: "take-received", id: s.id, ...out, at: Date.now() });
    sendJson(res, 200, out);
  }

  async function judge(body, req, res) {
    const s = sessions.get(body.id);
    const [p1, p2] = s.pvp.players;
    const marks = [heuristic(s, 0), heuristic(s, 1)];
    let winnerIdx = null;
    if (!s.mock) {
      const r = await quiet(withTimeout(gemma({ prompt: `${mcIntro(s)} The battle is over. Judge BOTH players ONLY on what they actually said:
${log(s)}

The scorer has ALREADY measured these in code (do not change them):
p1 ${p1.name}: ${rubricText(marks[0].rub)}
p2 ${p2.name}: ${rubricText(marks[1].rub)}
For each player:
- wit: 0-10, how funny/clever their insults were (0 if silent, max 2 if they barely said anything).
- roast: ONE line, max ${ROAST_EACH} characters, roasting that player CONSISTENT with their numbers (silent or low = mock that, never praise it), quoting their bar if possible. ${tags(s.difficulty)}
- best: their best line VERBATIM from the transcripts (or "silence").
${tone(s.difficulty)}
Return JSON: {"p1":{"wit":5,"roast":"","best":""},"p2":{"wit":5,"roast":"","best":""}}`, json: true, temperature: 0.9, maxTokens: 900 }), 12000), "judge");
      const j = r?.json || {};
      ["p1", "p2"].forEach((k, i) => {
        const x = j[k];
        if (!x || typeof x !== "object") return;
        if (Number.isFinite(Number(x.wit))) marks[i] = { ...heuristic(s, i, Number(x.wit)), best: marks[i].best };
        const m = marks[i];
        if (x.roast && !m.silent) m.roast = String(x.roast);
        if (x.best && !m.silent && !/^n.?a$/i.test(String(x.best))) m.best = capChars(x.best, 120);
      });
    }
    [p1, p2].forEach((p, i) => {
      if (marks[i].roast) return;
      marks[i].roast = marks[i].best && marks[i].best !== "silence" ? `[scoffs] ${p.name}, "${capChars(marks[i].best, 40)}"? Is that your best, you melt?` : `[laughs] ${p.name} said nowt. Absolute weapon.`;
    });
    // Crowd votes per round (lib/audience.mjs, value = player id): up to +/-10 per player.
    const tally = crowdTally ? crowdTally(s.id) : null;
    const by = tally?.byValue || {};
    const v1 = by[p1.id] || 0, v2 = by[p2.id] || 0, vt = v1 + v2;
    const bonus = vt ? [Math.round(((v1 - v2) / vt) * 10), Math.round(((v2 - v1) / vt) * 10)] : [0, 0];
    marks.forEach((m, i) => { m.score = Math.round(Math.min(100, Math.max(0, m.score + bonus[i]))); });
    if (marks[0].score !== marks[1].score || winnerIdx == null) winnerIdx = marks[1].score > marks[0].score ? 1 : 0;
    const win = [p1, p2][winnerIdx], lose = [p1, p2][1 - winnerIdx];
    const roasts = marks.map((m) => splitTags(m.roast, ROAST_EACH));
    const spoken = `[shouting] ${win.name} takes it! ${roasts[winnerIdx].speech} ${roasts[1 - winnerIdx].speech}`;
    const display = `${win.name} takes it! ${roasts[winnerIdx].display} ${roasts[1 - winnerIdx].display}`;
    let audio = null;
    try { audio = (await voice(`${s.id}_roast.mp3`, { speech: spoken, display }, s)).audio; } catch (e) { console.warn("[pvp] roast audio", e.message); }
    const list = [p1, p2].map((p, i) => ({ ...p, score: marks[i].score, categories: marks[i].categories, reasons: marks[i].reasons, roast: roasts[i].display, best: marks[i].best, crowd: vt ? { votes: [v1, v2][i], bonus: bonus[i] } : null, winner: i === winnerIdx }));
    const out = { score: marks[winnerIdx].score, roast: display, audio, best: marks[winnerIdx].best, worst: marks[1 - winnerIdx].best, categories: marks[winnerIdx].categories, reasons: marks[winnerIdx].reasons, mode: "battle", pvp: { winner: win.id, winnerName: win.name, loserName: lose.name, players: list }, ...(vt ? { crowd: { player: v1, object: v2, bonus: bonus[0] } } : {}) };
    s.verdict = out;
    if (!s.mock && remember) quiet(remember(`${s.character.name} the ${s.object} hosted a player-vs-player roast battle: ${p1.name} (${marks[0].score}) vs ${p2.name} (${marks[1].score}). Winner: ${win.name}. ${p1.name}'s best line: "${marks[0].best}". ${p2.name}'s best line: "${marks[1].best}".`), "remember");
    broadcast({ type: "verdict", id: s.id, score: out.score, roast: out.roast, audio, best: out.best, worst: out.worst, categories: out.categories, reasons: out.reasons, crowd: out.crowd, pvp: out.pvp, at: Date.now() });
    sendJson(res, 200, out);
  }

  return {
    object, take, judge,
    has: (id) => sessions.has(String(id || "")),
    get: (id) => sessions.get(String(id || "")),
    /** Who raps on this turn (1-based) of a PvP session. */
    turnPlayer: (id, turn) => { const s = sessions.get(id); return s ? turnPlayer(s, Math.max(1, Number(turn) || 1)) : null; },
  };
}
