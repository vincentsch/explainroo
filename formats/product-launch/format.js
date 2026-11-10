// Scene helpers of the product-launch format. scenes.js imports them. They draw
// with the UI kit (s.ui) and place everything from s.safe, so a scene works in
// 16:9 and, stacked, in a tall frame.

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
}

// The size at which a headline fits the width, never above `size`.
function fitted(s, text, size, width) {
  const w = s.ui.measure(text.replace(/\*/g, ''), size, 400, 'headline');
  return w > width ? size * (width / w) : size;
}

// The background, then the camera, then a headline at the top of the content
// area, so the headline moves with the camera. Returns s.ui.
export function stage(s, headline, { camera, at = 0.15 } = {}) {
  const ui = s.ui;
  ui.backdrop();
  ui.floaters();
  if (camera) s.camera(camera);
  if (headline) ui.headline(headline, s.cx, s.safe.top + unit(s) * 10, { size: fitted(s, headline, unit(s) * 8, s.safe.w * 0.9), at });
  return ui;
}

// The area under the headline that stage leaves free.
export function body(s) {
  const top = s.safe.top + unit(s) * 17;
  return { x: s.safe.x, y: top, w: s.safe.w, h: s.safe.bottom - top, cx: s.cx, cy: (top + s.safe.bottom) / 2 };
}

// The product's name with its promise under it, big in the middle. With at: -1
// it is there on the first frame, which feeds and posting tools show as the cover.
// `icon` puts the product's mark in a tile above the name, and `eyebrow` a small
// label instead.
export function nameCard(s, name, promise, { at = -1, promiseAt = at, icon, eyebrow = s.kitWord('new') } = {}) {
  const ui = s.ui;
  const u = unit(s);
  const size = fitted(s, name, u * 17, s.safe.w * 0.86);
  const y = s.safe.top + s.safe.h * (icon ? 0.56 : 0.47);
  if (icon) {
    const t = u * 22;
    const ty = y - size - t * 0.75;
    ui.pop(at, s.cx, ty, () => {
      ui.card(s.cx - t / 2, ty - t / 2, t, t, { r: t * 0.24, fill: ui.colors.accent, border: false, lift: 1.2 });
      ui.icon(icon, s.cx, ty, t * 0.55, '#ffffff', 2.2);
    }, { sfx: null });
  } else ui.pop(at, s.cx, y - size * 0.9, () => ui.pill(eyebrow, s.cx, y - size * 1.15, 'accent', { align: 'center', size: u * 3 }), { sfx: null });
  ui.headline(name, s.cx, y, { size, at });
  if (promise) ui.headline(promise, s.cx, y + u * 14, { size: fitted(s, promise, u * 6, s.safe.w * 0.86), at: promiseAt, color: ui.colors.muted });
}

// A browser window in the free area. fn(x, y, w, h) draws the page inside it.
// Returns the window's box.
export function appWindow(s, { url, at = 0.3, width = 0.62, height = 0.86 } = {}, fn) {
  const b = body(s);
  const w = Math.min(b.w * width, b.h * height * 1.75);
  const h = b.h * height;
  const x = b.cx - w / 2;
  const y = b.y + (b.h - h) / 2;
  s.ui.browser(x, y, w, h, { url, at }, fn);
  return { x, y, w, h };
}

// Cards that show one by one, side by side in a wide frame and stacked in a
// tall one. Each item is { icon, title, text, at }.
export function featureCards(s, items) {
  const ui = s.ui;
  const u = unit(s);
  const b = body(s);
  const gap = u * 4;
  const n = items.length;
  const w = s.portrait ? b.w * 0.9 : (b.w * 0.94 - gap * (n - 1)) / n;
  const h = s.portrait ? Math.min(u * 42, (b.h * 0.9 - gap * (n - 1)) / n) : Math.min(u * 46, b.h * 0.7);
  items.forEach((it, i) => {
    const x = s.portrait ? b.cx - w / 2 : b.cx - (w * n + gap * (n - 1)) / 2 + i * (w + gap);
    const y = s.portrait ? b.cy - (h * n + gap * (n - 1)) / 2 + i * (h + gap) : b.cy - h / 2;
    ui.panel(x, y, w, h, { at: it.at, sfx: 'pop' }, () => {
      const pad = u * 4;
      ui.card(x + pad, y + pad, u * 11, u * 11, { r: u * 3, fill: ui.colors.accentTint, border: false, shadow: false });
      ui.icon(it.icon, x + pad + u * 5.5, y + pad + u * 5.5, u * 6, ui.colors.accent, 2.2);
      ui.text(it.title, x + pad, y + pad + u * 19, { size: u * 4.6, weight: 700, color: ui.colors.ink });
      if (it.text) ui.para(it.text, x + pad, y + pad + u * 24, w - pad * 2, { size: u * 3.3, color: ui.colors.muted });
    });
  });
}

// The closing frame: the name, a button with the action and the address.
export function callToAction(s, { name, action = s.kitWord('try-free'), url, at = 0.2, urlAt = at } = {}) {
  const ui = s.ui;
  const u = unit(s);
  const y = s.safe.top + s.safe.h * 0.4;
  ui.headline(name, s.cx, y, { size: fitted(s, name, u * 15, s.safe.w * 0.86), at });
  const bw = Math.max(u * 34, ui.measure(action, u * 4.4, 600) + u * 12);
  ui.pop(urlAt, s.cx, y + u * 17, () => ui.button(action, s.cx - bw / 2, y + u * 11, bw, u * 12, { size: u * 4.4, r: u * 2.4, press: ui.press(s.time(urlAt) + 0.6) }), { sfx: 'pop' });
  if (url) ui.pop(urlAt, s.cx, y + u * 30, () => ui.text(url, s.cx, y + u * 30, { size: u * 5, weight: 600, color: ui.colors.accent, align: 'center' }), { sfx: null });
}
