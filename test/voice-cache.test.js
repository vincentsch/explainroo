// What voice keeps and what it makes again: a moved marker keeps the narration,
// an older scene gets today's speech check from its transcript, and a long scene
// says which step it is on. Before it makes speech, voice estimates the length.
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

// The change from a product demo that seemed to make the narration again: two
// markers moved from the start of their sentences to inside them. The voice
// run there kept the narration; the 100 s it reported was the first run.
test('markers that move from the start of a sentence into it keep the narration', async (t) => {
  const sentences = ['Curious how it sounds?', 'Ten example tracks come with it.', 'And on Explore, you can hear what people made.'];
  const { dir, spoken } = await paidProject(t, `# Test\n\n## intro\n[#listen] Curious how it sounds? [#play] Ten example tracks come with it. [#explore] And on Explore, you can hear what people made.\n\n## outro\nThat is all.\n`);
  await synthesize(loadProject(dir), { transcribe: echo([...sentences, 'That is all.']) });
  assert.equal(spoken(), 4);
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'build/voice/intro.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\n[#listen] Curious how it sounds? Ten example tracks [#play] come with it. And on [#explore] Explore, you can hear what people made.\n\n## outro\nThat is all.\n');
  const lines = [];
  const voices = await synthesize(loadProject(dir), { transcribe: noSpeech, log: (line) => lines.push(line) });
  assert.equal(spoken(), 4, 'no new speech');
  assert.deepEqual(lines, ['voice intro: kept the narration, updated the cues']);
  const start = (text) => before.words.find((w) => w.text === text).start;
  assert.deepEqual([voices.intro.marks.play, voices.intro.marks.explore], [start('come'), start('Explore,')]);
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

test('an older scene gets the speech check of today from its transcript once, without new speech, and the result is saved', async (t) => {
  const { dir, files } = olderProject(t, '# Test\n\n## intro\nIt contains a harmless piece of the virus, and {tabslip.com|tab slip dot com} sells it.\n', {
    transcript: 'It contains a harmless peace of the virus, and tabslip.com sells it.', unmatched: ['piece', 'tabslip.com'], matchRate: 0.786,
  });
  const before = fs.readFileSync(files.json, 'utf8');
  const voices = await synthesize(loadProject(dir), { transcribe: noSpeech });
  assert.equal(voices.intro.matchRate, 1);
  assert.deepEqual(voices.intro.unmatched, []);
  assert.ok(voices.intro.words.every((w) => w.matched));
  assert.deepEqual(voices.intro.nearly, [{ word: 'piece', heard: 'peace', alike: true }]);
  // Saved once with today's rules and the old times, so the next command takes it as it is.
  const saved = JSON.parse(fs.readFileSync(files.json, 'utf8'));
  assert.deepEqual([saved.check, saved.matchRate, saved.unmatched, saved.hash], [3, 1, [], JSON.parse(before).hash]);
  assert.deepEqual(saved.words.map((w) => [w.start, w.end]), JSON.parse(before).words.map((w) => [w.start, w.end]));
  const after = fs.readFileSync(files.json, 'utf8');
  await synthesize(loadProject(dir), { transcribe: noSpeech });
  assert.equal(fs.readFileSync(files.json, 'utf8'), after, 'nothing to save the second time');
  // The list keeps the order of the script, with words confirmed then and now.
  const merge = olderProject(t, '# Test\n\n## intro\nA merge adds one commit.\n', { transcript: 'Emerge adds one commit.', unmatched: ['A'], matchRate: 0.8 });
  const reviewed = (await synthesize(loadProject(merge.dir), { transcribe: noSpeech })).intro;
  assert.deepEqual(reviewed.nearly, [{ word: 'A', heard: 'Emerge', joined: true }, { word: 'merge', heard: 'Emerge', joined: true }]);
  // A scene checked with today's rules is taken as it is.
  const today = { ...JSON.parse(before), check: 3 };
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

test('a long scene says the step it is on, a line per step in the order they run, and in a terminal one line that changes', async (t) => {
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
  const order = ['making speech', 'timing words', 'checking speech'];
  const steps = lines.flatMap((line) => {
    const m = /^voice scene 1\/1 intro: (making speech|timing words|checking speech), sentence (\d) of 2$/.exec(line);
    return m ? [Number(m[2]) * 10 + order.indexOf(m[1])] : [];
  });
  assert.ok(steps.length >= 2, lines.join('\n'));
  // Each step of each sentence once, in the order they run.
  assert.deepEqual(steps, [...new Set(steps)].sort((a, b) => a - b), lines.join('\n'));
  assert.ok(!lines.some((line) => /^voice scene 1\/1 intro: (making speech|timing words|checking speech)$/.test(line)), lines.join('\n'));
  assert.match(lines.at(-1), /^voice scene 1\/1 intro: .* of narration .*made in \d+\.\d s$/);
  // A terminal gets one line that names the sentence too.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  const updates = [];
  const log = (line) => lines.push(line);
  log.update = (line) => updates.push(line);
  await synthesize(loadProject(dir), { transcribe: slow(['One sentence here.', 'Two sentences there.']), log });
  assert.ok(updates.some((u) => /^voice scene 1\/1 intro: (making speech|timing words|checking speech), sentence 2 of 2$/.test(u)), updates.join('\n'));
  // A quick scene says nothing about its steps.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  lines.length = 0;
  await synthesize(loadProject(dir), { transcribe: echo(['One sentence here.', 'Two sentences there.']), log: (line) => lines.push(line) });
  assert.ok(!lines.some((line) => /making speech|timing words|checking speech/.test(line)), lines.join('\n'));
});

test('each scene line of voice starts with its number out of the scenes it makes, and says the time left after each but the last', async (t) => {
  const { dir } = await paidProject(t, '# Test\n\n## intro\nOne sentence here.\n\n## middle\nTwo sentences there, and more.\n\n## silent {min=2}\n\n## outro\nThat is all.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {}, middle() {}, silent() {}, outro() {} };');
  const lines = [];
  await synthesize(loadProject(dir), { transcribe: echo(['One sentence here.', 'Two sentences there, and more.', 'That is all.']), log: (line) => lines.push(line) });
  const scenes = lines.filter((line) => / of narration /.test(line));
  assert.equal(scenes.length, 3, lines.join('\n'));
  assert.match(scenes[0], /^voice scene 1\/3 intro: .* made in \d+\.\d s, about \d+ s left$/);
  assert.match(scenes[1], /^voice scene 2\/3 middle: .* made in \d+\.\d s, about \d+ s left$/);
  assert.match(scenes[2], /^voice scene 3\/3 outro: .* made in \d+\.\d s$/);
  // Only the scenes it makes count, so a scene made again alone is 1/1.
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\nOne sentence here.\n\n## middle\nTwo sentences there, and more.\n\n## silent {min=2}\n\n## outro\nThat is all now.\n');
  lines.length = 0;
  await synthesize(loadProject(dir), { transcribe: echo(['That is all now.']), log: (line) => lines.push(line) });
  assert.deepEqual(lines.filter((line) => / of narration /.test(line)).map((line) => line.split(':')[0]), ['voice scene 1/1 outro']);
});

test('a wait is said the way a person says it', async () => {
  const { roughTime } = await import('../src/timeline.js');
  assert.deepEqual([0.4, 12, 44, 59, 64, 100, 125.5].map(roughTime), ['5 s', '10 s', '45 s', '1 min', '1 min', '1 min 40 s', '2 min 10 s']);
});

test('before it makes speech, voice says how long the video will be about, and it says nothing when the narration is there', async (t) => {
  const { dir } = await paidProject(t, '# Test\n\n## intro\nOne sentence here. Two sentences there.\n\n## outro {min=4}\n');
  const lines = [];
  const seen = [];
  await synthesize(loadProject(dir), { transcribe: echo([]), log: (line) => lines.push(line), onEstimate: (e) => seen.push(e) });
  assert.match(lines[0], /^voice: about \d+ s \(\d+ to \d+ s\): 6 words of speech at about \d+ a minute take \d+\.\d s\. The scene adds [\d.]+ s for its lead and hold, and the pauses between sentences add 0\.3 s\. The end of the video adds 1\.4 s\. Scenes with a min, or without narration, add 4\.0 s more\.$/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].words, 6);
  lines.length = 0;
  await synthesize(loadProject(dir), { transcribe: noSpeech, log: (line) => lines.push(line), onEstimate: (e) => seen.push(e) });
  assert.deepEqual(lines, []);
  assert.equal(seen.length, 1);
  // The voice command gives the estimate in its JSON.
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  assert.equal(await main(['voice', dir, '--json']), 0);
  assert.equal(JSON.parse(output).estimate.words, 6);
});

test('voice says what targetSeconds did, and how far over a longer video runs', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  t.mock.method(process.stderr, 'write', () => true);
  const short = tinyProject(t, { targetSeconds: 3 });
  assert.equal(await main(['voice', short]), 0);
  assert.match(output, /total 3\.0s \(targetSeconds 3 from video\.json, which added 2\.0 s to the hold of each scene\)$/m);
  output = '';
  assert.equal(await main(['voice', short, '--json']), 0);
  assert.deepEqual(JSON.parse(output).target, { seconds: 3, natural: 1, added: 2, from: 'top' });
  // A size takes the target at the top unless its block sets its own, or null.
  fs.writeFileSync(path.join(short, 'video.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(short, 'video.json'), 'utf8')), sizes: { tiktok: { targetSeconds: 4 }, reels: { targetSeconds: null } } }));
  const { seedNarration } = await import('./helpers/tiny-project.js');
  for (const [size, line] of [['shorts', /total 3\.0s \(targetSeconds 3 from video\.json, which added 2\.0 s/], ['tiktok', /total 4\.0s \(targetSeconds 4 from the tiktok block in "sizes", which added 3\.0 s/], ['reels', /total 1\.0s \(no targetSeconds: the reels block in "sizes" turns it off\)$/m]]) {
    seedNarration(loadProject(short, { size }));
    output = '';
    assert.equal(await main(['voice', short, '--size', size]), 0, size);
    assert.match(output, line, size);
  }
  // A tiny video can't be shorter than its scene, so a target of 1 second over a 2 second scene is over.
  const long = tinyProject(t, { targetSeconds: 1 });
  fs.writeFileSync(path.join(long, 'script.md'), '# Tiny video\n\n## intro {min=2 chapter="Intro"}\n');
  output = '';
  assert.equal(await main(['voice', long]), 0);
  assert.match(output, /^WARN  the video runs 2\.0 s, 1\.0 s over targetSeconds 1\. The longest scene is intro \(2\.0 s\)\.$/m);
});

test('voice says what it heard for each word it could not confirm, with the quote check gives and the advice that fits, also in JSON', async (t) => {
  const { dir } = olderProject(t, '# Test\n\n## intro\nPublish it on {soundroo.com|sound roo dot com} and put the link over there today.\n', {
    transcript: 'Publish it on Soundray.com and put the link over then today.', unmatched: ['soundroo.com', 'there'], matchRate: 0.8,
  });
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  t.mock.method(process.stderr, 'write', () => true);
  assert.equal(await main(['voice', dir]), 0);
  assert.match(output, /intro .* confirmed {2}unconfirmed: soundroo\.com, there\n/);
  assert.match(output, /^ {2}"soundroo\.com": it heard "Publish it on Soundray\.com and put the link…"\. \{soundroo\.com\|sound roo dot com\} was heard as "Soundray\.com", so the override didn't help\. Try a different spoken spelling, like \{soundroo\.com\|another spelling\}, or reword the sentence\.$/m);
  assert.match(output, /^ {2}"there": it heard "…put the link over then today\."\. If the voice says it wrong, write it as \{there\|spoken spelling\} in script\.md\. If it is said right and only heard wrong, reword the sentence\.$/m);
  output = '';
  assert.equal(await main(['voice', dir, '--json']), 0);
  const [row] = JSON.parse(output).scenes;
  assert.deepEqual(row.heard.map((u) => [u.word, u.heard]), [['soundroo.com', 'Soundray.com'], ['there', 'then']]);
  assert.equal(row.heard[1].quote, '"…put the link over then today."');
  assert.match(row.heard[1].advice, /^If the voice says it wrong/);
  // A word heard as a word that may sound the same, in a language whose sounds can't be compared.
  const { unconfirmedWords } = await import('../src/qa.js');
  const german = olderProject(t, '# Test\n\n## intro\nDas Rad dreht sich.\n', { transcript: 'Das Rat dreht sich.', unmatched: ['Rad'], matchRate: 0.75 });
  fs.writeFileSync(path.join(german.dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, lead: 0, hold: 0, end: 0, language: 'de', voice: { provider: 'elevenlabs', id: 'x' } }));
  const v = JSON.parse(fs.readFileSync(german.files.json, 'utf8'));
  assert.match(unconfirmedWords(loadProject(german.dir), v)[0].advice, /^"Rat" may sound the same, and in this language the speech check can't compare sounds, so \{shown\|spoken\} can't help\. Reword the sentence\.$/);
  // A short, common word has no better spelling, so the advice is to reword.
  const its = olderProject(t, '# Test\n\n## intro\nTides slow the planet down and its spin wobbles.\n', { transcript: 'Tides slow the planet down and it spin wobbles.', unmatched: ['its'], matchRate: 0.89 });
  const [word] = unconfirmedWords(loadProject(its.dir), JSON.parse(fs.readFileSync(its.files.json, 'utf8')));
  assert.deepEqual([word.word, word.quote], ['its', '"…the planet down and it spin wobbles."']);
  assert.equal(word.advice, '"its" is a short, common word, so a spelling hint can\'t change how it sounds. Reword the sentence.');
});

test('a short, common word is one that a spelling hint can\'t change, and an acronym or a longer word is not', async () => {
  const { shortWord } = await import('../src/qa.js');
  for (const word of ['its', 'Its', "it's", 'the', 'a', 'and,', 'then', 'Bob']) assert.equal(shortWord(word), true, word);
  for (const word of ['AI', 'SQL', 'Then', 'there', '1972', 'tides', '']) assert.equal(shortWord(word), false, word);
});
