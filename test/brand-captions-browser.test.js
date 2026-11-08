// brand.accent colors the spoken word in normal captions, in real stills: a look
// file with caption colors wins, a dark accent keeps its hue made lighter with a
// hint from check, bold captions keep their palette, and the built-in look that
// every engine in a page shares never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome, launch, openEngine } from '../src/browser.js';
import { ffmpegPath } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { makeState, prepare } from '../src/pipeline.js';
import { startServer } from '../src/server.js';
import { layoutAreas } from '../engine/layout.js';
import { THEMES } from '../engine/themes.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SETTINGS = { size: '1280x720', theme: 'clean', captions: true, music: false, sfx: false, end: 0, camera: 'still', watermark: false };
const ORANGE = '#ff6a00';
const COLORS = {
  orange: (r, g, b) => r > 220 && g > 70 && g < 140 && b < 60,
  look: (r, g, b) => r > 110 && r < 135 && g > 150 && g < 175 && b > 245,
  green: (r, g, b) => r < 90 && g > 165 && b > 55 && b < 135,
  yellow: (r, g, b) => r > 220 && g > 180 && b < 110,
  // #94a9e8, the dark blue below made lighter.
  tinted: (r, g, b) => r > 135 && r < 160 && g > 158 && g < 182 && b > 220 && b < 245,
};
// clean's own highlight, which the look counter above finds.
assert.equal(THEMES.clean.caption.active, '#7aa2ff');

function bakery(t, settings, { script = '# Bread\n\n## intro\nFour loaves of bread are ready.\n', look = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-brand-captions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...SETTINGS, ...settings }));
  if (look) fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify(look));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.title('Bread', { y: 200, enter: 'none' }); } };");
  cachedVoice(dir, 'intro');
  return dir;
}

// The pixels of each color in the caption band of a still, and elsewhere.
async function colorsIn(dir, spec = 'intro@0.9') {
  const r = await cli(['still', dir, spec, '--json']);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  const file = JSON.parse(r.stdout).stills[0].file;
  const config = loadProject(dir).config;
  const { band } = layoutAreas(config, config.width, config.height);
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: config.width * config.height * 3 + 1e6 });
  const counts = Object.fromEntries(Object.keys(COLORS).map((k) => [k, { band: 0, elsewhere: 0 }]));
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const i = (y * config.width + x) * 3;
      for (const [name, is] of Object.entries(COLORS)) if (is(stdout[i], stdout[i + 1], stdout[i + 2])) counts[name][y >= band.top && y <= band.bottom ? 'band' : 'elsewhere']++;
    }
  }
  return counts;
}

test('brand.accent colors the spoken word in normal captions', { skip, timeout: 240000 }, async (t) => {
  const brand = await colorsIn(bakery(t, { brand: { accent: ORANGE } }));
  assert.ok(brand.orange.band > 150, `the spoken words are orange: ${JSON.stringify(brand)}`);
  assert.equal(brand.orange.elsewhere, 0);
  assert.equal(brand.look.band, 0, 'the look\'s highlight is gone');
  // Without a brand, the same still has the look's highlight.
  const plain = await colorsIn(bakery(t, {}));
  assert.ok(plain.look.band > 150, `the look's highlight: ${JSON.stringify(plain)}`);
  assert.equal(plain.orange.band, 0);
});

test('a look file with caption colors wins over brand.accent', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, { theme: 'look.json', brand: { accent: ORANGE } }, { look: { extends: 'clean', caption: { active: '#22c55e' } } });
  const counts = await colorsIn(dir);
  assert.ok(counts.green.band > 150, `the look's green: ${JSON.stringify(counts)}`);
  assert.equal(counts.orange.band, 0);
  // A look file without caption colors leaves the highlight to the brand.
  fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify({ extends: 'clean', bg: '#fbfaf7' }));
  const brand = await colorsIn(dir);
  assert.ok(brand.orange.band > 150, `the brand's orange: ${JSON.stringify(brand)}`);
});

test('a dark accent keeps its hue, made lighter until it reads, and check names that color in a hint', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, { brand: { accent: '#1e3a8a' } });
  const counts = await colorsIn(dir);
  assert.ok(counts.tinted.band > 150, `the lighter blue: ${JSON.stringify(counts)}`);
  assert.equal(counts.look.band, 0, 'not the look\'s highlight');
  const r = await cli(['check', dir, '--json']);
  assert.equal(r.code, 0, r.text);
  const hints = JSON.parse(r.stdout).issues.filter((i) => i.message.includes('brand.accent'));
  assert.deepEqual(hints.map((i) => [i.level, i.scene]), [['hint', null]]);
  assert.equal(hints[0].message, 'brand.accent #1e3a8a is hard to read on the caption background (1.0:1, below 3:1), so captions use #94a9e8, the same hue made lighter, at 4.5:1');
  // A readable accent gets no hint.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...SETTINGS, brand: { accent: ORANGE } }));
  const fine = await cli(['check', dir, '--json']);
  assert.equal(fine.code, 0, fine.text);
  assert.deepEqual(JSON.parse(fine.stdout).issues.filter((i) => i.message.includes('brand.accent')), []);
});

test('bold captions keep their palette with a brand accent', { skip, timeout: 240000 }, async (t) => {
  const counts = await colorsIn(bakery(t, { captions: 'bold', brand: { accent: ORANGE } }, { script: '# Bread\n\n## intro\n*Four* loaves of bread are ready.\n' }), 'intro@0.5');
  assert.ok(counts.yellow.band > 150, `the keyword keeps the bold yellow: ${JSON.stringify(counts)}`);
  assert.equal(counts.orange.band, 0);
});

test('a project without a brand, loaded after one with it in the same page, shows the look\'s own highlight', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, { brand: { accent: ORANGE } });
  const branded = loadProject(dir);
  const { timeline } = await prepare(branded);
  let state = makeState(branded, timeline);
  const server = await startServer({ projectDir: dir, getState: () => state });
  t.after(() => server.close());
  const browser = await launch();
  t.after(() => browser.close());
  // The page boots the branded project, as preview does when it opens.
  const page = await openEngine(browser, server.url, { scale: 0.5 });
  // Then video.json loses its brand, and the page boots again, as preview does on save.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(SETTINGS));
  const plain = loadProject(dir);
  state = makeState(plain, (await prepare(plain)).timeline);
  const seen = await page.evaluate(async ([top, bottom]) => {
    const { boot } = await import('/engine/runtime.js');
    const { THEMES: looks } = await import('/engine/themes.js');
    const canvas = document.createElement('canvas');
    const { engine } = await boot({ canvas, scale: 0.5 });
    engine.renderFrame(engine.timeline.scenes[0].start + 0.9);
    const d = canvas.getContext('2d').getImageData(0, Math.floor(top / 2), canvas.width, Math.ceil((bottom - top) / 2)).data;
    const count = { orange: 0, look: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 220 && g > 70 && g < 140 && b < 60) count.orange++;
      if (r > 110 && r < 135 && g > 150 && g < 175 && b > 245) count.look++;
    }
    return { count, active: engine.theme.caption.active, builtIn: looks.clean.caption.active };
  }, (() => { const { band } = layoutAreas(plain.config, plain.config.width, plain.config.height); return [band.top, band.bottom]; })());
  assert.equal(seen.builtIn, '#7aa2ff', 'the built-in look kept its highlight');
  assert.equal(seen.active, '#7aa2ff');
  assert.ok(seen.count.look > 30, `the look's highlight is drawn: ${JSON.stringify(seen.count)}`);
  assert.equal(seen.count.orange, 0);
});
