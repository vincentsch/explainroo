// A sticker covers backgrounds only: fact() in vertical-short finds a place
// clear of the hook title, the pictures and the step label, and check warns
// when a sticker covers an icon, a picture or text, also with overlap: true.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { BUILT_IN } from '../src/formats.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// Scenes of four seconds in a Reels frame, with the vertical-short helpers.
function project(t, scenes, words = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-stickers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'reels', theme: 'midnight', music: false, sfx: false, captions: false, defaults: '0.6' }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.copyFileSync(path.join(BUILT_IN, 'vertical-short', 'format.js'), path.join(dir, 'format.js'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `import { beats, fact, hookFrame, punch } from './format.js';\nexport default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) { ${body} },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  const { width, height } = loaded.config;
  const list = Object.keys(scenes).map((id, index) => ({ id, index, start: index * 4, dur: 4, marks: {}, voice: null, lead: 0, transition: 'cut',
    words: (words[id] ?? []).map((text, i) => ({ text, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5 })) }));
  return { project: loaded, timeline: { pace: 1, duration: list.length * 4, frames: list.length * 120, fps: 30, width, height, transitionSeconds: 0, scenes: list } };
}

const check = ({ project: p, timeline }) => withEngine(p, timeline, { scale: 0.25 }, (page) => page.evaluate(() => window.explainroo.check(0.25)));
const stickers = (issues) => issues.filter((i) => /^the sticker /.test(i.message)).map((i) => [i.scene, i.message]);

test('fact() keeps clear of the hook title, the subject, the beats and the step label', { skip, timeout: 120000 }, async (t) => {
  const issues = await check(project(t, {
    hook: "s.camera(punch(s, 1.5, { zoom: 1.15 })); hookFrame(s, 'Why is the sky *blue*?', { icon: 'cloud-sun' }); fact(s, 'Space: *black*', { at: 1 });",
    beat: "s.short.step(1, 4); beats(s, [{ at: 0.2, icon: 'sun', label: 'White light' }, { at: 2, icon: 'rainbow', label: 'All the colors' }]); fact(s, '*Mixed*', { at: 2.5 });",
    long: "beats(s, [{ at: 0.2, icon: 'audio-waveform', label: 'Blue: short wave' }]); fact(s, '*5* times more than red', { at: 1 });",
  }));
  assert.deepEqual(stickers(issues), []);
  assert.deepEqual(issues.filter((i) => /overlap/.test(i.message)), []);
});

test('check warns when a sticker covers an icon, a picture or text, also with overlap: true', { skip, timeout: 120000 }, async (t) => {
  const issues = await check(project(t, {
    icon: "s.icon('sun', { x: 540, y: 900, size: 300, at: 0 }); s.short.sticker('*Hot*', { x: 540, y: 900, at: 0.5, overlap: true });",
    words: "s.text('Light scatters', { x: 540, y: 900, size: 64, at: 0 }); s.short.sticker('*Hot*', { x: 540, y: 900, at: 0.5, overlap: true });",
    // A faint picture is a background, which overlap: true allows.
    faint: "s.icon('sun', { x: 540, y: 900, size: 600, opacity: 0.16, at: 0 }); s.short.sticker('*Hot*', { x: 540, y: 900, at: 0.5, overlap: true });",
  }));
  assert.deepEqual(stickers(issues), [
    ['icon', 'the sticker "Hot" covers the icon "sun"; move the sticker with x and y. overlap: true lets a sticker cover backgrounds only'],
    ['words', 'the sticker "Hot" covers the text "Light scatters"; move the sticker with x and y'],
  ]);
});
