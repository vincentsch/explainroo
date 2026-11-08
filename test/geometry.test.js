import test from 'node:test';
import assert from 'node:assert/strict';
import { ring, bounds, overlapDepth, holds, crosses, along, rayThrough } from '../engine/geometry.js';

const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('two boxes overlap by the smaller side of what they share', () => {
  assert.equal(overlapDepth(box(0, 0, 100, 100), box(90, 50, 200, 150)), 10);
  assert.equal(overlapDepth(box(0, 0, 100, 100), box(100, 0, 200, 100)), 0);
  assert.equal(overlapDepth(box(0, 0, 100, 100), box(150, 0, 200, 100)), 0);
  // A cross: no corner inside the other, still 100 deep.
  assert.equal(overlapDepth(box(0, 100, 300, 200), box(100, 0, 200, 300)), 100);
});

test('circles overlap only where they really meet, not where their boxes do', () => {
  const a = ring(800, 500, 100, 100);
  assert.equal(overlapDepth(a, ring(950, 650, 100, 100)), 0);
  const depth = overlapDepth(a, ring(980, 500, 100, 100));
  assert.ok(depth > 15 && depth < 25, depth);
  // A badge on a card's corner reaches deep into it.
  assert.ok(overlapDepth(box(760, 440, 1160, 640), ring(1150, 450, 76, 76)) > 50);
});

test('a shape holds another inside it, give or take 4 pixels', () => {
  assert.ok(holds(box(0, 0, 100, 100), box(10, 10, 90, 90)));
  assert.ok(holds(box(0, 0, 100, 100), box(-3, 10, 90, 103)));
  assert.ok(!holds(box(0, 0, 100, 100), box(-6, 10, 90, 90)));
  assert.ok(holds(ring(0, 0, 100, 100), box(-50, -50, 50, 50)));
  assert.ok(!holds(ring(0, 0, 100, 100), box(-80, -80, 80, 80)));
  assert.deepEqual(bounds(box(3, 4, 5, 6)), { x0: 3, y0: 4, x1: 5, y1: 6 });
});

test('a line crosses a box when a point along it lies inside the box', () => {
  const line = along([[0, 50], [200, 50]]);
  assert.ok(crosses(line, { x0: 90, y0: 30, x1: 110, y1: 70 }));
  assert.ok(!crosses(line, { x0: 90, y0: 51, x1: 110, y1: 70 }), 'grazing the edge is not crossing');
  assert.ok(!crosses(line, { x0: 300, y0: 30, x1: 310, y1: 70 }));
});

test('a ray enters and leaves a box', () => {
  assert.deepEqual(rayThrough({ x: 0, y: 0 }, 0, 1, { x0: -10, y0: 50, x1: 10, y1: 80 }), [50, 80]);
  assert.equal(rayThrough({ x: 0, y: 0 }, 1, 0, { x0: -10, y0: 50, x1: 10, y1: 80 }), null);
});
