// Aligns the words we asked the voice model to say with the words Whisper
// heard, so every script word gets a start and end time.
import { createRequire } from 'node:module';
import { normWord } from './script.js';
import { japaneseReadings, hasPhonemizer, soundsOf } from './phonemes.js';
import { isScale, readGerman, saysOne } from './german.js';
import { decimalDigits, numberGroups, numberValue, sameUnitWord, unitReading } from './units.js';

const require = createRequire(import.meta.url);

// Whisper often writes Mandarin in Traditional characters, even when the
// script is Simplified. Both sides are compared in Simplified.
let toSimplified;
function simplified(text) {
  toSimplified ??= require('opencc-js/t2cn').Converter({ from: 'tw', to: 'cn' });
  return toSimplified(text);
}

// Whisper also often writes another character with the same sound, like 直
// for 值. Mandarin characters match when they share a reading without tones.
const readings = new Map();
function soundsAlike(a, b) {
  const as = Array.from(a);
  const bs = Array.from(b);
  if (as.length !== bs.length) return false;
  const { pinyin } = require('pinyin-pro');
  const of = c => {
    if (!readings.has(c)) readings.set(c, /\p{Script=Han}/u.test(c) ? pinyin(c, { multiple: true, toneType: 'none', type: 'array' }) : [c]);
    return readings.get(c);
  };
  return as.every((c, i) => c === bs[i] || of(c).some(r => of(bs[i]).includes(r)));
}

const katakana = text => text.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

// Gives each piece of text the reading of its characters. A reading that
// covers several characters is shared out between them.
export function spreadReadings(pieces, tokens) {
  const kana = Array.from(pieces.join(''), () => '');
  for (const [start, end, reading] of tokens) {
    const r = Array.from(katakana(reading));
    const n = end - start;
    for (let k = 0; k < n && start + k < kana.length; k++) kana[start + k] = r.slice(Math.round(k * r.length / n), Math.round((k + 1) * r.length / n)).join('');
  }
  let at = 0;
  return pieces.map(p => {
    const length = Array.from(p).length;
    at += length;
    return kana.slice(at - length, at).join('');
  });
}

// Japanese has many words that sound the same, and Whisper often writes a
// word in kana that the script writes in kanji. When Python with misaki is
// there, both sides are compared by their reading.
export async function readAlike(words, heard, language) {
  if (language !== 'ja' || !words.length || !heard.length) return { words, heard };
  try {
    const spoken = words.map(w => String(w.spoken));
    const pieces = heard.map(h => String(h.text).trim());
    const shown = words.map((w, i) => w.display !== undefined && String(w.display) !== spoken[i] ? String(w.display) : null);
    const extra = shown.filter(s => s !== null);
    const [a, b, ...c] = await japaneseReadings([spoken.join(''), pieces.join(''), ...extra]);
    const spokenKana = spreadReadings(spoken, a);
    const heardKana = spreadReadings(pieces, b);
    let k = 0;
    const shownKana = shown.map(s => s === null ? null : spreadReadings([s], c[k++])[0]);
    return {
      words: words.map((w, i) => ({ ...w, spoken: spokenKana[i] || w.spoken, display: shown[i] === null ? undefined : shownKana[i] || w.display })),
      heard: heard.map((h, i) => ({ ...h, text: heardKana[i] || h.text })),
    };
  } catch {
    return { words, heard };
  }
}

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
  sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100', thousand: '1000',
};

function canon(w) {
  const n = normWord(w).replace(/,/g, '');
  return NUMBER_WORDS[n] ?? n;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const CURRENCY = { $: 'dollars', '€': 'euros', '£': 'pounds' };

// 1102 -> one thousand one hundred two (without "and"; "and" is optional below).
export function intWords(n) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return [String(n)];
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? intWords(n % 100) : [])];
  for (const [size, name] of SCALES) {
    if (n >= size) return [...intWords(Math.floor(n / size)), name, ...(n % size ? intWords(n % size) : [])];
  }
  return [String(n)];
}

