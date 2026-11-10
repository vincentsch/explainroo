// How DNS finds a website. One diagram grows from scene to scene; parts that
// were introduced earlier are drawn with at: -1 so they are simply there.

const P = {
  you: { x: 250, y: 560 },
  resolver: { x: 800, y: 560 },
  root: { x: 1500, y: 290 },
  tld: { x: 1500, y: 580 },
  auth: { x: 1500, y: 870 },
};

function question(s, o = {}) {
  return s.text('What is the address of *example.com*?', { id: 'q', y: 120, size: 50, bg: true, border: 'muted', ...o });
}

function you(s, o = {}) {
  return s.icon('laptop', { id: 'you', ...P.you, size: 150, label: 'your browser', labelSize: 40, ...o });
}

function resolver(s, o = {}) {
  return s.box('Resolver', { id: 'resolver', ...P.resolver, icon: 'server', color: 'yellow', w: 330, ...o });
}

function root(s, o = {}) {
  return s.box('Root server', { id: 'root', ...P.root, icon: 'globe', color: 'blue', w: 360, ...o });
}

function tld(s, o = {}) {
  return s.box('.com servers', { id: 'tld', ...P.tld, icon: 'server', color: 'green', w: 360, ...o });
}

function auth(s, o = {}) {
  return s.box('Name server', { id: 'auth', ...P.auth, icon: 'server', color: 'pink', w: 360, ...o });
}

export default {
  hook(s) {
    s.text('example.com', { id: 'url', font: 'mono', size: 76, y: 300, bg: true, border: 'ink', at: 'type', enter: 'type', dur: 0.8, out: '#numbers' });
    s.icon('app-window', { y: 640, size: 220, at: 'appears', out: '#but' });
    s.icon('laptop', { id: 'a', x: 620, y: 660, size: 170, at: s.mark('but') + 0.3 });
    s.icon('server', { id: 'b', x: 1300, y: 660, size: 170, at: s.mark('but') + 0.5 });
    s.arrow('a', 'b', { dashed: true, color: 'muted', label: 'by name?', at: 'name', head: 'both' });
    s.annotate('url', { type: 'cross', color: 'red', at: s.cueEnd('name') - 0.1, out: '#numbers', outDur: 0.2 });
    s.text('203.0.113.7', { font: 'mono', size: 76, y: 300, bg: true, border: 'accent', at: s.mark('numbers') + 0.25, enter: 'type', dur: 0.8 });
    s.note('an IP address', { y: 400, size: 40, at: 'addresses', color: 'yellow' });
  },

  question(s) {
    you(s, { at: 0.1 });
    question(s, { at: '#ask' });
    s.icon('help-circle', { x: 800, y: 560, size: 150, color: 'yellow', at: 'address' });
  },

  cache(s) {
    question(s, { at: -1 });
    you(s, { at: -1 });
    s.box('Browser cache', { id: 'bc', x: 800, y: 420, icon: 'history', w: 400, at: '#browser', color: 'blue' });
    s.box('Operating system cache', { id: 'oc', x: 800, y: 720, icon: 'cpu', w: 400, size: 40, at: '#os', color: 'purple' });
    s.arrow('you', 'bc', { at: s.mark('browser') + 0.1, bend: -0.15 });
    s.arrow('you', 'oc', { at: s.mark('os') + 0.1, bend: 0.15 });
  },

  resolver(s) {
    question(s, { at: -1 });
    you(s, { at: -1 });
    resolver(s, { at: 'resolver' });
    s.arrow('you', 'resolver', { at: 'resolver' });
    s.note('run by your internet provider', { x: P.resolver.x, y: 735, size: 40, at: '#isp' });
    s.note('or a public one, like 1.1.1.1', { x: P.resolver.x, y: 800, size: 40, at: '#public', color: 'yellow' });
  },

  root(s) {
    question(s, { at: -1 });
    you(s, { at: -1 });
    resolver(s, { at: -1 });
    s.arrow('you', 'resolver', { at: -1 });
    root(s, { at: 'root#1' });
    s.arrow('resolver', 'root', { at: 'root#1', bend: -0.1 });
    s.note("doesn't know the address", { x: P.root.x, y: P.root.y + 125, size: 36, at: 'address' });
    s.arrow('root', 'resolver', { at: '#tld', bend: 0.8, dashed: true, color: 'blue', label: 'ask the .com servers', labelColor: 'blue', labelOffset: 40 });
  },

  tld(s) {
    question(s, { at: -1 });
    you(s, { at: -1 });
    resolver(s, { at: -1 });
    root(s, { at: -1 });
    s.arrow('you', 'resolver', { at: -1 });
    s.arrow('resolver', 'root', { at: -1, bend: -0.1 });
    tld(s, { at: 'servers' });
    s.arrow('resolver', 'tld', { at: s.cue('servers') + 0.2 });
    s.arrow('tld', 'resolver', { at: '#auth', bend: -0.8, dashed: true, color: 'green', label: 'ask the name server', labelColor: 'green', labelOffset: 40 });
  },

  answer(s) {
    const q = question(s, { at: -1 });
    you(s, { at: -1 });
    resolver(s, { at: -1 });
    root(s, { at: -1 });
    tld(s, { at: -1 });
    s.arrow('you', 'resolver', { at: -1 });
    s.arrow('resolver', 'root', { at: -1, bend: -0.1 });
    s.arrow('resolver', 'tld', { at: -1 });
    auth(s, { at: 'name' });
    s.arrow('resolver', 'auth', { at: s.cue('name') + 0.2, bend: 0.1 });
    s.arrow('auth', 'resolver', { at: '#ip', bend: 0.6, color: 'accent', width: 6, label: 'the IP address', labelSize: 34, labelColor: 'yellow', labelOffset: 44 });
    s.arrow('resolver', 'you', { at: s.mark('ip') + 0.9, bend: 0.25, color: 'accent', width: 6 });
    s.annotate('q', { type: 'box', color: 'green', at: s.mark('ip') + 1.4 });
    s.icon('check', { x: q.right + 60, y: q.y, size: 70, color: 'green', at: s.mark('ip') + 1.6, enter: 'pop' });
    s.icon('database', { x: P.resolver.x, y: 780, size: 90, color: 'yellow', at: '#keep', label: 'saved for the next request', labelSize: 36 });
  },

  outro(s) {
    s.number(4, { suffix: ' questions', y: 360, at: 0.15 });
    const chain = [
      ['laptop', 'you'],
      ['server', 'resolver'],
      ['globe', 'root'],
      ['server', '.com'],
      ['server', 'name server'],
    ];
    const xs = s.row(5, { width: 1400 });
    chain.forEach(([icon, label], i) => {
      s.icon(icon, { id: `c${i}`, x: xs[i], y: 700, size: 110, label, labelSize: 36, at: s.mark('blink') + i * 0.3, color: i === 0 ? 'ink' : ['yellow', 'blue', 'green', 'pink'][i - 1] });
    });
    for (let i = 0; i < 4; i++) {
      s.arrow(`c${i}`, `c${i + 1}`, { at: s.mark('blink') + (i + 1) * 0.3 + 0.1, color: 'muted', gap: 20 });
    }
  },
};
