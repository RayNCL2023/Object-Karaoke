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
3. Server `/api/object`: recall memory for similar objects → one Gemma 4 call (JSON) creating/continuing the character + duet song → pick an ElevenLabs voice → generate all object-line MP3s in parallel → remember the character → broadcast `song-ready` → return the session.
4. Stage shows the photo as the character (cut-out circle, animated mouth driven by audio level, bobbing to the beat), song title, lyrics karaoke-style. Tone.js plays a backing beat (genre + bpm). Lines alternate: object lines play the MP3; on "you" lines the stage broadcasts `record-start` and shows a countdown + "YOUR LINE".
5. Phone on `record-start`: vibrates, records with MediaRecorder for `ms`, shows a big pulsing mic + live level meter, POSTs `/api/take`. (Mic needs a secure context: works over USB with `adb reverse tcp:5173 tcp:5173` → `http://localhost:5173/mic.html`. If `getUserMedia` is unavailable, show a clear message and the stage falls back to the laptop mic for takes.)
6. After the last line the stage calls `/api/judge` → object roasts you (MP3 + text), score 0–100 with confetti/score animation; result remembered; leaderboard updated.
7. "Again" → back to idle. Snapping the same object again → it recognises you ("Back for more, are we?").

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
- 6–8 lines, alternating, starting with the object; object lines ≤ 90 chars (max 4); "you" lines ≤ 10 words. `ms` = how long the line lasts (object: real MP3 duration estimate; you: ~ words × 450ms + 1200ms).
- Gemma prompt gets the photo + recalled memories. If memories show this object before, keep the same name/personality/voiceStyle and set `returning: true`, referencing last score/roast in the first line.

`GET /api/photo/:id.jpg`, `GET /api/audio/:file.mp3` → files from `cache/`.

`POST /api/take` body `{ id, line, audio: base64, mime }` → `{ transcript, accuracy }` — ElevenLabs speech-to-text (`POST https://api.elevenlabs.io/v1/speech-to-text`, multipart: `file`, `model_id=scribe_v1`), accuracy = share of the line's words heard (0–1). Broadcast `take-received`. MOCK: fake transcript.

`POST /api/judge` body `{ id }` → `{ score, roast, audio, best, worst }` — Gemma writes a ≤ 2-sentence Manc roast + score from the takes' accuracy and transcripts; ElevenLabs speaks the roast in the character's voice (≤ 160 chars); NMAFC remembers "<name> the <object> duetted '<title>' with the user, score X, roast Y". Broadcast `verdict`.

`GET /api/leaderboard` → `[{ name, object, score, title, at }]` (top 10, saved in `cache/leaderboard.json`).

`POST /api/broadcast` (alias of existing `/api/phone`) body = any event; `GET /api/events` = Server-Sent Events stream (exists).

## Events (SSE, `{ type, ... }`)
`photo-received` · `song-ready {session}` · `line {index}` · `record-start {line, ms}` · `take-received {line, transcript, accuracy}` · `verdict {score, roast, audio}` · `reset`.

## Look (Best UI)
Dark stage, one bold accent per character (`character.colour`), huge readable lyrics (current line bright, next dim, sung lines fade), smooth GPU-only animations (transform/opacity, eased), the object photo as a circular character with a mouth and blinking eyes overlay, beat-synced bounce, confetti on the score. Phone screen: one giant button at a time, high contrast, vibration feedback.
