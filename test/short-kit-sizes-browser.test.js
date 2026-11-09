// The short kit and the UI kit's badges in a tall frame with "defaults": "0.6":
// the hook's kicker stays inside s.safe at 40 pixels or more, pills are big
// enough to read on a phone, check measures a badge's words like any text, and
// brand.accent colors the hook's keywords and the vertical-short format.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpegPath } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

function project(t, scenes, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-kit-sizes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'reels', captions: 'bold', theme: 'midnight', music: false, end: 0, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Kit\n\n## hook {min=2}\n\n## tip {min=2}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), scenes);
  return dir;
}

async function issues(dir) {
  const r = await cli(['check', dir, '--json']);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  return JSON.parse(r.stdout).issues;
}

// The pixels of a 1080x1920 still as RGB.
function pixels(file) {
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1080 * 1920 * 3 + 1e6 });
  return stdout;
}

// How many pixels are within a few steps of a color.
function count(buf, hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let k = 0;
  for (let i = 0; i < buf.length; i += 3) if (Math.abs(buf[i] - r) < 8 && Math.abs(buf[i + 1] - g) < 8 && Math.abs(buf[i + 2] - b) < 8) k++;
  return k;
}

async function still(dir, at) {
  const r = await cli(['still', dir, at, '--json']);
  assert.equal(r.code, 0, r.text);
  return pixels(JSON.parse(r.stdout).stills[0].file);
}

// A hook placed high up, as a scene does to leave room for its subject.
const HOOK = `export default {
  hook(s) {
    s.short.backdrop({ color: '#101013' });
    s.short.hook('Which *model* answered?', { y: s.safe.top + 120, kicker: 'Tabslip', at: 0 });
  },
  tip(s) { s.short.backdrop({ color: '#101013' }); },
};`;
const PLAIN_HOOK = HOOK.replace(", kicker: 'Tabslip'", '');

test('with "defaults": "0.6" the hook\'s kicker stays inside s.safe at 44px, and before it left s.safe at 34px', { skip, timeout: 120000 }, async (t) => {
  const kicker = (list) => list.filter((i) => /"TABSLIP"/.test(i.message)).map((i) => i.message);
  const now = kicker(await issues(project(t, HOOK, { defaults: '0.6' })));
  assert.deepEqual(now, []);
  const before = kicker(await issues(project(t, HOOK)));
  assert.ok(before.some((m) => /outside the reels content area/.test(m)), before.join('\n'));
  assert.ok(before.some((m) => /shows 34px tall/.test(m)), before.join('\n'));
  // kickerSize and kickerY place it by hand, and check says when that is too small.
  const small = kicker(await issues(project(t, HOOK.replace("kicker: 'Tabslip'", "kicker: 'Tabslip', kickerSize: 30, kickerY: s.safe.top + 300"), { defaults: '0.6' })));
  assert.ok(small.some((m) => /shows 30px tall/.test(m)), small.join('\n'));
});

const PILLS = (o) => `export default {
  hook(s) {
    const u = s.ui;
    s.camera([]);
    u.backdrop();
    u.pill('Signed', s.cx, s.cy - 200, 'green', { align: 'center', dot: true${o} });
    u.chip('Monthly', s.cx - 150, s.cy, { ${o.slice(1)} });
    u.toast('Saved', { y: s.cy + 150${o} });
  },
  tip(s) { s.ui.backdrop(); },
};`;

test('pills, chips and toasts read on a phone with "defaults": "0.6", and check measures their words like any text', { skip, timeout: 120000 }, async (t) => {
  const named = (list) => list.filter((i) => /"(Signed|Monthly|Saved)".*\d+px/.test(i.message)).map((i) => `${i.level} ${i.message}`);
  assert.deepEqual(named(await issues(project(t, PILLS(''), { defaults: '0.6' }))), []);
  // A size set by hand is measured, like a label.
  const set = named(await issues(project(t, PILLS(', size: 30'), { defaults: '0.6' })));
  assert.equal(set.length, 3, set.join('\n'));
  assert.ok(set.every((m) => /^hint .*shows 30px tall/.test(m)), set.join('\n'));
  // The kit's old sizes are too small in a tall frame, and check now says so.
  const old = named(await issues(project(t, PILLS(''))));
  assert.ok(old.some((m) => /^warn "Signed" is 17px, hard to read/.test(m)), old.join('\n'));
  assert.ok(old.some((m) => /^warn "Monthly" is 20px, hard to read/.test(m)), old.join('\n'));
});

test('the hook\'s keywords take brand.accent where it reads, and keep their red where it does not', { skip, timeout: 120000 }, async (t) => {
  const accent = '#da5c2b';
  const branded = await still(project(t, PLAIN_HOOK, { defaults: '0.6', brand: { accent } }), 'hook@0.5');
  assert.ok(count(branded, accent) > 5000, `${count(branded, accent)}`);
  assert.ok(count(branded, '#e5233d') < 500);
  // White keywords don't read on a light yellow, so the red stays.
  const light = await still(project(t, PLAIN_HOOK, { defaults: '0.6', brand: { accent: '#ffe066' } }), 'hook@0.5');
  assert.ok(count(light, '#e5233d') > 5000, `${count(light, '#e5233d')}`);
  // Without "defaults": "0.6", brand.accent leaves the hook as it was.
  const old = await still(project(t, PLAIN_HOOK, { brand: { accent } }), 'hook@0.5');
  assert.ok(count(old, accent) < 500);
});

test('the vertical-short format takes its background and glow from brand, and passes check with a kicker and a pill', { skip, timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-kit-format-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'video');
  assert.equal((await cli(['init', dir, '--format', 'vertical-short', '--size', 'reels'])).code, 0);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...settings, brand: { background: '#2a0a12', accent: '#da5c2b' } }));
  const file = path.join(dir, 'scenes.js');
  const scenes = fs.readFileSync(file, 'utf8');
  assert.match(scenes, /hookFrame\(s, '[^']+', \{ icon: 'battery-low', color: 'orange' \}\)/);
  fs.writeFileSync(file, scenes
    .replace("{ icon: 'battery-low', color: 'orange' }", "{ icon: 'battery-low', kicker: 'Phone tip' }")
    .replace("s.short.flash('#dies'", "s.ui.pill('Below 0°C', s.safe.left + 40, s.safe.top + s.safe.h * 0.5, 'accent');\n    s.short.flash('#dies'"));
  for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
  const bad = (await issues(dir)).filter((i) => i.level !== 'hint');
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  // The top of the frame is brand.background, under the backdrop's vignette.
  const top = (await still(dir, 'hook@0')).subarray((20 * 1080 + 540) * 3, (20 * 1080 + 540) * 3 + 3);
  assert.ok(top[0] > top[2] + 10, `a red background at the top, not the look's blue: ${[...top]}`);
});
