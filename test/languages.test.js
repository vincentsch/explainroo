import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { normWord, parseScript, speechChunks, tokenizeNarration } from '../src/script.js';
import { normWord as browserNorm } from '../engine/util.js';
import { alignWords, expand } from '../src/align.js';
import { normalizeConfig, ProjectError } from '../src/project.js';
import { VOICES, LANGUAGES, voiceLanguage, asrModel, ASR_MODEL, MULTILINGUAL_ASR_MODEL, TTS_MODEL, ttsDtype } from '../src/models.js';
import { sceneHash } from '../src/voice.js';
import { recordingCuts } from '../src/recordings.js';
import { subtitleCues, toSrt, toVtt } from '../src/subtitles.js';
import { buildPhrases } from '../engine/captions.js';
import { main } from '../src/cli.js';

test('word normalization keeps letters, marks and numbers across scripts, with the existing accent rules', () => {
  for (const [word, expected] of [
    ['Qué', 'que'], ['¿NIÑO?', 'nino'], ['français', 'francais'], ['cœur', 'cœur'],
    ['ação', 'acao'], ['pão', 'pao'], ['città', 'citta'], ['हिन्दी।', 'हिन्दी'],
    ['फ़ाइलें', 'फ़ाइलें'], ['१२३', '१२३'], ['किंतु', 'किंतु'], ['देवनागरी', 'देवनागरी'],
    ["Visitor’s", 'visitors'], ['example.com.', 'example.com'], ['$1,050.50', '$1050.50'], ['API+#@', 'api+#@'],
  ]) {
    assert.equal(normWord(word), expected, word);
    assert.equal(browserNorm(word), expected, word);
    assert.equal(normWord(word.normalize('NFD')), expected, word);
  }
});

test('sentence boundaries include danda and Spanish question and exclamation marks', () => {
  const words = tokenizeNarration('¿Qué pasa? ¡Todo bien! \"यह अच्छा है।\" फिर चलें।');
  const chunks = speechChunks(words);
  assert.deepEqual(chunks.map(c => c.text), ['¿Qué pasa?', '¡Todo bien!', '\"यह अच्छा है।\"', 'फिर चलें।']);
  assert.deepEqual(chunks.map(c => c.gapBefore), [0, 0.3, 0.3, 0.3]);
  assert.equal(tokenizeNarration('एक {दो|दो}।').length, 2);
});

test('each language picks its default and rejects every voice from a different language', () => {
  assert.equal(normalizeConfig({}).language, 'en');
  for (const [language, id] of Object.entries(LANGUAGES)) {
    assert.equal(normalizeConfig({ language }).voice, id);
    assert.equal(normalizeConfig({ language, voice: { provider: 'kokoro', id } }).voice, id);
    for (const voice of Object.keys(VOICES)) {
      if (voiceLanguage(voice) === language) assert.equal(normalizeConfig({ language, voice }).voice, voice);
      else assert.throws(() => normalizeConfig({ language, voice }), e => e instanceof ProjectError && e.message.includes(id));
    }
    for (const voice of [{ provider: 'elevenlabs', id: 'sample' }, { provider: 'recording', src: 'assets/take.wav' }]) {
      assert.equal(normalizeConfig({ language, voice }).language, language);
    }
    assert.equal(asrModel(language), language === 'en' ? ASR_MODEL : MULTILINGUAL_ASR_MODEL);
  }
  for (const language of ['ko', 'pt', '', 'EN', 'toString', null, true, ['es']]) assert.throws(() => normalizeConfig({ language }), /language must be one of/);
});

test('non-English numbers stay digits, including Devanagari, and are never fuzzy matched or spelled out', () => {
  for (const language of ['es', 'fr', 'it', 'pt-br', 'hi']) {
    assert.deepEqual(expand('1,050', language), ['1050']);
    assert.deepEqual(expand('€1.050', language), ['1050']);
    assert.deepEqual(expand('१२%', language), ['12']);
    assert.deepEqual(expand('twenty', language), ['twenty']);
    const r = alignWords([{ spoken: '१२३' }, { spoken: '1050' }], [{ text: '123', start: 0, end: 0.5 }, { text: '1,050', start: 0.5, end: 1 }], 1, language);
    assert.equal(r.matchRate, 1);
    assert.equal(alignWords([{ spoken: '1234' }], [{ text: '1235', start: 0, end: 1 }], 1, language).matchRate, 0);
    assert.equal(alignWords([{ spoken: 'twenty' }], [{ text: '20', start: 0, end: 1 }], 1, language).matchRate, 0);
  }
  assert.deepEqual(expand('twenty'), ['20']);
});

