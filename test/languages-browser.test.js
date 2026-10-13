import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject, THEMES } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}

const sentences = [
  '¿Qué pasó? ¡El niño llegó al café!',
  'La sœur prépare une leçon en français.',
  'La città è bella e il caffè è pronto.',
  'Não há açúcar, mas os pães são bons.',
  'हिन्दी में शब्दों और तस्वीरों से जानकारी समझाएँ।',
];

test('every look uses bundled fonts for all five languages, including Devanagari in captions and UI', { skip: !chrome }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-language-fonts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=3}');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) { s.title('Qué', { at: 0 }); } };`);
  for (const theme of THEMES) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme, captions: true, sfx: false }));
    const project = loadProject(dir);
    await withEngine(project, buildTimeline(project, {}), {}, async page => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      await page.evaluate(async ([sentences, theme]) => {
        const { getTheme, fontString } = await import('/engine/themes.js');
        const { UI } = await import('/engine/ui.js');
        const fonts = ['display', 'body', 'hand', 'mono'].map(role => fontString(getTheme(theme), role, 48));
        fonts.push(UI.prototype.fontString.call({ font: 'Inter' }, 48));
        let i = 0;
        for (const font of fonts) for (const sentence of sentences) {
          const span = document.createElement('div');
          span.id = 'glyph' + i++;
          span.style.font = font;
          span.textContent = sentence;
          document.body.append(span);
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }, [sentences, theme]);
      for (let i = 0; i < 25; i++) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#glyph' + i });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.length, `${theme} sentence ${i}`);
        assert.ok(fonts.every(f => f.isCustomFont), `${theme} sentence ${i}: ${JSON.stringify(fonts)}`);
        if (i % 5 === 4) assert.ok(fonts.some(f => f.familyName === 'Noto Sans Devanagari'), `${theme} Hindi fallback`);
      }
    });
  }
});

test('accented and Hindi cue words resolve to their spoken times in the page', { skip: !chrome }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-language-cues-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), '{}');
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo\nQué cœur pão città फ़ाइलें');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) {
    s.text('Qué', { y: 200, at: 'qué' }); s.text('cœur', { y: 300, at: 'CŒUR' });
    s.text('pão', { y: 400, at: 'PÃO' }); s.text('città', { y: 500, at: 'CITTÀ' });
    s.text('फ़ाइलें', { y: 600, at: 'फ़ाइलें' });
  } };`);
  const project = loadProject(dir);
  const words = project.script.scenes[0].units.map((u, i) => ({ text: u.display, start: i * 0.5, end: (i + 1) * 0.5 }));
  const timeline = buildTimeline(project, { demo: { duration: 2.5, words, marks: {} } });
  await withEngine(project, timeline, {}, async page => {
    const result = await page.evaluate(() => window.explainroo.check());
    assert.deepEqual(result.filter(i => i.level === 'error'), []);
  });
});
