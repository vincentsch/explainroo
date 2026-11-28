import test from 'node:test';
import assert from 'node:assert/strict';
import { keyframeValue, mixValue } from '../engine/util.js';

test('keyframes hold before the first and after the last key, and ease into each key', () => {
  const keys = [{ at: 1, v: 0 }, { at: 2, v: 100, ease: 'linear' }, { at: 4, v: 0 }];
  assert.equal(keyframeValue(keys, 0), 0);
  assert.equal(keyframeValue(keys, 1.5), 50);
  assert.equal(keyframeValue(keys, 2), 100);
  // The default ease is inOut, so the middle of the last span is its middle value.
  assert.equal(keyframeValue(keys, 3), 50);
  assert.ok(keyframeValue(keys, 2.5) > 75, 'inOut starts slowly');
  assert.equal(keyframeValue(keys, 9), 0);
  // Two keys at the same time jump.
  assert.equal(keyframeValue([{ at: 1, v: 0 }, { at: 1, v: 5 }, { at: 2, v: 5 }], 1.5), 5);
});

test('keyframe values can be points, objects and colors, and mixing unlike values says why it fails', () => {
  assert.deepEqual(mixValue([0, 10], [10, 30], 0.5), [5, 20]);
  assert.deepEqual(mixValue({ x: 0, y: 0 }, { x: 4, y: 8 }, 0.25), { x: 1, y: 2 });
  assert.equal(mixValue('#000000', '#ffffff', 0.5), 'rgba(128,128,128,1)');
  assert.throws(() => mixValue([0, 1], [0, 1, 2], 0.5), /lists of different lengths \(2 and 3\)/);
  assert.throws(() => mixValue({ x: 0 }, { y: 0 }, 0.5), /have "x" in one value and not in the next/);
  assert.throws(() => mixValue(1, 'big', 0.5), /only numbers, lists of numbers, \{ x, y \} objects and colors can be mixed/);
});
