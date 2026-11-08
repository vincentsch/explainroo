// Boots the engine in a page: loads the project state, fonts, icons, images
// and scenes, then exposes frame rendering, checks and the soundtrack.
import rough from '../vendor/rough.js';
import { Stage, SceneError, boundsRecorder } from './stage.js';
import { getTheme, makeBackground, fontString, colorOf } from './themes.js';
import { Pen } from './pen.js';
import { drawTransition } from './transitions.js';
import { buildPhrases, drawCaptions, buildChunks, drawBoldCaptions, captionHighlight } from './captions.js';
import { AUDIO_FILE, clamp, hashStr, mulberry32, suggest, suggestColor, contrast, luminance, opaque, withAlpha, parseColor, mixColor, rgba, cssColor, newDefaults } from './util.js';
import { overlapDepth, holds, crosses, bounds, inside, toEdge, grow } from './geometry.js';
import { layoutAreas } from './layout.js';
import { loadClips, soundURL, ClipFrames, FREEZE_SECONDS, FIT_SPEEDS } from './clips.js';
import { UI } from './ui.js';
import { Short } from './short.js';
import { playbackTextIssue } from './readability.js';
import { planCamera, cameraAt, cameraMoving, heldShot, continues, frameRect, backgroundShot } from './director.js';

Stage.UI = UI;
Stage.Short = Short;

// The color a scene painted behind a text, with s.bg or the kit's backdrop: a
// gradient from top to bottom, read at the text's height.
function pageColor(tx, H) {
  const p = tx.page;
  const top = p && cssColor(p.top);
  const bottom = p && cssColor(p.bottom);
  if (!top || !bottom) return null;
  return mixColor(top, bottom, clamp((tx.y0 + tx.y1) / 2 / H));
}

