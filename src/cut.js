// explainroo cut: edit your own recording by its transcript. "cut <video>"
// listens to the video with the speech model and writes <name>.cut.md next to
// it, one sentence a line, each word with its time. Taking a word out of that
// file cuts it out of the video, and a long silence shows as a [pause] that can
// go or get shorter. "cut <video> --apply" writes <name>.cut.mp4, with the sound
// crossfaded at every join, so a cut never clicks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUDIO_CODECS, dbtp, ffmpeg, finishMix, loudness, probe } from './ffmpeg.js';
import { cacheRoot, transcribeWords } from './models.js';
import { readWav } from './wav.js';
import { sha256File } from './history.js';
import { DEFAULTS, ProjectError, checkLanguage } from './project.js';
import { alignSpeech, bareWord } from './align.js';

// A quiet stretch at least this long, in seconds, is a [pause] in the cut list.
export const PAUSE = 0.6;
// Sound between words at least this long, with no word heard in it, like "um"
// or a cough, is a [sound] in the cut list.
export const SOUND = 0.4;
// What a pause keeps when its [pause] is taken out.
export const BREATH = 0.25;
// The length of the crossfade at each join, in seconds.
export const FADE = 0.03;
// The sample rate of the cut sound.
const RATE = 48000;

// <name>.cut.md and <name>.cut.mp4 next to the video.
export function cutFiles(video) {
  const base = video.slice(0, video.length - path.extname(video).length);
  return { list: `${base}.cut.md`, out: `${base}.cut.mp4` };
}

// A word's end is moved on through the sound that follows it without a gap,
// when that sound reaches this level in dBFS: the speech model often ends a word
// before its last sound, like the "s" of "settings".
export const TAIL_LEVEL = -35;
// The most a word's end moves on that way, in seconds.
const TAIL = 0.4;
// A [sound] that starts this close to the end of a word may hold the end of it.
const NEAR_WORD = 0.08;
// Quiet this long, in 10 ms steps, is a gap that a word's end doesn't move past.
const GAP_STEPS = 5;

// The smallest pause and sound in a cut list. --min-gap sets a smaller pause,
// and then a sound may be as short as the pause, with half of it not quiet.
export function gapSizes(minGap = null) {
  if (minGap === null || minGap === undefined) return { pause: PAUSE, sound: SOUND };
  return { pause: minGap, sound: Math.min(SOUND, minGap) };
}