// Kokoro reads a lone four-digit number like a year: 1582 "fifteen eighty
// two", 1900 "nineteen hundred", 1905 "nineteen oh five". Numbers below 1100
// or with fewer than ten in the last three digits (2000, 2005) stay cardinal.
export function yearWords(n) {
  if (n < 1100 || n > 9999 || n % 1000 < 10) return null;
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (n % 1000 >= 100 && lo === 0) return [...intWords(hi), 'hundred'];
  if (n % 1000 >= 100 && lo < 10) return [...intWords(hi), 'oh', ...intWords(lo)];
  return [...intWords(hi), ...intWords(lo)];
}

const ORDINALS = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

// 29th -> twenty ninth, 101st -> one hundred first.
function ordinalWords(n) {
  const words = intWords(n);
  const last = words.pop();
  const ord = ORDINALS[last] ?? (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th');
  return [...words.map(canon), ord];
}

// Turns one written word into the tokens a voice would say, in canonical form.
// Whisper writes "$1,050" and "5%" where the voice said "one thousand and
// fifty dollars" and "five percent", and "example.com" or "1.1.1.1" where it
// said words joined by "dot". Both sides are expanded the same way. German has
// rules of its own in german.js, which read a word together with its neighbours.
// Other languages compare a number by its value, written the way the language
// writes it, so "300.000" in Spanish is "300000" and "7,5" stays "7,5".
export function expand(word, language = 'en') {
  if (language === 'de') return readGerman([word], normWord)[0];
  if (language !== 'en') {
    const latin = (text) => String(text).replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966));
    const value = numberValue(latin(word), language);
    if (value !== null) return [value];
    const n = latin(normWord(word));
    const digits = /^[\p{N}%$€£+.]+$/u.test(n) ? n.replace(/[^\p{N}]/gu, '') : '';
    return n ? [digits || n] : [];
  }
  const raw = String(word).trim().toLowerCase();
  // Whisper splits "1.1.1.1" into "1", ".1", ".1", ".1": a leading dot is a spoken "dot".
  const lead = /^\.[a-z0-9]/i.test(raw) ? ['dot'] : [];
  const n = canon(word);
  const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(n);
  if (ordinal && !/\d,\d/.test(raw)) return [...lead, ...ordinalWords(Number(ordinal[1]))];
  const money = /^([$€£])?(\d+)(?:\.(\d+))?(%)?$/.exec(n);
  if (money && /\d/.test(raw) && !/^\d+\.\d+\.\d+/.test(n)) {
    const [, cur, int, dec, pct] = money;
    const year = !cur && dec === undefined && !pct && /^\d{4}$/.test(int) && !/\d,\d/.test(raw) ? yearWords(Number(int)) : null;
    if (year) return [...lead, ...year].map(canon);
    const out = [...lead, ...intWords(Number(int))];
    // Zeros at the end of the decimals change no value, so "2.0" reads like "2".
    const point = dec === undefined ? '' : decimalDigits(dec);
    if (dec !== undefined && cur) out.push(CURRENCY[cur], ...intWords(Number(dec)), 'cents');
    else if (point) out.push('point', ...point.split('').map((d) => ONES[Number(d)]));
    else if (cur) out.push(CURRENCY[cur]);
    if (pct) out.push('percent');
    return out.map(canon);
  }
  if (!/[a-z0-9]\.[a-z0-9]/.test(n)) return n ? [...lead, n] : lead;
  const parts = n.split('.').filter(Boolean).map((p) => NUMBER_WORDS[p] ?? p);
  const out = [...lead];
  parts.forEach((p, i) => {
    if (i) out.push('dot');
    out.push(p);
  });
  return out;
}

const isNumberToken = (t) => /^\d+$/.test(t) || ['hundred', 'thousand', 'million', 'billion', '100', '1000'].includes(t);

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len <= 3) return false;
  return editDistance(a, b) / len <= 0.34;
}

// A written or heard word without the punctuation around it, for messages.
export function bareWord(text) {
  return String(text).trim().replace(/^[^\p{L}\p{N}$€£]+|[^\p{L}\p{N}%$€£]+$/gu, '');
}

