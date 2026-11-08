// A project without "defaults" in video.json renders the frames and the cover it
// did before the defaults of 0.5 existed. test/fixtures/old-frames.json holds the
// frames that version rendered of an example and of a project with every part
// whose look the line changes. They depend on the browser that drew them, so the
// test runs where that browser is.
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

const PINNED = JSON.parse(fs.readFileSync(new URL('./fixtures/old-frames.json', import.meta.url), 'utf8'));
let chrome = null;
try { chrome = findChrome(); } catch {}
const version = chrome ? spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim() : null;
const skip = !chrome ? 'no browser here' : version !== PINNED.chrome || process.platform !== PINNED.platform ? `the pinned frames were drawn by ${PINNED.chrome} on ${PINNED.platform}` : false;
const mod = { loadProject, prepare, withEngine, render, qa };
const differ = (a, b) => Object.keys(a.frames).filter((f) => a.frames[f] !== b.frames[f]);

for (const [name, make] of [['how-dns-works', (t, settings) => exampleCopy(t, 'how-dns-works', settings)], ['parts', partsProject]]) {
  test(`${name} without "defaults" renders the frames and the cover it did before, and with "defaults": "0.5" it looks new`, { skip, timeout: 240000 }, async (t) => {
    const before = PINNED[name];
    const now = await frameHashes(mod, make(t));
    assert.deepEqual(differ(before, now), [], 'the same frames');
    assert.deepEqual(now.cover, before.cover, 'the same cover');
    const fresh = await frameHashes(mod, make(t, { defaults: '0.5' }));
    assert.ok(differ(before, fresh).length > 0, 'the new defaults change the frames');
  });
}