// The words, pauses and sounds of a recording in order. Each runs from its start
// to the start of what comes next, so the short gap after a word goes with it,
// and the first starts at 0. A pause is a quiet stretch of PAUSE seconds or
// more. A sound is a stretch of SOUND seconds or more between words, at least
// half of it not quiet, with no word in it: the speech model leaves out "um" and
// coughs. The model's word times can run into a quiet stretch, so a word that
// starts in one starts at its end, and one that ends in one ends at its start.
// With `levels`, the sound level in dBFS of each 10 ms, a word also ends after
// the sound that joins it without a gap, 50 ms or more of quiet, up to the last
// 10 ms at TAIL_LEVEL or louder. A sound whose first 10 ms at that level comes
// within NEAR_WORD of a word's end has `holds`, the word it may hold the end of.
export function cutItems(words, duration, quiet = [], { levels = null, pause = PAUSE, sound: soundSize = SOUND } = {}) {
  const list = words.map((w) => ({ text: w.text, start: Math.max(0, w.start), end: Math.max(0, w.start, w.end) }));
  for (const [s, e] of quiet) {
    for (const w of list) {
      if (w.start >= s && w.start < e) w.start = e;
      if ((w.end > s && w.end <= e) || (w.start < s && w.end > e)) w.end = s;
      if (w.end < w.start) w.end = w.start;
    }
  }
  const limit = levels ? quietLevel(levels) : null;
  if (levels) {
    list.forEach((w, k) => {
      const stop = Math.min(list[k + 1]?.start ?? duration, w.end + TAIL, quiet.find(([s]) => s >= w.end - 1e-6)?.[0] ?? duration);
      let end = w.end;
      let still = 0;
      for (let i = Math.ceil(w.end * 100 - 1e-6); i < levels.length && (i + 1) / 100 <= stop + 1e-6; i++) {
        still = levels[i] < limit ? still + 1 : 0;
        if (still >= GAP_STEPS) break;
        if (levels[i] >= TAIL_LEVEL) end = (i + 1) / 100;
      }
      w.end = Math.max(w.end, Math.min(end, stop));
    });
  }
  const items = [];
  // The pauses and sounds between `from` and `to`. What is left after a pause
  // and too short to be a sound goes with the pause.
  // How long the sound between `from` and `to` isn't quiet.
  const loud = (from, to) => quiet.reduce((n, [s, e]) => n - Math.max(0, Math.min(e, to) - Math.max(s, from)), to - from);
  const sound = (from, to) => to - from >= soundSize - 1e-6 && loud(from, to) >= soundSize / 2 - 1e-6;
  let word = null;
  // Where a sound is first heard: its first 10 ms at TAIL_LEVEL, or without
  // levels, after the quiet it starts with.
  const heard = (start, end) => {
    if (levels) {
      for (let i = Math.floor(start * 100 + 1e-6); i < Math.min(levels.length, end * 100); i++) if (levels[i] >= TAIL_LEVEL) return i / 100;
      return end;
    }
    return quiet.find(([s, e]) => s <= start + 1e-6 && e > start)?.[1] ?? start;
  };
  const addSound = (start, end) => {
    const item = { type: 'sound', start, end };
    if (word && heard(start, end) - word.end < NEAR_WORD - 1e-6) item.holds = bareWord(word.text);
    items.push(item);
  };
  const gap = (from, to) => {
    let at = from;
    for (const [s, e] of quiet) {
      const qs = Math.max(s, from);
      const qe = Math.min(e, to);
      if (qe - qs < pause - 1e-6) continue;
      if (sound(at, qs)) addSound(at, qs);
      items.push({ type: 'pause', start: qs, end: qe });
      at = qe;
    }
    if (sound(at, to)) addSound(at, to);
    else if (items.at(-1)?.type === 'pause' && items.at(-1).end === at) items.at(-1).end = to;
  };
  let t = 0;
  for (const w of list) {
    gap(t, w.start);
    items.push({ type: 'word', ...w });
    word = w;
    t = Math.max(t, w.end);
  }
  gap(t, duration);
  return items;
}

// The sound level of each 10 ms in dBFS, and the level under which it counts as
// quiet: between the noise floor and the speech, where the floor is the level
// that 10% of the steps stay under, and the speech the level that 5% of them reach.
export function soundLevels(samples, rate) {
  const step = Math.round(rate / 100);
  const levels = [];
  for (let i = 0; i + step <= samples.length; i += step) {
    let sum = 0;
    for (let k = i; k < i + step; k++) sum += samples[k] * samples[k];
    levels.push(10 * Math.log10(sum / step + 1e-12));
  }
  return { levels, limit: quietLevel(levels) };
}

// The level under which sound counts as quiet, from the levels of its 10 ms steps.
export function quietLevel(levels) {
  if (!levels.length) return -Infinity;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  return Math.min(floor + Math.max(6, (loud - floor) * 0.25), loud - 20);
}

// The quiet stretches of a sound, 0.1 seconds or longer, as [start, end] in
// seconds, read from its levels in 10 ms steps.
export function quietStretches(samples, rate) {
  const { levels, limit } = soundLevels(samples, rate);
  const out = [];
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] >= limit) continue;
    let j = i;
    while (j + 1 < levels.length && levels[j + 1] < limit) j++;
    if (j + 1 - i >= 10) out.push([i / 100, Math.min((j + 1) / 100, samples.length / rate)]);
    i = j;
  }
  return out;
}

