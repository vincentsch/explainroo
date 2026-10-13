// Boots the engine in a page: loads the project state, fonts, icons, images
// and scenes, then exposes frame rendering, checks and the soundtrack.
import rough from '/vendor/rough.js';
import { Stage, SceneError } from './stage.js';
import { getTheme, makeBackground, fontString, colorOf } from './themes.js';
import { Pen } from './pen.js';
import { drawTransition } from './transitions.js';
import { buildPhrases, drawCaptions } from './captions.js';
import { hashStr, mulberry32, suggest, suggestColor, contrast, opaque, withAlpha, parseColor, rgba } from './util.js';
import { layoutAreas } from './layout.js';
import { loadClips, ClipFrames } from './clips.js';
import { UI } from './ui.js';
import { playbackTextIssue } from './readability.js';

Stage.UI = UI;

export async function fetchState() {
  const res = await fetch('/__state.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not load project state: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadFonts(theme, config) {
  const manifest = await (await fetch('/fonts/fonts.json')).json();
  const wanted = new Set(Object.values(theme.fonts).map((f) => f.family));
  // The UI kit (s.ui) draws app screens in Inter and headlines in Instrument Serif.
  wanted.add('Inter');
  wanted.add('Instrument Serif');
  wanted.add('Noto Sans Devanagari');
  const faces = [];
  const add = (family, url, o) => {
    const face = new FontFace(family, `url(${url})`, { weight: String(o.weight ?? 400), style: o.style ?? 'normal', unicodeRange: o.unicodeRange, display: 'block' });
    document.fonts.add(face);
    faces.push(face.load().catch(() => {
      throw new Error(`font "${family}" from ${url} could not be loaded`);
    }));
  };
  for (const f of manifest) if (wanted.has(f.family)) add(f.family, `/fonts/${f.file}`, f);
  // A video's own fonts, from "fonts" in video.json.
  for (const f of config.fonts || []) add(f.family, '/project/' + f.src.split('/').map(encodeURIComponent).join('/'), f);
  await Promise.all(faces);
  // Make sure every weight used by the theme is ready before the first frame.
  await Promise.all(Object.values(theme.fonts).map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`)));
}

async function loadImages(assets) {
  const images = new Map();
  await Promise.all(
    assets
      .filter((a) => /\.(png|jpe?g|webp|gif|svg)$/i.test(a))
      .map(async (a) => {
        const img = new Image();
        img.src = '/project/' + a.split('/').map(encodeURIComponent).join('/');
        await img.decode().catch(() => {
          throw new Error(`image ${a} could not be decoded`);
        });
        images.set(a, img);
      }),
  );
  return images;
}

export class Engine {
  constructor({ canvas, state, scenes, icons, images, clips = new Map(), scale = 1, transparent = false, sfxNames = [] }) {
    const { config, timeline } = state;
    this.state = state;
    this.config = config;
    this.timeline = timeline;
    this.scenesModule = scenes;
    this.W = config.width;
    this.H = config.height;
    const areas = layoutAreas(config, this.W, this.H);
    this.safeArea = areas.safe;
    this.captionArea = areas.captions;
    this.captionBand = areas.band;
    this.appArea = areas.app;
    this.fps = config.fps;
    this.scale = scale;
    this.transparent = transparent;
    this.theme = getTheme(config.theme, config.look);
    this.pen = new Pen({ rough, theme: this.theme });
    this.icons = icons;
    this.iconCache = new Map();
    this.mathCache = new Map();
    this.lateMath = new Map();
    this.collectingMath = false;
    this.images = images;
    this.clips = clips;
    this.clipFrames = new ClipFrames();
    this.clipProbe = null;
    this.sfxNames = sfxNames;
    this.sfxMode = config.sfx;
    this.recorder = null;
    this.textLog = null;
    this.errors = [];
    this.canvas = canvas;
    // H.264 needs even dimensions.
    canvas.width = 2 * Math.round((this.W * scale) / 2);
    canvas.height = 2 * Math.round((this.H * scale) / 2);
    this.ctx = canvas.getContext('2d', { alpha: transparent });
    this.background = transparent ? null : makeBackground(this.theme, this.W, this.H, config.seed);
    this.phrases = config.captions ? buildPhrases(timeline, this.H > this.W ? 28 : 46) : [];
    this.buffers = [0, 1].map(() => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      return c;
    });
    const ids = new Set(timeline.scenes.map((s) => s.id));
    this.extraScenes = Object.keys(scenes).filter((k) => !ids.has(k));
    for (const sc of timeline.scenes) {
      if (typeof scenes[sc.id] !== 'function') {
        const have = Object.keys(scenes);
        throw new SceneError(`scenes.js has no function for scene "${sc.id}".${have.length ? ' Close names: ' + suggest(sc.id, have, 3).join(', ') : ''}`);
      }
    }
  }

  image(src) {
    const key = src.replace(/^\.?\//, '');
    const img = this.images.get(key) || this.images.get('assets/' + key);
    if (!img) throw new SceneError(`image "${src}" not found. Put it in the project's assets/ folder. Available: ${[...this.images.keys()].join(', ') || 'none'}`);
    return img;
  }

  clip(src) {
    const key = src.replace(/^\.?\//, '');
    const clip = this.clips.get(key) || this.clips.get('assets/' + key);
    if (!clip) throw new SceneError(`clip "${src}" not found. Put an MP4, MOV, WebM or M4V in the project's assets/ folder. Available: ${[...this.clips.keys()].join(', ') || 'none'}`);
    return clip;
  }

  clipImage(clip, frame) {
    if (this.recorder) return null;
    const key = this.clipFrames.key(clip, frame);
    if (this.clipProbe) {
      this.clipProbe.set(key, { clip, frame });
      return null;
    }
    const img = this.clipFrames.get(clip, frame);
    if (img) return img;
    if (this.clipFrames.errors.has(key)) throw this.clipFrames.errors.get(key);
    this.clipFrames.load(clip, frame).then(() => {
      this.clipFrames.trim();
      this.onClipFrame?.();
    }).catch((e) => {
      this.clipFrames.errors.set(key, e);
      this.onClipFrame?.();
    });
    return this.clipFrames.nearest(clip, frame);
  }

  async prepareFrame(T) {
    if (!this.clips.size) return;
    const needed = new Map();
    this.clipProbe = needed;
    try { this.renderFrame(T); }
    finally { this.clipProbe = null; }
    await Promise.all([...needed.values()].map(({ clip, frame }) => this.clipFrames.load(clip, frame)));
    this.clipFrames.trim(new Set(needed.keys()));
  }

  mathData(tex, display, scene, t) {
    const key = JSON.stringify([tex, display]);
    if (this.collectingMath) {
      if (!this.mathCache.has(key)) this.mathCache.set(key, null);
      return null;
    }
    if (!this.mathCache.has(key)) {
      this.lateMath.set(key, { scene, t, tex });
      // Late formulas still draw synchronously, including the frame that finds them.
      const req = new XMLHttpRequest();
      req.open('GET', this.mathURL(tex, display), false);
      req.send();
      this.mathCache.set(key, this.mathResponse(req.status, req.responseText));
    }
    return this.mathCache.get(key);
  }

  mathURL(tex, display) {
    return `/__math?tex=${encodeURIComponent(tex)}&display=${display ? '1' : '0'}`;
  }

  mathResponse(status, body) {
    if (status !== 200) {
      try { return { error: JSON.parse(body).error || body }; } catch { return { error: body }; }
    }
    return JSON.parse(body);
  }

  async loadMath() {
    this.collectingMath = true;
    try {
      for (const sc of this.timeline.scenes) {
        // Scene errors belong to check or render, as they do without formulas.
        try { this.drawScene(this.ctx, sc.index, 0); } catch {}
      }
    } finally {
      this.collectingMath = false;
    }
    await Promise.all([...this.mathCache.keys()].map(async key => {
      const [tex, display] = JSON.parse(key);
      const res = await fetch(this.mathURL(tex, display));
      this.mathCache.set(key, this.mathResponse(res.status, await res.text()));
    }));
  }

  sceneAt(T) {
    const list = this.timeline.scenes;
    let i = list.length - 1;
    while (i > 0 && T < list[i].start) i--;
    return i;
  }

  transitionFor(sc) {
    const name = sc.transition === 'auto' ? this.theme.transition : sc.transition;
    if (this.transparent && ['slide', 'wipe', 'brush'].includes(name)) return 'fade';
    return name || 'fade';
  }

  drawScene(ctx, index, t) {
    const sc = this.timeline.scenes[index];
    if (this.transparent) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.background) ctx.drawImage(this.background, 0, 0, this.W, this.H);
    if (this.config.boil > 0) this.pen.seedOffset = Math.floor((sc.start + t) * this.config.boil) % 997;
    const saved = Math.random;
    Math.random = mulberry32(hashStr(`random:${sc.id}`));
    const s = new Stage(this, ctx, sc, t);
    ctx.save();
    try {
      this.scenesModule[sc.id](s);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      err.scene = sc.id;
      err.sceneTime = t;
      throw err;
    } finally {
      Math.random = saved;
      ctx.restore();
    }
    return s;
  }

  renderFrame(T, ctx = this.ctx) {
    const i = this.sceneAt(T);
    const sc = this.timeline.scenes[i];
    const t = T - sc.start;
    const trName = this.transitionFor(sc);
    const trDur = Math.min(this.timeline.transitionSeconds, sc.dur * 0.5);
    if (i > 0 && sc.transition !== 'none' && trName !== 'cut' && t < trDur) {
      const prev = this.timeline.scenes[i - 1];
      const [a, b] = this.buffers;
      if (this.transparent) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      this.drawScene(a.getContext('2d', { alpha: this.transparent }), i - 1, T - prev.start);
      this.drawScene(b.getContext('2d', { alpha: this.transparent }), i, t);
      drawTransition(trName, ctx, a, b, t / trDur, this.W, this.H, hashStr(sc.id), this.transparent);
    } else {
      this.drawScene(ctx, i, t);
    }
    if (this.phrases.length) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      drawCaptions(ctx, this.phrases, T, this.theme, this.W, this.H, this.captionArea);
    }
    if (this.config.watermark) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      this.drawWatermark(ctx, this.config.watermark);
    }
  }

  // Small text in the bottom right corner of every frame, on a soft backing
  // so it stays readable over any scene. Platform formats cover that corner
  // with the app's own buttons, so there it sits at the top right of the part
  // of the frame the app leaves free.
  drawWatermark(ctx, text) {
    const th = this.theme;
    const m = Math.min(this.W, this.H);
    const size = Math.round(m * 0.028);
    const margin = Math.round(m * 0.028);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = fontString(th, 'body', size, th.fonts.body.family === 'Inter' ? 600 : th.fonts.body.family === 'Kalam' ? 700 : undefined);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    const padX = size * 0.6;
    const h = size * 1.6;
    const x = this.appArea ? this.appArea.right : this.W - margin;
    const y = this.appArea ? this.appArea.top + h / 2 : this.H - margin - h / 2;
    ctx.fillStyle = withAlpha(th.bg, 0.72);
    ctx.beginPath();
    ctx.roundRect(x - w - padX * 2, y - h / 2, w + padX * 2, h, h / 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(th.ink, 0.82);
    ctx.fillText(text, x - padX, y + size * 0.04);
    ctx.restore();
  }

  // Runs every scene over its duration without keeping pixels, collecting the
  // elements that enter (for sound effects) and any scene errors.
  collectEvents(step = 0.1) {
    const scratch = document.createElement('canvas');
    const save = { scale: this.scale };
    this.scale = 0.25;
    scratch.width = Math.round(this.W * 0.25);
    scratch.height = Math.round(this.H * 0.25);
    const ctx = scratch.getContext('2d', { alpha: false });
    const events = [];
    const errors = [];
    try {
      for (const sc of this.timeline.scenes) {
        const seen = new Map();
        this.recorder = { push: (e) => { if (!seen.has(e.key)) seen.set(e.key, e); } };
        const n = Math.ceil(sc.dur / step);
        for (let k = 0; k <= n; k++) {
          const t = Math.min(sc.dur, k * step);
          try {
            this.drawScene(ctx, sc.index, t);
          } catch (e) {
            errors.push({ scene: sc.id, t, message: e.message });
            break;
          }
        }
        for (const e of seen.values()) {
          if (e.at > sc.dur + 0.001) continue;
          events.push({ ...e, scene: sc.id, T: sc.start + e.at });
        }
      }
    } finally {
      this.recorder = null;
      this.scale = save.scale;
    }
    return { events, errors };
  }

  // Sound cues for the soundtrack: element entrances, explicit s.sfx() calls
  // and scene transitions, thinned so effects never pile up.
  sfxCues() {
    if (this.config.sfx === false && !this.clips.size) return { cues: [], clips: [], errors: [] };
    const { events, errors } = this.collectEvents();
    const clips = events.filter((e) => e.kind === 'clip' && e.volume > 0 && e.speed === 1 && e.hasAudio).map((e) => ({ ...e, start: e.T, end: e.T + e.end - e.at }));
    if (this.config.sfx === false) return { cues: [], clips, errors };
    const cues = [];
    for (const e of events) {
      if (!e.sfx) continue;
      if (!this.sfxNames.includes(e.sfx)) continue;
      const cue = { name: e.sfx, t: e.T, gain: e.gain ?? 1, explicit: !!e.explicit };
      if (e.pitch !== undefined) cue.pitch = e.pitch;
      if (['scribble', 'chalk', 'type', 'rise'].includes(e.sfx)) cue.dur = Math.max(0.15, Math.min(e.dur || 0.4, 3));
      cues.push(cue);
    }
    for (const sc of this.timeline.scenes) {
      if (sc.index === 0 || sc.transition === 'none') continue;
      const name = this.transitionFor(sc);
      if (name === 'cut') continue;
      const s = this.theme.sfx.transition;
      if (s) cues.push({ name: s, t: Math.max(0, sc.start - 0.05), gain: 0.8, explicit: true });
    }
    cues.sort((a, b) => a.t - b.t);
    const out = [];
    const last = new Map();
    let windowStart = 0;
    let inWindow = 0;
    for (const c of cues) {
      const prev = last.get(c.name);
      if (!c.explicit && prev !== undefined && c.t - prev < (c.name === 'tick' ? 0.045 : 0.12)) continue;
      if (c.t - windowStart > 0.5) {
        windowStart = c.t;
        inWindow = 0;
      }
      if (!c.explicit && inWindow >= 3 && c.name !== 'tick') continue;
      inWindow++;
      last.set(c.name, c.t);
      out.push(c);
    }
    return { cues: out, clips, errors };
  }

  // Samples every scene and reports layout problems.
  check(step = 0.25, viewWidth = null) {
    const issues = [];
    const add = (level, scene, t, message) => issues.push({ level, scene, t: t === null ? null : Math.round(t * 100) / 100, message });
    if (this.config.look) {
      for (const [key, min] of [['ink', 4.5], ['muted', 3]]) {
        if (contrast(this.theme[key], this.theme.bg) < min) add('warn', null, null, `${this.config.theme}: ${key} has low contrast against bg; use colors with a contrast of at least ${min}`);
      }
    }
    for (const id of this.extraScenes) add('warn', id, null, `scenes.js has a function "${id}" but script.md has no scene with that id, so it is never shown`);
    const scratch = document.createElement('canvas');
    scratch.width = this.canvas.width;
    scratch.height = this.canvas.height;
    const ctx = scratch.getContext('2d', { alpha: false });
    const { W, H } = this;
    const margin = Math.round(Math.min(W, H) * 0.035);
    const minSize = Math.round(Math.min(W, H) * 0.022);
    const uiMinSize = Math.round(Math.min(W, H) * 0.015);
    const colors = Object.fromEntries(['ink', 'accent', ...Object.keys(this.theme.colors)].map(name => [name, colorOf(this.theme, name)]));
    let colorCtx;
    const cssColor = color => {
      if (parseColor(color)) return color;
      if (!colorCtx) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        colorCtx = canvas.getContext('2d');
      }
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = '#000000';
      colorCtx.fillStyle = color;
      colorCtx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
      return rgba({ r, g, b, a: a / 255 });
    };
    const reported = new Set();
    const once = (key, fn) => {
      if (reported.has(key)) return;
      reported.add(key);
      fn();
    };
    this.cueNotes = [];
    for (const sc of this.timeline.scenes) {
      const entrances = [];
      this.recorder = { push: (e) => entrances.push(e) };
      const n = Math.ceil(sc.dur / step);
      for (let k = 0; k <= n; k++) {
        const t = Math.min(sc.dur - 0.001, k * step);
        this.textLog = [];
        try {
          this.drawScene(ctx, sc.index, t);
        } catch (e) {
          once(`err:${sc.id}:${e.message}`, () => add('error', sc.id, t, e.message));
          break;
        }
        for (const pr of this.textLog.filter((x) => x.problem)) once(`problem:${sc.id}:${pr.problem}`, () => add('error', sc.id, t, pr.problem));
        const texts = this.textLog.filter((x) => !x.problem && x.alpha > 0.5);
        for (const tx of texts) {
          if (viewWidth !== null) {
            const message = playbackTextIssue(tx, W, H, viewWidth);
            if (message) once(`playback:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, message));
          }
          const label = tx.text.length > 40 ? tx.text.slice(0, 37) + '...' : tx.text;
          // UI kit text (s.ui) may leave the frame on purpose while the
          // camera zooms or pans; app screens use smaller text than slides.
          const framed = !(tx.ui && tx.zoomed);
          if (tx.x0 < -1 || tx.y0 < -1 || tx.x1 > W + 1 || tx.y1 > H + 1) {
            if (framed) once(`off:${sc.id}:${tx.text}`, () => add('error', sc.id, t, `"${label}" runs off the frame (${Math.round(tx.x0)},${Math.round(tx.y0)} to ${Math.round(tx.x1)},${Math.round(tx.y1)} in a ${W}x${H} frame)`));
          } else if (this.appArea) {
            const a = this.appArea;
            if (framed && (tx.x0 < a.left - 2 || tx.y0 < a.top - 2 || tx.x1 > a.right + 2 || tx.y1 > a.bottom + 2)) {
              once(`app:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" is outside the ${this.config.format} safe area (${a.left},${a.top} to ${a.right},${a.bottom}), where the app's buttons, name or caption can cover it`));
            }
          } else if (framed && (tx.x0 < margin || tx.y0 < margin || tx.x1 > W - margin || tx.y1 > H - margin)) {
            once(`edge:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" sits closer than ${margin}px to the edge`));
          }
          const b = this.captionBand;
          if (b && tx.y1 > b.top + 2 && tx.y0 < b.bottom - 2 && tx.x1 > b.left && tx.x0 < b.right) {
            once(`cap:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" is in the caption band (y ${Math.round(b.top)} to ${Math.round(b.bottom)}), where captions can cover it; keep content above s.safe.bottom (${Math.round(this.safeArea.bottom)})`));
          }
          const least = tx.ui ? uiMinSize : minSize;
          if (!tx.block && Math.round(tx.size) < least) once(`small:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" is ${Math.round(tx.size)}px, hard to read (use at least ${least}px)`));
          const bg = opaque(tx.bg || this.theme.bg, this.theme.bg);
          if (typeof tx.fg === 'string' && contrast(tx.fg, bg) < 3) once(`contrast:${sc.id}:${tx.text}`, () => {
            const suggestion = suggestColor(cssColor(tx.fg), cssColor(bg), tx.size, Object.fromEntries(Object.entries(colors).map(([name, c]) => [name, cssColor(c)])));
            add('warn', sc.id, t, `"${label}" has low contrast against its background (${contrast(tx.fg, bg).toFixed(1)}:1); use color: '${suggestion.color}' (${suggestion.ratio.toFixed(1)}:1)`);
          });
        }
        // Overlaps only count when both are fully shown, not mid-fade.
        const solid = texts.filter((x) => x.alpha > 0.95);
        for (let a = 0; a < solid.length; a++) {
          for (let b = a + 1; b < solid.length; b++) {
            const A = solid[a];
            const B = solid[b];
            if (A.block && B.block) continue;
            // A dropdown or dialog (s.ui) covers what is under it.
            if ((A.ui || 1) !== (B.ui || 1)) continue;
            const ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
            const iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
            if (ix <= 4 || iy <= 4) continue;
            const small = Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0)) || 1;
            if ((ix * iy) / small > 0.15) {
              once(`overlap:${sc.id}:${A.text}:${B.text}`, () => add('error', sc.id, t, `"${A.text.slice(0, 30)}" overlaps "${B.text.slice(0, 30)}"`));
            }
          }
        }
      }
      this.recorder = null;
      this.textLog = null;
      const times = [...new Set(entrances.map((e) => Math.round(e.at * 100) / 100))].sort((a, b) => a - b);
      for (const e of entrances) {
        if (e.kind === 'clip') {
          if (e.volume > 0 && e.speed !== 1) once(`clip-sound:${sc.id}:${e.key}`, () => add('warn', sc.id, e.at, `clip "${e.src}" stays silent at speed ${e.speed}; use speed: 1 for its sound`));
          if (!e.loop && e.out - e.end > 1) once(`clip-freeze:${sc.id}:${e.key}`, () => add('hint', sc.id, e.end, `clip "${e.src}" freezes on its last frame from ${e.end.toFixed(2)}s until ${e.out.toFixed(2)}s; use loop: true or an earlier out`));
        }
        if (e.at > sc.dur) once(`late:${sc.id}:${e.key}`, () => add('error', sc.id, e.at, `a ${e.kind} is set to appear at ${e.at.toFixed(2)}s but the scene ends at ${sc.dur.toFixed(2)}s`));
      }
      if (!times.length) {
        add('warn', sc.id, null, 'nothing enters in this scene; add at least one element with an "at" time');
      } else {
        const marks = [0, ...times.filter((x) => x >= 0 && x <= sc.dur), sc.dur];
        for (let i = 1; i < marks.length; i++) {
          const gap = marks[i] - marks[i - 1];
          if (gap > 6) add('hint', sc.id, marks[i - 1], `no new element for ${gap.toFixed(1)}s (from ${marks[i - 1].toFixed(1)}s); consider revealing something on a cue in that stretch`);
        }
      }
    }
    const repeated = new Map();
    for (const c of this.cueNotes) repeated.set(`${c.scene}|${c.word.toLowerCase()}`, c);
    for (const c of repeated.values()) {
      add('hint', c.scene, null, `cue "${c.word}" means the first of the ${c.count} times it is spoken in this scene; if you meant a later one, use s.cue("${c.word}", 2) or a [#marker]`);
    }
    this.cueNotes = null;
    for (const { scene, t, tex } of this.lateMath.values()) add('error', scene, t, `math "${tex}" was not collected at the start; keep TeX strings fixed and always call s.math with at and out for timing`);
    return issues;
  }
}

