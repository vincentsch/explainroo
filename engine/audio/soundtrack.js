// Soundtrack renderer: narration, generated music and synthesized sound
// effects mixed into one stereo AudioBuffer. Synthesis is plain JavaScript
// (see synth.js), so the same input always gives the same samples, in a page
// (headless Chrome for final renders, the preview page for playback) or in Node.
import { dbToGain, limitInPlace, fadeEdges } from './dsp.js';
import { BLOCK, Synth, Env, Compressor } from './synth.js';
import { createMusic, musicPlan, STYLE_INFO } from './music.js';
import { scheduleSfx, validateSfx, SFX_INFO } from './sfx.js';
import { parseWav, toMono, resample } from './pcm.js';
import { encodeWav } from './wav.js';

export { encodeWav, musicPlan };

export const MUSIC_STYLES = Object.fromEntries(Object.entries(STYLE_INFO).map(([k, v]) => [k, v.description]));
export const SFX = { ...SFX_INFO };

// Mix calibration (measured against Kokoro narration, which lands near
// -20 LUFS as stereo): at volume 0.5 the music bed sits about 12 LU under the
// voice and ducks a further 8 dB while someone talks; short effects peak about
// 11 dB under voice peaks.
const MUSIC_BASE_DB = 0;
const DUCK_DB = -8;
const DUCK_ATTACK = 0.2;
const DUCK_RELEASE = 0.5;
const SFX_BASE_DB = 0;

async function loadVoice(v, sr, cache) {
  if (v.buffer) {
    const b = v.buffer;
    const chans = [];
    for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
    return resample(toMono(chans), b.sampleRate, sr);
  }
  if (v.data) return resample(v.data, v.sampleRate || sr, sr);
  if (!v.url) throw new Error('voice entries need url, buffer or data');
  if (!cache.has(v.url)) {
    cache.set(
      v.url,
      (async () => {
        const res = await fetch(v.url);
        if (!res.ok) throw new Error(`Could not load voice audio ${v.url} (HTTP ${res.status})`);
        const ab = await res.arrayBuffer();
        try {
          const wav = parseWav(ab);
          return resample(toMono(wav.channels), wav.sampleRate, sr);
        } catch (err) {
          if (typeof OfflineAudioContext === 'undefined') throw err;
          const decoded = await new OfflineAudioContext(1, 1, sr).decodeAudioData(ab);
          return decoded.getChannelData(0);
        }
      })(),
    );
  }
  return cache.get(v.url);
}