const time = (t) => t.toFixed(2);
const gapToken = (p) => `[${p.type} ${time(p.end - p.start)}s @${time(p.start)}${p.holds ? ` may hold the end of "${p.holds}"` : ''}]`;
const sentenceEnd = /[.!?…。！？]["'’”)\]]*$/u;

// The text of a cut list: a short guide in a comment, then one line a sentence.
// A pause starts the line of the sentence after it.
export function cutListText(name, items, { sha256, language, minGap = null }) {
  const lines = [];
  let line = [];
  for (const item of items) {
    line.push(item.type === 'word' ? `${item.text}@${time(item.start)}` : gapToken(item));
    if (item.type === 'word' && sentenceEnd.test(item.text)) {
      lines.push(line.join(' '));
      line = [];
    }
  }
  if (line.length) lines.push(line.join(' '));
  return [
    `# Cut list of ${name}`,
    '',
    '<!--',
    'Each line is one sentence, and each word has its time in seconds, like word@12.34.',
    'Delete a word to cut it out of the video, or delete a whole line.',
    `A [pause 1.20s @14.02] is a silence. Delete it to shorten it to ${BREATH} s, or change`,
    'its seconds to keep that much of it.',
    'A [sound 0.50s @7.02] is sound without words, like "um" or a cough. Delete it to cut it out,',
    'or change its seconds to keep that much of it from the start. A sound that "may hold the',
    'end" of a word can be the last sound of that word, so listen before you delete it.',
    'Leave the other words as they are. The cut only takes things out.',
    `Then run: explainroo cut ${name} --apply`,
    `video: ${name}, sha256 ${sha256.slice(0, 16)}, language ${language}${minGap === null ? '' : `, min gap ${minGap}s`}`,
    '-->',
    '',
    ...lines,
    '',
  ].join('\n');
}

// What the cut list keeps: for each item, false for a word or sound that was
// taken out, and for a pause the seconds it keeps. A sound with fewer seconds
// than it has keeps that many from its start. `name` names the file in messages.
export function readCutList(text, items, name = 'the cut list') {
  const keep = items.map((item) => (item.type === 'pause' ? 0 : false));
  const byTime = new Map();
  items.forEach((item, i) => {
    const key = `${item.type}@${time(item.start)}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(i);
  });
  const used = new Set();
  let last = -1;
  const token = /\[\s*(pause|sound)\s+([\d.]+)\s*s?\s*@\s*([\d.]+)[^\]\n]*\]|(\S+?)@(\d+\.\d+)(?=\s|$)/gu;
  let comment = false;
  text.split(/\r?\n/).forEach((raw, n) => {
    let line = raw;
    if (comment) {
      const end = line.indexOf('-->');
      if (end === -1) return;
      line = line.slice(end + 3);
      comment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    if (line.includes('<!--')) {
      line = line.slice(0, line.indexOf('<!--'));
      comment = true;
    }
    if (/^\s*#/.test(line)) return;
    const where = `${name} line ${n + 1}`;
    const rest = line.replace(token, (whole, type, seconds, gapAt, word, at) => {
      const key = word === undefined ? `${type}@${time(Number(gapAt))}` : `word@${time(Number(at))}`;
      const list = (byTime.get(key) ?? []).filter((i) => !used.has(i));
      // Two words with one time: the one with this text, else the first.
      const i = word === undefined ? list[0] : (list.find((k) => items[k].text === word) ?? list[0]);
      if (i === undefined) throw new ProjectError(`${where}: "${whole}" is not in the recording. Leave the words, pauses and sounds as cut wrote them, and only delete them.`);
      if (i < last) throw new ProjectError(`${where}: "${whole}" comes before a word that stands earlier in the list. The cut keeps the order of the recording, so it can't move words.`);
      used.add(i);
      last = i;
      const s = Number(seconds);
      if (type !== undefined && !Number.isFinite(s)) throw new ProjectError(`${where}: "${whole}" needs the seconds to keep, like [${type} 0.5s @${time(Number(gapAt))}]`);
      if (type === 'pause') keep[i] = Math.min(s, items[i].end - items[i].start);
      // A sound keeps all of it at the seconds cut wrote, which are rounded.
      else if (type === 'sound') keep[i] = s >= Number(time(items[i].end - items[i].start)) ? true : s;
      else keep[i] = true;
      return ' ';
    });
    const left = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (left.length) throw new ProjectError(`${where}: "${left[0]}" has no time, so it is not a word of the recording. The cut only takes words out, so leave out words you want to add.`);
  });
  // A pause that is no longer in the list keeps a breath.
  items.forEach((item, i) => {
    if (item.type === 'pause' && !used.has(i)) keep[i] = Math.min(BREATH, item.end - item.start);
  });
  return keep;
}

