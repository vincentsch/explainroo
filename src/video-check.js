// check and verify for any video file, made with explainroo or with any other
// tool. Without a project there are no scenes to draw, so everything is read
// from the file: blank, black and frozen stretches of the picture, silence,
// loudness and true peak of the sound, text too small for a phone in frames
// taken from the video, and, with a script, how much of it the speech model hears.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dbtp, ffmpeg, ffmpegPath, loudness, probe, PEAK_CEILING } from './ffmpeg.js';
import { blackSegments, missedWords, nearlyAdvice, nearlyText, silentStretches, timedNear, unconfirmedText, verdictOf } from './qa.js';
import { textLines } from './text-size.js';
import { playbackTextIssue } from '../engine/readability.js';
import { transcribeWords } from './models.js';
import { alignSpeech } from './align.js';
import { parseScript, ScriptError, tokenizeNarration } from './script.js';
import { DEFAULTS, ProjectError, checkLanguage } from './project.js';
import { sha256File } from './history.js';
import { readWav } from './wav.js';

// The files check and verify take without a project.
export const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv)$/i;

export function isVideoFile(arg) {
  return typeof arg === 'string' && VIDEO_FILE.test(arg) && fs.existsSync(arg) && fs.statSync(arg).isFile();
}

// Whether a video file belongs to an explainroo project, so explainroo drew its
// text: render and package write into a project, up to three folders below its
// video.json, like out/package/tiktok/.
export function inProject(file) {
  let dir = path.dirname(path.resolve(file));
  for (let k = 0; k < 4; k++) {
    if (fs.existsSync(path.join(dir, 'video.json'))) return true;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return false;
}

// The words of a script to compare the speech with. A script.md of explainroo is
// read with its scenes and its {shown|spoken} words, any other file as plain text.
export function scriptWords(file, language = 'en') {
  if (!fs.existsSync(file)) throw new ProjectError(`${file} does not exist. --script takes the text the video says, like script.md or a .txt file.`);
  const text = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  let units;
  try {
    units = /^##\s/m.test(text)
      ? parseScript(text, { language, file: name }).scenes.flatMap((sc) => sc.units)
      : tokenizeNarration(text.replace(/^#.*$/gm, ' ').replace(/\s+/g, ' ').trim(), 0, language);
  } catch (e) {
    if (e instanceof ScriptError) throw new ProjectError(`${name}: ${e.detail}`);
    throw e;
  }
  const words = units.filter((u) => u.type === 'word').map((u) => ({ spoken: u.spoken, display: u.display }));
  if (!words.length) throw new ProjectError(`${name} has no words to compare the speech with`);
  return words;
}

// How far apart the frames are that check reads for text: 1 second, and for a
// video longer than 2 minutes as far apart as 120 frames allow.
export function frameStep(duration) {
  return Math.max(1, Math.round((duration / 120) * 10) / 10);
}

// `script` is a file with the words the video says. `transcribe` replaces Whisper
// in tests.
export async function checkVideo(file, { script = null, language = 'en', viewWidth = null, step = null, log = () => {}, transcribe = transcribeWords } = {}) {
  const video = path.resolve(file);
  if (!fs.existsSync(video)) throw new ProjectError(`${file} does not exist`);
  if (viewWidth !== null && (!Number.isFinite(viewWidth) || viewWidth <= 0)) throw new ProjectError('--view-width must be a positive number');
  if (step !== null && (!Number.isFinite(step) || step <= 0)) throw new ProjectError('--step must be a positive number of seconds');
  checkLanguage(language);
  const words = script ? scriptWords(script, language) : null;
  const issues = [];
  const info = await probe(video).catch(() => {
    throw new ProjectError(`${file} is not a video that ffmpeg can read`);
  });
  const stream = info.streams.find((s) => s.codec_type === 'video');
  const v = stream ? { ...stream, ...shownSize(stream) } : null;
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format.duration) || Number(v?.duration) || 0;
  if (!v) issues.push({ level: 'error', t: null, message: 'the file has no video stream' });
  if (!a) issues.push({ level: 'warn', t: null, message: 'the file has no sound' });

  // The sound: loudness and true peak, against what explainroo aims for.
  const target = DEFAULTS.loudness;
  const loud = a ? await loudness(video) : null;
  if (loud && loud.integrated !== null && Math.abs(loud.integrated - target) > 1.5) {
    issues.push({ level: 'warn', t: null, message: `loudness is ${loud.integrated} LUFS, target is ${target}. YouTube, TikTok and Instagram play videos at about ${target} LUFS.` });
  }
  if (loud?.truePeak > 0) issues.push({ level: 'error', t: null, message: `the true peak is ${dbtp(loud.truePeak)}, above 0 dBTP, so the sound is clipping. Lower the sound by ${Math.ceil(loud.truePeak - PEAK_CEILING)} dB or more, or put a limiter on it.` });
  else if (loud?.truePeak > PEAK_CEILING) issues.push({ level: 'warn', t: null, message: `the true peak is ${dbtp(loud.truePeak)}, above the ceiling of ${dbtp(PEAK_CEILING)}` });
  let silences = [];
  if (a) {
    log('listening for silence');
    silences = await silentStretches(video, duration);
    for (const [s, e] of silences) issues.push({ level: 'hint', t: round1(s), message: `near silence from ${s.toFixed(1)}s to ${e.toFixed(1)}s` });
  }

  // The picture: black and frozen stretches over every frame, then blank frames
  // and small text in frames taken `step` seconds apart.
  let blacks = [];
  let frozen = [];
  let blanks = [];
  let text = null;
  if (v) {
    log('looking for black and frozen frames');
    blacks = await blackSegments(video);
    for (const [s, e] of blacks) issues.push({ level: 'warn', t: round1(s), message: `black frames from ${s.toFixed(2)}s to ${e.toFixed(2)}s` });
    const gap = step ?? frameStep(duration);
    const frames = await readFrames(video, { width: v.width, height: v.height, step: gap, log });
    blanks = blankStretches(frames, gap, duration);
    for (const [s, e] of blanks) issues.push({ level: 'warn', t: round1(s), message: `blank frames, all one color, from ${s.toFixed(1)}s to ${e.toFixed(1)}s` });
    frozen = (await frozenStretches(video, duration)).filter(([s, e]) => ![...blacks, ...blanks].some(([bs, be]) => bs < e && be > s));
    for (const [s, e] of frozen) issues.push({ level: 'hint', t: round1(s), message: `the picture stands still from ${s.toFixed(1)}s to ${e.toFixed(1)}s` });
    const drawn = inProject(video);
    const small = smallText(frames, { width: v.width, height: v.height, viewWidth });
    for (const s of small) {
      // Text in a recording from elsewhere may be part of it, like a clock in a
      // screen recording, so it is only a hint there.
      if (!drawn && s.kind !== 'player') Object.assign(s, { level: 'hint', recording: true });
      const issue = textIssue(s);
      s.message = issue.message;
      issues.push(issue);
    }
    text = { frames: frames.length, step: gap, small };
  }

  // The speech, against the script.
  let speech = null;
  if (words && a) {
    const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-check-')), 'speech-16k.wav');
    try {
      await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      const { samples } = readWav(wav);
      log(`comparing the speech with ${path.basename(script)}`);
      const heard = await transcribe(samples, { log, language });
      const aligned = await alignSpeech(words, heard.words, duration, language);
      speech = { matchRate: Math.round(aligned.matchRate * 1000) / 1000, transcript: heard.text, nearly: timedNear(words, aligned, 0), unconfirmed: missedWords(words, aligned, 0, null) };
    } finally {
      fs.rmSync(path.dirname(wav), { recursive: true, force: true });
    }
    if (speech.unconfirmed.length) issues.push({ level: 'warn', t: null, message: unconfirmedText(speech.unconfirmed).replace('in the final mix', 'in the video') });
    if (speech.matchRate < 0.85) issues.push({ level: 'warn', t: null, message: `only ${Math.round(speech.matchRate * 100)}% of ${path.basename(script)} was understood in the video. Check that it is the script of this video, and listen where the words above are.` });
  } else if (words) issues.push({ level: 'warn', t: null, message: `the file has no sound, so the speech can't be compared with ${path.basename(script)}` });

  const order = { error: 0, warn: 1, hint: 2 };
  issues.sort((x, y) => order[x.level] - order[y.level] || (x.t ?? -1) - (y.t ?? -1));
  return {
    file: video,
    sha256: sha256File(video),
    duration: Math.round(duration * 100) / 100,
    video: v ? { width: v.width, height: v.height, fps: v.r_frame_rate, codec: v.codec_name } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
    loudness: loud,
    blackSegments: blacks,
    blankSegments: blanks,
    frozen,
    silences,
    text,
    speech,
    issues,
    ...verdictOf(issues),
  };
}

const round1 = (t) => Math.round(t * 10) / 10;

// The width and height a player shows. A phone stores a video filmed upright as
// a wide one turned by 90 degrees, and ffmpeg turns it back when it reads frames.
function shownSize(v) {
  const turn = Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0);
  return Math.abs(turn) % 180 === 90 ? { width: v.height, height: v.width } : { width: v.width, height: v.height };
}

// The stretches where the picture doesn't change for 3 seconds or more.
async function frozenStretches(video, duration) {
  const { stderr } = await ffmpeg(['-nostats', '-i', video, '-vf', 'freezedetect=n=-60dB:d=3', '-an', '-f', 'null', '-']);
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? duration]);
}

