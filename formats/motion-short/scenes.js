// A launch teaser without narration, in four scenes of two bars each. Every
// time comes from the music's beats, so the motion lands on the beat at any
// tempo. Swap the words, the icon and the colors for the user's product.
import { unit, beatPulse, beatWords, sparks } from './format.js';

export default {
  // Bar 1: a ring breathes on each beat. Bar 2: the first words land.
  open(s) {
    s.camera([]);
    const u = unit(s);
    const ring = beatPulse(s, 4);
    s.draw({ x: s.cx, y: s.cy - u * 14, at: -1, box: { x: 0, y: 0, w: u * 30, h: u * 30, round: true } }, (ctx) => {
      ctx.scale(ring, ring);
      ctx.strokeStyle = s.color('accent');
      ctx.lineWidth = u * 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, u * 13, 0, Math.PI * 2 * s.p(0, s.bar(2), 'out'));
      ctx.stroke();
    });
    beatWords(s, 'Something new', { from: 5, y: s.cy + u * 20, size: u * 15 });
  },

  // A promise in three words, one per beat, with the key word in the accent color.
  idea(s) {
    s.camera([]);
    const u = unit(s);
    beatWords(s, 'Faster than ever', { from: 1, size: u * 18, accent: [0] });
    s.sfx('rise', s.beat(5), { dur: s.bar(3) - s.beat(5) });
  },

  // The hit on the cut: the mark lands big and settles, with sparks, and a
  // ripple goes out from it on each beat after that.
  reveal(s) {
    s.camera([]);
    const u = unit(s);
    const land = s.keys([{ at: 0, v: 1.4 }, { at: 0.45, v: 1, ease: 'outBack' }]);
    s.draw({ x: s.cx, y: s.cy, at: s.beat(2), overlap: true, box: { x: 0, y: 0, w: u * 70, h: u * 70, round: true } }, (ctx) => {
      ctx.strokeStyle = s.color('accent');
      for (let n = 2; n <= 8; n++) {
        const p = (s.t - s.beat(n)) / (s.beat(2) - s.beat(1)) / 1.6;
        if (p < 0 || p > 1) continue;
        ctx.globalAlpha = (1 - p) * 0.6;
        ctx.lineWidth = u * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, u * (19 + 16 * p), 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    s.icon('rocket', { x: s.cx, y: s.cy, size: u * 34 * land * beatPulse(s, 8, 0.03), color: 'accent', bg: 'circle', at: -1, sfx: false });
    sparks(s, s.cx, s.cy, 0.02);
    s.sfx('impact', 0.02);
  },

  // The name and the date, held to the closing hit of the music.
  end(s) {
    s.camera([]);
    const u = unit(s);
    const title = s.title('Launch day', { y: s.cy - u * 6, size: u * 16, at: s.beat(1), enter: 'pop' });
    s.line([[s.cx - title.w * 0.35, title.bottom + u * 3], [s.cx + title.w * 0.35, title.bottom + u * 3]], { color: 'accent', width: u * 0.8, enter: 'draw', at: s.beat(2), dur: s.beat(4) - s.beat(2) });
    s.subtitle('December 4', { y: title.bottom + u * 11, size: u * 7, at: s.beat(3) });
  },
};
