// sheet --times: a sheet of chosen moments, in the order given, labelled like
// stills, in a file of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpegPath } from '../src/ffmpeg.js';
import { runCli as cli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// The color in the middle of each tile of a sheet, as red, blue or something else.
function tileColors(file, count, { tw, th }) {
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e8 });
  const [width] = dimensions(file);
  const colors = [];
  for (let i = 0; i < count; i++) {
    const x = 8 + i * (tw + 8) + tw / 2;
    const y = 8 + th / 2;
    const k = (y * width + x) * 3;
    const [r, g, b] = [stdout[k], stdout[k + 1], stdout[k + 2]];
    colors.push(r > 200 && g < 60 && b < 60 ? 'red' : b > 200 && r < 60 && g < 60 ? 'blue' : `${r},${g},${b}`);
  }
  return colors;
}

function dimensions(file) {
  const { stderr } = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  return /, (\d+)x(\d+)/.exec(stderr).slice(1).map(Number);
}

test('sheet --times shows exactly the chosen moments, in order, with the labels of still', { skip, timeout: 240000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sheet-times-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '640x360', theme: 'clean', captions: false, music: false, sfx: false, lead: 0, hold: 0, end: 0, transition: 'cut', watermark: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Colors\n\n## intro {min=2}\n\n## outro {min=2}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.bg('#ff0000'); }, outro(s) { s.bg('#0000ff'); } };");

  const r = await cli(['sheet', dir, '--times', '3, intro@0.5,outro@end,1', '--json']);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  const sheet = JSON.parse(r.stdout);
  assert.equal(sheet.file, path.join(dir, 'out', 'sheet-times.jpg'));
  assert.equal(sheet.frames, 4);
  assert.deepEqual(sheet.times, [{ time: 3, label: 't3.00' }, { time: 0.5, label: 'intro@0.5' }, { time: 3.7, label: 'outro@end' }, { time: 1, label: 't1.00' }]);
  // Four tiles in one row of a 320x180 page at half scale, each of its own moment.
  assert.deepEqual(dimensions(sheet.file), [4 * (320 + 8) + 8, 180 + 30 + 8 + 8]);
  assert.deepEqual(tileColors(sheet.file, 4, { tw: 320, th: 180 }), ['blue', 'red', 'blue', 'red']);

  // The sheet of the whole video keeps its own file.
  const whole = await cli(['sheet', dir, '--json']);
  assert.equal(whole.code, 0, whole.text);
  assert.equal(JSON.parse(whole.stdout).file, path.join(dir, 'out', 'sheet.jpg'));
  assert.ok(fs.existsSync(sheet.file));
  // Sizes add their suffix as usual.
  const tall = await cli(['sheet', dir, '--times', 'outro@1', '--size', 'tiktok', '--json']);
  assert.equal(tall.code, 0, tall.text);
  assert.equal(JSON.parse(tall.stdout).file, path.join(dir, 'out', 'sheet-times-tiktok.jpg'));

  // --times picks the moments itself.
  for (const [args, message] of [
    [['--times', '3', '--scene', 'intro'], /^error: --times picks the moments itself, so it can't go with --scene\. Leave out one of them\.$/m],
    [['--times', '3', '--every', '2'], /^error: --times picks the moments itself, so it can't go with --every\. Leave out one of them\.$/m],
    [['--times', ' , '], /^error: --times needs at least one time, like --times 3,12\.5,intro@2$/m],
    [['--times'], /^error: --times needs a value$/m],
    [['--times', '3,middle@2'], /^error: no scene "middle"\. Scenes: intro, outro$/m],
  ]) {
    const bad = await cli(['sheet', dir, ...args]);
    assert.equal(bad.code, 1, `${args.join(' ')}: ${bad.text}`);
    assert.match(bad.stderr, message);
  }
});

test('sheet --large makes frames 640 pixels wide, 3 to a row, also for a tall video', { skip, timeout: 240000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sheet-large-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = { size: '1920x1080', theme: 'clean', captions: false, music: false, sfx: false, lead: 0, hold: 0, end: 0, transition: 'cut', watermark: false };
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Colors\n\n## intro {min=2}\n\n## outro {min=2}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.bg('#ff0000'); }, outro(s) { s.bg('#0000ff'); } };");
  const r = await cli(['sheet', dir, '--times', 'intro@0.5,outro@0.5,intro@1,outro@1', '--large', '--json']);
  assert.equal(r.code, 0, r.text);
  // Two rows of three, 640x360 each.
  assert.deepEqual(dimensions(JSON.parse(r.stdout).file), [3 * (640 + 8) + 8, 2 * (360 + 30 + 8) + 8]);
  assert.deepEqual(tileColors(JSON.parse(r.stdout).file, 3, { tw: 640, th: 360 }), ['red', 'blue', 'red']);
  // --cols still wins, and a tall video gets frames 640 wide too.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...settings, size: '1080x1920' }));
  const tall = await cli(['sheet', dir, '--times', 'intro@0.5,outro@0.5', '--large', '--cols', '2', '--json']);
  assert.equal(tall.code, 0, tall.text);
  assert.deepEqual(dimensions(JSON.parse(tall.stdout).file), [2 * (640 + 8) + 8, 1138 + 30 + 8 + 8]);
});
