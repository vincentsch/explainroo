// Scene helpers of the motion-short format. scenes.js imports them. Each one
// works out everything from the time and the beats of the music, and places
// things from s.safe, so the piece works wide, square and tall.

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
}

// A scale that kicks up on each of the first `beats` beats of the scene and
// settles in between, for a shape that breathes with the music.
export function beatPulse(s, beats = 4, amount = 0.06) {
  let k = 1;
  for (let n = 1; n <= beats; n++) k += amount * Math.max(0, 1 - Math.abs(s.t - s.beat(n)) / 0.12);
  return k;
}

// Words that land one per beat, from beat `from`, as kinetic type in the
// middle of the content area. Returns the beat after the last word.
export function beatWords(s, words, { from = 1, y = s.cy, size = unit(s) * 11, color = 'ink', accent = [] } = {}) {
  const list = words.split(' ');
  const gap = size * 0.3;
  // The width of each word in the look's display font, the font s.text draws it in.
  const face = s.theme.fonts.display;
  s.ctx.save();
  s.ctx.font = `${face.weight} ${size}px "${face.family}"`;
  const widths = list.map((w) => s.ctx.measureText(w).width);
  s.ctx.restore();
  const total = widths.reduce((a, b) => a + b, 0) + gap * (list.length - 1);
  const scale = Math.min(1, (s.safe.w * 0.9) / total);
  let x = s.cx - (total * scale) / 2;
  list.forEach((word, i) => {
    const w = widths[i] * scale;
    s.text(word, { x: x + w / 2, y, size: size * scale, font: 'display', color: accent.includes(i) ? 'accent' : color, enter: 'pop', at: s.beat(from + i), sfx: i === 0 ? undefined : false });
    x += w + gap * scale;
  });
  return from + list.length;
}

// Sparks that fly out from (x, y) on a hit and fade within a second.
export function sparks(s, x, y, at, { count = 28, reach = unit(s) * 34, colors = ['accent', 'ink'] } = {}) {
  const tones = colors.map((c) => s.color(c));
  s.draw({ x, y, at, out: s.time(at) + 1.1, exit: 'none', overlap: true, box: { x: 0, y: 0, w: reach * 2.2, h: reach * 2.2, round: true } }, (ctx, life) => {
    const p = Math.min(1, life.local / 1.05);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 2) * 0.11;
      const d = reach * (0.35 + (0.65 + (i % 3) * 0.12) * (1 - (1 - p) ** 3));
      ctx.globalAlpha = (1 - p) ** 1.5;
      ctx.fillStyle = tones[i % tones.length];
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, (reach / 45) * (1 - p) + 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
