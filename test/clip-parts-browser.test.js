// One file gives several parts: s.clip and s.recording play from `from` to
// `to`, and s.clip and s.image show only the part of the file in `crop`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { scriptHash } from '../src/record.js';

let chrome;
try { chrome = findChrome(); } catch {}

const COLORS = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] };

// Four seconds of video, red, green, blue and white, and a picture and a video
// whose left half is red and right half blue. The recording is the four colors.
async function project(t, scenes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-parts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets/recordings'), { recursive: true });
  const seconds = ['red', 'lime', 'blue', 'white'].map((c) => ['-f', 'lavfi', '-i', `color=${c}:s=320x180:r=30:d=1`]).flat();
  const four = ['-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]', '-map', '[v]'];
  await ffmpeg(['-loglevel', 'error', ...seconds, ...four, '-c:v', 'libx264', '-threads', '1', path.join(dir, 'assets/four.mp4')]);
  await ffmpeg(['-loglevel', 'error', ...seconds, ...four, '-c:v', 'libvpx', '-b:v', '1M', '-threads', '1', path.join(dir, 'assets/recordings/demo.webm')]);
  const halves = ['-f', 'lavfi', '-i', 'color=red:s=160x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=blue:s=160x180:r=30:d=1', '-filter_complex', '[0:v][1:v]hstack[v]', '-map', '[v]'];
  await ffmpeg(['-loglevel', 'error', ...halves, '-c:v', 'libx264', '-threads', '1', path.join(dir, 'assets/halves.mp4')]);
  await ffmpeg(['-loglevel', 'error', ...halves, '-frames:v', '1', path.join(dir, 'assets/halves.png')]);
  const script = { url: 'https://example.com/', steps: [{ do: 'mark', name: 'green' }, { do: 'mark', name: 'white' }] };
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings/demo.json'), JSON.stringify(script));
  const steps = [{ step: 1, do: 'mark', name: 'green', t: 1.2, start: 1.2, end: 1.2 }, { step: 2, do: 'mark', name: 'white', t: 3.2, start: 3.2, end: 3.2 }];
  fs.writeFileSync(path.join(dir, 'assets/recordings/demo.json'), JSON.stringify({ version: 1, width: 320, height: 180, duration: 4, start: 0, end: 4, cursor: { x: 160, y: 90 }, script: scriptHash(script), steps }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', camera: 'still', captions: false, watermark: false, music: false, sfx: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), `## ${Object.keys(scenes).join('\n\n## ')}\n`);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { ${Object.entries(scenes).map(([id, body]) => `${id}(s) { ${body} }`).join(', ')} };`);
  return loadProject(dir);
}

function timeline(p, durs) {
  let start = 0;
  const scenes = Object.entries(durs).map(([id, dur], index) => {
    const scene = { id, index, start, dur, words: [], marks: {}, voice: null, lead: 0, transition: 'none' };
    start += dur;
    return scene;
  });
  return { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width: p.config.width, height: p.config.height, transitionSeconds: 0, scenes };
}

// The color at a few points of a still at each time, by the nearest of COLORS.
async function colors(page, times, points) {
  return page.evaluate(async ([times, points, named]) => {
    await window.explainroo.stills(times.map((T, i) => ({ T, path: `out/stills/${i}.png` })));
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const img = new Image();
      img.src = `/project/out/stills/${i}.png?${Date.now()}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      out.push(points.map(([x, y]) => {
        const px = ctx.getImageData(Math.min(img.width - 1, Math.round(x * img.width)), Math.min(img.height - 1, Math.round(y * img.height)), 1, 1).data;
        const [name, d] = Object.entries(named).map(([n, c]) => [n, Math.hypot(...c.map((v, k) => v - px[k]))]).sort((a, b) => a[1] - b[1])[0];
        return d < 90 ? name : 'other';
      }));
    }
    return out;
  }, [times, points, COLORS]);
}

const MIDDLE = [[0.5, 0.5]];
const SIDES = [[0.1, 0.5], [0.9, 0.5]];

test('a clip plays from from to to, fits that part into the scene, holds its last frame and loops inside it', { skip: !chrome }, async (t) => {
  const p = await project(t, {
    // Seconds 1 to 2, green, then it holds green for the rest of the scene.
    part: "s.clip('assets/four.mp4', { full: true, from: 1, to: 2, at: 0 });",
    // Seconds 1 to 3, green and blue, fitted into four seconds.
    fit: "s.clip('assets/four.mp4', { full: true, from: 1, to: 3, speed: 'fit', at: 0 });",
    // Seconds 2 to 3 again and again: blue, never white.
    loop: "s.clip('assets/four.mp4', { full: true, from: 2, to: 3, loop: true, at: 0 });",
  });
  const tl = timeline(p, { part: 3, fit: 4, loop: 3 });
  await withEngine(p, tl, { scale: 0.25 }, async (page) => {
    const at = (scene, local) => tl.scenes.find((s) => s.id === scene).start + local;
    const seen = (await colors(page, [at('part', 0.5), at('part', 2.5), at('fit', 1), at('fit', 3), at('loop', 0.5), at('loop', 1.5), at('loop', 2.9)], MIDDLE)).map(([c]) => c);
    assert.deepEqual(seen, ['green', 'green', 'green', 'blue', 'blue', 'blue', 'blue']);
    const issues = await page.evaluate(() => window.explainroo.check());
    const freezes = issues.filter((i) => /freezes/.test(i.message));
    assert.deepEqual(freezes.map((i) => i.scene), ['part'], JSON.stringify(issues));
    assert.match(freezes[0].message, /^clip "assets\/four\.mp4" freezes on its frame at to: 2 for 2\.0s, from 1\.00s until 3\.00s\./);
    // A to before from, or after the end of the file, says what it must be.
    const bad = await page.evaluate(async () => {
      const { boot } = await import('/engine/runtime.js');
      const { engine } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
      const errors = [];
      for (const o of [{ from: 2, to: 1 }, { to: 9 }]) {
        engine.scenesModule = { part(s) { s.clip('assets/four.mp4', o); }, fit() {}, loop() {} };
        errors.push(...engine.check().filter((i) => i.level === 'error').map((i) => i.message));
      }
      engine.clipFrames.close();
      return errors;
    });
    assert.deepEqual(bad, [
      'clip to must be seconds in the file after from (2) and no later than its end at 4, the length of "assets/four.mp4"',
      'clip to must be seconds in the file after from (0) and no later than its end at 4, the length of "assets/four.mp4"',
    ]);
  });
});

test('crop shows only that part of a clip or an image, in the pixels of the file', { skip: !chrome }, async (t) => {
  const p = await project(t, {
    left: "s.clip('assets/halves.mp4', { full: true, crop: [0, 0, 160, 180] });",
    right: "s.image('assets/halves.png', { x: s.W / 2, y: s.H / 2, w: s.W, h: s.H, radius: 0, shadow: false, enter: 'none', crop: [160, 0, 160, 180] });",
    whole: "s.image('assets/halves.png', { x: s.W / 2, y: s.H / 2, w: s.W, h: s.H, radius: 0, shadow: false, enter: 'none', fit: 'fill' });",
  });
  const tl = timeline(p, { left: 1, right: 1, whole: 1 });
  await withEngine(p, tl, { scale: 0.25 }, async (page) => {
    const seen = await colors(page, [0.5, 1.5, 2.5], SIDES);
    assert.deepEqual(seen, [['red', 'red'], ['blue', 'blue'], ['red', 'blue']]);
    const bad = await page.evaluate(async () => {
      const { boot } = await import('/engine/runtime.js');
      const { engine } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
      const errors = [];
      for (const scene of [(s) => s.clip('assets/halves.mp4', { crop: [200, 0, 160, 180] }), (s) => s.image('assets/halves.png', { crop: [0, 0, 100] }), (s) => s.recording('demo', { crop: [0, 0, 10, 10] })]) {
        engine.scenesModule = { left: scene, right() {}, whole() {} };
        errors.push(...engine.check().filter((i) => i.level === 'error').map((i) => i.message));
      }
      engine.clipFrames.close();
      return errors;
    });
    assert.deepEqual(bad, [
      'clip crop [200, 0, 160, 180] must lie inside "assets/halves.mp4", which is 320x180: x and y from 0, w and h above 0, x + w up to 320 and y + h up to 180',
      'image crop must be [x, y, w, h] in the pixels of "assets/halves.png", which is 320x180',
      'recording "demo" takes no crop. A zoom step in recordings/demo.json shows a part of the page',
    ]);
  });
});

test('a recording plays up to to, its steps after to do not play, and a cue on one says so', { skip: !chrome }, async (t) => {
  const p = await project(t, {
    demo: "const r = s.recording('demo', { full: true, cursor: false, from: 1, to: 3 }); s.text(String(r.times.white ?? 'none'), { id: 'times', x: 100, y: 1000, size: 20, at: 0 });",
  });
  const tl = timeline(p, { demo: 4 });
  await withEngine(p, tl, { scale: 0.25 }, async (page) => {
    const seen = (await colors(page, [0.5, 1.5, 3.5], MIDDLE)).map(([c]) => c);
    // Green, blue, and blue again: the white second after to never shows.
    assert.deepEqual(seen, ['green', 'blue', 'blue']);
    const issues = await page.evaluate(() => window.explainroo.check());
    assert.deepEqual(issues.filter((i) => i.level === 'error'), [], JSON.stringify(issues));
    const bad = await page.evaluate(async () => {
      const { boot } = await import('/engine/runtime.js');
      const { engine } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
      engine.scenesModule = { demo(s) { s.recording('demo', { to: 3, cues: { white: 1 } }); } };
      const found = engine.check().filter((i) => i.level === 'error').map((i) => i.message);
      engine.clipFrames.close();
      return found;
    });
    assert.deepEqual(bad, ['recording "demo" step 2 ("white") comes at 3.20s, after to: 3, so its cue can\'t play. Use a later to, or take the cue out']);
  });
});
