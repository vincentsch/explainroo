// Time flows down in portrait and across in wide frames.
function layout(s) {
  const { safe } = s;
  const scale = s.portrait ? Math.min(safe.w / 928, safe.h / 1221) : Math.min(s.W / 1920, s.H / 1080);
  const x = (v) => safe.left + (v - 76) * safe.w / 928;
  const y = (v) => safe.top + (v - 76) * safe.h / 1221;
  const r = (s.portrait ? 58 : 96) * scale;
  const count = s.id === 'hook' ? 5 : s.id === 'merge' ? 6 : 7;
  const xs = s.row(count, { width: safe.w - r * 2 });
  const midY = safe.top + safe.h / 2;
  const point = (i, feature = false) => s.portrait
    ? [x(feature ? 760 : 300), y(400 + i * 142)]
    : [xs[i], midY + safe.h * (feature ? 0.2 : -0.2)];
  return { x, y, point, scale, r, titleY: s.portrait ? y(190) : safe.top + safe.h * 0.1 };
}

function link(s, a, b, r, o) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  s.line([[a[0] + dx * r / d, a[1] + dy * r / d], [b[0] - dx * r / d, b[1] - dy * r / d]], o);
}

// Draws main (A to E) and the feature branch (F1, F2 off B).
function history(s, l, { at = -1, main = true, feature = true, featureOut, ghost = false } = {}) {
  const { point, scale, r } = l;
  const t0 = s.time(at);
  const when = (d) => (t0 < 0 ? t0 : t0 + d);
  if (main) {
    ['A', 'B', 'C', 'D', 'E'].forEach((c, i) => {
      const [x, y] = point(i);
      s.circle({ id: c, x, y, r, label: c, size: (s.portrait ? 52 : 64) * scale, color: 'blue', at: when(i * 0.15) });
      if (i) link(s, point(i - 1), point(i), r, { color: 'blue', at: when(i * 0.15 - 0.05), sfx: false });
    });
    const [x, y] = point(0);
    s.note('main', { x, y: y - (s.portrait ? 105 : 150) * scale, size: Math.max(32, (s.portrait ? 44 : 56) * scale), color: 'blue', at: t0 });
  }
  if (!feature) return;
  const f = { at: when(0.8), out: featureOut, dashed: ghost, opacity: ghost ? 0.45 : 1 };
  link(s, point(1), point(2, true), r, { color: 'green', ...f, sfx: false });
  const [x1, y1] = point(2, true);
  const [x2, y2] = point(3, true);
  s.circle({ id: 'F1', x: x1, y: y1, r, label: 'F1', size: Math.max(32, (s.portrait ? 46 : 56) * scale), color: 'green', ...f });
  link(s, point(2, true), point(3, true), r, { color: 'green', ...f, sfx: false });
  s.circle({ id: 'F2', x: x2, y: y2, r, label: 'F2', size: Math.max(32, (s.portrait ? 46 : 56) * scale), color: 'green', ...f, at: f.at + 0.15 });
  s.note('your branch', { x: s.portrait ? x1 : (x1 + x2) / 2, y: y1 + (s.portrait ? -105 : 150) * scale, size: Math.max(32, (s.portrait ? 44 : 56) * scale), color: 'green', ...f });
}