test('Hindi recording cuts use the same language rules as per-scene alignment', () => {
  const scenes = parseScript('## first\n१२३\n## second\nफ़ाइलें').scenes;
  const cuts = recordingCuts(scenes, [{ text: '123', start: 0.2, end: 0.5 }, { text: 'फ़ाइलें', start: 1, end: 1.5 }], 2, 'hi');
  assert.ok(cuts.every(c => c.words[0].matched));
});

test('English cache hashes keep the previous format; other languages are part of the cache', () => {
  const scene = parseScript('## first\n[#a] Hello. Goodbye.').scenes[0];
  const chunks = speechChunks(scene.units);
  const config = normalizeConfig({});
  const previous = crypto.createHash('sha256').update(JSON.stringify({
    PIPELINE: 7, TTS_MODEL, ASR_MODEL, dtype: ttsDtype(), voice: config.voice, speed: config.speed * config.pace,
    chunks: chunks.map(c => [c.gapBefore, c.text]),
    layout: scene.units.map(u => u.type === 'mark' ? `#${u.name}` : u.type === 'word' ? u.display : '').join('|'),
  })).digest('hex').slice(0, 16);
  assert.equal(sceneHash(scene, chunks, config), previous);
  assert.equal(sceneHash(scene, chunks, { ...config, language: undefined }), previous);
  const voice = { provider: 'recording', src: 'assets/take.wav' };
  assert.notEqual(sceneHash(scene, chunks, normalizeConfig({ language: 'fr', voice })), sceneHash(scene, chunks, normalizeConfig({ language: 'es', voice })));
});

test('captions and subtitle files keep native text and split at danda', () => {
  for (const text of ['¿Qué pasó?', 'Le cœur écoute.', 'La città è bella.', 'Não há açúcar.', 'यह अच्छा है। फिर चलें।']) {
    const words = text.split(' ').map((text, i) => ({ text, start: i * 0.2, end: (i + 1) * 0.2 }));
    const timeline = { scenes: [{ start: 0, dur: 10, words }] };
    const cues = subtitleCues(timeline);
    assert.equal(cues.map(c => c.text.replaceAll('\n', ' ')).join(' '), text);
    assert.ok(toSrt(cues).includes(text.split(' ')[0]));
    assert.ok(toVtt(cues).includes(text.split(' ')[0]));
    if (text.includes('।')) {
      assert.equal(cues.length, 2);
      assert.equal(buildPhrases(timeline, 80).length, 2);
    }
  }
});

test('init stores the language and default voice; voices filters and doctor allows missing espeak-ng and misaki', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-language-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let output = '';
  let errors = '';
  t.mock.method(process.stdout, 'write', s => { output += s; return true; });
  t.mock.method(process.stderr, 'write', s => { errors += s; return true; });
  assert.equal(await main(['init', path.join(dir, 'video'), '--language', 'es', '--json']), 0);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'video/video.json')));
  assert.equal(config.language, 'es');
  assert.equal(config.voice, 'ef_dora');
  for (const flags of [['--language', 'ko'], ['--language'], ['--language', 'es', '--voice', 'af_heart']]) {
    assert.equal(await main(['init', path.join(dir, 'bad'), ...flags]), 1);
    assert.equal(fs.existsSync(path.join(dir, 'bad')), false);
  }
  assert.match(errors, /--language needs a value/);
  output = '';
  assert.equal(await main(['voices', '--language', 'es', '--json']), 0);
  const list = JSON.parse(output);
  assert.deepEqual(Object.keys(list.voices), ['ef_dora', 'em_alex', 'em_santa']);
  assert.equal(list.languages.ef_dora, 'es');
  const saved = process.env.EXPLAINROO_ESPEAK;
  process.env.EXPLAINROO_ESPEAK = path.join(dir, 'missing');
  t.after(() => { if (saved === undefined) delete process.env.EXPLAINROO_ESPEAK; else process.env.EXPLAINROO_ESPEAK = saved; });
  output = '';
  assert.equal(await main(['doctor', '--json']), 0);
  assert.match(JSON.parse(output).checks.find(c => c.name === 'espeak-ng').detail, /only needed for Spanish, French, Italian, Portuguese and Hindi/);
  const python = process.env.EXPLAINROO_PYTHON;
  process.env.EXPLAINROO_PYTHON = path.join(dir, 'missing');
  t.after(() => { if (python === undefined) delete process.env.EXPLAINROO_PYTHON; else process.env.EXPLAINROO_PYTHON = python; });
  output = '';
  assert.equal(await main(['doctor', '--json']), 0);
  const misaki = JSON.parse(output).checks.filter(c => c.name.startsWith('misaki'));
  assert.deepEqual(misaki.map(c => [c.name, c.ok, c.detail]), [['misaki ja', true, 'not found; only needed for Japanese'], ['misaki zh', true, 'not found; only needed for Chinese']]);
});
