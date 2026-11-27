// Synthesized sound effects. Each effect adds voices to a stereo Synth lane;
// `p.amp` already includes the per-effect trim, the cue gain and sfxVolume.
import { Voice, Env, WAVES } from './synth.js';
import { mtof, dbToGain } from './dsp.js';
import { pentaNote } from './theory.js';
import { makeRng, hashSeed } from './rng.js';

const perc = (t, peak, attack, tau) => new Env(0).set(0, t).lin(peak, t + attack).target(0, t + attack, tau);
const seedOf = (rng) => Math.floor(rng.next() * 4294967295) || 1;

// Bell-like ping with a few inharmonic partials.
const PING = [[1, 1, 1], [2, 0.35, 0.55], [2.76, 0.2, 0.4], [5.4, 0.08, 0.2]];

function ping(syn, lane, t, midi, peak, decay, { partials = PING, pan = 0 } = {}) {
  const f = mtof(midi);
  const parts = partials.filter(([ratio]) => f * ratio < 16000);
  const v = new Voice(t, t + (decay / 4) * 7 + 0.02);
  for (const [ratio, amp, df] of parts) v.layer({ wave: WAVES.sine, freq: f * ratio, amp: perc(t, peak * amp, 0.0015, (decay * df) / 4) });
  v.pan = pan;
  syn.add(lane, v);
}

function noiseBurst(syn, lane, t, peak, tau, rng, { type = 'highpass', freq = 3000, q = 0.8, pink = false, attack = 0.0008, pan = 0 } = {}) {
  const v = new Voice(t, t + attack + tau * 7 + 0.01);
  v.layer({ wave: pink ? WAVES.pink : WAVES.noise, seed: seedOf(rng), amp: perc(t, peak, attack, tau) });
  v.filter = { type, freq, q };
  v.pan = pan;
  syn.add(lane, v);
}

function tone(syn, lane, t, wave, freq, peak, attack, tau, { freqEnv = null, pan = 0, length } = {}) {
  const v = new Voice(t, t + (length ?? attack + tau * 7 + 0.01));
  v.layer({ wave, freq, freqEnv, amp: perc(t, peak, attack, tau) });
  v.pan = pan;
  syn.add(lane, v);
}

// Felt-marker / chalk strokes: one filtered noise voice whose gain and centre
// frequency are automated stroke by stroke.
function strokes(syn, lane, t, p, { dur, band, q, pink, grain, squeak }) {
  const rng = p.rng;
  const amp = new Env(0).set(0, t);
  const freq = new Env(band[0]).set(band[0], t);
  const end = t + dur;
  const squeaks = [];
  let s = t;
  while (s < end - 0.04) {
    const len = Math.min(end - s, rng.range(0.09, 0.22));
    const peak = p.amp * rng.range(0.7, 1);
    const f0 = rng.range(band[0], band[1]);
    freq.set(f0, s).lin(f0 * rng.range(0.8, 1.25), s + len);
    amp.set(0, s).lin(peak, s + 0.018);
    if (grain) {
      for (let x = s + 0.03; x < s + len - 0.03; x += rng.range(0.012, 0.025)) amp.lin(peak * rng.range(0.35, 1), x);
    } else {
      amp.lin(peak * rng.range(0.75, 0.95), s + len - 0.022);
    }
    amp.lin(0, s + len);
    if (squeak && rng.chance(0.25)) squeaks.push([s + rng.range(0.02, Math.max(0.03, len - 0.08)), rng.range(2600, 3400)]);
    s += len + rng.range(0.02, 0.05);
  }
  const v = new Voice(t, end + 0.05);
  v.layer({ wave: pink ? WAVES.pink : WAVES.noise, seed: seedOf(rng), amp });
  v.filter = { type: 'bandpass', q, freqEnv: freq };
  v.pan = rng.range(-0.15, 0.15);
  syn.add(lane, v);
  for (const [at, f] of squeaks) {
    const sv = new Voice(at, at + 0.2);
    sv.layer({ wave: WAVES.sine, freqEnv: new Env(f).set(f, at).lin(f * rng.range(0.9, 1.1), at + 0.06), amp: perc(at, p.amp * 0.18, 0.01, 0.025) });
    syn.add(lane, sv);
  }
}

