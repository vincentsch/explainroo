// Line charts with several series and numbers in the video's language. Each
// case draws scene bodies in a real page and reads the text check logs.
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

function project(t, settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-elements-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## one\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { one(s) {} };\n');
  const loaded = loadProject(dir);
  const { width, height } = loaded.config;
  const scene = { id: 'one', index: 0, start: 0, dur: 4, marks: {}, voice: null, lead: 0, transition: 'none', words: [] };
  return { project: loaded, timeline: { pace: 1, duration: 4, frames: 120, fps: 30, width, height, transitionSeconds: 0, scenes: [scene] } };
}

// Draws each scene body at time t, and gives what it returned, the text
// check logged and a hash of the pixels in `area` ([x, y, w, h]), or the
// error it threw.
const draw = (t, settings, bodies, { at = 3, area = null } = {}) => {
  const { project: p, timeline } = project(t, settings);
  return withEngine(p, timeline, { scale: 1 }, (page) => page.evaluate(async ({ bodies, at, area }) => {
    const { Engine, fetchState } = await import('/engine/runtime.js');
    const state = await fetchState();
    const out = [];
    for (const body of bodies) {
      let value = null;
      const fn = new Function('s', body);
      const canvas = document.createElement('canvas');
      const engine = new Engine({ canvas, state, scenes: { one(s) { value = fn(s); } }, icons: {}, images: new Map() });
      engine.textLog = [];
      try {
        engine.drawScene(engine.ctx, 0, at);
      } catch (e) {
        out.push({ error: e.message });
        continue;
      }
      let pixels = null;
      if (area) {
        const data = engine.ctx.getImageData(...area).data;
        let h = 0;
        for (let i = 0; i < data.length; i++) h = (h * 31 + data[i]) >>> 0;
        pixels = h;
      }
      out.push({ value, texts: engine.textLog.filter((x) => !x.problem).map(({ text, x0, y0, x1, y1, fg }) => ({ text, x0, y0, x1, y1, fg })), pixels });
    }
    return out;
  }, { bodies, at, area }));
};

test('s.lineChart takes several series on one scale, with each label at the end of its line, clear of the others, in the look\'s colors', { skip, timeout: 120000 }, async (t) => {
  const compound = Array.from({ length: 21 }, (_, n) => Math.round(1000 * 1.05 ** n));
  const simple = Array.from({ length: 21 }, (_, n) => 1000 + 50 * n);
  const [named, listed, close, bad, one] = await draw(t, { defaults: '0.6' }, [
    `return s.lineChart({ Compound: ${JSON.stringify(compound)}, Simple: ${JSON.stringify(simple)} }, { x: 900, y: 540, w: 1000, h: 600, at: 0 });`,
    `return s.lineChart([{ label: 'Compound', values: ${JSON.stringify(compound)} }, { label: 'Simple', values: ${JSON.stringify(simple)}, color: '#c2410c' }], { x: 900, y: 540, w: 1000, h: 600, at: 0 });`,
    // Two lines that end almost together.
    `return s.lineChart({ A: [1, 2, 10], B: [1, 3, 10.1], C: [2, 2, 2] }, { x: 900, y: 540, w: 1000, h: 600, at: 0 });`,
    `return s.lineChart({ A: [1, 'two'] }, { at: 0 });`,
    `return s.lineChart([1, 4, 9], { labels: ['Mon', 'Tue', 'Wed'], x: 900, y: 540, w: 1000, h: 600, at: 0 });`,
  ]);
  // x and y are the center of the plot, w and h its size.
  assert.deepEqual([named.value.left, named.value.top, named.value.right, named.value.bottom], [400, 240, 1400, 840]);
  const label = (r, text) => r.texts.find((x) => x.text === text);
  const [c, s] = [label(named, 'Compound'), label(named, 'Simple')];
  assert.ok(c && s, JSON.stringify(named.texts));
  // Right of the plot, at the height of the line's end on one shared scale:
  // the top is 1.1 times the highest value, 2653.
  const yOf = (v) => 840 - (v / (2653 * 1.1)) * 600;
  for (const [l, v] of [[c, 2653], [s, 2000]]) {
    assert.ok(l.x0 > 1400 && l.x0 < 1440, JSON.stringify(l));
    assert.ok(Math.abs((l.y0 + l.y1) / 2 - yOf(v)) < 2, JSON.stringify(l));
  }
  // The look's colors in order: the accent first, then the next of blue and
  // green; a series' own color wins.
  const theme = await import('../engine/themes.js');
  const clean = theme.getTheme('clean');
  assert.equal(c.fg, theme.colorOf(clean, 'accent'));
  assert.equal(s.fg, theme.colorOf(clean, ['blue', 'green'].find((n) => n !== clean.accent)));
  assert.equal(label(listed, 'Simple').fg, '#c2410c');
  // Labels whose lines end close together move apart until none touches another.
  const ends = ['A', 'B', 'C'].map((n) => label(close, n)).sort((a, b) => a.y0 - b.y0);
  assert.ok(ends[1].y0 >= ends[0].y1, JSON.stringify(ends));
  assert.ok(ends[2].y0 >= ends[1].y1, JSON.stringify(ends));
  assert.equal(bad.error, 'lineChart: series "A" needs values, an array of numbers');
  // One array works as before, and its labels under the axis are text for check now.
  assert.deepEqual(one.texts.map((x) => x.text), ['Mon', 'Tue', 'Wed']);
  assert.deepEqual([one.value.left, one.value.bottom], [400, 840]);
});

test('with "defaults": "0.6", s.number writes the number the way the video\'s language does, and keeps its unit with it', { skip, timeout: 120000 }, async (t) => {
  const bodies = [
    `s.number(1050, { suffix: ' €', at: 0 }); return null;`,
    `s.number(52.5, { decimals: 2, suffix: ' %', at: 0 }); return null;`,
    `s.number(1500000, { at: 0 }); return null;`,
    `s.number(1050, { locale: 'de-DE', prefix: 'EUR ', at: 0 }); return null;`,
    `s.number(1050, { separator: '.', at: 0 }); return null;`,
  ];
  const text = (r) => r.texts[0].text;
  const fr = await draw(t, { defaults: '0.6', language: 'fr', voice: 'ff_siwis' }, bodies);
  assert.deepEqual(fr.map(text), ['1 050 €', '52,50 %', '1 500 000', 'EUR 1.050', '1.050']);
  const en = await draw(t, { defaults: '0.6' }, bodies);
  assert.deepEqual(en.map(text), ['1,050 €', '52.50 %', '1,500,000', 'EUR 1.050', '1.050']);
  // Without the line, the number and its suffix stay as they were; locale still works.
  const old = await draw(t, { defaults: '0.5', language: 'fr', voice: 'ff_siwis' }, bodies);
  assert.deepEqual(old.map(text), ['1,050 €', '52.50 %', '1,500,000', 'EUR 1.050', '1.050']);
  const [wrong] = await draw(t, {}, [`s.number(5, { locale: 'not a tag', at: 0 });`]);
  assert.equal(wrong.error, 'number: locale "not a tag" is not a language tag; use one like "fr-FR" or "de-DE"');
});

