import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectError } from './project.js';
import { alignWords } from './align.js';
import { ffmpeg, probe, normalizeLoudness } from './ffmpeg.js';
import { readWav, writeWav } from './wav.js';

const AUDIO_FILE = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;
// Four Kokoro scenes from how-dns-works measured -22.0 to -22.5 LUFS.
const RECORDING_LUFS = -22.3;

export function recordingFiles(project) {
  const src = project.config.voice.src;
  const file = path.join(project.dir, src);
  const assets = path.join(fs.realpathSync(project.dir), 'assets');
  const inside = (p) => fs.realpathSync(p).startsWith(assets + path.sep);
  if (!fs.existsSync(file)) throw new ProjectError(`${src} is missing. Put the recording in assets/ and check voice.src.`);
  if (!inside(file)) throw new ProjectError('recordings must stay inside assets/, including symlinks');
  const folder = fs.statSync(file).isDirectory();
  if (!folder && !AUDIO_FILE.test(file)) throw new ProjectError('recordings must be wav, mp3, m4a, aac, flac, ogg or opus files');
  const files = {};
  const hashes = new Map();
  const missing = [];
  const names = folder ? fs.readdirSync(file).sort() : [];
  for (const scene of project.script.scenes) {
    if (!scene.units.some((u) => u.type === 'word')) continue;
    const name = names.find((n) => path.parse(n).name === scene.id && AUDIO_FILE.test(n) && fs.existsSync(path.join(file, n)) && fs.statSync(path.join(file, n)).isFile());
    if (folder && !name) { missing.push(scene.id); continue; }
    const p = folder ? path.join(file, name) : file;
    if (!inside(p)) throw new ProjectError('recordings must stay inside assets/, including symlinks');
    if (!hashes.has(p)) hashes.set(p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    files[scene.id] = { file: p, hash: hashes.get(p) };
  }
  if (missing.length) throw new ProjectError(`missing scene recordings in ${src}: ${missing.join(', ')}. Add <scene-id>.<ext> for each scene with narration.`);
  return { folder, files };
}

function tempo(speed) {
  const filters = [];
  while (speed < 0.5) { filters.push('atempo=0.5'); speed /= 0.5; }
  while (speed > 2) { filters.push('atempo=2'); speed /= 2; }
  if (speed !== 1) filters.push(`atempo=${speed}`);
  return filters;
}

export async function decodeRecording(file, build, speed) {
  const info = await probe(file);
  const stream = info.streams.find((s) => s.codec_type === 'audio');
  if (!stream) throw new ProjectError('the recording has no audio. Choose an audio file in voice.src.');
  const sampleRate = Math.min(48000, Number(stream.sample_rate));
  const dir = fs.mkdtempSync(path.join(build, 'recording-'));
  try {
    const wav = path.join(dir, 'decoded.wav');
    const filters = tempo(speed);
    await ffmpeg(['-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate),
      ...(filters.length ? ['-af', filters.join(',')] : []), '-c:a', 'pcm_s16le', wav]);
    return readWav(wav);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function saveRecording(file, samples, sampleRate) {
  const dir = fs.mkdtempSync(path.join(path.dirname(file), 'recording-'));
  try {
    const input = path.join(dir, 'input.wav');
    writeWav(input, samples, sampleRate);
    await normalizeLoudness(input, file, RECORDING_LUFS, sampleRate);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function recordingCuts(scenes, heard, duration) {
  const spoken = scenes.map((scene) => ({ scene, words: scene.units.filter((u) => u.type === 'word') })).filter((s) => s.words.length);
  const aligned = alignWords(spoken.flatMap((s) => s.words), heard, duration).words;
  let offset = 0;
  const spans = spoken.map(({ scene, words }) => {
    const times = aligned.slice(offset, offset + words.length);
    offset += words.length;
    return { scene, words: times, first: times[0].start, last: times.at(-1).end };
  });
  return spans.map((s, i) => {
    const left = i ? (spans[i - 1].last + s.first) / 2 : 0;
    const right = i + 1 < spans.length ? (s.last + spans[i + 1].first) / 2 : duration;
    return { scene: s.scene, words: s.words, start: Math.max(0, left, s.first - 0.15), end: Math.min(duration, right, s.last + 0.15) };
  });
}
