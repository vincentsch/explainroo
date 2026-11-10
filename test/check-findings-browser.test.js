// What check finds while the scenes draw: text with a background but no words,
// an arrow's label as text, labelSide, a lift above 2 and the hint about a word
// cue spoken twice. Real pages, with timelines made by hand.
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

// A project whose scenes are { id: body }, each two seconds long unless `dur` says
// otherwise, with `words` spoken in a scene when given.
function project(t, settings, scenes, { words = {}, dur = 2, added = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-findings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.keys(scenes).map((id, index) => {
    const scene = { id, index, start, dur, marks: {}, voice: null, lead: 0, transition: 'none',
      words: (words[id] ?? []).map((text, i) => ({ text, start: 0.2 + i * 0.2, end: 0.35 + i * 0.2 })), ...(added[id] ? { added: added[id] } : {}) };
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

// "LEFT" runs off the frame (x0,y0 to x1,y1 in a 1920x1080 frame): the box's center.
function offFrame(issues, label) {
  const found = issues.filter((i) => i.message.startsWith(`"${label}" runs off the frame`));
  assert.equal(found.length, 1, `one off-frame finding for "${label}": ${JSON.stringify(issues)}`);
  assert.equal(found[0].level, 'error');
  const [x0, y0, x1, y1] = /\((-?\d+),(-?\d+) to (-?\d+),(-?\d+) in a/.exec(found[0].message).slice(1).map(Number);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, y0, x1, y1 };
}

test('check warns once for each text with a background but no words, also in groups, and an overflow stays an error', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    form: `s.text('        ', { id: 'password', bg: 'surface', x: 960, y: 380, at: 0 });
    s.text('', { bg: 'surface', x: 960, y: 560, at: 0.5 });
    s.text('   ', { x: 960, y: 700, at: 0 });
    s.text('Email', { bg: 'surface', x: 500, y: 380, at: 0 });`,
    // The same field at 0,0 in two groups, and one in a group that rises in, so
    // its place in the frame moves between the moments check looks at.
    grouped: `s.group({ x: 600, y: 400 }, () => s.text('   ', { bg: 'surface', x: 0, y: 0 }));
    s.group({ x: 1200, y: 400 }, () => s.text('   ', { bg: 'surface', x: 0, y: 0 }));
    s.group({ x: 900, y: 760, at: 0.25, enter: 'rise', dur: 1.5 }, () => s.text('', { bg: 'surface', x: 0, y: 0, enter: 'slide-left', dur: 1.5 }));`,
    code: `s.code('const answer = computeTheAnswerToEverythingWithAVeryLongName(first, second);', { x: 960, y: 540, w: 420, at: 0 });`,
  }));
  const blank = issues.filter((i) => i.message.includes('has a background but no words'));
  const field = (name) => `${name} has a background but no words, so it draws an empty card; for an empty field, use s.box({ w, h }) or another shape with a size`;
  // Each field is drawn at every moment check looks at, and gives one warning,
  // named by its id, or by its call and where it sits in the frame.
  assert.deepEqual(blank.filter((i) => i.scene === 'form').map((i) => [i.level, i.message]), [
    ['warn', field('the text "password"')],
    ['warn', field('the 2nd s.text at 960,560')],
  ]);
  const grouped = blank.filter((i) => i.scene === 'grouped');
  assert.deepEqual(grouped.slice(0, 2).map((i) => [i.level, i.message]), [['warn', field('the 1st s.text at 600,400')], ['warn', field('the 2nd s.text at 1200,400')]]);
  assert.equal(grouped.length, 3, JSON.stringify(grouped));
  assert.match(grouped[2].message, /^the 3rd s\.text at 900,\d+ has a background but no words/);
  const overflow = issues.filter((i) => i.message.includes('is wider than its window'));
  assert.equal(overflow.length, 1, JSON.stringify(issues));
  assert.equal(overflow[0].level, 'error');
  assert.match(overflow[0].message, /^line 1 of the 1st s\.code \("const answer = computeTheAnswerToEvery/);
});

test('check treats an arrow label as text: overlap, off the frame, caption band and the TikTok content area', { skip }, async (t) => {
  const wide = await check(project(t, { size: '16:9', captions: true, defaults: '0.5' }, {
    overlap: `s.text('Resolver', { x: 960, y: 506, size: 40, at: 0 });
    s.arrow([600, 540], [1320, 540], { label: 'asks', at: 0 });`,
    offframe: `s.arrow([30, 300], [30, 700], { label: 'too far', at: 0 });`,
    band: `s.arrow([760, 950], [1160, 950], { label: 'low', at: 0 });`,
  }));
  const found = (scene, start) => wide.filter((i) => i.scene === scene && i.message.startsWith(start));
  assert.deepEqual(found('overlap', '"Resolver" overlaps').map((i) => [i.level, i.message]), [['error', '"Resolver" overlaps "asks"']]);
  const off = offFrame(wide.filter((i) => i.scene === 'offframe'), 'too far');
  // The default label is 48 pixels, the size of body text, 44 pixels from the arrow.
  assert.ok(off.x0 < -1 && Math.abs(off.x1 - (30 - 44)) <= 1, JSON.stringify(off));
  assert.deepEqual(found('band', '"low"').map((i) => [i.level, i.message]), [['warn', '"low" is in the caption band (y 851 to 990), where captions can cover it; keep content above s.safe.bottom (827)']]);

  const tall = await check(project(t, { size: 'tiktok', defaults: '0.5' }, {
    vault: `s.arrow([700, 700], [1000, 700], { label: 'scrambled vault only', at: 0 });`,
  }));
  assert.deepEqual(tall.filter((i) => i.message.startsWith('"scrambled vault only"')).map((i) => [i.level, i.message]),
    [['warn', '"scrambled vault only" is outside the tiktok content area (119,304 to 864,1267, 745x963), where the app\'s buttons and post text can cover it']]);
});

test('labelSide moves the label, the box check measures and the box the camera keeps whole', { skip }, async (t) => {
  const sides = project(t, { defaults: '0.5' }, {
    left: `s.arrow([80, 300], [80, 780], { label: 'LEFT', labelSide: 'left', at: 0 });`,
    right: `s.arrow([1840, 300], [1840, 780], { label: 'RIGHT', labelSide: 'right', at: 0 });`,
    above: `s.arrow([700, 40], [1220, 40], { label: 'ABOVE', labelSide: 'above', at: 0 });`,
    below: `s.arrow([700, 1040], [1220, 1040], { label: 'BELOW', labelSide: 'below', at: 0 });`,
    plain: `s.arrow([1840, 300], [1840, 780], { label: 'RIGHT', at: 0 });
    s.arrow([700, 1040], [1220, 1040], { label: 'BELOW', at: 0 });`,
    wrong: `s.arrow([700, 540], [1220, 540], { label: 'here', labelSide: 'top', at: 0 });`,
  });
  const { issues, more: cameras } = await check(sides, (page) => page.evaluate(() => window.explainroo.cameras()));
  const at = (scene) => issues.filter((i) => i.scene === scene);
  // Each label runs off the frame on the side it names, labelOffset (44 for the
  // default 48 pixel label) from the arrow's middle: beside a vertical arrow its
  // near edge, above or below a horizontal one its center.
  const left = offFrame(at('left'), 'LEFT');
  const right = offFrame(at('right'), 'RIGHT');
  const above = offFrame(at('above'), 'ABOVE');
  const below = offFrame(at('below'), 'BELOW');
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 2, `${what}: ${a} is not ${b}`);
  near(left.x1, 80 - 44, 'the right edge of the left label');
  near(left.y, 540, 'the middle of the left label');
  near(right.x0, 1840 + 44, 'the left edge of the right label');
  near(right.y, 540, 'the middle of the right label');
  near(above.y, 40 - 44, 'the middle of the label above');
  near(above.x, 960, 'the middle of the label above');
  near(below.y, 1040 + 44, 'the middle of the label below');
  near(below.x, 960, 'the middle of the label below');
  // Without labelSide the same arrows keep their labels left and above, in the frame.
  assert.deepEqual(at('plain').filter((i) => i.message.includes('runs off the frame')), []);
  assert.deepEqual(at('wrong').filter((i) => i.level === 'error').map((i) => i.message), ['arrow: labelSide "top" is not one of left, right, above, below']);
  // The camera keeps the same label whole. It measures the drawn letters, and
  // check a box of the label's size, so their middles differ by a few pixels.
  for (const [scene, box] of Object.entries({ left, right, above, below })) {
    const labels = cameras[scene].elements.filter((e) => e.kind === 'label');
    assert.equal(labels.length, 1, `${scene}: ${JSON.stringify(cameras[scene].elements)}`);
    assert.ok(Math.abs(labels[0].box.x - box.x) <= 10 && Math.abs(labels[0].box.y - box.y) <= 10, `${scene}: the camera keeps ${JSON.stringify(labels[0].box)}, check measures ${JSON.stringify(box)}`);
  }
  const plain = cameras.plain.elements.filter((e) => e.kind === 'label').map((e) => e.box);
  assert.ok(plain.some((b) => b.x < 1840 && Math.abs(b.y - 540) <= 10) && plain.some((b) => b.y < 1040 && Math.abs(b.x - 960) <= 10), JSON.stringify(plain));

  // The label is drawn there too.
  const drawn = project(t, { camera: 'still' }, {
    all: `s.bg('#ffffff');
    s.arrow([480, 300], [480, 780], { label: 'RIGHT', labelSide: 'right', at: 0 });
    s.arrow([1440, 300], [1440, 780], { label: 'LEFT', labelSide: 'left', at: 0 });
    s.arrow([760, 160], [1160, 160], { label: 'BELOW', labelSide: 'below', at: 0 });
    s.arrow([760, 920], [1160, 920], { label: 'ABOVE', labelSide: 'above', at: 0 });`,
  });
  const regions = {
    right: [[514, 528, 574, 552], [386, 528, 446, 552]],
    left: [[1346, 528, 1406, 552], [1474, 528, 1534, 552]],
    below: [[930, 182, 990, 206], [930, 114, 990, 138]],
    above: [[930, 874, 990, 898], [930, 942, 990, 966]],
  };
  const ink = await withEngine(drawn.project, drawn.timeline, {}, async (page) => {
    await page.evaluate(() => window.explainroo.stills([{ T: 1.5, path: 'out/sides.png' }]));
    return page.evaluate((list) => {
      const canvas = document.getElementById('c');
      const g = canvas.getContext('2d');
      return Object.fromEntries(Object.entries(list).map(([side, boxes]) => [side, boxes.map(([x0, y0, x1, y1]) => {
        const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) n++;
        return n;
      })]));
    }, regions);
  });
  for (const [side, [there, opposite]] of Object.entries(ink)) {
    assert.ok(there > 40, `the ${side} label is drawn on its side: ${JSON.stringify(ink)}`);
    assert.equal(opposite, 0, `nothing is drawn on the other side of the ${side} label: ${JSON.stringify(ink)}`);
  }
});

