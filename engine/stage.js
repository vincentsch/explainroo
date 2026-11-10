// The scene API. Every scene function receives a Stage `s` for one frame and
// draws the whole frame from scratch as a function of the scene time `s.t`.
// Elements take `at` (when they appear) and optional `out` (when they leave);
// the theme decides how they enter, and entering elements add sound effects.
import { clamp, lerp, ease, easeFn, rand01, noise1, hashStr, mulberry32, suggest, normWord, withAlpha, contrast, mixColor, opaque, newDefaults, ordinal, LOCALES } from './util.js';
import { colorOf, tintOf, fontString } from './themes.js';
import { scalePath, quadD, polyD, pathLength, pointAt, parsePath, absolutize, samplePath } from './pathdata.js';
import { layoutText, lineStartX } from './text.js';
import { clipFrame, clipURL, soundURL, FIT_SPEEDS } from './clips.js';
import { cuedSteps, smallRecording, smallPageText, talkZoomed, movingSteps, recordingClock, videoTime, sceneTime, cursorAt, viewAt, drawCursor, RING_SECONDS } from './recording.js';
import { highlightLine, codeTokens, matchTokens, resolveCodeSteps, codeMorphState } from './code.js';
import { ring, bounds, along, rayThrough } from './geometry.js';
import { kitWord } from './words.js';

// The size of body text, which s.text uses unless told otherwise, and arrow
// labels with "defaults": "0.5".
export const TEXT_SIZE = 48;
// The size of an arrow's label, and its distance from the arrow, without it.
const OLD_LABEL_SIZE = 34;
// The sizes of text with "defaults": "0.6", one scale from the title down to
// the labels of a chart: a card's words are smaller than body text, and the
// label of an arrow or an icon smaller than a card's.
export const SCALE = { title: 104, subtitle: 46, body: TEXT_SIZE, card: 44, label: 40, axis: 36, note: 34, value: 48 };
const DEFAULT_DUR = { draw: 0.9, write: 0.8, pop: 0.6, rise: 0.75, fade: 0.6, zoom: 0.75, drop: 0.75, grow: 1.0, none: 0.001, 'slide-left': 0.75, 'slide-right': 0.75, 'slide-up': 0.75, 'slide-down': 0.75 };
const ENTERS = ['draw', 'write', 'type', 'words', 'sync', 'pop', 'rise', 'fade', 'zoom', 'drop', 'grow', 'none', 'slide-left', 'slide-right', 'slide-up', 'slide-down'];
const EXITS = ['fade', 'pop', 'rise', 'drop', 'slide-left', 'slide-right', 'none'];
const BOLD = { display: undefined, body: 600, hand: undefined, mono: 700 };
// labelSide of an arrow: the direction from the arrow's middle to its label.
const LABEL_SIDES = { left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1] };
// Entrances that show an element bit by bit, so a frame in the middle looks unfinished.
const DRAWN_IN = new Set(['draw', 'write', 'type', 'words', 'sync', 'grow']);

