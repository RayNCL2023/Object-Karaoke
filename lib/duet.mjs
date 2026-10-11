// Duet Anything: the game logic behind /api/object, /api/take, /api/judge, /api/leaderboard.
// server.mjs passes in its helpers (gemma, voices, remember, recall, broadcast, readJson, sendJson, env).
// Everything generated (photos, MP3s, leaderboard, known characters) lives in cache/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { mask, cleanSpeech, PHOTO_RULE } from "./safety.mjs";
import { scoreBattle, scoreKaraoke, rubricText } from "./rubric.mjs";

const ELEVEN = "https://api.elevenlabs.io/v1";
const TTS_MODEL = "eleven_multilingual_v2";
// Expressive, sing-song delivery: low stability = more emotion, style pushes the performance.
const VOICE_SETTINGS = { stability: 0.3, similarity_boost: 0.8, style: 0.65, use_speaker_boost: true };
// Eleven v3: understands [audio tags] like [laughs] / [shouting]. Falls back to TTS_MODEL (tags stripped) on any error.
const V3_MODEL = "eleven_v3";
// v3 stability only snaps to 0 (Creative) / 0.5 (Natural) / 1 (Robust): Creative = most performed, least "read out". speed 0.7-1.2.
const V3_SETTINGS = { stability: 0.0, similarity_boost: 0.75, style: 0.8, use_speaker_boost: true, speed: Math.max(0.7, Math.min(1.2, Number(process.env.RAP_SPEED) || 1.1)) };
// Rap bars: Gemma separates bars with " / ". For v3 each bar goes on its own line with a dash breath, and a
// [rapping] performance tag leads if the line has no opening tag. The screen shows the bars comma-separated.
const RAP_RULE = `RAP FORMAT (this is performed over a beat, so it must FLOW like a real MC, not read like a sentence): exactly 4 bars separated by " / ". Each bar 6-9 syllables, punchy, natural speech rhythm. Strong END RHYMES (AABB or AAAA, multi-syllable rhymes are best). Write the single punchline word of the last bar in CAPS. Start the whole thing with the tag [rapping] (or [confident] / [hyped]), you may end with [laughs]. No filler words.`;
function rapText(speech) {
  let t = String(speech || "").trim();
  if (!/\//.test(t)) return t; // not bar-formatted (old cache / backup lines): leave as is
  const bars = t.split(/\s*\/\s*/).map((b) => b.trim()).filter(Boolean);
  t = bars.map((b, i) => (i < bars.length - 1 ? b.replace(/[,;:.]+$/, "") + " —" : b)).join("\n");
  if (!/^\s*\[/.test(t)) t = "[rapping] " + t;
  return t;
}
const MAX_DESIGNED_VOICES = 25; // Creator plan voice slots
// Gemma is asked to put 1-3 v3 audio tags in every object line. speech = with tags (sent to TTS), display = without (shown on screen).
const TAG_RULE = `Delivery tags: put 1-3 fitting Eleven v3 audio tags in square brackets inside the text, placed naturally where the delivery changes, e.g. [scoffs], [laughs], [sarcastic], [shouting], [whispers], [sighs], [clears throat], [mischievously], [excited], [laughs harder]. Tags count towards the character limit. No other brackets.`;
const stripTags = (s) => String(s || "").replace(/\[[^\]]*\]?/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\s+/g, " ").trim();
/** Cap a tagged line (tags count), drop broken/extra tags. Returns { speech, display }. */
function splitTags(raw, cap) {
  let speech = capChars(String(raw || "").replace(/\(([a-z ]{3,24})\)/gi, "[$1]"), cap).replace(/\[[^\]]*$/, "").trim();
  let n = 0;
  speech = speech.replace(/\[([^\]]*)\]/g, (m, t) => (t.trim().length && t.length <= 30 && ++n <= 3 ? `[${t.trim().toLowerCase()}]` : " ")).replace(/\s+/g, " ").trim();
  return { speech: cleanSpeech(speech), display: mask(stripTags(speech).replace(/\s*\/\s*/g, ", ").replace(/,\s*,/g, ",")) }; // swear/slur filter before TTS + screen; bars "/" -> commas on screen
}
const MAX_OBJECT_CHARS = 90;
const MAX_OBJECT_LINES = 4;
const MAX_YOU_WORDS = 10;
const ROAST_CHARS = 160;
// Freestyle roast battle: object opens, user freestyles, object comes back; 3 user rounds.
const OPENER_CHARS = 200;
const COMEBACK_CHARS = 200;
// Battle length: BATTLE_ROUNDS (default 3) user rounds of BATTLE_TURN_MS (default 12000) each, from .env.
const battleCfg = () => ({ rounds: Math.max(1, Math.min(6, Math.round(Number(process.env.BATTLE_ROUNDS)) || 3)), youMs: Math.max(3000, Math.min(30000, Math.round(Number(process.env.BATTLE_TURN_MS)) || 12000)) });
export { battleCfg };
// Shared tone + guardrails for every battle prompt (savage, but safe for a uni stage).
// Difficulty (stage idle toggle, POST /api/difficulty): mild | spicy (default) | savage. Guardrails apply at EVERY level.
const GUARDRAILS = `Hard guardrails (live on stage in front of judges), at every difficulty: no slurs, nothing about race, religion, gender, sexuality, disability, body/appearance or real tragedies, no strong swearing (mild like "bloody" is fine), nothing about real named people. Roast the performance, never protected traits. ${PHOTO_RULE}`;
const DIFFICULTIES = ["mild", "spicy", "savage"];
const normDifficulty = (d) => (DIFFICULTIES.includes(String(d || "").toLowerCase()) ? String(d).toLowerCase() : "spicy");
const TONES = {
  mild: `Difficulty MILD ("Light roast"): playful TEASING, warm and silly, like a cheeky mate winding you up. Gentle ribbing about the performance and the daft situation (stood at a hack day rapping at a household object), never cutting, no personal digs, keep it light and fun. Manc slang (our kid, proper, mint, buzzin', sound, our Nan) and soft British teases like "you daft apeth", "you plum", "bless you".`,
  spicy: `Difficulty SPICY: proper battle-rap energy but CHEEKY. Sharp, funny jabs at the player's PERFORMANCE: their weak bars, their voice, their silence, their recycled comebacks, their nerves, and the situation (stood at a hack day rapping at a household object). Confident and cocky, with a wink. Manc attitude and slang (our kid, proper, mither) and British insults, VARIED every line (pick fresh ones: muppet, plonker, absolute weapon, wet wipe, numpty, div, clown, waste of a charger). Never reuse the same insult in a battle; use "melt" at most once.`,
  savage: `Difficulty SAVAGE ("No mercy"): SAVAGE battle-rap energy. Brutal and personal about the player's PERFORMANCE: their weak bars, their voice, their silence, their recycled comebacks, their nerves, and the situation (stood at a hack day rapping at a household object). Not friendly, not gentle. Manc attitude and slang (our kid, proper, mither, proper swagger) and British insults, VARIED every line (pick fresh ones: muppet, plonker, absolute weapon, you're mingin', bellend-lite energy, numpty, wet wipe, clown). Never reuse the same insult in a battle; use "melt" at most once.`,
};
const toneBlock = (d) => `Tone: ${TONES[normDifficulty(d)]}\n${GUARDRAILS}`;
const BATTLE_TONE = toneBlock("savage"); // legacy name (other modules may import the idea; prompts use toneBlock(d))
const TAG_EXAMPLES = { mild: "[laughs], [playfully], [giggles], [mischievously], [excited], [chuckles]", spicy: "[scoffs], [laughs], [sarcastic], [mischievously], [excited], [laughs harder]", savage: "[scoffs], [shouting], [sarcastic], [laughs harder], [sighs], [clears throat]" };
const tagRule = (d) => `Delivery tags: put 1-3 fitting Eleven v3 audio tags in square brackets inside the text, placed naturally where the delivery changes. For this difficulty prefer: ${TAG_EXAMPLES[normDifficulty(d)]}. Tags count towards the character limit. No other brackets.`;
// How the judge marks at each level.
const JUDGE_STYLE = { mild: "Be GENEROUS: reward any effort, round scores up, a brave try deserves 55+.", spicy: "Be fair but demanding.", savage: "Be HARSH: silence = 0-1, only genuinely sharp bars score well." };
const JUDGE_NUDGE = { mild: 10, spicy: 0, savage: -8 }; // heuristic score shift (MOCK + fallback)
const MOCK_TRANSCRIPTS = [
  "you're just a mug, you hold my tea, nobody even knows your name",
  "",
  "at least I can walk, you sit on a desk all day collecting dust our kid",
];
const MOCK_COMEBACKS = [
  "Hold your tea? You couldn't hold a tune, you plonker. Nobody knows my name? Mate, nobody's asked for yours.",
  "Cat got your tongue? Proper silence, absolute weapon. Even the kettle's louder than you, muppet.",
];
// Canned lines per difficulty (MOCK). comebacks: [answered, silence]; roasts: [good, bad].
const MOCK_LINES = {
  mild: {
    opener: "Ey up, our kid! Fancy a little rap with a mug? Go easy, I'm only small. Give us your best, you daft apeth.",
    back: "Oh, it's you again, our kid! Last time was proper mint. Ready for round two, you plum?",
    comebacks: ["Hold your tea? Aw, bless, you're sweet. Nobody knows my name? It's Mug Jagger, love, write it down.", "Lost for words? Don't worry, our kid, happens to the best of us. Have a brew and try again."],
    roasts: (best) => [`"${best}"? Aw, that was mint, our kid. Proper buzzin' for you.`, "You said nowt, but you looked lovely doing it. Bless, our kid."],
    karaoke: ["Lovely singing, our kid! Our Nan would be proper chuffed.", "Bit wobbly, but we had fun, didn't we? Sound, our kid."],
  },
  spicy: {
    opener: "Look at you, our kid, stood there like a muppet. I've held better bars in me since 1996. Go on then, you numpty.",
    back: "Back for more, are we, you muppet? Last time you froze like milk gone off. Same muppet, same rubbish bars, our kid.",
    comebacks: MOCK_COMEBACKS,
    roasts: (best) => [`"${best}"? That was your BEST bar, you wet wipe. Absolute weapon, go home.`, "Three rounds and you said nowt, you muppet. Proper mingin' performance, our kid."],
    karaoke: ["Hit the notes, did you? Barely. My nan's budgie's got more soul, you clown.", "You sang like a kettle with a cold, you muppet. Proper mingin', our kid."],
  },
  savage: {
    opener: "State of you, rapping at a MUG. I've had more flavour from teabag number nine. Go on, embarrass yourself, you div.",
    back: "You came BACK? After last time? You froze like milk gone off and you're still mingin'. Absolute weapon.",
    comebacks: ["Hold my tea? You can't hold a beat, a note OR a crowd, you plonker. Nobody asked your name, nobody will.", "Silence? Proper silence? Even the dregs in me have got more to say than you, muppet. Pathetic."],
    roasts: (best) => [`"${best}" was your BEST? Bloody hell. Absolute weapon. Get off my stage.`, "Three rounds, zero bars, total shambles. Even the kettle's embarrassed for you."],
    karaoke: ["Barely in tune and fully mingin'. My nan's budgie would boo you off.", "That wasn't singing, that was a cry for help, you muppet. Mingin'."],
  },
};

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
const mockSong = (returning, mode, difficulty) => mode === "karaoke" ? ({
  // Public-domain traditional song (no copyright issue) so MOCK karaoke has real lyrics.
  title: "Twinkle Twinkle Little Star", genre: "pop", bpm: 100, key: "C",
  lines: ["Twinkle, twinkle, little star", "How I wonder what you are", "Up above the world so high", "Like a diamond in the sky",
    "Twinkle, twinkle, little star", "How I wonder what you are"].map((text) => ({ who: "you", text })),
}) : ({
  title: "Brew Beef", genre: "hip hop", bpm: 92, key: "C",
  battle: battleCfg(),
  lines: [
    { who: "object", text: returning ? MOCK_LINES[normDifficulty(difficulty)].back : MOCK_LINES[normDifficulty(difficulty)].opener },
  ],
});

