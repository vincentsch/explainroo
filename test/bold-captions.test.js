// Bold captions: *stars* in the script mark keywords, the parser takes them off
// before the voice or the captions see them, and the engine shows two to four
// big words at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseScript, speechChunks, tokenizeNarration } from '../src/script.js';
import { loadProject, normalizeConfig, ProjectError } from '../src/project.js';
import { sceneHash, synthesize } from '../src/voice.js';
import { buildTimeline } from '../src/timeline.js';
import { subtitleCues, toSrt } from '../src/subtitles.js';
import { BOLD_CAPTION_FAMILIES, boldCaptionFont, boldChunks, boldText, buildChunks, buildPhrases, isKeyword } from '../engine/captions.js';
import { LANGUAGE_FONTS, fontString, getTheme } from '../engine/themes.js';
import { layoutAreas } from '../engine/layout.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const words = (text, language) => tokenizeNarration(text, 0, language).filter((u) => u.type === 'word').map((u) => ({ display: u.display, spoken: u.spoken, ...(u.key ? { key: true } : {}) }));

test('stars come off the shown and the spoken word, which gets a keyword flag', () => {
  assert.deepEqual(words('Bread needs *four* things.'), [
    { display: 'Bread', spoken: 'Bread' }, { display: 'needs', spoken: 'needs' }, { display: 'four', spoken: 'four', key: true }, { display: 'things.', spoken: 'things.' },
  ]);
  assert.deepEqual(words('*Not one, but two* loaves.').map((w) => [w.display, !!w.key]), [['Not', true], ['one,', true], ['but', true], ['two', true], ['loaves.', false]]);
  assert.deepEqual(words('It costs *$2.50*, not more.')[2], { display: '$2.50,', spoken: '$2.50,', key: true });
  assert.deepEqual(words('(*Really*) good.')[0], { display: '(Really)', spoken: '(Really)', key: true });
  assert.deepEqual(words('A *{SQL|sequel}* query.')[1], { display: 'SQL', spoken: 'sequel', key: true });
  assert.deepEqual(words('A {*SQL*|sequel} query.')[1], { display: 'SQL', spoken: 'sequel', key: true });
  assert.deepEqual(words('**Bold** words')[0], { display: 'Bold', spoken: 'Bold', key: true });
  assert.deepEqual(words('これは*重要*です', 'ja').map((w) => [w.display, !!w.key]), [['これ', false], ['は', false], ['重要', true], ['です', false]]);
});

test('in Japanese and Chinese a star next to punctuation or a bracket still comes off', () => {
  for (const [starred, plain, language, key] of [
    ['我们去*北京*。', '我们去北京。', 'zh', '北京。'],
    ['これは「*東京*」です。', 'これは「東京」です。', 'ja', '「東京」'],
    ['*重要*です。', '重要です。', 'ja', '重要'],
  ]) {
    const a = parseScript(`## x\n${starred}\n`, { language }).scenes[0];
    const b = parseScript(`## x\n${plain}\n`, { language }).scenes[0];
    assert.equal(a.text, b.text, starred);
    assert.equal(a.spoken, b.spoken, starred);
    assert.deepEqual(a.units.map((u) => u.space), b.units.map((u) => u.space), starred);
    assert.deepEqual(a.units.filter((u) => u.key).map((u) => u.display), [key], starred);
  }
});

test('of two opening stars the later one counts, so a stray star never swallows a keyword', () => {
  assert.deepEqual(words('*Note: prices vary. Then *key* word.').map((w) => [w.display, w.spoken, !!w.key]), [
    ['*Note:', '*Note:', false], ['prices', 'prices', false], ['vary.', 'vary.', false], ['Then', 'Then', false], ['key', 'key', true], ['word.', 'word.', false],
  ]);
});

test('a star that opens or closes nothing stays as it is', () => {
  for (const [text, shown] of [
    ['2 * 3 is six.', ['2', '*', '3', 'is', 'six.']],
    ['Terms apply.*', ['Terms', 'apply.*']],
    ['*Open but never closed.', ['*Open', 'but', 'never', 'closed.']],
    ['a*b stays', ['a*b', 'stays']],
    ['Note (*) here', ['Note', '(*)', 'here']],
  ]) {
    const list = words(text);
    assert.deepEqual(list.map((w) => w.display), shown, text);
    assert.ok(list.every((w) => !w.key), text);
  }
});

