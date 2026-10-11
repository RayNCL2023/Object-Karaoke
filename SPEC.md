# Duet Anything — build spec (shared by every bot on the team)

**Pitch:** Snap any object with your phone. It comes alive as a cheeky Mancunian character and sings a karaoke DUET with you. You sing your lines into your phone like a mic; the object sings back, then roasts your performance and scores you. It remembers every object it has met, so the same mug always has the same name, voice and grudges.

Hack day: Hacktoberfest Hack Day Manchester, 11 Oct 2026. Team: Kaif Nadeem + Debanjan Ray. All code written today. Submissions close 18:10 BST.
Tracks (all 8): Gemma 4 · Open-Source AI · ElevenLabs · OpenLoft (NMAFC memory) · Music · Best UI · Manchester Madness · Physical World (phone camera + mic + vibration).

## Rules for every bot
- Node, no npm installs. Browser libs only from a CDN (cdnjs / jsdelivr), e.g. Tone.js `https://cdnjs.cloudflare.com/ajax/libs/tone/15.0.4/Tone.min.js` (check the URL loads).
- Only edit the files you own (below). Use the contracts here exactly.
- Never print or log API keys. Never run git commit/push.
- ElevenLabs credit is limited: object lines max 90 characters each, max 4 object lines per song, cache every generated MP3 on disk and reuse it.
- `MOCK=1` in the environment (or `?mock=1` on /api/object) must give a full working flow with NO paid calls (canned persona, canned song, a short generated beep/silent MP3 or the stage's own Tone.js voice), so the UI can be built and tested for free.
- Tone: cheeky, friendly Manchester roasting ("our kid", "mint", "proper", "buzzin'", "sound", "our Nan"), never nasty, nothing offensive about real people.

## Screens
- **Stage** `/` (laptop / projector): `public/index.html`, `public/stage.js`, `public/stage.css`.
- **Mic** `/mic.html` (phone): `public/mic.html`, `public/mic.js`.
- Existing: `public/api.js` (helpers; may be extended), `public/test.html` (feature test page; leave alone), `public/phone.html` (old pads; leave alone).

## Flow
1. Stage idle: big title "Duet Anything", the phone URL (from `/api/status` → `phoneUrl`, but point it at `/mic.html`) and a short "Snap anything to start".
2. Phone: big **Snap** button (`<input type="file" accept="image/*" capture="environment">`), shrinks the photo to max 1024px JPEG in a canvas, POSTs `/api/object`. Shows "Waking it up…".
3. Server `/api/object` (uses the current **mode**, `battle` default or `karaoke`, toggled on the stage idle screen / key M → `POST /api/mode`): recall memory → one Gemma 4 call (JSON, random naming style + do-not-reuse name list) → voice → MP3s → remember → broadcast `song-ready` → return the session.
4. **Roast battle (main mode, freestyle, NO lyrics for the user):** object raps its opener (2–4 savage rhyming bars, ≤ 200 chars, its lyrics show). Then 3 rounds: stage shows "FREESTYLE!" + big countdown and broadcasts `record-start {line: round, round, ms: youMs (12000)}`; phone shows "FREESTYLE! Roast it back 🎤" + seconds countdown (no lyric text), records, POSTs `/api/take`. Server: speech-to-text → broadcast `take-heard` (stage shows what you actually said) → one fast Gemma call writes the object's COMEBACK twisting your words (≤ 180 chars; silence gets mocked) → TTS → `take-received` with the comeback → stage plays it with its text as lyrics. Round 3 has no comeback: straight to judging.
5. **Karaoke (secondary mode):** Gemma writes an ORIGINAL song (8–12 lines, repeating chorus, never real lyrics; MOCK uses public-domain "Twinkle Twinkle"). The user sings every line (lyrics + wipe on the stage only); the phone is just a mic recording each line; scored on lyric accuracy; the object dances as hype man.
6. Stage calls `/api/judge` → harsh roast (MP3 + text), score 0–100 (battle also shows Wit/Rhymes/Comebacks/Confidence 0–10), confetti; result remembered (battle: winner + your best line); leaderboard updated.
7. "Again" → back to idle. Snapping the same object again → it recognises you and throws last time's battle in your face.
Tone: savage battle-rap roasting of the PERFORMANCE (Manc slang, "melt", "muppet", "absolute weapon"); no slurs, nothing about protected traits or real tragedies, no strong swearing.

## API contracts (server.mjs + lib/duet.mjs)
All JSON unless noted. `session` objects are kept in memory on the server (Map by id).

`POST /api/object` body `{ image: { data: base64, mime } }` →
```json
{ "id": "s_abc123",
  "photo": "/api/photo/s_abc123.jpg",
  "returning": false,
  "object": "coffee mug",
  "character": { "name": "Mug Jagger", "personality": "washed-up rock star mug", "voiceStyle": "older male, raspy, Northern", "catchphrase": "Pour us another, our kid", "colour": "#ff5a36" },
  "song": { "title": "Brew Me Tender", "genre": "britpop", "bpm": 112, "key": "C",
            "lines": [ { "who": "object", "text": "...", "audio": "/api/audio/s_abc123_0.mp3", "ms": 3800 },
                       { "who": "you", "text": "...", "ms": 4000 } ] },
  "voiceId": "..." }
```
- Battle session: `mode: "battle"`, `battle: { rounds: 3, youMs: 12000 }`, `song.lines` = `[ { who: "object", text: opener, audio, ms } ]`. Karaoke session: `mode: "karaoke"`, 8–12 `{ who: "you", text, ms }` lines (≤ 10 words; ms ≈ words × 450 + 1200).
- Gemma prompt gets the photo + recalled memories. If memories show this object before, keep the same name/personality/voiceStyle and set `returning: true`, referencing last score/roast in the first line.

`GET /api/photo/:id.jpg`, `GET /api/audio/:file.mp3` → files from `cache/`.

`POST /api/take` body `{ id, round|line, audio: base64, mime }` → battle: `{ round, transcript, comeback: { text, audio, ms } | null, last }` (ElevenLabs Scribe STT → Gemma comeback → TTS; broadcasts `take-heard {round, transcript}` then `take-received {round, line, transcript, comeback}`); karaoke: `{ transcript, accuracy }`. MOCK: canned transcripts + comebacks, silent MP3s.

`GET /api/mode` → `{ mode }`; `POST /api/mode` body `{ mode: "battle" | "karaoke" }` (also in `/api/status`, broadcasts `mode`).

`POST /api/judge` body `{ id }` → `{ score, roast, audio, best, worst, categories?, mode }` — battle: Gemma judges ONLY the user's transcripts vs the object's lines: `categories { wit, rhymes, comebacks, confidence }` 0–10, score 0–100, ≤ 2-sentence roast quoting their best/worst line, `best`/`worst` verbatim; karaoke: from line accuracy. Roast spoken via ElevenLabs (≤ 160 chars); NMAFC remembers the battle (winner, best line). Broadcast `verdict`.

`GET /api/leaderboard` → `[{ name, object, score, title, at }]` (top 10, saved in `cache/leaderboard.json`).

`POST /api/broadcast` (alias of existing `/api/phone`) body = any event; `GET /api/events` = Server-Sent Events stream (exists).

## Events (SSE, `{ type, ... }`)
`photo-received` · `song-ready {session}` · `line {index}` · `record-start {line, round?, ms}` · `take-heard {round, transcript}` · `take-received {line, round?, transcript, accuracy? | comeback?}` · `verdict {score, roast, audio, best, worst, categories}` · `mode {mode}` · `reset`.

## Look (Best UI)
Dark stage, one bold accent per character (`character.colour`), huge readable lyrics (current line bright, next dim, sung lines fade), smooth GPU-only animations (transform/opacity, eased), the object photo as a circular character with a mouth and blinking eyes overlay, beat-synced bounce, confetti on the score. Phone screen: one giant button at a time, high contrast, vibration feedback.
