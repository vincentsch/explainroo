// The scene API. Every scene function receives a Stage `s` for one frame and
// draws the whole frame from scratch as a function of the scene time `s.t`.
// Elements take `at` (when they appear) and optional `out` (when they leave);
// the theme decides how they enter, and entering elements add sound effects.
import { clamp, lerp, ease, easeFn, rand01, noise1, hashStr, mulberry32, suggest, normWord, withAlpha, contrast, mixColor, opaque } from './util.js';
import { colorOf, tintOf, fontString } from './themes.js';
import { scalePath, quadD, polyD, pathLength, pointAt, parsePath, absolutize } from './pathdata.js';
import { layoutText, lineStartX } from './text.js';
import { clipFrame, clipURL } from './clips.js';
import { highlightLine, codeTokens, matchTokens, resolveCodeSteps, codeMorphState } from './code.js';

const DEFAULT_DUR = { draw: 0.9, write: 0.8, pop: 0.6, rise: 0.75, fade: 0.6, zoom: 0.75, drop: 0.75, grow: 1.0, none: 0.001, 'slide-left': 0.75, 'slide-right': 0.75, 'slide-up': 0.75, 'slide-down': 0.75 };
const ENTERS = ['draw', 'write', 'type', 'words', 'sync', 'pop', 'rise', 'fade', 'zoom', 'drop', 'grow', 'none', 'slide-left', 'slide-right', 'slide-up', 'slide-down'];
const EXITS = ['fade', 'pop', 'rise', 'drop', 'slide-left', 'slide-right', 'none'];
const BOLD = { display: undefined, body: 600, hand: undefined, mono: 700 };

export class SceneError extends Error {}

export class Stage {
  constructor(engine, ctx, scene, t) {
    this.engine = engine;
    this.ctx = ctx;
    this.scene = scene;
    this.theme = engine.theme;
    this.pen = engine.pen;
    this.W = engine.W;
    this.H = engine.H;
    this.portrait = this.H > this.W;
    // Platform formats (tiktok, reels, shorts...) keep content inside the part
    // of the frame the app leaves free, so the center moves with it.
    this.safe = engine.safeArea;
    this.platform = Boolean(engine.config.safe);
    this.cx = this.platform ? this.safe.x + this.safe.w / 2 : this.W / 2;
    this.cy = this.platform ? this.safe.y + this.safe.h / 2 : this.H / 2;
    // The center of the content area. With captions on it sits above the
    // frame center; layout helpers center on it by default.
    this._mid = { x: this.safe.x + this.safe.w / 2, y: this.safe.y + this.safe.h / 2 };
    // pace > 1 makes animations shorter. Times stay real seconds of the
    // scene, like s.t and the word cues, so `s.cue('word') + 0.3` keeps working.
    this.pace = engine.timeline.pace || 1;
    this.t = t;
    this.T = scene.start + t;
    this.dur = scene.dur;
    this.end = scene.dur;
    this.id = scene.id;
    this.index = scene.index;
    this.words = scene.words;
    this.marks = scene.marks;
    this.voice = scene.voice ? { start: scene.lead, end: scene.lead + scene.voice.dur } : { start: 0, end: 0 };
    this.fps = engine.fps;
    const tl = engine.timeline;
    this.video = { duration: tl.duration, frames: tl.frames, fps: tl.fps, width: tl.width, height: tl.height, scenes: tl.scenes.length };
    this.ease = ease;
    this.lerp = lerp;
    this.clamp = clamp;
    this._ids = new Map();
    this._kindSeq = Object.create(null);
    this._suppress = 0;
    this._camMoved = false;
  }

  // The UI kit for product demos (engine/ui.js): app cards, fields, buttons,
  // a clicking cursor and serif headlines, in the colors from "brand".
  get ui() {
    if (!this._ui) {
      if (!Stage.UI) throw new SceneError('the UI kit is not loaded');
      this._ui = new Stage.UI(this);
    }
    return this._ui;
  }

  // ---------- time ----------

  // Start time of the n-th time a word or phrase is spoken in this scene.
  cue(word, n = 1) {
    return this._cue(word, n).start;
  }

  cueEnd(word, n = 1) {
    return this._cue(word, n).end;
  }

  _cue(word, n) {
    const cjk = ['ja', 'zh'].includes(this.engine.config.language);
    const want = (cjk ? [String(word)] : String(word).split(/\s+/)).map(normWord).filter(Boolean);
    if (!want.length) throw new SceneError(`cue("${word}") is empty`);
    const ws = this.words;
    if (!ws.length) throw new SceneError(`cue("${word}"): scene "${this.id}" has no narration`);
    const norms = ws.map((w) => normWord(w.text));
    let seen = 0;
    let found = null;
    for (let i = 0; i + want.length <= norms.length; i++) {
      let ok = true;
      let end = i + want.length;
      if (cjk) {
        let phrase = norms[i];
        while (phrase.length < want[0].length && end < norms.length) phrase += norms[end++];
        ok = phrase === want[0];
      } else {
        for (let k = 0; k < want.length; k++) if (norms[i + k] !== want[k]) { ok = false; break; }
      }
      if (ok && ++seen === n && !found) found = { start: ws[i].start, end: ws[end - 1].end };
    }
    if (found) {
      // A word spoken more than once silently means its first time; tell the check.
      if (seen > 1 && n === 1 && this.engine.cueNotes) this.engine.cueNotes.push({ scene: this.id, word: String(word), count: seen });
      return found;
    }
    const count = seen ? ` (it is spoken ${seen} time${seen > 1 ? 's' : ''})` : '';
    const hint = suggest(want[0], [...new Set(norms)], 6).join(', ');
    throw new SceneError(`cue("${word}"${n > 1 ? `, ${n}` : ''}) is not in the narration of scene "${this.id}"${count}. Close words: ${hint}`);
  }

  mark(name) {
    if (!(name in this.marks)) {
      const names = Object.keys(this.marks);
      throw new SceneError(`mark("${name}") is not in scene "${this.id}". ${names.length ? 'Marks: ' + names.join(', ') : 'Add [#' + name + '] to the narration in script.md.'}`);
    }
    return this.marks[name];
  }

  // Accepts seconds, "#mark" or a spoken word/phrase.
  time(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return v.startsWith('#') ? this.mark(v.slice(1)) : this.cue(v);
    if (v === undefined || v === null) return 0;
    throw new SceneError(`a time must be seconds, a spoken word or "#mark", not ${JSON.stringify(v)}`);
  }

  // 0..1 progress of an animation that starts at `at` and lasts `dur`.
  p(at, dur = 0.6, easing = 'inOut') {
    const a = this.time(at);
    return easeFn(easing)(clamp((this.t - a) / (dur / this.pace)));
  }

  since(at) {
    return this.t - this.time(at);
  }

  between(a, b) {
    return this.t >= this.time(a) && this.t < this.time(b);
  }

  rand(i = 0, seed = 0) {
    return rand01(i, hashStr(this.id) + seed);
  }

  noise(x, seed = 0) {
    return noise1(x, hashStr(this.id) + seed);
  }

  // Smooth idle drift, handy to keep a still element alive.
  wiggle(amount = 6, speed = 0.6, seed = 0) {
    const k = this.T * speed;
    return { x: noise1(k, seed * 13 + 1) * amount, y: noise1(k, seed * 13 + 7) * amount };
  }

  color(name) {
    return colorOf(this.theme, name);
  }

  tint(name) {
    return tintOf(this.theme, name);
  }

  // ---------- layout ----------

  row(n, o = {}) {
    const width = o.width ?? this._w(0.72);
    const x = o.x ?? this.cx;
    if (n <= 1) return [x];
    return Array.from({ length: n }, (_, i) => x - width / 2 + (width * i) / (n - 1));
  }

  col(n, o = {}) {
    const height = o.height ?? (this.platform ? this.safe.h * 0.7 : Math.min(this.H * 0.56, this.safe.h * 0.8));
    const y = o.y ?? this._mid.y;
    if (n <= 1) return [y];
    return Array.from({ length: n }, (_, i) => y - height / 2 + (height * i) / (n - 1));
  }

