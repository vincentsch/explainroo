// What check sees besides text: shapes that partly overlap, lines that cross
// text, an empty start, colors on stickers and boxes, text at the size the
// camera shows it, and text a held shot cuts. Real pages, with timelines made
// by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { contrast } from '../engine/util.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// A project whose scenes are { id: body }, each `dur` seconds long.
function project(t, settings, scenes, { dur = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-shapes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, camera: 'still', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.keys(scenes).map((id, index) => {
    const scene = { id, index, start, dur, marks: {}, voice: null, lead: 0, transition: 'none', words: [] };
    start += dur;
    return scene;
  });
  const { width, height } = loaded.config;
  return { project: loaded, timeline: { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width, height, transitionSeconds: 0, scenes: list } };
}

const check = ({ project: p, timeline }, fn = null) => withEngine(p, timeline, { scale: 0.5 }, async (page) => {
  const issues = await page.evaluate(() => window.explainroo.check(0.25));
  return fn ? { issues, more: await fn(page) } : issues;
});

const messages = (issues, scene, part) => issues.filter((i) => i.scene === scene && i.message.includes(part)).map((i) => i.message);

test('check warns about shapes that partly overlap, and not about touching, nested or grouped ones', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    // Two cards 220 pixels high, 210 apart: 10 pixels of each other.
    stacked: `s.box('Rivers bring salt in', { x: 960, y: 400, w: 500, h: 220, at: 0 });
    s.box('Only water leaves', { x: 960, y: 610, w: 500, h: 220, at: 0 });`,
    // 4 pixels is touching.
    touching: `s.box('Left', { x: 700, y: 540, w: 404, h: 200, at: 0 });
    s.box('Right', { x: 1100, y: 540, w: 404, h: 200, at: 0 });`,
    nested: `s.box({ x: 960, y: 540, w: 900, h: 600, at: 0 });
    s.box('Inside', { x: 960, y: 540, at: 0.2 });
    s.icon('server', { x: 1300, y: 400, size: 100, at: 0.2 });`,
    grouped: `s.group({ x: 960, y: 540, at: 0 }, () => {
      s.box('Card', { x: 0, y: 0, w: 400, h: 200 });
      s.icon('badge-check', { x: 190, y: -90, size: 90, bg: 'circle', color: 'green' });
    });`,
    allowed: `s.box('Card', { x: 960, y: 540, w: 400, h: 200, at: 0 });
    s.icon('badge-check', { x: 1150, y: 450, size: 90, bg: 'circle', color: 'green', overlap: true, at: 0 });`,
    // Circles whose boxes overlap at a corner, but not the circles themselves.
    circles: `s.circle({ x: 800, y: 500, r: 100, at: 0 });
    s.circle({ x: 950, y: 650, r: 100, at: 0 });`,
    // A badge on a card's corner, and a sticker over an image.
    badge: `s.box('Card', { x: 960, y: 540, w: 400, h: 200, at: 0 });
    s.icon('badge-check', { x: 1150, y: 450, size: 90, bg: 'circle', color: 'green', at: 0 });`,
    sticker: `s.box('Price list', { x: 960, y: 500, w: 600, h: 300, at: 0 });
    s.short.sticker('*2* days', { x: 1240, y: 650, at: 0 });`,
    // App cards: two side by side overlap, what a panel holds is inside it, and
    // a dialog covers what is under it.
    app: `const u = s.ui;
    u.panel(200, 200, 700, 500, { at: 0 }, () => u.card(260, 300, 300, 120));
    u.panel(850, 300, 600, 400, { at: 0 });
    u.modal(500, 250, 900, 500, { at: 0.5 });`,
    // Shapes count once they have arrived, not while they pop in.
    arriving: `s.box('A', { x: 900, y: 540, w: 300, h: 200, at: 0, enter: 'none' });
    s.box('B', { x: 1200, y: 540, w: 400, h: 200, at: 2.6, enter: 'pop', dur: 1 });`,
  }));
  assert.deepEqual(messages(issues, 'stacked', 'overlap'), ['the box "Rivers bring salt in" and the box "Only water leaves" partly overlap, by 10px; move them apart, or give one of them overlap: true if that is meant']);
  assert.equal(issues.find((i) => i.scene === 'stacked').level, 'warn');
  for (const scene of ['touching', 'nested', 'grouped', 'allowed', 'circles', 'arriving']) assert.deepEqual(messages(issues, scene, 'overlap'), [], scene);
  assert.match(messages(issues, 'badge', 'overlap')[0] ?? '', /^the box "Card" and the icon "badge-check" partly overlap, by \d+px; move them apart, or give one of them overlap: true if that is meant$/);
  assert.match(messages(issues, 'sticker', 'overlap')[0] ?? '', /^the box "Price list" and the sticker "2 days" partly overlap, by \d+px/);
  assert.deepEqual(messages(issues, 'app', 'overlap'), ['the card at 550,450 and the card at 1150,500 partly overlap, by 50px; move them apart, or give one of them overlap: true if that is meant']);
});

