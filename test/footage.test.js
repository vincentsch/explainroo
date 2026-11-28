import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { footageScript, pieceEnds, unheardStretches, projectRate, createFootageProject, makeWorkingCopy, footageInfo, plausibleTimes, collapsed, softestMoment } from '../src/footage.js';
import { ffmpeg, probe } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { parseScript } from '../src/script.js';
import { speechOnly } from '../src/models.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-footage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Words that say what they are, a word every 0.4 s, with a long pause after word 12.
function words(n, pauseAfter = 12) {
  const out = [];
  let t = 1;
  for (let i = 1; i <= n; i++) {
    out.push({ text: i % 6 === 0 ? `word${i}.` : `word${i}`, start: t, end: t + 0.3 });
    t += i === pauseAfter ? 2.5 : 0.4;
  }
  return out;
}

test('a recording becomes scenes of whole sentences whose spans follow each other on the frame grid', () => {
  const heard = words(30);
  const text = footageScript(heard, 20, 25, 'Talk');
  const script = parseScript(text);
  // The long pause sits between two scenes, with the times that cut it.
  const pauseEnd = heard[11].end;
  assert.ok(text.includes(`> pause of 2.2 s after this scene: to cut it, end this scene at ${(Math.round((pauseEnd + 0.25) * 25) / 25).toFixed(3)} and start the next at ${(Math.round((heard[12].start - 0.25) * 25) / 25).toFixed(3)}`), text);
  assert.ok(script.scenes.length >= 2);
  const spans = script.scenes.map((s) => [s.attrs.from, s.attrs.to]);
  // From just before the first word to just after the last, with no gap between scenes.
  assert.equal(spans[0][0], 0.76);
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i][0], spans[i - 1][1]);
  for (const [a, b] of spans) for (const v of [a, b]) assert.equal(Math.round(v * 25 * 1000) % 1000, 0, `${v} is on the frame grid`);
  // Every word is in the script once, in order, and a scene ends at a sentence or at the long pause.
  assert.deepEqual(script.scenes.flatMap((s) => s.units.filter((u) => u.type === 'word').map((u) => u.display)), heard.map((w) => w.text));
  assert.ok(script.scenes.some((s) => /^word12\.$/.test(s.units.filter((u) => u.type === 'word').at(-1).display)), 'a scene ends at the long pause');
  assert.throws(() => footageScript([], 5, 25, 'Talk'), /heard no words in the recording/);
});

test('a short sentence between two pauses joins the scene before it', () => {
  // Six seconds that end a sentence, then a short sentence, then a long pause.
  const heard = [];
  let t = 1;
  for (let i = 1; i <= 15; i++, t += 0.4) heard.push({ text: i === 15 ? 'level.' : 'say', start: t, end: t + 0.3 });
  t += 0.2;
  for (const text of ['Go', 'to', 'school.']) heard.push({ text, start: t, end: (t += 0.4) - 0.1 });
  t += 2;
  for (let i = 1; i <= 15; i++, t += 0.4) heard.push({ text: i === 15 ? 'end.' : 'more', start: t, end: t + 0.3 });
  const script = parseScript(footageScript(heard, t + 1, 25, 'Talk'));
  assert.deepEqual(script.scenes.map((s) => s.units.filter((u) => u.type === 'word').at(-1).display), ['school.', 'end.']);
});

test("the speech model's notes for sound that isn't speech are left out, and a hyphenated word stays whole", () => {
  const heard = [['We', 0], ['had', 0.3], ['800', 0.6], ['-foot', 0.9], ['ships.', 1.2], ['[BLANK', 2], ['_AUDIO]', 2.2], ['(laughs)', 2.5], ['♪', 3], ['F', 3.5], ['-14.', 3.8], ['100', 4.5], [',000', 4.8], ['nasa', 5.5], ['.gov.', 5.8]]
    .map(([text, start]) => ({ text, start, end: start + 0.3 }));
  assert.deepEqual(speechOnly(heard).map((w) => w.text), ['We', 'had', '800-foot', 'ships.', 'F-14.', '100,000', 'nasa.gov.']);
  assert.deepEqual(speechOnly(heard).find((w) => w.text === '800-foot'), { text: '800-foot', start: 0.6, end: 1.2 });
});