export default {
  hook(s) {
    const l = layout(s);
    s.title('merge or *rebase*?', { y: l.titleY, size: Math.max(64, 88 * l.scale), at: 0, enter: 'none' });
    history(s, l, { at: 'branch' });
    const xs = s.portrait ? [l.x(300), l.x(780)] : s.row(2, { width: s.safe.w * 0.18, x: s.safe.left + s.safe.w * 0.18 });
    const y = s.portrait ? l.y(1150) : l.point(2, true)[1];
    s.icon('git-merge', { x: xs[0], y, size: (s.portrait ? 120 : 160) * l.scale, color: 'purple', at: '#two', label: 'merge', labelSize: Math.max(32, (s.portrait ? 48 : 56) * l.scale) });
    s.icon('git-commit-vertical', { x: xs[1], y, size: (s.portrait ? 120 : 160) * l.scale, color: 'accent', at: '#or', label: 'rebase', labelSize: Math.max(32, (s.portrait ? 48 : 56) * l.scale) });
  },

  merge(s) {
    const l = layout(s);
    s.title('merge', { y: l.titleY, size: Math.max(64, 88 * l.scale), at: -1 });
    history(s, l);
    const [x, y] = l.point(5);
    s.circle({ id: 'M', x, y, r: l.r + 6 * l.scale, label: 'M', size: (s.portrait ? 52 : 64) * l.scale, color: 'purple', at: '#knot', enter: 'pop' });
    link(s, l.point(4), l.point(5), l.r + 6 * l.scale, { color: 'purple', at: s.mark('knot') - 0.2 });
    link(s, l.point(3, true), l.point(5), l.r, { color: 'purple', at: s.mark('knot') - 0.2 });
    s.note('merge commit', { x: s.portrait ? l.x(420) : s.safe.right - 200 * l.scale, y: s.portrait ? y : y - 150 * l.scale, size: Math.max(32, (s.portrait ? 48 : 56) * l.scale), color: 'purple', align: s.portrait ? 'left' : 'center', at: s.mark('knot') + 0.4 });
  },

  rebase(s) {
    const l = layout(s);
    s.title('rebase', { y: l.titleY, size: Math.max(64, 88 * l.scale), at: -1 });
    history(s, l, { featureOut: 'takes' });
    history(s, l, { main: false, ghost: true, at: s.cueEnd('off') - 0.8 });
    const [x1, y1] = l.point(5);
    const [x2, y2] = l.point(6);
    link(s, l.point(4), l.point(5), l.r, { color: 'accent', at: s.mark('replay') + 0.1 });
    s.circle({ id: 'F1b', x: x1, y: y1, r: l.r, label: "F1'", size: Math.max(32, (s.portrait ? 46 : 56) * l.scale), color: 'accent', at: s.mark('replay') + 0.3, enter: 'drop' });
    link(s, l.point(5), l.point(6), l.r, { color: 'accent', at: s.mark('replay') + 0.8 });
    s.circle({ id: 'F2b', x: x2, y: y2, r: l.r, label: "F2'", size: Math.max(32, (s.portrait ? 46 : 56) * l.scale), color: 'accent', at: s.mark('replay') + 1.0, enter: 'drop' });
    const [fx, fy] = l.point(2, true);
    const from = s.portrait ? [fx - 20 * l.scale, fy + 70 * l.scale] : [l.point(3, true)[0] + l.r + 20 * l.scale, fy];
    s.arrow(from, [x1 + (s.portrait ? 90 : 0) * l.scale, y1 + (s.portrait ? -10 : 120) * l.scale], { bend: -0.3, dashed: true, color: 'muted', at: s.mark('replay') + 0.1, width: 3 });
    s.note('a straight line', { x: s.portrait ? l.x(420) : (x1 + x2) / 2, y: s.portrait ? y2 : y2 + 180 * l.scale, size: Math.max(32, (s.portrait ? 48 : 56) * l.scale), color: 'accent', align: s.portrait ? 'left' : 'center', at: '#line' });
  },

  hashes(s) {
    const l = layout(s);
    s.title('new hashes', { y: l.titleY, size: Math.max(64, 88 * l.scale), at: 0 });
    const cells = s.grid(s.portrait ? 1 : 2, s.portrait ? 2 : 1, { y: s.safe.top + s.safe.h * (s.portrait ? 0.48 : 0.5), h: s.safe.h * 0.56, gap: s.portrait ? 80 : 120 });
    const rows = [
      ['F1', 'a3f9c21', "F1'", 'e1d7b09'],
      ['F2', '7be04d8', "F2'", '4c2a8f3'],
    ];
    rows.forEach(([o, oh, n, nh], i) => {
      const x = s.portrait ? l.x(230) : cells[i].x - 180 * l.scale;
      const tx = s.portrait ? l.x(340) : x + 160 * l.scale;
      const y = s.portrait ? l.y(480 + i * 340) : cells[i].y - 160 * l.scale;
      const nextY = s.portrait ? l.y(630 + i * 340) : y + 320 * l.scale;
      s.circle({ id: `o${i}`, x, y, r: l.r, label: o, size: Math.max(32, (s.portrait ? 46 : 56) * l.scale), color: 'green', at: -1, opacity: 0.55, dashed: true });
      s.text(oh, { id: `oh${i}`, font: 'mono', x: tx, y, size: (s.portrait ? 60 : 72) * l.scale, align: 'left', color: 'muted', at: -1 });
      s.annotate(`oh${i}`, { type: 'strike', color: 'red', at: s.mark('new') + i * 0.3 });
      s.circle({ id: `n${i}`, x, y: nextY, r: l.r, label: n, size: Math.max(32, (s.portrait ? 46 : 56) * l.scale), color: 'accent', at: s.cue('new') + i * 0.25 });
      s.text(nh, { font: 'mono', x: tx, y: nextY, size: (s.portrait ? 60 : 72) * l.scale, align: 'left', color: 'accent', at: s.mark('new') + 0.2 + i * 0.3, enter: 'type', dur: 0.5 });
    });
    s.note('same changes, new commits', { y: s.portrait ? l.y(1230) : s.safe.bottom - 100 * l.scale, size: Math.max(32, (s.portrait ? 48 : 56) * l.scale), at: s.cue('commits') });
  },

  rule(s) {
    const l = layout(s);
    s.icon('triangle-alert', { x: s.portrait ? s.cx : s.safe.left + s.safe.w * 0.22, y: s.portrait ? l.y(470) : s.cy, size: 210 * l.scale, color: 'yellow', at: 0.2, bg: 'circle', bgScale: 1.5 });
    const x = s.portrait ? s.cx : s.safe.left + s.safe.w * 0.65;
    s.text("Don't rebase\n*shared* branches", { x, font: 'display', size: 84 * l.scale, y: s.portrait ? l.y(850) : s.cy - 60 * l.scale, at: '#shared', lineHeight: 1.15, mark: 'yellow' });
    s.icon('users', { x, y: s.portrait ? l.y(1150) : s.cy + 190 * l.scale, size: 120 * l.scale, color: 'muted', at: 'people' });
  },

  outro(s) {
    const l = layout(s);
    const xs = s.portrait ? [s.cx, s.cx] : s.row(2, { width: s.safe.w * 0.53 });
    const midY = s.safe.top + s.safe.h / 2;
    const ys = s.portrait ? [l.y(520), l.y(960)] : [midY, midY];
    const w = s.portrait ? l.x(920) - l.x(160) : s.safe.w * 0.46;
    s.box('merge', { x: xs[0], y: ys[0], w, h: (s.portrait ? 250 : 460) * l.scale, icon: 'git-merge', iconSize: s.portrait ? undefined : 200 * l.scale, color: 'purple', size: (s.portrait ? 56 : 80) * l.scale, at: 'merge' });
    s.note('history as it happened', { x: xs[0], y: s.portrait ? l.y(710) : ys[0] + 320 * l.scale, size: Math.max(32, (s.portrait ? 48 : 56) * l.scale), at: 'happened' });
    s.box('rebase', { x: xs[1], y: ys[1], w, h: (s.portrait ? 250 : 460) * l.scale, icon: 'git-commit-vertical', iconSize: s.portrait ? undefined : 200 * l.scale, color: 'accent', size: (s.portrait ? 56 : 80) * l.scale, at: '#clean' });
    s.note('a straight line, easier to read', { x: xs[1], y: s.portrait ? l.y(1150) : ys[1] + 320 * l.scale, size: Math.max(32, (s.portrait ? 48 : 56) * l.scale), at: 'easier' });
  },
};
