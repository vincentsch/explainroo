// Small math, easing, randomness and color helpers shared by the engine.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, p) => a + (b - a) * p;

export const ease = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  },
  outElastic: (p) => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outQuart: (p) => 1 - Math.pow(1 - p, 4),
  inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
};

export function easeFn(name) {
  if (typeof name === 'function') return name;
  const f = ease[name || 'inOut'];
  if (!f) throw new Error(`unknown ease "${name}". Use one of: ${Object.keys(ease).join(', ')}`);
  return f;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic value in [0, 1) for an index and seed.
export function rand01(i, seed = 0) {
  return mulberry32(hashStr(`${seed}:${i}`))();
}

// Smooth 1D value noise in [-1, 1].
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand01(i, seed) * 2 - 1;
  const b = rand01(i + 1, seed) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  const m = HEX.exec(c.trim());
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c.trim());
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  return null;
}

export function rgba({ r, g, b, a = 1 }) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`;
}

export function mixColor(c1, c2, p) {
  const a = parseColor(c1);
  const b = parseColor(c2);
  if (!a || !b) return p < 0.5 ? c1 : c2;
  return rgba({ r: lerp(a.r, b.r, p), g: lerp(a.g, b.g, p), b: lerp(a.b, b.b, p), a: lerp(a.a, b.a, p) });
}

export function withAlpha(c, alpha) {
  const p = parseColor(c);
  if (!p) return c;
  return rgba({ ...p, a: p.a * alpha });
}

// A translucent color as it looks over an opaque base color.
export function opaque(c, base) {
  const p = parseColor(c);
  if (!p || p.a >= 1) return c;
  return mixColor(base, rgba({ ...p, a: 1 }), p.a);
}

export function luminance(c) {
  const p = parseColor(c);
  if (!p) return 0.5;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
}

export function contrast(c1, c2) {
  const a = luminance(c1);
  const b = luminance(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hsl(c) {
  const { r, g, b } = parseColor(c);
  const [R, G, B] = [r, g, b].map(v => v / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min, l = (max + min) / 2;
  const h = !d ? 0 : max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
}

function hslHex({ h, s, l }) {
  const a = s * Math.min(l, 1 - l);
  const channel = n => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
}

export function suggestColor(fg, bg, size = 0, colors = {}) {
  if (!parseColor(fg) || !parseColor(bg)) return null;
  const min = size >= 48 ? 3 : 4.5;
  const result = color => ({ color, ratio: contrast(colors[color] || color, bg) });
  if (contrast(fg, bg) >= min) return { color: fg, ratio: contrast(fg, bg) };
  const source = hsl(fg);
  const named = Object.entries(colors).filter(([, c]) => parseColor(c) && contrast(c, bg) >= min)
    .map(([name, c]) => {
      const p = hsl(c);
      const diff = Math.abs(source.h - p.h);
      const hue = Math.min(diff, 360 - diff);
      // Hue is undefined for grays, so match them only with other grays.
      const gray = source.s <= 0.1 && p.s <= 0.1;
      const close = gray || source.s > 0.1 && p.s > 0.1 && hue <= 15;
      return { name, close, distance: (gray ? 0 : hue / 180) ** 2 + (source.s - p.s) ** 2 + (source.l - p.l) ** 2 };
    }).filter(p => p.close).sort((a, b) => a.distance - b.distance);
  if (named.length) return result(named[0].name);
  const candidates = [];
  for (const end of [0, 1]) {
    if (contrast(hslHex({ ...source, l: end }), bg) < min) continue;
    let fail = source.l, pass = end;
    // Check rounded hex values so the suggested color itself meets the target.
    for (let i = 0; i < 24; i++) {
      const l = (fail + pass) / 2;
      if (contrast(hslHex({ ...source, l }), bg) >= min) pass = l;
      else fail = l;
    }
    candidates.push({ l: pass, color: hslHex({ ...source, l: pass }) });
  }
  candidates.sort((a, b) => Math.abs(a.l - source.l) - Math.abs(b.l - source.l));
  return result(candidates[0].color);
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function suggest(name, options, n = 5) {
  const q = String(name).toLowerCase();
  return options
    .map((o) => ({ o, d: o.includes(q) || q.includes(o) ? 0 : levenshtein(q, o) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.o);
}

export function normWord(w) {
  return String(w)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9%$€£+#@.]/g, '')
    .replace(/^\.+|\.+$/g, '');
}
