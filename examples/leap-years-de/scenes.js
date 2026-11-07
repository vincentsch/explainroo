// Labels use s.text; custom canvas work is limited to geometry.
const INK = 'ink';
function text(s, str, x, y, size, o = {}) {
  return s.text(str, { x, y, size, color: INK, sfx: false, ...o });
}
function frame(s, title, at = 0) {
  text(s, 'KALENDER UND JAHRESZEITEN', 170, 116, 30, { align: 'left', color: 'muted', at: -1, enter: 'none' });
  text(s, title, 170, 206, 92, { align: 'left', font: 'display', at, enter: 'rise' });
  s.line([[170, 282], [1750, 282]], { color: 'ink', width: 1, at: -1, enter: 'none', opacity: 0.3, sfx: false });
}
function orbit(s, x, y, r, at, o = {}) {
  s.draw({ at, sfx: false, enter: 'fade', ...o }, (c, life) => {
    c.strokeStyle = s.color('ink'); c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = s.color('surface');
    c.beginPath(); c.arc(x, y, 38, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      c.beginPath(); c.moveTo(x + Math.cos(a) * 51, y + Math.sin(a) * 51);
      c.lineTo(x + Math.cos(a) * 64, y + Math.sin(a) * 64); c.stroke();
    }
    const a = -Math.PI / 2 + Math.min(1, life.local / Math.max(1, s.dur - s.time(at))) * Math.PI * 2;
    const ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r;
    c.fillStyle = s.color('ink'); c.beginPath(); c.arc(ex, ey, 19, 0, Math.PI * 2); c.fill();
    c.strokeStyle = s.color('surface'); c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(ex, ey, 7, 15, 0.3, 0, Math.PI * 2); c.stroke();
  });
}
function dateCard(s, x, y, w, h, at, o = {}) {
  s.draw({ at, sfx: false, enter: 'fade', ...o }, (c) => {
    c.fillStyle = s.color('surface'); c.strokeStyle = s.color('ink'); c.lineWidth = 2;
    c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 8); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - w / 2, y - h / 2 + 100); c.lineTo(x + w / 2, y - h / 2 + 100); c.stroke();
    for (const dx of [-w * 0.25, w * 0.25]) {
      c.beginPath(); c.moveTo(x + dx, y - h / 2 - 20); c.lineTo(x + dx, y - h / 2 + 20); c.stroke();
    }
  });
}
function fractions(s, at, x, y, gap = 180, size = 130, out, combineAt) {
  s.draw({ at, out, sfx: false, enter: 'fade' }, (c, life) => {
    const alpha = c.globalAlpha;
    const q = combineAt ? s.p(combineAt, 0.85) : 0;
    const targetX = x + gap * 1.5;
    for (let i = 0; i < 4; i++) {
      const p = s.clamp((life.local - i * 0.65) / 0.6, 0, 1);
      c.strokeStyle = s.color('ink'); c.lineWidth = 1.5;
      c.globalAlpha = alpha * (1 - q);
      c.strokeRect(x + i * gap, y, size, size);
      c.globalAlpha = alpha;
      c.fillStyle = s.color('accent');
      const h = (size - 10) * 0.2422 * p;
      c.fillRect(s.lerp(x + i * gap + 5, targetX + 5, q), s.lerp(y + size - 5 - h, y + size - 5 - h * (i + 1), q), size - 10, h);
    }
    c.globalAlpha = alpha * q;
    c.strokeStyle = s.color('ink'); c.lineWidth = 1.5;
    c.strokeRect(targetX, y, size, size);
  });
}
export default {
  hook(s) {
    text(s, 'DER KALENDER', 180, 170, 34, { align: 'left', color: 'muted', at: 0, enter: 'none' });
    text(s, 'Warum es\nSchaltjahre gibt', 180, 390, 104, { align: 'left', font: 'display', at: 0, enter: 'none', lineHeight: 1.12 });
    s.line([[180, 572], [800, 572]], { color: 'ink', width: 1, at: '#question', sfx: false });
    text(s, 'Damit der Kalender\nzur Erde passt', 180, 680, 42, { align: 'left', at: '#calendar', enter: 'fade', lineHeight: 1.2 });
    dateCard(s, 1360, 450, 400, 440, 0, { enter: 'none' });
    text(s, 'Februar', 1360, 280, 44, { at: 0, enter: 'none' });
    text(s, '29', 1360, 470, 180, { font: 'display', color: 'accent', at: 0, enter: 'none' });
    s.line([[1270, 590], [1450, 590]], { color: 'accent', width: 3, at: '#calendar', sfx: false });
    text(s, 'Ein Tag mehr', 1360, 760, 44, { at: 'mehr', enter: 'fade' });
  },
  orbit(s) {
    frame(s, 'Ein Jahr hat einen Rest', '#orbit');
    orbit(s, 500, 545, 190, '#orbit');
    text(s, 'Die Erde um die Sonne', 500, 785, 38, { at: '#orbit', color: 'muted' });
    text(s, '365,2422', 1260, 440, 124, { font: 'display', at: '#orbit' });
    text(s, 'Tage', 1260, 545, 46, { at: s.cueEnd('365,2422') });
    s.line([[1040, 610], [1480, 610]], { color: 'accent', width: 4, at: '#gap', sfx: false });
    text(s, 'Ein Kalenderjahr: 365 Tage', 1260, 680, 44, { at: '#gap' });
    text(s, 'Fast ein Vierteltag fehlt', 1260, 760, 44, { at: 'Vierteltag', color: 'accent' });
  },
  leap(s) {
    frame(s, 'Ein Tag mehr im Februar', '#four');
    fractions(s, '#four', 225, 420, 180, 130, undefined, '#date');
    text(s, 'Alle vier Jahre', 565, 650, 54, { font: 'display', at: '#four' });
    s.arrow([960, 490], [1140, 490], { at: '#date', width: 2, color: 'ink', sfx: false });
    dateCard(s, 1440, 535, 360, 420, '#date');
    text(s, 'Februar', 1440, 375, 42, { at: '#date' });
    text(s, '29', 1440, 555, 160, { font: 'display', color: 'accent', at: '#date' });
    text(s, 'Bruchteile vergrößert', 170, 785, 30, { align: 'left', color: 'muted', at: '#four' });
    s.sfx('chime', '#date', { gain: 0.18 });
  },
  rule(s) {
    frame(s, 'Die Ausnahme', '#gregorian');
    text(s, 'Gregorianischer\nKalender', 170, 440, 64, { font: 'display', align: 'left', at: '#gregorian', lineHeight: 1.1 });
    text(s, 'Seit 1582', 170, 590, 42, { align: 'left', color: 'muted', at: '#gregorian' });
    text(s, 'Jahre auf 00', 1200, 400, 56, { font: 'display', at: '#skip' });
    text(s, 'Kein Schalttag', 1200, 482, 42, { at: '#skip' });
    s.line([[880, 560], [1520, 560]], { color: 'ink', width: 1, at: '#keep', opacity: 0.4, sfx: false });
    text(s, 'Außer durch 400 teilbar', 1200, 650, 56, { font: 'display', color: 'accent', at: '#keep' });
    text(s, 'Dann doch ein Schalttag', 1200, 735, 42, { at: '#keep' });
  },
  examples(s) {
    frame(s, 'Die Regel in der Praxis', '#no');
    text(s, '1900', 520, 450, 140, { font: 'display', at: '#no' });
    text(s, 'Kein Schalttag', 520, 600, 46, { at: '#no' });
    s.draw({ at: '#no', enter: 'fade', sfx: false }, (c) => {
      c.strokeStyle = s.color('ink'); c.lineWidth = 2;
      c.beginPath(); c.moveTo(493, 683); c.lineTo(547, 737); c.moveTo(547, 683); c.lineTo(493, 737); c.stroke();
    });
    s.line([[960, 350], [960, 780]], { width: 1, opacity: 0.25, at: '#yes', sfx: false });
    text(s, '2000', 1380, 450, 140, { font: 'display', color: 'accent', at: '#yes' });
    text(s, '29. Februar', 1380, 600, 46, { at: 'Februar' });
    s.draw({ at: 'Februar', enter: 'fade', sfx: false }, (c) => {
      c.strokeStyle = s.color('accent'); c.lineWidth = 3;
      c.beginPath(); c.moveTo(1350, 710); c.lineTo(1372, 732); c.lineTo(1412, 686); c.stroke();
    });
    s.sfx('chime', 'Februar', { gain: 0.16 });
  },
};
