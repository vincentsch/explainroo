// The same project through the real command line and a real page: a music file
// and an s.sound in the final render, in the mix that preview serves and in the
// exported player's audio.m4a. Each mix is measured, also with "sfx": false.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../src/browser.js';
import { parseWav } from '../engine/audio/pcm.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const LEFT = 440;
const RIGHT = 660;
const SOUND = 1320;
// The one scene has no narration: 12 seconds, with a sound from 4 to 7.
const WATCH = { before: [1.6, 3.8], during: [4.3, 6.7], after: [7.3, 9.5] };

let chrome;
try { chrome = findChrome(); } catch {}

function level(samples, freq, [from, to], sr = 48000) {
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

function assertAudible(left, right, name) {
  const during = WATCH.during;
  const music = level(left, LEFT, during);
  assert.ok(music > 0.002, `${name}: the music is there, ${music}`);
  assert.ok(level(right, RIGHT, during) > 0.002, `${name}: the music is in the right channel too`);
  assert.ok(level(left, RIGHT, during) < music / 5, `${name}: left and right stay different`);
  assert.ok(level(right, LEFT, during) < level(right, RIGHT, during) / 5, `${name}: left and right stay different`);
  const sound = level(left, SOUND, during);
  assert.ok(sound > 0.002, `${name}: the sound file plays between at and out, ${sound}`);
  assert.ok(level(left, SOUND, WATCH.before) < sound / 20, `${name}: the sound is silent before at`);
  assert.ok(level(left, SOUND, WATCH.after) < sound / 20, `${name}: the sound is silent after out`);
}

async function wavChannels(file) {
  const bytes = fs.readFileSync(file);
  const { channels, sampleRate } = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  assert.equal(sampleRate, 48000);
  return channels;
}

// The sound of any file as 48 kHz stereo samples.
async function soundOf(file, dir) {
  const out = path.join(dir, 'measure.wav');
  await ffmpeg(['-loglevel', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return wavChannels(out);
}

function cli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeProject(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sound-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  // Formats the server does not serve as they are, so only decoding can make them work.
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${LEFT}:duration=20`, '-f', 'lavfi', '-i', `sine=frequency=${RIGHT}:duration=20`, '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[a]', '-c:a', 'aac', path.join(dir, 'assets/track.m4a')]);
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${SOUND}:duration=8`, '-c:a', 'flac', path.join(dir, 'assets/noise.flac')]);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, theme: 'clean', captions: false, watermark: false, end: 0, music: { src: 'assets/track.m4a', volume: 0.5, credit: 'Fixture tones' }, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first {min=12}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) {
    s.title('Sound', { at: 0 });
    s.sound('assets/noise.flac', { at: 4, out: 7, volume: 1 });
  } };`);
  return dir;
}

for (const [name, settings] of [['with built-in effects', {}], ['with "sfx": false', { sfx: false }]]) {
  test(`a music file and s.sound play in render, preview and export, ${name}`, { skip: !chrome && 'no browser here' }, async (t) => {
    const dir = await makeProject(t, settings);

    const rendered = await cli(['render', dir, '--workers', '1', '--json']);
    assert.equal(rendered.code, 0, rendered.stdout + rendered.stderr);
    const video = await soundOf(path.join(dir, 'out/video.mp4'), dir);
    assertAudible(video[0], video[1], 'render');

    // The decoded files are named by a hash of the file, and a second run makes them again the same.
    const decoded = fs.readdirSync(path.join(dir, 'build/sounds')).filter((f) => f.endsWith('.wav'));
    assert.equal(decoded.length, 2);
    for (const file of decoded) assert.match(file, /^[0-9a-f]{64}\.wav$/);
    const mix = fs.readFileSync(path.join(dir, 'build/mix.wav'));
    fs.rmSync(path.join(dir, 'build/sounds'), { recursive: true });
    assert.equal((await cli(['render', dir, '--workers', '1', '--json'])).code, 0);
    assert.ok(fs.readFileSync(path.join(dir, 'build/mix.wav')).equals(mix), 'the same file gives the same mix');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'build/sounds')).filter((f) => f.endsWith('.wav')).toSorted(), decoded.toSorted());

    const preview = spawn(process.execPath, [bin, 'preview', dir, '--port', '0'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => preview.kill('SIGKILL'));
    const url = await new Promise((resolve, reject) => {
      let err = '';
      preview.stderr.on('data', (d) => {
        err += d;
        const m = /preview: (http:\S+)/.exec(err);
        if (m) resolve(m[1]);
      });
      preview.on('close', () => reject(new Error(`preview stopped: ${err}`)));
    });
    const browser = await launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#meta').textContent);
    // The Play button mixes the sound, and the status shows if that failed.
    await page.click('#play');
    await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause' && document.querySelector('#status').textContent === '');
    assert.equal(await page.textContent('#status'), '');
    assert.deepEqual(errors, []);
    // The same function the Play button uses, read back.
    await page.evaluate(async () => {
      const { boot, renderAudio } = await import('/engine/runtime.js');
      const { upload } = await import('/engine/upload.js');
      const { engine, audio } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
      const { buffer, errors } = await renderAudio(engine, audio);
      if (errors.length) throw new Error(errors[0].message);
      await upload('build/preview-mix.wav', audio.encodeWav(buffer));
    });
    const heard = await wavChannels(path.join(dir, 'build/preview-mix.wav'));
    assertAudible(heard[0], heard[1], 'preview');
    await browser.close();
    preview.kill('SIGKILL');

    const exported = await cli(['export', dir, '--json']);
    assert.equal(exported.code, 0, exported.stdout + exported.stderr);
    const { out } = JSON.parse(exported.stdout);
    const player = await soundOf(path.join(out, 'audio.m4a'), dir);
    assertAudible(player[0], player[1], 'export');
    // Inside the mix, like everything else. Neither the files nor their names are in the folder.
    assert.equal(fs.existsSync(path.join(out, 'project/assets/track.m4a')), false);
    assert.equal(fs.existsSync(path.join(out, 'project/assets/noise.flac')), false);
    const state = fs.readFileSync(path.join(out, 'state.json'), 'utf8');
    assert.doesNotMatch(state, /track\.m4a|Fixture tones/);
    assert.deepEqual(JSON.parse(state).config.music, { src: 'audio.m4a' });
  });
}

test('in a real page both are lower during a voice span, with "sfx": false too', { skip: !chrome && 'no browser here' }, async (t) => {
  const dir = await makeProject(t, { sfx: false });
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) {
    s.sound('assets/noise.flac', { at: 'word', out: 11.5, volume: 1 });
  } };`);
  const project = loadProject(dir);
  const scene = { id: 'first', index: 0, start: 2, dur: 10, words: [{ text: 'word', start: 1, end: 1.5 }], marks: {}, voice: null, lead: 0, transition: 'none' };
  const timeline = { pace: 1, duration: 12, frames: 288, fps: 24, width: 320, height: 180, transitionSeconds: 0, voiceSpans: [{ start: 7, end: 9 }], scenes: [scene] };
  await withEngine(project, timeline, {}, async (page) => {
    const sound = await page.evaluate(() => window.explainroo.soundtrack('build/page-mix.wav'));
    assert.equal(sound.cues, 0, '"sfx": false still silences the built-in effects');
  });
  const [left, right] = await wavChannels(path.join(dir, 'build/page-mix.wav'));
  for (const [channel, freq, name] of [[left, LEFT, 'music, left'], [right, RIGHT, 'music, right'], [left, SOUND, 'sound, left']]) {
    const outside = level(channel, freq, [4.5, 6.5]);
    const during = level(channel, freq, [7.5, 8.5]);
    assert.ok(outside > 0.002, `${name}: ${outside}`);
    const db = 20 * Math.log10(during / outside);
    assert.ok(Math.abs(db + 8) < 1, `${name} is about 8 dB lower, measured ${db.toFixed(1)} dB`);
  }
  assert.ok(level(left, SOUND, [1.6, 2.8]) < level(left, SOUND, [4.5, 6.5]) / 20, 'the word cue starts it');
});

