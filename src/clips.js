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
  return { frames, fps, width, height, duration: frames / fps, hasAudio };
}
