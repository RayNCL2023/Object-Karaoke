// beats.js - Duet Anything backing-beat engine (Music track).
// Needs Tone.js on window.Tone. Verified working URL (HTTP 200, 2026-10-11):
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/15.0.4/Tone.min.js"></script>
// Exports: startBeat({genre,bpm,key}) -> Promise, stopBeat(), getBeatPulse() -> 0..1,
//          playSting('drumroll'|'applause'|'airhorn'|'fail'), setDuck(on)
// Everything is synthesised - no samples.

const T = () => {
  const t = typeof window !== 'undefined' ? window.Tone : undefined;
  if (!t) throw new Error('beats.js: window.Tone missing - add the Tone.js <script> tag before stage.js');
  return t;
};
const transport = () => (T().getTransport ? T().getTransport() : T().Transport);

// ---------------------------------------------------------------- genres
// 16-step patterns. kick/snare: x = hit (X = accent). hat: x closed, o open.
// clap: x. bass: r root, o octave, f fifth, . rest. chord: x stab, a arpeggio note, p pad (whole bar).
const GENRES = {
  britpop: { // Madchester baggy shuffle + jangly guitar arps
    bpm: 104, swing: 0.55, minorOk: false,
    prog: ['I', 'bVII', 'IV', 'I'],
    kick:  'x.....x...x..x..', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx', clap: '................',
    bass:  'r..r..f.r..o.f..', chord: 'a.aaa.aaa.aaa.aa',
    chordOsc: 'fattriangle', chordCut: 3800, bassOsc: 'sawtooth', bassCut: 500, pad: true, tamb: true,
  },
  indie: {
    bpm: 120, swing: 0.1, prog: ['I', 'V', 'vi', 'IV'],
    kick:  'x.....x.x.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', clap: '................',
    bass:  'r.r.r.r.r.r.f.o.', chord: 'a.a.a.a.a.a.a.a.',
    chordOsc: 'triangle', chordCut: 3400, bassOsc: 'sawtooth', bassCut: 600, pad: false,
  },
  pop: {
    bpm: 112, swing: 0, prog: ['I', 'V', 'vi', 'IV'],
    kick:  'x...x...x...x...', snare: '................', hat: '..x...x...x...x.', clap: '....x.......x...',
    bass:  'r..r..r.r..r..o.', chord: 'x..x..x...x.x...',
    chordOsc: 'fatsawtooth', chordCut: 2200, bassOsc: 'square', bassCut: 450, pad: true,
  },
  rock: {
    bpm: 128, swing: 0, prog: ['I', 'bVII', 'IV', 'V'],
    kick:  'x.......x.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', clap: '................',
    bass:  'r.r.r.r.r.r.r.r.', chord: 'x...x...x...x.x.',
    chordOsc: 'fatsawtooth', chordCut: 1800, bassOsc: 'sawtooth', bassCut: 700, pad: false, power: true,
  },
  hiphop: {
    bpm: 90, swing: 0.35, minor: true, prog: ['i', 'VI', 'III', 'VII'],
    kick:  'x......x..x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.xx', clap: '................',
    bass:  'r......r..r.....', chord: 'p...............',
    chordOsc: 'sine', chordCut: 2000, bassOsc: 'sine', bassCut: 300, pad: true, padOnly: true,
  },
  dnb: {
    bpm: 172, swing: 0, minor: true, prog: ['i', 'i', 'VI', 'VII'],
    kick:  'x.........x.....', snare: '....X.......X..x', hat: 'x.xxx.x.x.xxx.x.', clap: '................',
    bass:  'r.......r.....f.', chord: 'p...............',
    chordOsc: 'sine', chordCut: 1800, bassOsc: 'sine', bassCut: 260, pad: true, padOnly: true, minBpm: 160,
  },
  house: {
    bpm: 124, swing: 0, prog: ['vi', 'IV', 'I', 'V'],
    kick:  'x...x...x...x...', snare: '................', hat: '..o...o...o...o.', clap: '....x.......x...',
    bass:  '..r...r...r...o.', chord: '...x..x....x..x.',
    chordOsc: 'fatsquare', chordCut: 1600, bassOsc: 'sawtooth', bassCut: 400, pad: false, minBpm: 118,
  },
  disco: {
    bpm: 118, swing: 0, prog: ['ii', 'V', 'I', 'vi'],
    kick:  'x...x...x...x...', snare: '....X.......X...', hat: 'xxoxxxoxxxoxxxox', clap: '................',
    bass:  'r.o.r.o.r.o.r.o.', chord: '..x...x...x...x.',
    chordOsc: 'fatsawtooth', chordCut: 2600, bassOsc: 'square', bassCut: 700, pad: true,
  },
  ballad: {
    bpm: 72, swing: 0, prog: ['I', 'vi', 'IV', 'V'],
    kick:  'x.........x.....', snare: '........x.......', hat: '................', clap: '................',
    bass:  'r.......f.......', chord: 'a.a.a.a.a.a.a.a.',
    chordOsc: 'triangle', chordCut: 2400, bassOsc: 'triangle', bassCut: 500, pad: true, soft: true,
  },
  shanty: { // oom-pah stomp, accordion-ish chords
    bpm: 110, swing: 0.15, prog: ['I', 'IV', 'V', 'I'],
    kick:  'x.......x.......', snare: '................', hat: '................', clap: '....x.......x...',
    bass:  'r.......f.......', chord: '....x.......x...',
    chordOsc: 'fatsquare', chordCut: 1500, bassOsc: 'triangle', bassCut: 600, pad: false, stomp: true,
  },
  grime: {
    bpm: 140, swing: 0, minor: true, prog: ['i', 'i', 'bII', 'i'],
    kick:  'x.....x...x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.', clap: '................',
    bass:  'r.....r...o..r..', chord: 'x.........x.....',
    chordOsc: 'square', chordCut: 1400, bassOsc: 'square', bassCut: 350, pad: false,
  },
};

