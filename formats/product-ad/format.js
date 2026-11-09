// Scene helpers of the product-ad format. scenes.js imports them. They draw with
// the UI kit (s.ui) and place everything from s.safe, so the ad works square,
// in 4:5 and in a tall frame.

// A hundredth of the short side of the content area, for sizes.
export function unit(s) {
  return Math.min(s.safe.w, s.safe.h) / 100;
}

function fitted(s, text, size, width) {
  const w = s.ui.measure(text.replace(/\*/g, ''), size, 400, 'headline');
  return w > width ? size * (width / w) : size;
}

// The background of a scene. Returns s.ui.
export function stage(s, { camera } = {}) {
  const ui = s.ui;
  ui.backdrop();
  if (camera) s.camera(camera);
  return ui;
}

// The question that stops the scroll, with a picture of the problem. Both are
// there on the first frame, which feeds show before anyone presses play.
export function hookQuestion(s, text, { icon, color = 'red', iconAt = -1 } = {}) {
  const ui = stage(s, { camera: [{ at: 0, zoom: 1.05, dur: s.dur, ease: 'linear' }] });
  const u = unit(s);
  const lines = String(text).split('\n');
  const size = Math.min(...lines.map((l) => fitted(s, l, u * 11, s.safe.w * 0.9)));
  lines.forEach((line, i) => ui.headline(line, s.cx, s.safe.top + u * 18 + i * size * 1.1, { size, at: -1 }));
  if (icon) s.icon(icon, { x: s.cx, y: s.safe.top + s.safe.h * 0.66, size: u * 34, color, bg: 'circle', at: iconAt, sfx: false });
}

// The product: its mark in a tile and its name, with one line on what it does.
export function productShot(s, { name, icon, line, at = 0.1, lineAt = at } = {}) {
  const ui = stage(s);
  const u = unit(s);
  const t = u * 30;
  const ty = s.safe.top + s.safe.h * 0.32;
  ui.pop(at, s.cx, ty, () => {
    ui.card(s.cx - t / 2, ty - t / 2, t, t, { r: t * 0.24, fill: ui.colors.accent, border: false, lift: 1.2 });
    ui.icon(icon, s.cx, ty, t * 0.55, '#ffffff', 2.2);
  }, { sfx: 'pop' });
  ui.headline(name, s.cx, ty + t / 2 + u * 16, { size: fitted(s, name, u * 12, s.safe.w * 0.9), at });
  if (line) ui.headline(line, s.cx, ty + t / 2 + u * 29, { size: fitted(s, line, u * 7, s.safe.w * 0.9), at: lineAt, color: ui.colors.muted });
}

// Up to three benefits, each a row with a check mark that comes on its cue.
// Each item is { text, at }.
export function benefits(s, items) {
  const ui = stage(s);
  const u = unit(s);
  const rowH = u * 20;
  const gap = u * 5;
  const w = s.safe.w * 0.86;
  const top = s.cy - (items.length * rowH + (items.length - 1) * gap) / 2;
  items.forEach((it, i) => {
    const y = top + i * (rowH + gap);
    const x = s.cx - w / 2;
    ui.panel(x, y, w, rowH, { at: it.at, sfx: 'pop', r: u * 4 }, () => {
      ui.checkbox(x + u * 9, y + rowH / 2, s.p(s.time(it.at) + 0.2, 0.3), { size: u * 7 });
      ui.text(it.text, x + u * 17, y + rowH / 2, { size: u * 6.5, weight: 700, color: ui.colors.ink, maxW: w - u * 20 });
    });
  });
}

// The offer on the brand color: the name, a button with the action and the address.
export function offer(s, { name, action = 'Try it for free', url, at = 0 } = {}) {
  const ui = stage(s);
  const u = unit(s);
  ui.wipe(at);
  const after = s.time(at) + 0.5;
  const y = s.safe.top + s.safe.h * 0.36;
  ui.headline(name, s.cx, y, { size: fitted(s, name, u * 13, s.safe.w * 0.9), at: after, color: '#ffffff' });
  const bw = Math.max(u * 50, ui.measure(action, u * 6, 600) + u * 16);
  const bh = u * 15;
  ui.pop(after + 0.3, s.cx, y + u * 20, () => ui.button(action, s.cx - bw / 2, y + u * 12, bw, bh, { size: u * 6, r: u * 4, variant: 'secondary', press: ui.press(after + 1.2) }), { sfx: 'pop' });
  if (url) ui.pop(after + 0.5, s.cx, y + u * 40, () => ui.text(url, s.cx, y + u * 40, { size: u * 7, weight: 700, color: '#ffffff', align: 'center' }), { sfx: null });
}
