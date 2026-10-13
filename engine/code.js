// A small syntax highlighter for code on screen. It colors comments, strings,
// numbers, keywords and function calls for the common languages; anything it
// does not know stays plain.
import { clamp, ease, lerp } from './util.js';

const KEYWORDS = {
  js: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false err',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include instanceof interface isset list match namespace new null or print private protected public readonly require return static switch throw trait true false try use var while yield',
  sh: 'if then else elif fi for while do done case esac in function return export local echo exit sudo cd npm npx node git curl',
  sql: 'select from where join left right inner outer on group by order having limit insert into values update set delete create table index as and or not null is in like count sum avg distinct',
  json: 'true false null',
};
KEYWORDS.ts = KEYWORDS.js + ' interface type enum implements private public readonly as';
KEYWORDS.jsx = KEYWORDS.js;
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.bash = KEYWORDS.sh;
KEYWORDS.shell = KEYWORDS.sh;
KEYWORDS.python = KEYWORDS.py;
KEYWORDS.javascript = KEYWORDS.js;
KEYWORDS.typescript = KEYWORDS.ts;

const sets = {};
function keywordSet(lang) {
  const k = String(lang || 'js').toLowerCase();
  if (!sets[k]) sets[k] = new Set((KEYWORDS[k] || KEYWORDS.js).split(' ').map((w) => (k === 'sql' ? w.toLowerCase() : w)));
  return sets[k];
}

function commentStart(lang) {
  const k = String(lang || 'js').toLowerCase();
  if (['py', 'python', 'sh', 'bash', 'shell'].includes(k)) return ['#'];
  if (k === 'sql') return ['--'];
  if (k === 'php') return ['//', '#'];
  if (k === 'json') return [];
  return ['//'];
}

// Markdown, including explainroo's script syntax: headings, [#marks],
// [pause] and {shown|spoken}.
function highlightMarkdown(line) {
  if (/^\s*#/.test(line)) return [{ text: line, type: 'keyword' }];
  if (/^\s*>/.test(line)) return [{ text: line, type: 'comment' }];
  const out = [];
  const re = /(\[#[^\]]*\]|\[pause[^\]]*\])|(\{[^}]*\})|(`[^`]*`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), type: 'plain' });
    out.push({ text: m[0], type: m[1] ? 'string' : m[2] ? 'fn' : 'number' });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), type: 'plain' });
  return out;
}

// One line -> [{ text, type }] with type in comment|string|number|keyword|fn|punct|plain.
export function highlightLine(line, lang) {
  if (['md', 'markdown'].includes(String(lang).toLowerCase())) return highlightMarkdown(line);
  const out = [];
  const kw = keywordSet(lang);
  const isSql = String(lang).toLowerCase() === 'sql';
  const cstarts = commentStart(lang);
  let i = 0;
  const push = (text, type) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ text, type });
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const cs = cstarts.find((c) => rest.startsWith(c));
    if (cs || rest.startsWith('/*')) {
      push(rest, 'comment');
      break;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      push(line.slice(i, j + 1), 'string');
      i = j + 1;
      continue;
    }
    const num = /^(0x[0-9a-f]+|\d+(\.\d+)?)/i.exec(rest);
    if (num && !/[A-Za-z_$]/.test(line[i - 1] || '')) {
      push(num[0], 'number');
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (id) {
      const word = id[0];
      const next = line.slice(i + word.length).trimStart()[0];
      if (kw.has(isSql ? word.toLowerCase() : word)) push(word, 'keyword');
      else if (next === '(') push(word, 'fn');
      else push(word, 'plain');
      i += word.length;
      continue;
    }
    if (/[{}()[\];,.:=<>+\-*/%!&|?]/.test(ch)) {
      push(ch, 'punct');
      i++;
      continue;
    }
    push(ch, 'plain');
    i++;
  }
  return out;
}

export function codeTokens(lines, lang) {
  const tokens = [];
  lines.forEach((line, row) => {
    let column = 0;
    for (const tok of highlightLine(line, lang)) {
      // The highlighter merges adjacent plain text and punctuation. Separate
      // identifiers so a rename does not replace the rest of the line, and keep
      // operators like => whole so the font draws them the same while moving.
      const parts = ['plain', 'punct'].includes(tok.type)
        ? tok.text.match(/\s+|[A-Za-z_$][\w$]*|===|!==|=>|==|!=|<=|>=|&&|\|\||\?\?|\.\.\.|->|::|[^\s]/g) || [] : [tok.text];
      for (const text of parts) {
        if (/\S/.test(text)) tokens.push({ text, type: tok.type, row, column });
        column += text.length;
      }
    }
  });
  return tokens;
}

// Indices into the original sequences, with whitespace left out of the LCS.
export function matchTokens(before, after) {
  const a = before.map((t, i) => i).filter((i) => /\S/.test(before[i].text));
  const b = after.map((t, i) => i).filter((i) => /\S/.test(after[i].text));
  const same = (i, j) => before[a[i]].text === after[b[j]].text && before[a[i]].type === after[b[j]].type;
  const cols = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * cols + j] = same(i, j) ? 1 + lengths[(i + 1) * cols + j + 1]
        : Math.max(lengths[(i + 1) * cols + j], lengths[i * cols + j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(i, j)) { pairs.push([a[i++], b[j++]]); }
    else if (lengths[(i + 1) * cols + j] >= lengths[i * cols + j + 1]) i++;
    else j++;
  }
  return pairs;
}

export function resolveCodeSteps(steps, o, time) {
  if (!steps.length) throw new Error('code needs at least one step');
  let highlight = o.highlight;
  return steps.map((step, i) => {
    if (!step || typeof step.code !== 'string') throw new Error(`code step ${i + 1} needs a code string`);
    if (i && step.at === undefined) throw new Error(`code step ${i + 1} needs an at time`);
    const at = time(step.at ?? o.at ?? 0);
    if (!Number.isFinite(at)) throw new Error(`code step ${i + 1} needs a finite at time`);
    if (step.highlight !== undefined) highlight = step.highlight;
    return { at, lines: step.code.replace(/\t/g, '  ').split('\n'), highlight };
  });
}

export function codeMorphState(steps, t, dur = 0.8, pace = 1) {
  let to = 0;
  for (let i = 1; i < steps.length; i++) if (t >= steps[i].at) to = i;
  const from = Math.max(0, to - 1);
  const raw = to ? (dur > 0 ? clamp((t - steps[to].at) / (dur / pace)) : 1) : 1;
  const p = ease.inOut(raw);
  return { from, to, p, removed: 1 - ease.inOut(clamp(raw * 2)), added: ease.inOut(clamp(raw * 2 - 1)),
    lines: lerp(steps[from].lines.length, steps[to].lines.length, p) };
}
