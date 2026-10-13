import test from 'node:test';
import assert from 'node:assert/strict';
import { codeTokens, matchTokens, resolveCodeSteps, codeMorphState } from '../engine/code.js';
import { Stage } from '../engine/stage.js';

const tokens = (code) => codeTokens(code.split('\n'), 'js');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

function matched(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  const pairs = matchTokens(a, b);
  for (const [i, j] of pairs) {
    assert.equal(a[i].text, b[j].text);
    assert.equal(a[i].type, b[j].type);
  }
  return pairs.map(([i]) => a[i].text);
}

test('code tokens keep their positions and ignore whitespace', () => {
  assert.deepEqual(tokens('  const total = items.length;').slice(0, 3), [
    { text: 'const', type: 'keyword', row: 0, column: 2 },
    { text: 'total', type: 'plain', row: 0, column: 8 },
    { text: '=', type: 'punct', row: 0, column: 14 },
  ]);
  assert.equal(tokens('const x = "a b"; // a note').at(-1).text, '// a note');
  assert.ok(tokens('const x = "a b";').some((t) => t.text === '"a b"'));
});

test('matching keeps existing tokens across insertions and deletions', () => {
  const short = 'const total = items.length;';
  const long = 'const total = items\n  .filter((i) => i.active)\n  .length;';
  const expected = tokens(short).map((t) => t.text);
  assert.deepEqual(matched(short, long), expected);
  assert.deepEqual(matched(long, short), expected);
});

test('a rename removes and adds only the identifier', () => {
  assert.deepEqual(matched('const total = items.length;', 'const activeCount = items.length;'),
    ['const', '=', 'items', '.', 'length', ';']);
});

test('moved lines keep an ordered subsequence and move matching tokens to new rows', () => {
  const a = tokens('first(alpha, beta, gamma);\nsecond(delta);');
  const b = tokens('second(delta);\nfirst(alpha, beta, gamma);');
  const pairs = matchTokens(a, b);
  assert.ok(pairs.some(([i, j]) => a[i].row !== b[j].row && a[i].type === 'fn'));
  assert.equal(pairs.length, 9);
  pairs.slice(1).forEach(([i, j], n) => {
    assert.ok(i > pairs[n][0]);
    assert.ok(j > pairs[n][1]);
  });
});

test('identical steps match every token, including repeated tokens', () => {
  const a = tokens('const x = x + x;\nreturn x;');
  assert.deepEqual(matchTokens(a, a), a.map((_, i) => [i, i]));
  assert.deepEqual(matched('const x=1;', '  const   x = 1;'), tokens('const x=1;').map((t) => t.text));
  assert.deepEqual(matchTokens([], a), []);
  assert.deepEqual(matchTokens(a, []), []);
  assert.deepEqual(matchTokens([{ text: ' ', type: 'plain' }, { text: 'x', type: 'plain' }],
    [{ text: 'x', type: 'plain' }, { text: '\n', type: 'plain' }]), [[1, 0]]);
  assert.deepEqual(matchTokens([{ text: 'x', type: 'plain' }], [{ text: 'x', type: 'fn' }]), []);
});

test('matching handles forty lines of code', () => {
  const code = Array.from({ length: 40 }, (_, i) => `const item${i} = items.filter((x) => x.id === ${i});`).join('\n');
  assert.equal(matched(code, '// Added a comment\n' + code).length, tokens(code).length);
});

test('step times resolve seconds, words and markers with the stage time API', () => {
  const engine = { theme: {}, config: {}, safeArea: { x: 0, y: 0, w: 1920, h: 1080 },
    W: 1920, H: 1080, timeline: { pace: 1, scenes: [] } };
  const scene = { id: 'demo', start: 0, words: [{ text: 'filter', start: 2, end: 2.5 }], marks: { rename: 4 } };
  const s = new Stage(engine, null, scene, 0);
  const steps = [{ code: 'x', at: 0.5 }, { code: 'y', at: 'filter', highlight: [2] }, { code: 'z', at: '#rename' }];
  const resolved = resolveCodeSteps(steps, { highlight: [1] }, (v) => s.time(v));
  assert.deepEqual(resolved.map((step) => step.at), [0.5, 2, 4]);
  assert.deepEqual(resolved.map((step) => step.highlight), [[1], [2], [2]]);
  assert.equal(resolveCodeSteps([{ code: '\tx' }], { at: '#rename' }, (v) => s.time(v))[0].at, 4);
  assert.deepEqual(resolveCodeSteps([{ code: '\tx', highlight: [] }], {}, (v) => s.time(v))[0],
    { at: 0, lines: ['  x'], highlight: [] });
  assert.throws(() => resolveCodeSteps([{ code: 'x', at: 'missing' }], {}, (v) => s.time(v)), /not in the narration/);
  assert.throws(() => resolveCodeSteps([], {}, (v) => s.time(v)), /at least one step/);
  assert.throws(() => resolveCodeSteps([{ at: 0 }], {}, (v) => s.time(v)), /needs a code string/);
  assert.throws(() => resolveCodeSteps([{ code: 'x' }, { code: 'y' }], {}, (v) => s.time(v)), /step 2 needs an at time/);
});

test('morph height eases between line counts and follows pace and duration', () => {
  const steps = resolveCodeSteps([{ code: 'a', at: 0.5 }, { code: 'a\nb\nc', at: 2 }, { code: 'd', at: 4 }], {}, (v) => v);
  assert.equal(codeMorphState(steps, 1).lines, 1);
  assert.equal(codeMorphState(steps, 2).lines, 1);
  close(codeMorphState(steps, 2.2).lines, 1.125);
  close(codeMorphState(steps, 2.4).lines, 2);
  close(codeMorphState(steps, 2.6).lines, 2.875);
  assert.equal(codeMorphState(steps, 3).lines, 3);
  close(codeMorphState(steps, 4.4).lines, 2);
  assert.equal(codeMorphState(steps, 5).lines, 1);
  close(codeMorphState(steps, 2.2, 0.8, 2).lines, 2);
  assert.equal(codeMorphState(steps, 2.4, 0.8, 2).lines, 3);
  close(codeMorphState(steps, 2.2, 0.4).lines, 2);
  assert.equal(codeMorphState(steps, 2, 0).lines, 3);
  const middle = codeMorphState(steps, 2.4);
  close(middle.removed, 0);
  close(middle.added, 0);
  close(codeMorphState(steps, 2.2).removed, 0.5);
  close(codeMorphState(steps, 2.6).added, 0.5);
  assert.deepEqual([middle.from, middle.to], [0, 1]);
  assert.deepEqual(codeMorphState(steps, 2.2), codeMorphState(steps, 2.2));
});
