import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhrases, balancePhrases } from '../engine/captions.js';

const words = (text, step = 0.3) => text.split(' ').map((t, i) => ({ text: t, start: i * step, end: i * step + 0.2 }));
const texts = (phrases) => phrases.map((p) => p.words.map((w) => w.text).join(' '));

test('a sentence that just overflows splits into balanced phrases, not a lonely last word', () => {
  const phrases = buildPhrases({ scenes: [{ start: 0, words: words('La respuesta está en la luz del Sol y en el aire.') }] }, 46);
  assert.equal(phrases.length, 2);
  assert.ok(texts(phrases).every((t) => t.split(' ').length >= 3), texts(phrases).join(' | '));
});

test('phrases prefer a break after a comma and never exceed the limit', () => {
  const out = balancePhrases(words('When the user arrives, its callback starts fetching the orders.'), 46);
  assert.deepEqual(out.map((p) => p.map((w) => w.text).join(' ')), ['When the user arrives,', 'its callback starts fetching the orders.']);
  const long = balancePhrases(words('Every phrase here stays within twenty eight characters on a phone screen.'), 28);
  assert.ok(long.every((p) => p.map((w) => w.text).join(' ').length <= 28));
});

test('short sentences stay whole, sentences and long pauses start new phrases', () => {
  const sc = { start: 1, words: [...words('One short line.'), { text: 'Next', start: 2, end: 2.2 }, { text: 'idea.', start: 2.3, end: 2.5 }] };
  assert.deepEqual(texts(buildPhrases({ scenes: [sc] }, 46)), ['One short line.', 'Next idea.']);
  const paused = { start: 0, words: [{ text: 'before', start: 0, end: 0.3 }, { text: 'after', start: 1.2, end: 1.5 }] };
  assert.deepEqual(texts(buildPhrases({ scenes: [paused] }, 46)), ['before', 'after']);
});

test('a single word longer than the limit is its own phrase', () => {
  assert.equal(balancePhrases(words('a supercalifragilisticexpialidocious word'), 10).length, 3);
});

test('a comma does not leave a lonely word behind', () => {
  const out = balancePhrases(words('Yes, the browser asks a resolver for the address first.'), 46);
  assert.ok(out.every((p) => p.length >= 3), out.map((p) => p.map((w) => w.text).join(' ')).join(' | '));
});
