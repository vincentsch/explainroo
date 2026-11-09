// The four layouts in "explainroo docs pictures" pass check in a wide and in a
// tall frame, with made-up narration that has their markers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { check } from '../src/qa.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SCRIPT = `# Layouts

## number
About a million [#number] requests come in [#caption] every day.

## compare
Callbacks nest [#left] while async await [#right] reads from top to bottom.

## steps
The browser asks [#step2] a resolver, which finds [#step3] the address.

## hub
One login server [#hub] serves email [#spoke1] the calendar [#spoke2] and files [#spoke3] for the whole team.
`;

test('the layouts in the pictures topic pass check in a wide and in a tall frame', { skip, timeout: 240000 }, async (t) => {
  const doc = fs.readFileSync(new URL('../docs/pictures.md', import.meta.url), 'utf8');
  const start = doc.indexOf('```js\nexport default {') + 6;
  const code = doc.slice(start, doc.indexOf('```', start));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-layouts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, defaults: '0.5' }));
  fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
  fs.writeFileSync(path.join(dir, 'scenes.js'), code);
  for (const scene of ['number', 'compare', 'steps', 'hub']) cachedVoice(dir, scene);
  for (const size of ['youtube', 'shorts']) {
    const { issues } = await check(loadProject(dir, { size }));
    // The first scene is a number alone that comes in on a marker, so the
    // hints about the cover and the first frame are all there is.
    assert.deepEqual(issues.filter((i) => !/"cover"|^the first frame/.test(i.message)), [], `${size}: ${JSON.stringify(issues)}`);
  }
});

// The layout in the short-video topic fills the whole frame, and check says
// nothing about its pictures with "defaults": "0.6".
test('the layout that fills the frame in the short-video topic passes check on TikTok with "defaults": "0.6"', { skip, timeout: 120000 }, async (t) => {
  const doc = fs.readFileSync(new URL('../docs/short-video.md', import.meta.url), 'utf8');
  const start = doc.indexOf('```js\nproblem(s) {') + 6;
  const code = doc.slice(start, doc.indexOf('```', start));
  assert.match(code, /s\.full\.bottom/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-full-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## problem\nOn a plane, the engines make a steady, low hum. Noise-cancelling headphones remove most of it.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${code}};\n`);
  const outside = (issues) => issues.filter((i) => /content area|caption band|off the frame/.test(i.message));
  for (const defaults of ['0.6', '0.5']) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: 'tiktok', captions: 'bold', music: false, sfx: false, defaults }));
    cachedVoice(dir, 'problem');
    const { issues } = await check(loadProject(dir));
    if (defaults === '0.6') assert.deepEqual(outside(issues), [], JSON.stringify(issues));
    else assert.ok(outside(issues).length > 0, 'without it, the lines below the captions get warnings');
  }
});

// What scene-api says about bend and wrapping, and what the code does.
test('a positive bend curves to the right of the way an arrow points, and a box label wraps at maxWidth, not at minW, as scene-api says', { skip }, async (t) => {
  const api = fs.readFileSync(new URL('../docs/scene-api.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(api.includes('a positive one curves to the right of the way the arrow points, so one from left to right sags down, and a negative one to the left; at 1 its middle moves a quarter of its length'));
  assert.ok(api.includes('The label wraps at `maxWidth`, 560 pixels, or inside `w`. `minW` only widens the box, so to keep a long label on one line, raise `maxWidth`.'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-bend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## shapes {min=1}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { shapes(s) {
    globalThis.drawn = {
      right: s.arrow([300, 300], [1100, 300], { bend: 0.5, at: 0 }),
      up: s.arrow([1500, 900], [1500, 200], { bend: 0.5, at: 0 }),
      left: s.arrow([300, 700], [1100, 700], { bend: -1, at: 0 }),
      wrapped: s.box('many checks by hand', { y: 900, size: 65, minW: 900, at: 0 }),
      line: s.box('many checks by hand', { y: 900, size: 65, minW: 900, maxWidth: 900, at: 0 }),
    };
  } };`);
  const project = loadProject(dir);
  const timeline = { pace: 1, duration: 1, frames: 30, fps: 30, width: 1920, height: 1080, transitionSeconds: 0, scenes: [{ id: 'shapes', index: 0, start: 0, dur: 1, marks: {}, voice: null, lead: 0, transition: 'none', words: [] }] };
  const { withEngine } = await import('../src/pipeline.js');
  const drawn = await withEngine(project, timeline, { scale: 0.5 }, (page) => page.evaluate(async () => {
    await window.explainroo.stills([{ T: 0.5, path: 'out/x.png' }]);
    return globalThis.drawn;
  }));
  // The control point of the curve: below a left to right arrow, right of an upward one.
  assert.ok(drawn.right.control.y > 300 + 150, JSON.stringify(drawn.right));
  assert.ok(drawn.up.control.x > 1500 + 150, JSON.stringify(drawn.up));
  // At a bend of -1 the control point is half the length above, 400 pixels, and
  // the middle of the curve halfway to it, a quarter of the length.
  assert.equal(drawn.left.control.y, 700 - 400);
  // minW leaves the label on two lines, and maxWidth puts it on one.
  assert.equal(drawn.wrapped.w, drawn.line.w);
  assert.ok(drawn.wrapped.h > drawn.line.h * 1.4, JSON.stringify([drawn.wrapped, drawn.line]));
});
