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
import { contrast } from '../engine/util.js';
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
  // #b8400a, a brand's dark orange.
  rust: (r, g, b) => r > 170 && r < 200 && g > 50 && g < 80 && b < 30,
  // #ffd23f made darker until it reads on white.
  olive: (r, g, b) => r > 130 && r < 170 && g > 95 && g < 130 && b < 30,
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
      for (const [name, is] of Object.entries(COLORS)) if (is(stdout[i], stdout[i + 1], stdout[i + 2])) counts[name][band && y >= band.top && y <= band.bottom ? 'band' : 'elsewhere']++;
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

test('with "defaults": "0.5" a dark accent keeps its hue, made lighter until it reads, and check names that color in a hint', { skip, timeout: 240000 }, async (t) => {
  // Without the line, the captions keep the look's highlight, as before.
  const before = bakery(t, { brand: { accent: '#1e3a8a' } });
  const old = await colorsIn(before);
  assert.ok(old.look.band > 150, `the look's highlight: ${JSON.stringify(old)}`);
  assert.equal(old.tinted.band, 0);
  const said = await cli(['check', before, '--json']);
  assert.deepEqual(JSON.parse(said.stdout).issues.filter((i) => i.message.includes('brand.accent')).map((i) => i.message), ["brand.accent #1e3a8a is hard to read on the caption background (1.0:1, below 3:1), so captions keep the look's highlight #7aa2ff"]);
  const dir = bakery(t, { brand: { accent: '#1e3a8a' }, defaults: '0.5' });
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

// The color of one pixel of a still.
async function pixelOf(dir, spec, x, y) {
  const r = await cli(['still', dir, spec, '--json']);
  assert.equal(r.code, 0, r.text);
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', JSON.parse(r.stdout).stills[0].file, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [...stdout];
}

test('with "defaults": "0.6" brand.accent colors starred words in s.title and s.text, and brand.background is the background', { skip, timeout: 240000 }, async (t) => {
  const scene = "export default { intro(s) { s.title('Fresh *bread*', { y: 200, enter: 'none' }); s.text('Baked *today*', { y: 420, enter: 'none' }); } };";
  const settings = { captions: false, brand: { accent: '#b8400a', background: '#f6e7c8' } };
  const dir = bakery(t, { ...settings, defaults: '0.6' });
  fs.writeFileSync(path.join(dir, 'scenes.js'), scene);
  const counts = await colorsIn(dir);
  assert.ok(counts.rust.elsewhere > 500, `the starred words are in the brand's color: ${JSON.stringify(counts)}`);
  const [r, g, b] = await pixelOf(dir, 'intro@0.9', 20, 700);
  assert.ok(Math.abs(r - 0xf6) < 6 && Math.abs(g - 0xe7) < 6 && Math.abs(b - 0xc8) < 6, `the brand's background: ${[r, g, b]}`);
  // Before 0.6, the brand stays with s.ui and the captions, so the frames stay the same.
  const old = bakery(t, { ...settings, defaults: '0.5' });
  fs.writeFileSync(path.join(old, 'scenes.js'), scene);
  assert.equal((await colorsIn(old)).rust.elsewhere, 0);
  const [r0, g0, b0] = await pixelOf(old, 'intro@0.9', 20, 700);
  assert.ok(Math.abs(r0 - g0) < 8 && Math.abs(g0 - b0) < 12, `the look's own background: ${[r0, g0, b0]}`);
  // An accent that is hard to read on the background keeps its hue and gets darker.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...SETTINGS, ...settings, brand: { accent: '#ffd23f', background: '#ffffff' }, defaults: '0.6' }));
  const pale = await colorsIn(dir);
  assert.ok(pale.olive.elsewhere > 500 && pale.yellow.elsewhere < 100, `darker yellow words on white: ${JSON.stringify(pale)}`);
});

test('check names brand.accent, its contrast and the color used instead when starred words or hook keywords can\'t use it', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, { captions: false, defaults: '0.6', brand: { accent: '#ffd23f', background: '#ffffff' } });
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.title('Fresh *bread*', { y: 200, enter: 'none' }); s.text('Baked *today*', { y: 420, enter: 'none' }); } };");
  const accentHints = async () => JSON.parse((await cli(['check', dir, '--json'])).stdout).issues.filter((i) => i.message.startsWith('brand.accent'));
  const [starred, ...more] = await accentHints();
  assert.deepEqual(more, [], 'one hint for the whole video');
  assert.equal(starred.level, 'hint');
  assert.match(starred.message, /^brand\.accent #ffd23f is hard to read on the background \(1\.\d:1, below 3:1\), so \*starred\* words use #[0-9a-f]{6}, the same hue made darker$/);
  // A slab hook in a short: white keywords on the accent read poorly, so the box
  // keeps the accent's hue, made darker until white reads on it.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.short.hook('Solve it in *seconds*', { style: 'slab' }); } };");
  for (const [accent, ratio] of [['#f96932', '2.9'], ['#4dabf7', '2.4']]) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...SETTINGS, size: 'shorts', captions: false, defaults: '0.6', brand: { accent } }));
    cachedVoice(dir, 'intro');
    const hints = await accentHints();
    assert.equal(hints.length, 1, JSON.stringify(hints));
    const used = new RegExp(`^brand\\.accent ${accent} is hard to read as the box behind white keywords in the hook \\(${ratio.replace('.', '\\.')}:1, below 3:1\\), so their box uses (#[0-9a-f]{6}), the same hue made darker$`).exec(hints[0].message)?.[1];
    assert.ok(used, hints[0].message);
    assert.ok(contrast('#ffffff', used) >= 3, `${used} reads behind white`);
    const hue = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI; };
    assert.ok(Math.abs(hue(used) - hue(accent)) < 4, `${used} keeps the hue of ${accent}`);
  }
  // An accent that reads gives no hint.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...SETTINGS, size: 'shorts', captions: false, defaults: '0.6', brand: { accent: '#b8400a' } }));
  cachedVoice(dir, 'intro');
  assert.deepEqual(await accentHints(), []);
});
