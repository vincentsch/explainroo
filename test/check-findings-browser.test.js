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
function project(t, settings, scenes, { words = {}, dur = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-findings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, captions: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), Object.keys(scenes).map((id) => `## ${id}\n`).join('\n'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {\n${Object.entries(scenes).map(([id, body]) => `  ${id}(s) {\n    ${body}\n  },`).join('\n')}\n};\n`);
  const loaded = loadProject(dir);
  let start = 0;
  const list = Object.keys(scenes).map((id, index) => {
    const scene = { id, index, start, dur, marks: {}, voice: null, lead: 0, transition: 'none',
      words: (words[id] ?? []).map((text, i) => ({ text, start: 0.2 + i * 0.2, end: 0.35 + i * 0.2 })) };
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
  const field = (name) => `text ${name} has a background but no words, so it draws an empty card; for an empty field, use s.box({ w, h }) or another shape with a size`;
  // Each field is drawn at every moment check looks at, and gives one warning,
  // named by its id or by where it sits in the frame.
  assert.deepEqual(blank.filter((i) => i.scene === 'form').map((i) => [i.level, i.message]), [
    ['warn', field('"password"')],
    ['warn', field('at 960,560')],
  ]);
  const grouped = blank.filter((i) => i.scene === 'grouped');
  assert.deepEqual(grouped.slice(0, 2).map((i) => [i.level, i.message]), [['warn', field('at 600,400')], ['warn', field('at 1200,400')]]);
  assert.equal(grouped.length, 3, JSON.stringify(grouped));
  assert.match(grouped[2].message, /^text at 900,\d+ has a background but no words/);
  const overflow = issues.filter((i) => i.message.includes('is wider than its window'));
  assert.equal(overflow.length, 1, JSON.stringify(issues));
  assert.equal(overflow[0].level, 'error');
  assert.match(overflow[0].message, /^code line 1 \("const answer = computeTheAnswerToEvery/);
});

test('check treats an arrow label as text: overlap, off the frame, caption band and the TikTok safe area', { skip }, async (t) => {
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
    [['warn', '"scrambled vault only" is outside the tiktok safe area (119,240 to 864,1267), where the app\'s buttons, name or caption can cover it']]);
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

test('check warns about a lift above 2 with the value and the range, and not about 2', { skip }, async (t) => {
  const issues = await check(project(t, {}, {
    lifted: `s.ui.panel(200, 200, 700, 500, { at: 0, lift: 3 }, () => {});`,
    normal: `s.ui.panel(200, 200, 700, 500, { at: 0, lift: 2 }, () => {});
    s.ui.modal(1000, 200, 700, 500, { at: 0 }, () => {});`,
  }));
  assert.deepEqual(issues.filter((i) => i.message.includes('lift')).map((i) => [i.level, i.scene, i.message]), [
    ['warn', 'lifted', 'lift: 3 makes a shadow 3 times the normal one, which can cover much of the frame; use a lift from 0 (no shadow) to 2 (twice the normal shadow)'],
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

test('a cue that is not in the narration is one error, without "nothing enters" or other findings for the rest of the scene', { skip }, async (t) => {
  const issues = await check(project(t, { language: 'fr' }, {
    arc: "s.text('Arc', { x: 960, y: 540, at: 'soleil' });",
    ombre: "s.text('Ombre', { x: 960, y: 540, at: 'ombre' });",
  }, { words: { arc: ['Autour', "de", "l'ombre."], ombre: ['Autour', "de", "l'ombre."] } }));
  const arc = issues.filter((i) => i.scene === 'arc');
  assert.equal(arc.length, 1, JSON.stringify(issues));
  assert.match(arc[0].message, /cue\("soleil"\) is not in the narration of scene "arc"/);
  assert.equal(arc[0].level, 'error');
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
  assert.match(reveals[2].message, /^the terminal "terminal" shows 0 of its 3 lines by the end of the scene at 2\.0s, and needs until \d+\.\ds; give it an earlier at, or a higher cps than 8$/);
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
  assert.match(found[0].message, /^"Mail, maps, music and photos" and the box "Your phone" partly overlap, by \d+px; move them apart, or give one of them overlap: true if that is meant$/);
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
  assert.match(through[0].message, /^the arrow from 600,540 to 1320,540 runs through the box "Compressor"; let it go around with bend, or move one of them$/);
  const edges = issues.filter((i) => i.scene === 'edge' && /^the arrow/.test(i.message)).map((i) => i.message);
  assert.deepEqual(edges.length, 2, JSON.stringify(issues));
  assert.match(edges.find((m) => m.includes('1905')), /^the arrow from 1500,540 to 1905,540 comes closer than 38px to the edge \(/);
  assert.match(edges.find((m) => m.includes('1100')), /^the arrow from 300,900 to 300,1100 runs off the frame \(/);
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