const ALIASES = [
  [/madchester|baggy|brit|manc|oasis|stone roses|happy mondays|shoegaze/, 'britpop'],
  [/shanty|sea|pirate|folk|celtic|irish|trad|polka|oompah/, 'shanty'],
  [/grime|drill|garage|ukg|dubstep|bassline/, 'grime'],
  [/drum ?(and|&|n) ?bass|dnb|d&b|jungle|breakbeat|liquid/, 'dnb'],
  [/hip ?hop|rap|trap|boom ?bap|lo-?fi|reggae|r&b|rnb/, 'hiphop'],
  [/house|techno|edm|dance|electro|trance|rave|club|eurodance/, 'house'],
  [/disco|funk|motown|boogie|nu-?disco/, 'disco'],
  [/ballad|slow|love|jazz|lullaby|piano|soul|acoustic|power ballad/, 'ballad'],
  [/rock|punk|metal|grunge|emo|glam/, 'rock'],
  [/indie|alt|country|surf|garage rock/, 'indie'],
  [/pop|k-?pop|synth/, 'pop'],
];
function resolveGenre(g) {
  const s = String(g || '').toLowerCase().trim();
  if (GENRES[s]) return s;
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  return 'pop';
}

// ---------------------------------------------------------------- harmony
const PC = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
function parseKey(k) {
  const s = String(k || 'C').trim().toLowerCase().replace('♯', '#').replace('♭', 'b');
  const m = s.match(/^([a-g])([#b]?)\s*(.*)$/);
  if (!m) return { pc: 0, minor: false };
  const pc = PC[m[1] + m[2]] ?? PC[m[1]] ?? 0;
  const rest = m[3];
  const minor = /^(m|min|minor|-)(?!aj)/.test(rest);
  return { pc, minor };
}
// roman numeral -> [semitone offset from tonic, quality]
const ROMAN = {
  I: [0, 'maj'], ii: [2, 'min'], iii: [4, 'min'], IV: [5, 'maj'], V: [7, 'maj'], vi: [9, 'min'], bVII: [10, 'maj'],
  i: [0, 'min'], bII: [1, 'maj'], III: [3, 'maj'], iv: [5, 'min'], v: [7, 'min'], VI: [8, 'maj'], VII: [10, 'maj'],
};
const MAJ_TO_MIN = { I: 'i', V: 'VII', vi: 'VI', IV: 'iv', ii: 'iv', bVII: 'VII', iii: 'III' };
function buildProgression(cfg, key) {
  let prog = cfg.prog;
  const majorDegrees = !cfg.minor;
  if (key.minor && majorDegrees) prog = prog.map((r) => MAJ_TO_MIN[r] || r);
  // A minor-flavoured genre in a major key: shift tonic to the relative minor so it stays in key.
  const tonic = !key.minor && cfg.minor ? (key.pc + 9) % 12 : key.pc;
  return prog.map((r) => {
    const [off, q] = ROMAN[r] || [0, 'maj'];
    const root = (tonic + off) % 12;
    const ints = cfg.power ? [0, 7, 12] : q === 'min' ? [0, 3, 7] : [0, 4, 7];
    // voice chord tones into a comfy mid range (MIDI 55..66) so stabs sit under the vocal
    const notes = ints.map((i) => { let n = 55 + (((root + i) - 55) % 12 + 12) % 12; if (cfg.power && i === 12) n += 12; return n; }).sort((a, b) => a - b);
    return { root, notes, bass: 36 + ((root + 12 - 0) % 12) - (root > 7 ? 12 : 0) };
  });
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- audio graph
let G = null; // shared nodes, built once
let state = { running: false, loop: null, step: 0, kicks: [], ducked: false };

async function ensureGraph() {
  if (G) return G;
  const Tn = T();
  const limiter = new Tn.Limiter(-3).toDestination();
  const master = new Tn.Volume(-6).connect(limiter);
  const beatBus = new Tn.Volume(0).connect(master);
  const stingBus = new Tn.Volume(-2).connect(master);
  const comp = new Tn.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.15 }).connect(beatBus);
  const reverb = new Tn.Reverb({ decay: 2.2, wet: 0.22 }).connect(comp);
  if (reverb.ready) { try { await reverb.ready; } catch (e) { /* fine */ } }

  const kick = new Tn.MembraneSynth({ pitchDecay: 0.045, octaves: 6, oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.08 } }).connect(comp);
  kick.volume.value = -3;

  const snareF = new Tn.Filter({ type: 'bandpass', frequency: 2200, Q: 0.7 }).connect(reverb);
  const snare = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 } }).connect(snareF);
  snare.volume.value = -9;
  const snareBody = new Tn.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(comp);
  snareBody.volume.value = -16;

  const clapF = new Tn.Filter({ type: 'bandpass', frequency: 1400, Q: 1.1 }).connect(reverb);
  const clap = new Tn.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }).connect(clapF);
  clap.volume.value = -8;

  const hatF = new Tn.Filter({ type: 'highpass', frequency: 7500 }).connect(comp);
  const hat = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }).connect(hatF);
  hat.volume.value = -22;
  const ohat = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.22, sustain: 0 } }).connect(hatF);
  ohat.volume.value = -25;
  const tambF = new Tn.Filter({ type: 'bandpass', frequency: 9000, Q: 1.5 }).connect(comp);
  const tamb = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.07, sustain: 0 } }).connect(tambF);
  tamb.volume.value = -24;

  const bass = new Tn.MonoSynth({ oscillator: { type: 'sawtooth' },
    filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0.55, release: 0.15 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 90, octaves: 2.6 } }).connect(comp);
  bass.volume.value = -9;

  const chordF = new Tn.Filter({ type: 'lowpass', frequency: 2500, Q: 0.6 }).connect(reverb);
  const chords = new Tn.PolySynth(Tn.Synth, { oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 0.35 } }).connect(chordF);
  chords.volume.value = -17;

  const pad = new Tn.PolySynth(Tn.Synth, { oscillator: { type: 'fatsine', count: 3, spread: 18 },
    envelope: { attack: 0.5, decay: 0.4, sustain: 0.7, release: 1.4 } }).connect(reverb);
  pad.volume.value = -24;

  G = { limiter, master, beatBus, stingBus, comp, reverb, kick, snare, snareF, snareBody, clap, clapF, hat, ohat, hatF, tamb, bass, chords, chordF, pad };
  return G;
}

