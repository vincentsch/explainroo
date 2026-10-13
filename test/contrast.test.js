import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, parseColor, suggestColor } from '../engine/util.js';

test('suggestion darkens text on a light background while keeping hue and saturation', () => {
  const { color, ratio } = suggestColor('#ffaaaa', '#ffffff');
  const { r, g, b } = parseColor(color);
  assert.match(color, /^#[0-9a-f]{6}$/);
  assert.equal(g, b);
  assert.equal(g, 0);
  assert.ok(r < 255);
  assert.ok(ratio >= 4.5);
  assert.equal(ratio, contrast(color, '#ffffff'));
  assert.ok(contrast(`#${(r + 1).toString(16)}0000`, '#ffffff') < 4.5);
});

test('suggestion lightens text on a dark background while keeping hue and saturation', () => {
  const { color, ratio } = suggestColor('#550000', '#0b1020');
  const { r, g, b } = parseColor(color);
  assert.equal(g, b);
  assert.equal(g, 0);
  assert.ok(r > 85);
  assert.ok(ratio >= 4.5);
  assert.equal(ratio, contrast(color, '#0b1020'));
  assert.ok(contrast(`#${(r - 1).toString(16)}0000`, '#0b1020') < 4.5);
});

test('already passing text keeps its color', () => {
  for (const [fg, bg] of [['#123456', '#ffffff'], ['#abcdef', '#000000']]) {
    assert.deepEqual(suggestColor(fg, bg, 32, { ink: '#000000' }), { color: fg, ratio: contrast(fg, bg) });
  }
});

test('a passing named color close in hue wins over a hex adjustment', () => {
  const colors = { ink: '#222222', accent: '#990000', red: '#550000' };
  const result = suggestColor('#ffaaaa', '#ffffff', 32, colors);
  assert.equal(result.color, 'accent');
  assert.equal(result.ratio, contrast(colors.accent, '#ffffff'));
  assert.equal(suggestColor('#aaaaaa', '#ffffff', 32, colors).color, 'ink');
});

test('named colors must pass the target and match the hue', () => {
  const result = suggestColor('#ffaaaa', '#ffffff', 32, { red: '#ff8888', blue: '#000099', ink: '#000000' });
  assert.match(result.color, /^#/);
  assert.ok(result.ratio >= 4.5);
});

test('named hue matching wraps around red at zero degrees', () => {
  const result = suggestColor('#ffaaaa', '#ffffff', 32, { pink: '#990019' });
  assert.equal(result.color, 'pink');
});

test('48px text targets 3:1 while smaller text targets 4.5:1', () => {
  const small = suggestColor('#bbbbbb', '#ffffff', 47.99);
  const large = suggestColor('#bbbbbb', '#ffffff', 48);
  assert.equal(small.color, '#767676');
  assert.equal(large.color, '#949494');
  assert.ok(small.ratio >= 4.5);
  assert.ok(large.ratio >= 3 && large.ratio < 4.5);
  assert.equal(suggestColor('#888888', '#ffffff', 48).color, '#888888');
  assert.equal(suggestColor('#bbbbbb', '#ffffff', 48, { gray: '#888888' }).color, 'gray');
  assert.match(suggestColor('#bbbbbb', '#ffffff', 47, { gray: '#888888' }).color, /^#/);
});

test('the closest passing lightness can be on either side of a middle background', () => {
  assert.equal(suggestColor('#767676', '#767676').color, '#040404');
  assert.equal(suggestColor('#999999', '#767676').color, '#fefefe');
});

test('suggestions meet the target after hex rounding across hues and backgrounds', () => {
  for (const fg of ['#fcba03', '#32aa70', '#79d4ea', '#8870ba', '#dd7f9e', '#808080']) {
    for (const bg of ['#f7f3ea', '#0b1020', '#777777']) {
      for (const size of [32, 48]) {
        const result = suggestColor(fg, bg, size);
        assert.ok(result.ratio >= (size >= 48 ? 3 : 4.5), `${fg} on ${bg}: ${result.color}`);
        assert.equal(result.ratio, contrast(result.color, bg));
      }
    }
  }
});