test('check warns about a lift above 2 with the card, the value and the range, and not about 2', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    lifted: `s.ui.panel(200, 200, 700, 500, { at: 0, lift: 3 }, () => {});
    s.ui.card(1000, 200, 400, 300, { lift: 4, name: 'Plan' });`,
    normal: `s.ui.panel(200, 200, 700, 500, { at: 0, lift: 2 }, () => {});
    s.ui.modal(1000, 200, 700, 500, { at: 0 }, () => {});`,
  }));
  assert.deepEqual(issues.filter((i) => i.message.includes('lift')).map((i) => [i.level, i.scene, i.message]), [
    ['warn', 'lifted', 'the 1st s.ui.panel at 550,450 has lift: 3, which makes a shadow 3 times the normal one and can cover much of the frame; use a lift from 0 (no shadow) to 2 (twice the normal shadow)'],
    ['warn', 'lifted', 'the card "Plan" has lift: 4, which makes a shadow 4 times the normal one and can cover much of the frame; use a lift from 0 (no shadow) to 2 (twice the normal shadow)'],
  ]);
});

// A cross on a bug that leaves at 1.0s, in three-second scenes.
const MARKS = {
  alone: "s.icon('bug', { id: 'bug', x: 960, y: 540, size: 200, at: 0, out: 1 }); s.annotate('bug', { type: 'cross', at: 0.3 });",
  together: "s.icon('bug', { id: 'bug', x: 960, y: 540, size: 200, at: 0, out: 1 }); s.annotate('bug', { type: 'cross', at: 0.3, out: 1 });",
  shortly: "s.icon('bug', { id: 'bug', x: 960, y: 540, size: 200, at: 0, out: 1 }); s.annotate('bug', { type: 'cross', at: 0.3, out: 1.2 });",
  grouped: "s.group({ at: 0, out: 1 }, () => s.icon('bug', { id: 'bug', x: 960, y: 540, size: 200 })); s.annotate('bug', { type: 'circle', at: 0.3 });",
  later: "s.icon('bug', { id: 'bug', x: 960, y: 540, size: 200, at: 0, out: '#gone' }); s.annotate('bug', { type: 'cross', at: 0.3, out: 2.5 });",
};

