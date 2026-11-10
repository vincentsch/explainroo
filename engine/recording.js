// Playback of a recording that `explainroo record` made: when each part of the
// video shows, where the cursor is and what the view zooms in on, all from its
// step log. Every function here is pure, so a frame stays a function of time.
// Times in the log are seconds into the video, and places are pixels of it.
import { clamp, lerp, ease } from './util.js';

// How long a zoom takes, in seconds of the video. record waits as long, so the
// next step starts once the view has arrived.
export const ZOOM_SECONDS = 0.8;
// How far a zoom goes: as close as fits the element into about ZOOM_FIT of the
// view, but at least ZOOM_RANGE[0] and at most ZOOM_RANGE[1] times closer than
// the whole recording, so every zoom shows. A step's scale sets its own, within
// ZOOM_SCALES.
export const ZOOM_FIT = 0.7;
export const ZOOM_RANGE = [1.4, 2.5];
export const ZOOM_SCALES = [1, 4];
// How long a click ring grows and fades, in seconds of the scene.
export const RING_SECONDS = 0.6;
// A step that lands later than this after its cue gets a warning from check.
export const LATE_SECONDS = 0.15;

// A recording shown at less than this part of its size, and with no zoom,
// gets a warning from check, as its text gets hard to read.
export const SMALL_SHOWN = 0.6;

// How much faster than its speed a recording plays to catch up with a cue.
export const CATCH_UP = 2;

// Most pages set their body text at PAGE_TEXT pixels. Played at under
// PLAYED_TEXT pixels in the frame it is hard to read on a phone, and check
// warns. A viewport of the area the recording plays in, divided by
// VIEWPORT_SHRINK, plays it at about 29 pixels.
export const PAGE_TEXT = 16;
export const PLAYED_TEXT = 24;
export const VIEWPORT_SHRINK = 1.8;

// The viewport that fits an area of w x h pixels of the frame: the area's
// shape, VIEWPORT_SHRINK times smaller, in even pixels from 320 to 3840.
export function fitViewport(w, h) {
  const k = Math.max(1, 320 / (w / VIEWPORT_SHRINK), 320 / (h / VIEWPORT_SHRINK));
  const even = (v) => Math.min(3840, Math.max(320, 2 * Math.round((v * k) / VIEWPORT_SHRINK / 2)));
  return { width: even(w), height: even(h) };
}

// How tall a page's PAGE_TEXT pixel text plays when a recording shows w x h,
// without a zoom: { px, shown }, or null when it plays at PLAYED_TEXT or more.
export function smallPageText(log, { w, h }) {
  const shown = Math.max(w / log.width, h / log.height);
  const px = PAGE_TEXT * shown;
  return px < PLAYED_TEXT - 1e-6 ? { px, shown } : null;
}

// The stretches of the video, in its seconds, where a step moves the picture:
// typing, a scroll, a zoom, a page that opens, and a click, hover or wait that
// changes the page. [{ step, from, to }], with from === to for a moment. In a
// log from before record noted what changes (`noted` false), every step counts
// at its own time, as it did then.
export function movingSteps(steps, { zoom = true, noted = true } = {}) {
  const out = [];
  for (const st of steps) {
    let span = null;
    if (!noted) span = [st.t, st.t];
    else if (st.do === 'type' || st.do === 'scroll') span = [st.t, st.until ?? st.t];
    else if (st.do === 'zoom') span = zoom ? [st.t, st.t + ZOOM_SECONDS] : null;
    else if (st.do === 'open') span = [st.t, st.t];
    else if (st.do === 'click' || st.do === 'hover' || st.do === 'press') span = st.changed ? [st.t, st.t] : null;
    else if (st.do === 'wait') span = st.changed ? [st.end, st.end] : null;
    if (span) out.push({ step: st.step, from: span[0], to: Math.max(span[0], span[1]) });
  }
  return out;
}

