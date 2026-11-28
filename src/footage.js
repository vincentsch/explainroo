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
import { transcribeWords, speechOnly } from './models.js';
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
  // The nominal rate, as long as it is one a video plays at: a variable frame
  // rate recording has a lower average, and some screen recorders give 1000.
  const source = [v.r_frame_rate, v.avg_frame_rate].map(rate).find((r) => r > 0 && r <= 61) ?? (rate(v.avg_frame_rate) || 30);
  const rotation = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  const [width, height] = rotation ? [v.height, v.width] : [v.width, v.height];
  return {
    duration: Number(info.format.duration) || Number(v.duration) || 0,
    sourceFps: Math.round(source * 1000) / 1000,
    fps: projectRate(source),
    width,
    height,
    hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
    // Older and some screen recorders' video is BT.601 or full range.
    bt601: ['smpte170m', 'bt470bg'].includes(v.color_space),
    fullRange: v.color_range === 'pc' || /^yuvj/.test(v.pix_fmt ?? ''),
    codec: v.codec_name,
  };
}

// The frame rate of the project for a recording: the nearest one it takes,
// and 30 for a recording slower than 24 frames a second, like a screen recording.
export function projectRate(source) {
  if (!(source >= 23)) return 30;
  return RATES.reduce((best, r) => (Math.abs(r - source) < Math.abs(best - source) ? r : best), RATES[0]);
}