// The parts of the recording to keep, from the items and what the list keeps of
// them. Each start and end is a join, with the times the join may move between to
// find a quiet spot. The speech model often times a word a little late, so a
// join at a word or a sound may move up to 0.2 s before it, and 0.03 s into it.
export function keptParts(items, keep, duration) {
  const parts = [];
  const add = (start, end, from, to) => {
    if (end - start < 1e-6) return;
    const prev = parts.at(-1);
    if (prev && Math.abs(prev.end.t - start) < 1e-6) prev.end = to;
    else parts.push({ start: from, end: to });
  };
  const fixed = (t) => ({ t, lo: t, hi: t });
  const join = (i) => {
    if (i >= items.length) return fixed(duration);
    const item = items[i];
    if (i === 0) return fixed(0);
    if (item.type === 'pause') return fixed(item.start);
    const before = items[i - 1];
    return { t: item.start, lo: Math.max(item.start - 0.2, before.start), hi: item.start + 0.03 };
  };
  items.forEach((item, i) => {
    const start = i === 0 ? 0 : item.start;
    const end = i + 1 < items.length ? items[i + 1].start : duration;
    if (item.type === 'sound' && typeof keep[i] === 'number') {
      if (keep[i] > 0) add(start, start + keep[i], join(i), fixed(start + keep[i]));
      return;
    }
    if (item.type !== 'pause') {
      if (keep[i]) add(start, end, join(i), join(i + 1));
      return;
    }
    // The first pause keeps its end, the last its start, and one between words both.
    const kept = keep[i];
    if (kept >= end - start - 1e-6) add(start, end, join(i), join(i + 1));
    else if (i === 0) add(end - kept, end, fixed(end - kept), join(i + 1));
    else if (i === items.length - 1) add(start, start + kept, join(i), fixed(start + kept));
    else {
      add(start, start + kept / 2, join(i), fixed(start + kept / 2));
      add(end - kept / 2, end, fixed(end - kept / 2), join(i + 1));
    }
  });
  return parts;
}

