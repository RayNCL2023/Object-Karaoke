# Two-minute pitch - Kaif + Debanjan

**Set-up before you walk on:** laptop on the projector showing the stage idle screen, phone plugged in over USB (`adb reverse tcp:5173 tcp:5173`) with `/mic.html` open, volume up, a backup object in your pocket (a mug or a lanyard). Have a second terminal ready with `$env:MOCK=1; node server.mjs` typed but not run.

| Time | Who | Say / do |
|---|---|---|
| 0:00 | **Kaif** | *(Holds up phone.)* "Everyone's done karaoke. Nobody's done karaoke with their water bottle. Until today." |
| 0:10 | **Kaif** | "This is Duet Anything. Snap any object, it comes alive as a cheeky Manc, sings a duet with you, then roasts you." |
| 0:20 | **Debanjan** | *(Walks to a judge.)* "Can I borrow that?" *(Judge's water bottle or lanyard. If they say no, use the backup object.)* *(Snap it. Stage shows "Waking it up...")* |
| 0:25 | **Debanjan** | *(While it loads, about 10 seconds.)* "Right now Gemma 4 is looking at the photo, checking its memory, and writing a character and a song. ElevenLabs is giving it a voice." |
| 0:35 | *both* | *(Character appears. Read its name out with a straight face.)* Let it sing line one. |
| 0:45 | **Kaif** | *(Phone buzzes.)* Sing your line into the phone. Commit. Bad singing is better. |
| 0:45-1:15 | *both* | Let the duet play out. Don't talk over it. React to the jokes. |
| 1:15 | *both* | Roast and score. *(Point at the score.)* "Fair." |
| 1:20 | **Debanjan** | "The best bit: it remembers. Snap the same thing again..." *(Snap it again.)* "...and it knows its name, its voice, and that we got a 41." *(Let the "back for more" line land.)* |
| 1:35 | **Debanjan** | "Under the hood: Gemma 4 through the Gemini API for the brains, ElevenLabs for the voices and for marking our singing, OpenLoft's NMAFC for memory, Tone.js for the beat, and the phone's camera, mic and buzz as the controller." |
| 1:50 | **Kaif** | "No installs, open source, MIT, all built today. It's completely pointless and we're proper proud of it." |
| 1:58 | **Kaif** | "Cheers, Manchester." *(Hand the bottle back.)* |

## If something breaks
- **Wi-Fi or an API is slow (over 15 seconds on "Waking it up"):** Kaif fills: "It's nervous, it's never sung in front of judges." If it's still stuck at 25 seconds, switch to the backup.
- **Backup (mock mode):** stop the server, run `$env:MOCK=1; node server.mjs`, refresh the stage and phone, snap again. It runs the whole flow with a canned character and song and no internet calls. Say: "Conference Wi-Fi, so here's one we made earlier, same app, offline mode."
- **Phone mic won't start:** the stage falls back to the laptop mic. Lean in and sing at the laptop. It's funnier anyway.
- **No sound on the projector:** unplug HDMI audio and use the laptop speakers; hold the phone near the mic for your lines.
- **Memory (NMAFC) is down:** skip the "it remembers" beat and jump straight to the tech line at 1:35. Mention it remembers across restarts and show the leaderboard instead.
- **Total failure:** play the demo video (keep it open in a browser tab) and talk over it.

## Tips
- Keep a straight face when the object says something rude about you.
- Pick a judge who looks up for it. Ask first.
- Practise the handover at 0:20 and 1:20 twice. That's where time goes.