test('a script with stars speaks, hashes and subtitles exactly like the same script without them', () => {
  const plain = parseScript('## intro\nBread needs four things. [#flour] Flour comes first.\n');
  const starred = parseScript('## intro\nBread needs *four things*. [#flour] *Flour* comes first.\n');
  const config = normalizeConfig({});
  const [a] = plain.scenes;
  const [b] = starred.scenes;
  assert.equal(b.text, a.text);
  assert.equal(b.spoken, a.spoken);
  assert.deepEqual(speechChunks(b.units, config).map((c) => c.text), speechChunks(a.units, config).map((c) => c.text));
  assert.equal(sceneHash(b, speechChunks(b.units, config), config), sceneHash(a, speechChunks(a.units, config), config));
  // The voice cache of the plain script works for the starred one, and the keywords come from the script.
  const cached = { duration: 2, words: a.units.filter((u) => u.type === 'word').map((u, i) => ({ text: u.display, start: i * 0.3, end: i * 0.3 + 0.25 })), marks: {}, chunks: [] };
  const project = (script) => ({ dir: '/tmp/x', config: { ...config, lead: 0 }, script });
  const timeline = buildTimeline(project(starred), { intro: cached });
  assert.deepEqual(timeline.scenes[0].words.filter((w) => w.key).map((w) => w.text), ['four', 'things.', 'Flour']);
  assert.deepEqual(buildTimeline(project(plain), { intro: cached }).scenes[0].words.filter((w) => w.key), []);
  assert.equal(toSrt(subtitleCues(timeline)), toSrt(subtitleCues(buildTimeline(project(plain), { intro: cached }))));
  assert.doesNotMatch(toSrt(subtitleCues(timeline)), /\*/);
  // A cached word that no longer matches the script gets no keyword by mistake.
  const shifted = { ...cached, words: [{ text: 'Other', start: 0, end: 0.2 }, ...cached.words.slice(1)] };
  assert.deepEqual(buildTimeline(project(parseScript('## intro\n*Bread* needs four things.\n')), { intro: shifted }).scenes[0].words.filter((w) => w.key), []);
});

test('chunks hold two to four words, never cross a sentence end or a long pause, and leave no lonely last word', () => {
  let t = 0;
  const timed = (text, pauseAfter = []) => text.split(' ').map((w, i) => {
    const word = { text: w, start: t, end: t + 0.25 };
    t += 0.3 + (pauseAfter.includes(i) ? 0.5 : 0);
    return word;
  });
  const chunks = boldChunks(timed('Bread needs four things, and the first one is flour from a mill. Then water. Yes.'));
  assert.deepEqual(chunks.map((c) => c.words.map((w) => w.text).join(' ')), ['Bread needs four', 'things, and the', 'first one is flour', 'from a mill.', 'Then water.', 'Yes.']);
  for (const c of chunks) assert.ok(c.words.length <= 4);
  chunks.forEach((c, i) => {
    assert.equal(c.start, c.words[0].start);
    if (chunks[i + 1]) assert.ok(c.until <= chunks[i + 1].start);
  });
  t = 0;
  assert.deepEqual(boldChunks(timed('We mix the dough and wait', [2])).map((c) => c.words.map((w) => w.text).join(' ')), ['We mix the', 'dough and wait']);
  // A lonely last word borrows one from a chunk of three or four, and joins a chunk of two.
  t = 0;
  assert.deepEqual(boldChunks(timed('We go to the shop.')).map((c) => c.words.map((w) => w.text).join(' ')), ['We go to', 'the shop.']);
  t = 0;
  assert.deepEqual(boldChunks(timed('Bake it, now.')).map((c) => c.words.map((w) => w.text).join(' ')), ['Bake it, now.']);
  t = 0;
  assert.deepEqual(boldChunks(timed('Bake it, then rest.')).map((c) => c.words.map((w) => w.text).join(' ')), ['Bake it,', 'then rest.']);
  t = 0;
  assert.deepEqual(boldChunks(timed('Yes.')).map((c) => c.words.length), [1]);
});

test('numbers, money and starred words are keywords, and a caption drops a comma or period after a word', () => {
  for (const [word, key] of [[{ text: '42' }, true], [{ text: '$3' }, true], [{ text: '€9,50' }, true], [{ text: '१२' }, true], [{ text: 'flour' }, false], [{ text: 'flour', key: true }, true]]) assert.equal(isKeyword(word), key, word.text);
  assert.deepEqual(['mill.', 'things,', 'Why?', '"Done."', '$2.50'].map(boldText), ['mill', 'things', 'Why?', '"Done"', '$2.50']);
  const timeline = { scenes: [{ start: 10, words: [{ text: 'Bread', start: 0, end: 0.2, key: true }, { text: 'rises.', start: 0.3, end: 0.5 }] }] };
  assert.deepEqual(buildChunks(timeline).map((c) => c.words.map((w) => [w.text, w.key, w.start])), [[['Bread', true, 10], ['rises.', false, 10.3]]]);
  assert.deepEqual(buildPhrases(timeline, 40)[0].words.map((w) => w.text), ['Bread', 'rises.']);
});