  grid(cols, rows, o = {}) {
    const w = o.w ?? this.safe.w;
    const h = o.h ?? this.safe.h;
    const x0 = (o.x ?? this._mid.x) - w / 2;
    const y0 = (o.y ?? this._mid.y) - h / 2;
    const gap = o.gap ?? 24;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * (cw + gap) + cw / 2, y: y0 + r * (ch + gap) + ch / 2, w: cw, h: ch });
    return cells;
  }

  // Geometry of an element registered with `id`, in scene coordinates.
  get(id) {
    const r = this._ids.get(id);
    if (!r) throw new SceneError(`no element with id "${id}" has been drawn yet in scene "${this.id}". Draw it before referring to it.`);
    return this._fromDesign(r);
  }

  // ---------- internals ----------

  _seed(kind, o, label) {
    if (o.seed !== undefined) return o.seed;
    const n = (this._kindSeq[kind] = (this._kindSeq[kind] || 0) + 1);
    return hashStr(`${this.id}:${o.id ?? `${kind}#${n}:${label ?? ''}`}`) % 100000 + 1;
  }

  _check(o, kind) {
    if (o.enter && !ENTERS.includes(o.enter)) throw new SceneError(`${kind}: enter "${o.enter}" is not one of ${ENTERS.join(', ')}`);
    if (o.exit && !EXITS.includes(o.exit)) throw new SceneError(`${kind}: exit "${o.exit}" is not one of ${EXITS.join(', ')}`);
  }

  _life(o, kind, extra = {}) {
    this._check(o, kind);
    const enter = o.enter ?? extra.enter ?? this.theme.enter[kind] ?? this.theme.enter.shape ?? 'fade';
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? Infinity : this.time(o.out);
    const base = o.dur ?? extra.dur ?? DEFAULT_DUR[enter] ?? 0.6;
    const dur = extra.real ? base : base / this.pace;
    this._record(kind, at, dur, o, extra);
    if (this.engine.layoutLog && this._pendingBox) {
      // The element's own scale and rotation, and parts drawn beside it
      // (an icon's label), count for the camera.
      let box = this._pendingBox;
      const sc = o.scale ?? 1;
      const rad = ((o.rotate ?? 0) * Math.PI) / 180;
      if (sc !== 1 || rad) box = { ...box, w: (Math.abs(box.w * Math.cos(rad)) + Math.abs(box.h * Math.sin(rad))) * sc, h: (Math.abs(box.w * Math.sin(rad)) + Math.abs(box.h * Math.cos(rad))) * sc };
      // _pendingExtra is already measured with the element's transform.
      if (this._pendingExtra) box = unionBox(box, this._pendingExtra);
      this._attach(kind, at, out, box, this._pendingInfo);
      this._pendingBox = null;
      this._pendingExtra = null;
      this._pendingInfo = null;
    }
    if (this._suppress > 0) return null;
    if (this.t < at) return null;
    let q = 0;
    if (this.t >= out) {
      q = clamp((this.t - out) / ((o.outDur ?? 0.45) / this.pace));
      if (q >= 1 || o.exit === 'none') return null;
    }
    const p = clamp((this.t - at) / dur);
    if ((p < 1 && enter !== 'none') || (q > 0 && q < 1)) this.engine.moving = true;
    return { p, q, at, dur, enter, exit: o.exit ?? 'fade', local: this.t - at };
  }

  _record(kind, at, dur, o, extra = {}) {
    const rec = this.engine.recorder;
    // Negative times mean "already on screen when the scene starts": no sound.
    if (!rec || at < 0) return;
    let sfx = o.sfx === undefined ? (extra.sfx === undefined ? this.theme.sfx[kind] : extra.sfx) : o.sfx;
    if (this.engine.sfxMode === 'minimal' && o.sfx === undefined) sfx = null;
    rec.push({ kind, at, dur, sfx: sfx || null, gain: o.sfxGain ?? extra.gain ?? 1, pitch: extra.pitch, sustain: extra.sustain, key: `${kind}|${Math.round(at * 1000)}|${o.id ?? extra.label ?? ''}|${extra.pitch ?? ''}` });
  }

  // Entrances move on a spring: they go a little past their place and settle
  // back. They fade in quickly.
  // `lift` is 1 while an element is arriving and 0 once it has landed;
  // shadows use it to rise and settle.
  _enterTransform(life) {
    const p = life.p;
    const E = ease.out(p);
    const S = ease.spring(p);
    const A = ease.out(clamp(p * 1.8));
    let a = 1;
    let s = 1;
    let dx = 0;
    let dy = 0;
    let lift = 0;
    switch (life.enter) {
      case 'fade': a = E; s = lerp(0.975, 1, S); break;
      case 'pop': s = lerp(0.6, 1, S); a = clamp(p * 3); lift = 1 - E; break;
      case 'rise': dy = (1 - S) * 44; s = lerp(0.965, 1, S); a = A; lift = 1 - E; break;
      case 'drop': dy = -(1 - S) * 60; a = clamp(p * 2.5); lift = 1 - E; break;
      case 'zoom': s = lerp(1.3, 1, S); a = A; break;
      case 'slide-left': dx = (1 - S) * 170; a = A; break;
      case 'slide-right': dx = -(1 - S) * 170; a = A; break;
      case 'slide-up': dy = (1 - S) * 170; a = A; break;
      case 'slide-down': dy = -(1 - S) * 170; a = A; break;
      default: break;
    }
    if (life.q > 0) {
      const Q = ease.in(life.q);
      switch (life.exit) {
        case 'pop': s *= 1 - 0.45 * Q; a *= 1 - Q; break;
        case 'rise': dy -= Q * 40; s *= 1 - 0.03 * Q; a *= 1 - Q; break;
        case 'drop': dy += Q * 60; a *= 1 - Q; break;
        case 'slide-left': dx -= Q * 170; a *= 1 - Q; break;
        case 'slide-right': dx += Q * 170; a *= 1 - Q; break;
        default: s *= 1 - 0.03 * Q; a *= 1 - Q;
      }
    }
    return { a, s, dx, dy, lift };
  }

  // The look's shadow (or `fallback`), raised while the element drawn last
  // is still arriving.
  _shadow(tr = this._lastTr, fallback = null) {
    const sh = this.theme.shadow || fallback;
    if (!sh || !tr || !tr.lift) return sh;
    const k = tr.lift;
    return { ...sh, blur: sh.blur * (1 + 1.4 * k), y: (sh.y || 0) * (1 + 2 * k) };
  }

  _push(x, y, life, o) {
    const ctx = this.ctx;
    ctx.save();
    const tr = this._enterTransform(life);
    let fx = 0;
    let fy = 0;
    if (o.float) {
      const w = this.wiggle(o.float, 0.5, hashStr(String(o.id ?? x + ':' + y)) % 97);
      fx = w.x;
      fy = w.y;
    }
    ctx.translate(x + tr.dx + fx, y + tr.dy + fy);
    if (o.rotate) ctx.rotate((o.rotate * Math.PI) / 180);
    const sc = (o.scale ?? 1) * tr.s;
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.globalAlpha *= tr.a * (o.opacity ?? 1);
    this._lastTr = tr;
    return tr;
  }

  _drawProgress(life) {
    if (life.enter !== 'draw') return { stroke: 1, fill: 1, text: 1 };
    const p = life.p;
    return { stroke: ease.inOut(clamp(p / 0.78)), fill: clamp((p - 0.42) / 0.58), text: clamp((p - 0.35) / 0.45) };
  }

  // Current transform relative to the render scale: local -> design pixels.
  _matrix() {
    const m = this.ctx.getTransform();
    const s = this.engine.scale;
    return new DOMMatrix([m.a / s, m.b / s, m.c / s, m.d / s, m.e / s, m.f / s]);
  }

  _register(id, x, y, w, h, shape = 'rect') {
    const m = this._matrix();
    const pts = [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), shape };
    if (id !== undefined && id !== null) this._ids.set(String(id), box);
    // While the camera is planned, the next _life call gives this box its
    // timing.
    if (this.engine.layoutLog) this._pendingBox = box;
    return box;
  }

  // Records an element's place and timing for the automatic camera. x, y is
  // the center in local coordinates.
  _logLayout(kind, at, out, x, y, w, h) {
    if (!this.engine.layoutLog) return;
    this._attach(kind, at, out, this._designBox(x, y, w, h));
  }

  // A box inside an element drawn at (ax, ay), in scene coordinates, with
  // the element's own scale and rotation, as _push draws it.
  _elementBox(o, ax, ay, x, y, w, h) {
    const sc = o.scale ?? 1;
    const rad = ((o.rotate ?? 0) * Math.PI) / 180;
    const m = this._matrix().translate(ax, ay).rotate((rad * 180) / Math.PI).scale(sc, sc);
    const pts = [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(([px, py]) => m.transformPoint(new DOMPoint(px - ax, py - ay)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // The box around text drawn beside an element, like a chart's labels, for
  // the camera: where the letters land, as the browser measures them. Each
  // entry: { text, x, y, font, align, base } with canvas textAlign and
  // textBaseline values.
  _textExtent(entries) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const ctx = this.ctx;
    ctx.save();
    for (const e of entries) {
      if (!e.text) continue;
      ctx.font = e.font;
      ctx.textAlign = e.align ?? 'center';
      ctx.textBaseline = e.base ?? 'middle';
      const m = ctx.measureText(e.text);
      x0 = Math.min(x0, e.x - m.actualBoundingBoxLeft - 2);
      x1 = Math.max(x1, e.x + m.actualBoundingBoxRight + 2);
      y0 = Math.min(y0, e.y - m.actualBoundingBoxAscent - 2);
      y1 = Math.max(y1, e.y + m.actualBoundingBoxDescent + 2);
    }
    ctx.restore();
    return x1 > x0 ? this._designBox((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0) : null;
  }

  _designBox(x, y, w, h) {
    const m = this._matrix();
    const pts = [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]].map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // An element inside groups is only on screen while every group is.
  _attach(kind, at, out, box, extra = null) {
    for (const g of this._spans || []) {
      at = Math.max(at, g.at);
      out = Math.min(out, g.out);
    }
    if (out > at) this.engine.layoutLog.push({ kind, at, out, box, ...extra });
  }

  _fromDesign(box) {
    const inv = this._matrix().inverse();
    const c = inv.transformPoint(new DOMPoint(box.x, box.y));
    const sx = Math.hypot(inv.a, inv.b);
    const w = box.w * sx;
    const h = box.h * sx;
    return geom(c.x, c.y, w, h, box.shape);
  }

  _point(v) {
    if (typeof v === 'string') return this.get(v);
    if (Array.isArray(v)) return { x: v[0], y: v[1], w: 0, h: 0 };
    if (v && typeof v.x === 'number') return { x: v.x, y: v.y, w: v.w || 0, h: v.h || 0, shape: v.shape };
    throw new SceneError(`expected [x, y], {x, y} or an element id, got ${JSON.stringify(v)}`);
  }

  // Point on the edge of box `b` in the direction of `toward`, pushed out by gap.
  _edge(b, toward, gap) {
    const dx = toward.x - b.x;
    const dy = toward.y - b.y;
    if (!b.w && !b.h) {
      const L = Math.hypot(dx, dy) || 1;
      return { x: b.x + (dx / L) * gap, y: b.y + (dy / L) * gap };
    }
    const hw = b.w / 2 + gap;
    const hh = b.h / 2 + gap;
    if (b.shape === 'ellipse') {
      const ang = Math.atan2(dy, dx);
      return { x: b.x + Math.cos(ang) * hw, y: b.y + Math.sin(ang) * hh };
    }
    const k = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    return { x: b.x + dx * k, y: b.y + dy * k };
  }

  _logText(entry) {
    const log = this.engine.textLog;
    if (!log) return;
    const m = this._matrix();
    const pts = [[entry.x0, entry.y0], [entry.x1, entry.y0], [entry.x1, entry.y1], [entry.x0, entry.y1]].map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
    const scale = Math.hypot(m.a, m.b);
    log.push({
      scene: this.id,
      t: this.t,
      text: entry.text,
      x0: Math.min(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)),
      y1: Math.max(...pts.map((p) => p.y)),
      size: entry.size * scale,
      alpha: this.ctx.globalAlpha,
      fg: entry.fg,
      bg: entry.bg,
      block: !!entry.block,
      ui: entry.ui || 0,
      zoomed: !!entry.zoomed,
    });
  }

  // Layout problems found while drawing, reported by `check`.
  _overflow(message) {
    const log = this.engine.textLog;
    if (log) log.push({ scene: this.id, t: this.t, problem: message });
  }

  _autoTextColor(fill, fallback) {
    if (!fill || fill === 'none') return fallback;
    fill = opaque(fill, this.theme.bg);
    const light = this.theme.dark ? this.theme.ink : '#ffffff';
    const dark = this.theme.dark ? '#0b1020' : this.theme.ink;
    return contrast(fill, fallback) >= 3 ? fallback : contrast(fill, light) > contrast(fill, dark) ? light : dark;
  }

  // ---------- background and sound ----------

  bg(color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.engine.scale, 0, 0, this.engine.scale, 0, 0);
    ctx.fillStyle = colorOf(this.theme, color, 'bg');
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
  }

  sfx(name, at, o = {}) {
    if (!this.engine.sfxNames.includes(name)) throw new SceneError(`sfx "${name}" does not exist. Sounds: ${this.engine.sfxNames.join(', ')}`);
    const t = at === undefined ? this.t : this.time(at);
    const rec = this.engine.recorder;
    if (rec) rec.push({ kind: 'sfx', at: t, dur: o.dur ?? 0, sfx: name, gain: o.gain ?? 1, pitch: o.pitch, explicit: true, key: `sfx|${Math.round(t * 1000)}|${name}|${o.pitch ?? ''}` });
  }

  // ---------- camera and groups ----------

  // keys: [{ at, x, y, zoom, dur }]. Call before drawing anything else.
  camera(keys, o = {}) {
    // A scene that moves its own camera gets no automatic camera.
    if (this.engine.planning) this.engine.manualCamera = true;
    const list = [{ at: 0, x: this.cx, y: this.cy, zoom: 1, dur: 0 }, ...keys.map((k) => ({ x: this.cx, y: this.cy, zoom: 1, dur: 1.1, ...k, at: this.time(k.at ?? 0) }))].sort((a, b) => a.at - b.at);
    let cur = { ...list[0] };
    if (o.shake) this.engine.moving = true;
    for (let i = 1; i < list.length; i++) {
      const k = list[i];
      if (this.t < k.at) break;
      const prev = cur;
      const raw = (this.t - k.at) / Math.max(0.001, k.dur / this.pace);
      if (raw > 0 && raw < 1) this.engine.moving = true;
      const p = easeFn(k.ease ?? 'inOut')(clamp(raw));
      cur = { x: lerp(prev.x, k.x, p), y: lerp(prev.y, k.y, p), zoom: lerp(prev.zoom, k.zoom, p), rotate: lerp(prev.rotate || 0, k.rotate || 0, p) };
    }
    const ctx = this.ctx;
    this._camMoved = cur.zoom !== 1 || cur.x !== this.cx || cur.y !== this.cy || Boolean(cur.rotate) || Boolean(o.shake);
    ctx.translate(this.cx, this.cy);
    if (cur.rotate) ctx.rotate((cur.rotate * Math.PI) / 180);
    ctx.scale(cur.zoom, cur.zoom);
    ctx.translate(-cur.x, -cur.y);
    if (o.shake) {
      const w = this.wiggle(o.shake, 3);
      ctx.translate(w.x, w.y);
    }
    return cur;
  }

  // Draws `fn` inside a moved/scaled/rotated group that can enter and leave
  // as one piece. Times inside stay scene times.
  group(o, fn) {
    if (typeof o === 'function') [o, fn] = [{}, o];
    const life = this._life(o, 'group', { enter: o.enter ?? 'none', sfx: null, dur: o.dur });
    const planning = Boolean(this.engine.layoutLog);
    if (planning) (this._spans ??= []).push({ at: this.time(o.at ?? 0), out: o.out === undefined ? Infinity : this.time(o.out) });
    try {
      if (!life || planning) {
        if (!life) this._suppress++;
        // The camera measures what a group holds where it rests, whether it
        // is hidden, arriving or leaving at that moment.
        if (planning) {
          this.ctx.save();
          this.ctx.translate(o.x ?? 0, o.y ?? 0);
          if (o.rotate) this.ctx.rotate((o.rotate * Math.PI) / 180);
          if ((o.scale ?? 1) !== 1) this.ctx.scale(o.scale, o.scale);
        }
        try { fn(this); } finally {
          if (!life) this._suppress--;
          if (planning) this.ctx.restore();
        }
        return;
      }
      this._push(o.x ?? 0, o.y ?? 0, life, o);
      try { fn(this); } finally { this.ctx.restore(); }
    } finally {
      if (planning) this._spans.pop();
    }
  }

  // While the camera is planned, runs a custom drawing once on a context
  // that records how far its paths, shapes, text and images reach. It runs at
  // its own place, scale and rotation, without its entrance or exit.
  _measureDrawing(o, fn, life, random) {
    const ctx = this.ctx;
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? Infinity : this.time(o.out);
    ctx.save();
    ctx.translate(o.x ?? 0, o.y ?? 0);
    if (o.rotate) ctx.rotate((o.rotate * Math.PI) / 180);
    if (o.scale) ctx.scale(o.scale, o.scale);
    const rec = boundsRecorder(ctx, this.engine.scale);
    const saved = Math.random;
    Math.random = random;
    try {
      fn(rec.proxy, life ? { ...life, p: 1, q: 0 } : { p: 1, q: 0, at, dur: 0.001, enter: 'none', exit: 'fade', local: Math.max(0, this.t - at) });
    } catch {
      // drawn for real later, where its errors are reported
    } finally {
      Math.random = saved;
      ctx.restore();
    }
    const box = rec.box();
    if (box) this._attach('custom', at, out, box);
  }

  // Points the camera at an element or a region from `at` until `out`. It
  // draws nothing. target: an id drawn earlier, { x, y, w, h } (center and
  // size) or [x, y, w, h].
  focus(target, o = {}) {
    const b = typeof target === 'string' ? this.get(target) : Array.isArray(target) ? { x: target[0], y: target[1], w: target[2], h: target[3] } : target;
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.w > 0) || !(b.h > 0)) throw new SceneError('focus needs an element id, { x, y, w, h } or [x, y, w, h]');
    if (this.engine.layoutLog) this._attach('focus', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), this._designBox(b.x, b.y, b.w, b.h), { explicit: true });
  }

  // Custom drawing with the same timing rules: fn(ctx, life) where life.p is
  // the 0..1 entrance progress and ctx is already moved to x, y.
  // Math.random inside fn has its own sequence for each drawing, so its
  // numbers do not depend on which other drawings are on screen.
  draw(o, fn) {
    if (typeof o === 'function') [o, fn] = [{}, o];
    const life = this._life(o, 'custom', { enter: o.enter ?? 'none', sfx: o.sfx ?? null });
    const random = mulberry32(this._seed('random', o));
    if (this.engine.layoutLog) return this._measureDrawing(o, fn, life, random);
    if (!life) return;
    this._push(o.x ?? 0, o.y ?? 0, life, o);
    const saved = Math.random;
    Math.random = random;
    try { fn(this.ctx, life); } finally {
      Math.random = saved;
      this.ctx.restore();
    }
  }

  // ---------- text ----------

  text(str, o = {}) {
    return this._text(str, o, o.kind || 'text');
  }

  // A width of `f` times the frame, never wider than the platform safe area.
  _w(f) {
    return this.platform ? Math.min(this.W * f, this.safe.w) : this.W * f;
  }

  // A height `f` of the way down the frame (or down the safe area).
  _y(f) {
    return this.platform ? this.safe.y + this.safe.h * f : this.H * f;
  }

  title(str, o = {}) {
    return this._text(str, { font: 'display', size: 104, y: this._y(0.44), maxWidth: this._w(0.82), lineHeight: 1.12, ...o }, 'title');
  }

  subtitle(str, o = {}) {
    return this._text(str, { font: 'body', size: 46, color: 'muted', y: this._y(0.6), maxWidth: this._w(0.7), ...o }, 'text');
  }

  note(str, o = {}) {
    return this._text(str, { size: 32, color: 'muted', ...o }, 'text');
  }

  _text(str, o, kind) {
    const th = this.theme;
    const ctx = this.ctx;
    const role = o.font ?? 'body';
    if (!th.fonts[role]) throw new SceneError(`font "${role}" is not one of display, body, hand, mono`);
    const size = o.size ?? 48;
    const weight = o.weight ?? (o.bold ? BOLD[role] ?? 700 : undefined);
    const font = fontString(th, role, size, weight);
    const align = o.align ?? 'center';
    // Large text gets slightly tighter letter spacing in looks that set a
    // tracking value.
    const tracking = size >= 56 ? (th.fonts[role].tracking ?? 0) * size : 0;
    // save() and restore() put the spacing back. Reading ctx.letterSpacing
    // back is not reliable in Chrome.
    ctx.save();
    ctx.letterSpacing = `${tracking}px`;
    let lay;
    try {
      lay = layoutText(ctx, { str: String(str), font, size, maxWidth: o.maxWidth ?? o.width ?? this._w(0.8), lineHeight: o.lineHeight ?? 1.24 });
    } finally {
      ctx.restore();
    }
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const left = align === 'left' ? x : align === 'right' ? x - lay.width : x - lay.width / 2;
    const valign = o.valign ?? 'middle';
    const top = valign === 'top' ? y : valign === 'bottom' ? y - lay.height : y - lay.height / 2;
    const bx = left + lay.width / 2;
    const by = top + lay.height / 2;
    const pad = o.bg ? (o.padding ?? size * 0.45) : 0;
    const g = geom(bx, by, lay.width + pad * 2, lay.height + pad * 2);
    this._register(o.id, g.x, g.y, g.w, g.h);

    const plain = String(str).replace(/\*/g, '');
    const enter = o.enter ?? th.enter[kind] ?? 'fade';
    let dur = o.dur;
    if (dur === undefined) {
      if (enter === 'write') dur = clamp(0.35 + plain.length * 0.028, 0.5, 1.8);
      else if (enter === 'type') dur = plain.length / (o.cps ?? 28);
      else if (enter === 'words') dur = Math.max(0.4, lay.count * 0.18);
    }
    let times = null;
    // 'sync' follows the real word times; 'words' is spread over `dur`, which
    // the pace shortens like every other animation.
    if (enter === 'sync' || enter === 'words') times = this._wordTimes(lay, enter, o, enter === 'words' ? dur / this.pace : dur);
    const life = this._life({ ...o, enter }, kind, { dur: enter === 'sync' ? Math.max(0.3, (times[times.length - 1] ?? 0) - this.time(o.at ?? 0) + 0.3) : dur, real: enter === 'sync', label: plain.slice(0, 40) });
    if (!life) return g;

    this._push(bx, by, life, o);
    const color = colorOf(th, o.color, 'ink');
    const accent = colorOf(th, o.mark ?? 'accent');
    if (o.bg) {
      const bgc = colorOf(th, o.bg === true ? 'surface' : o.bg);
      this.pen.draw(ctx, { kind: 'rect', w: g.w, h: g.h, r: o.radius ?? Math.min(th.radius, g.h / 2) }, { fill: bgc, stroke: o.border ? colorOf(th, o.border) : 'none', width: 2, shadow: this._shadow(), seed: this._seed('textbg', o, plain), rough: false }, { stroke: 1, fill: 1 });
    }
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.letterSpacing = `${tracking}px`;
    const ox = -lay.width / 2;
    const oy = -lay.height / 2;
    const glow = th.stroke.glow && o.glow !== false && kind === 'title' ? th.stroke.glow : 0;

    const drawWord = (w, lx, ly, alpha = 1, dy = 0) => {
      ctx.fillStyle = w.accent ? accent : color;
      if (glow && w.accent) {
        ctx.shadowColor = withAlpha(accent, 0.55);
        ctx.shadowBlur = glow;
      }
      const prev = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prev * alpha;
      ctx.fillText(w.text, lx, ly + dy);
      ctx.globalAlpha = prev;
      ctx.shadowBlur = 0;
    };

    if (life.enter === 'write') {
      const widths = lay.lines.map((l) => l.width);
      const total = widths.reduce((a, b) => a + b, 0) || 1;
      let reveal = ease.inOutSine(life.p) * total;
      lay.lines.forEach((line) => {
        const lx0 = ox + lineStartX(line, lay.width, align);
        const show = Math.min(line.width, reveal);
        reveal -= line.width;
        if (show <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx0 - size, oy + line.y - lay.ascent - size * 0.3, show + size, lay.lineHeight + size * 0.5);
        ctx.clip();
        for (const w of line.words) drawWord(w, lx0 + w.x, oy + line.y);
        ctx.restore();
      });
    } else if (life.enter === 'type') {
      let chars = Math.floor(plain.length * clamp(life.local / Math.max(0.01, life.dur)) + 1e-6);
      lay.lines.forEach((line) => {
        const lx0 = ox + lineStartX(line, lay.width, align);
        for (const w of line.words) {
          if (chars <= 0) return;
          const part = w.text.slice(0, chars);
          drawWord({ ...w, text: part }, lx0 + w.x, oy + line.y);
          chars -= w.text.length + 1;
        }
      });
    } else if (times) {
      lay.lines.forEach((line) => {
        const lx0 = ox + lineStartX(line, lay.width, align);
        for (const w of line.words) {
          const k = clamp((this.t - times[w.index]) / (0.22 / this.pace));
          if (k <= 0) continue;
          drawWord(w, lx0 + w.x, oy + line.y, ease.out(k), (1 - ease.out(k)) * 14);
        }
      });
    } else {
      const a = life.enter === 'draw' ? this._drawProgress(life).text : 1;
      lay.lines.forEach((line) => {
        const lx0 = ox + lineStartX(line, lay.width, align);
        for (const w of line.words) drawWord(w, lx0 + w.x, oy + line.y, a);
      });
    }
    this._logText({ text: plain, x0: ox, y0: oy, x1: -ox, y1: -oy, size, fg: color, bg: o.bg ? colorOf(th, o.bg === true ? 'surface' : o.bg) : null });
    ctx.restore();
    return g;
  }

  _wordTimes(lay, enter, o, dur) {
    const at = this.time(o.at ?? 0);
    const flat = [];
    lay.lines.forEach((l) => l.words.forEach((w) => flat.push(w)));
    flat.sort((a, b) => a.index - b.index);
    if (enter === 'words') return flat.map((w, i) => at + (i * dur) / Math.max(1, flat.length));
    const norms = this.words.map((w) => normWord(w.text));
    let ptr = 0;
    while (ptr < this.words.length && this.words[ptr].start < at - 0.05) ptr++;
    let last = at;
    return flat.map((w) => {
      const n = normWord(w.text);
      for (let j = ptr; j < norms.length; j++) {
        if (norms[j] === n) {
          ptr = j + 1;
          last = Math.max(last, this.words[j].start);
          return last;
        }
      }
      last += 0.12;
      return last;
    });
  }

  math(tex, o = {}) {
    if (typeof tex !== 'string') throw new SceneError('math: use a fixed TeX string');
    if (o.display !== undefined && typeof o.display !== 'boolean') throw new SceneError('math: display must be true or false');
    if (o.align !== undefined && !['center', 'left'].includes(o.align)) throw new SceneError('math: align must be center or left');
    const data = this.engine.mathData(tex, o.display ?? true, this.id, this.t);
    if (data?.error) throw new SceneError(`math "${tex}": ${data.error}`);
    const size = o.size ?? 72;
    const unit = size / (data?.unitsPerEm ?? 1000);
    const [vx, vy, vw, vh] = data?.viewBox ?? [0, -1000, 0, 1000];
    const w = vw * unit;
    const h = vh * unit;
    const x = (o.x ?? this.cx) + (o.align === 'left' ? w / 2 : 0);
    const y = o.y ?? this.cy;
    this._register(o.id, x, y, w, h);
    const g = geom(x, y, w, h);
    const th = this.theme;
    const life = this._life(o, 'text', { enter: th.enter.shape === 'draw' ? 'draw' : th.enter.text, label: tex });
    if (!life || !data) return g;
    const ctx = this.ctx;
    const color = colorOf(th, o.color, 'ink');
    this._push(x, y, life, o);
    const draw = life.enter === 'draw' || life.enter === 'write';
    const stroke = draw ? ease.inOut(clamp(life.p / 0.78)) : 1;
    const fill = draw ? clamp((life.p - 0.78) / 0.22) : 1;
    for (const d of data.paths) {
      const path = scalePath(d, unit, -w / 2 - vx * unit, -h / 2 - vy * unit);
      this.pen.draw(ctx, { kind: 'path', d: path }, { stroke: draw && life.p < 1 ? color : 'none', width: Math.max(0.7, size / 72), fill: color, rough: false }, { stroke, fill });
    }
    this._logText({ text: tex, x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: color, bg: null });
    ctx.restore();
    return g;
  }

  // ---------- shapes ----------

  box(label, o = {}) {
    if (label && typeof label === 'object') [o, label] = [label, label.label];
    const th = this.theme;
    const ctx = this.ctx;
    const size = o.size ?? 44;
    const role = o.font ?? 'body';
    const font = fontString(th, role, size, o.weight ?? BOLD[role]);
    const pad = o.padding ?? size * 0.62;
    const maxW = o.w ? o.w - pad * 2 : o.maxWidth ?? 560;
    const lay = label !== undefined && label !== null && label !== '' ? layoutText(ctx, { str: String(label), font, size, maxWidth: maxW, lineHeight: 1.15 }) : null;
    const iconSize = o.icon ? o.iconSize ?? size * 1.55 : 0;
    const gapIL = lay && o.icon ? size * 0.35 : 0;
    const contentH = (lay ? lay.height : 0) + iconSize + gapIL;
    const w = o.w ?? Math.max(o.minW ?? 0, (lay ? lay.width : 0) + pad * 2, iconSize + pad * 2);
    const h = o.h ?? Math.max(o.minH ?? 0, contentH + pad * 1.4);
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const shape = o.shape ?? 'rect';
    this._register(o.id, x, y, w, h, shape === 'ellipse' || shape === 'circle' ? 'ellipse' : 'rect');
    // A shape without words has no detail for the camera to move in on.
    if (this.engine.layoutLog && !lay) this._pendingInfo = { bare: true };
    const g = geom(x, y, w, h);
    const plain = lay ? String(label).replace(/\*/g, '') : '';
    const life = this._life(o, 'shape', { label: plain.slice(0, 40) || o.icon });
    if (!life) return g;
    this._push(x, y, life, o);
    const prog = this._drawProgress(life);
    const stroke = colorOf(th, o.stroke ?? o.color, 'ink');
    const fill = o.fill !== undefined ? colorOf(th, o.fill) : o.color ? tintOf(th, o.color) : th.surface;
    const spec = shape === 'ellipse' || shape === 'circle' ? { kind: 'ellipse', w, h } : { kind: 'rect', w, h, r: o.radius ?? th.radius };
    this.pen.draw(ctx, spec, { stroke: o.border === false ? 'none' : stroke, width: o.width ?? th.stroke.width, fill, fillStyle: o.fillStyle, dashed: o.dashed, seed: this._seed('box', o, plain), shadow: this._shadow(), glow: o.glow ?? (th.stroke.glow && o.color ? th.stroke.glow : 0) }, prog);
    const textColor = o.textColor ? colorOf(th, o.textColor) : this._autoTextColor(fill, th.ink);
    const top = -contentH / 2;
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = prevA * prog.text;
    if (o.icon) this._iconAt(o.icon, 0, top + iconSize / 2, iconSize, colorOf(th, o.iconColor ?? o.color, 'ink'), 1, this._seed('boxicon', o, o.icon), o.iconWeight);
    if (lay) {
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      const ty = top + iconSize + gapIL;
      const accent = colorOf(th, o.mark ?? 'accent');
      for (const line of lay.lines) {
        const lx = -lay.width / 2 + (lay.width - line.width) / 2;
        for (const wd of line.words) {
          ctx.fillStyle = wd.accent ? accent : textColor;
          ctx.fillText(wd.text, lx + wd.x, ty + line.y);
        }
      }
      this._logText({ text: plain, x0: -lay.width / 2, y0: ty, x1: lay.width / 2, y1: ty + lay.height, size, fg: textColor, bg: fill });
    }
    ctx.globalAlpha = prevA;
    ctx.restore();
    return g;
  }

  circle(o = {}) {
    const r = o.r ?? 80;
    return this.box(o.label, { ...o, shape: 'ellipse', w: r * 2, h: r * 2, padding: 0 });
  }

  line(points, o = {}) {
    const th = this.theme;
    const pts = points.map((p) => this._point(p)).map((p) => [p.x, p.y]);
    const life = this._life(o, 'line', { enter: o.enter ?? 'draw' });
    if (this.engine.layoutLog) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      // A line thick enough to read as a bar is a shape the camera keeps whole.
      const thick = (o.width ?? th.stroke.width) >= 10;
      this._logLayout(thick ? 'shape' : 'line', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
    if (!life) return;
    this.ctx.save();
    const tr = this._enterTransform(life.enter === 'draw' ? { ...life, enter: 'none' } : life);
    this.ctx.globalAlpha *= tr.a * (o.opacity ?? 1);
    const prog = life.enter === 'draw' ? { stroke: ease.inOut(life.p), fill: 1 } : { stroke: 1, fill: 1 };
    this.pen.draw(this.ctx, { kind: 'poly', points: pts, close: !!o.close }, { stroke: colorOf(th, o.color, 'ink'), width: o.width ?? th.stroke.width, fill: o.fill ? colorOf(th, o.fill) : undefined, dashed: o.dashed, seed: this._seed('line', o), single: true, glow: o.glow ?? 0 }, prog);
    this.ctx.restore();
  }

  path(d, o = {}) {
    const th = this.theme;
    const life = this._life(o, 'line', { enter: o.enter ?? 'draw' });
    if (this.engine.layoutLog) {
      const pts = [];
      for (const { c, v } of absolutize(parsePath(d))) {
        if (c === 'A') pts.push([v[5], v[6]], [v[5] - v[0], v[6] - v[1]], [v[5] + v[0], v[6] + v[1]]);
        else for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      }
      if (pts.length) {
        const xs = pts.map((q) => q[0] + (o.x ?? 0));
        const ys = pts.map((q) => q[1] + (o.y ?? 0));
        // A closed or filled path is a shape; an open one is a line.
        this._logLayout(/z/i.test(d) || o.fill ? 'shape' : 'line', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      }
    }
    if (!life) return;
    this._push(o.x ?? 0, o.y ?? 0, life.enter === 'draw' ? { ...life, enter: 'none' } : life, o);
    const prog = this._drawProgress(life);
    this.pen.draw(this.ctx, { kind: 'path', d }, { stroke: colorOf(th, o.color, 'ink'), width: o.width ?? th.stroke.width, fill: o.fill ? colorOf(th, o.fill) : undefined, fillStyle: o.fillStyle, dashed: o.dashed, seed: this._seed('path', o), single: o.single ?? false, glow: o.glow ?? 0 }, prog);
    this.ctx.restore();
  }

  // from/to: [x, y], {x, y} or an element id (the arrow then stops at its edge).
  arrow(from, to, o = {}) {
    const th = this.theme;
    const A = this._point(from);
    const B = this._point(to);
    const gap = o.gap ?? 14;
    const a = typeof from === 'string' ? this._edge(A, B, gap) : A;
    const b = typeof to === 'string' ? this._edge(B, A, gap) : B;
    if (typeof from === 'string' && typeof to !== 'string') Object.assign(a, this._edge(A, b, gap));
    const bend = o.bend ?? 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const c = { x: (a.x + b.x) / 2 - dy * bend * 0.5, y: (a.y + b.y) / 2 + dx * bend * 0.5 };
    const d = bend ? quadD([a.x, a.y], [c.x, c.y], [b.x, b.y]) : polyD([[a.x, a.y], [b.x, b.y]]);
    const life = this._life(o, 'arrow', { enter: o.enter ?? 'draw', dur: o.dur ?? 0.7 });
    if (this.engine.layoutLog) {
      const xs = [a.x, b.x, c.x];
      const ys = [a.y, b.y, c.y];
      const at = this.time(o.at ?? 0);
      const out = o.out === undefined ? Infinity : this.time(o.out);
      this._logLayout('arrow', at, out, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      // The line may run off the edge of a close-up, but its label is text,
      // so the camera keeps it whole.
      if (o.label) {
        const label = this._arrowLabel(o, d, a, b, bend);
        this._attach('label', at, out, this._textExtent([{ text: String(o.label), x: label.x, y: label.y, font: label.font }]));
      }
    }
    const result = { from: a, to: b, control: c };
    if (!life) return result;
    const ctx = this.ctx;
    ctx.save();
    const tr = this._enterTransform(life.enter === 'draw' ? { ...life, enter: 'none' } : life);
    ctx.globalAlpha *= tr.a * (o.opacity ?? 1);
    const color = colorOf(th, o.color, 'ink');
    const width = o.width ?? th.stroke.width;
    const prog = life.enter === 'draw' ? ease.inOut(life.p) : 1;
    const seed = this._seed('arrow', o);
    this.pen.draw(ctx, { kind: 'path', d }, { stroke: color, width, dashed: o.dashed, seed, single: true, glow: o.glow ?? 0 }, { stroke: prog, fill: 1 });
    const head = o.head ?? 'end';
    const hs = o.headSize ?? width * 3.2 + 12;
    const L = pathLength(d);
    const drawHead = (dist, dir) => {
      const tip = pointAt(d, dist);
      const back = pointAt(d, Math.max(0, Math.min(L, dist - dir * Math.min(12, L / 3))));
      const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
      const s1 = [tip.x - hs * Math.cos(ang - 0.5), tip.y - hs * Math.sin(ang - 0.5)];
      const s2 = [tip.x - hs * Math.cos(ang + 0.5), tip.y - hs * Math.sin(ang + 0.5)];
      if (th.stroke.rough) {
        this.pen.draw(ctx, { kind: 'poly', points: [s1, [tip.x, tip.y], s2] }, { stroke: color, width, seed: seed + 7, single: true, roughness: 0.6 }, { stroke: 1, fill: 1 });
      } else {
        this.pen.draw(ctx, { kind: 'poly', points: [s1, [tip.x, tip.y], s2], close: true }, { stroke: color, width: width * 0.6, fill: color, seed, glow: o.glow ?? 0 }, { stroke: 1, fill: 1 });
      }
    };
    if (L > 1 && prog > 0.02) {
      if (head === 'end' || head === 'both') drawHead(L * prog, 1);
      if ((head === 'start' || head === 'both') && prog > 0.2) drawHead(0.001, -1);
    }
    if (o.label) {
      const la = clamp((life.p - 0.55) / 0.35);
      if (la > 0) {
        const { x: lx, y: ly, w, size: ls, font } = this._arrowLabel(o, d, a, b, bend);
        ctx.save();
        ctx.globalAlpha *= la;
        ctx.font = font;
        ctx.fillStyle = colorOf(th, o.labelColor ?? o.color, 'muted');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.label), lx, ly);
        this._logText({ text: String(o.label), x0: lx - w / 2, y0: ly - ls / 2, x1: lx + w / 2, y1: ly + ls / 2, size: ls, fg: ctx.fillStyle, bg: null });
        ctx.restore();
      }
    }
    ctx.restore();
    return result;
  }

  // Where an arrow's label goes: on the outer side of a curve, or above a
  // straight arrow. x, y is the label's center.
  _arrowLabel(o, d, a, b, bend) {
    const mid = pointAt(d, pathLength(d) / 2);
    let nx;
    let ny;
    const bx = mid.x - (a.x + b.x) / 2;
    const by = mid.y - (a.y + b.y) / 2;
    if (bend && Math.hypot(bx, by) > 1) {
      nx = bx / Math.hypot(bx, by);
      ny = by / Math.hypot(bx, by);
    } else {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      nx = -dy / len;
      ny = dx / len;
      if (ny > 0 || (ny === 0 && nx > 0)) {
        nx = -nx;
        ny = -ny;
      }
    }
    const off = o.labelOffset ?? 34;
    const size = o.labelSize ?? 34;
    const font = fontString(this.theme, o.labelFont ?? 'hand', size);
    this.ctx.save();
    this.ctx.font = font;
    const w = this.ctx.measureText(String(o.label)).width;
    this.ctx.restore();
    // Further out when the label runs along the arrow's direction.
    const extra = Math.abs(nx) * w * 0.5;
    return { x: mid.x + nx * (off + extra), y: mid.y + ny * off, w, size, font };
  }

  connect(a, b, o = {}) {
    return this.arrow(a, b, o);
  }

  // ---------- icons and images ----------

  _iconPaths(name, size) {
    const key = name + '@' + size;
    let v = this.engine.iconCache.get(key);
    if (!v) {
      const src = this.engine.icons[name];
      if (!src) throw new SceneError(`icon "${name}" does not exist. Try: ${iconSuggest(name, this.engine.icons, this.engine.iconTags).join(', ')}. Search with: explainroo icons <word>`);
      const s = size / 24;
      v = src.map((d) => scalePath(d, s, -size / 2, -size / 2));
      this.engine.iconCache.set(key, v);
    }
    return v;
  }

  _iconAt(name, x, y, size, color, stroke = 1, seed = 1, weight) {
    const paths = this._iconPaths(name, size);
    const th = this.theme;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    const w = ((weight ?? 2) * size) / 24;
    for (let i = 0; i < paths.length; i++) {
      this.pen.draw(ctx, { kind: 'path', d: paths[i] }, { stroke: color, width: w, seed: seed + i, single: true, roughness: (th.stroke.roughness ?? 0) * 0.45 }, { stroke, fill: 1 });
    }
    ctx.restore();
  }

  icon(name, o = {}) {
    const th = this.theme;
    const size = o.size ?? 120;
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const bgSize = o.bg ? size * (o.bgScale ?? 1.7) : size;
    this._register(o.id, x, y, bgSize, bgSize, o.bg === 'square' ? 'rect' : o.bg ? 'ellipse' : 'rect');
    // Nor has an icon without a label.
    if (this.engine.layoutLog && !o.label) this._pendingInfo = { bare: true };
    if (this.engine.layoutLog && o.label) {
      // The label belongs to the icon for the camera, not for arrows.
      const ls = o.labelSize ?? 36;
      this.ctx.save();
      this.ctx.font = fontString(th, o.labelFont ?? 'body', ls, BOLD[o.labelFont ?? 'body']);
      const lw = this.ctx.measureText(String(o.label)).width;
      this.ctx.restore();
      this._pendingExtra = this._elementBox(o, x, y, x, y + bgSize / 2 + ls * 0.45 + ls / 2, lw, ls * 1.1);
    }
    this._iconPaths(name, size);
    const life = this._life(o, 'icon', { label: name });
    const g = geom(x, y, bgSize, bgSize);
    if (!life) return g;
    this._push(x, y, life, o);
    const prog = this._drawProgress(life);
    const color = colorOf(th, o.color, 'ink');
    if (o.bg) {
      const bgColor = o.bg === true || o.bg === 'circle' || o.bg === 'square' ? tintOf(th, o.color ?? th.accent) : colorOf(th, o.bg);
      const spec = o.bg === 'square' ? { kind: 'rect', w: bgSize, h: bgSize, r: th.radius } : { kind: 'ellipse', w: bgSize, h: bgSize };
      this.pen.draw(this.ctx, spec, { stroke: th.stroke.rough ? color : 'none', width: th.stroke.width * 0.8, fill: bgColor, seed: this._seed('iconbg', o, name), shadow: this._shadow() }, { stroke: prog.stroke, fill: prog.fill });
    }
    this._iconAt(name, 0, 0, size, color, prog.stroke, this._seed('icon', o, name), o.weight);
    if (o.label) {
      const ls = o.labelSize ?? 36;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha *= life.enter === 'draw' ? prog.text : 1;
      ctx.font = fontString(th, o.labelFont ?? 'body', ls, BOLD[o.labelFont ?? 'body']);
      ctx.fillStyle = colorOf(th, o.labelColor, 'ink');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ly = bgSize / 2 + ls * 0.45;
      ctx.fillText(String(o.label), 0, ly);
      const w = ctx.measureText(String(o.label)).width;
      this._logText({ text: String(o.label), x0: -w / 2, y0: ly, x1: w / 2, y1: ly + ls, size: ls, fg: ctx.fillStyle, bg: null });
      ctx.restore();
    }
    this.ctx.restore();
    return g;
  }

  image(src, o = {}) {
    const img = this.engine.image(src);
    return this._picture(src, img, img.naturalWidth, img.naturalHeight, o);
  }

  clip(src, o = {}) {
    const clip = this.engine.clip(src);
    const from = o.from ?? 0;
    const speed = o.speed ?? 1;
    const volume = o.volume ?? 0;
    for (const [name, value, lo, hi] of [['from', from, 0, Infinity], ['speed', speed, 0.25, 4], ['volume', volume, 0, 1]]) {
      if (!Number.isFinite(value) || value < lo || value > hi) throw new SceneError(`clip ${name} must be ${name === 'from' ? 'a non-negative number' : `from ${lo} to ${hi}`}`);
    }
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? this.dur : Math.min(this.dur, this.time(o.out));
    const end = o.loop ? out : Math.min(out, at + Math.max(0, clip.duration - from) / speed);
    const n = this._clipSeq = (this._clipSeq || 0) + 1;
    if (this.engine.recorder) this.engine.recorder.push({ kind: 'clip', key: `clip|${at}|${o.id ?? n}|${src}`, at, end, out, from, speed, loop: !!o.loop, volume, hasAudio: clip.hasAudio, duration: clip.duration, src: clip.src, url: clipURL('audio', clip.src) });
    const frame = clipFrame(clip, this.t, { at, from, speed, loop: o.loop });
    return this._picture(src, () => frame === null ? null : this.engine.clipImage(clip, frame), clip.width, clip.height, o);
  }

  _picture(src, source, naturalWidth, naturalHeight, o) {
    const th = this.theme;
    const ratio = naturalWidth / naturalHeight;
    let w = o.w;
    let h = o.h;
    if (!w && !h) {
      w = Math.min(this._w(0.6), naturalWidth);
      h = w / ratio;
    } else if (!h) h = w / ratio;
    else if (!w) w = h * ratio;
    const frame = o.frame ?? 'none';
    if (!['none', 'browser', 'window', 'phone', 'card'].includes(frame)) throw new SceneError(`image frame must be none, browser, window, phone or card, not "${frame}"`);
    const bar = frame === 'browser' || frame === 'window' ? Math.max(34, h * 0.075) : 0;
    const cardPad = frame === 'card' ? Math.round(Math.min(w, h) * 0.035) + 8 : 0;
    const fw = frame === 'phone' ? w + 28 : w + cardPad * 2;
    const fh = frame === 'phone' ? h + 28 : h + bar + cardPad * 2;
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    this._register(o.id, x, y, fw, fh);
    const life = this._life(o, 'image', { label: src });
    const g = geom(x, y, fw, fh);
    if (!life) return g;
    this._push(x, y, life, o);
    const ctx = this.ctx;
    const r = o.radius ?? (frame === 'phone' ? 46 : th.radius);
    if (frame === 'phone') {
      this.pen.draw(ctx, { kind: 'rect', w: fw, h: fh, r: r + 10 }, { fill: '#111418', stroke: 'none', width: 0, shadow: this._shadow(undefined, { color: 'rgba(0,0,0,0.25)', blur: 30, y: 12 }), rough: false }, { stroke: 1, fill: 1 });
    } else if (bar) {
      this.pen.draw(ctx, { kind: 'rect', w: fw, h: fh, r }, { fill: th.dark ? '#1b2233' : '#ffffff', stroke: th.dark ? '#2b3550' : 'rgba(0,0,0,0.08)', width: 2, shadow: this._shadow(undefined, { color: 'rgba(0,0,0,0.18)', blur: 26, y: 10 }), rough: false }, { stroke: 1, fill: 1 });
      const dots = ['#ff5f57', '#febc2e', '#28c840'];
      dots.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(-fw / 2 + bar * 0.55 + i * bar * 0.45, -fh / 2 + bar / 2, bar * 0.13, 0, Math.PI * 2);
        ctx.fill();
      });
      if (frame === 'browser' && o.url) {
        const pw = fw * 0.5;
        this.pen.draw(ctx, { kind: 'rect', w: pw, h: bar * 0.58, r: bar * 0.29 }, { fill: th.dark ? '#111727' : '#f1f3f7', stroke: 'none', width: 0, rough: false }, { stroke: 1, fill: 1 });
        ctx.save();
        ctx.translate(0, -fh / 2 + bar / 2);
        ctx.font = fontString(th, 'body', bar * 0.34);
        ctx.fillStyle = th.dark ? '#aab4c8' : '#5b6474';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(o.url, 0, 1);
        ctx.restore();
      }
    } else if (frame === 'card') {
      this.pen.draw(ctx, { kind: 'rect', w: fw, h: fh, r: r + cardPad / 2 }, { fill: th.dark ? th.surface : '#ffffff', stroke: th.stroke.rough ? th.ink : 'none', width: th.stroke.width * 0.8, shadow: this._shadow(undefined, { color: 'rgba(0,0,0,0.16)', blur: 24, y: 8 }), seed: this._seed('card', o, src), fillStyle: 'solid' }, { stroke: 1, fill: 1 });
    } else if (o.shadow !== false && th.shadow) {
      this.pen.draw(ctx, { kind: 'rect', w, h, r }, { fill: th.surface, stroke: 'none', width: 0, shadow: this._shadow(), rough: false }, { stroke: 1, fill: 1 });
    }
    const iy = frame === 'phone' ? 0 : bar / 2;
    ctx.save();
    const clip = new Path2D();
    const ir = frame === 'phone' ? r : bar ? 0 : r;
    clip.roundRect(-w / 2, iy - h / 2, w, h, bar ? [0, 0, r, r] : ir);
    ctx.clip(clip);
    const kb = o.kenburns ? 1 + 0.08 * clamp(this.t / Math.max(1, this.dur)) : 1;
    const fit = o.fit ?? 'cover';
    let dw = w;
    let dh = h;
    if (fit === 'cover') {
      if (w / h > ratio) dh = w / ratio;
      else dw = h * ratio;
    } else if (fit === 'contain') {
      if (w / h > ratio) dw = h * ratio;
      else dh = w / ratio;
    }
    dw *= kb;
    dh *= kb;
    const img = typeof source === 'function' ? source() : source;
    if (img) ctx.drawImage(img, -dw / 2, iy - dh / 2, dw, dh);
    else {
      ctx.fillStyle = th.surface;
      ctx.fillRect(-w / 2, iy - h / 2, w, h);
    }
    ctx.restore();
    if (o.border) {
      this.pen.draw(ctx, { kind: 'rect', w, h, r }, { stroke: colorOf(th, o.border === true ? 'ink' : o.border), width: th.stroke.width, seed: this._seed('imgborder', o, src) }, { stroke: 1, fill: 1 });
    }
    ctx.restore();
    return g;
  }

  // ---------- emphasis ----------

  // type: underline | circle | box | highlight | strike | cross | bracket
  annotate(target, o = {}) {
    const th = this.theme;
    const b = this._point(target);
    const pad = o.padding ?? 14;
    const type = o.type ?? 'underline';
    const color = colorOf(th, o.color ?? 'accent');
    const w = b.w + pad * 2;
    const h = b.h + pad * 2;
    const life = this._life(o, 'annotate', { enter: 'draw', dur: o.dur ?? (type === 'circle' ? 0.8 : 0.6), label: type });
    if (!life) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    const prog = ease.inOut(life.p);
    const qa = life.q > 0 ? 1 - ease.in(life.q) : 1;
    ctx.globalAlpha *= qa;
    const width = o.width ?? th.stroke.width * 1.1;
    const seed = this._seed('annotate', o, type);
    const style = { stroke: color, width, seed, single: type !== 'circle', roughness: (th.stroke.roughness ?? 1) * 0.9 };
    switch (type) {
      case 'underline': {
        const yy = h / 2 - pad * 0.4;
        this.pen.draw(ctx, { kind: 'path', d: `M${-w / 2} ${yy}Q0 ${yy + 8} ${w / 2} ${yy - 4}` }, style, { stroke: prog, fill: 1 });
        break;
      }
      case 'circle': {
        this.pen.draw(ctx, { kind: 'ellipse', w: w * 1.12, h: h * 1.25 }, { ...style, single: false }, { stroke: prog, fill: 1 });
        break;
      }
      case 'box':
        this.pen.draw(ctx, { kind: 'rect', w, h, r: th.stroke.rough ? 0 : th.radius }, style, { stroke: prog, fill: 1 });
        break;
      case 'strike':
        this.pen.draw(ctx, { kind: 'poly', points: [[-w / 2, 4], [w / 2, -4]] }, style, { stroke: prog, fill: 1 });
        break;
      case 'cross':
        this.pen.draw(ctx, { kind: 'poly', points: [[-w / 2, -h / 2], [w / 2, h / 2]] }, style, { stroke: clamp(prog * 2), fill: 1 });
        this.pen.draw(ctx, { kind: 'poly', points: [[w / 2, -h / 2], [-w / 2, h / 2]] }, { ...style, seed: seed + 3 }, { stroke: clamp(prog * 2 - 1), fill: 1 });
        break;
      case 'bracket':
        this.pen.draw(ctx, { kind: 'poly', points: [[-w / 2 + 16, -h / 2], [-w / 2, -h / 2], [-w / 2, h / 2], [-w / 2 + 16, h / 2]] }, style, { stroke: prog, fill: 1 });
        break;
      case 'highlight': {
        ctx.globalCompositeOperation = th.dark ? 'screen' : 'multiply';
        ctx.fillStyle = withAlpha(color, th.dark ? 0.3 : 0.38);
        const hw = w * prog;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2 + h * 0.08, hw, h * 0.84, 6);
        ctx.fill();
        break;
      }
      default:
        throw new SceneError(`annotate type "${type}" is not one of underline, circle, box, highlight, strike, cross, bracket`);
    }
    ctx.restore();
  }

  // ---------- lists, numbers, charts ----------

  list(items, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const size = o.size ?? 50;
    const x = o.x ?? (this.platform ? this.safe.x + this.safe.w * 0.06 : this.W * 0.2);
    let y = o.y ?? this._y(0.3);
    const width = o.width ?? this._w(0.62);
    const gap = o.gap ?? size * 0.55;
    const bullet = o.bullet ?? 'dot';
    const indent = size * 1.25;
    const base = this.time(o.at ?? 0);
    const stagger = (o.stagger ?? 0.7) / this.pace;
    const role = o.font ?? 'body';
    const font = fontString(th, role, size, o.weight);
    const out = [];
    items.forEach((raw, i) => {
      const it = typeof raw === 'string' ? { text: raw } : raw;
      const at = it.at !== undefined ? this.time(it.at) : Array.isArray(o.at) ? this.time(o.at[i]) : base + i * stagger;
      const lay = layoutText(ctx, { str: it.text, font, size, maxWidth: width - indent, lineHeight: 1.2 });
      const cy = y + lay.height / 2;
      const color = colorOf(th, it.color ?? o.color, 'ink');
      const bcolor = colorOf(th, it.bulletColor ?? o.bulletColor ?? 'accent');
      this._record('list', at, 0.4, { sfx: o.sfx }, { pitch: i, label: it.text.slice(0, 30) });
      const bx = x + size * 0.45;
      const by = y + lay.ascent - size * 0.32;
      const life = this._life({ at, out: it.out ?? o.out, sfx: null }, 'list', { enter: 'pop', dur: 0.4 });
      if (life) {
        this._push(bx, by, life, {});
        this._bullet(it.icon ?? bullet, i, size, bcolor);
        ctx.restore();
      }
      out.push(this._text(it.text, { x: x + indent, y, valign: 'top', align: 'left', size, font: role, weight: o.weight, color: it.color ?? o.color, maxWidth: width - indent, lineHeight: 1.2, at: at + 0.12, out: it.out ?? o.out, enter: o.enter ?? th.enter.list, sfx: null, id: o.id ? `${o.id}.${i}` : undefined }, 'text'));
      y += lay.height + gap;
    });
    return out;
  }

  _bullet(kind, i, size, color) {
    const ctx = this.ctx;
    const th = this.theme;
    const r = size * 0.16;
    switch (kind) {
      case 'dot':
        this.pen.draw(ctx, { kind: 'ellipse', w: r * 2.2, h: r * 2.2 }, { fill: color, stroke: color, width: 2, seed: 11 + i, fillStyle: 'solid' }, { stroke: 1, fill: 1 });
        break;
      case 'dash':
        this.pen.draw(ctx, { kind: 'poly', points: [[-r * 1.6, 0], [r * 1.6, 0]] }, { stroke: color, width: th.stroke.width, seed: 11 + i, single: true }, { stroke: 1, fill: 1 });
        break;
      case 'number': {
        ctx.font = fontString(th, 'display', size * 0.62);
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), 0, 2);
        this.pen.draw(ctx, { kind: 'ellipse', w: size * 0.95, h: size * 0.95 }, { stroke: color, width: th.stroke.width * 0.8, seed: 21 + i }, { stroke: 1, fill: 1 });
        break;
      }
      case 'check':
        this._iconAt('check', 0, 0, size * 0.8, color, 1, 31 + i, 3);
        break;
      case 'arrow':
        this._iconAt('arrow-right', 0, 0, size * 0.8, color, 1, 41 + i, 2.6);
        break;
      default:
        this._iconAt(kind, 0, 0, size * 0.85, color, 1, 51 + i, 2.2);
    }
  }

  number(value, o = {}) {
    const th = this.theme;
    const from = o.from ?? 0;
    const dur = (o.dur ?? 1.4) / this.pace;
    const at = this.time(o.at ?? 0);
    const decimals = o.decimals ?? (Number.isInteger(value) && Number.isInteger(from) ? 0 : 1);
    const steps = Math.min(18, Math.max(4, Math.round(dur * 10)));
    for (let k = 0; k < steps; k++) {
      const tau = 1 - Math.cbrt(1 - k / steps);
      this._record('number', at + tau * dur, 0.05, { sfx: o.sfx, sfxGain: 0.8 - (0.4 * k) / steps }, { label: `${value}#${k}` });
    }
    const cp = ease.out(clamp((this.t - at) / dur));
    const v = lerp(from, value, cp);
    const fmt = (n) => {
      const s = Math.abs(n).toFixed(decimals);
      const [int, dec] = s.split('.');
      const grouped = o.group === false ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, o.separator ?? ',');
      return (n < 0 ? '-' : '') + grouped + (dec ? '.' + dec : '');
    };
    const str = `${o.prefix ?? ''}${fmt(v)}${o.suffix ?? ''}`;
    return this._text(str, { font: 'display', size: 150, color: o.color ?? 'accent', ...o, at, sfx: null, enter: o.enter ?? th.enter.number ?? 'fade', dur: o.enterDur ?? 0.4, id: o.id }, 'number');
  }

  bars(data, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const items = data.map((d, i) => (typeof d === 'number' ? { value: d } : d)).map((d, i) => ({ ...d, color: d.color ?? palette(th, i) }));
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const w = o.w ?? this._w(0.56);
    const h = o.h ?? (this.platform ? this.safe.h * 0.46 : this.H * 0.46);
    const max = o.max ?? Math.max(...items.map((d) => d.value)) * 1.12;
    const n = items.length;
    const slot = w / n;
    const bw = slot * (1 - (o.gapRatio ?? 0.36));
    const base = y + h / 2;
    const at = this.time(o.at ?? 0);
    const stagger = (o.stagger ?? 0.22) / this.pace;
    this._register(o.id, x, y, w, h);
    if (this.engine.layoutLog) {
      // The labels under the bars and the values on top count for the
      // camera, not for arrows.
      const format = o.format ?? ((v) => (Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)));
      const ls = o.labelSize ?? 34;
      const vs = o.valueSize ?? 40;
      const text = this._textExtent(items.flatMap((d, i) => {
        const cx = x - w / 2 + slot * i + slot / 2;
        const labels = d.label !== undefined ? [{ text: String(d.label), x: cx, y: base + 16, font: fontString(th, 'body', ls), base: 'top' }] : [];
        const values = o.values !== false ? [{ text: `${o.prefix ?? ''}${format(d.value)}${o.suffix ?? ''}`, x: cx, y: base - (d.value / max) * h - 12, font: fontString(th, 'display', vs), base: 'bottom' }] : [];
        return [...labels, ...values];
      }));
      // The axis reaches 20 pixels past the bars on each side.
      const axis = this._designBox(x, y, w + 40 + th.stroke.width * 2, h + th.stroke.width * 2);
      this._pendingExtra = text ? unionBox(axis, text) : axis;
    }
    // Each bar can have its own `at` (seconds, a spoken word or "#marker").
    const barAt = items.map((d, i) => (d.at !== undefined ? this.time(d.at) : at + 0.3 / this.pace + i * stagger));
    items.forEach((d, i) => this._record('chart', barAt[i], 0.8, { sfx: o.sfx }, { label: `bar${i}` }));
    const axisLife = this._life({ at, out: o.out, sfx: null }, 'chart', { enter: 'draw', dur: 0.5 });
    if (!axisLife) return geom(x, y, w, h);
    const alpha = axisLife.q > 0 ? 1 - ease.in(axisLife.q) : 1;
    ctx.save();
    ctx.globalAlpha *= alpha;
    this.pen.draw(ctx, { kind: 'poly', points: [[x - w / 2 - 20, base], [x + w / 2 + 20, base]] }, { stroke: colorOf(th, 'ink'), width: th.stroke.width, seed: this._seed('axis', o), single: true }, { stroke: ease.inOut(axisLife.p), fill: 1 });
    items.forEach((d, i) => {
      const t0 = barAt[i];
      const g = ease.out(clamp((this.t - t0) / ((o.growDur ?? 0.9) / this.pace)));
      const cx = x - w / 2 + slot * i + slot / 2;
      const bh = (d.value / max) * h;
      if (g > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - bw / 2 - 20, base - bh * g - 20, bw + 40, bh * g + 20);
        ctx.clip();
        ctx.translate(cx, base - bh / 2);
        const color = colorOf(th, d.color);
        this.pen.draw(ctx, { kind: 'rect', w: bw, h: bh, r: th.stroke.rough ? 0 : Math.min(12, bw / 4) }, { stroke: th.stroke.rough ? color : 'none', width: th.stroke.width, fill: th.dark && !th.stroke.rough ? color : th.stroke.rough ? color : color, fillStyle: o.fillStyle ?? (th.stroke.rough ? 'hachure' : 'solid'), seed: this._seed('bar', o, i) + i, glow: th.stroke.glow ? th.stroke.glow * 0.6 : 0 }, { stroke: 1, fill: 1 });
        ctx.restore();
        if (o.values !== false) {
          ctx.save();
          ctx.globalAlpha *= g;
          const vs = o.valueSize ?? 40;
          ctx.font = fontString(th, 'display', vs);
          ctx.fillStyle = colorOf(th, 'ink');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const val = (o.format ?? ((v) => (Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1))))(d.value * g);
          const txt = `${o.prefix ?? ''}${val}${o.suffix ?? ''}`;
          ctx.fillText(txt, cx, base - bh * g - 12);
          ctx.restore();
        }
      }
      if (d.label !== undefined) {
        const ls = o.labelSize ?? 34;
        ctx.save();
        ctx.globalAlpha *= clamp((this.t - at) / (0.4 / this.pace));
        ctx.font = fontString(th, 'body', ls);
        ctx.fillStyle = colorOf(th, 'muted');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(d.label), cx, base + 16);
        const lw = ctx.measureText(String(d.label)).width;
        this._logText({ text: String(d.label), x0: cx - lw / 2, y0: base + 16, x1: cx + lw / 2, y1: base + 16 + ls, size: ls, fg: ctx.fillStyle, bg: null });
        ctx.restore();
      }
    });
    ctx.restore();
    return geom(x, y, w, h);
  }

  lineChart(values, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const w = o.w ?? this._w(0.6);
    const h = o.h ?? (this.platform ? this.safe.h * 0.44 : this.H * 0.44);
    const lo = o.min ?? Math.min(0, ...values);
    const hi = o.max ?? Math.max(...values) * 1.1;
    const pts = values.map((v, i) => [x - w / 2 + (w * i) / Math.max(1, values.length - 1), y + h / 2 - ((v - lo) / (hi - lo || 1)) * h]);
    this._register(o.id, x, y, w, h);
    if (this.engine.layoutLog) {
      // The ends of the axes, the dots and the labels under the axis count
      // for the camera, not for arrows.
      const pad = 12 + th.stroke.width * 1.3;
      const around = this._designBox(x, y, w + pad * 2, h + pad * 2);
      const ls = o.labelSize ?? 30;
      const text = o.labels && this._textExtent(o.labels.slice(0, pts.length).map((l, i) => ({ text: String(l), x: pts[i][0], y: y + h / 2 + 14, font: fontString(th, 'body', ls), base: 'top' })));
      this._pendingExtra = text ? unionBox(around, text) : around;
    }
    const life = this._life(o, 'chart', { enter: 'draw', dur: o.dur ?? 1.6 });
    if (!life) return geom(x, y, w, h);
    ctx.save();
    ctx.globalAlpha *= life.q > 0 ? 1 - ease.in(life.q) : 1;
    const color = colorOf(th, o.color ?? 'accent');
    const p = ease.inOut(life.p);
    this.pen.draw(ctx, { kind: 'poly', points: [[x - w / 2, y - h / 2 - 10], [x - w / 2, y + h / 2], [x + w / 2 + 10, y + h / 2]] }, { stroke: colorOf(th, 'muted'), width: th.stroke.width * 0.7, seed: this._seed('axes', o), single: true }, { stroke: clamp(p * 3), fill: 1 });
    if (o.area !== false) {
      ctx.save();
      ctx.globalAlpha *= clamp((life.p - 0.6) / 0.4) * 0.9;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], y + h / 2);
      pts.forEach((pt) => ctx.lineTo(pt[0], pt[1]));
      ctx.lineTo(pts[pts.length - 1][0], y + h / 2);
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      gr.addColorStop(0, withAlpha(color, 0.35));
      gr.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.restore();
    }
    this.pen.draw(ctx, { kind: 'poly', points: pts }, { stroke: color, width: o.width ?? th.stroke.width * 1.3, seed: this._seed('series', o), single: true, glow: th.stroke.glow ?? 0 }, { stroke: p, fill: 1 });
    if (o.dots !== false) {
      pts.forEach((pt, i) => {
        const k = clamp((p - i / Math.max(1, pts.length - 1)) * 6);
        if (k <= 0) return;
        ctx.save();
        ctx.translate(pt[0], pt[1]);
        ctx.scale(ease.outBack(k), ease.outBack(k));
        this.pen.draw(ctx, { kind: 'ellipse', w: 18, h: 18 }, { fill: color, stroke: th.bg, width: 3, seed: i + 3, fillStyle: 'solid', rough: false }, { stroke: 1, fill: 1 });
        ctx.restore();
      });
    }
    if (o.labels) {
      ctx.font = fontString(th, 'body', o.labelSize ?? 30);
      ctx.fillStyle = colorOf(th, 'muted');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      o.labels.forEach((l, i) => {
        if (i < pts.length) ctx.fillText(String(l), pts[i][0], y + h / 2 + 14);
      });
    }
    ctx.restore();
    return geom(x, y, w, h);
  }

  pie(data, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const items = data.map((d, i) => (typeof d === 'number' ? { value: d } : d)).map((d, i) => ({ ...d, color: d.color ?? palette(th, i) }));
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const r = o.r ?? 220;
    const hole = (o.donut ?? 0) * r;
    const total = items.reduce((a, d) => a + d.value, 0) || 1;
    this._register(o.id, x, y, r * 2, r * 2, 'ellipse');
    if (this.engine.layoutLog) {
      // The outline of the slices and the labels around the pie count for
      // the camera, not for arrows.
      const ring = this._designBox(x, y, r * 2 + th.stroke.width * 4, r * 2 + th.stroke.width * 4);
      const ls = o.labelSize ?? 32;
      const lr = r + (o.labelOffset ?? 56);
      let a0 = -Math.PI / 2;
      const text = o.labels !== false && this._textExtent(items.map((d) => {
        const full = (d.value / total) * Math.PI * 2;
        const mid = a0 + full / 2;
        a0 += full;
        if (full <= 0.001) return {};
        const text = d.label !== undefined ? `${d.label} ${Math.round((d.value / total) * 100)}%` : `${Math.round((d.value / total) * 100)}%`;
        return { text, x: x + Math.cos(mid) * lr, y: y + Math.sin(mid) * lr, font: fontString(th, 'body', ls, BOLD.body), align: Math.cos(mid) > 0.2 ? 'left' : Math.cos(mid) < -0.2 ? 'right' : 'center', base: 'middle' };
      }));
      this._pendingExtra = text ? unionBox(ring, text) : ring;
    }
    const life = this._life(o, 'chart', { enter: 'grow', dur: o.dur ?? 1.2 });
    if (!life) return geom(x, y, r * 2, r * 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= life.q > 0 ? 1 - ease.in(life.q) : 1;
    const sweep = ease.inOut(life.p) * Math.PI * 2;
    let a0 = -Math.PI / 2;
    items.forEach((d, i) => {
      const full = (d.value / total) * Math.PI * 2;
      const a1 = a0 + Math.min(full, Math.max(0, sweep - (a0 + Math.PI / 2)));
      if (a1 > a0 + 0.001) {
        const color = colorOf(th, d.color);
        const dd = wedgeD(r, hole, a0, a1);
        this.pen.draw(ctx, { kind: 'path', d: dd }, { fill: color, stroke: th.stroke.rough ? color : th.bg, width: th.stroke.rough ? th.stroke.width : 4, fillStyle: o.fillStyle ?? (th.stroke.rough ? 'hachure' : 'solid'), seed: this._seed('slice', o, i) + i, rough: th.stroke.rough }, { stroke: 1, fill: 1 });
        if (o.labels !== false && a1 - a0 >= full - 0.001) {
          const mid = (a0 + a1) / 2;
          const lr = r + (o.labelOffset ?? 56);
          const ls = o.labelSize ?? 32;
          const txt = d.label !== undefined ? `${d.label} ${Math.round((d.value / total) * 100)}%` : `${Math.round((d.value / total) * 100)}%`;
          ctx.font = fontString(th, 'body', ls, BOLD.body);
          ctx.fillStyle = colorOf(th, 'ink');
          ctx.textAlign = Math.cos(mid) > 0.2 ? 'left' : Math.cos(mid) < -0.2 ? 'right' : 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, Math.cos(mid) * lr, Math.sin(mid) * lr);
        }
      }
      a0 += full;
    });
    ctx.restore();
    return geom(x, y, r * 2, r * 2);
  }

  // ---------- code and terminal ----------

  code(src, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const C = th.code;
    const size = o.size ?? 32;
    const steps = Array.isArray(src) ? resolveCodeSteps(src, o, (v) => this.time(v)) : null;
    if (steps) o = { ...o, at: o.at ?? steps[0].at };
    const morph = steps ? codeMorphState(steps, this.t, o.morphDur ?? 0.8, this.pace) : null;
    const lines = steps ? steps[morph.to].lines : String(src).replace(/\t/g, '  ').split('\n');
    const firstLines = steps ? steps[0].lines : lines;
    const lh = size * 1.5;
    const pad = size * 0.9;
    const barH = o.title === false ? 0 : size * 1.6;
    const font = fontString(th, 'mono', size);
    ctx.save();
    ctx.font = font;
    const charW = ctx.measureText('M').width;
    ctx.restore();
    const maxLines = steps ? Math.max(...steps.map((step) => step.lines.length)) : lines.length;
    const numW = o.lineNumbers === false ? 0 : charW * (String(maxLines).length + 2);
    const allLines = steps ? steps.flatMap((step) => step.lines) : lines;
    const naturalW = Math.max(...allLines.map((l) => l.length)) * charW + numW + pad * 2;
    const w = o.w ?? Math.min(this._w(0.86), naturalW);
    const h = o.h ?? (morph ? morph.lines : lines.length) * lh + pad * 1.6 + barH;
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    this._register(o.id, x, y, w, h);
    // The camera keeps the tallest step in view, not only the current one.
    if (this.engine.layoutLog && steps && !o.h) this._register(undefined, x, y, w, Math.max(...steps.map((step) => step.lines.length)) * lh + pad * 1.6 + barH);
    const at = this.time(o.at ?? 0);
    const reveal = o.reveal ?? 'type';
    const cps = (o.cps ?? 40) * this.pace;
    const chars = firstLines.reduce((a, l) => a + l.length + 1, 0);
    const typeDur = chars / cps;
    const lineDelay = (o.lineDelay ?? 0.3) / this.pace;
    const startText = at + 0.35 / this.pace;
    if (reveal === 'type') this._record('code', startText, typeDur, { sfx: o.sfx }, { label: 'typing', sustain: true });
    if (steps) steps.slice(1).forEach((step, i) => this._record('code', step.at, (o.morphDur ?? 0.8) / this.pace,
      { sfx: o.sfx === false || o.sfx === null ? false : undefined, sfxGain: 0.2 }, { sfx: 'whoosh', label: `morph${i + 2}` }));
    const life = this._life({ ...o, sfx: null }, 'code', { dur: 0.5 });
    if (this.engine.layoutLog) {
      // Highlighted lines tell the camera where to look. The window is as
      // tall as the step it shows, so each step has its own first line.
      const focusLines = (list, from, until, rows) => {
        const nums = (Array.isArray(list) ? list : list ? [list] : []).filter((n) => n >= 1 && n <= rows.length);
        if (!nums.length) return;
        const lineTop = y - (o.h ?? rows.length * lh + pad * 1.6 + barH) / 2 + barH + pad * 0.8;
        // Whole lines across, with a little of the lines around them.
        const y0 = lineTop + (Math.min(...nums) - 1) * lh - lh * 0.72;
        const y1 = lineTop + Math.max(...nums) * lh + lh * 0.28;
        const longest = Math.max(...rows.map((r) => r.length));
        const x0 = x - w / 2 + pad;
        const x1 = Math.min(x + w / 2 - pad, x0 + numW + longest * charW);
        const box = this._elementBox(o, x, y, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0);
        this._attach('focus', from, until, box);
      };
      const out = o.out === undefined ? Infinity : this.time(o.out);
      if (steps) steps.forEach((step, k) => focusLines(step.highlight, k ? step.at : this.time(o.highlightAt ?? at + 0.4 / this.pace), steps[k + 1]?.at ?? out, step.lines));
      else focusLines(o.highlight, this.time(o.highlightAt ?? at + 0.4 / this.pace), out, lines);
    }
    if (!life) return geom(x, y, w, h);
    this._push(x, y, life, o);
    this.pen.draw(ctx, { kind: 'rect', w, h, r: Math.min(th.radius, 18) }, { fill: C.bg, stroke: th.stroke.rough ? C.border : 'none', width: th.stroke.width * 0.8, seed: this._seed('codebg', o), shadow: this._shadow(undefined, { color: 'rgba(0,0,0,0.2)', blur: 24, y: 10 }), rough: th.stroke.rough, fillStyle: 'solid' }, { stroke: 1, fill: 1 });
    const left = -w / 2 + pad;
    const top = -h / 2 + barH + pad * 0.8;
    if (barH) {
      ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(-w / 2 + pad * 0.8 + i * size * 0.8, -h / 2 + barH / 2 + 4, size * 0.2, 0, Math.PI * 2);
        ctx.fill();
      });
      if (o.title) {
        ctx.font = fontString(th, 'mono', size * 0.72);
        ctx.fillStyle = C.comment;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.title), 0, -h / 2 + barH / 2 + 4);
      }
    }
    if (steps && morph.to) {
      const drawHighlight = (step, alpha) => {
        const hl = Array.isArray(step.highlight) ? step.highlight : step.highlight ? [step.highlight] : [];
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = C.highlight;
        for (const n of hl) ctx.fillRect(-w / 2 + 6, top + (n - 1) * lh - lh * 0.22, w - 12, lh);
        ctx.restore();
      };
      drawHighlight(steps[morph.from], 1 - morph.p);
      drawHighlight(steps[morph.to], morph.p);
    } else if (steps ? steps[0].highlight : o.highlight) {
      const highlight = steps ? steps[0].highlight : o.highlight;
      const hl = Array.isArray(highlight) ? highlight : [highlight];
      const ha = clamp((this.t - this.time(o.highlightAt ?? at + 0.4 / this.pace)) / (0.4 / this.pace));
      if (ha > 0) {
        ctx.save();
        ctx.globalAlpha *= ha;
        ctx.fillStyle = C.highlight;
        for (const n of hl) ctx.fillRect(-w / 2 + 6, top + (n - 1) * lh - lh * 0.22, w - 12, lh);
        ctx.restore();
      }
    }
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const room = w / 2 - pad * 0.5 - (left + numW);
    (steps || [{ lines }]).forEach((step, n) => step.lines.forEach((line, i) => {
      if (ctx.measureText(line).width > room) this._overflow(`code ${steps ? `step ${n + 1} ` : ''}line ${i + 1} ("${line.trim().slice(0, 40)}") is wider than its window; shorten it, lower size or raise w`);
    }));
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    if (steps && morph.to && morph.p < 1) {
      const position = (tok, step) => ({ x: left + numW + ctx.measureText(step.lines[tok.row].slice(0, tok.column)).width, y: top + tok.row * lh });
      const drawToken = (tok, pos, alpha) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = C[tok.type] ?? C.fg;
        ctx.fillText(tok.text, pos.x, pos.y);
        ctx.restore();
      };
      const before = codeTokens(steps[morph.from].lines, o.lang ?? 'js');
      const after = codeTokens(lines, o.lang ?? 'js');
      const pairs = matchTokens(before, after);
      const keptBefore = new Set(pairs.map(([a]) => a));
      const keptAfter = new Set(pairs.map(([, b]) => b));
      for (const [a, b] of pairs) {
        const start = position(before[a], steps[morph.from]);
        const end = position(after[b], steps[morph.to]);
        drawToken(after[b], { x: lerp(start.x, end.x, morph.p), y: lerp(start.y, end.y, morph.p) }, 1);
      }
      before.forEach((tok, i) => { if (!keptBefore.has(i)) drawToken(tok, position(tok, steps[morph.from]), morph.removed); });
      after.forEach((tok, i) => { if (!keptAfter.has(i)) drawToken(tok, position(tok, steps[morph.to]), morph.added); });
      if (numW) {
        ctx.fillStyle = C.lineNo;
        ctx.textAlign = 'right';
        const oldCount = steps[morph.from].lines.length;
        for (let i = 0; i < Math.max(oldCount, lines.length); i++) {
          ctx.save();
          ctx.globalAlpha *= i < Math.min(oldCount, lines.length) ? 1 : i < oldCount ? morph.removed : morph.added;
          ctx.fillText(String(i + 1), left + numW - charW * 1.4, top + i * lh);
          ctx.restore();
        }
        ctx.textAlign = 'left';
      }
    } else {
      const activeReveal = morph?.to ? 'none' : reveal;
      let budget = activeReveal === 'type' ? Math.floor((this.t - startText) * cps) : Infinity;
      lines.forEach((line, i) => {
        if (activeReveal === 'lines' && this.t < startText + i * lineDelay) return;
        if (budget <= 0 && activeReveal === 'type') return;
        const ly = top + i * lh;
        if (numW) {
          ctx.fillStyle = C.lineNo;
          ctx.textAlign = 'right';
          ctx.fillText(String(i + 1), left + numW - charW * 1.4, ly);
          ctx.textAlign = 'left';
        }
        let cx = left + numW;
        for (const tok of highlightLine(line, o.lang ?? 'js')) {
          let txt = tok.text;
          if (activeReveal === 'type') {
            if (budget <= 0) break;
            txt = txt.slice(0, budget);
            budget -= txt.length;
          }
          ctx.fillStyle = C[tok.type] ?? C.fg;
          ctx.fillText(txt, cx, ly);
          cx += ctx.measureText(txt).width;
        }
        if (activeReveal === 'type') budget -= 1;
      });
    }
    ctx.restore();
    this._logText({ text: 'code', x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: C.fg, bg: C.bg, block: true });
    ctx.restore();
    return geom(x, y, w, h);
  }

  // lines: "$ command" or plain output strings, or { cmd, at } / { out, at, color }.
  terminal(lines, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const T = th.terminal;
    const size = o.size ?? 32;
    const lh = size * 1.55;
    const pad = size * 0.9;
    const barH = size * 1.5;
    const items = lines.map((l) => (typeof l === 'string' ? (l.startsWith('$ ') ? { cmd: l.slice(2) } : { out: l }) : l));
    const w = o.w ?? this._w(0.62);
    const rows = items.reduce((n, it) => n + String(it.cmd ?? it.out ?? '').split('\n').length, 0);
    const h = o.h ?? Math.max(rows, o.rows ?? 0) * lh + barH + pad * 1.6;
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    this._register(o.id, x, y, w, h);
    const at = this.time(o.at ?? 0);
    const cps = (o.cps ?? 22) * this.pace;
    let clock = at + 0.5 / this.pace;
    const timed = items.map((it) => {
      const r = { ...it };
      if (it.at !== undefined) clock = this.time(it.at);
      r.start = clock;
      if (it.cmd !== undefined) {
        r.end = r.start + String(it.cmd).length / cps;
        clock = r.end + (o.outputDelay ?? 0.35) / this.pace;
        this._record('terminal', r.start, r.end - r.start, { sfx: o.sfx }, { label: String(it.cmd).slice(0, 20), sustain: true });
      } else {
        r.end = r.start;
        clock = r.start + (o.lineGap ?? 0.25) / this.pace;
      }
      return r;
    });
    const life = this._life({ ...o, sfx: null }, 'terminal', { dur: 0.5, enter: o.enter ?? (th.enter.code === 'rise' ? 'rise' : 'fade') });
    if (this.engine.layoutLog) {
      // Each command with its output is a focus point while it is the
      // newest thing in the terminal.
      const out = o.out === undefined ? Infinity : this.time(o.out);
      const lineTop = y - h / 2 + barH + pad * 0.8;
      let row = 0;
      const blocks = [];
      for (const it of timed) {
        const n = String(it.cmd ?? it.out ?? '').split('\n').length;
        if (it.cmd !== undefined) blocks.push({ at: it.start, from: row, to: row + n });
        else if (blocks.length) blocks[blocks.length - 1].to = row + n;
        row += n;
      }
      if (blocks.length > 1) blocks.forEach((b, i) => {
        const y0 = lineTop + b.from * lh - lh * 0.45;
        const y1 = lineTop + b.to * lh - lh * 0.1;
        this._attach('focus', b.at, blocks[i + 1]?.at ?? out, this._elementBox(o, x, y, x, (y0 + y1) / 2, w - pad * 2, y1 - y0));
      });
    }
    if (!life) return geom(x, y, w, h);
    this._push(x, y, life, o);
    this.pen.draw(ctx, { kind: 'rect', w, h, r: Math.min(th.radius, 16) }, { fill: T.bg, stroke: th.stroke.rough ? th.ink : 'none', width: th.stroke.width * 0.8, seed: this._seed('termbg', o), shadow: this._shadow(undefined, { color: 'rgba(0,0,0,0.22)', blur: 26, y: 10 }), rough: th.stroke.rough, fillStyle: 'solid' }, { stroke: 1, fill: 1 });
    ctx.save();
    const clip = new Path2D();
    clip.roundRect(-w / 2, -h / 2, w, barH, [Math.min(th.radius, 16), Math.min(th.radius, 16), 0, 0]);
    ctx.fillStyle = T.bar;
    ctx.fill(clip);
    ctx.restore();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(-w / 2 + pad * 0.8 + i * size * 0.8, -h / 2 + barH / 2, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = fontString(th, 'mono', size * 0.7);
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.title ?? 'terminal', 0, -h / 2 + barH / 2);
    ctx.font = fontString(th, 'mono', size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const left = -w / 2 + pad;
    const promptW = ctx.measureText((o.prompt ?? '$') + ' ').width;
    for (const it of timed) {
      for (const part of String(it.cmd ?? it.out ?? '').split('\n')) {
        const width = ctx.measureText(part).width + (it.cmd !== undefined ? promptW : 0);
        if (width > w - pad * 2) this._overflow(`terminal line "${part.slice(0, 40)}" is wider than the terminal; shorten it, lower size or raise w`);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    let row = 0;
    const top = -h / 2 + barH + pad * 0.8;
    let cursor = null;
    for (const it of timed) {
      if (this.t < it.start) break;
      if (it.cmd !== undefined) {
        const n = Math.floor((this.t - it.start) * cps);
        const txt = String(it.cmd).slice(0, n);
        ctx.fillStyle = T.prompt;
        ctx.fillText(o.prompt ?? '$', left, top + row * lh);
        const pw = ctx.measureText((o.prompt ?? '$') + ' ').width;
        ctx.fillStyle = T.fg;
        ctx.fillText(txt, left + pw, top + row * lh);
        cursor = { x: left + pw + ctx.measureText(txt).width, y: top + row * lh, typing: this.t < it.end };
        row++;
      } else {
        for (const part of String(it.out).split('\n')) {
          ctx.fillStyle = it.color ? colorOf(th, it.color) : T.fg;
          ctx.fillText(part, left, top + row * lh);
          row++;
        }
        cursor = { x: left, y: top + row * lh, typing: false };
      }
    }
    if (cursor && (cursor.typing || Math.floor(this.T * 2) % 2 === 0)) {
      ctx.fillStyle = T.fg;
      ctx.globalAlpha *= 0.85;
      ctx.fillRect(cursor.x + 4, cursor.y + size * 0.08, size * 0.55, size * 1.05);
    }
    ctx.restore();
    this._logText({ text: 'terminal', x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: T.fg, bg: T.bg, block: true });
    ctx.restore();
    return geom(x, y, w, h);
  }

  // ---------- celebration ----------

  burst(o = {}) {
    const th = this.theme;
    const at = this.time(o.at ?? 0);
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    this._record('burst', at, 0.6, o);
    // Particle physics run on pace-scaled time, so a faster video bursts faster.
    const k = (this.t - at) * this.pace;
    if (k < 0 || k > (o.life ?? 2.2)) return;
    const ctx = this.ctx;
    const count = o.count ?? 42;
    const colors = (o.colors ?? ['accent', 'yellow', 'blue', 'green', 'pink', 'purple']).map((c) => colorOf(th, c));
    const rand = mulberry32(hashStr(`${this.id}:burst:${at}`));
    ctx.save();
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.35 * (o.spread ?? 1);
      const sp = (o.power ?? 1000) * (0.45 + rand() * 0.65);
      const px = x + Math.cos(ang) * sp * k;
      const py = y + Math.sin(ang) * sp * k + 0.5 * 1500 * k * k;
      const rot = rand() * 6 + k * (rand() - 0.5) * 14;
      const s = (o.size ?? 14) * (0.6 + rand() * 0.8);
      ctx.globalAlpha = clamp(1 - (k - 1.1) / 1.0);
      ctx.fillStyle = colors[i % colors.length];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      ctx.restore();
    }
    ctx.restore();
  }
}

// Suggestions for a misspelled or renamed icon: names sharing its parts in any
// order ("help-circle" -> "circle-help"), then tag matches, then close spellings.
function iconSuggest(name, icons, tags = {}) {
  const parts = String(name).toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const names = Object.keys(icons);
  const score = (n) => {
    const np = n.split('-');
    let sc = 0;
    for (const p of parts) {
      if (np.includes(p)) sc += 3;
      else if (n.includes(p)) sc += 1;
      if ((tags[n] || []).some((t) => t === p || t === parts.join(' '))) sc += 2;
    }
    return sc - np.length * 0.1;
  };
  const ranked = names.map((n) => ({ n, sc: score(n) })).filter((x) => x.sc > 0.5).sort((a, b) => b.sc - a.sc).slice(0, 8).map((x) => x.n);
  return ranked.length ? ranked : suggest(name, names, 8);
}

function geom(x, y, w, h, shape = 'rect') {
  return { x, y, w, h, shape, left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

function palette(th, i) {
  const order = [th.accent, 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink', 'red'];
  const uniq = [...new Set(order)];
  return uniq[i % uniq.length];
}

function wedgeD(r, hole, a0, a1) {
  const f = (n) => Math.round(n * 100) / 100;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${f(Math.cos(a) * rad)} ${f(Math.sin(a) * rad)}`;
  if (a1 - a0 >= Math.PI * 2 - 0.001) a1 = a0 + Math.PI * 2 - 0.001;
  if (!hole) return `M0 0L${p(r, a0)}A${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)}Z`;
  return `M${p(r, a0)}A${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)}L${p(hole, a1)}A${f(hole)} ${f(hole)} 0 ${large} 0 ${p(hole, a0)}Z`;
}

export { mixColor };

// A drawing context that remembers the box everything drawn on it covers,
// in design pixels. Each fill, stroke, text or image counts on its own, and
// one that covers most of the frame is a background and does not count.
// Path2D objects cannot be looked into and are skipped.
export function boundsRecorder(ctx, scale, frame = null) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let path = null;
  const point = (x, y) => {
    const m = ctx.getTransform();
    return [(m.a * x + m.c * y + m.e) / scale, (m.b * x + m.d * y + m.f) / scale];
  };
  const grow = (b, x, y) => {
    const [px, py] = point(x, y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    b.x0 = Math.min(b.x0, px);
    b.y0 = Math.min(b.y0, py);
    b.x1 = Math.max(b.x1, px);
    b.y1 = Math.max(b.y1, py);
  };
  const empty = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  let paused = 0;
  const commit = (b) => {
    if (paused || !b || !(b.x1 >= b.x0) || !(b.y1 >= b.y0)) return;
    if (frame && (b.x1 - b.x0) * (b.y1 - b.y0) > frame.W * frame.H * 0.6) return;
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  };
  // How far a stroke reaches past its outline: half the line width in the
  // drawing's own units, through the full transform.
  const widen = (b) => {
    const m = ctx.getTransform();
    const r = ctx.lineWidth / 2 / scale;
    const kx = r * Math.hypot(m.a, m.c);
    const ky = r * Math.hypot(m.b, m.d);
    return { x0: b.x0 - kx, y0: b.y0 - ky, x1: b.x1 + kx, y1: b.y1 + ky };
  };
  const onPath = (fn) => (...a) => {
    path ??= empty();
    fn(path, ...a);
  };
  // For strokes: the segments of each subpath of the current path, so
  // sharp corners and square ends can be measured. A segment keeps its
  // ends and the control points that give its direction there.
  let subs = [];
  let sub = null;
  const dir = (p, q) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const L = Math.hypot(dx, dy);
    return L > 1e-9 ? [dx / L, dy / L] : null;
  };
  const begin = (p) => {
    sub = { first: p, last: p, segs: [], closed: false };
    subs.push(sub);
  };
  // A segment from the current point to `end`; `a` and `b` are its first
  // and last control points. Without a current point a path starts at `a`.
  const segment = (a, b, end) => {
    if (!sub) begin(a);
    const p0 = sub.last;
    if (dir(p0, a) || dir(p0, b) || dir(p0, end)) sub.segs.push({ p0, a, b, p1: end });
    sub.last = end;
  };
  const close = () => {
    if (!sub) return;
    segment(sub.first, sub.first, sub.first);
    sub.closed = true;
    begin(sub.first);
  };
  const line = (x, y) => {
    const p = point(x, y);
    segment(p, p, p);
  };
  // An arc as one segment, with its direction at both ends. Canvas draws a
  // straight line to the arc's start first.
  const arcSegment = (cx, cy, rx, ry, rot, a0, a1, ccw) => {
    const full = ccw ? a0 - a1 >= Math.PI * 2 : a1 - a0 >= Math.PI * 2;
    const end = full ? a0 : a1;
    const sign = ccw ? -1 : 1;
    const turn = (x, y) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
    const at = (t) => { const [x, y] = turn(rx * Math.cos(t), ry * Math.sin(t)); return [cx + x, cy + y]; };
    const tangent = (t) => turn(-rx * Math.sin(t) * sign, ry * Math.cos(t) * sign);
    const s0 = at(a0);
    const s1 = at(end);
    const t0 = tangent(a0);
    const t1 = tangent(end);
    line(s0[0], s0[1]);
    segment(point(s0[0] + t0[0], s0[1] + t0[1]), point(s1[0] - t1[0], s1[1] - t1[1]), point(s1[0], s1[1]));
  };
  // Turns a point from `point` back into the current transform's units.
  const toLocal = () => {
    const inv = ctx.getTransform().inverse();
    if (![inv.a, inv.b, inv.c, inv.d, inv.e, inv.f].every(Number.isFinite)) return null;
    return (p) => {
      const q = inv.transformPoint(new DOMPoint(p[0] * scale, p[1] * scale));
      return [q.x, q.y];
    };
  };
  // Works out the corners and ends of a stroke in the current transform's
  // units, where the line width applies, and adds them to the box.
  const strokeEnds = (b) => {
    const local = toLocal();
    if (!local) return b;
    const hw = ctx.lineWidth / 2;
    const miter = ctx.lineJoin === 'miter' ? ctx.miterLimit : 0;
    // A mitered corner sticks out along the line that splits the corner in
    // half. Canvas cuts it off when the corner is sharper than the miter
    // limit allows.
    const join = (u, v, p) => {
      const sinHalf = Math.sqrt(Math.max(0, (1 + u[0] * v[0] + u[1] * v[1]) / 2));
      const ox = u[0] - v[0];
      const oy = u[1] - v[1];
      const L = Math.hypot(ox, oy);
      if (sinHalf < 1e-6 || 1 / sinHalf > miter || L < 1e-9) return;
      grow(b, p[0] + (ox / L) * (hw / sinHalf), p[1] + (oy / L) * (hw / sinHalf));
    };
    const cap = (p, d) => {
      grow(b, p[0] + (d[0] - d[1]) * hw, p[1] + (d[1] + d[0]) * hw);
      grow(b, p[0] + (d[0] + d[1]) * hw, p[1] + (d[1] - d[0]) * hw);
    };
    for (const sp of subs) {
      const segs = sp.segs.map((g) => {
        const [p0, a, c, p1] = [g.p0, g.a, g.b, g.p1].map(local);
        return { p0, p1, d0: dir(p0, a) ?? dir(p0, c) ?? dir(p0, p1), d1: dir(c, p1) ?? dir(a, p1) ?? dir(p0, p1) };
      }).filter((g) => g.d0 && g.d1);
      const n = segs.length;
      if (!n) continue;
      if (miter) {
        for (let i = 1; i < n; i++) join(segs[i - 1].d1, segs[i].d0, segs[i].p0);
        if (sp.closed) join(segs[n - 1].d1, segs[0].d0, segs[0].p0);
      }
      if (ctx.lineCap === 'square' && !sp.closed) {
        cap(segs[0].p0, [-segs[0].d0[0], -segs[0].d0[1]]);
        cap(segs[n - 1].p1, segs[n - 1].d1);
      }
    }
    return b;
  };
  const corners = (b, x, y, w, h) => {
    grow(b, x, y);
    grow(b, x + w, y);
    grow(b, x, y + h);
    grow(b, x + w, y + h);
  };
  const shape = (x, y, w, h) => {
    const b = empty();
    corners(b, x, y, w, h);
    commit(b);
  };
  const text = (str, x, y, stroked = false) => {
    const m = ctx.measureText(String(str));
    const l = m.actualBoundingBoxLeft || 0;
    const a = m.actualBoundingBoxAscent || 0;
    const b = empty();
    corners(b, x - l, y - a, l + (m.actualBoundingBoxRight || m.width), a + (m.actualBoundingBoxDescent || 0));
    commit(stroked ? widen(b) : b);
  };
  const record = {
    beginPath: () => {
      path = null;
      subs = [];
      sub = null;
    },
    moveTo: onPath((b, x, y) => { grow(b, x, y); begin(point(x, y)); }),
    lineTo: onPath((b, x, y) => { grow(b, x, y); line(x, y); }),
    quadraticCurveTo: onPath((b, cx, cy, x, y) => { grow(b, cx, cy); grow(b, x, y); const c = point(cx, cy); segment(c, c, point(x, y)); }),
    bezierCurveTo: onPath((b, a, c, d, e, x, y) => { grow(b, a, c); grow(b, d, e); grow(b, x, y); segment(point(a, c), point(d, e), point(x, y)); }),
    // A line toward the corner (x1, y1) that turns along a circle onto the
    // line toward (x2, y2), as canvas draws it.
    arcTo: onPath((b, x1, y1, x2, y2, r) => {
      grow(b, x1, y1);
      grow(b, x2, y2);
      const local = toLocal();
      if (!sub || !local) return line(x1, y1);
      const p0 = local(sub.last);
      const u = dir([x1, y1], p0);
      const v = dir([x1, y1], [x2, y2]);
      const sin = u && v ? Math.abs(u[0] * v[1] - u[1] * v[0]) : 0;
      if (!(r > 0) || sin < 1e-9) return line(x1, y1);
      const d = r / Math.tan(Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1)) / 2);
      const t1 = [x1 + u[0] * d, y1 + u[1] * d];
      const t2 = [x1 + v[0] * d, y1 + v[1] * d];
      grow(b, t1[0], t1[1]);
      grow(b, t2[0], t2[1]);
      line(t1[0], t1[1]);
      segment(point(x1, y1), point(x1, y1), point(t2[0], t2[1]));
    }),
    arc: onPath((b, x, y, r, a0, a1, ccw = false) => { corners(b, x - r, y - r, r * 2, r * 2); arcSegment(x, y, r, r, 0, a0, a1, ccw); }),
    ellipse: onPath((b, x, y, rx, ry, rot, a0, a1, ccw = false) => { const r = Math.max(rx, ry); corners(b, x - r, y - r, r * 2, r * 2); arcSegment(x, y, rx, ry, rot, a0, a1, ccw); }),
    // A rectangle is a closed path of its own, and the next one starts at
    // its first corner.
    rect: onPath((b, x, y, w, h) => {
      corners(b, x, y, w, h);
      begin(point(x, y));
      line(x + w, y);
      line(x + w, y + h);
      line(x, y + h);
      close();
    }),
    roundRect: onPath((b, x, y, w, h) => { corners(b, x, y, w, h); begin(point(x, y)); }),
    closePath: close,
    fill: (p) => { if (!(p instanceof Path2D)) commit(path); },
    stroke: (p) => { if (!(p instanceof Path2D) && path) commit(strokeEnds(widen(path))); },
    fillRect: shape,
    // Mitered corners reach half the line width out on both sides; round
    // and bevelled ones no further than the widened outline.
    strokeRect: (x, y, w, h) => {
      const b = empty();
      const hw = ctx.lineWidth / 2;
      if (ctx.lineJoin === 'miter') {
        corners(b, Math.min(x, x + w) - hw, Math.min(y, y + h) - hw, Math.abs(w) + hw * 2, Math.abs(h) + hw * 2);
        commit(b);
      } else {
        corners(b, x, y, w, h);
        commit(widen(b));
      }
    },
    fillText: (str, x, y) => text(str, x, y),
    strokeText: (str, x, y) => text(str, x, y, true),
    drawImage: (img, ...a) => {
      if (a.length === 2) shape(a[0], a[1], img.width, img.height);
      else if (a.length === 4) shape(a[0], a[1], a[2], a[3]);
      else if (a.length === 8) shape(a[4], a[5], a[6], a[7]);
    },
  };
  // Parts that report their own place and time (UI panels, headlines) and
  // decoration (floating cards) are left out.
  const pause = (on) => { paused += on ? 1 : -1; };
  const proxy = new Proxy(ctx, {
    get(target, prop) {
      if (prop === '__inkPause') return pause;
      const v = target[prop];
      if (typeof v !== 'function') return v;
      const note = record[prop];
      return note ? (...args) => { note(...args); return v.apply(target, args); } : v.bind(target);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return { proxy, box: () => (x1 >= x0 && y1 >= y0 && (x1 > x0 || y1 > y0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 } : null) };
}

function unionBox(a, b) {
  const x0 = Math.min(a.x - a.w / 2, b.x - b.w / 2);
  const y0 = Math.min(a.y - a.h / 2, b.y - b.h / 2);
  const x1 = Math.max(a.x + a.w / 2, b.x + b.w / 2);
  const y1 = Math.max(a.y + a.h / 2, b.y + b.h / 2);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
