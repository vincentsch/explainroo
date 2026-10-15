import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}

test('the camera measures what scenes draw where and as big as it is drawn', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-camera-'));
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', captions: false, watermark: false, music: false, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=8}\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo(s) {} };');
    const project = loadProject(dir);
    await withEngine(project, buildTimeline(project, {}), {}, async (page) => {
      const r = await page.evaluate(async () => {
        const { Engine, fetchState } = await import('/engine/runtime.js');
        const state = await fetchState();
        const plan = (demo) => {
          const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { demo }, icons: { dot: ['M0 0L24 24'] }, images: new Map() });
          engine.planCameras();
          return engine.cameraPlans.get(0)?.elements ?? [];
        };
        const out = {};
        // Random positions: planned where they are drawn, one call each.
        let calls = 0;
        const drawn = [];
        const scene = (s) => {
          for (let i = 0; i < 3; i++) s.draw({ at: 0 }, (ctx) => { calls++; const x = 200 + Math.random() * 1400; drawn.push(x); ctx.fillRect(x, 400, 100, 100); });
        };
        out.random = { planned: plan(scene).filter((e) => e.kind === 'custom').map((e) => e.box.x - 50), calls };
        const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { demo: scene }, icons: {}, images: new Map() });
        drawn.length = 0;
        engine.renderFrame(4);
        out.random.drawn = [...drawn];
        // A drawing on its way out is measured at its full size.
        out.leaving = plan((s) => s.draw({ at: 0, out: 7.9, exit: 'pop' }, (ctx) => ctx.fillRect(700, 400, 400, 200))).find((e) => e.kind === 'custom')?.box;
        // Stroke widths count, through the transform.
        out.stroked = plan((s) => s.draw({ x: 960, y: 540, at: 0 }, (ctx) => { ctx.lineWidth = 300; ctx.strokeRect(-50, -150, 100, 300); })).find((e) => e.kind === 'custom')?.box;
        // A sharp miter corner reaches past half the line width.
        out.miter = plan((s) => s.draw({ at: 0 }, (ctx) => {
          ctx.lineWidth = 50;
          ctx.beginPath(); ctx.moveTo(900, 650); ctx.lineTo(960, 400); ctx.lineTo(1020, 650); ctx.closePath(); ctx.stroke();
        })).find((e) => e.kind === 'custom')?.box;
        // Sharp corners under a squeezed transform, after a rectangle, and
        // on curves without a moveTo reach as far as Chrome draws them.
        const ink = (paint) => {
          const c = document.createElement('canvas');
          c.width = 1920; c.height = 1080;
          const g = c.getContext('2d');
          g.strokeStyle = '#f00';
          paint(g);
          const d = g.getImageData(0, 0, 1920, 1080).data;
          const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
          for (let i = 3; i < d.length; i += 4) if (d[i] > 128) {
            const x = ((i - 3) / 4) % 1920;
            const y = Math.floor((i - 3) / 4 / 1920);
            b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x + 1); b.y1 = Math.max(b.y1, y + 1);
          }
          return b;
        };
        const strokes = {
          squeezed: (ctx) => { ctx.scale(0.5, 1); ctx.lineWidth = 50; ctx.beginPath(); ctx.moveTo(1880, 650); ctx.lineTo(1920, 400); ctx.lineTo(1960, 650); ctx.closePath(); ctx.stroke(); },
          stretched: (ctx) => { ctx.scale(1, 0.5); ctx.lineWidth = 40; ctx.lineCap = 'square'; ctx.beginPath(); ctx.moveTo(800, 1000); ctx.lineTo(1100, 1200); ctx.stroke(); },
          afterRect: (ctx) => { ctx.lineWidth = 50; ctx.beginPath(); ctx.rect(930, 650, 60, 50); ctx.lineTo(960, 400); ctx.lineTo(990, 650); ctx.stroke(); },
          curve: (ctx) => { ctx.lineWidth = 40; ctx.lineCap = 'square'; ctx.beginPath(); ctx.quadraticCurveTo(700, 300, 900, 600); ctx.stroke(); },
          backwards: (ctx) => { ctx.lineWidth = 100; ctx.strokeRect(900, 500, -100, -100); ctx.strokeRect(1300, 500, -100, 100); },
          arcTo: (ctx) => { ctx.lineWidth = 40; ctx.beginPath(); ctx.moveTo(800, 700); ctx.arcTo(960, 300, 1000, 700, 10); ctx.lineTo(1300, 300); ctx.stroke(); },
        };
        out.strokes = Object.fromEntries(Object.entries(strokes).map(([k, paint]) => {
          const box = plan((s) => s.draw({ at: 0 }, paint)).find((e) => e.kind === 'custom')?.box;
          return [k, { box: { x0: box.x - box.w / 2, y0: box.y - box.h / 2, x1: box.x + box.w / 2, y1: box.y + box.h / 2 }, ink: ink(paint) }];
        }));
        // A group on its way out is measured where it rests.
        out.groupLeaving = plan((s) => s.group({ x: 960, y: 540, at: 0, out: 7.55, exit: 'pop' }, () => {
          s.draw({ at: 0 }, (ctx) => ctx.fillRect(-550, -100, 1100, 200));
        })).find((e) => e.kind === 'custom')?.box;
        // A drawing's random numbers do not depend on which drawings are on screen.
        const xs = [];
        const two = (s) => {
          s.draw({ at: 0, out: 2 }, (ctx) => { const x = 200 + Math.random() * 1400; xs.push(['early', s.t, x]); ctx.fillRect(x, 400, 100, 100); });
          s.draw({ at: 0 }, (ctx) => { const x = 200 + Math.random() * 1400; xs.push(['always', s.t, x]); ctx.fillRect(x, 600, 100, 100); });
        };
        out.hidden = { planned: plan(two).filter((e) => e.kind === 'custom').map((e) => e.box.x - 50) };
        const twice = new Engine({ canvas: document.createElement('canvas'), state, scenes: { demo: two }, icons: {}, images: new Map() });
        xs.length = 0;
        twice.renderFrame(1);
        out.hidden.drawn = xs.map((v) => v[2]);
        // An icon's label grows with the icon.
        out.label = plan((s) => s.icon('dot', { x: 960, y: 400, size: 120, label: 'A label much wider than its icon', labelSize: 48, scale: 2, at: 0, enter: 'none' })).find((e) => e.kind === 'icon')?.box;
        // A highlight in each code step is where that step's line is.
        out.focus = plan((s) => s.code([
          { code: Array.from({ length: 12 }, (_, i) => `const line${i} = ${i};`).join('\n'), at: 0, highlight: [1] },
          { code: 'done();', at: 4, highlight: [1] },
        ], { reveal: 'none', size: 32 })).filter((e) => e.kind === 'focus').map((e) => e.box.y);
        return out;
      });
      assert.equal(r.random.calls, 3);
      r.random.planned.forEach((x, i) => assert.ok(Math.abs(x - r.random.drawn[i]) < 1e-6, JSON.stringify(r.random)));
      assert.deepEqual([r.leaving.w, r.leaving.h].map(Math.round), [400, 200]);
      assert.deepEqual([r.stroked.x, r.stroked.y, r.stroked.w, r.stroked.h].map(Math.round), [960, 540, 400, 600]);
      assert.ok(r.label.w > 1300, `label width ${r.label.w}`);
      // The tip at (960, 400) turns by about 27 degrees: its miter reaches about 107 pixels higher.
      assert.ok(r.miter.y - r.miter.h / 2 < 300, JSON.stringify(r.miter));
      assert.deepEqual(r.hidden.planned.map(Math.round), r.hidden.drawn.map(Math.round));
      for (const [k, { box, ink }] of Object.entries(r.strokes)) {
        assert.ok(box.x0 <= ink.x0 + 0.5 && box.y0 <= ink.y0 + 0.5 && box.x1 >= ink.x1 - 0.5 && box.y1 >= ink.y1 - 0.5, `${k}: ${JSON.stringify({ box, ink })}`);
      }
      assert.equal(Math.round(r.groupLeaving.w), 1100);
      // The 12-line window starts much higher than the one-line window.
      assert.ok(r.focus[0] < r.focus[1] - 200, JSON.stringify(r.focus));
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('large type tracking stays with its own text', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-tracking-'));
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', captions: false, watermark: false, music: false, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=8}\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo(s) {} };');
    const project = loadProject(dir);
    await withEngine(project, buildTimeline(project, {}), {}, async (page) => {
      const [alone, after] = await page.evaluate(async () => {
        const { Engine, fetchState } = await import('/engine/runtime.js');
        const state = await fetchState();
        const box = (withTitle) => {
          let b;
          const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { demo(s) {
            // A hidden title is still laid out; its tracking must not reach the box.
            if (withTitle) s.title('A big hidden title', { at: 6 });
            b = s.box('Some words that wrap in a narrow box', { x: 960, y: 700, w: 420, size: 40, at: 0, enter: 'none' });
          } }, icons: {}, images: new Map() });
          engine.renderFrame(1);
          return b.h;
        };
        return [box(false), box(true)];
      });
      assert.equal(after, alone);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
