// With "defaults": "0.5", "cover": "auto" takes the fullest frame of the first
// scene, a frame with a picture first, and check gives a hint when the cover
// shows only text on an empty background. Without the line, "auto" is the end of
// the first scene as before. Real pages, with timelines made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { check, resolveTimes } from '../src/qa.js';
import { tinyProject, runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

function project(t, settings, scenes, durs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cover-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.keys(scenes).map((id, index) => {
    const dur = durs[id] ?? 5;
    const scene = { id, index, start, dur, marks: {}, voice: null, lead: 0, transition: 'none', words: [] };
    start += dur;
    return scene;
  });
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width, height, transitionSeconds: 0, scenes: list } };
}

const inPage = ({ project: p, timeline }, fn) => withEngine(p, timeline, { scale: 0.5 }, fn);

// A title on the first frame, a picture that has arrived at 1.6 s, a card at
// 2.6 s, and a note at 3.5 s.
const HOOK = `s.title('How DNS works', { y: 200, at: 0, enter: 'none' });
    s.icon('globe', { x: 600, y: 600, size: 200, at: 1, enter: 'pop', dur: 0.6 });
    s.box('Resolver', { x: 1300, y: 600, at: 2, enter: 'pop', dur: 0.6 });
    s.note('about 20 ms', { y: 900, at: 3.5 });`;
const NEW = { defaults: '0.5' };
const moment = (p) => inPage(p, (page) => page.evaluate(() => window.explainroo.coverMoment()));
// The cover's moment, and how many elements it and the frame before it show.
const counted = (p) => inPage(p, (page) => page.evaluate(() => {
  const T = window.explainroo.coverMoment();
  return { T, at: window.explainroo.framed(0, T).count, before: window.explainroo.framed(0, T - 1 / 30).count };
}));
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1.01 / 30, `${value} is not ${expected}`);

test('with "defaults": "0.5", "cover": "auto" takes the earliest of the fullest frames of the whole first scene, a frame with a picture first', { skip }, async (t) => {
  // The note arrives after the first 3 seconds, and the cover is the first frame that shows it fully.
  const full = await counted(project(t, NEW, { hook: HOOK, next: `s.title('Next', { at: 0 });` }));
  assert.ok(full.T > 3.5 && full.T < 4.5, JSON.stringify(full));
  assert.ok(full.at > full.before, JSON.stringify(full));
  // A short first scene is looked at to its end.
  near(await moment(project(t, NEW, { hook: HOOK, next: `s.title('Next', { at: 0 });` }, { hook: 2.3 })), 1.6);
  // A title alone, there from the start, gives the first frame.
  assert.equal(await moment(project(t, NEW, { hook: `s.title('Here', { at: 0, enter: 'none' });` })), 0);
  // An arrow that points at a picture before it has arrived: the frame with the picture wins.
  const pointing = project(t, NEW, { hook: `s.title('Heat leaves', { y: 160, at: 0, enter: 'none' });
    s.note('the kitchen', { x: 400, y: 400, at: 0, enter: 'none' });
    s.note('outside', { x: 1500, y: 400, at: 0, enter: 'none' });
    s.arrow([700, 600], [1300, 600], { at: 0, enter: 'none', label: 'heat' });
    s.icon('house', { x: 1500, y: 650, size: 220, at: 4, enter: 'pop', dur: 0.5 });` });
  near(await moment(pointing), 4.5);
  // Only the elements whose entrance has finished count.
  const fading = project(t, NEW, { hook: `s.icon('sun', { x: 600, y: 540, size: 200, at: 0, enter: 'none' });
    s.icon('cloud', { x: 1300, y: 540, size: 200, at: 1, enter: 'fade', dur: 3 });` });
  near(await moment(fading), 4);
});

