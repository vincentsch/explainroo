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

// A scene that writes what the helpers return where the test can read it.
const SCENES = `export default { intro(s) {
  globalThis.__out = {
    x: s.keys([{ at: 0, v: 0 }, { at: '#go', v: 300, ease: 'linear' }]),
    point: s.keys([{ at: 0, v: [0, 0] }, { at: 2, v: [100, 50], ease: 'linear' }]),
    color: s.keys([{ at: 0, v: 'ink' }, { at: 2, v: 'bg', ease: 'linear' }]),
    late: s.keys([{ at: 0, v: 1 }, { at: 1, v: 2 }], 5),
    percent: s.keys([{ at: 0, v: 'rgb(100% 0% 0%)' }, { at: 2, v: 'rgb(0% 0% 100%)', ease: 'linear' }]),
    onPath: s.along('M 0 0 L 100 0 L 100 100', 0.75),
    onPoints: s.along([[0, 0], [0, 200]], 0.5),
    wide: s.text('WIDE', { tracking: 0.3, size: 40, y: 40, at: 0 }).w,
    narrow: s.text('WIDE', { size: 40, y: 120, at: 0 }).w,
  };
  for (const [name, fn] of Object.entries({
    order: () => s.keys([{ at: 2, v: 0 }, { at: 1, v: 1 }]),
    value: () => s.keys([{ at: 0 }]),
    ease: () => s.keys([{ at: 0, v: 0, ease: 'bouncy' }]),
    word: () => s.keys([{ at: 'banana', v: 0 }]),
    text: () => s.keys([{ at: 0, v: 'big' }, { at: 1, v: 'small' }]),
    points: () => s.along([[5, 5]], 0.5),
    tracking: () => s.text('WIDE', { tracking: 5, at: 0 }),
  })) { try { fn(); globalThis.__out[name] = 'no error'; } catch (e) { globalThis.__out[name] = e.message; } }
} };`;

test('s.keys and s.along give values from the time, and say what is wrong with bad keyframes', { skip: !chrome && 'no browser here' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: '320x180', captions: false, sfx: false, music: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## intro {min=4}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), SCENES);
  const project = loadProject(dir);
  const timeline = { duration: 4, frames: 120, fps: 30, width: 320, height: 180, transitionSeconds: 0,
    scenes: [{ id: 'intro', index: 0, start: 0, dur: 4, words: [], marks: { go: 2 }, voice: null, transition: 'none' }] };
  await withEngine(project, timeline, {}, async (page) => {
    await page.evaluate(() => window.explainroo.stills([{ T: 1, path: 'out/still.png' }]));
    const out = await page.evaluate(() => globalThis.__out);
    assert.equal(out.x, 150);
    assert.deepEqual(out.point, [50, 25]);
    assert.match(out.color, /^rgba\(/);
    assert.equal(out.late, 2);
    assert.ok(out.wide > out.narrow + 30, `tracking spreads the letters: ${out.wide} against ${out.narrow}`);
    assert.equal(out.percent, 'rgba(128,0,128,1)');
    assert.ok(Math.abs(out.onPath.x - 100) < 0.5 && Math.abs(out.onPath.y - 50) < 0.5, JSON.stringify(out.onPath));
    assert.ok(Math.abs(out.onPath.angle - 90) < 1, `the path goes down there: ${out.onPath.angle}`);
    assert.deepEqual(out.onPoints, { x: 0, y: 100, angle: 90 });
    assert.match(out.order, /must be in time order, and keyframe 2 \(1\.00 s\) comes before keyframe 1 \(2\.00 s\)/);
    assert.match(out.value, /keyframe 1 of s\.keys needs its value as v/);
    assert.match(out.ease, /has the ease "bouncy"\. Use one of: linear/);
    assert.match(out.word, /banana/);
    assert.match(out.text, /a string value must be a color/);
    assert.match(out.points, /two or more points/);
    assert.match(out.tracking, /text tracking is the space between letters in ems, from -0\.2 to 2/);
  });
});
