// Paid narration against the fake server, with a call counter. A fake transcribe
// keeps these free of the speech models, and the last test runs the real command
// line where the models are there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadProject, normalizeConfig, ProjectError } from '../src/project.js';
import { parseScript, speechChunks } from '../src/script.js';
import { sceneHash, synthesize, voicePaths } from '../src/voice.js';
import { speechKey, boughtCharacters } from '../src/paid-speech.js';
import { findConnector } from '../src/connectors/index.js';
import { listJobs, historyReport, historyDir } from '../src/history.js';
import { readWav } from '../src/wav.js';
import { cacheRoot, TTS_MODEL, ASR_MODEL } from '../src/models.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const runner = fileURLToPath(new URL('./helpers/voice-run.js', import.meta.url));
const SPEAK = 'POST /v1/text-to-speech/*';
const FOUR_SENTENCES = '# Test\n## first\nThe first sentence is here. [#mark] The second sentence is there.\n## silent\n## second\n{DNS|D N S} finds the address. It answers fast.\n';
const noWords = async () => ({ text: '', words: [] });
const noop = () => {};

function setEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

async function setup(t, { script = FOUR_SENTENCES, voice = { provider: 'elevenlabs', id: 'fake-voice' }, settings = {} } = {}) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-speech-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {}, silent() {}, second() {} };');
  setEnv(t, 'EXPLAINROO_ELEVENLABS_URL', fake.env.EXPLAINROO_ELEVENLABS_URL);
  setEnv(t, 'ELEVENLABS_API_KEY', GOOD_KEY);
  // Says the address override once, which would only clutter the test output.
  t.mock.method(process.stderr, 'write', () => true);
  const spoken = () => fake.requests('elevenlabs', SPEAK).map((r) => r.body.text);
  const voiceRun = (options = {}) => synthesize(loadProject(dir), { transcribe: noWords, ...options });
  const child = (...args) => spawn(process.execPath, [runner, dir, ...args], { env: { ...process.env, ...fake.env }, stdio: 'ignore' });
  return { fake, dir, spoken, voiceRun, child };
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const sentences = ['The first sentence is here.', 'The second sentence is there.', 'D N S finds the address.', 'It answers fast.'];

test('each answer is saved under its own key before it is transcribed, and its job counts the characters', async (t) => {
  const { dir, fake, spoken, voiceRun } = await setup(t);
  const seen = [];
  await voiceRun({ transcribe: async () => { seen.push(fs.readdirSync(historyDir(dir, 'voice')).length); return { text: '', words: [] }; } });
  assert.deepEqual(spoken(), sentences);
  // The first sentence was on disk when the first transcribe started, and so on.
  assert.deepEqual(seen, [1, 2, 3, 4]);
  const jobs = listJobs(dir);
  assert.equal(jobs.length, 4);
  for (const job of jobs) {
    assert.equal(job.kind, 'speech');
    assert.equal(job.provider, 'elevenlabs');
    assert.equal(job.status, 'done');
    assert.equal(job.characters, [...job.request.text].length);
    assert.equal(job.request.voice, 'fake-voice');
    assert.equal(job.request.model, 'eleven_multilingual_v2');
    assert.equal(job.request.speed, 1);
    assert.equal(job.output.file, `history/voice/${job.key}.wav`);
    assert.equal(hashFile(path.join(dir, job.output.file)), job.output.sha256);
  }
  assert.equal(boughtCharacters(dir), sentences.join('').length);
  const body = fake.requests('elevenlabs', SPEAK)[1].body;
  assert.equal(body.previous_text, sentences[0]);
  assert.equal(body.next_text, undefined);
});

