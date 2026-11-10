import test from 'node:test';
import assert from 'node:assert/strict';
import { clipFrame, ClipFrames } from '../engine/clips.js';
import { renderSoundtrack } from '../engine/audio/soundtrack.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceSize, withSourceSize } from '../src/clips.js';
import { ffmpeg } from '../src/ffmpeg.js';

const info = { fps: 30, frames: 90, duration: 3 };

test('clip frames follow at, from and speed, and hold the last frame', () => {
  assert.equal(clipFrame(info, 1, { at: 2 }), null);
  assert.equal(clipFrame(info, 2, { at: 2 }), 0);
  assert.equal(clipFrame(info, 2.5, { at: 2, from: 1, speed: 2 }), 60);
  assert.equal(clipFrame(info, 3, { at: 2, speed: 0.25 }), 7);
  assert.equal(clipFrame(info, 10), 89);
  assert.equal(clipFrame(info, 0, { from: 10 }), 89);
  assert.equal(clipFrame(info, 1 / 30), 1);
});

test('looping wraps through the whole clip, including from', () => {
  assert.equal(clipFrame(info, 3, { loop: true }), 0);
  assert.equal(clipFrame(info, 1, { from: 2.5, loop: true }), 15);
  assert.equal(clipFrame(info, 4, { at: 1, from: 1, speed: 2, loop: true }), 30);
});

test('clip audio starts at its offset, loops, stops at out, and is silent at other speeds', async () => {
  const sr = 1000;
  const data = Float32Array.from({ length: sr }, (_, i) => i < 500 ? 0.1 : 0.2);
  const clip = { data, sampleRate: sr, start: 0.5, end: 2.5, duration: 1, from: 0.5, loop: true, volume: 0.6, speed: 1 };
  const mix = await renderSoundtrack({ duration: 3, sampleRate: sr, clips: [clip] });
  const L = mix.getChannelData(0);
  assert.equal(L[400], 0);
  assert.ok(Math.abs(L[600] - 0.12) < 1e-6);
  assert.ok(Math.abs(L[1100] - 0.06) < 1e-6);
  assert.ok(Math.abs(L[1600] - 0.12) < 1e-6);
  assert.equal(L[2600], 0);
  const silent = await renderSoundtrack({ duration: 3, sampleRate: sr, clips: [{ ...clip, speed: 2 }] });
  assert.ok(silent.getChannelData(0).every((v) => v === 0));
});

test('decoded frame cache keeps requested frames and closes old bitmaps', () => {
  const cache = new ClipFrames();
  const closed = [];
  for (let i = 0; i < 50; i++) cache.frames.set(String(i), { bitmap: { close: () => closed.push(i) } });
  cache.trim(new Set(['0', '1']));
  assert.equal(cache.frames.size, 24);
  assert.ok(cache.frames.has('0') && cache.frames.has('1'));
  assert.equal(closed.length, 26);
  cache.close();
  assert.equal(cache.frames.size, 0);
  assert.equal(closed.length, 50);
});

test('clip audio stops at the clip end and handles an entrance before the scene', async () => {
  const sr = 1000;
  const data = new Float32Array(sr).fill(0.1);
  const clip = { data, sampleRate: sr, start: -0.25, end: 2, duration: 1, from: 0.25, loop: false, volume: 0.6, speed: 1 };
  const mix = await renderSoundtrack({ duration: 3, sampleRate: sr, clips: [clip] });
  assert.ok(Math.abs(mix.getChannelData(0)[100] - 0.06) < 1e-6);
  assert.equal(mix.getChannelData(0)[600], 0);
});

test('music ducks under clip sound with the same envelope as narration', async () => {
  const opts = { duration: 3, sampleRate: 8000, music: { style: 'calm', seed: 42 } };
  const voice = await renderSoundtrack({ ...opts, voiceSpans: [{ start: 1, end: 2 }] });
  const clip = await renderSoundtrack({ ...opts, clips: [{ data: new Float32Array(8000), sampleRate: 8000, start: 1, end: 2, duration: 1, from: 0, volume: 0.6, speed: 1 }] });
  assert.deepEqual(clip.getChannelData(0), voice.getChannelData(0));
  assert.deepEqual(clip.getChannelData(1), voice.getChannelData(1));
});

test('with to, a clip plays up to that second of the file, holds the frame before it, and loops back to from', () => {
  assert.equal(clipFrame(info, 0.5, { from: 1, to: 2 }), 45);
  assert.equal(clipFrame(info, 5, { from: 1, to: 2 }), 59);
  assert.equal(clipFrame(info, 1.5, { from: 1, to: 2, loop: true }), 45);
  assert.equal(clipFrame(info, 2.25, { at: 1, from: 1, to: 2, speed: 2, loop: true }), 45);
  // A to at the end of the file is the file's last frame.
  assert.equal(clipFrame(info, 9, { to: 3 }), 89);
});

test('clip sound with to stops there, and a loop repeats only the part', async () => {
  const sr = 1000;
  const data = Float32Array.from({ length: 3 * sr }, (_, i) => (i < sr ? 0.1 : i < 2 * sr ? 0.2 : 0.3));
  const clip = { data, sampleRate: sr, start: 0, end: 3, duration: 3, from: 1, to: 2, loop: false, volume: 1, speed: 1 };
  const once = (await renderSoundtrack({ duration: 3, sampleRate: sr, clips: [clip] })).getChannelData(0);
  assert.ok(Math.abs(once[500] - 0.2) < 1e-6);
  assert.equal(once[1500], 0);
  const looped = (await renderSoundtrack({ duration: 3, sampleRate: sr, clips: [{ ...clip, loop: true }] })).getChannelData(0);
  for (const i of [500, 1500, 2500]) assert.ok(Math.abs(looped[i] - 0.2) < 1e-6, String(i));
});

test('a clip knows the size of its file, which a crop is given in, also when its frames are smaller', () => {
  assert.deepEqual(sourceSize({ width: 1280, height: 720 }, 1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(sourceSize({ width: 3840, height: 2160 }, 1920, 1080), { width: 3840, height: 2160 });
  // A video turned on its side plays tall.
  assert.deepEqual(sourceSize({ width: 3840, height: 2160 }, 1920, 3413), { width: 2160, height: 3840 });
});

test('a clip from an older cache gets the size of its file, read once from the file when its frames are 1920 wide', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wide.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=3840x2160:r=30:d=0.1', '-c:v', 'libx264', '-threads', '1', file]);
  assert.deepEqual((await withSourceSize(file, { width: 1920, height: 1080 })).source, { width: 3840, height: 2160 });
  // Frames under 1920 wide are the file's own size, so the file isn't read.
  assert.deepEqual((await withSourceSize(path.join(dir, 'missing.mp4'), { width: 1280, height: 720 })).source, { width: 1280, height: 720 });
  const kept = { width: 1920, height: 1080, source: { width: 2560, height: 1440 } };
  assert.equal(await withSourceSize(file, kept), kept);
});
