// Parser for script.md, the narration file of a video project.
//
//   # Title                      (optional, not spoken)
//   ## scene-id {hold=1 min=4}   (starts a scene; attributes are optional)
//   Narration text. [#mark] Markers name a moment, [pause 0.6] adds silence,
//   and {DNS|D N S} shows "DNS" on screen but speaks "D N S".
//   > director notes and <!-- comments --> are ignored.

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ATTR_NUMBERS = new Set(['hold', 'min', 'lead', 'gap', 'max']);

export class ScriptError extends Error {
  constructor(message, line) {
    super(line ? `script.md line ${line}: ${message}` : `script.md: ${message}`);
    this.line = line;
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

// Splits one scene's narration into units. A unit is a word (or an override
// group) with separate display and spoken text, a marker, or a pause.
export function tokenizeNarration(text, line = 0, language = 'en') {
  const units = [];
  const segmenter = ['ja', 'zh'].includes(language) ? new Intl.Segmenter(language, { granularity: 'word' }) : null;
  const punctuation = segmenter ? /^[.,;:!?।。！？、，；：）」』)\]"'’”…]+$/ : /^[.,;:!?।)\]"'’…]+$/;
  let i = 0;
  let pendingSpace = false;
  const n = text.length;
  const pushWord = (display, spoken) => {
    const prev = units[units.length - 1];
    if (!pendingSpace && prev && prev.type === 'word' && punctuation.test(display)) {
      prev.display += display;
      prev.spoken += spoken;
      return;
    }
    units.push({ type: 'word', display, spoken, space: pendingSpace || !units.some((u) => u.type === 'word') });
    pendingSpace = false;
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
  return units;
}

export function parseScript(source, { language = 'en' } = {}) {
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
// exact control over the silence between sentences.
export function speechChunks(units, { sentenceGap = 0.3, paragraphGap = 0.55, pace = 1, language = 'en' } = {}) {
  const cjk = ['ja', 'zh'].includes(language);
  const sentenceEnd = cjk ? /[.!?…।。！？]["'’)\]」』）]*$/ : /[.!?…।]["'’)\]]*$/;
  const chunks = [];
  let cur = null;
  let gapBefore = 0;
  const close = () => {
    if (cur && cur.words.length) chunks.push(cur);
    cur = null;
  };
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
    if (sentenceEnd.test(u.spoken)) {
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