// How many marks the scene `index` draws at `t`, or with `kind` how many shapes
// of that kind, drawn on their own.
const marksAt = (page, index, t, kind = null) => page.evaluate(async ([index, t, kind]) => {
  const { Engine, fetchState } = await import('/engine/runtime.js');
  const state = await fetchState();
  const scenes = (await import(`/project/scenes.js?v=${state.version}`)).default;
  const engine = new Engine({ canvas: document.createElement('canvas'), state, scenes, icons: await (await fetch('/engine/icons/lucide.json')).json().then((j) => j.icons), images: new Map() });
  engine.textLog = [];
  engine.drawLog = { shapes: [], strokes: [], lives: [], shown: 0, order: 0 };
  engine.drawScene(engine.ctx, index, t);
  return kind ? engine.drawLog.shapes.filter((s) => s.kind === kind).length : engine.drawLog.strokes.filter((s) => s.kind === 'annotate').length;
}, [index, t, kind]);

test('check warns about a mark that stays more than 0.3 seconds after what it marks has left, and with "defaults": "0.5" a mark leaves with it', { skip }, async (t) => {
  const marks = (issues) => issues.filter((i) => /stays on screen/.test(i.message)).map((i) => [i.scene, i.message]);
  const old = project(t, {}, MARKS, { dur: 3 });
  old.timeline.scenes[4].marks = { gone: 1 };
  const { issues, more } = await check(old, (page) => marksAt(page, 0, 2));
  assert.deepEqual(marks(issues), [
    ['alone', 'the cross around "bug" stays on screen for 1.6s after "bug" leaves at 1.0s; give the mark the same out as "bug", out: 1. With "defaults": "0.5" in video.json, a mark without an out of its own leaves with what it marks'],
    ['grouped', 'the circle around "bug" stays on screen for 1.6s after "bug" leaves at 1.0s; give the mark the same out as "bug". With "defaults": "0.5" in video.json, a mark without an out of its own leaves with what it marks'],
    ['later', 'the cross around "bug" stays on screen for 1.5s after "bug" leaves at 1.0s; give the mark the same out as "bug", out: \'#gone\''],
  ]);
  assert.equal(issues.find((i) => i.scene === 'alone' && /stays on screen/.test(i.message)).t, 1.45);
  // Without the line the frames stay as they were: the cross is still there at 2s.
  assert.equal(more, 1);
  const fresh = project(t, { defaults: '0.5' }, MARKS, { dur: 3 });
  fresh.timeline.scenes[4].marks = { gone: 1 };
  const now = await check(fresh, (page) => Promise.all([marksAt(page, 0, 1.2), marksAt(page, 0, 2), marksAt(page, 3, 2)]));
  // A mark of its own out still gets the warning, without the note about the line.
  assert.deepEqual(marks(now.issues), [['later', 'the cross around "bug" stays on screen for 1.5s after "bug" leaves at 1.0s; give the mark the same out as "bug", out: \'#gone\'']]);
  // It fades with the bug, is gone at 2s, and leaves with a group too.
  assert.deepEqual(now.more, [1, 0, 0]);
});

