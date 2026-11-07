// German narration: a language with no Kokoro voice, the German rules of the
// speech check and of sentence ends, and the paid voices against the fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords, expand } from '../src/align.js';
import { germanNumber, germanOrdinal, periodGoesOn, SHORT_FORMS } from '../src/german.js';
import { asrModel, LANGUAGE_NAMES, LANGUAGES, MULTILINGUAL_ASR_MODEL } from '../src/models.js';
import { loadProject, noKokoroVoice, normalizeConfig, ProjectError } from '../src/project.js';
import { parseScript, speechChunks } from '../src/script.js';
import { synthesize } from '../src/voice.js';
import { doctor } from '../src/doctor.js';
import { normWord as browserNorm } from '../engine/util.js';
import { normWord } from '../src/script.js';
import { main } from '../src/cli.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';
import { runCli } from './helpers/tiny-project.js';

const heard = (text) => text.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));
const words = (text) => text.split(' ').map((spoken) => ({ spoken }));
const align = (script, said) => alignWords(words(script), heard(said), 10, 'de');
const noWords = async () => ({ text: '', words: [] });

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
}

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-german-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A project folder with these files. Objects are written as JSON.
function project(t, files) {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const [name, content] of Object.entries({ 'script.md': '# Test\n\n## intro\nHello.\n', 'scenes.js': 'export default { intro() {} };', ...files })) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const RECORDING = { provider: 'recording', src: 'assets/narration.m4a' };

test('German is a language with no Kokoro voice, timed by the multilingual model', () => {
  assert.equal(Object.hasOwn(LANGUAGES, 'de'), true);
  assert.equal(LANGUAGES.de, null);
  assert.equal(LANGUAGE_NAMES.de, 'German');
  assert.equal(asrModel('de'), MULTILINGUAL_ASR_MODEL);
  for (const voice of [RECORDING, { provider: 'elevenlabs', id: 'v' }, { provider: 'cartesia', id: 'klare-stimme' }]) {
    const cfg = normalizeConfig({ language: 'de', voice });
    assert.equal(cfg.language, 'de');
    assert.equal(cfg.voice.provider, voice.provider);
  }
  assert.equal(normalizeConfig({ language: 'de', voice: { provider: 'elevenlabs', id: 'v' } }).voice.model, 'eleven_multilingual_v2');
  assert.equal(normalizeConfig({ voice: 'af_heart', languages: { de: { voice: RECORDING } } }, '.', { language: 'de' }).voice.provider, 'recording');
});

test('every place that would fall back to Kokoro for German stops with one plain message', () => {
  const message = noKokoroVoice('de');
  for (const words of ['Kokoro, the free voice, has no German voice.', '"voice": { "provider": "recording", "src": "assets/narration.m4a" }', '"voice": { "provider": "elevenlabs", "id": "<voice id>" }', '"voice": { "provider": "cartesia", "id": "<voice id>" }', 'explainroo services voice']) assert.ok(message.includes(words), words);
  const isMessage = (place) => (e) => e instanceof ProjectError && e.message.includes(noKokoroVoice('de', place));
  // Without a voice, with a Kokoro voice in either form, and as another language without a voice of its own.
  assert.throws(() => normalizeConfig({ language: 'de' }), isMessage('main'));
  assert.throws(() => normalizeConfig({ language: 'de', voice: 'ff_siwis' }), isMessage('main'));
  assert.throws(() => normalizeConfig({ language: 'de', voice: { provider: 'kokoro', id: 'af_heart' } }), isMessage('main'));
  assert.throws(() => normalizeConfig({ languages: { de: {} } }), (e) => isMessage('version')(e) && e.message.startsWith('languages.de: '));
  assert.throws(() => normalizeConfig({ languages: { de: { voice: 'af_heart' } } }), isMessage('version'));
  assert.throws(() => normalizeConfig({ voice: 'af_heart', languages: { de: { captions: true } } }, '.', { language: 'de' }), isMessage('version'));
  const version = noKokoroVoice('de', 'version');
  assert.ok(version.includes('"languages": { "de": { "voice": { "provider": "recording", "src": "assets/narration-de.m4a" } } }'));
  assert.ok(noKokoroVoice('de', 'init').includes('create the project without --language. Then set "language": "de"'));
  assert.ok(noKokoroVoice('de', 'voices').includes('"explainroo voices --provider elevenlabs --language de" or "explainroo voices --provider cartesia --language de"'));
  // The other languages keep their default voices.
  assert.equal(normalizeConfig({ language: 'fr' }).voice, 'ff_siwis');
  assert.throws(() => normalizeConfig({ languages: { nl: {} } }), /"nl" is not a language explainroo speaks/);
});

