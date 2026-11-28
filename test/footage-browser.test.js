// Footage projects keep picture and sound together across cuts. The fixture
// has a white flash and a short beep on every whole second of the recording;
// after cutting and reordering its spans, each flash in the finished video must
// come with its beep, to within one frame, at 25, 30 and 60 frames a second.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { synthesize } from '../src/voice.js';
import { render } from '../src/render.js';
import { footageInfo, makeWorkingCopy } from '../src/footage.js';
import { readWav } from '../src/wav.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// A recording of `seconds`, with a flash frame and a 20 ms beep at each whole second.
async function flashAndBeep(file, fps, seconds = 6) {
  await ffmpeg(['-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=black:s=320x180:r=${fps}:d=${seconds},drawbox=enable='eq(mod(n\\,${fps})\\,0)':color=white:t=fill`,
    '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t\\,1)\\,0.02)\\,0.5*sin(2*PI*1000*t)\\,0)':s=48000:d=${seconds}`,
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

for (const fps of [25, 30, 60]) {
  test(`a footage project keeps each flash with its beep across a cut and a reorder at ${fps} frames a second`, { skip, timeout: 300000 }, async (t) => {
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
    await flashAndBeep(source, fps);
    fs.mkdirSync(path.join(dir, 'assets'));
    const info = await footageInfo(source);
    assert.equal(info.fps, fps);
    await makeWorkingCopy(source, path.join(dir, 'assets/footage.mov'), info);
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps, footage: 'assets/footage.mov', music: false, sfx: false, captions: false, watermark: false, motionBlur: false, transition: 'cut', defaults: '0.7' }));
    // Seconds 0 to 2, then 3 to 5 (a cut), then 1 to 2 again (a reorder).
    fs.writeFileSync(path.join(dir, 'script.md'), '# Sync\n\n## a {from=0 to=2}\n\n## b {from=3 to=5}\n\n## c {from=1 to=2}\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};\n');
    const project = loadProject(dir);
    // No speech in the fixture, so the speech model isn't needed.
    await synthesize(project, { transcribe: async () => ({ text: '', words: [] }) });
    const r = await render(project, { workers: 2 });
    const video = r.file ?? path.join(dir, 'out/video.mp4');
    const seen = await flashes(video, fps);
    const heard = await beeps(video);
    // Flashes and beeps at 0, 1 (scene a), 2, 3 (scene b, from 3 and 4) and 4 (scene c, from 1).
    assert.deepEqual(seen.map((x) => Math.round(x)), [0, 1, 2, 3, 4], `flashes at ${seen}`);
    assert.equal(heard.length, 5, `beeps at ${heard}`);
    seen.forEach((x, i) => assert.ok(Math.abs(x - heard[i]) <= 1 / fps + 0.002, `flash ${x.toFixed(3)} s and beep ${heard[i].toFixed(3)} s are more than a frame apart`));
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
