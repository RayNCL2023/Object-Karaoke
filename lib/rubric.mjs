// Transparent judging rubric, computed in code from the (safety-filtered) transcripts.
// Gemma only supplies WIT (0-10), which is capped by how much was actually said.
// Score = Delivery 30 + Rhymes 25 + Comebacks 25 + Wit 20 (each category 0-10), + difficulty (mild +5, savage -5).
// Hard rules: total silence -> 0-5; a silent round scores 0 in every category; clamp 0-100. Crowd bonus is added by the caller.

const FILLER = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "ahh", "hmm", "mm", "mmm", "hm", "eh", "uhm"]);
const STOP = new Set(("a an the and or but so to of in on at for with is are was were be been am im i me my mine you your youre yours u ur " +
  "it its this that these those he she they them we us our his her their what who how why when where do does did dont " +
  "not no yes yeah just like got get have has had will would can cant could if then than as by from up out about all " +
  "one some any very really oh ok okay well thats theres here there").split(" "));
const words = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\*+/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
/** Spoken words with filler (um/uh/er) removed. */
export const spoken = (s) => words(s).filter((w) => !FILLER.has(w));
const stem = (w) => w.replace(/(ing|in|ed|es|s)$/, "") || w;
const meaningful = (ws) => ws.filter((w) => w.length >= 3 && !STOP.has(w));

/** Rhyme key: last vowel group + coda ("thug" -> "ug", "cold" -> "old", "name" -> "am", "walkin" -> "ing"). */
export function rhymeKey(w) {
  w = String(w || "").toLowerCase().replace(/in$/, "ing");
  if (w.length < 2) return "";
  if (/[^e]ed$/.test(w) && w.length > 4) w = w.slice(0, -2); // "cracked" -> "crack": -ed alone is not a rhyme
  if (/[^aeiou]e$/.test(w) && w.length > 3) w = w.slice(0, -1); // silent e
  const m = w.match(/[aeiouy]+[^aeiouy]*$/);
  if (!m) return "";
  const k = m[0];
  return k.length >= 2 ? k : w.length <= 3 ? w.slice(-2) : "";
}

/** Rhyming pairs inside one verse: distinct words sharing a rhyme key (chain per key, so 3 words = 2 pairs). */
function rhymePairs(ws) {
  const byKey = new Map();
  for (const w of new Set(ws.filter((x) => x.length >= 2 && !FILLER.has(x) && !STOP.has(x)))) {
    const k = rhymeKey(w);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    const g = byKey.get(k);
    if (!g.some((x) => stem(x) === stem(w))) g.push(w); // "mug"/"mugs" isn't a rhyme
  }
  const pairs = [];
  for (const g of byKey.values()) for (let i = 1; i < g.length; i++) pairs.push(`${g[i - 1]}/${g[i]}`);
  return pairs;
}

/** Words the player took from (or rhymed against) the opponent's previous line. */
function comebackHits(ws, prevText) {
  const prev = meaningful(spoken(prevText));
  if (!prev.length || !ws.length) return { echoed: [], twisted: [], addressed: false };
  const prevStems = new Set(prev.map(stem));
  const prevKeys = new Set(prev.map(rhymeKey).filter((k) => k.length >= 2));
  const mine = [...new Set(meaningful(ws))];
  const echoed = mine.filter((w) => prevStems.has(stem(w)));
  const twisted = mine.filter((w) => !prevStems.has(stem(w)) && prevKeys.has(rhymeKey(w)));
  const addressed = ws.some((w) => ["you", "your", "youre", "ya", "yours"].includes(w));
  return { echoed, twisted, addressed };
}

const ten = (v) => Math.round(Math.min(10, Math.max(0, v)));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const list = (a, n = 3) => a.slice(0, n).join(", ") + (a.length > n ? "…" : "");

/**
 * Score a battle performance.
 * rounds: [{ transcript, prev }] (prev = the opponent's line the player was answering).
 * opts: { turnMs, difficulty, wit (Gemma 0-10 or null) }.
 * Returns { score, categories:{delivery,rhymes,comebacks,wit}, reasons:{...}, stats, silent }.
 */
