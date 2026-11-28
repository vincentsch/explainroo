// Generative underscore. A style is a tempo, a set of chord progressions and a
// bar function that plays its instruments; the scheduler handles sections,
// voice leading, scene accents and the final cadence.
import { makeRng, hashSeed } from './rng.js';
import { dbToGain, clamp } from './dsp.js';
import { Synth } from './synth.js';
import { parseKey, KEYS, KEY_LABELS, MAJOR, chordPcs, rootPc, bassMidi, voiceChord, nearestWithPc, pentaNote } from './theory.js';
import * as I from './instruments.js';

const C = (deg, ext = {}) => ({ deg, ...ext });

// --- shared helpers used by the style bar functions --------------------------

function strum(api, fn, lane, t, notes, vel, dur, gap = 0.012, opts) {
  notes.forEach((m, k) => fn(api.syn, lane, api.hum(t + k * gap, 0.003), m, api.vel(vel), dur, opts));
}

// Next note of a slow pentatonic melody: small steps, chord tones on strong beats.
function melodyNote(api, b, strong, { low = 74, high = 88 } = {}) {
  const st = api.state;
  let note = st.melody ?? nearestWithPc(b.pcs[0], (low + high) / 2);
  if (strong) {
    const options = [];
    for (let m = low; m <= high; m++) if (b.pcs.slice(0, 3).includes(m % 12)) options.push(m);
    options.sort((x, y) => Math.abs(x - note) - Math.abs(y - note));
    note = options[Math.min(options.length - 1, api.rng.int(0, 1))] ?? note;
  } else {
    const tonic = api.tonic;
    const steps = [];
    for (let s = -10; s <= 20; s++) {
      const m = pentaNote(tonic, s);
      if (m >= low && m <= high && m !== note && Math.abs(m - note) <= 5) steps.push(m);
    }
    if (steps.length) note = api.rng.pick(steps);
  }
  st.melody = note;
  return note;
}

function inKey(api, m) {
  return MAJOR.includes((((m - api.keyRoot) % 12) + 12) % 12);
}

// A scale tone one step before `target`, approached from `dir` (+1 below, -1 above).
function approach(api, target, dir) {
  for (let d = 1; d <= 2; d++) {
    const m = target - dir * d;
    if (inKey(api, m)) return m;
  }
  return target - dir * 2;
}

const topNotes = (notes, n) => notes.slice(-n);

// --- styles ------------------------------------------------------------------

const EP_PATTERNS = {
  0: [
    [[0, 'chord', 3.6, 0.7]],
    [[0, 'chord', 2.2, 0.7], [2.5, 'top2', 1.3, 0.45]],
  ],
  0.5: [[[0, 'chord', 3.6, 0.6]]],
  1: [
    [[0, 'chord', 1.4, 0.8], [1.5, 'top2', 0.9, 0.5], [2.5, 'chord', 1.2, 0.6], [3.5, 'top1', 0.45, 0.4]],
    [[0, 'chord', 1.9, 0.8], [2, 'top2', 0.5, 0.45], [2.5, 'chord', 1.3, 0.6]],
  ],
  2: [
    [[0, 'chord', 1.4, 0.85], [1, 'top1', 0.4, 0.35], [1.5, 'top2', 0.8, 0.5], [2.5, 'chord', 1.1, 0.65], [3.25, 'top1', 0.3, 0.35], [3.5, 'top2', 0.45, 0.45]],
    [[0, 'chord', 0.9, 0.85], [1, 'top2', 0.4, 0.4], [1.5, 'chord', 0.9, 0.6], [2.5, 'top2', 0.5, 0.5], [3, 'chord', 0.9, 0.6]],
  ],
};

function pickNotes(b, kind) {
  if (kind === 'chord') return b.upper;
  if (kind === 'top2') return topNotes(b.upper, 2);
  return topNotes(b.upper, 1);
}

function walkingBass(api, b, lane) {
  const { syn, beat } = api;
  I.bass(syn, lane, api.hum(b.t), b.bass, api.vel(0.85), beat * 1.4);
  const fifth = nearestWithPc(b.pcs[2], b.bass + 7);
  const second = api.rng.chance(0.6) ? b.bass : fifth;
  I.bass(syn, lane, api.hum(b.t + 2 * beat), second, api.vel(0.7), beat * 1.2);
  if (b.nextRoot !== b.root && api.rng.chance(0.55)) {
    const next = bassMidi(b.nextRoot);
    I.bass(syn, lane, api.hum(b.t + 3.5 * beat), approach(api, next, next >= second ? 1 : -1), api.vel(0.5), beat * 0.45);
  }
}

