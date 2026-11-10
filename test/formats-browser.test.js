// Every built-in format's example passes check, and so does a project that init
// made from it. The narration is cached, so the voice model never loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { ffmpegPath } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { BUILT_IN, readFormat, startFromFormat } from '../src/formats.js';
import { cachedVoice } from './helpers/cached-voice.js';
import { runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

for (const name of fs.readdirSync(BUILT_IN).sort()) {
  test(`the ${name} format checks without errors or warnings, from init`, { skip }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-check-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'video');
    const made = await runCli(['init', dir, '--format', name]);
    assert.equal(made.code, 0, made.text);
    for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
    const r = await runCli(['check', dir, '--json']);
    const { issues } = JSON.parse(r.stdout);
    const bad = issues.filter((i) => i.level === 'error' || i.level === 'warn');
    assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  });
}

// A format with its own look and a helper module that format.js imports: both
// come into the new project, so check loads the scenes and draws them.
test('a project from a format with a look file and helper modules checks without errors', { skip }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const from = path.join(root, 'format');
  fs.cpSync(path.join(BUILT_IN, 'narrated-explainer'), from, { recursive: true });
  const settings = JSON.parse(fs.readFileSync(path.join(from, 'video.json'), 'utf8'));
  fs.writeFileSync(path.join(from, 'video.json'), JSON.stringify({ ...settings, theme: 'look.json' }));
  fs.writeFileSync(path.join(from, 'format.json'), JSON.stringify({ name: 'own-look', description: 'With its own look.', author: 'Jane Doe', version: '0.1.0' }));
  fs.writeFileSync(path.join(from, 'look.json'), JSON.stringify({ extends: 'paper', bg: '#ededed' }));
  fs.mkdirSync(path.join(from, 'lib'));
  fs.writeFileSync(path.join(from, 'lib', 'size.js'), 'export const share = 100;\n');
  const code = fs.readFileSync(path.join(from, 'format.js'), 'utf8');
  fs.writeFileSync(path.join(from, 'format.js'), `import { share } from './lib/size.js';\n${code.replace('/ 100;', '/ share;')}`);
  const dir = path.join(root, 'video');
  startFromFormat(readFormat(from), dir, { ...settings, theme: 'look.json', title: 'Ice' });
  for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
  const r = await runCli(['check', dir, '--json']);
  assert.equal(r.code, 0, r.text);
  const { issues } = JSON.parse(r.stdout);
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
});

test('the formats start with the 0.6 defaults, and the product formats in the studio look', () => {
  for (const name of fs.readdirSync(BUILT_IN)) {
    const settings = JSON.parse(fs.readFileSync(path.join(BUILT_IN, name, 'video.json'), 'utf8'));
    assert.equal(settings.defaults, '0.6', name);
    if (name.startsWith('product-')) assert.equal(settings.theme, 'studio', name);
  }
});

// vertical-short fills the tall frame below the captions: a faint copy of each
// beat's picture comes in there with the beat, from s.full, and its words stay
// in s.safe, where check finds nothing outside it.
test('vertical-short draws pictures below the captions, and keeps its words inside s.safe', { skip }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-full-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'video');
  assert.equal((await runCli(['init', dir, '--format', 'vertical-short'])).code, 0);
  for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
  const { issues } = JSON.parse((await runCli(['check', dir, '--json'])).stdout);
  assert.deepEqual(issues.filter((i) => /content area|caption band|off the frame/.test(i.message)), []);
  // At an app's size, long words in fact() and beats() stay in the content
  // area, also at the zoom of the scene's punch().
  const tiktok = path.join(root, 'tiktok');
  assert.equal((await runCli(['init', tiktok, '--format', 'vertical-short', '--size', 'tiktok'])).code, 0);
  const file = path.join(tiktok, 'scenes.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace("label: 'It comes back'", "label: 'It may come back after all'")
    .replace("fact(s, '*20%*', { at: '#twenty' });", "fact(s, 'Only *20%* left in the cold', { at: '#twenty' });"));
  for (const scene of loadProject(tiktok).script.scenes) cachedVoice(tiktok, scene.id);
  const long = JSON.parse((await runCli(['check', tiktok, '--json'])).stdout).issues;
  assert.deepEqual(long.filter((i) => /content area|caption band|off the frame/.test(i.message)), []);
  // "why" starts on the background alone, and its first beat comes on "still".
  assert.equal((await runCli(['still', dir, 'why@0.1', 'why@end', '--no-watermark'])).code, 0);
  const stills = path.join(dir, 'out', 'stills-no-watermark');
  const files = fs.readdirSync(stills).sort();
  assert.equal(files.length, 2, files.join(', '));
  // A band of the lower frame, between the captions and the apps' post text.
  const band = (file) => execFileSync(ffmpegPath(), ['-loglevel', 'error', '-i', path.join(stills, file), '-vf', 'format=gray,crop=600:240:240:1450', '-f', 'rawvideo', '-']);
  const [before, after] = [band(files.find((f) => f.includes('0.1'))), band(files.find((f) => f.includes('end')))];
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - after[i]) > 12) changed++;
  assert.ok(changed / before.length > 0.05, `only ${changed} of ${before.length} pixels below the captions changed`);
});