// Whether a recording shown w x h plays at under SMALL_SHOWN of its size with
// no zoom on its played steps: then { shown, before, step }, with a zoom step
// to add before the first step that has an element, or on the whole page when
// none has one. { shown, off: true } when zoom: false keeps its zooms out.
export function smallRecording(log, { w, h, from = 0, zoom = true }) {
  const shown = Math.max(w / log.width, h / log.height);
  const played = log.steps.filter((st) => !st.before && st.t >= from);
  const zooms = played.some((st) => st.do === 'zoom' && st.box);
  if (shown >= SMALL_SHOWN || (zoom && zooms)) return null;
  if (zooms) return { shown, off: true };
  const first = played.find((st) => st.text !== undefined || st.selector !== undefined);
  const step = first
    ? { do: 'zoom', ...(first.text !== undefined ? { text: first.text } : { selector: first.selector }), ...(first.nth ? { nth: first.nth } : {}), ...(first.cue !== undefined ? { cue: first.cue } : {}) }
    : { do: 'zoom', selector: 'body' };
  return { shown, before: first?.step ?? null, step };
}

// The steps that land on a cue, with the scene time of the cue: [{ step,
// start, t, cueAt, cue }]. `cues` sets cues by mark name or step number, over
// the steps' own. Steps that share a cue run in order, and the first one lands
// on it. Steps before `from` are not played.
export function cuedSteps(steps, { cues, from = 0, time }) {
  const cued = [];
  for (const st of steps) {
    const cue = cues?.[st.name] ?? cues?.[st.step] ?? st.cue;
    if (cue === undefined || st.t < from || cued.some((c) => c.cue === cue)) continue;
    cued.push({ step: st.step, start: st.start, t: st.t, cueAt: time(cue), cue });
  }
  return cued;
}

// When the video plays: a list of parts, each from scene time `at` until
// `until`, starting at second `v` of the video and playing at `speed`, 0 for a
// hold. The video starts at `from` when the scene reaches `at`. A step with a
// cue holds the frame before the step until the step's action, like a click,
// lands on its cue. When the video gets to a step too late for that, the part
// before the step plays faster, up to CATCH_UP times, and a step that is late
// even then goes in `late`. The step itself always plays at `speed`, so a
// pointer moves and types at the pace it was recorded at.
// cued: [{ step, start, t, cueAt }], with cueAt the scene time of the cue.
export function recordingClock(cued, { at = 0, from = 0, speed = 1 } = {}) {
  const parts = [];
  const late = [];
  let scene = at;
  let video = from;
  for (const c of [...cued].sort((a, b) => a.start - b.start)) {
    if (c.t < from) continue;
    const hold = Math.max(c.start, from, video);
    const reach = scene + (hold - video) / speed;
    const want = c.cueAt - (c.t - hold) / speed;
    if (want >= reach) {
      if (hold > video) parts.push({ at: scene, until: reach, v: video, speed });
      if (want > reach) parts.push({ at: reach, until: want, v: hold, speed: 0 });
      scene = want;
      video = hold;
      continue;
    }
    if (hold > video) {
      const until = Math.max(want, scene + (hold - video) / (speed * CATCH_UP));
      parts.push({ at: scene, until, v: video, speed: (hold - video) / (until - scene) });
      scene = until;
      video = hold;
    }
    if (scene - want > LATE_SECONDS) late.push({ step: c.step, by: scene - want, cueAt: c.cueAt });
  }
  return { at, from, speed, parts, late, held: parts.reduce((n, p) => n + (p.speed ? 0 : p.until - p.at), 0) };
}

// Where the parts end: the scene time and the second of the video.
function partsEnd(clock) {
  const last = clock.parts.at(-1);
  return last ? { scene: last.until, video: last.v + (last.until - last.at) * last.speed } : { scene: clock.at, video: clock.from };
}

// The second of the video shown at scene time t, or null before it starts.
export function videoTime(clock, t) {
  if (t < clock.at) return null;
  for (const p of clock.parts) if (t < p.until) return p.v + (t - p.at) * p.speed;
  const end = partsEnd(clock);
  return end.video + (t - end.scene) * clock.speed;
}

// The scene time when the video first reaches second v.
export function sceneTime(clock, v) {
  for (const p of clock.parts) {
    if (p.speed && v <= p.v + (p.until - p.at) * p.speed) return p.at + Math.max(0, v - p.v) / p.speed;
  }
  const end = partsEnd(clock);
  return end.scene + (v - end.video) / clock.speed;
}

