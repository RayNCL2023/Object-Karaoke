// dissPICable - karaoke song list. COPYRIGHT RULE: we only ever store ORIGINAL songs (written live by Gemma in the
// style of a British era/genre) or PUBLIC-DOMAIN lyrics (traditional, or writers dead 70+ years). Real modern songs are
// never stored here: they play as an embedded official karaoke video (YouTube IFrame Player, embed only) - we keep just
// title / artist / videoId, NO lyrics.

// a) BRITISH BANGERS (ORIGINALS): Gemma writes a new song in this style (see lib/karaoke.mjs originalPrompt).
export const ORIGINAL_STYLES = [
  { id: "o_britpop", title: "Britpop Anthem", style: "mid-90s Britpop anthem: swaggering guitars, a huge terrace-sized singalong chorus", genre: "britpop", bpm: 112, key: "G" },
  { id: "o_madchester", title: "Madchester Baggy", style: "late-80s Madchester baggy: loose shuffling groove, hazy, euphoric, dance-floor", genre: "madchester", bpm: 104, key: "A minor" },
  { id: "o_garage", title: "UK Garage", style: "late-90s UK garage: 2-step shuffle, smooth hook, cheeky MC ad-libs", genre: "uk garage", bpm: 132, key: "F minor" },
  { id: "o_grime", title: "Grime", style: "2000s grime: hard, fast, 140 bpm, chantable hook", genre: "grime", bpm: 140, key: "C minor" },
  { id: "o_synth", title: "80s Synth-Pop", style: "early-80s British synth-pop: shiny synths, dramatic, a soaring chorus", genre: "synth pop", bpm: 118, key: "D minor" },
  { id: "o_indie", title: "Indie Landfill", style: "mid-2000s British indie: jangly guitars, shouty 'woah-oh' chorus", genre: "indie", bpm: 126, key: "E" },
  { id: "o_terrace", title: "Football Terrace Chant", style: "football terrace chant: simple, repetitive, clap-along, everyone can join in", genre: "terrace chant", bpm: 100, key: "C" },
  { id: "o_northern", title: "Northern Soul", style: "Northern Soul stomper: Wigan Casino energy, uplifting, handclaps", genre: "northern soul", bpm: 120, key: "Bb" },
];

// b) CLASSICS (OUT OF COPYRIGHT). section: "verse" | "chorus" (chorus = everyone sings).
const V = (text) => ({ text, section: "verse" });
const C = (text) => ({ text, section: "chorus" });
export const CLASSICS = [
  { id: "c_tipperary", title: "It's a Long Way to Tipperary", year: "1912", genre: "music hall", bpm: 108, key: "G", lines: [
    V("Up to mighty London came an Irishman one day"), V("As the streets are paved with gold, sure everyone was gay"),
    V("Singing songs of Piccadilly, Strand and Leicester Square"), V("Till Paddy got excited, then he shouted to them there"),
    C("It's a long way to Tipperary"), C("It's a long way to go"), C("It's a long way to Tipperary"), C("To the sweetest girl I know"),
    C("Goodbye Piccadilly, farewell Leicester Square"), C("It's a long, long way to Tipperary"), C("But my heart's right there") ] },
  { id: "c_daisy", title: "Daisy Bell", year: "1892", genre: "music hall waltz", bpm: 96, key: "C", lines: [
    V("There is a flower within my heart, Daisy, Daisy"), V("Planted one day by a glancing dart, planted by Daisy Bell"),
    V("Whether she loves me or loves me not, sometimes it's hard to tell"), V("Yet I am longing to share the lot of beautiful Daisy Bell"),
    C("Daisy, Daisy, give me your answer do"), C("I'm half crazy all for the love of you"), C("It won't be a stylish marriage"),
    C("I can't afford a carriage"), C("But you'll look sweet upon the seat"), C("Of a bicycle made for two") ] },
  { id: "c_packup", title: "Pack Up Your Troubles in Your Old Kit-Bag", year: "1915", genre: "marching song", bpm: 112, key: "F", lines: [
    V("Pack up your troubles in your old kit-bag"), V("And smile, smile, smile"), V("While you've a lucifer to light your fag"), V("Smile, boys, that's the style"),
    C("What's the use of worrying?"), C("It never was worth while, so"), C("Pack up your troubles in your old kit-bag"), C("And smile, smile, smile") ] },
  { id: "c_scarborough", title: "Scarborough Fair", year: "traditional", genre: "folk ballad", bpm: 84, key: "D minor", lines: [
    V("Are you going to Scarborough Fair?"), C("Parsley, sage, rosemary and thyme"), V("Remember me to one who lives there"), C("She once was a true love of mine"),
    V("Tell her to make me a cambric shirt"), C("Parsley, sage, rosemary and thyme"), V("Without no seams nor needlework"), C("Then she'll be a true love of mine") ] },
  { id: "c_auldlang", title: "Auld Lang Syne", year: "Robert Burns, 1788", genre: "folk", bpm: 88, key: "F", lines: [
    V("Should auld acquaintance be forgot"), V("And never brought to mind?"), V("Should auld acquaintance be forgot"), V("And auld lang syne?"),
    C("For auld lang syne, my dear"), C("For auld lang syne"), C("We'll tak a cup o' kindness yet"), C("For auld lang syne"),
    V("And there's a hand, my trusty fiere"), V("And gie's a hand o' thine"), C("We'll tak a cup o' kindness yet"), C("For auld lang syne") ] },
  { id: "c_sailor", title: "Drunken Sailor", year: "traditional sea shanty", genre: "sea shanty", bpm: 120, key: "D minor", lines: [
    V("What will we do with a drunken sailor?"), V("What will we do with a drunken sailor?"), V("What will we do with a drunken sailor?"), V("Early in the morning"),
    C("Way hay and up she rises"), C("Way hay and up she rises"), C("Way hay and up she rises"), C("Early in the morning"),
    V("Put him in the longboat till he's sober"), V("Put him in the longboat till he's sober"), C("Way hay and up she rises"), C("Early in the morning") ] },
  { id: "c_greensleeves", title: "Greensleeves", year: "traditional, 16th century", genre: "ballad", bpm: 80, key: "A minor", lines: [
    V("Alas, my love, you do me wrong"), V("To cast me off discourteously"), V("For I have loved you well and long"), V("Delighting in your company"),
    C("Greensleeves was all my joy"), C("Greensleeves was my delight"), C("Greensleeves was my heart of gold"), C("And who but my lady Greensleeves") ] },
];

