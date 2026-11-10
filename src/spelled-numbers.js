// Spelled numbers in Spanish, French, Italian and Brazilian Portuguese for the
// speech check. A voice says "cinco" for "5", and Whisper writes either one, so
// both sides of the check read a spelled number as its digits: "treinta y
// cinco" and "35" are both "35", "dix-sept" and "17" are both "17", and "tres
// coma cinco" and "3,5" are both "3,5", the way units.js writes a value. It
// reads whole numbers from 0 to 9,999 and simple decimals. German has its own
// rules in german.js.
//
// The words are written the way normWord leaves them: lowercase, without
// accents, apostrophes and hyphens, so "quatre-vingt-dix" is "quatrevingtdix".
import { decimalDigits } from './units.js';

// The kinds of number words: a unit from 0 to 9, a teen from 10 to 19, a ten,
// a whole hundred said in one word (like "doscientos"), "cent" or "cento",
// which multiply what comes before them, and the word for a thousand.
const UNIT = 'unit';
const TEEN = 'teen';
const TEN = 'ten';
const HUNDREDS = 'hundreds';
const TIMES_100 = 'times100';
const THOUSAND = 'thousand';
const AND = 'and';

const words = (kind, list) => Object.fromEntries(Object.entries(list).map(([w, v]) => [w, { kind, v }]));

const SPANISH_HUNDREDS = Object.fromEntries(['dos', 'tres', 'cuatro', 'seis', 'siete', 'ocho', 'nueve'].flatMap((n, i) => {
  const value = [2, 3, 4, 6, 7, 8, 9][i] * 100;
  const stem = { siete: 'sete', nueve: 'nove' }[n] ?? n;
  return [[`${stem}cientos`, value], [`${stem}cientas`, value]];
}));

const LEXICON = {
  es: {
    ...words(UNIT, { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 }),
    ...words(TEEN, { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19 }),
    // 21 to 29 are one word each, so nothing goes on after them, like after a unit.
    ...words(UNIT, { veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 }),
    ...words(TEN, { veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 }),
    ...words(HUNDREDS, { cien: 100, ciento: 100, quinientos: 500, quinientas: 500, ...SPANISH_HUNDREDS }),
    ...words(THOUSAND, { mil: 1000 }),
    ...words(AND, { y: 0 }),
  },
  fr: {
    ...words(UNIT, { zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9 }),
    ...words(TEEN, { dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, dixsept: 17, dixhuit: 18, dixneuf: 19 }),
    ...words(TEN, { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, quatrevingt: 80, quatrevingts: 80, huitante: 80, octante: 80, nonante: 90 }),
    ...words(TIMES_100, { cent: 100, cents: 100 }),
    ...words(THOUSAND, { mille: 1000, mil: 1000 }),
    ...words(AND, { et: 0 }),
  },
  it: {
    ...words(UNIT, { zero: 0, un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9 }),
    ...words(TEEN, { dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19 }),
    // A ten loses its last vowel before "uno" and "otto", like "ventuno" and "trentotto".
    ...words(TEN, { venti: 20, vent: 20, trenta: 30, trent: 30, quaranta: 40, quarant: 40, cinquanta: 50, cinquant: 50, sessanta: 60, sessant: 60, settanta: 70, settant: 70, ottanta: 80, ottant: 80, novanta: 90, novant: 90 }),
    ...words(TIMES_100, { cento: 100, cent: 100 }),
    ...words(THOUSAND, { mille: 1000, mila: 1000 }),
  },
  'pt-br': {
    ...words(UNIT, { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 }),
    ...words(TEEN, { dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19 }),
    ...words(TEN, { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 }),
    ...words(HUNDREDS, {
      cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
      seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
    }),
    ...words(THOUSAND, { mil: 1000 }),
    ...words(AND, { e: 0 }),
  },
};

// The word for the decimal point, and the words before "cent" in a percentage,
// where "cent" is no number.
const POINT = { es: ['coma', 'punto'], fr: ['virgule', 'point'], it: ['virgola', 'punto'], 'pt-br': ['virgula', 'ponto'] };
const PER = { es: 'por', fr: 'pour', it: 'per', 'pt-br': 'por' };

export const SPELLED_LANGUAGES = Object.keys(LEXICON);

// A word as its number words, like "dixsept" as [dixsept] and "trentotto" as
// [trent, otto], or null. Longer pieces are tried first.
function pieces(word, lexicon) {
  if (lexicon[word]) return [word];
  for (let at = word.length - 1; at > 0; at--) {
    const head = word.slice(0, at);
    if (!lexicon[head]) continue;
    const rest = pieces(word.slice(at), lexicon);
    if (rest) return [head, ...rest];
  }
  return null;
}

