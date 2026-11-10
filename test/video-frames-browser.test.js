// still and sheet of a video file that isn't a project, like a cut of your own
// recording: times in seconds, and the files next to the video.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpeg, ffmpegPath } from '../src/ffmpeg.js';
import { videoTimes } from '../src/video-frames.js';
import { runCli as cli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

function dimensions(file) {
  const { stderr } = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  return /, (\d+)x(\d+)/.exec(stderr).slice(1).map(Number);
}

// The color of one pixel of an image, as red, blue or its numbers.
function colorAt(file, x, y) {
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e8 });
  const [width] = dimensions(file);
  const k = (y * width + x) * 3;
  const [r, g, b] = [stdout[k], stdout[k + 1], stdout[k + 2]];
  return r > 200 && g < 60 && b < 60 ? 'red' : b > 200 && r < 60 && g < 60 ? 'blue' : `${r},${g},${b}`;
}

test('times of a video file are seconds, kept inside the video', () => {
  assert.deepEqual(videoTimes(['1', '2.5', 9], 4, 25, 'talk.mp4'), [{ T: 1, label: 't1.00' }, { T: 2.5, label: 't2.50' }, { T: 3.94, label: 't3.94' }]);
  assert.throws(() => videoTimes(['intro@2'], 4, 25, 'talk.mp4'), /"intro@2" isn't a time in seconds\. talk\.mp4 is a video file without scenes, so give times in seconds, like 3 or 12\.5\./);
});

test('still and sheet take a video file that is not a project', { skip, timeout: 240000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-video-frames-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Red for 2 seconds, then blue for 2, with sound, like a recording.
  const video = path.join(dir, 'talk.cut.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=2',
    '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);

  const stills = await cli(['still', video, '1', '3', '10', '--json']);
  assert.equal(stills.code, 0, stills.text);
  assert.doesNotMatch(stills.stderr, /test guard: blocked/);
  const list = JSON.parse(stills.stdout).stills;
  assert.deepEqual(list.map((s) => [s.label, path.relative(dir, s.file)]), [['t1.00', 'talk.cut.stills/t1.00.png'], ['t3.00', 'talk.cut.stills/t3.00.png'], ['t3.94', 'talk.cut.stills/t3.94.png']]);
  assert.deepEqual(dimensions(list[0].file), [320, 180]);
  assert.deepEqual(list.map((s) => colorAt(s.file, 160, 90)), ['red', 'blue', 'blue']);
  // Without times: the start, the middle and the end.
  const plain = await cli(['still', video, '--json']);
  assert.equal(plain.code, 0, plain.text);
  assert.equal(JSON.parse(plain.stdout).stills.length, 3);

  const sheet = await cli(['sheet', video, '--every', '1', '--json']);
  assert.equal(sheet.code, 0, sheet.text);
  const r = JSON.parse(sheet.stdout);
  assert.equal(r.file, path.join(dir, 'talk.cut.sheet.jpg'));
  assert.equal(r.frames, 4);
  // Four frames 320 wide in a row, with the time under each.
  assert.deepEqual(dimensions(r.file), [4 * (320 + 8) + 8, 180 + 30 + 8 + 8]);
  assert.deepEqual([0, 1, 2, 3].map((i) => colorAt(r.file, 8 + i * 328 + 160, 98)), ['red', 'red', 'blue', 'blue']);
  const times = await cli(['sheet', video, '--times', '3,0.5', '--json']);
  assert.equal(times.code, 0, times.text);
  assert.equal(JSON.parse(times.stdout).file, path.join(dir, 'talk.cut.sheet-times.jpg'));
  assert.deepEqual([0, 1].map((i) => colorAt(JSON.parse(times.stdout).file, 8 + i * 328 + 160, 98)), ['blue', 'red']);

  // What needs a project stops and says what a video file takes.
  const scene = await cli(['still', video, 'intro@2']);
  assert.equal(scene.code, 1);
  assert.match(scene.stderr, /"intro@2" isn't a time in seconds/);
  const size = await cli(['sheet', video, '--size', 'tiktok']);
  assert.equal(size.code, 1);
  assert.match(size.stderr, /--size works with a project\. For a video file, sheet takes --every, --times, --cols and --large\./);
  const scaled = await cli(['still', video, '1', '--scale', '0.5']);
  assert.match(scaled.stderr, /--scale works with a project\. For a video file, still takes times in seconds\./);
  const named = await cli(['sheet', video, 'intro']);
  assert.match(named.stderr, /a video file has no scenes, so sheet takes only the video/);
  const gone = await cli(['sheet', path.join(dir, 'missing.mp4')]);
  assert.match(gone.stderr, /missing\.mp4 does not exist/);
});
