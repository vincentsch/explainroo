import test from 'node:test';
import assert from 'node:assert/strict';
import { clipFrame, ClipFrames } from '../engine/clips.js';
import { renderSoundtrack } from '../engine/audio/soundtrack.js';

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