// Adds a number word to a running number, as { total, part, last }, or returns
// null when the word can't go on with it. `part` is the number after the
// thousand, and `last` the word before.
function add(state, piece, language) {
  const { total, part, last } = state;
  const { kind, v } = piece;
  const low = part % 100;
  const next = (n) => ({ total, part: n, last: piece });
  if (kind === UNIT) {
    if (v === 0) return last ? null : next(0);
    if (low === 0 && last?.kind !== UNIT && last?.kind !== TEEN) return next(part + v);
    if ((last?.kind === TEN || last?.kind === AND) && low >= 20 && low % 10 === 0) return next(part + v);
    return null;
  }
  if (kind === TEEN) {
    if (low === 0 && last?.kind !== UNIT) return next(part + v);
    // French says 70 and 90 as 60 and 80 with a teen, like "soixante-dix-sept",
    // and 71 as "soixante et onze".
    if (language === 'fr' && (low === 60 || low === 80) && (last?.kind === TEN || (last?.kind === AND && v === 11))) return next(part + v);
    return null;
  }
  if (kind === TEN) return low === 0 && last?.kind !== UNIT ? next(part + v) : null;
  if (kind === HUNDREDS) return part === 0 ? next(v) : null;
  if (kind === TIMES_100) return part < 10 && last?.kind !== TIMES_100 ? next((part || 1) * 100) : null;
  if (kind === THOUSAND) return total || part >= 10 ? null : { total: (part || 1) * 1000, part: 0, last: piece };
  return null;
}

// Whether "and" may come next: Spanish "y" between a ten and a unit, French "et"
// between a ten and "un" or "onze", and Portuguese "e" after a ten, a hundred
// or a thousand.
function andFits(state, following, language) {
  if (!following || !state.last) return false;
  const { kind } = state.last;
  if (language === 'es') return kind === TEN && following.kind === UNIT && following.v > 0 && following.v < 10;
  if (language === 'fr') return kind === TEN && ((following.kind === UNIT && following.v === 1) || (following.kind === TEEN && following.v === 11));
  if (language === 'pt-br') return kind === TEN || kind === HUNDREDS || kind === THOUSAND;
  return false;
}

// Reads number words from `at` on, as { value, length } in words, or null. A
// word counts only when all its pieces fit, and a number never ends on "and".
function readWhole(list, at, lexicon, language) {
  let state = { total: 0, part: 0, last: null };
  let found = null;
  for (let i = at; i < list.length && list[i]; i++) {
    const parts = list[i];
    for (let k = 0; state && k < parts.length; k++) {
      const piece = lexicon[parts[k]];
      if (piece.kind === AND) {
        const following = k + 1 < parts.length ? lexicon[parts[k + 1]] : list[i + 1] ? lexicon[list[i + 1][0]] : null;
        state = andFits(state, following, language) ? { ...state, last: piece } : null;
      } else state = add(state, piece, language);
    }
    if (!state) break;
    if (state.last.kind !== AND) found = { value: state.total + state.part, length: i - at + 1 };
  }
  return found;
}

// For each word of a list, the tokens of a spelled number that starts there, an
// empty list for a word that belongs to the number before it, or undefined for
// a word that is no spelled number. `plain` makes a word as normWord does.
export function spelledNumbers(list, language, plain) {
  const lexicon = LEXICON[language];
  const out = list.map(() => undefined);
  if (!lexicon) return out;
  const norm = list.map((w) => String(plain(w) ?? ''));
  const parts = norm.map((w) => (/^\p{L}+$/u.test(w) ? pieces(w, lexicon) : null));
  for (let i = 0; i < list.length; i++) {
    // "cent" in "pour cent" belongs to the percentage.
    if (!parts[i] || (i && norm[i - 1] === PER[language] && lexicon[parts[i][0]]?.kind !== UNIT)) continue;
    const whole = readWhole(parts, i, lexicon, language);
    if (!whole) continue;
    let length = whole.length;
    let value = String(whole.value);
    // Decimals: a point word, then one number or digits said one by one.
    if (POINT[language].includes(norm[i + length])) {
      let digits = '';
      let at = i + length + 1;
      const first = parts[at] ? readWhole(parts, at, lexicon, language) : null;
      if (first) {
        digits = String(first.value);
        at += first.length;
        // A zero first, like "coma cero cinco", and more single digits go on.
        while (first.value < 10 && parts[at] && parts[at].length === 1 && lexicon[parts[at][0]].kind === UNIT && lexicon[parts[at][0]].v < 10) {
          digits += String(lexicon[parts[at][0]].v);
          at++;
        }
        length = at - i;
        const point = decimalDigits(digits);
        value = point ? `${value},${point}` : value;
      }
    }
    out[i] = [value];
    for (let k = 1; k < length; k++) out[i + k] = [];
    i += length - 1;
  }
  return out;
}

// A single number word as its digits, like "un" as "1", or the word unchanged.
export function spelledToken(token, language) {
  const lexicon = LEXICON[language];
  const piece = lexicon?.[token];
  return piece && piece.kind !== AND && piece.kind !== TIMES_100 ? String(piece.v) : token;
}
