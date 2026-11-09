// Scene helpers of the vertical-short format. scenes.js imports them. They use
// the short-video kit (s.short). Words and the subject stay in s.safe, which
// ends above the bold captions and stays clear of the apps' buttons. The
// pictures below it fill the rest of the tall frame from s.full.

const BACK = '#111a33';
// The zoom of each scene's punch(), so the words stay in s.safe at that zoom.
const ZOOMS = new WeakMap();

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
}

// The point punch() zooms onto, in the middle of the subject. It stays where it is.
function pivot(s) {
  return { x: s.cx, y: s.safe.y + s.safe.h * 0.55 };
}

// The part of s.safe whose words stay in s.safe at the zoom of the scene's
// punch(). Without a punch, it is s.safe.
export function wordArea(s) {
  const z = ZOOMS.get(s) ?? 1;
  const p = pivot(s);
  const left = p.x + (s.safe.x - p.x) / z;
  const top = p.y + (s.safe.y - p.y) / z;
  const right = p.x + (s.safe.x + s.safe.w - p.x) / z;
  const bottom = p.y + (s.safe.y + s.safe.h - p.y) / z;
  return { left, top, right, bottom, w: right - left, h: bottom - top };
}

// A line of `text` in `font` at `size`: the size that fits `width`, and its width.
function fitLine(s, text, size, weight, width) {
  // A little room for other fonts than the kit's and for the tilt of a sticker.
  const w = s.short.measure(text, size, weight) * 1.08;
  const fit = Math.min(size, (size * width) / Math.max(1, w));
  return { size: fit, w: (w * fit) / size };
}

// The background of every scene: one color for the whole video, with a glow
// behind the subject. Call it first, right after s.camera.
export function backdrop(s, { glow = '#4dabf7', pattern = 'dots' } = {}) {
  s.short.backdrop({ color: BACK, glow, gy: s.safe.y + s.safe.h * 0.6, pattern });
}

// A large, faint copy of the subject in the lower part of the frame, below the
// captions. The apps put their buttons and post text there, so it carries
// nothing the viewer must see: it fills the tall frame and changes with the
// subject.
export function echo(s, icon, { color = 'blue', at, out, exit } = {}) {
  const size = s.full.w * 0.66;
  s.icon(icon, { x: s.full.x + s.full.w / 2, y: s.full.bottom - size * 0.56, size, color, opacity: 0.16, at, out, exit, sfx: false, camera: false });
}

// The first frame: the hook title and the subject, both there at 0 seconds, so
// the frame says what the video is about. Feeds and apps show it as the cover.
export function hookFrame(s, title, { icon, color = 'yellow', kicker } = {}) {
  backdrop(s, { glow: '#f59f00' });
  s.short.hook(title, { y: s.safe.y + s.safe.h * 0.2, kicker, at: 0 });
  if (icon) {
    echo(s, icon, { color, at: -1 });
    s.icon(icon, { x: s.cx, y: s.safe.y + s.safe.h * 0.62, size: unit(s) * 48, color, at: -1 });
  }
}

// Pictures that take turns in the middle of the content area, one per cue, so
// the frame changes on every beat. Each item is { at, icon, label, color } and
// stays until the next one comes. A long label gets smaller, so it stays in
// s.safe at the zoom of the scene's punch().
export function beats(s, items, { y = s.safe.y + s.safe.h * 0.55 } = {}) {
  const u = unit(s);
  const area = wordArea(s);
  const size = u * 44;
  items.forEach((it, i) => {
    const next = items[i + 1]?.at;
    const exit = next === undefined ? undefined : 'none';
    const label = it.label ? fitLine(s, it.label, u * 9, 600, area.w * 0.96).size : u * 9;
    const at = Math.min(y, area.bottom - size / 2 - label * 1.5);
    echo(s, it.icon, { color: it.color, at: it.at, out: next, exit });
    s.icon(it.icon, { x: s.cx, y: at, size, color: it.color ?? 'blue', label: it.label, labelSize: label, labelColor: '#ffffff', at: it.at, out: next, exit, enter: 'pop' });
  });
}

// One fact on a tilted sticker, like "*20%*". It may sit on the subject's corner.
// It moves in and gets smaller where it needs to, so it stays in s.safe at the
// zoom of the scene's punch().
export function fact(s, text, { at, x = s.cx + s.safe.w * 0.24, y = s.safe.y + s.safe.h * 0.42, out } = {}) {
  const area = wordArea(s);
  const { size, w } = fitLine(s, String(text).replace(/\*/g, ''), unit(s) * 11, 900, area.w * 0.96 - unit(s) * 11);
  const half = { w: (w + size * 0.9) / 2, h: size * 0.75 + w * 0.04 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  s.short.sticker(text, { x: clamp(x, area.left + half.w, area.right - half.w), y: clamp(y, area.top + half.h, area.bottom - half.h), size, at, out, overlap: true });
}

// A fast zoom onto the middle on a cue, for a turn in the story. Put it in
// s.camera([...]) first in the scene: then fact() and beats() keep their words
// in s.safe at this zoom. The point it zooms onto stays where it is.
export function punch(s, at, { zoom = 1.25 } = {}) {
  ZOOMS.set(s, Math.max(1, zoom));
  const p = pivot(s);
  return s.short.punch(at, { x: p.x - (p.x - s.cx) / zoom, y: p.y - (p.y - s.cy) / zoom, zoom, hold: 1 });
}

// The last frame: the one thing to remember, with up to three short lines.
export function payoff(s, title, lines, { at = 0.2, tone = 'good', icon = 'circle-check', color = 'green' } = {}) {
  backdrop(s, { glow: '#12a150', pattern: 'none' });
  if (icon) echo(s, icon, { color, at });
  s.short.payoff({ title, lines, tone, at, y: s.safe.y + s.safe.h * 0.5 });
}