const STYLES = {
  warm: {
    description: 'Soft electric piano over a warm pad with a gentle bass line (about 84 bpm). Friendly all-round default.',
    mixDb: -12.7,
    bpm: 84,
    keys: ['F', 'G', 'D', 'Eb', 'C', 'Bb'],
    barsPerChord: 1,
    progressions: [
      [C(0, { seventh: true }), C(5, { seventh: true }), C(3, { seventh: true }), C(4, { sus4: true })],
      [C(3, { seventh: true }), C(0, { ninth: true }), C(5, { seventh: true }), C(4)],
      [C(5, { seventh: true }), C(3, { seventh: true }), C(0, { ninth: true }), C(4)],
      [C(1, { seventh: true }), C(4), C(2, { seventh: true }), C(5, { seventh: true })],
    ],
    cadence: C(4),
    final: C(0, { ninth: true }),
    trimDb: 0,
    reverb: { seconds: 2.4, level: 0.8 },
    lanes: {
      pad: { filter: { type: 'lowpass', freq: 1100, q: 0.6, lfo: { rate: 0.07, depth: 350 } }, reverb: 0.35 },
      ep: { panLfo: { rate: 0.23, depth: 0.35 }, reverb: 0.25, filter: { type: 'lowpass', freq: 5200, q: 0.5 } },
      bass: { filter: { type: 'lowpass', freq: 700, q: 0.6 }, gain: 0.5 },
      bell: { pan: 0.3, reverb: 0.55, gain: 0.9 },
      fx: { reverb: 0.3 },
    },
    bar(api, b) {
      const { syn, lanes, beat } = api;
      const L = b.level;
      if (b.chordStart) {
        for (const m of b.voicing) I.padVoice(syn, lanes.pad, b.t, m, L === 0 ? 0.75 : 1, b.chordDur, { attack: 1.0, release: 1.8, level: 0.03 });
      }
      const patterns = EP_PATTERNS[L];
      const pattern = patterns[(b.sec + Math.floor(b.secBar / 2)) % patterns.length];
      for (const [pos, kind, len, v] of pattern) {
        strum(api, I.epiano, lanes.ep, b.t + pos * beat, pickNotes(b, kind), v * (L === 0 ? 0.85 : 1), len * beat, kind === 'chord' ? 0.014 : 0.008);
      }
      if (L >= 1) walkingBass(api, b, lanes.bass);
      else if (L === 0.5) I.bass(syn, lanes.bass, b.t, b.bass, 0.6, api.barLen * 0.95);
      if (L === 2) {
        for (const half of [0, 2]) {
          if (!api.rng.chance(0.45)) continue;
          const pos = half + api.rng.pick([0, 0.5, 1]);
          I.bell(syn, lanes.bell, api.hum(b.t + pos * beat), melodyNote(api, b, pos % 2 === 0), api.vel(0.5), { decay: 2.4, level: 0.045 });
        }
      }
    },
    accent(api, t, b) {
      I.swell(api.syn, api.lanes.fx, t, 0.8, api.rng, { length: 0.9, level: 0.035 });
      if (b.level >= 1) I.bell(api.syn, api.lanes.bell, t, nearestWithPc(b.pcs[0], 84), 0.4, { decay: 2.6, level: 0.045 });
    },
    ending(api, t, remain, f) {
      const { syn, lanes } = api;
      const hold = Math.max(0.2, remain - 1.3);
      for (const m of f.voicing) I.padVoice(syn, lanes.pad, t, m, 1, hold, { attack: 0.08, release: 1.1, level: 0.032 });
      strum(api, I.epiano, lanes.ep, t, f.upper, 0.8, Math.max(0.3, remain - 0.4), 0.035);
      I.bass(syn, lanes.bass, t, f.bass, 0.8, Math.max(0.3, remain * 0.75));
      I.bell(syn, lanes.bell, t + 0.06, api.tonic + 24, 0.5, { decay: Math.min(3.5, remain + 0.5), level: 0.05 });
    },
  },

  upbeat: {
    description: 'Bright plucked arpeggios, light drums and a bouncing bass (about 112 bpm). Product launches and energetic explainers.',
    mixDb: -9,
    bpm: 112,
    keys: ['C', 'D', 'E', 'G', 'A', 'F'],
    barsPerChord: 1,
    progressions: [
      [C(0), C(4), C(5), C(3)],
      [C(5), C(3), C(0), C(4)],
      [C(3), C(4), C(0, { ninth: true }), C(5)],
      [C(0, { ninth: true }), C(2), C(3), C(4, { sus4: true })],
    ],
    cadence: C(4),
    final: C(0),
    trimDb: 0,
    reverb: { seconds: 1.8, level: 0.6 },
    lanes: {
      pad: { filter: { type: 'lowpass', freq: 1500, q: 0.5, lfo: { rate: 0.09, depth: 400 } }, reverb: 0.3, gain: 0.8 },
      arpL: { pan: -0.35, reverb: 0.22 },
      arpR: { pan: 0.35, reverb: 0.22 },
      bass: { filter: { type: 'lowpass', freq: 800, q: 0.7 }, gain: 0.5 },
      kick: { gain: 0.7 },
      clap: { filter: { type: 'bandpass', freq: 1500, q: 0.8 }, pan: -0.08, reverb: 0.18 },
      hat: { filter: { type: 'highpass', freq: 7000, q: 0.7 }, pan: 0.22 },
      bell: { pan: -0.25, reverb: 0.45 },
      fx: { reverb: 0.3 },
    },
    bar(api, b) {
      const { syn, lanes, beat, rng } = api;
      const L = b.level;
      if (b.chordStart) {
        for (const m of b.voicing) I.padVoice(syn, lanes.pad, b.t, m, 1, b.chordDur, { attack: 0.35, release: 1.0, level: 0.022 });
      }
      const ARP = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 3], [0, 1, 2, 3, 4, 3, 2, 1]];
      const pattern = ARP[b.sec % ARP.length];
      const step = L === 0 || L === 0.5 ? 0.5 : 0.25;
      const n = Math.round(4 / step);
      for (let k = 0; k < n; k++) {
        const idx = pattern[k % pattern.length];
        const m = idx < b.upper.length ? b.upper[idx] : b.upper[0] + 12;
        const onBeat = (k * step) % 1 === 0;
        I.pluck(syn, k % 2 ? lanes.arpR : lanes.arpL, api.hum(b.t + k * step * beat, 0.003), m, api.vel(onBeat ? 0.8 : 0.58), {
          decay: 0.26, bright: L === 2 ? 3800 : 2700, level: 0.1,
        });
      }
      if (L >= 1) {
        for (let k = 0; k < 8; k++) {
          const m = k % 4 === 3 && rng.chance(0.4) ? b.bass + 12 : b.bass;
          I.bass(syn, lanes.bass, api.hum(b.t + k * 0.5 * beat, 0.003), m, api.vel(k % 2 ? 0.6 : 0.85), beat * 0.38, { staccato: true });
        }
        const kicks = L === 2 ? [0, 1, 2, 3] : [0, 2, 2.5];
        for (const x of kicks) I.kick(syn, lanes.kick, api.hum(b.t + x * beat, 0.002), api.vel(0.85, 0.05));
        for (const x of [1, 3]) I.clap(syn, lanes.clap, api.hum(b.t + x * beat, 0.002), api.vel(0.8, 0.05), rng);
        for (const x of [0.5, 1.5, 2.5, 3.5]) I.hat(syn, lanes.hat, api.hum(b.t + x * beat, 0.002), api.vel(0.8), rng);
        if (L === 2) for (const x of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]) I.hat(syn, lanes.hat, api.hum(b.t + x * beat, 0.002), api.vel(0.32), rng);
        if (b.secBar === 0 && b.sec > 0) I.crash(syn, lanes.hat, b.t, 0.8, rng);
      } else if (L === 0.5) {
        I.bass(syn, lanes.bass, b.t, b.bass, 0.6, api.barLen * 0.95);
        for (const x of [0, 1, 2, 3]) I.hat(syn, lanes.hat, api.hum(b.t + x * beat, 0.002), api.vel(0.45), rng);
      }
      if (L === 2) {
        for (const pos of [0, 1.5, 3]) {
          if (pos > 0 && !rng.chance(0.55)) continue;
          I.bell(syn, lanes.bell, api.hum(b.t + pos * beat), melodyNote(api, b, pos === 0, { low: 76, high: 91 }), api.vel(0.45), { decay: 1.4, level: 0.04, partials: 4 });
        }
      }
    },
    accent(api, t) {
      I.swell(api.syn, api.lanes.fx, t, 0.9, api.rng, { length: 0.8, level: 0.04 });
    },
    ending(api, t, remain, f) {
      const { syn, lanes, rng } = api;
      for (const m of f.voicing) I.padVoice(syn, lanes.pad, t, m, 1, Math.max(0.2, remain - 1.1), { attack: 0.05, release: 1.0, level: 0.026 });
      f.upper.forEach((m, k) => I.pluck(syn, k % 2 ? lanes.arpR : lanes.arpL, t + k * 0.06, m, 0.8, { decay: 0.9, bright: 3000, level: 0.1 }));
      I.pluck(syn, lanes.arpL, t + f.upper.length * 0.06, f.upper[0] + 12, 0.7, { decay: 1.2, bright: 2600, level: 0.1 });
      I.bass(syn, lanes.bass, t, f.bass, 0.85, Math.max(0.3, remain * 0.6));
      I.kick(syn, lanes.kick, t, 0.9);
      I.crash(syn, lanes.hat, t, 1, rng);
      I.bell(syn, lanes.bell, t + 0.05, api.tonic + 24, 0.45, { decay: Math.min(3, remain + 0.4), level: 0.045 });
    },
  },

  calm: {
    description: 'Slow evolving pad with sparse bells and a soft low piano (about 70 bpm). Thoughtful or serious topics.',
    mixDb: -10.6,
    bpm: 70,
    keys: ['D', 'Eb', 'F', 'A', 'Bb', 'C'],
    barsPerChord: 2,
    progressions: [
      [C(0, { ninth: true }), C(3, { seventh: true }), C(5, { seventh: true }), C(3, { ninth: true })],
      [C(5, { seventh: true }), C(3, { seventh: true }), C(0, { ninth: true }), C(4, { sus4: true })],
      [C(3, { seventh: true }), C(0, { ninth: true }), C(1, { seventh: true }), C(4, { sus2: true })],
      [C(0, { ninth: true }), C(2, { seventh: true }), C(3, { seventh: true }), C(3, { ninth: true })],
    ],
    cadence: C(3, { seventh: true }),
    final: C(0, { ninth: true }),
    trimDb: 0,
    reverb: { seconds: 3.6, level: 0.9 },
    lanes: {
      pad: { filter: { type: 'lowpass', freq: 1300, q: 0.5, lfo: { rate: 0.05, depth: 450 } }, reverb: 0.45 },
      ep: { reverb: 0.35, filter: { type: 'lowpass', freq: 3000, q: 0.5 } },
      bass: { filter: { type: 'lowpass', freq: 500, q: 0.5 }, gain: 0.5 },
      bell: { pan: 0.28, reverb: 0.7, panLfo: { rate: 0.11, depth: 0.4 } },
      fx: { reverb: 0.4 },
    },
    bar(api, b) {
      const { syn, lanes, beat, rng } = api;
      const L = b.level;
      if (b.chordStart) {
        for (const m of b.voicing) I.padVoice(syn, lanes.pad, b.t, m, L === 0 ? 0.8 : 1, b.chordDur, { attack: 1.6, release: 2.6, level: 0.042 });
        if (L >= 1) {
          strum(api, I.epiano, lanes.ep, b.t, b.voicing.map((m) => m - 12).filter((m) => m >= 45), 0.38, b.chordDur * 0.9, 0.03);
          I.bass(syn, lanes.bass, b.t, b.bass, 0.55, b.chordDur - 0.02);
        }
      }
      const count = L === 0 ? 1 : L === 2 ? 3 : 2;
      const slots = [0, 1, 1.5, 2, 2.5, 3];
      const chosen = [];
      while (chosen.length < count) {
        const s = rng.pick(slots);
        if (!chosen.includes(s)) chosen.push(s);
      }
      chosen.sort((x, y) => x - y);
      for (const pos of chosen) {
        I.bell(syn, lanes.bell, api.hum(b.t + pos * beat, 0.012), melodyNote(api, b, pos % 2 === 0), api.vel(0.5, 0.15), { decay: 3.4, level: 0.05 });
      }
    },
    accent(api, t, b) {
      I.swell(api.syn, api.lanes.fx, t, 0.7, api.rng, { length: 1.2, level: 0.03 });
      I.bell(api.syn, api.lanes.bell, t, nearestWithPc(b.pcs[0], 86), 0.4, { decay: 3.5, level: 0.045 });
    },
    ending(api, t, remain, f) {
      const { syn, lanes } = api;
      for (const m of f.voicing) I.padVoice(syn, lanes.pad, t, m, 1, Math.max(0.2, remain - 1.4), { attack: 0.4, release: 1.2, level: 0.042 });
      I.bass(syn, lanes.bass, t, f.bass, 0.6, Math.max(0.3, remain * 0.8));
      I.bell(syn, lanes.bell, t + 0.1, api.tonic + 24, 0.5, { decay: Math.min(4, remain + 0.5), level: 0.05 });
      I.bell(syn, lanes.bell, t + 0.55, api.tonic + 19, 0.35, { decay: Math.min(4, remain), level: 0.045 });
    },
  },

  tech: {
    description: 'Pulsing filtered synth arpeggio, sub bass and a steady soft kick (about 100 bpm). Software, data and developer topics.',
    mixDb: -9.1,
    bpm: 100,
    keys: ['C', 'D', 'Eb', 'F', 'G', 'A'],
    barsPerChord: 1,
    progressions: [
      [C(5), C(3), C(0), C(4)],
      [C(5), C(5), C(3), C(4)],
      [C(3), C(4), C(5), C(5)],
      [C(5, { seventh: true }), C(2), C(3), C(4)],
    ],
    cadence: C(4),
    final: C(0),
    trimDb: 0,
    reverb: { seconds: 2.0, level: 0.55 },
    lanes: {
      arp: { pump: true, reverb: 0.25, panLfo: { rate: 0.19, depth: 0.45 } },
      pad: { pump: true, filter: { type: 'lowpass', freq: 900, q: 1.2, lfo: { rate: 0.06, depth: 350 } }, reverb: 0.35 },
      bass: { filter: { type: 'lowpass', freq: 320, q: 0.7 }, gain: 0.5 },
      kick: { gain: 0.7 },
      hat: { filter: { type: 'highpass', freq: 8000, q: 0.7 }, pan: 0.2 },
      clap: { filter: { type: 'bandpass', freq: 1900, q: 1.1 }, pan: -0.1, reverb: 0.2 },
      bell: { pan: 0.2, reverb: 0.5 },
      fx: { reverb: 0.3 },
    },
    bar(api, b) {
      const { syn, lanes, beat, rng } = api;
      const L = b.level;
      const r = nearestWithPc(b.root, 57);
      const tones = [r, nearestWithPc(b.pcs[1], r + 4), nearestWithPc(b.pcs[2], r + 7), r + 12];
      const TECH = [[0, 2, 1, 2, 0, 2, 3, 2], [0, 1, 2, 1, 0, 3, 2, 1], [0, 2, 3, 2, 1, 2, 3, 2]];
      const pattern = TECH[b.sec % TECH.length];
      const open = (b.secBar + 1) / api.secLen;
      const bright = (900 + 2800 * open) * (L >= 1 ? 1 : 0.65);
      for (let k = 0; k < 16; k++) {
        if (L === 0 && k % 2 === 1) continue;
        const m = tones[pattern[k % pattern.length]];
        I.pluck(syn, lanes.arp, api.hum(b.t + k * 0.25 * beat, 0.002), m, api.vel(k % 4 === 0 ? 0.9 : 0.62, 0.06), {
          type: 'sawtooth', decay: 0.19, bright, q: 4, level: 0.085,
        });
      }
      const drums = L >= 1;
      if (drums) {
        for (let k = 0; k < 4; k++) {
          const tb = b.t + k * beat;
          I.kick(syn, lanes.kick, tb, api.vel(0.8, 0.04));
          api.pump(tb);
          I.bass(syn, lanes.bass, api.hum(tb + 0.5 * beat, 0.002), b.bass, api.vel(0.8, 0.05), beat * 0.32, { staccato: true });
          I.hat(syn, lanes.hat, api.hum(tb + 0.5 * beat, 0.002), api.vel(0.55), rng, { open: true, level: 0.05 });
        }
        if (L === 2) {
          for (const x of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]) I.hat(syn, lanes.hat, api.hum(b.t + x * beat, 0.002), api.vel(0.3), rng);
          for (const x of [1, 3]) I.clap(syn, lanes.clap, api.hum(b.t + x * beat, 0.002), api.vel(0.5), rng, { level: 0.1 });
        }
      } else if (L === 0.5) {
        I.bass(syn, lanes.bass, b.t, b.bass, 0.55, api.barLen * 0.95);
      }
      if (b.chordStart && (L === 2 || L === 0.5)) {
        for (const m of b.voicing) I.padVoice(syn, lanes.pad, b.t, m, 1, b.chordDur, { attack: 0.3, release: 0.9, level: 0.022 });
      }
    },
    accent(api, t) {
      I.swell(api.syn, api.lanes.fx, t, 0.9, api.rng, { length: 0.7, level: 0.04 });
    },
    ending(api, t, remain, f) {
      const { syn, lanes, rng } = api;
      for (const m of f.voicing) I.padVoice(syn, lanes.pad, t, m, 1, Math.max(0.2, remain - 1.1), { attack: 0.05, release: 1.0, level: 0.03 });
      I.pluck(syn, lanes.arp, t, nearestWithPc(f.pcs[0], 57), 0.9, { type: 'sawtooth', decay: 1.1, bright: 2400, q: 3, level: 0.09 });
      I.pluck(syn, lanes.arp, t + 0.02, nearestWithPc(f.pcs[0], 69), 0.7, { type: 'sawtooth', decay: 1.3, bright: 2600, q: 3, level: 0.08 });
      I.bass(syn, lanes.bass, t, f.bass, 0.85, Math.max(0.3, remain * 0.6));
      I.kick(syn, lanes.kick, t, 0.9);
      I.crash(syn, lanes.hat, t, 0.8, rng);
      I.bell(syn, lanes.bell, t + 0.05, api.tonic + 24, 0.4, { decay: Math.min(3, remain + 0.4), level: 0.04 });
    },
  },

  playful: {
    description: 'Bouncy marimba, pizzicato bass, claps and shaker (about 118 bpm). Light, fun or consumer topics.',
    mixDb: -8,
    bpm: 118,
    keys: ['C', 'D', 'F', 'G', 'A', 'Bb'],
    barsPerChord: 1,
    progressions: [
      [C(0), C(3), C(4), C(0)],
      [C(0), C(5), C(1), C(4)],
      [C(3), C(4), C(2), C(5)],
      [C(0), C(1, { seventh: true }), C(3), C(4)],
    ],
    cadence: C(4),
    final: C(0),
    trimDb: 0,
    reverb: { seconds: 1.6, level: 0.55 },
    lanes: {
      marL: { pan: -0.3, reverb: 0.2 },
      marR: { pan: 0.3, reverb: 0.2 },
      pad: { filter: { type: 'lowpass', freq: 1400, q: 0.5 }, reverb: 0.3, gain: 0.7 },
      bass: { filter: { type: 'lowpass', freq: 1200, q: 0.6 }, gain: 0.8 },
      kick: { gain: 0.7 },
      clap: { filter: { type: 'bandpass', freq: 1400, q: 0.9 }, reverb: 0.2, pan: 0.05 },
      shaker: { filter: { type: 'bandpass', freq: 6500, q: 1.2 }, pan: -0.35 },
      bell: { pan: 0.25, reverb: 0.4 },
      fx: { reverb: 0.3 },
    },
    bar(api, b) {
      const { syn, lanes, beat, rng } = api;
      const L = b.level;
      const r = nearestWithPc(b.root, 64);
      const tones = [r, nearestWithPc(b.pcs[1], r + 4), nearestWithPc(b.pcs[2], r + 7), r + 12, nearestWithPc(b.pcs[1], r + 16)];
      const MAR = [[0, 2, 3, 2, 1, 2, 3, null], [0, null, 2, 3, 4, 3, 2, null], [3, 2, 0, 2, 1, null, 2, 4]];
      const pattern = MAR[(b.sec + Math.floor(b.secBar / 2)) % MAR.length];
      for (let k = 0; k < 8; k++) {
        if ((L === 0 || L === 0.5) && k % 2 === 1) continue;
        const idx = pattern[k];
        if (idx == null) continue;
        const swing = k % 2 ? 0.06 * beat : 0;
        I.marimba(syn, k % 2 ? lanes.marR : lanes.marL, api.hum(b.t + k * 0.5 * beat + swing, 0.004), tones[idx], api.vel(k % 2 ? 0.7 : 0.95), { level: 0.15 });
      }
      if (b.chordStart) {
        for (const m of b.voicing) I.padVoice(syn, lanes.pad, b.t, m, 1, b.chordDur, { attack: 0.2, release: 0.8, level: 0.014 });
      }
      const fifth = nearestWithPc(b.pcs[2], b.bass + 7);
      const pizz = { type: 'triangle', bright: 1500, decay: 0.3, level: 0.3, q: 0.8 };
      I.pluck(syn, lanes.bass, api.hum(b.t), b.bass + 12, api.vel(0.9), pizz);
      I.pluck(syn, lanes.bass, api.hum(b.t + 2 * beat), fifth + 12, api.vel(0.75), pizz);
      if (L >= 1) {
        if (b.nextRoot !== b.root) {
          const next = bassMidi(b.nextRoot) + 12;
          I.pluck(syn, lanes.bass, api.hum(b.t + 3.5 * beat), approach(api, next, next >= fifth + 12 ? 1 : -1), api.vel(0.55), pizz);
        }
        for (const x of [1, 3]) I.clap(syn, lanes.clap, api.hum(b.t + x * beat, 0.002), api.vel(0.6), rng, { level: 0.1 });
        for (let k = 0; k < 16; k++) {
          const swing = k % 2 ? 0.05 * beat : 0;
          I.shaker(syn, lanes.shaker, api.hum(b.t + k * 0.25 * beat + swing, 0.002), api.vel(k % 4 === 2 ? 0.85 : 0.45), rng);
        }
        if (L === 2) for (const x of [0, 2]) I.kick(syn, lanes.kick, api.hum(b.t + x * beat, 0.002), api.vel(0.55, 0.05));
      }
      if (L === 2 || (L === 1 && b.sec % 2 === 1)) {
        for (const pos of [0, 1, 2.5]) {
          if (pos > 0 && !rng.chance(0.6)) continue;
          I.bell(syn, lanes.bell, api.hum(b.t + pos * beat), melodyNote(api, b, pos === 0, { low: 79, high: 93 }), api.vel(0.5), { decay: 1.0, level: 0.04, partials: 3 });
        }
      }
    },
    accent(api, t, b) {
      I.swell(api.syn, api.lanes.fx, t, 0.8, api.rng, { length: 0.6, level: 0.035 });
      I.bell(api.syn, api.lanes.bell, t, nearestWithPc(b.pcs[0], 86), 0.4, { decay: 1.2, level: 0.04, partials: 3 });
    },
    ending(api, t, remain, f) {
      const { syn, lanes } = api;
      const top = nearestWithPc(f.pcs[0], 72);
      for (let k = 0; k < 10; k++) {
        const v = 0.75 * Math.pow(0.82, k);
        I.marimba(syn, k % 2 ? lanes.marR : lanes.marL, t + k * 0.055, k % 2 ? nearestWithPc(f.pcs[2], top - 5) : top, v, { level: 0.15 });
      }
      I.marimba(syn, lanes.marL, t, nearestWithPc(f.pcs[0], 60), 0.9, { level: 0.15 });
      for (const m of f.voicing) I.padVoice(syn, lanes.pad, t, m, 1, Math.max(0.2, remain - 1.1), { attack: 0.05, release: 1.0, level: 0.016 });
      I.pluck(syn, lanes.bass, t, f.bass + 12, 0.9, { type: 'triangle', bright: 1400, decay: 0.6, level: 0.3, q: 0.8 });
      I.kick(syn, lanes.kick, t, 0.6);
      I.bell(syn, lanes.bell, t + 0.6, api.tonic + 24, 0.5, { decay: Math.min(2.5, remain), level: 0.045, partials: 3 });
    },
  },
};