// The words that only nearly matched, as [{ word, heard }]. `words` are the
// script words that `aligned` came from, with their shown text in `display`. A
// word whose heard word sounds the same has `alike: true`, and two words heard
// as one have `joined: true`.
export function nearList(words, aligned) {
  return aligned.flatMap((a, k) => (a.nearly ? [{
    word: bareWord(words[k].display ?? words[k].spoken), heard: a.heard ?? '', ...(a.alike ? { alike: true } : {}), ...(a.joined ? { joined: true } : {}),
  }] : []));
}

// How well a script token and a heard token match. The order matters: a path
// takes the best way a token can match.
const EXACT = 3;
const NEAR = 2;
const ALIKE = 1;
// What a pairing adds to a word that matched: nothing, only nearly, the same
// sound, or two words heard as one.
const MARK = { [EXACT]: 0, [NEAR]: 1, [ALIKE]: 2 };
const JOINED = 3;
// A path through a new kind of match costs a little more than one through the
// matches from before, so a word that matched before matches the same way.
const STEP = 0.001;

// Reads a list of written or heard words as the tokens a voice says for them.
// Thousands written with spaces, like "300 000", are one number, read by the
// first word, and the words after it read nothing (null). A unit or symbol is
// read as the words of the language, like "km/s" as "kilómetros por segundo".
// `other` holds the words of the other side in order, for units with several readings.
function readWords(list, language, other = []) {
  const lead = numberGroups(list);
  const merged = list.map((word, i) => (lead[i] === i ? list.filter((_, k) => lead[k] === i).map((w) => String(w).trim()).join('') : ''));
  const number = (text) => (language === 'de' ? readGerman([text], normWord)[0] : expand(text, language));
  const base = language === 'de' ? readGerman(merged, normWord) : merged.map((w) => expand(w, language));
  return merged.map((word, i) => {
    if (lead[i] !== i) return null;
    const unit = unitReading(word, i ? list[i - 1] : null, language, other);
    const tokens = unit ? [...(unit.number === null ? [] : number(unit.number)), ...unit.tokens] : base[i];
    return tokens.map((t) => sameUnitWord(t, language));
  });
}