test('a kill after the first answer is saved: the restart buys only the rest', async (t) => {
  const { dir, spoken, voiceRun, child } = await setup(t);
  const marker = path.join(dir, 'transcribing');
  const run = child(marker);
  while (!fs.existsSync(marker)) await new Promise((resolve) => setTimeout(resolve, 20));
  run.kill('SIGKILL');
  await once(run, 'close');
  assert.deepEqual(spoken(), sentences.slice(0, 1));
  await voiceRun();
  assert.deepEqual(spoken(), sentences);
  assert.ok(fs.existsSync(voicePaths(loadProject(dir), 'first').wav));
});

test('a transcribe that fails right after an answer arrives: the restart buys nothing for that sentence', async (t) => {
  const { spoken, voiceRun } = await setup(t);
  await assert.rejects(voiceRun({ transcribe: async () => { throw new Error('the speech model broke'); } }), /speech model broke/);
  assert.deepEqual(spoken(), sentences.slice(0, 1));
  await voiceRun();
  assert.deepEqual(spoken(), sentences);
});

test('a kill during a request: voice stops, says why, and --new buys only that sentence', async (t) => {
  const { dir, fake, spoken, voiceRun, child } = await setup(t, { script: '# Test\n## first\nThe first sentence is here. The second sentence is there.\n' });
  fake.plan('elevenlabs', SPEAK, {}, { hang: true });
  const run = child();
  await fake.until('elevenlabs', SPEAK, 2);
  run.kill('SIGKILL');
  await once(run, 'close');
  assert.deepEqual(spoken(), sentences.slice(0, 2));

  await assert.rejects(voiceRun(), (e) => {
    assert.ok(e instanceof ProjectError);
    assert.match(e.message, /nothing more was bought/);
    assert.match(e.message, /scene first: "The second sentence is there\."/);
    assert.match(e.message, /Another run may still be working on it, or an earlier run stopped/);
    assert.match(e.message, / voice .* --new/);
    return true;
  });
  assert.deepEqual(spoken(), sentences.slice(0, 2));

  const report = historyReport(dir);
  assert.equal(report.open.length, 1);
  assert.match(report.open[0].command, / voice .* --new$/);
  await voiceRun({ fresh: true });
  assert.deepEqual(spoken(), [...sentences.slice(0, 2), sentences[1]]);
  assert.deepEqual(historyReport(dir).open, []);
  await voiceRun();
  assert.equal(spoken().length, 3);
});

test('--new also finishes what was never asked for, and buys nothing that is already good', async (t) => {
  const { fake, spoken, voiceRun, child } = await setup(t);
  fake.plan('elevenlabs', SPEAK, {}, { hang: true });
  const run = child();
  await fake.until('elevenlabs', SPEAK, 2);
  run.kill('SIGKILL');
  await once(run, 'close');
  await voiceRun({ fresh: true });
  assert.deepEqual(spoken(), [sentences[0], sentences[1], sentences[1], sentences[2], sentences[3]]);
});

test('moving a marker or changing shown text on a paid scene buys nothing', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  const before = await voiceRun();
  const edit = (from, to) => fs.writeFileSync(path.join(dir, 'script.md'), fs.readFileSync(path.join(dir, 'script.md'), 'utf8').replace(from, to));
  edit('here. [#mark] The', 'here. The [#mark]');
  const moved = await voiceRun();
  assert.notEqual(moved.first.hash, before.first.hash);
  assert.notEqual(moved.first.marks.mark, before.first.marks.mark);
  edit('{DNS|D N S}', '{The DNS|D N S}');
  const shown = await voiceRun();
  assert.equal(shown.second.words[0].text, 'The DNS');
  assert.deepEqual(spoken(), sentences);
});