// Frames `step` seconds apart, from the start, each with whether it is blank and
// the lines of text in it. A frame bigger than 1080 pixels on its short side is
// read at that size, and the sizes are given in the video's own pixels.
function readFrames(video, { width, height, step, log }) {
  const scale = Math.min(1, 1080 / Math.min(width, height));
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);
  const back = width / w;
  const size = w * h;
  log(`reading frames ${step} s apart for blank frames and small text`);
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', video, '-an', '-vf', `fps=${1 / step},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-'];
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const frames = [];
    let frame = Buffer.alloc(size);
    let filled = 0;
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (chunk) => {
      for (let at = 0; at < chunk.length;) {
        const n = Math.min(size - filled, chunk.length - at);
        chunk.copy(frame, filled, at, at + n);
        filled += n;
        at += n;
        if (filled < size) continue;
        frames.push(readFrame(frame, w, h, back, round1(frames.length * step)));
        frame = Buffer.alloc(size);
        filled = 0;
      }
    });
    child.on('error', (e) => reject(new Error(`ffmpeg could not start: ${e.message}. Install ffmpeg or set EXPLAINROO_FFMPEG.`)));
    child.on('close', (code) => (code === 0 ? resolve(frames) : reject(new Error(`ffmpeg could not read the frames of ${path.basename(video)} (${code}): ${err.slice(-400)}`))));
  });
}

