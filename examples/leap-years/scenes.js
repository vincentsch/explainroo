// All labels use s.text; custom canvas work is limited to geometry.
const INK = 'ink';
function text(s, str, x, y, size, o = {}) {
  return s.text(str, { x, y, size, color: INK, sfx: false, ...o });
}
function frame(s, title, at = 0) {
  text(s, 'CALENDARS & THE SEASONS', 170, 120, 32, { align: 'left', color: 'muted', at: -1, enter: 'none' });
  text(s, title, 170, 222, 104, { align: 'left', font: 'display', at, enter: 'rise' });
  s.line([[170, 308], [1750, 308]], { color: 'ink', width: 1, at: -1, enter: 'none', opacity: 0.3, sfx: false });
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
    text(s, 'THE CALENDAR', 180, 180, 34, { align: 'left', color: 'muted', at: 0, enter: 'none' });
    text(s, 'Why we have\nleap years', 180, 425, 110, { align: 'left', font: 'display', at: 0, enter: 'none', lineHeight: 1.12 });
    s.line([[180, 618], [780, 618]], { color: 'ink', width: 1, at: '#question', sfx: false });
    text(s, 'Keeping dates with the seasons', 180, 704, 42, { align: 'left', at: '#calendar', enter: 'fade' });
    dateCard(s, 1360, 540, 430, 480, 0, { enter: 'none' });
    text(s, 'February', 1360, 348, 46, { at: 0, enter: 'none' });
    text(s, '29', 1360, 555, 190, { font: 'display', color: 'accent', at: 0, enter: 'none' });
    s.line([[1260, 685], [1460, 685]], { color: 'accent', width: 3, at: '#calendar', sfx: false });
    text(s, 'An extra day', 1360, 850, 44, { at: 'extra day', enter: 'fade' });
  },
  orbit(s) {
    frame(s, 'A year has a fraction', '#orbit');
    orbit(s, 520, 610, 215, '#orbit');
    text(s, 'Earth around the Sun', 520, 900, 40, { at: '#orbit', color: 'muted' });
    text(s, '365.2422', 1230, 520, 132, { font: 'display', at: '#orbit' });
    text(s, 'days', 1230, 640, 48, { at: s.cueEnd('365.2422') });
    s.line([[1188, 578], [1424, 578]], { color: 'accent', width: 4, at: '#fraction', sfx: false });
    text(s, 'The fraction matters', 1230, 820, 46, { at: '#fraction', color: 'accent' });
  },
  drift(s) {
    frame(s, 'The fraction adds up', '#regular');
    text(s, 'Calendar year', 170, 438, 44, { at: '#regular', align: 'left' });
    text(s, '365 days', 170, 545, 104, { font: 'display', at: '#regular', align: 'left' });
    s.line([[700, 385], [700, 800]], { width: 1, opacity: 0.25, at: '#gap', sfx: false });
    text(s, 'Almost a quarter day', 830, 438, 54, { font: 'display', color: 'accent', at: '#gap', align: 'left' });
    fractions(s, '#gap', 830, 555, 205, 135);
    text(s, 'more each year', 830, 735, 42, { align: 'left', at: '#gap' });
    text(s, 'The difference accumulates', 830, 842, 42, { align: 'left', color: 'accent', at: '#build' });
    text(s, 'Fractions enlarged', 170, 914, 32, { align: 'left', color: 'muted', at: '#gap' });
  },
  leap(s) {
    frame(s, 'An extra day in February', '#four');
    fractions(s, '#four', 225, 515, 180, 130, undefined, '#date');
    text(s, 'Every four years', 565, 760, 54, { font: 'display', at: '#four' });
    s.arrow([960, 585], [1140, 585], { at: '#date', width: 2, color: 'ink', sfx: false });
    dateCard(s, 1440, 600, 380, 450, '#date');
    text(s, 'February', 1440, 424, 44, { at: '#date' });
    text(s, '29', 1440, 625, 170, { font: 'display', color: 'accent', at: '#date' });
    text(s, 'Fractions enlarged', 170, 914, 32, { align: 'left', color: 'muted', at: '#four' });
    s.sfx('chime', '#date', { gain: 0.18 });
  },
  correction(s) {
    frame(s, 'A little too much', '#extra');
    text(s, "Earth's cycle", 170, 458, 44, { align: 'left', at: '#extra' });
    text(s, 'Calendar correction', 170, 633, 44, { align: 'left', at: '#extra' });
    s.draw({ at: '#extra', enter: 'fade', sfx: false }, (c, life) => {
      const x = 700, target = 1550, y1 = 458, y2 = 633;
      c.strokeStyle = s.color('ink'); c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y1); c.lineTo(target, y1); c.stroke();
      c.beginPath(); c.moveTo(target, 395); c.lineTo(target, 735); c.stroke();
      const p = s.clamp(life.local / 3.0, 0, 1);
      c.beginPath(); c.moveTo(x, y2); c.lineTo(x + (target - x) * p, y2); c.stroke();
      c.strokeStyle = s.color('accent'); c.lineWidth = 8;
      const q = s.p('#over', 1.2);
      c.beginPath(); c.moveTo(target, y2); c.lineTo(target + 110 * q, y2); c.stroke();
    });
    text(s, 'An occasional exception', 960, 825, 66, { font: 'display', color: 'accent', at: '#over' });
    text(s, 'Difference enlarged', 170, 914, 32, { align: 'left', color: 'muted', at: '#extra' });
  },
  rule(s) {
    frame(s, 'The century exception', '#gregorian');
    text(s, 'Gregorian calendar', 170, 438, 68, { font: 'display', align: 'left', at: '#gregorian' });
    text(s, 'Introduced in 1582', 170, 529, 42, { align: 'left', color: 'muted', at: 'introduced' });
    text(s, 'Century year', 1110, 429, 58, { font: 'display', at: '#skip' });
    text(s, 'Skip the leap day', 1110, 525, 44, { at: '#skip' });
    s.line([[750, 632], [1470, 632]], { color: 'ink', width: 1, at: '#keep', opacity: 0.4, sfx: false });
    text(s, 'Unless divisible by 400', 1110, 736, 62, { font: 'display', color: 'accent', at: '#keep' });
    text(s, 'Keep the leap day', 1110, 837, 44, { at: '#keep' });
  },
  examples(s) {
    frame(s, 'The rule in practice', '#no');
    text(s, '1900', 520, 520, 144, { font: 'display', at: '#no' });
    text(s, 'No leap day', 520, 685, 48, { at: '#no' });
    s.draw({ at: '#no', enter: 'fade', sfx: false }, (c) => {
      c.strokeStyle = s.color('ink'); c.lineWidth = 2;
      c.beginPath(); c.moveTo(493, 783); c.lineTo(547, 837); c.moveTo(547, 783); c.lineTo(493, 837); c.stroke();
    });
    s.line([[960, 410], [960, 878]], { width: 1, opacity: 0.25, at: '#yes', sfx: false });
    text(s, '2000', 1380, 520, 144, { font: 'display', color: 'accent', at: '#yes' });
    text(s, 'February 29', 1380, 685, 48, { at: '#yes' });
    s.draw({ at: '#yes', enter: 'fade', sfx: false }, (c) => {
      c.strokeStyle = s.color('accent'); c.lineWidth = 3;
      c.beginPath(); c.moveTo(1350, 810); c.lineTo(1372, 832); c.lineTo(1412, 786); c.stroke();
    });
    s.sfx('chime', '#yes', { gain: 0.16 });
  },
  close(s) {
    frame(s, 'Keeping dates with the seasons', '#finish');
    dateCard(s, 530, 612, 350, 420, '#finish');
    text(s, 'February', 530, 451, 42, { at: '#finish' });
    text(s, '29', 530, 638, 160, { font: 'display', color: 'accent', at: '#finish' });
    s.line([[840, 615], [1040, 615]], { color: 'accent', width: 2, at: 'dates', sfx: false });
    orbit(s, 1340, 615, 195, 'dates');
    text(s, "Earth's yearly cycle", 1340, 901, 42, { at: 'seasons' });
  },
};
