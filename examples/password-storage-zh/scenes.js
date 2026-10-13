// Midnight password explainer. All values are illustrative shapes, never real hashes.
const C = { password: 'blue', hash: 'teal', salt: 'yellow', function: 'purple' };
const common = { sfx: false };
function title(s, text, o = {}) {
  s.text(text, { x: 960, y: 156, size: 88, weight: 700, font: 'display', at: 0, enter: 'none', ...common, ...o });
}
function label(s, text, x, y, at, color = 'ink', o = {}) {
  s.text(text, { x, y, size: 44, color, at, enter: 'rise', ...common, ...o });
}
function password(s, x, y, at, o = {}) {
  s.box('sunflower42', { id: 'password', x, y, w: 410, h: 142, size: 48, font: 'mono', color: C.password, at, ...common, ...o });
}
function machine(s, x, y, at, o = {}) {
  s.box('单向函数', { id: 'function', x, y, w: 320, h: 142, size: 48, color: C.function, at, ...common, ...o });
}
function hash(s, x, y, at, variant = 0, o = {}) {
  const color = s.color(C.hash);
  s.box('', { id: o.id || 'hash', x, y, w: 340, h: 142, color: C.hash, at, ...common, ...o });
  s.draw({ x, y, at, out: o.out }, (ctx, life) => {
    ctx.globalAlpha *= life.p;
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const px = -112 + i * 56;
      const v = (i + variant) % 3;
      ctx.beginPath();
      if (v === 0) ctx.roundRect(px - 16, -19, 32, 38, 5);
      else if (v === 1) ctx.arc(px, 0, 18, 0, Math.PI * 2);
      else {
        ctx.moveTo(px, -22);
        ctx.lineTo(px + 20, 0);
        ctx.lineTo(px, 22);
        ctx.lineTo(px - 20, 0);
        ctx.closePath();
      }
      ctx.fill();
    }
  });
}
function salt(s, x, y, at, variant = 0, o = {}) {
  s.box(variant ? '盐 · 乙' : '盐 · 甲', {
    id: o.id || 'salt',
    x,
    y,
    w: 240,
    h: 95,
    size: 44,
    color: C.salt,
    at,
    ...common,
    ...o,
  });
}
function arrow(s, a, b, at, o = {}) {
  s.arrow(a, b, { at, color: 'muted', width: 5, headSize: 22, ...common, ...o });
}
function flow(s, at0, at1, at2, o = {}) {
  password(s, 440, 480, at0, o);
  machine(s, 960, 480, at1, o);
  hash(s, 1480, 480, at2, 0, o);
  arrow(s, 'password', 'function', at1);
  arrow(s, 'function', 'hash', at2, { color: C.hash });
}
function foot(s, text, at, color = 'muted', o = {}) {
  label(s, text, 960, 790, at, color, { size: 40, ...o });
}
export default {
  question(s) {
    title(s, '网站怎么安全保存密码？');
    s.icon('key-round', { id: 'key', x: 440, y: 470, size: 180, color: C.password, at: '#ask', ...common });
    s.icon('cpu', { id: 'cpu', x: 960, y: 470, size: 180, color: C.function, at: '#careful', ...common });
    s.icon('database', { id: 'db', x: 1480, y: 470, size: 180, color: C.hash, at: '#hash', ...common });
    label(s, '密码', 440, 635, '#ask', C.password);
    label(s, '单向处理', 960, 635, '#careful', C.function);
    label(s, '保存哈希值', 1480, 635, '#hash', C.hash);
    arrow(s, 'key', 'cpu', '#careful');
    arrow(s, 'cpu', 'db', '#hash', { color: C.hash });
    s.annotate('cpu', { type: 'circle', color: C.function, at: s.time('#careful') + 2.3, ...common });
  },
  example(s) {
    title(s, '数据库里保存什么？');
    label(s, '示例密码', 440, 340, '#password', C.password);
    label(s, '计算', 960, 340, '#process', C.function);
    label(s, '哈希值', 1480, 340, '#store', C.hash);
    flow(s, '#password', '#process', '#store');
    s.annotate('hash', { type: 'box', color: C.hash, padding: 16, at: '#store', ...common });
    foot(s, '图形仅作示意', '#store');
    s.annotate('password', { type: 'strike', at: s.time('#store') + 1.3, color: 'red', ...common });
  },
  oneway(s) {
    title(s, '同样输入，同样结果');
    flow(s, -1, -1, -1);
    s.annotate('hash', { type: 'box', color: C.hash, padding: 16, at: '#same', ...common });
    arrow(s, [1420, 670], [470, 670], '#reverse', { dashed: true, color: 'red' });
    s.icon('x', { x: 960, y: 670, size: 68, color: 'red', at: s.time('#reverse') + 0.8, ...common });
    foot(s, '难以倒推', '#reverse', 'red', { out: '#guess', exit: 'none' });
    foot(s, '仍需防范猜密码', '#guess', 'yellow');
    s.annotate('password', { type: 'box', color: 'yellow', padding: 14, at: '#guess', ...common });
    s.annotate('function', { type: 'underline', color: 'yellow', at: s.time('#guess') + 2.3, ...common });
  },
  login(s) {
    title(s, '登录时，比对两个哈希值');
    label(s, '这次输入', 440, 310, '#type', C.password);
    password(s, 440, 435, '#type');
    machine(s, 960, 435, '#type');
    arrow(s, 'password', 'function', '#type');
    hash(s, 1480, 435, '#new');
    arrow(s, 'function', 'hash', '#new', { color: C.hash });
    label(s, '已保存', 960, 675, '#new', C.hash);
    hash(s, 1480, 675, '#new', 0, { id: 'saved' });
    arrow(s, [1480, 525], [1480, 585], '#compare', { color: 'green', head: 'both' });
    s.icon('check', { x: 1580, y: 555, size: 50, color: 'green', at: s.time('#compare') + 0.8, ...common });
    foot(s, '相同 → 核对通过', '#compare', 'green');
    s.sfx('ding', s.time('#compare') + 0.8, { gain: 0.12 });
  },
  salt(s) {
    title(s, '每个用户，加入随机盐');
    password(s, 440, 450, -1);
    machine(s, 960, 450, -1);
    hash(s, 1480, 450, '#salt');
    arrow(s, 'password', 'function', -1);
    arrow(s, 'function', 'hash', '#salt', { color: C.hash });
    salt(s, 960, 680, '#salt');
    arrow(s, 'salt', 'function', '#random', { color: C.salt });
    label(s, '随机数据', 650, 680, '#random', C.salt);
    salt(s, 1480, 680, '#save', 0, { id: 'savedSalt' });
    s.annotate({ x: 1480, y: 550, w: 410, h: 440 }, { type: 'bracket', color: C.hash, at: '#save', ...common });
    foot(s, '哈希值和盐一起保存', '#save', C.hash);
  },
  users(s) {
    title(s, '相同密码，不同哈希');
    label(s, '同一个密码', 960, 290, '#shared', C.password);
    password(s, 960, 390, '#shared');
    salt(s, 480, 565, '#different', 0, { id: 'saltA' });
    salt(s, 1440, 565, s.time('#different') + 0.4, 1, { id: 'saltB' });
    hash(s, 480, 735, s.time('#different') + 0.8, 0, { id: 'hashA' });
    hash(s, 1440, 735, s.time('#different') + 1.2, 2, { id: 'hashB' });
    arrow(s, 'password', 'saltA', '#different', { bend: -0.1, color: C.password });
    arrow(s, 'password', 'saltB', '#different', { bend: 0.1, color: C.password });
    arrow(s, 'saltA', 'hashA', s.time('#different') + 0.8, { color: C.hash });
    arrow(s, 'saltB', 'hashB', s.time('#different') + 1.2, { color: C.hash });
    label(s, '一张表查遍所有人', 960, 635, '#table', 'muted', { size: 38 });
    s.annotate({ x: 960, y: 635, w: 370, h: 55 }, { type: 'strike', color: 'red', at: s.time('#table') + 1.2, ...common });
    s.annotate('hashA', { type: 'box', color: C.hash, padding: 12, at: s.time('#table') + 3, ...common });
    s.annotate('hashB', { type: 'box', color: C.hash, padding: 12, at: s.time('#table') + 3, ...common });
  },
  slow(s) {
    title(s, '专为密码设计的慢计算');
    s.box('猜一个密码', { id: 'guess', x: 440, y: 465, w: 410, h: 142, size: 48, color: C.password, at: '#function', ...common });
    s.box('密码哈希函数', {
      id: 'function',
      x: 960,
      y: 465,
      w: 370,
      h: 142,
      size: 48,
      color: C.function,
      at: '#function',
      ...common,
    });
    hash(s, 1480, 465, '#cost');
    arrow(s, 'guess', 'function', '#slow');
    arrow(s, 'function', 'hash', '#cost', { color: C.hash });
    s.icon('timer', { x: 960, y: 685, size: 125, color: C.salt, at: '#slow', ...common });
    label(s, '每次猜测，都要计算', 960, 805, '#cost', C.salt, { size: 44 });
    s.annotate('function', { type: 'box', color: C.salt, padding: 14, at: s.time('#cost') + 2.2, ...common });
    s.draw({ x: 960, y: 685, at: '#slow' }, (ctx, life) => {
      ctx.strokeStyle = s.color(C.salt);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 81, -Math.PI / 2, -Math.PI / 2 + Math.min(1, life.local / 3) * Math.PI * 2);
      ctx.stroke();
    });
  },
  summary(s) {
    title(s, '安全保存密码');
    const xs = [440, 960, 1480];
    [['arrow-right', '单向哈希', C.hash, '#hash'], ['shuffle', '随机盐', C.salt, '#salt'], ['timer', '慢计算', C.function, '#slow']].forEach(([icon, text, color, at], i) => {
      s.icon(icon, { x: xs[i], y: 450, size: 160, color, at, ...common });
      label(s, text, xs[i], 610, at, color, { size: 56 });
    });
    s.line([[260, 720], [1660, 720]], { at: '#slow', color: C.hash, width: 4, ...common });
    foot(s, '密码用于核对，数据库保存哈希与盐', '#slow', 'ink', { size: 44 });
  },
};
