// "heard" in video.json: the forms the speech check accepts for a word, like
// "reg x 101" for regex101. A word heard as one of them is confirmed fully, in
// voice, check and verify. voice suggests the line when a word is heard the
// same way twice in a row, and voice and check suggest it when a word is heard
// as the same other spelling each time it comes up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords } from '../src/align.js';
import { loadProject } from '../src/project.js';
import { heardLine, heardTwice, synthesize, voicePaths, withHeard } from '../src/voice.js';
import { heardEveryTime, speechFindings, unconfirmedWords } from '../src/qa.js';
import { shownIssues } from '../src/cli.js';
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

test('check names a form of "heard" that matched nothing, with what was heard there instead', async (t) => {
  const noVoice = () => { throw new Error('no voice should be made'); };
  const dir = project(t, { heard: { regex101: ['regex101', 'reg ex'] } });
  heardAsRegX(dir);
  const voices = await synthesize(loadProject(dir), { transcribe: noVoice });
  const hint = speechFindings(loadProject(dir), voices).issues.find((i) => i.key === 'heard');
  assert.deepEqual([hint.level, hint.word, hint.forms], ['hint', 'regex101', ['regex101', 'reg ex']]);
  assert.equal(hint.message, '"heard" in video.json gives "regex101" and "reg ex" for "regex101", and none of them matched what the speech check heard. It heard "Reg X 101" there instead. A form matches one word or a few words, written the way the speech check writes them, so copy it from what it heard.');
  // One form that matches is enough for the word, and a form that matched nothing is named alone.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, heard: { regex101: ['reg ex', 'reg x 101'] } }));
  const fixed = await synthesize(loadProject(dir), { transcribe: noVoice });
  assert.equal(fixed.intro.words[0].matched, true);
  assert.equal(speechFindings(loadProject(dir), fixed).issues.find((i) => i.key === 'heard'), undefined);
  // A form is read like the words it was heard with, so "$" is "dollars" and confirms "bucks" in "$10".
  fs.writeFileSync(path.join(dir, 'script.md'), '# Money\n\n## intro\nIt costs ten bucks today.\n');
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, heard: { bucks: ['$'] } }));
  cachedVoice(dir, 'intro');
  const file = voicePaths(loadProject(dir), 'intro').json;
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...info, transcript: 'It costs $10 today.', words: info.words.map((w, k) => (k === 3 ? { ...w, matched: false } : w)), matchRate: 0.75, unmatched: ['bucks'] }));
  const money = await synthesize(loadProject(dir), { transcribe: noVoice });
  assert.equal(money.intro.words[3].matched, true);
  assert.equal(speechFindings(loadProject(dir), money).issues.find((i) => i.key === 'heard'), undefined);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, heard: { bucks: ['bux'] } }));
  const one = speechFindings(loadProject(dir), await synthesize(loadProject(dir), { transcribe: noVoice })).issues.find((i) => i.key === 'heard');
  assert.equal(one.message, '"heard" in video.json gives "bux" for "bucks", and it never matched what the speech check heard. It heard "$10" there instead. A form matches one word or a few words, written the way the speech check writes them, so copy it from what it heard.');
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

test('a word heard as the same other spelling each time gets the line for "heard", in voice and in check', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-heard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tabslip\n\n## intro\nTabslip keeps your tabs.\n\n## outro\nTry Tabslip today.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {}, outro() {} };');
  const voices = {};
  for (const [id, transcript] of [['intro', 'Tap Lip keeps your tabs.'], ['outro', 'Try Tap Lip today.']]) {
    cachedVoice(dir, id);
    const file = voicePaths(loadProject(dir), id).json;
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    info.transcript = transcript;
    info.words = info.words.map((w) => (w.text === 'Tabslip' ? { ...w, matched: false } : w));
    info.matchRate = 0.75;
    info.unmatched = ['Tabslip'];
    voices[id] = info;
  }
  const project = loadProject(dir);
  const line = 'It was heard as "Tap Lip" each time. If it is said right, add this to video.json, and the check accepts it: "heard": {"Tabslip": ["Tap Lip"]}';
  assert.deepEqual([...heardEveryTime(project, voices).values()], [{ word: 'Tabslip', heard: 'Tap Lip' }]);
  const [word] = unconfirmedWords(project, voices.intro, heardEveryTime(project, voices));
  assert.equal(word.advice, `If the voice says it wrong, write it as {Tabslip|spoken spelling} in script.md. ${line}`);
  const { issues } = speechFindings(project, voices);
  assert.equal(issues.filter((i) => i.level === 'warn').length, 2);
  for (const issue of issues.filter((i) => i.level === 'warn')) assert.ok(issue.message.endsWith(` "Tabslip" ${line.replace(/^It /, '')}`), issue.message);
  // Heard another way in one place, or only once, it gets the usual advice.
  const other = { ...voices.outro, transcript: 'Try Tab Lid today.' };
  assert.equal(heardEveryTime(project, { ...voices, outro: other }).size, 0);
  assert.equal(heardEveryTime(project, { intro: voices.intro }).size, 0);
  // Another word each time, like "Snow", is no other spelling.
  const snow = (v) => ({ ...v, transcript: v.transcript.replace('Tap Lip', 'Snow') });
  assert.equal(heardEveryTime(project, { intro: snow(voices.intro), outro: snow(voices.outro) }).size, 0);
  assert.match(unconfirmedWords(project, voices.intro)[0].advice, /reword the sentence\.$/);
});