export const STYLE_INFO = Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, { description: s.description, bpm: s.bpm, mixDb: s.mixDb || 0 }]));

// --- planning ----------------------------------------------------------------

// When the first beat of the built-in music sounds, in seconds of the video.
export const MUSIC_START = 0.05;

function resolveStyle(style) {
  const name = style || 'warm';
  if (!STYLES[name]) {
    throw new Error(`Unknown music style "${style}". Use one of: ${Object.keys(STYLES).join(', ')}`);
  }
  return name;
}

// Key and tempo a music option resolves to, without rendering anything.
export function musicPlan(music = {}) {
  const name = resolveStyle(music.style);
  const def = STYLES[name];
  const seed = music.seed ?? 1;
  const keyRoot = music.key != null && music.key !== '' ? parseKey(music.key) : KEYS[makeRng(hashSeed('key', name, seed)).pick(def.keys)];
  const bpm = clamp((Number(music.bpm) || def.bpm) * (Number(music.tempo) || 1), 40, 200);
  return { style: name, seed, keyRoot, key: KEY_LABELS[keyRoot], bpm, mixDb: def.mixDb || 0 };
}

function sectionLevels(n) {
  const cycle = [1, 2, 1, 2, 0.5, 2];
  const levels = [0];
  for (let s = 1; s < n; s++) levels.push(cycle[(s - 1) % cycle.length]);
  if (n >= 3) levels[n - 1] = 2;
  return levels;
}

