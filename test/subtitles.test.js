import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitleCues, toSrt, toVtt } from '../src/subtitles.js';
import { parseScript } from '../src/script.js';
import { buildTimeline } from '../src/timeline.js';
import { normalizeConfig } from '../src/project.js';

function scene(text, { start = 0, step = 0.3, dur = 100 } = {}) {
  return { start, dur, words: text.split(' ').map((text, i) => ({ text, start: i * step, end: i * step + 0.2 })) };
}

test('cues keep every word inside two 42-character lines and six seconds', () => {
  for (const step of [0.15, 0.7]) {
    const sc = scene('This longer explanation contains several ordinary words and keeps going until both lines fill up with enough text to need another cue before the sentence ends.', { step });
    const cues = subtitleCues({ scenes: [sc] });
    assert.ok(cues.length > 1);
    assert.equal(cues.map((c) => c.text.replaceAll('\n', ' ')).join(' '), sc.words.map((w) => w.text).join(' '));
    for (const c of cues) {
      assert.ok(c.end - c.start <= 6);
      assert.ok(c.text.split('\n').length <= 2);
      assert.ok(c.text.split('\n').every((line) => line.length <= 42));
    }
  }
});

test('sentence endings start new cues and padding stops at the next cue', () => {
  const cues = subtitleCues({ scenes: [scene('Hello there. Another sentence! Last one?')] });
  assert.deepEqual(cues.map((c) => c.text), ['Hello there.', 'Another sentence!', 'Last one?']);
  assert.equal(cues[0].end, cues[1].start);
  assert.equal(cues[2].end, 1.95);
});

test('line and cue breaks prefer commas and other punctuation', () => {
  const line = subtitleCues({ scenes: [scene('Here is a useful clause, followed by more words for the second line')] });
  assert.equal(line[0].text, 'Here is a useful clause,\nfollowed by more words for the second line');
  const cues = subtitleCues({ scenes: [scene('Here is a useful clause, followed by several words that keep going until the subtitle has no room left for more words')] });
  assert.equal(cues[0].text, 'Here is a useful clause,');
  const orphan = subtitleCues({ scenes: [scene("Computers don't find each other by name, though.")] });
  assert.equal(orphan[0].text, "Computers don't find each\nother by name, though.");
});

test('pauses over 0.6 seconds and scene boundaries start new cues', () => {
  const sc = { start: 2, dur: 4, words: [
    { text: 'One', start: 0, end: 0.2 },
    { text: 'two', start: 0.8, end: 1 },
    { text: 'three', start: 1.61, end: 1.9 },
  ] };
  const cues = subtitleCues({ scenes: [sc, scene('Next', { start: 6, dur: 0.3 })] });
  assert.deepEqual(cues.map((c) => c.text), ['One two', 'three', 'Next']);
  assert.equal(cues[0].start, 2);
  assert.equal(cues[0].end, 3.25);
  assert.equal(cues.at(-1).end, 6.3);
});

test('partial ranges keep overlapping cues, clip times and start at clip zero', () => {
  const timeline = { scenes: [scene('First. Second. Third.', { step: 1 })] };
  assert.deepEqual(subtitleCues(timeline, { from: 0.2, to: 1.2 }), [
    { start: 0, end: 0.25, text: 'First.' },
    { start: 0.8, end: 1, text: 'Second.' },
  ]);
  assert.deepEqual(subtitleCues(timeline, { from: 3 }), []);
  assert.deepEqual(subtitleCues({ scenes: [{ start: 0, words: [] }] }), []);
});

test('subtitles use the shown form from pronunciation overrides', () => {
  const script = parseScript('## intro\nThe {DNS|D N S} answer.');
  const words = script.scenes[0].units.map((u, i) => ({ text: u.display, start: i * 0.3, end: i * 0.3 + 0.2 }));
  const timeline = buildTimeline({ script, config: normalizeConfig({}) }, { intro: { duration: 1, words } });
  assert.equal(subtitleCues(timeline)[0].text, 'The DNS answer.');
});

test('an indivisible word over 42 characters gives a useful error', () => {
  assert.throws(() => subtitleCues({ scenes: [scene('x'.repeat(43))] }), /Shorten its shown text/);
});

test('SRT and VTT have millisecond timestamps, UTF-8 text and LF endings', () => {
  const cues = [{ start: 1.234, end: 3.5, text: 'Café\nline two' }, { start: 3661.9996, end: 3663, text: 'End.' }];
  assert.equal(toSrt(cues), '1\n00:00:01,234 --> 00:00:03,500\nCafé\nline two\n\n2\n01:01:02,000 --> 01:01:03,000\nEnd.\n\n');
  assert.equal(toVtt(cues), 'WEBVTT\n\n00:00:01.234 --> 00:00:03.500\nCafé\nline two\n\n01:01:02.000 --> 01:01:03.000\nEnd.\n\n');
  assert.equal(toSrt([]), '');
  assert.equal(toVtt([]), 'WEBVTT\n\n');
  assert.match(toVtt([{ start: 0, end: 1, text: '<tag> & text' }]), /&lt;tag&gt; &amp; text/);
});
