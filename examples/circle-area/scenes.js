// Geometry is in canvas pixels; every sector remains a circular sector.
// For n even: half-angle d=pi/n, projected half-chord a=R sin(d),
// distance between the alternating tips h=R cos(d).
// The n/2 arcs on EACH long edge have total length pi R.
const TAU = Math.PI * 2;
const R = 255;
const CX = 960;
const CY = 550;

function heading(s, text, at = -1) {
  s.text(text, { x: 960, y: 155, size: 88, font: 'display', at, enter: at < 0 ? 'none' : 'write', sfx: false });
}
function label(s, text, x, y, at, extra = {}) {
  s.text(text, { x, y, size: 48, at, sfx: false, ...extra });
}
function stroke(ctx, pts, color, width = 4) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
}
function sector(ctx, radius, delta, color, ink, alpha = 1, inner = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -Math.PI / 2 - delta, -Math.PI / 2 + delta);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.12;
  ctx.fill();
  ctx.globalAlpha /= 0.12;
  const a = radius * Math.sin(delta), h = radius * Math.cos(delta);
  ctx.save();
  ctx.globalAlpha *= inner;
  stroke(ctx, [[-a, -h], [0, 0], [a, -h]], ink, 2.4);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, radius, -Math.PI / 2 - delta, -Math.PI / 2 + delta);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}
function row(ctx, s, n, radius = R, x = CX, y = CY, alpha = 1) {
  const d = Math.PI / n, a = radius * Math.sin(d), h = radius * Math.cos(d);
  for (let j = 0; j < n; j++) {
    ctx.save();
    ctx.translate(x + (j - (n - 1) / 2) * a, y + (j % 2 ? -h / 2 : h / 2));
    ctx.rotate(j % 2 ? Math.PI : 0);
    sector(ctx, radius, d, s.color(j % 2 ? 'blue' : 'yellow'), s.color('ink'), alpha, n >= 64 ? 0.2 : n >= 32 ? 0.35 : 0.65);
    ctx.restore();
  }
}
function circle(s, { x = 560, y = 550, r = 235, at = -1, out } = {}) {
  // Exact circular geometry makes the radius endpoint land on the boundary.
  // The chalk look's rough s.circle outline can wander outside its nominal r.
  s.draw({ at, out, enter: at < 0 ? 'none' : 'fade' }, (ctx) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.save();
    ctx.globalAlpha *= 0.12;
    ctx.fillStyle = s.color('yellow'); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = s.color('ink'); ctx.lineWidth = 5; ctx.stroke();
  });
}
function cutCircle(s, { at = -1, coloredAt = -1, cutAt = -1 } = {}) {
  s.draw({ at, enter: 'none' }, (ctx) => {
    const colorP = coloredAt < 0 ? 1 : s.p(coloredAt, 1.4);
    const cutP = cutAt < 0 ? 1 : s.p(cutAt, 2.6, 'linear');
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.translate(CX, CY);
      ctx.rotate((i + 0.5) * TAU / 8);
      const c = s.color(i < 4 ? 'yellow' : 'blue');
      sector(ctx, R, Math.PI / 8, colorP > 0 ? c : s.color('ink'), s.color('ink'), 1, Math.min(1, Math.max(0, cutP * 8 - i)));
      ctx.restore();
    }
  });
}
function rectangle(s, at = -1, { x = CX, y = CY, r = R, opacity = 1 } = {}) {
  const w = Math.PI * r;
  s.draw({ at, enter: at < 0 ? 'none' : 'fade', dur: 1.1, opacity }, (ctx) => {
    ctx.save();
    ctx.globalAlpha *= 0.1;
    ctx.fillStyle = s.color('yellow');
    ctx.fillRect(x - w / 2, y - r / 2, w, r);
    ctx.restore();
    stroke(ctx, [[x - w / 2, y - r / 2], [x + w / 2, y - r / 2]], s.color('yellow'), 6);
    stroke(ctx, [[x - w / 2, y + r / 2], [x + w / 2, y + r / 2]], s.color('blue'), 6);
    stroke(ctx, [[x - w / 2, y - r / 2], [x - w / 2, y + r / 2]], s.color('ink'), 4);
    stroke(ctx, [[x + w / 2, y - r / 2], [x + w / 2, y + r / 2]], s.color('ink'), 4);
  });
}
function horizontalMeasure(s, x1, x2, y, at, color = 'yellow') {
  s.line([[x1, y - 12], [x1, y + 12], [x1, y], [x2, y], [x2, y - 12], [x2, y + 12]], { color, at, width: 3, sfx: false });
}
function verticalMeasure(s, x, y1, y2, at) {
  s.line([[x - 12, y1], [x + 12, y1], [x, y1], [x, y2], [x - 12, y2], [x + 12, y2]], { color: 'ink', at, width: 3, sfx: false });
}