test('check finds a sound file that is missing or a music file it can\'t read, and a bad cue stops the render', { skip: !chrome && 'no browser here' }, async (t) => {
  const dir = await makeProject(t);
  const check = async () => JSON.parse((await cli(['check', dir, '--json'])).stdout).issues.filter((i) => i.level === 'error').map((i) => i.message).join('\n');
  assert.equal(await check(), '');
  fs.writeFileSync(path.join(dir, 'assets/track.m4a'), 'this is not a sound file');
  assert.match(await check(), /music: assets\/track\.m4a could not be read as a sound file/);
  const failed = await cli(['render', dir, '--workers', '1']);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /assets\/track\.m4a could not be read as a sound file/);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, theme: 'clean', music: false }));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) { s.title('x', { at: 0 }); s.sound('assets/gone.mp3', { at: 1 }); } };`);
  assert.match(await check(), /sound file "assets\/gone\.mp3" not found.*Available: assets\/noise\.flac, assets\/track\.m4a/);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) { s.title('x', { at: 0 }); s.sound('assets/noise.flac', { at: 1, volume: 2 }); } };`);
  assert.match(await check(), /sound volume must be from 0 to 1/);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) { s.title('x', { at: 0 }); s.sound('assets/noise.flac', { at: 20 }); } };`);
  assert.match(await check(), /a sound is set to appear at 20\.00s but the scene ends/);
  // A short path works too, the way images and clips do.
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) { s.title('x', { at: 0 }); s.sound('noise.flac', { at: 1 }); } };`);
  assert.equal(await check(), '');
});
