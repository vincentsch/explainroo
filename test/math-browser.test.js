import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { buildTimeline } from '../src/timeline.js';

let chrome;
try { chrome = findChrome(); } catch {}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-math-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'chalk', captions: false, sfx: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=3}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) {
    s.math(String.raw\`\\frac{1}{2}\`, { x: 450, y: 540, size: 96, at: 0.5, id: 'fraction' });
    s.math(String.raw\`\\sum_{i=1}^n i\`, { x: 950, y: 540, at: 0.5 });
    s.math(String.raw\`\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}\`, { x: 1450, y: 540, at: 0.5 });
    s.annotate('fraction', { at: 2, type: 'underline' });
  }};`);
  const project = loadProject(dir);
  return { project, timeline: buildTimeline(project, {}) };
}

test('fixed formulas preload once and render deterministically before, during and after entering', { skip: !chrome }, async t => {
  const { project, timeline } = fixture(t);
  await withEngine(project, timeline, {}, async page => {
    const result = await page.evaluate(async () => {
      const before = performance.getEntriesByType('resource').filter(r => r.name.includes('/__math?')).length;
      const a = await window.explainroo.frames([0, 28, 55]);
      const b = await window.explainroo.frames([55, 28, 0]);
      const issues = window.explainroo.check();
      const after = performance.getEntriesByType('resource').filter(r => r.name.includes('/__math?')).length;
      return { before, after, deterministic: a.every((f, i) => f === b[2 - i]), changing: new Set(a).size, issues };
    });
    assert.equal(result.before, 3);
    assert.equal(result.after, 3);
    assert.equal(result.deterministic, true);
    assert.equal(result.changing, 3);
    assert.deepEqual(result.issues, []);
  });
});

test('math boxes, transformations, text checks and late-formula errors work in the page', { skip: !chrome }, async t => {
  const { project, timeline } = fixture(t);
  await withEngine(project, timeline, {}, async page => {
    const result = await page.evaluate(async () => {
      const { Engine, fetchState } = await import('/engine/runtime.js');
      const { SceneError } = await import('/engine/stage.js');
      const state = await fetchState();
      const make = async (draw, config = {}) => {
        const engine = new Engine({ canvas: document.createElement('canvas'), state: { ...state, config: { ...state.config, ...config } }, scenes: { demo: draw }, icons: {}, images: new Map() });
        await engine.loadMath();
        return engine;
      };
      const boxes = [];
      const ids = [];
      const geometry = await make(s => {
        boxes.push(s.math('E=mc^2', { x: 400, y: 300, align: 'left', id: 'energy', at: 1 }));
        ids.push(s.get('energy'));
        s.arrow('energy', [1500, 300], { at: 1 });
        s.annotate('energy', { at: 2 });
      });
      geometry.drawScene(geometry.ctx, 0, 0.5);
      const box = boxes.at(-1);
      const id = ids.at(-1);
      const checks = await make(s => {
        s.math('x', { x: -10, y: 200, enter: 'none' });
        s.math('y', { x: 500, y: 400, size: 10, enter: 'none' });
        s.math('z', { x: 20, y: 600, align: 'left', enter: 'none' });
        s.math('a+b', { x: 900, y: 930, enter: 'none' });
        s.math('E=mc^2', { y: 800, enter: 'none' });
        s.text('Energy', { y: 800, enter: 'none' });
      }, { captions: true });
      const transformed = await make(s => s.math('x', { x: 900, y: 500, size: 72, scale: 2, rotate: 90, enter: 'none' }));
      transformed.textLog = [];
      transformed.drawScene(transformed.ctx, 0, 2);
      const log = transformed.textLog[0];
      const late = await make(s => s.math('x=' + Math.floor(s.t), { enter: 'none' }));
      const lateIssues = late.check();
      late.renderFrame(2);
      const invalid = await make(s => s.math(String.raw`\frac{1}`, { at: 1 }));
      let error;
      try { invalid.renderFrame(2); } catch (e) { error = { isSceneError: e instanceof SceneError, message: e.message }; }
      const entrances = [];
      for (const theme of ['paper', 'chalk', 'blueprint', 'clean', 'midnight']) {
        const engine = await make(s => s.math('x', { at: 1 }), { theme, sfx: true });
        const events = engine.collectEvents().events;
        const frames = [0, 1.25, 2.5].map(time => { engine.renderFrame(time); return engine.canvas.toDataURL(); });
        entrances.push({ theme, dur: events[0].dur, changing: new Set(frames).size });
      }
      return { box, id, issues: checks.check(), log, lateIssues, latePaths: [...late.mathCache.values()].every(d => d.paths.length > 0), error, entrances };
    });
    assert.equal(result.box.left, 400);
    assert.equal(result.box.y, 300);
    assert.ok(result.box.w > 0 && result.box.h > 0);
    for (const key of ['x', 'y', 'w', 'h', 'left', 'right', 'top', 'bottom']) assert.ok(Math.abs(result.id[key] - result.box[key]) < 1e-8, key);
    for (const pattern of [/runs off the frame/, /hard to read/, /closer.*edge/, /caption band/, /overlaps/]) assert.ok(result.issues.some(i => pattern.test(i.message)), String(pattern));
    assert.equal(result.log.size, 144);
    assert.ok(result.log.y1 - result.log.y0 > result.log.x1 - result.log.x0);
    assert.ok(result.lateIssues.some(i => i.level === 'error' && /keep TeX strings fixed/.test(i.message)));
    assert.equal(result.latePaths, true);
    assert.equal(result.error.isSceneError, true);
    assert.match(result.error.message, /\\frac\{1\}.*Missing argument/);
    for (const r of result.entrances) {
      assert.equal(r.changing, 3, r.theme);
      assert.equal(r.dur, ['clean', 'midnight'].includes(r.theme) ? 0.75 : 0.9, r.theme);
    }
  });
});
