// Duet Anything - shared swear/slur filter (names, transcripts shown on screen, Gemma output before TTS).
// Whole-word matching (so Scunthorpe, Dickens, cockpit, Shitake... er, shiitake are fine) + leetspeak (sh1t, f*ck).
// Words that are ONLY ever offensive are matched as word stems; ambiguous ones only as whole words.
const STEMS = ["fuck", "shit", "cunt", "nigg", "fag", "twat", "wank", "bitch", "slut", "whore", "rape", "rapist", "nazi", "hitler", "retard", "paki", "spastic", "spaz", "spunk", "bollock", "bellend", "tosser", "motherf", "gobshite", "dyke", "tranny", "chink", "kike", "wetback", "coon"];
const WHOLE = ["dick", "dicks", "dickhead", "cock", "cocks", "cocksucker", "pussy", "pussies", "piss", "pissed", "prick", "pricks", "arse", "arsehole", "ass", "asshole", "bastard", "knob", "knobhead", "homo", "spas", "spak", "minge", "nonce", "skank", "slag", "jizz", "tits", "titties", "wog", "gypo", "pikey", "shite"];
// Words that contain a stem but are fine.
const ALLOW = new Set(["scunthorpe", "shitake", "shiitake", "cocktail", "cockpit", "cockney", "cockerel", "peacock", "hancock", "dickens", "dickinson", "therapist", "therapists", "rapeseed", "pakistan", "pakistani", "assess", "assessment", "assassin", "cocky", "cocoon", "raccoon", "racoon", "tycoon", "swank", "swanky", "fagin", "hitlist", "penistone", "dickson"]);
// Stems that are bad anywhere inside a word (bullshit, dipshit, ...).
const ANYWHERE = ["fuck", "shit", "cunt", "wank", "twat", "bitch", "whore", "nigg", "retard", "bollock", "bellend"];
const LEET = { "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g", "*": "u", "(": "c", "€": "e", "£": "e" };
const norm = (w) => w.toLowerCase().replace(/[01!|34@5$7+89*(€£]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, "").replace(/(.)\1{2,}/g, "$1$1");
const bad = (n) => !!n && !ALLOW.has(n) && (WHOLE.includes(n) || WHOLE.includes(n.replace(/(.)\1+/g, "$1")) || (STEMS.some((s) => n.startsWith(s)) || ANYWHERE.some((s) => n.includes(s))));
// A "word" token: letters plus leet characters glued to letters (so "sh1t", "f*ck", "$hit" are one token).
const TOKEN = /[A-Za-z0-9@$!|*+(€£]*[A-Za-z][A-Za-z0-9@$!|*+(€£']*/g;

/** True if the text contains a swear word or slur. */
export function isRude(text) {
  const s = String(text || "");
  for (const m of s.matchAll(TOKEN)) if (bad(norm(m[0]))) return true;
  // "f u c k" / "s.h.i.t" spaced out
  const spaced = s.match(/\b(?:[a-z][\s._-]){3,}[a-z]\b/gi) || [];
  return spaced.some((x) => bad(norm(x)));
}
// Kaif: normal swearing is NOT bleeped. Only hate slurs (and rape) are masked on screen / in speech.
// SWEAR_FILTER=1 in .env brings back the full swear filter.
const SLURS = ["nigg", "fag", "paki", "retard", "spastic", "spaz", "dyke", "tranny", "chink", "kike", "wetback", "coon", "rape", "rapist"];
const SLUR_WHOLE = ["homo", "spas", "spak", "wog", "gypo", "pikey", "nonce"];
const slur = (n) => !!n && !ALLOW.has(n) && (SLUR_WHOLE.includes(n) || SLURS.some((s) => n.startsWith(s)) || ["nigg", "retard"].some((s) => n.includes(s)));
const hits = (n) => (process.env.SWEAR_FILTER === "1" ? bad(n) : slur(n));
/** Replace each filtered word with stars (★), keeping the first letter. */
export function mask(text) {
  return String(text || "").replace(TOKEN, (w) => (hits(norm(w)) ? w[0] + "★".repeat(Math.max(2, w.length - 1)) : w))
    .replace(/\b(?:[a-z][\s._-]){3,}[a-z]\b/gi, (w) => (hits(norm(w)) ? w[0] + "★★★" : w));
}
/** For TTS: filtered words become "bleep" (stars would be read out or skipped). Keeps [audio tags] intact. */
export function cleanSpeech(text) {
  return String(text || "").replace(TOKEN, (w) => (hits(norm(w)) ? "bleep" : w)).replace(/\b(?:[a-z][\s._-]){3,}[a-z]\b/gi, (w) => (hits(norm(w)) ? "bleep" : w));
}
/** For player names: true = OK to show. */
export const nameOk = (name) => !isRude(name) && !isRude(String(name || "").replace(/[^a-z0-9@$!*]/gi, ""));

/** Appended to every Gemma prompt that sees a photo or writes lines. */
export const PHOTO_RULE = "If a person is in the photo, roast the object/hat/clothes, never their face, body, age, race or looks.";
