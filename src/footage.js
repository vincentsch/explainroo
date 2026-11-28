// Footage projects: the user's own recording is the narration and the picture.
// Each scene of script.md is a span of it, `## s03 {from=12.4 to=25.8}`, and
// its picture and its sound come from that same span, so lip sync holds. The
// recording goes into the project once, as a working copy with a constant frame
// rate, colours the browser shows right and sound at 48 kHz. Its words come from
// the speech model, heard in pieces split at pauses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProjectError } from './errors.js';
import { ffmpeg, ffmpegPath, probe, normalizeLoudness } from './ffmpeg.js';
import { readWav } from './wav.js';
import { cacheRoot, transcribeWords, speechOnly } from './models.js';
import { quietStretches } from './cut.js';
import { THEMES, DEFAULTS_VERSIONS, resolveSize, normalizeConfig, checkLanguage } from './project.js';

// The files a recording can come in. OBS records .mkv.
export const FOOTAGE_FILE = /\.(mp4|mov|webm|m4v|mkv)$/i;
// The frame rates a footage project takes. Each divides 48,000, so a frame is a
// whole number of sound samples and every cut lands on a sample.
const RATES = [24, 25, 30, 50, 60];
export const FOOTAGE_RATE = 48000;
// The level the speech is brought to, the level of Kokoro's voice.
const SPEECH_LUFS = -22.3;
// The longest piece the speech model hears at once. One call on a long file
// can drop a whole 30 second chunk.
const PIECE_SECONDS = 25;

const rate = (r) => {
  const [n, d] = String(r ?? '').split('/').map(Number);
  return d ? n / d : n;
};

// What a recording is: its length, frame rate, size, whether it is HDR, and
// whether it has sound.
export async function footageInfo(file) {
  if (!fs.existsSync(file)) throw new ProjectError(`${file} does not exist`);
  if (!FOOTAGE_FILE.test(file)) throw new ProjectError(`${path.basename(file)} is not a video explainroo takes. Use an MP4, MOV, WebM, M4V or MKV file.`);
  const info = await probe(file).catch(() => {
    throw new ProjectError(`${file} is not a video that ffmpeg can read`);
  });
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new ProjectError(`${path.basename(file)} has no picture.`);
  if (!a) throw new ProjectError(`${path.basename(file)} has no sound. A footage project uses the speech in the recording as its narration.`);
  const source = [v.avg_frame_rate, v.r_frame_rate].map(rate).find((r) => r > 0 && r <= 240) ?? 30;
  const rotation = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  const [width, height] = rotation ? [v.height, v.width] : [v.width, v.height];
  return {
    duration: Number(info.format.duration) || Number(v.duration) || 0,
    sourceFps: Math.round(source * 1000) / 1000,
    fps: projectRate(source),
    width,
    height,
    hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
    codec: v.codec_name,
  };
}

// The frame rate of the project for a recording: the nearest one it takes,
// and 30 for a recording slower than 24 frames a second, like a screen recording.
export function projectRate(source) {
  if (!(source >= 23)) return 30;
  return RATES.reduce((best, r) => (Math.abs(r - source) < Math.abs(best - source) ? r : best), RATES[0]);
}

let zscaleSeen;
function hasZscale() {
  zscaleSeen ??= /\bzscale\b/.test(spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout ?? '');
  return zscaleSeen;
}

