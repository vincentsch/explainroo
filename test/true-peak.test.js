// The finished sound: the limiter after loudness normalization, the true peak in
// every encoder, and what verify says about a peak.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUDIO_CODECS, PEAK_CEILING, ffmpeg, ffmpegVersion, finishMix, limiterFilter, loudness, normalizeLoudness } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { prepare } from '../src/pipeline.js';
import { verify } from '../src/qa.js';
import { readWav } from '../src/wav.js';
import { runCli, tinyProject } from './helpers/tiny-project.js';

const skip = !ffmpegVersion() && 'ffmpeg is not installed';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-peak-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Hi-hats at seven levels with plucked notes. Normalized to -14 LUFS and encoded
// to AAC the way render did before the limiter, this sound peaked above 0 dBTP
// with ffmpeg 6.1 and 7.0: the encoder turned a quiet hit into a click.
const HATS = '(2*random(0)-1)*exp(-mod(t,0.125)*70)*(0.05+0.95*mod(floor(t*8),7)/6)';
const PLUCKS = 'sin(2*PI*(330+110*mod(floor(t*4),3))*t)*exp(-mod(t,0.25)*18)*(0.2+0.8*mod(floor(t*4),5)/4)';

test('the finished mix stays at or under -1 dBTP in AAC, Opus and PCM, near the target loudness', { skip, timeout: 180000 }, async (t) => {
  const dir = temp(t);
  const input = path.join(dir, 'mix.wav');
  await ffmpeg(['-loglevel', 'error', '-filter_complex', `aevalsrc=exprs='${HATS}':s=48000:d=12,lowpass=f=8000,volume=0.8[h];aevalsrc=exprs='0.5*${PLUCKS}':s=48000:d=12[p];[h][p]amix=inputs=2:normalize=0`, '-ac', '2', '-c:a', 'pcm_s16le', input]);
  // MP4 and the web player's audio.m4a get AAC, WebM gets Opus and MOV gets PCM.
  for (const [format, ext] of [['mp4', 'm4a'], ['webm', 'webm'], ['mov', 'mov']]) {
    const norm = path.join(dir, `${format}-norm.wav`);
    await finishMix(input, norm, -14, AUDIO_CODECS[format]);
    const file = path.join(dir, `sound.${ext}`);
    await ffmpeg(['-loglevel', 'error', '-i', norm, ...AUDIO_CODECS[format], file]);
    const { integrated, truePeak } = await loudness(file);
    assert.ok(truePeak <= PEAK_CEILING, `${format}: the true peak is ${truePeak} dBTP`);
    assert.ok(Math.abs(integrated - -14) <= 1.5, `${format}: the loudness is ${integrated} LUFS`);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.peak.')), []);
  }
});

test('the limiter keeps the timing and the end of the sound, also on ffmpeg builds without its latency option', { skip }, async (t) => {
  const dir = temp(t);
  const input = path.join(dir, 'input.wav');
  // A quiet tone with a burst that goes over the ceiling in the middle.
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc=exprs='if(between(t,1,1.2),1.4,0.2)*sin(2*PI*1000*t)':s=192000:d=2", '-c:a', 'pcm_f32le', input]);
  const limit = async (latency) => {
    const out = path.join(dir, `limited-${latency}.wav`);
    await ffmpeg(['-loglevel', 'error', '-i', input, '-af', limiterFilter(PEAK_CEILING, latency), '-c:a', 'pcm_f32le', out]);
    return readWav(out).samples;
  };
  const before = readWav(input).samples;
  const padded = await limit(false);
  assert.equal(padded.length, before.length);
  // Far from the burst the tone passes unchanged, sample for sample, so it is not delayed.
  for (const [from, to] of [[0, 0.9], [1.5, 2]]) {
    for (let i = Math.round(from * 192000); i < Math.round(to * 192000); i++) assert.ok(Math.abs(padded[i] - before[i]) < 1e-6, `sample ${i}`);
  }
  assert.ok(padded.every((v) => Math.abs(v) <= 10 ** (PEAK_CEILING / 20) + 1e-6));
  if (limiterFilter(PEAK_CEILING).includes('latency=true')) assert.deepEqual(await limit(true), padded);
});

