// Burned-in captions built from the narration's word timings. The current
// phrase is shown; words light up as they are spoken.
import { fontString } from './themes.js';
import { clamp, ease } from './util.js';
import { BOLD_CAPTION_SIZE } from './layout.js';

// Some words belong to the word before them, so a phrase or line should not
// start with one: Japanese particles and verb endings (short hiragana pieces
// such as は, ごと, せん, or ones starting like ません), a one-kanji suffix
// such as the 暦 of グレゴリオ暦, Chinese particles such as 的, and counters
// after a number (4年, 365天).
const JAPANESE_ENDINGS = /^(ませ|まし|でし|です|ます|しょう|られ|させ|され|なかっ|ながら|ような|ように|という|として|について|によって|くらい|ぐらい)/;
export function clingsToPrevious(language) {
  const counter = (text, before) => /\d$/.test(before) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  if (language === 'ja') {
    return (text, before = '') => {
      const word = text.replace(/[、。！？「」『』（）]+$/, '');
      const ending = /^[\u3041-\u3096]+$/.test(word) && (word.length <= 2 || JAPANESE_ENDINGS.test(word));
      const suffix = /^\p{Script=Han}$/u.test(word) && /[\p{Script=Han}\p{Script=Katakana}]$/u.test(before);
      return ending || suffix || counter(text, before);
    };
  }
  if (language === 'zh') return (text, before = '') => /^[的了吗呢吧啊着过得地们][，。！？、]*$/.test(text) || counter(text, before);
  return () => false;
}

