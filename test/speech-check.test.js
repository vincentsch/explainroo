// The rules of the speech check: spelling hints heard as written, words that
// sound the same, two words heard as one, units, symbols and maths in each
// language, and numbers compared by value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignSpeech, alignWords, nearList } from '../src/align.js';
import { numberValue, unitReading } from '../src/units.js';
import { mathReading } from '../src/math-words.js';
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
  // A word heard on its own doesn't confirm the word before it, and a word that
  // takes in the one before it does.
  assert.deepEqual(state(alignWords(words('ask for a video.'), said('ask for video.'), 1)), ['exact', 'exact', 'no:', 'exact']);
  assert.deepEqual(state(alignWords(words('A merge adds'), said('Emerge adds'), 1)), ['joined:Emerge', 'joined:Emerge', 'exact']);
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

// The voice says the amount, and Whisper wrote it with a currency symbol,
// before or after the number, in one piece or split like "R", "$" and "22".
const MONEY_CASES = {
  en: ['It costs one hundred reais, five dollars, ten dollars, three pounds and twenty euros.',
    'It costs R$100, US$5, $10, £3 and 20 €.'],
  de: ['Es kostet 100 Real, 5 Dollar, 10 Dollar, 3 Pfund und 20 Euro.',
    'Es kostet R$ 100, US$5, 10 $, £3 und 20 €.'],
  es: ['Cuesta cien reales, cinco dólares, diez dólares, tres libras y veinte euros.',
    'Cuesta R$ 100, US$5, $10, £3 y 20 €.'],
  fr: ['Ça coûte cent reais, cinq dollars, dix dollars, trois livres et vingt euros.',
    'Ça coûte R$100, US$5, 10 $, 3 £ et 20 €.'],
  it: ['Costa cento reais, cinque dollari, dieci dollari, tre sterline e venti euro.',
    'Costa R$100, US$5, $10, £3 e 20 €.'],
  'pt-br': ['Por que a mesma nota de cem reais custa vinte e dois reais, cinco dólares, dez dólares, três libras e vinte euros?',
    'Porque a mesma nota de R $100 custa R $ 22, US$5, $10, £3 e 20 €?'],
  hi: ['इसकी कीमत 100 रियल, 5 डॉलर, 3 पाउंड और 20 यूरो है।', 'इसकी कीमत R$100, $5, £3 और 20 € है।'],
};

for (const [language, [script, transcript]] of Object.entries(MONEY_CASES)) {
  test(`an amount with a currency symbol is read as the number and the currency's word: ${language}`, () => {
    const r = alignWords(words(script), said(transcript), 30, language);
    assert.deepEqual(missed(script, r), []);
  });
}

test('"cem reais" heard as "R$ 100,00" is confirmed, and another amount is not', () => {
  assert.equal(alignWords(words('Com cem reais, você'), said('Com R$ 100,00, você'), 3, 'pt-br').matchRate, 1);
  assert.equal(alignWords(words('Com um real'), said('Com R$1'), 3, 'pt-br').matchRate, 1);
  // In English the real is "real" for one and "reais" or "reals" for more.
  assert.equal(alignWords(words('It costs one real today.'), said('It costs R$1 today.'), 3, 'en').matchRate, 1);
  assert.equal(alignWords(words('It costs one real today.'), said('It costs 1 R$ today.'), 3, 'en').matchRate, 1);
  assert.equal(alignWords(words('It costs two reals today.'), said('It costs R$2 today.'), 3, 'en').matchRate, 1);
  assert.deepEqual(missed('Com cem reais', alignWords(words('Com cem reais'), said('Com R$200'), 3, 'pt-br')), ['cem']);
  assert.deepEqual(missed('Com cem reais', alignWords(words('Com cem reais'), said('Com US$100'), 3, 'pt-br')), ['reais']);
});

