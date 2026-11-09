// The short-video rules in check: in a tall video of up to 3 minutes the picture
// changes at least every 2 seconds, and the voice starts in the first second. A
// wide video keeps the old hint about 6 seconds. Real pages, with timelines made
// by hand.
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
const skip = !chrome && 'no browser here';

// Scenes are { id: [body, dur] }. `voice` gives the first scene narration from
// that second to the end of the scene.
function project(t, settings, scenes, { voiceAt = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-short-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, [body]]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.entries(scenes).map(([id, [, dur]], index) => {
    const voice = index === 0 && voiceAt !== null ? { url: '', start: voiceAt, dur: dur - voiceAt } : null;
    const scene = { id, index, start, dur, marks: {}, voice, lead: voice ? voiceAt : 0, transition: 'none', words: [] };
    start += dur;
    return scene;
  });
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width, height, transitionSeconds: 0, scenes: list } };
}

const check = ({ project: p, timeline }) => withEngine(p, timeline, { scale: 0.25 }, (page) => page.evaluate(() => window.explainroo.check(0.25)));
const still = (issues) => issues.filter((i) => i.message.startsWith("the picture doesn't change"));

const ICON = (at) => `s.icon('star', { x: s.cx, y: s.cy, size: 200, at: ${at}, out: ${at} + 0.9, exit: 'none' });`;

test('a short whose picture stands still for more than 2 seconds gets a hint with the stretch', { skip }, async (t) => {
  const p = project(t, { size: '9:16' }, {
    one: [`${ICON(0)} ${ICON(1)} s.text('Late', { y: s.cy + 300, size: 60, at: 4 });`, 5],
    two: [`s.text('Next', { y: s.cy, size: 60, at: 0.2 });`, 1.5],
  });
  const found = still(await check(p));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].level, 'hint');
  assert.equal(found[0].scene, 'one');
  assert.equal(found[0].t, 1);
  assert.match(found[0].message, /for 3\.0s, from 1\.0s, and a short changes it at least every 2 seconds/);
});

test('entrances, a new scene and a camera move each count as a change', { skip }, async (t) => {
  const p = project(t, { size: 'tiktok', captions: 'bold' }, {
    one: [`s.camera([{ at: 1.8, zoom: 1.2 }, { at: 3.6, zoom: 1 }]); ${ICON(0)}`, 4.5],
    two: [`${ICON(0.3)} ${ICON(2)}`, 3.5],
  });
  assert.deepEqual(still(await check(p)), []);
});

test('the hold after the last words of a short may stay still', { skip }, async (t) => {
  const p = project(t, { size: '9:16' }, { one: [`${ICON(0)} ${ICON(1.5)}`, 6] }, { voiceAt: 0 });
  // The voice runs to the end of the scene here, so the stretch after 1.5 s counts.
  assert.equal(still(await check(p)).length, 1);
  const q = project(t, { size: '9:16' }, { one: [`${ICON(0)} ${ICON(1.5)}`, 6] }, { voiceAt: 0 });
  q.timeline.scenes[0].voice.dur = 3;
  assert.deepEqual(still(await check(q)), []);
});

test('a short whose voice starts late gets the hint about the hook, and one that starts at once does not', { skip }, async (t) => {
  const late = project(t, { size: '9:16' }, { one: [`${ICON(-1)} ${ICON(1)}`, 3] }, { voiceAt: 1.2 });
  const hook = (await check(late)).filter((i) => /the first second carries the hook/.test(i.message));
  assert.equal(hook.length, 1);
  assert.match(hook[0].message, /the voice starts at 1\.2s.*\{lead=0\}/);
  const soon = project(t, { size: '9:16' }, { one: [`${ICON(-1)} ${ICON(1)}`, 3] }, { voiceAt: 0 });
  assert.equal((await check(soon)).filter((i) => /carries the hook/.test(i.message)).length, 0);
});

test('a wide video and a tall one over 3 minutes keep the hint about 6 seconds instead', { skip }, async (t) => {
  const wide = project(t, {}, { one: [`${ICON(0)} s.text('Late', { y: 900, size: 60, at: 4 });`, 5] });
  const issues = await check(wide);
  assert.deepEqual(still(issues), []);
  const long = project(t, { size: '9:16' }, { one: [`${ICON(0)} s.text('Late', { y: s.cy + 300, size: 60, at: 7 });`, 181] });
  const found = await check(long);
  assert.deepEqual(still(found), []);
  assert.ok(found.some((i) => /no new element for 7\.0s/.test(i.message)), JSON.stringify(found));
});