test('bold captions name the fonts explainroo brings for Hindi, Japanese and Chinese, as every look font does', () => {
  // The look fonts keep the exact font names they always had.
  assert.equal(fontString(getTheme('clean'), 'body', 48), '400 48px "Inter", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", sans-serif');
  assert.equal(fontString(getTheme('paper'), 'mono', 31.333), '400 31.33px "JetBrains Mono", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", monospace');
  assert.equal(boldCaptionFont(74), '900 74px "Inter", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", sans-serif');
  assert.deepEqual(BOLD_CAPTION_FAMILIES, ['Inter', ...LANGUAGE_FONTS]);
});

test('"captions": "bold" is a setting of its own, and Japanese and Chinese refuse it with a clear message', () => {
  assert.equal(normalizeConfig({ captions: 'bold' }).captions, 'bold');
  assert.equal(normalizeConfig({ captions: 'bold', size: 'youtube' }).captions, 'bold');
  assert.throws(() => normalizeConfig({ captions: 'big' }), /captions must be true, false, "auto" or "bold"/);
  for (const language of ['ja', 'zh']) {
    assert.throws(() => normalizeConfig({ language, captions: 'bold' }), (e) => e instanceof ProjectError && /does not work for (Japanese|Chinese), whose words have no spaces/.test(e.message) && /Use "captions": true\.$/.test(e.message));
  }
  // Another language of the video can turn them off for itself.
  assert.throws(() => normalizeConfig({ captions: 'bold', languages: { ja: {} } }), /languages\.ja: "captions": "bold" does not work for Japanese/);
  assert.equal(normalizeConfig({ captions: 'bold', languages: { ja: { captions: true } } }, '.', { language: 'ja' }).captions, true);
  assert.throws(() => normalizeConfig({ captions: 'bold' }, '.', { language: 'zh' }), /add "languages": \{ "zh": \{ "captions": true \} \} to video\.json/);
});

test('bold captions get a band of their own, and the content area ends above it', () => {
  for (const size of ['tiktok', 'shorts', 'reels', '9:16', 'youtube', 'square', 'linkedin']) {
    const config = normalizeConfig({ size, captions: 'bold' });
    const { safe, captions, band } = layoutAreas(config, config.width, config.height);
    const phrases = layoutAreas({ ...config, captions: true }, config.width, config.height);
    assert.ok(band.bottom - band.top < phrases.band.bottom - phrases.band.top, size);
    assert.ok(captions.cy > band.top && captions.cy < band.bottom, size);
    assert.ok(safe.bottom <= band.top - 24, size);
    if (config.safe) assert.ok(band.bottom <= layoutAreas({ ...config, captions: false }, config.width, config.height).app.bottom, size);
  }
});

test('a star added to a script whose paid narration is saved buys nothing, from build/ or from history/', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-stars-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of [['EXPLAINROO_ELEVENLABS_URL', fake.env.EXPLAINROO_ELEVENLABS_URL], ['ELEVENLABS_API_KEY', GOOD_KEY]]) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
  }
  t.mock.method(process.stderr, 'write', () => true);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'fake-voice' }, captions: 'bold', size: 'tiktok' }));
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  const script = (text) => fs.writeFileSync(path.join(dir, 'script.md'), `## intro\n${text}\n`);
  const noWords = async () => ({ text: '', words: [] });
  const run = async () => {
    const project = loadProject(dir);
    return buildTimeline(project, await synthesize(project, { transcribe: noWords }));
  };
  const bought = () => fake.count('elevenlabs', 'POST /v1/text-to-speech/*');
  script('Bread needs four things. Flour comes first.');
  const plain = await run();
  assert.equal(bought(), 2);
  script('Bread needs *four* things. *Flour* comes first.');
  const starred = await run();
  assert.equal(bought(), 2, 'adding stars bought nothing');
  assert.deepEqual(starred.scenes[0].words.filter((w) => w.key).map((w) => w.text), ['four', 'Flour']);
  assert.deepEqual(starred.scenes[0].words.map((w) => [w.text, w.start, w.end]), plain.scenes[0].words.map((w) => [w.text, w.start, w.end]));
  assert.deepEqual(fake.requests('elevenlabs', 'POST /v1/text-to-speech/*').map((r) => r.body.text), ['Bread needs four things.', 'Flour comes first.']);
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  const rebuilt = await run();
  assert.equal(bought(), 2, 'rebuilding from history/voice/ bought nothing');
  assert.deepEqual(rebuilt.scenes[0].words.filter((w) => w.key).map((w) => w.text), ['four', 'Flour']);
  script('Bread needs four things. Flour comes first.');
  assert.deepEqual((await run()).scenes[0].words.filter((w) => w.key), []);
  assert.equal(bought(), 2, 'removing stars bought nothing');
});