test('a project with a German version that would use Kokoro stops every command that loads it', (t) => {
  const german = { 'script.de.md': '# Test\n\n## intro\nHallo.\n' };
  // A script.de.md without a voice of its own stops the English version too.
  const dir = project(t, { 'video.json': {}, ...german });
  assert.throws(() => loadProject(dir), (e) => e instanceof ProjectError && e.message.includes(noKokoroVoice('de', 'version')));
  assert.throws(() => loadProject(dir, { lang: 'de' }), (e) => e.message.includes(noKokoroVoice('de', 'version')));
  for (const settings of [{ languages: { de: {} } }, { languages: { de: { voice: 'ff_siwis' } } }]) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
    assert.throws(() => loadProject(dir), (e) => e instanceof ProjectError && e.message.includes('has no German voice'));
  }
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ languages: { de: { voice: RECORDING } } }));
  assert.deepEqual(loadProject(dir).languages, ['en', 'de']);
  assert.equal(loadProject(dir, { lang: 'de' }).config.voice.provider, 'recording');
  // German as the main language.
  const main = project(t, { 'video.json': { language: 'de' } });
  assert.throws(() => loadProject(main), (e) => e.message.includes(noKokoroVoice('de', 'main')));
  fs.writeFileSync(path.join(main, 'video.json'), JSON.stringify({ language: 'de', voice: RECORDING }));
  assert.equal(loadProject(main).language, 'de');
});

test('init --language de stops and creates nothing, and voices --language de needs a provider', async (t) => {
  const dir = temp(t);
  let output = '';
  let errors = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  t.mock.method(process.stderr, 'write', (s) => { errors += s; return true; });
  assert.equal(await main(['init', path.join(dir, 'video'), '--language', 'de']), 1);
  assert.equal(await main(['init', path.join(dir, 'video'), '--language', 'de', '--voice', 'ff_siwis']), 1);
  assert.equal(fs.existsSync(path.join(dir, 'video')), false);
  assert.ok(errors.includes(noKokoroVoice('de', 'init')));
  errors = '';
  assert.equal(await main(['voices', '--language', 'de']), 1);
  assert.ok(errors.includes(noKokoroVoice('de', 'voices')));
  output = '';
  assert.equal(await main(['voices', '--language', 'de', '--json']), 1);
  assert.ok(JSON.parse(output).error.includes('has no German voice'));
  output = '';
  assert.equal(await main(['help']), 0);
  assert.match(output, /--language en\|es\|fr\|it\|pt-br\|hi\|ja\|zh, --voice, --title\)\.\n +German works with a paid voice or a recording, see "explainroo docs languages"/);
});

test('voices --provider lists German voices from Cartesia and ElevenLabs', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const settings = temp(t);
  const env = { ...fake.env, EXPLAINROO_CONFIG: settings, CARTESIA_API_KEY: GOOD_KEY, ELEVENLABS_API_KEY: GOOD_KEY };
  const cartesia = await runCli(['voices', '--provider', 'cartesia', '--language', 'de', '--json'], env);
  assert.equal(cartesia.code, 0, cartesia.text);
  assert.deepEqual(JSON.parse(cartesia.stdout).voices, [{ name: 'Klare Stimme', id: 'klare-stimme', labels: { accent: 'de-DE', gender: 'feminine' } }]);
  assert.match(fake.requests('cartesia', 'GET /voices').at(-1).search, /language=de/);
  const eleven = await runCli(['voices', '--provider', 'elevenlabs', '--language', 'de', '--json'], env);
  assert.equal(eleven.code, 0, eleven.text);
  assert.deepEqual(JSON.parse(eleven.stdout).voices.map((v) => v.id), ['fake-voice']);
});

test('doctor says a German project needs the language model and neither espeak-ng nor misaki', async (t) => {
  const dir = project(t, { 'video.json': { language: 'de', voice: RECORDING } });
  const r = await doctor({ project: loadProject(dir) });
  const state = (name) => r.checks.find((c) => c.name === name).state;
  assert.deepEqual(r.setup, [{ language: 'de', voice: 'recording' }]);
  assert.notEqual(state('language model'), 'not needed');
  for (const name of ['espeak-ng', 'misaki ja', 'misaki zh', 'voice model', 'speech check model']) assert.equal(state(name), 'not needed', name);
});

