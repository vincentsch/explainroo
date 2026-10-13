// The UI kit behind s.ui: crisp app screens for product demos. Cards,
// buttons, fields, dropdowns, toggles, status pills, a mouse cursor that
// clicks and types, and serif headlines that blur in word by word.
//
// Everything is drawn in the frame's design space, so s.camera() can zoom
// into it. Times are scene seconds, spoken words or "#marks", and pace
// applies, like everywhere else. Colors, fonts and the logo come from
// "brand" in video.json.

import { SceneError } from './stage.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, p) => a + (b - a) * p;
const outCubic = (p) => 1 - Math.pow(1 - p, 3);
const inOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const outBack = (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
// 0 -> 1 -> 0 over p in 0..1, for a press.
const bell = (p) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, p) {
  const A = rgb(a);
  const B = rgb(b);
  const h = (i) => Math.round(lerp(A[i], B[i], p)).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

const TONES = {
  gray: { bg: '#f2f4f7', fg: '#344054', ring: '#d0d5dd' },
  blue: { bg: '#eff8ff', fg: '#175cd3', ring: '#b2ddff' },
  yellow: { bg: '#fffaeb', fg: '#b54708', ring: '#fedf89' },
  green: { bg: '#ecfdf3', fg: '#067647', ring: '#abefc6' },
  red: { bg: '#fef3f2', fg: '#b42318', ring: '#fecdca' },
  purple: { bg: '#f4f3ff', fg: '#5925dc', ring: '#d9d6fe' },
};

// Faint cards scattered around the edges, for depth behind the UI.
const FLOATERS = [
  { x: 0.078, y: 0.157, r: -7 }, { x: 0.917, y: 0.139, r: 6 }, { x: 0.057, y: 0.519, r: 4 },
  { x: 0.943, y: 0.556, r: -5 }, { x: 0.12, y: 0.87, r: 8 }, { x: 0.88, y: 0.889, r: -8 },
  { x: 0.365, y: 0.954, r: 3 }, { x: 0.635, y: 0.037, r: -3 },
];

// While a hidden s.group() runs (to collect timing and sounds), the kit must
// not draw: these canvas calls are skipped then, everything else goes through.
const DRAW_CALLS = new Set(['fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'fillRect', 'strokeRect', 'clearRect', 'putImageData']);

export class UI {
  constructor(s) {
    this.s = s;
    const th = s.theme;
    const b = s.engine.config.brand || {};
    const accent = b.accent ?? th.colors[th.accent];
    this.font = b.font ?? 'Inter';
    this.headlineFont = b.headline ?? 'Instrument Serif';
    this.logoSrc = b.logo ?? null;
    // App screens are light; `ink` is for text drawn straight on the background.
    this.colors = {
      accent,
      accentDark: mix(accent, '#000000', 0.16),
      accentTint: mix(accent, '#ffffff', 0.91),
      accentRing: mix(accent, '#ffffff', 0.55),
      background: b.background ?? th.bg,
      ink: b.ink ?? th.ink,
      text: '#18202c',
      soft: '#526071',
      muted: '#667085',
      faint: '#98a2b3',
      line: '#e4e7ec',
      field: '#d0d5dd',
      surface: '#ffffff',
      panel: '#f5f7fb',
      // brand.colors overrides any of these, for example warm grays.
      ...(b.colors || {}),
    };
    this._layer = 0;
    this._layers = 0;
  }

  // The canvas, or a stand-in that draws nothing while a group is hidden.
  get c() {
    if (!(this.s._suppress > 0)) return this.s.ctx;
    if (!this._quiet) {
      const real = this.s.ctx;
      this._quiet = new Proxy(real, {
        get(target, key) {
          if (DRAW_CALLS.has(key)) return () => {};
          const v = target[key];
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, key, value) {
          target[key] = value;
          return true;
        },
      });
    }
    return this._quiet;
  }

  get hidden() {
    return this.s._suppress > 0;
  }

  // Scale of the current transform. Canvas shadows and blur filters work in
  // device pixels, so they are multiplied by this to zoom with the camera.
  get k() {
    const m = this.c.getTransform();
    return Math.hypot(m.a, m.b);
  }

  at(v) {
    return this.s.time(v);
  }

  _p(at, dur, easing = 'out') {
    return this.s.p(at, dur, easing);
  }

  fontString(size, weight = 400, family = this.font, italic = false) {
    return `${italic ? 'italic ' : ''}${weight} ${size}px "${family}", Inter, "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", sans-serif`;
  }

  _family(f) {
    if (!f || f === 'ui') return this.font;
    if (f === 'headline') return this.headlineFont;
    return f;
  }

  // An entrance, so `check` knows something new appears and a sound can play.
  _enter(at, dur, sfx) {
    this.s._record('ui', at, dur, { sfx: sfx ?? null });
  }

  // ---------- surfaces ----------

  backdrop(color = this.colors.background) {
    const c = this.c;
    c.save();
    c.setTransform(this.s.engine.scale, 0, 0, this.s.engine.scale, 0, 0);
    c.fillStyle = color;
    c.fillRect(0, 0, this.s.W, this.s.H);
    c.restore();
  }

  // Faint app cards drifting around the edges, out of focus. Each card is
  // blurred once and reused, because a blur filter on every frame is slow.
  floaters(o = {}) {
    const s = this.s;
    const c = this.c;
    const tint = o.tint ?? 'card';
    const cache = (s.engine._uiSprites ??= new Map());
    FLOATERS.forEach((f, i) => {
      const key = `${i % 3}|${tint}`;
      if (!cache.has(key)) cache.set(key, this._floaterSprite(i, tint));
      const dx = Math.sin(s.T * 0.25 + i * 1.7) * 14;
      const dy = Math.cos(s.T * 0.3 + i * 2.1) * 12;
      c.save();
      c.globalAlpha *= o.alpha ?? 0.55;
      c.translate(f.x * s.W + dx, f.y * s.H + dy);
      c.rotate((f.r * Math.PI) / 180);
      c.drawImage(cache.get(key), -210, -140, 420, 280);
      c.restore();
    });
  }

  _floaterSprite(i, tint) {
    const k = 2;
    const cv = new OffscreenCanvas(420 * k, 280 * k);
    const c = cv.getContext('2d');
    c.scale(k, k);
    c.translate(210, 140);
    c.scale(0.62, 0.62);
    const bar = (x, y, w) => {
      c.beginPath();
      c.roundRect(x, y, w, 10, 5);
      c.fill();
    };
    if (tint === 'white') {
      c.fillStyle = 'rgba(255, 255, 255, 0.9)';
      c.beginPath();
      c.roundRect(-150, -80, 300, 160, 16);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.55)';
    } else {
      c.shadowColor = 'rgba(16, 24, 40, 0.08)';
      c.shadowBlur = 24 * k;
      c.shadowOffsetY = 8 * k;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.roundRect(-150, -80, 300, 160, 16);
      c.fill();
      c.shadowColor = 'transparent';
      c.strokeStyle = this.colors.line;
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = ['#dbe7ff', '#fde7d9', '#dcfae6'][i % 3];
      c.beginPath();
      c.arc(-112, -44, 16, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#e4e8ef';
    }
    bar(-84, -52, 170);
    [0, 1, 2].forEach((j) => bar(-122, -4 + j * 22, [240, 220, 150][j]));
    const out = new OffscreenCanvas(420 * k, 280 * k);
    const oc = out.getContext('2d');
    oc.filter = `blur(${1.6 * k}px)`;
    oc.drawImage(cv, 0, 0);
    return out;
  }

  card(x, y, w, h, o = {}) {
    const c = this.c;
    const r = o.r ?? 18;
    const k = this.k;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fillStyle = o.fill ?? this.colors.surface;
    if (o.shadow !== false) {
      const lift = o.lift ?? 1;
      c.shadowColor = `rgba(16, 24, 40, ${0.05 * lift})`;
      c.shadowBlur = 3 * k;
      c.shadowOffsetY = 1 * k;
      c.fill();
      c.shadowColor = `rgba(16, 24, 40, ${0.09 * lift})`;
      c.shadowBlur = 48 * lift * k;
      c.shadowOffsetY = 18 * lift * k;
    }
    c.fill();
    c.shadowColor = 'transparent';
    if (o.border !== false) {
      c.strokeStyle = o.border ?? this.colors.line;
      c.lineWidth = o.borderWidth ?? 1.5;
      c.stroke();
    }
    c.restore();
  }

  // A card that pops up at `at`, then fn(x, y, w, h) draws inside it.
  // Returns the entrance progress (0 before `at`).
  panel(x, y, w, h, o = {}, fn) {
    if (typeof o === 'function') [o, fn] = [{}, o];
    const s = this.s;
    const a = this.at(o.at ?? 0);
    const dur = o.dur ?? 0.6;
    this._enter(a, dur, o.sfx);
    if (s.t < a) return 0;
    const p = clamp((s.t - a) / (dur / s.pace));
    const q = o.out !== undefined ? this._p(o.out, o.outDur ?? 0.35, 'in') : 0;
    if (q >= 1) return p;
    const c = this.c;
    const sc = lerp(o.from ?? 0.94, 1, outBack(p)) * (1 - 0.03 * q);
    c.save();
    c.globalAlpha *= clamp(p * 2.5) * (1 - q);
    c.translate(x + w / 2, y + h / 2 + (1 - outCubic(p)) * (o.rise ?? 30));
    c.scale(sc, sc);
    c.translate(-(x + w / 2), -(y + h / 2));
    this.card(x, y, w, h, o);
    if (fn) fn(x, y, w, h);
    c.restore();
    return p;
  }

  // A panel with a browser bar and an address. fn gets the page area.
  browser(x, y, w, h, o = {}, fn) {
    if (typeof o === 'function') [o, fn] = [{}, o];
    const bar = o.bar ?? 50;
    return this.panel(x, y, w, h, o, () => {
      const c = this.c;
      c.save();
      c.beginPath();
      c.roundRect(x, y, w, bar, [o.r ?? 18, o.r ?? 18, 0, 0]);
      c.fillStyle = '#f2f4f7';
      c.fill();
      ['#f97066', '#fdb022', '#32d583'].forEach((col, i) => {
        c.beginPath();
        c.arc(x + 28 + i * 22, y + bar / 2, 7, 0, Math.PI * 2);
        c.fillStyle = col;
        c.fill();
      });
      c.beginPath();
      c.roundRect(x + 110, y + 11, w - 140, bar - 22, (bar - 22) / 2);
      c.fillStyle = '#ffffff';
      c.fill();
      c.restore();
      if (o.url) this.text(o.url, x + 128, y + bar / 2 + 1, { size: o.urlSize ?? 17, color: this.colors.muted, maxW: w - 170 });
      if (fn) fn(x, y + bar, w, h - bar);
    });
  }

  // A dialog over a dimmed frame. Everything drawn in fn sits on top of
  // what is below, so `check` does not report it as overlapping.
  modal(x, y, w, h, o = {}, fn) {
    if (typeof o === 'function') [o, fn] = [{}, o];
    const s = this.s;
    const a = this.at(o.at ?? 0);
    if (s.t < a) return 0;
    const q = o.out !== undefined ? this._p(o.out, 0.3, 'in') : 0;
    if (q >= 1) return 1;
    const p = this._p(a, 0.35);
    const c = this.c;
    if (o.dim !== false) {
      c.save();
      c.setTransform(s.engine.scale, 0, 0, s.engine.scale, 0, 0);
      c.fillStyle = `rgba(16, 24, 40, ${(o.dim ?? 0.28) * p * (1 - q)})`;
      c.fillRect(0, 0, s.W, s.H);
      c.restore();
    }
    return this.over(() => this.panel(x, y, w, h, { r: 20, lift: 1.4, ...o, at: a, dur: 0.45 }, fn));
  }

  // A short message card that slides up, like "Saved" or "Sent".
  toast(label, o = {}) {
    const a = this.at(o.at ?? 0);
    const s = this.s;
    if (s.t < a) return;
    if (o.out !== undefined && s.t >= this.at(o.out) + 0.4) return;
    const size = o.size ?? 22;
    const w = this.measure(label, size, 600) + (o.icon === false ? 64 : 100);
    const x = (o.x ?? s.W / 2) - w / 2;
    const y = o.y ?? s.H - 150;
    const tone = TONES[o.tone ?? 'green'] || TONES.green;
    this.over(() => {
      this.panel(x, y, w, 72, { at: a, out: o.out, r: 16, lift: 0.9, rise: 40, from: 0.9, sfx: o.sfx === undefined ? 'chime' : o.sfx }, () => {
        let tx = x + 32;
        if (o.icon !== false) {
          this.icon(o.icon ?? 'circle-check', x + 40, y + 36, 30, tone.fg, 2.2);
          tx = x + 70;
        }
        this.text(label, tx, y + 37, { size, weight: 600 });
      });
    });
  }

  // Brand color spreading from a point until it fills the frame.
  wipe(at, o = {}) {
    const s = this.s;
    const a = this.at(at);
    if (s.t < a) return 0;
    if (o.sfx !== null) s.sfx(o.sfx ?? 'swipe', a);
    const p = this._p(a, o.dur ?? 0.7, 'inOut');
    const x = o.x ?? s.W / 2;
    const y = o.y ?? s.H / 2;
    const c = this.c;
    c.save();
    c.beginPath();
    c.arc(x, y, lerp(0, Math.hypot(Math.max(x, s.W - x), Math.max(y, s.H - y)) + 20, p), 0, Math.PI * 2);
    c.fillStyle = o.color ?? this.colors.accent;
    c.fill();
    c.restore();
    return p;
  }

  // Scales something in around (cx, cy) with a little overshoot at `at`.
  pop(at, cx, cy, fn, o = {}) {
    const s = this.s;
    const a = this.at(at);
    this._enter(a, o.dur ?? 0.45, o.sfx);
    if (s.t < a) return 0;
    const p = this._p(a, o.dur ?? 0.45, 'outBack');
    const c = this.c;
    c.save();
    c.globalAlpha *= clamp(p * 2);
    c.translate(cx, cy);
    const sc = lerp(o.from ?? 0.7, 1, p);
    c.scale(sc, sc);
    c.translate(-cx, -cy);
    fn(p);
    c.restore();
    return p;
  }

  // Draws fn as a layer on top of what is already there (menus, dialogs).
  // Each call is its own layer, so `check` does not report text in one
  // layer as overlapping text in another.
  over(fn) {
    const prev = this._layer;
    this._layer = ++this._layers;
    try {
      return fn();
    } finally {
      this._layer = prev;
    }
  }

  // ---------- text ----------

  _log(str, x, y, w, size, align, base) {
    if (!str.trim() || this.hidden) return;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const [t, b] = base === 'top' ? [0, 1.2] : base === 'alphabetic' ? [-0.8, 0.22] : [-0.6, 0.6];
    this.s._logText({ text: str, x0, y0: y + t * size, x1: x0 + w, y1: y + b * size, size, fg: null, bg: null, ui: this._layer + 1, zoomed: this.s._camMoved });
  }

  text(str, x, y, o = {}) {
    const c = this.c;
    const size = o.size ?? 22;
    c.save();
    c.font = this.fontString(size, o.weight ?? 400, this._family(o.font), o.italic);
    c.fillStyle = o.color ?? this.colors.text;
    const align = o.align ?? 'left';
    const base = o.base ?? 'middle';
    c.textAlign = align;
    c.textBaseline = base;
    c.letterSpacing = `${o.tracking ?? 0}px`;
    c.globalAlpha *= o.alpha ?? 1;
    let t = String(str);
    if (o.maxW && c.measureText(t).width > o.maxW) {
      while (t.length > 1 && c.measureText(t + '…').width > o.maxW) t = t.slice(0, -1);
      t = t.trimEnd() + '…';
    }
    c.fillText(t, x, y);
    const w = c.measureText(t).width;
    if (o.check !== false) this._log(t, x, y, w, size, align, base);
    c.restore();
    return w;
  }

  measure(str, size, weight = 400, font, italic = false, tracking = 0) {
    const c = this.c;
    c.save();
    c.font = this.fontString(size, weight, this._family(font), italic);
    c.letterSpacing = `${tracking}px`;
    const w = c.measureText(String(str)).width;
    c.restore();
    return w;
  }

  // Wraps text to maxW and draws it from the top. Returns the height.
  para(str, x, y, maxW, o = {}) {
    const size = o.size ?? 22;
    const lh = o.lh ?? size * 1.45;
    const lines = this._wrap(str, maxW, size, o.weight ?? 400, o.font).filter((l, i, a) => l || i < a.length - 1);
    lines.forEach((l, i) => this.text(l, x, y + i * lh, { ...o, base: 'top' }));
    return lines.length * lh;
  }

  // Small uppercase label above a heading.
  eyebrow(str, x, y, o = {}) {
    return this.text(String(str).toUpperCase(), x, y, { size: 17, weight: 700, color: this.colors.accent, tracking: 2.2, ...o });
  }

  // A headline that blurs in word by word, in the headline font. Wrap words
  // in *stars* to set them in the accent color, in italic unless
  // italic: false (for a brand font without an italic).
  headline(str, x, y, o = {}) {
    const s = this.s;
    const c = this.c;
    const size = o.size ?? 96;
    const family = this._family(o.font ?? 'headline');
    const tracking = o.tracking ?? -1;
    const tokens = [];
    let italic = false;
    for (const raw of String(str).split(' ')) {
      let w = raw;
      const starts = w.startsWith('*');
      if (starts) w = w.slice(1);
      const ends = w.endsWith('*');
      if (ends) w = w.slice(0, -1);
      if (starts) italic = true;
      tokens.push({ w, italic, accent: italic });
      if (ends) italic = false;
    }
    if (o.italic === false) tokens.forEach((t) => (t.italic = false));
    const widths = tokens.map((t) => this.measure(t.w, size, o.weight ?? 400, family, t.italic, tracking));
    const space = this.measure(' ', size, 400, family) * 0.9;
    const total = widths.reduce((a, b) => a + b, 0) + space * (tokens.length - 1);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    const a = this.at(o.at ?? 0);
    const stagger = (o.stagger ?? 0.07) / s.pace;
    const dur = (o.dur ?? 0.7) / s.pace;
    this._enter(a, dur + stagger * tokens.length, o.sfx);
    const k = this.k;
    tokens.forEach((t, i) => {
      const e = outCubic(clamp((s.t - (a + i * stagger)) / dur));
      const q = o.out !== undefined ? this._p(this.at(o.out) + i * stagger * 0.4, 0.35, 'in') : 0;
      const alpha = e * (1 - q);
      if (alpha > 0.002) {
        const blur = (1 - e) * 14 + q * 10;
        c.save();
        if (blur > 0.3) c.filter = `blur(${(blur * k).toFixed(2)}px)`;
        this.text(t.w, cx, y + (1 - e) * 22 - q * 14, {
          size,
          font: family,
          italic: t.italic,
          weight: o.weight ?? 400,
          color: t.accent ? o.accent ?? this.colors.accent : o.color ?? this.colors.ink,
          alpha,
          tracking,
          base: 'alphabetic',
        });
        c.restore();
      }
      cx += widths[i] + space;
    });
    return total;
  }

  // ---------- controls ----------

  // tone: gray, blue, yellow, green, red, purple or accent.
  pill(label, x, y, tone = 'gray', o = {}) {
    const T = tone === 'accent' ? { bg: this.colors.accentTint, fg: this.colors.accentDark, ring: this.colors.accentRing } : TONES[tone];
    if (!T) throw new SceneError(`pill tone must be one of ${Object.keys(TONES).join(', ')} or accent, not "${tone}"`);
    const size = o.size ?? 17;
    const dot = o.dot ?? false;
    const padX = size * 0.75;
    const h = size * 1.75;
    const w = this.measure(label, size, 600) + padX * 2 + (dot ? size * 0.85 : 0);
    const c = this.c;
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.roundRect(left, y - h / 2, w, h, h / 2);
    c.fillStyle = T.bg;
    c.fill();
    c.strokeStyle = T.ring;
    c.lineWidth = 1.5;
    c.stroke();
    let tx = left + padX;
    if (dot) {
      const pulse = o.pulse ? 0.5 + 0.5 * Math.sin(this.s.t * 6) : 1;
      c.save();
      c.beginPath();
      c.arc(tx + size * 0.25, y, size * 0.25, 0, Math.PI * 2);
      c.fillStyle = T.fg;
      c.globalAlpha *= 0.45 + 0.55 * pulse;
      c.fill();
      c.restore();
      tx += size * 0.85;
    }
    this.text(label, tx, y + 0.5, { size, weight: 600, color: T.fg });
    c.restore();
    return w;
  }

  // variant: primary, secondary or ghost. press: 0..1, from u.press(at).
  // color: another fill for a primary button. caps: uppercase label.
  button(label, x, y, w, h, o = {}) {
    const c = this.c;
    const v = o.variant ?? 'primary';
    const press = o.press ?? 0;
    const hover = o.hover ?? 0;
    const C = this.colors;
    const fill = o.color ?? C.accent;
    if (o.caps) label = String(label).toUpperCase();
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.translate(x + w / 2, y + h / 2);
    c.scale(1 - 0.04 * press, 1 - 0.04 * press);
    c.translate(-(x + w / 2), -(y + h / 2));
    c.beginPath();
    c.roundRect(x, y, w, h, o.r ?? 12);
    if (v === 'primary') {
      const k = this.k;
      const [r, g, b] = rgb(fill);
      c.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.28 * (1 - press)})`;
      c.shadowBlur = 16 * k;
      c.shadowOffsetY = 6 * k;
      c.fillStyle = mix(fill, '#000000', 0.16 * clamp(hover + press));
      c.fill();
    } else if (v === 'secondary') {
      c.fillStyle = mix('#ffffff', '#f2f4f7', clamp(hover + press));
      c.fill();
      c.strokeStyle = C.field;
      c.lineWidth = 1.5;
      c.stroke();
    } else if (hover + press > 0) {
      c.fillStyle = `rgba(16, 24, 40, ${0.05 * clamp(hover + press)})`;
      c.fill();
    }
    c.shadowColor = 'transparent';
    const size = o.size ?? (o.caps ? 18 : 21);
    const tracking = o.caps ? 1.6 : 0;
    const color = v === 'primary' ? '#ffffff' : v === 'ghost' ? C.accent : C.text;
    const labelW = this.measure(label, size, 600, undefined, false, tracking);
    const iconSize = size * 1.05;
    const gap = o.icon || o.loading ? iconSize + 10 : 0;
    let lx = x + w / 2 - (labelW + gap) / 2;
    if (o.loading) {
      this.spinner(lx + iconSize / 2, y + h / 2, iconSize / 2.4, color);
      lx += gap;
    } else if (o.icon) {
      this.icon(o.icon, lx + iconSize / 2, y + h / 2, iconSize, color, 2.2);
      lx += gap;
    }
    this.text(label, lx, y + h / 2 + 0.5, { size, weight: 600, color, tracking });
    c.restore();
  }

  input(x, y, w, h, o = {}) {
    const c = this.c;
    const C = this.colors;
    const focus = o.focus ?? 0;
    const size = o.size ?? 21;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    if (o.label) this.text(o.label, x, y - 24, { size: 19, weight: 600 });
    if (focus > 0) {
      const [r, g, b] = rgb(C.accent);
      c.beginPath();
      c.roundRect(x - 4, y - 4, w + 8, h + 8, 14);
      c.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.16 * focus})`;
      c.fill();
    }
    c.beginPath();
    c.roundRect(x, y, w, h, 11);
    c.fillStyle = '#ffffff';
    c.fill();
    c.strokeStyle = mix(C.field, C.accent, focus);
    c.lineWidth = 1.5;
    c.stroke();
    const pad = 18;
    let tx = x + pad;
    if (o.icon) {
      this.icon(o.icon, tx + 11, y + h / 2, 22, C.faint, 2);
      tx += 34;
    }
    const room = w - (tx - x) - pad - (o.room ?? 0);
    const value = o.value ?? '';
    if (value) this.text(value, tx, y + h / 2 + 0.5, { size, maxW: room });
    else if (o.placeholder) this.text(o.placeholder, tx, y + h / 2 + 0.5, { size, color: C.faint, maxW: room });
    if (o.caret && focus > 0.5 && Math.floor(this.s.t * 2.2) % 2 === 0) {
      const cx = tx + (value ? Math.min(this.measure(value, size), room) : 0) + 2;
      c.fillStyle = C.text;
      c.fillRect(cx, y + h / 2 - size * 0.6, 2, size * 1.2);
    }
    c.restore();
  }

  // A multi-line field: the value wraps inside it, with a caret at the end.
  textarea(x, y, w, h, o = {}) {
    const size = o.size ?? 21;
    const lh = o.lh ?? size * 1.45;
    this.input(x, y, w, h, { label: o.label, focus: o.focus, alpha: o.alpha, size });
    const pad = 18;
    const value = o.value ?? '';
    if (!value && o.placeholder) {
      this.para(o.placeholder, x + pad, y + pad, w - pad * 2, { size, lh, color: this.colors.faint });
      return;
    }
    const lines = this._wrap(value, w - pad * 2, size, o.weight ?? 400);
    lines.forEach((l, i) => this.text(l, x + pad, y + pad + i * lh, { size, base: 'top' }));
    if (o.caret && (o.focus ?? 0) > 0.5 && Math.floor(this.s.t * 2.2) % 2 === 0) {
      const last = lines[lines.length - 1] ?? '';
      const c = this.c;
      c.fillStyle = this.colors.text;
      c.fillRect(x + pad + this.measure(last, size) + 2, y + pad + (lines.length - 1) * lh + (lh - size * 1.2) / 2, 2, size * 1.2);
    }
  }

  _wrap(str, maxW, size, weight = 400, font) {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + ' ' + w : w;
        if (cur && this.measure(next, size, weight, font) > maxW) {
          lines.push(cur);
          cur = w;
        } else cur = next;
      }
      lines.push(cur);
    }
    return lines;
  }

  // The part of `str` shown by now when it appears word by word from `at`,
  // like an AI reply streaming in (wps: words per second).
  stream(str, at, wps = 9) {
    const words = String(str).split(/(\s+)/);
    const n = Math.floor(Math.max(0, this.s.t - this.at(at)) * wps * this.s.pace);
    let shown = 0;
    let out = '';
    for (const part of words) {
      if (/\S/.test(part)) {
        if (shown >= n) break;
        shown++;
      }
      out += part;
    }
    return out.trimEnd();
  }

  // A dropdown. open 0..1 shows the menu below it, hover is the index of the
  // highlighted option, selected gets a check. Returns each option row's
  // center y, for pointing the cursor at it.
  select(x, y, w, h, o = {}) {
    const C = this.colors;
    const open = o.open ?? 0;
    this.input(x, y, w, h, { label: o.label, value: o.value, placeholder: o.placeholder, focus: o.focus ?? open, alpha: o.alpha, size: o.size, room: 30 });
    this.icon('chevron-down', x + w - 30, y + h / 2, 24, C.muted, 2);
    const rowH = o.rowH ?? 54;
    const opts = o.options ?? [];
    const my = y + h + 12;
    const rows = opts.map((_, i) => my + 8 + i * rowH + rowH / 2);
    if (open <= 0.001) return rows;
    const c = this.c;
    this.over(() => {
      c.save();
      c.globalAlpha *= clamp(open * 1.6) * (o.alpha ?? 1);
      c.translate(x + w / 2, my);
      c.scale(1, lerp(0.92, 1, outCubic(open)));
      c.translate(-(x + w / 2), -my);
      this.card(x, my, w, opts.length * rowH + 16, { r: 14, lift: 0.8 });
      opts.forEach((label, i) => {
        const ry = my + 8 + i * rowH;
        if (o.hover === i) {
          c.beginPath();
          c.roundRect(x + 8, ry, w - 16, rowH, 9);
          c.fillStyle = C.accentTint;
          c.fill();
        }
        const chosen = o.selected === i;
        this.text(label, x + 24, ry + rowH / 2 + 0.5, { size: o.size ?? 21, weight: chosen ? 600 : 400, color: chosen ? C.accent : C.text, maxW: w - 80 });
        if (chosen) this.icon('check', x + w - 34, ry + rowH / 2, 22, C.accent, 2.4);
      });
      c.restore();
    });
    return rows;
  }

  toggle(x, y, on, o = {}) {
    const c = this.c;
    const w = o.w ?? 64;
    const h = o.h ?? 36;
    const p = clamp(on);
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.roundRect(x, y - h / 2, w, h, h / 2);
    c.fillStyle = mix('#e4e7ec', this.colors.accent, p);
    c.fill();
    const r = h / 2 - 4;
    const kx = lerp(x + 4 + r, x + w - 4 - r, outBack(p));
    const k = this.k;
    c.shadowColor = 'rgba(16, 24, 40, 0.18)';
    c.shadowBlur = 6 * k;
    c.shadowOffsetY = 2 * k;
    c.beginPath();
    c.arc(kx, y, r, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();
  }

  checkbox(x, y, on, o = {}) {
    const c = this.c;
    const size = o.size ?? 26;
    const p = clamp(on);
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.roundRect(x - size / 2, y - size / 2, size, size, 7);
    c.fillStyle = mix('#ffffff', this.colors.accent, p);
    c.fill();
    c.strokeStyle = mix(this.colors.field, this.colors.accent, p);
    c.lineWidth = 1.5;
    c.stroke();
    if (p > 0.05) {
      c.globalAlpha *= clamp(p * 2);
      this.icon('check', x, y, size * 0.72, '#ffffff', 3.2);
    }
    c.restore();
  }

  radio(x, y, on, o = {}) {
    const c = this.c;
    const r = (o.size ?? 26) / 2;
    const p = clamp(on);
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.strokeStyle = mix(this.colors.field, this.colors.accent, p);
    c.lineWidth = 2;
    c.stroke();
    if (p > 0) {
      c.beginPath();
      c.arc(x, y, r * 0.55 * outBack(p), 0, Math.PI * 2);
      c.fillStyle = this.colors.accent;
      c.fill();
    }
    c.restore();
  }

  // A selectable option chip. It grows by its check mark when selected, so
  // leave that room (u.chipWidth(label, o, true)) next to it.
  chip(label, x, y, o = {}) {
    const c = this.c;
    const C = this.colors;
    const size = o.size ?? 20;
    const sel = clamp(o.selected ?? 0);
    const h = size * 2.2;
    const w = this.measure(label, size, 500) + size * 1.6 + sel * size * 1.1;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.beginPath();
    c.roundRect(x, y - h / 2, w, h, h / 2);
    c.fillStyle = mix('#ffffff', C.accentTint, sel);
    c.fill();
    c.strokeStyle = mix(C.field, C.accent, sel);
    c.lineWidth = 1.5 + sel;
    c.stroke();
    let tx = x + size * 0.8;
    if (sel > 0.05) {
      c.save();
      c.globalAlpha *= sel;
      this.icon('check', tx + size * 0.4, y, size * 0.85, C.accent, 2.6);
      c.restore();
      tx += sel * size * 1.1;
    }
    this.text(label, tx, y + 0.5, { size, weight: sel > 0.5 ? 600 : 500, color: mix(C.text, C.accent, sel) });
    c.restore();
    return w;
  }

  chipWidth(label, o = {}, selected = false) {
    const size = o.size ?? 20;
    return this.measure(label, size, selected ? 600 : 500) + size * 1.6 + (selected ? size * 1.1 : 0);
  }

  spinner(x, y, r, color = this.colors.accent) {
    const c = this.c;
    const a = this.s.t * 7;
    c.save();
    c.lineWidth = Math.max(2, r * 0.32);
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.globalAlpha *= 0.25;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha /= 0.25;
    c.beginPath();
    c.arc(x, y, r, a, a + Math.PI * 0.6);
    c.stroke();
    c.restore();
  }

  progress(x, y, w, p, o = {}) {
    const c = this.c;
    const h = o.h ?? 10;
    c.save();
    c.beginPath();
    c.roundRect(x, y - h / 2, w, h, h / 2);
    c.fillStyle = '#eaecf0';
    c.fill();
    if (p > 0) {
      c.beginPath();
      c.roundRect(x, y - h / 2, Math.max(h, w * clamp(p)), h, h / 2);
      c.fillStyle = o.color ?? this.colors.accent;
      c.fill();
    }
    c.restore();
  }

  avatar(x, y, r, initials = '', o = {}) {
    const c = this.c;
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = o.bg ?? this.colors.accentTint;
    c.fill();
    if (o.image) {
      const img = this.s.engine.image(o.image);
      c.clip();
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      c.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, x - r, y - r, r * 2, r * 2);
    }
    c.restore();
    if (initials && !o.image) this.text(initials, x, y + 1, { size: Math.max(17, r * 0.8), weight: 600, color: o.color ?? this.colors.accent, align: 'center' });
  }

  icon(name, x, y, size, color = this.colors.text, weight = 2) {
    if (this.hidden) return;
    this.s._iconAt(name, x, y, size, color, 1, 1, weight);
  }

  // Grey bars standing in for text, for article bodies and backgrounds.
  lines(x, y, w, n, o = {}) {
    const c = this.c;
    const gap = o.gap ?? 22;
    c.save();
    c.fillStyle = o.color ?? '#e9edf3';
    for (let i = 0; i < n; i++) {
      const lw = i === n - 1 ? w * (o.last ?? 0.6) : w * (0.88 + 0.12 * Math.abs(Math.sin(i * 7.3 + (o.seed ?? 0))));
      c.beginPath();
      c.roundRect(x, y + i * gap, lw, o.h ?? 9, (o.h ?? 9) / 2);
      c.fill();
    }
    c.restore();
  }

  // The brand logo (brand.logo in video.json, or o.src), w wide, centered on
  // (x, y) unless align is "left". Returns its height.
  logo(x, y, w, o = {}) {
    const src = o.src ?? this.logoSrc;
    if (!src) throw new SceneError('u.logo() needs a logo: set "brand": { "logo": "assets/logo.svg" } in video.json or pass { src }');
    const img = this.s.engine.image(src);
    const h = (w * img.naturalHeight) / img.naturalWidth;
    const c = this.c;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.drawImage(img, o.align === 'left' ? x : x - w / 2, y - h / 2, w, h);
    c.restore();
    return h;
  }

  // ---------- the cursor ----------

  // keys: [{ at, x, y }, ...]. The first key places the cursor; each later
  // one with x, y glides it there starting at `at` (dur, default 0.7 s). A
  // key with click: true presses at `at` and plays a click. Draw the cursor
  // last so it sits on top. Returns { x, y, press } or null before it shows.
  cursor(keys, o = {}) {
    const s = this.s;
    const first = keys[0];
    const start = this.at(first.at ?? 0);
    let x = first.x;
    let y = first.y;
    let press = 0;
    const ripples = [];
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      const a = this.at(k.at);
      if (k.click) s.sfx('click', a, { gain: 0.9 });
      if (s.t < a) continue;
      if (k.x !== undefined) {
        const p = inOutCubic(clamp((s.t - a) / ((k.dur ?? 0.7) / s.pace)));
        // A slight arc looks like a hand moved it.
        const dx = k.x - x;
        const dy = k.y - y;
        const arc = Math.sin(Math.PI * p) * (k.arc ?? 0.08);
        const nx = lerp(x, k.x, p) - dy * arc;
        y = lerp(y, k.y, p) + dx * arc;
        x = nx;
      }
      if (k.click) {
        const since = s.t - a;
        press = Math.max(press, bell(since / (0.26 / s.pace)));
        if (since < 0.6 / s.pace) ripples.push({ x, y, p: since / (0.6 / s.pace) });
      }
    }
    if (s.t < start) return null;
    const c = this.c;
    const [r, g, b] = rgb(this.colors.accent);
    for (const rp of ripples) {
      c.save();
      c.beginPath();
      c.arc(rp.x, rp.y, lerp(6, 38, outCubic(rp.p)), 0, Math.PI * 2);
      c.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.22 * (1 - rp.p)})`;
      c.fill();
      c.restore();
    }
    let alpha = clamp((s.t - start) / 0.25);
    if (o.out !== undefined) alpha *= 1 - this._p(o.out, 0.3, 'in');
    if (alpha <= 0) return { x, y, press };
    const size = (o.size ?? 34) * (1 - 0.14 * press);
    c.save();
    c.globalAlpha *= alpha;
    c.translate(x, y);
    c.scale(size / 24, size / 24);
    const k = this.k;
    c.shadowColor = 'rgba(0, 0, 0, 0.28)';
    c.shadowBlur = 5 * k;
    c.shadowOffsetY = 2 * k;
    const arrow = new Path2D('M1 1 L1 19.5 L5.6 15.3 L8.7 22.4 L11.9 21 L8.9 14.1 L15 14.1 Z');
    c.lineJoin = 'round';
    c.strokeStyle = '#ffffff';
    c.lineWidth = 3;
    c.stroke(arrow);
    c.shadowColor = 'transparent';
    c.fillStyle = '#101828';
    c.fill(arrow);
    c.restore();
    return { x, y, press };
  }

  // How far a click at `at` presses a button right now (0..1..0).
  press(at) {
    return bell((this.s.t - this.at(at)) / (0.26 / this.s.pace));
  }

  // The part of `str` typed by now, starting at `at`, with typing sounds
  // (o.gain, or o.sfx: false for none; keep long typing quiet under the voice).
  typed(str, at, cps = 17, o = {}) {
    const a = this.at(at);
    const dur = str.length / cps / this.s.pace;
    if (o.sfx !== false) this.s.sfx('type', a, { dur, gain: o.gain ?? 0.55 });
    return str.slice(0, Math.floor(clamp((this.s.t - a) / dur) * str.length));
  }

  // A number counting from `from` to `to`, starting at `at`.
  count(to, at, dur = 1, from = 0) {
    return Math.round(lerp(from, to, outCubic(this._p(at, dur, 'linear'))));
  }
}