// The parts of the sound to keep, as [start, end] in samples. Each join goes to
// the quietest 10 ms between its lo and hi, read in 5 ms steps. Parts that come
// to touch are one.
export function placeJoins(parts, samples, channels, duration) {
  const length = Math.min(samples.length / channels, Math.round(duration * RATE));
  const half = RATE / 200;
  const level = (s) => {
    let sum = 0;
    for (let k = Math.max(0, s - half); k < Math.min(length, s + half); k++) {
      for (let c = 0; c < channels; c++) sum += samples[k * channels + c] ** 2;
    }
    return sum;
  };
  const place = (j) => {
    const step = RATE / 200;
    let best = Math.round(j.t * RATE);
    if (j.hi > j.lo) {
      let least = Infinity;
      for (let s = Math.round(j.lo * RATE); s <= Math.round(j.hi * RATE); s += step) {
        const l = level(s);
        if (l < least) [least, best] = [l, s];
      }
    }
    return Math.max(0, Math.min(length, best));
  };
  const out = [];
  for (const p of parts) {
    const a = place(p.start);
    const b = place(p.end);
    if (b <= a) continue;
    const prev = out.at(-1);
    if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

// The frames of the picture for each part of the sound, so that the picture
// keeps up with the sound: each part ends at the frame closest to where the sound
// has got to by then. The picture is never more than half a frame off.
export function partFrames(sound, fps) {
  let heard = 0;
  let shown = 0;
  return sound.map(([a, b]) => {
    heard += b - a;
    const first = Math.round((a / RATE) * fps);
    const count = Math.round((heard / RATE) * fps) - shown;
    shown += count;
    return [first, first + count];
  }).filter(([a, b]) => b > a);
}

// The kept sound, with a crossfade of FADE at each join: the part before fades
// out past its end while the part after fades in from before its start, both
// centered on the join, so the length stays the sum of the parts. `total` is the
// length to give it in samples, the length of the picture.
export function joinSound(samples, channels, parts, total) {
  const out = new Float32Array(total * channels);
  const length = samples.length / channels;
  const read = (s, c) => (s >= 0 && s < length ? samples[s * channels + c] : 0);
  let pos = 0;
  const joins = [];
  parts.forEach(([a, b], k) => {
    const n = Math.max(0, Math.min(b - a, total - pos));
    out.set(samples.subarray(a * channels, (a + n) * channels), pos * channels);
    if (k > 0) joins.push({ pos, end: parts[k - 1][1], start: a });
    pos += n;
  });
  const fade = Math.round(FADE * RATE);
  const half = Math.floor(fade / 2);
  for (const j of joins) {
    for (let n = 0; n < fade; n++) {
      const o = j.pos - half + n;
      if (o < 0 || o >= total) continue;
      const x = (n + 0.5) / fade;
      const gainOut = Math.cos((x * Math.PI) / 2);
      const gainIn = Math.sin((x * Math.PI) / 2);
      for (let c = 0; c < channels; c++) out[o * channels + c] = read(j.end - half + n, c) * gainOut + read(j.start - half + n, c) * gainIn;
    }
  }
  // A start or end inside the recording fades in or out over 5 ms.
  const edge = Math.round(0.005 * RATE);
  const ramp = (o, g) => { for (let c = 0; c < channels; c++) out[o * channels + c] *= g; };
  if (parts.length && parts[0][0] > 0) for (let n = 0; n < Math.min(edge, total); n++) ramp(n, n / edge);
  if (parts.length && parts.at(-1)[1] < length) for (let n = 0; n < Math.min(edge, pos); n++) ramp(pos - 1 - n, n / edge);
  return out;
}

// A WAV file of 32-bit float samples, `channels` interleaved.
export function writeFloatWav(file, samples, channels, rate = RATE) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 4, 28);
  head.writeUInt16LE(channels * 4, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

// The streams of a video that cut needs: picture and sound, its length and its
// frame rate.
async function videoInfo(file) {
  if (!fs.existsSync(file)) throw new ProjectError(`${file} does not exist`);
  const info = await probe(file).catch(() => {
    throw new ProjectError(`${file} is not a video that ffmpeg can read`);
  });
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new ProjectError(`${path.basename(file)} has no picture. cut edits a video by its speech.`);
  if (!a) throw new ProjectError(`${path.basename(file)} has no sound, so there is no speech to cut by.`);
  const rate = (r) => {
    const [n, d] = String(r ?? '').split('/').map(Number);
    return d ? n / d : n;
  };
  const fpsText = [v.avg_frame_rate, v.r_frame_rate].find((r) => rate(r) > 0 && rate(r) <= 240) ?? '30/1';
  return { duration: Number(info.format.duration) || Number(v.duration), fps: rate(fpsText), fpsText, channels: Math.min(2, a.channels || 1) };
}

// The saved transcript of a video, by the hash of the file and the language.
const transcriptFile = (sha256, language) => path.join(cacheRoot(), 'cut', `${sha256}-${language}.json`);

// The words of a recording, its quiet stretches and the level of each 10 ms.
// A transcript saved before the levels were kept gets them from the video.
async function transcript(video, sha256, language, { log, transcribe }) {
  const file = transcriptFile(sha256, language);
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (saved?.levels) return saved;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cut-'));
  try {
    const wav = path.join(dir, 'speech-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const { samples } = readWav(wav);
    let words = saved?.words;
    if (!words) {
      log(`listening to ${path.basename(video)}`);
      const heard = await transcribe(samples, { log, language });
      words = heard.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim().replace(/\s+/g, ' '), start: Math.round(w.start * 100) / 100, end: Math.round(w.end * 100) / 100 }));
    }
    const levels = soundLevels(samples, 16000).levels.map((l) => Math.round(l * 10) / 10);
    const result = { language, words, quiet: quietStretches(samples, 16000), levels };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result));
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --min-gap: seconds, 0.1 or more.
function checkMinGap(minGap) {
  if (minGap === null || minGap === undefined) return null;
  const n = Number(minGap);
  if (!Number.isFinite(n) || n < 0.1) throw new ProjectError(`--min-gap needs seconds of 0.1 or more, like --min-gap 0.3. Without it a pause is ${PAUSE} s or more.`);
  return Math.round(n * 100) / 100;
}

