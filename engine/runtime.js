// Boots the engine in a page: loads the project state, fonts, icons, images
// and scenes, then exposes frame rendering, checks and the soundtrack.
import rough from '../vendor/rough.js';
import { Stage, SceneError, boundsRecorder } from './stage.js';
import { getTheme, makeBackground, fontString, colorOf } from './themes.js';
import { Pen } from './pen.js';
import { drawTransition } from './transitions.js';
import { buildPhrases, drawCaptions, buildChunks, drawBoldCaptions, captionHighlight } from './captions.js';
import { AUDIO_FILE, clamp, ease, hashStr, mulberry32, suggest, suggestColor, contrast, luminance, opaque, withAlpha, parseColor, mixColor, rgba, cssColor, newDefaults, accentNote, normWord } from './util.js';
import { overlapDepth, holds, crosses, bounds, inside, toEdge, grow } from './geometry.js';
import { layoutAreas } from './layout.js';
import { loadClips, soundURL, ClipFrames, FREEZE_SECONDS, FIT_SPEEDS } from './clips.js';
import { UI, STARRED } from './ui.js';
import { CATCH_UP, fitViewport, PAGE_TEXT, PLAYED_TEXT } from './recording.js';
import { Short } from './short.js';
import { playbackTextIssue } from './readability.js';
import { planCamera, cameraAt, cameraMoving, heldShot, continues, frameRect, backgroundShot } from './director.js';
import { englishKitWord, kitWordHint } from './words.js';

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
    // this page shares, so a brand color goes on this engine's own copy. With
    // "defaults": "0.6", brand.background is the background of every scene.
    const brand = newDefaults(config, '0.6') ? config.brand ?? {} : {};
    if (brand.background) this.theme = { ...this.theme, bg: brand.background };
    const highlight = captionHighlight(config, this.theme);
    if (highlight.color) this.theme = { ...this.theme, caption: { ...this.theme.caption, active: highlight.color } };
    this.captionNote = highlight.note ?? null;
    // and brand.accent colors the *starred* words of s.title and s.text. On a
    // background where it is hard to read, below 3:1, it keeps its hue and
    // gets lighter or darker until it reads, as in captions.
    this.brandAccent = brand.accent ? (contrast(brand.accent, this.theme.bg) >= 3 ? brand.accent : suggestColor(brand.accent, this.theme.bg, 0)?.color ?? null) : null;
    // check names the color used instead when a starred word shows it.
    this.brandAccentNote = brand.accent && this.brandAccent !== brand.accent ? accentNote(brand.accent, contrast(brand.accent, this.theme.bg), 3, 'on the background', `*starred* words use ${this.brandAccent ?? `the look's accent ${this.theme.colors?.[this.theme.accent] ?? this.theme.accent}`}${this.brandAccent ? `, the same hue made ${contrast(this.brandAccent, '#ffffff') < contrast(brand.accent, '#ffffff') ? 'lighter' : 'darker'}` : ''}`) : null;
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
    this.cropLog = null;
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

  // A recording that "explainroo record" made: its step log and its video.
  recording(name) {
    const have = Object.keys(this.state.recordings ?? {});
    const log = this.state.recordings?.[name];
    if (typeof name !== 'string' || !log) {
      const close = typeof name === 'string' ? suggest(name, have, 3) : [];
      throw new SceneError(`recording "${name}" not found. Write recordings/${name}.json and run "explainroo record <project> ${name}", which saves assets/recordings/${name}.webm and its step log. ${have.length ? `Recordings: ${have.join(', ')}${close.length ? `. Did you mean "${close[0]}"?` : ''}` : 'This project has no recordings yet.'}`);
    }
    return { log, clip: this.clip(`assets/recordings/${name}.webm`) };
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

  // How long a scene shows together with the one before it at its start: the
  // length of its transition, or 0 after a cut and for the first scene.
  blendIn(sc) {
    if (!sc || sc.index === 0 || sc.transition === 'none' || this.transitionFor(sc) === 'cut') return 0;
    return Math.min(this.timeline.transitionSeconds, sc.dur * 0.5);
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
    const { size, font, w, padX, h, x, y } = this.watermarkPlace(ctx, text);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = withAlpha(th.bg, 0.72);
    ctx.beginPath();
    ctx.roundRect(x - w - padX * 2, y - h / 2, w + padX * 2, h, h / 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(th.ink, 0.82);
    ctx.fillText(text, x - padX, y + size * 0.04);
    ctx.restore();
  }

  // Where the watermark sits: its font, the width of its words, and the
  // right end and middle of its backing.
  watermarkPlace(ctx, text) {
    const th = this.theme;
    const m = Math.min(this.W, this.H);
    const size = Math.round(m * 0.028);
    const margin = Math.round(m * 0.028);
    const font = fontString(th, 'body', size, th.fonts.body.family === 'Inter' ? 600 : th.fonts.body.family === 'Kalam' ? 700 : undefined);
    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.restore();
    const padX = size * 0.6;
    const h = size * 1.6;
    const x = this.appArea ? this.appArea.right : this.W - margin;
    const y = this.appArea ? this.appArea.top + h / 2 : this.H - margin - h / 2;
    return { size, font, w, padX, h, x, y };
  }

  // The box of the watermark's backing in the frame, for check, or null
  // without a watermark.
  watermarkBox() {
    const text = this.config.watermark;
    if (!text) return null;
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const { w, padX, h, x, y } = this.watermarkPlace(scratch.getContext('2d'), text);
    return { x0: x - w - padX * 2, y0: y - h / 2, x1: x, y1: y + h / 2, text };
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
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder, revealLog: this.revealLog, markLog: this.markLog, windowLog: this.windowLog, arrowLog: this.arrowLog };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    this.revealLog = null;
    this.markLog = null;
    this.windowLog = null;
    this.arrowLog = null;
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
  // With "defaults": "0.5", an element that is still typing, showing its lines,
  // counting or writing itself has not arrived, and `partial` lists those.
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
      return { count: 0, onlyText: false, partial: [], coming: [] };
    } finally {
      Object.assign(this, saved);
    }
    const fresh = newDefaults(this.config);
    const arrived = (x) => !(fresh && x.partial);
    const inside = (b) => b.x0 >= -1 && b.y0 >= -1 && b.x1 <= this.W + 1 && b.y1 <= this.H + 1;
    const words = texts.filter((x) => !x.problem && x.settled && x.alpha > 0.95 && inside(x) && arrived(x)).length;
    // A picture is a shape, icon, image, clip, chart or drawing. Lines and
    // arrows count as elements, but no picture. A clip or image that fills the
    // frame counts too, also while the camera crops it.
    const pictures = log.shapes.filter((s) => s.settled && s.alpha > 0.95 && arrived(s) && (inside(s.box) || fillsFrame(s.box, this.W, this.H))).length
      + log.lives.filter((l) => l.settled && ['chart', 'custom'].includes(l.kind)).length
      + (log.ink ? 1 : 0);
    const lines = log.strokes.filter((s) => s.settled && s.alpha > 0.95).length
      + log.lives.filter((l) => l.settled && l.kind === 'line').length;
    const partial = fresh ? [...new Map(log.partial.map((p) => [p.name, p])).values()] : [];
    // Text still on its way in, like a name placed at: 0.
    const coming = texts.filter((x) => !x.problem && !x.settled && x.text.trim() && inside(x)).map((x) => x.text);
    // A recording, a clip, an image or a drawing, which "cover": "auto" looks
    // for with "defaults": "0.6".
    const media = log.shapes.some((s) => (s.kind === 'image' || s.kind === 'drawing') && s.settled && s.alpha > 0.95 && arrived(s) && (inside(s.box) || fillsFrame(s.box, this.W, this.H)));
    return { count: words + pictures + lines, picture: pictures > 0, media, onlyText: words > 0 && pictures + lines === 0, partial, coming };
  }

  // The moment "cover": "auto" takes with "defaults": "0.5": the frame of the
  // first scene with the most elements fully on screen, entrances finished and
  // nothing still typing or counting, where a frame with a picture comes before
  // any frame without one, then a frame where nothing shows itself half way, and
  // the earliest of those. Seconds into the video.
  // With "defaults": "0.6", it is the fullest frame of the first scene that
  // shows a recording, a clip, an image or a drawing, a frame with one first,
  // and the first scene's as before when no scene shows one.
  coverMoment() {
    if (newDefaults(this.config, '0.6')) {
      for (const sc of this.timeline.scenes) {
        if (!this.showsMedia(sc)) continue;
        const best = this.fullestFrame(sc, true);
        if (best.media) return best.T;
      }
    }
    return this.fullestFrame(this.timeline.scenes[0]).T;
  }

  // The fullest frame of a scene, as the time in the video and what it shows.
  // With `media`, a frame with a recording, a clip, an image or a drawing comes
  // before any frame without one.
  fullestFrame(sc, media = false) {
    const last = Math.max(0, Math.floor((sc.dur - 1e-6) * this.fps));
    // Every frame, or evenly spread frames of a long scene.
    const step = Math.max(1, Math.ceil((last + 1) / COVER_FRAMES));
    let best = null;
    for (let f = 0; f <= last; f += step) {
      const seen = this.framed(sc.index, f / this.fps);
      const fuller = seen.count > best?.count || (seen.count === best?.count && seen.partial.length < best.partial.length);
      const first = media && seen.media !== best?.media ? seen.media : seen.picture !== best?.picture ? seen.picture : fuller;
      if (!best || first) best = { T: sc.start + f / this.fps, ...seen };
    }
    return best;
  }

  // Whether some frame of a scene shows a recording, a clip, an image or a
  // drawing, from up to 60 frames spread over it.
  showsMedia(sc) {
    const last = Math.max(0, Math.floor((sc.dur - 1e-6) * this.fps));
    const step = Math.max(1, Math.ceil((last + 1) / 60));
    for (let f = 0; f <= last; f += step) if (this.framed(sc.index, f / this.fps).media) return true;
    return false;
  }

  // A hint when the first frame of the video shows only the background, or
  // only elements still on their way in, while the first scene's fullest frame
  // shows something. Buffer, LinkedIn and other services take the first frame
  // as the thumbnail. It names an element of that fuller frame to show from the
  // start, a picture first.
  firstFrameIssue() {
    const sc = this.timeline.scenes[0];
    if (!sc) return null;
    const first = this.framed(sc.index, 0);
    if (first.count > 0) {
      // Something shows, but a text placed at: 0, like the product's name,
      // is still coming in, so the thumbnail misses it.
      if (!first.coming.length) return null;
      const text = first.coming[0];
      const more = new Set(first.coming).size - 1;
      const name = `"${text.length > 40 ? text.slice(0, 37) + '...' : text}"${more > 0 ? ` and ${more} more text${more > 1 ? 's' : ''}` : ''}`;
      return { level: 'hint', scene: sc.id, t: 0, message: `the first frame of the video shows ${name} still coming in, and Buffer, LinkedIn and other services use it as the thumbnail; give ${more > 0 ? 'them' : 'it'} at: -1 instead of at: 0, so ${more > 0 ? 'they are' : 'it is'} there from the first frame` };
    }
    const T = this.fullestFrame(sc).T;
    const t = T - sc.start;
    if (!(this.framed(sc.index, t).count > 0)) return null;
    // What that frame shows, without the camera, in the order it was drawn.
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder, cameraOff: this.cameraOff };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    this.cameraOff = true;
    let shapes;
    let texts;
    try {
      this.drawScene(scratch.getContext('2d'), sc.index, t);
      shapes = this.drawLog.shapes.filter((x) => x.settled && x.alpha > 0.95);
      texts = this.textLog.filter((x) => !x.problem && x.settled && x.alpha > 0.95 && x.text !== 'code');
    } catch {
      return null;
    } finally {
      Object.assign(this, saved);
    }
    const shown = this.shownAt(sc.index, 0);
    const what = shown ? 'shows only elements that are still on their way in' : 'shows only the background';
    const picture = shapes.sort((a, b) => a.order - b.order)[0];
    const name = picture ? shapeName(picture) : texts[0] ? `the text "${texts[0].text.length > 40 ? texts[0].text.slice(0, 37) + '...' : texts[0].text}"` : null;
    const advice = name ? `give ${name} at: -1, so it is there from the first frame` : 'show one element from the start with at: -1';
    return { level: 'hint', scene: sc.id, t: 0, message: `the first frame of the video ${what}, and Buffer, LinkedIn and other services use it as the thumbnail; ${advice}` };
  }

  // A hint when the cover shows an image that fit: 'cover' cuts at its edges,
  // which can cut off words or a face in the thumbnail. `T` is the cover's
  // time, or null for the time the page works out.
  coverCropIssue(T = null) {
    const at = T === null ? this.coverMoment() : T;
    const i = this.sceneAt(at);
    const sc = this.timeline.scenes[i];
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder, cropLog: this.cropLog };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    this.cropLog = [];
    let crops;
    try {
      this.drawScene(scratch.getContext('2d'), i, at - sc.start);
      crops = this.cropLog;
    } catch {
      return null;
    } finally {
      Object.assign(this, saved);
    }
    const most = crops.sort((a, b) => b.part - a.part)[0];
    if (!most) return null;
    const label = `${sc.id}@${(at - sc.start).toFixed(1)}`;
    const name = most.id === null ? `the image ${most.src}` : `the image "${most.id}" (${most.src})`;
    return { level: 'hint', scene: sc.id, t: Math.round((at - sc.start) * 100) / 100, message: `the cover at ${label} shows ${name} with fit: 'cover', which cuts ${Math.round(most.part * 100)}% of it off at the ${most.sides}; look at the cover for words or faces cut at its edge, and give the image the shape of the picture or fit: 'contain' if they are` };
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
    const label = `${sc.id}@${(at - sc.start).toFixed(1)}`;
    // With "defaults": "0.5", a cover that shows something half typed or counted,
    // and the first moment after it when nothing is.
    if (seen.partial.length) {
      let done = null;
      for (let t = at - sc.start; t < sc.dur - 0.05; t += 0.25) {
        const f = this.framed(i, t);
        if (!f.partial.length && f.count > 0) {
          done = t;
          break;
        }
      }
      const where = auto ? `"cover": "auto" picks ${label}` : `the cover at ${label}`;
      const what = seen.partial.map((p) => `${p.name} is ${p.doing}`).join(', and ');
      const advice = done === null ? 'set "cover" to a moment when it is all there, or let it finish sooner' : `set "cover": "${sc.id}@${(Math.ceil(done * 10) / 10).toFixed(1)}", when it is all there`;
      return { level: 'hint', scene: sc.id, t: Math.round((at - sc.start) * 100) / 100, message: `${where}, where ${what}; ${advice}` };
    }
    if (T === null ? seen.picture || !seen.count : !seen.onlyText) return null;
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

  // A tall video of up to 3 minutes is a short: the kind of video that Shorts,
  // TikTok and Reels show to people who scroll.
  isShort() {
    return this.H / this.W >= 1.7 && this.timeline.duration <= SHORT_LONGEST;
  }

  // The stretches of a scene where a clip or a recording plays and its
  // picture changes, as { from, to } in seconds of the scene, from what the
  // scene's elements recorded. A clip plays from its at to its end, except
  // where it shows a still picture, and a recording moves where its steps
  // type, scroll, zoom or change the page.
  movingSpans(entrances, dur) {
    const spans = [];
    for (const e of entrances) {
      if (e.kind === 'recording') spans.push(...e.moving);
      if (e.kind !== 'clip') continue;
      const info = this.clips?.get(e.src);
      const still = info?.still ?? [];
      const step = 0.1;
      let open = null;
      for (let t = Math.max(0, e.at); t < Math.min(e.end ?? e.at, dur); t += step) {
        let at = e.from + (t - e.at) * e.speed;
        if (e.loop && info?.duration > 0) at %= info.duration;
        const moving = !still.some(([from, to]) => at >= from - 1e-6 && at < to);
        if (moving && !open) spans.push((open = { from: t, to: t }));
        if (moving) open.to = Math.min(t + step, e.end, dur);
        else open = null;
      }
    }
    return spans;
  }

  // The rules of a short: the voice starts in the first second, and the picture
  // changes at least every SHORT_CHANGE seconds. The stretch after the last
  // words is the payoff's hold, which may stay still.
  shortHints(changes, add) {
    const scenes = this.timeline.scenes;
    const first = scenes.find((sc) => sc.voice);
    if (first && first.voice.start > SHORT_VOICE_START) add('hint', first.id, 0, `the voice starts at ${first.voice.start.toFixed(1)}s, and in a short the first second carries the hook; give the first scene {lead=0} in the script, so the voice starts at once`);
    const spoken = scenes.filter((sc) => sc.voice).at(-1);
    const end = spoken ? spoken.voice.start + spoken.voice.dur : this.timeline.duration;
    const points = [...new Set(changes.filter((x) => x <= end).map((x) => Math.round(x * 100) / 100)), end].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
      const gap = points[i] - points[i - 1];
      if (gap <= SHORT_CHANGE + 0.05) continue;
      const sc = scenes.findLast((x) => x.start <= points[i - 1] + 1e-6) ?? scenes[0];
      const from = points[i - 1] - sc.start;
      const words = stretchWords(scenes, points[i - 1], points[i], sc);
      add('hint', sc.id, from, `the picture doesn't change for ${gap.toFixed(1)}s, from ${from.toFixed(1)}s, and a short changes it at least every ${SHORT_CHANGE} seconds; show something new on a word in that stretch${words ? `, like ${words}` : ''}, or move the camera with s.short.punch`);
    }
  }

  // The words the captions show at T in the video, as { text, start }, or null.
  captionAt(T) {
    const shown = this.phrases.find((p) => T >= p.start - 0.08 && T < p.until) ?? this.chunks.find((c) => T >= c.start - 0.05 && T < c.until);
    return shown ? shown.words : null;
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
    const add = (level, scene, t, message, extra = {}) => issues.push({ level, scene, t: t === null ? null : Math.round(t * 100) / 100, message, ...extra });
    // The same problem on one element, at every moment it has it. The command
    // line prints these as one line, with the first time, the count and the span.
    const same = (kind, tx) => (tx.element ? { element: `${kind}:${tx.scene}:${tx.element}` } : {});
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
    // Where content may go: the frame, its margin, the content area of a
    // platform size and the caption band.
    const areas = { W, H, margin, app: this.appArea, band: this.captionBand, format: this.config.format, safe: this.safeArea };
    // Text and pictures stay out from under the watermark, also where the
    // scene's own camera zooms them there.
    const watermark = this.watermarkBox();
    // With "defaults": "0.6", pictures in a tall frame of Shorts, TikTok or
    // Reels may run into the parts the app covers and behind the captions, as
    // long as they stay on the frame. Text keeps to s.safe.
    const roomy = this.appArea && H > W && newDefaults(this.config, '0.6');
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
    this.estimatedCues = [];
    // A cue that isn't in the narration is an error, and the rest of its scene is
    // measured with the cue at the scene start.
    this.cueErrors = new Map();
    this.soundsPlayed = new Map();
    // A short video: what changes the picture, in seconds of the video.
    const shortVideo = this.isShort();
    const language = this.config.language || 'en';
    const changes = [];
    let anyBroke = false;
    for (const sc of this.timeline.scenes) {
      const entrances = [];
      this.cameraKeys = new Set();
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
      // Arrows, when they start drawing and when their ends come in.
      this.arrowLog = new Map();
      const n = Math.ceil(sc.dur / step);
      for (let k = 0; k <= n; k++) {
        const t = Math.min(sc.dur - 0.001, k * step);
        this.recorder = { push: (e) => entrances.push(e) };
        this.textLog = [];
        this.drawLog = drawLog();
        this.sceneCamera = null;
        try {
          this.drawScene(ctx, sc.index, t);
        } catch (e) {
          once(`err:${sc.id}:${e.message}`, () => add('error', sc.id, t, e.message));
          broke = true;
          break;
        }
        const laid = { texts: this.textLog.filter((x) => !x.problem), draw: this.drawLog };
        for (const pr of this.textLog.filter((x) => x.problem)) once(pr.video ? `problem:${pr.key}` : `problem:${sc.id}:${pr.key ?? pr.problem}`, () => add(pr.level ?? 'error', sc.id, t, pr.problem));
        if (shownAt === null && laid.draw.shown > 0) shownAt = t;
        filled.push({ t, shown: laid.draw.shown > 0 });
        const texts = laid.texts.filter((x) => x.alpha > 0.5);
        for (const tx of texts) {
          const label = short(tx.text);
          const english = language !== 'en' ? englishKitWord(tx.text) : null;
          if (english) once(`kitword:${sc.id}:${tx.text}`, () => add('hint', sc.id, t, kitWordHint(english, language)));
          const literal = tx.block ? null : markupShown(tx);
          if (literal) once(`markup:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" ${literal}`, same('markup', tx)));
          // UI kit text (s.ui) may leave the frame on purpose while the
          // camera zooms or pans; app screens use smaller text than slides.
          // The short-video kit draws titles and stickers, not app screens.
          const framed = !(tx.ui && tx.zoomed && !tx.short);
          const covered = framed && tx.alpha > 0.95 && tx.settled ? underWatermark(tx, watermark) : null;
          if (covered) {
            once(`watermark:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, watermarkMessage(`"${label}"`, tx, covered, this.sceneCamera), same('watermark', tx)));
          } else if (tx.x0 < -1 || tx.y0 < -1 || tx.x1 > W + 1 || tx.y1 > H + 1) {
            if (framed) once(`off:${sc.id}:${tx.text}`, () => add('error', sc.id, t, `"${label}" runs off the frame (${Math.round(tx.x0)},${Math.round(tx.y0)} to ${Math.round(tx.x1)},${Math.round(tx.y1)} in a ${W}x${H} frame)`, same('off', tx)));
          } else if (this.appArea) {
            // On Shorts, TikTok and Reels: outside the content area, s.safe.
            const message = framed ? contentMessage(`"${label}"`, tx, areas, { verb: 'is', band: inBand(tx, this.captionBand) }) : null;
            if (message) once(`app:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, message + zoomCause(tx, this.sceneCamera, areas, inBand(tx, this.captionBand)), same('app', tx)));
          } else if (framed && (tx.x0 < margin || tx.y0 < margin || tx.x1 > W - margin || tx.y1 > H - margin)) {
            once(`edge:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" sits closer than ${margin}px to the edge`, same('edge', tx)));
          }
          const b = this.captionBand;
          if (inBand(tx, b)) {
            once(`cap:${sc.id}:${tx.text}`, () => add('warn', sc.id, t, `"${label}" is in the caption band (y ${Math.round(b.top)} to ${Math.round(b.bottom)}), where captions can cover it; keep content above s.safe.bottom (${Math.round(this.safeArea.bottom)})`, same('band', tx)));
          }
          // Text on a sticker, a box or a card of its own is measured against
          // that color, *starred* words too.
          const own = cssColor(tx.bg);
          const bg = opaque(own || pageColor(tx, H) || this.theme.bg, this.theme.bg);
          const fg = cssColor(tx.fg);
          if (fg && contrast(fg, bg) < 3) once(`contrast:${sc.id}:${tx.text}`, () => {
            add('warn', sc.id, t, `"${label}" has low contrast against its background (${contrast(fg, bg).toFixed(1)}:1); ${contrastAdvice(tx.option ?? 'color', pixelColor(fg), pixelColor(bg), tx.size, named())}`, same('contrast', tx));
          });
          const mark = own && cssColor(tx.mark);
          if (mark && contrast(mark, bg) < 3) once(`mark:${sc.id}:${tx.text}`, () => {
            add('warn', sc.id, t, `the *starred* words in "${label}" have low contrast against its background (${contrast(mark, bg).toFixed(1)}:1); ${contrastAdvice('mark', pixelColor(mark), pixelColor(bg), tx.size, named())}`, same('mark', tx));
          });
        }
        // Screen text that says four or more words in a row of what the
        // captions show at the same moment. A hook title is the headline of a
        // short, there before the voice says it, so it doesn't count.
        const caption = cjkLanguage(language) ? null : this.captionAt(sc.start + t);
        if (caption) {
          for (const tx of texts) {
            if (tx.block || tx.role === 'title') continue;
            const run = sharedRun(tx.text, caption);
            if (run) once(`echo:${sc.id}:${tx.element ?? tx.text}`, () => add('hint', sc.id, t, `"${short(tx.text)}" shows "${run.text}" while the captions show the same words, in "${sentenceOf(sc, run.first)}". The captions already carry what the voice says, so keep the screen text to a short label or a number, or leave it out`));
          }
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
        for (const f of stickersOverTitles(laid.draw.shapes, solid)) once(`sticker:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of stickersOverPictures(laid.draw.shapes, solid, W, H)) once(`sticker:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of shapeOverlaps(laid.draw.shapes)) once(`shapes:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of textsIntoShapes(solid, laid.draw.shapes)) once(`shapes:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of linesOverText(laid.draw.strokes, solid)) once(`line:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of labelsIntoShapes(laid.draw.strokes, solid, laid.draw.shapes)) once(`label:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        for (const f of arrowsThroughShapes(laid.draw.strokes, laid.draw.shapes)) once(`through:${sc.id}:${f.key}`, () => add('warn', sc.id, t, f.message));
        // The box of a drawing counts in the frame like text: off the frame,
        // outside the content area of a platform size, close to the edge or in
        // the caption band. Other shapes count in the content area and the
        // caption band. A clip or image that fills the frame is a background, and
        // an app screen may leave the frame while the scene's camera zooms.
        for (const sh of laid.draw.shapes) {
          if (!sh.settled || sh.alpha <= 0.95) continue;
          const drawing = sh.kind === 'drawing';
          if (!drawing && (fillsFrame(sh.box, W, H) || (sh.ui && sh.zoomed && !sh.short))) continue;
          const covered = underWatermark(sh.box, watermark, PICTURES.has(sh.kind));
          if (covered) {
            once(`drawing-watermark:${sc.id}:${shapeKey(sh)}`, () => add('warn', sc.id, t, watermarkMessage(shapeName(sh), sh.box, covered, this.sceneCamera, true)));
            continue;
          }
          if (roomy && !drawing) continue;
          const message = roomy ? offFrame(shapeName(sh), sh.box, W, H) : edgeMessage(shapeName(sh), sh.box, areas, { edge: drawing });
          if (message) once(`drawing-edge:${sc.id}:${shapeKey(sh)}`, () => add('warn', sc.id, t, message));
        }
        // The line of an arrow counts in the frame like its label: off the frame,
        // outside the content area of a platform size, close to the edge or in
        // the caption band.
        for (const line of laid.draw.strokes) {
          if (line.kind !== 'arrow' || !line.settled || line.alpha <= 0.95) continue;
          const b = bounds(line.points);
          const where = `${Math.round(b.x0)},${Math.round(b.y0)} to ${Math.round(b.x1)},${Math.round(b.y1)}`;
          const band = this.captionBand;
          const banded = !!band && line.points.some(([x, y]) => y > band.top + 2 && y < band.bottom - 2 && x > band.left && x < band.right);
          const near = !this.appArea && (b.x0 < margin || b.y0 < margin || b.x1 > W - margin || b.y1 > H - margin);
          const message = !inFrame(b) ? `${line.name} runs off the frame (${where} in a ${W}x${H} frame); move its ends inside`
            : roomy ? null
            : contentMessage(line.name, b, areas, { band: banded })
              ?? (near ? `${line.name} comes closer than ${margin}px to the edge (${where})` : null)
              ?? (banded ? `${line.name} runs into the caption band (y ${Math.round(band.top)} to ${Math.round(band.bottom)}), where captions can cover it; keep it above s.safe.bottom (${Math.round(this.safeArea.bottom)})` : null);
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
          // A table of texts, which the shot shows only in part: some rows
          // without the header, or some columns without the others.
          if (held && filmed.texts.length === laid.texts.length) {
            for (const f of cutTables(laid.texts, filmed.texts, onScreen, inFrame)) {
              once(`table:${sc.id}:${f.key}`, () => add('warn', sc.id, t, `the camera shows only part of the table with "${short(f.shown)}" while it holds still: ${f.out} ${f.count > 1 ? 'are' : 'is'} out of the shot; keep this scene still with s.camera([]), or point the camera with s.focus`));
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
        const least = size.tx.ui && !size.tx.badge ? uiMinSize : minSize;
        if (Math.round(size.tx.size) < least) once(`small:${sc.id}:${text}`, () => add('warn', sc.id, size.t, `"${short(text)}" is ${Math.round(size.tx.size)}px, hard to read (use at least ${least}px)`));
        // Above that, text that shows small on a phone gets a hint, as the
        // camera shows it at its widest once it has arrived, once per video for
        // a label that comes back in later scenes. App screens and code use
        // smaller text on purpose.
        else if (calm && (!calm.tx.ui || calm.tx.badge) && !calm.tx.block && Math.round(calm.tx.size) < readable) once(`smallish:${text}`, () => add('hint', sc.id, calm.t, `"${short(text)}" shows ${Math.round(calm.tx.size)}px tall at ${calm.t.toFixed(1)}s, small on a phone, where labels read best at ${Math.round(40 * scale1080)} to ${Math.round(56 * scale1080)}px; make it bigger, or give the picture more of the frame`));
        const message = viewWidth !== null && play ? playbackTextIssue(play.tx, W, H, viewWidth) : null;
        if (message) once(`playback:${sc.id}:${text}`, () => add('warn', sc.id, play.t, message));
      }
      this.recorder = null;
      this.textLog = null;
      const times = [...new Set(entrances.map((e) => Math.round(e.at * 100) / 100))].sort((a, b) => a - b);
      // While a clip or a recording plays and its picture changes, something
      // happens: as points every half second, in seconds of the scene.
      const playing = [];
      for (const m of this.movingSpans(entrances, sc.dur)) {
        for (let x = Math.max(0, m.from); x < Math.min(sc.dur, m.to); x += 0.5) playing.push(x);
        if (m.to >= 0 && m.to <= sc.dur) playing.push(m.to);
      }
      // A new scene, an entrance and a camera move change the picture, and so
      // does a clip or a recording that plays. A scene that stopped with an
      // error has its error, and no hint is given about stretches.
      if (broke) anyBroke = true;
      if (shortVideo && !broke) {
        changes.push(sc.start);
        // A recording changes it where its steps type, scroll, zoom or change
        // the page, and not at a step that only marks a moment.
        const shown = entrances.filter((e) => e.kind !== 'recording-step').map((e) => e.at);
        for (const x of [...shown, ...this.cameraKeys, ...playing]) if (x >= 0 && x <= sc.dur) changes.push(sc.start + x);
      }
      this.cameraKeys = null;
      for (const e of entrances) {
        if (e.kind === 'clip') {
          if (e.volume > 0 && e.speed !== 1) once(`clip-sound:${sc.id}:${e.key}`, () => add('warn', sc.id, e.at, `clip "${e.src}" stays silent at speed ${Math.round(e.speed * 100) / 100}${e.fit ? ", which speed: 'fit' picked" : ''}; use speed: 1 for its sound`));
          const frozen = e.loop ? 0 : e.out - e.end;
          const held = e.to === undefined ? 'its last frame' : `its frame at to: ${+e.to.toFixed(2)}`;
          if (frozen > FREEZE_SECONDS) once(`clip-freeze:${sc.id}:${e.key}`, () => add('warn', sc.id, e.end, `clip "${e.src}" freezes on ${held} for ${frozen.toFixed(1)}s, from ${e.end.toFixed(2)}s until ${e.out.toFixed(2)}s. ${e.fit
            ? `speed: 'fit' goes no slower than ${FIT_SPEEDS[0]} times the clip's speed, and this one needs slower. Use loop: true, ${e.to === undefined ? 'a longer clip' : 'a later to'} or an earlier out`
            : "speed: 'fit' plays it slower, so it ends with the scene, and loop: true repeats it"}`));
        }
        if (e.kind === 'recording') {
          if (e.changed) once(`recording-changed:${e.name}`, () => add('warn', sc.id, e.at, `recordings/${e.name}.json changed after recording "${e.name}" was made: a change to its steps other than a cue, or to its url, viewport, locale, pace or blur, needs a new recording; run "explainroo record <project> ${e.name}" again`));
          for (const l of e.late) once(`recording-late:${sc.id}:${e.key}:${l.step}`, () => add('warn', sc.id, l.cueAt, `recording "${e.name}" ${l.label} comes ${l.by.toFixed(1)}s after its cue "${l.cue}", because the steps before it take longer, also at ${CATCH_UP} times the speed; cue a later word, start the recording earlier with at, or record fewer or quicker steps with the script's pace, a step's duration or a type step's cps`));
          if (e.small) {
            const size = `recording "${e.name}" plays at ${Math.round(e.small.shown * 100)}% of its size, ${e.width} pixels wide in ${Math.round(e.width * e.small.shown)}`;
            const zoom = e.small.step && `{ ${Object.entries(e.small.step).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
            once(`recording-small:${sc.id}:${e.key}`, () => add('warn', sc.id, e.at, e.small.off
              ? `${size}, and zoom: false keeps its zooms out, so its text is small to read. Take out zoom: false, or show it larger`
              : `${size}, and none of its steps zooms in, so its text is small to read. Add a zoom step to recordings/${e.name}.json${e.small.before ? ` before step ${e.small.before}` : ''}, like ${zoom}, and record it again`));
          }
          else if (e.text) {
            // The viewport that fits the most of the content area the page
            // can play at, less the bar of its frame.
            const fit = fitViewport(e.room.w, e.room.h);
            const then = Math.round(PAGE_TEXT * Math.min(e.room.w / fit.width, e.room.h / fit.height));
            const px = (b) => `${Math.round(b.w)}x${Math.round(b.h)}`;
            const room = `${px(e.room)} the page can take there`;
            const plays = `recording "${e.name}" plays its ${e.width}x${e.height} page at ${px(e.played)} in a content area of ${px(e.area)}${e.frame ? `, with its ${e.frame} frame` : ''}, so the page's ${PAGE_TEXT}px text shows ${Math.round(e.text.px)}px tall`;
            const fix = then < PLAYED_TEXT
              ? `Show it larger: in the ${room}, even the smallest viewport, { "width": ${fit.width}, "height": ${fit.height} }, plays its ${PAGE_TEXT}px text at about ${then}px`
              : `Record it with "viewport": { "width": ${fit.width}, "height": ${fit.height} } in recordings/${e.name}.json: that shape fits the ${room}, and its ${PAGE_TEXT}px text shows about ${then}px tall`;
            const spans = e.unzoomed?.map((sp) => `${sp.from.toFixed(1)} to ${sp.to.toFixed(1)}s`);
            once(`recording-text:${sc.id}:${e.key}`, () => (e.unzoomed
              ? add('hint', sc.id, e.at, `${plays} where it doesn't zoom${spans.length ? `, from ${spans.join(' and ')} of the scene` : ''}. Every type step and every cued step on an element plays inside a zoom, so that is fine when the viewer needs to read nothing there. For larger text everywhere: ${fix[0].toLowerCase()}${fix.slice(1)}`)
              : add('warn', sc.id, e.at, `${plays}, under ${PLAYED_TEXT}px and hard to read on a phone. A zoom helps only while it holds. ${fix}`)));
          }
          if (e.cut) once(`recording-cut:${sc.id}:${e.key}`, () => add('warn', sc.id, e.out, `recording "${e.name}" is cut off at ${e.out.toFixed(1)}s: ${e.cut.first}${e.cut.count > 1 ? ` and ${e.cut.count - 1} more step${e.cut.count > 2 ? 's' : ''}` : ''} would come at ${e.cut.at.toFixed(1)}s. ${e.fit ? `speed: 'fit' goes no faster than ${FIT_SPEEDS[1]} times; make the narration longer or record fewer steps` : "speed: 'fit' plays it faster, so it ends with the scene, or the narration can be longer"}`));
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
      // An arrow that starts drawing before an element it starts from or points
      // at has come in, so it points at empty space for a while.
      if (!broke) {
        for (const a of this.arrowLog.values()) {
          for (const e of a.ends) {
            if (a.at >= sc.dur || !(e.at > (e.side === 'to' ? a.reach : a.at + ARROW_SLACK))) continue;
            const like = e.spec === undefined ? '' : `, like at: ${typeof e.spec === 'string' ? `'${e.spec}'` : e.spec}`;
            once(`arrow-early:${sc.id}:${a.name}:${e.id}`, () => add('warn', sc.id, a.at, `${a.name} starts drawing at ${a.at.toFixed(1)}s, but "${e.id}", which it ${e.side === 'to' ? 'points at' : 'starts from'}, comes in at ${e.at.toFixed(1)}s; give the arrow the at of "${e.id}" or a later one${like}`));
          }
        }
      }
      this.arrowLog = null;
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
      } else if (!times.length && !playing.length) {
        add('warn', sc.id, null, 'nothing enters in this scene; add at least one element with an "at" time');
      } else {
        // The hold that targetSeconds adds may stay still.
        const end = sc.dur - (sc.added ?? 0);
        const marks = [0, ...[...new Set([...times, ...playing])].filter((x) => x >= 0 && x <= end).sort((a, b) => a - b), end];
        for (let i = 1; i < marks.length; i++) {
          const gap = marks[i] - marks[i - 1];
          // The empty start already has its hint.
          if (emptyStart && i === 1) continue;
          if (gap > 6 && !shortVideo) add('hint', sc.id, marks[i - 1], `no new element for ${gap.toFixed(1)}s (from ${marks[i - 1].toFixed(1)}s); consider revealing something on a cue in that stretch`);
        }
      }
    }
    if (shortVideo && !anyBroke) this.shortHints(changes, add);
    const repeated = new Map();
    for (const c of this.cueNotes) repeated.set(`${c.scene}|${c.word.toLowerCase()}`, c);
    for (const c of repeated.values()) {
      add('hint', c.scene, null, `cue "${c.word}" means the first of the ${c.count} times it is spoken in this scene; write "${c.word}#1" if you mean the first time, or "${c.word}#2" for a later one`);
    }
    const estimated = new Map();
    for (const c of this.estimatedCues) if (!estimated.has(`${c.scene}|${c.word}`)) estimated.set(`${c.scene}|${c.word}`, c);
    for (const c of estimated.values()) {
      const near = c.near ? ` "${c.near.cue}" at ${c.near.t.toFixed(2)} s has a measured time, so cue that word when the picture has to land exactly.` : '';
      add('hint', c.scene, c.t, `cue "${c.word}" sits on an estimated time: the speech check heard no start of its own for this word, like when Whisper writes "one hundred dollars" as "$100".${near}`);
    }
    this.cueNotes = null;
    this.estimatedCues = null;
    this.cueErrors = null;
    for (const { scene, t, tex } of this.lateMath.values()) add('error', scene, t, `math "${tex}" was not collected at the start; keep TeX strings fixed and always call s.math with at and out for timing`);
    if (!anyBroke) for (const f of this.transitionOverlaps()) add('hint', f.scene, f.t, f.message);
    return issues;
  }

  // The texts a scene shows at `t`, as check logs them, with the camera off.
  textsAt(index, t) {
    const scratch = (this._framedCanvas ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const saved = { textLog: this.textLog, drawLog: this.drawLog, recorder: this.recorder };
    this.textLog = [];
    this.drawLog = drawLog();
    this.recorder = null;
    try {
      this.drawScene(scratch.getContext('2d'), index, t);
      return this.textLog.filter((x) => !x.problem && x.alpha > 0.3 && String(x.text).trim());
    } catch {
      return [];
    } finally {
      Object.assign(this, saved);
    }
  }

  // Different text of two scenes in the same place during a zoom between
  // them, for more than two frames. A zoom shows the two at different sizes,
  // so they read as doubled. A fade only blends one into the other, which is
  // what a fade is for, and the same text in both scenes is one thing that
  // stays. A slide, a push, a wipe and a brush show each part of the frame
  // from one scene only, and a cut shows no two scenes at all.
  transitionOverlaps() {
    const found = [];
    const { W, H } = this;
    for (const sc of this.timeline.scenes) {
      const blend = this.blendIn(sc);
      const name = this.transitionFor(sc);
      if (!blend || name !== 'zoom') continue;
      const prev = this.timeline.scenes[sc.index - 1];
      const frames = Math.ceil(blend * this.fps);
      let count = 0;
      let first = null;
      for (let f = 0; f < frames; f++) {
        const t = f / this.fps;
        const e = ease.inOut(t / blend);
        // Each side as the frame shows it: how much shows, and how much bigger.
        const sides = [
          { texts: this.textsAt(prev.index, sc.start + t - prev.start), weight: 1 - e, grow: name === 'zoom' ? 1 + 0.12 * e : 1 },
          { texts: this.textsAt(sc.index, t), weight: e, grow: name === 'zoom' ? 0.94 + 0.06 * e : 1 },
        ];
        if (sides.some((side) => side.weight < 0.15)) continue;
        const box = (x, k) => ({ x0: W / 2 + (x.x0 - W / 2) * k, x1: W / 2 + (x.x1 - W / 2) * k, y0: H / 2 + (x.y0 - H / 2) * k, y1: H / 2 + (x.y1 - H / 2) * k });
        let pair = null;
        for (const A of sides[0].texts) {
          for (const B of sides[1].texts) {
            if (String(A.text).trim() === String(B.text).trim()) continue;
            const a = box(A, sides[0].grow);
            const b = box(B, sides[1].grow);
            const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
            const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) || 1;
            if (ix > 4 && iy > 4 && (ix * iy) / small > 0.15) pair ??= [A.text, B.text];
          }
        }
        if (!pair) continue;
        count++;
        first ??= { t, pair };
      }
      if (count <= 2) continue;
      const label = (text) => `"${text.length > 30 ? text.slice(0, 27) + '...' : text}"`;
      const [a, b] = first.pair;
      found.push({ scene: sc.id, t: Math.round(first.t * 100) / 100, message: `during the ${name} from "${prev.id}" into this scene, ${label(a)} of "${prev.id}" and ${label(b)} of this scene show in the same place for ${count} frames, from ${(sc.start + first.t).toFixed(1)}s in the video; give the scene {transition=cut} or {transition=push} in the script, or let one of them leave or come later` });
    }
    return found;
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

const cjkLanguage = (language) => ['ja', 'zh'].includes(language);

// The longest run of four or more words in a row that `text` and the caption
// words share, as { text, first } with the text the captions show and its first
// word, or null.
function sharedRun(text, words) {
  const a = String(text).split(/\s+/).map(normWord).filter(Boolean);
  const b = words.map((w) => normWord(w.text));
  let best = { length: 0, end: 0 };
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let n = 0;
      while (i + n < a.length && j + n < b.length && b[j + n] && a[i + n] === b[j + n]) n++;
      if (n > best.length) best = { length: n, end: j + n };
    }
  }
  if (best.length < 4) return null;
  const run = words.slice(best.end - best.length, best.end);
  return { text: run.map((w) => w.text).join(' ').replace(/[,.;:!?]+$/, ''), first: run[0] };
}

// The sentence of the scene's narration that the caption word `first` is in.
function sentenceOf(sc, first) {
  const k = sc.words.findIndex((w) => Math.abs(sc.start + w.start - first.start) < 1e-6);
  if (k === -1) return first.text;
  const end = (w) => /[.!?…]["'’)\]]*$/.test(w.text);
  let from = k;
  while (from > 0 && !end(sc.words[from - 1])) from--;
  let to = k;
  while (to < sc.words.length - 1 && !end(sc.words[to])) to++;
  return sc.words.slice(from, to + 1).map((w) => w.text).join(' ');
}

// Whether a box reaches into the caption band.
function inBand(b, band) {
  return !!band && b.y1 > band.top + 2 && b.y0 < band.bottom - 2 && b.x1 > band.left && b.x0 < band.right;
}

// The content area of a platform size, like Shorts or TikTok, is s.safe: the part
// the app leaves free, without the strip the watermark takes at the top and
// without the caption band. What check says about a box outside it, or null.
// A box in the caption band gets the finding of the band, unless it also
// reaches where the app's buttons are.
function contentMessage(name, b, { app, safe, format }, { verb = 'reaches', band = false } = {}) {
  if (!app) return null;
  const out = (r) => b.x0 < r.left - 2 || b.y0 < r.top - 2 || b.x1 > r.right + 2 || b.y1 > r.bottom + 2;
  if (!out(safe) || (band && !out(app))) return null;
  const R = Math.round;
  const area = `the ${format} content area (${R(safe.left)},${R(safe.top)} to ${R(safe.right)},${R(safe.bottom)}, ${R(safe.right - safe.left)}x${R(safe.bottom - safe.top)})`;
  if (out(app)) return `${name} ${verb} outside ${area}, where the app's buttons and post text can cover it`;
  return `${name} ${verb} outside ${area}, ${b.y0 < safe.top - 2 ? 'in the strip at the top that the watermark takes' : 'right next to the captions'}`;
}

// Why a box is outside the content area when the scene's own camera zooms in
// and it fits there without the zoom: the text that check adds, or ''.
function zoomCause(b, cam, areas, band) {
  if (!cam || cam.zoom <= 1.001 || cam.rotate) return '';
  const back = (x, y) => [cam.x + (x - cam.cx) / cam.zoom, cam.y + (y - cam.cy) / cam.zoom];
  const [x0, y0] = back(b.x0, b.y0);
  const [x1, y1] = back(b.x1, b.y1);
  if (contentMessage('', { x0, y0, x1, y1 }, areas, { band })) return '';
  const zoom = Math.round(cam.zoom * 100) / 100;
  return `. The camera's zoom of ${zoom}x pushes it there, and without the zoom it fits: zoom less, or move it toward the point the camera zooms onto`;
}

// What check says about text that shows its markup as it is written: *stars*
// around a word, a backslash and an n where a new line was meant, or a new
// line that a kit drew on one line. Null when it shows none.
function markupShown(tx) {
  const star = new RegExp(STARRED.source).exec(tx.text);
  if (star) return `shows the stars of "*${star[1].length > 30 ? star[1].slice(0, 27) + '...' : star[1]}*" as they are written: this call doesn't set *starred* words in the accent color. Leave the stars out, or use one that does, like s.text, s.title or, with "defaults": "0.6", the s.ui text helpers`;
  if (/\\n/.test(tx.text)) return 'shows a backslash and an n where a new line was meant. In scenes.js, write \\n inside the quotes, not \\\\n, or draw each line on its own';
  if ((tx.ui || tx.short) && tx.text.includes('\n')) return 'has a new line that this call draws as a space, on one line. Draw each line on its own, or use a call that takes \\n, like s.text or, with "defaults": "0.6", the s.ui text helpers';
  return null;
}

// The shapes that are pictures. A large one may run behind the watermark. A
// card, a sticker, a box or a code window is a panel that holds words, and the
// watermark on its corner reads as part of it.
const PICTURES = new Set(['icon', 'image', 'drawing']);

// The watermark's box when `b` reaches more than 4 pixels under it, or null.
// With `part`, a box counts only when the watermark covers at least a twentieth
// of it, so a large picture may run behind the watermark.
function underWatermark(b, mark, part = false) {
  if (!mark) return null;
  const ix = Math.min(b.x1, mark.x1) - Math.max(b.x0, mark.x0);
  const iy = Math.min(b.y1, mark.y1) - Math.max(b.y0, mark.y0);
  if (ix <= 4 || iy <= 4) return null;
  if (part && ix * iy < 0.05 * (b.x1 - b.x0) * (b.y1 - b.y0)) return null;
  return mark;
}

// What check says about text or a picture with the box `b` under the
// watermark, and whether the zoom of the scene's own camera puts it there.
function watermarkMessage(name, b, mark, cam, part = false) {
  const R = Math.round;
  const message = `${name} is under the "${mark.text}" watermark (${R(mark.x0)},${R(mark.y0)} to ${R(mark.x1)},${R(mark.y1)}), which covers it`;
  if (cam && cam.zoom > 1.001 && !cam.rotate) {
    const back = (x, y) => [cam.x + (x - cam.cx) / cam.zoom, cam.y + (y - cam.cy) / cam.zoom];
    const [x0, y0] = back(b.x0, b.y0);
    const [x1, y1] = back(b.x1, b.y1);
    if (!underWatermark({ x0, y0, x1, y1 }, mark, part)) return `${message}. The camera's zoom of ${Math.round(cam.zoom * 100) / 100}x pushes it there, and without the zoom it is clear of it: zoom less, or move it toward the point the camera zooms onto`;
  }
  return `${message}; move it clear of the watermark`;
}

// The first two words spoken between `from` and `to` in the video, as cues
// with their times in their scene, like "twitch" at 1.6s. A word said more than
// once in its scene is named with its number, like "fills#2". A word of
// another scene than `sc` names its scene.
function stretchWords(scenes, from, to, sc) {
  const found = [];
  for (const scene of scenes) {
    const count = new Map();
    for (const w of scene.words ?? []) {
      const key = bareCue(w.text);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    const seen = new Map();
    for (const w of scene.words ?? []) {
      const key = bareCue(w.text);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      const at = scene.start + w.start;
      if (!key || at <= from + 0.05 || at >= to - 0.05 || found.length >= 2) continue;
      const word = bareCue(w.text, false);
      const cue = count.get(key) > 1 ? `${word}#${seen.get(key)}` : word;
      found.push(`"${cue}" at ${scene === sc ? '' : `${scene.id}@`}${w.start.toFixed(1)}s`);
    }
  }
  return found.join(' or ');
}

// A word as a cue names it: without the marks around it, and to compare, in
// lower case.
function bareCue(text, lower = true) {
  const bare = String(text).trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '');
  return lower ? bare.toLowerCase() : bare;
}

// What check says about a box that runs off the frame, or null.
function offFrame(name, b, W, H) {
  if (b.x0 >= -1 && b.y0 >= -1 && b.x1 <= W + 1 && b.y1 <= H + 1) return null;
  return `${name} runs off the frame (${Math.round(b.x0)},${Math.round(b.y0)} to ${Math.round(b.x1)},${Math.round(b.y1)} in a ${W}x${H} frame)`;
}

// What check says about a box that runs off the frame, outside the content area
// of a platform size, close to the edge or into the caption band, or null.
// `edge: false` leaves out the frame and its edge on other sizes.
function edgeMessage(name, b, { W, H, margin, app, band, format, safe }, { edge = true } = {}) {
  const where = `${Math.round(b.x0)},${Math.round(b.y0)} to ${Math.round(b.x1)},${Math.round(b.y1)}`;
  const banded = inBand(b, band);
  if (edge && (b.x0 < -1 || b.y0 < -1 || b.x1 > W + 1 || b.y1 > H + 1)) return `${name} runs off the frame (${where} in a ${W}x${H} frame)`;
  const content = contentMessage(name, b, { app, safe, format }, { band: banded });
  if (content) return content;
  if (edge && !app && (b.x0 < margin || b.y0 < margin || b.x1 > W - margin || b.y1 > H - margin)) return `${name} comes closer than ${margin}px to the edge (${where})`;
  if (banded) return `${name} runs into the caption band (y ${Math.round(band.top)} to ${Math.round(band.bottom)}), where captions can cover it; keep it above s.safe.bottom (${Math.round(safe.bottom)})`;
  return null;
}

// Texts on their own, not on a box or as an arrow's label, that line up in
// rows and columns, at least two of each with two texts or more, make a
// table. A shot that shows part of a column and leaves the rest of it out,
// or cuts it, cuts the table. Each finding names a text the shot shows, the
// texts of those columns it leaves out from the top left, and a key for the
// table.
function cutTables(laid, filmed, onScreen, inFrame) {
  const free = [];
  laid.forEach((tx, i) => {
    if (tx.alpha > 0.95 && tx.settled && !tx.block && !tx.ui && !tx.shape && tx.owner === null && !tx.partial && String(tx.text).trim() && inFrame(tx)) free.push({ tx, shot: filmed[i] });
  });
  const mid = (a, b) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) <= Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.2;
  const near = (u, v) => Math.abs(u - v) <= 3;
  const column = (a, b) => near((a.x0 + a.x1) / 2, (b.x0 + b.x1) / 2) || near(a.x0, b.x0) || near(a.x1, b.x1);
  // A cell shares its row with another text and its column with another, so
  // a title centered over the table is no part of it.
  const cells = free.filter((c) => free.some((d) => d !== c && mid(c.tx, d.tx)) && free.some((d) => d !== c && column(c.tx, d.tx)));
  // Tables are the groups of cells linked by a shared row or column.
  const parent = cells.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (mid(cells[i].tx, cells[j].tx) || column(cells[i].tx, cells[j].tx)) parent[root(i)] = root(j);
    }
  }
  const tables = new Map();
  cells.forEach((cell, i) => {
    const k = root(i);
    if (!tables.has(k)) tables.set(k, []);
    tables.get(k).push(cell);
  });
  const found = [];
  for (const list of tables.values()) {
    // Two rows of two or more, and two columns of two or more.
    const lines = (same) => {
      const groups = [];
      for (const c of list) {
        const g = groups.find((x) => same(x[0].tx, c.tx));
        if (g) g.push(c);
        else groups.push([c]);
      }
      return groups.filter((g) => g.length >= 2);
    };
    const columns = lines(column);
    if (lines(mid).length < 2 || columns.length < 2) continue;
    // A column the shot splits, like rows without their header. A close-up
    // of whole columns, like one side of a comparison, is fine.
    const split = columns.filter((g) => g.some((c) => onScreen(c.shot)) && g.some((c) => !inFrame(c.shot)));
    if (!split.length) continue;
    const order = (a, b) => a.tx.y0 - b.tx.y0 || a.tx.x0 - b.tx.x0;
    const left = [...new Set(split.flat().filter((c) => !inFrame(c.shot)))].sort(order);
    const shown = split.flat().filter((c) => inFrame(c.shot)).sort(order);
    const names = left.slice(0, 2).map((c) => `"${String(c.tx.text).slice(0, 30)}"`);
    const more = left.length - names.length;
    found.push({
      key: [...list].sort(order)[0].tx.text,
      shown: (shown[0] ?? split.flat().filter((c) => onScreen(c.shot)).sort(order)[0]).tx.text,
      out: more > 0 ? `${names.join(', ')} and ${more} more` : names.join(' and '),
      count: left.length,
    });
  }
  return found;
}

// The canvas calls that put something on it.
const INK_CALLS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);