// Terminals whose first line comes at 1.5s, in three-second scenes, and code.
const WINDOWS = {
  bare: "s.terminal([{ cmd: 'npm test', at: 1.5 }, { out: 'PASS' }], { x: 960, y: 540 });",
  given: "s.terminal([{ cmd: 'npm test', at: 1.5 }, { out: 'PASS' }], { x: 960, y: 540, title: 'shell', at: 0 });",
  soon: "s.terminal([{ cmd: 'npm test', at: 0.8 }], { x: 960, y: 540 });",
  plain: "s.terminal(['$ npm test', 'PASS'], { x: 960, y: 540 });",
  code: "s.code([{ code: 'let a = 1;' }, { code: 'let a = 2;', at: 2 }], { x: 960, y: 540, at: 0.2 }); s.code('let b = 1;', { x: 960, y: 800, reveal: 'lines', at: 0.5 });",
};

test('check warns about a code window or terminal that is empty for more than a second, and with "defaults": "0.5" a terminal without an at comes in with its first line', { skip }, async (t) => {
  const empty = (issues) => issues.filter((i) => /on screen empty/.test(i.message)).map((i) => [i.scene, i.t, i.message]);
  const { issues, more } = await check(project(t, {}, WINDOWS, { dur: 3 }), (page) => marksAt(page, 0, 1, 'terminal'));
  assert.deepEqual(empty(issues), [
    ['bare', 0, 'the 1st s.terminal is on screen empty for 1.5s, from 0.0s until its first line at 1.5s; give it the at of its first line, like at: 1.5, or add "defaults": "0.5" to video.json, where a terminal without an at of its own comes in with its first line'],
    ['given', 0, 'the terminal "shell" is on screen empty for 1.5s, from 0.0s until its first line at 1.5s; give it the at of its first line, like at: 1.5'],
  ]);
  // Without the line the frames stay as they were: the empty window is there at 1s.
  assert.equal(more, 1);
  const fresh = await check(project(t, { defaults: '0.5' }, WINDOWS, { dur: 3 }), (page) => Promise.all([marksAt(page, 0, 1, 'terminal'), marksAt(page, 0, 1.6, 'terminal')]));
  assert.deepEqual(empty(fresh.issues).map(([scene]) => scene), ['given']);
  assert.deepEqual(fresh.more, [0, 1]);
});

test('check warns about a command written with the prompt in front, which shows the prompt twice', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    object: "s.terminal([{ cmd: '$ npm test' }, { out: 'PASS' }], { x: 960, y: 540, at: 0 });",
    string: "s.terminal(['$ $ npm test'], { x: 960, y: 540, at: 0 });",
    variable: "s.terminal([{ cmd: '$HOME/bin/run' }, '$ echo $PATH'], { x: 960, y: 540, at: 0 });",
    custom: "s.terminal([{ cmd: '> dir' }, { cmd: 'npm test' }], { x: 960, y: 540, prompt: '>', title: 'cmd', at: 0 });",
  }));
  const doubled = issues.filter((i) => /starts with the prompt/.test(i.message)).map((i) => [i.level, i.scene, i.message]);
  assert.deepEqual(doubled, [
    ['warn', 'object', 'the command "$ npm test" of the 1st s.terminal starts with the prompt "$", which the terminal adds itself, so it shows "$ $ npm test"; write it without the prompt, like { cmd: \'npm test\' }'],
    ['warn', 'string', 'the command "$ npm test" of the 1st s.terminal starts with the prompt "$", which the terminal adds itself, so it shows "$ $ npm test"; write it without the prompt, like { cmd: \'npm test\' }'],
    ['warn', 'custom', 'the command "> dir" of the terminal "cmd" starts with the prompt ">", which the terminal adds itself, so it shows "> > dir"; write it without the prompt, like { cmd: \'dir\' }'],
  ]);
});

