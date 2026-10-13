// Burned-in captions built from the narration's word timings. The current
// phrase is shown; words light up as they are spoken.
import { fontString } from './themes.js';
import { clamp, ease } from './util.js';

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
      for (const words of balancePhrases(run, maxChars, cjk ? '' : ' ')) phrases.push({ words, ...(cjk ? { separator: '' } : {}), start: words[0].start, end: words[words.length - 1].end });
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
// lengths as even as possible and breaks after commas where they fit.
export function balancePhrases(words, maxChars, separator = ' ') {
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
      const c = { parts: best[a].parts + 1, cost: best[a].cost + (maxChars - l) ** 2 - comma, from: a };
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