function applyGenreSound(cfg) {
  try { G.chords.set({ oscillator: cfg.chordOsc.startsWith('fat') ? { type: cfg.chordOsc, count: 3, spread: 22 } : { type: cfg.chordOsc } }); } catch (e) { /* keep last */ }
  try { G.bass.set({ oscillator: { type: cfg.bassOsc } }); } catch (e) { /* keep last */ }
  G.chordF.frequency.value = cfg.chordCut;
  G.bass.filterEnvelope.baseFrequency = cfg.bassCut / 5;
  G.chords.volume.value = cfg.soft ? -19 : cfg.power ? -20 : -17;
  G.pad.volume.value = cfg.padOnly ? -19 : -25;
  G.kick.volume.value = cfg.soft ? -8 : -3;
}

// ---------------------------------------------------------------- public API
export async function startBeat({ genre, bpm, key } = {}) {
  const Tn = T();
  await Tn.start();
  if (state.running) stopBeat();
  await ensureGraph();
  const gName = resolveGenre(genre);
  const cfg = GENRES[gName];
  let tempo = Number(bpm) || cfg.bpm;
  if (cfg.minBpm && tempo < cfg.minBpm) tempo = tempo * 2 >= cfg.minBpm && tempo * 2 <= 180 ? tempo * 2 : cfg.minBpm;
  tempo = Math.max(60, Math.min(180, tempo));
  const prog = buildProgression(cfg, parseKey(key));
  applyGenreSound(cfg);

  const tr = transport();
  tr.cancel();
  tr.bpm.value = tempo;
  tr.swing = cfg.swing || 0;
  tr.swingSubdivision = '16n';
  G.beatBus.volume.cancelScheduledValues(Tn.now());
  G.beatBus.volume.value = state.ducked ? -10 : 0;

  state.step = 0;
  state.kicks = [];
  let arpI = 0;
  const loop = new Tn.Loop((time) => {
    const s = state.step % 16;
    const bar = Math.floor(state.step / 16) % 4;
    const ch = prog[bar];
    const at = (pat) => pat[s];

    const k = at(cfg.kick);
    if (k !== '.') {
      const v = k === 'X' || s === 0 ? 1 : 0.85;
      G.kick.triggerAttackRelease(cfg.soft ? 'C1' : 'B0', '8n', time, v);
      state.kicks.push([time, v]); // audio-clock times; read in getBeatPulse (no rAF dependency)
      if (state.kicks.length > 16) state.kicks.splice(0, state.kicks.length - 16);
    }
    const sn = at(cfg.snare);
    if (sn !== '.') {
      const v = sn === 'X' ? 0.9 : 0.5;
      G.snare.triggerAttackRelease('16n', time, cfg.soft ? v * 0.5 : v);
      G.snareBody.triggerAttackRelease('G2', '16n', time, v * 0.8);
    }
    if (at(cfg.clap) !== '.') {
      // three tiny hits = a real-ish clap
      G.clap.triggerAttackRelease(0.01, time, 0.6);
      G.clap.triggerAttackRelease(0.01, time + 0.012, 0.6);
      G.clap.triggerAttackRelease(0.12, time + 0.024, cfg.stomp ? 1 : 0.85);
      if (cfg.stomp) G.snareBody.triggerAttackRelease('D2', '8n', time, 0.9);
    }
    const h = at(cfg.hat);
    if (h === 'x') G.hat.triggerAttackRelease('32n', time, s % 4 === 0 ? 0.9 : s % 2 === 0 ? 0.65 : 0.45);
    else if (h === 'o') G.ohat.triggerAttackRelease('8n', time, 0.8);
    if (cfg.tamb && s % 4 === 2) G.tamb.triggerAttackRelease('16n', time, 0.8);

    const b = at(cfg.bass);
    if (b !== '.') {
      const n = ch.bass + (b === 'o' ? 12 : b === 'f' ? 7 : 0);
      G.bass.triggerAttackRelease(midiHz(n), cfg.soft ? '4n' : '16n', time, 0.9);
    }

    const c = at(cfg.chord);
    if (c === 'x') G.chords.triggerAttackRelease(ch.notes.map(midiHz), cfg.stomp ? '8n' : '16n', time, 0.7);
    else if (c === 'a') {
      const pool = [...ch.notes, ch.notes[0] + 12, ch.notes[1] + 12];
      const order = [0, 2, 1, 3, 2, 4, 1, 3];
      G.chords.triggerAttackRelease(midiHz(pool[order[arpI++ % order.length]]), '8n', time, 0.55);
    }
    if (cfg.pad && s === 0) G.pad.triggerAttackRelease(ch.notes.map(midiHz), '1m', time, 0.5);

    state.step++;
  }, '16n');
  loop.start(0);
  state.loop = loop;
  state.running = true;
  tr.start('+0.05');
  return { genre: gName, bpm: tempo };
}

