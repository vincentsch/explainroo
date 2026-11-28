// Footage projects keep picture and sound together across cuts. The fixture
// has a white flash and a short beep at six moments of the recording, a
// different one in each part, so playing it straight through, or with a span
// cut or ordered wrong, puts them elsewhere. After cutting and reordering at
// frame-aligned fractions of a second, each flash in the finished video must be
// where its span puts it and come with its beep, within one frame, at 25, 30
// and 60 frames a second, and at 30 with motion blur on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { ffmpeg, probe } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { synthesize } from '../src/voice.js';
import { render } from '../src/render.js';
import { footageInfo, makeWorkingCopy } from '../src/footage.js';
import { readWav } from '../src/wav.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// The moments of the fixture, on the frame grid at 25, 30 and 60.
const EVENTS = [0.4, 1.2, 2.2, 3.4, 4.4, 5.6];

// A recording of `seconds` with a flash frame and a 20 ms beep at each moment.
// With `delay`, the picture starts that much after the sound, as when a screen
// recording starts after the microphone, and each flash comes that much later.
async function flashAndBeep(file, fps, delay = 0, seconds = 6) {
  const flashes = EVENTS.map((e) => `eq(n\\,${Math.round(e * fps)})`).join('+');
  const beeps = EVENTS.map((e) => `between(t\\,${e}\\,${e + 0.02})`).join('+');
  await ffmpeg(['-loglevel', 'error', '-y',
    ...(delay ? ['-itsoffset', String(delay)] : []),
    '-f', 'lavfi', '-i', `color=black:s=320x180:r=${fps}:d=${seconds},drawbox=enable='${flashes}':color=white:t=fill`,
    '-f', 'lavfi', '-i', `aevalsrc='(${beeps})*0.5*sin(2*PI*1000*t)':s=48000:d=${seconds}`,
    // passthrough keeps the picture's late start in the file instead of padding it.
    ...(delay ? ['-fps_mode', 'passthrough'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
}

// The times of the white frames of a video, in seconds.
async function flashes(video, fps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-flashes-'));
  try {
    const raw = path.join(dir, 'gray.raw');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', raw]);
    const bytes = fs.readFileSync(raw);
    const times = [];
    for (let f = 0; f * 64 < bytes.length; f++) {
      const mean = bytes.subarray(f * 64, f * 64 + 64).reduce((a, b) => a + b, 0) / 64;
      if (mean > 128) times.push(f / fps);
    }
    return times;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The start times of the beeps of a video, in seconds.
async function beeps(video) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-beeps-'));
  try {
    const wav = path.join(dir, 'sound.wav');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    const { samples, sampleRate } = readWav(wav);
    const times = [];
    let quiet = Infinity;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > 0.05) {
        if (quiet > sampleRate * 0.2) times.push(i / sampleRate);
        quiet = 0;
      } else quiet++;
    }
    return times;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const [fps, blur, delay] of [[25, false, 0], [30, false, 0], [60, false, 0], [30, true, 0], [30, false, 0.1]]) {
  test(`a footage project keeps each flash with its beep across a cut and a reorder at ${fps} frames a second${blur ? ', with motion blur' : ''}${delay ? `, with a picture that starts ${delay} s after the sound` : ''}`, { skip, timeout: 300000 }, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `explainroo-footage-${fps}-`));
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-cache-'));
    const before = process.env.EXPLAINROO_CACHE;
    process.env.EXPLAINROO_CACHE = cache;
    t.after(() => {
      if (before === undefined) delete process.env.EXPLAINROO_CACHE;
      else process.env.EXPLAINROO_CACHE = before;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(cache, { recursive: true, force: true });
    });
    const source = path.join(dir, 'talk.mp4');
    await flashAndBeep(source, fps, delay);
    if (delay) {
      const streams = (await probe(source)).streams;
      const start = (type) => Number(streams.find((x) => x.codec_type === type).start_time);
      assert.ok(Math.abs(start('video') - start('audio') - delay) < 0.02, `the fixture's picture starts ${start('video')} s and its sound ${start('audio')} s`);
    }
    fs.mkdirSync(path.join(dir, 'assets'));
    const info = await footageInfo(source);
    assert.equal(info.fps, fps);
    await makeWorkingCopy(source, path.join(dir, 'assets/footage.mov'), info);
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps, footage: 'assets/footage.mov', music: false, sfx: false, captions: false, watermark: false, motionBlur: blur, transition: 'cut', defaults: '0.7' }));
    // 0.2 to 2.6, then 3.0 to 4.8 (a cut), then 1.0 to 1.6 again (a reorder).
    fs.writeFileSync(path.join(dir, 'script.md'), '# Sync\n\n## a {from=0.2 to=2.6}\n\n## b {from=3.0 to=4.8}\n\n## c {from=1.0 to=1.6}\n');
    // With blur, a small dot slides in over each scene, so the frames take motion blur samples.
    const dot = "s.footage(); s.circle({ x: 300, y: 20, r: 4, color: 'muted', at: 0.1, enter: 'slide-left', dur: 1.5 });";
    fs.writeFileSync(path.join(dir, 'scenes.js'), blur ? `export default { a(s) { ${dot} }, b(s) { ${dot} }, c(s) { ${dot} } };\n` : 'export default {};\n');
    const project = loadProject(dir);
    // No speech in the fixture, so the speech model isn't needed.
    await synthesize(project, { transcribe: async () => ({ text: '', words: [] }) });
    const r = await render(project, { workers: 2 });
    const video = r.file ?? path.join(dir, 'out/video.mp4');
    const seen = await flashes(video, fps);
    const heard = await beeps(video);
    // a has the moments at 0.4, 1.2 and 2.2, b those at 3.4 and 4.4, c the one at 1.2 again.
    const expected = [0.2, 1.0, 2.0, 2.8, 3.8, 4.4];
    assert.equal(seen.length, expected.length, `flashes at ${seen}`);
    seen.forEach((x, i) => assert.ok(Math.abs(x - expected[i] - delay) <= 1 / fps + 0.002, `flash ${i + 1} at ${x.toFixed(3)} s, where its span puts it at ${expected[i] + delay} s`));
    assert.equal(heard.length, expected.length, `beeps at ${heard}`);
    seen.forEach((x, i) => assert.ok(Math.abs(x - delay - heard[i]) <= 1 / fps + 0.002, `flash ${x.toFixed(3)} s and beep ${heard[i].toFixed(3)} s are not ${delay} s apart, within a frame`));
  });
}