// Merge narration spans that are too close to release the music in between.
function mergeSpans(spans) {
  const gap = DUCK_ATTACK + DUCK_RELEASE + 0.1;
  const sorted = spans
    .map((s) => ({ start: Number(s.start), end: Number(s.end) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < gap) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

function duckEnv(spans) {
  const low = dbToGain(DUCK_DB);
  const e = new Env(1).set(1, 0);
  for (const s of mergeSpans(spans)) {
    const a0 = Math.max(0, s.start - DUCK_ATTACK);
    e.set(1, a0).lin(low, Math.max(a0 + 0.001, s.start)).set(low, s.end).lin(1, s.end + DUCK_RELEASE);
  }
  return e;
}

function levelEnv(level, duration) {
  const fadeIn = Math.min(1.5, duration * 0.25);
  const fadeOut = Math.min(0.35, duration * 0.1);
  return new Env(0).set(0, 0).lin(level, fadeIn).set(level, Math.max(fadeIn, duration - fadeOut)).lin(0, duration);
}

function toAudioBuffer(L, R, sampleRate) {
  if (typeof AudioBuffer !== 'undefined') {
    const buf = new AudioBuffer({ length: L.length, numberOfChannels: 2, sampleRate });
    buf.copyToChannel(L, 0);
    buf.copyToChannel(R, 1);
    return buf;
  }
  const chans = [L, R];
  return { sampleRate, length: L.length, numberOfChannels: 2, duration: L.length / sampleRate, getChannelData: (c) => chans[c] };
}

// Renders one synth into (L, R), optionally through a compressor and gain curves.
function renderInto(syn, L, R, { compressor = null, gains = [] } = {}) {
  const n = L.length;
  const bl = new Float32Array(BLOCK);
  const br = new Float32Array(BLOCK);
  const g = gains.map(() => new Float32Array(BLOCK));
  gains.forEach((e) => e.begin(syn.sr, 0));
  for (let i0 = 0; i0 < n; i0 += BLOCK) {
    const cnt = Math.min(BLOCK, n - i0);
    bl.fill(0);
    br.fill(0);
    syn.renderBlock(i0, cnt, bl, br);
    if (compressor) compressor.process(bl, br, cnt);
    gains.forEach((e, j) => e.fill(g[j], cnt));
    for (let k = 0; k < cnt; k++) {
      let m = 1;
      for (let j = 0; j < g.length; j++) m *= g[j][k];
      L[i0 + k] += bl[k] * m;
      R[i0 + k] += br[k] * m;
    }
  }
}

export async function renderSoundtrack(opts = {}) {
  const {
    duration,
    sampleRate = 48000,
    voice = [],
    voiceSpans = [],
    clips = [],
    music = null,
    sfx = [],
    scenes = [],
    sfxVolume = 1,
  } = opts;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('renderSoundtrack: duration must be a positive number of seconds');
  }
  validateSfx(sfx);
  const plan = music ? musicPlan(music) : null; // throws early on a bad style or key

  const sr = sampleRate;
  const length = Math.max(1, Math.ceil(duration * sr));
  const L = new Float32Array(length);
  const R = new Float32Array(length);

  // narration: straight into the mix, unprocessed
  const cache = new Map();
  for (const v of voice) {
    const data = await loadVoice(v, sr, cache);
    const gain = v.gain == null ? 1 : Number(v.gain);
    const at = Math.round((Number(v.start) || 0) * sr);
    const from = Math.max(0, -at);
    const to = Math.min(data.length, length - at);
    for (let i = from; i < to; i++) {
      const s = data[i] * gain;
      L[at + i] += s;
      R[at + i] += s;
    }
  }

  const clipSpans = [];
  for (const clip of clips) {
    if (clip.speed !== 1 || clip.volume <= 0) continue;
    const data = await loadVoice(clip, sr, cache);
    const clipLength = Math.max(1, Math.round(clip.duration * sr));
    const start = Math.round(clip.start * sr);
    const end = Math.min(length, Math.round(clip.end * sr));
    const offset = Math.round(clip.from * sr);
    for (let i = Math.max(0, start); i < end; i++) {
      let source = offset + i - start;
      if (clip.loop) source %= clipLength;
      if (source >= clipLength) break;
      const sample = (data[source] || 0) * clip.volume;
      L[i] += sample;
      R[i] += sample;
    }
    if (end > Math.max(0, start)) clipSpans.push({ start: Math.max(0, clip.start), end: end / sr });
  }

  // music: glue compressor, level with fades, ducked under narration
  if (plan) {
    const { synth } = createMusic({ ...music, style: plan.style, seed: plan.seed, bpm: plan.bpm, key: plan.keyRoot, duration, scenes, sampleRate: sr });
    const volume = Math.max(0, Math.min(2, music.volume == null ? 0.5 : Number(music.volume)));
    renderInto(synth, L, R, {
      compressor: new Compressor(sr, { threshold: -18, ratio: 2, knee: 10, attack: 0.02, release: 0.3 }),
      gains: [levelEnv(dbToGain(MUSIC_BASE_DB + plan.mixDb) * (volume / 0.5), duration), duckEnv([...voiceSpans, ...clipSpans])],
    });
  }

  // sound effects with a little room, pitched ones in the music key
  if (sfx.length) {
    const syn = new Synth(sr, length, { reverb: { room: 0.45, damp: 0.5, preDelay: 0.006, lowCut: 300 }, reverbLevel: 0.25 });
    const lane = syn.lane({ stereo: true, reverb: 1 });
    scheduleSfx(syn, lane, sfx, { tonic: 60 + (plan ? plan.keyRoot : 0), duration, volume: dbToGain(SFX_BASE_DB) * Math.max(0, Number(sfxVolume)) });
    renderInto(syn, L, R);
  }

  limitInPlace([L, R], sr, { ceilingDb: -1 });
  fadeEdges([L, R], sr);
  return toAudioBuffer(L, R, sr);
}
