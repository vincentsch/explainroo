import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPlayer } from '../src/export.js';
import { cacheRoot } from '../src/models.js';
import { languageFonts } from '../src/fonts.js';
import { findChrome } from '../src/browser.js';
import { loadProject, THEMES } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}

for (const language of ['ja', 'zh']) {
  const cached = languageFonts(language).every(f => fs.existsSync(f.path));
  test(`${language} uses cached Noto glyphs in every look and UI, with word and phrase cues`, { skip: !chrome || !cached }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cjk-browser-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ language, captions: true, sfx: false }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## demo\n解析住所');
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) { s.text('解析', { at: '解析' }); } };`);
    const project = loadProject(dir);
    const timeline = buildTimeline(project, { demo: { duration: 2, words: [{ text: '解析', start: 0, end: 1 }, { text: '住所', start: 1, end: 2 }], marks: {} } });
    const out = path.join(dir, 'player');
    const sentence = language === 'ja' ? '日本語の解析が始まります。' : '中文解析开始了。';
    copyPlayer(project, timeline, { assets: [], fonts: [], math: {}, text: sentence }, out);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'fonts/fonts.json')));
    assert.deepEqual(manifest.map(f => f.weight), [400, 700]);
    const subsets = languageFonts(language).map(f => fs.readFileSync(path.join(out, 'fonts', f.file)));
    for (const data of subsets) {
      assert.equal(data.subarray(0, 4).toString(), 'OTTO');
      assert.ok(data.length < 100_000, `${data.length} bytes`);
    }
    assert.deepEqual(fs.readFileSync(path.join(out, 'fonts/licenses/NotoSansCJK-OFL.txt')), fs.readFileSync(path.join(cacheRoot(), 'fonts', 'NotoSansCJK-OFL.txt')));
    await withEngine(project, timeline, {}, async (page, { server }) => {
      const result = await page.evaluate(async ([language, themes, sentence, subsets]) => {
        const { getTheme, fontString } = await import('/engine/themes.js');
        const { UI } = await import('/engine/ui.js');
        const { Stage } = await import('/engine/stage.js');
        let i = 0;
        // The exported player's reduced fonts still draw every character of the video.
        for (const [k, data] of subsets.entries()) {
          const face = new FontFace('Exported', Uint8Array.from(atob(data), c => c.charCodeAt(0)), { weight: String(400 + k * 300) });
          document.fonts.add(await face.load());
          for (const text of [sentence, '解析住所']) {
            const span = document.createElement('div');
            span.id = 'glyph' + i++;
            span.style.font = `${400 + k * 300} 48px Exported, serif`;
            span.textContent = text;
            document.body.append(span);
          }
        }
        for (const theme of themes) {
          const fonts = ['display', 'body', 'hand', 'mono'].map(role => fontString(getTheme(theme), role, 48));
          fonts.push(UI.prototype.fontString.call({ font: 'Inter' }, 48));
          for (const font of fonts) {
            const span = document.createElement('div');
            span.id = 'glyph' + i++;
            span.style.font = font;
            span.textContent = sentence;
            document.body.append(span);
          }
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        const s = Object.create(Stage.prototype);
        s.engine = { config: { language } };
        s.words = [{ text: '解析', start: 0.35, end: 1.35 }, { text: '住所', start: 1.35, end: 2.35 }];
        assertCue(s.cue('解析'), 0.35);
        assertCue(s.cueEnd('解析住所'), 2.35);
        s.words.push({ text: '名前の解析', start: 2.5, end: 3 });
        assertCue(s.cue('名前の解析'), 2.5);
        let rejected = false;
        try { s.cue('名前'); } catch { rejected = true; }
        if (!rejected) throw new Error('cue broke inside a word');
        function assertCue(actual, expected) { if (actual !== expected) throw new Error(`cue ${actual} != ${expected}`); }
        return { count: i, issues: window.explainroo.check() };
      }, [language, THEMES, sentence, subsets.map(data => data.toString('base64'))]);
      assert.deepEqual(result.issues.filter(i => i.level === 'error'), []);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      for (let i = 0; i < result.count; i++) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#glyph' + i });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.every(f => f.isCustomFont), JSON.stringify(fonts));
        assert.ok(fonts.some(f => f.familyName === (language === 'ja' ? 'Noto Sans CJK JP' : 'Noto Sans CJK SC')), JSON.stringify(fonts));
      }
      assert.equal((await fetch(server.url + '/language-fonts/' + language + '-400.otf')).status, 200);
      const other = language === 'ja' ? 'zh' : 'ja';
      if (languageFonts(other).every(f => fs.existsSync(f.path))) {
        project.config.language = other;
        assert.equal((await fetch(server.url + '/language-fonts/' + other + '-400.otf')).status, 200);
      }
      for (const file of ['NotoSansCJK-OFL.txt', 'ja-400.otf.part', '%2e%2e%2fmodels%2fconfig.json']) assert.equal((await fetch(server.url + '/language-fonts/' + file)).status, 404);
    });
  });
}