// words: [{ spoken, display? }] in order. heard: [{ text, start, end }] from Whisper.
// Returns per-word { start, end, matched } and the share of spoken tokens matched.
// A word also counts as heard when Whisper writes its shown form, so
// {SQL|sequel} or {async|a sink} is confirmed by "SQL" or "async", also over
// several heard words, like "tabslip.com" for {tabslip.com|tab slip dot com}.
// A confirmed word that `similar` had to accept, like "Soundroo" heard as
// "Soundru", also has `nearly: true`. Such a word, and a word that wasn't
// confirmed, has what was heard in its place in `heard`. Neither changes a time
// or the rate: the alignment takes the same path as without them.
// Two neighbouring words heard as one, like "See costs" as "Seacosts", count as
// confirmed with `nearly` and `joined`. With `sounds`, a map from tokens to their
// sound, a word heard as another word with the same sound, like "piece" as
// "peace", counts as confirmed with `nearly` and `alike`. Both are matches
// that weren't there before, so they do change times and the rate.
export function alignWords(words, heard, duration, language = 'en', { sounds = null } = {}) {
  const cjk = ['ja', 'zh'].includes(language);
  const chars = word => normWord(word).normalize('NFC');
  const partsOf = word => Array.from(language === 'zh' ? simplified(chars(word)) : chars(word));
  // The tokens of each word in a list. German reads a word with its neighbours,
  // like the two halves of "z. B.".
  const read = (list, other) => (cjk ? list.map(partsOf) : readWords(list, language, other));
  // EXACT when a token is the same as what was heard, NEAR when `similar` had to
  // accept it, ALIKE when it sounds the same, and 0 when it doesn't match.
  const compare = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return EXACT;
    if (cjk) return language === 'zh' && soundsAlike(a, b) ? EXACT : 0;
    if (language !== 'en' && (/\p{N}/u.test(a) || /\p{N}/u.test(b))) return language === 'de' && saysOne(a, b) ? EXACT : 0;
    // German large numbers like "Millionen" are numbers too.
    if (language === 'de' && (isScale(a) || isScale(b))) return 0;
    if (similar(a, b)) return NEAR;
    return sounds?.has(a) && sounds.get(a) === sounds.get(b) ? ALIKE : 0;
  };
  // Whisper splits numbers into pieces ("$1", ",000" and "5", "%" and "1",
  // ".1", and in German "19", "-hundert"), writes thousands with a space, like
  // "300" and "000", and splits units, like "km" and "/s". Join them back before
  // comparing.
  const joined = [];
  for (const h of heard) {
    const prev = joined[joined.length - 1];
    const t = String(h.text).trim();
    const thousands = !cjk && prev && (prev.grouped ? /\d{3}$/.test(prev.text) : /^[$€£]?\d{1,3}$/.test(prev.text)) && /^\d{3}(?!\d)/.test(t);
    const unit = !cjk && prev && ((/^\/\p{L}/u.test(t) && /\p{L}$/u.test(prev.text)) || (/^[cC]\b/.test(t) && /°$/.test(prev.text)));
    const glue = prev && (thousands || unit || (/^[,.]\d/.test(t) && /\d$/.test(prev.text)) || (/^%/.test(t) && /\d$/.test(prev.text)) || (/^\d/.test(t) && /^[$€£]$/.test(prev.text))
      || (language === 'de' && /^-(hundert|tausend)/i.test(t) && /\d$/.test(prev.text)));
    if (glue) {
      prev.text += t;
      prev.end = h.end;
      if (thousands) prev.grouped = true;
    } else {
      joined.push({ ...h, text: t });
    }
  }
  const tokens = [];
  const pieces = words.map((w) => String(w.spoken).split(/\s+/));
  const spoken = read(pieces.flat(), joined.map((h) => normWord(h.text)));
  // A word that only goes on with the number of the word before it, like "000"
  // in "300 000", has no tokens. It shares the fate and the time of that word.
  const follows = words.map(() => false);
  let at = 0;
  words.forEach((w, wi) => {
    const own = spoken.slice(at, at += pieces[wi].length);
    if (wi && own.every((p) => p === null)) {
      follows[wi] = true;
      return;
    }
    const parts = own.filter((p) => p !== null).flat();
    (parts.length ? parts : ['']).forEach((p, k) => {
      // "and" inside a spoken number ("one thousand and fifty") is optional.
      const prev = tokens[tokens.length - 1];
      const optional = language === 'en' && p === 'and' && prev && isNumberToken(prev.norm);
      tokens.push({ wi, norm: p, first: k === 0, last: k === parts.length - 1 || !parts.length, optional });
    });
    const shown = w.display === undefined ? '' : read(String(w.display).split(/\s+/)).filter(Boolean).flat().join('');
    const first = tokens.findIndex((t) => t.wi === wi);
    if (shown && shown !== parts.join('')) tokens[first].shown = shown;
    // A spelling hint, like {soundroo.com|sound roo dot com}, and a word with a
    // hyphen, like "arc-en-ciel", may be heard as several words.
    if (w.display !== undefined && String(w.display).replace(/\s+/g, ' ') !== String(w.spoken).replace(/\s+/g, ' ')) tokens[first].override = true;
    if (pieces[wi].some((p) => /[\p{L}\p{N}][-‐‑][\p{L}\p{N}]/u.test(p))) tokens[first].hyphen = true;
  });
  const H = [];
  read(joined.map((h) => h.text), tokens.map((t) => t.norm)).forEach((parts, source) => {
    const h = joined[source];
    const step = (h.end - h.start) / Math.max(1, parts.length);
    parts.forEach((p, k) => H.push({ text: p, norm: p, start: h.start + k * step, end: h.start + (k + 1) * step, source }));
  });
  const T = tokens.length;
  const N = H.length;

  // Dynamic programming over (token i, heard j). Moves:
  //  match 1:1, skip a token, skip a heard word, a whole multi-token word to one
  //  heard word ("D N S" vs "DNS"), one token to two heard words, a whole word to
  //  several heard words that spell its spoken or shown form ("tab slip dot com"
  //  vs "tabslip.com"), and two words to one or two heard words that spell them
  //  joined ("See costs" vs "Seacosts").
  // `near` notes a match that only `similar` accepted. It never changes a cost,
  // so the path is the same with or without it.
  const INF = 1e9;
  const cost = Array.from({ length: T + 1 }, () => new Float64Array(N + 1).fill(INF));
  const move = Array.from({ length: T + 1 }, () => new Int8Array(N + 1));
  const near = Array.from({ length: T + 1 }, () => new Uint8Array(N + 1));
  // How many heard tokens a move took, for the moves that take several.
  const length = Array.from({ length: T + 1 }, () => new Int16Array(N + 1));
  cost[0][0] = 0;
  const groupEnd = new Int32Array(T);
  for (let i = 0; i < T; i++) {
    let e = i;
    while (e + 1 < T && tokens[e + 1].wi === tokens[i].wi) e++;
    groupEnd[i] = e;
  }
  const joinTokens = (from, to) => tokens.slice(from, to + 1).map((t) => t.norm).join('');
  // The sound of a spelling hint's spoken form, without spaces, when every part of it has one.
  const soundOf = (from, to) => {
    const parts = tokens.slice(from, to + 1).map((t) => sounds?.get(t.norm));
    return parts.every(Boolean) ? parts.join('') : null;
  };
  // Per first token of a word: the word's tokens joined, and the same with the next word.
  const wordJoin = tokens.map((t, i) => (t.first ? joinTokens(i, groupEnd[i]) : ''));
  const pairJoin = tokens.map((t, i) => (t.first && groupEnd[i] + 1 < T ? joinTokens(i, groupEnd[groupEnd[i] + 1]) : ''));
  for (let i = 0; i <= T; i++) {
    for (let j = 0; j <= N; j++) {
      const c = cost[i][j];
      if (c >= INF) continue;
      if (i < T && c + (tokens[i].optional ? 0 : 1) < cost[i + 1][j]) { cost[i + 1][j] = c + (tokens[i].optional ? 0 : 1); move[i + 1][j] = 2; }
      if (j < N && c + 1 < cost[i][j + 1]) { cost[i][j + 1] = c + 1; move[i][j + 1] = 3; }
      if (i < T && j < N) {
        const how = compare(tokens[i].norm, H[j].norm);
        const v = c + (how ? 0 : 1.6);
        if (v < cost[i + 1][j + 1]) { cost[i + 1][j + 1] = v; move[i + 1][j + 1] = how ? 1 : 4; near[i + 1][j + 1] = MARK[how] ?? 0; }
      }
      if (i < T && j < N && tokens[i].first && (groupEnd[i] > i || tokens[i].shown || tokens[i].hyphen)) {
        const e = groupEnd[i];
        const group = wordJoin[i];
        const how = Math.max(groupEnd[i] > i ? compare(group, H[j].norm) : 0, tokens[i].shown ? compare(tokens[i].shown, H[j].norm) : 0);
        if (how && c < cost[e + 1][j + 1]) { cost[e + 1][j + 1] = c; move[e + 1][j + 1] = 5; near[e + 1][j + 1] = MARK[how]; }
        // The shown form heard as it is, like "SQL" for {SQL|sequel}, is exact also
        // when the spoken form nearly matched the same word first.
        else if (how === EXACT && e === i && move[e + 1][j + 1] === 1 && cost[e + 1][j + 1] === c) near[e + 1][j + 1] = 0;
        // The spoken or shown form spelled out over several heard words, without
        // spaces and punctuation, like "tabslip.com" for "tab slip dot com".
        if (!cjk) {
          const forms = [group, tokens[i].shown].filter(Boolean);
          const longest = Math.max(...forms.map((f) => f.length));
          let said = H[j].norm;
          for (let L = 2; j + L <= N; L++) {
            said += H[j + L - 1].norm;
            if (said.length > longest) break;
            if (forms.includes(said) && c + STEP < cost[e + 1][j + L]) {
              cost[e + 1][j + L] = c + STEP;
              move[e + 1][j + L] = 8;
              length[e + 1][j + L] = L;
              near[e + 1][j + L] = 0;
            }
          }
          // A spelling hint heard with the same sound as its spoken form, over one
          // or more heard words and without spaces, like "SoundRue.com" for
          // {soundroo.com|sound roo dot com}. It counts as sounding the same.
          const want = sounds && tokens[i].override ? soundOf(i, e) : null;
          let heardSound = '';
          for (let L = 1; want && j + L <= N; L++) {
            const part = sounds.get(H[j + L - 1].norm);
            if (!part) break;
            heardSound += part;
            if (heardSound.length > want.length) break;
            if (heardSound === want && c + 2 * STEP < cost[e + 1][j + L]) {
              cost[e + 1][j + L] = c + 2 * STEP;
              move[e + 1][j + L] = 8;
              length[e + 1][j + L] = L;
              near[e + 1][j + L] = MARK[ALIKE];
            }
          }
        }
      }
      if (cjk && i < T && tokens[i].first && tokens[i].shown) {
        const shownLength = Array.from(tokens[i].shown).length;
        const e = groupEnd[i];
        if (j + shownLength <= N && compare(tokens[i].shown, H.slice(j, j + shownLength).map(h => h.norm).join('')) && c < cost[e + 1][j + shownLength]) {
          cost[e + 1][j + shownLength] = c;
          move[e + 1][j + shownLength] = 7;
          length[e + 1][j + shownLength] = shownLength;
          near[e + 1][j + shownLength] = 0;
        }
      }
      if (i < T && j + 1 < N && c < cost[i + 1][j + 2]) {
        const how = compare(tokens[i].norm, H[j].norm + H[j + 1].norm);
        if (how) {
          cost[i + 1][j + 2] = c;
          move[i + 1][j + 2] = 6;
          near[i + 1][j + 2] = MARK[how];
        }
      }
      // Two neighbouring words heard as one word, exactly or nearly, like "See
      // costs" as "Seacosts", or as two words split in another place, like
      // "Tabslip sits" as "Tab slipsits".
      if (!cjk && i < T && j < N && tokens[i].first && groupEnd[i] + 1 < T) {
        const e = groupEnd[groupEnd[i] + 1];
        const both = pairJoin[i];
        const firstLength = wordJoin[i].length;
        for (let L = 1; L <= 2 && j + L <= N; L++) {
          const said = L === 1 ? H[j].norm : H[j].norm + H[j + 1].norm;
          // A near match of two joined words may differ by a letter or two, not by a
          // whole short word that was never heard. Over two heard words it must be exact.
          if (Math.abs(said.length - both.length) > (L === 1 ? 2 : 0)) continue;
          // One of the two words heard on its own, like "video" for "a video", means the other wasn't heard.
          if (L === 1 && (said === wordJoin[i] || said === wordJoin[groupEnd[i] + 1])) continue;
          const how = L === 1 ? compare(both, said) : both === said ? EXACT : 0;
          const fits = L === 1 ? how === EXACT || (how === NEAR && editDistance(both, said) <= Math.min(2, Math.floor(Math.max(both.length, said.length) / 4))) : how === EXACT && H[j].norm.length !== firstLength;
          if (fits && c + STEP < cost[e + 1][j + L]) {
            cost[e + 1][j + L] = c + STEP;
            move[e + 1][j + L] = 9;
            length[e + 1][j + L] = L;
            near[e + 1][j + L] = JOINED;
          }
        }
      }
    }
  }

  const spans = words.map(() => null);
  const hits = words.map(() => 0);
  const need = words.map(() => 0);
  const weight = words.map((w) => Math.max(1, String(w.spoken).length));
  // The heard words that each word was paired with, and whether one only nearly matched.
  const sources = words.map(() => new Set());
  const nearly = words.map(() => 0);
  for (const t of tokens) if (!t.optional) need[t.wi]++;
  const add = (wi, s, e, n = 1) => {
    hits[wi] += n;
    const cur = spans[wi];
    spans[wi] = cur ? { start: Math.min(cur.start, s), end: Math.max(cur.end, e) } : { start: s, end: e };
  };
  const pair = (wi, from, to, mark = 0) => {
    for (let k = from; k <= to; k++) sources[wi].add(H[k].source);
    if (mark && !nearly[wi]) nearly[wi] = mark;
  };
  // The first token of the word that token `i - 1` belongs to.
  const wordStart = (i) => {
    let s = i - 1;
    while (s > 0 && tokens[s - 1].wi === tokens[i - 1].wi) s--;
    return s;
  };
  let matched = 0;
  let i = T;
  let j = N;
  while (i > 0 || j > 0) {
    const m = move[i][j];
    if (m === 1) { add(tokens[i - 1].wi, H[j - 1].start, H[j - 1].end); pair(tokens[i - 1].wi, j - 1, j - 1, near[i][j]); matched++; i--; j--; }
    else if (m === 4) { pair(tokens[i - 1].wi, j - 1, j - 1); i--; j--; }
    else if (m === 2) { i--; }
    else if (m === 3) { j--; }
    else if (m === 5) {
      const s = wordStart(i);
      add(tokens[i - 1].wi, H[j - 1].start, H[j - 1].end, i - s);
      pair(tokens[i - 1].wi, j - 1, j - 1, near[i][j]);
      matched += i - s;
      i = s;
      j--;
    } else if (m === 7 || m === 8) {
      const L = length[i][j];
      const s = wordStart(i);
      add(tokens[i - 1].wi, H[j - L].start, H[j - 1].end, i - s);
      pair(tokens[i - 1].wi, j - L, j - 1, near[i][j]);
      matched += i - s;
      i = s;
      j -= L;
    } else if (m === 9) {
      // The heard time is shared by the length of the two words.
      const L = length[i][j];
      const sb = wordStart(i);
      const sa = wordStart(sb);
      const [wa, wb] = [tokens[sa].wi, tokens[sb].wi];
      const from = H[j - L].start;
      const to = H[j - 1].end;
      const cut = from + ((to - from) * weight[wa]) / (weight[wa] + weight[wb]);
      add(wa, from, cut, sb - sa);
      add(wb, cut, to, i - sb);
      pair(wa, j - L, j - 1, JOINED);
      pair(wb, j - L, j - 1, JOINED);
      matched += i - sa;
      i = sa;
      j -= L;
    } else if (m === 6) { add(tokens[i - 1].wi, H[j - 2].start, H[j - 1].end); pair(tokens[i - 1].wi, j - 2, j - 1, near[i][j]); matched++; i--; j -= 2; }
    else break;
  }

  // The words that go on with a number share its time by their length.
  const leader = words.map(() => 0);
  words.forEach((w, wi) => { leader[wi] = follows[wi] ? leader[wi - 1] : wi; });
  for (let wi = 0; wi < words.length; wi++) {
    if (follows[wi] || !follows[wi + 1]) continue;
    let e = wi + 1;
    while (e < words.length && follows[e]) e++;
    for (let q = wi + 1; q < e; q++) for (const s of sources[wi]) sources[q].add(s);
    if (!spans[wi]) continue;
    const total = weight.slice(wi, e).reduce((a, b) => a + b, 0);
    const { start, end } = spans[wi];
    let t = start;
    for (let q = wi; q < e; q++) {
      const d = ((end - start) * weight[q]) / total;
      spans[q] = { start: t, end: t + d };
      t += d;
    }
  }

  // Interpolate words Whisper did not confirm, by character length, between
  // the nearest confirmed neighbours.
  // A word counts as confirmed only when every part of it was heard, so
  // "example.com" read as "example comm" is reported.
  const out = words.map((w, wi) => ({ start: 0, end: 0, matched: !!spans[wi] && hits[wi] >= need[wi] }));
  out.forEach((word, wi) => { if (follows[wi]) word.matched = out[leader[wi]].matched; });
  let k = 0;
  while (k < words.length) {
    if (spans[k]) {
      out[k].start = spans[k].start;
      out[k].end = Math.max(spans[k].end, spans[k].start + 0.05);
      k++;
      continue;
    }
    let e = k;
    while (e < words.length && !spans[e]) e++;
    const from = k > 0 ? out[k - 1].end : 0;
    const to = e < words.length ? spans[e].start : duration;
    const total = weight.slice(k, e).reduce((a, b) => a + b, 0);
    let t = from;
    for (let q = k; q < e; q++) {
      const d = ((to - from) * weight[q]) / total;
      out[q].start = t;
      out[q].end = t + d;
      t += d;
    }
    k = e;
  }
  // Keep times monotonic.
  for (let q = 1; q < out.length; q++) {
    if (out[q].start < out[q - 1].start) out[q].start = out[q - 1].start;
    if (out[q].end < out[q].start) out[q].end = out[q].start + 0.05;
  }
  // A path that cost the same may have matched a word nearly where it was heard
  // exactly, like "But" to "but" and part of "2000". A word whose own tokens, or
  // shown form, are a run of the heard tokens it was paired with is exact.
  const exactAmong = (wi) => {
    const own = tokens.filter((t) => t.wi === wi);
    const forms = [own.map((t) => t.norm).join(''), own.filter((t) => !t.optional).map((t) => t.norm).join(''), own[0].shown ?? ''].filter(Boolean);
    const from = Math.min(...sources[wi]);
    const to = Math.max(...sources[wi]);
    const run = H.filter((h) => h.source >= from && h.source <= to).map((h) => h.norm);
    for (let a = 0; a < run.length; a++) {
      let said = '';
      for (let b = a; b < run.length; b++) {
        said += run[b];
        if (forms.some((form) => compare(form, said) === EXACT)) return true;
      }
    }
    return false;
  };
  words.forEach((w, wi) => {
    if (out[wi].matched && nearly[wi] && exactAmong(wi)) nearly[wi] = 0;
  });
  out.forEach((word, wi) => {
    if (word.matched && !nearly[wi]) return;
    const said = [...sources[wi]].sort((a, b) => a - b).map((s) => bareWord(joined[s].text)).filter(Boolean).join(' ');
    if (word.matched) {
      word.nearly = true;
      if (nearly[wi] === MARK[ALIKE]) word.alike = true;
      if (nearly[wi] === JOINED) word.joined = true;
    }
    if (said) word.heard = said;
  });
  const counted = tokens.filter((t) => !t.optional).length;
  return {
    words: out,
    matchRate: counted ? Math.min(1, matched / counted) : 1,
    // The tokens of each word and of what was heard, for a second look by sound.
    tokens: { words: words.map((w, wi) => tokens.filter((t) => t.wi === wi).map((t) => t.norm)), heard: H.map((h) => h.norm) },
  };
}

// The speech check of one piece of narration. It aligns the words, and when a
// word isn't confirmed and explainroo has a phonemizer for the language, it
// looks again with the sound of each word, so "piece" heard as "peace" counts.
// Without a phonemizer, or when it fails, the first result stands.
export async function alignSpeech(words, heard, duration, language = 'en') {
  const alike = await readAlike(words, heard, language);
  const first = alignWords(alike.words, alike.heard, duration, language);
  if (first.words.every((w) => w.matched) || !hasPhonemizer(language)) return first;
  // Numbers outside English only match the same number, so their sound never counts.
  const wanted = (t) => t && (language === 'en' || !/\p{N}/u.test(t));
  const missed = first.words.flatMap((w, k) => (w.matched ? [] : first.tokens.words[k]));
  let sounds;
  try {
    sounds = await soundsOf([...new Set([...missed, ...first.tokens.heard])].filter(wanted), language);
  } catch {
    return first;
  }
  return alignWords(alike.words, alike.heard, duration, language, { sounds });
}
