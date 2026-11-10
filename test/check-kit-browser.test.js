// What check says about the watermark, the short-video kit, drawings over a
// hook title, the order of s.camera, markup shown as written, and clips that
// play. Real pages, with timelines made by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// A project whose scenes are { id: body }, each `dur` seconds long. `make`
// gets the folder first, for assets.
async function project(t, settings, scenes, { dur = 3, make = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-kit-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (make) await make(dir);
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

test('check warns about text and pictures under the watermark, also where the scene camera zooms them there', { skip }, async (t) => {
  const scenes = {
    // The watermark sits in the bottom right corner of a wide frame.
    corner: `s.text('Under it', { x: 1790, y: 1026, size: 30, at: 0 });
    s.icon('star', { x: 1700, y: 1020, size: 80, at: 0 });
    s.text('Clear of it', { x: 960, y: 540, at: 0 });`,
  };
  const wide = await check(await project(t, {}, scenes));
  assert.equal(messages(wide, 'corner', '"Under it" is under the "explainroo.com" watermark').length, 1, JSON.stringify(wide, null, 2));
  assert.equal(messages(wide, 'corner', 'the icon "star" is under the "explainroo.com" watermark').length, 1);
  assert.deepEqual(messages(wide, 'corner', 'Clear of it'), []);
  assert.deepEqual(messages(await check(await project(t, { watermark: false }, scenes)), 'corner', 'watermark'), []);

  // On Shorts the watermark sits at the top right of the content area. A
  // zoom of the scene's own camera pushes a hook title and an icon into it.
  const tall = await check(await project(t, { size: 'shorts', defaults: '0.6' }, {
    punch: `s.camera([{ at: 1, zoom: 1.3, dur: 0.2 }]);
    s.short.hook('Bees make honey together', { at: -1 });
    s.icon('star', { x: s.safe.right - 195, y: s.safe.top + 110, size: 60, at: -1 });`,
    still: `s.short.hook('Bees make honey together', { at: -1 });
    s.icon('star', { x: s.safe.right - 195, y: s.safe.top + 110, size: 60, at: -1 });`,
  }));
  const punched = messages(tall, 'punch', 'watermark');
  assert.ok(punched.some((m) => m.includes('the icon "star" is under the "explainroo.com" watermark') && m.includes("The camera's zoom of 1.3x pushes it there")), JSON.stringify(tall, null, 2));
  assert.ok(messages(tall, 'punch', "zoom of 1.3x pushes it there").some((m) => /^"(BEES|MAKE|HONEY|TOGETHER)"/.test(m)), JSON.stringify(tall, null, 2));
  assert.deepEqual(messages(tall, 'still', 'watermark'), []);

  // A card or a sticker with its corner under the watermark counts, however
  // large it is. A large picture may run behind it.
  const panels = await check(await project(t, { size: 'reels', defaults: '0.6' }, {
    card: `s.short.payoff({ title: 'Brewly', lines: ['Fresh beans every 2 weeks', 'First box half price'], w: s.safe.w, y: s.safe.top + 260, at: -1 });`,
    sticker: `s.short.sticker('Order *today*', { x: s.safe.right - 190, y: s.safe.top - 20, rotate: 0, at: -1 });`,
    picture: `s.icon('coffee', { x: s.cx, y: s.safe.top + 380, size: 900, at: -1 });`,
  }));
  assert.equal(messages(panels, 'card', 'the card "Brewly" is under the "explainroo.com" watermark').length, 1, JSON.stringify(panels, null, 2));
  assert.equal(messages(panels, 'sticker', 'the sticker "Order today" is under the "explainroo.com" watermark').length, 1, JSON.stringify(panels, null, 2));
  assert.deepEqual(messages(panels, 'picture', 'watermark'), []);
});

// The box a sticker returns, with "defaults": "0.6", is the box around it
// tilted, and `top` places the top of that box. So a sticker placed right
// below a card's box doesn't overlap the card.
test('a sticker placed with top right below a card keeps clear of it, and returns its tilted box', { skip }, async (t) => {
  const body = `const card = s.short.payoff({ title: 'Brewly', lines: ['Fresh beans every 2 weeks', 'First box half price'], y: s.safe.top + 320, at: -1 });
    const st = s.short.sticker('Order *today*', { top: card.bottom + 12, at: -1 });
    const right = s._v6 ? st.h > 84 + 20 && Math.abs(st.top - card.bottom - 12) < 0.01 : st.h === 84 && st.top > card.bottom + 12;
    if (!right) throw new Error('the sticker returned ' + JSON.stringify(st));`;
  for (const defaults of ['0.6', undefined]) {
    const issues = await check(await project(t, { size: 'reels', defaults }, { below: body }));
    const bad = issues.filter((i) => i.level === 'error' || /overlap|covers/.test(i.message));
    assert.deepEqual(bad, [], `${defaults}: ${JSON.stringify(bad, null, 2)}`);
  }
});

test('a drawing with a box counts as a shape over a hook title, also after the scene used the short-video kit', { skip }, async (t) => {
  const issues = await check(await project(t, { size: 'shorts', defaults: '0.6' }, {
    over: `const box = s.short.hook('Bees make honey', { at: -1 });
    s.draw({ x: s.cx - 150, y: box.top + 40, at: -1, box: { x: 0, y: 0, w: 160, h: 120 } }, (ctx) => { ctx.fillStyle = '#ffc107'; ctx.fillRect(-80, -60, 160, 120); });`,
    clear: `const box = s.short.hook('Bees make honey', { at: -1 });
    s.draw({ x: s.cx, y: box.bottom + 200, at: -1, box: { x: 0, y: 0, w: 160, h: 120 } }, (ctx) => { ctx.fillStyle = '#ffc107'; ctx.fillRect(-80, -60, 160, 120); });`,
  }));
  assert.equal(messages(issues, 'over', 'the 1st s.draw at').length, 1, JSON.stringify(issues, null, 2));
  assert.match(messages(issues, 'over', 'the 1st s.draw at')[0], /^"(BEES|MAKE|HONEY)" and the 1st s\.draw at \d+,\d+ partly overlap/);
  assert.deepEqual(messages(issues, 'clear', 's.draw'), []);
});

test('check gives a hint when s.camera comes after other elements of a scene', { skip }, async (t) => {
  const issues = await check(await project(t, {}, {
    after: `s.text('Before the camera', { at: 0 });
    s.camera([{ at: 1, zoom: 1.2 }]);`,
    first: `s.camera([{ at: 1, zoom: 1.2 }]);
    s.text('After the camera', { at: 0 });`,
    still: `s.text('Before a still camera', { at: 0 });
    s.camera([]);`,
  }));
  assert.equal(messages(issues, 'after', 's.camera comes after other elements').length, 1, JSON.stringify(issues, null, 2));
  assert.equal(issues.find((i) => i.scene === 'after' && i.message.startsWith('s.camera')).level, 'hint');
  assert.deepEqual(messages(issues, 'first', 's.camera'), []);
  assert.deepEqual(messages(issues, 'still', 's.camera'), []);
});

test('s.ui text takes \\n and *stars* with "defaults": "0.6", and check warns about markup shown as written', { skip }, async (t) => {
  const scenes = {
    headline: `s.ui.headline('Catch type errors\\n*as you type*', s.W / 2, 300, { size: 76, at: -1, italic: false });`,
    texts: `s.ui.text('Saved *in a second*', 960, 500, { size: 40, align: 'center' });
    s.ui.para('One *long run of words that wraps* over lines', 700, 600, 300, { size: 30 });
    s.ui.text('Two\\nlines', 960, 900, { size: 40, align: 'center' });`,
    literal: `s.text('One line\\\\n and more', { y: 400, at: 0 });`,
  };
  const fresh = await check(await project(t, { defaults: '0.6' }, scenes), (page) => page.evaluate(() => {
    const e = window.explainroo;
    return [0, 1].map((i) => e.textsAt(i, 2.5).map((x) => ({ text: x.text, y: Math.round(x.y0) })));
  }));
  const [headline, texts] = fresh.more;
  // Two lines: the second one lower, without its stars.
  const lines = [...new Set(headline.map((x) => x.y))];
  assert.equal(lines.length, 2, JSON.stringify(headline));
  assert.deepEqual(headline.filter((x) => x.y === Math.max(...lines)).map((x) => x.text), ['as', 'you', 'type']);
  assert.ok(texts.every((x) => !x.text.includes('*')), JSON.stringify(texts));
  assert.deepEqual(texts.filter((x) => x.text === 'Two' || x.text === 'lines').length, 2, JSON.stringify(texts));
  assert.deepEqual(fresh.issues.filter((i) => /as they are written|backslash|draws as a space/.test(i.message) && i.scene !== 'literal'), []);
  assert.equal(messages(fresh.issues, 'literal', 'shows a backslash and an n').length, 1, JSON.stringify(fresh.issues, null, 2));

  // Without the 0.6 defaults, s.ui draws its text as written, and check says so.
  const old = await check(await project(t, {}, scenes));
  assert.equal(messages(old, 'texts', 'shows the stars of "*in a second*" as they are written').length, 1, JSON.stringify(old, null, 2));
  assert.ok(messages(old, 'headline', 'draws as a space').length >= 1, JSON.stringify(old, null, 2));
});

test('a clip that plays and changes is something happening, and a still one is not', { skip }, async (t) => {
  const make = async (dir) => {
    fs.mkdirSync(path.join(dir, 'assets'));
    // A square that moves the whole time, one that moves for a second and
    // then stays, and a still picture.
    const clip = (name, x) => ffmpeg(['-loglevel', 'error', '-filter_complex', `color=white:s=320x180:r=30:d=10[bg];color=black:s=40x40:r=30:d=10[box];[bg][box]overlay=x='${x}':y=60,format=yuv420p`, '-c:v', 'libx264', '-threads', '1', path.join(dir, `assets/${name}.mp4`)]);
    await clip('moving', 'mod(t*60,280)');
    await clip('settles', 'min(t,3)*60');
    await clip('still', '100');
  };
  const issues = await check(await project(t, {}, {
    moving: `s.clip('assets/moving.mp4', { w: 1200, at: -1 });`,
    settles: `s.clip('assets/settles.mp4', { w: 1200, at: -1 });`,
    still: `s.clip('assets/still.mp4', { w: 1200, at: -1 });`,
  }, { dur: 10, make }));
  assert.deepEqual(issues.filter((i) => i.scene === 'moving' && /nothing enters|no new element/.test(i.message)), [], JSON.stringify(issues, null, 2));
  assert.deepEqual(messages(issues, 'settles', 'nothing enters'), []);
  const quiet = messages(issues, 'settles', 'no new element');
  assert.equal(quiet.length, 1, JSON.stringify(issues, null, 2));
  assert.match(quiet[0], /^no new element for 8\.\ds \(from [12]\.\ds\)/);
  assert.deepEqual(messages(issues, 'still', 'no new element'), ['no new element for 10.0s (from 0.0s); consider revealing something on a cue in that stretch']);
});