// Boots the engine for render, check or studio pages.
export async function boot({ canvas, scale = 1, transparent = false, version = '' }) {
  const state = await fetchState();
  const theme = getTheme(state.config.theme, state.config.look);
  const [icons, images, scenesMod, audio, iconTags, clips] = await Promise.all([
    fetch('/engine/icons/lucide.json').then((r) => r.json()).then((j) => {
      // Old Lucide names keep working.
      for (const [alias, target] of Object.entries(j.aliases || {})) if (!j.icons[alias]) j.icons[alias] = j.icons[target];
      return j.icons;
    }),
    loadImages(state.assets),
    import(`/project/scenes.js?v=${encodeURIComponent(version || state.version)}`),
    import('/engine/audio/soundtrack.js').catch((e) => ({ SFX: {}, loadError: e })),
    fetch('/engine/icons/lucide-tags.json').then((r) => r.json()),
    loadClips(state.assets),
    loadFonts(theme, state.config),
  ]);
  const scenes = scenesMod.default;
  if (!scenes || typeof scenes !== 'object') throw new Error('scenes.js must "export default { sceneId(s) { ... } }"');
  const engine = new Engine({ canvas, state, scenes, icons, images, clips, scale, transparent, sfxNames: Object.keys(audio.SFX) });
  engine.iconTags = iconTags;
  await engine.loadMath();
  return { engine, audio, state };
}

// Mixes narration, music and sound effects in an OfflineAudioContext.
export async function renderAudio(engine, audio, { sampleRate = 48000 } = {}) {
  if (audio.loadError) throw new Error(`audio engine failed to load: ${audio.loadError.message}`);
  const { timeline, config } = engine.state;
  const { cues, clips, errors } = engine.sfxCues();
  const buffer = await audio.renderSoundtrack({
    duration: timeline.duration,
    sampleRate,
    voice: timeline.scenes.filter((s) => s.voice).map((s) => ({ url: '/project/' + s.voice.url + '?v=' + engine.state.version, start: s.voice.start })),
    voiceSpans: timeline.voiceSpans,
    music: config.music,
    sfx: cues,
    clips,
    scenes: timeline.scenes.map((s) => ({ start: s.start, dur: s.dur })),
  });
  return { buffer, cues, errors };
}