test('the hint about a word spoken twice names "word#1" and "word#2", and "word#1" silences it', { skip }, async (t) => {
  const tank = ['The', 'tank', 'fills', 'up.', 'It', 'fills', 'again.'];
  const issues = await check(project(t, {}, {
    first: `s.text('Full', { at: 'fills' });`,
    meant: `s.text('Full', { at: 'fills#1', y: 400 });
    s.text('Again', { at: 'fills#2', out: 'again#1', y: 700 });`,
  }, { words: { first: tank, meant: tank } }));
  assert.deepEqual(issues.filter((i) => i.message.startsWith('cue ')).map((i) => [i.level, i.scene, i.message]), [
    ['hint', 'first', 'cue "fills" means the first of the 2 times it is spoken in this scene; write "fills#1" if you mean the first time, or "fills#2" for a later one'],
  ]);
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
});

test('a cue that is not in the narration is one error, and check goes on with the scene\'s other findings, with that cue at the scene start', { skip }, async (t) => {
  const issues = await check(project(t, { language: 'fr' }, {
    arc: "s.text('Arc', { x: 960, y: 540, at: 'soleil' }); s.text('Loin', { x: 2100, y: 300, at: 'ombre' });",
    // Measured at the scene start, the text at the missing cue overlaps the one that is there from 0.
    early: "s.text('Lune', { x: 960, y: 540, at: 0 }); s.text('Lune', { x: 980, y: 545, at: 'soleil' }); s.text('Marque', { y: 800, at: '#absent' });",
    ombre: "s.text('Ombre', { x: 960, y: 540, at: 'ombre' });",
  }, { words: { arc: ['Autour', 'de', "l'ombre."], early: ['Autour', 'de', "l'ombre."], ombre: ['Autour', 'de', "l'ombre."] } }));
  const arc = issues.filter((i) => i.scene === 'arc');
  assert.deepEqual(arc.map((i) => i.level), ['error', 'error'], JSON.stringify(arc));
  assert.match(arc.find((i) => i.message.startsWith('cue')).message, /^cue\("soleil"\) is not in the narration of scene "arc"/);
  assert.match(arc.find((i) => !i.message.startsWith('cue')).message, /^"Loin" runs off the frame/);
  assert.ok(!issues.some((i) => /nothing enters/.test(i.message)), JSON.stringify(issues));
  const early = issues.filter((i) => i.scene === 'early');
  assert.deepEqual(early.map((i) => `${i.level} ${i.message.split('.')[0]}`).sort(), [
    'error "Lune" overlaps "Lune"',
    'error cue("soleil") is not in the narration of scene "early"',
    'error mark("absent") is not in scene "early"',
  ]);
  // Both are on screen as soon as they have risen in, so the second one is measured from 0.
  assert.ok(early.find((i) => i.message.includes('overlaps')).t < 1);
  // "ombre" finds "l'ombre", so that scene has no error.
  assert.deepEqual(issues.filter((i) => i.scene === 'ombre' && i.level === 'error'), []);
});

// Code that types itself, a terminal, a number that counts and text that writes
// itself should be all there before their scene ends, or before they leave.
test('check warns when a reveal has not finished by the end of its scene or by its out, with how much is missing and the option', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    lines: "s.code('one\\ntwo\\nthree\\nfour\\nfive', { title: 'app.js', reveal: 'lines', lineDelay: 0.6, at: 0.5 });",
    typed: "s.code('const answer = 42;\\nconsole.log(answer);', { title: 'typed.js', cps: 10, at: 0 });",
    term: "s.terminal(['$ npm install explainroo', 'added 1 package', '$ npx explainroo doctor'], { cps: 8, at: 0 });",
    count: "s.number(1240, { at: 1.2, dur: 1.4 });",
    leaves: "s.text('Writes itself slowly', { enter: 'write', dur: 1.5, at: 0.2, out: 1 });",
    fine: "s.code('one\\ntwo', { reveal: 'lines', at: 0 }); s.number(12, { at: 0 }); s.text('Quick', { enter: 'write', at: 0 });",
  }, { dur: 2 }));
  const reveals = issues.filter((i) => /of its \d+ lines|has typed|has counted|has written/.test(i.message));
  assert.deepEqual(reveals.map((i) => [i.level, i.scene, i.t]), [['warn', 'lines', 2], ['warn', 'typed', 2], ['warn', 'term', 2], ['warn', 'count', 2], ['warn', 'leaves', 1]]);
  // The lines start 0.35 s after the window, at 0.85, 1.45, 2.05, 2.65 and 3.25 s.
  assert.equal(reveals[0].message, 'the code "app.js" shows 2 of its 5 lines by the end of the scene at 2.0s, and needs until 3.3s; give it an earlier at, or a smaller lineDelay than 0.6');
  assert.match(reveals[1].message, /^the code "typed\.js" has typed \d+% of its text by the end of the scene at 2\.0s, and needs until \d+\.\ds; give it an earlier at, or a higher cps than 10$/);
  assert.match(reveals[2].message, /^the 1st s\.terminal shows 0 of its 3 lines by the end of the scene at 2\.0s, and needs until \d+\.\ds; give it an earlier at, or a higher cps than 8$/);
  assert.match(reveals[3].message, /^the number counting to 1240 has counted \d+% of the way by the end of the scene at 2\.0s, and needs until 2\.6s; give it an earlier at, or a shorter dur than 1\.4$/);
  assert.match(reveals[4].message, /^"Writes itself slowly" has written \d+% of itself by its out at 1\.0s, and needs until 1\.7s; give it an earlier at, or a shorter dur$/);
});

