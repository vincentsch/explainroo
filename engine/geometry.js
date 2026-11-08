// Plane geometry for check: how far two drawn shapes overlap, whether one
// holds the other, and whether a drawn line runs through a box. Shapes are
// polygons in design pixels: a box is its four corners, a circle or an
// ellipse a ring of points around it. Pure functions, so tests run them in Node.

// Points around an ellipse with its center at cx, cy.
export function ring(cx, cy, rx, ry, n = 32) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

// The axis-aligned box around some points.
export function bounds(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Whether a polygon is a box with sides along the axes, as most shapes are.
function upright(poly) {
  if (poly.length !== 4) return false;
  const [a, b, c, d] = poly;
  const flat = (p, q) => Math.abs(p[0] - q[0]) < 0.01 || Math.abs(p[1] - q[1]) < 0.01;
  return flat(a, b) && flat(b, c) && flat(c, d) && flat(d, a);
}

export function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The distance from a point to the nearest side of a polygon.
function toEdge([x, y], poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    const k = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * k), y - (ay + dy * k)));
  }
  return best;
}

// Points along the sides of a polygon, about `step` pixels apart, corners included.
export function outline(poly, step = 6) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// How far two shapes reach into each other: the depth, in pixels, of the
// deepest point of either outline inside the other shape. Two boxes along the
// axes overlap by the smaller side of the part they share. 0 when they don't
// meet.
export function overlapDepth(a, b) {
  const A = bounds(a);
  const B = bounds(b);
  const ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
  if (ix <= 0 || iy <= 0) return 0;
  if (upright(a) && upright(b)) return Math.min(ix, iy);
  let depth = 0;
  for (const [p, q] of [[a, b], [b, a]]) {
    for (const pt of outline(p)) if (inside(pt, q)) depth = Math.max(depth, toEdge(pt, q));
  }
  return depth;
}

// Whether `inner` lies inside `outer`, or pokes out by no more than `slack` pixels.
export function holds(outer, inner, slack = 4) {
  if (upright(outer) && upright(inner)) {
    const O = bounds(outer);
    const I = bounds(inner);
    return I.x0 >= O.x0 - slack && I.y0 >= O.y0 - slack && I.x1 <= O.x1 + slack && I.y1 <= O.y1 + slack;
  }
  return outline(inner).every((pt) => inside(pt, outer) || toEdge(pt, outer) <= slack);
}

// Whether any of `points` lies inside the box { x0, y0, x1, y1 } made smaller
// by `inset` on each side.
export function crosses(points, box, inset = 2) {
  const x0 = box.x0 + inset;
  const y0 = box.y0 + inset;
  const x1 = box.x1 - inset;
  const y1 = box.y1 - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  return points.some(([x, y]) => x > x0 && x < x1 && y > y0 && y < y1);
}

// Points along straight lines through `points`, about `step` pixels apart.
export function along(points, step = 5) {
  const out = points.length ? [points[0]] : [];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// Where a ray from `from` in direction (dx, dy) runs through a box, as
// [enter, leave] distances along it, or null when it misses the box.
export function rayThrough(from, dx, dy, box) {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, d, a, b] of [[from.x, dx, box.x0, box.x1], [from.y, dy, box.y0, box.y1]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < a || p > b) return null;
      continue;
    }
    const t0 = (a - p) / d;
    const t1 = (b - p) / d;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  return lo < hi ? [lo, hi] : null;
}