export function buildPhrases(timeline, maxChars) {
  const cjk = ['ja', 'zh'].includes(timeline.language);
  const sentenceEnd = cjk ? /[.!?;:।。！？]["'’)」』）]*$/ : /[.!?;:।]["'’)]*$/;
  if (cjk) maxChars = Math.min(maxChars, 18);
  const phrases = [];
  for (const sc of timeline.scenes) {
    // A sentence (or a run of words between long pauses) is split into as few
    // phrases as fit, balanced in length, so no phrase is one lonely word.
    let run = [];
    const flush = () => {
      for (const words of balancePhrases(run, maxChars, cjk ? '' : ' ', clingsToPrevious(timeline.language))) phrases.push({ words, ...(cjk ? { separator: '' } : {}), start: words[0].start, end: words[words.length - 1].end });
      run = [];
    };
    for (const w of sc.words) {
      const g = { text: w.text, start: sc.start + w.start, end: sc.start + w.end };
      if (run.length && g.start - run[run.length - 1].end > 0.55) flush();
      run.push(g);
      if (sentenceEnd.test(g.text)) flush();
    }
    if (run.length) flush();
  }
  phrases.forEach((p, i) => {
    const next = phrases[i + 1];
    p.until = next ? Math.min(next.start, p.end + 0.9) : p.end + 0.9;
  });
  return phrases;
}

// Splits words into the fewest phrases of at most maxChars characters, with
// lengths as even as possible and breaks after commas where they fit, never
// before a word that clings to the one before it if that can be helped.
export function balancePhrases(words, maxChars, separator = ' ', clings = () => false) {
  if (!words.length) return [];
  const len = (a, b) => words.slice(a, b).reduce((n, w) => n + w.text.length + separator.length, -separator.length);
  if (len(0, words.length) <= maxChars) return [words];
  const punctuation = separator === '' ? /[,;:–—、，；：]["'’)」』）]*$/ : /[,;:–—]["'’)]*$/;
  const n = words.length;
  const best = [{ parts: 0, cost: 0, from: -1 }];
  for (let b = 1; b <= n; b++) {
    best[b] = null;
    for (let a = b - 1; a >= 0; a--) {
      const l = len(a, b);
      if (l > maxChars && b - a > 1) break;
      if (!best[a]) continue;
      const comma = b < n && punctuation.test(words[b - 1].text) ? 150 : 0;
      const glued = b < n && !comma && clings(words[b].text, words[b - 1].text) ? 250 : 0;
      const c = { parts: best[a].parts + 1, cost: best[a].cost + (maxChars - l) ** 2 - comma + glued, from: a };
      if (!best[b] || c.parts < best[b].parts || (c.parts === best[b].parts && c.cost < best[b].cost)) best[b] = c;
    }
  }
  const out = [];
  for (let b = n; b > 0; b = best[b].from) out.unshift(words.slice(best[b].from, b));
  return out;
}

// `area` ({ cx, bottom, maxWidth }) places the captions inside a platform's
// safe area, right above the band the app covers with its own text.
export function drawCaptions(ctx, phrases, T, theme, W, H, area = null) {
  const ph = phrases.find((p) => T >= p.start - 0.08 && T < p.until);
  if (!ph) return;
  const vertical = H > W;
  const size = vertical ? 58 : 44;
  const font = fontString(theme, 'body', size, theme.fonts.body.family === 'Inter' ? 600 : undefined);
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(ph.separator ?? ' ').width;
  const widths = ph.words.map((w) => ctx.measureText(w.text).width);
  const maxLine = area ? area.maxWidth - size * 1.1 : W * (vertical ? 0.8 : 0.7);
  const lines = [[]];
  let lw = 0;
  ph.words.forEach((w, i) => {
    const add = (lines[lines.length - 1].length ? space : 0) + widths[i];
    if (lw + add > maxLine && lines[lines.length - 1].length) {
      lines.push([]);
      lw = 0;
    }
    lines[lines.length - 1].push(i);
    lw += (lines[lines.length - 1].length > 1 ? space : 0) + widths[i];
  });
  const lh = size * 1.3;
  const boxW = Math.max(...lines.map((l) => l.reduce((a, i, k) => a + widths[i] + (k ? space : 0), 0))) + size * 1.1;
  const boxH = lines.length * lh + size * 0.55;
  const cx = area ? area.cx : W / 2;
  const cy = area ? area.bottom - boxH / 2 : vertical ? H * 0.74 : H - Math.max(96, H * 0.1) - boxH / 2 + lh / 2;
  const fadeIn = ease.out(clamp((T - (ph.start - 0.08)) / 0.15));
  const fadeOut = 1 - clamp((T - (ph.until - 0.15)) / 0.15);
  ctx.globalAlpha = Math.min(fadeIn, fadeOut);
  ctx.fillStyle = theme.caption.bg;
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, Math.min(22, boxH / 2));
  ctx.fill();
  lines.forEach((l, li) => {
    const total = l.reduce((a, i, k) => a + widths[i] + (k ? space : 0), 0);
    let x = cx - total / 2;
    const y = cy - boxH / 2 + size * 0.275 + lh * li + lh / 2;
    for (const i of l) {
      const w = ph.words[i];
      ctx.fillStyle = T >= w.start ? theme.caption.active : theme.caption.fg;
      ctx.fillText(w.text, x, y);
      x += widths[i] + space;
    }
  });
  ctx.restore();
}

// ---------- bold captions ----------
// "captions": "bold" shows two to four big words at a time, white with a dark
// outline. Words marked with *stars* in the script, numbers and money get the
// keyword color. A chunk pops in as its first word is spoken.

export const BOLD_CAPTIONS = { font: 'Inter', weight: 900, fill: '#ffffff', key: '#ffd43b', stroke: '#0b0b10' };

const SENTENCE_END = /[.!?;:…।]["'’”)\]]*$/;
const COMMA = /[,–—]["'’”)\]]*$/;

// A word with *stars* in the script, a number or an amount of money.
export function isKeyword(word) {
  return Boolean(word.key) || /\p{Nd}/u.test(word.text) || /^[$€£¥₹]/.test(word.text);
}

// Splits timed words into chunks of at most four words and about 18 letters.
// A chunk never runs across a sentence end or a long pause, a comma after two
// words or more ends one, and a lonely last word joins the chunk before it.
// A chunk shows until the next one starts, or a moment after its last word.
export function boldChunks(words, { maxWords = 4, maxChars = 18, pause = 0.35, hold = 0.45 } = {}) {
  const runs = [];
  let run = [];
  words.forEach((w, i) => {
    run.push(w);
    const next = words[i + 1];
    if (!next || SENTENCE_END.test(w.text) || next.start - w.end > pause) {
      runs.push(run);
      run = [];
    }
  });
  const chunks = [];
  for (const list of runs) {
    const groups = [];
    let cur = [];
    let chars = 0;
    for (const w of list) {
      if (cur.length && (cur.length >= maxWords || chars + 1 + w.text.length > maxChars)) {
        groups.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(w);
      chars += (cur.length > 1 ? 1 : 0) + w.text.length;
      if (cur.length >= 2 && COMMA.test(w.text)) {
        groups.push(cur);
        cur = [];
        chars = 0;
      }
    }
    if (cur.length) groups.push(cur);
    const last = groups.length - 1;
    if (last > 0 && groups[last].length === 1) {
      if (groups[last - 1].length >= 3) groups[last].unshift(groups[last - 1].pop());
      else groups[last - 1].push(...groups.pop());
    }
    for (const g of groups) chunks.push({ words: g, start: g[0].start, end: g[g.length - 1].end });
  }
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    c.until = next && next.start - c.end < 0.6 ? next.start : c.end + hold;
    if (next) c.until = Math.min(c.until, next.start);
  });
  return chunks;
}

// The chunks of the whole video, scene by scene. A chunk leaves when the next one comes.
export function buildChunks(timeline) {
  const chunks = [];
  for (const sc of timeline.scenes) chunks.push(...boldChunks(sc.words.map((w) => ({ text: w.text, key: isKeyword(w), start: sc.start + w.start, end: sc.start + w.end }))));
  chunks.forEach((c, i) => {
    if (chunks[i + 1]) c.until = Math.min(c.until, chunks[i + 1].start);
  });
  return chunks;
}

// A caption shows a word without a comma or a period after it.
export function boldText(text) {
  return String(text).replace(/[,.;:]+(["'’”)\]]*)$/, '$1');
}

// `area` ({ cx, cy, bottom, maxWidth }) is the band from layoutAreas.
export function drawBoldCaptions(ctx, chunks, T, W, H, area, style = BOLD_CAPTIONS) {
  const ch = chunks.find((c) => T >= c.start - 0.05 && T < c.until);
  if (!ch) return;
  const words = ch.words.map((w) => ({ key: w.key, show: boldText(w.text) })).filter((w) => w.show);
  if (!words.length) return;
  const base = H > W ? BOLD_CAPTION_SIZE.tall : BOLD_CAPTION_SIZE.wide;
  const maxW = area.maxWidth - 24;
  const maxH = 2 * (area.bottom - area.cy);
  ctx.save();
  const measure = (size) => {
    ctx.font = `${style.weight} ${size}px "${style.font}", sans-serif`;
    // The outline takes part of each space, so words get a little more room.
    const space = ctx.measureText(' ').width + size * 0.14;
    const widths = words.map((w) => ctx.measureText(w.show).width);
    return { size, space, widths, total: widths.reduce((a, b) => a + b, 0) + space * (words.length - 1) };
  };
  // A long chunk shrinks to fit one line, down to 62% of the size.
  let m = measure(base);
  if (m.total > maxW) m = measure(Math.max(base * 0.62, (base * maxW) / m.total));
  // Still too wide: more lines.
  const lines = [[]];
  let lw = 0;
  words.forEach((w, i) => {
    const line = lines[lines.length - 1];
    if (line.length && lw + m.space + m.widths[i] > maxW) {
      lines.push([i]);
      lw = m.widths[i];
    } else {
      line.push(i);
      lw += (line.length > 1 ? m.space : 0) + m.widths[i];
    }
  });
  const lineWidth = (l) => l.reduce((a, i, n) => a + m.widths[i] + (n ? m.space : 0), 0);
  const lh = m.size * 1.08;
  // A word wider than the band, or a third line, scales the whole chunk down to fit.
  const fit = Math.min(1, maxW / Math.max(...lines.map(lineWidth)), maxH / (lines.length * lh + m.size * 0.2));
  const k = clamp((T - (ch.start - 0.05)) / 0.14);
  const pop = 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
  const fade = 1 - clamp((T - (ch.until - 0.06)) / 0.06);
  ctx.globalAlpha = Math.min(1, k * 3) * fade;
  ctx.translate(area.cx, area.cy);
  ctx.scale((0.78 + 0.22 * pop) * fit, (0.78 + 0.22 * pop) * fit);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // Shadows are measured in pixels of the canvas, so they follow the scale.
  const px = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  const y0 = -((lines.length - 1) * lh) / 2;
  lines.forEach((l, li) => {
    let x = -lineWidth(l) / 2;
    const y = y0 + li * lh;
    for (const i of l) {
      // A soft shadow, then a thick outline, then the fill.
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = m.size * 0.22 * px;
      ctx.shadowOffsetY = m.size * 0.07 * px;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = m.size * 0.2;
      ctx.strokeText(words[i].show, x, y);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = words[i].key ? style.key : style.fill;
      ctx.fillText(words[i].show, x, y);
      x += m.widths[i] + m.space;
    }
  });
  ctx.restore();
}