// The elided articles and pronouns of French, like "l'" or "qu'", and of Italian,
// like "un'" or "dell'", that a cue may leave out.
const ELIDED = /^(?:qu|dell|un|[cdjlmnst])['’]/i;

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
    // The whole frame, for pictures and backgrounds that may fill it. On
    // Shorts, TikTok and Reels with "defaults": "0.6", check lets pictures run
    // into the parts the app covers; text stays in s.safe.
    this.full = { x: 0, y: 0, w: this.W, h: this.H, left: 0, top: 0, right: this.W, bottom: this.H };
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
    // Elements are always called, so the n-th text of a scene is the same text
    // at every moment. check tells texts without an id apart by it.
    this._texts = 0;
    this._suppress = 0;
    this._camMoved = false;
    // For check: groups and kit parts that are still arriving or leaving, the
    // groups being drawn (outermost first) and the arrows drawn so far.
    this._unsettled = 0;
    this._groups = [];
    this._groupCalls = 0;
    this._arrowCalls = 0;
    this._shapeCalls = 0;
    this._revealCalls = 0;
    // How many times each call has run in this scene, so check can name an
    // element without an id as "the 2nd s.draw".
    this._calls = Object.create(null);
    this._cover = 0;
    // s.quiet() turns off the entrance sounds of the rest of the scene.
    this._quiet = false;
    // The defaults of 0.6, which "defaults": "0.6" in video.json asks for.
    this._v6 = newDefaults(engine.config, '0.6');
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

  // The short-video kit (engine/short.js): a hook title for the first frame, a
  // sticker, a step pill, a payoff card, a flash and keys for camera punch-ins.
  get short() {
    if (!this._short) {
      if (!Stage.Short) throw new SceneError('the short-video kit is not loaded');
      this._short = new Stage.Short(this);
    }
    return this._short;
  }

  // Draws fn once the scene function has finished, in design pixels without the
  // camera, so an overlay such as a flash covers everything. A hidden group
  // queues nothing.
  _post(fn) {
    if (this._suppress > 0) return;
    (this._posts ??= []).push(fn);
  }

  // ---------- language ----------

  // The language of the version being drawn, like "en" or "es".
  get lang() {
    return this.engine.config.language || 'en';
  }

  // On-screen text in that language, from strings.json for the main language or
  // strings.<lang>.json for another one. A text or a list of texts.
  str(key) {
    const text = this.engine.state?.text;
    const file = text?.files?.strings ?? 'strings.json';
    const all = text?.strings;
    if (!all) throw new SceneError(`s.str("${key}"): there is no ${file}. Put the on-screen text of this language there, like { "${key}": "..." }`);
    if (Object.hasOwn(all, key)) return all[key];
    const close = suggest(String(key), Object.keys(all), 4);
    throw new SceneError(`s.str("${key}"): ${file} has no "${key}".${close.length ? ` Close keys: ${close.join(', ')}` : ''}`);
  }

  // A word that the kits and the formats draw when a scene gives none, like
  // "Paso" for "step" in Spanish, in the language of the version being drawn.
  kitWord(key) {
    try {
      return kitWord(key, this.lang);
    } catch (e) {
      throw new SceneError(e.message);
    }
  }

  // ---------- time ----------

  // Start time of the n-th time a word or phrase is spoken in this scene. n is 1
  // unless it is given, here or as "word#n".
  cue(word, n) {
    return this._cue(word, n).start;
  }

  cueEnd(word, n) {
    return this._cue(word, n).end;
  }

  _cue(cue, given) {
    const written = String(cue);
    // "fills#2" is the second time "fills" is spoken. Only digits after the last
    // # count, so "C#" stays a word. This comes before normWord, which keeps #.
    const hash = written.lastIndexOf('#');
    const counted = hash > 0 && /^\d+$/.test(written.slice(hash + 1)) && written.slice(0, hash).trim() ? Number(written.slice(hash + 1)) : null;
    const word = counted === null ? written : written.slice(0, hash);
    if (counted === 0) return this._noCue(`cue("${written}"): the number after # counts from 1, so "${word.trim()}#1" is the first time it is spoken`);
    if (counted !== null && given !== undefined && given !== counted) return this._noCue(`cue("${written}", ${given}) names two different times; write "${word.trim()}#${given}" or cue("${word.trim()}", ${given})`);
    const n = counted ?? given ?? 1;
    // A number that is written, here or as an argument, means that time on purpose.
    const meant = counted !== null || given !== undefined;
    const cjk = ['ja', 'zh'].includes(this.engine.config.language);
    const want = (cjk ? [word] : word.split(/\s+/)).map(normWord).filter(Boolean);
    if (!want.length) return this._noCue(`cue("${written}") is empty`);
    const ws = this.words;
    if (!ws.length) return this._noCue(`cue("${written}"): scene "${this.id}" has no narration`);
    const norms = ws.map((w) => normWord(w.text));
    const search = (forms) => {
      let count = 0;
      let at = null;
      for (let i = 0; i + want.length <= norms.length; i++) {
        let ok = true;
        let end = i + want.length;
        if (cjk) {
          let phrase = norms[i];
          while (phrase.length < want[0].length && end < norms.length) phrase += norms[end++];
          ok = phrase === want[0];
        } else {
          for (let k = 0; k < want.length; k++) if (!forms(i + k).includes(want[k])) { ok = false; break; }
        }
        if (ok && ++count === n && !at) at = { start: ws[i].start, end: ws[end - 1].end };
      }
      return { count, at };
    };
    let { count: seen, at: found } = search((i) => [norms[i]]);
    // A word after an elided article or pronoun, like "ombre" in "l'ombre", when the
    // cue isn't there as written. Cues that worked before keep their time.
    if (!found && !cjk) {
      const bare = ws.map((w) => normWord(String(w.text).replace(/^[^\p{L}\p{N}]+/u, '').replace(ELIDED, '')));
      const again = search((i) => [norms[i], bare[i]]);
      if (again.at) ({ count: seen, at: found } = again);
    }
    if (found) {
      // A word spoken more than once silently means its first time; tell the check.
      if (seen > 1 && !meant && this.engine.cueNotes) this.engine.cueNotes.push({ scene: this.id, word: written, count: seen });
      return found;
    }
    const count = seen ? ` (it is spoken ${seen} time${seen > 1 ? 's' : ''})` : '';
    // A cue with the name of one of the scene's markers, written without its #.
    const marker = want.length === 1 ? Object.keys(this.marks ?? {}).find((m) => normWord(m) === want[0]) : undefined;
    const mean = marker === undefined ? '' : `; did you mean '#${marker}'? [#${marker}] is a marker in this scene, and a marker needs its #`;
    const hint = suggest(want[0], [...new Set(norms)], 6).join(', ');
    // Each language says other words, so a cue that works in one fails in another.
    const several = this.engine.state?.text?.languages ? ' Word cues differ between languages, so a scene that every language draws is safer with the same [#marker] in each script.' : '';
    return this._noCue(`cue("${written}"${counted === null && n > 1 ? `, ${n}` : ''}) is not in the narration of scene "${this.id}"${count}${mean}. Close words: ${hint}${several ? `.${several}` : ''}`);
  }

  mark(name) {
    if (!(name in this.marks)) {
      const names = Object.keys(this.marks);
      return this._noCue(`mark("${name}") is not in scene "${this.id}". ${names.length ? 'Marks: ' + names.join(', ') : `Add [#${name}] to the narration in ${this.engine.state?.text?.files?.script ?? 'script.md'}.`}`).start;
    }
    return this.marks[name];
  }

  // A cue or a marker that isn't there. check notes it as an error and measures
  // the rest of the scene with the cue at the scene start. Anything else stops.
  _noCue(message) {
    const lost = this.engine.cueErrors;
    if (!lost) throw new SceneError(message);
    if (!lost.has(message)) lost.set(message, { scene: this.id, t: this.t });
    return { start: 0, end: 0 };
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
    // When the element just registered under its id comes and goes, for the marks
    // that point at it.
    if (this._lastId !== undefined && o.id !== undefined && o.id !== null && String(o.id) === this._lastId) {
      const entry = this._ids.get(this._lastId);
      if (entry) entry.life = { ...this._lifetime(at, out, o.exit ?? 'fade', o.outDur ?? 0.45), spec: o.out, atSpec: o.at };
    }
    this._lastId = undefined;
    if (this.engine.layoutLog && this._pendingBox) {
      // The element's own scale and rotation, and parts drawn beside it
      // (an icon's label), count for the camera.
      let box = this._pendingBox;
      const sc = o.scale ?? 1;
      const rad = ((o.rotate ?? 0) * Math.PI) / 180;
      if (sc !== 1 || rad) box = { ...box, w: (Math.abs(box.w * Math.cos(rad)) + Math.abs(box.h * Math.sin(rad))) * sc, h: (Math.abs(box.w * Math.sin(rad)) + Math.abs(box.h * Math.cos(rad))) * sc };
      // _pendingExtra is already measured with the element's transform.
      if (this._pendingExtra) box = unionBox(box, this._pendingExtra);
      // Its id tells the camera which arrows and marks belong to it, and
      // camera: false keeps the camera from moving to it.
      const info = { ...this._pendingInfo, ...(this._pendingId !== null && this._pendingId !== undefined ? { id: String(this._pendingId) } : {}), ...(o.camera === false ? { camera: false } : {}) };
      this._attach(kind, at, out, box, info);
      this._pendingBox = null;
      this._pendingExtra = null;
      this._pendingInfo = null;
      this._pendingId = null;
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
    // An element that draws itself in, or one that has only just begun to arrive.
    if (this.engine.motion && enter !== 'none' && (DRAWN_IN.has(enter) ? p < 1 : p < 0.3)) this.engine.motion.drawing = true;
    const life = { p, q, at, dur, enter, exit: o.exit ?? 'fade', local: this.t - at };
    if (kind !== 'group') this._seen(kind, life);
    return life;
  }

  _record(kind, at, dur, o, extra = {}) {
    const rec = this.engine.recorder;
    // Negative times mean "already on screen when the scene starts": no sound.
    if (!rec || at < 0) return;
    // sfx: true asks for the element's usual sound, also where it would be off.
    const usual = extra.sfx === undefined ? this.theme.sfx[kind] : extra.sfx;
    let sfx = o.sfx === undefined || o.sfx === true ? usual : o.sfx;
    if ((this.engine.sfxMode === 'minimal' || this._quiet) && o.sfx === undefined) sfx = null;
    rec.push({ kind, at, dur, sfx: sfx || null, gain: o.sfxGain ?? extra.gain ?? 1, pitch: extra.pitch, sustain: extra.sustain, key: `${kind}|${Math.round(at * 1000)}|${o.id ?? extra.label ?? ''}|${extra.pitch ?? ''}` });
  }

  // ---------- what check sees ----------

  // The place of this call among the calls of its kind in the scene, like "2nd
  // s.draw". Elements are always called, so it is the same at every moment.
  _call(name) {
    this._calls[name] = (this._calls[name] ?? 0) + 1;
    return `${ordinal(this._calls[name])} s.${name}`;
  }

  // How check names an element: by what it shows, with its id when it has one,
  // by its id alone, or else by its call and where it is, like "the 2nd s.draw
  // at 960,735".
  _named(kind, call, name, id, where = null) {
    const shown = name ? String(name) : '';
    const own = id === undefined || id === null ? '' : String(id);
    if (shown) return `the ${kind} "${shown.length > 40 ? shown.slice(0, 37) + '...' : shown}"${own && own !== shown ? ` (id "${own}")` : ''}`;
    if (own) return `the ${kind} "${own}"`;
    return `the ${call}${where ? ` at ${where}` : ''}`;
  }

  // While check samples a scene, engine.drawLog collects what each frame shows
  // besides text: the shapes, the lines of arrows and annotations, and how many
  // elements are on screen. Boxes are in design pixels, as drawn at that moment.

  // Whether an element has fully arrived and isn't leaving, inside groups and
  // kit parts that have too.
  _settled(life) {
    return Boolean(life) && (life.p >= 1 || life.enter === 'none') && life.q === 0 && this._unsettled === 0;
  }

  // When an element comes and has gone, in seconds of the scene, inside the groups
  // it is drawn in: `out` is when it starts to leave, and `gone` when its exit
  // has ended. Infinity for an element that stays.
  _lifetime(at, out, exit, outDur) {
    let gone = out === Infinity ? Infinity : out + (exit === 'none' ? 0 : outDur / this.pace);
    for (const g of this._windows ?? []) {
      at = Math.max(at, g.at);
      if (g.gone < gone) {
        gone = g.gone;
        out = Math.min(out, g.out);
      }
    }
    return { at, out, gone };
  }

  // Something other than the background is on screen.
  _seen(kind, life = null) {
    const log = this.engine.drawLog;
    if (!log || this._suppress > 0 || this.ctx.globalAlpha <= 0.01) return;
    log.shown++;
    if (kind) log.lives.push({ kind, settled: life ? this._settled(life) : this._unsettled === 0 });
  }

  _designPoints(points) {
    const m = this._matrix();
    return points.map(([px, py]) => {
      const p = m.transformPoint(new DOMPoint(px, py));
      return [p.x, p.y];
    });
  }

  // A shape for check: a box or, with `round`, an ellipse around x, y in the
  // current transform. `o.overlap: true` says it may overlap other shapes.
  // `border` is the width of the line drawn on its outline, half of which lies
  // outside it. Returns its number in the scene, so its own text can say whose it is.
  _logShape(kind, { x = 0, y = 0, w, h, round = false }, settled, o = {}, name = '', { border = 0, call = null, partial = null } = {}) {
    const log = this.engine.drawLog;
    const serial = ++this._shapeCalls;
    if (!log || this._suppress > 0 || !(w > 0) || !(h > 0)) return serial;
    this._seen(null);
    const local = round ? ring(x, y, w / 2, h / 2) : [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];
    const poly = this._designPoints(local);
    const m = this._matrix();
    const edge = border > 0 ? (border / 2) * Math.hypot(m.a, m.b) : 0;
    log.shapes.push({ kind, name: String(name ?? ''), id: o.id === undefined || o.id === null ? null : String(o.id), serial, poly, box: bounds(poly), edge, call, partial, settled, alpha: this.ctx.globalAlpha, group: this._groups[0] ?? null, overlap: o.overlap === true, cover: this._cover > 0, ui: this._ui ? this._ui._layer + 1 : 0, zoomed: !!this._camMoved, order: log.order++ });
    return serial;
  }

  // For check: something that shows itself bit by bit, like code that types
  // itself or a number that counts. `end` is when it is all there, and
  // `missing(t)` says how much is still missing at t. Each one is noted once.
  _reveal(key, info) {
    const log = this.engine.revealLog;
    if (!log || this._suppress > 0 || log.has(`${this.id}|${key}`)) return;
    log.set(`${this.id}|${key}`, info);
  }

  // For the cover: an element on screen that is still typing, showing its lines,
  // counting or writing itself, as { name, doing }.
  _partial(p) {
    const log = this.engine.drawLog;
    if (p && log && this._suppress === 0 && this.ctx.globalAlpha > 0.01) (log.partial ??= []).push(p);
    return p;
  }

  // For check: a code window or a terminal that comes in at `at` and shows its
  // first line at `first`, inside its groups. Each one is noted once.
  _window(name, at, o, first, advice) {
    const log = this.engine.windowLog;
    if (!log || log.has(`${this.id}|${name}`)) return;
    const life = this._lifetime(at, o.out === undefined ? Infinity : this.time(o.out), o.exit ?? 'fade', o.outDur ?? 0.45);
    log.set(`${this.id}|${name}`, { name, at: life.at, out: life.out, first: Math.max(first, life.at), advice });
  }

  // The drawn line of an arrow or an annotation for check, as points in the
  // current transform.
  _logStroke(kind, points, settled, extra = {}) {
    const log = this.engine.drawLog;
    if (!log || this._suppress > 0 || !points.length) return;
    log.strokes.push({ kind, points: this._designPoints(points), settled, alpha: this.ctx.globalAlpha, order: log.order++, ...extra });
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
    if (id !== undefined && id !== null) this._lastId = String(id);
    // While the camera is planned, the next _life call gives this box its
    // timing.
    if (this.engine.layoutLog) {
      this._pendingBox = box;
      this._pendingId = id;
    }
    return box;
  }

  // Records an element's place and timing for the automatic camera. x, y is
  // the center in local coordinates.
  _logLayout(kind, at, out, x, y, w, h, extra = null) {
    if (!this.engine.layoutLog) return;
    this._attach(kind, at, out, this._designBox(x, y, w, h), extra);
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
    this._seen(null);
    const m = this._matrix();
    const pts = [[entry.x0, entry.y0], [entry.x1, entry.y0], [entry.x1, entry.y1], [entry.x0, entry.y1]].map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
    const scale = Math.hypot(m.a, m.b);
    const drawn = this.engine.drawLog;
    log.push({
      // Whether it has fully arrived, the color of its *starred* words, the
      // option that sets its color, the arrow it labels and when it was drawn.
      settled: entry.settled ?? this._unsettled === 0,
      mark: entry.mark ?? null,
      option: entry.option ?? null,
      owner: entry.owner ?? null,
      // The shape it belongs to, like a box's own text, its group, and overlap: true.
      shape: entry.shape ?? null,
      // Still showing itself bit by bit, like code that types: { name, doing }.
      partial: entry.partial ?? null,
      group: this._groups[0] ?? null,
      overlap: entry.overlap === true,
      // 'title' for the words of a hook.
      role: entry.role ?? null,
      order: drawn ? drawn.order++ : 0,
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
      // What the scene painted behind it, for a text with no background of its own.
      page: entry.bg ? null : this._page ?? null,
      block: !!entry.block,
      ui: entry.ui || 0,
      // A badge of the UI kit, whose words check measures like any text.
      badge: !!entry.badge,
      zoomed: !!entry.zoomed,
    });
  }

  // Layout problems found while drawing, reported by `check`.
  _overflow(message) {
    const log = this.engine.textLog;
    if (log) log.push({ scene: this.id, t: this.t, problem: message });
  }

  // Something `check` should warn about, found while drawing. `check` keeps one
  // finding per scene and `key`, so a key that stands for one element gives one
  // warning for each element, wherever and whenever it is seen.
  _warn(message, key = message) {
    const log = this.engine.textLog;
    if (log) log.push({ scene: this.id, t: this.t, problem: message, level: 'warn', key });
  }

  // A hint for `check` that holds for the whole video, like a brand color that
  // was replaced. It shows once, however often it is found.
  _hint(message, key = message) {
    const log = this.engine.textLog;
    if (log) log.push({ scene: this.id, t: this.t, problem: message, level: 'hint', key, video: true });
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
    const fill = colorOf(this.theme, color, 'bg');
    ctx.save();
    ctx.setTransform(this.engine.scale, 0, 0, this.engine.scale, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
    this._page = { top: fill, bottom: fill };
  }

  // Turns off the entrance sounds of everything drawn after it in this scene,
  // so call it at the top. An element with sfx: true or a sound name of its
  // own still plays, and so do s.sfx and s.sound.
  quiet() {
    this._quiet = true;
  }

  sfx(name, at, o = {}) {
    if (!this.engine.sfxNames.includes(name)) throw new SceneError(`sfx "${name}" does not exist. Sounds: ${this.engine.sfxNames.join(', ')}`);
    const t = at === undefined ? this.t : this.time(at);
    const rec = this.engine.recorder;
    if (rec) rec.push({ kind: 'sfx', at: t, dur: o.dur ?? 0, sfx: name, gain: o.gain ?? 1, pitch: o.pitch, explicit: true, key: `sfx|${Math.round(t * 1000)}|${name}|${o.pitch ?? ''}` });
  }

  // Plays a file from assets/. It only matters to the soundtrack, so frames skip
  // it, and an exported player, which has the sound in its mix, doesn't need the file.
  sound(src, o = {}) {
    const rec = this.engine.recorder;
    if (!rec) return;
    const file = this.engine.soundFile(src);
    const volume = o.volume ?? 0.5;
    if (typeof volume !== 'number' || !(volume >= 0 && volume <= 1)) throw new SceneError('sound volume must be from 0 to 1');
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? this.dur : Math.min(this.dur, this.time(o.out));
    const n = this._soundSeq = (this._soundSeq || 0) + 1;
    rec.push({ kind: 'sound', key: `sound|${at}|${o.id ?? n}|${file}`, at, out, volume, src: file, url: soundURL('audio', file) });
  }

  // ---------- camera and groups ----------

  // keys: [{ at, x, y, zoom, dur }]. Call before drawing anything else.
  camera(keys, o = {}) {
    // A scene that moves its own camera gets no automatic camera.
    if (this.engine.planning) this.engine.manualCamera = true;
    const list = [{ at: 0, x: this.cx, y: this.cy, zoom: 1, dur: 0 }, ...keys.map((k) => ({ x: this.cx, y: this.cy, zoom: 1, dur: 1.1, ...k, at: this.time(k.at ?? 0) }))].sort((a, b) => a.at - b.at);
    // check counts a camera move as a change of the picture in a short video.
    for (const k of list.slice(1)) this.engine.cameraKeys?.add(Math.round(k.at * 100) / 100);
    let cur = { ...list[0] };
    const motion = this.engine.motion;
    if (o.shake) {
      this.engine.moving = true;
      if (motion) motion.camera = true;
    }
    for (let i = 1; i < list.length; i++) {
      const k = list[i];
      if (this.t < k.at) break;
      const prev = cur;
      const raw = (this.t - k.at) / Math.max(0.001, k.dur / this.pace);
      if (raw > 0 && raw < 1) {
        this.engine.moving = true;
        if (motion) motion.camera = true;
      }
      const p = easeFn(k.ease ?? 'inOut')(clamp(raw));
      cur = { x: lerp(prev.x, k.x, p), y: lerp(prev.y, k.y, p), zoom: lerp(prev.zoom, k.zoom, p), rotate: lerp(prev.rotate || 0, k.rotate || 0, p) };
    }
    const ctx = this.ctx;
    this._camMoved = cur.zoom !== 1 || cur.x !== this.cx || cur.y !== this.cy || Boolean(cur.rotate) || Boolean(o.shake);
    // check undoes the camera on a box outside the content area, to tell
    // whether the zoom is what put it there.
    if (this.engine.drawLog) this.engine.sceneCamera = { ...cur, cx: this.cx, cy: this.cy };
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
    // check counts what a group holds as one piece, so its shapes may overlap.
    const serial = ++this._groupCalls;
    const life = this._life(o, 'group', { enter: o.enter ?? 'none', sfx: null, dur: o.dur });
    const planning = Boolean(this.engine.layoutLog);
    if (planning) (this._spans ??= []).push({ at: this.time(o.at ?? 0), out: o.out === undefined ? Infinity : this.time(o.out) });
    // What the group holds comes and goes with it.
    (this._windows ??= []).push(this._lifetime(this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), o.exit ?? 'fade', o.outDur ?? 0.45));
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
      const moving = (life.p < 1 && life.enter !== 'none') || life.q > 0;
      if (moving) this._unsettled++;
      this._groups.push(serial);
      try { fn(this); } finally {
        this._groups.pop();
        if (moving) this._unsettled--;
        this.ctx.restore();
      }
    } finally {
      if (planning) this._spans.pop();
      this._windows.pop();
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
    const call = this._call('draw');
    const box = o.box;
    if (box !== undefined && !(box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box[k])) && box.w > 0 && box.h > 0)) {
      throw new SceneError('s.draw box must be { x, y, w, h }: the center and the size of what it draws, around 0, 0 when the drawing has x and y');
    }
    const life = this._life(o, 'custom', { enter: o.enter ?? 'none', sfx: o.sfx ?? null });
    const random = mulberry32(this._seed('random', o));
    if (this.engine.layoutLog) return this._measureDrawing(o, fn, life, random);
    if (!life) return;
    this._push(o.x ?? 0, o.y ?? 0, life, o);
    // check takes the box as a shape, where the drawing is now.
    if (box) this._logShape('drawing', { x: box.x, y: box.y, w: box.w, h: box.h, round: box.round === true }, this._settled(life), o, o.id ?? '', { call });
    const saved = Math.random;
    Math.random = random;
    try { fn(this.ctx, life); } finally {
      Math.random = saved;
      this.ctx.restore();
    }
  }

  // ---------- text ----------

  text(str, o = {}) {
    return this._text(str, o, o.kind || 'text', this._call('text'));
  }

  // A width of `f` times the frame, never wider than the platform safe area.
  _w(f) {
    return this.platform ? Math.min(this.W * f, this.safe.w) : this.W * f;
  }

  // A height `f` of the way down the frame (or down the safe area).
  _y(f) {
    return this.platform ? this.safe.y + this.safe.h * f : this.H * f;
  }

  // With "defaults": "0.6", a title or subtitle that wraps breaks into lines of
  // about the same length, so no word is left alone on the last line.
  title(str, o = {}) {
    return this._text(str, { font: 'display', size: 104, y: this._y(0.44), maxWidth: this._w(0.82), lineHeight: 1.12, balance: this._v6, ...o }, 'title', this._call('title'));
  }

  subtitle(str, o = {}) {
    return this._text(str, { font: 'body', size: 46, color: 'muted', y: this._y(0.6), maxWidth: this._w(0.7), balance: this._v6, ...o }, 'text', this._call('subtitle'));
  }

  note(str, o = {}) {
    return this._text(str, { size: this._v6 ? SCALE.note : 32, color: 'muted', ...o }, 'text', this._call('note'));
  }

  // `method` is the call that drew it, like "2nd s.text", for check.
  _text(str, o, kind, method = null) {
    const call = ++this._texts;
    const th = this.theme;
    const ctx = this.ctx;
    const role = o.font ?? 'body';
    if (!th.fonts[role]) throw new SceneError(`font "${role}" is not one of display, body, hand, mono`);
    const size = o.size ?? TEXT_SIZE;
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
      const maxWidth = o.maxWidth ?? o.width ?? this._w(0.8);
      lay = layoutText(ctx, { str: String(str), font, size, maxWidth, lineHeight: o.lineHeight ?? 1.24 });
      // With "defaults": "0.6", text on a card of its own (bg) is balanced too.
      if ((o.balance ?? (this._v6 && !!o.bg)) && lay.lines.length > 1) lay = balanced(ctx, lay, { str: String(str), font, size, maxWidth, lineHeight: o.lineHeight ?? 1.24 });
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
    if ((enter === 'write' || enter === 'type') && plain.trim()) {
      const start = this.time(o.at ?? 0);
      const length = (dur ?? DEFAULT_DUR[enter] ?? 0.6) / this.pace;
      const label = plain.length > 40 ? plain.slice(0, 37) + '...' : plain;
      this._reveal(`text|${call}`, {
        what: `"${label}"`, at: start, end: start + length, out: o.out === undefined ? Infinity : this.time(o.out),
        missing: (t) => `has ${enter === 'type' ? 'typed' : 'written'} ${Math.floor(clamp((t - start) / length) * 100)}% of itself`,
        advice: enter === 'type' ? `give it an earlier at, or a higher cps than ${o.cps ?? 28}` : 'give it an earlier at, or a shorter dur',
      });
    }
    const life = this._life({ ...o, enter }, kind, { dur: enter === 'sync' ? Math.max(0.3, (times[times.length - 1] ?? 0) - this.time(o.at ?? 0) + 0.3) : dur, real: enter === 'sync', label: plain.slice(0, 40) });
    if (!life) return g;

    // Spaces on a background, often meant as an empty field, shrink to a thin
    // card. check names such a text by its id, or by where it sits in the frame,
    // inside its groups and before its own entrance moves it.
    const blank = o.bg && !plain.trim() && this.engine.textLog;
    const place = blank && (o.id === undefined || o.id === null) ? this._matrix().transformPoint(new DOMPoint(x, y)) : null;
    this._push(bx, by, life, o);
    const color = colorOf(th, o.color, 'ink');
    const accent = colorOf(th, o.mark ?? this.engine.brandAccent ?? 'accent');
    if (o.bg) {
      const bgc = colorOf(th, o.bg === true ? 'surface' : o.bg);
      this.pen.draw(ctx, { kind: 'rect', w: g.w, h: g.h, r: o.radius ?? Math.min(th.radius, g.h / 2) }, { fill: bgc, stroke: o.border ? colorOf(th, o.border) : 'none', width: 2, shadow: this._shadow(), seed: this._seed('textbg', o, plain), rough: false }, { stroke: 1, fill: 1 });
      if (blank && bgc !== 'none') {
        const name = place ? `the ${method ?? 'text'} at ${Math.round(place.x)},${Math.round(place.y)}` : `the text "${o.id}"`;
        this._warn(`${name} has a background but no words, so it draws an empty card; for an empty field, use s.box({ w, h }) or another shape with a size`, place ? `blank text ${call}` : `blank text id ${o.id}`);
      }
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
    // brand.accent replaced by a color that reads, on starred words that use it.
    const note = o.mark === undefined && this.engine.brandAccentNote;
    if (note && lay.lines.some((line) => line.words.some((w) => w.accent))) this._hint(note, 'brand accent text');
    const marked = o.bg && lay.lines.some((line) => line.words.some((w) => w.accent));
    const label = plain.length > 40 ? plain.slice(0, 37) + '...' : plain;
    const partial = this._partial(o._counting ?? (['type', 'write', 'words', 'sync'].includes(life.enter) && life.p < 1 ? { name: `"${label}"`, doing: life.enter === 'type' ? 'still typing' : 'still writing itself' } : null));
    this._logText({ text: plain, x0: ox, y0: oy, x1: -ox, y1: -oy, size, fg: color, bg: o.bg ? colorOf(th, o.bg === true ? 'surface' : o.bg) : null, settled: this._settled(life), mark: marked ? accent : null, overlap: o.overlap, partial });
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
    this._logText({ text: tex, x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: color, bg: null, settled: this._settled(life) });
    ctx.restore();
    return g;
  }

  // ---------- shapes ----------

  box(label, o = {}) {
    return this._box(label, o, 'box');
  }

  // A box or a circle. `method` is the call that drew it, for check.
  _box(label, o, method) {
    if (label && typeof label === 'object') [o, label] = [label, label.label];
    const call = this._call(method);
    const th = this.theme;
    const ctx = this.ctx;
    const size = o.size ?? 44;
    const role = o.font ?? 'body';
    const font = fontString(th, role, size, o.weight ?? BOLD[role]);
    const pad = o.padding ?? size * 0.62;
    const maxW = o.w ? o.w - pad * 2 : o.maxWidth ?? 560;
    let lay = label !== undefined && label !== null && label !== '' ? layoutText(ctx, { str: String(label), font, size, maxWidth: maxW, lineHeight: 1.15 }) : null;
    // With "defaults": "0.6", a label that wraps gets lines of about the same
    // length, so no word sits alone on the last line, as in titles.
    if (lay && lay.lines.length > 1 && (o.balance ?? this._v6)) lay = balanced(ctx, lay, { str: String(label), font, size, maxWidth: maxW, lineHeight: 1.15 });
    const iconSize = o.icon ? o.iconSize ?? size * 1.55 : 0;
    const gapIL = lay && o.icon ? size * 0.35 : 0;
    const contentH = (lay ? lay.height : 0) + iconSize + gapIL;
    const shape = o.shape ?? 'rect';
    // A look with "card": "strip", like studio, draws a white card with a fine
    // outline, and a card with a color gets a band of it along the top, with
    // room for it above the words.
    const strip = th.card === 'strip' && !th.stroke.rough && shape === 'rect' && o.fill === undefined && o.color && o.color !== 'none';
    const band = strip ? Math.round(clamp(size * 0.2, 6, 16)) : 0;
    const w = o.w ?? Math.max(o.minW ?? 0, (lay ? lay.width : 0) + pad * 2, iconSize + pad * 2);
    const h = o.h ?? Math.max(o.minH ?? 0, contentH + pad * 1.4 + band);
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    this._register(o.id, x, y, w, h, shape === 'ellipse' || shape === 'circle' ? 'ellipse' : 'rect');
    // A shape without words has no detail for the camera to move in on.
    if (this.engine.layoutLog && !lay) this._pendingInfo = { bare: true };
    const g = geom(x, y, w, h);
    const plain = lay ? String(label).replace(/\*/g, '') : '';
    const life = this._life(o, 'shape', { label: plain.slice(0, 40) || o.icon });
    if (!life) return g;
    this._push(x, y, life, o);
    const settled = this._settled(life);
    const own = this._logShape('box', { w, h, round: shape === 'ellipse' || shape === 'circle' }, settled, o, plain || o.id, { border: o.border === false ? 0 : o.width ?? th.stroke.width, call });
    const prog = this._drawProgress(life);
    const spec = shape === 'ellipse' || shape === 'circle' ? { kind: 'ellipse', w, h } : { kind: 'rect', w, h, r: o.radius ?? th.radius };
    const fine = th.card === 'strip' && o.stroke === undefined && o.width === undefined;
    const stroke = fine ? mixColor(th.surface, o.color ? colorOf(th, o.color) : th.ink, o.color ? 0.4 : 0.14) : colorOf(th, o.stroke ?? o.color, 'ink');
    const fill = o.fill !== undefined ? colorOf(th, o.fill) : strip ? th.surface : o.color ? tintOf(th, o.color) : th.surface;
    this.pen.draw(ctx, spec, { stroke: o.border === false ? 'none' : stroke, width: o.width ?? (fine ? 2 : th.stroke.width), fill, fillStyle: o.fillStyle, dashed: o.dashed, seed: this._seed('box', o, plain), shadow: this._shadow(), glow: o.glow ?? (th.stroke.glow && o.color ? th.stroke.glow : 0) }, prog);
    if (strip) {
      ctx.save();
      ctx.clip(this.pen.prepared(this.pen.specD(spec)).full);
      ctx.globalAlpha *= prog.fill;
      ctx.fillStyle = colorOf(th, o.color);
      ctx.fillRect(-w / 2, -h / 2, w, band);
      ctx.restore();
    }
    const textColor = o.textColor ? colorOf(th, o.textColor) : this._autoTextColor(fill, th.ink);
    const top = -contentH / 2 + band / 2;
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = prevA * prog.text;
    if (o.icon) this._iconAt(o.icon, 0, top + iconSize / 2, iconSize, colorOf(th, o.iconColor ?? o.color, 'ink'), 1, this._seed('boxicon', o, o.icon), o.iconWeight);
    if (lay) {
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      const ty = top + iconSize + gapIL;
      const accent = colorOf(th, o.mark ?? 'accent');
      let marked = false;
      for (const line of lay.lines) {
        const lx = -lay.width / 2 + (lay.width - line.width) / 2;
        for (const wd of line.words) {
          ctx.fillStyle = wd.accent ? accent : textColor;
          ctx.fillText(wd.text, lx + wd.x, ty + line.y);
          marked ||= Boolean(wd.accent);
        }
      }
      this._logText({ text: plain, x0: -lay.width / 2, y0: ty, x1: lay.width / 2, y1: ty + lay.height, size, fg: textColor, bg: fill, settled, mark: marked ? accent : null, shape: own });
    }
    ctx.globalAlpha = prevA;
    ctx.restore();
    return g;
  }

  circle(o = {}) {
    const r = o.r ?? 80;
    return this._box(o.label, { ...o, shape: 'ellipse', w: r * 2, h: r * 2, padding: 0 }, 'circle');
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
      this._logLayout(thick ? 'shape' : 'line', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), o.camera === false ? { camera: false } : null);
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
        this._logLayout(/z/i.test(d) || o.fill ? 'shape' : 'line', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), o.camera === false ? { camera: false } : null);
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
    if (o.labelSide !== undefined && !Object.hasOwn(LABEL_SIDES, o.labelSide)) throw new SceneError(`arrow: labelSide "${o.labelSide}" is not one of ${Object.keys(LABEL_SIDES).join(', ')}`);
    const th = this.theme;
    // Arrows are always drawn, so the n-th arrow of a scene is the same arrow at
    // every moment; its label and the camera's records carry the number.
    const serial = ++this._arrowCalls;
    const A = this._point(from);
    const B = this._point(to);
    const gap = o.gap ?? 14;
    // With "defaults": "0.5", gap leaves room at a point end too, and an icon's
    // label belongs to the icon, so the arrow leaves and arrives outside it.
    const fresh = newDefaults(this.engine.config);
    let a = typeof from === 'string' ? this._edge(A, B, gap) : A;
    let b = typeof to === 'string' ? this._edge(B, A, gap) : B;
    if (typeof from === 'string' && typeof to !== 'string') Object.assign(a, this._edge(A, b, gap));
    if (fresh && o.gap !== undefined) {
      // gap pixels from a point, toward the other end.
      const off = (p, q) => {
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        return len > o.gap * 2 ? { x: p.x + ((q.x - p.x) / len) * o.gap, y: p.y + ((q.y - p.y) / len) * o.gap } : p;
      };
      const [pa, pb] = [a, b];
      if (typeof from !== 'string') a = off(pa, pb);
      if (typeof to !== 'string') b = off(pb, pa);
    }
    if (fresh && typeof from === 'string') a = this._pastLabel(from, a, A, B, gap);
    if (fresh && typeof to === 'string') b = this._pastLabel(to, b, B, A, gap);
    const bend = o.bend ?? 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const c = { x: (a.x + b.x) / 2 - dy * bend * 0.5, y: (a.y + b.y) / 2 + dx * bend * 0.5 };
    const d = bend ? quadD([a.x, a.y], [c.x, c.y], [b.x, b.y]) : polyD([[a.x, a.y], [b.x, b.y]]);
    const life = this._life(o, 'arrow', { enter: o.enter ?? 'draw', dur: o.dur ?? 0.7 });
    // By its id, by the ids of its ends, or by its call and where it runs.
    const end = (v, p) => (typeof v === 'string' ? `"${v}"` : `${Math.round(p.x)},${Math.round(p.y)}`);
    const name = o.id !== undefined && o.id !== null ? `the arrow "${o.id}"` : typeof from === 'string' && typeof to === 'string' ? `the arrow from ${end(from, a)} to ${end(to, b)}` : `the ${ordinal(serial)} s.arrow from ${end(from, a)} to ${end(to, b)}`;
    // For check: when it starts drawing, and when the elements it starts from
    // and points at come in.
    const arrows = this.engine.arrowLog;
    if (arrows && !arrows.has(serial)) {
      const ends = [[from, 'from'], [to, 'to']].filter(([v]) => typeof v === 'string' && this._ids.get(v)?.life).map(([v, side]) => ({ id: v, side, at: this._ids.get(v).life.at, spec: this._ids.get(v).life.atSpec }));
      const at = this._lifetime(this.time(o.at ?? 0), Infinity, 'none', 0).at;
      // Its tip reaches what it points at as it finishes drawing.
      arrows.set(serial, { name, at, reach: at + (o.dur ?? 0.7) / this.pace, ends });
    }
    if (this.engine.layoutLog) {
      const xs = [a.x, b.x, c.x];
      const ys = [a.y, b.y, c.y];
      const at = this.time(o.at ?? 0);
      const out = o.out === undefined ? Infinity : this.time(o.out);
      // What it points at, so a shot that moves to one of them takes the arrow in.
      const ends = [typeof from === 'string' ? from : null, typeof to === 'string' ? to : null];
      const tips = this._designPoints([[a.x, a.y], [b.x, b.y]]);
      this._logLayout('arrow', at, out, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), { serial, ends, tips });
      // The line may run off the edge of a close-up, but its label is text,
      // so the camera keeps it whole. A label outside the frame is never
      // seen, so the camera leaves it alone.
      if (o.label) {
        const label = this._arrowLabel(o, d, a, b, bend);
        const box = this._textExtent([{ text: String(o.label), x: label.x, y: label.y, font: label.font }]);
        const seen = box.x + box.w / 2 > 0 && box.x - box.w / 2 < this.W && box.y + box.h / 2 > 0 && box.y - box.h / 2 < this.H;
        if (seen) this._attach('label', at, out, box, { serial });
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
    const headAt = (dist, dir) => {
      const tip = pointAt(d, dist);
      const back = pointAt(d, Math.max(0, Math.min(L, dist - dir * Math.min(12, L / 3))));
      const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
      const s1 = [tip.x - hs * Math.cos(ang - 0.5), tip.y - hs * Math.sin(ang - 0.5)];
      const s2 = [tip.x - hs * Math.cos(ang + 0.5), tip.y - hs * Math.sin(ang + 0.5)];
      return [s1, [tip.x, tip.y], s2];
    };
    const drawHead = (dist, dir) => {
      const points = headAt(dist, dir);
      if (th.stroke.rough) {
        this.pen.draw(ctx, { kind: 'poly', points }, { stroke: color, width, seed: seed + 7, single: true, roughness: 0.6 }, { stroke: 1, fill: 1 });
      } else {
        this.pen.draw(ctx, { kind: 'poly', points, close: true }, { stroke: color, width: width * 0.6, fill: color, seed, glow: o.glow ?? 0 }, { stroke: 1, fill: 1 });
      }
    };
    if (L > 1 && prog > 0.02) {
      if (head === 'end' || head === 'both') drawHead(L * prog, 1);
      if ((head === 'start' || head === 'both') && prog > 0.2) drawHead(0.001, -1);
    }
    // check sees the whole line once it is drawn, heads included.
    if (this.engine.drawLog && L > 1 && prog >= 1) {
      const heads = [...(head === 'end' || head === 'both' ? [headAt(L, 1)] : []), ...(head === 'start' || head === 'both' ? [headAt(0.001, -1)] : [])];
      const body = samplePath(d);
      this._logStroke('arrow', [...body, ...heads.flatMap((h) => along(h))], this._settled(life), { serial, name, ends: [typeof from === 'string' ? from : null, typeof to === 'string' ? to : null], body: this._designPoints(body), tips: this._designPoints([[a.x, a.y], [b.x, b.y]]) });
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
        this._logText({ text: String(o.label), x0: lx - w / 2, y0: ly - ls / 2, x1: lx + w / 2, y1: ly + ls / 2, size: ls, fg: ctx.fillStyle, bg: null, owner: serial, settled: la >= 1 && this._settled(life) });
        ctx.restore();
      }
    }
    ctx.restore();
    return result;
  }

  // Where an arrow from an icon with a label starts, or where one to it ends:
  // `end` on the icon's edge, unless the line from the icon's middle toward
  // `toward` runs through the label. Then it starts past the label, `gap` away.
  _pastLabel(id, end, center, toward, gap) {
    const label = this._ids.get(String(id))?.label;
    if (!label) return end;
    const L = this._fromDesign(label);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return end;
    const hit = rayThrough(center, dx / len, dy / len, { x0: L.left - gap, y0: L.top - gap, x1: L.right + gap, y1: L.bottom + gap });
    const from = Math.hypot(end.x - center.x, end.y - center.y);
    if (!hit || hit[1] <= from || hit[0] >= len) return end;
    return { x: center.x + (dx / len) * hit[1], y: center.y + (dy / len) * hit[1] };
  }

  // Where an arrow's label goes: on the side `labelSide` names, or else on the
  // outer side of a curve, or above a straight arrow (left of a vertical one).
  // x, y is the label's center.
  _arrowLabel(o, d, a, b, bend) {
    const mid = pointAt(d, pathLength(d) / 2);
    let nx;
    let ny;
    const bx = mid.x - (a.x + b.x) / 2;
    const by = mid.y - (a.y + b.y) / 2;
    if (o.labelSide !== undefined) {
      [nx, ny] = LABEL_SIDES[o.labelSide];
    } else if (bend && Math.hypot(bx, by) > 1) {
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
    // With "defaults": "0.5" a label is body size and sits further out as it
    // grows: 34 pixels out for a 34 pixel label, and 44 for 48. Before, it was
    // 34 pixels and 34 pixels out. With "0.6" it is a label of the scale, 40
    // pixels, a little smaller than the words on a card.
    const fresh = newDefaults(this.engine.config);
    const size = o.labelSize ?? (this._v6 ? SCALE.label : fresh ? TEXT_SIZE : OLD_LABEL_SIZE);
    const off = o.labelOffset ?? (fresh ? Math.round(size * 0.7 + 10) : OLD_LABEL_SIZE);
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

  // The box the lines of an icon fill when it is drawn `size` wide around 0,0,
  // for check. Icons leave a little room around their lines.
  _glyphBox(name, size, weight = 2) {
    const cache = (this.engine.glyphBoxes ??= new Map());
    let b = cache.get(name);
    if (!b) {
      b = bounds((this.engine.icons[name] ?? []).flatMap((d) => samplePath(d, 0.5)));
      if (!Number.isFinite(b.x0)) b = { x0: 0, y0: 0, x1: 24, y1: 24 };
      cache.set(name, b);
    }
    const k = size / 24;
    const half = (weight * k) / 2;
    return { x: ((b.x0 + b.x1) / 2 - 12) * k, y: ((b.y0 + b.y1) / 2 - 12) * k, w: (b.x1 - b.x0) * k + half * 2, h: (b.y1 - b.y0) * k + half * 2 };
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
    const box = this._register(o.id, x, y, bgSize, bgSize, o.bg === 'square' ? 'rect' : o.bg ? 'ellipse' : 'rect');
    // Nor has an icon without a label.
    if (this.engine.layoutLog && !o.label) this._pendingInfo = { bare: true };
    let labelBox = null;
    if (o.label) {
      const ls = o.labelSize ?? (this._v6 ? SCALE.label : 36);
      this.ctx.save();
      this.ctx.font = fontString(th, o.labelFont ?? 'body', ls, BOLD[o.labelFont ?? 'body']);
      const lw = this.ctx.measureText(String(o.label)).width;
      this.ctx.restore();
      const ly = y + bgSize / 2 + ls * 0.45 + ls / 2;
      labelBox = geom(x, ly, lw, ls);
      // The label belongs to the icon for the camera, and for arrows, which
      // leave and arrive outside it, but not for s.get().
      if (o.id !== undefined && o.id !== null) this._ids.set(String(o.id), { ...box, label: this._designBox(x, ly, lw, ls * 1.1) });
      if (this.engine.layoutLog) this._pendingExtra = this._elementBox(o, x, y, x, ly, lw, ls * 1.1);
    }
    this._iconPaths(name, size);
    const life = this._life(o, 'icon', { label: name });
    // bottom stays the icon's own, so older projects place things where they did.
    // With a label, label is its box and outer holds the icon and its label.
    const g = geom(x, y, bgSize, bgSize);
    if (labelBox) {
      const left = Math.min(g.left, labelBox.left);
      const right = Math.max(g.right, labelBox.right);
      Object.assign(g, { label: labelBox, outer: geom((left + right) / 2, (g.top + labelBox.bottom) / 2, right - left, labelBox.bottom - g.top) });
    }
    if (!life) return g;
    this._push(x, y, life, o);
    const settled = this._settled(life);
    // check compares what is drawn: the background, or else the lines of the icon.
    const own = this._logShape('icon', o.bg ? { w: bgSize, h: bgSize, round: o.bg !== 'square' } : this._glyphBox(name, size, o.weight), settled, o, name, { border: o.bg && th.stroke.rough ? th.stroke.width * 0.8 : 0 });
    const prog = this._drawProgress(life);
    const color = colorOf(th, o.color, 'ink');
    if (o.bg) {
      const bgColor = o.bg === true || o.bg === 'circle' || o.bg === 'square' ? tintOf(th, o.color ?? th.accent) : colorOf(th, o.bg);
      const spec = o.bg === 'square' ? { kind: 'rect', w: bgSize, h: bgSize, r: th.radius } : { kind: 'ellipse', w: bgSize, h: bgSize };
      this.pen.draw(this.ctx, spec, { stroke: th.stroke.rough ? color : 'none', width: th.stroke.width * 0.8, fill: bgColor, seed: this._seed('iconbg', o, name), shadow: this._shadow() }, { stroke: prog.stroke, fill: prog.fill });
    }
    this._iconAt(name, 0, 0, size, color, prog.stroke, this._seed('icon', o, name), o.weight);
    if (o.label) {
      const ls = o.labelSize ?? (this._v6 ? SCALE.label : 36);
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
      this._logText({ text: String(o.label), x0: -w / 2, y0: ly, x1: w / 2, y1: ly + ls, size: ls, fg: ctx.fillStyle, bg: null, settled, shape: own });
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
    // A full clip fills the whole frame, edge to edge, and is simply there: no
    // frame, shadow, rounded corners or entrance, whatever the look draws.
    if (o.full) o = { ...o, x: this.W / 2, y: this.H / 2, w: this.W, h: this.H, frame: 'none', shadow: false, radius: 0, enter: 'none' };
    const clip = this.engine.clip(src);
    const from = o.from ?? 0;
    const volume = o.volume ?? 0;
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? this.dur : Math.min(this.dur, this.time(o.out));
    // 'fit' plays the clip at the speed that makes it end with the scene, or at out,
    // from half speed to twice the speed. Slower than that, it freezes at the end.
    const fit = o.speed === 'fit';
    const length = Math.max(0, clip.duration - from);
    const speed = fit ? (out > at && length > 0 ? clamp(length / (out - at), FIT_SPEEDS[0], FIT_SPEEDS[1]) : 1) : o.speed ?? 1;
    for (const [name, value, lo, hi] of [['from', from, 0, Infinity], ['speed', speed, 0.25, 4], ['volume', volume, 0, 1]]) {
      if (!Number.isFinite(value) || value < lo || value > hi) throw new SceneError(`clip ${name} must be ${name === 'from' ? 'a non-negative number' : `from ${lo} to ${hi}`}${name === 'speed' ? ", or 'fit'" : ''}`);
    }
    const end = o.loop ? out : Math.min(out, at + length / speed);
    const n = this._clipSeq = (this._clipSeq || 0) + 1;
    if (this.engine.recorder) this.engine.recorder.push({ kind: 'clip', key: `clip|${at}|${o.id ?? n}|${src}`, at, end, out, from, speed, fit, loop: !!o.loop, volume, hasAudio: clip.hasAudio, duration: clip.duration, src: clip.src, url: clipURL('audio', clip.src) });
    const frame = clipFrame(clip, this.t, { at, from, speed, loop: o.loop });
    return this._picture(src, () => frame === null ? null : this.engine.clipImage(clip, frame), clip.width, clip.height, o);
  }

  // A recording from "explainroo record", played like a clip: the video with a
  // cursor that moves between steps, a ring on each click and the zooms of its
  // zoom steps, all from its step log. A step with a cue holds the frame before
  // the step until its action lands on the cue.
  recording(name, o = {}) {
    if (o.full) o = { ...o, x: this.W / 2, y: this.H / 2, w: this.W, h: this.H, frame: 'none', shadow: false, radius: 0, enter: 'none' };
    const { log, clip } = this.engine.recording(name);
    // Its zoom steps are the camera of the scene, so the automatic one keeps out.
    if (this.engine.planning) this.engine.manualCamera = true;
    const ratio = log.width / log.height;
    const bar = o.frame === 'browser' || o.frame === 'window' ? 1.075 : o.frame === 'phone' ? 1.03 : 1;
    // The content area it plays in, the size it was given or the safe area,
    // and the most of it the page can take, for the viewport check names:
    // without a size, that is the safe area less the bar of a frame and a
    // small margin.
    const area = o.w === undefined && o.h === undefined ? { w: this.safe.w, h: this.safe.h } : { w: o.w ?? o.h * ratio, h: o.h ?? o.w / ratio };
    const room = o.w === undefined && o.h === undefined ? { w: area.w * 0.96, h: (area.h / bar) * 0.96 } : area;
    // Without a size it fills what the safe area holds, with the bar of a
    // browser or window frame, which _picture puts on top.
    if (o.w === undefined && o.h === undefined) {
      const h = Math.min(this.safe.h / bar, this.safe.w / ratio) * 0.96;
      o = { ...o, w: h * ratio, h, ...(o.x === undefined ? { x: this.safe.x + this.safe.w / 2 } : {}), ...(o.y === undefined ? { y: this.safe.y + this.safe.h / 2 } : {}) };
    }
    const from = o.from ?? log.start ?? 0;
    const at = this.time(o.at ?? 0);
    const out = o.out === undefined ? this.dur : Math.min(this.dur, this.time(o.out));
    if (!Number.isFinite(from) || from < 0 || from > log.duration) throw new SceneError(`recording from must be seconds from 0 to ${log.duration.toFixed(1)}, the length of "${name}"`);
    if (o.speed !== undefined && o.speed !== 'fit' && !(Number.isFinite(o.speed) && o.speed >= 0.25 && o.speed <= 4)) throw new SceneError("recording speed must be from 0.25 to 4, or 'fit'");
    if (o.cues !== undefined && (typeof o.cues !== 'object' || o.cues === null || Array.isArray(o.cues))) throw new SceneError("recording cues must be an object like { saved: 'saved', 4: '#total' }: a mark name or a step number, and its cue");
    const steps = log.steps.filter((st) => !st.before);
    for (const key of Object.keys(o.cues ?? {})) {
      if (!steps.some((st) => st.name === key || String(st.step) === key)) {
        const names = steps.filter((st) => st.name).map((st) => st.name);
        throw new SceneError(`recording "${name}" has no mark or step "${key}" for cues. ${names.length ? `Marks: ${names.join(', ')}. ` : ''}Steps go from ${steps[0].step} to ${steps.at(-1).step}`);
      }
    }
    const cued = cuedSteps(steps, { cues: o.cues, from, time: (cue) => this.time(cue) });
    // 'fit' plays the recording at the speed that ends its last step with the
    // scene, or at out, with the holds for its cues, from half to twice its speed.
    const end = log.end ?? log.duration;
    let speed = o.speed ?? 1;
    if (speed === 'fit') {
      speed = 1;
      for (let i = 0; i < 8; i++) {
        const c = recordingClock(cued, { at, from, speed });
        const room = out - at - c.held;
        speed = room > 0 ? clamp((end - from) / room, FIT_SPEEDS[0], FIT_SPEEDS[1]) : FIT_SPEEDS[1];
      }
    }
    const clock = recordingClock(cued, { at, from, speed });
    const v = videoTime(clock, this.t);
    const clicks = steps.filter((st) => st.click !== undefined && st.click >= from).map((st) => ({ st, at: sceneTime(clock, st.click) }));
    const rec = this.engine.recorder;
    if (rec) {
      const n = this._recordingSeq = (this._recordingSeq || 0) + 1;
      const label = (step) => {
        const st = log.steps.find((x) => x.step === step);
        const target = st.text ?? st.selector ?? st.name ?? st.key;
        return `step ${step} (${st.do}${target !== undefined ? ` "${target}"` : ''})`;
      };
      const after = steps.filter((st) => st.t >= from && sceneTime(clock, st.t) > out + 0.05);
      rec.push({ kind: 'recording', key: `recording|${at}|${o.id ?? n}|${name}`, at, out, end: sceneTime(clock, end), name, changed: !!log.changed,
        late: clock.late.map((l) => ({ ...l, label: label(l.step), cue: cued.find((c) => c.step === l.step).cue })),
        cut: after.length ? { first: label(after[0].step), count: after.length, at: sceneTime(clock, after[0].t) } : null, fit: o.speed === 'fit', speed,
        small: smallRecording(log, { w: o.w ?? o.h * (log.width / log.height), h: o.h ?? o.w / (log.width / log.height), from, zoom: o.zoom !== false }), width: log.width, height: log.height,
        text: smallPageText(log, { w: o.w ?? o.h * (log.width / log.height), h: o.h ?? o.w / (log.width / log.height) }), area, room,
        played: { w: o.w ?? o.h * ratio, h: o.h ?? o.w / ratio }, frame: bar > 1 ? o.frame : null,
        // Where the page plays whole, when every step the narration talks
        // about plays inside a zoom: then small text matters less.
        unzoomed: o.zoom === false ? null : talkZoomed(steps.filter((st) => st.t >= from), { cues: o.cues, end: Infinity, from })?.map((sp) => ({ from: Math.max(at, sceneTime(clock, sp.from)), to: Math.min(out, sceneTime(clock, sp.to)) })).filter((sp) => sp.to - sp.from > 0.1),
        // What moves the picture, for the look a short takes at still stretches.
        moving: movingSteps(steps.filter((st) => st.t >= from), { zoom: o.zoom !== false, noted: !!log.changes }).map((m) => ({ from: sceneTime(clock, m.from), to: sceneTime(clock, m.to) })).filter((m) => m.to >= at && m.from < out) });
      // Each step shows something new, for check's look at quiet stretches.
      for (const st of steps) {
        const T = st.t >= from ? sceneTime(clock, st.t) : -1;
        if (T >= at && T < out) rec.push({ kind: 'recording-step', at: T, key: `recording-step|${n}|${st.step}` });
      }
      if (o.sound !== false) {
        for (const c of clicks) if (c.at >= at && c.at < out) rec.push({ kind: 'sfx', at: c.at, dur: 0, sfx: 'click', gain: 0.5, key: `recording-click|${n}|${c.st.step}` });
      }
    }
    const accent = colorOf(this.theme, o.color ?? 'accent');
    const t = this.t;
    const paint = (ctx, img, left, top, w, h) => {
      const sx = clip.width / log.width;
      const view = viewAt(log, v, w / h, { zoom: o.zoom !== false });
      ctx.drawImage(img, view.x * sx, view.y * sx, view.w * sx, view.h * sx, left, top, w, h);
      const k = w / view.w;
      const place = (x, y) => [left + (x - view.x) * k, top + (y - view.y) * k];
      const size = Math.max(26 * k, h * 0.035);
      for (const c of clicks) {
        const age = t - c.at;
        if (age < 0 || age >= RING_SECONDS) continue;
        const p = age / RING_SECONDS;
        const [x, y] = place(c.st.box ? c.st.box.x : c.st.move?.x1 ?? 0, c.st.box ? c.st.box.y : c.st.move?.y1 ?? 0);
        const r = size * (0.3 + 1.1 * ease.out(p));
        ctx.save();
        ctx.globalAlpha *= 1 - p;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(accent, 0.22);
        ctx.fill();
        ctx.lineWidth = Math.max(2, size * 0.12);
        ctx.strokeStyle = accent;
        ctx.stroke();
        ctx.restore();
      }
      if (o.cursor === false) return;
      const pos = cursorAt(log, v);
      const [x, y] = place(pos.x, pos.y);
      drawCursor(ctx, x, y, size);
    };
    const g = this._picture(`assets/recordings/${name}.webm`, () => v === null ? null : this.engine.clipImage(clip, Math.max(0, Math.min(clip.frames - 1, Math.floor(v * clip.fps + 1e-8)))), log.width, log.height, o, paint);
    // When the video reaches each step, in seconds of the scene, by step number
    // and by mark name, so other elements can come in with a step.
    g.times = {};
    for (const st of steps) {
      if (st.t < from) continue;
      g.times[st.step] = sceneTime(clock, st.t);
      if (st.name) g.times[st.name] = g.times[st.step];
    }
    return g;
  }

  // An AI presenter that "explainroo presenter" made: assets/presenters/<name>.mp4.
  // It plays without sound from where the scene's narration starts, so the lips
  // follow the voice of the video. It stands beside the content, or below it in
  // a tall frame, with a small label that says it is an AI person.
  presenter(name, o = {}) {
    const { safe } = this;
    // A card of its own shape, which the clip fills, cut to fit.
    const place = this.portrait
      ? { x: this.cx, y: safe.bottom - safe.h * 0.24, w: safe.w * 0.8, h: safe.h * 0.42 }
      : { x: safe.right - safe.w * 0.15, y: this.cy, w: safe.w * 0.28, h: safe.h * 0.74 };
    const at = o.at ?? this.voice.start;
    const { label = 'AI presenter', ...rest } = o;
    const box = this.clip(`assets/presenters/${name}.mp4`, { frame: 'card', fit: 'cover', ...place, ...rest, at, volume: 0 });
    if (label !== false) {
      const size = Math.max(18, Math.round(Math.min(safe.w, safe.h) * 0.026));
      this.text(label, { x: box.x, y: box.bottom + size * 1.1, size, color: 'muted', at, out: o.out });
    }
    return box;
  }

  _picture(src, source, naturalWidth, naturalHeight, o, paint) {
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
    // check's hint about the cover: how much of an image fit: 'cover' cuts off.
    if (this.engine.cropLog && typeof source !== 'function' && !paint && (o.fit ?? 'cover') === 'cover') {
      const cut = w / h > ratio ? { sides: 'top and bottom', part: 1 - (h * ratio) / w } : { sides: 'left and right', part: 1 - w / (h * ratio) };
      if (cut.part > 0.04) this.engine.cropLog.push({ src: String(src), id: o.id ?? null, ...cut });
    }
    this._push(x, y, life, o);
    // The line on the outline: a rough card's, a window's, or o.border on a bare image.
    const border = frame === 'card' && th.stroke.rough ? th.stroke.width * 0.8 : bar ? 2 : frame === 'none' && o.border ? th.stroke.width : 0;
    this._logShape('image', { w: fw, h: fh }, this._settled(life), o, src, { border });
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
    if (img && paint) paint(ctx, img, -w / 2, iy - h / 2, w, h);
    else if (img) ctx.drawImage(img, -dw / 2, iy - dh / 2, dw, dh);
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
    const call = this._call('annotate');
    const th = this.theme;
    const b = this._point(target);
    const pad = o.padding ?? 14;
    const type = o.type ?? 'underline';
    const color = colorOf(th, o.color ?? 'accent');
    const w = b.w + pad * 2;
    const h = b.h + pad * 2;
    const name = o.id !== undefined && o.id !== null ? `the ${type} "${o.id}"` : typeof target === 'string' ? `the ${type} around "${target}"` : `the ${call} (a ${type}) around ${Math.round(b.x)},${Math.round(b.y)}`;
    // When the element it marks comes and goes. With "defaults": "0.5", a mark
    // without an out of its own leaves with it, the same way.
    const marked = typeof target === 'string' ? this._ids.get(target)?.life ?? null : null;
    const given = o.out !== undefined;
    if (marked && !given && marked.gone !== Infinity && newDefaults(this.engine.config)) {
      const exit = marked.gone - marked.out;
      o = { ...o, out: marked.out, ...(exit > 1e-6 ? { outDur: exit * this.pace } : { exit: 'none' }) };
    }
    const life = this._life(o, 'annotate', { enter: 'draw', dur: o.dur ?? (type === 'circle' ? 0.8 : 0.6), label: type });
    // For check: when the mark is on screen and when what it marks has gone.
    const marks = this.engine.markLog;
    if (marks && marked && !marks.has(`${this.id}|${call}`)) {
      const own = this._lifetime(this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), o.exit ?? 'fade', o.outDur ?? 0.45);
      marks.set(`${this.id}|${call}`, { name, target, at: own.at, gone: own.gone, targetOut: marked.out, targetGone: marked.gone, spec: marked.spec, given });
    }
    // Where the mark's line runs, around the target's middle. A highlight is a
    // fill over its target, with no line.
    const line = () => {
      const yy = h / 2 - pad * 0.4;
      switch (type) {
        case 'underline': return samplePath(`M${-w / 2} ${yy}Q0 ${yy + 8} ${w / 2} ${yy - 4}`);
        case 'circle': return along([...ring(0, 0, w * 0.56, h * 0.625, 48), [w * 0.56, 0]]);
        case 'box': return along([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]]);
        case 'strike': return along([[-w / 2, 4], [w / 2, -4]]);
        case 'cross': return [...along([[-w / 2, -h / 2], [w / 2, h / 2]]), ...along([[w / 2, -h / 2], [-w / 2, h / 2]])];
        case 'bracket': return along([[-w / 2 + 16, -h / 2], [-w / 2, -h / 2], [-w / 2, h / 2], [-w / 2 + 16, h / 2]]);
        default: return [];
      }
    };
    if (this.engine.layoutLog && type !== 'highlight' && newDefaults(this.engine.config)) {
      // The camera keeps a mark with what it marks, with "defaults": "0.5".
      const r = bounds(line());
      if (Number.isFinite(r.x0)) this._attach('annotate', this.time(o.at ?? 0), o.out === undefined ? Infinity : this.time(o.out), this._designBox(b.x + (r.x0 + r.x1) / 2, b.y + (r.y0 + r.y1) / 2, r.x1 - r.x0, r.y1 - r.y0), { ends: [typeof target === 'string' ? target : null], around: this._designBox(b.x, b.y, b.w, b.h) });
    }
    if (!life) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    if (this.engine.drawLog && type !== 'highlight' && life.p >= 1) {
      const t = this._designBox(0, 0, b.w, b.h);
      this._logStroke('annotate', line(), this._settled(life), { target: { x0: t.x - t.w / 2, y0: t.y - t.h / 2, x1: t.x + t.w / 2, y1: t.y + t.h / 2 }, name });
    }
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
    const size = o.size ?? (this._v6 ? SCALE.body : 50);
    const x = o.x ?? (this.platform ? this.safe.x + this.safe.w * 0.06 : this.W * 0.2);
    let y = o.y ?? this._y(0.3);
    const width = o.width ?? this._w(0.62);
    // A look with "list": "cards", like studio, puts each item on a card of
    // its own, numbered unless the list has a bullet. card: false leaves them out.
    // With "defaults": "0.6" the items get more room between them.
    const gap = o.gap ?? size * (th.list === 'cards' && o.card !== false ? 1.05 : this._v6 ? 0.8 : 0.55);
    // The cards keep a little room between them, and a gap too small for that
    // leaves them out, as does a list of one item, often one of several lists
    // placed close together.
    const padV = clamp((gap - size * 0.2) / 2, 0, size * 0.42);
    const cards = th.list === 'cards' && o.card !== false && padV >= size * 0.15 && items.length > 1;
    const bullet = o.bullet ?? (cards ? 'badge' : 'dot');
    const indent = size * 1.25;
    const base = this.time(o.at ?? 0);
    const stagger = (o.stagger ?? 0.7) / this.pace;
    const role = o.font ?? 'body';
    const font = fontString(th, role, size, o.weight);
    const out = [];
    const all = items.map((raw) => (typeof raw === 'string' ? { text: raw } : raw));
    // The cards are as wide as the widest item.
    const lays = all.map((it) => layoutText(ctx, { str: it.text, font, size, maxWidth: width - indent, lineHeight: 1.2 }));
    const padH = size * 0.45;
    const cardW = indent + Math.max(0, ...lays.map((l) => l.width)) + padH * 2;
    all.forEach((it, i) => {
      const at = it.at !== undefined ? this.time(it.at) : Array.isArray(o.at) ? this.time(o.at[i]) : base + i * stagger;
      const lay = lays[i];
      if (cards) {
        const ch = lay.height + padV * 2;
        this._box(null, { x: x - padH + cardW / 2, y: y + lay.height / 2, w: cardW, h: ch, radius: Math.min(th.radius, ch / 2), at, out: it.out ?? o.out, enter: o.enter ?? th.enter.list, sfx: null }, 'list');
      }
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
      case 'badge': {
        // A number on a disc of the color, for lists on cards.
        this.pen.draw(ctx, { kind: 'ellipse', w: size * 1.04, h: size * 1.04 }, { fill: color, stroke: 'none', width: 0, seed: 21 + i, fillStyle: 'solid', rough: false }, { stroke: 1, fill: 1 });
        ctx.font = fontString(th, 'display', size * 0.6);
        ctx.fillStyle = this._autoTextColor(color, th.surface);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), 0, size * 0.02);
        break;
      }
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
    this._reveal(`number|${++this._revealCalls}`, {
      what: `the number counting to ${value}`, at, end: at + dur, out: o.out === undefined ? Infinity : this.time(o.out),
      missing: (t) => `has counted ${Math.floor(ease.out(clamp((t - at) / dur)) * 100)}% of the way`,
      advice: `give it an earlier at, or a shorter dur than ${o.dur ?? 1.4}`,
    });
    const cp = ease.out(clamp((this.t - at) / dur));
    const v = lerp(from, value, cp);
    // With "defaults": "0.6" the number is written the way the video's
    // language writes it, like 1 050 and 52,50 in French, and `locale` asks
    // for another. A unit in suffix or prefix then stays with the number, as
    // its space doesn't break.
    const locale = o.locale ?? (this._v6 ? LOCALES[this.lang] ?? this.lang : null);
    let fmt;
    let prefix = o.prefix ?? '';
    let suffix = o.suffix ?? '';
    if (locale) {
      let nf;
      try {
        nf = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: o.group !== false });
      } catch {
        throw new SceneError(`number: locale "${locale}" is not a language tag; use one like "fr-FR" or "de-DE"`);
      }
      fmt = (n) => nf.formatToParts(n).map((part) => (part.type === 'group' && o.separator !== undefined ? o.separator : part.value)).join('');
      prefix = String(prefix).replace(/ $/, '\u00a0');
      suffix = String(suffix).replace(/^ /, '\u00a0');
    } else {
      fmt = (n) => {
        const s = Math.abs(n).toFixed(decimals);
        const [int, dec] = s.split('.');
        const grouped = o.group === false ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, o.separator ?? ',');
        return (n < 0 ? '-' : '') + grouped + (dec ? '.' + dec : '');
      };
    }
    const str = `${prefix}${fmt(v)}${suffix}`;
    const counting = cp < 1 ? { name: `the number counting to ${value}`, doing: 'still counting' } : null;
    return this._text(str, { font: 'display', size: 150, color: o.color ?? 'accent', ...o, at, sfx: null, enter: o.enter ?? th.enter.number ?? 'fade', dur: o.enterDur ?? 0.4, id: o.id, _counting: counting }, 'number');
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
      const ls = o.labelSize ?? (this._v6 ? SCALE.axis : 34);
      const vs = o.valueSize ?? (this._v6 ? SCALE.value : 40);
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
    // With "defaults": "0.6" a clean look draws the axis as a thin muted line,
    // so the bars stand out.
    const fine = this._v6 && !th.stroke.rough;
    this.pen.draw(ctx, { kind: 'poly', points: [[x - w / 2 - 20, base], [x + w / 2 + 20, base]] }, { stroke: colorOf(th, fine ? 'muted' : 'ink'), width: fine ? Math.max(2, th.stroke.width * 0.6) : th.stroke.width, seed: this._seed('axis', o), single: true }, { stroke: ease.inOut(axisLife.p), fill: 1 });
    items.forEach((d, i) => {
      const t0 = barAt[i];
      const g = ease.out(clamp((this.t - t0) / ((o.growDur ?? 0.9) / this.pace)));
      const cx = x - w / 2 + slot * i + slot / 2;
      // With "defaults": "0.6" a small value keeps a bar you can see.
      const bh = this._v6 && d.value > 0 ? Math.max((d.value / max) * h, 8) : (d.value / max) * h;
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
          const vs = o.valueSize ?? (this._v6 ? SCALE.value : 40);
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
        const ls = o.labelSize ?? (this._v6 ? SCALE.axis : 34);
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

  // values: one array of numbers, or several series that share one scale, as
  // { 'Name': [...] } or [{ label, values, color }]. Each of several series
  // gets its label at the end of its line.
  lineChart(values, o = {}) {
    const th = this.theme;
    const ctx = this.ctx;
    const many = !(Array.isArray(values) && values.every((v) => typeof v === 'number'));
    const series = many ? chartSeries(values).map((d, i) => ({ ...d, color: d.color ?? palette(th, i) })) : [{ values, color: o.color ?? 'accent' }];
    const x = o.x ?? this.cx;
    const y = o.y ?? this.cy;
    const w = o.w ?? this._w(0.6);
    const h = o.h ?? (this.platform ? this.safe.h * 0.44 : this.H * 0.44);
    const all = series.flatMap((d) => d.values);
    const lo = o.min ?? Math.min(0, ...all);
    const hi = o.max ?? Math.max(...all) * 1.1;
    const count = Math.max(...series.map((d) => d.values.length));
    const place = (list) => list.map((v, i) => [x - w / 2 + (w * i) / Math.max(1, count - 1), y + h / 2 - ((v - lo) / (hi - lo || 1)) * h]);
    series.forEach((d) => { d.pts = place(d.values); });
    const ls = o.labelSize ?? (this._v6 ? SCALE.axis : 30);
    // The names at the ends of the lines, moved apart so none touches another.
    const ns = SCALE.label;
    const nameFont = fontString(th, 'body', ns, BOLD.body);
    const names = many ? endLabels(series, ns * 1.2).map((n) => ({ ...n, x: n.end[0] + 18 + (o.dots === false ? 0 : 9) })) : [];
    const axisLabels = (o.labels ?? []).slice(0, count).map((l, i) => ({ text: String(l), x: x - w / 2 + (w * i) / Math.max(1, count - 1), y: y + h / 2 + 14 }));
    this._register(o.id, x, y, w, h);
    if (this.engine.layoutLog) {
      // The ends of the axes, the dots and the labels under the axis count
      // for the camera, not for arrows.
      const pad = 12 + th.stroke.width * 1.3;
      const around = this._designBox(x, y, w + pad * 2, h + pad * 2);
      const text = this._textExtent([
        ...axisLabels.map((l) => ({ ...l, font: fontString(th, 'body', ls), base: 'top' })),
        ...names.map((n) => ({ text: n.text, x: n.x, y: n.y, font: nameFont, align: 'left' })),
      ]);
      this._pendingExtra = text ? unionBox(around, text) : around;
    }
    const life = this._life(o, 'chart', { enter: 'draw', dur: o.dur ?? 1.6 });
    if (!life) return geom(x, y, w, h);
    ctx.save();
    ctx.globalAlpha *= life.q > 0 ? 1 - ease.in(life.q) : 1;
    const p = ease.inOut(life.p);
    this.pen.draw(ctx, { kind: 'poly', points: [[x - w / 2, y - h / 2 - 10], [x - w / 2, y + h / 2], [x + w / 2 + 10, y + h / 2]] }, { stroke: colorOf(th, 'muted'), width: th.stroke.width * 0.7, seed: this._seed('axes', o), single: true }, { stroke: clamp(p * 3), fill: 1 });
    // Several lines get no area under them unless area: true, so one doesn't
    // hide another.
    if (many ? o.area === true : o.area !== false) {
      for (const d of series) {
        const color = colorOf(th, d.color);
        ctx.save();
        ctx.globalAlpha *= clamp((life.p - 0.6) / 0.4) * 0.9;
        ctx.beginPath();
        ctx.moveTo(d.pts[0][0], y + h / 2);
        d.pts.forEach((pt) => ctx.lineTo(pt[0], pt[1]));
        ctx.lineTo(d.pts[d.pts.length - 1][0], y + h / 2);
        ctx.closePath();
        const gr = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
        gr.addColorStop(0, withAlpha(color, many ? 0.2 : 0.35));
        gr.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      }
    }
    series.forEach((d, k) => {
      const color = colorOf(th, d.color);
      this.pen.draw(ctx, { kind: 'poly', points: d.pts }, { stroke: color, width: o.width ?? th.stroke.width * 1.3, seed: this._seed('series', o) + (many ? k : 0), single: true, glow: th.stroke.glow ?? 0 }, { stroke: p, fill: 1 });
    });
    if (o.dots !== false) {
      series.forEach((d) => {
        const color = colorOf(th, d.color);
        d.pts.forEach((pt, i) => {
          const k = clamp((p - i / Math.max(1, count - 1)) * 6);
          if (k <= 0) return;
          ctx.save();
          ctx.translate(pt[0], pt[1]);
          ctx.scale(ease.outBack(k), ease.outBack(k));
          this.pen.draw(ctx, { kind: 'ellipse', w: 18, h: 18 }, { fill: color, stroke: th.bg, width: 3, seed: i + 3, fillStyle: 'solid', rough: false }, { stroke: 1, fill: 1 });
          ctx.restore();
        });
      });
    }
    // check reads the chart's words like any text, so a held shot that cuts
    // them, small or faint ones are found.
    const settled = this._settled(life);
    if (axisLabels.length) {
      ctx.font = fontString(th, 'body', ls);
      ctx.fillStyle = colorOf(th, 'muted');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const l of axisLabels) {
        if (!l.text) continue;
        ctx.fillText(l.text, l.x, l.y);
        const lw = ctx.measureText(l.text).width;
        this._logText({ text: l.text, x0: l.x - lw / 2, y0: l.y, x1: l.x + lw / 2, y1: l.y + ls, size: ls, fg: ctx.fillStyle, bg: null, settled });
      }
    }
    const shown = clamp((life.p - 0.85) / 0.15);
    if (names.length && shown > 0) {
      ctx.save();
      ctx.globalAlpha *= shown;
      ctx.font = nameFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const n of names) {
        ctx.fillStyle = colorOf(th, n.color);
        ctx.fillText(n.text, n.x, n.y);
        const nw = ctx.measureText(n.text).width;
        this._logText({ text: n.text, x0: n.x, y0: n.y - ns / 2, x1: n.x + nw, y1: n.y + ns / 2, size: ns, fg: ctx.fillStyle, bg: null, settled: settled && shown >= 1 });
      }
      ctx.restore();
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
      const ls = o.labelSize ?? (this._v6 ? SCALE.axis : 32);
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
          const ls = o.labelSize ?? (this._v6 ? SCALE.axis : 32);
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
    const call = this._call('code');
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
    if (!steps && (reveal === 'type' || reveal === 'lines')) {
      const total = lines.length;
      const out = o.out === undefined ? Infinity : this.time(o.out);
      this._reveal(`code|${++this._revealCalls}`, {
        what: this._named('code', call, o.title, o.id), at, out,
        end: reveal === 'lines' ? startText + (total - 1) * lineDelay : startText + typeDur,
        missing: (t) => (reveal === 'lines' ? `shows ${clamp(Math.floor((t - startText) / lineDelay) + 1, 0, total)} of its ${total} lines` : `has typed ${Math.floor(clamp((t - startText) / typeDur) * 100)}% of its text`),
        advice: reveal === 'lines' ? `give it an earlier at, or a smaller lineDelay than ${o.lineDelay ?? 0.3}` : `give it an earlier at, or a higher cps than ${o.cps ?? 40}`,
      });
    }
    // The first line or step shows when its typing or its first line begins.
    this._window(this._named('code', call, o.title, o.id), at, o, reveal === 'type' || reveal === 'lines' ? startText : at, 'give it a later at');
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
    // The first step types itself or shows its lines one by one. A step that
    // changes into the next is no reveal.
    const revealing = morph?.to ? 'none' : reveal;
    const doing = revealing === 'type' && this.t < startText + typeDur ? 'still typing' : revealing === 'lines' && this.t < startText + (lines.length - 1) * lineDelay ? 'still showing its lines' : null;
    const partial = this._partial(doing && { name: this._named('code', call, o.title, o.id), doing });
    this._logShape('code', { w, h }, this._settled(life), o, o.title || '', { border: th.stroke.rough ? th.stroke.width * 0.8 : 0, call, partial });
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
    // A highlighted line. With "defaults": "0.6" it also gets a bar in the
    // accent color at its left edge.
    const markLine = (n) => {
      ctx.fillRect(-w / 2 + 6, top + (n - 1) * lh - lh * 0.22, w - 12, lh);
      if (!this._v6) return;
      const fill = ctx.fillStyle;
      ctx.fillStyle = colorOf(th, 'accent');
      ctx.fillRect(-w / 2 + 6, top + (n - 1) * lh - lh * 0.22, 6, lh);
      ctx.fillStyle = fill;
    };
    if (steps && morph.to) {
      const drawHighlight = (step, alpha) => {
        const hl = Array.isArray(step.highlight) ? step.highlight : step.highlight ? [step.highlight] : [];
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = C.highlight;
        for (const n of hl) markLine(n);
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
        for (const n of hl) markLine(n);
        ctx.restore();
      }
    }
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const room = w / 2 - pad * 0.5 - (left + numW);
    (steps || [{ lines }]).forEach((step, n) => step.lines.forEach((line, i) => {
      if (ctx.measureText(line).width > room) this._overflow(`line ${i + 1}${steps ? ` of step ${n + 1}` : ''} of ${this._named('code', call, o.title, o.id)} ("${line.trim().slice(0, 40)}") is wider than its window; shorten it, lower size or raise w`);
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
    this._logText({ text: 'code', x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: C.fg, bg: C.bg, block: true, partial });
    ctx.restore();
    return geom(x, y, w, h);
  }

  // lines: "$ command" or plain output strings, or { cmd, at } / { out, at, color }.
  terminal(lines, o = {}) {
    const call = this._call('terminal');
    const th = this.theme;
    const ctx = this.ctx;
    const T = th.terminal;
    const size = o.size ?? 32;
    const lh = size * 1.55;
    const pad = size * 0.9;
    const barH = size * 1.5;
    const items = lines.map((l) => (typeof l === 'string' ? (l.startsWith('$ ') ? { cmd: l.slice(2) } : { out: l }) : l));
    // With "defaults": "0.5", a terminal without an at of its own comes in with its
    // first line, as code with steps does.
    const own = o.at !== undefined;
    if (!own && items[0]?.at !== undefined && newDefaults(this.engine.config)) o = { ...o, at: items[0].at };
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
    this._reveal(`terminal|${++this._revealCalls}`, {
      what: this._named('terminal', call, o.title, o.id), at, out: o.out === undefined ? Infinity : this.time(o.out),
      end: Math.max(at, ...timed.map((r) => r.end)),
      missing: (t) => `shows ${timed.filter((r) => r.end <= t + 1e-6).length} of its ${timed.length} lines`,
      advice: `give it an earlier at, or a higher cps than ${o.cps ?? 22}`,
    });
    if (timed.length) {
      const first = items[0].at;
      const like = first === undefined ? '' : `, like at: ${typeof first === 'string' ? `'${first}'` : first}`;
      this._window(this._named('terminal', call, o.title, o.id), at, o, timed[0].start, own
        ? `give it the at of its first line${like}`
        : `give it the at of its first line${like}, or add "defaults": "0.5" to video.json, where a terminal without an at of its own comes in with its first line`);
    }
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
    // A command that is typing, or lines that are still to come.
    const typing = timed.some((r) => r.cmd !== undefined && this.t >= r.start && this.t < r.end);
    const pending = this.t < Math.max(at, ...timed.map((r) => r.end));
    const partial = this._partial(typing || pending ? { name: this._named('terminal', call, o.title, o.id), doing: typing ? 'still typing' : 'still showing its lines' } : null);
    this._logShape('terminal', { w, h }, this._settled(life), o, o.title ?? '', { border: th.stroke.rough ? th.stroke.width * 0.8 : 0, call, partial });
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
    // A command written with the prompt in front shows it twice.
    const prompt = String(o.prompt ?? '$');
    timed.forEach((it, i) => {
      const cmd = it.cmd === undefined ? null : String(it.cmd);
      if (cmd !== null && prompt && (cmd === prompt || cmd.startsWith(`${prompt} `))) {
        this._warn(`the command "${cmd.slice(0, 40)}" of ${this._named('terminal', call, o.title, o.id)} starts with the prompt "${prompt}", which the terminal adds itself, so it shows "${prompt} ${cmd.slice(0, 40)}"; write it without the prompt, like { cmd: '${cmd.slice(prompt.length + 1).replace(/'/g, "\\'").slice(0, 40)}' }`, `prompt ${call} ${i}`);
      }
    });
    for (const it of timed) {
      for (const part of String(it.cmd ?? it.out ?? '').split('\n')) {
        const width = ctx.measureText(part).width + (it.cmd !== undefined ? promptW : 0);
        if (width > w - pad * 2) this._overflow(`the line "${part.slice(0, 40)}" of ${this._named('terminal', call, o.title, o.id)} is wider than the terminal; shorten it, lower size or raise w`);
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
    // cursor: false shows no cursor. With "defaults": "0.6" a terminal whose
    // last line is output has no empty prompt line under it once it is shown.
    const last = timed[timed.length - 1];
    if (o.cursor === false || (this._v6 && last && last.cmd === undefined && this.t >= last.start)) cursor = null;
    if (cursor && (cursor.typing || Math.floor(this.T * 2) % 2 === 0)) {
      ctx.fillStyle = T.fg;
      ctx.globalAlpha *= 0.85;
      ctx.fillRect(cursor.x + 4, cursor.y + size * 0.08, size * 0.55, size * 1.05);
    }
    ctx.restore();
    this._logText({ text: 'terminal', x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, size, fg: T.fg, bg: T.bg, block: true, partial });
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

// The narrowest layout of a text with as many lines as `lay`, so the lines come
// out about the same length.
function balanced(ctx, lay, spec) {
  let lo = spec.maxWidth / lay.lines.length;
  let hi = spec.maxWidth;
  let best = lay;
  for (let k = 0; k < 12 && hi - lo > 2; k++) {
    const mid = (lo + hi) / 2;
    const next = layoutText(ctx, { ...spec, maxWidth: mid });
    if (next.lines.length > lay.lines.length) lo = mid;
    else {
      hi = mid;
      best = next;
    }
  }
  return best;
}

function geom(x, y, w, h, shape = 'rect') {
  return { x, y, w, h, shape, left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

function palette(th, i) {
  const order = [th.accent, 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink', 'red'];
  const uniq = [...new Set(order)];
  return uniq[i % uniq.length];
}

// The series of a line chart: { 'Name': [...] } or [{ label, values, color }].
function chartSeries(values) {
  const list = Array.isArray(values) ? values : values && typeof values === 'object' ? Object.entries(values).map(([label, v]) => ({ label, values: v })) : null;
  if (!list?.length) throw new SceneError("lineChart: give it an array of numbers, or several series like { 'Compound': [...], 'Simple': [...] } or [{ label, values, color }]");
  return list.map((d, i) => {
    if (!d || !Array.isArray(d.values) || !d.values.length || !d.values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new SceneError(`lineChart: series ${d?.label !== undefined ? `"${d.label}"` : i + 1} needs values, an array of numbers`);
    }
    return { label: d.label === undefined ? '' : String(d.label), values: d.values, color: d.color };
  });
}

// Where the names at the ends of several lines go: beside each line's last
// point, moved up or down until every two are `gap` apart, and as close to
// their lines as that allows.
function endLabels(series, gap) {
  const labels = series.filter((d) => d.label).map((d) => ({ text: d.label, color: d.color, end: d.pts[d.pts.length - 1], y: d.pts[d.pts.length - 1][1] }));
  labels.sort((a, b) => a.y - b.y);
  // Runs of labels that would touch move as one block, centered on their lines.
  const blocks = labels.map((l) => ({ items: [l], want: l.y }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i + 1 < blocks.length; i++) {
      const [a, b] = [blocks[i], blocks[i + 1]];
      const top = (bl) => bl.want - ((bl.items.length - 1) * gap) / 2;
      if (top(a) + a.items.length * gap > top(b)) {
        const items = [...a.items, ...b.items];
        blocks.splice(i, 2, { items, want: items.reduce((sum, l) => sum + l.end[1], 0) / items.length });
        merged = true;
        break;
      }
    }
  }
  for (const bl of blocks) bl.items.forEach((l, i) => { l.y = bl.want - ((bl.items.length - 1) * gap) / 2 + i * gap; });
  return labels;
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
