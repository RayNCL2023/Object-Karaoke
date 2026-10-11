// Duet Anything - KARAOKE like a real karaoke night: the host picks a song (no snap needed), lines are split into
// parts (P1..P4 = joined BATTLE players round-robin on verses, ALL = everyone on the chorus, AI = the object character
// or the default AI singer), every phone records only its own parts, and the character roasts the per-singer scores.
// Songs: BRITISH BANGERS (ORIGINALS, Gemma writes them), CLASSICS (public domain, lib/songs.mjs) and REAL SONGS
// (an embedded official YouTube karaoke video: no lyrics stored, scored on singing time / words heard / Gemma / crowd).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ORIGINAL_STYLES, CLASSICS, YOUTUBE, songList, findSong, youtubeId } from "./songs.mjs";
import { scoreKaraoke } from "./rubric.mjs";

const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const capWords = (s, n) => String(s || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
// No snap: a sequinned karaoke machine sings with you (inline SVG so the stage has a face to animate).
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#1a1030"/><rect x="95" y="70" width="210" height="270" rx="28" fill="#ff4fa3" stroke="#111" stroke-width="10"/><circle cx="200" cy="250" r="62" fill="#111"/><circle cx="200" cy="250" r="40" fill="#333"/><rect x="125" y="100" width="150" height="60" rx="10" fill="#ffd400" stroke="#111" stroke-width="8"/><circle cx="140" cy="320" r="8" fill="#ffd400"/><circle cx="260" cy="320" r="8" fill="#2ee6a6"/></svg>`;
const DEFAULT_PHOTO = "data:image/svg+xml;base64," + Buffer.from(MIC_SVG).toString("base64");
const DEFAULT_SINGER = { name: "Karaoke Kev", personality: "a sequinned karaoke machine from a Deansgate bar who has heard every bad Wonderwall", voiceStyle: "warm, theatrical Mancunian male crooner", catchphrase: "Grab the mic, our kid", colour: "#ff4fa3" };
const DEFAULT_FACE = { leftEye: { x: 0.4, y: 0.32 }, rightEye: { x: 0.6, y: 0.32 }, eyeSize: 0.1, mouth: { x: 0.5, y: 0.62, width: 0.22 } };
// MOCK / Gemma-failed original (written for this app, not based on any real song).
const MOCK_ORIGINAL = { title: "Last Tram to Buzzin'", lines: [
  ["Rain on the window, Oxford Road is calling", "verse"], ["Best trainers on and all my mates are here", "verse"], ["Last tram's a rumour and the night is young", "verse"],
  ["We're buzzin', buzzin', all the way home", "chorus"], ["Sing it loud on Deansgate, never alone", "chorus"], ["Buzzin', buzzin', our kid, come on", "chorus"],
  ["Chippy tea at midnight, gravy on my sleeve", "verse"], ["Northern Quarter neon, never wanna leave", "verse"],
  ["We're buzzin', buzzin', all the way home", "chorus"], ["Sing it loud on Deansgate, never alone", "chorus"], ["Buzzin', buzzin', our kid, come on", "chorus"],
].map(([text, section]) => ({ text, section })) };
const MOCK_HECKLES = ["[laughs] Is that singing or is the kettle boiling, our kid?", "[gasps] Ooh, hit that note! Well, near it.", "[sighs] My nan sings this better in the bath."];

export function createKaraoke({ here, env, gemma, duet, players, broadcast, readJson, sendJson }) {
  const H = duet.helpers;
  const cacheDir = path.join(process.env.DUET_DATA_DIR || here, "cache");
  let armed = null; // the host's pick: findSong() result or { kind: "youtube", videoId, title }
  let lastSnap = null; // last snapped character (any mode): becomes the AI duet partner / host
  const reacts = new Map(); // session id -> { pos, neg }
  let liveId = null;
  const isMock = (req) => env("MOCK") === "1" || /[?&]mock=1\b/.test(req?.url || "");
  const newId = () => "k_" + crypto.randomBytes(5).toString("hex");
  const defaultVoice = () => env("KARAOKE_VOICE") || env("DUET_FALLBACK_VOICE", "JBFqnCBsd6RMkjVDRZzb");
  const diff = () => duet.getDifficulty?.() || "spicy";
  const roster = () => (players.all?.() || []).slice(0, 4);

  async function writeOriginal(style, { object, character, mock }) {
    if (mock) return MOCK_ORIGINAL;
    const prompt = `Write an ORIGINAL karaoke song for a live party game at a Manchester hack day.
Style: ${style.style} (${style.genre}, about ${style.bpm} bpm).
Topic: ${object ? `life as a ${object} - the AI co-singer is ${character.name}, ${character.personality}` : "a big Manchester night out (Oxford Road, the rain, the last tram home, chippy tea)"}.
COPYRIGHT RULE (strict): every line must be brand new. Do NOT quote, paraphrase or closely imitate ANY real song's lyrics, title, hook or chorus, and never name real bands or artists. Capture the era/genre only through the vibe and slang.
Shape: 10-14 short lines, max 9 simple words each, easy to read off a screen: verse 1 (3-4 lines), a big CHORUS (3-4 lines, repetitive, easy to shout along), verse 2 (2-4 lines), then the SAME chorus lines again.
Warm, cheeky Manc slang (our kid, buzzin', mint, proper, sound). Nothing offensive, no swearing.
Return JSON: {"title":"","lines":[{"text":"","section":"verse"},{"text":"","section":"chorus"}]}`;
    try {
      const r = await gemma({ prompt, json: true, temperature: 0.95, maxTokens: 1200, timeoutMs: 25000 });
      const lines = (Array.isArray(r?.json?.lines) ? r.json.lines : []).filter((l) => l && typeof l.text === "string" && l.text.trim())
        .map((l) => ({ text: capWords(H.mask(l.text.replace(/\[[^\]]*\]/g, "")), 10), section: /chorus/i.test(l.section) ? "chorus" : "verse" })).slice(0, 14);
      if (lines.length >= 6) return { title: String(r.json.title || style.title).slice(0, 60), lines };
    } catch (e) { console.warn("[karaoke] original", e.message); }
    return MOCK_ORIGINAL;
  }

  /** P1..P4 round-robin on verses, ALL on the chorus, AI when nobody is there (1 player = duet with the AI). */
  function assignParts(lines, plist, ch) {
    const n = plist.length;
    let v = 0;
    const ai = (l) => ({ ...l, who: "object", part: "AI", singer: "ai", singerName: ch.name, singerColour: ch.colour });
    return lines.map((l) => {
      if (!n) return ai(l);
      if (l.section === "chorus") return { ...l, who: "you", part: "ALL", singer: "all", singerName: n === 1 ? `${plist[0].name} + ${ch.name}` : "Everyone", singerColour: "#ffd400", aiAlong: n === 1 };
      if (n === 1) return v++ % 2 ? ai(l) : { ...l, who: "you", part: "P1", singer: plist[0].id, singerName: plist[0].name, singerColour: plist[0].colour };
      const k = v++ % n;
      return { ...l, who: "you", part: `P${k + 1}`, singer: plist[k].id, singerName: plist[k].name, singerColour: plist[k].colour };
    });
  }

  /** AI lines sung by eleven_v3 in the character's voice (cached per text). Every line's ms snaps to half-bars (beat-locked). */
  async function voiceLines(id, song, voiceId, mock) {
    const half = (2 * 60000) / (song.bpm || 100);
    const q = (ms) => Math.ceil(ms / half) * half;
    const made = new Map();
    let budget = Number(env("KARAOKE_AI_LINES", "10")); // ElevenLabs credit: max unique AI lines per song
    const sung = (text) => {
      if (!made.has(text)) made.set(text, (async () => {
        const name = `${id}_${made.size}.mp3`;
        if (mock || budget-- <= 0) return { ...H.publishAudio(name, H.silentMp3(1400 + text.length * 70)), ttsFailed: !mock };
        try { return H.publishAudio(name, fs.readFileSync(await H.sing(text, voiceId))); }
        catch (e) { console.warn("[karaoke] sing", e.message); return { ...H.publishAudio(name, H.silentMp3(1400 + text.length * 70)), ttsFailed: true }; }
      })());
      return made.get(text);
    };
    await Promise.all(song.lines.map(async (l) => {
      const est = words(l.text).length * 480 + 1300;
      if (l.who === "object" || l.aiAlong) { const a = await sung(l.text); Object.assign(l, { audio: a.audio, ...(a.ttsFailed ? { ttsFailed: true } : {}) }); l.ms = q(Math.max(est, a.ms + 200)); }
      else l.ms = q(est);
    }));
  }

  async function start({ pick, mock, snap }) {
    const id = newId();
    const ch = snap?.character || DEFAULT_SINGER;
    const voiceId = snap?.voiceId && snap.voiceId !== "mock" ? snap.voiceId : defaultVoice();
    const plist = roster();
    const look = snap ? { photo: snap.photo, object: snap.object, face: snap.face, outline: snap.outline, bbox: snap.bbox } : { photo: DEFAULT_PHOTO, object: "karaoke machine", face: DEFAULT_FACE, ...H.ellipseShape({ x: 0.2, y: 0.15, w: 0.6, h: 0.72 }) };
    const base = { id, ...look, returning: false, character: ch, voiceId, mode: "karaoke", parts: true, singers: plist, difficulty: diff(), ...(snap ? {} : { noSnap: true }), ...(mock ? { mock: true } : {}) };
    let session;
    if (pick.kind === "youtube") {
      session = { ...base, song: { title: pick.title || "YouTube karaoke", artist: pick.artist || "", genre: "karaoke", bpm: 100, key: "C", kind: "youtube", lines: [] }, youtube: { videoId: pick.videoId, title: pick.title || "", artist: pick.artist || "", chunkMs: 8000, turnMs: 30000 } };
    } else {
      broadcast({ type: "karaoke-building", title: pick.title, kind: pick.kind, at: Date.now() });
      const src = pick.kind === "original" ? await writeOriginal(pick, { object: snap?.object, character: ch, mock }) : { title: pick.title, lines: pick.lines };
      const song = { title: pick.kind === "original" ? src.title : pick.title, genre: pick.genre, bpm: pick.bpm, key: pick.key, kind: pick.kind, style: pick.kind === "original" ? pick.title : `public domain · ${pick.year}`, lines: assignParts(src.lines.map((l) => ({ ...l })), plist, ch) };
      await voiceLines(id, song, voiceId, mock);
      session = { ...base, song };
    }
    duet.sessions.set(id, { ...session, takes: {}, rounds: {}, ptakes: {}, heckles: 0 });
    reacts.set(id, { pos: 0, neg: 0 });
    liveId = id;
    armed = null;
    broadcast({ type: "song-ready", session, at: Date.now() });
    return session;
  }

  const pickFrom = (b) => {
    if (b.youtube) { const v = youtubeId(b.youtube); return v ? { kind: "youtube", videoId: v, title: String(b.title || "Your YouTube pick").slice(0, 80), artist: "" } : null; }
    if (b.songId === "surprise") { const all = [...ORIGINAL_STYLES.map((s) => ({ kind: "original", ...s })), ...CLASSICS.map((s) => ({ kind: "classic", ...s }))]; return all[Math.floor(Math.random() * all.length)]; }
    return b.songId ? findSong(String(b.songId)) : null;
  };
  const freshSnap = () => (lastSnap && Date.now() - lastSnap.at < 30 * 60000 ? lastSnap : null);

  // ---------- judging ----------
  function cardFor(s, p) {
    const mine = s.ptakes[p.id] || {};
    if (s.youtube) {
      const chunks = Object.values(mine);
      const asked = Math.max(chunks.length, Number(s.asked?.[p.id]) || 0, 1);
      const active = chunks.filter((c) => words(c.transcript).length >= 2).length;
      const wordsAll = chunks.reduce((a, c) => a + words(c.transcript).length, 0);
      const time = active / asked, density = clamp(wordsAll / asked / 1.4, 0, 10);
      const transcript = chunks.map((c) => c.transcript).filter(Boolean).join(" / ").slice(0, 600);
      return { id: p.id, name: p.name, colour: p.colour, time, density, transcript, silent: !wordsAll, reason: `sang ${active}/${asked} turns (${Math.round(time * 100)}% of their time), ${wordsAll} words heard` };
    }
    const idx = s.song.lines.map((l, i) => (l.singer === p.id || l.part === "ALL" ? i : -1)).filter((i) => i >= 0);
    const k = scoreKaraoke(idx.map((i) => mine[i]?.accuracy ?? 0), idx.map((i) => mine[i]?.transcript || ""));
    const hard = { mild: 5, spicy: 0, savage: -5 }[s.difficulty] ?? 0;
    const best = idx.reduce((b, i) => ((mine[i]?.accuracy ?? -1) > (mine[b]?.accuracy ?? -1) ? i : b), idx[0]);
    return { id: p.id, name: p.name, colour: p.colour, score: k.silent ? 0 : clamp(k.score + hard, 0, 100), silent: k.silent, lines: idx.length, best: k.silent ? "silence" : s.song.lines[best]?.text || "", reason: k.reasons.lyrics };
  }

  async function judge(b, req, res) {
    const s = duet.sessions.get(b.id);
    if (!s) return sendJson(res, 404, { error: "unknown session id" });
    if (b.asked && typeof b.asked === "object") s.asked = b.asked;
    const mock = !!(s.mock || env("MOCK") === "1");
    const cards = s.singers.map((p) => cardFor(s, p));
    const r = reacts.get(s.id) || { pos: 0, neg: 0 };
    const crowdScore = r.pos + r.neg ? Math.round((100 * r.pos) / (r.pos + r.neg)) : null;
    const ch = s.character;
    let roast = "", vibe = {}, guess = "";
    if (!mock) {
      const sheet = cards.map((c) => s.youtube ? `${c.name}: ${c.reason}. Heard: "${c.transcript || "(nothing)"}"` : `${c.name}: ${c.score}/100 (${c.reason})${c.silent ? " - SILENT" : ""}`).join("\n");
      const prompt = `You are ${ch.name} (${ch.personality}), host of a karaoke night at a Manchester hack day. The song was "${s.song.title}"${s.youtube ? ` (an official karaoke video${s.song.artist ? ` by ${s.song.artist}` : ""})` : ` (${s.song.style || s.song.genre})`}.
Singers:
${sheet || "(nobody sang - you performed it alone as a demo)"}
Crowd: ${r.pos} cheers/fire/laughs, ${r.neg} boos.
${s.youtube ? "From the transcripts, give each singer a vibe mark 0-10 (did they actually sing the song? recognise it if you can; 0 if silent).\n" : ""}Write the verdict: max 2 short sentences, max 160 characters, in character, naming the singers, praising or roasting them CONSISTENT with the numbers (never praise a silent singer). Put 1-2 Eleven v3 audio tags like [laughs] or [sighs] in it.
${duet.toneBlock(s.difficulty)}
Return JSON: {"roast":""${s.youtube ? ',"song":"your guess of the song","vibe":{"<singer name>":5}' : ""}}`;
      try { const g = await gemma({ prompt, json: true, temperature: 0.9, maxTokens: 600, timeoutMs: 12000 }); roast = String(g?.json?.roast || ""); vibe = g?.json?.vibe || {}; guess = String(g?.json?.song || ""); } catch (e) { console.warn("[karaoke] judge", e.message); }
    }
    if (s.youtube) for (const c of cards) {
      const v = c.silent ? 0 : clamp(Number(vibe[c.name]) || (mock ? 6 : 5), 0, 10);
      c.score = c.silent ? 0 : Math.round(c.time * 40 + c.density * 3 + v * 3);
      c.reason += `, vibe ${v}/10`;
    }
    const avg = cards.length ? cards.reduce((a, c) => a + c.score, 0) / cards.length : (crowdScore ?? 70);
    const score = Math.round(crowdScore == null || !cards.length ? avg : avg * 0.8 + crowdScore * 0.2);
    if (!roast) roast = !cards.length ? `[laughs] Nobody brave enough to sing with ${ch.name}? Grab a phone next time, our kid.`
      : cards.every((c) => c.silent) ? "[sighs] Not one note. I've heard livelier silence in a library, you lot."
      : `[laughs] ${cards.sort((a, b) => b.score - a.score)[0].name} carried that! ${score >= 60 ? "Proper mint, our kid." : "The rest of you? Brave. Very brave."}`;
    const said = H.splitTags(roast, 160);
    let audio = null;
    try { audio = (mock ? H.publishAudio(`${s.id}_roast.mp3`, H.silentMp3(1500 + said.display.length * 55)) : H.publishAudio(`${s.id}_roast.mp3`, fs.readFileSync(await H.tts(said.speech, s.voiceId)))).audio; }
    catch (e) { console.warn("[karaoke] roast audio", e.message); }
    const categories = {}, reasons = {};
    for (const c of cards) { categories[c.name] = Math.round(c.score / 10); reasons[c.name] = `${c.score}/100 - ${c.reason}`; }
    if (!cards.length) { categories.demo = Math.round(score / 10); reasons.demo = "nobody joined - the AI sang it all"; }
    if (crowdScore != null) { categories.crowd = Math.round(crowdScore / 10); reasons.crowd = `${r.pos} cheers vs ${r.neg} boos`; }
    const top = [...cards].sort((a, b) => b.score - a.score);
    const out = { score, roast: said.display, audio, best: top[0] ? `${top[0].name} (${top[0].score})` : "AI demo", worst: top.length > 1 ? `${top[top.length - 1].name} (${top[top.length - 1].score})` : "", categories, reasons, mode: "karaoke", singers: cards.map(({ transcript, ...c }) => c), crowdScore, ...(guess ? { songGuess: guess.slice(0, 80) } : {}) };
    s.verdict = out;
    broadcast({ type: "verdict", id: s.id, ...out, at: Date.now() });
    sendJson(res, 200, out);
  }

  async function take(b, req, res) {
    const s = duet.sessions.get(b.id);
    if (!s) return sendJson(res, 404, { error: "unknown session id" });
    const mock = !!(s.mock || env("MOCK") === "1");
    const idx = Math.round(Number(b.line ?? b.round)) || 0;
    const who = b.player && s.singers.some((p) => p.id === b.player) ? b.player : s.singers[0]?.id || "solo";
    const target = s.song.lines[idx]?.text || "";
    let transcript = "";
    const bytes = b.audio ? Math.floor(String(b.audio).length * 3 / 4) : 0;
    if (mock) transcript = typeof b.transcript === "string" ? b.transcript : s.youtube ? "oh oh singing my heart out tonight yeah" : target.split(" ").filter(() => Math.random() > 0.25).join(" ");
    else if (b.audio && !b.silent && bytes >= 2048) { try { transcript = await H.stt(b.audio, b.mime); } catch (e) { console.warn("[karaoke] stt", e.message); } }
    const accuracy = s.youtube ? 0 : H.accuracy(target, transcript);
    transcript = H.mask(String(transcript).slice(0, 400));
    (s.ptakes[who] ||= {})[idx] = { transcript, accuracy, words: words(transcript).length };
    s.takes[idx] = { transcript, accuracy };
    const out = { line: idx, player: who, transcript, accuracy, words: words(transcript).length };
    broadcast({ type: "take-received", id: s.id, ...out, at: Date.now() });
    sendJson(res, 200, out);
  }

  const routes = {
    "GET /api/songs": async (req, res) => { const snap = freshSnap(); sendJson(res, 200, { ...songList(), armed, snap: snap ? { name: snap.character.name, object: snap.object, photo: snap.photo } : null, players: roster() }); },
    "POST /api/karaoke/pick": async (req, res) => {
      const b = await readJson(req);
      if (b.clear) { armed = null; broadcast({ type: "karaoke-armed", armed: null, at: Date.now() }); return sendJson(res, 200, { armed: null }); }
      const p = pickFrom(b);
      if (!p) return sendJson(res, 400, { error: "unknown song (or not a YouTube link)" });
      armed = p;
      broadcast({ type: "karaoke-armed", armed: { kind: p.kind, id: p.id, title: p.title, videoId: p.videoId }, at: Date.now() });
      sendJson(res, 200, { armed: { kind: p.kind, id: p.id, title: p.title, videoId: p.videoId } });
    },
    "POST /api/karaoke/start": async (req, res) => {
      const b = await readJson(req);
      const pick = (b.songId || b.youtube) ? pickFrom(b) : armed;
      if (!pick) return sendJson(res, 400, { error: "pick a song first" });
      try { sendJson(res, 200, await start({ pick, mock: isMock(req), snap: b.useSnap === false ? null : freshSnap() })); }
      catch (e) { console.error("[karaoke] start", e); sendJson(res, 500, { error: "couldn't start that song" }); }
    },
    // Between verses of a YouTube song: the character heckles with one short line (max 3 per song).
    "POST /api/karaoke/heckle": async (req, res) => {
      const b = await readJson(req);
      const s = duet.sessions.get(b.id);
      if (!s?.parts) return sendJson(res, 404, { error: "unknown session id" });
      if (s.heckles >= 3) return sendJson(res, 429, { error: "enough heckling" });
      const n = s.heckles++;
      const mock = !!(s.mock || env("MOCK") === "1");
      let text = MOCK_HECKLES[n % MOCK_HECKLES.length];
      if (!mock) {
        const heard = Object.values(s.ptakes).flatMap((m) => Object.values(m)).map((t) => t.transcript).filter(Boolean).slice(-3).join(" / ");
        try { const g = await gemma({ prompt: `You are ${s.character.name} (${s.character.personality}) heckling karaoke singers doing "${s.song.title}". Just heard: "${heard || "(mumbling)"}". One heckle, max 80 characters, with one Eleven v3 tag like [laughs]. ${duet.toneBlock(s.difficulty)}\nReturn JSON: {"text":""}`, json: true, temperature: 1, maxTokens: 200, timeoutMs: 7000 }); if (g?.json?.text) text = String(g.json.text); } catch { /* canned */ }
      }
      const said = H.splitTags(text, 90);
      let a;
      try { a = mock ? H.publishAudio(`${s.id}_h${n}.mp3`, H.silentMp3(1200 + said.display.length * 55)) : H.publishAudio(`${s.id}_h${n}.mp3`, fs.readFileSync(await H.tts(said.speech, s.voiceId))); }
      catch (e) { console.warn("[karaoke] heckle tts", e.message); a = { ...H.publishAudio(`${s.id}_h${n}.mp3`, H.silentMp3(1500)), ttsFailed: true }; }
      sendJson(res, 200, { text: said.display, ...a, ...(mock || a.ttsFailed ? { ttsFailed: true } : {}) });
    },
  };

  return {
    routes, take, judge,
    has: (id) => !!duet.sessions.get(id)?.parts,
    armed: () => armed,
    /** Snap while a song is armed in karaoke mode: the snapped object becomes the AI duet partner for that song. */
    async object(req, res) {
      const b = await readJson(req);
      if (!b.image?.data) return sendJson(res, 400, { error: "send { image: { data: base64, mime } }" });
      const mock = isMock(req), id = newId(), pick = armed;
      fs.writeFileSync(path.join(cacheDir, `${id}.jpg`), Buffer.from(b.image.data, "base64"));
      const photo = `/api/photo/${id}.jpg`;
      broadcast({ type: "photo-received", id, photo, at: Date.now() });
      const made = await H.buildSong({ id, image: { data: b.image.data, mime: b.image.mime || "image/jpeg" }, mock, mode: "karaoke", difficulty: diff(), noMusic: true });
      H.upsertRoster({ mock, sessionId: id, made });
      lastSnap = { character: made.character, voiceId: made.voiceId, photo, object: made.object, face: made.face, outline: made.outline, bbox: made.bbox, at: Date.now() };
      sendJson(res, 200, await start({ pick, mock, snap: lastSnap }));
    },
    noteSnap(s) { if (s?.character && s.photo && !s.parts && !s.pvp && !s.demo) lastSnap = { character: s.character, voiceId: s.voiceId, photo: s.photo, object: s.object, face: s.face, outline: s.outline, bbox: s.bbox, at: Date.now() }; },
    react(kind) { const r = liveId && reacts.get(liveId); if (!r) return; if (kind === "boo") r.neg++; else r.pos++; },
  };
}
