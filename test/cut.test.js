// explainroo cut: a cut list of a recording, one sentence a line with each word's
// time, and the cut itself, with a crossfade at every join.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUDIO_CODECS, PEAK_CEILING, ffmpeg, finishMix, loudness, probe } from '../src/ffmpeg.js';
import { BREATH, applyCut, moveRange, compareCut, cutFiles, cutItems, cutListText, formatCut, gapSizes, joinSound, keptParts, partFrames, quietStretches, readCutList, writeCut } from '../src/cut.js';
import { checkVideo } from '../src/video-check.js';
import { ASR_MODEL, TTS_MODEL, cacheRoot } from '../src/models.js';
import { sha256File } from '../src/history.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cut-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A recording of 5.2 s: quiet until 0.8 s, "One," and "two." as tones, quiet from
// 1.7 to 2.9 s, "Three", an "um" from 3.4 to 3.9 s that the speech model leaves
// out, "four." and quiet from 4.4 s to the end.
const WORDS = [
  { text: 'One,', start: 0.8, end: 1.2, hz: 300 },
  { text: 'two.', start: 1.3, end: 1.7, hz: 400 },
  { text: 'Three', start: 2.9, end: 3.3, hz: 500 },
  { text: 'um', start: 3.4, end: 3.9, hz: 250, unheard: true },
  { text: 'four.', start: 4.0, end: 4.4, hz: 600 },
];
const QUIET = [[0, 0.8], [1.2, 1.3], [1.7, 2.9], [3.3, 3.4], [3.9, 4.0], [4.4, 5.2]];
const heardWords = WORDS.filter((w) => !w.unheard).map(({ text, start, end }) => ({ text, start, end }));

async function recording(dir, words = WORDS, d = 5.2) {
  const file = path.join(dir, 'talk.mp4');
  const tones = words.map((w) => `between(t,${w.start},${w.end})*0.3*sin(2*PI*${w.hz}*t)`).join('+');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=320x180:d=${d}:r=25`, '-f', 'lavfi', '-i', `aevalsrc='${tones}':s=48000:d=${d}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', '-shortest', file]);
  return file;
}

// The speech model: the recording first, then the cut.
function listener(...answers) {
  let call = 0;
  return async () => {
    const words = answers[Math.min(call++, answers.length - 1)];
    return { text: words.map((w) => w.text).join(' '), words };
  };
}

test('the items of a recording: words, pauses from the quiet and sounds without words', () => {
  const items = cutItems(heardWords, 5.2, QUIET);
  assert.deepEqual(items.map((i) => `${i.type === 'word' ? i.text : i.type} ${i.start}-${i.end}`), [
    'pause 0-0.8', 'One, 0.8-1.2', 'two. 1.3-1.7', 'pause 1.7-2.9', 'Three 2.9-3.3', 'sound 3.3-4', 'four. 4-4.4', 'pause 4.4-5.2',
  ]);
  // The speech model times a word into a quiet stretch: it starts at its end.
  const late = cutItems([{ text: 'Then', start: 1.9, end: 3.3 }], 5.2, QUIET);
  assert.deepEqual(late.map((i) => `${i.type} ${i.start}-${i.end}`), ['pause 0-0.8', 'sound 0.8-1.7', 'pause 1.7-2.9', 'word 2.9-3.3', 'sound 3.3-4.4', 'pause 4.4-5.2']);
  // Quiet stretches come from the sound: 10 ms steps under a level between floor and speech.
  const rate = 16000;
  const samples = new Float32Array(rate * 3);
  for (let i = rate; i < rate * 2; i++) samples[i] = 0.3 * Math.sin(i / 5);
  assert.deepEqual(quietStretches(samples, rate), [[0, 1], [2, 3]]);
});

