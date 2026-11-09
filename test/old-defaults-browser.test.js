// A project without "defaults" in video.json renders the frames and the cover it
// did before the defaults of 0.5 existed, and one with "defaults": "0.5" the ones
// explainroo 0.5.0 rendered. test/fixtures/old-frames.json holds the frames that
// version rendered of an example, without the line it has now, and of a project
// with every part whose look the line changes. test/fixtures/frames-0.5.json
// holds the frames 0.5.0 rendered of the same two with "defaults": "0.5". They
// depend on the browser that drew them, so the test runs where that browser is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { prepare, withEngine } from '../src/pipeline.js';
import * as render from '../src/render.js';
import * as qa from '../src/qa.js';
import { exampleCopy, frameHashes, partsProject } from './helpers/old-frames.js';

const pinned = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PINNED = pinned('old-frames.json');
const PINNED_05 = pinned('frames-0.5.json');
let chrome = null;
try { chrome = findChrome(); } catch {}
const version = chrome ? spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim() : null;
const skipFor = (pins) => !chrome ? 'no browser here' : version !== pins.chrome || process.platform !== pins.platform ? `the pinned frames were drawn by ${pins.chrome} on ${pins.platform}` : false;
const mod = { loadProject, prepare, withEngine, render, qa };
const differ = (a, b) => Object.keys(a.frames).filter((f) => a.frames[f] !== b.frames[f]);
const PROJECTS = [['how-dns-works', (t, settings) => exampleCopy(t, 'how-dns-works', settings)], ['parts', partsProject]];

for (const [name, make] of PROJECTS) {
  test(`${name} without "defaults" renders the frames and the cover it did before, and with "defaults": "0.5" it looks new`, { skip: skipFor(PINNED), timeout: 240000 }, async (t) => {
    const before = PINNED[name];
    const now = await frameHashes(mod, make(t, { defaults: undefined }));
    assert.deepEqual(differ(before, now), [], 'the same frames');
    assert.deepEqual(now.cover, before.cover, 'the same cover');
    const fresh = await frameHashes(mod, make(t, { defaults: '0.5' }));
    assert.ok(differ(before, fresh).length > 0, 'the new defaults change the frames');
  });

  test(`${name} with "defaults": "0.5" renders the frames and the cover of explainroo 0.5.0`, { skip: skipFor(PINNED_05), timeout: 240000 }, async (t) => {
    const before = PINNED_05[name];
    const now = await frameHashes(mod, make(t, { defaults: '0.5' }));
    assert.deepEqual(differ(before, now), [], 'the same frames');
    assert.deepEqual(now.cover, before.cover, 'the same cover');
  });
}
