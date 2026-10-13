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

function fixture(t, look) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-look-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'look.json', captions: false, sfx: false, fonts: [{ family: 'Figtree', src: 'assets/font.woff2', weight: 700 }] }));
  fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify(look));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.copyFileSync(new URL('../examples/unspar-demo/assets/fonts/Figtree-700.woff2', import.meta.url), path.join(dir, 'assets/font.woff2'));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=2}\n\n## end {min=2}');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {
    demo(s) { s.text('Custom look', { y: 400, at: 0, size: 80 }); s.box('Example', { y: 650, at: 1 }); },
    end(s) { s.circle({ x: 960, y: 540, r: 100, at: 0 }); }
  };`);
  const project = loadProject(dir);
  return { dir, project, timeline: buildTimeline(project, {}) };
}

test('the page builds the custom look, loads its font and uses its transition without serving its JSON', { skip: !chrome }, async t => {
  const { project, timeline } = fixture(t, { extends: 'clean', dark: true, bg: '#152337', ink: '#ffffff', muted: '#c9d1cb', background: 'glow', transition: 'fade', music: 'calm', fonts: { body: { family: 'Figtree', weight: 700 } } });
  await withEngine(project, timeline, {}, async page => {
    const result = await page.evaluate(async () => {
      const { fetchState, Engine } = await import('/engine/runtime.js');
      const { getTheme } = await import('/engine/themes.js');
      const state = await fetchState();
      const theme = getTheme(state.config.theme, state.config.look);
      window.explainroo.frames([45, 61]);
      return {
        theme, music: state.config.music.style,
        transition: Engine.prototype.transitionFor.call({ theme }, state.timeline.scenes[1]),
        explicit: Engine.prototype.transitionFor.call({ theme }, { transition: 'cut' }),
        font: document.fonts.check('700 40px Figtree'),
        fetched: performance.getEntriesByType('resource').some(r => r.name.endsWith('/project/look.json')),
        status: (await fetch('/project/look.json')).status,
        issues: window.explainroo.check(),
      };
    });
    assert.equal(result.theme.background, 'glow');
    assert.equal(result.theme.bg, '#152337');
    assert.equal(result.theme.fonts.body.family, 'Figtree');
    assert.equal(result.font, true);
    assert.equal(result.transition, 'fade');
    assert.equal(result.explicit, 'cut');
    assert.equal(result.music, 'calm');
    assert.equal(result.fetched, false);
    assert.equal(result.status, 404);
    assert.deepEqual(result.issues, []);
  });
});

test('check warns about the custom look palette at the ink and muted thresholds', { skip: !chrome }, async t => {
  const { project, timeline } = fixture(t, { extends: 'clean', bg: '#ffffff', ink: '#888888', muted: '#bbbbbb' });
  await withEngine(project, timeline, {}, async page => {
    const result = await page.evaluate(async () => {
      const { Engine, fetchState } = await import('/engine/runtime.js');
      const state = await fetchState();
      const paletteWarnings = (config) => {
        const engine = new Engine({ canvas: document.createElement('canvas'), state: { ...state, config }, scenes: { demo(s) { s.circle({ at: 0 }); }, end(s) { s.circle({ at: 0 }); } }, icons: {}, images: new Map() });
        return engine.check().filter(i => i.message.startsWith('look.json:'));
      };
      return {
        low: paletteWarnings(state.config),
        good: paletteWarnings({ ...state.config, look: { ...state.config.look, ink: '#000000', muted: '#888888' } }),
        builtin: paletteWarnings({ ...state.config, theme: 'paper', look: null }),
      };
    });
    assert.equal(result.low.length, 2);
    assert.deepEqual(result.low.map(i => i.level), ['warn', 'warn']);
    assert.match(result.low[0].message, /ink.*at least 4.5/);
    assert.match(result.low[1].message, /muted.*at least 3/);
    assert.equal(result.low[0].scene, null);
    assert.deepEqual(result.good, []);
    assert.deepEqual(result.builtin, []);
  });
});

test('all six textures follow bg and render deterministically regardless of the base look', { skip: !chrome }, async t => {
  const { project, timeline } = fixture(t, { extends: 'clean' });
  await withEngine(project, timeline, {}, async page => {
    const results = await page.evaluate(async () => {
      const { getTheme, makeBackground } = await import('/engine/themes.js');
      return ['paper', 'dots', 'chalk', 'grid', 'glow', 'plain'].map(background => {
        const draw = (base, bg) => makeBackground(getTheme('', { extends: base, name: 'custom', background, bg }), 160, 90, 4);
        const a = draw('clean', '#9b5c32');
        const b = draw('paper', '#9b5c32');
        const c = draw('clean', '#28517a');
        const d = draw('clean', '#9b5c32');
        return { background, same: a.toDataURL() === b.toDataURL(), deterministic: a.toDataURL() === d.toDataURL(), changed: a.toDataURL() !== c.toDataURL(), pixel: [...a.getContext('2d').getImageData(80, 45, 1, 1).data] };
      });
    });
    for (const r of results) {
      assert.equal(r.same, true, r.background);
      assert.equal(r.deterministic, true, r.background);
      assert.equal(r.changed, true, r.background);
    }
    assert.deepEqual(results.at(-1).pixel, [155, 92, 50, 255]);
  });
});
