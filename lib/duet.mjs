// Duet Anything: the game logic behind /api/object, /api/take, /api/judge, /api/leaderboard.
// server.mjs passes in its helpers (gemma, voices, remember, recall, broadcast, readJson, sendJson, env).
// Everything generated (photos, MP3s, leaderboard, known characters) lives in cache/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ELEVEN = "https://api.elevenlabs.io/v1";
const TTS_MODEL = "eleven_multilingual_v2";
// Expressive, sing-song delivery: low stability = more emotion, style pushes the performance.
const VOICE_SETTINGS = { stability: 0.3, similarity_boost: 0.8, style: 0.65, use_speaker_boost: true };
const MAX_OBJECT_CHARS = 90;
const MAX_OBJECT_LINES = 4;
const MAX_YOU_WORDS = 10;
const ROAST_CHARS = 160;

// ---------- small helpers ----------
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const newId = () => "s_" + crypto.randomBytes(5).toString("hex");
const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const capChars = (s, n) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : s.slice(0, n)).replace(/[,;:\-\s]+$/, "");
};
const capWords = (s, n) => String(s || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
const youMs = (text) => words(text).length * 450 + 1200;
const mp3Ms = (bytes) => Math.round(bytes / 16); // 128 kbps = 16 bytes per ms
const normObject = (s) => words(s).filter((w) => !["a", "an", "the", "my", "some"].includes(w)).join(" ");
const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));
const PALETTE = ["#ff5a36", "#ffcc00", "#2ee6a6", "#4da3ff", "#ff4fa3", "#b06bff", "#ff8a00"];

/** A valid silent MP3 (MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono) lasting about `ms`. Used in MOCK mode. */
function silentMp3(ms) {
  const frame = Buffer.alloc(417); // 144 * 128000 / 44100 = 417 bytes, 1152 samples = 26.1 ms
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0xc4; // side info + main data all zero = silence
  const n = Math.max(4, Math.ceil(ms / 26.122));
  return Buffer.concat(Array(n).fill(frame));
}

// ---------- canned content for MOCK ----------
const MOCK_CHARACTER = { name: "Mug Jagger", personality: "washed-up rock star mug who peaked in 1996", voiceStyle: "older male, raspy, Northern", catchphrase: "Pour us another, our kid", colour: "#ff5a36" };
const mockSong = (returning) => ({
  title: "Brew Me Tender", genre: "britpop", bpm: 112, key: "C",
  lines: [
    { who: "object", text: returning ? "Back for more, are we? Last time you sang like a broken kettle!" : "I've been sat on this desk since the Hacienda shut its doors" },
    { who: "you", text: "Put the kettle on and sing it loud" },
    { who: "object", text: "Two sugars, no milk, I'm proper Manc to the core" },
    { who: "you", text: "Rain on the window, tea in my hand" },
    { who: "object", text: "Don't you dare dunk a biscuit in me, our kid" },
    { who: "you", text: "Buzzin' for a brew in Manchester" },
    { who: "object", text: "Pour us another, our kid, we're mint together" },
    { who: "you", text: "Best duet in the whole North West" },
  ],
});

