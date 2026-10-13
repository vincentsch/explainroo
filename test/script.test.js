import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, speechChunks, resolveMarks, tokenizeNarration, ScriptError } from '../src/script.js';

test('parses title, scenes, attributes and narration', () => {
  const r = parseScript('# My video\n\n## intro {hold=1.5 transition=cut}\nHello there.\n\n## next\nBye.');
  assert.equal(r.title, 'My video');
  assert.deepEqual(r.scenes.map((s) => s.id), ['intro', 'next']);
  assert.deepEqual(r.scenes[0].attrs, { hold: 1.5, transition: 'cut' });
  assert.equal(r.scenes[0].text, 'Hello there.');
});

test('quoted attributes keep spaces and commas with either kind of quote', () => {
  const r = parseScript('## a {hold="1.5", chapter="How the resolver finds it" transition=cut}\nHi.\n## b {chapter=\'More, with spaces\' min:3}\nBye.');
  assert.deepEqual(r.scenes[0].attrs, { hold: 1.5, chapter: 'How the resolver finds it', transition: 'cut' });
  assert.deepEqual(r.scenes[1].attrs, { chapter: 'More, with spaces', min: 3 });
  assert.deepEqual(parseScript('## old {hold=1.5,min:3 lead=0 transition=fade}\nHi.').scenes[0].attrs, { hold: 1.5, min: 3, lead: 0, transition: 'fade' });
  assert.equal(parseScript("## old {note=don't}\nHi.").scenes[0].attrs.note, "don't");
});

test('chapter titles must have 1 to 60 characters', () => {
  for (const title of ['', '   ', 'x'.repeat(61)]) assert.throws(() => parseScript(`## a {chapter="${title}"}\nHi.`), /chapter title must be 1 to 60 characters/);
  assert.equal(parseScript(`## a {chapter="${'x'.repeat(60)}"}\nHi.`).scenes[0].attrs.chapter.length, 60);
});

test('markers, pauses and pronunciation overrides', () => {
  const units = tokenizeNarration('The {DNS|D N S} lookup, [pause 0.4] takes [#fast] {20ms|twenty milliseconds}.');
  const words = units.filter((u) => u.type === 'word');
  assert.deepEqual(words.map((w) => w.display), ['The', 'DNS', 'lookup,', 'takes', '20ms.']);
  assert.deepEqual(words.map((w) => w.spoken), ['The', 'D N S', 'lookup,', 'takes', 'twenty milliseconds.']);
  assert.ok(units.some((u) => u.type === 'pause' && u.sec === 0.4));
  assert.ok(units.some((u) => u.type === 'mark' && u.name === 'fast'));
});

test('comments and director notes are ignored', () => {
  const r = parseScript('## a\n> note for me\nSpoken <!-- not spoken --> words.\n<!--\nblock\n-->\nMore.');
  assert.equal(r.scenes[0].text, 'Spoken words. More.');
});

test('scenes without narration are allowed', () => {
  const r = parseScript('## title {min=3}\n\n## body\nText.');
  assert.equal(r.scenes[0].units.length, 0);
  assert.equal(r.scenes[0].attrs.min, 3);
});

test('errors carry line numbers', () => {
  assert.throws(() => parseScript('Hello\n## a\nx'), (e) => e instanceof ScriptError && /line 1/.test(e.message));
  assert.throws(() => parseScript('## a\nx\n## a\ny'), /used twice/);
  assert.throws(() => parseScript('## a\nBad {override} here'), /\{shown\|spoken\}/);
  assert.throws(() => parseScript('## a b\nx'), /scene headings/);
});

test('speech chunks split on sentences and pauses', () => {
  const { scenes } = parseScript('## a\nOne two. Three four! [pause 1] Five,\n\nSix.');
  const chunks = speechChunks(scenes[0].units, { sentenceGap: 0.3, paragraphGap: 0.55 });
  assert.deepEqual(chunks.map((c) => c.text), ['One two.', 'Three four!', 'Five,', 'Six.']);
  assert.deepEqual(chunks.map((c) => Math.round(c.gapBefore * 100) / 100), [0, 0.3, 1.3, 0.55]);
});

test('marks resolve to the next word, or the last word end', () => {
  const units = tokenizeNarration('[#start] Hello [#mid] world. [#end]');
  const times = [];
  units.forEach((u, i) => {
    if (u.type === 'word') times[i] = u.display === 'Hello' ? { start: 0.1, end: 0.5 } : { start: 0.6, end: 1.1 };
  });
  assert.deepEqual(resolveMarks(units, times), { start: 0.1, mid: 0.6, end: 1.1 });
});