test('vertical-short keeps the hook title clear of the watermark at its punch, and fact() clear of the hook picture', { skip }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hook = {
    // A two-line title with a kicker leaves little room under it at the
    // zoom, and fact() at its own place still finds the band left for it.
    kicker: `s.camera(punch(s, '#dies', { zoom: 1.15 }));
    hookFrame(s, 'Come le api fanno il *miele*', { icon: 'flower-2', color: 'yellow', kicker: 'Natura' });
    fact(s, '*< 1 g* a vita', { at: '#twenty' });`,
    // Without a kicker, the title is placed in the part of s.safe the zoom keeps.
    plain: `s.camera(punch(s, '#dies', { zoom: 1.15 }));
    hookFrame(s, 'Come le api fanno il *miele*', { icon: 'flower-2', color: 'yellow' });
    fact(s, '*< 1 g* a vita', { at: '#twenty' });`,
    // A punch after the title zooms in no further than keeps it in s.safe.
    late: `hookFrame(s, 'Come le api fanno il *miele*', { icon: 'flower-2', color: 'yellow' });
    s.camera(punch(s, '#dies', { zoom: 1.4 }));
    fact(s, '*< 1 g* a vita', { at: '#twenty' });`,
  };
  for (const [name, body] of Object.entries(hook)) {
    const dir = path.join(root, name);
    assert.equal((await runCli(['init', dir, '--format', 'vertical-short', '--size', 'shorts'])).code, 0);
    const file = path.join(dir, 'scenes.js');
    const scenes = fs.readFileSync(file, 'utf8').replace(/ {2}hook\(s\) \{[\s\S]*?\n {2}\},/, `  hook(s) {\n    ${body}\n  },`);
    assert.match(scenes, /< 1 g/);
    fs.writeFileSync(file, scenes);
    for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
    const { issues } = JSON.parse((await runCli(['check', dir, '--json'])).stdout);
    const hookIssues = issues.filter((i) => i.scene === 'hook' && (i.level === 'warn' || i.level === 'error'));
    const order = issues.filter((i) => /s\.camera comes after/.test(i.message));
    assert.deepEqual(hookIssues, [], `${name}: ${JSON.stringify(hookIssues, null, 2)}`);
    assert.equal(order.length, name === 'late' ? 1 : 0, name);
  }
});

// The step label stays where it is while the camera zooms. fact() keeps clear
// of it at every zoom of the scene's punch(), and beats() leaves the sticker a
// band below it.
test('vertical-short keeps fact() clear of the step label at the zoom of its punch', { skip }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-step-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const size of ['reels', 'shorts']) {
    const dir = path.join(root, size);
    assert.equal((await runCli(['init', dir, '--format', 'vertical-short', '--size', size])).code, 0);
    const file = path.join(dir, 'scenes.js');
    const scenes = fs.readFileSync(file, 'utf8')
      .replace('s.short.step(2, 2);', "s.short.step(2, 2, { word: 'BREWLY' });")
      .replace(/(\{ at: '#back', icon: 'battery-full', label: 'It comes back', color: 'green' \},\n {4}\]\);)/, "$1\n    fact(s, '*50%* off', { at: '#warm' });");
    assert.match(scenes, /50%/);
    fs.writeFileSync(file, scenes);
    for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
    const { issues } = JSON.parse((await runCli(['check', dir, '--json'])).stdout);
    const bad = issues.filter((i) => i.level === 'warn' || i.level === 'error');
    assert.deepEqual(bad, [], `${size}: ${JSON.stringify(bad, null, 2)}`);
  }
});

