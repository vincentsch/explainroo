// s.quiet() at the top of a scene turns off the entrance sounds of the rest of
// that scene, and an element with sfx: true still plays its usual sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stage } from '../engine/stage.js';
import { UI } from '../engine/ui.js';
import { Short } from '../engine/short.js';
import { getTheme } from '../engine/themes.js';

Stage.UI = UI;
Stage.Short = Short;

globalThis.DOMPoint ??= class {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
};
globalThis.DOMMatrix ??= class {
  constructor([a, b, c, d, e, f]) {
    Object.assign(this, { a, b, c, d, e, f });
  }
  transformPoint(p) {
    return new DOMPoint(this.a * p.x + this.c * p.y + this.e, this.b * p.x + this.d * p.y + this.f);
  }
};

// A canvas that draws nothing.
function fakeCanvas() {
  return new Proxy({ font: '', fillStyle: '#000', globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (t) => ({ width: String(t).length * 10 });
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, transformPoint: (p) => p });
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

// The sounds a scene asks for: [kind, at, sound].
function sounds(scene, { sfx = true, t = 0 } = {}) {
  const events = [];
  const engine = {
    theme: getTheme('clean'),
    pen: { draw() {} },
    W: 1920,
    H: 1080,
    safeArea: { x: 0, y: 0, w: 1920, h: 1080, bottom: 1080 },
    config: { brand: null },
    timeline: { pace: 1, duration: 10, frames: 300, fps: 30, width: 1920, height: 1080, scenes: [] },
    fps: 30,
    scale: 1,
    sfxMode: sfx,
    sfxNames: ['pop', 'ding', 'chime', 'whoosh', 'blip', 'swipe'],
    icons: { star: ['M2 2L22 22'] },
    iconCache: new Map(),
    recorder: { push: (e) => events.push(e) },
    textLog: null,
  };
  const s = new Stage(engine, fakeCanvas(), { start: 0, dur: 10, id: 'demo', index: 0, words: [], marks: {}, voice: null, lead: 0 }, t);
  scene(s);
  return events.filter((e) => e.sfx).map((e) => [e.kind, Math.round(e.at * 100) / 100, e.sfx]);
}

// A circle pops in first, then twelve more, a star with a sound of its own, a
// sound the scene adds, and two stickers.
const busy = (quiet) => (s) => {
  s.box('Before', { at: 0.5 });
  if (quiet) s.quiet();
  for (let i = 0; i < 12; i++) s.circle({ x: 100 + i * 120, y: 500, r: 40, at: 1 + i * 0.1, sfx: i === 0 ? true : undefined });
  s.icon('star', { at: 3, sfx: 'chime' });
  s.sfx('ding', 4);
  s.short.sticker('Done', { at: 5 });
  s.short.sticker('Loud', { at: 6, sfx: true });
  s.short.interrupt(7);
};

test('s.quiet() turns off the entrance sounds after it, and sfx: true still plays', () => {
  assert.deepEqual(sounds(busy(true)), [
    ['shape', 0.5, 'pop'],
    ['shape', 1, 'pop'],
    ['icon', 3, 'chime'],
    ['sfx', 4, 'ding'],
    ['short', 6, 'pop'],
    ['short', 7, 'whoosh'],
  ]);
  // Without it every entrance plays.
  const loud = sounds(busy(false));
  assert.equal(loud.filter(([kind]) => kind === 'shape').length, 13);
  assert.deepEqual(loud.filter(([kind]) => kind === 'short').map(([, at]) => at), [5, 6, 7]);
});

test('sfx: true plays the usual sound with "sfx": "minimal" too', () => {
  assert.deepEqual(sounds((s) => {
    s.box('Quiet', { at: 1 });
    s.box('Heard', { at: 2, sfx: true });
    s.short.sticker('Heard too', { at: 3, sfx: true });
  }, { sfx: 'minimal' }), [['shape', 2, 'pop'], ['short', 3, 'pop']]);
});

test('a toast and a wipe have usual sounds that s.quiet() turns off, sfx: true plays and a sound of their own replaces', () => {
  const kit = (quiet, o = {}) => sounds((s) => {
    if (quiet) s.quiet();
    s.ui.toast('Saved', { at: 1, icon: false, ...o });
    s.ui.wipe(2, o);
  }, { t: 2.5 });
  assert.deepEqual(kit(false), [['ui', 1, 'chime'], ['sfx', 2, 'swipe']]);
  assert.deepEqual(kit(true), []);
  assert.deepEqual(kit(true, { sfx: true }), [['ui', 1, 'chime'], ['sfx', 2, 'swipe']]);
  assert.deepEqual(kit(false, { sfx: true }), [['ui', 1, 'chime'], ['sfx', 2, 'swipe']]);
  assert.deepEqual(kit(true, { sfx: 'pop' }), [['ui', 1, 'pop'], ['sfx', 2, 'pop']]);
  assert.deepEqual(kit(false, { sfx: false }), []);
  // A panel has no sound of its own, so sfx: true finds none, and a chosen one plays.
  assert.deepEqual(sounds((s) => { s.ui.panel(0, 0, 100, 100, { at: 1, sfx: true }); s.ui.panel(0, 0, 100, 100, { at: 2, sfx: 'pop' }); }), [['ui', 2, 'pop']]);
});
