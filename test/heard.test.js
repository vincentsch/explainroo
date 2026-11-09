// "heard" in video.json: the forms the speech check accepts for a word, like
// "reg x 101" for regex101. A word heard as one of them is confirmed fully, in
// voice, check and verify, and voice suggests the line when a word with a
// {shown|spoken} override is heard the same way twice in a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords } from '../src/align.js';
import { loadProject } from '../src/project.js';
import { heardLine, heardTwice, synthesize, voicePaths, withHeard } from '../src/voice.js';
import { cachedVoice } from './helpers/cached-voice.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const said = (text) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 1 }));
const WORDS = [{ spoken: 'redge ex one oh one', display: 'regex101' }, { spoken: 'explains', display: 'explains' }, { spoken: 'them.', display: 'them.' }];
const HEARD = { regex101: ['reg x 101', 'regex 101'] };

test('a word heard as one of its forms in "heard" is confirmed fully, and others are not', () => {
  const without = alignWords(WORDS, said('Reg X 101 explains them.'), 5);
  assert.equal(without.words[0].matched, false);
  for (const heard of ['Reg X 101 explains them.', 'Regex 101 explains them.', 'reg-x 101 explains them.']) {
    const r = alignWords(WORDS, said(heard), 5, 'en', { accept: HEARD });
    assert.deepEqual(r.words.map((w) => [w.matched, !!w.nearly]), [[true, false], [true, false], [true, false]], heard);
    assert.equal(r.matchRate, 1);
  }
  // Another form is still not the word.
  assert.equal(alignWords(WORDS, said('Rejects 101 explains them.'), 5, 'en', { accept: HEARD }).words[0].matched, false);
});

function project(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-heard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Regex\n\n## intro\n{regex101|redge ex one oh one} explains them.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  return dir;
}

// A made scene whose transcript has "Reg X 101", which the check didn't confirm.
function heardAsRegX(dir) {
  cachedVoice(dir, 'intro');
  const file = voicePaths(loadProject(dir), 'intro').json;
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  info.transcript = 'Reg X 101 explains them.';
  info.words = info.words.map((w, k) => (k === 0 ? { ...w, matched: false } : w));
  info.matchRate = 0.5;
  info.unmatched = ['regex101'];
  info.nearly = [];
  fs.writeFileSync(file, JSON.stringify(info));
}

test('"heard" in video.json confirms a made scene from its transcript, without making the voice again', async (t) => {
  const noVoice = () => { throw new Error('no voice should be made'); };
  const dir = project(t);
  heardAsRegX(dir);
  const before = await synthesize(loadProject(dir), { transcribe: noVoice });
  assert.equal(before.intro.words[0].matched, false);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, heard: HEARD }));
  const after = await synthesize(loadProject(dir), { transcribe: noVoice });
  assert.equal(after.intro.words[0].matched, true);
  assert.equal(after.intro.matchRate, 1);
  assert.deepEqual(after.intro.unmatched, []);
  // The saved scene stays as it was made, so it follows video.json.
  assert.equal(JSON.parse(fs.readFileSync(voicePaths(loadProject(dir), 'intro').json, 'utf8')).words[0].matched, false);
  // A near match of the word is no near match with its form in "heard".
  const near = { ...after.intro, words: after.intro.words.map((w) => ({ ...w, matched: true })), nearly: [{ word: 'regex101', heard: 'Reg X 101' }] };
  assert.deepEqual(withHeard(near, 'en', HEARD).nearly, []);
});

test('"heard" must be words with lists of forms', (t) => {
  for (const [heard, message] of [[['x'], /heard must be an object/], [{ regex101: 'reg x 101' }, /heard\.regex101 must be a list/], [{ regex101: [] }, /must be a list/]]) {
    assert.throws(() => loadProject(project(t, { heard })), message);
  }
  assert.throws(() => loadProject(project(t, { languages: { es: { voice: 'ef_dora', heard: HEARD } } })), /"heard" goes at the top of video\.json/);
});

test('a word with an override heard the same way twice in a row gets the line for "heard"', () => {
  const info = (spoken, heard) => ({
    duration: 3,
    transcript: `${heard} explains them.`,
    words: [{ text: 'regex101', spoken, matched: false }, { text: 'explains', spoken: 'explains', matched: true }, { text: 'them.', spoken: 'them.', matched: true }],
  });
  const first = info('regex one oh one', 'Reg X 101');
  const second = info('redge ex one oh one', 'reg x 101');
  assert.deepEqual(heardTwice(first, second, 'en'), [{ word: 'regex101', heard: 'reg x 101' }]);
  assert.deepEqual(heardTwice(info('regex one oh one', 'Rejects 101'), second, 'en'), []);
  assert.equal(heardLine([{ word: 'regex101', heard: 'Reg X 101' }]), 'the speech check heard "regex101" as "Reg X 101" twice in a row. If that is how it is said, add this to video.json, and the check accepts it: "heard": {"regex101": ["Reg X 101"]}');
});

test('voice prints the line for "heard" when a new spoken form is heard as before', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const env = { EXPLAINROO_ELEVENLABS_URL: fake.env.EXPLAINROO_ELEVENLABS_URL, ELEVENLABS_API_KEY: GOOD_KEY };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
  }
  t.mock.method(process.stderr, 'write', () => true);
  const dir = project(t, { voice: { provider: 'elevenlabs', id: 'fake-voice' } });
  const transcribe = async () => ({ text: 'Reg X 101 explains them.', words: said('Reg X 101 explains them.').map((w) => ({ ...w, start: w.start * 0.3, end: w.end * 0.3 })) });
  const notes = [];
  await synthesize(loadProject(dir), { transcribe, notice: (m) => notes.push(m), log: () => {} });
  assert.deepEqual(notes.filter((n) => /twice in a row/.test(n)), []);
  fs.writeFileSync(path.join(dir, 'script.md'), '# Regex\n\n## intro\n{regex101|reg ex one oh one} explains them.\n');
  await synthesize(loadProject(dir), { transcribe, notice: (m) => notes.push(m), log: () => {} });
  assert.deepEqual(notes.filter((n) => /twice in a row/.test(n)), ['voice intro: the speech check heard "regex101" as "Reg X 101" twice in a row. If that is how it is said, add this to video.json, and the check accepts it: "heard": {"regex101": ["Reg X 101"]}']);
});
