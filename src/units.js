// Units, symbols and number formats for the speech check. Whisper writes
// "300.000 km/s" or "5 %" where the voice said "trescientos mil kilómetros por
// segundo" or "cinco por ciento", so both sides of the check read units and
// symbols as the words of the language, and numbers by their value.
//
// The words are written the way normWord leaves them: lowercase, without
// accents and without apostrophes.

// What each unit is called, by language. The first reading is the usual one.
// A unit with several readings takes the one whose words the other side of the
// check has, so "km/h" matches "kilomètres par heure" and "kilomètres-heure".
const UNITS = {
  en: {
    km: ['kilometers'], 'km/h': ['kilometers per hour', 'kilometers an hour'], 'km/s': ['kilometers per second', 'kilometers a second'],
    m: ['meters'], cm: ['centimeters'], mm: ['millimeters'], kg: ['kilograms'], g: ['grams'], s: ['seconds'], ms: ['milliseconds'],
    '%': ['percent', 'per cent'], '°c': ['degrees celsius'], '€': ['euros'], $: ['dollars'],
  },
  es: {
    km: ['kilometros'], 'km/h': ['kilometros por hora'], 'km/s': ['kilometros por segundo'],
    m: ['metros'], cm: ['centimetros'], mm: ['milimetros'], kg: ['kilogramos'], g: ['gramos'], s: ['segundos'], ms: ['milisegundos'],
    '%': ['por ciento', 'porciento'], '°c': ['grados celsius', 'grados centigrados', 'grados'], '€': ['euros'], $: ['dolares'],
  },
  fr: {
    km: ['kilometres'], 'km/h': ['kilometres par heure', 'kilometres heure', 'kilometres a lheure'], 'km/s': ['kilometres par seconde', 'kilometres seconde'],
    m: ['metres'], cm: ['centimetres'], mm: ['millimetres'], kg: ['kilogrammes'], g: ['grammes'], s: ['secondes'], ms: ['millisecondes'],
    '%': ['pour cent', 'pourcent'], '°c': ['degres celsius', 'degres'], '€': ['euros'], $: ['dollars'],
  },
  it: {
    km: ['chilometri'], 'km/h': ['chilometri orari', 'chilometri allora', 'chilometri lora', 'chilometri per ora'], 'km/s': ['chilometri al secondo', 'chilometri per secondo'],
    m: ['metri'], cm: ['centimetri'], mm: ['millimetri'], kg: ['chilogrammi'], g: ['grammi'], s: ['secondi'], ms: ['millisecondi'],
    '%': ['per cento', 'percento'], '°c': ['gradi celsius', 'gradi centigradi', 'gradi'], '€': ['euro'], $: ['dollari'],
  },
  'pt-br': {
    km: ['quilometros'], 'km/h': ['quilometros por hora'], 'km/s': ['quilometros por segundo'],
    m: ['metros'], cm: ['centimetros'], mm: ['milimetros'], kg: ['quilogramas'], g: ['gramas'], s: ['segundos'], ms: ['milissegundos'],
    '%': ['por cento', 'porcento'], '°c': ['graus celsius', 'graus'], '€': ['euros'], $: ['dolares'],
  },
  de: {
    km: ['kilometer'], 'km/h': ['kilometer pro stunde', 'stundenkilometer'], 'km/s': ['kilometer pro sekunde'],
    m: ['meter'], cm: ['zentimeter'], mm: ['millimeter'], kg: ['kilogramm'], g: ['gramm'], s: ['sekunden'], ms: ['millisekunden'],
    '%': ['prozent'], '°c': ['grad celsius', 'grad'], '€': ['euro'], $: ['dollar'],
  },
};

// Other ways to write a unit word, as the word above. So "1 kilómetro" and
// "1 km" agree, and so do "kilometre" and "kilometers".
const SAME = {
  en: {
    kilometer: 'kilometers', kilometre: 'kilometers', kilometres: 'kilometers', meter: 'meters', metre: 'meters', metres: 'meters',
    centimeter: 'centimeters', centimetre: 'centimeters', centimetres: 'centimeters', millimeter: 'millimeters', millimetre: 'millimeters', millimetres: 'millimeters',
    kilogram: 'kilograms', kilo: 'kilograms', kilos: 'kilograms', gram: 'grams', gramme: 'grams', grammes: 'grams',
    second: 'seconds', millisecond: 'milliseconds', degree: 'degrees', euro: 'euros', dollar: 'dollars',
  },
  es: {
    kilometro: 'kilometros', metro: 'metros', centimetro: 'centimetros', milimetro: 'milimetros', kilogramo: 'kilogramos', kilo: 'kilogramos', kilos: 'kilogramos',
    gramo: 'gramos', segundo: 'segundos', milisegundo: 'milisegundos', grado: 'grados', euro: 'euros', dolar: 'dolares',
  },
  fr: {
    kilometre: 'kilometres', metre: 'metres', centimetre: 'centimetres', millimetre: 'millimetres', kilogramme: 'kilogrammes', kilo: 'kilogrammes', kilos: 'kilogrammes',
    gramme: 'grammes', seconde: 'secondes', milliseconde: 'millisecondes', degre: 'degres', euro: 'euros', dollar: 'dollars',
  },
  it: {
    chilometro: 'chilometri', metro: 'metri', centimetro: 'centimetri', millimetro: 'millimetri', chilogrammo: 'chilogrammi', chilo: 'chilogrammi', chili: 'chilogrammi',
    grammo: 'grammi', secondo: 'secondi', millisecondo: 'millisecondi', grado: 'gradi', dollaro: 'dollari',
  },
  'pt-br': {
    quilometro: 'quilometros', metro: 'metros', centimetro: 'centimetros', milimetro: 'milimetros', quilograma: 'quilogramas', quilo: 'quilogramas', quilos: 'quilogramas',
    grama: 'gramas', segundo: 'segundos', milissegundo: 'milissegundos', grau: 'graus', euro: 'euros', dolar: 'dolares',
  },
  de: {
    kilometern: 'kilometer', metern: 'meter', zentimetern: 'zentimeter', millimetern: 'millimeter', kilo: 'kilogramm', kilos: 'kilogramm',
    sekunde: 'sekunden', millisekunde: 'millisekunden',
  },
};

