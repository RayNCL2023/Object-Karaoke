# Duet Anything

**Snap any object. It sings a duet with you. Then it roasts you.**

> **Quick start (free, no keys):** `npm run start` with `MOCK=1` set (PowerShell: `$env:MOCK=1; node server.mjs`, Bash: `MOCK=1 node server.mjs`).
> Open http://localhost:5173/stage on the laptop, then the phone link / QR it shows.
> Canned character, canned battle, silent audio: the whole flow with no paid calls.

Point your phone at a mug, a lanyard, a water bottle, anything. It wakes up as a cheeky Mancunian character with its own name, voice and attitude, and sings a karaoke duet with you. You sing your lines into your phone like a mic. It sings back, then roasts your singing and gives you a score out of 100. It remembers every object it has met, so the same mug keeps the same name, the same voice and the same grudges, even after a restart.

Built today at Hacktoberfest Hack Day Manchester (11 October 2026), all code written at the event, by Kaif Nadeem and Debanjan Ray.

## How it works

1. **Snap.** The phone (`/mic.html`) takes a photo and sends it to the laptop.
2. **Wake up.** Gemma 4 looks at the photo, checks memory for objects it has met before, and writes a character plus a short duet song (title, genre, tempo, alternating lines) as JSON.
3. **It starts on you.** It's a freestyle roast battle, not a scripted song. ElevenLabs gives the object its voice and it raps a savage opening verse at you over a Tone.js beat, while the stage (`/`, on the laptop or projector) animates it with googly eyes and a moving mouth.
4. **Your turn, no lyrics.** The phone buzzes and you get a few seconds (8 by default, `BATTLE_TURN_MS`) to make up a comeback on the spot. ElevenLabs speech-to-text hears what you actually said, the stage shows it, and Gemma writes the object's comeback twisting your own words back at you. Two rounds by default (`BATTLE_ROUNDS`). Swears and slurs are masked with ★ on screen (and bleeped in the object's lines), and if a person is in the photo it roasts the hat or clothes, never their looks.
5. **The verdict.** Gemma judges only what you said: Wit, Rhymes, Comebacks and Confidence out of 10, a score out of 100, and a roast quoting your best (or worst) line, spoken out loud. Confetti, leaderboard. (There's also a Karaoke mode: an original song, you sing every line, scored on accuracy.)
6. **Bring your mates.** Opening the site shows HOST or PLAYER. The stage QR goes to `/play`: type the room code and your name, then **BATTLE** (you get the phone mic, up to 8 players) or **JUDGE** (join the crowd). The host picks on the stage: **VS THE OBJECT** (choose who is up, it rotates after each battle) or **PLAYER vs PLAYER**: the snapped object becomes the MC, introduces you both, you take turns for 3 rounds each with the MC reacting after every verse, the crowd votes each round, and Gemma judges both of you and crowns a winner.
7. **It remembers.** OpenLoft's NMAFC memory stores every duet. Snap the same thing again and it says "Back for more, are we?"

## Run it

Needs Node 18+ and nothing to install.

1. Clone the repo and run `node server.mjs`.
2. Open http://localhost:5173 on the laptop and pick **HOST** (or go straight to http://localhost:5173/stage). First launch shows a setup screen: paste your Gemini key ([get one](https://aistudio.google.com/apikey)) and ElevenLabs key ([get one](https://elevenlabs.io/app/settings/api-keys)), hit **Test keys**, then **Save & start**. They're saved to `.env` on your laptop (gitignored) and never sent to the browser or phones. Change them later with the small **Keys** link on the stage.
3. Optional memory: `powershell -ExecutionPolicy Bypass -File start-memory.ps1` (NMAFC on http://127.0.0.1:8765).
4. Phone: open the link shown on the stage. The phone mic needs HTTPS, so pick one:
   - **Any Wi-Fi / 4G (best):** run with `TUNNEL=1` (or `npm run tunnel`; on by default in `npm run app` / the exe when `cloudflared.exe` is present). It opens a free Cloudflare quick tunnel and the stage links become `https://<random>.trycloudflare.com/...` with a real certificate: no warning, works on any network. Get `cloudflared-windows-amd64.exe` from the [official releases](https://github.com/cloudflare/cloudflared/releases), rename it `cloudflared.exe` and drop it in `launcher/bin/`. If the tunnel isn't up within 15 s the stage falls back to the Wi-Fi links. Live events reach phones over the tunnel through `GET /api/poll` (long-poll), because the quick tunnel buffers streamed responses.
   - **Same Wi-Fi:** the stage shows an `https://<laptop-ip>:5174/mic.html` link (self-signed: tap Advanced > Proceed once). Venue Wi-Fi blocks phone-to-laptop? Turn on the laptop's **Mobile hotspot** and put the phones on it.
   - **USB:** `adb reverse tcp:5173 tcp:5173`, then http://localhost:5173/mic.html on the phone.

**The crowd joins too:** the stage shows a 4-letter room code and a QR. Anyone on the same Wi-Fi opens `/join.html`, picks a nickname, face and colour, and appears in the on-stage crowd. They spam Cheer / Fire / Laugh / Boo and vote who won each battle round; the crowd vote moves the final score by up to 10 points.

**No keys, no Wi-Fi, no problem:** run with `MOCK=1` for a full demo with no paid calls (canned character and song).

- PowerShell: `$env:MOCK=1; node server.mjs`
- Bash: `MOCK=1 node server.mjs`

Optional settings (in `.env` or the environment):
- `PORT` (default 5173), `GEMINI_MODEL` (default `gemma-4-26b-a4b-it`), `NMAFC_URL`, `NMAFC_AGENT`.
- `ROOM_CODE`: fixed 4-letter room code. Without it the first random code is saved in `cache/room-code.txt`, so restarts keep the same code and QR.
- `BATTLE_ROUNDS` (default 2) and `BATTLE_TURN_MS` (default 8000): how many freestyle rounds and how long each turn is.
- `TUNNEL=1`: the any-Wi-Fi public link above (`TUNNEL=0` turns off the launcher's default).
- `GEMMA_TIMEOUT_MS` (default 20000): a Gemma call that takes longer is dropped and a ready-made backup character steps in, so a snap never hangs.

**Before a demo, wipe test data:** `npm run reset-data` clears the leaderboard, roster, saved characters and their photos, and session photos/audio, and deletes this app's NMAFC memories (`NMAFC_AGENT`). It keeps the cached TTS and sound-effect audio, designed voices, the room code and `.env`. It asks first (`--yes` skips the question, `--dry-run` just lists).

**Object cut-out:** the stage cuts the snapped object out of the photo right in the browser with MediaPipe image segmentation (falling back to Gemma's outline), so the googly-eyed character sits on stage like a sticker.

**Host lock:** paid and admin endpoints (`/api/gemma`, `/api/speak`, `/api/sfx`, `/api/memory/*`, `/api/setup/*`, mode, difficulty, match, reset) only answer the laptop itself (localhost), or a request carrying the per-run `hostToken` (header `x-host-token`) that `/api/status` hands out on localhost only. Phones keep the public routes (snap, take, crowd, players, events, photos and audio), and only the phone that snapped (or, in PvP, the player whose turn it is) can send that battle's takes.

## Windows app

The stage also runs as a small Windows app: `DuetAnything.exe` starts the server and opens the stage in its own clean Microsoft Edge window (app mode, no browser bars; falls back to Chrome, then your default browser). Phones still join through the web link, nothing to install on the phone.

1. Get the app: `npm install` then `npm run build:exe` builds `dist/DuetAnything/` (`DuetAnything.exe` + `public/` + `start-memory.ps1`). Zip that folder to share it; keep the exe next to `public/`.
2. Double-click `DuetAnything.exe`. It picks a free port (5173-5190), starts the server and opens the stage. The black console window shows the links; close it to stop.
3. First launch shows the setup screen: paste your Gemini and ElevenLabs keys. They are saved in `%APPDATA%\DuetAnything\.env` (with `cache/`, `certs/` and the Edge window's own profile, which remembers the laptop-mic permission).
4. Phones join with the link shown on the stage (same Wi-Fi).

From source: `npm run app` does the same with your project folder as the data folder (uses this folder's `.env`, and starts NMAFC memory with `start-memory.ps1` if it isn't running). You can point any run at another folder with `DUET_DATA_DIR`.

## Tracks we entered, and honestly how we fit

| Track | How Duet Anything fits |
|---|---|
| **Best Use of Gemma 4** | Gemma 4 (via the Gemini API) does the real thinking: it sees the photo, invents the character, writes the whole song as structured JSON, and judges and roasts your performance. |
| **Best Open-Source AI Project** | Gemma 4 is an open-weight model, the repo is public and MIT licensed, and the app runs with zero npm packages so anyone can clone it and go. |
| **Best Use of ElevenLabs** | Every object gets its own ElevenLabs voice for its lines and its roast, and ElevenLabs speech-to-text (Scribe) marks your singing. Remove ElevenLabs and there is no duet. |
| **Best Use of OpenLoft** | NMAFC memory is how objects recognise you: same name, same voice, and they bring up your last score. We demo it remembering across a server restart. |
| **Best Music Related Project** | It is a duet machine: generated songs with a genre and tempo, a live Tone.js backing beat, and karaoke timing. (No MIDI hardware, we kept it to the phone.) |
| **Best User Interface** | One giant button at a time on the phone, a big dark stage with readable karaoke lyrics, a talking cartoon face, beat-synced bounce and confetti. |
| **Manchester Madness** | Completely pointless, proper daft. Your water bottle calls you "our kid" and tells you your Nan sings better. Every character is a cheeky Mancunian. |
| **Best Physical World Hack** | Honest note: no Arduino or Pi. The physical part is the real world itself: you photograph real objects, and the phone's camera, microphone and vibration motor are the controller. |

## Files

- `server.mjs` - Node server: Gemma 4, ElevenLabs, NMAFC memory, live events to the phone and stage
- `launcher/` - the Windows app: `launch.mjs` (starts the server, opens the stage in an Edge app window), `build-exe.mjs` (builds `DuetAnything.exe` with Node SEA), icon
- `public/` - the stage (`index.html`), the phone mic (`mic.html`) and shared helpers (`api.js`)
- `marketing/` - submission text, pitch script, demo video plan, social posts, deck brief

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Kaif Nadeem and Debanjan Ray.
