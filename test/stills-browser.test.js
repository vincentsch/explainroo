import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}
test('stills preserve PNG by default and support JPEG covers', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-stills-'));
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: '320x180', captions: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) { s.bg("#245cff"); } };');
    const project = loadProject(dir);
    const timeline = { duration: 1, frames: 30, fps: 30, width: 320, height: 180, transitionSeconds: 0,
      scenes: [{ id: 'intro', index: 0, start: 0, dur: 1, words: [], marks: {}, voice: null, transition: 'none' }] };
    await withEngine(project, timeline, {}, async (page) => {
      await page.evaluate(() => window.explainroo.stills([{ T: 0.5, path: 'out/still.png' }]));
      await page.evaluate(() => window.explainroo.stills([{ T: 0.5, path: 'build/cover.jpg' }], { type: 'image/jpeg', quality: 0.9 }));
      const dimensions = await page.evaluate(async () => {
        const img = new Image();
        img.src = '/project/build/cover.jpg';
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      });
      assert.deepEqual(dimensions, [320, 180]);
    });
    assert.equal(fs.readFileSync(path.join(dir, 'out/still.png')).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([...fs.readFileSync(path.join(dir, 'build/cover.jpg')).subarray(0, 3)], [0xff, 0xd8, 0xff]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