test('a mix under the ceiling sounds as before, and silence and a very short clip still finish', { skip }, async (t) => {
  const dir = temp(t);
  const tone = path.join(dir, 'tone.wav');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.1*sin(2*PI*440*t)*(1+0.5*sin(2*PI*t))':s=48000:d=3", '-ac', '2', '-c:a', 'pcm_s16le', tone]);
  await normalizeLoudness(tone, path.join(dir, 'before.wav'), -14);
  await finishMix(tone, path.join(dir, 'after.wav'), -14, AUDIO_CODECS.mp4);
  const before = readWav(path.join(dir, 'before.wav')).samples;
  const after = readWav(path.join(dir, 'after.wav')).samples;
  assert.equal(after.length, before.length);
  let signal = 0;
  let difference = 0;
  for (let i = 0; i < before.length; i++) {
    signal += before[i] ** 2;
    difference += (after[i] - before[i]) ** 2;
  }
  assert.ok(10 * Math.log10(difference / signal) < -60, `the difference is ${(10 * Math.log10(difference / signal)).toFixed(1)} dB`);

  // Silence and a clip under half a second have no loudness to measure.
  const silence = path.join(dir, 'silence.wav');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:a', 'pcm_s16le', silence]);
  const quiet = await finishMix(silence, path.join(dir, 'silence-norm.wav'), -14, AUDIO_CODECS.mp4);
  assert.equal(quiet.truePeak, -Infinity);
  assert.equal(readWav(path.join(dir, 'silence-norm.wav')).samples.length, 48000);
  // A tone at a quarter of the sample rate whose samples sit at full scale peaks 3 dB higher between them.
  const short = path.join(dir, 'short.wav');
  const fullScale = '0.999*sqrt(2)*sin(2*PI*12000*t+PI/4)';
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=exprs='${fullScale}|${fullScale}':s=48000:d=0.3`, '-c:a', 'pcm_f32le', short]);
  assert.ok((await loudness(short)).truePeak > 2);
  await finishMix(short, path.join(dir, 'short-norm.wav'), -14, AUDIO_CODECS.mov);
  assert.equal(readWav(path.join(dir, 'short-norm.wav')).samples.length, 14400);
  assert.ok((await loudness(path.join(dir, 'short-norm.wav'))).truePeak <= PEAK_CEILING);
});

test('verify warns about a true peak above -1 dBTP and fails one above 0 dBTP as clipping', { skip, timeout: 120000 }, async (t) => {
  const dir = tinyProject(t, {}, { narrated: false });
  // The timeline lets verify check the scenes, which have no narration to listen to.
  await prepare(loadProject(dir));
  const video = async (name, db) => {
    const file = path.join(dir, `${name}.mov`);
    await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=gray:s=320x180:r=24:d=1', '-f', 'lavfi', '-i', `aevalsrc=exprs='${10 ** (db / 20)}*sin(2*PI*1000*t)':s=48000:d=1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_f32le', '-shortest', file]);
    return file;
  };
  const peaks = (report) => report.issues.filter((i) => /true peak/.test(i.message));
  const under = await verify(loadProject(dir), { file: await video('under', -1.5) });
  assert.ok(under.loudness.truePeak <= -1.4, JSON.stringify(under.loudness));
  assert.deepEqual(peaks(under), []);

  const high = await verify(loadProject(dir), { file: await video('high', -0.5) });
  assert.deepEqual(peaks(high).map((i) => i.level), ['warn']);
  assert.match(peaks(high)[0].message, /^the true peak is -0\.[456] dBTP, above the ceiling of -1\.0 dBTP$/);

  const clipping = await video('clipping', 0.5);
  const failed = await verify(loadProject(dir), { file: clipping });
  assert.deepEqual(peaks(failed).map((i) => i.level), ['error']);
  assert.match(peaks(failed)[0].message, /^the true peak is \+0\.[456] dBTP, above 0 dBTP, so the sound is clipping\. Render the video again/);
  assert.match(peaks(failed)[0].message, /lower "loudness" in video\.json/);
  assert.equal(typeof failed.loudness.truePeak, 'number');

  const cli = await runCli(['verify', dir, '--file', clipping]);
  assert.equal(cli.code, 1, cli.text);
  assert.match(cli.stdout, /, true peak \+0\.[456] dBTP\n/);
  assert.match(cli.stdout, /^ERROR the true peak is \+0\.[456] dBTP, above 0 dBTP, so the sound is clipping/m);
  const warned = await runCli(['verify', dir, '--file', path.join(dir, 'high.mov')]);
  assert.equal(warned.code, 0, warned.text);
  assert.match(warned.stdout, /^WARN {2}the true peak is -0\.[456] dBTP, above the ceiling of -1\.0 dBTP$/m);
});