// The same word for a unit in every form, like "kilometers" for "kilometre".
export function sameUnitWord(token, language) {
  return SAME[language]?.[token] ?? token;
}

// Short units that are also letters or sounds, like "s" or "mm", count only
// right after a number: "10 s" is ten seconds, and "s" alone stays a letter.
const AFTER_NUMBER = new Set(['m', 'g', 's', 'ms', 'mm']);

const NUMBER = String.raw`\d(?:[\d.,'’\s]*\d)?`;
const UNIT = String.raw`km\/h|km\/s|km|cm|mm|kg|ms|m|g|s|%|°[cC]|€|\$`;
// A number with a unit after it, a unit alone, or a currency before a number.
const WITH_UNIT = new RegExp(`^(${NUMBER})?\\s?(${UNIT})$`);
const CURRENCY_FIRST = new RegExp(`^([€$])\\s?(${NUMBER})$`);

const strip = (word) => String(word ?? '').trim().replace(/^[("'“‘«¿¡[]+/u, '').replace(/[.,;:!?…)"'’”»\]]+$/u, '');

// A word as a number and a unit, like "300km/s" or "€5", or null. `before` is
// the word before it. `other` holds the words of the other side of the check, in
// order. English money and German numbers with signs keep the rules of their
// language, which also read cents and decimals.
export function unitReading(word, before, language, other = []) {
  const forms = UNITS[language];
  if (!forms) return null;
  const text = strip(word);
  let number = null;
  let unit = null;
  const first = CURRENCY_FIRST.exec(text);
  if (first) [, unit, number] = first;
  else {
    const m = WITH_UNIT.exec(text);
    if (!m) return null;
    [, number = null, unit] = m;
  }
  unit = unit.toLowerCase();
  if (number === null && AFTER_NUMBER.has(unit) && !/\d$/.test(strip(before))) return null;
  if (language === 'en' && ['%', '$', '€'].includes(unit) && number !== null && (first || unit === '%')) return null;
  if (language === 'de' && ['%', '$', '€', '°c'].includes(unit) && number !== null) return null;
  const readings = forms[unit].map((r) => r.split(' '));
  if (readings.length === 1) return { number, tokens: readings[0] };
  // The reading that the other side says word for word, or else the one with
  // the most of its words there and the fewest missing.
  const line = ` ${other.join(' ')} `;
  const words = new Set(other);
  const score = (r) => (line.includes(` ${r.join(' ')} `) ? 100 : 0) + r.reduce((n, t) => n + (words.has(t) ? 1 : -1), 0);
  return { number, tokens: readings.reduce((a, b) => (score(b) > score(a) ? b : a)) };
}

// How a language writes the decimal point. Every other separator between digits
// groups thousands: a space, a thin space, a period, a comma or an apostrophe.
const POINT = { en: '.', hi: '.' };

// Decimals without the zeros at their end, which change no value: "50" gives "5",
// and "0" gives nothing.
export const decimalDigits = (digits) => digits.replace(/0+$/, '');

// A number written with digits, as its value: "300.000", "300 000" and "300000"
// in Spanish all give "300000", "7,5" gives "7,5", and "1,50" gives "1,5", like
// "2,0" gives "2". Hindi groups by lakh, like "3,00,000". A number that only
// reads with a period as its point, like "1.5" in Spanish, reads that way.
// Returns null for anything else.
export function numberValue(word, language) {
  const text = strip(word).replace(/[\s'’]/g, ' ');
  if (!/^\d(?:[\d., ]*\d)?$/.test(text)) return null;
  const point = POINT[language] ?? ',';
  return valueWith(text, point, language) ?? (point === ',' ? valueWith(text, '.', language) : null);
}

function valueWith(text, point, language) {
  let whole = text;
  let decimals = null;
  const at = text.lastIndexOf(point);
  if (at !== -1 && text.indexOf(point) === at) {
    whole = text.slice(0, at);
    decimals = decimalDigits(text.slice(at + 1));
    if (!/^\d*$/.test(decimals)) return null;
  }
  const groups = whole.split(/[., ]/);
  const grouped = groups.length === 1 || (/^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g, i, rest) => g.length === 3 || (language === 'hi' && g.length === 2 && i < rest.length - 1)));
  if (!grouped) return null;
  return groups.join('') + (decimals ? `,${decimals}` : '');
}

// Thousands written with spaces reach the check as separate words, like "300"
// and "000". For each word, the index of the word that starts its number, so the
// first word can read the whole number.
export function numberGroups(texts) {
  const lead = texts.map((_, i) => i);
  for (let i = 1; i < texts.length; i++) {
    const prev = String(texts[i - 1]).trim();
    const starts = lead[i - 1] === i - 1 ? /^[€$£]?\d{1,3}$/.test(prev) : /^\d{3}$/.test(prev);
    if (starts && /^\d{3}(?!\d)/.test(String(texts[i]).trim())) lead[i] = lead[i - 1];
  }
  return lead;
}