test('the speech check reads German numbers, years, ordinals, decimals, short forms and ß the way a voice says them', () => {
  for (const [script, said] of [
    ['zweiundvierzig', '42'], ['dreihundertzwölf', '312'], ['zweitausendvierundzwanzig', '2024'], ['einhundert', '100'], ['hundert', '100'], ['eintausend', '1000'],
    ['1990', 'neunzehnhundertneunzig'], ['1990', 'eintausendneunhundertneunzig'], ['2024', 'zweitausendvierundzwanzig'], ['1582', 'fünfzehnhundertzweiundachtzig'],
    ['3.', 'dritte'], ['3.', 'dritten'], ['3.', 'dritter'], ['19.', 'neunzehnten'], ['29.', 'neunundzwanzigsten'], ['1.', 'ersten'], ['7.', 'siebten'], ['8.', 'achten'], ['20.', 'zwanzigsten'], ['3.', '3.'],
    ['3,5', 'drei Komma fünf'], ['3,5', '3,5'], ['365,2422', 'dreihundertfünfundsechzig Komma zwei vier zwei zwei'], ['365,2422', '365,2422'], ['0,5', 'null Komma fünf'],
    ['1.000', 'tausend'], ['1.000', 'eintausend'], ['1.000', '1000'], ['10.000', 'zehntausend'],
    ['5 Millionen', '5 Mio.'], ['3 Milliarden', '3 Mrd.'], ['eine Million', 'eine Mio.'], ['5 %', '5 Prozent'], ['5%', 'fünf Prozent'], ['10 €', 'zehn Euro'], ['€5', '5 Euro'],
    ['z. B.', 'zum Beispiel'], ['z.B.', 'zum Beispiel'], ['zum Beispiel', 'z. B.'], ['d. h.', 'das heißt'], ['u. a.', 'unter anderem'], ['usw.', 'und so weiter'], ['bzw.', 'beziehungsweise'],
    ['ca.', 'circa'], ['ca.', 'zirka'], ['etc.', 'et cetera'], ['Nr.', 'Nummer'], ['Dr.', 'Doktor'],
    ['100 km', '100 Kilometer'], ['5 kg', 'fünf Kilogramm'], ['50 km/h', '50 Kilometer pro Stunde'], ['20 °C', '20 Grad Celsius'],
    ['dreißig', 'dreissig'], ['heißt', 'heisst'], ['Wärme', 'Warme'], ['1 Tag', 'ein Tag'],
    // Whisper sometimes writes a year as digits and a word.
    ['1900', '19-hundert'], ['1990', '19-hundert-90'], ['1990', '19hundertneunzig'], ['2024', '2-tausend-24'], ['2000', '2-tausend.'],
  ]) {
    const r = align(script, said);
    assert.equal(r.matchRate, 1, `${script} | ${said}`);
    assert.ok(r.words.every((w) => w.matched && !w.nearly), `${script} | ${said} matches exactly`);
  }
});

test('a German number only matches the same number', () => {
  for (const [script, said] of [['23', 'vierundzwanzig'], ['dreiundzwanzig', 'vierundzwanzig'], ['3,5', '35'], ['35', '3,5'], ['3,5', 'fünfunddreißig'], ['1990', '1991'], ['1990', 'neunzehnhundertneunzehn'], ['3.', 'vierten'], ['2024', 'zweitausendvierzig'], ['1.000', '1,000'], ['1990', '19-hundert'], ['5', '2-3']]) {
    assert.equal(align(script, said).matchRate, 0, `${script} | ${said}`);
  }
  // The large numbers that stay words only match themselves too.
  for (const [script, said] of [['5 Millionen', '5 Milliarden'], ['3 Milliarden', '3 Billionen'], ['eine Million', 'eine Milliarde'], ['2 Mio.', '2 Mrd.'], ['5 Milliarden', '5 Millionen']]) {
    const r = align(script, said);
    assert.equal(r.matchRate, 0.5, `${script} | ${said}`);
    assert.deepEqual(r.words.map((w) => [w.matched, !!w.nearly]), [[true, false], [false, false]], `${script} | ${said}`);
  }
  for (const [script, said] of [['2 Billionen', '2 Billion'], ['eine Milliarde', 'eine Mrd.']]) assert.equal(align(script, said).matchRate, 1, `${script} | ${said}`);
  assert.equal(germanNumber('dreiundzwanzig'), 23);
  assert.equal(germanNumber('vierundzwanzig'), 24);
  assert.equal(germanNumber('neunzehnhundertneunzig'), 1990);
  assert.equal(germanNumber('Jahrhundert'), null);
  assert.equal(germanNumber('ein'), null);
  assert.equal(germanOrdinal('neunundzwanzigste'), 29);
  for (const word of ['Weste', 'Gerste', 'machte', 'Monate', 'Hunderte', 'Jahrhunderte', 'Kiste', 'Elfen']) assert.equal(germanOrdinal(word), null, word);
});

