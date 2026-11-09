import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/script.js';
import { normalizeConfig } from '../src/project.js';
import { buildTimeline, estimateLength, estimateLine, targetNotes } from '../src/timeline.js';

function project(src, cfg = {}) {
  return { config: normalizeConfig(cfg), script: parseScript(src) };
}

test('scene length is lead + voice + hold, snapped to frames', () => {
  const p = project('## a\nHi.\n\n## b {min=4}\n', { fps: 30, lead: 0.3, hold: 0.5, end: 1 });
  const tl = buildTimeline(p, { a: { duration: 1.234, words: [{ text: 'Hi.', start: 0, end: 1.2 }], marks: {}, chunks: [{ start: 0, end: 1.234 }] } });
  assert.equal(tl.scenes[0].start, 0);
  assert.equal(tl.scenes[0].dur, Math.round((0.3 + 1.234 + 0.5) * 30) / 30);
  assert.equal(tl.scenes[1].start, tl.scenes[0].dur);
  assert.equal(tl.scenes[1].dur, 5);
  assert.equal(tl.scenes[0].words[0].start, 0.3);
  assert.equal(tl.frames, Math.round(tl.duration * 30));
  assert.equal(tl.voiceSpans.length, 1);
});

test('config validation gives useful errors', () => {
  assert.throws(() => normalizeConfig({ theme: 'neon' }), /theme must be one of/);
  assert.throws(() => normalizeConfig({ voice: 'nobody' }), /explainroo voices/);
  assert.throws(() => normalizeConfig({ colour: 'red' }), /unknown setting/);
  assert.equal(normalizeConfig({ size: '9:16' }).captions, true);
  assert.equal(normalizeConfig({}).captions, false);
  assert.equal(normalizeConfig({ theme: 'chalk' }).music.style, 'calm');
  assert.equal(normalizeConfig({ music: false }).music, null);
});

// Narration of `seconds` for each scene, as voice would save it.
const narration = (scenes) => Object.fromEntries(Object.entries(scenes).map(([id, seconds]) => [id, { duration: seconds, words: [{ text: 'Hi.', start: 0, end: seconds }], marks: {}, chunks: [{ start: 0, end: seconds }] }]));

test('targetSeconds spreads the missing time evenly over the holds, so the video ends at the target', () => {
  const src = '## a\nHi.\n\n## b\nHi.\n\n## c {min=4}\n';
  const voices = narration({ a: 5, b: 7.3 });
  const plain = buildTimeline(project(src), voices);
  const fitted = buildTimeline(project(src, { targetSeconds: 40 }), voices);
  assert.ok(Math.abs(fitted.duration - 40) < 0.1, String(fitted.duration));
  assert.equal(fitted.frames, 40 * 30);
  const added = fitted.scenes.map((s, k) => s.dur - plain.scenes[k].dur);
  assert.ok(Math.max(...added) - Math.min(...added) <= 1 / 30 + 1e-9, added.join(', '));
  // Each scene carries the hold it got, for check, and a timeline without a target has none.
  fitted.scenes.forEach((s, k) => assert.ok(Math.abs(s.added - added[k]) < 1e-3, `${s.added} ${added[k]}`));
  assert.ok(plain.scenes.every((s) => !('added' in s)));
  // The narration and the words keep their place in each scene, and the scenes follow each other.
  fitted.scenes.forEach((s, k) => {
    assert.equal(s.lead, plain.scenes[k].lead);
    assert.deepEqual(s.words, plain.scenes[k].words);
    if (k) assert.ok(Math.abs(s.start - (fitted.scenes[k - 1].start + fitted.scenes[k - 1].dur)) < 1e-9);
  });
  assert.equal(fitted.scenes[1].voice.start, fitted.scenes[1].start + fitted.scenes[1].lead);
  assert.deepEqual(fitted.target, { seconds: 40, natural: Math.round(plain.duration * 100) / 100, added: Math.round(((40 - plain.duration) / 3) * 100) / 100 });
  // More than 3 seconds a scene is said, and a little is not.
  assert.match(targetNotes(fitted)[0].message, /^targetSeconds 40 adds \d+\.\d s to the hold of every scene, because the narration with its pauses runs \d+\.\d s\. Write more narration, or lower targetSeconds\.$/);
  assert.deepEqual(targetNotes(buildTimeline(project(src, { targetSeconds: plain.duration + 2 }), voices)), []);
});

test('a video longer than targetSeconds stays as it is, and the note names its three longest scenes', () => {
  const src = '## a\nHi.\n\n## b\nHi.\n\n## c\nHi.\n\n## d\nHi.\n';
  const voices = narration({ a: 8, b: 12, c: 3, d: 10 });
  const plain = buildTimeline(project(src), voices);
  const over = buildTimeline(project(src, { targetSeconds: 30 }), voices);
  assert.deepEqual(over.scenes, plain.scenes);
  assert.equal(over.target.over, Math.round((plain.duration - 30) * 100) / 100);
  const [note] = targetNotes(over, 180);
  assert.equal(note.level, 'warn');
  assert.match(note.message, /^the video runs \d+\.\d s, \d+\.\d s over targetSeconds 30\. The longest scenes are b \(13\.0 s\), d \(\d+\.\d s\) and a \(\d+\.\d s\)\. Cut about \d+ words, or raise targetSeconds\.$/);
});