export function scoreBattle(rounds, { turnMs = 8000, difficulty = "spicy", wit = null } = {}) {
  const target = Math.max(8, Math.round(25 * (turnMs / 8000))); // ~25 words in an 8 s turn = 10/10
  const per = rounds.map((r, i) => {
    const ws = spoken(r.transcript);
    const n = ws.length;
    const pairs = n ? rhymePairs(ws) : [];
    const cb = comebackHits(ws, r.prev);
    return {
      round: i + 1, n, pairs, cb,
      delivery: n ? ten((n / target) * 10) : 0,
      rhymes: n ? ten(pairs.length * 3.4) : 0, // 3 pairs in a verse = 10
      noPrev: !meaningful(spoken(r.prev)).length, // opponent said nothing: nothing to answer
      comebacks: !n ? 0 : !meaningful(spoken(r.prev)).length ? 5 : ten(cb.echoed.length * 3 + cb.twisted.length * 2 + (cb.addressed ? 1 : 0)),
    };
  });
  const total = per.reduce((a, p) => a + p.n, 0);
  const answered = per.filter((p) => p.n).length;
  const silent = total === 0;
  const R = Math.max(1, per.length);

  // Wit: Gemma's call (or a variety heuristic when there is none), capped by content and by silent rounds.
  const uniq = new Set(meaningful(per.flatMap((p) => spoken(rounds[p.round - 1].transcript)))).size;
  const gem = Number.isFinite(Number(wit)) && wit !== null;
  let witRaw = gem ? ten(Number(wit)) : ten(uniq / 2.5);
  let witWhy = gem ? "judge's call on the jokes" : `${uniq} different meaningful words`;
  if (silent) { witRaw = 0; witWhy = "silent, nothing to laugh at"; }
  else if (total < 6) { witRaw = Math.min(witRaw, 2); witWhy = `capped: only ${total} word${total === 1 ? "" : "s"}`; }
  const witScore = ten(witRaw * (answered / R));
  if (!silent && answered < R) witWhy += `, ${R - answered} silent round${R - answered > 1 ? "s" : ""}`;

  const categories = {
    delivery: ten(avg(per.map((p) => p.delivery))),
    rhymes: ten(avg(per.map((p) => p.rhymes))),
    comebacks: ten(avg(per.map((p) => p.comebacks))),
    wit: witScore,
  };
  const wordsWhy = per.map((p) => (p.n ? `${p.n}` : "0 (silent)")).join(" + ");
  const allPairs = per.flatMap((p) => p.pairs);
  const echoed = [...new Set(per.flatMap((p) => p.cb.echoed))], twisted = [...new Set(per.flatMap((p) => p.cb.twisted))];
  const reasons = {
    delivery: silent ? "said nothing at all" : `${wordsWhy} words (target ~${target} a turn)`,
    rhymes: allPairs.length ? `${allPairs.length} rhyming pair${allPairs.length > 1 ? "s" : ""}: ${list(allPairs)}` : silent ? "no bars, no rhymes" : "no rhymes found",
    comebacks: echoed.length || twisted.length
      ? [echoed.length && `flipped their words: ${list(echoed)}`, twisted.length && `rhymed back: ${list(twisted)}`].filter(Boolean).join("; ")
      : silent ? "no answer back" : per.every((p) => !p.n || p.noPrev) ? "nothing to answer (they were silent), neutral 5" : per.some((p) => p.cb.addressed) ? "aimed at them, but ignored what they said" : "ignored what they said",
    wit: witWhy,
  };

  let score;
  const adj = { mild: 5, spicy: 0, savage: -5 }[difficulty] ?? 0;
  if (silent) score = { mild: 5, spicy: 2, savage: 0 }[difficulty] ?? 2; // hard rule: total silence = 0-5
  else score = Math.round(categories.delivery * 3 + categories.rhymes * 2.5 + categories.comebacks * 2.5 + categories.wit * 2 + adj);
  score = Math.max(0, Math.min(100, score));
  return { score, categories, reasons, silent, stats: { words: per.map((p) => p.n), total, answered, rounds: R, target, pairs: allPairs, echoed, twisted, difficultyAdj: silent ? 0 : adj } };
}

/** Karaoke: lyric accuracy % -> score; silence = 0. accs = per-line 0-1, transcripts = per-line text. */
export function scoreKaraoke(accs, transcripts = []) {
  const n = accs.length || 1;
  const heard = transcripts.filter((t) => spoken(t).length).length;
  const mean = accs.reduce((a, b) => a + (Number(b) || 0), 0) / n;
  const score = heard ? Math.max(0, Math.min(100, Math.round(mean * 100))) : 0;
  const silentLines = n - heard;
  return { score, silent: !heard, categories: { lyrics: ten(mean * 10) }, reasons: { lyrics: heard ? `${Math.round(mean * 100)}% of the words hit over ${n} lines${silentLines ? ` (${silentLines} silent)` : ""}` : "sang nothing at all" } };
}

/** One-line summary of the computed numbers for Gemma's judge prompt. */
export function rubricText(r) {
  const c = r.categories, why = r.reasons;
  return Object.keys(c).map((k) => `${k.toUpperCase()} ${c[k]}/10 (${why[k]})`).join("; ") + `. Computed score: ${r.score}/100${r.silent ? " - TOTAL SILENCE, they said nothing" : ""}.`;
}
