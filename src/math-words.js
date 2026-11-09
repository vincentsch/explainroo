// Spoken maths for the speech check. Whisper writes "2x squared plus 3x minus
// five equals zero" as "2x² + 3x-5 = 0", and "minus five halves" as "−5/2". The
// long final mix does this more often than the narration alone. Both sides of
// the check read such words the way a voice says them, like units in units.js.
//
// The words are written the way normWord leaves them: lowercase, without
// accents and without apostrophes. A sign with several readings takes the one
// whose words the other side of the check has.

// What each sign is called, by language. `power` reads "^n" for n above 3, with
// "#" for the number. `fraction` names the parts of a whole from 2 to 10, as
// [one part, several parts]. `one` is said before a single part, like "a half".
const SIGNS = {
  en: {
    '+': ['plus'], '-': ['minus', 'negative'], '=': ['equals', 'equal to', 'is equal to', 'equal', 'is'], '×': ['times', 'multiplied by'],
    '/': ['over', 'divided by'], '²': ['squared', 'to the power of #'], '³': ['cubed', 'to the power of #'], power: ['to the power of #', 'to the #'],
    fraction: [['half', 'halves'], ['third', 'thirds'], ['quarter', 'quarters'], ['fifth', 'fifths'], ['sixth', 'sixths'], ['seventh', 'sevenths'], ['eighth', 'eighths'], ['ninth', 'ninths'], ['tenth', 'tenths']],
    one: ['a'],
  },
  es: {
    '+': ['mas'], '-': ['menos'], '=': ['igual a', 'es igual a', 'igual'], '×': ['por', 'multiplicado por'],
    '/': ['entre', 'sobre', 'dividido por', 'dividido entre'], '²': ['al cuadrado', 'cuadrado'], '³': ['al cubo', 'cubo'], power: ['elevado a #', 'a la #'],
    fraction: [['medio', 'medios'], ['tercio', 'tercios'], ['cuarto', 'cuartos'], ['quinto', 'quintos'], ['sexto', 'sextos'], ['septimo', 'septimos'], ['octavo', 'octavos'], ['noveno', 'novenos'], ['decimo', 'decimos']],
    one: ['un'],
  },
  fr: {
    '+': ['plus'], '-': ['moins'], '=': ['egal', 'egal a', 'est egal a'], '×': ['fois', 'multiplie par'],
    '/': ['sur', 'divise par'], '²': ['au carre', 'carre'], '³': ['au cube', 'cube'], power: ['puissance #', 'a la puissance #'],
    fraction: [['demi', 'demis'], ['tiers', 'tiers'], ['quart', 'quarts'], ['cinquieme', 'cinquiemes'], ['sixieme', 'sixiemes'], ['septieme', 'septiemes'], ['huitieme', 'huitiemes'], ['neuvieme', 'neuviemes'], ['dixieme', 'dixiemes']],
    one: ['un'],
  },
  it: {
    '+': ['piu'], '-': ['meno'], '=': ['uguale a', 'e uguale a', 'uguale'], '×': ['per'],
    '/': ['fratto', 'diviso', 'diviso per'], '²': ['al quadrato', 'quadrato'], '³': ['al cubo', 'cubo'], power: ['elevato alla #', 'elevato a #', 'alla #'],
    fraction: [['mezzo', 'mezzi'], ['terzo', 'terzi'], ['quarto', 'quarti'], ['quinto', 'quinti'], ['sesto', 'sesti'], ['settimo', 'settimi'], ['ottavo', 'ottavi'], ['nono', 'noni'], ['decimo', 'decimi']],
    one: ['un'],
  },
  'pt-br': {
    '+': ['mais'], '-': ['menos'], '=': ['igual a', 'e igual a', 'igual'], '×': ['vezes', 'multiplicado por'],
    '/': ['sobre', 'dividido por'], '²': ['ao quadrado', 'quadrado'], '³': ['ao cubo', 'cubo'], power: ['elevado a #', 'elevado na #'],
    fraction: [['meio', 'meios'], ['terco', 'tercos'], ['quarto', 'quartos'], ['quinto', 'quintos'], ['sexto', 'sextos'], ['setimo', 'setimos'], ['oitavo', 'oitavos'], ['nono', 'nonos'], ['decimo', 'decimos']],
    one: ['um'],
  },
  de: {
    '+': ['plus'], '-': ['minus'], '=': ['gleich', 'ist gleich'], '×': ['mal'],
    '/': ['durch', 'geteilt durch'], '²': ['hoch #', 'quadrat'], '³': ['hoch #'], power: ['hoch #'],
    fraction: [['halb', 'halbe'], ['drittel', 'drittel'], ['viertel', 'viertel'], ['funftel', 'funftel'], ['sechstel', 'sechstel'], ['siebtel', 'siebtel'], ['achtel', 'achtel'], ['neuntel', 'neuntel'], ['zehntel', 'zehntel']],
    one: ['ein'],
  },
};

