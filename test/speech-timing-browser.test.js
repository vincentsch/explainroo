// check warns when a video runs over "targetSeconds". Real pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { check } from '../src/qa.js';
import { render } from '../src/render.js';
import { recordVersion, sha256File } from '../src/history.js';
import { tinyProject } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

test('check warns by how much a video runs over targetSeconds, and is quiet when it fits', { skip }, async (t) => {
  const dir = tinyProject(t, { targetSeconds: 1 }, { narrated: false });
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny video\n\n## intro {min=2 chapter="Intro"}\n');
  const over = await check(loadProject(dir));
  const warning = over.issues.find((i) => i.message.includes('targetSeconds'));
  assert.equal(warning?.level, 'warn', JSON.stringify(over.issues));
  assert.equal(warning.message, 'the video runs 2.0 s, 1.0 s over targetSeconds 1. The longest scene is intro (2.0 s).');
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), targetSeconds: 3 }));
  const fits = await check(loadProject(dir));
  assert.equal(fits.duration, 3);
  assert.ok(!fits.issues.some((i) => i.message.includes('targetSeconds')), JSON.stringify(fits.issues));
});
