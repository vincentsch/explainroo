// Burned-in captions built from the narration's word timings. The current
// phrase is shown; words light up as they are spoken.
import { fontString } from './themes.js';
import { clamp, ease } from './util.js';

export function buildPhrases(timeline, maxChars) {
  const phrases = [];
  for (const sc of timeline.scenes) {
    let cur = null;
    const flush = () => {
      if (cur && cur.words.length) phrases.push(cur);
      cur = null;
    };
    sc.words.forEach((w, i) => {
      const g = { text: w.text, start: sc.start + w.start, end: sc.start + w.end };
      if (cur) {
        const len = cur.words.reduce((n, x) => n + x.text.length + 1, 0) + g.text.length;
        const gapBefore = g.start - cur.words[cur.words.length - 1].end;
        if (len > maxChars || gapBefore > 0.55) flush();
      }
      if (!cur) cur = { words: [], start: g.start };
      cur.words.push(g);
      cur.end = g.end;
      if (/[.!?;:।]["'’)]*$/.test(g.text) || (/,$/.test(g.text) && cur.words.length >= 4)) flush();
    });
    flush();
  }
  phrases.forEach((p, i) => {
    const next = phrases[i + 1];
    p.until = next ? Math.min(next.start, p.end + 0.9) : p.end + 0.9;
  });
  return phrases;
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
  const space = ctx.measureText(' ').width;
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