// Whisper writes several spoken words as one, like "R$100" for "cem reais" or
// "10%" for "dez por cento". The first word starts with it, and the words after
// it get estimated starts, like a word that wasn't heard at all.
test('words whose start was shared out from one heard word, or not heard, are marked estimated', () => {
  const marks = (text, heardText, language = 'pt-br') => alignWords(words(text), said(heardText), 5, language).words.map((w) => (w.estimated ? '~' : '') + (w.matched ? 'ok' : 'no'));
  assert.deepEqual(marks('nota de cem reais compra', 'nota de R $100 compra'), ['ok', 'ok', 'ok', '~ok', 'ok']);
  assert.deepEqual(marks('de dez por cento em', 'de 10% em'), ['ok', 'ok', '~ok', '~ok', 'ok']);
  assert.deepEqual(marks('custar vinte e dois reais.', 'custar R$ 22.'), ['ok', 'ok', '~ok', '~ok', '~ok']);
  assert.deepEqual(marks('It costs five dollars today.', 'It costs $5 today.', 'en'), ['ok', 'ok', 'ok', '~ok', 'ok']);
  assert.deepEqual(marks('See costs at noon.', 'Seacosts at noon.', 'en'), ['ok', '~ok', 'ok', 'ok']);
  assert.deepEqual(marks('No API key needed.', 'No API can needed.', 'en'), ['ok', 'ok', '~no', 'ok']);
  assert.deepEqual(marks('Imagine que um pacote custa', 'Imagine que um pacote custa'), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

// The voice says the formula, and Whisper wrote it with signs.
const MATH_CASES = {
  en: ['like two x squared plus three x minus five equals zero, so x equals minus five halves, three times four, one half and a third.',
    'like 2x^2 + 3x-5 = 0, so x = −5/2, 3×4, 1/2 and 1/3.'],
  de: ['wie 2 x hoch 2 plus 3 x minus 5 gleich 0, also x gleich minus 5 Halbe, 3 mal 4 und ein Drittel.',
    'wie 2x² + 3x - 5 = 0, also x = −5/2, 3 × 4 und 1/3.'],
  es: ['como 2 x al cuadrado más 3 x menos 5 igual a 0, así que x igual a menos 5 medios, 3 por 4 y un tercio.',
    'como 2x² + 3x - 5 = 0, así que x = −5/2, 3 × 4 y 1/3.'],
  fr: ['comme 2 x au carré plus 3 x moins 5 égal 0, donc x égale moins 5 demis, 3 fois 4 et un tiers.',
    'comme 2x² + 3x − 5 = 0, donc x = −5/2, 3 × 4 et 1/3.'],
  it: ['come 2 x al quadrato più 3 x meno 5 uguale a 0, quindi x uguale a meno 5 mezzi, 3 per 4 e un terzo.',
    'come 2x² + 3x - 5 = 0, quindi x = −5/2, 3 × 4 e 1/3.'],
  'pt-br': ['como 2 x ao quadrado mais 3 x menos 5 igual a 0, então x igual a menos 5 meios, 3 vezes 4 e um terço.',
    'como 2x² + 3x - 5 = 0, então x = −5/2, 3 × 4 e 1/3.'],
};

for (const [language, [script, transcript]] of Object.entries(MATH_CASES)) {
  test(`maths that Whisper writes with signs is read the way a voice says it: ${language}`, () => {
    const r = alignWords(words(script), said(transcript), 30, language);
    assert.deepEqual(missed(script, r), []);
    assert.deepEqual(state(r).filter((s) => s !== 'exact'), [], 'no word only nearly matched');
    assert.equal(alignWords(words(transcript), said(script), 30, language).matchRate, 1);
  });
}

test('a fraction takes the reading the other side has, and words that only look like maths stay words', () => {
  assert.equal(alignWords(words('three divided by four'), said('3/4'), 1).matchRate, 1);
  assert.equal(alignWords(words('open twenty four seven'), said('open 24/7'), 1).matchRate, 1);
  assert.equal(alignWords(words('x to the power of five'), said('x^5'), 1).matchRate, 1);
  assert.deepEqual(mathReading('x^5', null, null, 'en', (n) => [n]), ['x', 'to', 'the', 'power', 'of', '5']);
  // A "2x" on its own is no formula, and neither is a hyphen or a date.
  for (const word of ['2x', 'B-52', 'T-5', 'COVID-19', 'x-ray', '9/11/2001', 'and/or', '-', '/']) assert.equal(mathReading(word, 'the', 'one', 'en', (n) => [n]), null, word);
  assert.deepEqual(state(alignWords(words('two x faster'), said('2x faster'), 1)), ['joined:2x', 'joined:2x', 'exact']);
  // Whisper may split a fraction or a power after its number.
  const pieces = (list) => list.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.equal(alignWords(words('x equals minus five halves'), pieces(['x', '=', '-5', '/2']), 2).matchRate, 1);
  assert.equal(alignWords(words('two x squared'), pieces(['2x', '^2']), 1).matchRate, 1);
  // Beside a word for a sign, a "2x" is "2 x" too.
  assert.deepEqual(state(alignWords(words('two x squared plus three x'), said('2x squared plus 3x'), 2)).filter((s) => s !== 'exact'), []);
  assert.deepEqual(state(alignWords(words('2 x más 3 x'), said('2x más 3x'), 2, 'es')).filter((s) => s !== 'exact'), []);
  // Hindi, Japanese and Chinese have no readings for signs yet.
  assert.equal(mathReading('x=1', null, null, 'hi', (n) => [n]), null);
});

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
  // Zeros at the end of the decimals change no value, and a decimal is still never a whole number.
  for (const language of ['es', 'fr', 'it', 'pt-br', 'de']) {
    assert.ok(same(language, 'son 1,50 metros', 'son 1,5 metros'), language);
    assert.ok(same(language, 'son 2,0 metros', 'son 2 metros'), language);
    assert.ok(!same(language, 'son 1,50 metros', 'son 150 metros'), language);
    assert.ok(!same(language, 'son 7,5 metros', 'son 75 metros'), language);
  }
  assert.ok(same('es', 'Recorre 1,50 metros.', 'Recorre 1,5 m.'));
  assert.ok(same('en', 'It is 2.0 meters.', 'It is 2 meters.'));
  assert.ok(same('en', 'about 1.50 meters', 'about 1.5 meters'));
  assert.ok(!same('en', 'about 7.5 meters', 'about 75 meters'));
  assert.ok(same('en', 'It costs $2.50.', 'It costs $2.50.'));
  assert.equal(numberValue('1,50', 'es'), '1,5');
  assert.equal(numberValue('2,0', 'es'), '2');
  assert.equal(numberValue('1.5', 'es'), '1,5', 'only a point fits');
  assert.equal(numberValue('1.500', 'es'), '1500');
  // A script that writes thousands with a space has two words, and both are confirmed by one heard number.
  const spaced = alignWords(words('unos 300 000 años'), heard([['unos', 0, 0.3], ['300.000', 0.3, 0.9], ['años', 0.9, 1.2]]), 1.3, 'es');
  assert.deepEqual(state(spaced), ['exact', 'exact', 'exact', 'exact']);
  assert.deepEqual(times(spaced.words.slice(1, 3)), [[0.3, 0.6], [0.6, 0.9]]);
  // And a number that was not heard leaves both unconfirmed.
  assert.deepEqual(state(alignWords(words('unos 300 000 años'), said('unos 200.000 años'), 1, 'es')).map((s) => s.split(':')[0]), ['exact', 'no', 'no', 'exact']);
});

test('the list of near matches shows sound-alike words and two words heard as one', () => {
  assert.equal(nearlyText([{ word: 'piece', heard: 'peace', alike: true }]), '1 word sounded the same: piece (heard "peace")');
  assert.equal(nearlyText([{ word: 'See', heard: 'Seacosts', joined: true }, { word: 'costs', heard: 'Seacosts', joined: true }, { word: 'Soundroo', heard: 'Soundru' }, { word: 'piece', heard: 'peace', alike: true }]),
    '3 words only nearly matched: See costs (heard "Seacosts"), Soundroo (heard "Soundru"); 1 word sounded the same: piece (heard "peace")');
});

test('punctuation on its own is never a word: it joins its word for the voice, the timings, the captions and the cues', async () => {
  const { parseScript } = await import('../src/script.js');
  const units = (text, language = 'fr') => parseScript(`## a\n${text}`, { language }).scenes[0].units.filter((u) => u.type === 'word');
  const shown = (text, language) => units(text, language).map((u) => u.display);
  assert.deepEqual(shown('Que voit-on après la pluie ?'), ['Que', 'voit-on', 'après', 'la', 'pluie ?']);
  assert.deepEqual(shown('« Bonjour » dit-il : oui ; non !'), ['« Bonjour »', 'dit-il :', 'oui ;', 'non !']);
  assert.deepEqual(shown('¿ Qué pasa ?', 'es'), ['¿ Qué', 'pasa ?']);
  assert.deepEqual(shown('A dash — here.', 'en'), ['A', 'dash —', 'here.']);
  // The voice gets the text as written, with plain spaces.
  const scene = parseScript('## a\nAprès la pluie ?', { language: 'fr' }).scenes[0];
  assert.equal(scene.spoken, 'Après la pluie ?');
  // A sign that is said stays a word, and so does a spelling hint for one.
  assert.deepEqual(shown('Prix : 5 % et {?|point d’interrogation}'), ['Prix :', '5', '%', 'et', '?']);
  // Stars still mark a keyword next to it.
  const starred = units('Une *pluie* !');
  assert.deepEqual([starred[1].display, starred[1].spoken, starred[1].key], ['pluie !', 'pluie !', true]);
  // The speech check never waits for it.
  const words = units('Il faut des gouttes après la pluie ?').map((u) => ({ spoken: u.spoken, display: u.display }));
  const r = alignWords(words, said('Il faut des gouttes après la pluie?'), 3, 'fr');
  assert.deepEqual(state(r), words.map(() => 'exact'));
  assert.equal(r.matchRate, 1);
});

test('a hyphenated word is confirmed by its parts heard as separate words', () => {
  const fr = (script, transcript) => state(alignWords(words(script), said(transcript), 3, 'fr'));
  assert.deepEqual(fr('Voici un arc-en-ciel.', 'Voici un arc en ciel.'), ['exact', 'exact', 'exact']);
  assert.deepEqual(fr('Que voit-on là', 'Que voit on là'), ['exact', 'exact', 'exact']);
  assert.deepEqual(fr('Voici un arc-en-ciel.', 'Voici un arc-en-ciel.'), ['exact', 'exact', 'exact']);
  assert.deepEqual(state(alignWords(words('A well-known fact.'), said('A well known fact.'), 2)), ['exact', 'exact', 'exact']);
  // A part that was never heard still shows.
  assert.deepEqual(fr('Voici un arc-en-ciel.', 'Voici un en ciel.'), ['exact', 'exact', 'near:en ciel']);
});

test('a spelling hint heard with the same sound as its spoken form counts, listed as sounding the same', async () => {
  const site = [{ spoken: 'Publish' }, { spoken: 'it' }, { spoken: 'on' }, { spoken: 'sound roo dot com', display: 'soundroo.com' }, { spoken: 'and' }, { spoken: 'share.' }];
  const r = await alignSpeech(site, said('Publish it on SoundRue.com and share.'), 3);
  assert.deepEqual(state(r), ['exact', 'exact', 'exact', 'alike:SoundRue.com', 'exact', 'exact']);
  assert.equal(r.matchRate, 1);
  assert.deepEqual(nearList(site, r.words), [{ word: 'soundroo.com', heard: 'SoundRue.com', alike: true }]);
  // Over several heard words too, without spaces.
  assert.deepEqual(state(await alignSpeech(site, said('Publish it on Sound Rue dot com and share.'), 3))[3], 'alike:Sound Rue dot com');
  // Another sound is still not confirmed.
  assert.equal(state(await alignSpeech(site, said('Publish it on SoundRay.com and share.'), 3))[3].split(':')[0], 'no');
});