test('a word gets no more time than its letters take, a run of words at one moment is noticed, and under music a piece ends where it is softest', () => {
  // The first word after music, which the speech model started at the start of its piece.
  const words = plausibleTimes([{ text: 'My', start: 25, end: 30.7, first: true }, { text: 'brother', start: 30.7, end: 31.1 }]);
  assert.deepEqual(words[0], { text: 'My', start: 29.86, end: 30.7, first: true, estimated: true, heardStart: 25 });
  assert.equal(words[1].estimated, undefined);
  // In the middle of a piece, a word far too long is cut back too, and a drawn-out one keeps its time.
  assert.equal(plausibleTimes([{ text: 'other.', start: 22.6, end: 22.98 }, { text: 'My', start: 23.94, end: 30.7 }])[1].start, 29.86);
  assert.deepEqual(plausibleTimes([{ text: 'So', start: 0.2, end: 1.6 }, { text: 'today', start: 1.7, end: 2 }])[0], { text: 'So', start: 0.2, end: 1.6 });
  // A tied start and a long first word stay in order, and the script's spans go forward.
  const tied = plausibleTimes([{ text: 'My', start: 15, end: 20.7, first: true }, { text: 'brother', start: 15, end: 15 }, { text: 'and', start: 20.9, end: 21.1 }, { text: 'I.', start: 21.1, end: 21.3 }]);
  tied.forEach((w, i) => assert.ok(!i || w.start >= tied[i - 1].start, `${w.text} at ${w.start} starts before ${tied[i - 1]?.text}`));
  assert.equal(tied[1].estimated, true);
  const spans = parseScript(footageScript(tied, 22, 30, 'Talk')).scenes.map((x) => [x.attrs.from, x.attrs.to]);
  spans.forEach(([a, b]) => assert.ok(b > a, `a scene from ${a} to ${b}`));
  // A near tie with an outlier between keeps every word forward.
  const near = plausibleTimes([{ text: 'one', start: 3, end: 3.2 }, { text: 'two', start: 9, end: 9.2 }, { text: 'three', start: 2.998, end: 3.3 }, { text: 'four', start: 3.4, end: 3.6 }]);
  near.forEach((w) => assert.ok(w.end >= w.start, `${w.text} from ${w.start} to ${w.end}`));
  // A drawn-out first word at the very start keeps its opening when it is cut back.
  const opening = parseScript(footageScript(plausibleTimes([{ text: 'So', start: 0.2, end: 1.6, first: true }, { text: 'today.', start: 1.7, end: 2 }]), 10, 30, 'Talk'));
  assert.equal(opening.scenes[0].attrs.from, 0);
  // Words heard after the end of the picture make no scene.
  const late = parseScript(footageScript([{ text: 'Hi.', start: 1, end: 1.4 }, { text: 'Gone.', start: 8, end: 8.4 }], 3, 30, 'Talk'));
  assert.deepEqual(late.scenes.map((x) => [x.attrs.from, x.attrs.to]), [[0.767, 2]]);
  // Words with times after the words that follow share the time before them.
  const lost = plausibleTimes([{ text: "it's", start: 17.28, end: 29.98 }, { text: 'really', start: 29.98, end: 29.98 }, { text: 'a', start: 29.98, end: 29.98 }, { text: 'bunch', start: 18.4, end: 18.64 }, { text: 'of', start: 18.64, end: 18.74 }, { text: 'little', start: 18.74, end: 18.94 }]);
  assert.deepEqual(lost.slice(0, 4).map((w) => [w.text, w.start, w.end, !!w.estimated]), [["it's", 17.28, 17.616, false], ['really', 17.616, 18.288, true], ['a', 18.288, 18.4, true], ['bunch', 18.4, 18.64, false]]);
  // A word that runs over the words after it ends where the next one starts.
  assert.deepEqual(plausibleTimes([{ text: "it's", start: 17.28, end: 29.98 }, { text: 'really', start: 17.5, end: 17.8 }])[0], { text: "it's", start: 17.28, end: 17.5 });
  assert.equal(collapsed([0, 1, 2, 3, 4].map(() => ({ text: 'and', start: 198.5, end: 198.5 }))), true);
  assert.equal(collapsed(words), false);
  // A minute of loud sound with one soft second, from 21 to 22 s.
  const samples = new Float32Array(16000 * 60).map((_, i) => (Math.floor(i / 16000) === 21 ? 0.01 : 0.5) * Math.sin(i / 3));
  const ends = pieceEnds([], 60, 25, (a, b) => softestMoment(samples, a, b));
  assert.ok(ends[0] > 21 && ends[0] < 22, String(ends));
});

