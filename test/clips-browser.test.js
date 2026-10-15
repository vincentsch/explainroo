import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { readWav } from '../src/wav.js';
import { ffmpeg } from '../src/ffmpeg.js';

let chrome;
try { chrome = findChrome(); } catch {}
test('stills use exact clip frames in any order and reuse extracted frames', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clips-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=lime:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:a', 'aac', '-shortest', '-c:v', 'libx264', '-threads', '1', path.join(dir, 'assets/colors.mp4')]);
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', captions: false, watermark: false, music: false, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) {
      s.clip('assets/colors.mp4', { w: 1200, at: 0.5, enter: 'none', shadow: false, radius: 0, volume: 0.6 });
    } };`);
    const project = loadProject(dir);
    const timeline = { pace: 1, duration: 6, frames: 180, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
      scenes: [{ id: 'demo', index: 0, start: 0, dur: 6, words: [], marks: {}, voice: null, lead: 0, transition: 'none' }] };
    let stamp;
    for (let run = 0; run < 2; run++) {
      await withEngine(project, timeline, { scale: 0.25 }, async (page) => {
        const samples = await page.evaluate(async () => {
          const times = [2.75, 0.75, 1.75, 5, 1.75, 0.25];
          await window.explainroo.stills(times.map((T, i) => ({ T, path: `out/stills/${i}.png` })));
          const out = [];
          for (let i = 0; i < times.length; i++) {
            const img = new Image();
            img.src = `/project/out/stills/${i}.png`;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
            out.push([...ctx.getImageData(img.width / 2, img.height / 2, 1, 1).data].slice(0, 3));
          }
          return out;
        });
        for (const [i, channel] of [[0, 2], [1, 0], [2, 1], [3, 2], [4, 1]]) {
          assert.ok(samples[i][channel] > 240, JSON.stringify(samples));
          assert.ok(samples[i].filter((_, c) => c !== channel).every((v) => v < 15), JSON.stringify(samples));
        }
        assert.ok(samples[5].every((v) => v > 220));
        const issues = await page.evaluate(() => window.explainroo.check());
        assert.ok(issues.some((i) => i.level === 'hint' && /freezes.*3.50s.*6.00s/.test(i.message)));
        if (run === 0) {
          await page.evaluate(() => window.explainroo.soundtrack('build/clip-mix.wav'));
          const { samples, sampleRate } = readWav(path.join(dir, 'build/clip-mix.wav'));
          const peak = (a, b) => samples.subarray(a * sampleRate, b * sampleRate).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
          assert.equal(peak(0.1, 0.4), 0);
          assert.ok(peak(0.6, 0.8) > 0.03);
          assert.equal(peak(4, 5), 0);
        }
        const result = await page.evaluate(() => window.explainroo.frames([60, 30, 60], 0.9));
        assert.equal(result[0], result[2]);
        const diagnostics = await page.evaluate(async () => {
          const { boot } = await import('/engine/runtime.js');
          const { engine } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
          engine.scenesModule = { demo(s) { s.clip('assets/colors.mp4', { speed: 2, volume: 0.6 }); } };
          const issues = engine.check();
          engine.clipFrames.close();
          return issues;
        });
        assert.ok(diagnostics.some((i) => i.level === 'warn' && /stays silent at speed 2/.test(i.message)));
      });
      const hashes = fs.readdirSync(path.join(dir, 'build/clips'));
      assert.equal(hashes.length, 1);
      const first = path.join(dir, 'build/clips', hashes[0], '00000000.jpg');
      if (run === 0) stamp = fs.statSync(first).mtimeMs;
      else assert.equal(fs.statSync(first).mtimeMs, stamp);
    }
    await withEngine(project, timeline, {}, async (page, { server }) => {
      await page.goto(server.url);
      await page.waitForFunction(() => document.querySelector('#c').width > 0 && document.querySelector('#meta').textContent);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => {
        const c = document.querySelector('#c');
        const pixel = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
        return pixel[0] > 240 && pixel[1] < 15;
      });
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => {
        const c = document.querySelector('#c');
        const pixel = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
        return pixel[1] > 240 && pixel[0] < 15;
      });
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('motion blur keeps a clip frame that does not change during the shutter', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-blur-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=lime:s=160x90:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-threads', '1', path.join(dir, 'assets/clip.mp4')]);
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', camera: 'still', captions: false, watermark: false, music: false, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo\n');
    // The card keeps the frame moving, so it is drawn with motion blur.
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) {
      s.clip('assets/clip.mp4', { w: 700, at: 0, enter: 'none', radius: 0, shadow: false });
      s.box('Moving', { x: 300, y: 200, w: 200, h: 100, at: 0.9, dur: 2, enter: 'rise' });
    } };`);
    const project = loadProject(dir);
    const timeline = { pace: 1, duration: 3, frames: 90, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
      scenes: [{ id: 'demo', index: 0, start: 0, dur: 3, words: [], marks: {}, voice: null, lead: 0, transition: 'none' }] };
    await withEngine(project, timeline, { scale: 0.25 }, async (page) => {
      const [sharp, blurred] = await page.evaluate(async () => {
        const c = document.querySelector('#c');
        const pixel = () => [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3);
        await window.explainroo.frames([45], 0.9, 1);
        const a = pixel();
        await window.explainroo.frames([45], 0.9, 6);
        return [a, pixel()];
      });
      assert.ok(sharp[1] > 240 && sharp[0] < 15, JSON.stringify(sharp));
      assert.deepEqual(blurred, sharp);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