function planBars(def, rng, keyRoot, nBars, start, barLen, groove = false) {
  const secLen = nBars <= 32 ? 4 : 8;
  const nSec = Math.max(1, Math.ceil(nBars / secLen));
  const levels = sectionLevels(nSec);
  if (groove && levels[0] === 0) levels[0] = 1;
  const progs = def.progressions;
  const main = progs[rng.int(0, 1)];
  const alt = progs[rng.int(2, progs.length - 1)];
  const bpc = def.barsPerChord || 1;
  const cadenceStart = nBars >= 2 ? Math.floor((nBars - 1) / bpc) * bpc : Infinity;

  const bars = [];
  let voicing = null;
  let upper = null;
  let current = null;
  for (let i = 0; i < nBars; i++) {
    const sec = Math.floor(i / secLen);
    const secBar = i % secLen;
    const chordStart = secBar % bpc === 0;
    if (chordStart) {
      const prog = sec % 4 === 2 ? alt : main;
      const chord = i >= cadenceStart ? def.cadence : prog[Math.floor(secBar / bpc) % prog.length];
      const pcs = chordPcs(keyRoot, chord);
      voicing = voiceChord(pcs, voicing, { low: 53, high: 76, voices: 4 });
      upper = voiceChord(pcs, upper, { low: 58, high: 81, voices: 4 });
      const bars_ = Math.min(bpc, nBars - i);
      current = { chord, pcs, root: rootPc(keyRoot, chord), voicing, upper, chordDur: bars_ * barLen };
    }
    bars.push({ i, t: start + i * barLen, sec, secBar, level: levels[sec], chordStart, ...current, bass: bassMidi(current.root) });
  }
  return { bars, secLen, lastVoicing: voicing, lastUpper: upper };
}