// ---------- prompts ----------
function songPrompt({ object, memories, known }) {
  const memText = memories.length ? memories.map((m) => `- ${m}`).join("\n") : "- (nothing yet)";
  return `You are the writers' room for "Duet Anything", a live karaoke game at a Manchester hack day.
Look at the photo. The main object in it comes alive as a cheeky, friendly Mancunian character and sings a short karaoke DUET with the human player.
${object ? `A quick look says the object is: "${object}".` : ""}

Memories of objects this game has met before:
${memText}
${known ? `\nThis object HAS been here before. Keep EXACTLY this character: ${JSON.stringify(known)}. Set "returning": true and make the first object line greet the player back ("Back for more, are we?" energy) and mention their last score or roast.\n` : `\nIf a memory clearly describes this same object, keep its name, personality and voiceStyle, set "returning": true, and make the first object line reference the last score or roast. Otherwise invent a new character and set "returning": false.\n`}
Rules:
- Character name: a pun on the object plus a famous name or Manc flavour (e.g. "Mug Jagger", "Liam Gallaghergraph"). Personality: one funny line.
- voiceStyle: gender, age and accent words for picking a voice, e.g. "older male, raspy, British" or "young female, bubbly, British".
- colour: one bold hex accent that suits the object, like "#ff5a36".
- Song: an original, funny duet about being this object. genre is one of: britpop, madchester, disco, rock, ballad, hip hop, pop punk, northern soul. bpm 80-140. key like "C" or "A minor".
- Exactly 8 lines that alternate, starting with the object: object, you, object, you, object, you, object, you.
- Object lines: max ${MAX_OBJECT_CHARS} characters each, singable, cheeky, about its life as this object.
- "you" lines: what the human sings back, max ${MAX_YOU_WORDS} simple words, easy to read off a screen and sing.
- Manc slang welcome (our kid, mint, proper, buzzin', sound, our Nan, our kid, ta-ra). Friendly roasting only, nothing nasty, nothing about real people, no swearing.

Return this JSON shape:
{"object":"coffee mug","returning":false,"character":{"name":"","personality":"","voiceStyle":"","catchphrase":"","colour":"#ff5a36"},"song":{"title":"","genre":"","bpm":112,"key":"C","lines":[{"who":"object","text":""},{"who":"you","text":""}]}}`;
}

function judgePrompt(s, takes) {
  const lines = s.song.lines.map((l, i) => {
    if (l.who === "object") return `${i}. ${s.character.name}: "${l.text}"`;
    const t = takes[i];
    return `${i}. PLAYER should sing: "${l.text}" -> heard: ${t ? `"${t.transcript}" (accuracy ${Math.round(t.accuracy * 100)}%)` : "(nothing recorded, they bottled it)"}`;
  }).join("\n");
  return `You are ${s.character.name}, a ${s.object} with this personality: ${s.character.personality}. Catchphrase: "${s.character.catchphrase}".
You just sang the duet "${s.song.title}" (${s.song.genre}) with a human player. Here is how it went:
${lines}

Judge the player's singing like a cheeky Mancunian talent-show judge.
- score: whole number 0-100, mostly driven by the accuracy figures (avg accuracy x 100, nudged up to +/-15 for flair). Nothing recorded = low score.
- roast: max 2 short sentences, max ${ROAST_CHARS} characters total, in character, cheeky friendly Manc banter (our kid, mint, proper, buzzin', our Nan). Never nasty, no swearing.
- best: the player's best line (quote it, short).
- worst: the player's worst line (quote it, short).
Return JSON: {"score":72,"roast":"","best":"","worst":""}`;
}

// ---------- validation / repair ----------
function repairSong(raw, objectName) {
  const src = Array.isArray(raw?.lines) ? raw.lines : [];
  const clean = src.filter((l) => l && typeof l.text === "string" && l.text.trim());
  const objs = clean.filter((l) => String(l.who).toLowerCase() !== "you").map((l) => capChars(l.text, MAX_OBJECT_CHARS));
  const yous = clean.filter((l) => String(l.who).toLowerCase() === "you").map((l) => capWords(l.text, MAX_YOU_WORDS));
  const fillO = [`I'm the best ${objectName} in all of Manchester, our kid`, "Sing it with me now, don't be shy", "Proper mint, this, isn't it?", "Ta-ra for now, you were sound"];
  const fillY = ["La la la, I'm singing too", "Mint, our kid, mint", "Buzzin' for this duet", "Ta-ra, see you soon"];
  while (objs.length < 3) objs.push(fillO[objs.length]);
  while (yous.length < 3) yous.push(fillY[yous.length]);
  const pairs = Math.min(MAX_OBJECT_LINES, objs.length, yous.length);
  const lines = [];
  for (let i = 0; i < pairs; i++) { lines.push({ who: "object", text: objs[i] }); lines.push({ who: "you", text: yous[i] }); }
  const bpm = Math.round(Math.min(150, Math.max(70, Number(raw?.bpm) || 112)));
  return { title: capChars(raw?.title || `Ballad of the ${objectName}`, 60), genre: String(raw?.genre || "britpop").toLowerCase().slice(0, 30), bpm, key: String(raw?.key || "C").slice(0, 12), lines };
}

