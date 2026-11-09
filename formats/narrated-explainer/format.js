// Scene helpers of the narrated-explainer format. scenes.js imports them. They
// place everything from s.safe, so a scene works in 16:9 and in a tall frame.

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
}

// The accent color: brand.accent from video.json when it is set, and the
// look's accent otherwise.
export function accent(s) {
  return s.ui.colors.accent;
}

// A heading at the top of the content area. Returns its box.
export function heading(s, text, { at = 0, out } = {}) {
  const u = unit(s);
  return s.text(text, { x: s.cx, y: s.safe.top + u * 8, size: u * 8, font: 'display', maxWidth: s.safe.w * 0.9, at, out });
}

// The free area under a heading.
export function body(s) {
  const top = s.safe.top + unit(s) * 18;
  return { x: s.safe.x, y: top, w: s.safe.w, h: s.safe.bottom - top, cx: s.cx, cy: (top + s.safe.bottom) / 2 };
}

// The question of the video, big, with an icon under it. With at: -1 it is
// there on the first frame, which feeds and posting tools show as the cover.
export function question(s, text, { icon, at = -1, iconAt = at, color = accent(s) } = {}) {
  const u = unit(s);
  const t = s.title(text, { y: s.safe.top + s.safe.h * (icon ? 0.3 : 0.45), size: u * 12, maxWidth: s.safe.w * 0.9, at });
  if (icon) s.icon(icon, { y: t.bottom + s.safe.h * 0.22, size: u * 26, color, at: iconAt });
}

// Boxes in order with arrows between them, left to right in a wide frame and
// top to bottom in a tall one. Each item is { label, icon, color, at }.
export function steps(s, items, { area = body(s) } = {}) {
  const u = unit(s);
  const xs = s.portrait ? items.map(() => area.cx) : s.row(items.length, { width: area.w * 0.8 });
  const ys = s.portrait ? items.map((_, i) => area.y + (area.h * (i + 0.5)) / items.length) : items.map(() => area.cy);
  items.forEach((it, i) => {
    s.box(it.label, { id: `step${i}`, x: xs[i], y: ys[i], size: u * 6, icon: it.icon, color: it.color, maxWidth: s.portrait ? area.w * 0.8 : (area.w * 0.8) / items.length - u * 8, at: it.at });
    if (i) s.arrow(`step${i - 1}`, `step${i}`, { at: it.at });
  });
}

// One big number that counts up, with a caption under it.
export function bigNumber(s, value, { prefix = '', suffix = '', caption, at = 0, captionAt = at, decimals = 0 } = {}) {
  const u = unit(s);
  const { w } = s.safe;
  const size = Math.min(u * 26, w / Math.max(3, String(value).length + suffix.length + prefix.length) * 1.6);
  const n = s.number(value, { y: s.cy - u * 6, size, prefix, suffix, decimals, color: accent(s), font: 'display', at });
  if (caption) s.text(caption, { y: n.bottom + u * 8, size: u * 7, color: 'muted', maxWidth: w * 0.85, at: captionAt });
}

// A short list of what to remember, with check marks. Each item is { text, at }.
export function takeaways(s, title, items, { at = 0 } = {}) {
  const u = unit(s);
  heading(s, title, { at });
  const b = body(s);
  const width = Math.min(b.w * 0.8, u * 150);
  s.list(items, { x: b.cx - width / 2, y: b.y + u * 6, width, size: u * 6.5, gap: u * 5, bullet: 'check', bulletColor: 'green' });
}
