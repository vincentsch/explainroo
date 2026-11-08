// What voice does with narration it made before: an older scene gets today's
// speech check from its transcript, and a word it couldn't confirm is quoted
// with the words around it.
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