export default {
  intro(s) {
    heading(s, 'Why this circle formula?');
    circle(s, { at: -1 });
    s.math(String.raw`A = \pi r^2`, { x: 1280, y: 520, size: 118, at: '#question', color: 'yellow', sfx: false });
    s.line([[560, 550], [795, 550]], { at: '#idea', color: 'yellow', sfx: false });
    s.math('r', { x: 685, y: 495, size: 64, at: '#idea', color: 'yellow', sfx: false });
    label(s, 'Cut it. Rearrange it.', 1280, 690, '#idea', { size: 56 });
  },
  measure(s) {
    heading(s, 'Start with the radius');
    circle(s);
    s.line([[560, 550], [795, 550]], { at: '#radius', color: 'yellow', sfx: false });
    s.math('r', { x: 685, y: 495, size: 64, at: '#radius', color: 'yellow', sfx: false });
    label(s, 'Center to edge', 1280, 390, '#radius', { size: 56 });
    s.draw({ at: '#around' }, (ctx) => {
      ctx.beginPath();
      ctx.arc(560, 550, 247, -Math.PI / 2, -Math.PI / 2 + TAU * s.p('#around', 2.7, 'linear'));
      ctx.strokeStyle = s.color('blue'); ctx.lineWidth = 6; ctx.stroke();
    });
    label(s, 'Around the circle', 1280, 580, '#around');
    s.math(String.raw`C = 2\pi r`, { x: 1280, y: 700, size: 86, color: 'blue', at: '#around', sfx: false });
  },
  slices(s) {
    heading(s, 'Cut into equal slices', '#cut');
    cutCircle(s, { at: '#cut', cutAt: '#cut', coloredAt: '#halves' });
    label(s, '8 equal slices', CX, 865, '#cut');
    // A trace of each semicircle links the two colors to the circumference.
    s.draw({ at: '#halves' }, (ctx) => {
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(CX, CY, R + 12, -Math.PI / 2 + i * Math.PI, -Math.PI / 2 + i * Math.PI + Math.PI * s.p('#halves', 1.7, 'linear'));
        ctx.strokeStyle = s.color(i ? 'blue' : 'yellow'); ctx.lineWidth = 4; ctx.stroke();
      }
    });
  },
  arrange(s) {
    heading(s, 'Alternate the directions');
    s.draw({ at: -1 }, (ctx) => {
      const n = 8, d = Math.PI / n, a = R * Math.sin(d), h = R * Math.cos(d);
      // Draw unmoved sectors first, then traveling sectors, to keep motion legible.
      const pieces = Array.from({ length: n }, (_, i) => {
        const j = i < 4 ? i * 2 : (i - 4) * 2 + 1;
        return { i, j, p: s.p(s.time('#move') + j * 0.24, 1.65) };
      }).sort((a, b) => a.p - b.p);
      for (const { i, j, p } of pieces) {
        const targetX = (j - (n - 1) / 2) * a;
        const targetY = j % 2 ? -h / 2 : h / 2;
        const startAngle = (i + 0.5) * TAU / n;
        const endAngle = j % 2 ? Math.PI : 0;
        const turn = ((endAngle - startAngle + 3 * Math.PI) % TAU) - Math.PI;
        ctx.save();
        ctx.translate(CX + targetX * p, CY + targetY * p + Math.sin(p * Math.PI) * (j % 2 ? 115 : -115));
        ctx.rotate(startAngle + turn * p);
        sector(ctx, R, d, s.color(i < 4 ? 'yellow' : 'blue'), s.color('ink'));
        ctx.restore();
      }
    });
    label(s, 'Same pieces, same area', CX, 865, '#same', { size: 56 });
    s.sfx('whoosh', '#move', { gain: 0.17, dur: 0.6 });
  },
  refine(s) {
    heading(s, 'Thinner slices, flatter edges');
    const stages = [
      { n: 8, at: -1, out: '#more' },
      { n: 16, at: '#more', out: 'flatter' },
      { n: 32, at: 'flatter', out: '#limit' },
      { n: 64, at: '#limit', out: 'rectangle' },
    ];
    for (const st of stages) {
      s.draw({ at: st.at, out: st.out, enter: st.at < 0 ? 'none' : 'fade', dur: 0.6 }, (ctx) => row(ctx, s, st.n));
    }
    label(s, '8 slices', CX, 865, -1, { out: '#more', exit: 'none' });
    label(s, '16 slices', CX, 865, '#more', { out: 'flatter', exit: 'none' });
    label(s, '32 slices', CX, 865, 'flatter', { out: '#limit', exit: 'none' });
    label(s, '64 slices', CX, 865, '#limit', { out: 'rectangle', exit: 'none' });
    rectangle(s, 'rectangle');
    label(s, 'The limiting rectangle', CX, 865, 'rectangle', { size: 56 });
  },
  edges(s) {
    heading(s, 'Half the circumference on each side');
    s.draw({ at: -1 }, (ctx) => row(ctx, s, 64));
    horizontalMeasure(s, 558, 1362, 355, '#top');
    s.math(String.raw`\pi r`, { x: CX, y: 300, size: 68, color: 'yellow', at: '#top', sfx: false });
    horizontalMeasure(s, 558, 1362, 748, 'bottom', 'blue');
    s.math(String.raw`\pi r`, { x: CX, y: 800, size: 68, color: 'blue', at: 'bottom', sfx: false });
    s.math(String.raw`\frac{1}{2}(2\pi r) = \pi r`, { x: CX, y: 915, size: 76, at: '#width', color: 'yellow', sfx: false });
  },
  height(s) {
    heading(s, 'The height approaches the radius');
    s.draw({ at: -1, out: '#height' }, (ctx) => row(ctx, s, 64));
    const d = Math.PI / 64, a = R * Math.sin(d), h = R * Math.cos(d);
    // This is an actual sector radius, not a finite-slice vertical height.
    s.line([[CX + a / 2, CY + h / 2], [CX + a * 1.5, CY - h / 2]], { at: '#radius', out: '#height', color: 'yellow', width: 7, sfx: false });
    s.math('r', { x: 1050, y: CY, size: 70, color: 'yellow', at: '#radius', out: '#height', sfx: false });
    rectangle(s, '#height');
    verticalMeasure(s, 1485, CY - R / 2, CY + R / 2, '#height');
    s.math('r', { x: 1560, y: CY, size: 76, at: '#height', sfx: false });
    label(s, 'In the limit', CX, 865, '#height', { size: 56 });
  },
  example(s) {
    heading(s, 'Try a radius of two', '#two');
    rectangle(s, '#two');
    horizontalMeasure(s, 558, 1362, 355, '#two');
    s.math(String.raw`2\pi`, { x: CX, y: 295, size: 76, color: 'yellow', at: '#two', sfx: false });
    verticalMeasure(s, 1485, CY - R / 2, CY + R / 2, '#multiply');
    s.math('2', { x: 1560, y: CY, size: 76, at: '#multiply', sfx: false });
    s.math(String.raw`2\pi \times 2 = 4\pi`, { x: CX, y: 850, size: 88, color: 'yellow', at: '#multiply', sfx: false });
    label(s, 'square units', CX, 950, 'square');
  },
  conclusion(s) {
    heading(s, 'The area of a circle');
    rectangle(s, -1, { y: 490, r: 220 });
    horizontalMeasure(s, 614, 1306, 325, '#product');
    s.math(String.raw`\pi r`, { x: CX, y: 270, size: 72, color: 'yellow', at: '#product', sfx: false });
    verticalMeasure(s, 1420, 380, 600, '#product');
    s.math('r', { x: 1500, y: 490, size: 78, at: '#product', sfx: false });
    s.math(String.raw`A = \pi r \times r`, { x: CX, y: 785, size: 100, at: '#product', out: '#answer', exit: 'none', sfx: false });
    s.math(String.raw`A = \pi r^2`, { id: 'answer', x: CX, y: 785, size: 128, at: '#answer', color: 'yellow', sfx: false });
    s.annotate('answer', { type: 'box', padding: 26, color: 'yellow', at: s.time('#answer') + 0.9, dur: 1, sfx: false });
    s.sfx('chime', '#answer', { gain: 0.15 });
  },
};