test('each German short form is in one table, and the speech check reads it as its spoken words', () => {
  assert.deepEqual(SHORT_FORMS.map((f) => f.written), ['z. B.', 'd. h.', 'u. a.', 'usw.', 'bzw.', 'ca.', 'etc.', 'Nr.', 'Dr.', 'Mio.', 'Mrd.', 'km', 'kg', 'km/h', '°C', '%', '€']);
  for (const { written, spoken } of SHORT_FORMS) {
    assert.equal(align(written, spoken).matchRate, 1, written);
    assert.equal(align(spoken, written).matchRate, 1, written);
  }
  // Whisper's pieces of one number are joined, like "19" and "-hundert" for 1900.
  assert.equal(alignWords([{ spoken: 'war' }, { spoken: '1900' }, { spoken: 'kein' }], heard('war 19 -hundert kein'), 2, 'de').matchRate, 1);
  assert.equal(alignWords([{ spoken: 'braucht' }, { spoken: '365,2422' }], heard('braucht 365 ,2422'), 1, 'de').matchRate, 1);
  assert.deepEqual(expand('3,5', 'de'), ['3', 'komma', '5']);
  assert.deepEqual(expand('usw.', 'de'), ['und', 'so', 'weiter']);
  // {shown|spoken} keeps working, with the shown form or the spoken form heard.
  const override = alignWords([{ spoken: 'am' }, { spoken: 'dritten', display: '3.' }, { spoken: 'Mai.' }], heard('am 3. Mai.'), 2, 'de');
  assert.equal(override.matchRate, 1);
  assert.equal(alignWords([{ spoken: 'sound rue', display: 'Soundroo' }], heard('Soundroo'), 1, 'de').matchRate, 1);
});

test('the other languages keep their own number rules', () => {
  for (const language of ['es', 'fr', 'it', 'pt-br', 'hi']) {
    assert.deepEqual(expand('3,5', language), ['35']);
    assert.deepEqual(expand('usw.', language), ['usw']);
  }
  assert.equal(alignWords(words('zweiundvierzig'), heard('42'), 1, 'es').matchRate, 0);
});

test('in German, ordinals and short forms inside a sentence do not end it, and other periods still do', () => {
  const sentences = (text, language = 'de') => speechChunks(parseScript(`## a\n${text}`, { language }).scenes[0].units, { language }).map((c) => c.text);
  for (const text of ['Wir treffen uns am 3. Mai im Park.', 'Das war im 19. Jahrhundert so.', 'Heute ist der 29. Februar.', 'Stoffe wie z. B. Wasser fließen.', 'Das heißt d. h. nichts.', 'Er war u. a. dort.', 'Wasser, Luft usw. sind Stoffe.', 'Luft etc. ist wichtig.', 'Das ist bzw. war so.', 'Es kostet ca. 5 Euro.', 'Siehe Nr. 5 bei Dr. Weber.', 'Das gilt z.B. hier.', 'Das ist der {3.|dritten} Versuch.', 'Er kam am 3. [#then] Mai an.']) {
    assert.deepEqual(sentences(text), [text.replace(/\{3\.\|dritten\}/, 'dritten').replace(' [#then]', '')], text);
  }
  assert.deepEqual(sentences('Die Anzahl ist 3. Danach steigt sie.'), ['Die Anzahl ist 3.', 'Danach steigt sie.']);
  assert.deepEqual(sentences('Wir nutzen Wasser usw. Danach geht es weiter.'), ['Wir nutzen Wasser usw.', 'Danach geht es weiter.']);
  assert.deepEqual(sentences('Es geht um Mio. Euro.'), ['Es geht um Mio.', 'Euro.']);
  // A pause still ends the piece before it.
  assert.deepEqual(sentences('Es war am 3. [pause] Mai.'), ['Es war am 3.', 'Mai.']);
  // English and Spanish split as before.
  assert.deepEqual(sentences('We met on the 3. May was warm.', 'en'), ['We met on the 3.', 'May was warm.']);
  assert.deepEqual(sentences('Llegó el 3. Mayo fue bueno.', 'es'), ['Llegó el 3.', 'Mayo fue bueno.']);
  assert.equal(periodGoesOn('3.', 'am', 'Mai'), true);
  assert.equal(periodGoesOn('3.', 'ist', 'Danach'), false);
  assert.equal(periodGoesOn('usw.', 'Luft', 'sind'), true);
  assert.equal(periodGoesOn('usw.', 'Wasser', 'Danach'), false);
  assert.equal(periodGoesOn('B.', 'z.', 'Wasser'), true);
});

