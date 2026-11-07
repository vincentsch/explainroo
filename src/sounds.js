// Music and sound files from assets/. ffmpeg decodes them to one format the page
// can always read, and measures how loud they are.
import fs from 'node:fs';
import { ffmpeg, probe, loudness } from './ffmpeg.js';
import { ProjectError } from './errors.js';

export const SOUND_RATE = 48000;

// Writes `out` as a 48 kHz stereo WAV. Floats keep the peaks of a loud track that
// a lossy format has pushed past full scale, so its level can come down cleanly.
export async function decodeSound(file, out, name = file) {
  const temp = `${out}.${process.pid}.tmp.wav`;
  try {
    const input = await probe(file);
    if (!input.streams.some((s) => s.codec_type === 'audio')) throw new ProjectError(`${name} has no sound in it. Use a wav, mp3, m4a, aac, flac, ogg or opus file.`);
    await ffmpeg(['-loglevel', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', String(SOUND_RATE), '-c:a', 'pcm_f32le', temp]);
    const { integrated } = await loudness(temp);
    fs.renameSync(temp, out);
    const { format } = await probe(out);
    return { lufs: integrated, duration: Number(format.duration) };
  } catch (e) {
    // A code means ffmpeg itself could not start, and that message says what to do.
    if (e instanceof ProjectError || e.code) throw e;
    throw new ProjectError(`${name} could not be read as a sound file. Use a wav, mp3, m4a, aac, flac, ogg or opus file.`);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
