// A final render says up front how long it takes, from the last measured speed of
// the same kind of render on this computer. The speed is kept in the cache folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateText, renderEstimate, renderKind } from '../src/render.js';
import { findChrome } from '../src/browser.js';
import { runCli, tinyProject } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}

test('the estimate scales the last speed by the pixels of a frame, and reads like "about 1 min 40 s"', () => {
  const measured = { frames_per_second: 14, pixels: 1920 * 1080 };
  const same = renderEstimate(measured, { frames: 1400, pixels: 1080 * 1920 });
  assert.deepEqual(same, { seconds: 100, frames_per_second: 14, frames: 1400 });
  assert.equal(estimateText(same), 'about 1 min 40 s: 1,400 frames at about 14 a second here');
  // A square frame has fewer pixels, so it goes faster.
  const square = renderEstimate(measured, { frames: 1400, pixels: 1080 * 1080 });
  assert.ok(square.seconds < 60 && square.frames_per_second > 24);
  assert.equal(estimateText({ seconds: 42, frames: 300, frames_per_second: 7.14 }), 'about 40 s: 300 frames at about 7.1 a second here');
  assert.equal(estimateText({ seconds: 1, frames: 90, frames_per_second: 90 }), 'about 5 s: 90 frames at about 90 a second here');
  assert.equal(estimateText({ seconds: 119, frames: 1190, frames_per_second: 10 }), 'about 2 min: 1,190 frames at about 10 a second here');
  // No measurement, or a broken one, gives no estimate.
  for (const bad of [undefined, null, {}, { frames_per_second: 0, pixels: 10 }, { frames_per_second: 'fast', pixels: 10 }]) assert.equal(renderEstimate(bad, { frames: 10, pixels: 10 }), null);
  assert.equal(renderKind({ samples: 6, transparent: false, workers: 4 }), '6 samples, 4 workers');
  assert.equal(renderKind({ samples: 1, transparent: true, workers: 1 }), '1 sample, alpha, 1 worker');
});

test('the first final render prints no estimate and keeps its speed, and the next one prints the estimate', { skip: !chrome && 'no browser here', timeout: 300000 }, async (t) => {
  const dir = tinyProject(t, {}, { narrated: false });
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny video\n\n## intro {min=4 chapter="Intro"}\n');
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-speed-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  const env = { EXPLAINROO_CACHE: cache };
  const file = path.join(cache, 'render-speed.json');
  const render = async (...flags) => {
    const r = await runCli(['render', dir, '--workers', '1', ...flags], env);
    assert.equal(r.code, 0, r.text);
    return r;
  };
  // A draft neither estimates nor counts.
  const draft = await render('--draft');
  assert.doesNotMatch(draft.stderr, /this takes about/);
  assert.equal(fs.existsSync(file), false);
  const first = await render();
  assert.doesNotMatch(first.stderr, /this takes about/);
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(kept), ['1 sample, 1 worker']);
  const speed = kept['1 sample, 1 worker'];
  assert.equal(speed.frames, 96);
  assert.equal(speed.pixels, 320 * 180);
  assert.ok(speed.frames_per_second > 0);
  const second = await render();
  assert.match(second.stderr, /^this takes about \d+ s: 96 frames at about [\d.]+ a second here$/m);
  // It comes before the frames, and the JSON has it too.
  assert.ok(second.stderr.indexOf('this takes about') < second.stderr.indexOf('frames done'));
  const json = JSON.parse((await render('--json')).stdout);
  assert.equal(typeof json.estimated_seconds, 'number');
  // Another number of pages is another kind of render, with no speed yet.
  const two = await render('--workers', '2');
  assert.doesNotMatch(two.stderr, /this takes about/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['1 sample, 1 worker', '1 sample, 2 workers']);
});

test('a render of fewer than 90 frames keeps no speed', { skip: !chrome && 'no browser here', timeout: 120000 }, async (t) => {
  const dir = tinyProject(t, {}, { narrated: false });
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-speed-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  const r = await runCli(['render', dir, '--workers', '1'], { EXPLAINROO_CACHE: cache });
  assert.equal(r.code, 0, r.text);
  assert.equal(fs.existsSync(path.join(cache, 'render-speed.json')), false);
});

// After the frames, render joins the sound and writes the cover, and before them
// it starts its pages. A step that takes 2 seconds says what it is, and the last
// line says where the time went.
test('a slow step of a render says what it is once, and the render says where its time went', { skip: !chrome && 'no browser here', timeout: 300000 }, async (t) => {
  const { step } = await import('../src/render.js');
  const lines = [];
  assert.equal(await step('joining the frames and the sound', (m) => lines.push(m), () => new Promise((resolve) => setTimeout(() => resolve(7), 2300))), 7);
  assert.deepEqual(lines, ['joining the frames and the sound…']);
  await step('quick', (m) => lines.push(m), () => 1);
  assert.equal(lines.length, 1);
  const dir = tinyProject(t, {}, { narrated: false });
  const said = await runCli(['render', dir, '--workers', '1']);
  assert.equal(said.code, 0, said.text);
  assert.match(said.stderr, /^wrote \S*video\.mp4 in \d+\.\ds: \d+\.\ds before the first frame, \d+\.\ds of frames and \d+\.\ds after them$/m);
  const r = await runCli(['render', dir, '--workers', '1', '--json']);
  assert.equal(r.code, 0, r.text);
  const { timing, seconds } = JSON.parse(r.stdout);
  assert.ok(Math.abs(timing.before_frames + timing.frames + timing.after_frames - seconds) < 0.3, JSON.stringify(timing));
});
