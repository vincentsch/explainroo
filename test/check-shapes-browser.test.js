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
import { getTheme } from '../engine/themes.js';

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
  assert.deepEqual(messages(issues, 'app', 'overlap'), ['the 1st s.ui.panel at 550,450 and the 2nd s.ui.panel at 1150,500 partly overlap, by 50px; move them apart, or give one of them overlap: true if that is meant']);
});

test('check warns about the line of an arrow or a mark that crosses text, and with "defaults": "0.5" arrows leave an icon outside its label', { skip }, async (t) => {
  const p = project(t, { theme: 'paper', defaults: '0.5' }, {
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
    // A circle around a part of the frame, by its call and where it is.
    around: `s.text('beside it', { x: 900, y: 540, size: 48, at: 0 });
    s.annotate({ x: 700, y: 540, w: 300, h: 100 }, { type: 'circle', at: 0.5 });`,
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
  assert.deepEqual(messages(issues, 'across', 'crosses'), ['the 1st s.arrow from 500,540 to 1400,540 crosses the text "in the way"; move the text, or let the arrow start or end somewhere else']);
  assert.deepEqual(messages(issues, 'icon', 'crosses'), []);
  assert.deepEqual(messages(issues, 'around', 'crosses'), ['the 1st s.annotate (a circle) around 700,540 crosses the text "beside it"; mark a box that holds both, like s.annotate({ x, y, w, h }), or move the text']);
  // s.get still gives the icon alone, and the arrow starts below its label:
  // 300 + 70 for the icon, 44 * 1.5 for the space above the label and the
  // label, and the gap of 14.
  assert.equal(more.icon.h, 140);
  assert.equal(more.arrow.from.x, 960);
  assert.ok(Math.abs(more.arrow.from.y - (300 + 70 + 44 * 1.5 + 14)) < 1, JSON.stringify(more.arrow));
  // Without the line the arrow starts at the icon's edge, as before, and runs through its label.
  const before = project(t, { theme: 'paper' }, { icon: `s.icon('syringe', { id: 'shot', x: 960, y: 300, size: 140, label: 'Vaccine', labelSize: 44, at: 0 });
    s.box('Virus piece', { id: 'piece', x: 960, y: 800, at: 0 });
    s.arrow('shot', 'piece', { at: 0.5 });` });
  assert.deepEqual(messages(await check(before), 'icon', 'crosses'), ['the arrow from "shot" to "piece" crosses the text "Vaccine"; move the text, or let the arrow start or end somewhere else']);
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

test('check measures text and starred words against their sticker or box, and with "defaults": "0.5" stickers pick a readable highlight', { skip }, async (t) => {
  // Without the line the keyword stays red on any sticker, as before, and check says so.
  const before = await check(project(t, {}, { green: `s.short.sticker('Cannot make you *sick*', { color: 'green', at: 0 });` }));
  assert.match(messages(before, 'green', 'low contrast')[0], /^"sick" has low contrast against its background \(1\.1:1\); use keyColor: /);
  const { issues, more } = await check(project(t, { defaults: '0.5' }, {
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
  assert.match(red[0], /^"sick" has low contrast against its background \(1\.1:1\); use keyColor: '#[0-9a-f]{6}' \(\d\.\d:1\), a (darker|lighter) shade of the same color(, or keyColor: 'ink' \(\d+\.\d:1\))?$/);
  const box = messages(issues, 'box', 'low contrast');
  assert.equal(box.length, 1, JSON.stringify(issues));
  assert.match(box[0], /^the \*starred\* words in "Saves time" have low contrast against its background \(1\.\d:1\); use mark: '#[0-9a-f]{6}' \(\d+\.\d:1\), a lighter shade of the same color$/);
  // The default highlight reaches 4.5:1 on the sticker's own color, and stays
  // red where red already does.
  assert.ok(contrast(more.green, '#008000') >= 4.5, more.green);
  assert.ok(contrast(more.yellow, '#ffd43b') >= 4.5, more.yellow);
  assert.equal(more.white, '#c8102e');
});

// Every part of the short-video kit that draws text, with no colors given, on
// the look's background and on the kit's backdrop.
const KIT = {
  slab: `s.short.hook('Your bread is *stale* again?', { kicker: 'Kitchen tip', kickerIcon: 'lightbulb' });`,
  stroke: `s.short.hook('Your bread is *stale* again?', { style: 'stroke' });`,
  plain: `s.short.hook('How *noise-cancelling* headphones work', { style: 'plain' });`,
  kicker: `s.short.kicker('Quick tip', { icon: 'lightbulb' });`,
  sticker: `s.short.sticker('*2* days');`,
  step: `s.short.step(1, 2, { label: 'Paper bag' }); s.short.progress();`,
  ...Object.fromEntries(['good', 'bad', 'info', 'dark'].map((tone) => [`payoff${tone[0].toUpperCase()}${tone.slice(1)}`, `s.short.payoff({ tone: '${tone}', title: 'Fresh for weeks', lines: ['Paper bag for two days', 'Freezer for longer'] });`])),
};
const KIT_SCENES = { ...KIT, ...Object.fromEntries(Object.entries(KIT).map(([id, body]) => [`${id}OnBackdrop`, `s.short.backdrop(); ${body}`])) };
const LOOKS = ['paper', 'clean', 'chalk', 'blueprint', 'midnight', 'editorial', 'studio'];

for (const theme of LOOKS) {
  test(`with "defaults": "0.5", every part of s.short reads in the ${theme} look with its own colors, so check gives no contrast warning`, { skip }, async (t) => {
    const issues = await check(project(t, { theme, size: 'tiktok', defaults: '0.5' }, KIT_SCENES, { dur: 1.5 }));
    assert.deepEqual(issues.filter((i) => i.message.includes('contrast')).map((i) => `${i.scene}: ${i.message}`), []);
  });
}

test('without "defaults" a plain hook keeps its yellow keywords, and check measures it against the backdrop behind it', { skip }, async (t) => {
  const { issues, more } = await check(project(t, { theme: 'clean', size: 'tiktok' }, { plain: KIT.plain, plainOnBackdrop: KIT_SCENES.plainOnBackdrop }, { dur: 1.5 }), (page) => page.evaluate(async (looks) => {
    const { plainColors } = await import('/engine/short.js');
    const { getTheme } = await import('/engine/themes.js');
    return Object.fromEntries(looks.map((name) => [name, { own: plainColors(getTheme(name), getTheme(name).bg, 104), dark: plainColors(getTheme(name), '#0d1222', 104), small: plainColors(getTheme(name), getTheme(name).bg, 40) }]));
  }, LOOKS));
  assert.deepEqual(messages(issues, 'plain', 'contrast'), [`"NOISE-CANCELLING" has low contrast against its background (1.3:1); use keyColor: '#b08900' (3.0:1), a darker shade of the same color, or keyColor: 'ink' (16.4:1)`]);
  assert.match(messages(issues, 'plainOnBackdrop', 'contrast')[0] ?? '', /^"HOW" has low contrast against its background \(1\.\d:1\); use color: /);
  // On a light look the keywords take the look's accent, darker where it needs
  // to be, and on a dark one, or on the backdrop, they stay yellow.
  for (const name of LOOKS) {
    const { own, dark, small } = more[name];
    const look = getTheme(name);
    assert.equal(own.ink, look.ink, name);
    assert.equal(own.key, look.dark ? '#ffd43b' : look.colors[look.accent], name);
    assert.ok(contrast(small.key, look.bg) >= 4.5, `${name}: ${small.key}`);
    assert.equal(dark.key, '#ffd43b', name);
    assert.equal(dark.ink, look.dark ? look.ink : '#ffffff', name);
  }
});

test('check judges text at the size the camera shows it, and with "defaults": "0.5" arrow labels are body size', { skip }, async (t) => {
  const scenes = {
    // Small text alone: the camera moves close, so it is shown big enough.
    alone: `s.text('fine print', { size: 18, at: 0 });`,
    // A scene that zooms out itself makes text smaller than written.
    away: `s.camera([{ at: 1, zoom: 0.5, dur: 0.2 }]); s.text('readable at first', { size: 30, at: 0 });`,
    label: `s.arrow([600, 540], [1300, 540], { label: 'water vapor', at: 0 });`,
  };
  const filmed = await check(project(t, { camera: 'auto' }, scenes, { dur: 4 }));
  assert.deepEqual(messages(filmed, 'alone', 'hard to read'), []);
  assert.deepEqual(filmed.filter((i) => i.message.includes('hard to read')).map((i) => [i.scene, i.t, i.message]), [['away', 1.25, '"readable at first" is 15px, hard to read (use at least 24px)']]);
  // Without the camera the layout is what shows.
  const still = await check(project(t, { camera: 'still' }, scenes, { dur: 4 }));
  assert.deepEqual(messages(still, 'alone', 'hard to read'), ['"fine print" is 18px, hard to read (use at least 24px)']);
  // At 48 pixels the label stays above 16 pixels in an 854 pixel player.
  const { more: size } = await check(project(t, { defaults: '0.5' }, { label: scenes.label }), (page) => page.evaluate(() => window.explainroo.check(0.5, 854)));
  assert.deepEqual(size, []);
  // Without the line it is 34 pixels, as before.
  const { more: old } = await check(project(t, {}, { label: scenes.label }), (page) => page.evaluate(() => window.explainroo.check(0.5, 854)));
  assert.deepEqual(old.map((i) => i.message.split(';')[0]), ['"water vapor" is 15.1px at a 854px player width']);
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

test('with "defaults": "0.5", gap leaves that many pixels free at a point end, as at an element; without it a point end stays where it was', { skip }, async (t) => {
  const ends = async (settings) => (await check(project(t, settings, { gap: `s.arrow([300, 540], [900, 540], { gap: 40, at: 0 });` }), (page) => page.evaluate(async () => {
    const { Engine, fetchState } = await import('/engine/runtime.js');
    const state = await fetchState();
    let arrows = null;
    const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes: { gap(s) {
      arrows = [s.arrow([300, 540], [900, 540], { gap: 40, at: 0 }), s.arrow([300, 700], [900, 700], { at: 0 }), s.arrow([300, 800], [320, 800], { gap: 40, at: 0 })];
    } }, icons: {}, images: new Map() });
    engine.drawScene(engine.ctx, 0, 1);
    return arrows.map((a) => [a.from.x, a.to.x]);
  }))).more;
  // 40 pixels at each point end; no gap at a point without one; an arrow too short for its gaps keeps its ends.
  assert.deepEqual(await ends({ defaults: '0.5' }), [[340, 860], [300, 900], [300, 320]]);
  assert.deepEqual(await ends({}), [[300, 900], [300, 900], [300, 320]]);
});

test('check gives a hint when a scene shows only its background for more than 1.5 seconds later in the scene, also until it ends', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    // A leaves at 1.5 and has faded by about 1.95, and B comes at 3.6.
    gap: `s.title('A', { at: 0, out: 1.5 }); s.title('B', { at: 3.6 });`,
    // 1.25 seconds is short enough.
    short: `s.title('A', { at: 0, out: 1.5 }); s.title('B', { at: 3.2 });`,
    // Everything has gone by about 3.45, and the scene ends at 6.
    tail: `s.title('A', { at: 0, out: 3 });`,
    // Something stays the whole time, so there is no gap.
    kept: `s.title('A', { at: 0, out: 1.5 }); s.text('stays', { y: 800, at: 0 }); s.title('B', { at: 4 });`,
  }, { dur: 6 }));
  const empty = issues.filter((i) => i.message.includes('only its background'));
  assert.deepEqual(empty.map((i) => i.scene), ['gap', 'tail'], JSON.stringify(empty));
  const [gap, tail] = empty;
  assert.equal(gap.level, 'hint');
  assert.match(gap.message, /^the scene shows only its background for 1\.[67]s, from (1\.9|2\.0)s to 3\.6s; put something on screen in that stretch, or let what was there stay longer with a later out$/);
  assert.ok(Math.abs(gap.t - 1.93) < 0.1, String(gap.t));
  assert.match(tail.message, /^the scene shows only its background for 2\.[56]s, from 3\.[45]s until the scene ends; /);
});

test('check suggests a darker shade of the same color for orange text on paper, and ink second', { skip }, async (t) => {
  const issues = await check(project(t, { theme: 'paper' }, { sun: `s.text('Sun time', { color: 'orange', size: 40, at: 0 });` }));
  const [warning] = messages(issues, 'sun', 'low contrast');
  const match = /^"Sun time" has low contrast against its background \((\d\.\d):1\); use color: '(#[0-9a-f]{6})' \((\d\.\d):1\), a darker shade of the same color, or color: 'ink' \((\d+\.\d):1\)$/.exec(warning);
  assert.ok(match, warning);
  assert.ok(Number(match[3]) >= 4.5);
});

test('s.draw with box is a shape for check: overlaps, text over its edge and the frame edge, and without box nothing changes', { skip }, async (t) => {
  const moon = (box) => `s.draw({ id: 'moon', x: 600, y: 540, ${box}at: 0 }, (ctx) => { ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.fill(); });`;
  const issues = await check(project(t, {}, {
    boxed: `${moon("box: { x: 0, y: 0, w: 300, h: 300 }, ")} s.box('Earth', { x: 800, y: 540, w: 260, h: 160, at: 0 }); s.text('Luna nueva', { x: 600, y: 700, at: 0 });`,
    plain: `${moon('')} s.box('Earth', { x: 800, y: 540, w: 260, h: 160, at: 0 }); s.text('Luna nueva', { x: 600, y: 700, at: 0 });`,
    edge: `s.draw({ x: 1880, y: 540, box: { x: 0, y: 0, w: 200, h: 200 }, at: 0 }, (ctx) => ctx.fillRect(-100, -100, 200, 200));
    s.draw({ x: 960, y: 40, box: { x: 0, y: 0, w: 100, h: 60, round: true }, at: 0 }, (ctx) => ctx.fillRect(-50, -30, 100, 60));`,
    inside: `${moon("box: { x: 0, y: 0, w: 300, h: 300 }, ")} s.text('Moon', { x: 600, y: 540, at: 0 });`,
  }));
  // The box runs 80 pixels into the drawing, and so its own text, and a label crosses its lower edge.
  assert.deepEqual(messages(issues, 'boxed', 'partly overlap').sort(), [
    '"Earth" and the drawing "moon" partly overlap, by 6px; move them apart, or give one of them overlap: true if that is meant',
    '"Luna nueva" and the drawing "moon" partly overlap, by 13px; move them apart, or give one of them overlap: true if that is meant',
    'the drawing "moon" and the box "Earth" partly overlap, by 80px; move them apart, or give one of them overlap: true if that is meant',
  ]);
  assert.deepEqual(issues.filter((i) => i.scene === 'plain'), []);
  assert.deepEqual(issues.filter((i) => i.scene === 'inside'), []);
  // Without an id, a drawing is named by its call, the 2nd s.draw of the scene,
  // and where it is.
  assert.deepEqual(messages(issues, 'edge', 's.draw'), [
    'the 1st s.draw at 1880,540 runs off the frame (1780,440 to 1980,640 in a 1920x1080 frame)',
    'the 2nd s.draw at 960,40 comes closer than 38px to the edge (910,10 to 1010,70)',
  ]);
  // A box that isn't one is an error that says what it takes.
  const bad = await check(project(t, {}, { bad: `s.draw({ box: { w: 100 }, at: 0 }, () => {});` }));
  assert.match(bad.find((i) => i.scene === 'bad').message, /^s\.draw box must be \{ x, y, w, h \}: the center and the size of what it draws/);
});

test('s.draw with box counts in the content area of a platform size and in the caption band', { skip }, async (t) => {
  const issues = await check(project(t, { size: 'tiktok' }, {
    low: `s.draw({ x: 540, y: 1700, box: { x: 0, y: 0, w: 300, h: 200 }, at: 0 }, (ctx) => ctx.fillRect(-150, -100, 300, 200));`,
  }));
  assert.match(messages(issues, 'low', 's.draw')[0], /^the 1st s\.draw at 540,1700 reaches outside the tiktok content area \(119,304 to 864,1267, 745x963\), where the app's buttons and post text can cover it$/);
  const band = await check(project(t, { captions: true }, {
    low: `s.draw({ x: 960, y: 900, box: { x: 0, y: 0, w: 300, h: 160 }, at: 0 }, (ctx) => ctx.fillRect(-150, -80, 300, 160));`,
  }));
  assert.match(messages(band, 'low', 's.draw')[0], /^the 1st s\.draw at 960,900 runs into the caption band \(y \d+ to \d+\), where captions can cover it; keep it above s\.safe\.bottom \(\d+\)$/);
});

test('on TikTok check measures text and every shape against one content area, s.safe, which ends above the caption band', { skip }, async (t) => {
  // A TikTok package: bold captions and no watermark. The content area is
  // 119,240 to 864,1103 and the caption band runs from y 1127 to 1243.
  const scenes = {
    band: `s.icon('plane', { x: 492, y: 1185, size: 100, at: 0 }); s.box({ id: 'panel', x: 492, y: 1150, w: 300, h: 100, at: 0 });`,
    side: `s.icon('plane', { x: 930, y: 700, size: 100, at: 0 }); s.text('Right side', { x: 920, y: 800, size: 40, at: 0 });`,
    gap: `s.text('Close to the captions', { x: 492, y: 1112, size: 24, at: 0 });`,
    inside: `s.icon('plane', { x: s.cx, y: s.safe.bottom - 60, size: 100, at: 0 }); s.box('Fits', { x: s.cx, y: s.safe.top + 80, at: 0 });`,
    full: `s.box({ x: s.W / 2, y: s.H / 2, w: s.W, h: s.H, at: 0 }); s.text('On top', { x: s.cx, y: s.cy, size: 60, at: 0 });`,
    top: `s.text('Top row', { x: 300, y: 270, size: 40, at: 0 });`,
  };
  const issues = await check(project(t, { size: 'tiktok', captions: 'bold', watermark: false }, scenes));
  const area = (scene) => issues.filter((i) => i.scene === scene && /content area|caption band/.test(i.message)).map((i) => i.message);
  assert.deepEqual(area('band'), [
    'the icon "plane" runs into the caption band (y 1127 to 1243), where captions can cover it; keep it above s.safe.bottom (1103)',
    'the box "panel" runs into the caption band (y 1127 to 1243), where captions can cover it; keep it above s.safe.bottom (1103)',
  ]);
  assert.deepEqual(area('side'), [
    '"Right side" is outside the tiktok content area (119,240 to 864,1103, 745x863), where the app\'s buttons and post text can cover it',
    'the icon "plane" reaches outside the tiktok content area (119,240 to 864,1103, 745x863), where the app\'s buttons and post text can cover it',
  ]);
  assert.deepEqual(area('gap'), ['"Close to the captions" is outside the tiktok content area (119,240 to 864,1103, 745x863), right next to the captions']);
  assert.deepEqual(area('inside'), []);
  // A shape that fills the frame is a background, and the top row has no watermark here.
  assert.deepEqual(area('full'), []);
  assert.deepEqual(area('top'), []);
  // With the watermark, the content area starts below the strip it takes.
  const marked = await check(project(t, { size: 'tiktok', captions: 'bold' }, { top: scenes.top }));
  assert.deepEqual(marked.filter((i) => i.message.includes('content area')).map((i) => i.message), ['"Top row" is outside the tiktok content area (119,304 to 864,1103, 745x799), in the strip at the top that the watermark takes']);
  // On a size without an app, shapes count only in the caption band, not at the edge.
  const wide = await check(project(t, { captions: true }, {
    low: `s.icon('plane', { x: 960, y: 920, size: 100, at: 0 }); s.box({ x: 60, y: 300, w: 200, h: 100, at: 0 });`,
  }));
  assert.deepEqual(wide.filter((i) => /caption band|edge/.test(i.message)).map((i) => i.message.replace(/\d+/g, 'N')), ['the icon "plane" runs into the caption band (y N to N), where captions can cover it; keep it above s.safe.bottom (N)']);
});

test('an icon with a label returns the label\'s box and an outer box with both, and bottom stays the icon\'s own', { skip }, async (t) => {
  const { issues, more } = await check(project(t, {}, {
    icons: `globalThis.labelled = s.icon('lock', { x: 600, y: 400, size: 120, label: 'Encrypted', at: 0 });
    globalThis.plain = s.icon('lock', { x: 1300, y: 400, size: 120, at: 0 });
    s.text('Under the label', { x: 600, y: globalThis.labelled.outer.bottom + 40, size: 40, at: 0 });
    s.text('Under the icon', { x: 1300, y: globalThis.labelled.bottom + 30, size: 40, at: 0 });`,
  }), (page) => page.evaluate(() => ({ labelled: globalThis.labelled, plain: globalThis.plain })));
  const { labelled, plain } = more;
  assert.equal(labelled.bottom, 460);
  assert.equal(labelled.label.top, 460 + 36 * 0.45);
  assert.equal(labelled.label.bottom, labelled.label.top + 36);
  assert.equal(labelled.label.x, 600);
  assert.ok(labelled.label.w > 100);
  assert.deepEqual([labelled.outer.top, labelled.outer.bottom], [340, labelled.label.bottom]);
  assert.equal(labelled.outer.left, Math.min(540, labelled.label.left));
  assert.equal('label' in plain || 'outer' in plain, false);
  // Text below outer clears the label, as check sees it.
  assert.deepEqual(issues.filter((i) => i.level !== 'hint'), []);
});

test('with "defaults": "0.6" pictures in a tall frame may fill s.full, past the content area, and text keeps to s.safe', { skip }, async (t) => {
  const scenes = {
    // A wave of the whole frame's width below the captions, a box at the
    // bottom of the frame, and a label in the same place.
    picture: `globalThis.full = s.full;
    s.draw({ x: s.full.w / 2, y: s.full.bottom - 300, at: 0, box: { x: 0, y: 0, w: s.full.w, h: 120 } }, (ctx) => { ctx.fillRect(-s.full.w / 2, -60, s.full.w, 120); });
    s.box({ x: s.full.w / 2, y: s.full.bottom - 120, w: 600, h: 160, color: 'blue', at: 0 });`,
    words: `s.text('Below the captions', { x: s.full.w / 2, y: s.full.bottom - 500, at: 0 });`,
    off: `s.draw({ x: s.full.w / 2, y: s.full.bottom, at: 0, box: { x: 0, y: 0, w: 400, h: 200 } }, (ctx) => { ctx.fillRect(-200, -100, 400, 200); });`,
  };
  const outside = (issues, scene) => messages(issues, scene, 'content area').length + messages(issues, scene, 'caption band').length;
  const { issues: now, more: full } = await check(project(t, { size: 'tiktok', captions: 'bold', defaults: '0.6' }, scenes), (page) => page.evaluate(() => globalThis.full));
  assert.deepEqual(full, { x: 0, y: 0, w: 1080, h: 1920, left: 0, top: 0, right: 1080, bottom: 1920 });
  assert.equal(outside(now, 'picture'), 0, JSON.stringify(now));
  assert.ok(outside(now, 'words') > 0, 'text below the content area still gets a warning');
  assert.match(messages(now, 'off', 'runs off the frame')[0] ?? '', /the 1st s\.draw at 540,1920 runs off the frame/);
  const before = await check(project(t, { size: 'tiktok', captions: 'bold', defaults: '0.5' }, scenes));
  assert.ok(outside(before, 'picture') >= 2, 'with "0.5" the pictures get warnings');
});

test('check gives a hint when the first frame shows only the background or elements still coming in, and names one to show from the start', { skip }, async (t) => {
  const first = (scenes) => check(project(t, {}, scenes), (page) => page.evaluate(() => window.explainroo.firstFrameIssue())).then((r) => r.more);
  const empty = await first({
    intro: `s.text('example.com', { y: 300, at: 1 });
    s.icon('laptop', { id: 'a', x: 620, y: 660, size: 170, at: 1.5 });`,
    next: `s.circle({ at: 0, enter: 'none' });`,
  });
  assert.deepEqual(empty, { level: 'hint', scene: 'intro', t: 0, message: 'the first frame of the video shows only the background, and Buffer, LinkedIn and other services use it as the thumbnail; give the icon "laptop" (id "a") at: -1, so it is there from the first frame' });
  const coming = await first({ intro: `s.title('How a cache works', { at: 0 });` });
  assert.equal(coming.message, 'the first frame of the video shows only elements that are still on their way in, and Buffer, LinkedIn and other services use it as the thumbnail; give the text "How a cache works" at: -1, so it is there from the first frame');
  assert.equal(await first({ intro: `s.title('How a cache works', { at: 0, enter: 'none' }); s.icon('laptop', { y: 800, at: 1 });` }), null);
  assert.equal(await first({ intro: `s.title('How a cache works', { at: -1 });` }), null);
});