// The working copy, a MOV: SDR, a constant frame rate, at most 1920 on its long
// side, a keyframe every second so a piece of it can be read quickly, and 48 kHz
// stereo sound as PCM. No B-frames and no AAC, because both delay their stream
// in the file, and then frame n of the picture is no longer at n / fps next to
// the sound. Returns a note when an HDR recording couldn't be tone mapped.
export async function makeWorkingCopy(src, dest, info, { log = () => {} } = {}) {
  const filters = [];
  let note = null;
  if (info.hdr && hasZscale()) filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  else if (info.hdr) note = 'the recording is HDR, and this ffmpeg has no zscale to bring it to normal brightness, so its colours may look flat';
  filters.push(`fps=${info.fps}`, "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'", 'setsar=1', 'format=yuv420p');
  log(`making a working copy of ${path.basename(src)} at ${info.fps} frames a second`);
  const temp = `${dest}.partial${path.extname(dest)}`;
  await ffmpeg(['-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0', '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-bf', '0', '-g', String(info.fps), '-keyint_min', String(info.fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'pcm_s16le', '-ar', String(FOOTAGE_RATE), '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
    '-avoid_negative_ts', 'make_zero', temp]);
  fs.renameSync(temp, dest);
  return note;
}

export function fileHash(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// Where a piece of `samples` should end: in the middle of the last quiet stretch
// before `limit` seconds, or at the limit when there is none.
export function pieceEnds(quiet, duration, limit = PIECE_SECONDS) {
  const ends = [];
  let start = 0;
  while (duration - start > limit) {
    const inside = quiet.filter(([a, b]) => a > start + 3 && (a + b) / 2 < start + limit);
    const end = inside.length ? (inside.at(-1)[0] + inside.at(-1)[1]) / 2 : start + limit;
    ends.push(end);
    start = end;
  }
  ends.push(duration);
  return ends;
}

// The words of the working copy, heard in pieces split at pauses, kept by its
// hash and language, with its quiet stretches. Stretches of sound of 2 seconds
// or more without words are listed, as speech the model may have missed.
export async function footageWords(file, sha256, language, { log = () => {}, transcribe = transcribeWords } = {}) {
  const saved = path.join(cacheRoot(), 'footage', `${sha256}-${language}.json`);
  if (fs.existsSync(saved)) return JSON.parse(fs.readFileSync(saved, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-'));
  try {
    const wav = path.join(dir, 'speech-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const { samples } = readWav(wav);
    const duration = samples.length / 16000;
    const quiet = quietStretches(samples, 16000);
    const ends = pieceEnds(quiet, duration);
    const words = [];
    let start = 0;
    for (const [i, end] of ends.entries()) {
      log(`listening to the recording, part ${i + 1} of ${ends.length}`);
      const heard = await transcribe(samples.subarray(Math.floor(start * 16000), Math.floor(end * 16000)), { log, language });
      for (const w of speechOnly(heard.words)) {
        words.push({ text: w.text.replace(/\s+/g, ' '), start: round(start + w.start), end: round(start + Math.max(w.start, w.end)) });
      }
      start = end;
    }
    const result = { language, duration: round(duration), words, quiet, unheard: unheardStretches(words, quiet, duration) };
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.writeFileSync(saved, JSON.stringify(result));
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Stretches of 2 seconds or more that are neither quiet nor covered by a word.
export function unheardStretches(words, quiet, duration) {
  const busy = [...words.map((w) => [w.start, w.end]), ...quiet].sort((a, b) => a[0] - b[0]);
  const out = [];
  let t = 0;
  for (const [a, b] of busy) {
    if (a - t >= 2) out.push([round(t), round(a)]);
    t = Math.max(t, b);
  }
  if (duration - t >= 2) out.push([round(t), round(duration)]);
  return out;
}

// The sound of the working copy as one track at 48 kHz, brought to the level of
// the narration once, for the whole take, with a high-pass for rumble. Scenes
// are slices of it, so the level never steps between them.
export async function footageSpeech(file, out) {
  if (fs.existsSync(out)) return readWav(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const raw = `${out}.raw.wav`;
  try {
    await ffmpeg(['-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', String(FOOTAGE_RATE), '-af', 'aresample=async=1:first_pts=0,highpass=f=70', '-c:a', 'pcm_s16le', raw]);
    await normalizeLoudness(raw, `${out}.partial.wav`, SPEECH_LUFS, FOOTAGE_RATE);
    fs.renameSync(`${out}.partial.wav`, out);
  } finally {
    fs.rmSync(raw, { force: true });
  }
  return readWav(out);
}

const SENTENCE_END = /[.!?…]["'’”)\]]*$/u;

// script.md for a recording: scenes of whole sentences, 5 to 15 seconds each,
// split at long pauses, whose spans follow each other on the frame grid from
// just before the first word to just after the last. A pause of 1.5 seconds
// or more inside a scene gets a note, so the agent can cut it.
export function footageScript(words, duration, fps, title) {
  const snap = (t) => Math.round(t * fps) / fps;
  const scenes = [];
  let current = [];
  const close = () => {
    if (current.length) scenes.push(current);
    current = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    current.push(w);
    const length = w.end - current[0].start;
    const pause = next ? next.start - w.end : Infinity;
    const sentence = SENTENCE_END.test(w.text);
    if ((sentence && length >= 5) || pause >= 1.2 || (length >= 15 && (sentence || pause >= 0.3)) || length >= 25) close();
  }
  close();
  // A scene of a few seconds, like a short sentence cut off by a pause, joins
  // the scene before it, or the one after, when no long pause stands between.
  for (let i = 0; i < scenes.length; i++) {
    const g = scenes[i];
    if (scenes.length < 2 || g.at(-1).end - g[0].start >= 4) continue;
    const before = scenes[i - 1];
    const after = scenes[i + 1];
    if (before && g[0].start - before.at(-1).end < 1.2 && g.at(-1).end - before[0].start <= 16) {
      before.push(...scenes.splice(i--, 1)[0]);
    } else if (after && after[0].start - g.at(-1).end < 1.2 && after.at(-1).end - g[0].start <= 16) {
      after.unshift(...scenes.splice(i--, 1)[0]);
    }
  }
  if (!scenes.length) throw new ProjectError('the speech model heard no words in the recording, so there is nothing to make scenes from. Check that it has speech, and its language with --language.');
  const head = Math.max(0, words[0].start - 0.25);
  const tail = Math.min(duration, words.at(-1).end + 0.6);
  const lines = [`# ${title}`, '', '> Each scene is a span of the recording: {from to} are its seconds. Delete a', '> scene to cut it, change from and to, or move it. Fix a misheard word in its', '> text, so the captions say it right; the timing stays the recording\'s.', ''];
  scenes.forEach((group, i) => {
    const from = i === 0 ? snap(head) : snap((scenes[i - 1].at(-1).end + group[0].start) / 2);
    const to = i === scenes.length - 1 ? snap(tail) : snap((group.at(-1).end + scenes[i + 1][0].start) / 2);
    lines.push(`## s${String(i + 1).padStart(2, '0')} {from=${from.toFixed(3)} to=${to.toFixed(3)}}`);
    let text = [];
    group.forEach((w, k) => {
      const gap = k ? w.start - group[k - 1].end : 0;
      if (gap >= 1.5) {
        lines.push(text.join(' '), `> pause of ${gap.toFixed(1)} s from ${group[k - 1].end.toFixed(2)} s`);
        text = [];
      }
      text.push(w.text);
    });
    lines.push(text.join(' '), '');
  });
  return lines.join('\n');
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

// The frames of a footage project's recording, made on demand: two seconds at
// a time into build/footage/frames/, numbered on the project's frame grid, with
// colours turned for the JPEG decoder of the browser. The folder stays under
// `cap` bytes by dropping the pieces used longest ago, so a long recording never
// fills the disk.
const PIECE = 2;
export const FRAMES_CAP = 1.5e9;

export function footageFrames(projectDir, src, fps, { cap = FRAMES_CAP } = {}) {
  const file = path.join(projectDir, src);
  const stat = fs.statSync(file);
  const root = path.join(projectDir, 'build', 'footage', 'frames', `${stat.size}-${Math.round(stat.mtimeMs)}-${fps}`);
  fs.mkdirSync(root, { recursive: true });
  const pieces = new Map();
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (fs.existsSync(path.join(dir, 'done'))) pieces.set(Number(name), { bytes: size(dir), used: fs.statSync(dir).mtimeMs });
  }
  const jobs = new Map();
  let info = null;
  const each = PIECE * fps;
  const evict = (keep) => {
    let total = [...pieces.values()].reduce((n, p) => n + p.bytes, 0);
    for (const [n, p] of [...pieces].sort((a, b) => a[1].used - b[1].used)) {
      if (total <= cap) break;
      if (n === keep || jobs.has(n)) continue;
      fs.rmSync(path.join(root, String(n)), { recursive: true, force: true });
      pieces.delete(n);
      total -= p.bytes;
    }
  };
  const piece = (n) => {
    if (pieces.has(n)) {
      pieces.get(n).used = Date.now();
      return Promise.resolve();
    }
    if (!jobs.has(n)) {
      const job = (async () => {
        const dir = path.join(root, String(n));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        await ffmpeg(['-loglevel', 'error', '-ss', String(n * PIECE), '-i', file, '-t', String(PIECE), '-map', '0:v:0',
          '-vf', `fps=${fps},colormatrix=bt709:bt601`, '-q:v', '3', '-start_number', String(n * each), path.join(dir, '%08d.jpg')]);
        fs.writeFileSync(path.join(dir, 'done'), '');
        pieces.set(n, { bytes: size(dir), used: Date.now() });
        evict(n);
      })();
      jobs.set(n, job);
      job.finally(() => jobs.delete(n)).catch(() => {});
    }
    return jobs.get(n);
  };
  return {
    // What the page needs to know: no frame is made for it.
    async info() {
      if (!info) {
        const probed = await probe(file);
        const v = probed.streams.find((x) => x.codec_type === 'video');
        const duration = Number(probed.format.duration) || 0;
        info = { src, fps, frames: Math.max(1, Math.floor(duration * fps + 1e-6)), duration, width: v.width, height: v.height };
      }
      return info;
    },
    // The file of frame `n`, the last frame for anything after the end.
    async frame(n) {
      const { frames } = await this.info();
      const k = Math.max(0, Math.min(frames - 1, n));
      const p = Math.floor(k / each);
      await piece(p);
      let jpg = path.join(root, String(p), `${String(k).padStart(8, '0')}.jpg`);
      // A piece at the very end can be a frame short of the grid.
      for (let j = k - 1; !fs.existsSync(jpg) && j >= p * each; j--) jpg = path.join(root, String(p), `${String(j).padStart(8, '0')}.jpg`);
      return jpg;
    },
  };
}

function size(dir) {
  return fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
}

// A footage project in `target` from the recording `input`: the working copy in
// assets/, video.json, script.md with a scene for each span of speech, and a
// scenes.js where every scene shows its span. `transcribe` replaces the speech
// model in tests.
export async function createFootageProject(target, input, { title, theme = 'midnight', size, language = 'en', log = () => {}, transcribe } = {}) {
  if (fs.existsSync(path.join(target, 'video.json'))) throw new ProjectError(`${target} already has a video.json`);
  const info = await footageInfo(input);
  checkLanguage(language);
  if (!THEMES.includes(theme)) throw new ProjectError(`theme must be one of ${THEMES.join(', ')}`);
  size ||= Math.abs(info.width - info.height) < 8 ? 'square' : info.width > info.height ? '16:9' : 'vertical';
  resolveSize(size);
  title ||= path.basename(target).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const config = { title, theme, size, fps: info.fps, footage: 'assets/footage.mov', music: true, captions: 'auto', transition: 'cut', defaults: DEFAULTS_VERSIONS.at(-1), ...(language !== 'en' ? { language } : {}) };
  normalizeConfig({ ...config }, '.');
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  const dest = path.join(target, 'assets', 'footage.mov');
  const note = await makeWorkingCopy(input, dest, info, { log });
  const heard = await footageWords(dest, fileHash(dest), language, { log, ...(transcribe ? { transcribe } : {}) });
  const script = footageScript(heard.words, heard.duration, info.fps, title);
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  fs.writeFileSync(path.join(target, 'video.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'script.md'), script);
  fs.writeFileSync(path.join(target, 'scenes.js'), fs.readFileSync(path.join(root, 'templates', 'footage', 'scenes.js'), 'utf8'));
  fs.writeFileSync(path.join(target, '.gitignore'), 'build/\nout/\n.env\nhistory/private/\nhistory/locks/\n');
  return { target, config, info, note, heard, scenes: (script.match(/^## /gm) || []).length };
}