export function stopBeat() {
  if (!window.Tone) return;
  const Tn = T();
  const tr = transport();
  if (state.loop) { try { state.loop.stop(); state.loop.dispose(); } catch (e) { /* ignore */ } state.loop = null; }
  try { tr.stop(); tr.cancel(); tr.position = 0; } catch (e) { /* ignore */ }
  if (G) { try { G.pad.releaseAll(Tn.now()); G.chords.releaseAll(Tn.now()); G.bass.triggerRelease(Tn.now()); } catch (e) { /* ignore */ } }
  state.running = false;
  state.kicks = [];
}

export function getBeatPulse() {
  if (!state.running || !state.kicks.length || !window.Tone) return 0;
  const now = T().getContext().currentTime;
  let last = null;
  for (const k of state.kicks) if (k[0] <= now) last = k;
  if (!last) return 0;
  return Math.max(0, Math.min(1, last[1] * Math.exp(-(now - last[0]) / 0.14)));
}

export function setDuck(on) {
  state.ducked = !!on;
  if (!G || !window.Tone) return;
  const Tn = T();
  G.beatBus.volume.cancelScheduledValues(Tn.now());
  G.beatBus.volume.rampTo(on ? -10 : 0, on ? 0.12 : 0.4);
}

// ---------------------------------------------------------------- stings
let S = null;
function ensureStings() {
  if (S) return S;
  const Tn = T();
  const out = G.stingBus;
  const rev = new Tn.Reverb({ decay: 1.8, wet: 0.25 }).connect(out);

  const rollF = new Tn.Filter({ type: 'bandpass', frequency: 2000, Q: 0.6 }).connect(rev);
  const roll = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0 } }).connect(rollF);
  roll.volume.value = -14;
  const crashF = new Tn.Filter({ type: 'highpass', frequency: 4000 }).connect(rev);
  const crash = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 1.6, sustain: 0 } }).connect(crashF);
  crash.volume.value = -18;
  const boom = new Tn.MembraneSynth({ pitchDecay: 0.06, octaves: 5, envelope: { attack: 0.001, decay: 0.6, sustain: 0 } }).connect(out);
  boom.volume.value = -4;

  const clapF = new Tn.Filter({ type: 'bandpass', frequency: 1600, Q: 1.2 }).connect(rev);
  const clap = new Tn.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(clapF);
  clap.volume.value = -12;
  const crowdF = new Tn.Filter({ type: 'bandpass', frequency: 1100, Q: 0.5 }).connect(rev);
  const crowdEnv = new Tn.AmplitudeEnvelope({ attack: 0.4, decay: 0.2, sustain: 1, release: 1.2 }).connect(crowdF);
  const crowd = new Tn.Noise('pink').connect(crowdEnv);
  crowd.volume.value = -20;

  const hornF = new Tn.Filter({ type: 'lowpass', frequency: 2800, Q: 1 }).connect(rev);
  const horn = new Tn.Synth({ oscillator: { type: 'fatsawtooth', count: 3, spread: 35 },
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.08 } }).connect(hornF);
  horn.volume.value = -16;

  const vib = new Tn.Vibrato({ frequency: 5.5, depth: 0.12 }).connect(rev);
  const bone = new Tn.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { type: 'lowpass', Q: 3 },
    envelope: { attack: 0.04, decay: 0.1, sustain: 0.8, release: 0.25 },
    filterEnvelope: { attack: 0.12, decay: 0.3, sustain: 0.4, release: 0.3, baseFrequency: 250, octaves: 2.2 } }).connect(vib);
  bone.volume.value = -12;

  S = { roll, crash, boom, clap, clapF, crowd, crowdEnv, horn, bone, vib };
  return S;
}

