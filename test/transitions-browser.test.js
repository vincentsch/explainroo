// Scene changes never show the text of two scenes in one place: check warns when
// a fade or a zoom does for more than two frames, a push moves the scenes side
// by side, a zoom no longer lets the frame drawn before show through, and with
// "defaults": "0.6" a step label comes after the transition into its scene.
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

// Two scenes of two seconds, the second one coming in with `transition`.
function project(t, settings, scenes, transition) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-transitions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '1080x1920', theme: 'midnight', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) { ${body} },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  const list = Object.keys(scenes).map((id, index) => ({ id, index, start: index * 2, dur: 2, marks: {}, voice: null, lead: 0, transition: index ? transition : 'none', words: [] }));
  return { project: loaded, timeline: { pace: 1, duration: list.length * 2, frames: list.length * 60, fps: 30, width: 1080, height: 1920, transitionSeconds: 0.5, scenes: list } };
}

const inPage = ({ project: p, timeline }, fn) => withEngine(p, timeline, { scale: 0.25 }, fn);

const LABELS = {
  first: "s.text('Light is white', { y: 900, size: 64, at: 0, enter: 'none' });",
  second: "s.text('Air bends it', { y: 900, size: 64, at: 0, enter: 'none' });",
};

test('check warns when text of two scenes shows in one place during a fade or a zoom, and not with a push or a cut', { skip, timeout: 120000 }, async (t) => {
  for (const transition of ['fade', 'zoom']) {
    const issues = await inPage(project(t, {}, LABELS, transition), (page) => page.evaluate(() => window.explainroo.check(0.25)));
    const found = issues.filter((i) => /show in the same place/.test(i.message));
    assert.equal(found.length, 1, `${transition}: ${JSON.stringify(issues)}`);
    assert.equal(found[0].level, 'warn');
    assert.equal(found[0].scene, 'second');
    assert.match(found[0].message, new RegExp(`^during the ${transition} from "first" into this scene, "Light is white" of "first" and "Air bends it" of this scene show in the same place for \\d+ frames, from 2\\.\\ds in the video; give the scene \\{transition=cut\\} or \\{transition=push\\}`));
  }
  for (const transition of ['push', 'cut', 'slide']) {
    const overlaps = await inPage(project(t, {}, LABELS, transition), (page) => page.evaluate(() => window.explainroo.transitionOverlaps()));
    assert.deepEqual(overlaps, [], transition);
  }
  // Text in different places is fine.
  const apart = { ...LABELS, second: "s.text('Air bends it', { y: 1500, size: 64, at: 0, enter: 'none' });" };
  assert.deepEqual(await inPage(project(t, {}, apart, 'fade'), (page) => page.evaluate(() => window.explainroo.transitionOverlaps())), []);
});

test('a zoom draws the same frame whatever was drawn before it', { skip, timeout: 120000 }, async (t) => {
  const frames = await inPage(project(t, {}, LABELS, 'zoom'), async (page) => {
    const after = async (before) => {
      await page.evaluate((f) => window.explainroo.frames([f], 0.9), before);
      return page.evaluate(() => window.explainroo.frames([68], 0.9));
    };
    return [await after(0), await after(119)];
  });
  assert.equal(frames[0][0], frames[1][0]);
});

test('with "defaults": "0.6", a step label and the progress bar come after the transition into their scene', { skip, timeout: 120000 }, async (t) => {
  const scenes = { first: 's.short.step(1, 2); s.short.progress();', second: 's.short.step(2, 2); s.short.progress();' };
  const texts = (p) => inPage(p, async (page) => {
    const at = async (i, time) => (await page.evaluate(([i, time]) => window.explainroo.textsAt(i, time), [i, time])).map((x) => x.text);
    return { during: await at(1, 0.2), after: await at(1, 0.8), before: await at(0, 1.9) };
  });
  const fresh = await texts(project(t, { defaults: '0.6' }, scenes, 'fade'));
  assert.deepEqual(fresh.during, []);
  assert.deepEqual(fresh.after, ['STEP 2/2']);
  assert.deepEqual(fresh.before, ['STEP 1/2']);
  // After a cut it is there at once, and before 0.6 the frames stay as they were.
  assert.deepEqual((await texts(project(t, { defaults: '0.6' }, scenes, 'cut'))).during, ['STEP 2/2']);
  assert.deepEqual((await texts(project(t, {}, scenes, 'fade'))).during, ['STEP 2/2']);
});