// cut <video>: writes the cut list. It won't write over one that is there,
// because that holds the edits, unless `force`. `minGap` shows shorter pauses and
// sounds.
export async function writeCut(file, { language = 'en', force = false, minGap = null, log = () => {}, transcribe = transcribeWords } = {}) {
  checkLanguage(language);
  minGap = checkMinGap(minGap);
  const video = path.resolve(file);
  const { duration } = await videoInfo(video);
  const { list } = cutFiles(video);
  const name = path.basename(video);
  if (fs.existsSync(list) && !force) throw new ProjectError(`${path.basename(list)} is already there and may hold your edits. Edit it and run "explainroo cut ${file} --apply", or add --force to write it again from the recording. When you edited it, --force moves it to ${path.basename(list).replace(/\.md$/, '.old.md')} first.`);
  const sha256 = sha256File(video);
  const { words, quiet, levels } = await transcript(video, sha256, language, { log, transcribe });
  if (!words.length) throw new ProjectError(`the speech model heard no words in ${name}, so there is nothing to cut by`);
  const items = cutItems(words, duration, quiet, { levels, ...gapSizes(minGap) });
  // An edited list moves aside before the new one takes its place.
  const old = fs.existsSync(list) && !writtenByCut(fs.readFileSync(list, 'utf8'), name, duration) ? keepOld(list) : null;
  fs.writeFileSync(list, cutListText(name, items, { sha256, language, minGap }));
  const pauses = items.filter((i) => i.type === 'pause');
  const sounds = items.filter((i) => i.type === 'sound');
  return { video, list, duration: Math.round(duration * 100) / 100, words: words.length, pauses: pauses.length, pauseSeconds: Math.round(pauses.reduce((n, p) => n + p.end - p.start, 0) * 10) / 10, sounds: sounds.length, soundsNearWords: sounds.filter((x) => x.holds).length, ...(minGap === null ? {} : { minGap }), ...(old ? { old } : {}) };
}

// Whether a cut list is still as cut wrote it, from the saved transcript its
// comment names. A list whose transcript isn't saved counts as edited.
function writtenByCut(text, name, duration) {
  const head = /video: .*, sha256 ([0-9a-f]+), language ([\w-]+)(?:, min gap ([\d.]+)s)?/.exec(text);
  if (!head) return false;
  const dir = path.join(cacheRoot(), 'cut');
  const saved = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(head[1]) && f.endsWith(`-${head[2]}.json`)) : null;
  if (!saved) return false;
  const { words, quiet, levels } = JSON.parse(fs.readFileSync(path.join(dir, saved), 'utf8'));
  const minGap = head[3] === undefined ? null : Number(head[3]);
  const items = cutItems(words, duration, quiet, { levels, ...gapSizes(minGap) });
  return cutListText(name, items, { sha256: saved.slice(0, saved.length - `-${head[2]}.json`.length), language: head[2], minGap }) === text.replace(/\r\n/g, '\n');
}

// Moves a cut list to <name>.cut.old.md, or <name>.cut.old-2.md and on when
// that is taken, and gives the new path.
function keepOld(list) {
  const base = list.slice(0, -'.md'.length);
  let to = `${base}.old.md`;
  for (let n = 2; fs.existsSync(to); n++) to = `${base}.old-${n}.md`;
  fs.renameSync(list, to);
  return to;
}

// The item that a kept word's join cut next to, as it stands in the cut list:
// a sound or word taken out right after the word, else right before it.
function cutNextTo(items, keep, i) {
  const gone = (k) => items[k] && items[k].type !== 'pause' && (keep[k] === false || typeof keep[k] === 'number');
  const name = (k) => (items[k].type === 'word' ? `${items[k].text}@${time(items[k].start)}` : gapToken(items[k]));
  if (gone(i + 1)) return { item: name(i + 1), side: 'after', type: items[i + 1].type };
  if (gone(i - 1)) return { item: name(i - 1), side: 'before', type: items[i - 1].type };
  return null;
}