test('a footage project shows the colours of the recording', { skip, timeout: 300000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-colour-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-cache-'));
  const before = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = cache;
  t.after(() => {
    if (before === undefined) delete process.env.EXPLAINROO_CACHE;
    else process.env.EXPLAINROO_CACHE = before;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  });
  // Three bars, encoded the way cameras and phones do, in BT.709.
  const colours = [[200, 50, 50], [46, 139, 87], [224, 172, 150]];
  const hex = (c) => '0x' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const source = path.join(dir, 'bars.mp4');
  await ffmpeg(['-loglevel', 'error', '-y',
    ...colours.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${hex(c)}:s=320x360:r=25:d=2`]),
    '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000',
    '-filter_complex', '[0:v][1:v][2:v]hstack=3,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]', '-map', '[v]', '-map', '3:a',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source]);
  fs.mkdirSync(path.join(dir, 'assets'));
  await makeWorkingCopy(source, path.join(dir, 'assets/footage.mov'), await footageInfo(source));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '960x360', fps: 25, footage: 'assets/footage.mov', music: false, sfx: false, captions: false, watermark: false, transition: 'cut', defaults: '0.7' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Colours\n\n## a {from=0 to=1.5}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};\n');
  const project = loadProject(dir);
  await synthesize(project, { transcribe: async () => ({ text: '', words: [] }) });
  const { stills } = await import('../src/qa.js');
  const [shot] = await stills(project, ['a@0.5']);
  const png = shot.file;
  const raw = path.join(dir, 'still.rgb');
  await ffmpeg(['-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const bytes = fs.readFileSync(raw);
  colours.forEach((c, i) => {
    const at = (180 * 960 + 160 + i * 320) * 3;
    const seen = [...bytes.subarray(at, at + 3)];
    assert.ok(seen.every((v, k) => Math.abs(v - c[k]) <= 6), `bar ${i + 1} should be ${c}, and it is ${seen}`);
  });
});
