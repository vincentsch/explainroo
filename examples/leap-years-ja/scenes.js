// Japanese labels stay in s.text, so check can measure every label.
const txt = (s, str, x, y, size = 48, o = {}) =>
  s.text(str, { x, y, size, color: 'ink', enter: 'write', dur: 0.65, sfx: false, ...o });
function header(s, title, at = 0) {
  txt(s, '暦と地球の動き', 160, 110, 38, { align: 'left', color: 'muted', at: -1, enter: 'none' });
  txt(s, title, 160, 207, 86, { align: 'left', font: 'display', at });
  s.line([[160, 280], [1760, 280]], { at: -1, enter: 'none', color: 'ink', opacity: 0.25, width: 2, sfx: false });
}
function calendar(s, x, y, at, o = {}) {
  const w = o.w || 360;
  const h = o.h || 390;
  s.box('', { x, y, w, h, fill: 'surface', color: 'ink', width: 4, at, sfx: false, ...o });
  s.line([[x - w / 2, y - h / 2 + 92], [x + w / 2, y - h / 2 + 92]], { at, color: 'ink', width: 3, sfx: false, ...o });
  for (const dx of [-w / 4, w / 4]) {
    s.line([[x + dx, y - h / 2 - 15], [x + dx, y - h / 2 + 18]], { at, color: 'ink', width: 6, sfx: false, ...o });
  }
}
function date(s, x, y, at, o = {}) {
  calendar(s, x, y, at, o);
  const h = o.h || 390;
  txt(s, '2月', x, y - h / 2 + 49, 50, { at, ...o });
  txt(s, '29', x, y + 40, 166, { font: 'display', color: 'accent', at, ...o });
}
function orbit(s, x, y, r, at, o = {}) {
  s.draw({ at, enter: 'fade', dur: 0.65, sfx: false, ...o }, (c, life) => {
    const p = Math.min(1, Math.max(0, life.local / Math.max(3, s.dur - s.time(at) - 0.5)));
    c.lineWidth = 3;
    c.strokeStyle = s.color('ink');
    c.globalAlpha *= 0.5;
    c.setLineDash([10, 12]);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha /= 0.5;
    c.strokeStyle = s.color('accent');
    c.lineWidth = 5;
    c.beginPath();
    c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    c.stroke();
    const a = -Math.PI / 2 + p * Math.PI * 2,
      ex = x + Math.cos(a) * r,
      ey = y + Math.sin(a) * r;
    c.fillStyle = s.color('blue');
    c.strokeStyle = s.color('ink');
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(ex, ey, 23, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = s.color('bg');
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(ex, ey, 9, 19, 0.3, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.ellipse(ex, ey, 20, 7, -0.15, 0, Math.PI * 2);
    c.stroke();
  });
  s.icon('sun', { x, y: y - 30, size: 108, color: 'accent', at, sfx: false, ...o });
  txt(s, '太陽', x, y + 63, 42, { at, ...o });
}
// Four enlarged annual fractions; no new numerical claim is shown.
function fractions(s, at, x, y, { merge, out, w = 126, h = 174, gap = 169 } = {}) {
  s.draw({ at, out, enter: 'fade', dur: 0.5, sfx: false }, (c, life) => {
    const q = merge ? s.p(merge, 1.3) : 0;
    const center = x + gap * 1.5;
    c.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const p = s.clamp((life.local - i * 0.65) / 0.7, 0, 1);
      const bx = s.lerp(x + i * gap, center, q);
      c.strokeStyle = s.color('ink');
      c.save();
      c.globalAlpha *= 1 - q;
      c.strokeRect(x + i * gap, y, w, h);
      c.restore();
      const fh = (h - 14) * 0.2422 * p;
      const by = s.lerp(y + h - 7 - fh, y + h - 7 - fh * (i + 1), q);
      c.fillStyle = s.color('accent');
      c.fillRect(bx + 7, by, w - 14, fh);
    }
    c.save();
    c.globalAlpha *= q;
    c.strokeStyle = s.color('ink');
    c.strokeRect(center, y, w, h);
    c.restore();
  });
}
export default {
  hook(s) {
    txt(s, '暦と地球の動き', 160, 140, 42, { align: 'left', color: 'muted', at: 0, enter: 'none' });
    txt(s, 'うるう年は、\nなぜあるの？', 160, 400, 100, {
      align: 'left',
      font: 'display',
      lineHeight: 1.28,
      at: 0,
      enter: 'none',
    });
    date(s, 1380, 490, 0, { w: 400, h: 420, enter: 'none' });
    txt(s, '一日をプラス', 1380, 780, 56, { at: '#question', color: 'accent' });
    s.line([[165, 560], [820, 560]], { at: '#reason', color: 'accent', width: 5, sfx: false });
    txt(s, '地球の一周がカギ', 160, 687, 54, { align: 'left', at: '#reason' });
    s.icon('orbit', { x: 795, y: 695, size: 90, color: 'blue', at: '#reason', sfx: false });
  },
  orbit(s) {
    header(s, '一年には、端数がある', '#earth');
    orbit(s, 505, 530, 196, '#earth');
    txt(s, '地球の一周', 505, 792, 48, { at: '#earth', color: 'blue' });
    txt(s, '約365.2422日', 1260, 475, 102, { id: 'year', font: 'display', at: '#number' });
    txt(s, '小数点以下の分', 1260, 674, 58, { at: '#fraction', color: 'accent' });
    s.annotate('year', { type: 'underline', at: '#fraction', color: 'accent', width: 5, padding: 15 });
  },
  drift(s) {
    header(s, '毎年、少しずつずれる', '#calendar');
    calendar(s, 490, 529, '#calendar', { w: 475, h: 380 });
    txt(s, 'カレンダーの1年', 490, 389, 48, { at: '#calendar' });
    txt(s, '365', 490, 525, 126, { font: 'display', at: '#calendar' });
    txt(s, '日', 490, 650, 50, { at: '#calendar' });
    txt(s, 'ほぼ4分の1日', 1300, 386, 58, { at: '#gap', color: 'accent' });
    fractions(s, '#gap', 990, 494);
    txt(s, '積み重なるズレ', 1300, 762, 54, { at: '#build', color: 'accent' });
    s.arrow([760, 571], [930, 571], { at: '#gap', color: 'ink', width: 4, sfx: false });
    txt(s, '模式図', 1678, 804, 34, { at: '#gap', color: 'muted' });
  },
  leap(s) {
    header(s, '基本は、4年ごとに一日', '#four');
    fractions(s, '#four', 195, 478, { merge: '#add', w: 132, h: 198, gap: 175 });
    txt(s, '4年ごと', 524, 755, 60, { at: '#four' });
    s.arrow([920, 578], [1120, 578], { at: '#add', color: 'accent', width: 5, sfx: false });
    date(s, 1410, 545, '#date', { w: 350, h: 388 });
    txt(s, '追加の一日', 1410, 795, 50, { at: '#date', color: 'accent' });
    txt(s, '模式図', 185, 804, 34, { at: '#four', align: 'left', color: 'muted' });
    s.sfx('chime', '#date', { gain: 0.11 });
  },
  correction(s) {
    header(s, '少し、足しすぎになる', '#mostly');
    txt(s, 'たまったズレ', 170, 439, 50, { align: 'left', at: '#mostly' });
    txt(s, '足す一日', 170, 614, 50, { align: 'left', at: '#over' });
    s.draw({ at: '#mostly', enter: 'fade', sfx: false }, (c) => {
      const x = 580,
        end = 1490,
        w = 54,
        p = s.p('#mostly', 1.8);
      c.fillStyle = s.color('accent');
      c.fillRect(x, 412, (end - x) * p, w);
      c.strokeStyle = s.color('ink');
      c.lineWidth = 3;
      c.setLineDash([9, 10]);
      c.beginPath();
      c.moveTo(end, 374);
      c.lineTo(end, 723);
      c.stroke();
      c.setLineDash([]);
      const q = s.p('#over', 1.6),
        extra = s.p(s.time('#over') + 2.2, 1.0);
      c.fillStyle = s.color('ink');
      c.fillRect(x, 587, (end - x) * q, w);
      c.fillStyle = s.color('accent');
      c.fillRect(end, 587, 112 * extra, w);
    });
    txt(s, 'わずかに多い', 1310, 766, 55, { at: s.time('#over') + 2.2, color: 'accent' });
    txt(s, '差を拡大した模式図', 170, 804, 34, { align: 'left', at: '#mostly', color: 'muted' });
  },
  rule(s) {
    header(s, '例外で、微調整', '#gregorian');
    txt(s, '1582年に導入', 160, 366, 42, { align: 'left', at: '#gregorian', color: 'muted' });
    txt(s, 'グレゴリオ暦', 160, 447, 60, { align: 'left', at: '#name' });
    s.line([[675, 350], [675, 802]], { at: '#skip', width: 2, opacity: 0.3, sfx: false });
    txt(s, '世紀の区切りの年', 1230, 389, 57, { at: '#skip' });
    txt(s, 'うるう年にしない', 1230, 485, 60, { at: s.time('#skip') + 1.5 });
    s.line([[865, 564], [1595, 564]], { at: '#keep', width: 3, color: 'accent', sfx: false });
    txt(s, '400で割り切れる年', 1230, 655, 57, { at: '#keep', color: 'accent' });
    txt(s, 'うるう年にする', 1230, 762, 60, { at: s.time('#keep') + 1.5, color: 'accent' });
  },
  examples(s) {
    header(s, '1900年と2000年', '#no');
    txt(s, '1900年', 505, 445, 124, { font: 'display', at: '#no' });
    txt(s, 'うるう年ではない', 505, 629, 50, { at: '#no' });
    s.icon('x', { x: 505, y: 752, size: 72, color: 'ink', at: s.time('#no') + 1.6, sfx: false });
    s.line([[960, 361], [960, 803]], { at: '#yes', width: 2, opacity: 0.3, sfx: false });
    txt(s, '2000年', 1415, 445, 124, { font: 'display', color: 'accent', at: '#yes' });
    txt(s, 'うるう年', 1415, 629, 50, { at: '#yes', color: 'accent' });
    s.icon('check', { x: 1415, y: 752, size: 80, color: 'accent', at: s.time('#yes') + 1.8, sfx: false });
    s.sfx('chime', s.time('#yes') + 1.8, { gain: 0.1 });
  },
  close(s) {
    header(s, '暦を、地球の動きに合わせる', '#finish');
    date(s, 490, 527, '#finish', { w: 340, h: 380 });
    txt(s, '日数を調整', 490, 794, 54, { at: '#finish', color: 'accent' });
    s.arrow([815, 533], [1070, 533], { at: '#align', color: 'accent', width: 5, sfx: false });
    orbit(s, 1400, 530, 190, '#align');
    txt(s, '地球の動き', 1400, 794, 54, { at: '#align', color: 'blue' });
  },
};
