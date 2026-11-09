// verify finds the file that render wrote with the same --platform, --size and
// --no-watermark, and render says once why a platform's rule left out the watermark.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { runCli as cli, tinyProject as tiny } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

test('verify --platform checks the file render --platform wrote, and a missing file names the ones there', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, {}, { narrated: false });
  const rendered = await cli(['render', dir, '--platform', 'tiktok', '--workers', '1']);
  assert.equal(rendered.code, 0, rendered.text);
  assert.equal(rendered.stderr.split('\n').filter((l) => l === 'no watermark: TikTok asks apps not to add one').length, 1, rendered.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'video-tiktok-no-watermark.mp4')));

  const checked = await cli(['verify', dir, '--platform', 'tiktok', '--json']);
  assert.equal(checked.code, 0, checked.text);
  assert.equal(path.basename(JSON.parse(checked.stdout).file), 'video-tiktok-no-watermark.mp4');

  const missing = await cli(['verify', dir]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /out\/video\.mp4 does not exist, but out\/ has video-tiktok-no-watermark\.mp4\. verify looks for the file that render writes with the same --platform, --size and --no-watermark, so give it those flags, or name a file with --file\./);

  // A platform that keeps the watermark, and a project without one, say nothing about it.
  const linkedin = await cli(['render', dir, '--platform', 'linkedin', '--workers', '1', '--draft']);
  assert.equal(linkedin.code, 0, linkedin.text);
  assert.doesNotMatch(linkedin.stderr, /no watermark/);
  const plain = tiny(t, { watermark: false }, { narrated: false });
  const off = await cli(['render', plain, '--platform', 'tiktok', '--workers', '1', '--draft']);
  assert.equal(off.code, 0, off.text);
  assert.doesNotMatch(off.stderr, /no watermark/);
});