// Where the pointer is at second v: where it started, or on its way between
// two places the way record moved it there.
export function cursorAt(log, v) {
  let x = log.cursor.x;
  let y = log.cursor.y;
  for (const st of log.steps) {
    const m = st.move;
    if (!m || v < m.t0) {
      if (m) break;
      continue;
    }
    const p = m.t1 > m.t0 ? ease.inOut(clamp((v - m.t0) / (m.t1 - m.t0))) : 1;
    x = lerp(m.x0, m.x1, p);
    y = lerp(m.y0, m.y1, p);
    if (p < 1) return { x, y, moving: true };
  }
  return { x, y, moving: false };
}

// The largest part of a width x height video with the shape `aspect`, in its middle.
export function coverRect(width, height, aspect) {
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

// How many times closer than `base` a zoom on `box` goes.
export function zoomScale(box, base, scale) {
  if (scale !== undefined) return scale;
  return clamp(ZOOM_FIT * Math.min(base.w / Math.max(1, box.w), base.h / Math.max(1, box.h)), ZOOM_RANGE[0], ZOOM_RANGE[1]);
}

// The sides and corners a zoom may hold its element by.
export const ZOOM_ALIGNS = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
// How much room a zoom held by one side leaves between that side and the edge
// of the view, as a part of the view.
const ALIGN_ROOM = 0.04;

// The view a zoom on `box` (center and size in video pixels) moves to: in the
// shape of `base`, zoomScale times closer, around the box and inside the video.
// `align` holds one side of the box in view instead of its middle, like
// 'left' for a wide element whose words start at its left, or a corner, like
// 'top-left' for a tall list whose first rows are at its top.
export function focusRect(box, base, width, height, scale, align = 'center') {
  const aspect = base.w / base.h;
  const w = base.w / zoomScale(box, base, scale);
  const h = w / aspect;
  let x = box.x - w / 2;
  let y = box.y - h / 2;
  const sides = align.split('-');
  if (sides.includes('left')) x = box.x - box.w / 2 - w * ALIGN_ROOM;
  if (sides.includes('right')) x = box.x + box.w / 2 + w * ALIGN_ROOM - w;
  if (sides.includes('top')) y = box.y - box.h / 2 - h * ALIGN_ROOM;
  if (sides.includes('bottom')) y = box.y + box.h / 2 + h * ALIGN_ROOM - h;
  return { x: clamp(x, 0, width - w), y: clamp(y, 0, height - h), w, h };
}

const mix = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });

// The part of the video in view at second v, with the shape `aspect`. A zoom
// step eases toward its box, and one without a box back to the whole video.
export function viewAt(log, v, aspect, { zoom = true } = {}) {
  const base = coverRect(log.width, log.height, aspect);
  const zooms = zoom ? log.steps.filter((st) => st.do === 'zoom') : [];
  let view = base;
  for (let i = 0; i < zooms.length; i++) {
    const z = zooms[i];
    if (v < z.t) break;
    const target = z.box ? focusRect(z.box, base, log.width, log.height, z.scale, z.align) : base;
    // A zoom that starts before this one ends takes over from where it is.
    const until = Math.min(v, zooms[i + 1]?.t ?? Infinity);
    const p = ease.inOut(clamp((until - z.t) / ZOOM_SECONDS));
    view = mix(view, target, p);
    if (p < 1 && until === v) return { ...view, moving: true };
  }
  return { ...view, moving: false };
}

// The arrow of a pointer, 1 unit tall, with its tip at 0,0.
const ARROW = [[0, 0], [0, 0.79], [0.19, 0.62], [0.32, 0.91], [0.45, 0.85], [0.32, 0.57], [0.56, 0.57]];

// Draws the pointer with its tip at x,y, `size` pixels tall: white with a dark
// edge and a soft shadow, so it shows on light and dark pages.
export function drawCursor(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ARROW.forEach(([px, py], i) => (i ? ctx.lineTo(px * size, py * size) : ctx.moveTo(px * size, py * size)));
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetY = size * 0.05;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.strokeStyle = '#15171c';
  ctx.stroke();
  ctx.restore();
}
