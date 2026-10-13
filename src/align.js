// Aligns the words we asked the voice model to say with the words Whisper
// heard, so every script word gets a start and end time.
import { normWord } from './script.js';

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

// Turns one written word into the tokens a voice would say, in canonical form.
// Whisper writes "$1,050" and "5%" where the voice said "one thousand and
// fifty dollars" and "five percent", and "example.com" or "1.1.1.1" where it
// said words joined by "dot". Both sides are expanded the same way.
export function expand(word, language = 'en') {
  if (language !== 'en') {
    const n = normWord(word).replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966));
    const digits = /^[\p{N}%$€£+.]+$/u.test(n) ? n.replace(/[^\p{N}]/gu, '') : '';
    return n ? [digits || n] : [];
  }
  const raw = String(word).trim().toLowerCase();
  // Whisper splits "1.1.1.1" into "1", ".1", ".1", ".1": a leading dot is a spoken "dot".
  const lead = /^\.[a-z0-9]/i.test(raw) ? ['dot'] : [];
  const n = canon(word);
  const money = /^([$€£])?(\d+)(?:\.(\d+))?(%)?$/.exec(n);
  if (money && /\d/.test(raw) && !/^\d+\.\d+\.\d+/.test(n)) {
    const [, cur, int, dec, pct] = money;
    const out = [...lead, ...intWords(Number(int))];
    if (dec !== undefined) {
      if (cur) out.push(CURRENCY[cur], ...intWords(Number(dec)), 'cents');
      else out.push('point', ...dec.split('').map((d) => ONES[Number(d)]));
    } else if (cur) out.push(CURRENCY[cur]);
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

function editDistance(a, b) {
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

// words: [{ spoken }] in order. heard: [{ text, start, end }] from Whisper.
// Returns per-word { start, end, matched } and the share of spoken tokens matched.
export function alignWords(words, heard, duration, language = 'en') {
  const partsOf = word => expand(word, language);
  const matches = (a, b) => language !== 'en' && (/\p{N}/u.test(a) || /\p{N}/u.test(b)) ? a === b : similar(a, b);
  const tokens = [];
  words.forEach((w, wi) => {
    const parts = String(w.spoken).split(/\s+/).flatMap(partsOf);
    (parts.length ? parts : ['']).forEach((p, k) => {
      // "and" inside a spoken number ("one thousand and fifty") is optional.
      const prev = tokens[tokens.length - 1];
      const optional = language === 'en' && p === 'and' && prev && isNumberToken(prev.norm);
      tokens.push({ wi, norm: p, first: k === 0, last: k === parts.length - 1 || !parts.length, optional });
    });
  });
  // Whisper splits numbers into pieces ("$1", ",000" and "5", "%" and "1",
  // ".1"). Join them back before comparing.
  const joined = [];
  for (const h of heard) {
    const prev = joined[joined.length - 1];
    const t = String(h.text).trim();
    const glue = prev && ((/^[,.]\d/.test(t) && /\d$/.test(prev.text)) || (/^%/.test(t) && /\d$/.test(prev.text)) || (/^\d/.test(t) && /^[$€£]$/.test(prev.text)));
    if (glue) {
      prev.text += t;
      prev.end = h.end;
    } else {
      joined.push({ ...h, text: t });
    }
  }
  const H = [];
  for (const h of joined) {
    const parts = partsOf(h.text);
    const step = (h.end - h.start) / Math.max(1, parts.length);
    parts.forEach((p, k) => H.push({ text: p, norm: p, start: h.start + k * step, end: h.start + (k + 1) * step }));
  }
  const T = tokens.length;
  const N = H.length;

  // Dynamic programming over (token i, heard j). Moves:
  //  match 1:1, skip a token, skip a heard word, a whole multi-token word to one
  //  heard word ("D N S" vs "DNS"), and one token to two heard words.
  const INF = 1e9;
  const cost = Array.from({ length: T + 1 }, () => new Float64Array(N + 1).fill(INF));
  const move = Array.from({ length: T + 1 }, () => new Int8Array(N + 1));
  cost[0][0] = 0;
  const groupEnd = new Int32Array(T);
  for (let i = 0; i < T; i++) {
    let e = i;
    while (e + 1 < T && tokens[e + 1].wi === tokens[i].wi) e++;
    groupEnd[i] = e;
  }
  for (let i = 0; i <= T; i++) {
    for (let j = 0; j <= N; j++) {
      const c = cost[i][j];
      if (c >= INF) continue;
      if (i < T && c + (tokens[i].optional ? 0 : 1) < cost[i + 1][j]) { cost[i + 1][j] = c + (tokens[i].optional ? 0 : 1); move[i + 1][j] = 2; }
      if (j < N && c + 1 < cost[i][j + 1]) { cost[i][j + 1] = c + 1; move[i][j + 1] = 3; }
      if (i < T && j < N) {
        const ok = matches(tokens[i].norm, H[j].norm);
        const v = c + (ok ? 0 : 1.6);
        if (v < cost[i + 1][j + 1]) { cost[i + 1][j + 1] = v; move[i + 1][j + 1] = ok ? 1 : 4; }
      }
      if (i < T && j < N && tokens[i].first && groupEnd[i] > i) {
        const e = groupEnd[i];
        const joined = tokens.slice(i, e + 1).map((t) => t.norm).join('');
        if (matches(joined, H[j].norm) && c < cost[e + 1][j + 1]) { cost[e + 1][j + 1] = c; move[e + 1][j + 1] = 5; }
      }
      if (i < T && j + 1 < N && matches(tokens[i].norm, H[j].norm + H[j + 1].norm) && c < cost[i + 1][j + 2]) {
        cost[i + 1][j + 2] = c;
        move[i + 1][j + 2] = 6;
      }
    }
  }

  const spans = words.map(() => null);
  const hits = words.map(() => 0);
  const need = words.map(() => 0);
  for (const t of tokens) if (!t.optional) need[t.wi]++;
  const add = (wi, s, e, n = 1) => {
    hits[wi] += n;
    const cur = spans[wi];
    spans[wi] = cur ? { start: Math.min(cur.start, s), end: Math.max(cur.end, e) } : { start: s, end: e };
  };
  let matched = 0;
  let i = T;
  let j = N;
  while (i > 0 || j > 0) {
    const m = move[i][j];
    if (m === 1) { add(tokens[i - 1].wi, H[j - 1].start, H[j - 1].end); matched++; i--; j--; }
    else if (m === 4) { i--; j--; }
    else if (m === 2) { i--; }
    else if (m === 3) { j--; }
    else if (m === 5) {
      let s = i - 1;
      while (s > 0 && tokens[s - 1].wi === tokens[i - 1].wi) s--;
      add(tokens[i - 1].wi, H[j - 1].start, H[j - 1].end, i - s);
      matched += i - s;
      i = s;
      j--;
    } else if (m === 6) { add(tokens[i - 1].wi, H[j - 2].start, H[j - 1].end); matched++; i--; j -= 2; }
    else break;
  }

  // Interpolate words Whisper did not confirm, by character length, between
  // the nearest confirmed neighbours.
  // A word counts as confirmed only when every part of it was heard, so
  // "example.com" read as "example comm" is reported.
  const out = words.map((w, wi) => ({ start: 0, end: 0, matched: !!spans[wi] && hits[wi] >= need[wi] }));
  const weight = words.map((w) => Math.max(1, String(w.spoken).length));
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
  const counted = tokens.filter((t) => !t.optional).length;
  return { words: out, matchRate: counted ? Math.min(1, matched / counted) : 1 };
}
