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

test('four-digit numbers are read like years, the way the voice reads them', async () => {
  const { yearWords, expand } = await import('../src/align.js');
  assert.deepEqual(yearWords(1582), ['fifteen', 'eighty', 'two']);
  assert.deepEqual(yearWords(1900), ['nineteen', 'hundred']);
  assert.deepEqual(yearWords(1905), ['nineteen', 'oh', 'five']);
  assert.deepEqual(yearWords(2015), ['twenty', 'fifteen']);
  assert.equal(yearWords(2000), null);
  assert.equal(yearWords(2005), null);
  assert.equal(yearWords(1066), null);
  // A comma makes it an ordinary number again: one thousand five hundred eighty two.
  assert.equal(expand('1,582').length, 6);
  const year = alignWords([{ spoken: 'In' }, { spoken: 'fifteen eighty two', display: '1582' }, { spoken: 'it' }, { spoken: 'changed.' }], heard([['In', 0, 0.2], ['1582', 0.2, 0.9], ['it', 0.9, 1], ['changed.', 1, 1.4]]), 1.5);
  assert.equal(year.matchRate, 1);
  const plain = alignWords([{ spoken: '1900' }, { spoken: 'was' }, { spoken: 'not.' }], heard([['1900', 0, 0.6], ['was', 0.6, 0.8], ['not.', 0.8, 1]]), 1.1);
  assert.equal(plain.matchRate, 1);
  const hundred = alignWords([{ spoken: 'nineteen hundred,', display: '1900,' }], heard([['1900,', 0, 0.6]]), 0.7);
  assert.equal(hundred.matchRate, 1);
  const cardinal = alignWords([{ spoken: 'two thousand', display: '2000' }], heard([['2000', 0, 0.6]]), 0.7);
  assert.equal(cardinal.matchRate, 1);
});

test('ordinals match the words the voice says', () => {
  const r = alignWords([{ spoken: 'February' }, { spoken: 'twenty ninth', display: '29' }], heard([['February', 0, 0.5], ['29th', 0.5, 1]]), 1.1);
  assert.equal(r.matchRate, 1);
  const first = alignWords([{ spoken: 'the' }, { spoken: '1st' }], heard([['the', 0, 0.2], ['first', 0.2, 0.5]]), 0.6);
  assert.equal(first.matchRate, 1);
});
