// check gives hints about YouTube's chapters only where they matter: for a
// YouTube size, or for a package made for YouTube.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { check } from '../src/qa.js';
import { tinyProject } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// The tiny project has one chapter of a second, which YouTube would not show.
const chapterHints = async (dir, size, platform) => {
  const r = await check(loadProject(dir, { size }), { platform });
  return r.issues.filter((i) => i.message.includes('YouTube shows chapters')).length;
};

test('chapter hints show for a YouTube size or a YouTube package, and not for an X video', { skip, timeout: 240000 }, async (t) => {
  const dir = tinyProject(t, {}, { narrated: false });
  assert.equal(await chapterHints(dir, 'youtube'), 2);
  assert.equal(await chapterHints(dir, '16:9'), 2);
  assert.equal(await chapterHints(dir, 'square'), 0);
  assert.equal(await chapterHints(dir, 'shorts'), 0);
  // A package decides by its platform.
  assert.equal(await chapterHints(dir, '16:9', 'x'), 0);
  assert.equal(await chapterHints(dir, 'square', 'youtube'), 2);
});