// A note on the edge of a box, right under it.
test('check warns about text that partly overlaps a shape, and not about a shape\'s own text, text inside a shape, a group or overlap: true', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    edge: "s.box('Your phone', { id: 'phone', x: 960, y: 400, w: 500, h: 200, at: 0 }); s.note('Mail, maps, music and photos', { x: 960, y: 505, size: 32, at: 0 });",
    inside: "s.box({ x: 960, y: 540, w: 900, h: 500, at: 0 }); s.text('Inside the box', { x: 960, y: 540, at: 0 }); s.box('Own text', { x: 400, y: 200, at: 0 }); s.icon('server', { x: 1500, y: 300, size: 120, label: 'Server', at: 0 });",
    allowed: "s.box('Card', { x: 960, y: 400, w: 500, h: 200, at: 0 }); s.note('meant to sit on the edge', { x: 960, y: 505, size: 32, at: 0, overlap: true });",
    grouped: "s.group({ x: 960, y: 540, at: 0 }, () => { s.box('Card', { x: 0, y: 0, w: 500, h: 200 }); s.note('a badge on its edge', { x: 0, y: 105, size: 32 }); });",
  }));
  const found = issues.filter((i) => /partly overlap/.test(i.message));
  assert.deepEqual(found.map((i) => [i.level, i.scene]), [['warn', 'edge']], JSON.stringify(issues));
  assert.match(found[0].message, /^"Mail, maps, music and photos" and the box "Your phone" \(id "phone"\) partly overlap, by \d+px; move them apart, or give one of them overlap: true if that is meant$/);
});

// The clean look draws a box's border 3.5 pixels wide on its outline, so half of
// it lies outside. The box runs from y 300 to 500.
test('check warns about text that reaches more than 4 pixels into a box\'s drawn border, from outside or inside, and not about text that only touches it', { skip }, async (t) => {
  const box = "s.box({ x: 960, y: 400, w: 600, h: 200, at: 0 });";
  const issues = await check(project(t, {}, {
    // 3 pixels past the outline is 4.75 into the drawn border.
    onTop: `${box} s.text('replaces', { x: 960, y: 303, valign: 'bottom', size: 48, at: 0 });`,
    touching: `${box} s.text('replaces', { x: 960, y: 301, valign: 'bottom', size: 48, at: 0 });`,
    above: `${box} s.text('replaces', { x: 960, y: 290, valign: 'bottom', size: 48, at: 0 });`,
    inside: `${box} s.text('replaces', { x: 960, y: 304, valign: 'top', size: 48, at: 0 });`,
    fromInside: `${box} s.text('replaces', { x: 960, y: 297, valign: 'top', size: 48, at: 0 });`,
    noBorder: "s.box({ x: 960, y: 400, w: 600, h: 200, border: false, at: 0 }); s.text('replaces', { x: 960, y: 303, valign: 'bottom', size: 48, at: 0 });",
  }));
  const found = issues.filter((i) => /partly overlap/.test(i.message));
  assert.deepEqual(found.map((i) => i.scene).sort(), ['fromInside', 'onTop'], JSON.stringify(issues));
  assert.match(found.find((i) => i.scene === 'onTop').message, /^"replaces" and the 1st s\.box at 960,400 partly overlap, by 5px; move them apart, or give one of them overlap: true if that is meant$/);
});

// The last scene of a LinkedIn video, in the layout that put "replaces" on the top
// border of the box under it: the box's label wraps onto two lines and grows up.
test('check finds a word on the top border of a box whose label wraps', { skip }, async (t) => {
  const issues = await check(project(t, { size: 'linkedin', captions: 'auto' }, {
    guard: `const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    const card = s.box('1 test first', { y: top + h * 0.3, size: u * 9, color: 'green', icon: 'flask-conical', minW: w * 0.8, at: 0 });
    s.text('replaces', { y: card.bottom + h * 0.1, size: u * 5.5, color: 'muted', at: 0.2 });
    s.box('many checks by hand', { y: card.bottom + h * 0.27, size: u * 6.5, color: 'red', icon: 'hourglass', minW: w * 0.8, at: 0.4 });`,
  }, { dur: 3 }));
  assert.deepEqual(issues.filter((i) => /partly overlap/.test(i.message)).map((i) => i.message.replace(/by \d+px/, 'by Npx')), ['"replaces" and the box "many checks by hand" partly overlap, by Npx; move them apart, or give one of them overlap: true if that is meant'], JSON.stringify(issues));
});