test('a long recording is heard in pieces split at pauses, and loud stretches without words are named', () => {
  assert.deepEqual(pieceEnds([[10, 11], [24, 25], [40, 41]], 60), [24.5, 40.5, 60]);
  assert.deepEqual(pieceEnds([], 60), [25, 50, 60]);
  assert.deepEqual(unheardStretches([{ start: 0, end: 1 }, { start: 5, end: 6 }], [[1, 2]], 9), [[2, 5], [6, 9]]);
  assert.equal(projectRate(29.97), 30);
  assert.equal(projectRate(23.976), 24);
  assert.equal(projectRate(59.94), 60);
  assert.equal(projectRate(15), 30);
});

function footageProject(t, settings, script) {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/footage.mov'), '');
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '640x360', fps: 30, footage: 'assets/footage.mov', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};');
  return dir;
}

test('the scenes of a footage project are whole frames end to end, with no lead, hold or end', (t) => {
  const p = loadProject(footageProject(t, {}, '## a {from=0 to=5.02}\n\n## b {from=5.02 to=10.04}\n\n## c {from=20 to=20.4}\n'));
  const tl = buildTimeline(p, {});
  // 5.02 s twice is 301 frames, the nearest frame to 10.04 s, not 302.
  assert.deepEqual(tl.scenes.map((s) => s.footage.frames), [151, 150, 12]);
  assert.deepEqual(tl.scenes.map((s) => Math.round(s.start * 30)), [0, 151, 301]);
  assert.equal(tl.frames, 313);
  assert.deepEqual(tl.scenes.map((s) => s.transition), ['none', 'cut', 'cut']);
  assert.equal(tl.scenes[2].footage.from, 20);
  // Captions in Japanese and Chinese join words without spaces, so the timeline says the language.
  assert.equal(tl.language, undefined);
  assert.equal(buildTimeline(loadProject(footageProject(t, { language: 'ja' }, '## a {from=0 to=2}\n')), {}).language, 'ja');
  // German has no Kokoro voice, and a footage project needs none.
  assert.equal(loadProject(footageProject(t, { language: 'de' }, '## a {from=0 to=2}\n')).config.voice.provider, 'footage');
});

test('a working copy of an odd-sized recording has even sides, and init never writes over a file', { timeout: 120000 }, async (t) => {
  const dir = temp(t);
  const src = path.join(dir, 'screen.mp4');
  await ffmpeg(['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=gray:s=1001x561:r=30:d=1', '-f', 'lavfi', '-i', 'sine=f=440:d=1:sample_rate=44100',
    '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-shortest', src]);
  const copy = path.join(dir, 'copy.mov');
  await makeWorkingCopy(src, copy, await footageInfo(src));
  const v = (await probe(copy)).streams.find((x) => x.codec_type === 'video');
  assert.deepEqual([v.width % 2, v.height % 2], [0, 0], `${v.width}x${v.height}`);
  assert.equal(v.width, 1000);
  // A recording already at assets/footage.mov stays as it is.
  const target = path.join(dir, 'talk');
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(target, 'assets', 'footage.mov'), 'the original');
  for (const input of [path.join(target, 'assets', 'footage.mov'), src]) {
    await assert.rejects(createFootageProject(target, input, { transcribe: async () => ({ text: '', words: [] }) }), /already there/);
  }
  // An init that fails, like one that hears no words, leaves nothing that stops the next try.
  const again = path.join(dir, 'again');
  await assert.rejects(createFootageProject(again, src, { transcribe: async () => ({ text: '', words: [] }) }), /heard no words/);
  assert.deepEqual(fs.readdirSync(path.join(again, 'assets')), []);
  await assert.rejects(createFootageProject(again, src, { transcribe: async () => ({ text: '', words: [] }) }), /heard no words/);
  assert.equal(fs.readFileSync(path.join(target, 'assets', 'footage.mov'), 'utf8'), 'the original');
});