// Filtered-noise sweep panned across the stereo field.
function sweep(syn, lane, t, p, { dur, from, to, back, q, panFrom, panTo, peakAt = 0.55 }) {
  const v = new Voice(t, t + dur * 1.6 + 0.05);
  v.layer({
    wave: WAVES.pink,
    seed: seedOf(p.rng),
    amp: new Env(0).set(0.0001, t).exp(p.amp, t + dur * peakAt).target(0, t + dur * peakAt, dur * 0.18),
  });
  v.filter = { type: 'bandpass', q, freqEnv: new Env(from).set(from, t).exp(to, t + dur * 0.7).exp(back, t + dur) };
  v.panEnv = new Env(panFrom).set(panFrom, t).lin(panTo, t + dur);
  syn.add(lane, v);
}

// name -> { description, trimDb, dur (default), play(syn, lane, t, p) }
// trimDb calibrates each effect's peak at gain 1: short effects about -18 dBFS,
// textures (whoosh, scribble, chalk, type) a few dB lower, i.e. roughly
// 11 dB under Kokoro narration peaks.
export const SFX_DEFS = {
  pop: {
    description: 'Short round pop for things appearing (boxes, icons, labels).',
    trimDb: -20.1,
    play(syn, lane, t, p) {
      const f0 = p.rng.range(360, 420);
      tone(syn, lane, t, WAVES.sine, 0, p.amp, 0.002, 0.03, { freqEnv: new Env(f0).set(f0, t).exp(p.rng.range(780, 880), t + 0.045), length: 0.3 });
      noiseBurst(syn, lane, t, p.amp * 0.25, 0.004, p.rng, { freq: 2500 });
    },
  },
  click: {
    description: 'Tiny UI click (buttons, toggles, cursor clicks).',
    trimDb: -19.6,
    play(syn, lane, t, p) {
      noiseBurst(syn, lane, t, p.amp, 0.003, p.rng, { type: 'bandpass', freq: 3500, q: 1 });
      tone(syn, lane, t, WAVES.sine, 1800, p.amp * 0.5, 0.0005, 0.004);
    },
  },
  whoosh: {
    description: 'Airy whoosh for movement, arrows and slides (dur, default 0.45 s).',
    trimDb: -12.9,
    dur: 0.45,
    play(syn, lane, t, p) {
      sweep(syn, lane, t, p, { dur: p.dur, from: 350, to: 2600, back: 1300, q: 1.1, panFrom: -0.55, panTo: 0.55 });
    },
  },
  swipe: {
    description: 'Wider, deeper whoosh for scene transitions (dur, default 0.6 s).',
    trimDb: -16.1,
    dur: 0.6,
    play(syn, lane, t, p) {
      sweep(syn, lane, t, p, { dur: p.dur, from: 200, to: 4200, back: 1500, q: 0.8, panFrom: -0.8, panTo: 0.8 });
      const v = new Voice(t, t + p.dur * 1.6);
      v.layer({
        wave: WAVES.sine,
        freqEnv: new Env(90).set(90, t).exp(55, t + p.dur),
        amp: new Env(0).set(0.0001, t).exp(p.amp * 0.35, t + p.dur * 0.5).target(0, t + p.dur * 0.5, p.dur * 0.2),
      });
      syn.add(lane, v);
    },
  },
  tick: {
    description: 'Single crisp tick (count-ups, typing, clock hands).',
    trimDb: -21.1,
    play(syn, lane, t, p) {
      noiseBurst(syn, lane, t, p.amp * 0.7, 0.0018, p.rng, { freq: 3500 });
      tone(syn, lane, t, WAVES.sine, 2800 * p.rng.range(0.94, 1.06), p.amp * 0.5, 0.0005, 0.005);
    },
  },
  type: {
    description: 'Keyboard typing burst (dur, default 0.8 s).',
    trimDb: -20.5,
    dur: 0.8,
    play(syn, lane, t, p) {
      const rng = p.rng;
      let k = t;
      let n = 0;
      while (k < t + p.dur) {
        const space = n > 0 && n % 6 === 5;
        const v = p.amp * rng.range(0.6, 1);
        const pan = rng.range(-0.2, 0.2);
        noiseBurst(syn, lane, k, v, 0.006, rng, { type: 'bandpass', freq: space ? 1800 : rng.range(2300, 3900), q: 1.4, pan });
        tone(syn, lane, k, WAVES.sine, space ? 140 : rng.range(170, 215), v * 0.45, 0.001, 0.012, { pan });
        k += rng.range(0.045, 0.11);
        n++;
      }
    },
  },
  ding: {
    description: 'Clear bell ding on the tonic (a highlight or a correct answer).',
    trimDb: -21,
    play(syn, lane, t, p) {
      ping(syn, lane, t, p.tonic + 24, p.amp, 1.4);
    },
  },
  chime: {
    description: 'Two-note rising chime (success, done, reveal).',
    trimDb: -24.4,
    play(syn, lane, t, p) {
      ping(syn, lane, t, p.tonic + 19, p.amp * 0.85, 1.2, { pan: -0.15 });
      ping(syn, lane, t + 0.11, p.tonic + 24, p.amp, 1.6, { pan: 0.15 });
    },
  },
  thud: {
    description: 'Soft low thud (something lands, a heavy point).',
    trimDb: -17,
    play(syn, lane, t, p) {
      tone(syn, lane, t, WAVES.sine, 0, p.amp, 0.002, 0.09, { freqEnv: new Env(110).set(110, t).exp(42, t + 0.18), length: 0.7 });
      noiseBurst(syn, lane, t, p.amp * 0.3, 0.03, p.rng, { type: 'lowpass', freq: 400 });
    },
  },
  impact: {
    description: 'Deep cinematic hit for a reveal on the beat, like a logo landing (pairs with rise).',
    trimDb: -18.7,
    play(syn, lane, t, p) {
      // A sub boom that drops in pitch, a dull body and a short crack on top.
      tone(syn, lane, t, WAVES.sine, 0, p.amp, 0.003, 0.32, { freqEnv: new Env(78).set(78, t).exp(34, t + 0.6), length: 1.4 });
      noiseBurst(syn, lane, t, p.amp * 0.5, 0.12, p.rng, { type: 'lowpass', freq: 260 });
      noiseBurst(syn, lane, t, p.amp * 0.22, 0.012, p.rng, { type: 'highpass', freq: 3000 });
    },
  },
  scribble: {
    description: 'Felt marker on paper while something is drawn (dur, default 0.6 s).',
    trimDb: -15.9,
    dur: 0.6,
    play(syn, lane, t, p) {
      strokes(syn, lane, t, p, { dur: p.dur, band: [1500, 2700], q: 1.3, pink: true, grain: false, squeak: false });
    },
  },
  chalk: {
    description: 'Chalk on a blackboard while something is drawn (dur, default 0.6 s).',
    trimDb: -22.3,
    dur: 0.6,
    play(syn, lane, t, p) {
      strokes(syn, lane, t, p, { dur: p.dur, band: [2800, 4800], q: 0.9, pink: false, grain: true, squeak: true });
    },
  },
  rise: {
    description: 'Riser that builds from t and ends at t + dur (default 1 s) for a big reveal.',
    trimDb: -18.3,
    dur: 1,
    play(syn, lane, t, p) {
      const end = t + p.dur;
      const nv = new Voice(t, end + 0.05);
      nv.layer({ wave: WAVES.pink, seed: seedOf(p.rng), amp: new Env(0).set(0.0001, t).exp(p.amp, end).lin(0, end + 0.03) });
      nv.filter = { type: 'bandpass', q: 1.6, freqEnv: new Env(300).set(300, t).exp(7000, end) };
      syn.add(lane, nv);
      const sv = new Voice(t, end + 0.05);
      for (const d of [-9, 9]) {
        sv.layer({
          wave: WAVES.saw,
          detune: d,
          freqEnv: new Env(mtof(p.tonic - 12)).set(mtof(p.tonic - 12), t).exp(mtof(p.tonic + 12), end),
          amp: new Env(0).set(0.0001, t).exp(p.amp * 0.3, end).lin(0, end + 0.03),
        });
      }
      sv.filter = { type: 'lowpass', q: 1.4, freqEnv: new Env(400).set(400, t).exp(6000, end) };
      syn.add(lane, sv);
    },
  },
  sparkle: {
    description: 'Cluster of high bell pings (magic, delight, something new).',
    trimDb: -26.3,
    play(syn, lane, t, p) {
      const rng = p.rng;
      let at = t;
      for (let k = 0; k < 6; k++) {
        ping(syn, lane, at, pentaNote(p.tonic + 24, rng.int(0, 6)), p.amp * Math.pow(0.85, k), rng.range(0.5, 0.8), {
          partials: [[1, 1, 1], [2.76, 0.2, 0.4], [5.4, 0.1, 0.2]],
          pan: rng.range(-0.7, 0.7),
        });
        at += rng.range(0.035, 0.07);
      }
    },
  },
  blip: {
    description: "Short pitched blip; pitch = step in the key's pentatonic scale, so list items can ascend.",
    trimDb: -19.4,
    play(syn, lane, t, p) {
      const f = mtof(pentaNote(p.tonic + 12, Math.round(p.pitch || 0)));
      const v = new Voice(t, t + 0.4);
      v.layer({ wave: WAVES.tri, freqEnv: new Env(f * 0.94).set(f * 0.94, t).exp(f, t + 0.015), amp: perc(t, p.amp, 0.002, 0.05) });
      v.layer({ wave: WAVES.sine, freq: f * 2, amp: perc(t, p.amp * 0.25, 0.002, 0.025) });
      syn.add(lane, v);
    },
  },
  error: {
    description: 'Soft low double buzz (wrong, blocked, failure).',
    trimDb: -23.9,
    play(syn, lane, t, p) {
      const v = new Voice(t, t + 0.35);
      for (const f of [110, 116.5]) {
        const amp = new Env(0).set(0, t);
        for (const s of [t, t + 0.17]) amp.set(0, s).lin(p.amp, s + 0.01).set(p.amp, s + 0.1).lin(0, s + 0.12);
        v.layer({ wave: WAVES.saw, freq: f, amp });
      }
      v.filter = { type: 'lowpass', freq: 700, q: 0.8 };
      syn.add(lane, v);
    },
  },
};

