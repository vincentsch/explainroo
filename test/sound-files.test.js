// Music and sound files in the mix, measured without a browser. The fixtures have
// a different tone left and right, and another tone for the sound file.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeWav, renderSoundtrack } from '../engine/audio/soundtrack.js';
import { parseWav } from '../engine/audio/pcm.js';
import { ffmpeg, loudness } from '../src/ffmpeg.js';
import { decodeSound, SOUND_RATE } from '../src/sounds.js';
import { loadProject, normalizeConfig, ProjectError } from '../src/project.js';

const SR = 8000;
const LEFT = 440;
const RIGHT = 660;
const SOUND = 1000;

function tone(freq, seconds, amp = 0.3, sr = SR) {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
}

const music = (seconds, amp) => [tone(LEFT, seconds, amp), tone(RIGHT, seconds, amp)];

// How strong one frequency is between two times, as the size of a sine wave.
function level(samples, freq, from, to, sr = SR) {
  let re = 0;
  let im = 0;
  const start = Math.round(from * sr);
  const end = Math.round(to * sr);
  for (let i = start; i < end; i++) {
    re += samples[i] * Math.cos((2 * Math.PI * freq * i) / sr);
    im += samples[i] * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return (2 * Math.hypot(re, im)) / (end - start);
}

const peak = (samples, from, to, sr = SR) => samples.subarray(Math.round(from * sr), Math.round(to * sr)).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const db = (a, b) => 20 * Math.log10(a / b);

async function mix(options) {
  const buffer = await renderSoundtrack({ sampleRate: SR, ...options });
  return { L: buffer.getChannelData(0), R: buffer.getChannelData(1), buffer };
}

test('a music file plays with its own two channels, and left and right stay different', async () => {
  const { L, R } = await mix({ duration: 6, musicFile: { data: music(6), sampleRate: SR, lufs: -32, volume: 0.5 } });
  assert.ok(level(L, LEFT, 3, 4) > 0.2, 'the left tone is in the left channel');
  assert.ok(level(R, RIGHT, 3, 4) > 0.2, 'the right tone is in the right channel');
  assert.ok(level(L, RIGHT, 3, 4) < 0.005, 'the right tone stays out of the left channel');
  assert.ok(level(R, LEFT, 3, 4) < 0.005, 'the left tone stays out of the right channel');
});

test('a music file is lower during a voice span than outside one', async () => {
  const { L, R } = await mix({ duration: 8, voiceSpans: [{ start: 3, end: 5 }], musicFile: { data: music(8), sampleRate: SR, lufs: -32, volume: 0.5 } });
  for (const [channel, freq] of [[L, LEFT], [R, RIGHT]]) {
    const during = level(channel, freq, 3.5, 4.5);
    const outside = level(channel, freq, 1.6, 2.4);
    assert.ok(Math.abs(db(during, outside) + 8) < 0.5, `about 8 dB lower, measured ${db(during, outside).toFixed(1)} dB`);
  }
});

test('the measured level sets the gain: a loud file comes down, a quiet one comes up, and volume works on top', async () => {
  const measure = async (lufs, volume, amp = 0.3) => level((await mix({ duration: 6, musicFile: { data: music(6, amp), sampleRate: SR, lufs, volume } })).L, LEFT, 3, 4);
  const atTarget = await measure(-32, 0.5);
  assert.ok(Math.abs(atTarget - 0.3) < 0.01, 'a file already at the level stays where it is');
  assert.ok(Math.abs(db(await measure(-8, 0.5), atTarget) + 24) < 0.2, 'a file measured 24 LU louder comes down 24 dB');
  assert.ok(Math.abs(db(await measure(-44, 0.5, 0.03), await measure(-32, 0.5, 0.03)) - 12) < 0.2, 'a file measured 12 LU quieter comes up 12 dB');
  assert.ok(Math.abs(db(await measure(-32, 0.25), atTarget) + 6) < 0.2, 'half the volume is 6 dB lower');
  assert.equal(await measure(-8, 0), 0);
});

test('silence and a file too short to measure are not turned up', async () => {
  for (const lufs of [-70, null]) {
    const { L } = await mix({ duration: 6, musicFile: { data: music(6, 0.01), sampleRate: SR, lufs, volume: 0.5 } });
    assert.ok(level(L, LEFT, 3, 4) < 0.011, String(lufs));
  }
});

test('music shorter than the video loops, unless loop is false', async () => {
  const data = music(2);
  const looped = await mix({ duration: 8, musicFile: { data, sampleRate: SR, lufs: -32, volume: 0.5, loop: true } });
  assert.ok(level(looped.L, LEFT, 2.2, 2.8) > 0.25, 'the second pass plays');
  assert.ok(level(looped.L, LEFT, 4.2, 4.8) > 0.25, 'the third pass plays');
  const byDefault = await mix({ duration: 8, musicFile: { data, sampleRate: SR, lufs: -32, volume: 0.5 } });
  assert.deepEqual(byDefault.L, looped.L);
  const once = await mix({ duration: 8, musicFile: { data, sampleRate: SR, lufs: -32, volume: 0.5, loop: false } });
  assert.ok(level(once.L, LEFT, 1.6, 1.9) > 0.25, 'it plays once');
  assert.equal(peak(once.L, 2.1, 7.9), 0, 'then it stops');
});

test('a loop has no click at the seam, and music fades out at the end of the video', async () => {
  // A square-ish signal that ends far from where it starts would click if it wrapped hard.
  const data = [new Float32Array(SR).fill(0.3), new Float32Array(SR).fill(0.3)];
  const { L } = await mix({ duration: 6, musicFile: { data, sampleRate: SR, lufs: -32, volume: 0.5 } });
  let jump = 0;
  for (let i = 3 * SR - 200; i < 3 * SR + 200; i++) jump = Math.max(jump, Math.abs(L[i] - L[i - 1]));
  assert.ok(jump < 0.05, `the biggest step at the seam is ${jump}`);
  // A longer file: it is at full level, then it has faded to nothing at the very end.
  const long = await mix({ duration: 20, musicFile: { data: music(60), sampleRate: SR, lufs: -32, volume: 0.5 } });
  assert.ok(level(long.L, LEFT, 16, 17) > 0.25);
  assert.ok(level(long.L, LEFT, 19, 19.4) < level(long.L, LEFT, 18, 18.4));
  assert.ok(level(long.L, LEFT, 19.7, 19.95) < 0.05);
});

test('a sound file is silent before at, there between at and out, and silent after out', async () => {
  const data = [tone(SOUND, 6), tone(SOUND, 6)];
  const { L, R } = await mix({ duration: 6, sounds: [{ data, sampleRate: SR, start: 2, end: 3.5, volume: 1 }] });
  for (const channel of [L, R]) {
    assert.equal(peak(channel, 0.1, 1.95), 0, 'before at');
    assert.ok(level(channel, SOUND, 2.2, 3.3) > 0.28, 'between at and out');
    assert.equal(peak(channel, 3.55, 5.9), 0, 'after out');
  }
});

test('a sound stops at the end of its file, and keeps two channels', async () => {
  const data = [tone(LEFT, 1), tone(RIGHT, 1)];
  const { L, R } = await mix({ duration: 6, sounds: [{ data, sampleRate: SR, start: 2, end: 6, volume: 1 }] });
  assert.ok(level(L, LEFT, 2.2, 2.8) > 0.28);
  assert.ok(level(R, RIGHT, 2.2, 2.8) > 0.28);
  assert.ok(level(L, RIGHT, 2.2, 2.8) < 0.005);
  assert.equal(peak(L, 3.05, 5.9), 0);
});

test('a sound stays inside its scene, also with an at before the scene starts', async () => {
  const data = [tone(SOUND, 6), tone(SOUND, 6)];
  const { L } = await mix({ duration: 6, sounds: [{ data, sampleRate: SR, start: 1, sceneStart: 2, end: 3, volume: 1 }] });
  assert.equal(peak(L, 0.1, 1.95), 0, 'nothing before the scene starts');
  assert.ok(level(L, SOUND, 2.2, 2.8) > 0.28);
  assert.equal(peak(L, 3.05, 5.9), 0);
});

test('a sound file is lower during a voice span, like the music', async () => {
  const data = [tone(SOUND, 8), tone(SOUND, 8)];
  const { L } = await mix({ duration: 8, voiceSpans: [{ start: 3, end: 5 }], sounds: [{ data, sampleRate: SR, start: 1, end: 7, volume: 1 }] });
  const during = level(L, SOUND, 3.5, 4.5);
  const outside = level(L, SOUND, 1.5, 2.5);
  assert.ok(Math.abs(db(during, outside) + 8) < 0.5, `about 8 dB lower, measured ${db(during, outside).toFixed(1)} dB`);
});

test('a sound cuts off without a click, and its volume sets its level', async () => {
  const constant = [new Float32Array(6 * SR).fill(0.5), new Float32Array(6 * SR).fill(0.5)];
  const { L } = await mix({ duration: 6, sounds: [{ data: constant, sampleRate: SR, start: 2, end: 3, volume: 0.5 }] });
  let jump = 0;
  for (let i = 1; i < L.length; i++) jump = Math.max(jump, Math.abs(L[i] - L[i - 1]));
  assert.ok(jump < 0.05, `the biggest step is ${jump}`);
  assert.ok(Math.abs(L[Math.round(2.5 * SR)] - 0.25) < 1e-6);
});

test('a file at another sample rate plays at its own pitch', async () => {
  const data = [tone(LEFT, 6, 0.3, 16000), tone(RIGHT, 6, 0.3, 16000)];
  const { L } = await mix({ duration: 6, musicFile: { data, sampleRate: 16000, lufs: -32, volume: 0.5 } });
  assert.ok(level(L, LEFT, 3, 4) > 0.25);
});

test('the same input gives the same samples, and a mix with no files stays what it was', async () => {
  const options = { duration: 3, voiceSpans: [{ start: 1, end: 2 }], musicFile: { data: music(3), sampleRate: SR, lufs: -12, volume: 0.5 }, sounds: [{ data: music(3), sampleRate: SR, start: 1, end: 2, volume: 0.5 }] };
  assert.deepEqual((await mix(options)).L, (await mix(options)).L);
  // These hashes come from the code before music files existed. Built-in music, effects and clip sound all go through the old path.
  const old = await renderSoundtrack({ duration: 3, sampleRate: SR, voiceSpans: [{ start: 1, end: 2 }], music: { style: 'calm', seed: 42 }, sfx: [{ name: 'pop', t: 0.5 }, { name: 'ding', t: 1.5 }], clips: [{ data: tone(330, 3), sampleRate: SR, start: 0.5, end: 2.5, duration: 3, from: 0, volume: 0.5, speed: 1 }] });
  const hash = crypto.createHash('sha256').update(Buffer.from(encodeWav(old))).digest('hex');
  assert.equal(hash, 'c2fdddcc177edfa6198bde0c6e2f5321e3113dddc60fec91f0b7c633e873e655');
});

test('video.json: a file, with its defaults, and existing values unchanged', () => {
  assert.deepEqual(normalizeConfig({ music: { src: 'assets/track.mp3' } }).music, { volume: 0.5, loop: true, src: 'assets/track.mp3' });
  assert.deepEqual(normalizeConfig({ music: { src: 'assets/sub/track.flac', volume: 0.3, credit: 'A track by someone', loop: false } }).music, { volume: 0.3, loop: false, src: 'assets/sub/track.flac', credit: 'A track by someone' });
  for (const ext of ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'MP3']) assert.equal(normalizeConfig({ music: { src: `assets/a.${ext}` } }).music.src, `assets/a.${ext}`);
  assert.deepEqual(normalizeConfig({ music: { style: 'calm', volume: 0.2 } }).music, { volume: 0.2, seed: 1, tempo: 1, style: 'calm' });
  assert.deepEqual(normalizeConfig({ music: 'tech' }).music, { volume: 0.5, seed: 1, tempo: 1, style: 'tech' });
  assert.equal(normalizeConfig({ music: true, theme: 'chalk' }).music.style, 'calm');
  assert.equal(normalizeConfig({ music: false }).music, null);
});

