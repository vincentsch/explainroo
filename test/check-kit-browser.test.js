// What check says about the watermark, the short-video kit, drawings over a
// hook title, the order of s.camera, markup shown as written, and clips that
// play. Real pages, with timelines made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// A project whose scenes are { id: body }, each `dur` seconds long. `make`
// gets the folder first, for assets.
async function project(t, settings, scenes, { dur = 3, make = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-kit-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (make) await make(dir);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.keys(scenes).map((id, index) => {
    const scene = { id, index, start, dur, marks: {}, voice: null, lead: 0, transition: 'none', words: [] };
    start += dur;
    return scene;
  });
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width, height, transitionSeconds: 0, scenes: list } };
}

const check = ({ project: p, timeline }, fn = null) => withEngine(p, timeline, { scale: 0.5 }, async (page) => {
  const issues = await page.evaluate(() => window.explainroo.check(0.25));
  return fn ? { issues, more: await fn(page) } : issues;
});

const messages = (issues, scene, part) => issues.filter((i) => i.scene === scene && i.message.includes(part)).map((i) => i.message);

test('check warns about text and pictures under the watermark, also where the scene camera zooms them there', { skip }, async (t) => {
  const scenes = {
    // The watermark sits in the bottom right corner of a wide frame.
    corner: `s.text('Under it', { x: 1790, y: 1026, size: 30, at: 0 });
    s.icon('star', { x: 1700, y: 1020, size: 80, at: 0 });
    s.text('Clear of it', { x: 960, y: 540, at: 0 });`,
  };
  const wide = await check(await project(t, {}, scenes));
  assert.equal(messages(wide, 'corner', '"Under it" is under the "explainroo.com" watermark').length, 1, JSON.stringify(wide, null, 2));
  assert.equal(messages(wide, 'corner', 'the icon "star" is under the "explainroo.com" watermark').length, 1);
  assert.deepEqual(messages(wide, 'corner', 'Clear of it'), []);
  assert.deepEqual(messages(await check(await project(t, { watermark: false }, scenes)), 'corner', 'watermark'), []);

  // On Shorts the watermark sits at the top right of the content area. A
  // zoom of the scene's own camera pushes a hook title and an icon into it.
  const tall = await check(await project(t, { size: 'shorts', defaults: '0.6' }, {
    punch: `s.camera([{ at: 1, zoom: 1.3, dur: 0.2 }]);
    s.short.hook('Bees make honey together', { at: -1 });
    s.icon('star', { x: s.safe.right - 195, y: s.safe.top + 110, size: 60, at: -1 });`,
    still: `s.short.hook('Bees make honey together', { at: -1 });
    s.icon('star', { x: s.safe.right - 195, y: s.safe.top + 110, size: 60, at: -1 });`,
  }));
  const punched = messages(tall, 'punch', 'watermark');
  assert.ok(punched.some((m) => m.includes('the icon "star" is under the "explainroo.com" watermark') && m.includes("The camera's zoom of 1.3x pushes it there")), JSON.stringify(tall, null, 2));
  assert.ok(messages(tall, 'punch', "zoom of 1.3x pushes it there").some((m) => /^"(BEES|MAKE|HONEY|TOGETHER)"/.test(m)), JSON.stringify(tall, null, 2));
  assert.deepEqual(messages(tall, 'still', 'watermark'), []);
});

test('a drawing with a box counts as a shape over a hook title, also after the scene used the short-video kit', { skip }, async (t) => {
  const issues = await check(await project(t, { size: 'shorts', defaults: '0.6' }, {
    over: `const box = s.short.hook('Bees make honey', { at: -1 });
    s.draw({ x: s.cx - 150, y: box.top + 40, at: -1, box: { x: 0, y: 0, w: 160, h: 120 } }, (ctx) => { ctx.fillStyle = '#ffc107'; ctx.fillRect(-80, -60, 160, 120); });`,
    clear: `const box = s.short.hook('Bees make honey', { at: -1 });
    s.draw({ x: s.cx, y: box.bottom + 200, at: -1, box: { x: 0, y: 0, w: 160, h: 120 } }, (ctx) => { ctx.fillStyle = '#ffc107'; ctx.fillRect(-80, -60, 160, 120); });`,
  }));
  assert.equal(messages(issues, 'over', 'the 1st s.draw at').length, 1, JSON.stringify(issues, null, 2));
  assert.match(messages(issues, 'over', 'the 1st s.draw at')[0], /^"(BEES|MAKE|HONEY)" and the 1st s\.draw at \d+,\d+ partly overlap/);
  assert.deepEqual(messages(issues, 'clear', 's.draw'), []);
});

test('check gives a hint when s.camera comes after other elements of a scene', { skip }, async (t) => {
  const issues = await check(await project(t, {}, {
    after: `s.text('Before the camera', { at: 0 });
    s.camera([{ at: 1, zoom: 1.2 }]);`,
    first: `s.camera([{ at: 1, zoom: 1.2 }]);
    s.text('After the camera', { at: 0 });`,
    still: `s.text('Before a still camera', { at: 0 });
    s.camera([]);`,
  }));
  assert.equal(messages(issues, 'after', 's.camera comes after other elements').length, 1, JSON.stringify(issues, null, 2));
  assert.equal(issues.find((i) => i.scene === 'after' && i.message.startsWith('s.camera')).level, 'hint');
  assert.deepEqual(messages(issues, 'first', 's.camera'), []);
  assert.deepEqual(messages(issues, 'still', 's.camera'), []);
});