test('a scene that only exists in build/voice is added when it is first seen, and its marker can move for free', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  // This is what a project from before the record looks like.
  fs.rmSync(historyDir(dir), { recursive: true });
  const old = readWav(voicePaths(loadProject(dir), 'first').wav).samples;
  fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES.replace('here. [#mark] The', 'here. The [#mark]').replace('{DNS|D N S}', '{The DNS|D N S}'));
  const after = await voiceRun();
  assert.deepEqual(spoken(), sentences, 'nothing is bought again');
  const added = listJobs(dir);
  assert.equal(added.length, 4);
  for (const job of added) {
    assert.equal(job.status, 'done');
    assert.equal(job.imported, true);
    assert.ok(fs.existsSync(path.join(dir, job.output.file)));
  }
  assert.equal(after.second.words[0].text, 'The DNS');
  // The rebuilt scene is the same audio, cut and joined again, within a millisecond per cut.
  const rebuilt = readWav(voicePaths(loadProject(dir), 'first').wav).samples;
  assert.ok(Math.abs(rebuilt.length - old.length) <= 2 * 24, `${rebuilt.length} and ${old.length}`);
  assert.ok(Math.abs(rebuilt.length / 24000 - after.first.duration) < 0.01);
  // And now that those pieces are saved, deleting build/ costs nothing either.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  await voiceRun();
  assert.deepEqual(spoken(), sentences);
});

test('an unchanged scene from before the record is added too, with its marker on either side of a pause', async (t) => {
  const script = '# Test\n## first\nThe first sentence is here. [pause 0.5] [#after] The second sentence is there.\n\n[#para] It answers fast.\n## silent\n## second\nD N S finds the address. [#before] [pause 0.5] It answers fast.\n';
  const { dir, spoken, voiceRun } = await setup(t, { script });
  await voiceRun();
  const bought = spoken().length;
  fs.rmSync(historyDir(dir), { recursive: true });
  await voiceRun();
  assert.equal(listJobs(dir).length, 4, 'one job per sentence, also when a sentence is said twice');
  assert.equal(spoken().length, bought);
  // A marker right after a pause and a marker right before one can each move.
  for (const [from, to] of [['[#after] The second', 'The [#after] second'], ['[#before] [pause 0.5] It', '[pause 0.5] [#before] It']]) {
    fs.rmSync(historyDir(dir), { recursive: true });
    fs.writeFileSync(path.join(dir, 'script.md'), script.replace(from, to));
    await voiceRun();
    assert.equal(spoken().length, bought, from);
    fs.rmSync(path.join(dir, 'build'), { recursive: true });
    await voiceRun();
    assert.equal(spoken().length, bought, from);
    // Back to where it started, with the scene files of the original script.
    fs.writeFileSync(path.join(dir, 'script.md'), script);
    await voiceRun();
  }
});

test('editing a sentence in a scene that only exists in build/voice buys only that sentence, and undoing it is free', async (t) => {
  for (const settings of [{}, { pace: 1.3 }]) {
    const { dir, spoken, voiceRun } = await setup(t, { settings });
    await voiceRun();
    fs.rmSync(historyDir(dir), { recursive: true });
    fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES.replace('It answers fast.', 'It answers very fast.').replace('[#mark] The', 'The [#mark]'));
    await voiceRun();
    assert.deepEqual(spoken(), [...sentences, 'It answers very fast.']);
    assert.deepEqual(listJobs(dir).filter((j) => j.imported).map((j) => j.request.text).toSorted(), sentences.toSorted());
    fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES);
    await voiceRun();
    assert.equal(spoken().length, 5);
  }
});

