// Local speech models: Kokoro for the voice, Whisper for word timing and checks.
// Both run on the CPU through ONNX Runtime and are downloaded from Hugging Face
// on first use into ~/.cache/explainroo/models (or $EXPLAINROO_CACHE/models).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const ASR_MODEL = 'onnx-community/whisper-base.en_timestamped';
export const MULTILINGUAL_ASR_MODEL = 'onnx-community/whisper-small_timestamped';
export const TTS_SAMPLE_RATE = 24000;

export const LANGUAGES = {
  en: 'af_heart', es: 'ef_dora', fr: 'ff_siwis', it: 'if_sara', 'pt-br': 'pf_dora', hi: 'hf_alpha', ja: 'jf_alpha', zh: 'zf_xiaobei',
};

// The languages by name, for messages.
export const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', 'pt-br': 'Brazilian Portuguese', hi: 'Hindi', ja: 'Japanese', zh: 'Chinese',
};

export function voiceLanguage(id) {
  return { a: 'en', b: 'en', e: 'es', f: 'fr', i: 'it', p: 'pt-br', h: 'hi', j: 'ja', z: 'zh' }[id[0]];
}

export function asrModel(language = 'en') {
  return language === 'en' ? ASR_MODEL : MULTILINGUAL_ASR_MODEL;
}

export function cacheRoot() {
  return process.env.EXPLAINROO_CACHE || path.join(os.homedir(), '.cache', 'explainroo');
}

// The settings folder holds what must outlast the package folder, which npx
// can throw away at any time.
export function configRoot(platform = process.platform) {
  if (process.env.EXPLAINROO_CONFIG) return process.env.EXPLAINROO_CONFIG;
  if (platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'explainroo');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'explainroo');
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

// What doctor and the download lines call each model.
export const MODEL_NAMES = { [TTS_MODEL]: 'voice model', [ASR_MODEL]: 'speech check model', [MULTILINGUAL_ASR_MODEL]: 'language model' };

// What each model downloads at the dtype explainroo loads it with, in bytes: its
// weights and the small files beside them. The Whisper models and Kokoro at fp32
// and q8 are measured. The other Kokoro weights are the sizes on the model's page.
export const DOWNLOAD_BYTES = {
  [TTS_MODEL]: { fp32: 325535886, fp16: 163e6, q8: 92364770, q4: 305e6, q4f16: 155e6 },
  [ASR_MODEL]: { q8: 79563802 },
  [MULTILINGUAL_ASR_MODEL]: { q8: 251805856 },
};
const ASR_DTYPE = 'q8';

function megabytes(bytes) {
  return `${Math.round(bytes / 1e6)} MB`;
}

// The size of a model's download, like "252 MB".
export function downloadSize(model) {
  return megabytes(DOWNLOAD_BYTES[model][model === TTS_MODEL ? ttsDtype() : ASR_DTYPE]);
}

// One line for each model download, fed with the progress events of transformers.js.
// The total comes from DOWNLOAD_BYTES, so it is known before the first byte and
// never changes. transformers.js also reports the files it reads from the cache,
// so only a file that wasn't there counts. A file sent without a size reports a
// total that grows with every chunk, so only the bytes loaded count. On a terminal,
// log.update changes the line in place. Elsewhere a download prints one line when
// it starts and one when it is done.
export function downloadProgress(model, dtype, log, { cached = (name, file) => fs.existsSync(path.join(cacheRoot(), 'models', name, file)), now = Date.now } = {}) {
  const label = `the ${MODEL_NAMES[model]}`;
  const total = DOWNLOAD_BYTES[model]?.[dtype] ?? null;
  const fresh = new Set();
  const loaded = new Map();
  let started = null;
  let shown = 0;
  const sum = () => [...loaded.values()].reduce((a, b) => a + b, 0);
  const line = () => `downloading ${label}: ${total ? `${Math.round(Math.min(sum(), total) / 1e6)} / ${megabytes(total)}` : megabytes(sum())}`;
  return {
    callback(p) {
      if (p.status === 'initiate' && !cached(p.name, p.file)) fresh.add(p.file);
      if (!fresh.has(p.file) || !['download', 'progress'].includes(p.status)) return;
      if (p.status === 'progress') loaded.set(p.file, p.loaded);
      if (started === null) {
        started = now();
        shown = started;
        if (log.update) log.update(line());
        else log(`downloading ${label}${total ? `, ${megabytes(total)}` : ''}`);
      } else if (log.update && now() - shown >= 250) {
        shown = now();
        log.update(line());
      }
    },
    finish(done) {
      if (started === null) return;
      log(done ? `downloaded ${label}: ${megabytes(sum())} in ${Math.round((now() - started) / 1000)}s` : `the download of ${label} stopped after ${megabytes(sum())}`);
    },
  };
}

// transformers.js warns about every file that comes without a size. The download
// line counts those files anyway, so while a model loads, that one warning is
// left out and every other warning comes through.
const NO_SIZE = 'Unable to determine content-length';
export function withoutSizeWarning(warn) {
  return (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith(NO_SIZE)) return;
    warn.apply(console, args);
  };
}

let loading = 0;
let warn = null;
async function loadModel(model, dtype, log, load) {
  const progress = log ? downloadProgress(model, dtype, log) : null;
  if (loading++ === 0) {
    warn = console.warn;
    console.warn = withoutSizeWarning(warn);
  }
  try {
    const loaded = await load(progress?.callback);
    progress?.finish(true);
    return loaded;
  } catch (e) {
    progress?.finish(false);
    throw e;
  } finally {
    if (--loading === 0) console.warn = warn;
  }
}

let ttsPromise = null;
export function loadTTS({ log } = {}) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      await lib();
      const { KokoroTTS } = await import('kokoro-js');
      const dtype = ttsDtype();
      return loadModel(TTS_MODEL, dtype, log, (progress_callback) => KokoroTTS.from_pretrained(TTS_MODEL, { dtype, device: 'cpu', progress_callback }));
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
      return loadModel(model, ASR_DTYPE, log, (progress_callback) => pipeline('automatic-speech-recognition', model, { dtype: ASR_DTYPE, progress_callback }));
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
  jf_alpha: 'Japanese, female (default)',
  jf_gongitsune: 'Japanese, female',
  jf_nezumi: 'Japanese, female',
  jf_tebukuro: 'Japanese, female',
  jm_kumo: 'Japanese, male',
  zf_xiaobei: 'Mandarin Chinese, female (default)',
  zf_xiaoni: 'Mandarin Chinese, female',
  zf_xiaoxiao: 'Mandarin Chinese, female',
  zf_xiaoyi: 'Mandarin Chinese, female',
  zm_yunjian: 'Mandarin Chinese, male',
  zm_yunxi: 'Mandarin Chinese, male',
  zm_yunxia: 'Mandarin Chinese, male',
  zm_yunyang: 'Mandarin Chinese, male',
};
