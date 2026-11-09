// explainroo cut: a cut list of a recording, one sentence a line with each word's
// time, and the cut itself, with a crossfade at every join.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, probe } from '../src/ffmpeg.js';
import { BREATH, applyCut, compareCut, cutFiles, cutItems, cutListText, formatCut, joinSound, keptParts, partFrames, quietStretches, readCutList, writeCut } from '../src/cut.js';
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

async function recording(dir) {
  const file = path.join(dir, 'talk.mp4');
  const tones = WORDS.map((w) => `between(t,${w.start},${w.end})*0.3*sin(2*PI*${w.hz}*t)`).join('+');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=5.2:r=25', '-f', 'lavfi', '-i', `aevalsrc='${tones}':s=48000:d=5.2`,
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
  assert.deepEqual(round(readCutList(text, items)), [0.8, true, true, 1.2, true, true, true, 0.8]);
  const edited = text.replace('[pause 0.80s @0.00]', '[pause 0.2s @0.00]').replace(' two.@1.30', '').replace('[pause 1.20s @1.70] ', '').replace('[sound 0.70s @3.30] ', '');
  const keep = readCutList(edited, items);
  assert.deepEqual(round(keep), [0.2, true, false, BREATH, true, false, true, 0.8]);
  const parts = keptParts(items, keep, 5.2).map((p) => [p.start.t, p.end.t].map((t) => Math.round(t * 1000) / 1000));
  assert.deepEqual(parts, [[0.6, 1.3], [1.7, 1.825], [2.775, 3.3], [4, 5.2]]);
  // A word that wasn't there, a word moved up and a word with a new time stop with the line.
  assert.throws(() => readCutList(`${edited}\nAnd five.\n`, items, 'talk.cut.md'), /talk\.cut\.md line \d+: "And" has no time, so it is not a word of the recording\. The cut only takes words out/);
  assert.throws(() => readCutList(edited.replace('One,@0.80', 'four.@4.00 One,@0.80').replace(' four.@4.00\n', '\n'), items, 'talk.cut.md'), /"One,@0\.80" comes before what the line above has\. The cut keeps the order of the recording, so it can't move words\./);
  assert.throws(() => readCutList(edited.replace('Three@2.90', 'Three@2.95'), items, 'talk.cut.md'), /"Three@2\.95" is not in the recording\. Leave the words, pauses and sounds as cut wrote them, and only delete them\./);
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
  assert.deepEqual({ ...written, video: undefined, list: undefined }, { video: undefined, list: undefined, duration: 5.2, words: 4, pauses: 3, pauseSeconds: 2.8, sounds: 1 });
  assert.match(formatCut(written), /talk\.cut\.md\n4 words, 3 pauses \(2\.8 s\) and 1 sound without words in 5\.2 s\. Delete words, pauses and sounds in it, then run: explainroo cut talk\.mp4 --apply$/);
  const text = fs.readFileSync(files.list, 'utf8');
  assert.match(text, /^\[pause 0\.8\ds @0\.00\] One,@0\.80 two\.@1\.30$/m);
  // The transcript is kept by the file's hash, so --apply doesn't listen again.
  assert.ok(fs.existsSync(path.join(cache, 'cut', `${sha256File(video)}-en.json`)));
  await assert.rejects(writeCut(video, { transcribe: listener(heardWords) }), /talk\.cut\.md is already there and may hold your edits\. Edit it and run "explainroo cut .*talk\.mp4 --apply", or add --force/);

  const pause = /\[pause ([\d.]+)s @1\.7\d\] /.exec(text)[0];
  const sound = /\[sound ([\d.]+)s @3\.\d\d\] /.exec(text)[0];
  fs.writeFileSync(files.list, text.replace(/\[pause [\d.]+s @0\.00\]/, '[pause 0.2s @0.00]').replace(' two.@1.30', '').replace(pause, '').replace(sound, ''));
  const kept = [{ text: 'One,', start: 0.2, end: 0.6 }, { text: 'Three', start: 0.9, end: 1.3 }, { text: 'four.', start: 1.4, end: 1.8 }];
  const r = await applyCut(video, { transcribe: listener(kept) });
  assert.equal(r.out, files.out);
  assert.equal(r.joins, 3);
  assert.ok(Math.abs(r.after - 2.55) < 0.12, `cut to ${r.after} s`);
  assert.deepEqual(r.speech.missing, []);
  assert.deepEqual(r.speech.extra, []);
  const info = await probe(r.out);
  assert.ok(Math.abs(Number(info.format.duration) - r.after) < 0.1);
  assert.match(formatCut(r), /talk\.cut\.mp4\n5\.2 s cut to 2\.\d s, with 3 joins\. The speech model heard 100% of the words the list keeps\.\nCheck the video with: explainroo verify talk\.cut\.mp4$/);
  // verify passes on the cut: the sound is leveled and held under the peak ceiling.
  const checked = await checkVideo(r.out);
  assert.equal(checked.passed, true, JSON.stringify(checked.issues));
  assert.ok(checked.loudness.truePeak <= -1, `true peak ${checked.loudness.truePeak}`);

  // The list belongs to that recording: another version of the file stops.
  fs.appendFileSync(video, Buffer.from([0]));
  await assert.rejects(applyCut(video, { transcribe: listener(kept) }), /talk\.cut\.md was made from another version of talk\.mp4\. Run "explainroo cut .*talk\.mp4 --force" to write it again from this one\./);
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