test('a scene with pauses and a sentence cut in two is still recognised when a word in it changes', async (t) => {
  const script = '# Test\n## first\nThe first [pause 0.4] sentence is here.\n\nIt answers fast. [pause 1] It answers again.\n## silent\n## second\n';
  const { dir, spoken, voiceRun } = await setup(t, { script });
  await voiceRun();
  const bought = spoken().length;
  fs.rmSync(historyDir(dir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.md'), script.replace('It answers again.', 'It answers once more.'));
  await voiceRun();
  assert.deepEqual(spoken(), [...spoken().slice(0, bought), 'It answers once more.']);
});

test('a sentence said twice in a scene from before the record is added once, and deleting build/ still costs nothing', async (t) => {
  const script = '# Test\n## first\nIt answers fast. Then it waits. It answers fast.\n## silent\n## second\n';
  const { dir, spoken, voiceRun } = await setup(t, { script });
  await voiceRun();
  const bought = spoken().length;
  assert.equal(bought, 2);
  fs.rmSync(historyDir(dir), { recursive: true });
  await voiceRun();
  assert.equal(listJobs(dir).length, 2);
  for (const job of listJobs(dir)) assert.equal(hashFile(path.join(dir, job.output.file)), job.output.sha256);
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  await voiceRun();
  assert.equal(spoken().length, bought);
});

test('a scene that can\'t be matched says so before it buys', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  fs.rmSync(historyDir(dir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'other-voice' } }));
  const said = [];
  await voiceRun({ notice: (m) => said.push([m, spoken().length]) });
  assert.equal(said.length, 2);
  assert.match(said[0][0], /voice first: the finished scene can't be matched/);
  assert.equal(said[0][1], 4, 'it says so before it buys');
  assert.equal(spoken().length, 8);
});

test('a refused --force leaves nothing that history would print and that would do nothing', async (t) => {
  const { dir, fake, spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nIt answers fast.\n## silent\n## second\n' });
  await voiceRun();
  fake.plan('elevenlabs', SPEAK, { status: 402, body: { detail: { status: 'quota_exceeded' } } });
  await assert.rejects(voiceRun({ force: true }), /no characters left/);
  assert.deepEqual(historyReport(dir).open, []);
  await voiceRun();
  assert.equal(spoken().length, 2);
});

test('a scene made with another voice, model or speed is not added under today\'s settings', async (t) => {
  for (const [settings, label] of [[{ voice: { provider: 'elevenlabs', id: 'other-voice' } }, 'voice'], [{ voice: { provider: 'elevenlabs', id: 'fake-voice', model: 'other-model' } }, 'model'], [{ speed: 0.8 }, 'speed']]) {
    const { dir, spoken, voiceRun } = await setup(t);
    await voiceRun();
    fs.rmSync(historyDir(dir), { recursive: true });
    const old = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...old, ...settings }));
    await voiceRun();
    assert.equal(spoken().length, sentences.length * 2, label);
    assert.ok(listJobs(dir).every((job) => !job.imported), label);
  }
});

test('deleting build/ builds the same scenes again with no purchase and no key', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  const first = await voiceRun();
  const wav = hashFile(voicePaths(loadProject(dir), 'second').wav);
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  setEnv(t, 'ELEVENLABS_API_KEY', '');
  const rebuilt = await voiceRun();
  assert.deepEqual(spoken(), sentences);
  assert.deepEqual(rebuilt.second.chunks, first.second.chunks);
  assert.equal(hashFile(voicePaths(loadProject(dir), 'second').wav), wav);
});

test('editing one sentence buys only that sentence', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES.replace('It answers fast.', 'It answers very fast.'));
  await voiceRun();
  assert.deepEqual(spoken(), [...sentences, 'It answers very fast.']);
  // The old sentence left the script, so nothing about it is open, and undoing the edit is free.
  assert.deepEqual(historyReport(loadProject(dir).dir).open, []);
  fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES);
  await voiceRun();
  assert.equal(spoken().length, 5);
});