// A diagram whose arrows run between points, through a circle on their way, and
// one that ends a few pixels from the edge of the frame.
test('check warns about an arrow through a shape that is not one of its ends, and about an arrow line off the frame or near its edge', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    through: "s.circle({ x: 600, y: 540, r: 80, label: 'Cold coils', at: 0 }); s.circle({ x: 960, y: 540, r: 80, label: 'Compressor', at: 0 }); s.circle({ x: 1320, y: 540, r: 80, label: 'Hot coils', at: 0 }); s.arrow([600, 540], [1320, 540], { gap: 100, at: 0.3 });",
    ends: "s.circle({ id: 'a', x: 600, y: 540, r: 80, label: 'A', at: 0 }); s.circle({ id: 'b', x: 1320, y: 540, r: 80, label: 'B', at: 0 }); s.arrow('a', 'b', { at: 0.3 }); s.arrow([600, 760], [1320, 760], { at: 0.3 }); s.box({ x: 960, y: 650, w: 1200, h: 500, at: 0 });",
    cross: "s.arrow([600, 540], [1320, 540], { dashed: true, at: 0.3 }); s.icon('x', { x: 960, y: 540, size: 68, color: 'red', at: 0.6 });",
    edge: "s.arrow([1500, 540], [1905, 540], { at: 0.3 }); s.arrow([300, 900], [300, 1100], { at: 0.3 });",
  }));
  const through = issues.filter((i) => /runs through/.test(i.message));
  assert.deepEqual(through.map((i) => i.scene), ['through'], JSON.stringify(issues));
  assert.match(through[0].message, /^the 1st s\.arrow from 600,540 to 1320,540 runs through the box "Compressor"; let it go around with bend, or move one of them$/);
  const edges = issues.filter((i) => i.scene === 'edge' && /arrow from/.test(i.message)).map((i) => i.message);
  assert.deepEqual(edges.length, 2, JSON.stringify(issues));
  assert.match(edges.find((m) => m.includes('1905')), /^the 1st s\.arrow from 1500,540 to 1905,540 comes closer than 38px to the edge \(/);
  assert.match(edges.find((m) => m.includes('1100')), /^the 2nd s\.arrow from 300,900 to 300,1100 runs off the frame \(/);
});

test('check gives a hint for text below 40 pixels in a tall or square frame, which people watch on a phone, and not in a wide one', { skip }, async (t) => {
  const scenes = { labels: "s.icon('snowflake', { x: s.cx, y: 700, size: 160, label: 'Cold coils', at: 0 }); s.text('Big enough', { x: s.cx, y: 400, size: 44, at: 0 });" };
  const tall = await check(project(t, { size: 'tiktok', camera: 'still' }, scenes));
  const hints = tall.filter((i) => /small on a phone/.test(i.message));
  assert.deepEqual(hints.map((i) => i.level), ['hint']);
  assert.match(hints[0].message, /^"Cold coils" shows 36px tall at \d\.\ds, small on a phone, where labels read best at 40 to 56px; make it bigger, or give the picture more of the frame$/);
  const wide = await check(project(t, { camera: 'still' }, scenes));
  assert.deepEqual(wide.filter((i) => /small on a phone/.test(i.message)), []);
});