// The closing card of vertical-short fills the content area in a tall frame,
// and its words stay in it at the zoom of the scene's punch(). `w` sets another
// width, and the card's box comes back.
test('vertical-short payoff() fills the content area in a tall frame and takes w', { skip }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-payoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = {
    full: ['{ zoom: 1.12 }', '', 'Math.abs(card.w - s.safe.w) < 0.5'],
    zoomed: ['{ zoom: 1.25 }', '', 'card.w < s.safe.w - 50'],
    own: ['{ zoom: 1.12 }', ', { w: 600 }', 'card.w === 600'],
  };
  for (const [name, [zoom, options, holds]] of Object.entries(cases)) {
    const dir = path.join(root, name);
    assert.equal((await runCli(['init', dir, '--format', 'vertical-short', '--size', 'reels'])).code, 0);
    const file = path.join(dir, 'scenes.js');
    const scenes = fs.readFileSync(file, 'utf8')
      .replace("punch(s, '#harm', { zoom: 1.12 })", `punch(s, '#harm', ${zoom})`)
      .replace("payoff(s, 'Keep it warm', [", 'const card = payoff(s, \'Keep it warm\', [')
      .replace(/(\{ text: 'No charging while frozen', at: '#charge' \},\n {4}\])\);/, `$1${options});\n    if (!(${holds})) throw new Error('the card is ' + card.w + ' wide');`);
    assert.match(scenes, /the card is/);
    fs.writeFileSync(file, scenes);
    for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
    const { issues } = JSON.parse((await runCli(['check', dir, '--json'])).stdout);
    const bad = issues.filter((i) => i.level === 'warn' || i.level === 'error');
    assert.deepEqual(bad, [], `${name}: ${JSON.stringify(bad, null, 2)}`);
  }
});

// A short made from vertical-short's helpers, as an app's TikTok: its brand
// color, a kicker on the hook, and the app's icon on the closing card.
test('vertical-short payoff() puts its icon on the card, the kicker takes brand.accent, and the card\'s lines are balanced', { skip }, async (t) => {
  const { withEngine } = await import('../src/pipeline.js');
  const { suggestColor } = await import('../engine/util.js');
  const look = async (defaults) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-app-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.copyFileSync(path.join(BUILT_IN, 'vertical-short', 'format.js'), path.join(dir, 'format.js'));
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'midnight', size: 'tiktok', captions: false, music: false, sfx: false, camera: 'still', brand: { accent: '#ff4fa3' }, ...(defaults ? { defaults } : {}) }));
    fs.writeFileSync(path.join(dir, 'script.md'), '## hook\n\n## outro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), `import { hookFrame, payoff } from './format.js';
export default {
  hook(s) {
    const round = s.short.roundRect.bind(s.short);
    s.short.roundRect = (x, y, w, h, r, fill, ...rest) => { globalThis.fills.add(fill); return round(x, y, w, h, r, fill, ...rest); };
    hookFrame(s, 'Learn *10* new words a day', { icon: 'languages', kicker: 'Lingopop' });
  },
  outro(s) {
    const icon = s.short.icon.bind(s.short);
    s.short.icon = (name, ...rest) => { globalThis.cardIcons.add(name); return icon(name, ...rest); };
    payoff(s, 'Lingopop', ['10 words a day in 5 minutes', '10 words, 5 minutes a day'], { icon: 'languages', at: 0 });
  },
};
`);
    const project = loadProject(dir);
    const scenes = ['hook', 'outro'].map((id, index) => ({ id, index, start: index * 4, dur: 4, marks: {}, voice: null, lead: 0, transition: 'none', words: [] }));
    const { width, height } = project.config;
    const timeline = { pace: 1, duration: 8, frames: 240, fps: 30, width, height, transitionSeconds: 0, scenes };
    return withEngine(project, timeline, { scale: 0.5 }, (page) => page.evaluate(() => {
      globalThis.cardIcons = new Set();
      globalThis.fills = new Set();
      const card = window.explainroo.textsAt(1, 3).map((x) => x.text);
      window.explainroo.textsAt(0, 1);
      return { card, icons: [...globalThis.cardIcons], fills: [...globalThis.fills] };
    }));
  };
  const now = await look('0.6');
  // The card shows the app's icon, not the check mark of its tone.
  assert.ok(now.icons.includes('languages') && !now.icons.includes('circle-check'), JSON.stringify(now.icons));
  // The kicker's pill is the brand's pink, made darker until its white words read.
  const pink = suggestColor('#ff4fa3', '#ffffff', 44).color;
  assert.ok(now.fills.includes(pink) && !now.fills.includes('#e5233d'), `${pink}: ${JSON.stringify(now.fills)}`);
  // No word sits alone on a line of the card.
  const lines = now.card.filter((x) => x !== 'Lingopop');
  assert.ok(lines.length >= 3 && lines.every((l) => l.trim().includes(' ')), JSON.stringify(now.card));
  // With "defaults": "0.5", the kicker stays red and the lines wrap as before,
  // which leaves a word alone.
  const old = await look('0.5');
  assert.ok(old.fills.includes('#e5233d') && !old.fills.includes(pink), JSON.stringify(old.fills));
  assert.ok(old.card.some((l) => l !== 'Lingopop' && !l.trim().includes(' ')), JSON.stringify(old.card));
});