test('the cut list has a line a sentence, and reading it back keeps what is left', () => {
  const items = cutItems(heardWords, 5.2, QUIET);
  const text = cutListText('talk.mp4', items, { sha256: 'ab'.repeat(32), language: 'en' });
  const lines = text.split('\n');
  assert.equal(lines[0], '# Cut list of talk.mp4');
  assert.ok(lines.includes('video: talk.mp4, sha256 abababababababab, language en'));
  assert.ok(lines.includes('Then run: explainroo cut talk.mp4 --apply'));
  assert.deepEqual(lines.slice(lines.indexOf('-->') + 2).filter(Boolean), [
    '[pause 0.80s @0.00] One,@0.80 two.@1.30',
    '[pause 1.20s @1.70] Three@2.90 [sound 0.70s @3.30] four.@4.00',
    '[pause 0.80s @4.40]',
  ]);
  // Untouched, everything stays.
  const round = (keep) => keep.map((k) => (typeof k === 'number' ? Math.round(k * 1000) / 1000 : k));
  assert.deepEqual(round(readCutList(text, items).keep), [0.8, true, true, 1.2, true, true, true, 0.8]);
  const edited = text.replace('[pause 0.80s @0.00]', '[pause 0.2s @0.00]').replace(' two.@1.30', '').replace('[pause 1.20s @1.70] ', '').replace('[sound 0.70s @3.30] ', '');
  const { keep } = readCutList(edited, items);
  assert.deepEqual(round(keep), [0.2, true, false, BREATH, true, false, true, 0.8]);
  const parts = keptParts(items, keep, 5.2).map((p) => [p.start.t, p.end.t].map((t) => Math.round(t * 1000) / 1000));
  assert.deepEqual(parts, [[0.6, 1.3], [1.7, 1.825], [2.775, 3.3], [4, 5.2]]);
  // A word that wasn't there, a word moved up and a word with a new time stop with the line.
  assert.throws(() => readCutList(`${edited}\nAnd five.\n`, items, 'talk.cut.md'), /talk\.cut\.md line \d+: "And" has no time, so it is not a word of the recording\. The cut only takes words out/);
  assert.throws(() => readCutList(edited.replace('One,@0.80', 'four.@4.00 One,@0.80').replace(' four.@4.00\n', '\n'), items, 'talk.cut.md'), /"One,@0\.80" comes before a word that stands earlier in the list\. The cut keeps the order of the recording, so it can't move words\./);
  // A word's time moves within its range, and a time outside it stops with the range.
  const moved = readCutList(edited.replace('Three@2.90', 'Three@3.05'), items, 'talk.cut.md');
  assert.deepEqual([...moved.moved], [[4, 3.05]]);
  assert.deepEqual(moved.keep, keep);
  assert.equal(moved.lines.get(4), lines.indexOf('[pause 1.20s @1.70] Three@2.90 [sound 0.70s @3.30] four.@4.00') + 1);
  assert.throws(() => readCutList(edited.replace('Three@2.90', 'Three@3.40'), items, 'talk.cut.md'), /talk\.cut\.md line \d+: "Three@3\.40" can move between 2\.90 and 3\.30, from the end of the word before it to its own end\. cut wrote it as Three@2\.90\./);
  assert.throws(() => readCutList(edited.replace('Three@2.90', 'Tree@3.00'), items, 'talk.cut.md'), /"Tree@3\.00" is not a word that cut wrote\. Leave the words as cut wrote them: delete them, or move a word's time to fix where it starts\./);
  assert.throws(() => readCutList(edited.replace('[pause 0.2s @0.00]', '[pause 0.2s @0.10]'), items, 'talk.cut.md'), /talk\.cut\.md line \d+: cut wrote no pause at 0\.10 s\. Leave the time of a pause as it is, and change only its seconds\./);
  for (const err of [() => readCutList(edited.replace('Three@2.90', 'Three@3.40'), items), () => readCutList(edited.replace('Three@2.90', 'Tree@3.00'), items)]) {
    assert.throws(err, (e) => !/not in the recording/.test(e.message));
  }
});

// The levels of a recording in 10 ms steps, from [from, to, dBFS] stretches over a
// floor of -64 dBFS.
function levelsOf(duration, stretches) {
  const levels = new Array(Math.round(duration * 100)).fill(-64);
  for (const [from, to, db] of stretches) for (let i = Math.round(from * 100); i < Math.round(to * 100); i++) levels[i] = db;
  return levels;
}

test('a word keeps the sound that joins it, and a sound right after a word says it may hold its end', () => {
  // "settings." as the speech model times it ends at 6.52, but its "-ngs" runs on:
  // a dip to -45 dBFS, which isn't quiet, then the "s" at -32 dBFS until 6.82.
  const words = [{ text: 'settings.', start: 6.26, end: 6.52 }, { text: "I'm", start: 7.34, end: 7.52 }];
  const quiet = [[0, 6.26], [6.85, 7.3], [7.52, 8.5]];
  const levels = levelsOf(8.5, [[6.26, 6.6, -24], [6.6, 6.75, -45], [6.75, 6.82, -32], [6.82, 6.85, -50], [7.3, 7.52, -18]]);
  const before = cutItems(words, 8.5, quiet);
  assert.deepEqual(before.filter((i) => i.type === 'sound').map((i) => [i.start, i.end]), [[6.52, 7.34]]);
  const items = cutItems(words, 8.5, quiet, { levels });
  assert.equal(items.find((i) => i.text === 'settings.').end, 6.82);
  assert.deepEqual(items.map((i) => i.type), ['pause', 'word', 'word', 'pause']);
  // Quiet in between is a gap, and the word ends before it.
  const apart = cutItems(words, 8.5, quiet, { levels: levelsOf(8.5, [[6.26, 6.6, -24], [6.66, 6.75, -45], [6.75, 6.82, -32], [7.3, 7.52, -18]]) });
  assert.equal(apart.find((i) => i.text === 'settings.').end, 6.6);
  // Sound longer than a word's end can be stays a sound, and says what it may hold.
  const um = cutItems([{ text: 'so', start: 1, end: 1.2 }, { text: 'then', start: 2.4, end: 2.6 }], 3.5, [[0, 1], [2.1, 2.4], [2.6, 3.5]], { levels: levelsOf(3.5, [[1, 2.1, -20], [2.4, 2.6, -20]]) });
  const sound = um.find((i) => i.type === 'sound');
  assert.deepEqual([sound.start, sound.holds], [1.6, 'so']);
  const text = cutListText('talk.mp4', um, { sha256: 'ab'.repeat(32), language: 'en' });
  assert.match(text, /^\[pause 1\.00s @0\.00\] so@1\.00 \[sound 0\.80s @1\.60 may hold the end of "so"\] then@2\.40 \[pause 0\.90s @2\.60\]$/m);
  assert.match(text, /A sound that "may hold the\nend" of a word can be the last sound of that word, so listen before you delete it\./);
  // The note reads back, and a length keeps that much of the sound from its start.
  assert.deepEqual(readCutList(text, um).keep.map((k) => (typeof k === 'number' ? Math.round(k * 100) / 100 : k)), [1, true, true, true, 0.9]);
  const shorter = readCutList(text.replace('[sound 0.80s', '[sound 0.20s'), um).keep;
  assert.equal(shorter[2], 0.2);
  const parts = keptParts(um, shorter, 3.5).map((p) => [p.start.t, p.end.t].map((t) => Math.round(t * 1000) / 1000));
  assert.deepEqual(parts, [[0, 1.8], [2.4, 3.5]]);
  // Without its seconds a sound stops with the line, like a pause.
  assert.throws(() => readCutList(text.replace('[sound 0.80s @1.60', '[sound xs @1.60'), um, 'talk.cut.md'), /talk\.cut\.md line \d+: "\[sound" has no time/);
});

test('--min-gap shows shorter pauses and sounds', () => {
  assert.deepEqual(gapSizes(), { pause: 0.6, sound: 0.4 });
  assert.deepEqual(gapSizes(0.2), { pause: 0.2, sound: 0.2 });
  const words = [{ text: 'and', start: 1, end: 1.3 }, { text: 'the', start: 1.6, end: 1.8 }, { text: 'end.', start: 2.15, end: 2.6 }];
  const quiet = [[0, 1], [1.3, 1.6], [1.8, 2.05], [2.6, 3.5]];
  const levels = levelsOf(3.5, [[1, 1.3, -20], [1.6, 1.8, -20], [2.05, 2.15, -40], [2.15, 2.6, -20]]);
  const plain = cutItems(words, 3.5, quiet, { levels });
  assert.deepEqual(plain.map((i) => i.type), ['pause', 'word', 'word', 'word', 'pause']);
  const fine = cutItems(words, 3.5, quiet, { levels, ...gapSizes(0.2) });
  assert.deepEqual(fine.map((i) => `${i.type}@${i.start}`), ['pause@0', 'word@1', 'pause@1.3', 'word@1.6', 'pause@1.8', 'word@2.15', 'pause@2.6']);
  assert.match(cutListText('talk.mp4', fine, { sha256: 'ab'.repeat(32), language: 'en', minGap: 0.2 }), /^video: talk\.mp4, sha256 abababababababab, language en, min gap 0\.2s$/m);
  const sounds = cutItems([{ text: 'and', start: 1, end: 1.3 }, { text: 'the', start: 1.9, end: 2.1 }], 3, [[0, 1], [1.3, 1.4], [1.65, 1.9], [2.1, 3]], { ...gapSizes(0.2) });
  assert.deepEqual(sounds.filter((i) => i.type === 'sound').map((i) => [i.start, i.end]), [[1.3, 1.65]]);
});

test('the sound of a cut joins without a click and keeps up with the picture', () => {
  const rate = 48000;
  // Two tones of different pitch and phase: a hard join would jump.
  const samples = new Float32Array(rate * 2);
  for (let i = 0; i < rate; i++) samples[i] = 0.5 * Math.sin(i * 0.05);
  for (let i = rate; i < rate * 2; i++) samples[i] = 0.5 * Math.cos(i * 0.11 + 1);
  const parts = [[0, Math.round(rate * 0.6)], [Math.round(rate * 1.3), Math.round(rate * 1.9)]];
  const out = joinSound(samples, 1, parts, Math.round(rate * 1.2));
  assert.equal(out.length, rate * 1.2);
  let jump = 0;
  for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
  // The biggest step is about that of the faster tone itself, 0.5 * 0.11.
  assert.ok(jump < 0.08, `largest step ${jump}`);
  // A hard join would step by about 0.75 there.
  assert.ok(Math.abs(samples[parts[1][0]] - samples[parts[0][1] - 1]) > 0.3);
  // The picture follows the sound to within half a frame at each join.
  const frames = partFrames([[0, 7999], [20000, 30001], [40000, 52003]], 30);
  let heard = 0;
  let shown = 0;
  [[0, 7999], [20000, 30001], [40000, 52003]].forEach(([a, b], k) => {
    heard += (b - a) / rate;
    shown += (frames[k][1] - frames[k][0]) / 30;
    assert.ok(Math.abs(heard - shown) <= 1 / 60 + 1e-9);
  });
});

test('cut writes the list, keeps it from being written over, and cuts the video as it says', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const cache = path.join(dir, 'cache');
  const before = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = cache;
  t.after(() => { if (before === undefined) delete process.env.EXPLAINROO_CACHE; else process.env.EXPLAINROO_CACHE = before; });
  const video = await recording(dir);
  const files = cutFiles(video);
  assert.equal(files.list, path.join(dir, 'talk.cut.md'));
  assert.equal(files.out, path.join(dir, 'talk.cut.mp4'));
  const written = await writeCut(video, { transcribe: listener(heardWords) });
  assert.deepEqual({ ...written, video: undefined, list: undefined }, { video: undefined, list: undefined, duration: 5.2, words: 4, pauses: 3, pauseSeconds: 2.8, sounds: 1, soundsNearWords: 0 });
  assert.match(formatCut(written), /talk\.cut\.md\n4 words, 3 pauses \(2\.8 s\) and 1 sound without words in 5\.2 s\. Delete words, pauses and sounds in it, then run: explainroo cut talk\.mp4 --apply$/);
  const text = fs.readFileSync(files.list, 'utf8');
  assert.match(text, /^\[pause 0\.8\ds @0\.00\] One,@0\.80 two\.@1\.30$/m);
  // The transcript is kept by the file's hash, so --apply doesn't listen again.
  assert.ok(fs.existsSync(path.join(cache, 'cut', `${sha256File(video)}-en.json`)));
  await assert.rejects(writeCut(video, { force: true, minGap: 0.05, transcribe: listener(heardWords) }), /--min-gap needs seconds of 0\.1 or more, like --min-gap 0\.3\. Without it a pause is 0\.6 s or more\./);
  await assert.rejects(writeCut(video, { transcribe: listener(heardWords) }), /talk\.cut\.md is already there and may hold your edits\. Edit it and run "explainroo cut .*talk\.mp4 --apply", or add --force/);

  const pause = /\[pause ([\d.]+)s @1\.7\d\] /.exec(text)[0];
  const sound = /\[sound ([\d.]+)s @3\.\d\d\] /.exec(text)[0];
  fs.writeFileSync(files.list, text.replace(/\[pause [\d.]+s @0\.00\]/, '[pause 0.2s @0.00]').replace(' two.@1.30', '').replace(pause, '').replace(sound, ''));
  const kept = [{ text: 'One,', start: 0.2, end: 0.6 }, { text: 'Three', start: 0.9, end: 1.3 }, { text: 'four.', start: 1.4, end: 1.8 }];
  // A dry run says what the cut would be and writes no file. Here the speech
  // model didn't hear "Three", next to the sound that was deleted, and heard
  // "Thr", given with its time in the cut and in the recording.
  const dry = await applyCut(video, { dryRun: true, transcribe: listener([kept[0], { text: 'Thr', start: 0.9, end: 1.1 }, kept[2]]) });
  assert.equal(fs.existsSync(files.out), false);
  assert.equal(dry.out, null);
  assert.equal(dry.joins, 3);
  assert.ok(Math.abs(dry.after - 2.55) < 0.12, `cut to ${dry.after} s`);
  assert.deepEqual(dry.speech.missing.map((m) => [m.word, m.original, m.next]), [['Three', 2.9, { item: '[sound 0.70s @3.30]', side: 'after', type: 'sound' }]]);
  assert.equal(dry.speech.extra[0].word, 'Thr');
  assert.ok(Math.abs(dry.speech.extra[0].original - 2.9) < 0.12, `Thr at ${dry.speech.extra[0].original} s`);
  const said = formatCut(dry);
  assert.match(said, /^Dry run of talk\.cut\.md, nothing written\.\n5\.2 s would cut to 2\.\d s, with 3 joins\./);
  assert.match(said, /\nIt didn't hear "Three" at \d\.\d s \(2\.90 s in talk\.mp4\)\. You deleted \[sound 0\.70s @3\.30\] right after it, and that may hold the end of the word\. Keep it, or give it fewer seconds to keep part of it, and try again\.\n/);
  assert.match(said, /\nIt heard "Thr" at 0\.9 s \(2\.\d\d s in talk\.mp4\), which the list doesn't keep\. That may be what is left of a kept word it didn't hear, so listen there\.\n/);
  assert.match(said, /\nTo write talk\.cut\.mp4, run it again without --dry-run\.$/);
  const r = await applyCut(video, { transcribe: listener(kept) });
  assert.equal(r.out, files.out);
  assert.equal(r.joins, 3);
  assert.ok(Math.abs(r.after - 2.55) < 0.12, `cut to ${r.after} s`);
  assert.deepEqual(r.speech.missing, []);
  assert.deepEqual(r.speech.extra, []);
  const info = await probe(r.out);
  assert.ok(Math.abs(Number(info.format.duration) - r.after) < 0.1);
  assert.match(formatCut(r), /talk\.cut\.mp4\n5\.2 s cut to 2\.\d s, with 3 joins\. The speech model heard 100% of the words the list keeps\.\nThe sound is at -1\d\.\d LUFS, with its peak at -\d+\.\d dBTP\.(?: [^\n]*)?\nThe joins, with where talk\.mp4 stops and starts again, as planned from the word times and where it landed at a quiet moment:\n  0\.\d\d s in the cut: stops at 1\.\d\d s \(planned 1\.30\), starts at 1\.\d\d s \(planned 1\.\d\d\), before \[pause [^\n]*\n.*\n  1\.\d\d s in the cut: stops at 3\.\d\d s \(planned 3\.30\), starts at 3\.\d\d s \(planned 4\.00\), before four\.@4\.00 on line \d+\nCheck the video with: explainroo verify talk\.cut\.mp4$/);
  // The joins in the report: each where it was planned and where it landed. The
  // first stops before the deleted "two.", so it doesn't go past its start.
  assert.equal(r.joinList.length, 3);
  assert.deepEqual(dry.joinList, r.joinList);
  assert.equal(r.joinList[0].out.planned, 1.3);
  assert.ok(r.joinList[0].out.landed <= 1.3 && r.joinList[0].out.landed >= 1.1, JSON.stringify(r.joinList[0]));
  assert.equal(r.joinList[2].next, 'four.@4.00');
  assert.equal(fs.readFileSync(files.list, 'utf8').split('\n')[r.joinList[2].line - 1].includes('four.@4.00'), true);
  // The loudness it reached, toward -14 LUFS, as verify measures it.
  assert.ok(r.loudness.integrated <= -13.5 && r.loudness.integrated > -20, `loudness ${r.loudness.integrated}`);
  assert.equal(dry.loudness, undefined);
  // verify passes on the cut: the sound is leveled and held under the peak ceiling.
  const checked = await checkVideo(r.out);
  assert.equal(checked.passed, true, JSON.stringify(checked.issues));
  assert.ok(checked.loudness.truePeak <= -1, `true peak ${checked.loudness.truePeak}`);
  assert.ok(Math.abs(checked.loudness.integrated - r.loudness.integrated) < 0.2, `verify measured ${checked.loudness.integrated}`);

  // The list belongs to that recording: another version of the file stops.
  fs.appendFileSync(video, Buffer.from([0]));
  await assert.rejects(applyCut(video, { transcribe: listener(kept) }), /talk\.cut\.md was made from another version of talk\.mp4\. Run "explainroo cut .*talk\.mp4 --force" to write it again from this one\./);
});

test('a join never reaches into a deleted word, and one at a moved word is right there', () => {
  // "sorry" as the speech model times it ends where "first" starts, and "page."
  // comes after a short gap.
  const items = [
    { type: 'word', text: 'Sorry,', start: 0, end: 1.4 },
    { type: 'word', text: 'first', start: 1.4, end: 1.9 },
    { type: 'word', text: 'the', start: 2.0, end: 2.2 },
    { type: 'word', text: 'page.', start: 2.5, end: 2.9 },
  ];
  const parts = keptParts(items, [false, true, false, true], 3);
  // After the deleted "Sorry," the join can't go earlier than its end.
  assert.deepEqual(parts[0].start, { t: 1.4, lo: 1.4, hi: 1.4, i: 1 });
  // Before the deleted "the" it stops at its start, and after it, between its end and "page.".
  assert.deepEqual(parts[0].end, { t: 2.0, lo: 1.8, hi: 2.0, i: 2 });
  assert.deepEqual(parts[1].start, { t: 2.5, lo: 2.3, hi: 2.5, i: 3 });
  // A word with a moved time has its join there.
  const moved = items.map((item, i) => (i === 1 ? { ...item, start: 1.62, moved: true } : item));
  assert.deepEqual(keptParts(moved, [false, true, false, true], 3)[0].start, { t: 1.62, lo: 1.62, hi: 1.62, i: 1 });
  // Kept words next to a deleted sound still look a little around the word.
  const sound = [{ type: 'word', text: 'so', start: 0, end: 0.5 }, { type: 'sound', start: 0.5, end: 1 }, { type: 'word', text: 'then', start: 1, end: 1.4 }];
  assert.deepEqual(keptParts(sound, [true, false, true], 1.5)[1].start, { t: 1, lo: 0.8, hi: 1.03, i: 2 });
  // A word may move from the end of the word before it to its own end.
  assert.deepEqual(moveRange(items, 1), { lo: 1.4, hi: 1.9 });
  assert.deepEqual(moveRange(items, 3), { lo: 2.2, hi: 2.9 });
});

test('a word heard right after a deleted one names the time to move, and the moved time cuts there', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const before = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = path.join(dir, 'cache');
  t.after(() => { if (before === undefined) delete process.env.EXPLAINROO_CACHE; else process.env.EXPLAINROO_CACHE = before; });
  // "Sorry," runs on to 1.6 s, but the speech model starts "first" at 1.4 s.
  const words = [
    { text: 'One.', start: 0.5, end: 0.9, hz: 300 },
    { text: 'Sorry,', start: 1.2, end: 1.6, hz: 400 },
    { text: 'first', start: 1.62, end: 1.9, hz: 500 },
    { text: 'page.', start: 2.3, end: 2.7, hz: 600 },
  ];
  const heard = [{ text: 'One.', start: 0.5, end: 0.9 }, { text: 'Sorry,', start: 1.2, end: 1.4 }, { text: 'first', start: 1.4, end: 1.9 }, { text: 'page.', start: 2.3, end: 2.7 }];
  const video = await recording(dir, words, 3.4);
  await writeCut(video, { transcribe: listener(heard) });
  const { list } = cutFiles(video);
  const text = fs.readFileSync(list, 'utf8');
  fs.writeFileSync(list, text.replace('Sorry,@1.20 ', ''));
  const line = fs.readFileSync(list, 'utf8').split('\n').findIndex((l) => l.includes('first@1.40')) + 1;
  // The cut keeps a bit of "Sorry," that the speech model hears as "Ri".
  const dry = await applyCut(video, { dryRun: true, transcribe: listener([{ text: 'One.', start: 0.5, end: 0.9 }, { text: 'Ri', start: 1.0, end: 1.1 }, { text: 'first', start: 1.2, end: 1.5 }, { text: 'page.', start: 1.9, end: 2.3 }]) });
  const join = dry.joinList.find((j) => j.next === 'first@1.40');
  assert.deepEqual(join.in, { planned: 1.4, landed: 1.4 });
  assert.equal(join.line, line);
  assert.ok(Math.abs(join.at - 1.05) < 0.1, `join at ${join.at} s in the cut`);
  assert.deepEqual(dry.speech.extra.map((x) => [x.word, x.cut]), [['Ri', { word: 'Sorry', side: 'before', kept: 'first@1.40', line, upTo: 1.9 }]]);
  assert.ok(Math.abs(dry.speech.extra[0].original - 1.4) < 0.1, `Ri at ${dry.speech.extra[0].original} s`);
  const said = formatCut(dry);
  assert.match(said, new RegExp(`It heard "Ri" at 1\\.0 s \\(1\\.\\d\\d s in talk\\.mp4\\), which the list doesn't keep\\. The join before first@1\\.40 may sit in "Sorry", which you deleted, because the speech model can put a word's start too early\\. Move the time of first@1\\.40 on line ${line} later, up to 1\\.90, to where the word starts, and try again\\.`));
  assert.doesNotMatch(said, /delete the word next to it/);
  assert.match(said, new RegExp(`  1\\.\\d\\d s in the cut: stops at [01]\\.\\d\\d s \\(planned 1\\.20\\), starts at 1\\.40 s \\(planned 1\\.40\\), before first@1\\.40 on line ${line}\\n`));
  // Two words heard at one join make one line, and a kept word it missed there
  // gets no advice to keep the deleted word.
  const cut = { word: 'Sorry', side: 'before', kept: 'first@1.40', line, upTo: 1.9 };
  const both = formatCut({ ...dry, speech: { matchRate: 0.75, missing: [{ word: 'first', time: 1.1, original: 1.4, next: { item: 'Sorry,@1.20', side: 'before', type: 'word' } }], extra: [{ word: 'Ri', time: 1.0, original: 1.4, cut }, { word: 'first', time: 1.2, original: 1.6, cut }] } });
  assert.equal(both.match(/Move the time of first@1\.40/g).length, 1);
  assert.match(both, /It heard "Ri" at 1\.0 s \(1\.40 s in talk\.mp4\), "first" at 1\.2 s \(1\.60 s in talk\.mp4\), which the list doesn't keep\. The join before first@1\.40/);
  assert.doesNotMatch(both, /Keep it/);
  // Moved to where the word starts, the join is there.
  fs.writeFileSync(list, fs.readFileSync(list, 'utf8').replace('first@1.40', 'first@1.62'));
  const fixed = await applyCut(video, { dryRun: true, transcribe: listener([{ text: 'One.', start: 0.5, end: 0.9 }, { text: 'first', start: 1.1, end: 1.4 }, { text: 'page.', start: 1.8, end: 2.2 }]) });
  assert.deepEqual(fixed.joinList.find((j) => j.next === 'first@1.62').in, { planned: 1.62, landed: 1.62 });
  assert.deepEqual(fixed.speech.extra, []);
  assert.ok(Math.abs(dry.after - fixed.after - 0.22) < 0.05, `${dry.after} then ${fixed.after}`);
  // Outside its range it stops with the range, and says nothing about the recording.
  fs.writeFileSync(list, fs.readFileSync(list, 'utf8').replace('first@1.62', 'first@2.00'));
  await assert.rejects(applyCut(video, { dryRun: true, transcribe: listener([]) }), new RegExp(`talk\\.cut\\.md line ${line}: "first@2\\.00" can move between 1\\.40 and 1\\.90, from the end of the word before it to its own end\\.`));

});

test('a recording is leveled toward -14 LUFS under the peak limit, and cut says what it reached', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  // Speech-like sound: a tone at -26 dBFS that comes and goes 3 times a second,
  // and a quiet tone with one loud clap.
  for (const [name, expr] of [['even', "aevalsrc='0.05*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))':s=48000:d=8"], ['clap', "aevalsrc='0.01*sin(2*PI*220*t)+between(t,4,4.004)*0.95*sin(2*PI*1000*t)':s=48000:d=8"]]) {
    const input = path.join(dir, `${name}.wav`);
    await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', expr, '-c:a', 'pcm_s16le', input]);
    const out = path.join(dir, `${name}-out.wav`);
    await finishMix(input, out, -14, AUDIO_CODECS.mp4);
    const leveled = await loudness(out);
    assert.ok(Math.abs(leveled.integrated + 14) <= 0.5, `${name}: loudness ${leveled.integrated}`);
    assert.ok(leveled.truePeak <= PEAK_CEILING + 0.05, `${name}: peak ${leveled.truePeak}`);
  }
  const line = (integrated) => formatCut({ video: '/v/talk.mp4', list: '/v/talk.cut.md', out: '/v/talk.cut.mp4', before: 9, after: 6, joins: 0, joinList: [], loudness: { integrated, truePeak: -1.2, target: -14 }, speech: { matchRate: 1, missing: [], extra: [] } });
  assert.match(line(-14.2), /\nThe sound is at -14\.2 LUFS, with its peak at -1\.2 dBTP\.\n/);
  assert.match(line(-17.5), /\nThe sound is at -17\.5 LUFS, with its peak at -1\.2 dBTP\. Its loudest moments are far above the rest, so the peak limit of -1 dBTP holds it under -14 LUFS\.\n/);
});

test('cut --force moves an edited list aside, and writes over one as cut wrote it', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const before = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = path.join(dir, 'cache');
  t.after(() => { if (before === undefined) delete process.env.EXPLAINROO_CACHE; else process.env.EXPLAINROO_CACHE = before; });
  const video = await recording(dir);
  await writeCut(video, { transcribe: listener(heardWords) });
  const { list } = cutFiles(video);
  const text = fs.readFileSync(list, 'utf8');
  fs.writeFileSync(list, text.replace(' two.@1.30', ''));
  const again = await writeCut(video, { force: true, transcribe: listener(heardWords) });
  assert.equal(again.old, path.join(dir, 'talk.cut.old.md'));
  assert.doesNotMatch(fs.readFileSync(again.old, 'utf8'), /two\.@1\.30/);
  assert.match(formatCut(again), /talk\.cut\.md\nYour edited list is now talk\.cut\.old\.md, so you can copy your edits from there\.\n/);
  assert.equal(fs.readFileSync(list, 'utf8'), text);
  // A list as cut wrote it, also with other settings, is written over.
  const same = await writeCut(video, { force: true, minGap: 0.3, transcribe: listener(heardWords) });
  assert.equal(same.old, undefined);
  assert.doesNotMatch(formatCut(same), /edited/);
  // The next edited list gets a number.
  fs.appendFileSync(list, 'edited\n');
  const third = await writeCut(video, { force: true, transcribe: listener(heardWords) });
  assert.equal(third.old, path.join(dir, 'talk.cut.old-2.md'));
  assert.match(fs.readFileSync(third.old, 'utf8'), /min gap 0\.3s[\s\S]*edited\n$/);
  assert.ok(fs.existsSync(again.old));
  await assert.rejects(writeCut(video, { transcribe: listener(heardWords) }), /When you edited it, --force moves it to talk\.cut\.old\.md first\./);
});

test('after a cut, the words heard are compared with the words kept, both ways', async () => {
  const said = ['Hi,', 'first', 'you', 'open', 'the', 'page.'];
  const words = ['Hi,', 'Dari,', 'first', 'you', 'open', 'the', 'page.'].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const r = await compareCut(said, { text: words.map((w) => w.text).join(' '), words }, 3, 'en');
  assert.equal(r.matchRate, 1);
  assert.deepEqual(r.extra, [{ word: 'Dari', time: 0.4 }]);
  const clipped = await compareCut(said, { text: '', words: words.filter((w) => w.text !== 'first' && w.text !== 'Dari,') }, 3, 'en');
  assert.deepEqual(clipped.missing.map((m) => m.word), ['first']);
  assert.match(formatCut({ out: '/v/talk.cut.mp4', before: 9, after: 6, joins: 1, speech: r }), /It heard "Dari" at 0\.4 s, which the list doesn't keep\. That may be left from a word you cut, so listen there\./);
});

// With the voice and speech models on this computer: a real recording made with
// the local voice, cut by its transcript.
const models = ['models', 'models'].map((dir, i) => path.join(cacheRoot(), dir, [TTS_MODEL, ASR_MODEL][i]));
const skip = models.every((m) => fs.existsSync(m)) ? false : 'needs the voice and speech models';
test('a spoken recording is cut by its transcript, and the cut says the words it keeps', { skip, timeout: 600000 }, async (t) => {
  const dir = tempDir(t);
  const { loadTTS } = await import('../src/models.js');
  const { generateSpeech } = await import('../src/phonemes.js');
  const { writeWav } = await import('../src/wav.js');
  const tts = await loadTTS();
  const sentences = ['This is the part we keep.', 'Sorry, this part has a mistake.', 'And this is how it ends.'];
  const wavs = [];
  for (const [i, text] of sentences.entries()) {
    const audio = await generateSpeech(tts, text, { language: 'en', voice: 'am_michael', speed: 1 });
    wavs.push(path.join(dir, `s${i}.wav`));
    writeWav(wavs.at(-1), audio.audio, audio.sampling_rate);
  }
  const video = path.join(dir, 'take.mp4');
  await ffmpeg(['-loglevel', 'error', ...wavs.flatMap((w) => ['-i', w]), '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=30',
    '-filter_complex', `aevalsrc=0:s=24000:d=0.7[a];aevalsrc=0:s=24000:d=1.2[b];aevalsrc=0:s=24000:d=0.8[c];[a][0][b][1][c][2]concat=n=6:v=0:a=1,aresample=48000[s]`,
    '-map', '3:v', '-map', '[s]', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', video]);
  const cached = path.join(cacheRoot(), 'cut', `${sha256File(video)}-en.json`);
  t.after(() => fs.rmSync(cached, { force: true }));
  await writeCut(video);
  const { list } = cutFiles(video);
  const lines = fs.readFileSync(list, 'utf8').split('\n');
  const wrong = lines.findIndex((l) => /mistake/.test(l));
  assert.ok(wrong > 0, lines.join('\n'));
  // The line of the mistake goes, and the pause before it shrinks to a breath.
  fs.writeFileSync(list, lines.filter((_, i) => i !== wrong).join('\n').replace(/\[pause [\d.]+s @0\.00\]/, '[pause 0.3s @0.00]'));
  const r = await applyCut(video);
  assert.ok(r.speech.matchRate >= 0.9, JSON.stringify(r.speech));
  assert.ok(!/mistake/i.test(r.speech.transcript), r.speech.transcript);
  const checked = await checkVideo(r.out, { script: (fs.writeFileSync(path.join(dir, 'kept.txt'), `${sentences[0]} ${sentences[2]}`), path.join(dir, 'kept.txt')) });
  assert.equal(checked.passed, true, JSON.stringify(checked.issues));
  assert.ok(checked.speech.matchRate >= 0.9, JSON.stringify(checked.speech));
});