// c) REAL SONGS (YOUTUBE KARAOKE): embedded official karaoke videos only. title / artist / videoId, NO lyrics.
// Embeddable (oEmbed-checked) karaoke videos from Party Tyme / Stingray Karaoke channels, 2026-10-11.
export const YOUTUBE = [
  { id: "y_0", title: "Mr Brightside", artist: "The Killers", videoId: "i5SWOQlFtUI" },
  { id: "y_1", title: "Wonderwall", artist: "Oasis", videoId: "Tpyo0fGdc6A" },
  { id: "y_2", title: "Don't Look Back in Anger", artist: "Oasis", videoId: "_FFyHg7HVDY" },
  { id: "y_3", title: "Sweet Caroline", artist: "Neil Diamond", videoId: "CgVhqLL1duA" },
  { id: "y_4", title: "Bohemian Rhapsody", artist: "Queen", videoId: "ZfpN7M6eMwI" },
  { id: "y_5", title: "Dancing Queen", artist: "ABBA", videoId: "W8GnkMoWFlY" },
  { id: "y_6", title: "Valerie", artist: "Mark Ronson ft. Amy Winehouse", videoId: "uogD6wdfXR8" },
  { id: "y_7", title: "Angels", artist: "Robbie Williams", videoId: "f_syy-8FGYg" },
  { id: "y_8", title: "Livin' on a Prayer", artist: "Bon Jovi", videoId: "FHO6JqggbXE" },
  { id: "y_9", title: "Hey Jude", artist: "The Beatles", videoId: "alYrasQqDxE" },
  { id: "y_10", title: "Common People", artist: "Pulp", videoId: "5TuR9Z_X1uc" },
  { id: "y_11", title: "I Predict a Riot", artist: "Kaiser Chiefs", videoId: "r7okXyepov8" },
];

export function songList() {
  return {
    originals: ORIGINAL_STYLES.map(({ id, title, genre, bpm }) => ({ id, title, kind: "original", genre, bpm })),
    classics: CLASSICS.map(({ id, title, year, genre, bpm }) => ({ id, title, kind: "classic", year, genre, bpm })),
    youtube: YOUTUBE.map(({ id, title, artist, videoId }) => ({ id, title, artist, videoId, kind: "youtube" })),
  };
}
export const findSong = (id) => ORIGINAL_STYLES.find((s) => s.id === id) && { kind: "original", ...ORIGINAL_STYLES.find((s) => s.id === id) }
  || CLASSICS.find((s) => s.id === id) && { kind: "classic", ...CLASSICS.find((s) => s.id === id) }
  || YOUTUBE.find((s) => s.id === id) && { kind: "youtube", ...YOUTUBE.find((s) => s.id === id) } || null;
/** "https://youtu.be/ID", "watch?v=ID", "/shorts/ID", "/embed/ID" or a bare 11-char ID -> ID (or null). */
export function youtubeId(s) {
  const t = String(s || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
