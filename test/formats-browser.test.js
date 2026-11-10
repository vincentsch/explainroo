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
import { BUILT_IN } from '../src/formats.js';
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