test('without "defaults", "cover": "auto" is the end of the first scene, and 1.0 second into it for Shorts, TikTok and Reels, as before', async (t) => {
  const { coverTime } = await import('../src/render.js');
  const { project: p, timeline } = project(t, {}, { hook: HOOK, next: `s.title('Next', { at: 0 });` });
  const wide = coverTime(p.config, timeline);
  assert.deepEqual([wide.auto, wide.label], [true, 'hook@end']);
  assert.equal(wide.T, resolveTimes(timeline, ['hook@end'])[0].T);
  const tall = project(t, { size: 'tiktok' }, { hook: HOOK, next: `s.title('Next', { at: 0 });` });
  assert.deepEqual([coverTime(tall.project.config, tall.timeline).label, coverTime(tall.project.config, tall.timeline).T], ['hook@1.0', 1]);
  const fresh = project(t, NEW, { hook: HOOK });
  assert.deepEqual(coverTime(fresh.project.config, fresh.timeline), { auto: true, T: null, label: 'auto' });
});

test('check gives a hint when the cover shows only text on an empty background, and suggests a frame with a picture', { skip }, async (t) => {
  const hints = (p, T, auto) => inPage(p, (page) => page.evaluate(([at, a]) => window.explainroo.coverIssue(at, a), [T, auto]));
  const bread = `s.short.backdrop({ color: '#1b2440' });
    s.short.hook('Your bread is *stale* again?');
    s.icon('wheat', { y: 700, size: 260, color: 'yellow', at: 3.5, enter: 'pop', dur: 0.5 });`;
  const textOnly = project(t, {}, { hook: bread });
  assert.deepEqual(await hints(textOnly, 0.5, false), { level: 'hint', scene: 'hook', t: 0.5, message: 'the cover at hook@0.5, which shows only text on an empty background; set "cover": "hook@4.0" for a frame with a picture, or show a picture sooner' });
  // The cover "auto" picked without the line, at a set time.
  assert.deepEqual(await hints(textOnly, 1, true), { level: 'hint', scene: 'hook', t: 1, message: '"cover": "auto" picks hook@1.0, which shows only text on an empty background; set "cover": "hook@4.0" for a frame with a picture, or show a picture sooner' });
  assert.equal(await hints(textOnly, 4.5, false), null);
  // With the line, "auto" finds the picture by itself, so there is no hint.
  assert.equal(await hints(project(t, NEW, { hook: bread }), null, true), null);
  assert.equal(await hints(project(t, NEW, { hook: HOOK }), null, true), null);
  // Only text in the whole first scene: the hint says no frame has a picture.
  const words = project(t, NEW, { hook: `s.title('Only words', { at: 0 });` });
  assert.match((await hints(words, null, true)).message, /^"cover": "auto" picks hook@\d\.\d, the fullest frame of the first scene, and no frame of that scene shows a picture; show a shape, an icon or an image with the text there, or set "cover" to a moment of another scene that has one$/);
});

test('render writes the automatic cover at that frame, without captions, and check runs the hint', { skip, timeout: 240000 }, async (t) => {
  const dir = tinyProject(t, { size: '640x360', captions: true, defaults: '0.5' }, { narrated: false });
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { intro(s) {
    s.bg('#ffffff');
    s.title('Tiny', { y: 90, size: 40, at: 0, enter: 'none' });
    s.box('Box', { x: 320, y: 230, size: 30, at: 0.5, enter: 'none', fill: '#000000', textColor: '#ffffff' });
  } };`);
  const r = await runCli(['render', dir, '--draft', '--json']);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  const cover = JSON.parse(r.stdout).cover;
  assert.ok(cover && fs.existsSync(cover), r.stdout);
  // The black box is on the cover, so the cover is from 0.5 s on, not the first frame.
  const { stdout } = await import('node:child_process').then(({ spawnSync }) => import('../src/ffmpeg.js').then(({ ffmpegPath }) => spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', cover, '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e6 })));
  const dark = [...stdout].filter((v) => v < 60).length;
  assert.ok(dark > 20, `the box is on the cover: ${dark} dark pixels`);
  const checked = await check(loadProject(dir));
  assert.deepEqual(checked.issues.filter((i) => /cover at|"cover"/.test(i.message)), []);
});