// cut <video> --apply: the video as the cut list says, in <name>.cut.mp4 or
// `out`. The sound gets the loudness and peak limit of a rendered video. With
// `dryRun` it only listens to the joined sound and writes no file.
export async function applyCut(file, { out = null, dryRun = false, log = () => {}, transcribe = transcribeWords } = {}) {
  const video = path.resolve(file);
  const { duration, fps, fpsText, channels } = await videoInfo(video);
  const files = cutFiles(video);
  const name = path.basename(video);
  const listName = path.basename(files.list);
  if (!fs.existsSync(files.list)) throw new ProjectError(`${listName} is not there yet. Run "explainroo cut ${file}" first, then edit it.`);
  const text = fs.readFileSync(files.list, 'utf8');
  const head = /video: .*, sha256 ([0-9a-f]+), language ([\w-]+)(?:, min gap ([\d.]+)s)?/.exec(text);
  if (!head) throw new ProjectError(`${listName} has lost the line with "video:" in its comment, so cut can't tell which recording it belongs to. Run "explainroo cut ${file} --force" to write it again.`);
  const sha256 = sha256File(video);
  if (!sha256.startsWith(head[1])) throw new ProjectError(`${listName} was made from another version of ${name}. Run "explainroo cut ${file} --force" to write it again from this one.`);
  const { words, quiet, levels } = await transcript(video, sha256, head[2], { log, transcribe });
  const items = cutItems(words, duration, quiet, { levels, ...gapSizes(head[3] === undefined ? null : Number(head[3])) });
  const keep = readCutList(text, items, listName);
  const parts = keptParts(items, keep, duration);
  if (!parts.length) throw new ProjectError(`${listName} keeps nothing of ${name}`);

  const target = dryRun ? null : path.resolve(out ?? files.out);
  if (target === video) throw new ProjectError('--out has to be another file than the video you cut');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cut-'));
  try {
    log('reading the sound');
    const raw = path.join(dir, 'sound.f32');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-map', '0:a:0', '-ac', String(channels), '-ar', String(RATE), '-f', 'f32le', '-c:a', 'pcm_f32le', raw]);
    const bytes = fs.readFileSync(raw);
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4)));
    const sound = placeJoins(parts, samples, channels, duration);
    const frames = partFrames(sound, fps);
    const kept = frames.reduce((n, [a, b]) => n + b - a, 0) / fps;
    const joinedSound = joinSound(samples, channels, sound, Math.round(kept * RATE));
    const joined = path.join(dir, 'joined.wav');
    const mixed = path.join(dir, 'mixed.wav');
    writeFloatWav(joined, joinedSound, channels);
    if (!dryRun) {
      log('leveling the sound');
      await finishMix(joined, mixed, DEFAULTS.loudness, AUDIO_CODECS.mp4, { log, gain: true });
      log(`writing ${path.basename(target)}`);
      const select = frames.map(([a, b]) => `between(n\\,${a}\\,${b - 1})`).join('+');
      await ffmpeg(['-loglevel', 'error', '-i', video, '-i', mixed,
        '-filter_complex', `[0:v]fps=${fpsText},select='${select}',setpts=N/(${fpsText})/TB[v]`,
        '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', fpsText,
        ...AUDIO_CODECS.mp4, '-movflags', '+faststart', target]);
    }
    // Listen to the cut, for the words it should say.
    const wav = path.join(dir, 'cut-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', dryRun ? joined : mixed, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    log(dryRun ? 'listening to the cut' : `listening to ${path.basename(target)}`);
    const heard = await transcribe(readWav(wav).samples, { log, language: head[2] });
    const keptWords = items.flatMap((item, i) => (item.type === 'word' && keep[i] ? [i] : []));
    const speech = await compareCut(keptWords.map((i) => items[i].text), heard, kept, head[2]);
    // A time in the cut, in the recording.
    const original = (t) => {
      let at = Math.round(t * RATE);
      for (const [a, b] of sound) {
        if (at < b - a) return Math.round(((a + at) / RATE) * 100) / 100;
        at -= b - a;
      }
      return Math.round(duration * 100) / 100;
    };
    for (const m of speech.missing) {
      const i = keptWords[m.index];
      m.original = Math.round(items[i].start * 100) / 100;
      const next = cutNextTo(items, keep, i);
      if (next) m.next = next;
      delete m.index;
    }
    for (const x of speech.extra) x.original = original(x.time);
    const level = dryRun ? null : await loudness(target);
    return {
      video, list: files.list, out: target, ...(dryRun ? { dryRun: true } : {}),
      before: Math.round(duration * 100) / 100, after: Math.round(kept * 100) / 100,
      joins: sound.length - 1,
      parts: sound.map(([a, b]) => [Math.round((a / RATE) * 1000) / 1000, Math.round((b / RATE) * 1000) / 1000]),
      ...(level ? { loudness: { integrated: level.integrated, truePeak: level.truePeak, target: DEFAULTS.loudness } } : {}),
      speech,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What the speech model heard in the cut against the words the list kept, both
// ways: kept words it didn't hear, which a join may have clipped, and words it
// heard that the list doesn't keep, which may be left from a cut word.
export async function compareCut(said, heard, duration, language) {
  const kept = said.map((text) => ({ spoken: text, display: text }));
  const forward = await alignSpeech(kept, heard.words, duration, language);
  const back = await alignSpeech(heard.words.map((w) => ({ spoken: w.text, display: w.text })), said.map((text) => ({ text, start: 0, end: 0 })), duration, language);
  const at = (t) => Math.round(t * 10) / 10;
  return {
    matchRate: Math.round(forward.matchRate * 1000) / 1000,
    transcript: heard.text,
    missing: forward.words.flatMap((w, k) => (w.matched ? [] : [{ word: bareWord(said[k]), time: at(w.start), ...(w.heard ? { heard: w.heard } : {}), index: k }])),
    extra: back.words.flatMap((w, k) => (w.matched || !bareWord(heard.words[k].text) ? [] : [{ word: bareWord(heard.words[k].text), time: at(heard.words[k].start) }])),
  };
}

// The loudness a cut reached. It stays under the target only when the peak
// limit holds it there.
function loudnessLine({ integrated, truePeak, target }) {
  if (integrated === null || integrated === undefined) return '';
  const reached = `The sound is at ${integrated.toFixed(1)} LUFS, with its peak at ${dbtp(truePeak)}.`;
  if (integrated >= target - 0.5) return reached;
  return `${reached} Its loudest moments are far above the rest, so the peak limit of -1 dBTP holds it under ${target} LUFS.`;
}

// What cut prints.
export function formatCut(r) {
  if (r.after !== undefined) {
    const name = path.basename(r.video ?? 'the recording');
    const where = (w) => `"${w.word}" at ${w.time.toFixed(1)} s${w.original === undefined ? '' : ` (${w.original.toFixed(2)} s in ${name})`}`;
    const list = (l) => l.slice(0, 8).map(where).join(', ') + (l.length > 8 ? `, and ${l.length - 8} more` : '');
    const { missing, extra } = r.speech;
    const plain = missing.filter((w) => !w.next);
    const near = (x) => missing.some((w) => Math.abs(w.time - x.time) < 0.6);
    const lines = [
      r.dryRun ? `Dry run of ${path.basename(r.list)}, nothing written.` : r.out,
      `${r.before.toFixed(1)} s ${r.dryRun ? 'would cut' : 'cut'} to ${r.after.toFixed(1)} s, with ${r.joins} join${r.joins === 1 ? '' : 's'}. The speech model heard ${Math.round(r.speech.matchRate * 100)}% of the words the list keeps.`,
      ...missing.filter((w) => w.next).slice(0, 8).map((w) => `It didn't hear ${where(w)}. You deleted ${w.next.item} right ${w.next.side} it, and that may hold the ${w.next.side === 'after' ? 'end' : 'start'} of the word. Keep it${w.next.type === 'sound' ? ', or give it fewer seconds to keep part of it,' : ''} and try again.`),
      plain.length ? `It didn't hear ${list(plain)}. A join may cut into ${plain.length === 1 ? 'that word' : 'those words'}, so listen there.` : '',
      extra.length ? `It heard ${list(extra)}, which the list doesn't keep. ${extra.every(near) ? 'That may be what is left of a kept word it didn\'t hear, so listen there.' : 'That may be left from a word you cut, so listen there. If it is, delete the word next to it too.'}` : '',
      r.loudness ? loudnessLine(r.loudness) : '',
      r.dryRun ? `To write ${path.basename(cutFiles(r.video ?? 'video.mp4').out)}, run it again without --dry-run.` : `Check the video with: explainroo verify ${path.basename(r.out)}`,
    ];
    return lines.filter(Boolean).join('\n');
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const near = r.soundsNearWords ? `\n${r.soundsNearWords === 1 ? 'One sound starts' : `${r.soundsNearWords} sounds start`} right after a word and may hold the end of it, so listen before you delete ${r.soundsNearWords === 1 ? 'it' : 'them'}.` : '';
  const old = r.old ? `\nYour edited list is now ${path.basename(r.old)}, so you can copy your edits from there.` : '';
  return `${r.list}${old}\n${plural(r.words, 'word')}, ${plural(r.pauses, 'pause')} (${r.pauseSeconds} s) and ${plural(r.sounds, 'sound')} without words in ${r.duration.toFixed(1)} s. Delete words, pauses and sounds in it, then run: explainroo cut ${path.basename(r.video)} --apply${near}`;
}
