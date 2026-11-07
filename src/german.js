// German rules for the speech check and for sentence ends. They read a word
// before normWord cleans it, because normWord would turn "3,5" into "35" and "3."
// into "3". Every other language keeps its own rules.

// Short forms, what a voice says for them, and when a period in them goes on
// inside the sentence: "always", or "lowercase" when the next word starts with a
// lowercase letter. Without goesOn, a period at the end ends the sentence.
export const SHORT_FORMS = [
  { written: 'z. B.', spoken: 'zum Beispiel', goesOn: 'always' },
  { written: 'd. h.', spoken: 'das heißt', goesOn: 'always' },
  { written: 'u. a.', spoken: 'unter anderem', goesOn: 'always' },
  { written: 'usw.', spoken: 'und so weiter', goesOn: 'lowercase' },
  { written: 'bzw.', spoken: 'beziehungsweise', goesOn: 'always' },
  { written: 'ca.', spoken: 'circa', goesOn: 'always' },
  { written: 'etc.', spoken: 'et cetera', goesOn: 'lowercase' },
  { written: 'Nr.', spoken: 'Nummer', goesOn: 'always' },
  { written: 'Dr.', spoken: 'Doktor', goesOn: 'always' },
  { written: 'Mio.', spoken: 'Millionen' },
  { written: 'Mrd.', spoken: 'Milliarden' },
  { written: 'km', spoken: 'Kilometer' },
  { written: 'kg', spoken: 'Kilogramm' },
  { written: 'km/h', spoken: 'Kilometer pro Stunde' },
  { written: '°C', spoken: 'Grad Celsius' },
  { written: '%', spoken: 'Prozent' },
  { written: '€', spoken: 'Euro' },
];

// Words that voices and Whisper write in more than one way.
const SAME_WORDS = { zirka: ['circa'], etcetera: ['et', 'cetera'], million: ['millionen'], milliarde: ['milliarden'], billion: ['billionen'] };

// The large numbers that stay words. They are numbers, so like digits they only
// match themselves: "Millionen" never matches "Milliarden".
const SCALES = new Set(['millionen', 'milliarden', 'billionen']);
export const isScale = (token) => SCALES.has(token);

