// The short-video kit behind s.short, for Shorts, TikTok and Reels: a bold
// backdrop, a hook title that is already there on the first frame (the cover),
// a kicker label, a sticker, camera keys for a punch-in and a slow drift, a jolt,
// a flash, a pattern interrupt, a step pill, a progress bar and a payoff card.
//
// Like everything in a scene, it draws as a function of the scene time. `at` and
// `out` take seconds, spoken words or "#marks", and pace applies. It draws
// straight on the canvas, so the automatic camera keeps what it draws as one
// block. A scene that wants a move sets s.camera with punch() or drift().

import { fontStack } from './themes.js';
import { contrast, cssColor, opaque, suggestColor } from './util.js';

const INK = '#0b0b10';
const KEY = '#ffd43b';
const TONES = {
  good: { bg: '#12a150', icon: 'circle-check' },
  bad: { bg: '#e5233d', icon: 'circle-x' },
  info: { bg: '#2563eb', icon: 'lightbulb' },
  dark: { bg: '#111827', icon: 'sparkles' },
};

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, p) => a + (b - a) * p;
const outCubic = (p) => 1 - Math.pow(1 - p, 3);
const outBack = (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
const outQuart = (p) => 1 - Math.pow(1 - p, 4);
// 0 -> 1 -> 0 over p in 0..1.
const bell = (p) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));