// ---------- prompts ----------
const NAMING_STYLES = [
  "a rapper/MC alias built from the object (e.g. \"MC Mug\", \"Lil' Lanyard\", \"Notorious B.O.T.T.L.E\")",
  "an old-school Manc nickname (e.g. \"Big Dave from Wythenshawe\" energy, but about the object)",
  "a posh aristocratic title (e.g. \"Lord Mugsworth III of Didsbury\")",
  "a footballer-style nickname (e.g. \"The Ancoats Assassin\", \"Kettle Kanté\")",
  "a cartoon villain name (e.g. \"Doctor Dregs\", \"Baron Von Biro\")",
  "a pun mashing the object with a famous non-Oasis musician or actor",
  "a grime MC tag (e.g. \"Skepta-cle Case\", \"Stormzy Teapot\")",
  "a boxer / wrestler ring name (e.g. \"Iron Lid\", \"The Rochdale Rattler\")",
  "a nan's pet name for it (e.g. \"Our Little Sippy\") delivered with menace",
  "a pure pun on the object's material, shape or job",
];
function songPrompt({ object, memories, known, mode = "battle", avoidNames = [], difficulty = "spicy" }) {
  const namingStyle = NAMING_STYLES[Math.floor(Math.random() * NAMING_STYLES.length)];
  const memText = memories.length ? memories.map((m) => `- ${m}`).join("\n") : "- (nothing yet)";
  const karaoke = mode === "karaoke";
  const gameText = karaoke
    ? "Look at the photo. The main object in it comes alive as a sharp-tongued character (personality and voice that fit the object itself) and sings a short karaoke DUET with the human player (who reads their lines off a screen)."
    : "Look at the photo. The main object in it comes alive as a battle rapper whose personality AND voice come from the object itself, and starts a FREESTYLE ROAST BATTLE with the human player (a few rounds: it opens, the human freestyles back with no lyrics, it fires comebacks).";
  const songRules = karaoke
    ? `- Song: a completely ORIGINAL karaoke song about being this object (never copy or quote any real song's lyrics). genre is one of: britpop, madchester, disco, rock, ballad, hip hop, pop punk, northern soul. bpm 80-140. key like "C" or "A minor".
- 8-12 lines, ALL {"who":"you"} (the human sings every line; the object is the hype man). Verse, then a catchy chorus that REPEATS (same chorus lines appear twice). Max ${MAX_YOU_WORDS} simple words per line, easy to read off a screen and sing.
- The song can be cheeky and Manc (our kid, proper, mither, buzzin') but nothing offensive.
- ${toneBlock(difficulty)}`
    : `- Song = the battle beat + the object's OPENING VERSE. title: a battle name. genre is one of: hip hop, grime, britpop, madchester, rock, pop punk, northern soul (prefer hip hop / grime). bpm 80-140. key like "C" or "A minor".
- lines: exactly ONE line {"who":"object","text":...}: the opener, max ${OPENER_CHARS} characters total, roasting the player and the situation and bigging up itself as this object. ${RAP_RULE}
- ${tagRule(difficulty)}
- ${toneBlock(difficulty)}`;
  const linesShape = karaoke ? `[{"who":"you","text":""},{"who":"you","text":""}]` : `[{"who":"object","text":""}]`;
  return `You are the writers' room for "Duet Anything", a live karaoke game at a Manchester hack day.
${gameText}
${object ? `A quick look says the object is: "${object}".` : ""}

Memories of objects this game has met before:
${memText}
${known ? `\nThis object HAS been here before. Keep EXACTLY this character: ${JSON.stringify(known)}. Set "returning": true and make the opener greet the player back ("Back for more, are we?" energy) and throw their last battle in their face (last score, their best/worst line, who won).\n` : `\nIf a memory clearly describes this same object, keep its name, personality and voiceStyle, set "returning": true, and make the opener throw last time's battle (score, best/worst line) in their face. Otherwise invent a new character and set "returning": false.\n`}
Rules:
- Character name (new characters only): FRESH and varied. This time use this naming style: ${namingStyle}. Never use Gallagher, Liam, Noel or Oasis puns.${avoidNames.length ? ` Do NOT reuse any of these existing names: ${avoidNames.map((n) => `"${n}"`).join(", ")}.` : ""} Personality: one funny line.
- voiceStyle: a vivid one-line voice description (gender, age, accent, pitch, texture, attitude) used to design a unique voice. The voice must FIT THE OBJECT ITSELF more than anything — imagine what this exact object would sound like if it could talk: a rubber duck = squeaky, high and hyper; a kettle = hissing, hot-headed, boiling over; a teapot = posh elderly English lady; a heavy textbook = deep, slow, pompous professor; an energy drink can = fast, jittery, shouting teenager; a cactus = dry, prickly, drawling desert cowboy; a smartphone = smug, robotic, notification-chirpy. Any accent or nationality that suits the object (it does NOT have to be Mancunian). Never a generic narrator voice.
- colour: one bold hex accent that suits the object, like "#ff5a36".
${songRules}
- face: where to stick googly eyes and a talking mouth ON the main object in THIS photo, so it looks like the object itself is alive (the googly-eyes-on-objects meme). Put them where a face would look funniest/most natural, e.g. on the front of a mug, on a bottle's label. All numbers are fractions 0-1 of the image width (x) and height (y), measured from the top-left. leftEye/rightEye are the eye centres, eyeSize is the eye diameter as a fraction of image width (about 0.08-0.2, sized to the object), mouth is the mouth centre and its width as a fraction of image width.
- bbox: the main object's tight bounding box {x,y,w,h} as fractions 0-1 of image width/height (x,y = top-left corner).

Return this JSON shape:
{"object":"coffee mug","returning":false,"character":{"name":"","personality":"","voiceStyle":"","catchphrase":"","colour":"#ff5a36"},"song":{"title":"","genre":"","bpm":112,"key":"C","lines":${linesShape}},"bbox":{"x":0.2,"y":0.15,"w":0.6,"h":0.7},"face":{"leftEye":{"x":0.4,"y":0.4},"rightEye":{"x":0.6,"y":0.4},"eyeSize":0.12,"mouth":{"x":0.5,"y":0.6,"width":0.25}}}`;
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

Judge the player's singing like a Mancunian talent-show judge (tone set by the difficulty below).
- score: whole number 0-100, mostly driven by the accuracy figures (avg accuracy x 100, nudged up to +/-15 for flair). Nothing recorded = low score.
- roast: max 2 short sentences, max ${ROAST_CHARS} characters total, in character, about their singing. ${tagRule(s.difficulty)}
- ${toneBlock(s.difficulty)}
- ${JUDGE_STYLE[normDifficulty(s.difficulty)]}
- best: the player's best line (quote it, short).
- worst: the player's worst line (quote it, short).
Return JSON: {"score":72,"roast":"","best":"","worst":""}`;
}