function repairCharacter(raw, objectName) {
  const c = raw || {};
  return {
    name: capChars(c.name || `Our Kid the ${objectName}`, 40),
    personality: capChars(c.personality || `a cheeky ${objectName} from Ancoats`, 120),
    voiceStyle: capChars(c.voiceStyle || "middle aged male, British", 80),
    catchphrase: capChars(c.catchphrase || "Buzzin', our kid", 80),
    colour: hexOk(c.colour) ? c.colour : PALETTE[Math.floor(Math.random() * PALETTE.length)],
  };
}

/** Score a voice against the voiceStyle words, using the ElevenLabs labels (gender / age / accent / description). */
function pickVoice(list, voiceStyle, avoid) {
  const style = String(voiceStyle || "").toLowerCase();
  const female = /\b(female|woman|girl|lady|feminine|her|she|nan|gran)\b/.test(style);
  const male = !female && /\b(male|man|boy|lad|bloke|guy|masculine|he|him)\b/.test(style);
  const age = /\b(old|older|elderly|aged|grand|nan|gran)\b/.test(style) ? "old" : /\b(young|teen|kid|child|youthful)\b/.test(style) ? "young" : /\bmiddle/.test(style) ? "middle" : "";
  const wantsBritish = /\b(british|northern|manc|mancunian|english|uk|scouse|yorkshire|cockney|london)\b/.test(style);
  const styleWords = new Set(words(style));
  let best = null, bestScore = -1e9;
  for (const v of list) {
    const L = v.labels || {};
    const g = String(L.gender || "").toLowerCase();
    const a = String(L.age || "").toLowerCase();
    const acc = String(L.accent || "").toLowerCase();
    const desc = words(`${L.description || ""} ${L.descriptive || ""} ${L.use_case || ""} ${L.use_case || ""}`);
    let sc = 0;
    if (female && g === "female") sc += 10;
    if (male && g === "male") sc += 10;
    if ((female && g === "male") || (male && !female && g === "female")) sc -= 10;
    if (age && a.includes(age)) sc += 4;
    if (age === "old" && /middle/.test(a)) sc += 2;
    if (wantsBritish && /british|english/.test(acc)) sc += 5;
    for (const w of desc) if (styleWords.has(w)) sc += 2;
    if (v.id === avoid) sc -= 1;
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return best || list[0];
}

/** Share of the line's words found in the transcript (0-1). Small leniency for plurals / dropped g's. */
export function accuracy(line, transcript) {
  const want = words(line);
  if (!want.length) return 0;
  const heard = new Set(words(transcript));
  const stem = (w) => w.replace(/(ing|in|s)$/, "");
  const heardStems = new Set([...heard].map(stem));
  const hit = want.filter((w) => heard.has(w) || heardStems.has(stem(w))).length;
  return Math.round((hit / want.length) * 100) / 100;
}

// ---------- the game ----------
export function createDuet({ here, env, gemma, voices, remember, recall, broadcast, readJson, sendJson }) {
  const cacheDir = path.join(here, "cache");
  const ttsDir = path.join(cacheDir, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });
  const sessions = new Map();
  const isMock = (req) => env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url || "");
  const elevenKey = () => env("ELEVENLABS_API_KEY");

  // Characters we've met, on disk, so "returning" works even if NMAFC memory is offline.
  const knownFile = path.join(cacheDir, "characters.json");
  const loadKnown = () => { try { return JSON.parse(fs.readFileSync(knownFile, "utf8")); } catch { return {}; } };
  const saveKnown = (k) => fs.writeFileSync(knownFile, JSON.stringify(k, null, 1));
  const boardFile = path.join(cacheDir, "leaderboard.json");
  const loadBoard = () => { try { return JSON.parse(fs.readFileSync(boardFile, "utf8")); } catch { return []; } };
  const topTen = (mock) => loadBoard().filter((e) => !!e.mock === !!mock).map(({ mock: _m, ...e }) => e).sort((a, b) => b.score - a.score).slice(0, 10);

  const quiet = (p, what = "") => p.catch((e) => { console.warn(`[duet]${what ? " " + what : ""}`, e.message); return null; });
  const memTexts = (r) => (Array.isArray(r) ? r : r?.results || r?.memories || []).map((m) => m?.memory || m?.text || m?.content || (typeof m === "string" ? m : "")).filter(Boolean);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  /** TTS with expressive settings, cached on disk by text+voice so repeats are free. Returns the cached file path. */
  async function tts(text, voiceId) {
    const file = path.join(ttsDir, `${sha(`${TTS_MODEL}|${voiceId}|${JSON.stringify(VOICE_SETTINGS)}|${text}`)}.mp3`);
    if (fs.existsSync(file)) return file;
    return ttsGate(async () => {
      if (fs.existsSync(file)) return file;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${ELEVEN}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: TTS_MODEL, text, voice_settings: VOICE_SETTINGS }),
        });
        if (res.status === 429 && attempt < 4) { await res.text(); await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
        if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        return file;
      }
    });
  }

  // ElevenLabs plans cap concurrent requests (free tier = 2), so queue TTS calls. ELEVENLABS_CONCURRENCY overrides.
  let running = 0;
  const waiting = [];
  async function ttsGate(fn) {
    const limit = Math.max(1, Number(env("ELEVENLABS_CONCURRENCY", "2")));
    if (running >= limit) await new Promise((r) => waiting.push(r));
    running++;
    try { return await fn(); } finally { running--; waiting.shift()?.(); }
  }

  /** Put an MP3 (real or silent) into cache/ under the session's public name. Returns { audio, ms }. */
  function publishAudio(name, buf) {
    fs.writeFileSync(path.join(cacheDir, name), buf);
    return { audio: `/api/audio/${name}`, ms: mp3Ms(buf.length) };
  }

  async function buildSong({ id, image, mock }) {
    if (mock) {
      const known = loadKnown()["mock|coffee mug"];
      return { object: "coffee mug", returning: !!known, character: { ...MOCK_CHARACTER }, song: mockSong(!!known), voiceId: "mock" };
    }
    // 1) Quick look + generic memory search in parallel, then a targeted search.
    const [look, generic] = await Promise.all([
      quiet(gemma({ prompt: "What is the main object in this photo? Answer with 1-4 plain words only, e.g. 'coffee mug'.", image, temperature: 0.1, maxTokens: 256 }), "quick look"),
      quiet(withTimeout(recall("objects that sang duets with the user", 6), 4000), "recall"),
    ]);
    const guess = capWords(String(look?.text || "").replace(/["'.\n]/g, " ").trim(), 5).toLowerCase();
    const specific = guess ? await quiet(withTimeout(recall(`${guess} character duet score roast`, 6), 4000)) : null;
    const memories = [...new Set([...memTexts(specific), ...memTexts(generic)])].slice(0, 10);
    const knownMap = loadKnown();
    const known = guess ? knownMap[normObject(guess)] : null;

    // 2) One Gemma call (photo + memories) for character + song. Retry once if the JSON is broken.
    let out = null;
    for (let tries = 0; tries < 2 && !out?.song; tries++) {
      const r = await quiet(gemma({ prompt: songPrompt({ object: guess, memories, known: known?.character }), image, json: true, temperature: 0.9, maxTokens: 2048 }), "song");
      if (r?.json && typeof r.json === "object") out = r.json;
    }
    if (!out) out = {};
    const object = capWords(out.object || guess || "mystery object", 5).toLowerCase();
    let character = repairCharacter(out.character, object);
    const byName = (n) => Object.entries(knownMap).find(([k, v]) => !k.startsWith("mock|") && v.character?.name?.toLowerCase() === String(n || "").toLowerCase())?.[1];
    const knownAfter = known || knownMap[normObject(object)] || byName(character.name); // Gemma kept a remembered name
    if (knownAfter) character = { ...character, ...knownAfter.character }; // same name/voice/personality every time
    const song = repairSong(out.song, object);
    const returning = !!knownAfter || (out.returning === true && memories.length > 0);

    // 3) Voice: reuse the one this character had before, else match voiceStyle against the labels.
    let voiceId = knownAfter?.voiceId;
    const list = (await quiet(voices(), "voices")) || (await quiet(voices(), "voices retry")) || [];
    if (!voiceId || (list.length && !list.some((v) => v.id === voiceId))) voiceId = pickVoice(list, character.voiceStyle)?.id || env("DUET_FALLBACK_VOICE", "JBFqnCBsd6RMkjVDRZzb");
    return { object, returning, character, song, voiceId };
  }

  async function makeAudio({ id, song, voiceId, mock }) {
    await Promise.all(song.lines.map(async (line, i) => {
      if (line.who !== "object") { line.ms = youMs(line.text); return; }
      const name = `${id}_${i}.mp3`;
      if (mock) Object.assign(line, publishAudio(name, silentMp3(1200 + line.text.length * 55)));
      else {
        try { Object.assign(line, publishAudio(name, fs.readFileSync(await tts(line.text, voiceId)))); }
        catch (e) { console.warn("[duet] tts", e.message); Object.assign(line, publishAudio(name, silentMp3(1200 + line.text.length * 55)), { ttsFailed: true }); }
      }
    }));
  }

  // ---------- routes ----------
  const routes = {
    "POST /api/object": async (req, res) => {
      const mock = isMock(req);
      const { image } = await readJson(req);
      if (!image?.data) return sendJson(res, 400, { error: "send { image: { data: base64, mime } }" });
      const id = newId();
      fs.writeFileSync(path.join(cacheDir, `${id}.jpg`), Buffer.from(image.data, "base64"));
      const photo = `/api/photo/${id}.jpg`;
      broadcast({ type: "photo-received", id, photo, at: Date.now() });

      const made = await buildSong({ id, image: { data: image.data, mime: image.mime || "image/jpeg" }, mock });
      await makeAudio({ id, song: made.song, voiceId: made.voiceId, mock });
      const session = { id, photo, returning: made.returning, object: made.object, character: made.character, song: made.song, voiceId: made.voiceId, ...(mock ? { mock: true } : {}) };
      sessions.set(id, { ...session, takes: {} });

      // Remember the character (disk now, NMAFC in the background - never block the reply).
      const k = loadKnown();
      const key = (mock ? "mock|" : "") + normObject(made.object);
      k[key] = { ...(k[key] || {}), object: made.object, character: made.character, voiceId: made.voiceId, seen: (k[key]?.seen || 0) + 1, at: Date.now() };
      saveKnown(k);
      if (!mock) quiet(remember(`Duet Anything met a ${made.object}. It is the character ${made.character.name}: ${made.character.personality}. Voice style: ${made.character.voiceStyle}. Catchphrase: "${made.character.catchphrase}". They started the duet "${made.song.title}" (${made.song.genre}).`));

      broadcast({ type: "song-ready", session, at: Date.now() });
      sendJson(res, 200, session);
    },

    "POST /api/take": async (req, res) => {
      const { id, line, audio, mime } = await readJson(req);
      const s = sessions.get(id);
      const idx = Number(line);
      const target = s?.song.lines[idx]?.text || "";
      let transcript = "";
      if (!s) return sendJson(res, 404, { error: "unknown session id" });
      if (s.mock || env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url)) {
        // Fake it: drop a random word or two so the score varies.
        transcript = target.split(" ").filter(() => Math.random() > 0.25).join(" ");
      } else {
        if (!audio) return sendJson(res, 400, { error: "send { id, line, audio: base64, mime }" });
        const type = mime || "audio/webm";
        const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "webm";
        const form = new FormData();
        form.append("file", new Blob([Buffer.from(audio, "base64")], { type }), `take.${ext}`);
        form.append("model_id", "scribe_v1");
        const r = await fetch(`${ELEVEN}/speech-to-text`, { method: "POST", headers: { "xi-api-key": elevenKey() }, body: form });
        if (!r.ok) throw new Error(`ElevenLabs STT ${r.status}: ${(await r.text()).slice(0, 160)}`);
        transcript = String((await r.json()).text || "").trim();
      }
      const acc = accuracy(target, transcript);
      s.takes[idx] = { transcript, accuracy: acc };
      broadcast({ type: "take-received", id, line: idx, transcript, accuracy: acc, at: Date.now() });
      sendJson(res, 200, { transcript, accuracy: acc });
    },

    "POST /api/judge": async (req, res) => {
      const { id } = await readJson(req);
      const s = sessions.get(id);
      if (!s) return sendJson(res, 404, { error: "unknown session id" });
      const mock = s.mock || env("MOCK") === "1";
      const youIdx = s.song.lines.map((l, i) => (l.who === "you" ? i : -1)).filter((i) => i >= 0);
      const accs = youIdx.map((i) => s.takes[i]?.accuracy ?? 0);
      const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
      const bestI = youIdx.reduce((b, i) => ((s.takes[i]?.accuracy ?? -1) > (s.takes[b]?.accuracy ?? -1) ? i : b), youIdx[0]);
      const worstI = youIdx.reduce((b, i) => ((s.takes[i]?.accuracy ?? -1) < (s.takes[b]?.accuracy ?? -1) ? i : b), youIdx[0]);
      let verdict = { score: Math.round(avg * 100), roast: "", best: s.song.lines[bestI]?.text || "", worst: s.song.lines[worstI]?.text || "" };
      if (mock) {
        verdict.roast = verdict.score >= 70 ? "Not bad, our kid, you were proper mint. Our Nan still sings it better mind." : "You sang like a kettle with a cold, our kid. Our Nan's budgie has more rhythm.";
      } else {
        const r = await quiet(gemma({ prompt: judgePrompt(s, s.takes), json: true, temperature: 0.9, maxTokens: 1024 }), "judge");
        const j = r?.json || {};
        if (Number.isFinite(Number(j.score))) verdict.score = Math.round(Math.min(100, Math.max(0, Number(j.score))));
        verdict.roast = j.roast || `${s.character.catchphrase}! You were... something, our kid.`;
        if (j.best && !/^n\/?a$/i.test(j.best)) verdict.best = capChars(j.best, 120);
        if (j.worst && !/^n\/?a$/i.test(j.worst)) verdict.worst = capChars(j.worst, 120);
      }
      verdict.roast = capChars(verdict.roast, ROAST_CHARS);
      const name = `${id}_roast.mp3`;
      let audio = null;
      try {
        audio = mock ? publishAudio(name, silentMp3(1500 + verdict.roast.length * 55)).audio : publishAudio(name, fs.readFileSync(await tts(verdict.roast, s.voiceId))).audio;
      } catch (e) { console.warn("[duet] roast audio", e.message); }
      const out = { score: verdict.score, roast: verdict.roast, audio, best: verdict.best, worst: verdict.worst };
      s.verdict = out;

      const board = loadBoard();
      board.push({ name: s.character.name, object: s.object, score: out.score, title: s.song.title, at: Date.now(), ...(mock ? { mock: true } : {}) });
      fs.writeFileSync(boardFile, JSON.stringify(board.slice(-500), null, 1));
      const k = loadKnown();
      const key = (mock ? "mock|" : "") + normObject(s.object);
      if (k[key]) { k[key].lastScore = out.score; k[key].lastRoast = out.roast; saveKnown(k); }
      if (!mock) quiet(remember(`${s.character.name} the ${s.object} duetted '${s.song.title}' with the user, score ${out.score}, roast: "${out.roast}"`));

      broadcast({ type: "verdict", id, score: out.score, roast: out.roast, audio, at: Date.now() });
      sendJson(res, 200, out);
    },

    "GET /api/leaderboard": async (req, res) => sendJson(res, 200, topTen(isMock(req))), // mock runs keep their own board
  };

  /** Serve /api/photo/:id.jpg and /api/audio/:file.mp3 from cache/. Returns true if handled. */
  function serveCache(urlPath, res) {
    const m = urlPath.match(/^\/api\/(photo|audio)\/([A-Za-z0-9_-]+)\.(jpg|mp3)$/);
    if (!m || (m[1] === "photo") !== (m[3] === "jpg")) return false;
    const file = path.join(cacheDir, `${m[2]}.${m[3]}`);
    if (!fs.existsSync(file)) { res.writeHead(404).end("Not found"); return true; }
    const size = fs.statSync(file).size;
    res.writeHead(200, { "Content-Type": m[3] === "jpg" ? "image/jpeg" : "audio/mpeg", "Content-Length": size, "Cache-Control": "public, max-age=3600", "Accept-Ranges": "none" });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  return { routes, serveCache, sessions };
}