// One frame: whether it is all one color, other than black, and its lines of text.
function readFrame(gray, w, h, back, t) {
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < gray.length; i++) {
    sum += gray[i];
    squares += gray[i] * gray[i];
  }
  const mean = sum / gray.length;
  // Black frames are found over every frame, so a dark one doesn't count here.
  const blank = mean > 40 && Math.sqrt(Math.max(0, squares / gray.length - mean * mean)) < 2;
  const lines = blank ? [] : textLines(gray, w, h).map((l) => ({
    size: Math.round(l.size * back * 10) / 10,
    box: [l.x0, l.y0, l.x1, l.y1].map((n) => Math.round(n * back)),
  }));
  return { t, blank, lines };
}

// Stretches of blank frames, two frames in a row or more.
function blankStretches(frames, step, duration) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].blank) continue;
    let j = i;
    while (j + 1 < frames.length && frames[j + 1].blank) j++;
    if (j > i) out.push([frames[i].t, Math.min(duration, frames[j].t + step)]);
    i = j;
  }
  return out;
}

// Text that is too small, by the rules check uses for a project's own text. Text
// under 2.2% of the frame's short side is hard to read anywhere. In a tall or
// square frame, which people watch on a phone, text under 40 pixels at 1080p is
// small. With a player width, text under 16 pixels at that width is too small
// there. Frames in a row with small text make one stretch, with its smallest line
// and the most lines one of its frames has.
export function smallText(frames, { width, height, viewWidth = null }) {
  const short = Math.min(width, height);
  const least = Math.round(short * 0.022);
  const readable = height >= width ? Math.round((40 * short) / 1080) : 0;
  const kinds = [
    { kind: 'small', level: 'warn', limit: least, test: (l) => Math.round(l.size) < least },
    { kind: 'phone', level: 'hint', limit: readable, test: (l) => Math.round(l.size) >= least && Math.round(l.size) < readable },
    ...(viewWidth ? [{ kind: 'player', level: 'warn', limit: 16, viewWidth, test: (l) => !!playbackTextIssue({ text: '', size: l.size, alpha: 1, x0: l.box[0], y0: l.box[1], x1: l.box[2], y1: l.box[3] }, width, height, viewWidth) }] : []),
  ];
  const out = [];
  for (const k of kinds) {
    let run = null;
    for (const f of frames) {
      const hit = f.lines.filter(k.test);
      if (!hit.length) {
        run = null;
        continue;
      }
      const smallest = hit.reduce((m, l) => (l.size < m.size ? l : m));
      if (!run) {
        run = { kind: k.kind, level: k.level, limit: k.limit, ...(k.viewWidth ? { viewWidth: k.viewWidth, shown: null } : {}), from: f.t, to: f.t, size: Infinity, lines: 0 };
        out.push(run);
      }
      run.to = f.t;
      run.lines = Math.max(run.lines, hit.length);
      if (smallest.size < run.size) Object.assign(run, { size: smallest.size, at: f.t, box: smallest.box });
      if (k.viewWidth) run.shown = Math.round(run.size * Math.min(1, k.viewWidth / width) * 10) / 10;
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

// The finding of a stretch of small text: when, how many lines a frame has at
// most, where the smallest line is, how tall it is and what the rule asks for.
function textIssue(s) {
  const [x0, y0, x1, y1] = s.box;
  const when = s.from === s.to ? `at ${s.at.toFixed(1)}s` : `from ${s.from.toFixed(1)}s to ${s.to.toFixed(1)}s`;
  const where = `${s.lines > 1 ? `${s.lines} lines, and the smallest` : 'the text'} at ${x0},${y0} to ${x1},${y1}`;
  const px = Math.round(s.size);
  const at = `at ${s.at.toFixed(1)}s`;
  const rule = s.kind === 'small' ? `${where} is about ${px}px tall ${at}, hard to read (use at least ${s.limit}px)`
    : s.kind === 'phone' ? `${where} is about ${px}px tall ${at}, small on a phone, where text reads best at ${s.limit}px and more`
      : `${where} shows about ${s.shown.toFixed(1)}px tall ${at} in a ${s.viewWidth}px wide player, too small there (aim for at least ${s.limit}px)`;
  if (s.recording) return { level: s.level, t: s.at, message: `small text in the video ${when}: ${rule.replace(/, hard to read \(use at least (\d+)px\)$/, ', under the $1px that reads well')}. If it came with the recording, it may be fine.` };
  return { level: s.level, t: s.at, message: `small text ${when}: ${rule}` };
}

// What check and verify print for a video file: the file, its frames and speech,
// each finding, and the verdict last.
export function formatVideoCheck(r) {
  const nearly = r.speech?.nearly?.length ? `, ${nearlyText(r.speech.nearly)}. ${nearlyAdvice(r.speech.nearly)}` : '';
  return [
    `${r.file}: ${r.duration}s, ${r.video ? `${r.video.width}x${r.video.height}` : 'no video'}, ${r.loudness ? `loudness ${r.loudness.integrated ?? '?'} LUFS, true peak ${dbtp(r.loudness.truePeak)}` : 'no sound'}`,
    r.text ? `read ${r.text.frames} frame${r.text.frames === 1 ? '' : 's'}, ${r.text.step} s apart, for blank frames and small text` : '',
    r.speech ? `speech understood: ${Math.round(r.speech.matchRate * 100)}% of the script${nearly}` : '',
    ...r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.message}`),
    r.verdict,
  ].filter(Boolean).join('\n');
}