/** Battle transcript so far, for the comeback + judge prompts. */
function battleLog(s) {
  const out = [`${s.character.name} (opener): "${s.song.lines[0]?.text || ""}"`];
  for (let r = 1; r <= s.battle.rounds; r++) {
    const t = s.rounds[r];
    if (!t) continue;
    out.push(`PLAYER round ${r}: ${t.transcript ? `"${t.transcript}"` : "(silence, they bottled it)"}`);
    if (t.comeback?.text) out.push(`${s.character.name} comeback: "${t.comeback.text}"`);
  }
  return out.join("\n");
}

function comebackPrompt(s, round, transcript) {
  return `You are ${s.character.name}, a ${s.object} (${s.character.personality}), in a live FREESTYLE ROAST BATTLE against a human at a Manchester hack day. Round ${round} of ${s.battle.rounds}.
Battle so far:
${battleLog(s)}
The player just freestyled: ${transcript ? `"${transcript}"` : "NOTHING. Total silence / mumbling, they froze."}

Write your COMEBACK: max ${COMEBACK_CHARS} characters total, reacting SPECIFICALLY to what they just said: quote or twist their actual words and flip them back on them${transcript ? "" : " (mock the silence: \"Cat got your tongue?\" energy)"}.
${RAP_RULE}
${tagRule(s.difficulty)}
${toneBlock(s.difficulty)}
Return JSON: {"text":""}`;
}

function battleJudgePrompt(s, rub) {
  return `You are ${s.character.name}, a ${s.object} (${s.character.personality}). Catchphrase: "${s.character.catchphrase}".
You just had a ${s.battle.rounds}-round FREESTYLE ROAST BATTLE with a human. Judge ONLY what the PLAYER actually said (their transcripts), against your lines:
${battleLog(s)}

The scorer has ALREADY measured these in code (do not change them): ${rubricText(rub)}
Your jobs:
- wit: 0-10, how funny/clever their insults were (0 if silent, max 2 if they barely said anything).
- roast: max 2 short sentences, max ${ROAST_CHARS} characters, in character, CONSISTENT with the numbers above (if they were silent or scored low, mock that; never call a weak or silent performance great). Quote their best or worst line back at them. ${tagRule(s.difficulty)}
- best: their best line, VERBATIM from the transcripts (short). worst: their worst line verbatim (or "silence").
- ${toneBlock(s.difficulty)}
Return JSON: {"wit":5,"roast":"","best":"","worst":""}`;
}