test('a footage project refuses what would change the speed or the length of the recording', (t) => {
  for (const [settings, message] of [
    [{ voice: 'af_heart' }, /takes no "voice"/],
    [{ pace: 1.2 }, /takes no "pace"/],
    [{ targetSeconds: 30 }, /takes no "targetSeconds"/],
    [{ speed: 1.1 }, /takes no "speed"/],
    [{ footage: 'talk.mp4' }, /footage must be a video inside assets\//],
  ]) assert.throws(() => loadProject(footageProject(t, settings, '## a {from=0 to=2}\n')), message, JSON.stringify(settings));
  assert.throws(() => loadProject(footageProject(t, {}, '## a\n')), /scene "a" needs the span of the recording it shows/);
  assert.throws(() => loadProject(footageProject(t, {}, '## a {from=3 to=2}\n')), /ends at 2 s of the recording, which is not after its start at 3 s/);
  assert.throws(() => loadProject(footageProject(t, {}, '## a {from=0 to=2 bars=2}\n')), /takes no bars/);
});

test('init from a recording makes a working copy, a script of spans and scenes that show them', { timeout: 120000 }, async (t) => {
  const dir = temp(t);
  const source = path.join(dir, 'talk.webm');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=300:d=6:sample_rate=44100', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', source]);
  const cache = temp(t);
  const before = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = cache;
  t.after(() => { if (before === undefined) delete process.env.EXPLAINROO_CACHE; else process.env.EXPLAINROO_CACHE = before; });
  const said = [{ text: 'Hello there.', start: 0.5, end: 1.4 }, { text: 'This', start: 1.6, end: 1.8 }, { text: 'is', start: 1.9, end: 2.0 }, { text: 'a', start: 2.1, end: 2.2 }, { text: 'test.', start: 2.3, end: 2.8 }];
  const target = path.join(dir, 'video');
  const r = await createFootageProject(target, source, { transcribe: async () => ({ text: said.map((w) => w.text).join(' '), words: said }) });
  assert.equal(r.info.fps, 30);
  assert.deepEqual(r.config.footage, 'assets/footage.mov');
  assert.equal(r.config.transition, 'cut');
  const project = loadProject(target);
  assert.equal(project.config.voice.provider, 'footage');
  assert.match(fs.readFileSync(path.join(target, 'script.md'), 'utf8'), /^## s01 \{from=0\.267 to=3\.400\}\nHello there\. This is a test\.$/m);
  // The working copy: a MOV with PCM sound, no B-frames, both streams from 0.
  const { probe } = await import('../src/ffmpeg.js');
  const streams = (await probe(path.join(target, 'assets/footage.mov'))).streams;
  assert.deepEqual(streams.map((s) => [s.codec_type, s.codec_name, Number(s.start_time)]), [['video', 'h264', 0], ['audio', 'pcm_s16le', 0]]);
  await assert.rejects(createFootageProject(target, source), /already has a video\.json/);
});

test('a short from a stretch of a footage project reuses its words, cuts its long pauses and keeps its settings', { timeout: 120000 }, async (t) => {
  const dir = temp(t);
  const src = path.join(dir, 'talk.mp4');
  await ffmpeg(['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=gray:s=320x180:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=300:d=12:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  const said = [['One', 1], ['two', 1.3], ['three.', 1.6], ['Four', 4.5], ['five', 4.8], ['six.', 5.1], ['Seven', 7.5], ['eight.', 7.8], ['Nine', 10], ['ten.', 10.3]];
  let heard = 0;
  const transcribe = async () => {
    heard++;
    return { text: '', words: said.map(([text, start]) => ({ text, start, end: start + 0.25 })) };
  };
  const parent = path.join(dir, 'talk');
  await createFootageProject(parent, src, { transcribe });
  assert.equal(heard, 1);
  const settings = JSON.parse(fs.readFileSync(path.join(parent, 'video.json'), 'utf8'));
  fs.writeFileSync(path.join(parent, 'video.json'), JSON.stringify({ ...settings, theme: 'paper', music: false }));
  const r = await createFootageProject(path.join(dir, 'short'), parent, { from: 4, to: 9, size: 'tiktok', transcribe });
  assert.equal(heard, 1, 'the short heard the recording again');
  assert.deepEqual(r.stretch, { from: 4, to: 9 });
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'short', 'video.json'), 'utf8'));
  assert.deepEqual([config.theme, config.music, config.size], ['paper', false, 'tiktok']);
  // The working copy is the stretch, five seconds.
  const v = (await probe(path.join(dir, 'short', 'assets', 'footage.mov'))).streams.find((x) => x.codec_type === 'video');
  assert.equal(Number(v.nb_frames), 150);
  // Its words start at the stretch, and the pause of two seconds between them is cut.
  const script = parseScript(fs.readFileSync(path.join(dir, 'short', 'script.md'), 'utf8'));
  assert.deepEqual(script.scenes.map((x) => x.units.filter((u) => u.type === 'word').map((u) => u.display).join(' ')), ['Four five six.', 'Seven eight.']);
  const [a, b] = script.scenes.map((x) => [x.attrs.from, x.attrs.to]);
  assert.ok(Math.abs(a[1] - (5.1 + 0.25 + 0.25 - 4)) < 0.04 && Math.abs(b[0] - (7.5 - 0.25 - 4)) < 0.04, `spans ${JSON.stringify([a, b])}`);
});
