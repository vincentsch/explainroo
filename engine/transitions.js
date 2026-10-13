// Scene transitions. Each one composites the outgoing and incoming scene
// canvases for progress p in 0..1.
import { ease, mulberry32, hashStr } from './util.js';

export const TRANSITION_NAMES = ['fade', 'slide', 'wipe', 'zoom', 'brush', 'cut'];

export function drawTransition(name, ctx, from, to, p, W, H, seed = 1, transparent = false) {
  const e = ease.inOut(p);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  switch (name) {
    case 'fade':
      if (transparent) ctx.globalAlpha = 1 - e;
      ctx.drawImage(from, 0, 0);
      if (transparent) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = e;
      ctx.drawImage(to, 0, 0);
      break;
    case 'slide':
      ctx.drawImage(from, -cw * e * 0.35, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.globalAlpha = e;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 40;
      ctx.drawImage(to, cw * (1 - e), 0);
      break;
    case 'wipe': {
      ctx.drawImage(from, 0, 0);
      const x = cw * e;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, ch);
      ctx.clip();
      ctx.drawImage(to, 0, 0);
      ctx.restore();
      if (p > 0 && p < 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x - 2, 0, 3, ch);
      }
      break;
    }
    case 'zoom': {
      ctx.save();
      ctx.globalAlpha = 1 - e;
      const s1 = 1 + 0.12 * e;
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(s1, s1);
      ctx.drawImage(from, -cw / 2, -ch / 2);
      ctx.restore();
      ctx.save();
      if (transparent) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = e;
      const s2 = 0.94 + 0.06 * e;
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(s2, s2);
      ctx.drawImage(to, -cw / 2, -ch / 2);
      ctx.restore();
      break;
    }
    case 'brush': {
      ctx.drawImage(from, 0, 0);
      const mask = brushMask(cw, ch, e, seed);
      const tmp = scratch(cw, ch, 'brushTmp');
      const g = tmp.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, cw, ch);
      g.drawImage(to, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmp, 0, 0);
      break;
    }
    case 'cut':
    default:
      ctx.drawImage(p < 0.5 ? from : to, 0, 0);
  }
  ctx.restore();
}

const scratches = {};
function scratch(w, h, key) {
  let c = scratches[key];
  if (!c || c.width !== w || c.height !== h) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    scratches[key] = c;
  }
  return c;
}

// A few thick, slightly uneven brush strokes zig-zagging down the frame.
function brushMask(w, h, p, seed) {
  const c = scratch(w, h, 'brushMask');
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (p <= 0) return c;
  if (p >= 1) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    return c;
  }
  const rand = mulberry32(hashStr('brush' + seed));
  const rows = 4;
  const band = h / rows;
  const width = band * 1.55;
  const pts = [];
  for (let i = 0; i < rows; i++) {
    const y = band * (i + 0.5);
    const lr = i % 2 === 0;
    pts.push([lr ? -width : w + width, y + (rand() - 0.5) * band * 0.2]);
    pts.push([lr ? w + width : -width, y + (rand() - 0.5) * band * 0.2]);
  }
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(L);
    total += L;
  }
  let left = total * p;
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const L = segs[i - 1];
    const k = Math.min(1, left / L);
    const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k;
    const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
    // Wavy edge: a few intermediate points with a small vertical wobble.
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const sx = pts[i - 1][0] + (x - pts[i - 1][0]) * f;
      const sy = pts[i - 1][1] + (y - pts[i - 1][1]) * f + Math.sin(f * 9 + i) * band * 0.04;
      g.lineTo(sx, sy);
    }
    left -= L;
  }
  g.stroke();
  // Bristle marks along the edges.
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    const t = rand();
    if (t > p) continue;
    const y = rand() * h;
    g.beginPath();
    g.moveTo(rand() * w, y);
    g.lineTo(rand() * w, y + (rand() - 0.5) * 6);
    g.stroke();
  }
  return c;
}
