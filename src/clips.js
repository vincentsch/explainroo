import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe } from './ffmpeg.js';

export const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i;

// The file in each folder of build/clips/ that names the video its frames come from.
export const CLIP_SOURCE = 'source.json';

// Takes out the frames in build/clips/ of the video `src`, a path like
// "assets/recordings/tour.webm", except those in the folder `keep`. A folder
// for the same file at another frame rate stays, as its frames still match.
export function dropClipFrames(projectDir, src, keep = null) {
  const root = path.join(projectDir, 'build', 'clips');
  // Never through a link, which could lead out of the project.
  if (![path.dirname(root), root].every((p) => fs.lstatSync(p, { throwIfNoEntry: false })?.isDirectory())) return [];
  const kept = keep ? clipSource(path.join(root, keep)) : null;
  const dropped = [];
  for (const name of fs.readdirSync(root)) {
    if (name === keep) continue;
    const source = clipSource(path.join(root, name));
    if (source?.src !== src || (kept && source.content === kept.content)) continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    dropped.push(name);
  }
  return dropped;
}

function clipSource(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, CLIP_SOURCE), 'utf8')); } catch { return null; }
}

export async function extractClip(file, dir, fps) {
  const input = await probe(file);
  const video = input.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('this clip has no video. Use an MP4, MOV, WebM or M4V with video.');
  await ffmpeg(['-loglevel', 'error', '-i', file, '-map', '0:v:0', '-vf', `fps=${fps},scale=min(1920\\,iw):-1`, '-q:v', '2', '-threads', '1', '-start_number', '0', path.join(dir, '%08d.jpg')]);
  const frames = fs.readdirSync(dir).filter((n) => n.endsWith('.jpg')).length;
  if (!frames) throw new Error('this clip has no frames. Use a video with at least one frame.');
  const frame = await probe(path.join(dir, '00000000.jpg'));
  const { width, height } = frame.streams[0];
  const hasAudio = input.streams.some((s) => s.codec_type === 'audio');
  if (hasAudio) await ffmpeg(['-loglevel', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(dir, 'audio.wav')]);
  return { frames, fps, width, height, duration: frames / fps, hasAudio, still: await stillSpans(dir, fps, frames) };
}

// The stretches of half a second or more where the picture of the frames in
// `dir` holds still, as [from, to] in seconds of the clip. check doesn't count
// a clip as something happening while it shows a still picture. Each frame is
// read as a grid of 32 by 18 cells. A frame shows something new when one of
// its cells differs clearly from every frame of the last one and a half
// seconds, and the picture before it doesn't come back in the one and a half
// seconds after: a typed letter does, and a blinking cursor doesn't.
export async function stillSpans(dir, fps, frames) {
  const duration = frames / fps;
  const ms = (t) => Math.round(t * 1000) / 1000;
  if (frames <= 1) return [[0, ms(duration)]];
  const [W, H] = [32, 18];
  const { stdout } = await ffmpeg(['-loglevel', 'error', '-framerate', String(fps), '-start_number', '0', '-i', path.join(dir, '%08d.jpg'), '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { binary: true });
  const n = Math.floor(stdout.length / (W * H));
  const differs = (k, j) => {
    for (let i = 0; i < W * H; i++) if (Math.abs(stdout[k * W * H + i] - stdout[j * W * H + i]) > STILL_STEP) return true;
    return false;
  };
  const back = Math.max(1, Math.round(fps * 1.5));
  const changed = (k) => {
    for (let j = Math.max(0, k - back); j < k; j++) if (!differs(k, j)) return false;
    for (let j = k + 1; j < Math.min(n, k + 1 + back); j++) if (!differs(k - 1, j)) return false;
    return true;
  };
  const spans = [];
  let from = 0;
  for (let k = 1; k <= n; k++) {
    if (k < n && !changed(k)) continue;
    if ((k - from) / fps >= 0.5) spans.push([from / fps, k === n ? duration : k / fps]);
    from = k;
  }
  return spans.map(([a, b]) => [ms(a), ms(Math.min(b, duration))]);
}

// How much a cell of the grid may change, of 255, while the picture holds still.
const STILL_STEP = 8;
