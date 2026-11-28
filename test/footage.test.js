import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { footageScript, pieceEnds, unheardStretches, projectRate, createFootageProject } from '../src/footage.js';
import { ffmpeg } from '../src/ffmpeg.js';
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
  const heard = [['We', 0], ['had', 0.3], ['800', 0.6], ['-foot', 0.9], ['ships.', 1.2], ['[BLANK', 2], ['_AUDIO]', 2.2], ['(laughs)', 2.5], ['♪', 3], ['F', 3.5], ['-14.', 3.8]]
    .map(([text, start]) => ({ text, start, end: start + 0.3 }));
  assert.deepEqual(speechOnly(heard).map((w) => w.text), ['We', 'had', '800-foot', 'ships.', 'F-14.']);
  assert.deepEqual(speechOnly(heard).find((w) => w.text === '800-foot'), { text: '800-foot', start: 0.6, end: 1.2 });
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