// "Brewly" only nearly matched in one scene, and in another, written as
// {Brewly|Brew lee}, it wasn't confirmed.
// The line for "heard" lists both forms, in check, in its one line for many
// near matches, and in voice.
test('the line for "heard" lists every form a word was heard as in the run', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-heard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Brewly\n\n## why\nMeet Brewly today.\n\n## tip\nOrder your first {Brewly|Brew lee} box.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { why() {}, tip() {} };');
  const voices = {};
  for (const [id, transcript] of [['why', 'Meet Bruelly today.'], ['tip', 'Order your first Brugley box.']]) {
    cachedVoice(dir, id);
    const file = voicePaths(loadProject(dir), id).json;
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    info.transcript = transcript;
    if (id === 'why') info.nearly = [{ word: 'Brewly', heard: 'Bruelly' }];
    else {
      info.words = info.words.map((w) => (w.text === 'Brewly' ? { ...w, matched: false } : w));
      info.matchRate = 0.8;
      info.unmatched = ['Brewly'];
    }
    fs.writeFileSync(file, JSON.stringify(info));
    voices[id] = info;
  }
  const project = loadProject(dir);
  const line = '"heard": {"Brewly": ["Bruelly", "Brugley"]}';
  const near = speechFindings(project, voices).issues.find((i) => i.key === 'nearly');
  assert.ok(near.message.endsWith(line), near.message);
  assert.deepEqual(near.heard, { Brewly: ['Bruelly', 'Brugley'] });
  // More near matches than check lists one by one become one line, with the same forms.
  const many = { ...near, words: 3, nearly: [...near.nearly, { word: 'today', heard: 'to day' }, { word: 'Meet', heard: 'Meat' }] };
  const [shown] = shownIssues([many], false);
  assert.match(shown.message, /"heard": \{"Brewly": \["Bruelly", "Brugley"\], "today": \["to day"\], "Meet": \["Meat"\]\}$/);
  // voice gives the line for a word heard the same way twice in a row once
  // all scenes are made, with the forms of the other scenes too.
  const notes = [];
  const before = JSON.parse(fs.readFileSync(voicePaths(project, 'tip').json, 'utf8'));
  fs.writeFileSync(voicePaths(project, 'tip').json, JSON.stringify({ ...before, hash: 'older' }));
  const transcribe = async () => ({ text: 'Order your first Brugley box.', words: said('Order your first Brugley box.').map((w) => ({ ...w, start: w.start * 0.3, end: w.end * 0.3 })) });
  t.mock.method(process.stderr, 'write', () => true);
  const fake = await startFakeServices();
  t.after(fake.close);
  for (const [name, value] of Object.entries({ EXPLAINROO_ELEVENLABS_URL: fake.env.EXPLAINROO_ELEVENLABS_URL, ELEVENLABS_API_KEY: GOOD_KEY })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
  }
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, voice: { provider: 'elevenlabs', id: 'fake-voice' } }));
  await synthesize(loadProject(dir), { transcribe, notice: (m) => notes.push(m), log: () => {}, only: ['tip'] });
  assert.deepEqual(notes.filter((n) => /twice in a row/.test(n)), [`voice tip: the speech check heard "Brewly" as "Brugley" twice in a row. If that is how it is said, add this to video.json, and the check accepts it: "heard": {"Brewly": ["Brugley", "Bruelly"]}`]);
});
