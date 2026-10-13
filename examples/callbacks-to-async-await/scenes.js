import { callback, promise, promiseErrors, awaited, awaitedErrors } from './code-versions.js';

// Every state is declared on every frame; markers drive both morphs and labels.
const quiet = { sfx: false };
function heading(s, title, section) {
  s.text(section, { x: 192, y: 94, align: 'left', size: 32, font: 'mono', color: 'muted', at: -1, ...quiet });
  s.text(title, { x: 192, y: 172, align: 'left', size: 88, font: 'display', bold: true, at: -1, ...quiet });
}
function editor(s, steps) {
  s.code(steps, { x: 960, y: 570, w: 1550, size: 48, title: 'user-orders.js', lang: 'js', reveal: 'none', enter: 'none', morphDur: 0.8, ...quiet });
}
function notes(s, states) {
  states.forEach(([text, at, color = 'ink'], i) => {
    s.text(text, { x: 960, y: 956, size: 44, color, at,
      out: states[i + 1]?.[1], enter: 'fade', dur: 0.18, exit: 'none', ...quiet });
  });
}
function flow(s, times, y = 625) {
  s.box('User 7', { id: 'user', x: 480, y, w: 310, h: 148, size: 52, color: 'blue', at: times[0], ...quiet });
  s.box('Orders', { id: 'orders', x: 960, y, w: 310, h: 148, size: 52, color: 'purple', at: times[1], ...quiet });
  s.box('Display', { id: 'display', x: 1440, y, w: 310, h: 148, size: 52, color: 'green', at: times[2], ...quiet });
  s.arrow('user', 'orders', { at: times[1], color: 'blue', width: 4, ...quiet });
  s.arrow('orders', 'display', { at: times[2], color: 'purple', width: 4, ...quiet });
}
export default {
  intro(s) {
    heading(s, 'Callbacks to async/await', 'JAVASCRIPT  /  ASYNCHRONOUS CODE');
    s.text('Two requests, one dependency', { id: 'dependency', y: 350, size: 56, at: '#question', ...quiet });
    s.annotate('dependency', { type: 'underline', color: 'accent', at: '#depends', ...quiet });
    flow(s, ['#user', '#orders', '#display']);
    s.text('user.id', { x: 720, y: 762, font: 'mono', size: 40, color: 'blue', at: '#orders', ...quiet });
  },
  callbacks(s) {
    heading(s, 'Callbacks', '01  /  FUNCTIONS THAT RUN LATER');
    editor(s, [
      { code: callback, at: -1, highlight: [] },
      { code: callback, at: '#callback', highlight: [1] },
      { code: callback, at: '#later', highlight: [1] },
      { code: callback, at: '#nested', highlight: [2] },
      { code: callback, at: '#display', highlight: [3] },
    ]);
    notes(s, [['Success path', -1, 'muted'], ['Pass a function', '#callback'], ['Run it when data arrives', '#later'], ['Start orders inside the callback', '#nested'], ['Display inside the next callback', '#display']]);
  },
  promises(s) {
    heading(s, 'Promises', '02  /  HELPERS NOW RETURN PROMISES');
    editor(s, [
      { code: callback, at: -1, highlight: [] },
      { code: promise, at: '#promise', highlight: [1] },
      { code: promise, at: '#future', highlight: [1] },
      { code: promise, at: '#then', highlight: [2] },
      { code: promise, at: '#return', highlight: [3] },
    ]);
    notes(s, [['A promise represents a future result', '#promise'], ['Result arrives later', '#future'], ['then receives the user', '#then'], ['Return the orders promise', '#return', 'accent']]);
    s.sfx('whoosh', '#promise', { gain: 0.12 });
  },
  chain(s) {
    heading(s, 'Connect the results', '02  /  A SINGLE PROMISE CHAIN');
    editor(s, [
      { code: promise, at: -1, highlight: [3] },
      { code: promise, at: '#wait', highlight: [3] },
      { code: promise, at: '#orders', highlight: [5] },
      { code: promiseErrors, at: '#catch', highlight: [6] },
      { code: promiseErrors, at: '#either', highlight: [1, 3, 6] },
    ]);
    notes(s, [['Return connects the two requests', '#wait'], ['The next then receives the orders', '#orders'], ['catch handles rejection', '#catch'], ['Failures from either request', '#either']]);
    s.sfx('click', '#catch', { gain: 0.1 });
  },
  asyncVersion(s) {
    heading(s, 'async / await', '03  /  THE SAME REQUEST ORDER');
    editor(s, [
      { code: promiseErrors, at: -1, highlight: [] },
      { code: awaited, at: '#async', highlight: [1] },
      { code: awaited, at: '#syntax', highlight: [2, 3] },
      { code: awaited, at: '#first', highlight: [2] },
      { code: awaited, at: '#second', highlight: [3] },
    ]);
    notes(s, [['async enables await', '#async'], ['Success path', '#syntax', 'muted'], ['The user result becomes a variable', '#first'], ['Then fetch orders with user.id', '#second']]);
    s.sfx('whoosh', '#async', { gain: 0.12 });
  },
  waiting(s) {
    heading(s, 'What await does', '03  /  WAITING AND FAILURE');
    editor(s, [
      { code: awaited, at: -1, highlight: [2] },
      { code: awaited, at: '#pause', highlight: [2] },
      { code: awaited, at: '#other', highlight: [2] },
      { code: awaited, at: '#throws', highlight: [2, 3] },
      { code: awaitedErrors, at: '#try', highlight: [2, 6] },
    ]);
    notes(s, [['This function pauses at await', '#pause'], ['Other JavaScript can run', '#other', 'accent'], ['Rejection throws at await', '#throws'], ['try / catch handles the failure', '#try']]);
    s.sfx('click', '#try', { gain: 0.1 });
  },
  summary(s) {
    heading(s, 'One sequence, three styles', 'JAVASCRIPT  /  CALLBACKS TO ASYNC/AWAIT');
    const styles = [
      ['Callbacks', 'Nested functions', 480, '#callbacks', 'blue'],
      ['Promises', 'Returned promises', 960, '#promises', 'purple'],
      ['async / await', 'Awaited results', 1440, '#await', 'accent'],
    ];
    styles.forEach(([title, detail, x, at, color]) => {
      s.text(title, { x, y: 404, size: 54, bold: true, color, at, ...quiet });
      s.text(detail, { x, y: 482, size: 36, color: 'muted', at, ...quiet });
    });
    flow(s, [-1, -1, -1], 715);
    s.text('Fetch user, then orders, then display', { y: 935, size: 48, at: '#read', ...quiet });
  },
};