export async function fetchState() {
  const res = await fetch('/__state.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not load project state: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadFonts(theme, config, root = '/') {
  const manifest = await (await fetch(root + 'fonts/fonts.json')).json();
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
  for (const f of manifest) if (root === './' || wanted.has(f.family)) add(f.family, `${root}fonts/${f.file}`, f);
  if (root !== './' && ['ja', 'zh'].includes(config.language)) {
    const family = config.language === 'ja' ? 'Noto Sans JP' : 'Noto Sans SC';
    for (const weight of [400, 700]) add(family, `/language-fonts/${config.language}-${weight}.otf`, { weight });
  }
  // A video's own fonts, from "fonts" in video.json.
  for (const f of config.fonts || []) add(f.family, root + 'project/' + f.src.split('/').map(encodeURIComponent).join('/'), f);
  await Promise.all(faces);
  // Make sure every weight used by the theme is ready before the first frame.
  await Promise.all(Object.values(theme.fonts).map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`)));
}

async function loadImages(assets, root = '/') {
  const images = new Map();
  await Promise.all(
    assets
      .filter((a) => /\.(png|jpe?g|webp|gif|svg)$/i.test(a))
      .map(async (a) => {
        const img = new Image();
        img.src = root + 'project/' + a.split('/').map(encodeURIComponent).join('/');
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
    // Without a look file, getTheme gives the built-in look that every engine in
    // this page shares, so a brand color goes on this engine's own copy.
    const highlight = captionHighlight(config, this.theme);
    if (highlight.color) this.theme = { ...this.theme, caption: { ...this.theme.caption, active: highlight.color } };
    this.captionNote = highlight.note ?? null;
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
    this.drawLog = null;
    this.errors = [];
    this.canvas = canvas;
    // H.264 needs even dimensions.
    canvas.width = 2 * Math.round((this.W * scale) / 2);
    canvas.height = 2 * Math.round((this.H * scale) / 2);
    this.ctx = canvas.getContext('2d', { alpha: transparent });
    this.background = transparent ? null : makeBackground(this.theme, this.W, this.H, config.seed);
    // "bold": two to four big words at a time. Any other true value: phrases.
    this.phrases = config.captions && config.captions !== 'bold' ? buildPhrases(timeline, this.H > this.W ? 28 : 46) : [];
    this.chunks = config.captions === 'bold' ? buildChunks(timeline) : [];
    this.buffers = [0, 1].map(() => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      return c;
    });
    const ids = new Set(timeline.scenes.map((s) => s.id));
    this.extraScenes = Object.keys(scenes).filter((k) => !ids.has(k));
    // Every scene of the script without a function, each with a stub to paste
    // into scenes.js, and the names it has that no scene uses.
    const missing = timeline.scenes.filter((sc) => typeof scenes[sc.id] !== 'function').map((sc) => sc.id);
    if (missing.length) {
      const script = state.text?.files?.script ?? 'script.md';
      const names = missing.map((id) => `"${id}"`).join(', ');
      const stubs = missing.map((id) => `  ${/^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id)}(s) {\n    s.text('${id}', { y: s.safe.top + s.safe.h / 2, at: 0 });\n  },`).join('\n');
      const unused = this.extraScenes.length ? ` scenes.js has ${this.extraScenes.map((k) => `"${k}"`).join(', ')}, which no scene in ${script} uses. Rename ${this.extraScenes.length === 1 ? 'it' : 'them'}, or add these to the object that scenes.js exports:` : ' Add these to the object that scenes.js exports:';
      throw new SceneError(`scenes.js has no function for ${missing.length === 1 ? 'the scene' : 'the scenes'} ${names} of ${script}.${unused}\n${stubs}`);
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

  soundFile(src) {
    const key = src.replace(/^\.?\//, '');
    const files = this.state.assets.filter((a) => AUDIO_FILE.test(a));
    const file = [key, 'assets/' + key].find((name) => files.includes(name));
    if (!file) throw new SceneError(`sound file "${src}" not found. Put a wav, mp3, m4a, aac, flac, ogg or opus file in the project's assets/ folder. Available: ${files.join(', ') || 'none'}`);
    return file;
  }

  // Only decoding a sound file shows whether it can be read, and the server does
  // that. So check asks for each file that s.sound played in its last run.
  async soundFileIssues() {
    const issues = [];
    for (const [src, { scene, t }] of this.soundsPlayed ?? []) {
      const res = await fetch(soundURL('check', src));
      const { error } = res.ok ? await res.json() : { error: await res.text() };
      if (error) issues.push({ level: 'error', scene, t: Math.round(t * 100) / 100, message: error });
    }
    return issues;
  }

  clipImage(clip, frame) {
    if (this.recorder) return null;
    if (clip.video) {
      const video = clip.video;
      const time = Math.min(frame / clip.fps, Math.max(0, clip.duration - 0.04));
      if (!video.seeking && Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
      return video.readyState >= 2 ? video : null;
    }
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

  // Loads the clip frames that time T shows. It finds them by drawing the
  // frame on `ctx`. Motion blur passes a spare canvas here, so the picture it
  // is adding up on the main canvas stays as it is.
  async prepareFrame(T, ctx = this.ctx) {
    if (!this.clips.size) return;
    const needed = new Map();
    this.clipProbe = needed;
    try { this.renderFrame(T, ctx); }
    finally { this.clipProbe = null; }
    await Promise.all([...needed.values()].map(({ clip, frame }) => this.clipFrames.load(clip, frame)));
    this.clipFrames.trim(new Set(needed.keys()));
  }

  mathData(tex, display, scene, t) {
    const key = JSON.stringify([tex, display]);
    if (this.staticMath) return this.staticMath[key] || { error: 'formula missing from the player. Export the project again.' };
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
    // A scene that goes on with the picture before it fades into it. A wipe
    // or a slide would break that picture apart.
    if (sc.transition === 'auto' && this.continued?.has(sc.index)) return 'fade';
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
    const plan = !this.planning && !this.cameraOff ? this.cameraPlans?.get(index) : null;
    // A scene drawn past its end, while the next one comes in, keeps the
    // camera where it stopped, so a continued picture stays on top of itself.
    const cam = plan ? cameraAt(plan, Math.min(t, plan.dur)) : null;
    if (this.background) {
      if (plan) {
        // The background moves a third as much as the camera, so it looks
        // further away.
        const bg = backgroundShot(plan, cam);
        const v = plan.view;
        ctx.save();
        ctx.translate(v.x + v.w / 2, v.y + v.h / 2);
        ctx.scale(bg.z, bg.z);
        ctx.translate(-bg.x, -bg.y);
        ctx.drawImage(this.background, 0, 0, this.W, this.H);
        ctx.restore();
      } else ctx.drawImage(this.background, 0, 0, this.W, this.H);
    }
    if (this.config.boil > 0) this.pen.seedOffset = Math.floor((sc.start + t) * this.config.boil) % 997;
    const saved = Math.random;
    Math.random = mulberry32(hashStr(`random:${sc.id}`));
    ctx.save();
    // The automatic camera films the scene unless the scene moves its own.
    if (plan) {
      const v = plan.view;
      ctx.translate(v.x + v.w / 2, v.y + v.h / 2);
      ctx.scale(cam.z, cam.z);
      ctx.translate(-cam.x, -cam.y);
      if (cameraMoving(plan, t)) {
        this.moving = true;
        if (this.motion) this.motion.camera = true;
      }
    }
    const s = new Stage(this, ctx, sc, t);
    // While the camera is planned, anything a scene draws straight on s.ctx
    // is measured as one block that the camera must not cut.
    let raw = null;
    let api = s;
    let ink = null;
    if (this.drawLog && !this.layoutLog) {
      // While check looks at a frame, what the scene draws straight on s.ctx
      // counts as something on screen. The kit draws on its own and tells
      // check itself, and a large fill is a background.
      ink = boundsRecorder(ctx, this.scale, { W: this.W, H: this.H });
      const pen = new Proxy(ctx, {
        get: (target, prop) => (INK_CALLS.has(prop) && target.globalAlpha <= 0.01 ? target[prop].bind(target) : ink.proxy[prop]),
        set: (target, prop, value) => {
          target[prop] = value;
          return true;
        },
      });
      api = new Proxy(s, {
        get: (target, prop) => {
          if (prop === 'ctx') return pen;
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    }
    if (this.planning && this.layoutLog) {
      raw = boundsRecorder(ctx, this.scale, { W: this.W, H: this.H });
      // The UI kit draws on the same recorder; its panels and headlines
      // still report their own times.
      let ui = null;
      let short = null;
      api = new Proxy(s, {
        get: (target, prop) => {
          if (prop === 'ctx') return raw.proxy;
          if (prop === 'ui') return (ui ??= new Stage.UI(api));
          if (prop === 'short') return (short ??= new Stage.Short(api));
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    }
    try {
      this.scenesModule[sc.id](api);
      // Overlays queued with s._post() go on top of the scene, without the camera.
      for (const fn of s._posts ?? []) {
        ctx.save();
        ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
        ctx.globalAlpha = 1;
        try {
          fn();
        } finally {
          ctx.restore();
        }
      }
      const drawn = raw?.box();
      if (drawn) this.layoutLog.push({ kind: 'ink', at: 0, out: Infinity, box: drawn });
      const inked = ink?.box();
      if (inked && this.drawLog) {
        this.drawLog.shown++;
        this.drawLog.ink = { x0: inked.x - inked.w / 2, y0: inked.y - inked.h / 2, x1: inked.x + inked.w / 2, y1: inked.y + inked.h / 2 };
      }
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

  // Measures every scene once and plans its camera. A scene that continues
  // the picture of the scene before it starts where that camera stopped,
  // and the two dissolve into each other. Scene errors are left to check
  // and render, which report them with their time.
  planCameras() {
    this.cameraPlans = new Map();
    this.continued = new Set();
    if (this.config.camera === 'still') return;
    const scratch = document.createElement('canvas');
    scratch.width = 16;
    scratch.height = 16;
    const ctx = scratch.getContext('2d');
    const view = this.safeArea;
    const frame = { W: this.W, H: this.H };
    // The part of the frame that captions and app overlays leave free.
    const usable = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    if (this.appArea) Object.assign(usable, { x0: this.appArea.left, y0: this.appArea.top, x1: this.appArea.right, y1: this.appArea.bottom });
    if (this.captionBand) usable.y1 = Math.min(usable.y1, this.captionBand.top);
    const layouts = this.timeline.scenes.map((sc) => {
      this.layoutLog = [];
      this.planning = true;
      this.manualCamera = false;
      try {
        this.drawScene(ctx, sc.index, Math.max(0, sc.dur - 0.01));
        return this.manualCamera ? null : this.layoutLog.map((e) => ({ ...e, out: e.out ?? Infinity }));
      } catch {
        return null;
      } finally {
        this.layoutLog = null;
        this.planning = false;
      }
    });
    this.timeline.scenes.forEach((sc, i) => {
      if (!layouts[i]) return;
      const prev = i > 0 ? this.cameraPlans.get(i - 1) : null;
      const linked = prev && layouts[i - 1] && sc.transition !== 'none' && continues(layouts[i - 1], layouts[i], frameRect(cameraAt(prev, prev.dur), view, frame));
      const voiceEnd = sc.voice ? sc.lead + sc.voice.dur : null;
      const still = linked ? Math.min(this.timeline.transitionSeconds, sc.dur * 0.5) : 0;
      const plan = planCamera(layouts[i], { dur: sc.dur, view, frame, pace: this.timeline.pace || 1, voiceEnd, from: linked ? cameraAt(prev, prev.dur) : null, still, usable, attach: newDefaults(this.config) });
      if (!plan) return;
      this.cameraPlans.set(i, plan);
      if (linked) this.continued.add(i);
    });
  }

  renderFrame(T, ctx = this.ctx, { captions = true } = {}) {
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
      this.moving = true;
      this.drawScene(a.getContext('2d', { alpha: this.transparent }), i - 1, T - prev.start);
      this.drawScene(b.getContext('2d', { alpha: this.transparent }), i, t);
      drawTransition(trName, ctx, a, b, t / trDur, this.W, this.H, hashStr(sc.id), this.transparent);
    } else {
      this.drawScene(ctx, i, t);
    }
    if (captions && this.phrases.length) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      drawCaptions(ctx, this.phrases, T, this.theme, this.W, this.H, this.captionArea);
    }
    if (captions && this.chunks.length) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      drawBoldCaptions(ctx, this.chunks, T, this.W, this.H, this.captionArea);
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
  // and scene transitions, thinned so effects never pile up. "sfx": false only
  // silences those. Clip sound and s.sound still play, so with any such file in
  // assets/ the scenes have to be looked at.
  sfxCues() {
    if (this.config.sfx === false && !this.clips.size && !this.state.assets.some((a) => AUDIO_FILE.test(a))) return { cues: [], clips: [], sounds: [], errors: [] };
    const { events, errors } = this.collectEvents();
    const clips = events.filter((e) => e.kind === 'clip' && e.volume > 0 && e.speed === 1 && e.hasAudio).map((e) => ({ ...e, start: e.T, end: e.T + e.end - e.at }));
    const sounds = events.filter((e) => e.kind === 'sound').map((e) => ({ url: e.url, start: e.T, sceneStart: e.T - e.at, end: e.T - e.at + e.out, volume: e.volume }));
    if (this.config.sfx === false) return { cues: [], clips, sounds, errors };
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
    return { cues: out, clips, sounds, errors };
  }

  // Whether moment t of scene `index` shows anything besides the background, as
  // check counts it, without the camera.
  shownAt(index, t) {
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder, revealLog: this.revealLog, markLog: this.markLog, windowLog: this.windowLog };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    this.revealLog = null;
    this.markLog = null;
    this.windowLog = null;
    try {
      this.drawScene(scratch.getContext('2d'), index, t);
      return this.drawLog.shown > 0;
    } catch {
      return true;
    } finally {
      Object.assign(this, saved);
    }
  }

  // What a frame shows as the camera films it: how many elements are fully on
  // screen, and whether those are only text. `t` is seconds into scene `index`.
  framed(index, t) {
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    let texts;
    let log;
    try {
      this.drawScene(scratch.getContext('2d'), index, t);
      texts = this.textLog;
      log = this.drawLog;
    } catch {
      return { count: 0, onlyText: false };
    } finally {
      Object.assign(this, saved);
    }
    const inside = (b) => b.x0 >= -1 && b.y0 >= -1 && b.x1 <= this.W + 1 && b.y1 <= this.H + 1;
    const words = texts.filter((x) => !x.problem && x.settled && x.alpha > 0.95 && inside(x)).length;
    // A picture is a shape, icon, image, clip, chart or drawing. Lines and
    // arrows count as elements, but no picture. A clip or image that fills the
    // frame counts too, also while the camera crops it.
    const pictures = log.shapes.filter((s) => s.settled && s.alpha > 0.95 && (inside(s.box) || fillsFrame(s.box, this.W, this.H))).length
      + log.lives.filter((l) => l.settled && ['chart', 'custom'].includes(l.kind)).length
      + (log.ink ? 1 : 0);
    const lines = log.strokes.filter((s) => s.settled && s.alpha > 0.95).length
      + log.lives.filter((l) => l.settled && l.kind === 'line').length;
    return { count: words + pictures + lines, picture: pictures > 0, onlyText: words > 0 && pictures + lines === 0 };
  }

  // The moment "cover": "auto" takes with "defaults": "0.5": the frame of the
  // first scene with the most elements fully on screen, entrances finished,
  // where a frame with a picture comes before any frame without one, and the
  // earliest of those. Seconds into the video.
  coverMoment() {
    const sc = this.timeline.scenes[0];
    const last = Math.max(0, Math.floor((sc.dur - 1e-6) * this.fps));
    // Every frame, or evenly spread frames of a long scene.
    const step = Math.max(1, Math.ceil((last + 1) / COVER_FRAMES));
    let best = null;
    for (let f = 0; f <= last; f += step) {
      const seen = this.framed(sc.index, f / this.fps);
      if (!best || (seen.picture && !best.picture) || (seen.picture === best.picture && seen.count > best.count)) best = { T: sc.start + f / this.fps, ...seen };
    }
    return best.T;
  }

  // A hint when the cover shows only text on an empty background, or when the
  // frame "auto" picked has no picture, which means no frame of the first scene
  // has one. `T` is the cover's time, or null for the time the page works out,
  // and `auto` says that "cover": "auto" chose it.
  coverIssue(T = null, auto = T === null) {
    const at = T === null ? this.coverMoment() : T;
    const i = this.sceneAt(at);
    const sc = this.timeline.scenes[i];
    const seen = this.framed(i, at - sc.start);
    if (T === null ? seen.picture || !seen.count : !seen.onlyText) return null;
    const label = `${sc.id}@${(at - sc.start).toFixed(1)}`;
    if (T === null) return { level: 'hint', scene: sc.id, t: Math.round((at - sc.start) * 100) / 100, message: `"cover": "auto" picks ${label}, the fullest frame of the first scene, and no frame of that scene shows a picture; show a shape, an icon or an image with the text there, or set "cover" to a moment of another scene that has one` };
    // The first moment of that scene that shows the most, with a picture.
    let better = null;
    for (let t = 0; t < sc.dur - 0.05; t += 0.25) {
      const f = this.framed(i, t);
      if (!f.onlyText && f.count > 0 && (!better || f.count > better.count)) better = { t, count: f.count };
    }
    const where = auto ? `"cover": "auto" picks ${label}` : `the cover at ${label}`;
    const advice = better ? `set "cover": "${sc.id}@${better.t.toFixed(1)}" for a frame with a picture, or show a picture sooner` : 'show a picture with the text, or set "cover" to a moment that has one';
    return { level: 'hint', scene: sc.id, t: Math.round((at - sc.start) * 100) / 100, message: `${where}, which shows only text on an empty background; ${advice}` };
  }

  // Samples every scene and reports layout problems.
  check(step = 0.25, viewWidth = null) {
    // check looks at the layout as written, and then at what the automatic
    // camera shows of it: text sizes, and what a held shot cuts at its edge.
    // The camera only ever moves in, which makes text larger, and it may leave
    // the edges out of a close-up on purpose.
    this.cameraOff = true;
    try {
      return this._check(step, viewWidth);
    } finally {
      this.cameraOff = false;
    }
  }

  _check(step, viewWidth) {
    const issues = [];
    const add = (level, scene, t, message) => issues.push({ level, scene, t: t === null ? null : Math.round(t * 100) / 100, message });
    if (this.config.look) {
      for (const [key, min] of [['ink', 4.5], ['muted', 3]]) {
        if (contrast(this.theme[key], this.theme.bg) < min) add('warn', null, null, `${this.config.theme}: ${key} has low contrast against bg; use colors with a contrast of at least ${min}`);
      }
    }
    for (const id of this.extraScenes) add('warn', id, null, `scenes.js has a function "${id}" but ${this.state.text?.files?.script ?? 'script.md'} has no scene with that id, so it is never shown`);
    if (this.captionNote) add('hint', null, null, this.captionNote);
    const scratch = document.createElement('canvas');
    scratch.width = this.canvas.width;
    scratch.height = this.canvas.height;
    const ctx = scratch.getContext('2d', { alpha: false });
    const { W, H } = this;
    const margin = Math.round(Math.min(W, H) * 0.035);
    const minSize = Math.round(Math.min(W, H) * 0.022);
    // In a tall or square frame, which people watch on a phone, text below the
    // 40 pixels that labels need at 1080p gets a hint. Wide videos use smaller
    // text on purpose, for notes and headings.
    const scale1080 = Math.min(W, H) / 1080;
    const readable = H >= W ? Math.round(40 * scale1080) : 0;
    const uiMinSize = Math.round(Math.min(W, H) * 0.015);
    const colors = Object.fromEntries(['ink', 'accent', ...Object.keys(this.theme.colors)].map(name => [name, colorOf(this.theme, name)]));
    let colorCtx;
    const pixelColor = color => {
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
    const named = () => Object.fromEntries(Object.entries(colors).map(([name, c]) => [name, pixelColor(c)]));
    const reported = new Set();
    const once = (key, fn) => {
      if (reported.has(key)) return;
      reported.add(key);
      fn();
    };
    const short = (text) => (text.length > 40 ? text.slice(0, 37) + '...' : text);
    const onScreen = (b) => b.x1 > 0 && b.y1 > 0 && b.x0 < W && b.y0 < H;
    const inFrame = (b) => b.x0 >= -1 && b.y0 >= -1 && b.x1 <= W + 1 && b.y1 <= H + 1;
    this.cueNotes = [];
    // A cue that isn't in the narration is an error, and the rest of its scene is
    // measured with the cue at the scene start.
    this.cueErrors = new Map();
    this.soundsPlayed = new Map();
    for (const sc of this.timeline.scenes) {
      const entrances = [];
      // Which moments show something besides the background.
      const filled = [];
      // The automatic camera of this scene. check looks at the layout as
      // written and, where the camera films the scene, at what it shows too.
      const plan = this.cameraPlans?.get(sc.index) ?? null;
      // Each text at the smallest size it is shown at while it is on screen.
      const smallest = new Map();
      let shownAt = null;
      // A scene that stopped with an error has its error, and nothing is said about
      // what it would have shown after it.
      let broke = false;
      // What shows itself bit by bit, like code that types itself.
      this.revealLog = new Map();
      // Marks from s.annotate on an element with an id, and when that element goes.
      this.markLog = new Map();
      // Code windows and terminals, and when their first line shows.
      this.windowLog = new Map();
      const n = Math.ceil(sc.dur / step);
      for (let k = 0; k <= n; k++) {
        const t = Math.min(sc.dur - 0.001, k * step);
        this.recorder = { push: (e) => entrances.push(e) };
        this.textLog = [];
        this.drawLog = drawLog();
        try {
          this.drawScene(ctx, sc.index, t);
        } catch (e) {
          once(`err:${sc.id}:${e.message}`, () => add('error', sc.id, t, e.message));
          broke = true;
          break;
        }
        const laid = { texts: this.textLog.filter((x) => !x.problem), draw: this.drawLog };
        for (const pr of this.textLog.filter((x) => x.problem)) once(`problem:${sc.id}:${pr.key ?? pr.problem}`, () => add(pr.level ?? 'error', sc.id, t, pr.problem));
        if (shownAt === null && laid.draw.shown > 0) shownAt = t;
        filled.push({ t, shown: laid.draw.shown > 0 });
        const texts = laid.texts.filter((x) => x.alpha > 0.5);
        for (const tx of texts) {
          const label = short(tx.text);
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
          // Text on a sticker, a box or a card of its own is measured against
          // that color, *starred* words too.
          const own = cssColor(tx.bg);
          const bg = opaque(own || pageColor(tx, H) || this.theme.bg, this.theme.bg);
          const fg = cssColor(tx.fg);
          if (fg && contrast(fg, bg) < 3) once(`contrast:${sc.id}:${tx.text}`, () => {
            add('warn', sc.id, t, `"${label}" has low contrast against its background (${contrast(fg, bg).toFixed(1)}:1); ${contrastAdvice(tx.option ?? 'color', pixelColor(fg), pixelColor(bg), tx.size, named())}`);
          });
          const mark = own && cssColor(tx.mark);
          if (mark && contrast(mark, bg) < 3) once(`mark:${sc.id}:${tx.text}`, () => {
            add('warn', sc.id, t, `the *starred* words in "${label}" have low contrast against its background (${contrast(mark, bg).toFixed(1)}:1); ${contrastAdvice('mark', pixelColor(mark), pixelColor(bg), tx.size, named())}`);
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
        for (const f of shapeOverlaps(laid.draw.shapes)) once(`shapes:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of textsIntoShapes(solid, laid.draw.shapes)) once(`shapes:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of linesOverText(laid.draw.strokes, solid)) once(`line:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of labelsIntoShapes(laid.draw.strokes, solid, laid.draw.shapes)) once(`label:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of arrowsThroughShapes(laid.draw.strokes, laid.draw.shapes)) once(`through:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        // The box of a drawing counts in the frame like text: off the frame,
        // outside the app's safe area, close to the edge or in the caption band.
        for (const sh of laid.draw.shapes) {
          if (sh.kind !== 'drawing' || !sh.settled || sh.alpha <= 0.95) continue;
          const message = edgeMessage(shapeName(sh), sh.box, { W, H, margin, app: this.appArea, band: this.captionBand, format: this.config.format, safe: this.safeArea });
          if (message) once(`drawing-edge:${sc.id}:${shapeKey(sh)}`, () => add('warn', sc.id, t, message));
        }
        // The line of an arrow counts in the frame like its label: off the frame,
        // outside the app's safe area, close to the edge or in the caption band.
        for (const line of laid.draw.strokes) {
          if (line.kind !== 'arrow' || !line.settled || line.alpha <= 0.95) continue;
          const b = bounds(line.points);
          const where = `${Math.round(b.x0)},${Math.round(b.y0)} to ${Math.round(b.x1)},${Math.round(b.y1)}`;
          const a = this.appArea;
          const band = this.captionBand;
          let message = null;
          if (!inFrame(b)) message = `${line.name} runs off the frame (${where} in a ${W}x${H} frame); move its ends inside`;
          else if (a && (b.x0 < a.left - 2 || b.y0 < a.top - 2 || b.x1 > a.right + 2 || b.y1 > a.bottom + 2)) message = `${line.name} reaches outside the ${this.config.format} safe area (${a.left},${a.top} to ${a.right},${a.bottom}), where the app's buttons, name or caption can cover it`;
          else if (!a && (b.x0 < margin || b.y0 < margin || b.x1 > W - margin || b.y1 > H - margin)) message = `${line.name} comes closer than ${margin}px to the edge (${where})`;
          else if (band && line.points.some(([x, y]) => y > band.top + 2 && y < band.bottom - 2 && x > band.left && x < band.right)) message = `${line.name} runs into the caption band (y ${Math.round(band.top)} to ${Math.round(band.bottom)}), where captions can cover it; keep it above s.safe.bottom (${Math.round(this.safeArea.bottom)})`;
          if (message) once(`arrow-edge:${sc.id}:${line.name}`, () => add('warn', sc.id, t, message));
        }
        // What the viewer sees: as the camera films it, when it films this scene.
        let seen = texts;
        if (plan) {
          this.recorder = null;
          this.textLog = [];
          this.drawLog = drawLog();
          this.cameraOff = false;
          try {
            this.drawScene(ctx, sc.index, t);
          } catch {
            // found above, without the camera
          } finally {
            this.cameraOff = true;
          }
          const filmed = { texts: this.textLog.filter((x) => !x.problem), draw: this.drawLog };
          // While the camera holds still, nothing that fits the frame as
          // written may be cut at its edge. Fully out of the shot is fine, and
          // so is the element a close-up looks into, like a code window.
          const held = heldShot(plan, t);
          const into = held?.into;
          const lookedInto = (b) => into && b.x0 <= into.x - into.w / 2 + 0.5 && b.x1 >= into.x + into.w / 2 - 0.5 && b.y0 <= into.y - into.h / 2 + 0.5 && b.y1 >= into.y + into.h / 2 - 0.5;
          if (filmed.texts.length === laid.texts.length) {
            seen = filmed.texts.filter((x) => x.alpha > 0.5);
            if (held) {
              laid.texts.forEach((tx, i) => {
                const shot = filmed.texts[i];
                if (tx.alpha > 0.95 && tx.settled && !tx.block && !lookedInto(tx) && inFrame(tx) && onScreen(shot) && !inFrame(shot)) once(`cut:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `the camera cuts off "${short(tx.text)}" at the edge of the frame while it holds still; keep this scene still with s.camera([]), or point the camera with s.focus`));
              });
            }
          }
          if (held && filmed.draw.shapes.length === laid.draw.shapes.length) {
            laid.draw.shapes.forEach((sh, i) => {
              const shot = filmed.draw.shapes[i];
              // A clip or image that fills the frame is cut by any close-up, on purpose.
              if (sh.alpha > 0.95 && sh.settled && !lookedInto(sh.box) && !fillsFrame(sh.box, W, H) && inFrame(sh.box) && onScreen(shot.box) && !inFrame(shot.box)) once(`cut:${sc.id}:${shapeKey(sh)}`, () => add('warn', sc.id, t, `the camera cuts off ${shapeName(sh)} at the edge of the frame while it holds still; keep this scene still with s.camera([]), or point the camera with s.focus`));
            });
          }
        }
        for (const tx of seen) {
          if (tx.block || !onScreen(tx)) continue;
          const entry = smallest.get(tx.text) ?? { size: null, play: null, calm: null };
          if (!entry.size || tx.size < entry.size.tx.size - 0.01) entry.size = { tx, t };
          if (tx.alpha > 0.95 && (!entry.play || tx.size < entry.play.tx.size - 0.01)) entry.play = { tx, t };
          // The smallest it shows once it has arrived, not while it grows in.
          if (tx.alpha > 0.95 && tx.settled && (!entry.calm || tx.size < entry.calm.tx.size - 0.01)) entry.calm = { tx, t };
          smallest.set(tx.text, entry);
        }
      }
      this.drawLog = null;
      for (const [message, where] of this.cueErrors) {
        if (where.scene === sc.id) once(`err:${sc.id}:${message}`, () => add('error', sc.id, where.t, message));
      }
      // Text is judged at the smallest size it is shown at: the size the
      // camera leaves it at when it shows the whole picture, or smaller where
      // the scene zooms out itself.
      for (const [text, { size, play, calm }] of smallest) {
        const least = size.tx.ui ? uiMinSize : minSize;
        if (Math.round(size.tx.size) < least) once(`small:${sc.id}:${text}`, () => add('warn', sc.id, size.t, `"${short(text)}" is ${Math.round(size.tx.size)}px, hard to read (use at least ${least}px)`));
        // Above that, text that shows small on a phone gets a hint, as the
        // camera shows it at its widest once it has arrived, once per video for
        // a label that comes back in later scenes. App screens and code use
        // smaller text on purpose.
        else if (calm && !calm.tx.ui && !calm.tx.block && Math.round(calm.tx.size) < readable) once(`smallish:${text}`, () => add('hint', sc.id, calm.t, `"${short(text)}" shows ${Math.round(calm.tx.size)}px tall at ${calm.t.toFixed(1)}s, small on a phone, where labels read best at ${Math.round(40 * scale1080)} to ${Math.round(56 * scale1080)}px; make it bigger, or give the picture more of the frame`));
        const message = viewWidth !== null && play ? playbackTextIssue(play.tx, W, H, viewWidth) : null;
        if (message) once(`playback:${sc.id}:${text}`, () => add('warn', sc.id, play.t, message));
      }
      this.recorder = null;
      this.textLog = null;
      const times = [...new Set(entrances.map((e) => Math.round(e.at * 100) / 100))].sort((a, b) => a - b);
      for (const e of entrances) {
        if (e.kind === 'clip') {
          if (e.volume > 0 && e.speed !== 1) once(`clip-sound:${sc.id}:${e.key}`, () => add('warn', sc.id, e.at, `clip "${e.src}" stays silent at speed ${Math.round(e.speed * 100) / 100}${e.fit ? ", which speed: 'fit' picked" : ''}; use speed: 1 for its sound`));
          const frozen = e.loop ? 0 : e.out - e.end;
          if (frozen > FREEZE_SECONDS) once(`clip-freeze:${sc.id}:${e.key}`, () => add('warn', sc.id, e.end, `clip "${e.src}" freezes on its last frame for ${frozen.toFixed(1)}s, from ${e.end.toFixed(2)}s until ${e.out.toFixed(2)}s. ${e.fit
            ? `speed: 'fit' goes no slower than ${FIT_SPEEDS[0]} times the clip's speed, and this one needs slower. Use loop: true, a longer clip or an earlier out`
            : "speed: 'fit' plays it slower, so it ends with the scene, and loop: true repeats it"}`));
        }
        if (e.kind === 'sound' && !this.soundsPlayed.has(e.src)) this.soundsPlayed.set(e.src, { scene: sc.id, t: e.at });
        if (e.at > sc.dur) once(`late:${sc.id}:${e.key}`, () => add('error', sc.id, e.at, `a ${e.kind} is set to appear at ${e.at.toFixed(2)}s but the scene ends at ${sc.dur.toFixed(2)}s`));
      }
      // A scene that shows only its background for a while at the start. The
      // first element's own time says how long, when there is one.
      const first = times.find((x) => x >= 0);
      const bare = shownAt === null ? null : first !== undefined && first > shownAt - step - 1e-6 && first <= shownAt + 1e-6 ? first : shownAt;
      // A reveal that hasn't finished when the scene ends, or when it leaves.
      if (!broke) {
        for (const r of this.revealLog.values()) {
          const deadline = Math.min(sc.dur, r.out);
          if (r.at >= deadline - 0.05 || r.end <= deadline + 0.05) continue;
          const by = r.out < sc.dur ? `by its out at ${r.out.toFixed(1)}s` : `by the end of the scene at ${sc.dur.toFixed(1)}s`;
          once(`reveal:${sc.id}:${r.what}:${r.at}`, () => add('warn', sc.id, deadline, `${r.what} ${r.missing(deadline)} ${by}, and needs until ${r.end.toFixed(1)}s; ${r.advice}`));
        }
      }
      this.revealLog = null;
      // A mark that stays on screen after what it marks has gone, alone or over
      // what comes next.
      if (!broke) {
        for (const m of this.markLog.values()) {
          const until = Math.min(m.gone, sc.dur);
          const from = Math.max(m.targetGone, m.at);
          if (m.targetGone >= sc.dur || !(until - from > MARK_SLACK)) continue;
          const out = m.spec === undefined ? '' : `, out: ${typeof m.spec === 'string' ? `'${m.spec}'` : m.spec}`;
          const fresh = m.given || newDefaults(this.config) ? '' : `. With "defaults": "0.5" in video.json, a mark without an out of its own leaves with what it marks`;
          once(`mark:${sc.id}:${m.name}`, () => add('warn', sc.id, from, `${m.name} stays on screen for ${(until - from).toFixed(1)}s after "${m.target}" leaves at ${m.targetOut.toFixed(1)}s; give the mark the same out as "${m.target}"${out}${fresh}`));
        }
      }
      this.markLog = null;
      // A code window or a terminal that is on screen empty for a while before its
      // first line or step.
      if (!broke) {
        for (const w of this.windowLog.values()) {
          const until = Math.min(w.first, w.out, sc.dur);
          if (w.at >= sc.dur || !(until - w.at > EMPTY_WINDOW)) continue;
          const to = until === w.first ? `until its first line at ${w.first.toFixed(1)}s` : until === sc.dur ? 'until the scene ends' : `until it leaves at ${w.out.toFixed(1)}s`;
          once(`window:${sc.id}:${w.name}`, () => add('warn', sc.id, w.at, `${w.name} is on screen empty for ${(until - w.at).toFixed(1)}s, from ${w.at.toFixed(1)}s ${to}; ${w.advice}`));
        }
      }
      this.windowLog = null;
      const emptyStart = !broke && bare !== null && bare > EMPTY_START;
      if (emptyStart) add('hint', sc.id, 0, `the scene shows only its background for the first ${bare.toFixed(1)}s; put something on screen sooner, for example give the first element an earlier at`);
      // The same later in the scene, once everything has left and before the next
      // element comes, or until the scene ends.
      if (!broke) {
        for (const gap of emptyStretches(filled, sc.dur, step, (t) => this.shownAt(sc.index, t))) {
          const until = gap.to >= sc.dur - 0.01 ? 'until the scene ends' : `to ${gap.to.toFixed(1)}s`;
          add('hint', sc.id, gap.from, `the scene shows only its background for ${(gap.to - gap.from).toFixed(1)}s, from ${gap.from.toFixed(1)}s ${until}; put something on screen in that stretch, or let what was there stay longer with a later out`);
        }
      }
      if (broke) {
        // its error says it all
      } else if (!times.length) {
        add('warn', sc.id, null, 'nothing enters in this scene; add at least one element with an "at" time');
      } else {
        const marks = [0, ...times.filter((x) => x >= 0 && x <= sc.dur), sc.dur];
        for (let i = 1; i < marks.length; i++) {
          const gap = marks[i] - marks[i - 1];
          // The empty start already has its hint.
          if (emptyStart && i === 1) continue;
          if (gap > 6) add('hint', sc.id, marks[i - 1], `no new element for ${gap.toFixed(1)}s (from ${marks[i - 1].toFixed(1)}s); consider revealing something on a cue in that stretch`);
        }
      }
    }
    const repeated = new Map();
    for (const c of this.cueNotes) repeated.set(`${c.scene}|${c.word.toLowerCase()}`, c);
    for (const c of repeated.values()) {
      add('hint', c.scene, null, `cue "${c.word}" means the first of the ${c.count} times it is spoken in this scene; write "${c.word}#1" if you mean the first time, or "${c.word}#2" for a later one`);
    }
    this.cueNotes = null;
    this.cueErrors = null;
    for (const { scene, t, tex } of this.lateMath.values()) add('error', scene, t, `math "${tex}" was not collected at the start; keep TeX strings fixed and always call s.math with at and out for timing`);
    return issues;
  }
}

// Whether a box covers the whole frame, like a clip with full: true.
function fillsFrame(b, W, H) {
  return b.x0 <= 1 && b.y0 <= 1 && b.x1 >= W - 1 && b.y1 >= H - 1;
}

// What to use for text that is hard to read: the nearest darker or lighter
// shade of its own color that reads well, so the color keeps its meaning, and
// then the look's ink, when that reads well too. Large text needs 3:1, and other
// text 4.5:1.
function contrastAdvice(option, fg, bg, size, named) {
  const min = size >= 48 ? 3 : 4.5;
  const shade = suggestColor(fg, bg, size);
  const own = shade && shade.color !== fg ? `use ${option}: '${shade.color}' (${shade.ratio.toFixed(1)}:1), a ${luminance(shade.color) < luminance(fg) ? 'darker' : 'lighter'} shade of the same color` : null;
  const ink = named.ink && contrast(named.ink, bg) >= min ? `${option}: 'ink' (${contrast(named.ink, bg).toFixed(1)}:1)` : null;
  if (own && ink) return `${own}, or ${ink}`;
  return own ?? (ink ? `use ${ink}` : `use another ${option}`);
}

// Stretches after the start of a scene in which it shows only its background for
// longer than EMPTY_START, from the moments check looked at. Each edge is found
// more exactly with `shown(t)`.
function emptyStretches(filled, dur, step, shown) {
  const found = [];
  const first = filled.findIndex((f) => f.shown);
  if (first === -1) return found;
  const edge = (a, b, emptyFirst) => {
    for (let i = 0; i < 7; i++) {
      const m = (a + b) / 2;
      if (shown(m) === emptyFirst) b = m;
      else a = m;
    }
    return (a + b) / 2;
  };
  for (let i = first + 1; i < filled.length; i++) {
    if (filled[i].shown) continue;
    let j = i;
    while (j < filled.length && !filled[j].shown) j++;
    // Too short to matter, even with the moments around it.
    if ((j < filled.length ? filled[j].t : dur) - filled[i - 1].t > EMPTY_START) {
      const from = edge(filled[i - 1].t, filled[i].t, false);
      const to = j < filled.length ? edge(filled[j - 1].t, filled[j].t, true) : dur;
      if (to - from > EMPTY_START) found.push({ from, to });
    }
    i = j;
  }
  return found;
}

// What check says about a box that runs off the frame, outside the app's safe
// area, close to the edge or into the caption band, or null.
function edgeMessage(name, b, { W, H, margin, app, band, format, safe }) {
  const where = `${Math.round(b.x0)},${Math.round(b.y0)} to ${Math.round(b.x1)},${Math.round(b.y1)}`;
  if (b.x0 < -1 || b.y0 < -1 || b.x1 > W + 1 || b.y1 > H + 1) return `${name} runs off the frame (${where} in a ${W}x${H} frame)`;
  if (app && (b.x0 < app.left - 2 || b.y0 < app.top - 2 || b.x1 > app.right + 2 || b.y1 > app.bottom + 2)) return `${name} reaches outside the ${format} safe area (${app.left},${app.top} to ${app.right},${app.bottom}), where the app's buttons, name or caption can cover it`;
  if (!app && (b.x0 < margin || b.y0 < margin || b.x1 > W - margin || b.y1 > H - margin)) return `${name} comes closer than ${margin}px to the edge (${where})`;
  if (band && b.y1 > band.top + 2 && b.y0 < band.bottom - 2 && b.x1 > band.left && b.x0 < band.right) return `${name} runs into the caption band (y ${Math.round(band.top)} to ${Math.round(band.bottom)}), where captions can cover it; keep it above s.safe.bottom (${Math.round(safe.bottom)})`;
  return null;
}

// The canvas calls that put something on it.
const INK_CALLS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);

// A scene may show only its background this long at the start, in seconds.
const EMPTY_START = 1.5;
// A mark may stay this long after what it marks has gone, in seconds.
const MARK_SLACK = 0.3;
// A code window or a terminal may be empty this long before its first line.
const EMPTY_WINDOW = 1;
// "cover": "auto" looks at this many frames of the first scene at most.
const COVER_FRAMES = 600;

// What check collects while it draws one moment of a scene: the shapes and
// lines drawn, in design pixels, and how many elements are on screen.
function drawLog() {
  return { shapes: [], strokes: [], lives: [], shown: 0, order: 0 };
}

const SHAPE_NAMES = { box: 'box', icon: 'icon', image: 'image', code: 'code window', terminal: 'terminal', card: 'card', sticker: 'sticker', drawing: 'drawing' };

// "the box "Rivers bring salt in"", with "(id "rivers")" after it when it has an
// id, "the drawing "moon"" by its id alone, or by its call and where it is
// without either, like "the 2nd s.draw at 960,735".
function shapeName(sh) {
  const kind = SHAPE_NAMES[sh.kind] ?? sh.kind;
  const name = sh.name.length > 40 ? sh.name.slice(0, 37) + '...' : sh.name;
  if (name) return `the ${kind} "${name}"${sh.id !== null && sh.id !== sh.name ? ` (id "${sh.id}")` : ''}`;
  if (sh.id !== null) return `the ${kind} "${sh.id}"`;
  return `the ${sh.call ?? kind} at ${Math.round((sh.box.x0 + sh.box.x1) / 2)},${Math.round((sh.box.y0 + sh.box.y1) / 2)}`;
}

function shapeKey(sh) {
  return `${sh.kind}|${sh.name}|${Math.round((sh.box.x0 + sh.box.x1) / 8)}|${Math.round((sh.box.y0 + sh.box.y1) / 8)}`;
}

// Shapes that partly overlap: they reach more than 4 pixels into each other
// and neither holds the other. Only shapes that have fully arrived count. Two
// in the same group, or in one panel, are one piece; a dialog, an open menu or
// a toast covers what is under it; and overlap: true allows it.
export function shapeOverlaps(shapes) {
  const list = shapes.filter((s) => s.settled && s.alpha > 0.95 && !s.overlap && !s.cover);
  const found = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      if (A.group !== null && A.group === B.group) continue;
      const depth = overlapDepth(A.poly, B.poly);
      if (depth <= 4 || holds(A.poly, B.poly) || holds(B.poly, A.poly)) continue;
      const key = [shapeKey(A), shapeKey(B)].sort().join('/');
      found.push({ key, message: `${shapeName(A)} and ${shapeName(B)} partly overlap, by ${Math.round(depth)}px; move them apart, or give one of them overlap: true if that is meant` });
    }
  }
  return found;
}

// The lines of arrows and annotations that run through text. An arrow's own
// label doesn't count, nor does the text a mark is drawn around, nor text
// drawn later on a card of its own, which covers the line.
export function linesOverText(strokes, texts) {
  const found = [];
  for (const line of strokes) {
    if (!line.settled || line.alpha <= 0.95) continue;
    for (const tx of texts) {
      if (tx.block || !tx.settled || (line.serial !== undefined && tx.owner === line.serial)) continue;
      if (line.target && tx.x0 >= line.target.x0 - 2 && tx.y0 >= line.target.y0 - 2 && tx.x1 <= line.target.x1 + 2 && tx.y1 <= line.target.y1 + 2) continue;
      if (tx.order > line.order && (tx.bg || tx.ui)) continue;
      if (!crosses(line.points, tx)) continue;
      const label = tx.text.length > 40 ? tx.text.slice(0, 37) + '...' : tx.text;
      const advice = line.kind === 'arrow' ? 'move the text, or let the arrow start or end somewhere else' : 'mark a box that holds both, like s.annotate({ x, y, w, h }), or move the text';
      found.push({ key: `${line.name}|${tx.text}`, message: `${line.name} crosses the text "${label}"; ${advice}` });
    }
  }
  return found;
}

// Text that partly covers a shape, like a note on the edge of a box: text that
// reaches more than 4 pixels into the line drawn on the shape's outline, from
// outside or from inside. The line counts as wide as it is drawn, so a word
// sitting on a box's border is found also where the browser measures letters a
// little smaller. Text fully inside or fully outside, a shape's own text, text in
// the same group, app screens, arrow labels (which have a check of their own)
// and overlap: true on either don't count.
export function textsIntoShapes(texts, shapes) {
  const list = shapes.filter((s) => s.settled && s.alpha > 0.95 && !s.overlap && !s.cover && !s.ui);
  const found = [];
  for (const tx of texts) {
    if (!tx.settled || tx.alpha <= 0.95 || tx.block || tx.ui || tx.overlap || (tx.owner !== null && tx.owner !== undefined)) continue;
    const box = [[tx.x0, tx.y0], [tx.x1, tx.y0], [tx.x1, tx.y1], [tx.x0, tx.y1]];
    for (const sh of list) {
      if ((tx.shape !== null && tx.shape === sh.serial) || (sh.group !== null && sh.group === tx.group)) continue;
      // The outer and the inner edge of the drawn border.
      const outer = grow(sh.poly, sh.edge ?? 0);
      const inner = grow(sh.poly, -(sh.edge ?? 0));
      const depth = overlapDepth(outer, box);
      if (depth <= 4 || holds(inner, box) || holds(box, outer)) continue;
      const label = tx.text.length > 40 ? tx.text.slice(0, 37) + '...' : tx.text;
      found.push({ key: `${shapeKey(sh)}/${tx.text}`, message: `"${label}" and ${shapeName(sh)} partly overlap, by ${Math.round(depth)}px; move them apart, or give one of them overlap: true if that is meant` });
    }
  }
  return found;
}

// An arrow whose drawn line runs through a shape or icon that is none of its
// ends: not the element it starts or ends at by id, and not a shape its end
// points are in or at. A shape that holds the whole arrow, like a frame around
// a diagram, doesn't count, nor does one drawn after the arrow, like a cross
// put on it, which covers the line instead.
export function arrowsThroughShapes(strokes, shapes) {
  const list = shapes.filter((s) => s.settled && s.alpha > 0.95 && !s.overlap && !s.cover && !s.ui);
  const found = [];
  for (const line of strokes) {
    if (line.kind !== 'arrow' || !line.settled || line.alpha <= 0.95 || !line.body) continue;
    const span = bounds(line.points);
    const outline = [[span.x0, span.y0], [span.x1, span.y0], [span.x1, span.y1], [span.x0, span.y1]];
    for (const sh of list) {
      if (sh.order > line.order || (sh.id !== null && line.ends.includes(sh.id))) continue;
      if (line.tips.some((p) => inside(p, sh.poly) || toEdge(p, sh.poly) <= 20)) continue;
      if (holds(sh.poly, outline)) continue;
      if (!line.body.some((p) => inside(p, sh.poly) && toEdge(p, sh.poly) > 4)) continue;
      found.push({ key: `${line.name}|${shapeKey(sh)}`, message: `${line.name} runs through ${shapeName(sh)}; let it go around with bend, or move one of them` });
    }
  }
  return found;
}

// An arrow's label that runs into a shape, like a box at the end of a short
// arrow. Labels are body size, so a short arrow between two shapes may have no
// room for one.
export function labelsIntoShapes(strokes, texts, shapes) {
  const found = [];
  const arrows = new Map(strokes.filter((s) => s.serial !== undefined).map((s) => [s.serial, s]));
  for (const tx of texts) {
    const arrow = tx.owner !== null && tx.owner !== undefined ? arrows.get(tx.owner) : null;
    if (!arrow || !tx.settled) continue;
    const box = [[tx.x0, tx.y0], [tx.x1, tx.y0], [tx.x1, tx.y1], [tx.x0, tx.y1]];
    for (const sh of shapes) {
      if (!sh.settled || sh.alpha <= 0.95 || sh.cover || sh.overlap) continue;
      if (overlapDepth(sh.poly, box) <= 4 || holds(sh.poly, box)) continue;
      const label = tx.text.length > 40 ? tx.text.slice(0, 37) + '...' : tx.text;
      found.push({ key: `${tx.owner}|${shapeKey(sh)}`, message: `the label "${label}" of ${arrow.name} runs into ${shapeName(sh)}; move it with labelSide or labelOffset, make it smaller with labelSize, or give the arrow more room` });
    }
  }
  return found;
}

// Boots the engine for render, check or studio pages.
export async function boot({ canvas, scale = 1, transparent = false, version = '', player = false }) {
  const root = player ? './' : '/';
  const state = player ? await (await fetch('./state.json')).json() : await fetchState();
  const theme = getTheme(state.config.theme, state.config.look);
  const [icons, images, scenesMod, audio, iconTags, clips] = await Promise.all([
    fetch(root + 'engine/icons/lucide.json').then((r) => r.json()).then((j) => {
      // Old Lucide names keep working.
      for (const [alias, target] of Object.entries(j.aliases || {})) if (!j.icons[alias]) j.icons[alias] = j.icons[target];
      return j.icons;
    }),
    loadImages(state.assets, root),
    import(player ? '../project/scenes.js' : `/project/scenes.js?v=${encodeURIComponent(version || state.version)}`),
    player ? { SFX: {} } : import('./audio/soundtrack.js').catch((e) => ({ SFX: {}, loadError: e })),
    player ? {} : fetch('/engine/icons/lucide-tags.json').then((r) => r.json()),
    loadClips(state.assets, player ? state : null),
    loadFonts(theme, state.config, root),
  ]);
  const scenes = scenesMod.default;
  if (!scenes || typeof scenes !== 'object') throw new Error('scenes.js must "export default { sceneId(s) { ... } }"');
  const engine = new Engine({ canvas, state, scenes, icons, images, clips, scale, transparent, sfxNames: Object.keys(audio.SFX) });
  engine.iconTags = iconTags;
  if (player) engine.staticMath = await (await fetch('./math.json')).json();
  else await engine.loadMath();
  engine.planCameras();
  return { engine, audio, state };
}

// A music file comes with its measured level, which decides how loud it plays.
async function loadMusicFile({ src, volume, loop }) {
  const res = await fetch(soundURL('info', src));
  if (!res.ok) throw new Error(await res.text());
  const { lufs } = await res.json();
  return { url: soundURL('audio', src), lufs, volume, loop };
}

// Mixes narration, music and sound effects in an OfflineAudioContext.
export async function renderAudio(engine, audio, { sampleRate = 48000 } = {}) {
  if (audio.loadError) throw new Error(`audio engine failed to load: ${audio.loadError.message}`);
  const { timeline, config } = engine.state;
  const { cues, clips, sounds, errors } = engine.sfxCues();
  const buffer = await audio.renderSoundtrack({
    duration: timeline.duration,
    sampleRate,
    voice: timeline.scenes.filter((s) => s.voice).map((s) => ({ url: '/project/' + s.voice.url + '?v=' + engine.state.version, start: s.voice.start })),
    voiceSpans: timeline.voiceSpans,
    music: config.music?.src ? null : config.music,
    musicFile: config.music?.src ? await loadMusicFile(config.music) : null,
    sfx: cues,
    clips,
    sounds,
    scenes: timeline.scenes.map((s) => ({ start: s.start, dur: s.dur })),
  });
  return { buffer, cues, errors };
}
