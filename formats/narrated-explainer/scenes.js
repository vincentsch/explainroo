// The example of the narrated-explainer format: why ice floats on water.
// Replace the words and pictures with your topic, one idea per scene.
import { bigNumber, body, heading, question, steps, takeaways, unit } from './format.js';

export default {
  question(s) {
    question(s, 'Why does ice *float*?', { icon: 'snowflake', color: 'blue' });
    const u = unit(s);
    s.note('most solids sink', { x: s.cx, y: s.safe.bottom - u * 8, size: u * 5, at: '#sink' });
  },

  molecules(s) {
    heading(s, 'Water freezes into an *open pattern*', { at: 0 });
    const b = body(s);
    const u = unit(s);
    const r = u * 2.6;
    // Liquid: dots that move and sit close. Ice: the same dots on a grid with space between them.
    const liquid = s.portrait ? { x: b.cx, y: b.y + b.h * 0.25 } : { x: b.x + b.w * 0.27, y: b.cy };
    const solid = s.portrait ? { x: b.cx, y: b.y + b.h * 0.75 } : { x: b.x + b.w * 0.73, y: b.cy };
    const box = u * 34;
    s.box('', { id: 'water', x: liquid.x, y: liquid.y, w: box, h: box, color: 'blue', at: '#move', overlap: true });
    s.box('', { id: 'ice', x: solid.x, y: solid.y, w: box, h: box, color: 'teal', at: '#freeze', overlap: true });
    s.draw({ at: '#move', box: { x: liquid.x, y: liquid.y, w: box, h: box } }, (ctx) => {
      ctx.fillStyle = '#1c7ed6';
      for (let i = 0; i < 24; i++) {
        const x = liquid.x + s.noise(i * 3.1 + s.t * 0.6) * box * 0.4;
        const y = liquid.y + s.noise(i * 7.7 + 40 + s.t * 0.6) * box * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    s.draw({ at: '#lattice', enter: 'fade', box: { x: solid.x, y: solid.y, w: box, h: box } }, (ctx) => {
      ctx.fillStyle = '#0c8599';
      const step = box / 4;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const x = solid.x - step + col * step + (row % 2 ? step / 2 - step / 4 : -step / 4);
          const y = solid.y - step + row * step;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    s.arrow('water', 'ice', { label: 'freezes', at: '#freeze' });
    s.text('liquid', { x: liquid.x, y: liquid.y + box / 2 + u * 6, size: u * 5, color: 'muted', at: '#move' });
    s.text('ice: *more space*', { x: solid.x, y: solid.y + box / 2 + u * 6, size: u * 5, color: 'muted', at: '#gaps' });
  },

  number(s) {
    heading(s, 'Ice is *lighter* for its size', { at: 0 });
    bigNumber(s, 9, { suffix: '%', caption: 'less dense than water', at: '#number', captionAt: '#number' });
    const u = unit(s);
    s.icon('arrow-up', { x: s.cx + s.safe.w * 0.3, y: s.cy - u * 6, size: u * 16, color: 'blue', label: 'so it floats', labelSize: u * 5, at: '#float' });
  },

  lakes(s) {
    heading(s, 'Lakes freeze from the *top*', { at: 0 });
    steps(s, [
      { label: 'Ice forms on top', icon: 'snowflake', color: 'blue', at: '#top' },
      { label: 'It covers the lake', icon: 'layers', color: 'teal', at: '#lid' },
      { label: 'Fish stay warm below', icon: 'fish', color: 'orange', at: '#fish' },
    ]);
  },

  summary(s) {
    takeaways(s, 'What to remember', [
      { text: 'Frozen water takes *more space*', at: '#s1' },
      { text: 'So ice is *lighter* than water', at: '#s2' },
      { text: 'That keeps lakes *alive*', at: '#s3' },
    ], { at: '#sum' });
  },
};
