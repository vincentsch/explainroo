// The parts of the short-video kit that need no browser: keywords in its titles,
// its fonts and the camera keys it returns for s.camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Short, richWords } from '../engine/short.js';
import { fontStack } from '../engine/themes.js';

test('*keywords* in a kit title are marked word by word, also across words', () => {
  assert.deepEqual(richWords('Your bread is *stale* again?'), [
    { text: 'Your', key: false }, { text: 'bread', key: false }, { text: 'is', key: false }, { text: 'stale', key: true }, { text: 'again?', key: false },
  ]);
  assert.deepEqual(richWords('*Two whole* days.').map((w) => [w.text, w.key]), [['Two', true], ['whole', true], ['days.', false]]);
  assert.deepEqual(richWords('*Fresh*, again').map((w) => [w.text, w.key]), [['Fresh,', true], ['again', false]]);
  assert.deepEqual(richWords('2 * 3').map((w) => [w.text, w.key]), [['2', false], ['*', false], ['3', false]]);
});

test('the kit draws in Inter with the fonts explainroo brings for Hindi, Japanese and Chinese', () => {
  assert.equal(new Short({}).font(56, 900), `900 56px ${fontStack('Inter')}`);
  assert.equal(new Short({}).font(34), '400 34px "Inter", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", sans-serif');
});

test('punch and drift take fixed places and return keys for s.camera', () => {
  const s = { cx: 500, cy: 700, dur: 6, pace: 1, time: (v) => (typeof v === 'number' ? v : { '#bag': 1.5 }[v]) };
  const short = new Short(s);
  assert.deepEqual(short.punch('#bag', { x: 400, y: 600, zoom: 1.3, hold: 1 }), [
    { at: 1.5, x: 400, y: 600, zoom: 1.3, dur: 0.24, ease: 'outQuart' },
    { at: 2.5, x: 500, y: 700, zoom: 1, dur: 0.5, ease: 'inOut' },
  ]);
  assert.equal(short.punch(1, { hold: 1, back: false }).length, 1);
  assert.equal(short.punch(1).length, 1);
  assert.deepEqual(short.drift(), [{ at: 0, x: 500, y: 700, zoom: 1.06, dur: 6, ease: 'linear' }]);
  assert.deepEqual(short.drift({ from: 2, zoom: 1.1, x: 300 }), [{ at: 2, x: 300, y: 700, zoom: 1.1, dur: 4, ease: 'linear' }]);
});