// A scene may show only its background this long at the start, in seconds.
const EMPTY_START = 1.5;
// A mark may stay this long after what it marks has gone, in seconds.
const MARK_SLACK = 0.3;
// An arrow may start drawing this many seconds before the element it starts
// from comes in. The element it points at may come in until its tip arrives.
const ARROW_SLACK = 0.1;
// A code window or a terminal may be empty this long before its first line.
const EMPTY_WINDOW = 1;
// A short is a tall video of up to this many seconds. Its picture changes at
// least this often, and its voice starts within the first second.
const SHORT_LONGEST = 180;
const SHORT_CHANGE = 2;
const SHORT_VOICE_START = 0.5;
// "cover": "auto" looks at this many frames of the first scene at most.
const COVER_FRAMES = 600;

// What check collects while it draws one moment of a scene: the shapes and
// lines drawn, in design pixels, and how many elements are on screen.
function drawLog() {
  return { shapes: [], strokes: [], lives: [], partial: [], shown: 0, order: 0 };
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

// Stickers that cover words of a hook title. A sticker's overlap: true lets it
// sit on pictures and backgrounds, never on the title, so this ignores it.
function stickersOverTitles(shapes, texts) {
  const found = [];
  const titles = texts.filter((tx) => tx.role === 'title');
  if (!titles.length) return found;
  for (const sh of shapes) {
    if (sh.kind !== 'sticker' || !sh.settled || sh.alpha <= 0.95) continue;
    const covered = titles.filter((tx) => Math.min(sh.box.x1, tx.x1) - Math.max(sh.box.x0, tx.x0) > 4 && Math.min(sh.box.y1, tx.y1) - Math.max(sh.box.y0, tx.y0) > 4 && overlapDepth(sh.poly, [[tx.x0, tx.y0], [tx.x1, tx.y0], [tx.x1, tx.y1], [tx.x0, tx.y1]]) > 4);
    if (!covered.length) continue;
    const words = covered.map((tx) => tx.text).join(' ');
    found.push({ key: `${sh.serial}/${words}`, message: `the sticker "${sh.name.slice(0, 30)}" covers "${words.slice(0, 40)}" of the hook title; move the sticker with x and y, or give it a later at` });
  }
  return found;
}

// Stickers that cover an icon, an image, a clip, a drawing or text that isn't
// their own, also with overlap: true, which lets a sticker cover backgrounds
// only. A picture that fills the frame is a background, and so is a faint
// one, like the large copy of a subject behind the captions. The hook title
// has a finding of its own.
export function stickersOverPictures(shapes, texts, W, H) {
  const found = [];
  const pictures = shapes.filter((sh) => ['icon', 'image', 'drawing'].includes(sh.kind) && sh.settled && sh.alpha > 0.5 && !fillsFrame(sh.box, W, H));
  for (const sh of shapes) {
    if (sh.kind !== 'sticker' || !sh.settled || sh.alpha <= 0.95) continue;
    const name = `the sticker "${sh.name.slice(0, 30)}"`;
    for (const p of pictures) {
      if (overlapDepth(sh.poly, p.poly) <= 4 && !holds(p.poly, sh.poly) && !holds(sh.poly, p.poly)) continue;
      found.push({ key: `${sh.serial}/${p.kind}/${p.id ?? p.name}`, message: `${name} covers ${shapeName(p)}; move the sticker with x and y. overlap: true lets a sticker cover backgrounds only` });
    }
    for (const tx of texts) {
      if (tx.owner === sh.serial || tx.role === 'title' || !tx.settled) continue;
      if (overlapDepth(sh.poly, [[tx.x0, tx.y0], [tx.x1, tx.y0], [tx.x1, tx.y1], [tx.x0, tx.y1]]) <= 4) continue;
      found.push({ key: `${sh.serial}/text/${tx.text}`, message: `${name} covers the text "${tx.text.slice(0, 30)}"; move the sticker with x and y` });
    }
  }
  return found;
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
      // A sticker over a picture has a finding of its own.
      const picture = (x) => ['icon', 'image', 'drawing'].includes(x.kind);
      if ((A.kind === 'sticker' && picture(B)) || (B.kind === 'sticker' && picture(A))) continue;
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
// the same group, app screens, arrow labels (which have a check of their own),
// stickers (which have one too) and overlap: true on either don't count. The
// titles and cards of the short-video kit are no app screens, so they count.
export function textsIntoShapes(texts, shapes) {
  const list = shapes.filter((s) => s.settled && s.alpha > 0.95 && !s.overlap && !s.cover && !(s.ui && !s.short) && s.kind !== 'sticker');
  const found = [];
  for (const tx of texts) {
    if (!tx.settled || tx.alpha <= 0.95 || tx.block || (tx.ui && !tx.short) || tx.overlap || (tx.owner !== null && tx.owner !== undefined)) continue;
    const box = [[tx.x0, tx.y0], [tx.x1, tx.y0], [tx.x1, tx.y1], [tx.x0, tx.y1]];
    for (const sh of list) {
      if ((tx.shape !== null && tx.shape === sh.serial) || (sh.group !== null && sh.group === tx.group)) continue;
      // The outer and the inner edge of the drawn border.
      const outer = grow(sh.poly, sh.edge ?? 0);
      const inner = grow(sh.poly, -(sh.edge ?? 0));
      const depth = overlapDepth(outer, box);
      if (depth <= 4 || holds(inner, box) || holds(box, outer)) continue;
      const label = tx.text.length > 40 ? tx.text.slice(0, 37) + '...' : tx.text;
      // A drawing that moves is one finding, by its call.
      found.push({ key: `${sh.call ?? shapeKey(sh)}/${tx.text}`, message: `"${label}" and ${shapeName(sh)} partly overlap, by ${Math.round(depth)}px; move them apart, or give one of them overlap: true if that is meant` });
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
