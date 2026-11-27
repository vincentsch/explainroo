// A logo reveal without words, cut to the music. The mark builds itself on the
// beats of the first two bars, lands on the cut with a hit, and the wordmark
// wipes in beside it. Everything comes from s.t and the beats, so every frame
// is the same on every render page.
const CORAL = '#e25c3f';
const CREAM = '#fdf8f0';
const MARK = 220;

// The play mark around 0, 0: a rounded square, `fill` from 0 to 1, with its
// outline drawn up to `outline` of the way round, and the play triangle.
function mark(ctx, { outline = 1, fill = 1, triangle = 1 }) {
  const r = MARK * 0.24;
  const square = new Path2D();
  square.roundRect(-MARK / 2, -MARK / 2, MARK, MARK, r);
  if (outline > 0 && fill < 1) {
    const around = 4 * (MARK - 2 * r) + 2 * Math.PI * r;
    ctx.save();
    ctx.strokeStyle = CORAL;
    ctx.lineWidth = 10;
    ctx.setLineDash([around * outline, around]);
    ctx.stroke(square);
    ctx.restore();
  }
  if (fill > 0) {
    ctx.save();
    ctx.globalAlpha *= fill;
    ctx.fillStyle = CORAL;
    ctx.fill(square);
    ctx.restore();
  }
  if (triangle > 0) {
    const t = MARK * 0.2;
    ctx.save();
    ctx.scale(triangle, triangle);
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = CREAM;
    ctx.lineJoin = 'round';
    ctx.lineWidth = MARK * 0.06;
    ctx.beginPath();
    ctx.moveTo(-t * 0.75, -t * 1.1);
    ctx.lineTo(t * 1.2, 0);
    ctx.lineTo(-t * 0.75, t * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export default {
  build(s) {
    s.camera([]);
    const { cx, cy } = s;
    // Bar 1: the outline draws itself, one side a beat, with a small pulse on each beat.
    const outline = s.keys([{ at: s.beat(1), v: 0 }, { at: s.beat(5), v: 1, ease: 'linear' }]);
    const pulse = [1, 2, 3, 4].reduce((k, n) => k + 0.06 * Math.max(0, 1 - Math.abs(s.t - s.beat(n)) / 0.12), 1);
    // Bar 2: it fills with a spring, and the triangle pops in on beat 3 of the bar.
    const fill = s.p(s.beat(5), 0.4, 'out');
    const triangle = s.p(s.beat(7), 0.45, 'spring');
    const grow = s.keys([{ at: s.beat(5), v: 1 }, { at: s.beat(6), v: 1.12, ease: 'outBack' }]);
    s.draw({ x: cx, y: cy, at: 0, box: { x: 0, y: 0, w: MARK * 1.2, h: MARK * 1.2 } }, (ctx) => {
      ctx.scale(pulse * grow, pulse * grow);
      mark(ctx, { outline, fill, triangle });
    });
    for (const n of [1, 2, 3, 4]) s.sfx('tick', s.beat(n), { gain: 0.6 });
    s.sfx('pop', s.beat(7));
    // A riser through the second bar leads into the hit on the cut.
    s.sfx('rise', s.beat(5), { dur: s.bar(3) - s.beat(5) });
  },

  reveal(s) {
    s.camera([]);
    const { cx, cy } = s;
    // The logo as a whole: the mark, a gap and the wordmark from the image,
    // whose letters start 230 pixels into the file and are 762 wide.
    const k = MARK / 160;
    const wordW = 762 * k;
    const wordH = 264 * k;
    const left = cx - (MARK + 40 * k + wordW) / 2;
    const markX = s.keys([{ at: 0, v: cx }, { at: s.beat(2), v: left + MARK / 2, ease: 'inOut' }]);
    // The hit: the mark lands big and settles.
    const land = s.keys([{ at: 0, v: 1.35 }, { at: 0.5, v: 1, ease: 'outBack' }]);
    s.draw({ x: markX, y: cy, at: -1, box: { x: 0, y: 0, w: MARK, h: MARK } }, (ctx) => {
      ctx.scale(land, land);
      mark(ctx, {});
    });
    // Sparks fly out from the mark on the hit and fade.
    s.draw({ x: cx, y: cy, at: 0, out: 1.2, exit: 'none', overlap: true, box: { x: 0, y: 0, w: 900, h: 900, round: true } }, (ctx, life) => {
      const p = Math.min(1, life.local / 1.1);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + (i % 2) * 0.11;
        const d = MARK * 0.7 + (300 + (i % 3) * 80) * (1 - (1 - p) ** 3);
        ctx.globalAlpha = (1 - p) ** 1.5;
        ctx.fillStyle = i % 3 ? CORAL : CREAM;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 7 * (1 - p) + 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    s.sfx('impact', 0.02);
    // The wordmark wipes in from its left edge over beats 2 to 4.
    const wipe = Math.max(0.001, s.p(s.beat(2), s.beat(4) - s.beat(2), 'inOut'));
    const wordLeft = left + MARK + 40 * k;
    s.image('assets/logo-dark.png', { x: wordLeft + (wordW * wipe) / 2, y: cy, w: wordW * wipe, h: wordH, crop: [230, 0, 762 * wipe, 264], at: s.beat(2), enter: 'none', shadow: false });
    s.sfx('whoosh', s.beat(2), { dur: s.beat(4) - s.beat(2) });
    s.text('The video studio your AI agent runs', { y: cy + 230, size: 52, color: 'muted', enter: 'words', at: s.bar(2) });
  },
};