test('video.json: bad music settings say what is wrong', () => {
  const fails = (music, pattern) => assert.throws(() => normalizeConfig({ music }), (e) => e instanceof ProjectError && pattern.test(e.message), JSON.stringify(music));
  fails({ src: 'assets/a.mp3', style: 'calm' }, /a style or a src, not both/);
  fails({ src: '../a.mp3' }, /inside assets\//);
  fails({ src: 'assets/../../a.mp3' }, /with no \.\./);
  fails({ src: 'other/a.mp3' }, /inside assets\//);
  fails({ src: 'assets/a.txt' }, /wav, mp3, m4a, aac, flac, ogg or opus/);
  fails({ src: 'assets\\a.mp3' }, /inside assets\//);
  fails({ src: 4 }, /inside assets\//);
  fails({ src: 'assets/a.mp3', volume: 2 }, /volume must be between 0 and 1/);
  fails({ src: 'assets/a.mp3', volume: '0.5' }, /volume must be between 0 and 1/);
  fails({ src: 'assets/a.mp3', loop: 'no' }, /loop must be true or false/);
  fails({ src: 'assets/a.mp3', credit: 5 }, /credit/);
  fails({ src: 'assets/a.mp3', bpm: 120 }, /unknown setting\(s\) for a file: bpm/);
});

test('a project with a music file that is missing, or outside assets through a link, does not load', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sound-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: { src: 'assets/track.mp3' } }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  assert.throws(() => loadProject(dir), /assets\/track\.mp3 is listed in video\.json but the file is missing/);
  fs.writeFileSync(path.join(dir, 'outside.mp3'), 'x');
  fs.symlinkSync('../outside.mp3', path.join(dir, 'assets/track.mp3'));
  assert.throws(() => loadProject(dir), /must stay inside assets\//);
  fs.rmSync(path.join(dir, 'assets/track.mp3'));
  fs.writeFileSync(path.join(dir, 'assets/track.mp3'), 'x');
  assert.equal(loadProject(dir).config.music.src, 'assets/track.mp3');
});

test('decoding gives 48 kHz stereo with both channels kept, and measures the file the same way each time', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sound-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'track.flac');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${LEFT}:duration=4:sample_rate=44100`, '-f', 'lavfi', '-i', `sine=frequency=${RIGHT}:duration=4:sample_rate=44100`, '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[a]', source]);
  const [one, two] = [path.join(dir, 'one.wav'), path.join(dir, 'two.wav')];
  const a = await decodeSound(source, one);
  const b = await decodeSound(source, two);
  assert.deepEqual(a, b);
  assert.ok(a.lufs < 0 && a.lufs > -40, String(a.lufs));
  assert.ok(Math.abs(a.duration - 4) < 0.1);
  assert.ok(fs.readFileSync(one).equals(fs.readFileSync(two)));
  assert.deepEqual(fs.readdirSync(dir).toSorted(), ['one.wav', 'track.flac', 'two.wav']);
  const bytes = fs.readFileSync(one);
  const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  assert.equal(wav.sampleRate, SOUND_RATE);
  assert.equal(wav.channels.length, 2);
  assert.ok(level(wav.channels[0], LEFT, 1, 2, SOUND_RATE) > 0.05);
  assert.ok(level(wav.channels[1], RIGHT, 1, 2, SOUND_RATE) > 0.05);
  assert.ok(level(wav.channels[0], RIGHT, 1, 2, SOUND_RATE) < 0.001);
});

test('a file that is no sound, or has no sound in it, says so', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sound-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'fake.mp3');
  fs.writeFileSync(fake, 'this is not a sound file');
  await assert.rejects(decodeSound(fake, path.join(dir, 'a.wav'), 'assets/fake.mp3'), (e) => e instanceof ProjectError && /assets\/fake\.mp3 could not be read as a sound file/.test(e.message));
  const silent = path.join(dir, 'video.m4a');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=5:d=1', '-c:v', 'libx264', '-threads', '1', '-f', 'mp4', silent]);
  await assert.rejects(decodeSound(silent, path.join(dir, 'b.wav'), 'assets/video.m4a'), /assets\/video\.m4a has no sound in it/);
  assert.deepEqual(fs.readdirSync(dir).toSorted(), ['fake.mp3', 'video.m4a']);
});

test('a loud track at volume 0.5 lands at the level of the built-in music, well under the voice', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sound-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'loud.mp3');
  // Peaks near full scale with loud broadband sound, like a mastered pop track.
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=30:amplitude=0.9:seed=3', '-af', 'volume=8dB,alimiter=limit=0.99:level=false', '-ac', '2', '-b:a', '192k', source]);
  const decoded = path.join(dir, 'decoded.wav');
  const { lufs } = await decodeSound(source, decoded);
  assert.ok(lufs > -12, `the fixture is loud, ${lufs} LUFS`);
  const bytes = fs.readFileSync(decoded);
  const { channels, sampleRate } = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const measure = async (music) => {
    const out = path.join(dir, 'mix.wav');
    fs.writeFileSync(out, Buffer.from(encodeWav(await renderSoundtrack({ duration: 30, sampleRate: 48000, ...music }))));
    return (await loudness(out)).integrated;
  };
  const file = await measure({ musicFile: { data: channels, sampleRate, lufs, volume: 0.5 } });
  const builtIn = await measure({ music: { style: 'warm', seed: 1, volume: 0.5, tempo: 1 } });
  assert.ok(Math.abs(file - builtIn) < 1.5, `the file measures ${file} LUFS and the built-in music ${builtIn}`);
  // Kokoro narration lands near -20 LUFS as stereo, so this leaves about 12 LU.
  assert.ok(file < -30, `${file} LUFS`);
});
