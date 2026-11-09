// What "defaults": "0.6" changes in a frame, and what the studio look draws:
// titles, box labels and text on a card that wrap into even lines, one size scale for labels and notes, room
// between list items, a bar for a small value, a band of color on a studio
// card and list items on cards. Each scene keeps what its elements return in
// globalThis.measured, so the test reads the layout the page drew.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SCENES = {
  title: `globalThis.measured.title = s.title('How a cache makes a website fast', { at: 0 });`,
  label: `s.box('Browser', { id: 'a', x: 500, y: 540, at: 0 });
    s.box('Server', { id: 'b', x: 1400, y: 540, at: 0 });
    s.arrow('a', 'b', { label: 'asks', at: 0 });
    globalThis.measured.note = s.note('about 20 ms', { y: 900, at: 0 });`,
  list: `globalThis.measured.list = s.list(['A cache keeps a copy', 'Copies need a time limit', 'Measure first'], { x: 400, y: 200, at: 0 });`,
  bars: `s.bars([{ label: 'Database', value: 40 }, { label: 'Memory', value: 0.1 }], { at: 0, dur: 0.1 });`,
  card: `s.box('With a cache', { x: 960, y: 540, w: 600, color: 'green', at: 0 });`,
  wrap: `globalThis.measured.box = s.box('Only the scrambled file syncs to the cloud', { y: 300, maxWidth: 640, at: 0 });
    globalThis.measured.text = s.text('Only the scrambled file syncs to the cloud', { y: 700, bg: true, maxWidth: 700, at: 0 });
    globalThis.measured.plain = s.text('Only the scrambled file syncs to the cloud', { y: 950, maxWidth: 700, at: 0 });`,
};

function project(t, settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-defaults-06-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(SCENES).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(SCENES).map(([id, body]) => `  ${id}(s) {\n    globalThis.measured ??= {};\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const scenes = Object.keys(SCENES).map((id, index) => {
    const scene = { id, index, start, dur: 3, marks: {}, voice: null, lead: 0, transition: 'none', words: [] };
    start += 3;
    return scene;
  });
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width, height, transitionSeconds: 0, scenes } };
}

// The end of each scene: what its elements returned, the text check saw, and
// the color of a few pixels.
const look = (settings, t) => {
  const { project: p, timeline } = project(t, settings);
  return withEngine(p, timeline, { scale: 1 }, (page) => page.evaluate(async () => {
    const issues = window.explainroo.check(0.25);
    const out = {};
    for (const [i, id] of ['title', 'label', 'list', 'bars', 'card', 'wrap'].entries()) {
      globalThis.measured = {};
      const [jpeg] = await window.explainroo.frames([i * 90 + 85], 1);
      const img = new Image();
      img.src = `data:image/jpeg;base64,${jpeg}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const pixel = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      out[id] = { ...globalThis.measured };
      if (id === 'bars') out.bars = { memory: pixel(1185, 830), above: pixel(1185, 790) };
      if (id === 'card') out.card = { band: [0, 4, 8, 12, 16, 20, 24].map((dy) => pixel(960, 497 + dy)) };
    }
    return { issues, ...out };
  }));
};

test('with "defaults": "0.6" a title wraps into even lines, labels and notes follow one scale and list items get more room', { skip, timeout: 120000 }, async (t) => {
  const before = await look({ defaults: '0.5' }, t);
  const after = await look({ defaults: '0.6' }, t);
  // The same two lines, but the second no longer holds one word alone.
  assert.equal(before.title.title.h, after.title.title.h);
  assert.ok(after.title.title.w < before.title.title.w - 150, `${after.title.title.w} < ${before.title.title.w}`);
  // A note of 34 pixels, up from 32.
  assert.ok(after.label.note.h > before.label.note.h);
  // The list items sit further apart.
  assert.ok(after.list.list[2].y - after.list.list[0].y > before.list.list[2].y - before.list.list[0].y);
  assert.deepEqual(after.issues, []);
});

test('with "defaults": "0.6" box labels and text on a card that wrap get balanced lines, and plain text keeps its lines', { skip, timeout: 120000 }, async (t) => {
  const before = await look({ defaults: '0.5' }, t);
  const after = await look({ defaults: '0.6' }, t);
  for (const key of ['box', 'text']) {
    assert.equal(after.wrap[key].h, before.wrap[key].h, `${key}: as many lines`);
    assert.ok(after.wrap[key].w < before.wrap[key].w - 100, `${key}: ${after.wrap[key].w} < ${before.wrap[key].w}`);
  }
  assert.deepEqual(after.wrap.plain, before.wrap.plain);
});

test('with "defaults": "0.6" a bar for a small value stays visible', { skip, timeout: 120000 }, async (t) => {
  const before = await look({ defaults: '0.5' }, t);
  const after = await look({ defaults: '0.6' }, t);
  const dark = (p) => p.reduce((a, b) => a + b, 0) < 600;
  assert.equal(dark(before.bars.memory), false, 'without it the bar is a line on the axis');
  assert.equal(dark(after.bars.memory), true, 'with it the bar shows');
});

test('the studio look draws a band of color on a card with a color and puts list items on numbered cards', { skip, timeout: 120000 }, async (t) => {
  const studio = await look({ theme: 'studio', defaults: '0.6' }, t);
  // The band along the top of the card is green, and the card under it white.
  assert.ok(studio.card.band.some(([r, g, b]) => g > r + 60 && g > b + 30), JSON.stringify(studio.card.band));
  assert.ok(studio.card.band.some(([r, g, b]) => r > 245 && g > 245 && b > 245), JSON.stringify(studio.card.band));
  // Cards need room between the items.
  const clean = await look({ defaults: '0.6' }, t);
  assert.ok(studio.list.list[1].y - studio.list.list[0].y > clean.list.list[1].y - clean.list.list[0].y);
  assert.deepEqual(studio.issues, []);
});
