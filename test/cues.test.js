// Word cues: "word#n" is the n-th time a word is spoken, like s.cue(word, n), and
// a written number means that time on purpose, so check gives no hint about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stage } from '../engine/stage.js';

const WORDS = ['The', 'tank', 'fills', 'up.', 'Then', 'it', 'fills', 'up', 'again', 'in', 'C#.'];

function stage(words = WORDS, { marks = { pump: 2.5 }, language = 'en' } = {}) {
  const engine = {
    theme: {}, pen: null, W: 1920, H: 1080, fps: 30, cueNotes: [],
    config: { language }, safeArea: { x: 0, y: 0, w: 1920, h: 1080 },
    timeline: { pace: 1, duration: 6, frames: 180, fps: 30, width: 1920, height: 1080, scenes: [{}] },
  };
  const scene = { id: 'tank', index: 0, start: 0, dur: 6, marks, lead: 0, voice: null,
    words: words.map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 })) };
  return { s: new Stage(engine, null, scene, 0), notes: engine.cueNotes };
}

test('a word spoken twice means its first time, and check hears about it', () => {
  const { s, notes } = stage();
  assert.equal(s.time('fills'), 1);
  assert.equal(s.cue('fills'), 1);
  assert.deepEqual(notes.map((n) => [n.word, n.count]), [['fills', 2], ['fills', 2]]);
});

test('"word#1" means the first time on purpose, so it gives no hint', () => {
  const { s, notes } = stage();
  assert.equal(s.time('fills#1'), 1);
  assert.equal(s.cue('fills#1'), 1);
  assert.equal(s.cueEnd('fills#1'), 1.4);
  // A number written as the argument is meant too.
  assert.equal(s.cue('fills', 1), 1);
  assert.deepEqual(notes, []);
});

test('"word#2" is the same time as s.cue(word, 2), wherever a time goes', () => {
  const { s, notes } = stage();
  assert.equal(s.cue('fills', 2), 3);
  assert.equal(s.cue('fills#2'), s.cue('fills', 2));
  assert.equal(s.time('fills#2'), s.cue('fills', 2));
  assert.equal(s.cueEnd('fills#2'), s.cueEnd('fills', 2));
  assert.equal(s.cue('fills#2', 2), 3);
  // A phrase, and the case and punctuation of the narration, work the same way.
  assert.equal(s.cue('Fills up#2'), 3);
  assert.equal(s.cueEnd('fills up#2'), 3.9);
  // at and out are read with s.time.
  assert.equal(s.p('fills#2', 1), 0);
  assert.deepEqual(notes, []);
});

test('only digits after the last # count, so "C#" stays a word and "#pump" a marker', () => {
  const { s } = stage();
  assert.equal(s.cue('C#'), 5);
  assert.equal(s.time('C#'), 5);
  assert.equal(s.cue('C##1'), 5);
  assert.equal(s.time('#pump'), 2.5);
  assert.throws(() => s.time('#tank'), /mark\("tank"\) is not in scene "tank"\. Marks: pump/);
  // Something that is no number after the # stays part of the word.
  assert.throws(() => s.cue('fills#two'), /cue\("fills#two"\) is not in the narration/);
});

test('a number larger than the times a word is spoken fails with the count', () => {
  const { s } = stage();
  assert.throws(() => s.cue('fills#3'), /^Error: cue\("fills#3"\) is not in the narration of scene "tank" \(it is spoken 2 times\)\. Close words: fills/);
  assert.throws(() => s.time('fills#3'), /\(it is spoken 2 times\)/);
  assert.throws(() => s.cue('fills', 3), /^Error: cue\("fills", 3\) is not in the narration of scene "tank" \(it is spoken 2 times\)/);
  assert.throws(() => s.cue('tank#2'), /cue\("tank#2"\) is not in the narration of scene "tank" \(it is spoken 1 time\)/);
});

test('#0 and two different numbers for one cue are errors that show the right way', () => {
  const { s } = stage();
  assert.throws(() => s.cue('fills#0'), /cue\("fills#0"\): the number after # counts from 1, so "fills#1" is the first time it is spoken/);
  assert.throws(() => s.cue('fills#2', 1), /cue\("fills#2", 1\) names two different times; write "fills#1" or cue\("fills", 1\)/);
});

test('Japanese and Chinese cues take "#n" too', () => {
  const { s, notes } = stage(['水が', '入る。', 'また', '水が', '入る。'], { language: 'ja' });
  assert.equal(s.cue('水が入る#2'), 1.5);
  assert.equal(s.cue('水が入る'), 0);
  assert.deepEqual(notes.map((n) => n.word), ['水が入る']);
});