test('without targetSeconds the timeline and the settings are as they were, and a size block can set it', () => {
  const voices = narration({ a: 5 });
  const tl = buildTimeline(project('## a\nHi.\n'), voices);
  assert.equal('target' in tl, false);
  assert.equal(JSON.stringify(normalizeConfig({})).includes('targetSeconds'), false);
  assert.equal(normalizeConfig({ sizes: { shorts: { targetSeconds: 30 } } }, '.', { overrides: { size: 'shorts' } }).targetSeconds, 30);
  assert.equal(normalizeConfig({ targetSeconds: 60, sizes: { shorts: { targetSeconds: null } } }, '.', { overrides: { size: 'shorts' } }).targetSeconds, undefined);
  assert.throws(() => normalizeConfig({ targetSeconds: '40' }), /^.*targetSeconds must be the length you want in seconds, from 1 to 3600, like 40$/);
  assert.throws(() => normalizeConfig({ sizes: { shorts: { targetSeconds: 0 } } }), /^.*sizes\.shorts: targetSeconds must be/);
});

test('the estimate counts the speech by its letters, and for each scene its lead, its hold and its pauses, and the end', () => {
  const src = '## a\nOne two three four five six. Seven eight nine ten.\n\n## b {hold=2}\nOne two three.\n\n## c {min=4}\n';
  const p = project(src, { voice: 'af_heart' });
  const e = estimateLength(p);
  assert.equal(e.words, 13);
  // 50 letters at 12.95 a second, the rate of af_heart at its default speed.
  const speech = 50 / 12.95;
  assert.equal(e.speechSeconds, Math.round(speech * 10) / 10);
  assert.equal(e.perMinute, Math.round((13 / speech) * 60));
  // a: lead + hold + one sentence gap, b: lead + its hold, c: its min + the end.
  const rest = (0.35 + 0.7 + 0.3) + (0.35 + 2) + (4 + 1.4);
  assert.equal(e.seconds, Math.round((speech + rest) * 10) / 10);
  // The two narrated scenes, each with its lead and hold as the settings give them.
  assert.deepEqual([e.scenes, e.perScene, e.pauses, e.end, e.other], [2, (0.35 + 0.7 + 0.35 + 2) / 2, 0.3, 1.4, 4]);
  assert.equal(estimateLine(e), `about ${Math.round(e.seconds)} s: 13 words of speech at about ${e.perMinute} a minute take ${e.speechSeconds.toFixed(1)} s. The 2 scenes add 1.7 s each for their lead and hold, and the pauses between sentences add 0.3 s. The end of the video adds 1.4 s. Scenes with a min, or without narration, add 4.0 s more.`);
  // With the defaults it is the figure the writing docs give.
  const plain = estimateLength(project('## a\nHello there.\n\n## b\nHello again.\n', { voice: 'af_heart' }));
  assert.equal(plain.perScene, 1.05);
  assert.match(estimateLine(plain), /\. The 2 scenes add 1\.05 s each for their lead and hold\. The end of the video adds 1\.4 s\.$/);
  // A number is said as several words, and a slower voice takes longer.
  assert.ok(estimateLength(project('## a\nIn 1972.\n', { voice: 'af_heart' })).speechSeconds > estimateLength(project('## a\nIn nineteen.\n', { voice: 'af_heart' })).speechSeconds);
  assert.ok(estimateLength(project(src, { voice: 'am_michael' })).seconds > e.seconds);
  // A faster pace says more words a minute and shortens the gaps.
  assert.ok(estimateLength(project(src, { pace: 1.2 })).perMinute > e.perMinute);
  assert.match(estimateLine({ ...e, targetSeconds: 10 }), /\. That is about \d+ s over targetSeconds 10, so cut about \d+ words\.$/);
  assert.match(estimateLine({ ...e, targetSeconds: 60 }), /\. The holds get longer to reach targetSeconds 60\.$/);
  // Japanese and Chinese count characters, and a recording has no estimate.
  const ja = { config: normalizeConfig({ language: 'ja' }), script: parseScript('## a\nうるう年は、なぜあるの？\n', { language: 'ja' }) };
  assert.match(estimateLine(estimateLength(ja)), /^about \d+ s: 10 characters of speech at about 300 a minute take 2\.0 s\./);
  assert.equal(estimateLength({ config: normalizeConfig({ voice: { provider: 'recording', src: 'assets/n.wav' } }), script: parseScript(src) }), null);
  assert.equal(estimateLength(project('## c {min=4}\n')), null);
});
