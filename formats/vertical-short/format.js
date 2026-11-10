// Scene helpers of the vertical-short format. scenes.js imports them. They use
// the short-video kit (s.short). Words and the subject stay in s.safe, which
// ends above the bold captions and stays clear of the apps' buttons. The
// pictures below it fill the rest of the tall frame from s.full.

// The zoom of each scene's punch(), so the words stay in s.safe at that zoom.
const ZOOMS = new WeakMap();

// The pictures and titles of each scene that a fact() sticker keeps clear of,
// as { x0, y0, x1, y1, from, until } with the seconds they show.
const TAKEN = new WeakMap();
function take(s, box, from = -Infinity, until = Infinity) {
  if (!TAKEN.has(s)) TAKEN.set(s, []);
  TAKEN.get(s).push({ ...box, from, until });
}

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

// The colors of the video: brand.background and brand.accent from video.json
// when they are set, and the look's background and accent otherwise.
export function colors(s) {
  return { back: s.ui.colors.background, accent: s.ui.colors.accent };
}

// The background of every scene: one color for the whole video, with a glow
// behind the subject in the accent color. Call it first, right after s.camera.
export function backdrop(s, { glow = colors(s).accent, pattern = 'dots' } = {}) {
  s.short.backdrop({ color: colors(s).back, glow, gy: s.safe.y + s.safe.h * 0.6, pattern });
}

// A large, faint copy of the subject in the lower part of the frame, below the
// captions. The apps put their buttons and post text there, so it carries
// nothing the viewer must see: it fills the tall frame and changes with the
// subject.
export function echo(s, icon, { color = colors(s).accent, at, out, exit } = {}) {
  const size = s.full.w * 0.66;
  s.icon(icon, { x: s.full.x + s.full.w / 2, y: s.full.bottom - size * 0.56, size, color, opacity: 0.16, at, out, exit, sfx: false, camera: false });
}

// The first frame: the hook title and the subject, both there at 0 seconds, so
// the frame says what the video is about. Feeds and apps show it as the cover.
// The title and its kicker stay in s.safe at the zoom of the scene's punch().
export function hookFrame(s, title, { icon, color = colors(s).accent, kicker } = {}) {
  backdrop(s);
  const area = wordArea(s);
  const box = s.short.hook(title, { y: s.safe.y + s.safe.h * 0.2, kicker, area, at: 0 });
  take(s, { x0: box.left, y0: box.top, x1: box.right, y1: box.bottom });
  if (icon) {
    // The subject fills the lower part of the room below the title, and
    // leaves a band under the title for a fact() sticker.
    const room = area.bottom - box.bottom;
    const size = Math.min(unit(s) * 48, room * 0.52);
    const y = area.bottom - room * 0.04 - size / 2;
    echo(s, icon, { color, at: -1 });
    s.icon(icon, { x: s.cx, y, size, color, at: -1 });
    take(s, { x0: s.cx - size / 2, y0: y - size / 2, x1: s.cx + size / 2, y1: y + size / 2 });
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
    s.icon(it.icon, { x: s.cx, y: at, size, color: it.color ?? colors(s).accent, label: it.label, labelSize: label, labelColor: '#ffffff', at: it.at, out: next, exit, enter: 'pop' });
    // The icon with its label under it.
    take(s, { x0: s.cx - size / 2, y0: at - size / 2, x1: s.cx + size / 2, y1: at + size / 2 + label * 2 }, s.time(it.at), next === undefined ? Infinity : s.time(next));
  });
}

// One fact on a tilted sticker, like "*20%*". It keeps clear of the hook title
// and of the pictures that hookFrame() and beats() drew before it while both
// show, so call it after them. It goes to the free place nearest to x and y,
// and gets smaller where it needs to, so it stays in s.safe at the zoom of the
// scene's punch(). Where no place is free, it stays at x and y, and check
// says what it covers.
export function fact(s, text, { at, x = s.cx + s.safe.w * 0.24, y = s.safe.y + s.safe.h * 0.42, out } = {}) {
  const area = wordArea(s);
  const u = unit(s);
  const fitted = fitLine(s, String(text).replace(/\*/g, ''), u * 11, 900, area.w * 0.96 - u * 11);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const from = s.time(at ?? 0);
  const until = out === undefined ? Infinity : s.time(out);
  const taken = (TAKEN.get(s) ?? []).filter((b) => b.from < until && b.until > from);
  // The step label at the top, when the scene shows one.
  if (s.short.stepBox) taken.push(s.short.stepBox);
  const gap = u * 2;
  // The free place nearest to x and y for the sticker at `k` times its size,
  // or null. With `anyway`, x and y when nothing is free.
  const near = (k, anyway = false) => {
    const size = fitted.size * k;
    const w = fitted.w * k;
    const half = { w: (w + size * 0.9) / 2, h: size * 0.75 + w * 0.04 };
    const free = (px, py) => taken.every((b) => px + half.w + gap <= b.x0 || px - half.w - gap >= b.x1 || py + half.h + gap <= b.y0 || py - half.h - gap >= b.y1);
    const place = (px, py) => ({ x: clamp(px, area.left + half.w, area.right - half.w), y: clamp(py, area.top + half.h, area.bottom - half.h), size });
    const first = place(x, y);
    if (anyway || free(first.x, first.y)) return first;
    let best = null;
    let far = Infinity;
    for (let py = area.top + half.h; py <= area.bottom - half.h; py += u * 2) {
      for (const px of [x, s.cx, area.left + half.w, area.right - half.w]) {
        const p = place(px, py);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < far && free(p.x, p.y)) {
          far = d;
          best = p;
        }
      }
    }
    return best;
  };
  // Smaller where it needs that to fit, and where nothing is free, at x and y.
  const spot = near(1) ?? near(0.85) ?? near(0.7) ?? near(0.6) ?? near(1, true);
  s.short.sticker(text, { x: spot.x, y: spot.y, size: spot.size, at, out, area, overlap: true });
}

// A fast zoom onto the middle on a cue, for a turn in the story, held for a
// second and back. Put it in s.camera([...]) first in the scene: then fact()
// and beats() keep their words in s.safe at this zoom. The point it zooms onto
// stays where it is. Several punches go in one s.camera, like
// s.camera([...punch(s, 'a'), ...punch(s, 'b')]), at least 1.5 seconds apart,
// and the words keep to the largest zoom.
export function punch(s, at, { zoom = 1.25 } = {}) {
  ZOOMS.set(s, Math.max(ZOOMS.get(s) ?? 1, zoom));
  const p = pivot(s);
  return s.short.punch(at, { x: p.x - (p.x - s.cx) / zoom, y: p.y - (p.y - s.cy) / zoom, zoom, hold: 1 });
}

// The last frame: the one thing to remember, with up to three short lines.
export function payoff(s, title, lines, { at = 0.2, tone = 'good', icon = 'circle-check', color = colors(s).accent } = {}) {
  backdrop(s, { pattern: 'none' });
  if (icon) echo(s, icon, { color, at });
  s.short.payoff({ title, lines, tone, at, y: s.safe.y + s.safe.h * 0.5 });
}
