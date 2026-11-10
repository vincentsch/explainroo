// The words the kits and the formats draw by default come from the video's
// language, like "PASO 1/4" in Spanish, an option a scene sets wins, and check
// gives a hint when a video in another language shows the English word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { BUILT_IN } from '../src/formats.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { KIT_WORDS, englishKitWord, kitWord } from '../engine/words.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const LANGUAGES = ['en', 'es', 'fr', 'it', 'pt-br', 'hi', 'ja', 'zh', 'de'];

test('every kit word is there in every language', () => {
  for (const [key, words] of Object.entries(KIT_WORDS)) {
    for (const language of LANGUAGES) assert.ok(words[language], `${key} in ${language}`);
  }
  assert.equal(kitWord('step', 'es'), 'Paso');
  assert.equal(kitWord('step', 'xx'), 'Step');
  assert.deepEqual(englishKitWord('STEP 2/4'), { key: 'step', text: 'STEP 2/4' });
  assert.deepEqual(englishKitWord('Try it for free'), { key: 'try-free', text: 'Try it for free' });
  assert.equal(englishKitWord('PASO 2/4'), null);
  assert.equal(englishKitWord('Stepping stones'), null);
});

const SCENES = {
  plain: 's.short.step(1, 4);',
  own: "s.short.step(2, 4, { word: 'STEP' });",
  launch: "nameCard(s, 'Acme', 'Notas rápidas'); callToAction(s, { name: 'Acme', at: 0 });",
  ad: "offer(s, { name: 'Acme', at: 0 });",
};

// A video with the four scenes above, two seconds each, and the format helpers
// beside it, as init puts them.
function project(t, settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-kit-words-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '1080x1920', theme: 'studio', music: false, sfx: false, captions: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(SCENES).map((id) => `## ${id}\n`).join('\n'));
  fs.copyFileSync(path.join(BUILT_IN, 'product-launch', 'format.js'), path.join(dir, 'launch.js'));
  fs.copyFileSync(path.join(BUILT_IN, 'product-ad', 'format.js'), path.join(dir, 'ad.js'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `import { nameCard, callToAction } from './launch.js';\nimport { offer } from './ad.js';\nexport default {\n${Object.entries(SCENES).map(([id, body]) => `  ${id}(s) { ${body} },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  const scenes = Object.keys(SCENES).map((id, index) => ({ id, index, start: index * 2, dur: 2, marks: {}, voice: null, lead: 0, transition: 'none', words: [] }));
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: 8, frames: 240, fps: 30, width, height, transitionSeconds: 0, scenes } };
}

// check's findings, and the texts each scene shows at 1.9 seconds.
const run = ({ project: p, timeline }) => withEngine(p, timeline, { scale: 0.5 }, async (page) => {
  const issues = await page.evaluate(() => window.explainroo.check(0.25));
  const texts = await page.evaluate(async (count) => {
    const { Engine, fetchState } = await import('/engine/runtime.js');
    const state = await fetchState();
    const scenes = (await import(`/project/scenes.js?v=${state.version}`)).default;
    const { SFX } = await import('/engine/audio/soundtrack.js');
    const icons = await (await fetch('/engine/icons/lucide.json')).json().then((j) => j.icons);
    const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes, icons, images: new Map(), sfxNames: Object.keys(SFX) });
    const out = [];
    for (let index = 0; index < count; index++) {
      engine.textLog = [];
      engine.drawLog = { shapes: [], strokes: [], lives: [], shown: 0, order: 0 };
      engine.drawScene(engine.ctx, index, 1.9);
      out.push(engine.textLog.filter((x) => !x.problem && x.alpha > 0.5).map((x) => x.text));
    }
    return out;
  }, Object.keys(SCENES).length);
  return { issues, texts };
});

test('the kit and the formats draw their words in the video\'s language, and check names an English one', { skip, timeout: 120000 }, async (t) => {
  const { issues, texts } = await run(project(t, { language: 'es', defaults: '0.6' }));
  const [plain, own, launch, ad] = texts;
  assert.ok(plain.includes('PASO 1/4'), JSON.stringify(plain));
  assert.ok(own.includes('STEP 2/4'), 'an option the scene sets wins');
  assert.ok(launch.includes('Nuevo') && launch.includes('Pruébalo gratis'), JSON.stringify(launch));
  assert.ok(ad.includes('Pruébalo gratis'), JSON.stringify(ad));
  const hints = issues.filter((i) => /is a default word in English/.test(i.message));
  assert.deepEqual(hints.map((i) => [i.level, i.scene, i.message]), [
    ['hint', 'own', `"STEP 2/4" is a default word in English, and this video is in Spanish. Set the word, like s.short.step(n, total, { word: 'PASO' })`],
  ]);
});

test('an English video keeps its words, and without "defaults": "0.6" the step label stays STEP', { skip, timeout: 120000 }, async (t) => {
  const english = await run(project(t, { defaults: '0.6' }));
  assert.ok(english.texts[0].includes('STEP 1/4'));
  assert.ok(english.texts[2].includes('New') && english.texts[2].includes('Try it for free'));
  assert.equal(english.issues.filter((i) => /default word in English/.test(i.message)).length, 0);
  const old = await run(project(t, { language: 'es' }));
  assert.ok(old.texts[0].includes('STEP 1/4'), 'the frames of an older project stay as they were');
  assert.ok(old.issues.some((i) => i.scene === 'plain' && /"STEP 1\/4" is a default word in English/.test(i.message)), 'with a hint');
});