test('when the scene\'s camera zoom pushes text out of the TikTok content area, check names the zoom', { skip }, async (t) => {
  const issues = await check(project(t, { size: 'tiktok', captions: false }, {
    zoomed: `s.camera([{ at: 0.5, zoom: 1.6, dur: 0.2 }]);
    s.text('Wide words here', { x: s.cx, y: s.cy, size: 60, at: 0 });`,
    plain: `s.text('Out anyway', { x: 900, y: s.cy, size: 40, at: 0 });`,
  }));
  const said = (scene) => issues.filter((i) => i.scene === scene && /content area/.test(i.message)).map((i) => i.message);
  assert.equal(said('zoomed').length, 1, JSON.stringify(issues));
  assert.match(said('zoomed')[0], /^"Wide words here" is outside the tiktok content area .*\. The camera's zoom of 1\.6x pushes it there, and without the zoom it fits: zoom less, or move it toward the point the camera zooms onto$/);
  assert.equal(said('plain').length, 1, JSON.stringify(issues));
  assert.doesNotMatch(said('plain')[0], /camera/);
});

test('the hint that a short\'s picture doesn\'t change names the next two words in that stretch, with their times', { skip }, async (t) => {
  const issues = await check(project(t, { size: 'tiktok', captions: false }, {
    still: `s.text('Purring', { x: s.cx, y: s.cy, size: 80, at: 0 });`,
  }, { dur: 4, words: { still: ['Cats', 'purr,', 'and', 'purr.'] } }));
  const hint = issues.find((i) => i.message.startsWith('the picture doesn\'t change'));
  assert.ok(hint, JSON.stringify(issues));
  assert.match(hint.message, /show something new on a word in that stretch, like "Cats" at 0\.2s or "purr#1" at 0\.4s, or move the camera with s\.short\.punch$/);
});

test('the hold that targetSeconds adds at the end of a scene doesn\'t count as a stretch with no new element', { skip }, async (t) => {
  const scenes = { long: `s.title('One', { at: 0 }); s.text('Two', { y: 700, at: 1 });` };
  const plain = await check(project(t, { size: '16:9' }, scenes, { dur: 10 }));
  assert.ok(plain.some((i) => i.message.startsWith('no new element for 9.0s (from 1.0s)')), JSON.stringify(plain));
  const held = await check(project(t, { size: '16:9' }, scenes, { dur: 10, added: { long: 6 } }));
  assert.ok(!held.some((i) => i.message.startsWith('no new element')), JSON.stringify(held));
});

test('check gives a hint when the cover shows an image that fit: \'cover\' cuts at its edges', { skip }, async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { ffmpegPath } = await import('../src/ffmpeg.js');
  const cropped = (fit) => {
    const p = project(t, { size: '16:9', defaults: '0.6' }, {
      intro: `s.title('Our app', { y: 200, at: -1 }); s.image('assets/wide.png', { w: 500, h: 500, y: 650, at: -1${fit ? `, fit: '${fit}'` : ''} });`,
    });
    fs.mkdirSync(path.join(p.project.dir, 'assets'), { recursive: true });
    execFileSync(ffmpegPath(), ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=800x200:d=1', '-frames:v', '1', path.join(p.project.dir, 'assets', 'wide.png')]);
    return withEngine(p.project, p.timeline, { scale: 0.5 }, (page) => page.evaluate(() => window.explainroo.coverCropIssue(null)));
  };
  const hint = await cropped(null);
  assert.equal(hint.level, 'hint');
  assert.match(hint.message, /^the cover at intro@\d\.\d shows the image assets\/wide\.png with fit: 'cover', which cuts 75% of it off at the left and right; look at the cover for words or faces cut at its edge, and give the image the shape of the picture or fit: 'contain' if they are$/);
  assert.equal(await cropped('contain'), null);
});

// A number that counts changes its words at every moment, and is still one
// element: the command line prints its finding once, with the count and the span.
test('the same finding on one element at several moments is one line, and --verbose and the JSON keep every time', { skip }, async (t) => {
  const p = project(t, {}, { count: "s.number(1500, { from: 600, x: s.cx, y: s.cy, color: '#f4e6d8', at: 0.2, dur: 1 }); s.text('Pale', { x: s.cx, y: s.cy + 260, color: '#f4e6d8', at: 0 });" });
  const issues = await check(p);
  const low = issues.filter((i) => / has low contrast/.test(i.message));
  const counting = low.filter((i) => i.message !== low.find((x) => x.message.startsWith('"Pale"')).message);
  assert.ok(counting.length >= 3, JSON.stringify(low));
  assert.equal(new Set(counting.map((i) => i.element)).size, 1);
  assert.notEqual(low.find((i) => i.message.startsWith('"Pale"')).element, counting[0].element);
  const { shownIssues } = await import('../src/cli.js');
  const shown = shownIssues(issues, false).filter((i) => / has low contrast/.test(i.message));
  assert.equal(shown.length, 2);
  const first = counting[0];
  const last = counting.at(-1);
  assert.equal(shown.find((i) => i.t === first.t).message, `${first.message} (the same element at ${counting.length} moments, from ${first.t}s to ${last.t}s; --verbose lists each)`);
  assert.equal(shownIssues(issues, true).length, issues.length);
});

// "free and open source" on screen while the captions say "It is free and open
// source." is a hint that names the element and the sentence. Three words, no
// captions, or a hook title are not.
test('with captions on, check gives a hint for screen text that shows four or more words the captions show at the same moment', { skip }, async (t) => {
  const words = { outro: ['It', 'is', 'free', 'and', 'open', 'source.', 'Try', 'it', 'today.'] };
  const body = "s.text('free and open source', { y: s.cy - 200, at: 0 }); s.text('open source tool', { y: s.cy, at: 0 }); s.text('Try it today', { y: s.cy + 200, at: 0 });";
  const hints = (issues) => issues.filter((i) => / while the captions show the same words/.test(i.message));
  const found = hints(await check(project(t, { captions: true }, { outro: body }, { words })));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].level, 'hint');
  assert.equal(found[0].scene, 'outro');
  assert.equal(found[0].message, '"free and open source" shows "free and open source" while the captions show the same words, in "It is free and open source.". The captions already carry what the voice says, so keep the screen text to a short label or a number, or leave it out');
  assert.deepEqual(hints(await check(project(t, { captions: false }, { outro: body }, { words }))), []);
  // After the captions have shown the words, the text is no repeat.
  assert.deepEqual(hints(await check(project(t, { captions: true }, { outro: "s.text('free and open source', { at: 1.6 });" }, { words }))), []);
  // A short's hook title is its headline, there before the voice says it.
  assert.deepEqual(hints(await check(project(t, { size: 'tiktok', captions: 'bold' }, { outro: "s.short.hook('Free and open source');" }, { words }))), []);
  // Bold captions show up to four words at a time, here "It is free and".
  assert.equal(hints(await check(project(t, { size: 'tiktok', captions: 'bold' }, { outro: "s.text('It is free and', { y: s.cy, at: 0 });" }, { words }))).length, 1);
});
