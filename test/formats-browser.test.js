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