// ElevenLabs Sound Effects pack (server generates once into cache/sfx/). Real recordings beat synth stings when present.
const SFX = {};
const SFX_ALIAS = { applause: 'cheer', ooh: 'ooooh', oooh: 'ooooh', laughter: 'laugh', mic: 'micdrop', 'mic drop': 'micdrop', 'record scratch': 'scratch' };
const SFX_VOL = { cheer: 0.8, laugh: 0.75, boo: 0.7, ooooh: 0.85, airhorn: 0.6, scratch: 0.8, micdrop: 0.9, drumroll: 0.8 };
function loadSfx() {
  return fetch('/api/sfx-pack').then((r) => (r.ok ? r.json() : [])).then((list) => {
    for (const { name, url } of list || []) { if (SFX[name]) continue; const a = new Audio(url); a.preload = 'auto'; SFX[name] = a; }
  }).catch(() => {});
}
if (typeof window !== 'undefined') { loadSfx(); setTimeout(loadSfx, 20000); setTimeout(loadSfx, 60000); } // pack may still be generating at start
/** Play an ElevenLabs sound effect (cheer, ooooh, boo, laugh, airhorn, scratch, micdrop, drumroll). Returns true if it played. */
export function playSfx(name) {
  const n = SFX_ALIAS[String(name || '').toLowerCase()] || String(name || '').toLowerCase();
  const base = SFX[n];
  if (!base) return false;
  try { const a = base.cloneNode(); a.volume = SFX_VOL[n] ?? 0.8; a.play().catch(() => {}); return true; } catch { return false; }
}
if (typeof window !== 'undefined') window.playSfx = playSfx;