function rgb(c) {
  const h = String(c).replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, p) {
  const A = rgb(a);
  const B = rgb(b);
  const h = (i) => Math.round(lerp(A[i], B[i], clamp(p))).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

// The top and bottom of the backdrop's gradient.
function backdropColors(o) {
  const top = o.color ?? '#0d1222';
  return [top, o.color2 ?? mix(top, '#000000', 0.35)];
}

function alpha(c, a) {
  const [r, g, b] = rgb(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// The color of *keywords* on a sticker: red, made darker or lighter where the
// sticker's own color needs that to reach 4.5:1.
const KEY_RED = '#c8102e';
export function stickerKey(color) {
  const bg = cssColor(color);
  if (!bg || contrast(KEY_RED, bg) >= 4.5) return KEY_RED;
  return suggestColor(KEY_RED, opaque(bg, '#ffffff'), 0)?.color ?? KEY_RED;
}

function geom(x, y, w, h) {
  return { x, y, w, h, left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

// "*Keyword* rest" -> [{ text, key }], one entry per word. Stars may span words.
export function richWords(str) {
  const out = [];
  let on = false;
  for (const raw of String(str).split(/\s+/).filter(Boolean)) {
    let w = raw;
    let key = on;
    if (w.startsWith('*') && w.length > 1) {
      key = true;
      on = true;
      w = w.slice(1);
    }
    const m = /\*([.,;:!?"'’)]*)$/.exec(w);
    if (m && key) {
      w = w.slice(0, m.index) + m[1];
      on = false;
    }
    out.push({ text: w, key });
  }
  return out;
}

export class Short {
  constructor(s) {
    this.s = s;
  }

  // ---------- drawing helpers ----------

  // The canvas, or a stand-in that draws nothing while an s.group() is hidden.
  get c() {
    return this.s.ui.c;
  }

  get hidden() {
    return this.s._suppress > 0;
  }

  // Canvas pixels per local unit, for shadows that must zoom with the camera.
  get k() {
    const m = this.c.getTransform();
    return Math.hypot(m.a, m.b);
  }

  at(v) {
    return this.s.time(v);
  }

  // Null before `at` and after the exit, otherwise { p: entrance 0..1, q: exit 0..1 }.
  life(at, out, dur = 0.5, outDur = 0.35) {
    const s = this.s;
    const a = this.at(at ?? 0);
    if (s.t < a) return null;
    let q = 0;
    if (out !== undefined && out !== null) {
      q = clamp((s.t - this.at(out)) / (outDur / s.pace));
      if (q >= 1) return null;
    }
    const p = a < 0 ? 1 : clamp((s.t - a) / (dur / s.pace));
    if (p < 1 || (q > 0 && q < 1)) s.engine.moving = true;
    return { p, q };
  }

  // Tells check and the soundtrack that something enters at `at`. A sound the
  // scene did not ask for stays out with "sfx": "minimal" and after s.quiet().
  // `usual` is the part's own sound, which sfx: true asks for. An interrupt is
  // no entrance, so s.quiet() leaves its sound alone.
  enter(at, dur, sfx, { label, pitch, chosen = false, usual = null, entrance = true } = {}) {
    const quiet = (this.s.engine.sfxMode === 'minimal' || (this.s._quiet && entrance)) && !chosen;
    const sound = sfx === true ? usual : sfx;
    this.s._record('short', this.at(at ?? 0), dur, { sfx: quiet ? null : sound ?? null }, { label, pitch });
  }

  // Inter, then the fonts explainroo brings for Hindi, Japanese and Chinese.
  font(size, weight = 400) {
    return `${weight} ${size}px ${fontStack('Inter')}`;
  }

  measure(str, size, weight = 400, tracking = 0) {
    const c = this.c;
    c.save();
    c.font = this.font(size, weight);
    c.letterSpacing = `${tracking}px`;
    const w = c.measureText(String(str)).width;
    c.restore();
    return w;
  }

  // One line of text that check can see. o: size, weight, color, align,
  // tracking, stroke (outline color), strokeW, shadow, bg (the color behind it,
  // for the contrast check).
  text(str, x, y, o = {}) {
    const c = this.c;
    const size = o.size ?? 24;
    const t = String(str);
    c.save();
    c.font = this.font(size, o.weight ?? 400);
    c.textAlign = o.align ?? 'left';
    c.textBaseline = 'middle';
    c.letterSpacing = `${o.tracking ?? 0}px`;
    if (o.shadow) {
      c.shadowColor = o.shadow;
      c.shadowBlur = size * 0.25 * this.k;
      c.shadowOffsetY = size * 0.06 * this.k;
    }
    if (o.stroke) {
      c.lineJoin = 'round';
      c.miterLimit = 2;
      c.strokeStyle = o.stroke;
      c.lineWidth = o.strokeW ?? size * 0.16;
      c.strokeText(t, x, y);
      c.shadowColor = 'transparent';
    }
    const color = o.color ?? INK;
    c.fillStyle = color;
    c.fillText(t, x, y);
    const w = c.measureText(t).width;
    this.log(t, x, y, w, size, c.textAlign, { fg: color, bg: o.bg ?? null, option: o.option });
    c.restore();
    return w;
  }

  // Tells check where text was drawn, in local units. Each layer of the UI kit is
  // checked for overlaps on its own, and text on the base layer gets the size
  // rule of slides.
  log(str, x, y, w, size, align, { fg = null, bg = null, option = null } = {}) {
    if (!String(str).trim() || this.hidden) return;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const layer = this.s.ui._layer + 1;
    this.s._logText({ text: String(str), x0, y0: y - 0.58 * size, x1: x0 + w, y1: y + 0.58 * size, size, fg: /^#/.test(fg) ? fg : null, bg, ui: layer === 1 ? 0 : layer, zoomed: this.s._camMoved, option });
  }

  // Wraps text into lines no wider than maxW.
  wrap(str, maxW, size, weight = 400) {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${w}` : w;
        if (cur && this.measure(next, size, weight) > maxW) {
          lines.push(cur);
          cur = w;
        } else cur = next;
      }
      lines.push(cur);
    }
    return lines;
  }

  roundRect(x, y, w, h, r, fill, o = {}) {
    if (!this.hidden) this.s._seen(null);
    const c = this.c;
    c.save();
    if (o.shadow) {
      c.shadowColor = o.shadow.color;
      c.shadowBlur = o.shadow.blur * this.k;
      c.shadowOffsetY = (o.shadow.y ?? 0) * this.k;
    }
    c.beginPath();
    c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
    c.fillStyle = fill;
    c.fill();
    c.shadowColor = 'transparent';
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.lineWidth = o.strokeW ?? 2;
      c.stroke();
    }
    c.restore();
  }

  circle(x, y, r, fill) {
    if (!this.hidden) this.s._seen(null);
    const c = this.c;
    c.beginPath();
    c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  }

  icon(name, x, y, size, color, weight = 2) {
    if (this.hidden) return;
    this.s._seen(null);
    this.s._iconAt(name, x, y, size, color, 1, 1, weight);
  }

  // Registers a box (top-left x, y) under `id`, for s.get and arrows.
  reg(id, x, y, w, h) {
    if (id !== undefined && id !== null) this.s._register(id, x + w / 2, y + h / 2, w, h);
  }

  // Draws fn in screen space: design pixels after the camera, so it keeps its
  // place and size while the camera moves.
  screen(fn) {
    const c = this.c;
    c.save();
    const sc = this.s.engine.scale;
    c.setTransform(sc, 0, 0, sc, 0, 0);
    try {
      return fn();
    } finally {
      c.restore();
    }
  }

  // Scales and fades what fn draws around (cx, cy) for an entrance.
  popIn(life, cx, cy, fn, o = {}) {
    const c = this.c;
    const sc = lerp(o.from ?? 0.6, 1, outBack(life.p)) * (1 - 0.08 * life.q);
    c.save();
    c.globalAlpha *= clamp(life.p * 2.5) * (1 - life.q);
    c.translate(cx, cy + (o.rise ?? 0) * (1 - outCubic(life.p)));
    if (o.rotate) c.rotate((o.rotate * Math.PI) / 180);
    c.scale(sc, sc);
    c.translate(-cx, -cy);
    // check compares shapes only once they have arrived.
    const moving = life.p < 1 || life.q > 0;
    if (moving) this.s._unsettled++;
    try {
      fn();
    } finally {
      if (moving) this.s._unsettled--;
      c.restore();
    }
  }

  // ---------- background ----------

  // A bold full-frame background: a vertical gradient, an optional glow behind
  // the subject, a faint pattern and a vignette. Call it first.
  // o: color, color2, glow (a color), gx, gy (the glow's center), glowR,
  // pattern ('dots', 'grid', 'rays' or 'none'), patternAlpha, vignette (0..1).
  backdrop(o = {}) {
    const s = this.s;
    const sc = s.engine.scale;
    // check measures the text drawn after it against these colors.
    const [top, bottom] = backdropColors(o);
    s._page = { top, bottom };
    const key = JSON.stringify({ ...o, sc, W: s.W, H: s.H });
    const cache = (s.engine._shortBackdrops ??= new Map());
    if (!cache.has(key)) cache.set(key, this._backdrop(o, sc));
    const c = this.c;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(cache.get(key), 0, 0);
    c.restore();
    // Rays turn slowly, so the background is never quite still.
    if (o.pattern === 'rays') {
      this.screen(() => {
        c.save();
        c.translate(o.gx ?? s.cx, o.gy ?? s.cy);
        c.rotate(s.T * 0.05 * s.pace);
        c.fillStyle = alpha(o.rayColor ?? '#ffffff', o.patternAlpha ?? 0.05);
        const R = Math.hypot(s.W, s.H);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          c.beginPath();
          c.moveTo(0, 0);
          c.arc(0, 0, R, a, a + Math.PI / 32);
          c.closePath();
          c.fill();
        }
        c.restore();
      });
    }
  }

  _backdrop(o, sc) {
    const s = this.s;
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(s.W * sc)), Math.max(1, Math.round(s.H * sc)));
    const g = canvas.getContext('2d');
    g.scale(sc, sc);
    const [top, bottom] = backdropColors(o);
    const gradient = g.createLinearGradient(0, 0, 0, s.H);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    g.fillStyle = gradient;
    g.fillRect(0, 0, s.W, s.H);
    if (o.glow) {
      const gx = o.gx ?? s.cx;
      const gy = o.gy ?? s.cy;
      const glow = g.createRadialGradient(gx, gy, 0, gx, gy, o.glowR ?? Math.max(s.W, s.H) * 0.45);
      glow.addColorStop(0, alpha(o.glow, o.glowAlpha ?? 0.45));
      glow.addColorStop(1, alpha(o.glow, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, s.W, s.H);
    }
    const pa = o.patternAlpha ?? 0.07;
    const pc = o.patternColor ?? '#ffffff';
    if (o.pattern === 'dots') {
      g.fillStyle = alpha(pc, pa);
      const step = o.step ?? 44;
      for (let y = step / 2; y < s.H; y += step) for (let x = step / 2; x < s.W; x += step) g.fillRect(x - 2, y - 2, 4, 4);
    } else if (o.pattern === 'grid') {
      g.strokeStyle = alpha(pc, pa);
      g.lineWidth = 2;
      const step = o.step ?? 72;
      g.beginPath();
      for (let x = 0; x <= s.W; x += step) {
        g.moveTo(x, 0);
        g.lineTo(x, s.H);
      }
      for (let y = 0; y <= s.H; y += step) {
        g.moveTo(0, y);
        g.lineTo(s.W, y);
      }
      g.stroke();
    }
    const v = o.vignette ?? 0.45;
    if (v > 0) {
      const vg = g.createRadialGradient(s.W / 2, s.H / 2, Math.min(s.W, s.H) * 0.35, s.W / 2, s.H / 2, Math.max(s.W, s.H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${v})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, s.W, s.H);
    }
    return canvas;
  }

  // ---------- hook title ----------

  // The first-frame title: big, at most two lines, *keywords* marked. With at
  // <= 0 (the default) it is all there on the first frame, so that frame works
  // as the cover. style: 'slab' (white boxes, dark text), 'stroke' (white text
  // with a dark outline) or 'plain' (the look's ink). o: x, y (the middle of the
  // block), size (the start size, which shrinks to fit), width, maxLines,
  // upper: false, color, keyColor, keyBg, slab, kicker (a small label above),
  // kickerColor, kickerIcon, at, out, sfx, id, screen: true (drawn without the
  // camera, so it stays put while the camera moves). Returns the block's box.
  hook(str, o = {}) {
    const s = this.s;
    const style = o.style ?? 'slab';
    const width = o.width ?? s.safe.w;
    const maxLines = o.maxLines ?? 2;
    let size = o.size ?? (s.H > s.W ? 104 : 88);
    const minSize = o.minSize ?? 56;
    const weight = 900;
    const words = richWords(o.upper === false ? str : String(str).toUpperCase());
    let pad;
    let lines;
    // Shrink until the title fits in maxLines. A single word wider than the
    // box, like a long compound word, keeps shrinking below minSize, down to 32.
    for (;;) {
      pad = style === 'slab' ? size * 0.26 : 0;
      lines = this._lines(words, width - pad * 2, size, weight);
      const fits = Math.max(...lines.map((l) => l.w)) <= width - pad * 2;
      const floor = fits ? minSize : 32;
      if ((lines.length <= maxLines && fits) || size <= floor) break;
      size = Math.max(floor, size * 0.94);
    }
    const lh = style === 'slab' ? size * 1.2 : size * 1.06;
    const gap = style === 'slab' ? size * 0.1 : 0;
    const blockH = lines.length * lh + (lines.length - 1) * gap;
    const x = o.x ?? s.cx;
    const y = o.y ?? s.safe.top + (o.kicker ? 64 : 0) + blockH / 2 + 18;
    const top = y - blockH / 2;
    const a = this.at(o.at ?? 0);
    const first = a <= 0;
    if (!first) this.enter(a, 0.4, o.sfx === undefined ? 'whoosh' : o.sfx, { label: 'hook', chosen: o.sfx !== undefined, usual: 'whoosh' });
    const life = this.life(first ? -1 : a, o.out, 0.45, 0.3);
    const maxLineW = Math.max(...lines.map((l) => l.w)) + pad * 2;
    this.reg(o.id, x - maxLineW / 2, top, maxLineW, blockH);
    const place = (fn) => (o.screen ? this.screen(fn) : fn());
    if (o.kicker) place(() => this.kicker(o.kicker, { x, y: top - 44, color: o.kickerColor, icon: o.kickerIcon, at: first ? -1 : a, out: o.out }));
    if (!life) return geom(x, y, maxLineW, blockH);
    const c = this.c;
    place(() => this.s.ui.over(() => lines.forEach((line, li) => {
      const ly = top + li * (lh + gap) + lh / 2;
      // Lines slam in one after the other when the hook is not on the first frame.
      const lp = first ? 1 : clamp((s.t - a - (li * 0.08) / s.pace) / (0.32 / s.pace));
      if (lp <= 0) return;
      const sc = first ? 1 : lerp(1.35, 1, outQuart(lp));
      const moving = lp < 1 || life.q > 0;
      if (moving) s._unsettled++;
      c.save();
      c.globalAlpha *= clamp(lp * 2) * (1 - life.q);
      c.translate(x, ly - life.q * 30);
      c.scale(sc, sc);
      if (style === 'slab') {
        const w = line.w + pad * 2;
        this.roundRect(-w / 2, -lh / 2, w, lh, size * 0.16, o.slab ?? '#ffffff', { shadow: { color: 'rgba(0,0,0,0.28)', blur: 18, y: 8 } });
      }
      let wx = -line.w / 2;
      for (const w of line.words) {
        const ww = this.measure(w.text, size, weight);
        if (w.key && style === 'slab') this.roundRect(wx - size * 0.1, -lh / 2 + size * 0.1, ww + size * 0.2, lh - size * 0.2, size * 0.12, o.keyBg ?? '#e5233d');
        const color = style === 'slab' ? (w.key ? o.keyColor ?? '#ffffff' : o.color ?? INK) : w.key ? o.keyColor ?? KEY : o.color ?? (style === 'stroke' ? '#ffffff' : s.theme.ink);
        const bg = style === 'slab' ? (w.key ? o.keyBg ?? '#e5233d' : o.slab ?? '#ffffff') : style === 'stroke' ? INK : s.theme.bg;
        this.text(w.text, wx, size * 0.04, { size, weight, color, bg, stroke: style === 'stroke' ? INK : undefined, strokeW: size * 0.2, shadow: style === 'stroke' ? 'rgba(0,0,0,0.45)' : undefined });
        wx += ww + line.space;
      }
      c.restore();
      if (moving) s._unsettled--;
    })));
    return geom(x, y, maxLineW, blockH);
  }

  _lines(words, maxW, size, weight) {
    const space = this.measure(' ', size, weight);
    const lines = [];
    let cur = { words: [], w: 0, space };
    for (const w of words) {
      const ww = this.measure(w.text, size, weight);
      if (cur.words.length && cur.w + space + ww > maxW) {
        lines.push(cur);
        cur = { words: [], w: 0, space };
      }
      cur.w += (cur.words.length ? space : 0) + ww;
      cur.words.push(w);
    }
    if (cur.words.length) lines.push(cur);
    return lines;
  }

  // A small uppercase label, like "QUICK TIP" above a hook. o: x, y, size,
  // color, icon (an icon name), at, out, sfx. Returns its width.
  kicker(str, o = {}) {
    const s = this.s;
    const size = o.size ?? 34;
    const label = String(str).toUpperCase();
    const icon = o.icon ?? null;
    const tw = this.measure(label, size, 800, 2);
    const iw = icon ? size * 1.15 : 0;
    const w = tw + iw + size * 1.3;
    const h = size * 1.75;
    const x = o.x ?? s.cx;
    const y = o.y ?? s.safe.top + h / 2 + 12;
    const at = o.at ?? 0;
    if (this.at(at) >= 0) this.enter(at, 0.35, o.sfx ?? null, { label: 'kicker', chosen: o.sfx !== undefined });
    const life = this.life(at, o.out, 0.35);
    if (!life) return w;
    const bg = o.color ?? '#e5233d';
    this.popIn(life, x, y, () => {
      this.roundRect(x - w / 2, y - h / 2, w, h, h / 2, bg, { shadow: { color: alpha(bg, 0.45), blur: 20, y: 6 } });
      let tx = x - w / 2 + size * 0.65;
      if (icon) {
        this.icon(icon, tx + size * 0.45, y, size * 0.95, '#ffffff', 2.6);
        tx += iw;
      }
      this.text(label, tx, y + 1, { size, weight: 800, color: '#ffffff', tracking: 2, bg });
    });
    return w;
  }

  // A tilted sticker: a solid box with bold text, for one key fact. *Keywords*
  // get their own color. o: x, y, size, color (the box), textColor, keyColor,
  // rotate (degrees), border, at, out, sfx, id.
  sticker(str, o = {}) {
    const s = this.s;
    const size = o.size ?? 56;
    const words = richWords(String(str));
    const tw = this.measure(words.map((w) => w.text).join(' '), size, 900);
    const w = tw + size * 0.9;
    const h = size * 1.5;
    const x = o.x ?? s.cx;
    const y = o.y ?? s.cy;
    this.reg(o.id, x - w / 2, y - h / 2, w, h);
    const at = o.at ?? 0;
    if (this.at(at) >= 0) this.enter(at, 0.35, o.sfx === undefined ? 'pop' : o.sfx, { label: words.map((wd) => wd.text).join(' ').slice(0, 20), chosen: o.sfx !== undefined, usual: 'pop' });
    const life = this.life(at, o.out, 0.38);
    if (!life) return geom(x, y, w, h);
    const bg = o.color ?? KEY;
    const keyColor = o.keyColor ?? stickerKey(bg);
    this.s.ui.over(() => this.popIn(life, x, y, () => {
      this.roundRect(x - w / 2, y - h / 2, w, h, size * 0.22, bg, { shadow: { color: 'rgba(0,0,0,0.35)', blur: 16, y: 8 }, stroke: o.border, strokeW: 5 });
      if (!this.hidden) this.s._logShape('sticker', { x, y, w, h }, this.s._unsettled === 0, o, words.map((wd) => wd.text).join(' '));
      let wx = x - tw / 2;
      const space = this.measure(' ', size, 900);
      for (const wd of words) {
        this.text(wd.text, wx, y + size * 0.04, { size, weight: 900, color: wd.key ? keyColor : o.textColor ?? INK, bg, option: wd.key ? 'keyColor' : 'textColor' });
        wx += this.measure(wd.text, size, 900) + space;
      }
    }, { rotate: o.rotate ?? -4, from: 0.4 }));
    return geom(x, y, w, h);
  }

  // ---------- camera keys ----------

  // Keys for a punch-in: a fast zoom onto a point at `at`, held for `hold`
  // seconds and then back to where it started, unless back: false. Spread them
  // into s.camera([...]). o: x, y, zoom, dur, hold, back ({ x, y, zoom, dur }).
  punch(at, o = {}) {
    const s = this.s;
    const a = this.at(at);
    const keys = [{ at: a, x: o.x ?? s.cx, y: o.y ?? s.cy, zoom: o.zoom ?? 1.35, dur: o.dur ?? 0.24, ease: 'outQuart' }];
    if (o.hold !== undefined && o.back !== false) {
      const b = o.back ?? {};
      keys.push({ at: a + o.hold, x: b.x ?? s.cx, y: b.y ?? s.cy, zoom: b.zoom ?? 1, dur: b.dur ?? 0.5, ease: 'inOut' });
    }
    return keys;
  }

  // Keys for a slow push-in over the rest of the scene, so a still frame moves.
  // o: from (a time), x, y, zoom, dur.
  drift(o = {}) {
    const s = this.s;
    const from = this.at(o.from ?? 0);
    return [{ at: from, x: o.x ?? s.cx, y: o.y ?? s.cy, zoom: o.zoom ?? 1.06, dur: o.dur ?? Math.max(1, s.dur - from) * s.pace, ease: 'linear' }];
  }

  // ---------- pattern interrupts ----------

  // A short jolt at `at`: the frame bumps in and shakes for a moment around the
  // middle of the screen. Call it before drawing what it should move.
  // o: dur, zoom, shake.
  jolt(at, o = {}) {
    const s = this.s;
    const a = this.at(at);
    const p = (s.t - a) / ((o.dur ?? 0.35) / s.pace);
    if (p <= 0 || p >= 1) return;
    s.engine.moving = true;
    const sc = s.engine.scale;
    const bump = 1 + ((o.zoom ?? 1.06) - 1) * bell(Math.min(1, p * 1.6));
    const amp = (o.shake ?? 10) * (1 - p) * sc;
    const dx = Math.sin(p * 47 + a * 3) * amp;
    const dy = Math.cos(p * 39 + a * 5) * amp;
    const c = this.c;
    const m = c.getTransform();
    c.setTransform(new DOMMatrix().translate(s.cx * sc + dx, s.cy * sc + dy).scale(bump, bump).translate(-s.cx * sc, -s.cy * sc).multiply(m));
  }

  // A white or colored flash over the whole frame at `at`, on top of everything.
  // o: color, alpha, dur.
  flash(at, o = {}) {
    const s = this.s;
    const a = this.at(at);
    const p = (s.t - a) / ((o.dur ?? 0.24) / s.pace);
    if (p < 0 || p >= 1) return;
    s.engine.moving = true;
    s._post(() => {
      const c = s.ctx;
      c.fillStyle = alpha(o.color ?? '#ffffff', (o.alpha ?? 0.85) * Math.pow(1 - p, 2));
      c.fillRect(0, 0, s.W, s.H);
    });
  }

  // A pattern interrupt at `at`: a flash, a jolt and one sound. Call it first in
  // the scene, or right after s.camera(), so the jolt moves everything.
  // o: flash (a color, or false), zoom, shake, sfx ('whoosh').
  interrupt(at, o = {}) {
    const a = this.at(at);
    this.enter(a, 0.3, o.sfx === undefined ? 'whoosh' : o.sfx, { label: 'interrupt', chosen: o.sfx !== undefined, usual: 'whoosh', entrance: false });
    this.jolt(a, o);
    if (o.flash !== false) this.flash(a, { color: typeof o.flash === 'string' ? o.flash : '#ffffff', alpha: o.flashAlpha, dur: o.flashDur });
  }

  // ---------- progress ----------

  // "STEP 2/4" with dots, at the top of the content area, outside the camera.
  // n is the step this scene shows, and its dot fills at `at`.
  // o: word (instead of STEP, like s.str('step')), label, x, y, size, color, at, out, sfx.
  step(n, total, o = {}) {
    const s = this.s;
    const size = o.size ?? 34;
    const x = o.x ?? s.cx;
    const y = o.y ?? s.safe.top + 40;
    const color = o.color ?? KEY;
    const label = `${String(o.word ?? 'STEP').toUpperCase()} ${n}/${total}`;
    const at = o.at ?? -1;
    const a = this.at(at);
    if (a >= 0) this.enter(a, 0.3, o.sfx === undefined ? 'blip' : o.sfx, { label, pitch: n, chosen: o.sfx !== undefined, usual: 'blip' });
    const life = this.life(at, o.out, 0.3);
    if (!life) return;
    const tw = this.measure(label, size, 900, 1.5);
    const dotR = size * 0.2;
    const dotsW = total * dotR * 2 + (total - 1) * dotR * 1.4;
    const extra = o.label ? this.measure(o.label, size, 700) + size * 0.8 : 0;
    const w = tw + dotsW + extra + size * 1.9;
    const h = size * 1.7;
    const left = x - w / 2;
    this.s.ui.over(() => this.screen(() => {
      this.c.globalAlpha *= 1 - life.q;
      this.roundRect(left, y - h / 2, w, h, h / 2, alpha(INK, 0.82), { shadow: { color: 'rgba(0,0,0,0.3)', blur: 14, y: 4 } });
      this.text(label, left + size * 0.6, y + 1, { size, weight: 900, color, tracking: 1.5, bg: INK });
      let dx = left + size * 0.6 + tw + size * 0.55 + dotR;
      for (let i = 1; i <= total; i++) {
        const fill = i < n ? 1 : i === n ? (a < 0 ? 1 : outBack(clamp(life.p))) : 0;
        this.circle(dx, y, dotR, alpha('#ffffff', 0.28));
        if (fill > 0) this.circle(dx, y, dotR * fill, color);
        dx += dotR * 3.4;
      }
      if (o.label) this.text(o.label, dx - dotR + size * 0.3, y + 1, { size, weight: 700, color: '#ffffff', bg: INK });
    }));
  }

  // A thin bar that fills over the whole video, just above the content area.
  // o: x, y, w, h, color.
  progress(o = {}) {
    const s = this.s;
    const p = clamp(s.T / Math.max(0.1, s.video.duration));
    this.screen(() => {
      const x = o.x ?? s.safe.left;
      const w = o.w ?? s.safe.w;
      const y = o.y ?? s.safe.top - 14;
      const h = o.h ?? 8;
      this.roundRect(x, y, w, h, h / 2, alpha('#ffffff', 0.22));
      this.roundRect(x, y, Math.max(h, w * p), h, h / 2, o.color ?? KEY);
    });
  }

  // ---------- payoff ----------

  // The payoff card: an icon, a bold title and up to three short lines, each
  // with a check mark. o: tone ('good', 'bad', 'info' or 'dark'), icon, title,
  // lines (texts or { text, at }), x, y, w, card (its color), at, out, sfx
  // ('chime'), id. Returns its box.
  payoff(o = {}) {
    const s = this.s;
    const tone = TONES[o.tone ?? 'good'] ?? TONES.good;
    // A little narrower than the content area, so a slow push-in keeps it inside.
    const w = o.w ?? s.safe.w * 0.92;
    const x = o.x ?? s.cx;
    const tall = s.H > s.W;
    const pad = tall ? 52 : 44;
    const titleSize = o.titleSize ?? (tall ? 76 : 64);
    const lineSize = o.lineSize ?? (tall ? 48 : 40);
    const card = o.card ?? '#ffffff';
    const titleLines = this.wrap(String(o.title ?? ''), w - pad * 2, titleSize, 900);
    const items = (o.lines ?? []).map((l) => (typeof l === 'string' ? { text: l } : l));
    const itemLines = items.map((it) => this.wrap(it.text, w - pad * 2 - lineSize * 1.3, lineSize, 700));
    const iconR = o.iconSize ?? (tall ? 100 : 84);
    const h = pad + iconR * 2 + 34 + titleLines.length * titleSize * 1.08 + (items.length ? 30 : 0) + itemLines.reduce((n, l) => n + l.length * lineSize * 1.25 + 22, 0) + pad - (items.length ? 22 : 0);
    const y = o.y ?? s.cy;
    const top = y - h / 2;
    this.reg(o.id, x - w / 2, top, w, h);
    const at = o.at ?? 0;
    const a = this.at(at);
    if (a >= 0) this.enter(at, 0.5, o.sfx === undefined ? 'chime' : o.sfx, { label: 'payoff', chosen: o.sfx !== undefined, usual: 'chime' });
    // Each line has its own entrance, on its own cue or one after the other.
    const lineAt = items.map((it, i) => (it.at !== undefined ? this.at(it.at) : a + (0.4 + i * 0.35) / s.pace));
    lineAt.forEach((t, i) => {
      if (t >= 0) this.enter(t, 0.3, o.itemSfx ?? 'blip', { label: `payoff${i}`, pitch: i + 2, chosen: o.itemSfx !== undefined, usual: 'blip' });
    });
    const life = this.life(at, o.out, 0.55);
    if (!life) return geom(x, y, w, h);
    this.s.ui.over(() => this.popIn(life, x, y, () => {
      this.roundRect(x - w / 2, top, w, h, 40, card, { shadow: { color: 'rgba(0,0,0,0.35)', blur: 40, y: 18 } });
      if (!this.hidden) this.s._logShape('card', { x, y: top + h / 2, w, h }, this.s._unsettled === 0, o, o.title ?? '');
      const icy = top + pad + iconR;
      // The icon breathes a little.
      const pulse = 1 + 0.04 * Math.sin(s.t * 3.2);
      this.circle(x, icy, iconR * 1.18 * pulse, alpha(tone.bg, 0.16));
      this.circle(x, icy, iconR, tone.bg);
      this.icon(o.icon ?? tone.icon, x, icy, iconR * 1.05, '#ffffff', 2.4);
      let ty = icy + iconR + 34 + (titleSize * 1.08) / 2;
      for (const line of titleLines) {
        this.text(line, x, ty, { size: titleSize, weight: 900, color: INK, align: 'center', bg: card });
        ty += titleSize * 1.08;
      }
      ty += 30 - (titleSize * 1.08) / 2;
      items.forEach((it, i) => {
        const ip = clamp((s.t - lineAt[i]) / (0.35 / s.pace));
        if (ip > 0) {
          const c = this.c;
          if (ip < 1) s._unsettled++;
          c.save();
          c.globalAlpha *= ip;
          c.translate((1 - outCubic(ip)) * 30, 0);
          const lx = x - w / 2 + pad;
          this.circle(lx + lineSize * 0.42, ty + lineSize * 0.62, lineSize * 0.42, tone.bg);
          this.icon('check', lx + lineSize * 0.42, ty + lineSize * 0.62, lineSize * 0.55, '#ffffff', 3.4);
          itemLines[i].forEach((ln, k) => this.text(ln, lx + lineSize * 1.3, ty + lineSize * 0.62 + k * lineSize * 1.25, { size: lineSize, weight: 700, color: '#1f2937', bg: card }));
          c.restore();
          if (ip < 1) s._unsettled--;
        }
        ty += itemLines[i].length * lineSize * 1.25 + 22;
      });
    }, { from: 0.8, rise: 40 }));
    return geom(x, y, w, h);
  }
}