const strip = (word) => String(word ?? '').trim().replace(/^[("'“‘«¿¡[]+/u, '').replace(/[.,;:!?…)"'’”»\]]+$/u, '');
// The signs as one character each.
const plain = (text) => strip(text).toLowerCase().replace(/[−–]/g, '-').replace(/[·*✕]/g, '×');

const NUMBER = /\d+(?:[.,]\d+)?/y;
const LETTER = /\p{L}(?!\p{L})/uy;
const SIGN = /\^\d+|[²³+\-=/×]/y;

// The parts of a written formula, like "2x²-5", as [{ number }, { letter },
// { sign }], or null when the word is no formula.
function parse(text) {
  const parts = [];
  let at = 0;
  while (at < text.length) {
    let m = null;
    for (const [re, kind] of [[NUMBER, 'number'], [LETTER, 'letter'], [SIGN, 'sign']]) {
      re.lastIndex = at;
      m = re.exec(text);
      if (m) {
        parts.push({ [kind]: m[0] });
        break;
      }
    }
    if (!m) return null;
    at += m[0].length;
  }
  return parts;
}

// Whether a word is a sign or a formula, so a "2x" beside it is "2 x".
const isSign = (text) => /^[+=×]$/.test(text);
export function isFormula(word) {
  const text = plain(word);
  if (isSign(text)) return true;
  const parts = parse(text);
  return Boolean(parts?.some((p) => p.sign)) && formulaParts(parts) !== null;
}

// Checks a parsed word: every sign has something to work on, and a "-" between
// a letter and a number is a hyphen, like "T-5", unless another sign shows that
// the word is a formula.
function formulaParts(parts) {
  const signs = parts.filter((p) => p.sign);
  if (!signs.length) return parts;
  const strong = signs.some((p) => /[²³^+=×]/.test(p.sign));
  const slashes = signs.filter((p) => p.sign === '/').length;
  // Dates like 9/11/2001 are no formula.
  if (slashes > 1 && !strong) return null;
  for (let i = 0; i < parts.length; i++) {
    const { sign } = parts[i];
    if (!sign) continue;
    const prev = parts[i - 1];
    const next = parts[i + 1];
    if (sign === '-') {
      if (!next || next.sign) return null;
      // At the start or after another sign it is a minus before a number.
      if (prev && !prev.sign && !strong && !prev.number && !(parts[i - 2]?.number && prev.letter)) return null;
    } else if (/^[²³^]/.test(sign)) {
      if (prev?.sign && !/^[²³^]/.test(prev.sign)) return null;
    } else if (!prev || prev.sign && !/^[²³^]/.test(prev.sign) || !next || next.sign && next.sign !== '-') {
      return null;
    }
  }
  return parts;
}

// The ways to say each part, as lists of tokens. `number` reads a number the
// way the language does.
function readings(parts, signs, number) {
  const say = (form, n) => form.split(' ').flatMap((t) => (t === '#' ? number(n) : [t]));
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.number) out.push([number(p.number)]);
    else if (p.letter) out.push([[p.letter]]);
    else if (p.sign === '²' || p.sign === '³') out.push(signs[p.sign].map((f) => say(f, p.sign === '²' ? '2' : '3')));
    else if (p.sign.startsWith('^')) {
      const n = p.sign.slice(1);
      out.push((signs[{ 2: '²', 3: '³' }[n]] ?? signs.power).map((f) => say(f, n)));
    } else if (p.sign === '/' && parts[i - 1]?.number && parts[i + 1]?.number && /^\d+$/.test(parts[i - 1].number) && /^\d+$/.test(parts[i + 1].number)) {
      // A simple fraction, like 5/2: "five halves", "five over two" or "five two".
      const top = parts[i - 1].number;
      const bottom = parts[i + 1].number;
      const named = signs.fraction[Number(bottom) - 2];
      const ways = signs['/'].map((f) => [...say(f), ...number(bottom)]);
      ways.push(number(bottom));
      out.pop();
      if (named) {
        const word = named[top === '1' ? 0 : 1];
        const first = [[...number(top), word], ...ways.map((w) => [...number(top), ...w])];
        if (top === '1') first.push(...signs.one.map((a) => [a, word]));
        out.push(first);
      } else {
        out.push(ways.map((w) => [...number(top), ...w]));
      }
      i++;
    } else out.push(signs[p.sign].map((f) => say(f)));
  }
  return out;
}

// The reading that the other side says word for word, or else the one with the
// most of its words there and the fewest missing. The first one wins a tie.
function pick(ways, other) {
  if (ways.length === 1 || !other.length) return ways[0];
  const line = ` ${other.join(' ')} `;
  const words = new Set(other);
  const score = (r) => (line.includes(` ${r.join(' ')} `) ? 100 : 0) + r.reduce((n, t) => n + (words.has(t) ? 1 : -1), 0);
  return ways.reduce((a, b) => (score(b) > score(a) ? b : a));
}

// A word as the tokens a voice says for it, like "2x²" as "2 x squared", or
// null when it is no formula. `before` and `after` are the words around it: a
// "2x" beside a formula or a word like "squared" is "2 x", and a lone "-" or "/" between numbers is a
// sign. `other` holds the words of the other side of the check, in order.
export function mathReading(word, before, after, language, number, other = []) {
  const signs = SIGNS[language];
  if (!signs) return null;
  const text = plain(word);
  if (!text || !/[\d²³+\-=/×^]|^\p{L}$/u.test(text)) return null;
  const operand = (w) => /^-?\d|^\p{L}$/u.test(plain(w));
  let parts;
  if (isSign(text) || (/^[-/]$/.test(text) && operand(after) && (text === '-' || operand(before)))) parts = [{ sign: text }];
  else {
    parts = parse(text);
    if (!parts) return null;
    if (!parts.some((p) => p.sign)) {
      // A number with a letter, like "2x", is "2 x" only beside a formula or
      // a word for a sign, like "squared" in "2x squared".
      const coefficient = parts.length === 2 && parts[0].number && parts[1].letter;
      const words = signWords(language);
      const maths = (w) => w !== null && w !== undefined && (isFormula(w) || words.has(plain(w).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')));
      if (!coefficient || !(maths(before) || maths(after))) return null;
    } else if (!formulaParts(parts)) return null;
  }
  return readings(parts, signs, number).flatMap((ways) => pick(ways, other));
}

// Everyday words that are also in a reading, like "is" in "is equal to".
const EVERYDAY = new Set(['is', 'to', 'the', 'of', 'by', 'a', 'al', 'ao', 'la', 'e', 'est', 'ist', 'par', 'per', 'por', 'na', 'un', 'um', 'ein', 'alla', 'entre', 'sobre', 'sur', 'durch', 'mal', 'cube', 'cubo', 'quarto', 'quart', 'quarter', 'second', 'secondo', 'segundo']);

// The words a language says for signs and fractions, like "minus", "squared"
// and "halves", without everyday words.
export function signWords(language) {
  const signs = SIGNS[language];
  if (!signs) return new Set();
  const all = [...Object.entries(signs).flatMap(([key, forms]) => (key === 'one' ? [] : forms.flat())), ...signs.fraction.flat()];
  return new Set(all.flatMap((form) => form.split(' ')).filter((t) => t !== '#' && !EVERYDAY.has(t)));
}
