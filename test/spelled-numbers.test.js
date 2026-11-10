// Spelled numbers in Spanish, French, Italian and Brazilian Portuguese: the
// speech check reads "cinco" like "5" on both sides, and in a language where it
// can't, the advice names the override with the heard word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords } from '../src/align.js';
import { normWord } from '../src/script.js';
import { spelledNumbers } from '../src/spelled-numbers.js';
import { loadProject } from '../src/project.js';
import { voicePaths } from '../src/voice.js';
import { unconfirmedWords } from '../src/qa.js';
import { cachedVoice } from './helpers/cached-voice.js';

const read = (language, text) => spelledNumbers(text.split(' '), language, normWord).filter(Boolean).filter((t) => t.length).map(([v]) => v);

test('spelled numbers read as their digits, from 0 to 9,999, with decimals', () => {
  const cases = {
    es: [['unas cinco veces', ['5']], ['treinta y cinco', ['35']], ['veintiún', ['21']], ['doscientos cuarenta', ['240']], ['mil novecientos noventa', ['1990']],
      ['nueve mil novecientos noventa y nueve', ['9999']], ['tres coma catorce', ['3,14']], ['cero coma cero cinco', ['0,05']], ['uno coma cincuenta', ['1,5']], ['cinco y seis', ['5', '6']]],
    fr: [['cinq', ['5']], ['dix-sept', ['17']], ['vingt et un', ['21']], ['soixante et onze', ['71']], ['quatre-vingt-dix-sept', ['97']], ['deux cents', ['200']],
      ['mille neuf cent quatre-vingt-dix', ['1990']], ['trois virgule cinq', ['3,5']]],
    it: [['cinque', ['5']], ['ventotto', ['28']], ['centottanta', ['180']], ['duemilacinquecento', ['2500']], ['millenovecentonovanta', ['1990']], ['tre virgola cinque', ['3,5']]],
    'pt-br': [['cinco', ['5']], ['vinte e cinco', ['25']], ['cento e vinte e três', ['123']], ['dois mil e quinhentos', ['2500']], ['dois e três', ['2', '3']], ['três vírgula cinco', ['3,5']]],
  };
  for (const [language, list] of Object.entries(cases)) {
    for (const [text, want] of list) assert.deepEqual(read(language, text), want, `${language}: ${text}`);
  }
  // Words that only look like numbers stay words, and so does "ciento" in "por ciento".
  assert.deepEqual(read('fr', 'septembre centre'), []);
  assert.deepEqual(read('es', 'el punto final'), []);
  assert.deepEqual(read('es', 'cinco por ciento'), ['5']);
  assert.deepEqual(read('en', 'five'), []);
});

const heard = (list) => list.map(([text, start, end]) => ({ text, start, end }));
const spaced = (text) => text.split(' ').map((t, i) => [t, i * 0.3, i * 0.3 + 0.3]);
const words = (text) => text.split(' ').map((spoken) => ({ spoken }));

test('the speech check matches spelled numbers to digits on both sides', () => {
  const cases = [
    ['es', 'eso se desvía unas 5 veces más', 'eso se desvía unas cinco veces más'],
    ['es', 'hace 35 grados', 'hace treinta y cinco grados'],
    ['es', 'el 5% del total', 'el cinco por ciento del total'],
    ['es', 'mide 3,5 metros', 'mide tres coma cinco metros'],
    ['es', 'unas cinco veces', 'unas 5 veces'],
    ['fr', 'en 1990 déjà', 'en mille neuf cent quatre-vingt-dix déjà'],
    ['fr', 'il y a 97 ans', 'il y a quatre-vingt-dix-sept ans'],
    ['it', 'ci sono 28 giorni', 'ci sono ventotto giorni'],
    ['pt-br', 'são 125 metros', 'são cento e vinte e cinco metros'],
  ];
  for (const [language, script, said] of cases) {
    const r = alignWords(words(script), heard(spaced(said)), 3, language);
    assert.equal(r.matchRate, 1, `${language}: ${script} / ${said}`);
    assert.ok(r.words.every((w) => w.matched), `${language}: ${script}`);
  }
  // The number lasts from its first heard word to its last.
  const r = alignWords(words('hace 35 grados'), heard(spaced('hace treinta y cinco grados')), 3, 'es');
  assert.deepEqual([r.words[1].start, r.words[1].end], [0.3, 1.2]);
  // A different number is still no match.
  assert.equal(alignWords(words('unas 5 veces'), heard(spaced('unas seis veces')), 3, 'es').words[1].matched, false);
});

test('a digit heard as a word the check cannot read gets the override with that word', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-spelled-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: false, language: 'hi' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Ginti\n\n## intro\nलगभग 5 गुना ज़्यादा।\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  cachedVoice(dir, 'intro');
  const project = loadProject(dir);
  const file = voicePaths(project, 'intro').json;
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  info.transcript = 'लगभग पांच गुना ज़्यादा।';
  info.words = info.words.map((w) => (w.text === '5' ? { ...w, matched: false } : w));
  const [word] = unconfirmedWords(project, info);
  assert.equal(word.word, '5');
  assert.equal(word.advice, "It may be the number said as a word, which the speech check can't read here. If the voice says it right, write it as {5|पांच} in script.md.");
});