test('check warns about the line of an arrow or a mark that crosses text, and arrows leave an icon outside its label', { skip }, async (t) => {
  const p = project(t, { theme: 'paper' }, {
    // The circle around an icon runs through the icon's label.
    circled: `s.icon('user-round', { id: 'body', x: 1360, y: 430, size: 200, label: 'Your body', labelSize: 48, at: 0 });
    s.annotate('body', { type: 'circle', color: 'muted', at: 0.5 });`,
    // A strike through a text is meant to cross it, and a circle around a box
    // stays clear of its label.
    marked: `s.text('Old price', { id: 'old', x: 600, y: 540, size: 64, at: 0 });
    s.annotate('old', { type: 'strike', at: 0.5 });
    s.box('Resolver', { id: 'res', x: 1300, y: 540, at: 0 });
    s.annotate('res', { type: 'circle', at: 0.5 });`,
    // An arrow through a text in its way, and one with its own label.
    across: `s.text('in the way', { x: 960, y: 540, size: 48, at: 0 });
    s.arrow([500, 540], [1400, 540], { at: 0.5 });
    s.arrow([500, 800], [1400, 800], { label: 'asks', labelOffset: 0, at: 0.5 });`,
    // From an icon down to a box: the arrow leaves below the icon's label.
    icon: `s.icon('syringe', { id: 'shot', x: 960, y: 300, size: 140, label: 'Vaccine', labelSize: 44, at: 0 });
    s.box('Virus piece', { id: 'piece', x: 960, y: 800, at: 0 });
    s.arrow('shot', 'piece', { at: 0.5 });`,
  });
  const { issues, more } = await check(p, (page) => page.evaluate(async () => {
    // Where that arrow starts, drawn on its own.
    const { Engine, fetchState } = await import('/engine/runtime.js');
    const state = await fetchState();
    let arrow = null;
    let label = null;
    const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { ...Object.fromEntries(state.timeline.scenes.map((s) => [s.id, () => {}])), icon(s) {
      s.icon('syringe', { id: 'shot', x: 960, y: 300, size: 140, label: 'Vaccine', labelSize: 44, at: 0 });
      s.box('Virus piece', { id: 'piece', x: 960, y: 800, at: 0 });
      arrow = s.arrow('shot', 'piece', { at: 0.5 });
      label = s.get('shot');
    } }, icons: await (await fetch('/engine/icons/lucide.json')).json().then((j) => j.icons), images: new Map() });
    engine.drawScene(engine.ctx, 3, 2);
    return { arrow, icon: label };
  }));
  assert.deepEqual(messages(issues, 'circled', 'crosses'), ['the circle around "body" crosses the text "Your body"; mark a box that holds both, like s.annotate({ x, y, w, h }), or move the text']);
  assert.equal(issues.find((i) => i.scene === 'circled').level, 'warn');
  assert.deepEqual(messages(issues, 'marked', 'crosses'), []);
  assert.deepEqual(messages(issues, 'across', 'crosses'), ['the arrow from 500,540 to 1400,540 crosses the text "in the way"; move the text, or let the arrow start or end somewhere else']);
  assert.deepEqual(messages(issues, 'icon', 'crosses'), []);
  // s.get still gives the icon alone, and the arrow starts below its label:
  // 300 + 70 for the icon, 44 * 1.5 for the space above the label and the
  // label, and the gap of 14.
  assert.equal(more.icon.h, 140);
  assert.equal(more.arrow.from.x, 960);
  assert.ok(Math.abs(more.arrow.from.y - (300 + 70 + 44 * 1.5 + 14)) < 1, JSON.stringify(more.arrow));
});

test('check gives a hint when a scene shows only its background for more than 1.5 seconds at the start', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    late: `s.bg('#203040'); s.title('At last', { at: 2.2, color: '#ffffff' });`,
    soon: `s.title('Soon', { at: 1.25 });`,
    carried: `s.title('Already here', { at: -1 }); s.text('later', { y: 800, at: 2.5 });`,
    app: `s.ui.backdrop(); s.ui.floaters(); s.ui.progress(400, 540, 1100, s.p(0.5, 2));`,
  }, { dur: 4 }));
  assert.deepEqual(issues.filter((i) => i.message.includes('only its background')).map((i) => [i.level, i.scene, i.t, i.message]), [
    ['hint', 'late', 0, 'the scene shows only its background for the first 2.2s; put something on screen sooner, for example give the first element an earlier at'],
  ]);
});

