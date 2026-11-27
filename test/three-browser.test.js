import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { buildTimeline } from '../src/timeline.js';
import { renderKind } from '../src/render.js';
import { runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

function project(t, scenes, script = '## orbit {min=3}\n', settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-three-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'studio', size: '480x270', captions: false, sfx: false, music: false, watermark: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), scenes);
  return dir;
}

// Stars at random places, made once, and a cube that turns with the time.
const ORBIT = `export default { orbit(s) {
  const cube = s.three({ id: 'cube', at: -1 }, {
    setup({ THREE, scene, color }) {
      const stars = new THREE.Group();
      for (let i = 0; i < 40; i++) {
        const star = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: color('accent') }));
        star.position.set(Math.random() * 12 - 6, Math.random() * 7 - 3.5, -2);
        stars.add(star);
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: color('blue') }));
      scene.add(stars, box);
      return { box };
    },
    frame({ t, state }) { state.box.rotation.set(t * 0.7, t * 1.1, 0); },
  });
  globalThis.__point = cube.point([0, 0, 0]);
  globalThis.__box = { x: cube.x, y: cube.y };
} };`;

test('a 3D scene draws the same pixels on every render page, also with random numbers in its setup', { skip, timeout: 240000 }, async (t) => {
  const p = loadProject(project(t, ORBIT));
  const timeline = buildTimeline(p, {});
  await withEngine(p, timeline, { pages: 2 }, async ([a, b]) => {
    assert.equal((await a.evaluate(() => window.explainroo.info())).three, true);
    // Page a draws frame 60 first, page b after other frames.
    const first = await a.evaluate(() => window.explainroo.frames([60], 0.95, 1));
    const later = await b.evaluate(() => window.explainroo.frames([10, 80, 60], 0.95, 1));
    assert.equal(first[0], later[2]);
    // Something was drawn: the frame differs from one without the cube turning.
    assert.notEqual(later[0], later[2]);
    // point([0, 0, 0]) is the middle of the box, where the camera looks.
    const { point, box } = await a.evaluate(() => ({ point: globalThis.__point, box: globalThis.__box }));
    assert.ok(Math.abs(point.x - box.x) < 0.01 && Math.abs(point.y - box.y) < 0.01, JSON.stringify({ point, box }));
  });
});

test('check finds a 3D scene that keeps values between frames, and its motion counts as change', { skip, timeout: 240000 }, async (t) => {
  const kept = project(t, ORBIT.replace("frame({ t, state }) { state.box.rotation.set(t * 0.7, t * 1.1, 0); }", "frame({ state }) { state.box.rotation.x += 0.2; }"), '## orbit {min=4}\n');
  const issues = JSON.parse((await runCli(['check', kept, '--json'])).stdout).issues;
  assert.ok(issues.some((x) => /drawn again after other moments/.test(x.message)), JSON.stringify(issues));
  // A long scene where only the cube turns gets no hint about a stretch without change.
  const long = project(t, ORBIT, '## orbit {min=14}\n');
  const calm = JSON.parse((await runCli(['check', long, '--json'])).stdout).issues;
  assert.deepEqual(calm.filter((x) => /no new element|drawn again/.test(x.message)), []);
});

test('s.three says what is wrong with its arguments, an async setup and a call that comes too late', { skip, timeout: 240000 }, async (t) => {
  const message = async (body) => {
    const dir = project(t, `export default { orbit(s) { ${body} } };`);
    const r = await runCli(['check', dir, '--json']);
    return JSON.parse(r.stdout).issues.filter((x) => x.level === 'error').map((x) => x.message).join('\n');
  };
  assert.match(await message("s.three({}, () => {});"), /s\.three takes its options and \{ setup, frame \}/);
  assert.match(await message("s.three({}, { async setup() {} });"), /s\.three setup must not be async/);
  assert.match(await message("if (s.t > 1) s.three({ id: 'late' }, { setup() {} });"), /s\.three "late" was not called when its scene started\. Call s\.three on every frame of the scene/);
});

test('a project without 3D scenes does not load three.js, and 3D renders keep a speed of their own', { skip, timeout: 120000 }, async (t) => {
  const p = loadProject(project(t, "export default { orbit(s) { s.text('Flat', { at: 0 }); } };"));
  await withEngine(p, buildTimeline(p, {}), {}, async (page) => {
    assert.equal((await page.evaluate(() => window.explainroo.info())).three, false);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('script')].length >= 0 && performance.getEntriesByType('resource').some((r) => r.name.includes('/vendor/three/'))), false);
  });
  assert.equal(renderKind({ samples: 6, transparent: false, workers: 4, three: true }), '6 samples, 3D, 4 workers');
  assert.equal(renderKind({ samples: 6, transparent: false, workers: 4 }), '6 samples, 4 workers');
});

test('the web player of a video with a 3D scene carries three.js and draws the scene', { skip, timeout: 300000 }, async (t) => {
  const dir = project(t, ORBIT, '## orbit {min=2}\n');
  const r = await runCli(['export', dir]);
  assert.equal(r.code, 0, r.text);
  const out = path.join(dir, 'out/player');
  for (const f of ['vendor/three/three.module.js', 'vendor/three/three.core.js', 'vendor/three/LICENSE-three.txt', 'engine/three.js']) assert.ok(fs.existsSync(path.join(out, f)), f);
  // A flat video's player has no three.js files.
  const flat = project(t, "export default { orbit(s) { s.text('Flat', { at: 0 }); } };", '## orbit {min=2}\n');
  assert.equal((await runCli(['export', flat])).code, 0);
  assert.equal(fs.existsSync(path.join(flat, 'out/player/vendor/three')), false);
});
