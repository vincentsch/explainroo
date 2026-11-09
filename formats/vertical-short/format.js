// Scene helpers of the vertical-short format. scenes.js imports them. They use
// the short-video kit (s.short). Words and the subject stay in s.safe, which
// ends above the bold captions and stays clear of the apps' buttons. The
// pictures below it fill the rest of the tall frame from s.full.

const BACK = '#111a33';

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
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
// stays until the next one comes.
export function beats(s, items, { y = s.safe.y + s.safe.h * 0.55 } = {}) {
  const u = unit(s);
  items.forEach((it, i) => {
    const next = items[i + 1]?.at;
    const exit = next === undefined ? undefined : 'none';
    echo(s, it.icon, { color: it.color, at: it.at, out: next, exit });
    s.icon(it.icon, { x: s.cx, y, size: u * 44, color: it.color ?? 'blue', label: it.label, labelSize: u * 9, labelColor: '#ffffff', at: it.at, out: next, exit, enter: 'pop' });
  });
}

// One fact on a tilted sticker, like "*20%*". It may sit on the subject's corner.
export function fact(s, text, { at, x = s.cx + s.safe.w * 0.24, y = s.safe.y + s.safe.h * 0.42, out } = {}) {
  s.short.sticker(text, { x, y, size: unit(s) * 11, at, out, overlap: true });
}

// A fast zoom onto the middle on a cue, for a turn in the story. Put it in
// s.camera([...]) first in the scene.
export function punch(s, at, { zoom = 1.25 } = {}) {
  return s.short.punch(at, { x: s.cx, y: s.safe.y + s.safe.h * 0.55, zoom, hold: 1 });
}

// The last frame: the one thing to remember, with up to three short lines.
export function payoff(s, title, lines, { at = 0.2, tone = 'good', icon = 'circle-check', color = 'green' } = {}) {
  backdrop(s, { glow: '#12a150', pattern: 'none' });
  if (icon) echo(s, icon, { color, at });
  s.short.payoff({ title, lines, tone, at, y: s.safe.y + s.safe.h * 0.5 });
}
