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

test('code morphs draw deterministic tokens, highlights, geometry and sounds in the page', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-code-morph-'));
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'midnight', captions: false, music: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo(s) {} };');
    const project = loadProject(dir);
    const timeline = { pace: 1, duration: 6, frames: 180, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
      scenes: [{ id: 'demo', index: 0, start: 0, dur: 6, words: [{ text: 'filter', start: 2, end: 2.5 }], marks: { rename: 4 }, voice: null, lead: 0, transition: 'none' }] };
    await withEngine(project, timeline, {}, async page => {
      const result = await page.evaluate(async () => {
        const { boot } = await import('/engine/runtime.js');
        const { engine } = await boot({ canvas: document.createElement('canvas') });
        const steps = [
          { code: 'const total = items.length;', at: 0.5 },
          { code: 'const total = items\n  .filter((i) => i.active)\n  .length;', at: 'filter', highlight: [2] },
          { code: 'const activeCount = items\n  .filter((i) => i.active)\n  .length;', at: '#rename', highlight: [] },
        ];
        let drawn = [];
        let highlights = [];
        let geometry;
        const ctx = engine.ctx;
        const fillText = ctx.fillText.bind(ctx);
        const fillRect = ctx.fillRect.bind(ctx);
        ctx.fillText = (text, x, y) => {
          const pos = ctx.getTransform().transformPoint(new DOMPoint(x, y));
          drawn.push({ text, x: pos.x, y: pos.y, alpha: ctx.globalAlpha });
          fillText(text, x, y);
        };
        ctx.fillRect = (...args) => { highlights.push(ctx.globalAlpha); fillRect(...args); };
        const draw = (t, src = steps, o = {}) => {
          drawn = [];
          highlights = [];
          engine.scenesModule.demo = (s) => { geometry = s.code(src, { title: 'stats.js', size: 40, reveal: 'none', enter: 'none', ...o }); };
          engine.drawScene(ctx, 0, t);
          return { geometry, drawn, highlights, image: engine.canvas.toDataURL() };
        };
        const start = draw(1);
        const mid = draw(2.4);
        const end = draw(3);
        const renameOut = draw(4.2);
        const renameIn = draw(4.6);
        const last = draw(5);
        draw(0);
        const repeated = draw(2.4);
        const deterministic = repeated.image === mid.image;
        const firstMatches = ['none', 'type', 'lines'].every((reveal) =>
          draw(0.8, [steps[0]], { reveal }).image === draw(0.8, steps[0].code, { at: 0.5, reveal }).image);
        const finalMatches = last.image === draw(5, steps[2].code, { at: 0.5, w: last.geometry.w }).image;
        draw(0, steps, { reveal: 'type' });
        const events = engine.collectEvents().events;
        engine.sfxMode = 'minimal';
        const minimal = engine.collectEvents().events.filter((e) => e.sfx);
        engine.sfxMode = true;
        draw(0, steps, { sfx: false });
        const silent = engine.collectEvents().events.filter((e) => e.sfx);
        draw(1, [steps[0], { ...steps[1], at: 20 }, { ...steps[2], at: 21 }], { w: 200 });
        const issues = engine.check();
        return { start: start.geometry, mid: mid.geometry, end: end.geometry, last: last.geometry,
          lengthY: [start, mid, end].map((frame) => frame.drawn.find((d) => d.text === 'length')?.y),
          renameOut: renameOut.drawn, renameIn: renameIn.drawn,
          midHighlights: mid.highlights, lastHighlights: last.highlights,
          firstMatches, finalMatches, deterministic, events, minimal, silent, issues };
      });
      assert.equal(result.deterministic, true);
      assert.equal(result.firstMatches, true);
      assert.equal(result.finalMatches, true);
      assert.equal(result.start.w, result.end.w);
      assert.equal(result.end.w, result.last.w);
      assert.ok(Math.abs(result.mid.h - (result.start.h + result.end.h) / 2) < 1e-8);
      assert.ok(Math.abs(result.lengthY[1] - (result.lengthY[0] + result.lengthY[2]) / 2) < 1e-8);
      assert.ok(result.renameOut.some((d) => d.text === 'total' && Math.abs(d.alpha - 0.5) < 1e-8));
      assert.equal(result.renameOut.some((d) => d.text === 'activeCount'), false);
      assert.equal(result.renameIn.some((d) => d.text === 'total'), false);
      assert.ok(result.renameIn.some((d) => d.text === 'activeCount' && Math.abs(d.alpha - 0.5) < 1e-8));
      assert.ok(result.midHighlights.some((a) => Math.abs(a - 0.5) < 1e-8));
      assert.ok(result.lastHighlights.every((a) => a === 0));
      const sounds = result.events.filter((e) => e.sfx);
      assert.deepEqual(sounds.map((e) => [e.sfx, e.at]), [['type', 0.85], ['whoosh', 2], ['whoosh', 4]]);
      assert.ok(sounds.slice(1).every((e) => e.gain === 0.2));
      assert.deepEqual(result.minimal, []);
      assert.deepEqual(result.silent, []);
      for (const n of [1, 2, 3]) assert.ok(result.issues.some((i) => i.message.includes(`code step ${n} line`)));
      assert.ok(result.issues.some((i) => i.message.includes('20.00s but the scene ends')));
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