// ---------- validation / repair ----------
function repairSong(raw, objectName, mode = "battle") {
  const src = Array.isArray(raw?.lines) ? raw.lines : [];
  const clean = src.filter((l) => l && typeof l.text === "string" && l.text.trim());
  const bpm0 = Math.round(Math.min(150, Math.max(70, Number(raw?.bpm) || 100)));
  const meta = { title: capChars(raw?.title || `Ballad of the ${objectName}`, 60), genre: String(raw?.genre || (mode === "battle" ? "hip hop" : "britpop")).toLowerCase().slice(0, 30), bpm: bpm0, key: String(raw?.key || "C").slice(0, 12) };
  if (mode === "battle") {
    const opener = splitTags(clean.filter((l) => String(l.who).toLowerCase() !== "you").map((l) => l.text).join(" ") || clean.map((l) => l.text).join(" ") || `[scoffs] Look at you, our kid, stood there like a muppet. [shouting] I'm the best ${objectName} in Manchester, go on then, you numpty.`, OPENER_CHARS);
    return { ...meta, battle: battleCfg(), lines: [{ who: "object", text: opener.display, speech: opener.speech }] };
  }
  if (mode === "karaoke") {
    let lines = clean.map((l) => capWords(l.text, MAX_YOU_WORDS)).filter(Boolean).slice(0, 12);
    const fill = [`I'm singing to a ${objectName}`, "Proper buzzin', our kid", "Manchester rain on my window", "Sing it loud, sing it proud"];
    while (lines.length < 8) lines.push(fill[lines.length % fill.length]);
    return { ...meta, lines: lines.map((text) => ({ who: "you", text })) };
  }
  const objs = clean.filter((l) => String(l.who).toLowerCase() !== "you").map((l) => splitTags(l.text, MAX_OBJECT_CHARS));
  const yous = clean.filter((l) => String(l.who).toLowerCase() === "you").map((l) => capWords(l.text, MAX_YOU_WORDS));
  const fillO = [`I'm the best ${objectName} in all of Manchester, our kid`, "Sing it with me now, don't be shy", "Proper mint, this, isn't it?", "Ta-ra for now, you were sound"];
  const fillY = ["La la la, I'm singing too", "Mint, our kid, mint", "Buzzin' for this duet", "Ta-ra, see you soon"];
  while (objs.length < 3) objs.push(splitTags(fillO[objs.length], MAX_OBJECT_CHARS));
  while (yous.length < 3) yous.push(fillY[yous.length]);
  const pairs = Math.min(MAX_OBJECT_LINES, objs.length, yous.length);
  const lines = [];
  for (let i = 0; i < pairs; i++) { lines.push({ who: "object", text: objs[i].display, speech: objs[i].speech }); lines.push({ who: "you", text: yous[i] }); }
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

const DEFAULT_FACE = { leftEye: { x: 0.38, y: 0.38 }, rightEye: { x: 0.62, y: 0.38 }, eyeSize: 0.14, mouth: { x: 0.5, y: 0.62, width: 0.28 } };
const defaultFace = () => JSON.parse(JSON.stringify(DEFAULT_FACE));
/** Validate Gemma's face placement (fractions 0-1). Returns null if missing or nonsense. */
function repairFace(raw) {
  const f = raw && typeof raw === "object" ? raw : null;
  if (!f) return null;
  const num = (v) => (typeof v === "string" ? parseFloat(v) : v);
  const frac = (v) => { let n = num(v); if (!Number.isFinite(n)) return NaN; if (n > 1 && n <= 100) n /= 100; return n; }; // tolerate percentages
  const pt = (p) => { const x = frac(p?.x), y = frac(p?.y); return Number.isFinite(x) && Number.isFinite(y) && x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05 ? { x: Math.min(0.97, Math.max(0.03, x)), y: Math.min(0.97, Math.max(0.03, y)) } : null; };
  let l = pt(f.leftEye), r = pt(f.rightEye);
  const mouthPt = pt(f.mouth);
  if (!l || !r) return null;
  if (l.x > r.x) [l, r] = [r, l];
  const gap = Math.hypot(r.x - l.x, r.y - l.y);
  if (gap < 0.03 || gap > 0.7) return null;
  let eyeSize = frac(f.eyeSize);
  if (!Number.isFinite(eyeSize) || eyeSize <= 0) eyeSize = Math.min(0.2, gap * 0.6);
  eyeSize = Math.min(0.25, Math.max(0.05, eyeSize));
  const cx = (l.x + r.x) / 2, cy = (l.y + r.y) / 2;
  const mouth = mouthPt && mouthPt.y > cy ? mouthPt : { x: cx, y: Math.min(0.95, cy + Math.max(0.12, gap * 0.9)) };
  let width = frac(f.mouth?.width);
  if (!Number.isFinite(width) || width <= 0) width = gap * 1.1;
  mouth.width = Math.min(0.5, Math.max(0.08, width));
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return { leftEye: { x: r3(l.x), y: r3(l.y) }, rightEye: { x: r3(r.x), y: r3(r.y) }, eyeSize: r3(eyeSize), mouth: { x: r3(mouth.x), y: r3(mouth.y), width: r3(mouth.width) } };
}

/** Cut-out shape: { bbox, outline }. Outline -> bbox rectangle -> centred ellipse. */
const r3 = (n) => Math.round(n * 1000) / 1000;
const fracNum = (v) => { let n = typeof v === "string" ? parseFloat(v) : v; if (!Number.isFinite(n)) return NaN; if (n > 1.05 && n <= 100) n /= 100; return n; };
const clamp01 = (n) => Math.min(1, Math.max(0, n));
function ellipseShape(b = { x: 0.12, y: 0.08, w: 0.76, h: 0.84 }) {
  const outline = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2 - Math.PI / 2; return { x: r3(b.x + b.w / 2 + Math.cos(a) * b.w / 2), y: r3(b.y + b.h / 2 + Math.sin(a) * b.h / 2) }; });
  return { bbox: { x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h) }, outline };
}
function repairShape(rawOutline, rawBbox) {
  let bbox = null;
  if (rawBbox && typeof rawBbox === "object") {
    const x = fracNum(rawBbox.x), y = fracNum(rawBbox.y), w = fracNum(rawBbox.w ?? rawBbox.width), h = fracNum(rawBbox.h ?? rawBbox.height);
    if ([x, y, w, h].every(Number.isFinite)) {
      const x0 = clamp01(x), y0 = clamp01(y), x1 = clamp01(x + w), y1 = clamp01(y + h);
      if (x1 - x0 >= 0.08 && y1 - y0 >= 0.08) bbox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  let pts = (Array.isArray(rawOutline) ? rawOutline : []).map((p) => Array.isArray(p) ? { x: fracNum(p[0]), y: fracNum(p[1]) } : { x: fracNum(p?.x), y: fracNum(p?.y) })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.03 && p.x <= 1.03 && p.y >= -0.03 && p.y <= 1.03)
    .map((p) => ({ x: r3(clamp01(p.x)), y: r3(clamp01(p.y)) }));
  if (pts.length > 48) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 48) === 0);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
  if (pts.length >= 6 && Math.abs(area / 2) >= 0.02) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const ob = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { bbox: { x: r3(ob.x), y: r3(ob.y), w: r3(ob.w), h: r3(ob.h) }, outline: pts };
  }
  if (bbox) return { bbox: { x: r3(bbox.x), y: r3(bbox.y), w: r3(bbox.w), h: r3(bbox.h) }, outline: [{ x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }, { x: bbox.x, y: bbox.y + bbox.h }].map((p) => ({ x: r3(p.x), y: r3(p.y) })) };
  return ellipseShape();
}
/** Default face placed inside the object's bbox. */
function faceInBox(b) {
  return { leftEye: { x: r3(b.x + b.w * 0.36), y: r3(b.y + b.h * 0.38) }, rightEye: { x: r3(b.x + b.w * 0.64), y: r3(b.y + b.h * 0.38) }, eyeSize: r3(Math.min(0.2, Math.max(0.06, b.w * 0.2))), mouth: { x: r3(b.x + b.w * 0.5), y: r3(b.y + b.h * 0.62), width: r3(Math.min(0.4, Math.max(0.08, b.w * 0.36))) } };
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

/** Battle scores from the transcripts alone (MOCK, and the fallback if Gemma fails). */
function battleHeuristic(s) {
  const n = s.battle?.rounds || battleCfg().rounds;
  const said = [];
  let total = 0, answered = 0, hits = 0, rhymeHits = 0;
  for (let r = 1; r <= n; r++) {
    const t = s.rounds?.[r]?.transcript || "";
    const w = words(t);
    total += w.length;
    if (w.length) { answered++; said.push(t); }
    const prev = r === 1 ? s.song.lines[0]?.text : s.rounds?.[r - 1]?.comeback?.text;
    const prevW = new Set(words(prev).filter((x) => x.length > 3));
    if (w.some((x) => prevW.has(x)) || /\b(you|your|youre)\b/.test(w.join(" "))) hits++;
    const ends = t.split(/[,.!?]|\band\b/).map((p) => words(p).pop()).filter(Boolean).map((x) => x.slice(-2));
    if (new Set(ends).size < ends.length) rhymeHits++;
  }
  const c = (v) => Math.round(Math.min(10, Math.max(0, v)));
  const categories = { wit: c(answered * 2 + total / 12), rhymes: c(1 + rhymeHits * 3 + (total > 20 ? 1 : 0)), comebacks: c((hits / n) * 9), confidence: c(total / 5) };
  const score = Math.round(Math.min(100, (categories.wit + categories.rhymes + categories.comebacks + categories.confidence) * 2.5));
  const sorted = [...said].sort((a, b) => words(b).length - words(a).length);
  return { score, roast: "", categories, best: capChars(sorted[0] || "silence", 120), worst: capChars(answered < n ? "silence" : sorted[sorted.length - 1] || "silence", 120) };
}

// Loose object matching: "white water bottle" ~ "water bottle" (colours / sizes / materials ignored).
const FILLER = new Set(["white", "black", "red", "blue", "green", "yellow", "pink", "purple", "orange", "grey", "gray", "brown", "silver", "gold", "golden", "clear", "dark", "light", "small", "big", "large", "little", "tiny", "old", "new", "plastic", "metal", "metallic", "glass", "wooden", "ceramic", "empty", "full", "shiny", "stainless", "steel", "reusable", "open", "closed"]);
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const coreWords = (s) => { const w = normObject(s).split(" ").filter(Boolean).map(singular); const c = w.filter((x) => !FILLER.has(x)); return c.length ? c : w; };
/** a ~ b when one's core words are all inside the other's (inText: b is free text, e.g. a memory). */
function sameObject(a, b, inText = false) {
  const A = coreWords(a), B = new Set(inText ? words(b).map(singular) : coreWords(b));
  if (!A.length || !B.size) return false;
  if (A.every((w) => B.has(w))) return true;
  return !inText && [...B].every((w) => A.includes(w));
}
/** Saved character for this object: exact key first, then a loose match (never mock entries). */
function looseKnown(map, object) {
  const exact = map[normObject(object)];
  if (exact) return exact;
  return Object.entries(map).find(([k]) => !k.startsWith("mock|") && sameObject(object, k))?.[1] || null;
}
// Ready-made characters when Gemma fails or times out ({o} = the object's last word).
const BACKUP_CHARS = [
  { name: "MC {o}", personality: "a cocky battle rapper who has never lost on home turf", voiceStyle: "young Mancunian man, fast, cocky, grime MC", catchphrase: "Mic check, our kid", colour: "#ff5a36" },
  { name: "Lady {o} of Didsbury", personality: "a posh dowager who slums it at rap battles", voiceStyle: "older posh British woman, withering, sarcastic", catchphrase: "How frightfully common", colour: "#b06bff" },
  { name: "Big {o} from Wythenshawe", personality: "a pub legend who peaked in 1996", voiceStyle: "gravelly older Mancunian man, pub storyteller", catchphrase: "Get the brews in, our kid", colour: "#ffcc00" },
];

// ---------- the game ----------
export function createDuet({ here, env, gemma, voices, remember, recall, broadcast, readJson, sendJson, crowdTally }) {
  const cacheDir = path.join(process.env.DUET_DATA_DIR || here, "cache");
  const ttsDir = path.join(cacheDir, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });
  const sessions = new Map();
  let difficulty = "spicy"; // mild | spicy (default) | savage - stage idle toggle via POST /api/difficulty
  let mode = "battle"; // battle (default) | karaoke - set from the stage idle toggle via POST /api/mode
  const isMock = (req) => env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url || "");
  const elevenKey = () => env("ELEVENLABS_API_KEY");

  // Characters we've met, on disk, so "returning" works even if NMAFC memory is offline.
  const knownFile = path.join(cacheDir, "characters.json");
  const loadKnown = () => { try { return JSON.parse(fs.readFileSync(knownFile, "utf8")); } catch { return {}; } };
  const saveKnown = (k) => fs.writeFileSync(knownFile, JSON.stringify(k, null, 1));
  // Character roster: every object ever snapped, with its photo copied to cache/characters/<id>.jpg.
  const charDir = path.join(cacheDir, "characters");
  fs.mkdirSync(charDir, { recursive: true });
  const rosterFile = path.join(cacheDir, "roster.json");
  const loadRoster = () => { try { const r = JSON.parse(fs.readFileSync(rosterFile, "utf8")); return r && typeof r === "object" ? r : {}; } catch { return {}; } };
  const saveRoster = (r) => { try { fs.writeFileSync(rosterFile, JSON.stringify(r, null, 1)); } catch (e) { console.warn("[duet] roster save", e.message); } };
  const rosterId = (mock, object) => "c_" + sha((mock ? "mock|" : "") + normObject(object));
  /** Add or update the roster entry for this snap. Returns the character id. */
  function upsertRoster({ mock, sessionId, made }) {
    try {
      const r = loadRoster();
      const id = rosterId(mock, made.object);
      const c = made.character || {};
      const old = r[id] || {};
      const src = path.join(cacheDir, `${sessionId}.jpg`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(charDir, `${id}.jpg`));
      r[id] = {
        id, name: c.name, object: made.object, colour: c.colour, voiceId: made.voiceId, ...(made.voiceDesigned || old.voiceDesigned ? { voiceDesigned: true } : {}), personality: c.personality, catchphrase: c.catchphrase,
        photo: `/api/charphoto/${id}.jpg`, face: made.face, outline: made.outline, bbox: made.bbox,
        played: (old.played || 0) + 1, bestScore: old.bestScore ?? null, createdAt: old.createdAt || Date.now(), updatedAt: Date.now(), ...(mock ? { mock: true } : {}),
      };
      saveRoster(r);
      return id;
    } catch (e) { console.warn("[duet] roster", e.message); return null; }
  }
  function rosterScore(id, score) {
    if (!id) return;
    const r = loadRoster();
    if (!r[id]) return;
    r[id].bestScore = Math.max(Number(r[id].bestScore) || 0, Number(score) || 0);
    r[id].lastScore = Number(score) || 0;
    saveRoster(r);
  }
  const boardFile = path.join(cacheDir, "leaderboard.json");
  const loadBoard = () => { try { return JSON.parse(fs.readFileSync(boardFile, "utf8")); } catch { return []; } };
  const topTen = (mock) => loadBoard().filter((e) => !!e.mock === !!mock).map(({ mock: _m, ...e }) => e).sort((a, b) => b.score - a.score).slice(0, 10);

  const quiet = (p, what = "") => p.catch((e) => { console.warn(`[duet]${what ? " " + what : ""}`, e.message); return null; });
  const memTexts = (r) => (Array.isArray(r) ? r : r?.results || r?.memories || []).map((m) => m?.memory || m?.fact || m?.text || m?.content || (typeof m === "string" ? m : "")).filter(Boolean);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  /** TTS with expressive settings, cached on disk by text+voice so repeats are free. Returns the cached file path. */
  // text may carry v3 [audio tags]: v3 performs them, the v2 fallback gets them stripped (it would read them aloud).
  async function tts(text, voiceId) {
    if (env("ELEVEN_V3", "1") !== "0") {
      try { return await ttsWith(rapText(text), voiceId, V3_MODEL, V3_SETTINGS); }
      catch (e) { console.warn("[duet] v3 tts failed, using v2:", e.message); }
    }
    return ttsWith(stripTags(String(text).replace(/\s*\/\s*/g, ", ")), voiceId, TTS_MODEL, VOICE_SETTINGS);
  }
  // Karaoke: the AI SINGS its line (eleven_v3 [sings] tag, melodic punctuation, slower). v2 fallback reads it plainly.
  async function sing(text, voiceId) {
    const line = stripTags(text).replace(/[.,;:]+$/, "");
    if (env("ELEVEN_V3", "1") !== "0") {
      try { return await ttsWith(`[sings] ${line.replace(/,\s*/g, "... ")}... ♪`, voiceId, V3_MODEL, { ...V3_SETTINGS, speed: Math.max(0.7, Math.min(1.2, Number(env("SING_SPEED", "0.85")))) }); }
      catch (e) { console.warn("[duet] v3 sing failed, using v2:", e.message); }
    }
    return ttsWith(line, voiceId, TTS_MODEL, VOICE_SETTINGS);
  }
  async function ttsWith(text, voiceId, model, settings) {
    const file = path.join(ttsDir, `${sha(`${model}|${voiceId}|${JSON.stringify(settings)}|${text}`)}.mp3`);
    if (fs.existsSync(file)) return file;
    return ttsGate(async () => {
      if (fs.existsSync(file)) return file;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${ELEVEN}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: model, text, voice_settings: settings }),
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

  // ---------- Voice Design: a unique, permanent ElevenLabs voice per NEW character ----------
  const designedFile = path.join(cacheDir, "designed-voices.json");
  const loadDesigned = () => { try { return JSON.parse(fs.readFileSync(designedFile, "utf8")) || {}; } catch { return {}; } };
  const saveDesigned = (d) => { try { fs.writeFileSync(designedFile, JSON.stringify(d, null, 1)); } catch (e) { console.warn("[duet] designed save", e.message); } };
  const elevenJson = async (p, body) => {
    const r = await ttsGate(() => fetch(`${ELEVEN}${p}`, { method: "POST", signal: AbortSignal.timeout(25000), headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if (!r.ok) throw new Error(`ElevenLabs ${p} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  };
  let designing = 0;
  /** Design + save a voice from the character's voiceStyle/personality. Returns the voice_id. Throws if off/full/failed. */
  async function designVoice(character, object) {
    if (env("VOICE_DESIGN", "1") === "0") throw new Error("VOICE_DESIGN=0");
    if (Object.keys(loadDesigned()).length + designing >= MAX_DESIGNED_VOICES) throw new Error("designed voice slots full");
    designing++;
    try {
      const desc = capChars(`${character.voiceStyle}. ${character.personality}. A ${object} brought to life as a cocky Manchester battle rapper. Characterful, expressive, clear studio audio.`, 480);
      const preview = `${character.catchphrase}! Right, listen here, our kid. I'm ${character.name}, the finest ${object} in all of Manchester, and I've heard better bars from a broken kettle. Go on then, give it your best shot.`.slice(0, 600);
      let d;
      try { d = await elevenJson("/text-to-voice/design?output_format=mp3_22050_32", { voice_description: desc, model_id: "eleven_ttv_v3", text: preview }); }
      catch (e) { if (!/ 4\d\d/.test(e.message)) throw e; d = await elevenJson("/text-to-voice/design?output_format=mp3_22050_32", { voice_description: desc, text: preview }); }
      const gen = d?.previews?.[0]?.generated_voice_id;
      if (!gen) throw new Error("voice design returned no preview");
      const saved = await elevenJson("/text-to-voice", { voice_name: capChars(`Duet - ${character.name}`, 60), voice_description: desc, generated_voice_id: gen, labels: { app: "duet-anything" } });
      if (!saved?.voice_id) throw new Error("voice save returned no voice_id");
      const all = loadDesigned();
      all[saved.voice_id] = { name: character.name, object, at: Date.now() };
      saveDesigned(all);
      console.log(`[duet] designed voice for ${character.name}`);
      return saved.voice_id;
    } finally { designing--; }
  }

  // ---------- Sound effects pack (ElevenLabs Sound Effects), generated once into cache/sfx/ ----------
  const sfxDir = path.join(cacheDir, "sfx");
  fs.mkdirSync(sfxDir, { recursive: true });
  const SFX_PACK = [
    { name: "cheer", seconds: 3, prompt: "Live club crowd cheering and whooping loudly after a rap battle, applause" },
    { name: "ooooh", seconds: 2.5, prompt: "Crowd of people going 'ooooh' in shocked reaction to a savage insult at a rap battle" },
    { name: "boo", seconds: 3, prompt: "Crowd booing loudly at a bad performance, live venue" },
    { name: "laugh", seconds: 3, prompt: "Live audience bursting into big laughter at a comedy roast" },
    { name: "airhorn", seconds: 2, prompt: "Hip hop air horn blasts, three quick hits" },
    { name: "scratch", seconds: 1.5, prompt: "DJ record scratch, vinyl rewind stop" },
    { name: "micdrop", seconds: 2, prompt: "Microphone dropped on a wooden stage, heavy thud with feedback ring" },
    { name: "drumroll", seconds: 3, prompt: "Snare drum roll building up, ending with a cymbal crash" },
  ];
  const sfxFile = (n) => path.join(sfxDir, `${n}.mp3`);
  async function ensureSfxPack() {
    const missing = SFX_PACK.filter((s) => !fs.existsSync(sfxFile(s.name)));
    if (!missing.length || !elevenKey() || env("MOCK") === "1" || env("SFX_PACK", "1") === "0") return;
    console.log(`[duet] generating ${missing.length} ElevenLabs sound effects in the background`);
    await Promise.all(missing.map((s) => ttsGate(async () => {
      try {
        const r = await fetch(`${ELEVEN}/sound-generation?output_format=mp3_44100_128`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" }, body: JSON.stringify({ text: s.prompt, duration_seconds: s.seconds, prompt_influence: 0.6 }) });
        if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
        fs.writeFileSync(sfxFile(s.name), Buffer.from(await r.arrayBuffer()));
      } catch (e) { console.warn(`[duet] sfx ${s.name}`, e.message); }
    })));
  }
  setTimeout(() => ensureSfxPack().catch((e) => console.warn("[duet] sfx pack", e.message)), 1500);

  /** Put an MP3 (real or silent) into cache/ under the session's public name. Returns { audio, ms }. */
  function publishAudio(name, buf) {
    fs.writeFileSync(path.join(cacheDir, name), buf);
    return { audio: `/api/audio/${name}`, ms: mp3Ms(buf.length) };
  }

  async function buildSong({ id, image, mock, mode = "battle", difficulty = "spicy", noMusic = false }) {
    if (mock) {
      const known = loadKnown()["mock|coffee mug"];
      broadcast({ type: "object-seen", id, object: "coffee mug", at: Date.now() }); // stage "under the hood" lines
      broadcast({ type: "memory-hits", id, count: known ? 1 : 0, known: !!known, at: Date.now() });
      return { object: "coffee mug", returning: !!known, character: { ...MOCK_CHARACTER }, song: mockSong(!!known, mode, difficulty), voiceId: "mock", face: defaultFace(), ...ellipseShape() };
    }
    // 1) Quick look + generic memory search in parallel, then a targeted search.
    const [look, generic] = await Promise.all([
      quiet(gemma({ prompt: "What is the main object in this photo? Answer with 1-4 plain words only, e.g. 'coffee mug'.", image, temperature: 0.1, maxTokens: 256, timeoutMs: 10000 }), "quick look"),
      quiet(withTimeout(recall("objects that battled or sang duets with the user", 6), 4000), "recall"),
    ]);
    const guess = capWords(String((!look?.mock && look?.text) || "").replace(/["'.\n]/g, " ").trim(), 5).toLowerCase();
    const specific = guess ? await quiet(withTimeout(recall(`${guess} character battle duet score best line roast`, 6), 4000)) : null;
    const memories = [...new Set([...memTexts(specific), ...memTexts(generic)])].slice(0, 10);
    const knownMap = loadKnown();
    const known = guess ? looseKnown(knownMap, guess) : null;
    if (guess) broadcast({ type: "object-seen", id, object: guess, at: Date.now() }); // stage "under the hood" lines
    broadcast({ type: "memory-hits", id, count: memories.length, known: !!known, at: Date.now() });

    // 2) One Gemma call (photo + memories) for character + song. Retry once if the JSON is broken.
    let out = null, lastR = true;
    for (let tries = 0; tries < 2 && !out?.song; tries++) {
      if (tries && !lastR) break; // timed out / API error: don't wait another 20 s, use the backup below
      const r = lastR = await quiet(gemma({ prompt: songPrompt({ object: guess, memories, known: known && { ...known.character, lastScore: known.lastScore, lastWinner: known.lastWinner, lastBest: known.lastBest, lastRoast: known.lastRoast }, mode, difficulty, avoidNames: known ? [] : Object.values(knownMap).map((v) => v?.character?.name).filter(Boolean).slice(-30) }), image, json: true, temperature: 0.9, maxTokens: 1500, timeoutMs: Number(process.env.GEMMA_SONG_TIMEOUT_MS) || 35000 }), "song");
      if (r?.json && typeof r.json === "object") out = r.json;
    }
    const backup = !out?.song; // Gemma failed / timed out: ready-made backup character + opener (real TTS still)
    if (!out) out = {};
    const object = capWords(out.object || guess || "mystery object", 5).toLowerCase();
    if (backup) {
      console.warn("[duet] Gemma gave no song - using the backup character");
      const b = BACKUP_CHARS[Math.floor(Math.random() * BACKUP_CHARS.length)];
      out.character ||= { ...b, name: b.name.replace("{o}", object.split(" ").pop().replace(/^./, (c) => c.toUpperCase())) };
      out.song = mockSong(false, mode, difficulty);
      if (mode !== "karaoke") out.song.lines[0].text = out.song.lines[0].text.replace(/\bmug\b/gi, object.split(" ").pop());
      delete out.song.title;
    }
    let character = repairCharacter(out.character, object);
    const byName = (n) => Object.entries(knownMap).find(([k, v]) => !k.startsWith("mock|") && v.character?.name?.toLowerCase() === String(n || "").toLowerCase())?.[1];
    const knownAfter = known || looseKnown(knownMap, object) || byName(character.name); // Gemma kept a remembered name
    if (knownAfter) character = { ...character, ...knownAfter.character }; // same name/voice/personality every time
    const song = repairSong(out.song, object, mode);
    if (song.battle && !noMusic) startRapTrack(song, character.voiceStyle); // real rapped opener (Music API), runs during voice design + opener TTS
    // Returning only on a REAL match: a saved character (loose object match / same name) or a memory that names this object.
    const returning = !!knownAfter || memories.some((m) => sameObject(object, m, true));

    // 3) Voice: reuse the one this character had before, else match voiceStyle against the labels.
    // NEW characters get a unique Voice Design voice (in parallel with the library list; max 12s, else library pick).
    let voiceId = knownAfter?.voiceId;
    let voiceDesigned = false;
    const designP = knownAfter ? null : designVoice(character, object);
    if (designP) broadcast({ type: "voice-designing", id, name: character.name, at: Date.now() });
    designP?.catch(() => {}); // a late failure is fine, handled below
    const [listR, designedId] = await Promise.all([
      quiet(voices(), "voices"),
      designP ? quiet(withTimeout(designP, Number(process.env.VOICE_DESIGN_WAIT_MS) || 20000), "voice design") : null,
    ]);
    const list = listR || (await quiet(voices(), "voices retry")) || [];
    if (designedId) { voiceId = designedId; voiceDesigned = true; }
    else if (designP) { // too slow: let it finish, and the character gets it next time it's snapped
      const key = normObject(object);
      const apply = (vid, tries) => { const k = loadKnown(); if (!k[key]) return tries > 0 && setTimeout(() => apply(vid, tries - 1), 15000); if (loadDesigned()[k[key].voiceId]) return; k[key].voiceId = vid; saveKnown(k); const r = loadRoster(), rid = rosterId(false, object); if (r[rid]) { r[rid].voiceId = vid; r[rid].voiceDesigned = true; saveRoster(r); } };
      designP.then((vid) => apply(vid, 4)).catch(() => {});
    }
    const designedOk = voiceId && loadDesigned()[voiceId];
    if (!voiceId || (!designedOk && list.length && !list.some((v) => v.id === voiceId))) voiceId = pickVoice(list, character.voiceStyle)?.id || env("DUET_FALLBACK_VOICE", "JBFqnCBsd6RMkjVDRZzb");
    // Face: from this photo if Gemma gave a sensible one, else the remembered one, else centred default.
    const shape = repairShape(out.outline, out.bbox);
    const face = repairFace(out.face) || faceInBox(shape.bbox);
    return { object, returning, character, song, voiceId, voiceDesigned, face, outline: shape.outline, bbox: shape.bbox };
  }

  // ---------- RAP_MUSIC=1 (default): the opener as a real rap track from the ElevenLabs Music API ----------
  // Started in buildSong (parallel with voice design). makeAudio waits up to RAP_MUSIC_WAIT_MS (25 s from start);
  // if it lands, line 0 gets rapAudio/rapMs and the stage plays it instead of TTS + Tone beat. 401/402/403 = plan
  // has no Music API: logged once and switched off. Cached by lyrics in cache/music/.
  const musicDir = path.join(cacheDir, "music");
  let musicOff = false;
  const rapJobs = new WeakMap();
  function startRapTrack(song, voiceStyle = "") {
    if (musicOff || env("RAP_MUSIC", "0") !== "1" || !elevenKey() || env("MOCK") === "1") return;
    const line = song.lines?.[0];
    const bars = String(line?.speech || line?.text || "").split(/\s*\/\s*|(?<=[.!?])\s+/).map((b) => stripTags(b)).filter(Boolean).slice(0, 8);
    if (!bars.length) return;
    const bpm = song.bpm || 100;
    const dur = Math.round(Math.max(12000, Math.min(20000, ((Math.max(4, bars.length) * 2 * 240) / bpm) * 1000)));
    const file = path.join(musicDir, `${sha(`${bpm}|${song.genre}|${bars.join("/")}`)}.mp3`);
    const t0 = Date.now();
    const p = (async () => {
      if (fs.existsSync(file)) return fs.readFileSync(file);
      const res = await fetch(`${ELEVEN}/music?output_format=mp3_44100_128`, {
        method: "POST", signal: AbortSignal.timeout(45000),
        headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: env("RAP_MUSIC_MODEL", "music_v1"), composition_plan: {
          // The rapper's voice comes from the object's character (voiceStyle), not a fixed accent.
          positive_global_styles: ["hip-hop", "battle rap", "solo rapper", ...(voiceStyle ? [`rapper voice: ${String(voiceStyle).slice(0, 90)}`] : ["confident MC"]), "confident flow", `${bpm} bpm`, `${song.genre || "hip hop"} beat`, "hard drums, deep 808 bass"],
          negative_global_styles: ["singing", "melodic chorus", "choir", "slow ballad"],
          sections: [{ section_name: "Verse", positive_local_styles: ["rapped verse on the beat", "punchy delivery"], negative_local_styles: ["sung"], duration_ms: dur, lines: bars }],
        } }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        if ([401, 402, 403].includes(res.status)) { musicOff = true; console.warn(`[duet] Music API not available on this plan (${res.status}) - RAP_MUSIC off: ${body}`); }
        throw new Error(`Music API ${res.status}: ${body}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(musicDir, { recursive: true });
      fs.writeFileSync(file, buf);
      console.log(`[duet] rap track ready in ${Date.now() - t0} ms (${buf.length} bytes)`);
      return buf;
    })();
    p.catch((e) => console.warn("[duet] rap track", e.message));
    rapJobs.set(song, { p, t0 });
  }

  async function makeAudio({ id, song, voiceId, mock }) {
    const rap = rapJobs.get(song);
    const rapP = rap && withTimeout(rap.p, Math.max(1000, Number(env("RAP_MUSIC_WAIT_MS", "25000")) - (Date.now() - rap.t0))).catch(() => null);
    await Promise.all(song.lines.map(async (line, i) => {
      if (line.who !== "object") { line.ms = youMs(line.text); return; }
      if (i === 0 && rapP) rapP.then((buf) => { if (buf) { const a = publishAudio(`${id}_0_rap.mp3`, buf); line.rapAudio = a.audio; line.rapMs = a.ms; } });
      const name = `${id}_${i}.mp3`;
      if (mock) Object.assign(line, publishAudio(name, silentMp3(1200 + line.text.length * 55)));
      else {
        try { Object.assign(line, publishAudio(name, fs.readFileSync(await tts(line.speech || line.text, voiceId)))); }
        catch (e) { console.warn("[duet] tts", e.message); Object.assign(line, publishAudio(name, silentMp3(1200 + line.text.length * 55)), { ttsFailed: true }); }
      }
    }));
    if (rapP) await rapP; // (the .then above has run by now: it was attached first)
  }

  /** ElevenLabs speech-to-text (Scribe). Returns the transcript. */
  async function stt(audio, mime) {
    const type = mime || "audio/webm";
    const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "webm";
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audio, "base64")], { type }), `take.${ext}`);
    form.append("language_code", "en");
    form.append("tag_audio_events", "false");
    const send = (model) => { form.set("model_id", model); return fetch(`${ELEVEN}/speech-to-text`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { "xi-api-key": elevenKey() }, body: form }); };
    let r = await send("scribe_v2"); // newest Scribe; v1 if this account/region doesn't have it
    if (!r.ok && r.status !== 429) { console.warn("[duet] scribe_v2", r.status, (await r.text()).slice(0, 120)); r = await send("scribe_v1"); }
    if (!r.ok) throw new Error(`ElevenLabs STT ${r.status}: ${(await r.text()).slice(0, 160)}`);
    // Scribe tags non-speech like "(laughs)" / "[music]": drop those so silence counts as silence.
    return String((await r.json()).text || "").replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim();
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

      const gameMode = mode, gameDifficulty = difficulty;
      const made = await buildSong({ id, image: { data: image.data, mime: image.mime || "image/jpeg" }, mock, mode: gameMode, difficulty: gameDifficulty });
      await makeAudio({ id, song: made.song, voiceId: made.voiceId, mock });
      const session = { id, photo, returning: made.returning, object: made.object, character: made.character, face: made.face, outline: made.outline, bbox: made.bbox, song: made.song, voiceId: made.voiceId, mode: gameMode, difficulty: gameDifficulty, ...(made.song.battle ? { battle: made.song.battle } : {}), ...(mock ? { mock: true } : {}) };
      sessions.set(id, { ...session, takes: {}, rounds: {} });

      // Remember the character (disk now, NMAFC in the background - never block the reply).
      const k = loadKnown();
      const key = (mock ? "mock|" : "") + normObject(made.object);
      const prev = k[key];
      if (made.returning && prev) { // stage "OPENLOFT MEMORY FOUND" card: last time's photo, date, score, best line
        let prevPhoto = null;
        try { const old = path.join(charDir, `${rosterId(mock, made.object)}.jpg`); if (fs.existsSync(old)) { fs.copyFileSync(old, path.join(cacheDir, `${id}_prev.jpg`)); prevPhoto = `/api/photo/${id}_prev.jpg`; } } catch { /* no old photo */ }
        session.memory = { photo: prevPhoto, lastAt: prev.at || null, lastScore: prev.lastScore ?? null, lastBest: prev.lastBest || null, lastWinner: prev.lastWinner || null, seen: prev.seen || 1 };
        if (sessions.get(id)) sessions.get(id).memory = session.memory;
      }
      k[key] = { ...(k[key] || {}), object: made.object, character: made.character, face: made.face, voiceId: made.voiceId, seen: (k[key]?.seen || 0) + 1, at: Date.now() };
      saveKnown(k);
      const charId = upsertRoster({ mock, sessionId: id, made });
      if (sessions.get(id)) sessions.get(id).charId = charId;
      session.charId = charId;
      if (!mock) quiet(remember(`Duet Anything met a ${made.object}. It is the character ${made.character.name}: ${made.character.personality}. Voice style: ${made.character.voiceStyle}. Catchphrase: "${made.character.catchphrase}". ${gameMode === "battle" ? `It started a freestyle roast battle "${made.song.title}" with: "${made.song.lines[0]?.text}"` : `They started the karaoke song "${made.song.title}" (${made.song.genre})`}.`));

      broadcast({ type: "song-ready", session, at: Date.now() });
      sendJson(res, 200, session);
    },

    "POST /api/take": async (req, res) => {
      const body = await readJson(req);
      const { id, audio, mime } = body;
      const s = sessions.get(id);
      if (!s) return sendJson(res, 404, { error: "unknown session id" });
      const mock = !!(s.mock || env("MOCK") === "1" || /[?&]mock=1\b/.test(req.url));
      const t0 = Date.now();
      // Silent take: phone flagged it, or the recording is under 2 KB (no real audio) -> skip STT, transcript "".
      const takeBytes = audio ? Math.floor(String(audio).length * 3 / 4) : 0;
      const silentTake = !mock && (body.silent === true || (!!audio && takeBytes < 2048));
      if (audio || body.silent) console.log(`[duet] take ${id} r${body.round ?? body.line}: ${takeBytes} B, ${Math.round(Number(body.durationMs) || 0)} ms${silentTake ? " (silent)" : ""}`);
      const mockSaid = mock && typeof body.transcript === "string" ? body.transcript : null; // MOCK test hook: inject what was "heard"

      // ----- Freestyle roast battle: STT -> Gemma comeback -> TTS, no extra waits -----
      if (s.mode === "battle") {
        const rounds = s.battle?.rounds || battleCfg().rounds;
        const round = Math.max(1, Math.min(rounds, Math.round(Number(body.round ?? body.line)) || 1));
        let transcript = "";
        if (mock) transcript = mockSaid ?? MOCK_TRANSCRIPTS[(round - 1) % MOCK_TRANSCRIPTS.length];
        else if (audio && !silentTake) { try { transcript = await stt(audio, mime); } catch (e) { console.warn("[duet] stt", e.message); } }
        transcript = mask(capChars(transcript, 400)); // shown on screen: swears masked with stars
        broadcast({ type: "take-heard", id, round, line: round, transcript, at: Date.now() });
        const last = round >= rounds;
        let comeback = null;
        if (!last) {
          let text = "";
          if (mock) text = MOCK_LINES[normDifficulty(s.difficulty)].comebacks[transcript ? 0 : 1];
          else {
            const r = await quiet(withTimeout(gemma({ prompt: comebackPrompt(s, round, transcript), json: true, temperature: 1, maxTokens: 400 }), 9000), "comeback");
            text = String(r?.json?.text || r?.json?.comeback || "").trim();
          }
          if (!text) {
            const q = capWords(transcript, 6);
            text = q ? `[scoffs] "${q}"? Is that it, you muppet? [laughs] I've heard better bars from a broken kettle, our kid.` : "[whispers] Cat got your tongue? [laughs] Proper silence, you muppet. Even the kettle's got more to say.";
          }
          const said = splitTags(text, COMEBACK_CHARS); // speech keeps the [tags] for v3, the screen gets display
          text = said.display;
          const name = `${id}_cb${round}.mp3`;
          comeback = { text };
          if (mock) Object.assign(comeback, publishAudio(name, silentMp3(1200 + text.length * 55)));
          else {
            try { Object.assign(comeback, publishAudio(name, fs.readFileSync(await tts(said.speech, s.voiceId)))); }
            catch (e) { console.warn("[duet] comeback tts", e.message); Object.assign(comeback, publishAudio(name, silentMp3(1200 + text.length * 55)), { ttsFailed: true }); }
          }
        }
        s.rounds[round] = { transcript, comeback };
        s.takes[round] = { transcript, accuracy: 0 };
        const out = { round, line: round, transcript, comeback, last, ms: Date.now() - t0 };
        broadcast({ type: "take-received", id, ...out, at: Date.now() });
        return sendJson(res, 200, out);
      }

      // ----- Karaoke: score the line on accuracy -----
      const idx = Number(body.line);
      const target = s.song.lines[idx]?.text || "";
      let transcript = "";
      if (mock) transcript = mockSaid ?? target.split(" ").filter(() => Math.random() > 0.25).join(" "); // drop a word or two so the score varies
      else if (silentTake) transcript = "";
      else {
        if (!audio) return sendJson(res, 400, { error: "send { id, line, audio: base64, mime }" });
        transcript = await stt(audio, mime);
      }
      const acc = accuracy(target, transcript);
      transcript = mask(transcript);
      s.takes[idx] = { transcript, accuracy: acc };
      broadcast({ type: "take-received", id, line: idx, transcript, accuracy: acc, at: Date.now() });
      sendJson(res, 200, { transcript, accuracy: acc });
    },

    "POST /api/judge": async (req, res) => {
      const { id } = await readJson(req);
      const s = sessions.get(id);
      if (!s) return sendJson(res, 404, { error: "unknown session id" });
      const mock = s.mock || env("MOCK") === "1";
      const battle = s.mode === "battle";
      let verdict;
      if (battle) {
        // Transparent rubric (lib/rubric.mjs): delivery / rhymes / comebacks measured in code; Gemma only marks wit.
        const n = s.battle?.rounds || battleCfg().rounds;
        const rubRounds = Array.from({ length: n }, (_, i) => ({ transcript: s.rounds?.[i + 1]?.transcript || "", prev: i === 0 ? s.song.lines[0]?.text : s.rounds?.[i]?.comeback?.text || "" }));
        const rubOpts = { turnMs: s.battle?.youMs || battleCfg().youMs, difficulty: normDifficulty(s.difficulty) };
        let rub = scoreBattle(rubRounds, rubOpts);
        const h = battleHeuristic(s);
        verdict = { score: rub.score, roast: "", best: h.best, worst: h.worst };
        if (mock) {
          const [good, bad] = MOCK_LINES[normDifficulty(s.difficulty)].roasts(capWords(verdict.best, 8));
          verdict.roast = !rub.silent && verdict.best !== "silence" ? good : bad; // "bad" = the silence roast
        } else {
          const r = await quiet(withTimeout(gemma({ prompt: battleJudgePrompt(s, rub), json: true, temperature: 0.9, maxTokens: 700 }), 12000), "judge");
          const j = r?.json || {};
          if (Number.isFinite(Number(j.wit))) rub = scoreBattle(rubRounds, { ...rubOpts, wit: Number(j.wit) });
          verdict.score = rub.score;
          verdict.roast = (!rub.silent && j.roast) || (rub.silent ? `[scoffs] ${n} rounds and not one word. Even the ${s.object} had more to say, you wet wipe.` : `${s.character.catchphrase}! Is that it? Absolute weapon.`);
          const na = (v) => /^n.?a$/i.test(String(v));
          if (j.best && !na(j.best) && !rub.silent) verdict.best = capChars(j.best, 120);
          if (j.worst && !na(j.worst)) verdict.worst = capChars(j.worst, 120);
        }
        if (rub.silent) { verdict.best = "silence"; verdict.worst = "silence"; }
        verdict.categories = rub.categories;
        verdict.reasons = rub.reasons;
      } else {
        const youIdx = s.song.lines.map((l, i) => (l.who === "you" ? i : -1)).filter((i) => i >= 0);
        const accs = youIdx.map((i) => s.takes[i]?.accuracy ?? 0);
        const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
        const bestI = youIdx.reduce((b, i) => ((s.takes[i]?.accuracy ?? -1) > (s.takes[b]?.accuracy ?? -1) ? i : b), youIdx[0]);
        const worstI = youIdx.reduce((b, i) => ((s.takes[i]?.accuracy ?? -1) < (s.takes[b]?.accuracy ?? -1) ? i : b), youIdx[0]);
        const kar = scoreKaraoke(accs, youIdx.map((i) => s.takes[i]?.transcript || ""));
        verdict = { score: kar.score, roast: "", best: kar.silent ? "silence" : s.song.lines[bestI]?.text || "", worst: kar.silent ? "silence" : s.song.lines[worstI]?.text || "", categories: kar.categories, reasons: kar.reasons };
        if (mock) {
          const [good, bad] = MOCK_LINES[normDifficulty(s.difficulty)].karaoke;
          verdict.roast = verdict.score >= 70 ? good : bad;
        } else {
          const r = await quiet(gemma({ prompt: judgePrompt(s, s.takes) + `
The score is ALREADY computed from lyric accuracy: ${kar.score}/100 (${kar.reasons.lyrics}). Your roast must match it.`, json: true, temperature: 0.9, maxTokens: 1024 }), "judge");
          const j = r?.json || {};
          if (!kar.silent && Number.isFinite(Number(j.score))) verdict.score = Math.round(Math.min(100, Math.max(0, Math.min(kar.score + 5, Math.max(kar.score - 5, Number(j.score)))))); // Gemma flair: +/-5 at most
          verdict.roast = (!kar.silent && j.roast) || (kar.silent ? "[sighs] Not one word sung. I've heard livelier silence in a library, you clown." : `${s.character.catchphrase}! You were... something, you div.`);
          const na = (v) => /^n.?a$/i.test(String(v));
          if (!kar.silent && j.best && !na(j.best)) verdict.best = capChars(j.best, 120);
          if (!kar.silent && j.worst && !na(j.worst)) verdict.worst = capChars(j.worst, 120);
        }
      }
      const roastSaid = splitTags(verdict.roast, ROAST_CHARS); // [tags] go to v3, the screen gets display
      verdict.roast = roastSaid.display;
      // Audience phones voted each battle round: up to +/-10 on the final score (lib/audience.mjs).
      const crowd = battle && crowdTally ? crowdTally(id) : null;
      if (crowd?.total) verdict.score = Math.round(Math.min(100, Math.max(0, verdict.score + crowd.bonus)));
      const name = `${id}_roast.mp3`;
      let audio = null;
      try {
        audio = mock ? publishAudio(name, silentMp3(1500 + verdict.roast.length * 55)).audio : publishAudio(name, fs.readFileSync(await tts(roastSaid.speech, s.voiceId))).audio;
      } catch (e) { console.warn("[duet] roast audio", e.message); }
      const out = { score: verdict.score, roast: verdict.roast, audio, best: verdict.best, worst: verdict.worst, ...(verdict.categories ? { categories: verdict.categories } : {}), ...(verdict.reasons ? { reasons: verdict.reasons } : {}), mode: s.mode, ...(crowd?.total ? { crowd: { player: crowd.player, object: crowd.object, bonus: crowd.bonus } } : {}) };
      s.verdict = out;

      const board = loadBoard();
      board.push({ name: s.character.name, object: s.object, score: out.score, title: s.song.title, mode: s.mode, at: Date.now(), ...(mock ? { mock: true } : {}) });
      fs.writeFileSync(boardFile, JSON.stringify(board.slice(-500), null, 1));
      const winner = out.score >= 60 ? "the user" : s.character.name;
      const k = loadKnown();
      const key = (mock ? "mock|" : "") + normObject(s.object);
      if (k[key]) { Object.assign(k[key], { lastScore: out.score, lastRoast: out.roast, lastMode: s.mode }, battle ? { lastBest: out.best, lastWinner: winner } : {}); saveKnown(k); }
      rosterScore(s.charId || rosterId(mock, s.object), out.score); // roster: best score per character
      if (!mock) quiet(remember(battle
        ? `${s.character.name} the ${s.object} had a freestyle roast battle "${s.song.title}" with the user. Winner: ${winner}. User scored ${out.score}/100. User's best line: "${out.best}". Worst: "${out.worst}". Roast: "${out.roast}"`
        : `${s.character.name} the ${s.object} watched the user sing karaoke '${s.song.title}', score ${out.score}, roast: "${out.roast}"`));

      broadcast({ type: "verdict", id, score: out.score, roast: out.roast, audio, best: out.best, worst: out.worst, categories: out.categories, reasons: out.reasons, crowd: out.crowd, at: Date.now() });
      sendJson(res, 200, out);
    },

    "GET /api/mode": async (req, res) => sendJson(res, 200, { mode }),
    "GET /api/difficulty": async (req, res) => sendJson(res, 200, { difficulty }),
    "POST /api/difficulty": async (req, res) => {
      const { difficulty: d } = await readJson(req);
      if (!DIFFICULTIES.includes(String(d || "").toLowerCase())) return sendJson(res, 400, { error: "difficulty must be mild, spicy or savage" });
      difficulty = String(d).toLowerCase();
      broadcast({ type: "difficulty", difficulty, at: Date.now() });
      sendJson(res, 200, { difficulty });
    },
    // ElevenLabs crowd/stage sound effects that exist on disk (generated once at start): [{ name, url }]
    "GET /api/sfx-pack": async (req, res) => sendJson(res, 200, SFX_PACK.filter((x) => fs.existsSync(sfxFile(x.name))).map((x) => ({ name: x.name, url: `/api/sfx/${x.name}.mp3` }))),
    "POST /api/mode": async (req, res) => {
      const { mode: m } = await readJson(req);
      if (m !== "battle" && m !== "karaoke") return sendJson(res, 400, { error: "mode must be battle or karaoke" });
      mode = m;
      broadcast({ type: "mode", mode, at: Date.now() });
      sendJson(res, 200, { mode });
    },

    "GET /api/leaderboard": async (req, res) => sendJson(res, 200, topTen(isMock(req))), // mock runs keep their own board
    // Character roster, newest first (mock runs keep their own roster)
    "GET /api/characters": async (req, res) => {
      const mock = isMock(req);
      const list = Object.values(loadRoster()).filter((c) => c && !!c.mock === mock && fs.existsSync(path.join(charDir, `${c.id}.jpg`)))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50).map(({ mock: _m, ...c }) => c);
      sendJson(res, 200, list);
    },
  };

  /** Serve /api/photo/:id.jpg and /api/audio/:file.mp3 from cache/. Returns true if handled. */
  function serveCache(urlPath, res) {
    const sm = urlPath.match(/^\/api\/sfx\/([a-z]+)\.mp3$/); // ElevenLabs sound-effects pack
    if (sm) {
      const file = sfxFile(sm[1]);
      if (!fs.existsSync(file)) { res.writeHead(404).end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": fs.statSync(file).size, "Cache-Control": "public, max-age=3600" });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    const cm = urlPath.match(/^\/api\/charphoto\/(c_[0-9a-f]{16})\.jpg$/); // roster cut-out photos
    if (cm) {
      const file = path.join(charDir, `${cm[1]}.jpg`);
      if (!fs.existsSync(file)) { res.writeHead(404).end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": fs.statSync(file).size, "Cache-Control": "no-cache" });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    const m = urlPath.match(/^\/api\/(photo|audio)\/([A-Za-z0-9_-]+)\.(jpg|mp3)$/);
    if (!m || (m[1] === "photo") !== (m[3] === "jpg")) return false;
    const file = path.join(cacheDir, `${m[2]}.${m[3]}`);
    if (!fs.existsSync(file)) { res.writeHead(404).end("Not found"); return true; }
    const size = fs.statSync(file).size;
    res.writeHead(200, { "Content-Type": m[3] === "jpg" ? "image/jpeg" : "audio/mpeg", "Content-Length": size, "Cache-Control": "public, max-age=3600", "Accept-Ranges": "none" });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  return { helpers: { buildSong, tts, sing, stt, accuracy, silentMp3, mask, MOCK_CHARACTER, defaultFace, ellipseShape, publishAudio, upsertRoster, rosterScore, rosterId, loadKnown, saveKnown, RAP_RULE, splitTags }, /* lib/pvp.mjs + lib/ovo.mjs */ routes, serveCache, sessions, getMode: () => mode, getDifficulty: () => difficulty, battleCfg, normDifficulty, toneBlock, tagRule };
}
