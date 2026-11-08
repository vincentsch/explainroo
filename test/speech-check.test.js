// The rules of the speech check: spelling hints heard as written, words that
// sound the same, two words heard as one, units and symbols in each language,
// and numbers compared by value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignSpeech, alignWords, nearList } from '../src/align.js';
import { numberValue, unitReading } from '../src/units.js';
import { soundsOf } from '../src/phonemes.js';
import { nearlyText } from '../src/qa.js';

const heard = (list) => list.map(([text, start, end]) => ({ text, start, end }));
// Heard words a third of a second apart, from one string.
const said = (text) => text.split(' ').map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }));
const words = (text) => text.split(' ').map((spoken) => ({ spoken }));
const state = (r) => r.words.map((w) => (w.nearly ? `${w.alike ? 'alike' : w.joined ? 'joined' : 'near'}:${w.heard}` : w.matched ? 'exact' : `no:${w.heard ?? ''}`));
const missed = (text, r) => text.split(' ').filter((_, k) => !r.words[k].matched);
const times = (list) => list.map((w) => [w.start, w.end].map((v) => Math.round(v * 1000) / 1000));

function fakeEspeak(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-espeak-'));
  const file = path.join(dir, 'espeak');
  fs.writeFileSync(file, '#!/usr/bin/env node\n' + source, { mode: 0o755 });
  const previous = process.env.EXPLAINROO_ESPEAK;
  process.env.EXPLAINROO_ESPEAK = file;
  t.after(() => {
    if (previous === undefined) delete process.env.EXPLAINROO_ESPEAK;
    else process.env.EXPLAINROO_ESPEAK = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return file;
}
const posix = { skip: process.platform === 'win32' && 'the fake espeak-ng is a POSIX script' };

test('a spelling hint counts when Whisper writes the spoken form or the shown form, in any case and with any punctuation', () => {
  const site = [{ spoken: 'Visit' }, { spoken: 'tab slip dot com.', display: 'tabslip.com.' }];
  for (const form of [['tabslip.com.'], ['Tabslip.com'], ['tab', 'slip.com'], ['Tabslip', 'dot', 'com.'], ['tab', 'slip', 'dot', 'com'], ['tab-slip.com'], ['tabslip', '.com']]) {
    const r = alignWords(site, heard([['Visit', 0, 0.3], ...form.map((w, i) => [w, 0.3 + i * 0.2, 0.5 + i * 0.2])]), 1.5);
    assert.deepEqual(state(r), ['exact', 'exact'], form.join(' '));
    assert.equal(r.matchRate, 1);
    // The word gets the time of everything that spelled it.
    assert.deepEqual([r.words[1].start, r.words[1].end], [0.3, 0.5 + (form.length - 1) * 0.2]);
  }
  // The shown form over several heard words, like "S Q L" for {SQL|sequel}.
  assert.deepEqual(state(alignWords([{ spoken: 'sequel', display: 'SQL' }, { spoken: 'runs.' }], said('S Q L runs.'), 2)), ['exact', 'exact']);
  // Another site is still not confirmed.
  assert.deepEqual(state(alignWords(site, said('Visit tabslap.com.'), 1.5)).map((s) => s.split(':')[0]), ['exact', 'no']);
});

test('two neighbouring words heard as one count as nearly matched, both of them, and share the heard time', () => {
  const costs = alignWords(words('See costs by model.'), heard([['Seacosts', 0, 0.8], ['by', 0.8, 1], ['model.', 1, 1.4]]), 1.5);
  assert.deepEqual(state(costs), ['joined:Seacosts', 'joined:Seacosts', 'exact', 'exact']);
  assert.equal(costs.matchRate, 1);
  // Split by the length of the two words: "See" has 3 letters and "costs" 5.
  assert.deepEqual(times(costs.words.slice(0, 2)), [[0, 0.3], [0.3, 0.8]]);
  const sits = alignWords(words('Tabslip sits between'), said('Tab slipsits between'), 1);
  assert.deepEqual(state(sits), ['joined:Tab slipsits', 'joined:Tab slipsits', 'exact']);
  // Heard exactly as one word, like "Soundroo" for "Sound roo", it is still listed.
  assert.deepEqual(state(alignWords(words('Sound roo plays'), said('Soundroo plays'), 1)), ['joined:Soundroo', 'joined:Soundroo', 'exact']);
  assert.deepEqual(nearList(words('See costs by model.'), costs.words), [{ word: 'See', heard: 'Seacosts', joined: true }, { word: 'costs', heard: 'Seacosts', joined: true }]);
  // A word that was never heard is not hidden in a near match of two words.
  assert.deepEqual(state(alignWords(words('El navegador pregunta otra vez.'), said('El navegador pregunto vez.'), 2, 'es')), ['exact', 'exact', 'near:pregunto', 'no:', 'exact']);
  // Two words heard as two words with the same split stay two words.
  assert.deepEqual(state(alignWords(words('red apple'), said('red apples'), 1)), ['exact', 'near:apples']);
});

test('a word heard as another word with the same sound counts, listed as sounding the same', async () => {
  const text = 'It contains a harmless piece of the virus.';
  const r = await alignSpeech(words(text), said('It contains a harmless peace of the virus.'), 3);
  assert.deepEqual(state(r), ['exact', 'exact', 'exact', 'exact', 'alike:peace', 'exact', 'exact', 'exact']);
  assert.equal(r.matchRate, 1);
  assert.deepEqual(nearList(words(text), r.words), [{ word: 'piece', heard: 'peace', alike: true }]);
  // Short words too, which `similar` never accepts, and a number heard as a word.
  assert.deepEqual(state(await alignSpeech(words('Put it over there.'), said('Put it over their.'), 2)), ['exact', 'exact', 'exact', 'alike:their']);
  assert.deepEqual(state(await alignSpeech(words('I see the sea.'), said('I sea the see.'), 2)), ['exact', 'alike:sea', 'exact', 'alike:see']);
  assert.deepEqual(state(await alignSpeech(words('Two steps.'), said('To steps.'), 1)), ['alike:To', 'exact']);
  // Another sound is still not confirmed, and the sound never moves a word that matched.
  assert.deepEqual(state(await alignSpeech(words('a harmless piece'), said('a harmless pizza'), 1)), ['exact', 'exact', 'no:pizza']);
  assert.equal((await soundsOf(['peace', 'piece'], 'en')).get('peace'), (await soundsOf(['piece'], 'en')).get('piece'));
  assert.doesNotMatch((await soundsOf(['peace'], 'en')).get('peace'), /[ˈˌ]/);
});

test('the sound check uses espeak-ng for Spanish, and without a phonemizer the check stays as it was', posix, async (t) => {
  fakeEspeak(t, `
    let text = '';
    process.stdin.on('data', (d) => text += d);
    process.stdin.on('end', () => process.stdout.write(text.trim().split('\\n').map((w) => ({ hay: 'ˈai', ay: 'ˈai', halla: 'ˈaʝa', haya: 'ˈaʝa' })[w] ?? w).join('\\n') + '\\n'));
  `);
  assert.deepEqual(state(await alignSpeech(words('Hay luz.'), said('Ay luz.'), 1, 'es')), ['alike:Ay', 'exact']);
  assert.deepEqual(state(await alignSpeech(words('lo halla hoy'), said('lo haya hoy'), 1, 'es')), ['exact', 'alike:haya', 'exact']);
  // German has no phonemizer here, so a word that sounds the same is still not confirmed.
  assert.deepEqual(state(await alignSpeech(words('das Rad'), said('das Rat'), 1, 'de')).map((s) => s.split(':')[0]), ['exact', 'no']);
});

test('a missing espeak-ng leaves the check as it was', posix, async (t) => {
  const file = fakeEspeak(t, 'process.exit(1);');
  fs.rmSync(file);
  assert.deepEqual(state(await alignSpeech(words('Hoz nueva.'), said('Os nueva.'), 1, 'es')).map((s) => s.split(':')[0]), ['no', 'exact']);
});

// The script says the words, and Whisper wrote the abbreviation.
const UNIT_CASES = {
  en: ['It moves 300,000 kilometers per second, at 100 kilometers per hour, 5 kilometers, 10 meters, 20 centimeters, 4 millimeters, 2 kilograms, 50 grams, 3 seconds, 200 milliseconds, 9 percent, 30 degrees Celsius, 5 euros and 7 dollars.',
    'It moves 300,000 km/s, at 100 km/h, 5 km, 10 m, 20 cm, 4 mm, 2 kg, 50 g, 3 s, 200 ms, 9%, 30 °C, 5 € and $7.'],
  de: ['mit 300.000 Kilometern pro Sekunde, 90 Kilometer pro Stunde, 5 Kilometer, 10 Meter, 3 Zentimeter, 2 Millimeter, 4 Kilogramm, 50 Gramm, 3 Sekunden, 200 Millisekunden, 9 Prozent, 30 Grad Celsius, 5 Euro und 7 Dollar.',
    'mit 300 000 km/s, 90 km/h, 5 km, 10 m, 3 cm, 2 mm, 4 kg, 50 g, 3 s, 200 ms, 9 %, 30 °C, 5 € und 7 $.'],
  es: ['Recorre 300.000 kilómetros por segundo, a 100 kilómetros por hora, 5 kilómetros, 10 metros, 3 centímetros, 2 milímetros, 4 kilogramos, 50 gramos, 3 segundos, 200 milisegundos, el 9 por ciento, 30 grados Celsius, 5 euros y 7 dólares.',
    'Recorre 300 000 km/s, a 100 km/h, 5 km, 10 m, 3 cm, 2 mm, 4 kg, 50 g, 3 s, 200 ms, el 9 %, 30 °C, 5 € y 7 $.'],
  fr: ['à 300 000 kilomètres par seconde, à 90 kilomètres heure, 5 kilomètres, 10 mètres, 3 centimètres, 2 millimètres, 4 kilos, 50 grammes, 3 secondes, 200 millisecondes, 9 pour cent, 30 degrés Celsius, 5 euros et 7 dollars.',
    'à 300 000 km/s, à 90 km/h, 5 km, 10 m, 3 cm, 2 mm, 4 kg, 50 g, 3 s, 200 ms, 9 %, 30 °C, 5 € et 7 $.'],
  it: ['a 300.000 chilometri al secondo, a 90 chilometri orari, 5 chilometri, 10 metri, 3 centimetri, 2 millimetri, 4 chili, 50 grammi, 3 secondi, 200 millisecondi, il 9 per cento, 30 gradi Celsius, 5 euro e 7 dollari.',
    'a 300.000 km/s, a 90 km/h, 5 km, 10 m, 3 cm, 2 mm, 4 kg, 50 g, 3 s, 200 ms, il 9%, 30 °C, 5 € e 7 $.'],
  'pt-br': ['a 300.000 quilômetros por segundo, a 90 quilômetros por hora, 5 quilômetros, 10 metros, 3 centímetros, 2 milímetros, 4 quilos, 50 gramas, 3 segundos, 200 milissegundos, 9 por cento, 30 graus Celsius, 5 euros e 7 dólares.',
    'a 300 000 km/s, a 90 km/h, 5 km, 10 m, 3 cm, 2 mm, 4 kg, 50 g, 3 s, 200 ms, 9%, 30 °C, 5 € e 7 $.'],
};

for (const [language, [script, transcript]] of Object.entries(UNIT_CASES)) {
  test(`units and symbols that Whisper writes are read as the words of the language: ${language}`, () => {
    const r = alignWords(words(script), said(transcript), 30, language);
    assert.deepEqual(missed(script, r), []);
    assert.equal(r.matchRate, 1);
    // The same holds the other way round, for a script that writes the abbreviation.
    assert.equal(alignWords(words(transcript), said(script), 30, language).matchRate, 1);
  });
}

test('a unit takes the reading that the other side has, and singular and plural agree', () => {
  assert.equal(alignWords(words('à 90 kilomètres par heure'), said('à 90 km/h'), 2, 'fr').matchRate, 1);
  assert.equal(alignWords(words('à 90 kilomètres à l’heure'), said('à 90 km/h'), 2, 'fr').matchRate, 1);
  assert.equal(alignWords(words('a 90 chilometri all’ora'), said('a 90 km/h'), 2, 'it').matchRate, 1);
  assert.equal(alignWords(words('un kilómetro'), said('un km'), 1, 'es').matchRate, 1);
  assert.equal(alignWords(words('one kilometre'), said('one km'), 1).matchRate, 1);
  assert.deepEqual(unitReading('km/h', '90', 'fr', ['a', '90', 'kilometres', 'heure'])?.tokens, ['kilometres', 'heure']);
  // A word of a reading elsewhere in the sentence doesn't pick it.
  assert.deepEqual(unitReading('km/h', '90', 'fr', ['par', 'seconde', 'a', '90', 'kilometres', 'heure'])?.tokens, ['kilometres', 'heure']);
});

test('short units count only after a number, and Whisper splitting a unit is joined back', () => {
  // "s" and "m" alone stay letters.
  assert.equal(unitReading('s', 'letter', 'en'), null);
  assert.deepEqual(unitReading('s', '10', 'en')?.tokens, ['seconds']);
  assert.deepEqual(unitReading('300km/s.', null, 'es'), { number: '300', tokens: ['kilometros', 'por', 'segundo'] });
  assert.equal(unitReading('5G', null, 'en'), null);
  assert.equal(alignWords(words('the letter s'), said('the letter s'), 1).matchRate, 1);
  // Whisper wrote "km" and "/s." as two words.
  const r = alignWords(words('unos 300.000 kilómetros por segundo.'), heard([['unos', 0, 0.3], ['300', 0.3, 0.6], ['000', 0.6, 0.9], ['km', 0.9, 1.2], ['/s.', 1.2, 1.5]]), 1.6, 'es');
  assert.deepEqual(state(r), ['exact', 'exact', 'exact', 'exact', 'exact']);
});

test('numbers count by value, with thousands written the way each language writes them', () => {
  const same = (language, script, transcript) => alignWords(words(script), said(transcript), 3, language).matchRate === 1;
  for (const language of ['es', 'fr', 'it', 'pt-br', 'de']) {
    for (const form of ['300.000', '300 000', '300000', '300 000', '300 000', '300 000']) {
      assert.ok(same(language, 'unos 300.000 años', `unos ${form} años`), `${language} ${form}`);
    }
    // A decimal comma stays a decimal, so 7,5 is never 75.
    assert.ok(same(language, 'son 7,5 años', 'son 7,5 años'));
    assert.ok(!same(language, 'son 7,5 años', 'son 75 años'), language);
  }
  for (const form of ['300,000', '300 000', '300 000', '300000']) assert.ok(same('en', 'about 300,000 years', `about ${form} years`), form);
  assert.ok(same('en', 'three hundred thousand years', '300 000 years'));
  // Hindi groups by lakh, with a comma.
  assert.equal(numberValue('3,00,000', 'hi'), '300000');
  assert.equal(numberValue('300.000', 'es'), '300000');
  assert.equal(numberValue('1.000.000,5', 'es'), '1000000,5');
  assert.equal(numberValue('300,000', 'en'), '300000');
  assert.equal(numberValue('3,0,0', 'es'), null);
  // A script that writes thousands with a space has two words, and both are confirmed by one heard number.
  const spaced = alignWords(words('unos 300 000 años'), heard([['unos', 0, 0.3], ['300.000', 0.3, 0.9], ['años', 0.9, 1.2]]), 1.3, 'es');
  assert.deepEqual(state(spaced), ['exact', 'exact', 'exact', 'exact']);
  assert.deepEqual(times(spaced.words.slice(1, 3)), [[0.3, 0.6], [0.6, 0.9]]);
  // And a number that was not heard leaves both unconfirmed.
  assert.deepEqual(state(alignWords(words('unos 300 000 años'), said('unos 200.000 años'), 1, 'es')).map((s) => s.split(':')[0]), ['exact', 'no', 'no', 'exact']);
});
