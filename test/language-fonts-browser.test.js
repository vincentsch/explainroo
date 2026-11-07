// Hindi text in bold captions and in s.short is drawn with the Hindi font that
// explainroo brings, not with a font the computer happens to have, and an
// exported player brings that font along.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { prepare, withEngine } from '../src/pipeline.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// A Hindi video about keeping bread fresh, with bold captions. Its narration is
// already made, so no voice model is needed.
function hindi(t, scenes, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-hindi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ language: 'hi', size: 'tiktok', captions: 'bold', theme: 'clean', music: false, sfx: false, end: 0, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# रोटी\n\n## intro\nरोटी को *दो दिन* ताज़ा रखें।\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), scenes);
  cachedVoice(dir, 'intro');
  return dir;
}

test('Hindi in bold captions and in the short-video kit uses the Hindi font explainroo brings', { skip, timeout: 120000 }, async (t) => {
  const dir = hindi(t, "export default { intro(s) { s.short.sticker('दो दिन', { y: s.safe.y + s.safe.h * 0.5 }); } };");
  const project = loadProject(dir);
  const { timeline } = await prepare(project);
  // The first chunk of captions is on screen half a second in.
  const frame = Math.round(0.5 * timeline.fps);
  const drawn = await withEngine(project, timeline, {}, (page) => page.evaluate(async (f) => {
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText;
    const calls = [];
    proto.fillText = function (text, ...rest) {
      calls.push({ text: String(text), font: this.font });
      return fillText.call(this, text, ...rest);
    };
    try {
      await window.explainroo.frames([f], 0.9);
    } finally {
      proto.fillText = fillText;
    }
    // Each Hindi word, measured in the font it was drawn with and in the
    // bundled Hindi font alone, at the same weight and size.
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, text) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    return calls.filter((c) => /\p{Script=Devanagari}/u.test(c.text)).map((c) => {
      const size = c.font.match(/[\d.]+px/)[0];
      const bundled = `${c.font.slice(0, c.font.indexOf(size))}${size} "Noto Sans Devanagari"`;
      return { text: c.text, font: c.font, used: width(c.font, c.text), bundled: width(bundled, c.text) };
    });
  }, frame));
  const texts = drawn.map((d) => d.text);
  assert.ok(texts.includes('दो') && texts.includes('दिन'), `the frame draws the sticker's words: ${JSON.stringify(texts)}`);
  assert.ok(drawn.some((d) => /^रोटी|^को|^ताज़ा/.test(d.text)), `the frame draws a caption word: ${JSON.stringify(texts)}`);
  for (const d of drawn) assert.equal(d.used, d.bundled, `"${d.text}" in ${d.font} is drawn with another font than the bundled Hindi one`);
});

test('an exported Hindi video with bold captions brings the Hindi font, also when the captions are its only text', { skip, timeout: 180000 }, async (t) => {
  // No watermark and no text in the scene, so the export never draws text in a font that names the Hindi one.
  const dir = hindi(t, "export default { intro(s) { s.icon('wheat', { y: s.safe.y + s.safe.h * 0.5, size: 240, at: 0 }); } };", { watermark: false });
  const r = await cli(['export', dir, '--json']);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  const out = JSON.parse(r.stdout).out;
  const fonts = JSON.parse(fs.readFileSync(path.join(out, 'fonts/fonts.json'), 'utf8'));
  const devanagari = fonts.filter((f) => f.family === 'Noto Sans Devanagari');
  assert.deepEqual(devanagari.map((f) => f.weight).sort(), [400, 700]);
  for (const f of devanagari) assert.ok(fs.statSync(path.join(out, 'fonts', f.file)).size > 0, f.file);
  assert.ok(fs.existsSync(path.join(out, 'fonts/licenses/NotoSansDevanagari-OFL.txt')));
  assert.ok(fonts.some((f) => f.family === 'Inter'));
});