test('check measures text and starred words against their sticker or box, and stickers pick a readable highlight', { skip }, async (t) => {
  const { issues, more } = await check(project(t, {}, {
    green: `s.short.sticker('Cannot make you *sick*', { color: 'green', at: 0 });`,
    red: `s.short.sticker('Cannot make you *sick*', { color: 'green', keyColor: '#c8102e', y: 300, at: 0 });`,
    box: `s.box('Saves *time*', { x: 960, y: 540, fill: '#1f2937', textColor: '#ffffff', mark: '#3b4252', at: 0 });`,
  }), (page) => page.evaluate(async () => {
    const { stickerKey } = await import('/engine/short.js');
    return { green: stickerKey('green'), yellow: stickerKey('#ffd43b'), white: stickerKey('#ffffff') };
  }));
  assert.deepEqual(issues.filter((i) => i.scene === 'green'), []);
  const red = messages(issues, 'red', 'low contrast');
  assert.equal(red.length, 1, JSON.stringify(issues));
  assert.match(red[0], /^"sick" has low contrast against its background \(1\.1:1\); use keyColor: '#[0-9a-f]{6}' \(\d\.\d:1\)$/);
  const box = messages(issues, 'box', 'low contrast');
  assert.equal(box.length, 1, JSON.stringify(issues));
  assert.match(box[0], /^the \*starred\* words in "Saves time" have low contrast against its background \(1\.\d:1\); use mark: '.+' \(\d\.\d:1\)$/);
  // The default highlight reaches 4.5:1 on the sticker's own color, and stays
  // red where red already does.
  assert.ok(contrast(more.green, '#008000') >= 4.5, more.green);
  assert.ok(contrast(more.yellow, '#ffd43b') >= 4.5, more.yellow);
  assert.equal(more.white, '#c8102e');
});

test('check judges text at the size the camera shows it', { skip }, async (t) => {
  const scenes = {
    // Small text alone: the camera moves close, so it is shown big enough.
    alone: `s.text('fine print', { size: 18, at: 0 });`,
    // A scene that zooms out itself makes text smaller than written.
    away: `s.camera([{ at: 1, zoom: 0.5, dur: 0.2 }]); s.text('readable at first', { size: 30, at: 0 });`,
  };
  const filmed = await check(project(t, { camera: 'auto' }, scenes, { dur: 4 }));
  assert.deepEqual(messages(filmed, 'alone', 'hard to read'), []);
  assert.deepEqual(filmed.filter((i) => i.message.includes('hard to read')).map((i) => [i.scene, i.t, i.message]), [['away', 1.25, '"readable at first" is 15px, hard to read (use at least 24px)']]);
  // Without the camera the layout is what shows.
  const still = await check(project(t, { camera: 'still' }, scenes, { dur: 4 }));
  assert.deepEqual(messages(still, 'alone', 'hard to read'), ['"fine print" is 18px, hard to read (use at least 24px)']);
});

test('check warns about text and shapes a held shot cuts at the edge, not about those fully out of it or cut during a move', { skip }, async (t) => {
  // The camera measures the card where it is at the end of the scene, but it
  // slides there from the middle, while the first shot holds.
  const { issues, more } = await check(project(t, { camera: 'auto' }, {
    slides: `s.text('Title', { x: 300, y: 450, size: 60, at: 0 });
    s.box('Sliding card', { x: Math.max(300, 960 - s.t * 300), y: 620, w: 300, h: 120, at: 0, enter: 'none' });`,
    calm: `s.text('Title', { x: 400, y: 300, size: 80, at: 0 });
    s.box('Card', { x: 400, y: 700, w: 400, h: 160, at: 0 });
    s.box('Far card', { x: 1500, y: 700, w: 400, h: 160, at: 3 });`,
  }, { dur: 5 }), (page) => page.evaluate(() => window.explainroo.cameras()));
  const cut = issues.filter((i) => i.message.startsWith('the camera cuts off'));
  assert.ok(cut.length >= 1 && cut.every((i) => i.scene === 'slides'), JSON.stringify(issues));
  assert.match(cut[0].message, /^the camera cuts off (the box )?"Sliding card" at the edge of the frame while it holds still; keep this scene still with s\.camera\(\[\]\), or point the camera with s\.focus$/);
  assert.ok(more.slides, 'the camera films the scene');
});