test('cues, captions and markers find German words with umlauts and ß', () => {
  for (const [cue, word] of [['Wärme', 'Wärme,'], ['wärme', 'WÄRME'], ['Straße', 'Straße.'], ['Größe', 'Größe']]) {
    assert.equal(browserNorm(cue), browserNorm(word), cue);
    assert.equal(normWord(cue), browserNorm(word), cue);
  }
  const scene = parseScript('## a\n[#heat] Die *Wärme* fließt.', { language: 'de' }).scenes[0];
  assert.deepEqual(scene.units.map((u) => u.type === 'word' ? u.display : `#${u.name}`), ['#heat', 'Die', 'Wärme', 'fließt.']);
  assert.equal(scene.units.find((u) => u.display === 'Wärme').key, true);
});

test('one German take is cut into scenes by its words, numbers read the way they were spoken', async () => {
  const { recordingCuts } = await import('../src/recordings.js');
  const scenes = parseScript('## orbit\nDie Erde braucht 365,2422 Tage.\n\n## leap\nDas ist der 29. Februar.\n', { language: 'de' }).scenes;
  const said = 'Die Erde braucht dreihundertfünfundsechzig Komma zwei vier zwei zwei Tage. Das ist der neunundzwanzigste Februar.';
  const cuts = recordingCuts(scenes, said.split(' ').map((text, i) => ({ text, start: 0.5 + i * 0.4, end: 0.8 + i * 0.4 })), 8, 'de');
  assert.deepEqual(cuts.map((c) => c.scene.id), ['orbit', 'leap']);
  assert.ok(cuts.every((c) => c.words.every((w) => w.matched)));
  assert.ok(cuts[0].end <= cuts[1].start);
  // The second scene starts at "Das", the eleventh word heard.
  assert.equal(cuts[1].words[0].start, 0.5 + 10 * 0.4);
});

test('Cartesia gets the language de, and ElevenLabs the German text in whole sentences', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  setEnv(t, 'EXPLAINROO_CARTESIA_URL', fake.env.EXPLAINROO_CARTESIA_URL);
  setEnv(t, 'EXPLAINROO_ELEVENLABS_URL', fake.env.EXPLAINROO_ELEVENLABS_URL);
  setEnv(t, 'CARTESIA_API_KEY', GOOD_KEY);
  setEnv(t, 'ELEVENLABS_API_KEY', GOOD_KEY);
  t.mock.method(process.stderr, 'write', () => true);
  const script = '# Test\n\n## intro\nWir treffen uns am 3. Mai, z. B. im Park. Die Anzahl ist 3. Danach steigt sie.\n';
  const cartesia = project(t, { 'video.json': { language: 'de', voice: { provider: 'cartesia', id: 'klare-stimme' } }, 'script.md': script });
  await synthesize(loadProject(cartesia), { transcribe: noWords });
  const sent = fake.requests('cartesia', 'POST /tts/bytes').map((r) => r.body);
  assert.deepEqual(sent.map((b) => [b.language, b.voice.id, b.transcript]), [['de', 'klare-stimme', 'Wir treffen uns am 3. Mai, z. B. im Park. Die Anzahl ist 3. Danach steigt sie.']]);
  const eleven = project(t, { 'video.json': { language: 'de', voice: { provider: 'elevenlabs', id: 'fake-voice' } }, 'script.md': script });
  await synthesize(loadProject(eleven), { transcribe: noWords });
  const spoken = fake.requests('elevenlabs', 'POST /v1/text-to-speech/*').map((r) => r.body);
  assert.deepEqual(spoken.map((b) => b.text), ['Wir treffen uns am 3. Mai, z. B. im Park.', 'Die Anzahl ist 3.', 'Danach steigt sie.']);
  assert.ok(spoken.every((b) => b.model_id === 'eleven_multilingual_v2' && b.language === undefined));
});
