// Local speech models: Kokoro for the voice, Whisper for word timing and checks.
// Both run on the CPU through ONNX Runtime and are downloaded from Hugging Face
// on first use into ~/.cache/explainroo/models (or $EXPLAINROO_CACHE/models).
import os from 'node:os';
import path from 'node:path';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const ASR_MODEL = 'onnx-community/whisper-base.en_timestamped';
export const MULTILINGUAL_ASR_MODEL = 'onnx-community/whisper-small_timestamped';
export const TTS_SAMPLE_RATE = 24000;

export const LANGUAGES = {
  en: 'af_heart', es: 'ef_dora', fr: 'ff_siwis', it: 'if_sara', 'pt-br': 'pf_dora', hi: 'hf_alpha',
};

export function voiceLanguage(id) {
  return { a: 'en', b: 'en', e: 'es', f: 'fr', i: 'it', p: 'pt-br', h: 'hi' }[id[0]];
}

export function asrModel(language = 'en') {
  return language === 'en' ? ASR_MODEL : MULTILINGUAL_ASR_MODEL;
}

export function cacheRoot() {
  return process.env.EXPLAINROO_CACHE || path.join(os.homedir(), '.cache', 'explainroo');
}

export function ttsDtype() {
  const d = process.env.EXPLAINROO_TTS_DTYPE || 'fp32';
  if (!['fp32', 'fp16', 'q8', 'q4', 'q4f16'].includes(d)) throw new Error(`EXPLAINROO_TTS_DTYPE must be fp32, fp16, q8, q4 or q4f16, not "${d}"`);
  return d;
}

let transformers = null;
async function lib() {
  if (!transformers) {
    transformers = await import('@huggingface/transformers');
    transformers.env.cacheDir = path.join(cacheRoot(), 'models');
    transformers.env.allowRemoteModels = process.env.EXPLAINROO_OFFLINE !== '1';
  }
  return transformers;
}

function progressLogger(label, log) {
  if (!log) return undefined;
  const files = new Map();
  let last = 0;
  return (p) => {
    if (p.status === 'progress' && p.total > 5e6 && p.loaded < p.total) {
      files.set(p.file, { loaded: p.loaded, total: p.total });
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      log(`downloading ${label}: ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
    }
  };
}

let ttsPromise = null;
export function loadTTS({ log } = {}) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      await lib();
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(TTS_MODEL, {
        dtype: ttsDtype(),
        device: 'cpu',
        progress_callback: progressLogger('voice model', log),
      });
    })();
  }
  return ttsPromise;
}

const asrPromises = new Map();
export function loadASR({ log, language = 'en' } = {}) {
  const model = asrModel(language);
  if (!asrPromises.has(model)) {
    asrPromises.set(model, (async () => {
      const { pipeline } = await lib();
      return pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: progressLogger('speech check model', log),
      });
    })());
  }
  return asrPromises.get(model);
}

// samples: Float32Array at 16 kHz. Returns [{ text, start, end }].
export async function transcribeWords(samples, { log, language = 'en' } = {}) {
  const asr = await loadASR({ log, language });
  const r = await asr(samples, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5,
    ...(language === 'en' ? {} : { language: language === 'pt-br' ? 'pt' : language, task: 'transcribe' }),
  });
  return {
    text: (r.text || '').trim(),
    words: (r.chunks || []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0 })),
  };
}

// Kokoro v1.0 voices for the supported languages.
export const VOICES = {
  af_heart: 'American English, female (default)',
  af_bella: 'American English, female',
  af_nicole: 'American English, female',
  af_aoede: 'American English, female',
  af_kore: 'American English, female',
  af_sarah: 'American English, female',
  af_nova: 'American English, female',
  af_sky: 'American English, female',
  af_alloy: 'American English, female',
  af_jessica: 'American English, female',
  af_river: 'American English, female',
  am_michael: 'American English, male',
  am_fenrir: 'American English, male',
  am_puck: 'American English, male',
  am_echo: 'American English, male',
  am_eric: 'American English, male',
  am_liam: 'American English, male',
  am_onyx: 'American English, male',
  am_adam: 'American English, male',
  am_santa: 'American English, male',
  bf_emma: 'British English, female',
  bf_isabella: 'British English, female',
  bf_alice: 'British English, female',
  bf_lily: 'British English, female',
  bm_george: 'British English, male',
  bm_fable: 'British English, male',
  bm_lewis: 'British English, male',
  bm_daniel: 'British English, male',
  ef_dora: 'Spanish, female (default)',
  em_alex: 'Spanish, male',
  em_santa: 'Spanish, male',
  ff_siwis: 'French, female (default)',
  if_sara: 'Italian, female (default)',
  im_nicola: 'Italian, male',
  pf_dora: 'Brazilian Portuguese, female (default)',
  pm_alex: 'Brazilian Portuguese, male',
  pm_santa: 'Brazilian Portuguese, male',
  hf_alpha: 'Hindi, female (default)',
  hf_beta: 'Hindi, female',
  hm_omega: 'Hindi, male',
  hm_psi: 'Hindi, male',
};
