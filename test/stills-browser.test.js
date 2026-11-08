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

test('covers leave out the burned-in captions', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cover-captions-'));
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: '640x360', captions: true, watermark: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\nHello there.\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) { s.bg("#ffffff"); } };');
    const project = loadProject(dir);
    const timeline = { duration: 2, frames: 60, fps: 30, width: 640, height: 360, transitionSeconds: 0,
      scenes: [{ id: 'intro', index: 0, start: 0, dur: 2, marks: {}, voice: null, transition: 'none',
        words: [{ text: 'Hello', start: 0.2, end: 0.6 }, { text: 'there.', start: 0.7, end: 1.1 }] }] };
    await withEngine(project, timeline, {}, async (page) => {
      const dark = await page.evaluate(async () => {
        const count = async (options) => {
          await window.explainroo.stills([{ T: 0.9, path: 'out/c.png' }], options);
          const img = new Image();
          img.src = '/project/out/c.png?' + Math.random();
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
          return n;
        };
        return { with: await count({}), without: await count({ captions: false }) };
      });
      assert.ok(dark.with > 100, `captions should draw dark pixels, got ${dark.with}`);
      assert.equal(dark.without, 0);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('still and sheet mark a frame caught in a camera move or while something draws itself in', { skip: !chrome && 'no browser here', timeout: 240000 }, async (t) => {
  const { runCli } = await import('./helpers/tiny-project.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-moving-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '640x360', theme: 'clean', captions: false, music: false, sfx: false, lead: 0, hold: 0, end: 0, transition: 'cut', watermark: false, camera: 'still' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Moving\n\n## pan {min=4}\n\n## write {min=4}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {
  pan(s) { s.camera([{ at: 1, zoom: 1.5, dur: 2 }]); s.box('A', { at: 0, enter: 'none' }); },
  write(s) { s.text('Being written', { at: 1, enter: 'write', dur: 2 }); },
};
`);
  const r = await runCli(['still', dir, 'pan@2', 'pan@3.5', 'write@2', 'write@3.5', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).stills.map((s) => [s.label, s.note ?? null]), [['pan@2', 'camera moving'], ['pan@3.5', null], ['write@2', 'drawing in'], ['write@3.5', null]]);
  const text = await runCli(['still', dir, 'pan@2', 'write@3.5']);
  assert.match(text.stdout, /^pan@2 +\S+pan@2\.png {2}\(camera moving\)$/m);
  assert.match(text.stdout, /^write@3\.5 +\S+write@3\.5\.png$/m);
  // The sheet writes the note under the frame, and says how many it marked.
  const sheet = await runCli(['sheet', dir, '--times', 'pan@2,pan@3.5,write@2', '--json']);
  assert.equal(sheet.code, 0, sheet.stderr);
  assert.deepEqual(JSON.parse(sheet.stdout).marked, [{ time: 2, label: 'pan@2', note: 'camera moving' }, { time: 6, label: 'write@2', note: 'drawing in' }]);
  const plain = await runCli(['sheet', dir, '--times', 'pan@2,pan@3.5,write@2']);
  assert.match(plain.stdout, /sheet-times\.jpg \(3 frames, 2 marked "camera moving" or "drawing in" under the frame\)$/m);
});
