# MLH submission - Duet Anything

## Name
Duet Anything

## Tagline options
1. Snap any object. It sings a duet with you. Then it roasts you. **<- pick this one**
2. Karaoke with your water bottle. It has opinions.
3. Every object has a voice. Most of them think you're flat.
4. Your mug wants a duet, our kid.
5. The karaoke partner that remembers your last bad note.

**Chosen:** Snap any object. It sings a duet with you. Then it roasts you.

## Inspiration
Karaoke is better with a partner, and everyone has talked to a mug at least once. We wanted the daftest possible use of serious AI: take any random thing on the table, give it a personality, a voice and a song, and let it judge you. Manchester did the rest. Of course the stapler is a washed-up Britpop singer who calls you "our kid".

## What it does
- Snap any object with your phone.
- It wakes up as a cheeky Mancunian character with a name, a personality, a catchphrase and its own voice.
- It writes a short duet for the two of you, with a title, a genre and a tempo, and the laptop stage plays a backing beat and shows the lyrics karaoke-style.
- It sings its lines out loud. On your lines your phone buzzes and becomes a mic.
- At the end it roasts your performance in two sentences, says it out loud, and scores you out of 100. Confetti, leaderboard.
- It remembers. Snap the same object again (even after a restart) and it knows its name, its voice and your last score: "Back for more, are we?"

## How we built it
- **Gemma 4 via the Gemini API** (`gemma-4-26b-a4b-it`): one image + text call returns the character and the full song as JSON, and a second call judges your takes and writes the roast.
- **ElevenLabs text to speech** gives each character its own voice for its sung lines and its roast. Every MP3 is cached so repeat runs cost nothing.
- **ElevenLabs speech to text** (Scribe) transcribes each of your takes so we can score how many words you actually hit.
- **OpenLoft NMAFC memory** stores every character and every duet, and is searched each time you snap, so objects keep their identity and grudges across sessions and restarts.
- **Tone.js** plays the backing beat in the right genre and tempo, synced to the lyrics and the character's bounce.
- **The phone is the controller:** camera to snap, microphone to sing, vibration to tell you it's your turn. It talks to the laptop over Server-Sent Events.
- **Node** with zero npm packages: one server file, plain browser JavaScript, so it clones and runs in seconds.
- A `MOCK=1` mode runs the full flow with no paid calls, which kept our credit alive while we built the UI.

## Challenges we ran into
- **Timing.** Getting AI-written lines, generated audio, a live beat and your recording window to line up felt like conducting an orchestra of strangers.
- **Phone mic permissions.** Browsers only allow the mic on a secure page, so we used USB port forwarding (`adb reverse`) and added a laptop-mic fallback.
- **Keeping it cheap.** ElevenLabs credit is limited, so we capped object lines at 90 characters and four per song, and cached every MP3.
- **Getting reliable JSON** out of one model call that has to look at a photo, read memories and write a song.
- **Keeping the roasts funny and kind.** Cheeky, never nasty.

## Accomplishments that we're proud of
- It works end to end on a real phone: snap, sing, get roasted, in under a minute.
- Objects genuinely remember you across a restart, which gets a proper laugh in a demo.
- It runs with no installs and has a free mock mode, so anyone can try it.
- All code written today, by two people.

## What we learned
- Small multimodal open models like Gemma 4 are quick and good enough to drive a whole live experience.
- Memory turns a gimmick into a character. The second snap is funnier than the first.
- Voice is everything. The same joke lands ten times better in the right voice.
- Phones are brilliant, free hardware: camera, mic and buzz in everyone's pocket.

## What's next
- Multiplayer: two phones, two objects, a duet battle.
- Proper pitch scoring, not just words.
- MIDI controller support for the backing band.
- A "Hall of Objects" page with every character it has ever met.

## Tracks
| Track | The real feature |
|---|---|
| Best Use of Gemma 4 | Gemma 4 sees the photo, invents the character, writes the song as JSON and judges you. |
| Best Open-Source AI Project | Built on an open-weight model; public repo, MIT licence, zero dependencies. |
| Best Use of ElevenLabs | A unique voice per object for singing and roasting, plus speech-to-text to mark your singing. |
| Best Use of OpenLoft | NMAFC memory keeps each object's name, voice and grudges; shown surviving a restart. |
| Best Music Related Project | Generated duets with genre and tempo, a live Tone.js beat and karaoke timing. |
| Best User Interface | One-button phone screens, a big readable karaoke stage, a talking face and confetti. |
| Manchester Madness | Pointless, daft and very Manc: your lanyard calls you "our kid" and rates you 34. |
| Best Physical World Hack | Real objects are the input; the phone's camera, mic and vibration are the hardware. (No Arduino, we're honest.) |

## Built with
gemma-4, gemini-api, elevenlabs, openloft, nmafc, tone.js, node.js, javascript, html, css, server-sent-events

## Links
- Repo: (add public GitHub URL)
- Demo video: (add link)