// An ordinal in a sentence comes after one of these words or before a month.
const ORDINAL_BEFORE = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'am', 'im', 'zum', 'zur', 'vom', 'beim']);
const MONTHS = new Set(['januar', 'janner', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']);

// Lowercase letters and digits, without accents and umlaut dots, with ß as ss.
function plain(word) {
  return String(word ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]/gu, '');
}

// The word without quotes or brackets around it and without punctuation after
// it, except a period, which can belong to a short form or an ordinal.
function core(word) {
  return String(word ?? '').trim().replace(/^[^\p{L}\p{N}€$£%°]+/u, '').replace(/[,;:!?…"'’”»)\]]+$/u, '');
}

// A short form as the table knows it, like "z.b" for "z. B." or "zB.".
const key = (written) => written.toLowerCase().replace(/ß/g, 'ss').replace(/\s+/g, '').replace(/\.$/, '');
const FORMS = new Map(SHORT_FORMS.map((form) => [key(form.written), form]));
const shortForm = (word) => FORMS.get(key(core(word)));
// The two halves of "z. B.", each with the word it belongs with.
const halves = (first, second) => (/^\p{L}\.$/u.test(core(first)) && /^\p{L}\.$/u.test(core(second)) ? FORMS.get(key(core(first) + core(second))) : undefined);

// German numbers written as one word, like "zweiundvierzig", "dreihundertzwölf"
// or "neunzehnhundertneunzig", as a number. "ein" counts as 1 inside a word.
const UNITS = { eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TEENS = { zehn: 10, elf: 11, zwolf: 12, dreizehn: 13, vierzehn: 14, funfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const TENS = { zwanzig: 20, dreissig: 30, vierzig: 40, funfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const TENS_COMPOUND = new RegExp(`^(ein|zwei|drei|vier|funf|sechs|sieben|acht|neun)und(${Object.keys(TENS).join('|')})$`);

function below100(s) {
  const n = UNITS[s] ?? TEENS[s] ?? TENS[s];
  if (n !== undefined) return n;
  const m = TENS_COMPOUND.exec(s);
  return m ? (m[1] === 'ein' ? 1 : UNITS[m[1]]) + TENS[m[2]] : null;
}

// "hundert", "einhundert", "dreihundertzwolf", and years like "neunzehnhundertneunzig".
function times(s, word, below, size) {
  const at = s.indexOf(word);
  if (at === -1) return below(s);
  const head = s.slice(0, at);
  const tail = s.slice(at + word.length).replace(/^und/, '');
  const count = head === '' || head === 'ein' ? 1 : below(head);
  const rest = tail === '' ? 0 : below(tail);
  if (!count || rest === null || rest >= size) return null;
  return count * size + rest;
}

export function germanNumber(word) {
  const s = plain(word);
  if (s === 'null') return 0;
  return times(s, 'tausend', (part) => times(part, 'hundert', below100, 100), 1000);
}

// Ordinals with any ending, like "dritte", "dritten" or "neunzehnten": the
// number they count. Below 20 the ordinal adds -t, from 20 on -st, and four
// have forms of their own.
const OWN_ORDINALS = [['erst', 'eins'], ['dritt', 'drei'], ['siebent', 'sieben'], ['siebt', 'sieben'], ['acht', 'acht']];

export function germanOrdinal(word) {
  const m = /^(.+?)(?:e|er|en|es|em)$/.exec(plain(word));
  if (!m) return null;
  const stem = m[1];
  for (const [ending, cardinal] of OWN_ORDINALS) {
    if (stem.endsWith(ending)) return germanNumber(stem.slice(0, -ending.length) + cardinal);
  }
  const high = stem.endsWith('st') ? germanNumber(stem.slice(0, -2)) : null;
  if (high !== null && high >= 20) return high;
  const low = stem.endsWith('t') ? germanNumber(stem.slice(0, -1)) : null;
  return low !== null && low % 100 > 0 && low % 100 < 20 ? low : null;
}

const SIGNS = { '%': ['prozent'], '€': ['euro'], $: ['dollar'], '£': ['pfund'], '°': ['grad'], '°c': ['grad', 'celsius'] };
// Digits with a period for thousands and a comma for decimals, with a sign before
// or after them, like "1.000", "3,5", "29.", "5%" or "€5".
const DIGITS = /^([€$£]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?([%€$£]|°c?)?\.?$/i;

// Digits with "hundert" or "tausend" after them, as Whisper sometimes writes a
// year it heard, like "19-hundert" for 1900 or "2-tausend-24" for 2024.
const DIGITS_TIMES = /^(\d{1,2})-?(hundert|tausend)(?:-?(.+))?$/;

function digitsTimes(lower) {
  const m = DIGITS_TIMES.exec(lower);
  if (!m) return null;
  const size = m[2] === 'hundert' ? 100 : 1000;
  const rest = m[3] === undefined ? 0 : /^\d+$/.test(m[3]) ? Number(m[3]) : germanNumber(m[3]);
  return rest !== null && rest < size ? Number(m[1]) * size + rest : null;
}

// The tokens a voice says for one word, or null for an ordinary word.
function special(word) {
  const c = core(word);
  const lower = c.toLowerCase();
  const digits = DIGITS.exec(lower);
  if (digits) {
    const [, before, whole, decimals, after] = digits;
    return [whole.replace(/\./g, ''), ...(decimals !== undefined ? ['komma', ...decimals] : []), ...(SIGNS[before] ?? []), ...(SIGNS[after] ?? [])];
  }
  const joined = digitsTimes(lower.replace(/\.$/, ''));
  if (joined !== null) return [String(joined)];
  const form = shortForm(word);
  if (form) return form.spoken.split(' ').map(plain);
  const s = plain(c);
  if (SAME_WORDS[s]) return SAME_WORDS[s];
  if (!s || /\d/.test(s)) return null;
  const n = germanNumber(s) ?? germanOrdinal(s);
  return n === null ? null : [String(n)];
}

// Each written or heard word as the tokens a voice says for it. `plainWord`
// makes the token of an ordinary word. Both sides of the speech check are read
// this way, so "1990" and "neunzehnhundertneunzig" both become "1990", "z. B."
// and "zum Beispiel" both become "zum beispiel", and "3,5" becomes
// "3 komma 5", like "drei Komma fünf", and never "35".
export function readGerman(words, plainWord) {
  const out = words.map((word) => special(word));
  words.forEach((word, i) => {
    const form = i + 1 < words.length ? halves(word, words[i + 1]) : undefined;
    if (!form) return;
    const [first, ...rest] = form.spoken.split(' ').map(plain);
    out[i] = [first];
    out[i + 1] = rest;
  });
  const read = [];
  out.forEach((tokens, i) => {
    const word = plainWord(words[i]).replace(/ß/g, 'ss');
    let next = tokens ?? (word ? [word] : []);
    // The digits after "Komma" are read one by one, like "Komma zwei vier".
    if (read[i - 1]?.at(-1) === 'komma' && next.length === 1 && /^\d{2,}$/.test(next[0])) next = [...next[0]];
    read.push(next);
  });
  return read;
}

// "1" is also said as a form of "ein", like "ein Tag" for "1 Tag".
const ONE = new Set(['ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'eins']);
export const saysOne = (a, b) => (a === '1' && ONE.has(b)) || (b === '1' && ONE.has(a));

// Whether the period at the end of `word` goes on inside the sentence. `before`
// and `after` are the words around it, or null. An ordinal with an article or a
// month next to it goes on, like "am 3. Mai", "im 19. Jahrhundert" or "der 29.
// Februar", and so do some short forms, like "z. B.". Every other period ends
// the sentence, so "Die Anzahl ist 3. Danach steigt sie." stays two sentences.
export function periodGoesOn(word, before = null, after = null) {
  const c = core(word);
  if (!c.endsWith('.')) return false;
  if (/^\d+\.$/.test(c)) return ORDINAL_BEFORE.has(plain(before)) || MONTHS.has(plain(after));
  const form = shortForm(word) ?? (before !== null ? halves(before, word) : undefined) ?? (after !== null ? halves(word, after) : undefined);
  if (!form?.goesOn) return false;
  return form.goesOn === 'always' || /^\p{Ll}/u.test(core(after));
}
