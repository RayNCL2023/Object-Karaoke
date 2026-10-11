# Duet Anything

**Snap any object. It sings a duet with you. Then it roasts you.**

Point your phone at a mug, a lanyard, a water bottle, anything. It wakes up as a cheeky Mancunian character with its own name, voice and attitude, and sings a karaoke duet with you. You sing your lines into your phone like a mic. It sings back, then roasts your singing and gives you a score out of 100. It remembers every object it has met, so the same mug keeps the same name, the same voice and the same grudges, even after a restart.

Built today at Hacktoberfest Hack Day Manchester (11 October 2026), all code written at the event, by Kaif Nadeem and Debanjan Ray.

## How it works

1. **Snap.** The phone (`/mic.html`) takes a photo and sends it to the laptop.
2. **Wake up.** Gemma 4 looks at the photo, checks memory for objects it has met before, and writes a character plus a short duet song (title, genre, tempo, alternating lines) as JSON.
3. **It starts on you.** It's a freestyle roast battle, not a scripted song. ElevenLabs gives the object its voice and it raps a savage opening verse at you over a Tone.js beat, while the stage (`/`, on the laptop or projector) animates it with googly eyes and a moving mouth.
4. **Your turn, no lyrics.** The phone buzzes and you get 12 seconds to make up a comeback on the spot. ElevenLabs speech-to-text hears what you actually said, the stage shows it, and Gemma writes the object's comeback twisting your own words back at you. Three rounds.
5. **The verdict.** Gemma judges only what you said: Wit, Rhymes, Comebacks and Confidence out of 10, a score out of 100, and a roast quoting your best (or worst) line, spoken out loud. Confetti, leaderboard. (There's also a Karaoke mode: an original song, you sing every line, scored on accuracy.)
6. **It remembers.** OpenLoft's NMAFC memory stores every duet. Snap the same thing again and it says "Back for more, are we?"

## Run it

Needs Node 18+ and nothing to install.

1. Put your keys in `.env` (never commit it): `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`.
2. Start memory: `powershell -ExecutionPolicy Bypass -File start-memory.ps1` (NMAFC on http://127.0.0.1:8765).
3. Start the app: `node server.mjs`, then open http://localhost:5173 on the laptop (the stage).
4. Phone: open the link shown on the stage (same Wi-Fi). The mic needs a secure context, so over USB is best:
   `adb reverse tcp:5173 tcp:5173`, then http://localhost:5173/mic.html on the phone.

**No keys, no Wi-Fi, no problem:** run with `MOCK=1` for a full demo with no paid calls (canned character and song).

- PowerShell: `$env:MOCK=1; node server.mjs`
- Bash: `MOCK=1 node server.mjs`

Optional settings: `PORT` (default 5173), `GEMINI_MODEL` (default `gemma-4-26b-a4b-it`), `NMAFC_URL`, `NMAFC_AGENT`.

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
- `public/` - the stage (`index.html`), the phone mic (`mic.html`) and shared helpers (`api.js`)
- `marketing/` - submission text, pitch script, demo video plan, social posts, deck brief

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Kaif Nadeem and Debanjan Ray.
