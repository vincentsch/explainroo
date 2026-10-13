import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { buildTimeline } from '../src/timeline.js';
import { contrast } from '../engine/util.js';
import { colorOf, getTheme } from '../engine/themes.js';

let chrome;
try { chrome = findChrome(); } catch {}

for (const theme of ['paper', 'midnight']) {
  test(`check suggests usable colors on ${theme} without changing the warning threshold`, { skip: !chrome }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-contrast-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme, captions: false, music: false, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=2}');
    const fg = theme === 'paper' ? '#ffaaaa' : '#002233';
    const bg = getTheme(theme).bg;
    const texts = [
      { text: 'Small label', size: 40, color: fg },
      { text: 'Large label', size: 48, color: fg },
      { text: 'Own background', size: 40, color: '#bbbbbb', bg: 'rgba(255,255,255,0.95)' },
      { text: 'Above threshold', size: 40, color: '#888888', bg: '#ffffff' },
      { text: 'CSS color', size: 40, color: 'hsl(0, 100%, 83%)', bg: '#ffffff' },
    ];
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) {
      ${JSON.stringify(texts)}.forEach((o, i) => s.text(o.text, { ...o, y: 200 + i * 140, at: 0, enter: 'none' }));
    } };`);
    const project = loadProject(dir);
    await withEngine(project, buildTimeline(project, {}), { scale: 0.5 }, async page => {
      const issues = await page.evaluate(() => window.explainroo.check());
      const warnings = issues.filter(i => i.message.includes('low contrast against its background'));
      assert.equal(warnings.length, 4);
      assert.equal(issues.length, 4);
      for (const label of ['Small label', 'Large label']) {
        const warning = warnings.find(i => i.message.startsWith(`"${label}"`));
        const match = /background \((\d+\.\d):1\); use color: '([^']+)' \((\d+\.\d):1\)$/.exec(warning.message);
        assert.ok(match, warning.message);
        assert.equal(match[1], contrast(fg, bg).toFixed(1));
        const ratio = contrast(colorOf(getTheme(theme), match[2]), bg);
        assert.ok(ratio >= (label === 'Large label' ? 3 : 4.5));
        assert.equal(match[3], ratio.toFixed(1));
      }
      assert.match(warnings.find(i => i.message.startsWith('"Own background"')).message, /use color: '#/);
      assert.match(warnings.find(i => i.message.startsWith('"CSS color"')).message, /use color: '#/);
      const fixed = await page.evaluate(async warnings => {
        const { Engine, fetchState } = await import('/engine/runtime.js');
        const state = await fetchState();
        const colors = warnings.map(w => /use color: '([^']+)'/.exec(w.message)[1]);
        const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { demo(s) {
          colors.forEach((color, i) => s.text(`Fixed ${i}`, { color, bg: i >= 2 ? '#ffffff' : undefined, size: i === 1 ? 48 : 40, y: 200 + i * 140, at: 0, enter: 'none' }));
        } }, icons: {}, images: new Map() });
        return engine.check();
      }, warnings);
      assert.deepEqual(fixed, []);
    });
  });
}
