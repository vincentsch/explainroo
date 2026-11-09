// Parser for script.md, the narration file of a video project.
//
//   # Title                      (optional, not spoken)
//   ## scene-id {hold=1 min=4}   (starts a scene; attributes are optional)
//   Narration text. [#mark] Markers name a moment, [pause 0.6] adds silence,
//   and {DNS|D, N, S} shows "DNS" on screen but speaks "D, N, S". *Stars* mark
//   keywords for bold captions, and nobody hears them.
//   > director notes and <!-- comments --> are ignored.
import { periodGoesOn } from './german.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ATTR_NUMBERS = new Set(['hold', 'min', 'lead', 'gap', 'max']);

export class ScriptError extends Error {
  constructor(message, line, file = 'script.md') {
    super(line ? `${file} line ${line}: ${message}` : `${file}: ${message}`);
    this.line = line;
    this.detail = message;
  }
}

export function normWord(w) {
  return String(w)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}%$€£+#@.]/gu, '')
    .replace(/^\.+|\.+$/g, '');
}

function parseAttrs(src, line) {
  const attrs = {};
  if (!src) return attrs;
  const token = /[^\s,=:]+[=:](?:"[^"]*"|'[^']*'|[^\s,]+)|[^\s,]+/y;
  let i = 0;
  while (i < src.length) {
    if (/[\s,]/.test(src[i])) { i++; continue; }
    token.lastIndex = i;
    const part = token.exec(src)?.[0];
    i = token.lastIndex;
    const m = /^([a-zA-Z][\w-]*)\s*[=:]\s*(.+)$/.exec(part);
    if (!m) throw new ScriptError(`cannot read scene attribute "${part}" (use key=value)`, line);
    const [, key, raw] = m;
    const value = raw.replace(/^["']|["']$/g, '');
    if (key === 'chapter' && (!value.trim() || value.length > 60)) throw new ScriptError('chapter title must be 1 to 60 characters', line);
    if (ATTR_NUMBERS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new ScriptError(`attribute ${key} must be a number >= 0`, line);
      attrs[key] = n;
    } else {
      attrs[key] = value;
    }
  }
  return attrs;
}

// Text with no letter, digit or spoken sign in it, like the "?" that French
// writes after a space, or a dash between two words. Stars are left to
// markKeywords.
const PUNCTUATION_ONLY = /^[^\p{L}\p{N}%$€£+#@&°=*]+$/u;
// Punctuation that opens what comes after it.
const NBSP = '\u00a0';
const OPENING = /^[(\[«“‘„‚¿¡「『（]+$/u;

// The words of a spoken text, without punctuation that stands alone.
export function spokenWords(text) {
  return String(text).split(/\s+/).filter((w) => w && !PUNCTUATION_ONLY.test(w));
}

// Splits one scene's narration into units. A unit is a word (or an override
// group) with separate display and spoken text, a marker, or a pause. A token
// of punctuation alone is never a word: it joins the word before it, and an
// opening one like "«" or "¿" joins the word after it. The space stays, as a
// space that doesn't break the line, so "pluie ?" is shown as written, and the
// voice gets the same text as before.
export function tokenizeNarration(text, line = 0, language = 'en') {
  const units = [];
  const segmenter = ['ja', 'zh'].includes(language) ? new Intl.Segmenter(language, { granularity: 'word' }) : null;
  const punctuation = segmenter ? /^[.,;:!?।。！？、，；：）」』)\]"'’”…]+$/ : /^[.,;:!?।)\]"'’…]+$/;
  let i = 0;
  let pendingSpace = false;
  // Opening punctuation that waits for its word.
  let opener = null;
  const n = text.length;
  const lastWord = () => units.findLast((u) => u.type === 'word') ?? null;
  const pushWord = (display, spoken) => {
    const prev = units[units.length - 1];
    if (!pendingSpace && prev && prev.type === 'word' && punctuation.test(display)) {
      prev.display += display;
      prev.spoken += spoken;
      return;
    }
    if (PUNCTUATION_ONLY.test(display) && PUNCTUATION_ONLY.test(spoken)) {
      const before = lastWord();
      if (opener || OPENING.test(display) || !before) {
        opener = opener
          ? { ...opener, display: opener.display + (pendingSpace ? NBSP : '') + display, spoken: opener.spoken + (pendingSpace ? ' ' : '') + spoken }
          : { display, spoken, space: pendingSpace || !before };
      } else {
        before.display += (pendingSpace ? NBSP : '') + display;
        before.spoken += (pendingSpace ? ' ' : '') + spoken;
      }
      pendingSpace = false;
      return;
    }
    if (opener) {
      units.push({ type: 'word', display: opener.display + (pendingSpace ? NBSP : '') + display, spoken: opener.spoken + (pendingSpace ? ' ' : '') + spoken, space: opener.space });
      opener = null;
      pendingSpace = false;
      return;
    }
    units.push({ type: 'word', display, spoken, space: pendingSpace || !units.some((u) => u.type === 'word') });
    pendingSpace = false;
  };
  // Opening punctuation with no word after it joins the last word.
  const finishOpener = () => {
    const before = lastWord();
    if (opener && before) {
      before.display += (opener.space ? NBSP : '') + opener.display;
      before.spoken += (opener.space ? ' ' : '') + opener.spoken;
    }
    opener = null;
  };
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { pendingSpace = true; i++; continue; }
    if (text.startsWith('[#', i)) {
      const end = text.indexOf(']', i);
      const name = end === -1 ? '' : text.slice(i + 2, end);
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new ScriptError(`marker "${text.slice(i, end + 1 || i + 12)}" should look like [#name]`, line);
      units.push({ type: 'mark', name });
      i = end + 1;
      continue;
    }
    if (text.startsWith('[pause', i)) {
      const end = text.indexOf(']', i);
      const arg = end === -1 ? null : text.slice(i + 6, end).trim();
      const sec = arg === '' ? 0.5 : Number(arg);
      if (end === -1 || !Number.isFinite(sec) || sec < 0 || sec > 10) throw new ScriptError('pauses look like [pause] or [pause 0.8] (0 to 10 seconds)', line);
      units.push({ type: 'pause', sec });
      pendingSpace = true;
      i = end + 1;
      continue;
    }
    if (c === '{') {
      const end = text.indexOf('}', i);
      const inner = end === -1 ? '' : text.slice(i + 1, end);
      const bar = inner.indexOf('|');
      if (end === -1 || bar === -1 || !inner.slice(0, bar).trim() || !inner.slice(bar + 1).trim()) {
        throw new ScriptError('pronunciation overrides look like {shown|spoken}, for example {SQL|sequel}', line);
      }
      let j = end + 1;
      while (j < n && !/\s/.test(text[j]) && text[j] !== '[' && text[j] !== '{' && (!segmenter || punctuation.test(text[j]))) j++;
      const trail = text.slice(end + 1, j);
      pushWord(inner.slice(0, bar).trim() + trail, inner.slice(bar + 1).trim() + trail);
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(text[j]) && !text.startsWith('[#', j) && !text.startsWith('[pause', j) && text[j] !== '{') j++;
    const word = text.slice(i, j);
    if (segmenter) {
      let prefix = '';
      for (const part of segmenter.segment(word)) {
        if (!part.isWordLike && (/[「『（“‘(]/u.test(part.segment) || !units.some(u => u.type === 'word'))) { prefix += part.segment; continue; }
        pushWord(prefix + part.segment, prefix + part.segment);
        prefix = '';
      }
      if (prefix) pushWord(prefix, prefix);
    } else pushWord(word, word);
    i = j;
  }
  finishOpener();
  return markKeywords(units);
}

// Punctuation that stands alone joins its word with a space that doesn't break,
// so the stars may have one, or a plain space in the spoken text, on their outer side.
const STAR_OPEN = /^([(\[{"'“‘«¿¡「『（\u00a0 ]*)\*+(?=[^*])/u;
const STAR_CLOSE = /([^*])\*+([.,;:!?…।)\]}"'’”»。！？、，；：」』）\u00a0 ]*)$/u;
// Stars with nothing but punctuation around them, like "*" or "*。".
const STARS = /^([^\p{L}\p{N}*]*)\*+([^\p{L}\p{N}*]*)$/u;
const hasText = (word) => /[\p{L}\p{N}]/u.test(word);

// *Stars* around a word, or around several words, mark keywords for bold
// captions. They come off the shown and the spoken word, which gets `key`, so
// the voice, the captions and the cues never see them. A star that opens or
// closes nothing stays as it is, like the one in "2 * 3", and of two opening
// stars the later one counts. Stars on their own open the word right after
// them or close the word right before them, as they do between Japanese or
// Chinese words, and their punctuation joins that word, as it would without them.
function markKeywords(units) {
  const drop = new Set();
  let start = null;
  let opener = null;
  const finish = (to) => {
    mark(units, start, to);
    if (opener !== null) {
      const [, before, after] = STARS.exec(units[opener].display);
      units[start].display = before + after + units[start].display;
      units[start].spoken = before + after + units[start].spoken;
      units[start].space = units[opener].space;
      drop.add(opener);
    }
    start = null;
    opener = null;
  };
  units.forEach((u, i) => {
    if (u.type !== 'word') return;
    const stars = STARS.exec(u.display);
    if (stars) {
      const next = units[i + 1];
      if (start !== null && !u.space) {
        let last = i - 1;
        while (last > start && units[last].type !== 'word') last--;
        units[last].display += stars[1] + stars[2];
        units[last].spoken += stars[1] + stars[2];
        drop.add(i);
        finish(last);
      } else if (next?.type === 'word' && !next.space && hasText(next.display)) {
        start = i + 1;
        opener = i;
      }
      return;
    }
    if (STAR_OPEN.test(u.display) && hasText(u.display)) {
      start = i;
      opener = null;
    }
    if (start !== null && STAR_CLOSE.test(u.display) && hasText(u.display)) finish(i);
  });
  return drop.size ? units.filter((u, i) => !drop.has(i)) : units;
}

function mark(units, from, to) {
  const strip = (text, first, last) => {
    let t = text;
    if (first) t = t.replace(STAR_OPEN, '$1');
    if (last) t = t.replace(STAR_CLOSE, '$1$2');
    return t;
  };
  for (let i = from; i <= to; i++) {
    const u = units[i];
    if (u.type !== 'word') continue;
    u.display = strip(u.display, i === from, i === to);
    u.spoken = strip(u.spoken, i === from, i === to);
    u.key = true;
  }
}

// `file` names the script in error messages, like script.es.md.
export function parseScript(source, { language = 'en', file = 'script.md' } = {}) {
  try {
    return parseLines(source, language);
  } catch (e) {
    if (e instanceof ScriptError && file !== 'script.md') throw new ScriptError(e.detail, e.line, file);
    throw e;
  }
}

function parseLines(source, language) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let title = null;
  const scenes = [];
  let current = null;
  let inComment = false;
  const seen = new Set();

  const flushParagraph = () => {
    if (!current) return;
    if (current._para.length) {
      current._paras.push({ text: current._para.join(' '), line: current._paraLine });
      current._para = [];
    }
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) return;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    const trimmed = line.trim();

    const h1 = /^#\s+(.+)$/.exec(trimmed);
    if (h1 && !trimmed.startsWith('##')) {
      if (!current && title === null) title = h1[1].trim();
      else throw new ScriptError('a single "#" title is only allowed once, before the first scene', lineNo);
      return;
    }
    const h2 = /^##\s+([^\s{]+)\s*(?:\{([^}]*)\})?\s*$/.exec(trimmed);
    if (h2) {
      flushParagraph();
      const id = h2[1];
      if (!ID_RE.test(id)) throw new ScriptError(`scene id "${id}" may only use letters, digits, "-" and "_"`, lineNo);
      if (seen.has(id)) throw new ScriptError(`scene id "${id}" is used twice`, lineNo);
      seen.add(id);
      current = { id, attrs: parseAttrs(h2[2], lineNo), line: lineNo, _paras: [], _para: [], _paraLine: lineNo };
      scenes.push(current);
      return;
    }
    if (trimmed.startsWith('##')) throw new ScriptError('scene headings look like "## scene-id" or "## scene-id {hold=1}"', lineNo);
    if (trimmed.startsWith('>')) return;
    if (!trimmed) {
      flushParagraph();
      return;
    }
    if (!current) throw new ScriptError('narration must come after a "## scene-id" heading', lineNo);
    if (!current._para.length) current._paraLine = lineNo;
    current._para.push(trimmed);
  });
  if (inComment) throw new ScriptError('an HTML comment is never closed');
  flushParagraph();
  if (!scenes.length) throw new ScriptError('no scenes found; start one with "## scene-id"');

  return {
    title,
    scenes: scenes.map((s) => {
      const units = [];
      s._paras.forEach((p, pi) => {
        if (pi > 0) units.push({ type: 'pause', sec: null, paragraph: true });
        units.push(...tokenizeNarration(p.text, p.line, language));
      });
      const words = units.filter((u) => u.type === 'word');
      return {
        id: s.id,
        attrs: s.attrs,
        line: s.line,
        units,
        text: words.map((w, i) => (i && w.space ? ' ' : '') + w.display).join(''),
        spoken: words.map((w, i) => (i && w.space ? ' ' : '') + w.spoken).join(''),
      };
    }),
  };
}

// Groups a scene's units into speakable chunks. Each chunk is one sentence (or
// the text between explicit pauses) and is sent to the TTS model on its own,
// which keeps every request well under the model's context limit and gives
// exact control over the silence between sentences. With `chunks: 'pauses'` a
// chunk runs from one pause or paragraph to the next, for a voice that reads
// several sentences in one go and pauses between them by itself. In German, a
// period of an ordinal or a short form inside a sentence, like "am 3. Mai" or
// "z. B.", doesn't end it.
export function speechChunks(units, { sentenceGap = 0.3, paragraphGap = 0.55, pace = 1, language = 'en', chunks: by = 'sentences' } = {}) {
  const cjk = ['ja', 'zh'].includes(language);
  const sentenceEnd = cjk ? /[.!?…।。！？]["'’)\]」』）]*$/ : /[.!?…।]["'’)\]]*$/;
  const chunks = [];
  let cur = null;
  let gapBefore = 0;
  const close = () => {
    if (cur && cur.words.length) chunks.push(cur);
    cur = null;
  };
  // The next word that is spoken without a pause, past any [#marker].
  const after = (index) => {
    for (let k = index + 1; k < units.length; k++) {
      if (units[k].type === 'word') return units[k].spoken;
      if (units[k].type === 'pause') return null;
    }
    return null;
  };
  const goesOn = (u, index) => language === 'de' && periodGoesOn(u.spoken, cur.words.at(-2)?.spoken ?? null, after(index));
  units.forEach((u, index) => {
    if (u.type === 'pause') {
      close();
      gapBefore = u.paragraph ? Math.max(gapBefore, paragraphGap / pace) : gapBefore + u.sec / pace;
      return;
    }
    if (u.type !== 'word') return;
    if (!cur) {
      cur = { gapBefore, words: [], text: '' };
      gapBefore = 0;
    }
    cur.text += (cur.words.length && !cjk ? ' ' : '') + u.spoken;
    cur.words.push({ unitIndex: index, display: u.display, spoken: u.spoken });
    if (by !== 'pauses' && sentenceEnd.test(u.spoken) && !goesOn(u, index)) {
      close();
      gapBefore = sentenceGap / pace;
    }
  });
  close();
  return chunks;
}

// Resolves [#marks] to times once every word unit has a start and end time.
// A mark takes the start of the next word; a mark after the last word takes
// the end of the last word.
export function resolveMarks(units, wordTimes) {
  const marks = {};
  units.forEach((u, i) => {
    if (u.type !== 'mark') return;
    let t = null;
    for (let j = i + 1; j < units.length; j++) {
      if (units[j].type === 'word' && wordTimes[j]) { t = wordTimes[j].start; break; }
    }
    if (t === null) {
      for (let j = i - 1; j >= 0; j--) {
        if (units[j].type === 'word' && wordTimes[j]) { t = wordTimes[j].end; break; }
      }
    }
    marks[u.name] = t ?? 0;
  });
  return marks;
}