test('a sentence that is said twice is bought once', async (t) => {
  const { spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nIt answers fast.\n## silent\n## second\nIt answers fast.\n' });
  await voiceRun();
  assert.deepEqual(spoken(), ['It answers fast.']);
});

test('--force says first that it buys again, makes a new attempt of each sentence, and the newest is used', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  const wav = hashFile(voicePaths(loadProject(dir), 'first').wav);
  const said = [];
  await voiceRun({
    force: true,
    notice: (m) => said.push([m, spoken().length]),
  });
  assert.equal(said.length, 1);
  assert.match(said[0][0], /--force .* buys 4 sentences again \(\d+ characters\)/);
  assert.equal(said[0][1], 4, 'it says so before the first purchase');
  assert.deepEqual(spoken(), [...sentences, ...sentences]);
  const jobs = listJobs(dir);
  assert.deepEqual(jobs.map((j) => j.attempt).toSorted(), [1, 1, 1, 1, 2, 2, 2, 2]);
  for (const job of jobs) assert.ok(fs.existsSync(path.join(dir, job.output.file)), job.output.file);
  assert.match(jobs.find((j) => j.attempt === 2).output.file, /\.2\.wav$/);
  const forced = hashFile(voicePaths(loadProject(dir), 'first').wav);
  assert.notEqual(forced, wav, 'the new take is in the scene');
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  await voiceRun();
  assert.equal(spoken().length, 8);
  assert.equal(hashFile(voicePaths(loadProject(dir), 'first').wav), forced, 'the newest attempt is the one used');
});

