// "cover": "auto" takes the fullest frame of the first three seconds of the
// first scene, and check gives a hint when the cover shows only text on an
// empty background. Real pages, with timelines made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { check } from '../src/qa.js';
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
// 2.6 s, and a note too late for the cover.
const HOOK = `s.title('How DNS works', { y: 200, at: 0, enter: 'none' });
    s.icon('globe', { x: 600, y: 600, size: 200, at: 1, enter: 'pop', dur: 0.6 });
    s.box('Resolver', { x: 1300, y: 600, at: 2, enter: 'pop', dur: 0.6 });
    s.note('about 20 ms', { y: 900, at: 3.5 });`;

test('"cover": "auto" takes the earliest frame of the first 3 seconds with the most elements fully on screen', { skip }, async (t) => {
  const moments = await inPage(project(t, {}, { hook: HOOK, next: `s.title('Next', { at: 0 });` }), (page) => page.evaluate(() => window.explainroo.coverMoment()));
  // The card has fully arrived at 2.6 s, give or take a frame.
  assert.ok(Math.abs(moments - 2.6) < 1.01 / 30, moments);
  // A first scene shorter than 3 seconds is looked at up to its end.
  const short = await inPage(project(t, {}, { hook: HOOK, next: `s.title('Next', { at: 0 });` }, { hook: 2.3 }), (page) => page.evaluate(() => window.explainroo.coverMoment()));
  assert.ok(Math.abs(short - 1.6) < 1.01 / 30, short);
  // A title alone, there from the start, gives the first frame.
  const nothing = await inPage(project(t, {}, { hook: `s.title('Here', { at: 0, enter: 'none' });` }), (page) => page.evaluate(() => window.explainroo.coverMoment()));
  assert.equal(nothing, 0);
});

test('check gives a hint when the cover shows only text on an empty background, and suggests a frame with a picture', { skip }, async (t) => {
  const hints = (p, T) => inPage(p, (page) => page.evaluate((at) => window.explainroo.coverIssue(at), T));
  const textOnly = project(t, {}, { hook: `s.short.backdrop({ color: '#1b2440' });
    s.short.hook('Your bread is *stale* again?');
    s.icon('wheat', { y: 700, size: 260, color: 'yellow', at: 3.5, enter: 'pop', dur: 0.5 });` });
  assert.deepEqual(await hints(textOnly, null), { level: 'hint', scene: 'hook', t: 0, message: '"cover": "auto" picks hook@0.0, which shows only text on an empty background; set "cover": "hook@4.0" for a frame with a picture, or show a picture sooner' });
  assert.deepEqual(await hints(textOnly, 0.5), { level: 'hint', scene: 'hook', t: 0.5, message: 'the cover at hook@0.5, which shows only text on an empty background; set "cover": "hook@4.0" for a frame with a picture, or show a picture sooner' });
  assert.equal(await hints(textOnly, 4.5), null);
  assert.equal(await hints(project(t, {}, { hook: HOOK }), null), null);
  // Only text in the whole scene: no frame to suggest.
  const words = project(t, {}, { hook: `s.title('Only words', { at: 0 });` });
  assert.match((await hints(words, null)).message, /only text on an empty background; show a picture with the text, or set "cover" to a moment that has one$/);
});

test('render writes the automatic cover at that frame, without captions, and check runs the hint', { skip, timeout: 240000 }, async (t) => {
  const dir = tinyProject(t, { size: '640x360', captions: true }, { narrated: false });
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
