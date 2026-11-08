// What voice keeps and what it makes again: a moved marker keeps the narration,
// an older scene gets today's speech check from its transcript, and a long scene
// says which step it is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { speechChunks } from '../src/script.js';
import { reviewSpeech, sceneHash, synthesize, voicePaths, heardQuote } from '../src/voice.js';
import { speechFindings } from '../src/qa.js';
import { writeWav } from '../src/wav.js';
import { main } from '../src/cli.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const SPEAK = 'POST /v1/text-to-speech/*';
// Says back every sentence it is given, as words a tenth of a second apart.
const echo = (texts) => async () => {
  const text = texts.shift() ?? '';
  return { text, words: text.split(' ').filter(Boolean).map((w, i) => ({ text: w, start: i * 0.1, end: i * 0.1 + 0.08 })) };
};

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
}

async function paidProject(t, script) {
  const fake = await startFakeServices();
  t.after(fake.close);
  setEnv(t, 'EXPLAINROO_ELEVENLABS_URL', fake.env.EXPLAINROO_ELEVENLABS_URL);
  setEnv(t, 'ELEVENLABS_API_KEY', GOOD_KEY);
  t.mock.method(process.stderr, 'write', () => true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'fake-voice' } }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {}, outro() {} };');
  const spoken = () => fake.requests('elevenlabs', SPEAK).length;
  return { dir, spoken };
}

// A scene with narration made by an older version: a tone, and JSON without the
// narration key or the speech check version.
function olderProject(t, script, saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-older-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, lead: 0, hold: 0, end: 0 }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  const project = loadProject(dir);
  const scene = project.script.scenes[0];
  const files = voicePaths(project, scene.id);
  fs.mkdirSync(project.paths.voice, { recursive: true });
  writeWav(files.wav, Float32Array.from({ length: 24000 }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
  const words = scene.units.filter((u) => u.type === 'word').map((u, i) => ({ text: u.display, spoken: u.spoken, start: i * 0.2, end: i * 0.2 + 0.15, matched: !saved.unmatched?.includes(u.display) }));
  const marks = Object.fromEntries(scene.units.flatMap((u, i) => {
    if (u.type !== 'mark') return [];
    const next = scene.units.slice(i).filter((x) => x.type === 'word').length;
    return [[u.name, words[words.length - next]?.start ?? words.at(-1).end]];
  }));
  fs.writeFileSync(files.json, JSON.stringify({ hash: sceneHash(scene, speechChunks(scene.units, project.config), project.config), id: scene.id, duration: 1, words, marks,
    chunks: [{ start: 0, end: 1, text: scene.spoken }], transcript: saved.transcript, matchRate: saved.matchRate ?? 1, unmatched: saved.unmatched ?? [], nearly: [] }));
  return { dir, files };
}

const noSpeech = () => { throw new Error('no speech should be made'); };

test('moving a marker keeps the narration, makes no new speech and moves only the cue', async (t) => {
  const { dir, spoken } = await paidProject(t, '# Test\n\n## intro\nOpen a receipt. [#open] See the model.\n\n## outro\nThat is all.\n');
  await synthesize(loadProject(dir), { transcribe: echo(['Open a receipt.', 'See the model.', 'That is all.']) });
  assert.equal(spoken(), 3);
  const file = path.join(dir, 'build/voice/intro.json');
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wav = fs.readFileSync(path.join(dir, 'build/voice/intro.wav'));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\n[#open] Open a receipt. See the [#model] model.\n\n## outro\nThat is all.\n');
  const lines = [];
  const voices = await synthesize(loadProject(dir), { transcribe: noSpeech, log: (line) => lines.push(line) });
  assert.equal(spoken(), 3, 'no new speech');
  assert.deepEqual(lines, ['voice intro: kept the narration, updated the cues']);
  assert.deepEqual(voices.intro.words, before.words);
  assert.equal(voices.intro.marks.open, 0);
  assert.equal(voices.intro.marks.model, before.words[5].start);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'build/voice/intro.wav')), wav);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(after.hash, before.hash);
  assert.equal(after.speech, before.speech);
  // The next run finds the scene up to date and says nothing.
  lines.length = 0;
  await synthesize(loadProject(dir), { transcribe: noSpeech, log: (line) => lines.push(line) });
  assert.deepEqual(lines, []);
  // A changed spoken word, or a changed shown word, makes that scene again.
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\n[#open] Open a receipt. See the [#model] models.\n\n## outro\nThat is all.\n');
  await synthesize(loadProject(dir), { transcribe: echo(['Open a receipt.', 'See the models.']) });
  assert.equal(spoken(), 4, 'only the new sentence is bought');
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\n[#open] Open a receipt. See the [#model] {Models|models}.\n\n## outro\nThat is all.\n');
  await synthesize(loadProject(dir), { transcribe: echo(['Open a receipt.', 'See the models.']) });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).words.at(-1).text, 'Models.');
});

test('a scene made by an older version keeps its narration when a marker moves, on either side of a pause', async (t) => {
  // The marker moves to the word with this index.
  for (const [from, to, at] of [
    ['Open a receipt. [#open] See the model.', '[#open] Open a receipt. See the model.', 0],
    ['Open a receipt. [pause 0.4] [#open] See the model.', 'Open [#open] a receipt. [pause 0.4] See the model.', 1],
    ['Open a receipt. [#open] [pause 0.4] See the model.', 'Open a receipt. [pause 0.4] See [#open] the model.', 4],
  ]) {
    const { dir, files } = olderProject(t, `# Test\n\n## intro\n${from}\n`, { transcript: 'Open a receipt. See the model.' });
    const words = JSON.parse(fs.readFileSync(files.json, 'utf8')).words;
    fs.writeFileSync(path.join(dir, 'script.md'), `# Test\n\n## intro\n${to}\n`);
    const lines = [];
    const voices = await synthesize(loadProject(dir), { transcribe: noSpeech, log: (line) => lines.push(line) });
    assert.deepEqual(lines, ['voice intro: kept the narration, updated the cues'], from);
    assert.deepEqual(voices.intro.words, words);
    assert.equal(voices.intro.marks.open, words[at].start, to);
  }
});

test('an older scene gets the speech check of today from its transcript, without new speech and without saving', async (t) => {
  const { dir, files } = olderProject(t, '# Test\n\n## intro\nIt contains a harmless piece of the virus, and {tabslip.com|tab slip dot com} sells it.\n', {
    transcript: 'It contains a harmless peace of the virus, and tabslip.com sells it.', unmatched: ['piece', 'tabslip.com'], matchRate: 0.786,
  });
  const before = fs.readFileSync(files.json, 'utf8');
  const voices = await synthesize(loadProject(dir), { transcribe: noSpeech });
  assert.equal(voices.intro.matchRate, 1);
  assert.deepEqual(voices.intro.unmatched, []);
  assert.ok(voices.intro.words.every((w) => w.matched));
  assert.deepEqual(voices.intro.nearly, [{ word: 'piece', heard: 'peace', alike: true }]);
  assert.equal(fs.readFileSync(files.json, 'utf8'), before);
  // A scene checked with today's rules is taken as it is.
  const today = { ...JSON.parse(before), check: 2 };
  assert.equal((await reviewSpeech(today, 'en')).matchRate, 0.786);
  const { issues } = speechFindings(loadProject(dir), voices);
  assert.ok(!issues.some((i) => i.level === 'warn'), JSON.stringify(issues));
});

test('a word that stays unconfirmed is quoted with four whole words on each side', async (t) => {
  const transcript = 'It contains a harmless pizza of the virus, such as a protein from its surface. That peace a lot.';
  const { dir } = olderProject(t, '# Test\n\n## intro\nIt contains a harmless piece of the virus, such as a protein from its surface. That piece a lot.\n', { transcript, unmatched: ['piece', 'piece'], matchRate: 0.9 });
  const project = loadProject(dir);
  const voices = await synthesize(project, { transcribe: noSpeech });
  const v = voices.intro;
  assert.deepEqual(v.words.filter((w) => !w.matched).map((w) => w.text), ['piece']);
  assert.equal(heardQuote(v, 'en', [4]), '"It contains a harmless pizza of the virus, such…"');
  assert.equal(heardQuote(v, 'en', [16]), '"…from its surface. That peace a lot."');
  // Places that overlap are quoted once.
  assert.equal(heardQuote(v, 'en', [4, 6]), '"It contains a harmless pizza of the virus, such as a…"');
  assert.equal(heardQuote(v, 'en', [1, 16]), '"It contains a harmless pizza of…" and "…from its surface. That peace a lot."');
  const warn = speechFindings(project, voices).issues.find((i) => i.level === 'warn');
  assert.match(warn.message, /^the voice check could not confirm "piece"\. It heard: "It contains a harmless pizza of the virus, such…"\. /);
});

test('a long scene says the step it is on, one line per step, and in a terminal one line that changes', async (t) => {
  const { dir } = await paidProject(t, '# Test\n\n## intro\nOne sentence here. Two sentences there.\n');
  const slow = (texts) => {
    const say = echo(texts);
    return async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return say(...args);
    };
  };
  const lines = [];
  await synthesize(loadProject(dir), { transcribe: slow(['One sentence here.', 'Two sentences there.']), log: (line) => lines.push(line) });
  const steps = lines.filter((line) => /^voice intro: (making speech|timing words|checking speech)$/.test(line));
  assert.ok(steps.length >= 2, lines.join('\n'));
  assert.equal(new Set(steps).size, steps.length, 'each step once');
  assert.match(lines.at(-1), /^voice intro: .* of narration/);
  // A terminal gets one line that names the sentence too.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  const updates = [];
  const log = (line) => lines.push(line);
  log.update = (line) => updates.push(line);
  await synthesize(loadProject(dir), { transcribe: slow(['One sentence here.', 'Two sentences there.']), log });
  assert.ok(updates.some((u) => /^voice intro: (making speech|timing words|checking speech), sentence 2 of 2$/.test(u)), updates.join('\n'));
  // A quick scene says nothing about its steps.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  lines.length = 0;
  await synthesize(loadProject(dir), { transcribe: echo(['One sentence here.', 'Two sentences there.']), log: (line) => lines.push(line) });
  assert.ok(!lines.some((line) => /making speech|timing words|checking speech/.test(line)), lines.join('\n'));
});
