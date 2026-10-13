import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { typesetMath, mathHash, MAX_TEX_LENGTH } from '../src/math.js';

test('math returns standalone paths, a viewBox and baseline metrics', async () => {
  for (const tex of [String.raw`\frac{1}{2}`, String.raw`\int_0^1 x^2\,dx = \tfrac{1}{3}`, String.raw`\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}`]) {
    const result = await typesetMath(tex);
    assert.equal(result.unitsPerEm, 1000);
    assert.equal(result.viewBox.length, 4);
    assert.ok(result.viewBox.every(Number.isFinite));
    assert.ok(result.viewBox[2] > 0 && result.viewBox[3] > 0);
    assert.ok(result.ascent > 0 && result.descent >= 0);
    assert.equal(result.ascent + result.descent, result.viewBox[3]);
    assert.ok(result.paths.length >= 3);
    for (const d of result.paths) {
      assert.match(d, /^M/);
      assert.doesNotMatch(d, /(?:NaN|Infinity|href|<)/);
    }
  }
  const fraction = await typesetMath(String.raw`\frac{1}{2}`);
  assert.ok(fraction.paths.some(d => /^M120 -220L820 -220L820 -280L120 -280Z$/.test(d)), 'fraction bar includes the flipped SVG coordinates');
  const inline = await typesetMath(String.raw`\frac{1}{2}`, false);
  assert.ok(inline.viewBox[3] < fraction.viewBox[3]);
});

test('math caches by TeX and display style and reuses the disk result', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-math-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tex = String.raw`\sum_{i=1}^n i`;
  const hash = mathHash(tex);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, mathHash(tex, false));
  assert.notEqual(hash, mathHash('x'));
  const file = path.join(dir, `${hash}.json`);
  const result = await typesetMath(tex, true, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), result);
  fs.utimesSync(file, 1, 1);
  assert.deepEqual(await typesetMath(tex, true, file), result);
  assert.equal(fs.statSync(file).mtimeMs, 1000);
});

test('math errors keep the TeX message and do not leak macros between formulas', async () => {
  await assert.rejects(typesetMath(String.raw`\frac{1}`), /Missing argument for \\frac/);
  await assert.rejects(typesetMath(String.raw`\unknown`), /Undefined control sequence \\unknown/);
  await typesetMath(String.raw`\newcommand{\localmacro}{x}\localmacro`);
  await assert.rejects(typesetMath(String.raw`\localmacro`), /Undefined control sequence/);
  await assert.rejects(typesetMath(String.raw`\require{html}`), /Undefined control sequence/);
  await assert.rejects(typesetMath('x'.repeat(MAX_TEX_LENGTH + 1)), /at most 4096 characters/);
  await assert.rejects(typesetMath(null), /TeX string/);
  await assert.rejects(typesetMath('x', 'false'), /display must be true or false/);
});
