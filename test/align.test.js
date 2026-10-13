import test from 'node:test';
import assert from 'node:assert/strict';
import { alignWords } from '../src/align.js';

const heard = (list) => list.map(([text, start, end]) => ({ text, start, end }));

test('aligns exact words', () => {
  const r = alignWords([{ spoken: 'Hello' }, { spoken: 'world.' }], heard([['Hello', 0, 0.4], ['world.', 0.5, 0.9]]), 1);
  assert.equal(r.matchRate, 1);
  assert.deepEqual(r.words.map((w) => [w.start, w.end]), [[0, 0.4], [0.5, 0.9]]);
});

test('number words match digits', () => {
  const r = alignWords([{ spoken: 'about' }, { spoken: 'twenty' }, { spoken: 'milliseconds.' }], heard([['about', 0, 0.3], ['20', 0.3, 0.6], ['milliseconds.', 0.6, 1.2]]), 1.3);
  assert.equal(r.matchRate, 1);
});

test('a spelled-out group matches one heard word', () => {
  const r = alignWords([{ spoken: 'The' }, { spoken: 'D N S' }, { spoken: 'lookup' }], heard([['The', 0, 0.2], ['DNS', 0.2, 0.7], ['lookup', 0.8, 1.2]]), 1.3);
  assert.equal(r.words[1].matched, true);
  assert.deepEqual([r.words[1].start, r.words[1].end], [0.2, 0.7]);
});

test('missing words are interpolated between neighbours', () => {
  const r = alignWords([{ spoken: 'one' }, { spoken: 'xyzzy' }, { spoken: 'three' }], heard([['one', 0, 0.4], ['three', 1.0, 1.4]]), 1.5);
  assert.equal(r.words[1].matched, false);
  assert.ok(r.words[1].start >= 0.4 && r.words[1].end <= 1.0);
});

test('times stay monotonic', () => {
  const r = alignWords([{ spoken: 'a' }, { spoken: 'b' }, { spoken: 'c' }], heard([['c', 0.1, 0.2]]), 1);
  for (let i = 1; i < r.words.length; i++) assert.ok(r.words[i].start >= r.words[i - 1].start);
});

test('dotted names match their spoken form', () => {
  const r = alignWords([{ spoken: 'runs' }, { spoken: 'dot' }, { spoken: 'com.' }], heard([['runs.com.', 0, 1]]), 1);
  assert.equal(r.matchRate, 1);
  const ip = alignWords([{ spoken: 'one dot one dot one dot one' }], heard([['1.1.1.1', 0, 1.4]]), 1.5);
  assert.equal(ip.matchRate, 1);
});

test('split number tokens with leading dots still match', () => {
  const r = alignWords([{ spoken: 'one dot one dot one dot one' }], heard([['1', 0, 0.3], ['.1', 0.3, 0.6], ['.1', 0.6, 0.9], ['.1', 0.9, 1.2]]), 1.3);
  assert.equal(r.matchRate, 1);
});

test('spoken amounts match digits, dollars and percent', () => {
  const r = alignWords(
    [{ spoken: 'one thousand and fifty dollars.' }, { spoken: 'at' }, { spoken: 'five percent' }, { spoken: 'one thousand one hundred and two dollars fifty' }],
    heard([['$1,050.', 0, 1], ['at', 1, 1.2], ['5%', 1.2, 1.6], ['$1,102.50', 1.6, 3]]),
    3,
  );
  assert.equal(r.matchRate, 1);
  assert.ok(r.words.every((w) => w.matched));
});

test('digits in the script match digits Whisper wrote', () => {
  const r = alignWords([{ spoken: 'After' }, { spoken: '10' }, { spoken: 'years' }], heard([['After', 0, 0.3], ['10', 0.3, 0.6], ['years', 0.6, 1]]), 1);
  assert.equal(r.matchRate, 1);
});

test('number pieces from Whisper are joined', () => {
  const r = alignWords([{ spoken: 'one thousand dollars' }, { spoken: 'five percent' }], heard([['$1', 0, 0.4], [',000', 0.4, 0.8], ['5', 0.8, 1], ['%', 1, 1.2]]), 1.2);
  assert.equal(r.matchRate, 1);
});

test('a word counts as heard when Whisper writes its shown form', () => {
  const one = alignWords([{ spoken: 'The' }, { spoken: 'sequel', display: 'SQL' }, { spoken: 'query.' }], heard([['The', 0, 0.2], ['SQL', 0.2, 0.7], ['query.', 0.7, 1.1]]), 1.2);
  assert.equal(one.matchRate, 1);
  assert.ok(one.words[1].matched);
  const two = alignWords([{ spoken: 'The' }, { spoken: 'a sink', display: 'async' }, { spoken: 'keyword.' }], heard([['The', 0, 0.2], ['async', 0.2, 0.7], ['keyword.', 0.7, 1.1]]), 1.2);
  assert.equal(two.matchRate, 1);
  assert.equal(two.words[1].start, 0.2);
  // The spoken form still matches as before.
  const spoken = alignWords([{ spoken: 'a sink', display: 'async' }], heard([['a', 0, 0.2], ['sink', 0.2, 0.5]]), 0.6);
  assert.equal(spoken.matchRate, 1);
  // A different word is still not confirmed.
  const wrong = alignWords([{ spoken: 'sequel', display: 'SQL' }], heard([['table', 0, 0.5]]), 0.6);
  assert.ok(!wrong.words[0].matched);
});