test('--force on a sentence said twice buys it once in that run', async (t) => {
  const { spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nIt answers fast.\n## silent\n## second\nIt answers fast.\n' });
  await voiceRun();
  await voiceRun({ force: true });
  assert.equal(spoken().length, 2);
});

test('a forced take that stops halfway: voice --new finishes it, and the newest take is in the scene', async (t) => {
  const { dir, fake, spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nThe first sentence is here. The second sentence is there.\n## silent\n## second\n' });
  await voiceRun();
  const first = hashFile(voicePaths(loadProject(dir), 'first').wav);
  fake.plan('elevenlabs', SPEAK, {}, { drop: true });
  await assert.rejects(voiceRun({ force: true }), /may have cost money/);
  assert.equal(spoken().length, 4);
  // The scene on disk is whole and current, so a normal run has nothing to do.
  await voiceRun();
  assert.equal(spoken().length, 4);
  assert.equal(hashFile(voicePaths(loadProject(dir), 'first').wav), first);
  const [open] = historyReport(dir).open;
  assert.equal(open.status, 'lost');
  assert.match(open.command, / voice .* --new$/);
  await voiceRun({ fresh: true });
  assert.equal(spoken().length, 5);
  assert.notEqual(hashFile(voicePaths(loadProject(dir), 'first').wav), first);
  assert.deepEqual(historyReport(dir).open, []);
});

test('a saved answer that was deleted or changed is never used, and --new buys only that one', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  const jobs = listJobs(dir);
  const gone = jobs.find((j) => j.request.text === sentences[1]);
  const changed = jobs.find((j) => j.request.text === sentences[2]);
  fs.rmSync(path.join(dir, gone.output.file));
  fs.appendFileSync(path.join(dir, changed.output.file), 'x');
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  await assert.rejects(voiceRun(), (e) => {
    assert.match(e.message, /2 paid sentences/);
    assert.match(e.message, /It was bought on .* is gone/);
    assert.match(e.message, /It was bought on .* has changed/);
    assert.match(e.message, /--new/);
    return true;
  });
  assert.equal(spoken().length, 4);
  assert.equal(historyReport(dir, { needed: () => true }).open.length, 2);
  await voiceRun({ fresh: true });
  assert.deepEqual(spoken().slice(4), [sentences[1], sentences[2]]);
  assert.deepEqual(historyReport(dir, { needed: () => true }).open, []);
});

test('a refusal costs nothing, so the next run goes on without --new and keeps what it has', async (t) => {
  const { dir, fake, spoken, voiceRun } = await setup(t);
  fake.plan('elevenlabs', SPEAK, {}, { status: 402, body: { detail: { status: 'quota_exceeded' } } });
  await assert.rejects(voiceRun(), (e) => {
    assert.match(e.message, /no characters left/);
    assert.doesNotMatch(e.message, /--new/);
    return true;
  });
  assert.equal(listJobs(dir).find((j) => j.request.text === sentences[1]).status, 'refused');
  await voiceRun();
  assert.deepEqual(spoken(), [sentences[0], sentences[1], sentences[1], sentences[2], sentences[3]]);
  assert.deepEqual(historyReport(dir).open, []);
});

test('a dropped connection and a server that keeps failing both stop the voice until --new', async (t) => {
  for (const [steps, status] of [[[{ drop: true }], 'lost'], [[{ status: 500 }, { status: 500 }, { status: 500 }], 'failed']]) {
    const { dir, fake, spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nIt answers fast.\n## silent\n## second\n' });
    fake.plan('elevenlabs', SPEAK, ...steps);
    await assert.rejects(voiceRun(), /may have cost money.*voice .* --new/s);
    assert.equal(listJobs(dir)[0].status, status);
    const count = spoken().length;
    await assert.rejects(voiceRun(), /nothing more was bought/);
    assert.equal(spoken().length, count);
    await voiceRun({ fresh: true });
    assert.equal(spoken().length, count + 1);
    assert.equal(listJobs(dir).at(-1).status, 'done');
  }
});

test('two voice runs at once buy each sentence once', async (t) => {
  const { fake, spoken, voiceRun } = await setup(t, { script: '# Test\n## first\nIt answers fast.\n## silent\n## second\n' });
  fake.plan('elevenlabs', SPEAK, { delay: 300 });
  const results = await Promise.allSettled([voiceRun(), voiceRun()]);
  assert.deepEqual(results.map((r) => r.status).toSorted(), ['fulfilled', 'rejected']);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /Another run may still be working on it/);
  assert.equal(spoken().length, 1);
});

test('a damaged scene in build/voice is not added to the record, and it is made again without trouble', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  await voiceRun();
  const files = voicePaths(loadProject(dir), 'first');
  const scene = JSON.parse(fs.readFileSync(files.json, 'utf8'));
  // Out of date with an unreadable WAV, and then with JSON that lacks its words.
  fs.rmSync(historyDir(dir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.md'), FOUR_SENTENCES.replace('here. [#mark] The', 'here. The [#mark]'));
  fs.writeFileSync(files.wav, 'not a wav file');
  await voiceRun();
  assert.deepEqual(spoken().slice(4, 6), sentences.slice(0, 2));
  fs.rmSync(historyDir(dir), { recursive: true });
  fs.writeFileSync(files.json, JSON.stringify({ hash: 'old', chunks: scene.chunks }));
  await voiceRun();
  assert.deepEqual(spoken().slice(6), sentences.slice(0, 2));
});

test('without a key nothing is recorded, and a sentence that needs buying says how to connect', async (t) => {
  const { dir, spoken, voiceRun } = await setup(t);
  setEnv(t, 'ELEVENLABS_API_KEY', '');
  // A .env in a source checkout may hold a real key, and that one would win.
  if (fs.existsSync(new URL('../.env', import.meta.url))) return;
  await assert.rejects(voiceRun(), /explainroo connect elevenlabs/);
  assert.deepEqual(spoken(), []);
  assert.deepEqual(listJobs(dir), []);
});

test('free voices use none of this', async (t) => {
  const { dir, voiceRun } = await setup(t, { voice: 'af_heart', script: '# Test\n## first\n## silent\n## second\n' });
  await voiceRun();
  const recorded = await setup(t, { voice: { provider: 'recording', src: 'assets/take' }, script: '# Test\n## first\n## silent\n## second\n' });
  fs.mkdirSync(path.join(recorded.dir, 'assets/take'));
  await recorded.voiceRun();
  assert.equal(fs.existsSync(historyDir(dir)), false);
  assert.equal(fs.existsSync(historyDir(recorded.dir)), false);
});

test('the speech key follows provider, voice, model, speed and spoken text, and nothing else', () => {
  const paid = findConnector('elevenlabs');
  const config = normalizeConfig({ voice: { provider: 'elevenlabs', id: 'v' } });
  const key = speechKey(paid, config, 'Hello there.');
  assert.equal(key, speechKey(paid, normalizeConfig({ voice: { provider: 'elevenlabs', id: 'v' }, sentenceGap: 2, captions: true }), 'Hello there.'));
  assert.notEqual(key, speechKey(paid, config, 'Hello.'));
  assert.notEqual(key, speechKey(paid, { ...config, voice: { ...config.voice, id: 'w' } }, 'Hello there.'));
  assert.notEqual(key, speechKey(paid, { ...config, voice: { ...config.voice, model: 'm' } }, 'Hello there.'));
  assert.notEqual(key, speechKey(paid, { ...config, speed: 0.8 }, 'Hello there.'));
  assert.notEqual(key, speechKey({ ...paid, id: 'made-up' }, config, 'Hello there.'));
  // Speeds above the limit are sent as the same speed, so they are the same request.
  assert.equal(speechKey(paid, { ...config, speed: 1.3 }, 'Hello there.'), speechKey(paid, { ...config, speed: 1.4 }, 'Hello there.'));
});

// If these change, every existing project makes its narration again. The values
// come from the code before the record existed.
test('scene hashes stay as they are, for free and for paid voices', () => {
  const scene = parseScript('## first\n[#a] Hello. {DNS|D N S} works.\n').scenes[0];
  const chunks = speechChunks(scene.units);
  assert.equal(sceneHash(scene, chunks, normalizeConfig({})), 'e9d7b6e0c2a3aaee');
  assert.equal(sceneHash(scene, chunks, normalizeConfig({ voice: { provider: 'elevenlabs', id: 'v' } })), '149fab7762d73405');
  assert.equal(sceneHash(scene, chunks, normalizeConfig({ voice: { model: 'm', provider: 'elevenlabs', id: 'v' }, pace: 1.3 })), '1eb172daf3289789');
});

const cached = [TTS_MODEL, ASR_MODEL].every((m) => fs.existsSync(path.join(cacheRoot(), 'models', m)));

test('the real command line stops on an unclear request, history prints the command, and it works as printed', { skip: !cached && 'speech models not downloaded' }, async (t) => {
  const { dir, fake, spoken } = await setup(t, { script: '# Test\n## first\nThe first sentence is here. The second sentence is there.\n## silent\n## second\n' });
  const env = { ...process.env, ...fake.env };
  const cli = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { out.stdout += d; });
    child.stderr.on('data', (d) => { out.stderr += d; });
    child.on('close', (code) => resolve({ ...out, code, child }));
  });
  fake.plan('elevenlabs', SPEAK, {}, { hang: true });
  const killed = spawn(process.execPath, [bin, 'voice', dir], { env, stdio: 'ignore' });
  await fake.until('elevenlabs', SPEAK, 2);
  killed.kill('SIGKILL');
  await once(killed, 'close');

  const stopped = await cli('voice', dir);
  assert.equal(stopped.code, 1);
  assert.match(stopped.stderr, /nothing more was bought/);
  assert.equal(spoken().length, 2);
  const history = JSON.parse((await cli('history', dir, '--json')).stdout);
  assert.equal(history.open.length, 1);
  assert.match(history.open[0].command, / voice .* --new$/);
  const printed = spawn(history.open[0].command, { shell: true, env, stdio: 'ignore' });
  assert.equal((await once(printed, 'close'))[0], 0);
  assert.equal(spoken().length, 3);

  const done = JSON.parse((await cli('voice', dir, '--json')).stdout);
  assert.equal(done.characters, 0);
  assert.ok(done.duration > 0);
  assert.deepEqual(JSON.parse((await cli('history', dir, '--json')).stdout).open, []);
  assert.equal(spoken().length, 3);

  const forced = await cli('voice', dir, '--force', '--json');
  assert.equal(forced.code, 0, forced.stderr);
  assert.match(forced.stderr, /--force .* buys 2 sentences again/);
  assert.equal(JSON.parse(forced.stdout).characters, sentences.slice(0, 2).join('').length);
  assert.equal(spoken().length, 5);
});
