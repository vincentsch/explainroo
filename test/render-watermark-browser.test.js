// render prints one line about the watermark every time: on, off by a setting
// or --no-watermark, or off by the platform's rule. render --platform reels
// keeps it, like the Reels package.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { watermarkLine } from '../src/cli.js';
import { runCli as cli, tinyProject as tiny } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

test('the watermark line says on, off by a setting or a flag, or off by the platform', () => {
  const project = (watermark) => ({ config: { watermark } });
  assert.equal(watermarkLine(project('explainroo.com'), {}, null, null), 'watermark: on, "explainroo.com". "watermark": false in video.json turns it off');
  assert.equal(watermarkLine(project('explainroo.com'), {}, 'reels', null), 'watermark: on, "explainroo.com", as the Instagram Reels package has it. "watermark": false in video.json turns it off');
  assert.equal(watermarkLine(project(false), { 'no-watermark': true }, null, null), 'watermark: off, because of --no-watermark');
  assert.equal(watermarkLine(project(false), {}, null, null), 'watermark: off, because "watermark" is false in video.json');
  assert.equal(watermarkLine(project(false), {}, 'tiktok', 'watermark: off, because TikTok asks apps that post to it not to add one'), 'watermark: off, because TikTok asks apps that post to it not to add one');
});

test('render --platform reels keeps the watermark like the Reels package, and says so in one line', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, {}, { narrated: false });
  const r = await cli(['render', dir, '--platform', 'reels', '--draft', '--workers', '1', '--json']);
  assert.equal(r.code, 0, r.text);
  const lines = r.stderr.split('\n').filter((l) => l.startsWith('watermark: '));
  assert.deepEqual(lines, ['watermark: on, "explainroo.com", as the Instagram Reels package has it. "watermark": false in video.json turns it off']);
  assert.equal(JSON.parse(r.stdout).watermark, lines[0]);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'draft-reels-no-watermark.mp4')));
});
