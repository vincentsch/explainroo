// Playback of a recording that `explainroo record` made: when each part of the
// video shows, where the cursor is and what the view zooms in on, all from its
// step log. Every function here is pure, so a frame stays a function of time.
// Times in the log are seconds into the video, and places are pixels of it.
import { clamp, lerp, ease } from './util.js';

// How long a zoom takes, in seconds of the video. record waits as long, so the
// next step starts once the view has arrived.
export const ZOOM_SECONDS = 0.8;
// How far a zoom goes at most, against the whole recording.
export const MAX_ZOOM = 2;
// How long a click ring grows and fades, in seconds of the scene.
export const RING_SECONDS = 0.6;
// A step that lands later than this after its cue gets a warning from check.
export const LATE_SECONDS = 0.15;

// When the video plays. The video starts at `from` when the scene reaches
// `at`, and plays at `speed`. A step with a cue holds the frame before the step
// until the step's action, like a click, lands on its cue. A step that the
// video reaches too late for that keeps playing, and goes in `late`.
// cued: [{ step, start, t, cueAt }], with cueAt the scene time of the cue.
export function recordingClock(cued, { at = 0, from = 0, speed = 1 } = {}) {
  const holds = [];
  const late = [];
  let scene = at;
  let video = from;
  for (const c of [...cued].sort((a, b) => a.start - b.start)) {
    if (c.t < from) continue;
    const hold = Math.max(c.start, from, video);
    const reach = scene + (hold - video) / speed;
    const want = c.cueAt - (c.t - hold) / speed;
    if (want > reach) {
      holds.push({ at: reach, until: want, v: hold });
      scene = want;
      video = hold;
    } else if (reach - want > LATE_SECONDS) late.push({ step: c.step, by: reach - want, cueAt: c.cueAt });
  }
  return { at, from, speed, holds, late };
}

// The second of the video shown at scene time t, or null before it starts.
export function videoTime(clock, t) {
  if (t < clock.at) return null;
  let scene = clock.at;
  let video = clock.from;
  for (const h of clock.holds) {
    if (t < h.at) break;
    if (t < h.until) return h.v;
    scene = h.until;
    video = h.v;
  }
  return video + (t - scene) * clock.speed;
}

// The scene time when the video first reaches second v.
export function sceneTime(clock, v) {
  let scene = clock.at;
  let video = clock.from;
  for (const h of clock.holds) {
    if (v <= h.v) break;
    scene = h.until;
    video = h.v;
  }
  return scene + (v - video) / clock.speed;
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

// The view a zoom on `box` (center and size in video pixels) moves to: the box
// with some room around it, in the shape of the view, inside the video, and at
// most MAX_ZOOM times closer than `base`.
export function focusRect(box, base, width, height) {
  const aspect = base.w / base.h;
  const w = clamp(Math.max(box.w * 1.25, box.w + 96, box.h * 1.25 * aspect, (box.h + 96) * aspect, base.w / MAX_ZOOM), 1, base.w);
  const h = w / aspect;
  return { x: clamp(box.x - w / 2, 0, width - w), y: clamp(box.y - h / 2, 0, height - h), w, h };
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
    const target = z.box ? focusRect(z.box, base, log.width, log.height) : base;
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