// Builds a Synth holding the whole underscore for `duration` seconds.
// Render it with synth.renderBlock(); `plan` says what was chosen.
// `groove` starts the music in its full groove instead of its quiet first
// section, for a video without narration. `ringOut` is how long the last chord
// may ring after the closing hit, which lands on the last bar line before it.
// `bars`, when given, is how many bars play before the closing hit.
export function createMusic({ style, seed = 1, bpm, key, duration, scenes = [], sampleRate = 48000, groove = false, ringOut: ring = null, bars: fixed = null } = {}) {
  const plan = musicPlan({ style, seed, bpm, key });
  const def = STYLES[plan.style];
  const rng = makeRng(hashSeed('music', plan.style, plan.seed));
  const beat = 60 / plan.bpm;
  const barLen = beat * 4;
  const start = MUSIC_START;

  const room = clamp(0.55 + (def.reverb.seconds - 1.5) * 0.14, 0.5, 0.9);
  const syn = new Synth(sampleRate, Math.max(1, Math.ceil(duration * sampleRate)), {
    reverb: { room, damp: 0.4, preDelay: 0.02, lowCut: 220 },
    reverbLevel: def.reverb.level,
    gain: dbToGain(def.trimDb || 0),
    highpass: 38,
  });
  const lanes = {};
  for (const [name, spec] of Object.entries(def.lanes)) lanes[name] = syn.lane(spec);
  const pumped = Object.values(lanes).filter((l) => l.pumpTimes);

  const ringOut = ring ?? clamp(duration * 0.1, 1.8, 3.0);
  // With ringOut given, a small margin lets a closing hit on a bar line that
  // whole frames moved a little still count.
  const nBars = fixed ?? Math.max(0, Math.floor((duration - ringOut - start) / barLen + (ring === null ? 0 : 1e-3)));
  const endHit = start + nBars * barLen;
  const { bars, secLen, lastVoicing, lastUpper } = planBars(def, rng, plan.keyRoot, nBars, start, barLen, groove);

  const finalChord = def.final || C(0);
  const fpcs = chordPcs(plan.keyRoot, finalChord);
  const froot = rootPc(plan.keyRoot, finalChord);
  for (let i = 0; i < bars.length; i++) bars[i].nextRoot = i + 1 < bars.length ? bars[i + 1].root : froot;

  const api = {
    syn, rng, lanes, beat, barLen, secLen,
    pump: (t) => pumped.forEach((l) => l.pump(t)),
    keyRoot: plan.keyRoot,
    tonic: 60 + plan.keyRoot,
    state: {},
    hum: (t, amt = 0.006) => Math.max(0, t + rng.jitter(amt)),
    vel: (v, amt = 0.1) => clamp(v * (1 + rng.jitter(amt)), 0.05, 1.3),
  };

  for (const b of bars) def.bar(api, b);

  for (const scene of scenes) {
    const s = Number(scene.start);
    if (!(s > 1) || s > endHit - 0.3) continue;
    const b = bars[Math.min(bars.length - 1, Math.floor((s - start) / barLen))];
    if (b) def.accent(api, s, b);
  }

  const f = {
    pcs: fpcs,
    root: froot,
    voicing: voiceChord(fpcs, lastVoicing, { low: 53, high: 76, voices: 4 }),
    upper: voiceChord(fpcs, lastUpper, { low: 58, high: 81, voices: 4 }),
    bass: bassMidi(froot),
  };
  def.ending(api, endHit, Math.max(0.4, duration - endHit), f);

  return { synth: syn, plan: { ...plan, beat, barLen, bars: nBars, endHit } };
}
