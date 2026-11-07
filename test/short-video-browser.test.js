// s.short in real frames: the hook is there on the first frame, check sees the
// kit's text, a flash covers the frame, and the exported player has the kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpegPath } from '../src/ffmpeg.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SCENES = `export default {
  hook(s) {
    s.short.backdrop({ color: '#1b2440', glow: '#f59f00', pattern: 'dots' });
    s.short.hook('Your bread is *stale* again?', { kicker: 'Kitchen tip', kickerIcon: 'lightbulb', id: 'hook' });
    s.short.sticker('*2* days', { x: s.cx, y: s.safe.y + s.safe.h * 0.7, at: 1 });
  },
  tip(s) {
    s.camera(s.short.punch('#bag', { y: s.safe.y + s.safe.h * 0.5, zoom: 1.2, hold: 0.5 }));
    s.short.interrupt('#bag');
    s.short.backdrop({ color: '#10304a', pattern: 'grid' });
    s.short.step(1, 2, { at: 0, word: 'Tip' });
    s.short.progress();
    s.short.payoff({ title: 'Use a paper bag', lines: ['Not plastic', { text: 'Freeze the rest', at: '#rest' }], at: '#rest' });
  },
};`;

function project(t, scenes = SCENES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-short-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'tiktok', captions: 'bold', theme: 'clean', music: false, end: 0 }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Bread\n\n## hook {min=2}\n\n## tip\nKeep it in a [#bag] paper bag. [#rest] Freeze the rest.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), scenes);
  cachedVoice(dir, 'tip');
  return dir;
}

async function json(args) {
  const r = await cli([...args, '--json']);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  assert.equal(r.code, 0, r.text);
  return JSON.parse(r.stdout);
}

// The average brightness of a 1080x1920 still, and how much of its top third is not the backdrop.
function measure(file) {
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1080 * 1920 + 1e6 });
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < stdout.length; i++) {
    sum += stdout[i];
    if (i < 1080 * 640 && stdout[i] > 200) bright++;
  }
  return { mean: sum / stdout.length, brightTop: bright };
}

test('the hook is there on the first frame, a flash covers the frame, and check passes', { skip, timeout: 300000 }, async (t) => {
  const dir = project(t);
  const checked = await json(['check', dir]);
  assert.deepEqual(checked.issues.filter((i) => i.level !== 'hint'), [], JSON.stringify(checked.issues));
  // The narration gives #bag at 0.35 + 4 x 0.3 = 1.55 seconds into the scene.
  const [first, before, flash] = (await json(['still', dir, '0', 'tip@1.45', 'tip@1.6'])).stills.map((s) => measure(s.file));
  assert.ok(first.brightTop > 20000, `the hook's white slabs are there at 0 seconds: ${first.brightTop}`);
  assert.ok(flash.mean > before.mean + 40, `the flash brightens the frame: ${flash.mean} vs ${before.mean}`);

  // A hook that comes in later leaves the first frame to the backdrop.
  fs.writeFileSync(path.join(dir, 'scenes.js'), SCENES.replace("id: 'hook' }", "id: 'hook', at: 1 }"));
  const [late] = (await json(['still', dir, '0'])).stills.map((s) => measure(s.file));
  assert.ok(late.brightTop < first.brightTop / 10, `${late.brightTop}`);
});

test('check sees the kit\'s text like any other text', { skip, timeout: 120000 }, async (t) => {
  const dir = project(t, `export default {
    hook(s) { s.short.sticker('Fresh bread', { y: s.safe.bottom + 70 }); },
    tip(s) { s.short.payoff({ title: 'Paper bag', x: s.W - 40, at: 0 }); },
  };`);
  const r = await cli(['check', dir, '--json']);
  const issues = JSON.parse(r.stdout).issues;
  // A sticker draws word by word, so check names each word.
  assert.ok(issues.some((i) => i.scene === 'hook' && /"Fresh" is in the caption band/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.scene === 'tip' && /"Paper bag" runs off the frame/.test(i.message)), JSON.stringify(issues));
});

test('check measures text against the backdrop or s.bg, not the page of the look', { skip, timeout: 120000 }, async (t) => {
  const dir = project(t, `export default {
    hook(s) {
      s.short.backdrop({ color: '#1b2440' });
      s.icon('shopping-bag', { y: s.safe.y + s.safe.h * 0.4, label: 'Paper bag', at: 0 });
      s.text('Fresh for weeks', { y: s.safe.y + s.safe.h * 0.7, color: '#ffffff', at: 0 });
    },
    tip(s) {
      s.bg('#10304a');
      s.text('Keep it dry', { y: s.safe.y + s.safe.h * 0.3, color: 'ink', at: 0 });
      s.text('Freeze the rest', { y: s.safe.y + s.safe.h * 0.6, color: '#ffffff', at: 0 });
    },
  };`);
  const r = await cli(['check', dir, '--json']);
  const contrast = JSON.parse(r.stdout).issues.filter((i) => /low contrast/.test(i.message));
  // The look is clean, whose page is light. The dark label and the dark text sit on a dark background.
  assert.deepEqual(contrast.map((i) => [i.scene, i.message.match(/^"([^"]+)"/)[1]]), [['hook', 'Paper bag'], ['tip', 'Keep it dry']], JSON.stringify(contrast));
});

test('the exported player brings the kit along', { skip, timeout: 120000 }, async (t) => {
  const dir = project(t);
  const out = (await json(['export', dir])).out;
  assert.ok(fs.existsSync(path.join(out, 'engine/short.js')));
  assert.ok(fs.readFileSync(path.join(out, 'engine/runtime.js'), 'utf8').includes("from './short.js'"));
});