export async function playSting(name) {
  if (playSfx(name)) return 2.5;
  const Tn = T();
  await Tn.start();
  await ensureGraph();
  const s = ensureStings();
  const t0 = Tn.now() + 0.05;
  const n = String(name || '').toLowerCase();

  if (n === 'drumroll') {
    let t = t0, gap = 0.07; const end = t0 + 2.2;
    while (t < end) {
      const p = (t - t0) / 2.2;
      s.roll.triggerAttackRelease(0.04, t, 0.25 + 0.75 * p);
      gap = Math.max(0.03, gap * 0.985);
      t += gap;
    }
    s.boom.triggerAttackRelease('A0', '4n', end + 0.02, 1);
    s.crash.triggerAttackRelease(1.6, end + 0.02, 0.9);
    return 2.6;
  }
  if (n === 'applause') {
    const dur = 3;
    s.crowd.start(t0).stop(t0 + dur + 1.4);
    s.crowdEnv.triggerAttackRelease(dur, t0, 0.8);
    let t = t0;
    while (t < t0 + dur) {
      const p = (t - t0) / dur;
      const fade = p < 0.15 ? p / 0.15 : p > 0.7 ? (1 - p) / 0.3 : 1;
      s.clapF.frequency.setValueAtTime(1000 + Math.random() * 1800, t);
      s.clap.triggerAttackRelease(0.02, t, (0.3 + Math.random() * 0.7) * fade);
      t += 0.012 + Math.random() * 0.025;
    }
    return dur + 1;
  }
  if (n === 'airhorn') {
    const f = 466.16; // Bb4
    const hits = [[0, 0.12], [0.18, 0.12], [0.36, 0.75]];
    for (const [o, d] of hits) {
      s.horn.triggerAttackRelease(f, d, t0 + o, 1);
    }
    s.horn.frequency.setValueAtTime(f, t0 + 0.9);
    s.horn.frequency.linearRampToValueAtTime(f * 0.94, t0 + 1.1);
    return 1.3;
  }
  if (n === 'fail') { // sad trombone: wah wah wah waaah
    const notes = [62, 61, 60, 59];
    notes.forEach((m, i) => {
      const last = i === notes.length - 1;
      s.bone.triggerAttackRelease(midiHz(m), last ? 1.3 : 0.38, t0 + i * 0.45, 0.9);
    });
    return 3.2;
  }
  return 0;
}
