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
- **Landing** `/` (`public/home.html`): two big choices, HOST (→ `/stage`) or PLAYER (→ `/play`). No keys yet + opened on localhost → setup page.
- **Stage** `/stage` (laptop / projector): `public/index.html`, `public/stage.js`, `public/stage.css`; multi-player lobby/PvP overlay in `public/pvp-stage.js`. The launcher opens `/stage`.
- **Play** `/play` (`public/play.html` + `play.js`, phone, plain http): room code (prefilled from the QR `?code=`) + name, then **BATTLE** (joins the player lobby, goes to the HTTPS `micUrl` `/mic.html?code=&name=&pid=`) or **JUDGE** (→ `/join.html?code=&name=`). The stage's one QR points at `/play?code=XXXX`.
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

**Players + matches** (`lib/players.mjs`, `lib/pvp.mjs`): `POST /api/players/join {code, name, playerId?}` → `{player:{id,name,colour}}` (max 8) · `POST /api/players/ping` (mic page heartbeat, same body; players silent for 3 min drop) · `POST /api/players/leave {playerId}` · `GET /api/players` → `{players, match, max, code}` · `POST /api/match {type:"object", current?} | {type:"pvp", players:[id1,id2]}`. Broadcasts `players {players, match}`.
- VS THE OBJECT: the normal battle, the host picks who's up (default first in the queue, rotates after each verdict). The server tags `song-ready.session.player/playerName` and every `record-start` with `player`, `playerName`; `mic.js` ignores record-starts for another player (no `pid` = old single-phone flow, records everything).
- PLAYER vs PLAYER (match type pvp with 2 players): `/api/object` builds the same character (now the MC) + a PvP intro naming both players; session has `pvp: { players:[p1,p2], roundsEach: 3 }`, `battle.rounds = 6` (turns alternate P1, P2). `/api/take` → `{round, player, playerName, pvpRound, voteOpen, transcript, comeback}` (comeback = MC one-liner ≤ 120 chars, none on turn 6). Crowd votes per pvpRound with `value: <player id>`. `/api/judge` → usual fields (winner's score/categories) + `pvp: { winner, winnerName, players:[{id,name,score,categories,roast,best,crowd,winner}] }`, crowd ±10 per player. Uses `session.difficulty`.

**OBJECT vs OBJECT** (`lib/ovo.mjs`, stage `public/ovo-stage.js`, trainer phone `public/ovo-phone.js`): `POST /api/match {type:"ovo", players:[t1?, t2?]}` (0-2 "trainers"; one = that phone snaps both; none = any phone). While the match type is ovo, `/api/object` returns at once `{ovo:true, id, slot, snapAgain, waitingFor}` and wakes the object in the background with the normal pipeline (`buildSong`, no Music API). Events: `ovo-photo {id, slot, photo, trainerName}` · `ovo-slot-ready {id, slot, side}` · `ovo-slot-failed {id, slot}` · `ovo-ready {session:{id, title, rounds, trainers, intro:[{side,text,audio,ms}], sides:[{slot, object, character, face, outline, bbox, photo, trainerName, value:"ovo_a"|"ovo_b", rematch}]}}` · `ovo-hype {id, side, hype:[a,b]}` · `ovo-vote {id, round}` (sent by the stage after each round via `/api/broadcast`; judges vote `value: "ovo_a"|"ovo_b"`) · `ovo-verdict {winner, winnerName, winnerTrainer, roast, audio, sides:[{name, score, ai, crowd:{votes,pct}, hype, categories, reasons, why, best, winner}]}`. Verses (BATTLE_ROUNDS rounds x 2, A then B, 4-bar RAP_RULE, each must flip the opponent's last line, eleven_v3 in each object's own voice) are generated in a chain as soon as both are awake: `POST /api/ovo/verse {id, n}` waits for verse n. `POST /api/ovo/hype {id, side}` (trainer phones, 250 ms per phone). `POST /api/ovo/judge {id, waitVotesMs}`: score = 70% crowd vote share + 30% AI (rubric rhymes/comebacks vs the other's lines + Gemma wit, delivery fixed at 7 because both are AI), hype breaks ties; the winner's final roast in its voice; both characters remember the result (`cache/characters.json` `ovo[]` + NMAFC + roster score) and a rematch mentions it. `GET /api/ovo/state`. MOCK: Mug Jagger vs Lanyard Lil, canned verses, browser speech. Stage key **O** = offline OvO demo.

`GET /api/leaderboard` → `[{ name, object, score, title, at }]` (top 10, saved in `cache/leaderboard.json`).

`POST /api/broadcast` (alias of existing `/api/phone`) body = any event; `GET /api/events` = Server-Sent Events stream (exists).

## Events (SSE, `{ type, ... }`)
`photo-received` · `song-ready {session}` · `line {index}` · `record-start {line, round?, ms}` · `take-heard {round, transcript}` · `take-received {line, round?, transcript, accuracy? | comeback?}` · `verdict {score, roast, audio, best, worst, categories}` · `mode {mode}` · `reset` · OvO: `ovo-photo` · `ovo-slot-ready` · `ovo-slot-failed` · `ovo-ready` · `ovo-hype` · `ovo-vote` · `ovo-verdict` (above).

## Look (Best UI)
Dark stage, one bold accent per character (`character.colour`), huge readable lyrics (current line bright, next dim, sung lines fade), smooth GPU-only animations (transform/opacity, eased), the object photo as a circular character with a mouth and blinking eyes overlay, beat-synced bounce, confetti on the score. Phone screen: one giant button at a time, high contrast, vibration feedback.

## Server additions (15:xx, server bot)
- `POST /api/judge` accepts `{ id, waitVotesMs }` (max 10000): waits that long for the crowd's last votes, then closes voting for the session. Votes after the verdict / close, for unknown sessions or for rounds beyond `battle.rounds` are rejected (409 / 404 / 400). `POST /api/audience/close { id, round? }` closes voting early (broadcasts `votes-closed`).
- Failed or timed-out (90 s) `/api/object` broadcasts `error {stage:"object", message}` then `reset {reason:"object-failed"}` and returns JSON 500/504.
- `/api/object` and `/api/take` carry `client` (mic.js id). The snapping phone owns the session: takes from another client (or without `client` once an owner is set) get 403, except from localhost (laptop mic). `record-start` gets `client` added when no player is targeted. PvP: a take whose `player` isn't the turn player gets 403.
- Host-only (localhost or header `x-host-token: <hostToken>` from `/api/status` on localhost): `/api/gemma`, `/api/speak`, `/api/sfx`, `/api/voices`, `/api/memory/*`, `/api/setup/*`, `POST /api/mode`, `POST /api/difficulty`, `POST /api/match`, and broadcasting `{type:"reset"}`.
- `/api/status` adds `publicUrl`, `tunnel` (off|starting|on|failed), `battle {rounds, youMs}`, `hostToken` (localhost only); `micUrl` / `joinUrl` / `playUrl` use the tunnel URL when it's up. Event `public-url {publicUrl}` when the tunnel comes up.
- `GET /api/poll?since=SEQ&wait=MS` → `{ seq, events }` long-poll (up to 25 s). Use it instead of SSE on the public trycloudflare link: the quick tunnel buffers streamed responses, so SSE events arrive late or never there (SSE is still fine on localhost / LAN).
- Battle length from `.env`: `BATTLE_ROUNDS` (2), `BATTLE_TURN_MS` (8000). Room code: `ROOM_CODE` or persisted `cache/room-code.txt`.

## Karaoke night (17:xx, karaoke bot) — `lib/karaoke.mjs`, `lib/songs.mjs`, stage `public/karaoke.js`
COPYRIGHT RULE: only ORIGINAL songs (Gemma, "in the style of" a British era, prompt forbids quoting/imitating real lyrics or titles) or PUBLIC-DOMAIN lyrics (hard-coded in `lib/songs.mjs`). Real songs = embedded YouTube karaoke video (IFrame Player API, embed only, player visible), we store title/artist/videoId only.
- `GET /api/songs` → `{originals, classics, youtube, armed, snap, players}`. Host-only: `POST /api/karaoke/pick {songId | youtube: url | clear}` (arms a song: a phone snap in karaoke mode then uses it with the snapped character), `POST /api/karaoke/start {songId? | youtube?, useSnap?}` (no snap needed; partner = last snap within 30 min, else "Karaoke Kev"), `POST /api/karaoke/heckle {id}` (YouTube songs, max 3).
- Session (`id` "k_…", `mode: "karaoke"`, `parts: true`, `singers: [players]`): `song.lines[] = {text, section, who, part: "P1".."P4"|"ALL"|"AI", singer: playerId|"all"|"ai", singerName, singerColour, aiAlong?, audio?, ms}` (ms beat-locked to half bars; AI lines sung by eleven_v3 `[sings]`, speed 0.85). YouTube: `youtube: {videoId, chunkMs: 8000, turnMs: 30000}`, no lines.
- Parts: 0 players = AI sings all; 1 player = verses alternate player/AI, chorus = ALL with the AI singing along; 2-4 players = verses round-robin, chorus = ALL.
- Stage sends `record-start {line, ms, player}` for a part, `{all: true}` for ALL (every phone records); the server does not re-target these. Takes carry `player`; `/api/judge` → per-singer `singers[]` + `categories/reasons` keyed by singer name (+ `crowd` from audience reactions, 20% of the score), roast by the character. YouTube judge takes `asked {playerId: chunks}`: score = 40% time singing + 30% words/chunk + 30% Gemma vibe.