export const SFX_INFO = Object.fromEntries(Object.entries(SFX_DEFS).map(([k, d]) => [k, d.description]));

export function validateSfx(cues) {
  for (const cue of cues) {
    if (!cue || !SFX_DEFS[cue.name]) {
      throw new Error(`Unknown sound effect "${cue && cue.name}". Valid names: ${Object.keys(SFX_DEFS).join(', ')}`);
    }
    if (!Number.isFinite(Number(cue.t))) throw new Error(`Sound effect "${cue.name}" needs a numeric time t`);
  }
}

// Adds every cue to `lane` (a stereo lane). `tonic` is a MIDI note in the key.
export function scheduleSfx(syn, lane, cues, { tonic = 60, volume = 1, duration = Infinity } = {}) {
  cues.forEach((cue, index) => {
    const def = SFX_DEFS[cue.name];
    const t = Math.max(0, Number(cue.t));
    if (t >= duration) return;
    const gain = cue.gain == null ? 1 : Math.max(0, Number(cue.gain));
    const amp = dbToGain(def.trimDb) * gain * volume;
    if (amp <= 0) return;
    const dur = Math.max(0.05, Number(cue.dur) || def.dur || 0.5);
    const rng = makeRng(hashSeed('sfx', cue.name, t.toFixed(4), index));
    def.play(syn, lane, t, { amp, dur, pitch: cue.pitch, rng, tonic });
  });
}