// How long the picture of a working copy is: its frames at its rate. The
// container's length can be the sound's, a little longer.
export async function pictureSeconds(file) {
  const probed = await probe(file);
  const v = probed.streams.find((x) => x.codec_type === 'video');
  const frames = Number(v?.nb_frames);
  const r = rate(v?.r_frame_rate);
  if (frames > 0 && r > 0) return frames / r;
  return Number(v?.duration) || Number(probed.format.duration) || 0;
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
export async function makeWorkingCopy(src, dest, info, { log = () => {}, from = null, to = null } = {}) {
  const filters = [];
  let note = null;
  if (info.hdr && hasZscale()) filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  else if (info.hdr) note = 'the recording is HDR, and this ffmpeg has no zscale to bring it to normal brightness, so its colours may look flat';
  // start_time=0 fills a picture that starts after the sound with its first
  // frame, on the clock the sound starts on. Both sides even, for yuv420p.
  const convert = info.hdr ? '' : `${info.bt601 ? ':in_color_matrix=bt601' : ''}${info.fullRange ? ':in_range=pc' : ''}:out_color_matrix=bt709:out_range=tv`;
  // A stretch of the source, for a short. The seek lands up to 10 s early, so a
  // frame still on screen at the cut, as variable frame rate recordings hold
  // them, is there when the frame rate is made constant; then both streams are
  // trimmed at the same moment on that grid.
  const pre = from !== null ? Math.min(10, from) : 0;
  const trim = from !== null ? [`trim=start=${pre}:duration=${to - from}`, 'setpts=PTS-STARTPTS'] : [];
  const atrim = from !== null ? `,atrim=start=${pre}:duration=${to - from},asetpts=PTS-STARTPTS` : '';
  filters.push(`fps=${info.fps}:start_time=0`, ...trim, `scale='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)'${convert}`, 'setsar=1', 'format=yuv420p');
  log(`making a working copy of ${path.basename(src)} at ${info.fps} frames a second`);
  const temp = `${dest}.partial${path.extname(dest)}`;
  await ffmpeg(['-loglevel', 'error', '-y', ...(from !== null ? ['-ss', String(from - pre)] : []), '-i', src, '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filters.join(','),
    // The rate is said once more for the encoder: after a trim the filters no
    // longer carry it, and ffmpeg would fall back to 25.
    '-r', String(info.fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-bf', '0', '-g', String(info.fps), '-keyint_min', String(info.fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'pcm_s16le', '-ar', String(FOOTAGE_RATE), '-ac', '2', '-af', `aresample=async=1:first_pts=0${atrim}`,
    '-avoid_negative_ts', 'make_zero', temp]);
  fs.renameSync(temp, dest);
  return note;
}

// The SHA-256 of a file. With `cache`, a small JSON file that keeps it by the
// file's size and time, so a long recording isn't read again for every command.
export function fileHash(file, cache = null) {
  const stat = fs.statSync(file);
  const id = `${stat.size}-${Math.round(stat.mtimeMs)}`;
  if (cache && fs.existsSync(cache)) {
    try {
      const kept = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (kept.id === id && kept.sha256) return kept.sha256;
    } catch {}
  }
  const sha256 = readHash(file);
  if (cache) {
    // A project that can't be written to still gets its hash.
    try {
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, JSON.stringify({ id, sha256 }));
    } catch {}
  }
  return sha256;
}

function readHash(file) {
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
// before `limit` seconds. Under music there is none, and then it ends at the
// softest moment of its last 10 seconds, which `softest` finds, so no word is
// cut in two.
export function pieceEnds(quiet, duration, limit = PIECE_SECONDS, softest = null) {
  const ends = [];
  let start = 0;
  while (duration - start > limit) {
    const inside = quiet.filter(([a, b]) => a > start + 3 && (a + b) / 2 < start + limit);
    const end = inside.length ? (inside.at(-1)[0] + inside.at(-1)[1]) / 2 : softest ? softest(start + limit - 10, start + limit) : start + limit;
    ends.push(end);
    start = end;
  }
  ends.push(duration);
  return ends;
}

// The words of the working copy, heard in pieces split at pauses, kept by its
// hash and language, with its quiet stretches. Stretches of sound of 2 seconds
// or more without words are listed, as speech the model may have missed.
export async function footageWords(file, sha256, language, { log = () => {}, transcribe = transcribeWords, saved: only = false } = {}) {
  // Next to the working copy, so the words and their times travel with the
  // project, and a new working copy or another language is heard again.
  const saved = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.words-${language}.json`);
  if (fs.existsSync(saved)) {
    const kept = JSON.parse(fs.readFileSync(saved, 'utf8'));
    if (kept.sha256 === sha256 && kept.language === language) return withPlausibleTimes(kept);
  }
  if (only) throw new ProjectError(`the words of ${path.basename(file)} in this language aren't saved for this working copy. "explainroo voice" on its project hears them once.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-'));
  try {
    const wav = path.join(dir, 'speech-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const { samples } = readWav(wav);
    const duration = samples.length / 16000;
    const quiet = quietStretches(samples, 16000);
    const ends = pieceEnds(quiet, duration, PIECE_SECONDS, (a, b) => softestMoment(samples, a, b));
    const words = [];
    const began = Date.now();
    // The speech model sometimes gives a run of words one time, and loses the
    // rest of its piece; a piece like that is heard again in two halves.
    const hear = async (a, b, depth = 0) => {
      const heard = await transcribe(samples.subarray(Math.floor(a * 16000), Math.floor(b * 16000)), { log, language });
      const got = speechOnly(heard.words).map((w, k) => ({ text: w.text.replace(/\s+/g, ' '), start: round(a + w.start), end: round(a + Math.max(w.start, w.end)), ...(k ? {} : { first: true }) }));
      if (depth < 2 && b - a > 8 && collapsed(got)) {
        const mid = softestMoment(samples, a + (b - a) * 0.35, a + (b - a) * 0.65);
        return [...await hear(a, mid, depth + 1), ...await hear(mid, b, depth + 1)];
      }
      return got;
    };
    let start = 0;
    for (const [i, end] of ends.entries()) {
      const left = i ? ` (about ${Math.max(1, Math.round(((Date.now() - began) / i) * (ends.length - i) / 60000))} min left)` : '';
      log(`listening to the recording, part ${i + 1} of ${ends.length}${left}`);
      words.push(...await hear(start, end));
      start = end;
    }
    const result = { sha256, language, duration: round(duration), words, quiet, unheard: unheardStretches(words, quiet, duration) };
    fs.writeFileSync(saved, JSON.stringify(result));
    return withPlausibleTimes(result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The softest 50 ms between `a` and `b` seconds of 16 kHz samples, in seconds.
export function softestMoment(samples, a, b) {
  const step = 800;
  let best = (a + b) / 2;
  let least = Infinity;
  for (let i = Math.max(0, Math.floor(a * 16000)); i + step <= Math.min(samples.length, Math.floor(b * 16000)); i += step / 2) {
    let sum = 0;
    for (let k = i; k < i + step; k++) sum += samples[k] * samples[k];
    if (sum < least) {
      least = sum;
      best = (i + step / 2) / 16000;
    }
  }
  return round(best);
}

// A run of five or more words that start at the same moment: the speech model
// lost track of the time there.
export function collapsed(words) {
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = Math.abs(words[i].start - words[i - 1].start) < 0.05 ? run + 1 : 1;
    if (run >= 5) return true;
  }
  return false;
}

// The words whose starts can stay: the longest run of them, in order, whose
// starts never go back. Of words that start at the same moment, the first.
function inOrder(words) {
  const tails = [];
  const at = [];
  const prev = words.map(() => -1);
  words.forEach((w, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] <= w.start) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = w.start;
    at[lo] = i;
    prev[i] = lo ? at[lo - 1] : -1;
  });
  const keep = words.map(() => false);
  for (let i = tails.length ? at[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = true;
  return keep.map((k, i) => k && !(i > 0 && keep[i - 1] && Math.abs(words[i].start - words[i - 1].start) < 0.01));
}

// The speech model sometimes loses track of time at the edge of what it
// heard: words get a time after the words that follow them or the same time
// as the word before, a word runs over the words after it, or the first word
// of a piece, after music or a pause, starts seconds early. Words out of order
// share the time between the words around them by their letters; a word ends
// where the next one starts; and a word that is too long, the first of a piece
// or any far too long, takes the time its letters take to say, counted back
// from its end. A start that had to be guessed is marked estimated, so a cut
// is never planned on it.
export function plausibleTimes(words) {
  const out = words.map((w) => ({ ...w }));
  const letters = (w) => Math.max(1, (w.text.match(/[\p{L}\p{N}]/gu) ?? []).length);
  const keep = inOrder(out);
  for (let i = 0; i < out.length; i++) {
    if (keep[i]) continue;
    let j = i;
    while (j < out.length && !keep[j]) j++;
    const first = i > 0 ? i - 1 : i;
    const before = first < i ? out[first].start : null;
    const to = j < out.length ? out[j].start : Math.max(before ?? 0, ...out.slice(i, j).map((w) => w.end)) + 0.3 * (j - i);
    const from = before === null ? Math.max(0, to - 0.3 * (j - i)) : Math.min(before, to);
    const group = out.slice(first, j);
    const total = group.reduce((n, w) => n + letters(w), 0);
    let t = from;
    group.forEach((w, k) => {
      const d = ((to - from) * letters(w)) / total;
      Object.assign(w, { start: round(t), end: round(t + d) });
      if (first + k >= i) w.estimated = true;
      t += d;
    });
    i = j - 1;
  }
  return out.map((w, i) => {
    const next = out[i + 1];
    const end = next && next.start > w.start && next.start < w.end ? next.start : w.end;
    const most = 0.6 + 0.12 * letters(w);
    // The first word of a piece is suspect when it is long; any word when it
    // is more than twice as long as its letters take, which no drawl explains.
    if (end - w.start > most && (w.first || end - w.start > 2 * most)) return { ...w, start: round(end - most), end, estimated: true, heardStart: w.heardStart ?? w.start };
    return end === w.end ? w : { ...w, end };
  });
}

function withPlausibleTimes(heard) {
  return { ...heard, words: plausibleTimes(speechOnly(heard.words)) };
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
// or more between two scenes gets a note with the times that cut it.
export function footagePassages(heardWords, duration, fps, { tight = false } = {}) {
  const snap = (t) => Math.round(t * fps) / fps;
  // Words the speech model heard after the end of the picture have no picture.
  const words = heardWords.filter((w) => w.start < duration - 0.1);
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
  // The opening keeps the start that was heard, so a drawn-out first word is never cut.
  const head = Math.max(0, Math.min(words[0].start, words[0].heardStart ?? Infinity) - 0.25);
  // The last span ends on a whole frame inside the recording.
  const tail = Math.min(Math.round(duration * fps), Math.round((words.at(-1).end + 0.6) * fps)) / fps;
  // Scenes meet in the middle of a pause. A tight edit, for a short, cuts a
  // pause of 1.2 seconds or more instead: the scene ends 0.25 s after its last
  // word and the next starts 0.25 s before its first.
  // A start that was only estimated may be early or late: a tight cut leaves up
  // to a second before it, back to where the speech model heard it.
  const earliest = (w) => (w.heardStart !== undefined ? Math.max(w.heardStart, w.start - 1) : w.start);
  const long = (i) => scenes[i + 1] && earliest(scenes[i + 1][0]) - scenes[i].at(-1).end >= 1.2;
  const begin = (i) => (i === 0 ? snap(head) : tight && long(i - 1) ? snap(earliest(scenes[i][0]) - 0.25) : snap((scenes[i - 1].at(-1).end + scenes[i][0].start) / 2));
  const finish = (i) => (i === scenes.length - 1 ? tail : tight && long(i) ? snap(scenes[i].at(-1).end + 0.25) : begin(i + 1));
  // A scene that wouldn't last a frame joins the one before it.
  for (let i = 1; i < scenes.length; i++) {
    if (begin(i) <= begin(i - 1) || finish(i) <= begin(i)) scenes[i - 1].push(...scenes.splice(i--, 1)[0]);
  }
  return scenes.map((group, i) => {
    const next = scenes[i + 1];
    const gap = next ? next[0].start - group.at(-1).end : 0;
    return {
      from: begin(i), to: finish(i), words: group, text: group.map((w) => w.text).join(' '),
      // A long pause after it that the spans keep, with the times that cut it.
      ...(!tight && gap >= 1.5 ? { pause: { seconds: round(gap), to: snap(group.at(-1).end + 0.25), next: snap(next[0].start - 0.25) } } : {}),
    };
  });
}

// script.md for a recording, from its passages.
export function footageScript(heardWords, duration, fps, title, options = {}) {
  const lines = [`# ${title}`, '', '> Each scene is a span of the recording: {from to} are its seconds. Delete a', '> scene to cut it, change from and to, or move it. Fix a misheard word in its', '> text, so the captions say it right; the timing stays the recording\'s.', ''];
  footagePassages(heardWords, duration, fps, options).forEach((p, i) => {
    lines.push(`## s${String(i + 1).padStart(2, '0')} {from=${p.from.toFixed(3)} to=${p.to.toFixed(3)}}`, p.text);
    if (p.pause) lines.push(`> pause of ${p.pause.seconds.toFixed(1)} s after this scene: to cut it, end this scene at ${p.pause.to.toFixed(3)} and start the next at ${p.pause.next.toFixed(3)}`);
    lines.push('');
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
  const frames = path.join(projectDir, 'build', 'footage', 'frames');
  const root = path.join(frames, `${stat.size}-${Math.round(stat.mtimeMs)}-${fps}`);
  // Frames of a recording that was replaced, or of another frame rate, are of no use.
  for (const old of fs.existsSync(frames) ? fs.readdirSync(frames) : []) {
    if (path.join(frames, old) !== root) fs.rmSync(path.join(frames, old), { recursive: true, force: true });
  }
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
        const duration = await pictureSeconds(file);
        info = { src, fps, frames: Math.max(1, Math.round(duration * fps)), duration, width: v.width, height: v.height };
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

// The footage project `dir`, when `input` is one: its working copy, its words
// in its language, its look and whether it has music.
export function footageParent(input) {
  const file = path.join(input, 'video.json');
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new ProjectError(`${file} is not valid JSON`);
  }
  const src = typeof raw.footage === 'string' ? raw.footage : raw.footage?.src;
  if (!src) throw new ProjectError(`${input} is a project without a recording. --footage takes a video file or a footage project.`);
  const language = raw.language ?? 'en';
  return { dir: input, file: path.join(input, src), language, theme: raw.theme, music: raw.music, words: path.join(input, path.dirname(src), `${path.basename(src, path.extname(src))}.words-${language}.json`) };
}

// The words of a stretch of a parent's recording, as words of the stretch:
// those that start inside it, from its start. Null when the parent's words are
// not those of its working copy.
function stretchWords(parent, parentHash, from, to) {
  if (!fs.existsSync(parent.words)) return null;
  const kept = JSON.parse(fs.readFileSync(parent.words, 'utf8'));
  if (kept.sha256 !== parentHash) return null;
  const shift = (t) => round(Math.min(to, Math.max(from, t)) - from);
  // The words as the long project shows them, repaired, so the short has the
  // words of the passage it was picked from.
  const words = plausibleTimes(speechOnly(kept.words));
  return {
    language: kept.language,
    duration: round(to - from),
    words: words.filter((w) => w.start >= from && w.start < to).map((w) => ({ ...w, start: shift(w.start), end: shift(w.end), ...(w.heardStart !== undefined ? { heardStart: shift(w.heardStart) } : {}) })),
    quiet: kept.quiet.filter(([a, b]) => b > from && a < to).map(([a, b]) => [shift(a), shift(b)]),
    unheard: kept.unheard.filter(([a, b]) => b > from && a < to).map(([a, b]) => [shift(a), shift(b)]),
  };
}

// A footage project in `target` from the recording `input`, a video file or a
// footage project: the working copy in assets/, video.json, script.md with a
// scene for each span of speech, and a scenes.js where every scene shows its
// span. With `from` and `to`, only that stretch, cut tight, for a short; from a
// project, its words are reused and its language, look and music carry over.
// `transcribe` replaces the speech model in tests.
export async function createFootageProject(target, input, { title, theme, size, language, from, to, log = () => {}, transcribe } = {}) {
  if (fs.existsSync(path.join(target, 'video.json'))) throw new ProjectError(`${target} already has a video.json`);
  const dest = path.join(target, 'assets', 'footage.mov');
  // The working copy never replaces a file, the recording itself least of all.
  if (fs.existsSync(dest)) throw new ProjectError(`${dest} is already there, and init writes the working copy there. Move it out of the project folder, or start the project in a new folder.`);
  const parent = fs.existsSync(input) && fs.statSync(input).isDirectory() ? footageParent(input) : null;
  const file = parent ? parent.file : input;
  language ??= parent?.language ?? 'en';
  theme ??= parent?.theme ?? 'midnight';
  const info = await footageInfo(file);
  checkLanguage(language);
  // The long project's own look file comes along, as a file of the short's own.
  const ownLook = parent && theme === parent.theme && !THEMES.includes(theme) && /\.json$/.test(theme) && fs.existsSync(path.join(parent.dir, theme)) ? path.join(parent.dir, theme) : null;
  if (!THEMES.includes(theme) && !ownLook) throw new ProjectError(`theme must be one of ${THEMES.join(', ')}`);
  if (ownLook) theme = path.basename(ownLook);
  // The stretch, on the frame grid of the project.
  let stretch = null;
  if (from !== undefined || to !== undefined) {
    const snap = (t) => Math.round(t * info.fps) / info.fps;
    const a = snap(from ?? 0);
    const b = snap(Math.min(to ?? info.duration, info.duration));
    if (!(a >= 0 && b - a >= 1)) throw new ProjectError(`--from and --to must be a stretch of at least a second inside the recording, which is ${info.duration.toFixed(1)} s long`);
    stretch = { from: a, to: b };
  }
  size ||= Math.abs(info.width - info.height) < 8 ? 'square' : info.width > info.height ? '16:9' : 'vertical';
  resolveSize(size);
  title ||= path.basename(target).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const config = { title, theme, size, fps: info.fps, footage: 'assets/footage.mov', music: parent?.music === false ? false : true, captions: 'auto', transition: 'cut', camera: 'still', defaults: DEFAULTS_VERSIONS.at(-1), ...(language !== 'en' ? { language } : {}) };
  if (!ownLook) normalizeConfig({ ...config }, '.');
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  if (ownLook) {
    // Never over a file that is there already.
    fs.copyFileSync(ownLook, path.join(target, theme), fs.constants.COPYFILE_EXCL);
    normalizeConfig({ ...config }, target);
  }
  const wordsFile = path.join(path.dirname(dest), `footage.words-${language}.json`);
  const hadWords = fs.existsSync(wordsFile);
  const note = await makeWorkingCopy(file, dest, info, { log, ...(stretch ?? {}) });
  let heard;
  let script;
  try {
    const hash = fileHash(dest);
    // The parent's words, when they are of its working copy and in this language, are not heard again.
    const reused = parent && parent.language === language ? stretchWords(parent, fileHash(parent.file, path.join(parent.dir, 'build', 'footage', 'hash.json')), stretch?.from ?? 0, stretch?.to ?? info.duration) : null;
    if (reused) fs.writeFileSync(wordsFile, JSON.stringify({ sha256: hash, ...reused }));
    else if (parent) log(`the words of ${path.basename(parent.dir)} aren't saved for its working copy${parent.language !== language ? ' in this language' : ''}, so the speech model hears the stretch`);
    heard = await footageWords(dest, hash, language, { log, ...(transcribe ? { transcribe } : {}) });
    script = footageScript(heard.words, Math.min(heard.duration, await pictureSeconds(dest)), info.fps, title, { tight: !!stretch });
  } catch (e) {
    // This run's working copy and words go, so init can run again in the same folder.
    fs.rmSync(dest, { force: true });
    if (!hadWords) fs.rmSync(wordsFile, { force: true });
    throw e;
  }
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  fs.writeFileSync(path.join(target, 'video.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'script.md'), script);
  fs.writeFileSync(path.join(target, 'scenes.js'), fs.readFileSync(path.join(root, 'templates', 'footage', 'scenes.js'), 'utf8'));
  fs.writeFileSync(path.join(target, '.gitignore'), 'build/\nout/\n.env\nhistory/private/\nhistory/locks/\n');
  return { target, config, info, note, heard, stretch, parent: parent?.dir ?? null, scenes: (script.match(/^## /gm) || []).length };
}
