// Numbers in the video's language. Each case draws scene bodies in a real
// page and reads the text check logs.
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

