import test from 'node:test';
import assert from 'node:assert/strict';
import { planCamera, cameraAt, cameraMoving, compose, continues, frameRect, viewRect } from '../engine/director.js';

const frame = { W: 1920, H: 1080 };
const view = { x: 134, y: 76, w: 1652, h: 928 };
const el = (kind, x, y, w, h, at, out = Infinity) => ({ kind, at, out, box: { x: x + w / 2, y: y + h / 2, w, h } });

// Every card or label is fully inside the frame or fully outside it.
function cuts(shot, elements, margin = 1) {
  const r = frameRect(shot, view, frame);
  return elements.filter((e) => {
    if (e.kind === 'arrow' || e.kind === 'line') return false;
    const b = { x0: e.box.x - e.box.w / 2, x1: e.box.x + e.box.w / 2, y0: e.box.y - e.box.h / 2, y1: e.box.y + e.box.h / 2 };
    const outside = b.x1 <= r.x0 + margin || b.x0 >= r.x1 - margin || b.y1 <= r.y0 + margin || b.y0 >= r.y1 - margin;
    const inside = b.x0 >= r.x0 - margin && b.x1 <= r.x1 + margin && b.y0 >= r.y0 - margin && b.y1 <= r.y1 + margin;
    return !inside && !outside;
  });
}

const diagram = [
  el('text', 760, 90, 400, 90, 0.1),
  el('shape', 200, 450, 260, 140, 1.5),
  el('arrow', 470, 500, 300, 40, 2.6),
  el('shape', 780, 450, 260, 140, 2.8),
  el('arrow', 1050, 500, 300, 40, 4.4),
  el('shape', 1360, 450, 260, 140, 4.6),
  el('text', 1360, 640, 260, 40, 6.2),
];

test('no elements means no camera', () => {
  assert.equal(planCamera([], { dur: 5, view, frame }), null);
  assert.equal(planCamera([el('shape', 0, 0, 1920, 1080, 0)], { dur: 5, view, frame }), null);
});

// Zoom direction changes (in after out, or out after in) less than `gap`
// seconds apart.
function reversals(plan, gap = 5) {
  let prev = null;
  let n = 0;
  for (const m of plan.moves) {
    const dz = Math.log(m.to.z / m.from.z);
    if (Math.abs(dz) < 0.1) continue;
    if (prev && Math.sign(dz) !== prev.sign && m.start - prev.start < gap) n++;
    prev = { sign: Math.sign(dz), start: m.start };
  }
  return n;
}

test('a scene that starts small starts close and widens as the picture grows', () => {
  const row = [0, 1, 2, 3].map((i) => el('shape', 260 + i * 380, 470, 220, 140, 0.5 + i * 3));
  const plan = planCamera(row, { dur: 14, view, frame });
  assert.ok(plan.start.z > 1.3, 'the first shot is close');
  for (const m of plan.moves) assert.ok(m.to.z <= m.from.z + 1e-9, `no zooming in again at ${m.start}`);
  const end = frameRect(cameraAt(plan, 13.9), view, frame);
  for (const e of row) assert.ok(e.box.x - e.box.w / 2 >= end.x0 && e.box.x + e.box.w / 2 <= end.x1, 'the end shows everything');
});

test('something new that already fits the shot needs no move', () => {
  // A large chart, then a line and a label drawn inside it.
  const chart = [
    el('shape', 260, 160, 1400, 760, 0.2),
    el('line', 560, 540, 800, 0, 3),
    el('text', 900, 600, 160, 40, 6.5),
  ];
  const plan = planCamera(chart, { dur: 11, view, frame });
  assert.equal(plan.moves.length, 0);
});

test('the camera pushes in on something small when there is time, not again right after, and pulls back at the end', () => {
  const scene = [
    el('shape', 200, 200, 600, 300, 0.2),
    el('shape', 1100, 200, 600, 300, 0.2),
    el('text', 1250, 700, 300, 50, 3),
    el('text', 300, 700, 300, 50, 6.5),
  ];
  const plan = planCamera(scene, { dur: 13, view, frame, voiceEnd: 11 });
  const pushes = plan.moves.filter((m) => m.to.z > m.from.z * 1.1);
  assert.equal(pushes.length, 1, 'one push in');
  assert.ok(Math.abs(pushes[0].start - 2.7) < 1e-6, 'on the first note');
  const end = frameRect(cameraAt(plan, 12.9), view, frame);
  for (const e of scene) assert.ok(e.box.x - e.box.w / 2 >= end.x0 - 0.5 && e.box.x + e.box.w / 2 <= end.x1 + 0.5, 'the end shows everything');
});

test('the camera does not keep zooming in and out', () => {
  // New things every two seconds, far apart from each other.
  const spots = [[200, 200], [1500, 800], [300, 820], [1450, 180], [860, 500], [200, 500], [1500, 500]];
  const scene = spots.map(([x, y], i) => el('shape', x - 90, y - 50, 180, 100, 0.2 + i * 2));
  const plan = planCamera(scene, { dur: 16, view, frame, voiceEnd: 14 });
  for (let i = 1; i < plan.moves.length; i++) assert.ok(plan.moves[i].start - plan.moves[i - 1].start >= 2.2 - 1e-9, 'moves are spaced out');
  assert.ok(reversals(plan) <= 1, `reversals: ${reversals(plan)}`);
  assert.ok(plan.moves.length <= 5, `moves: ${plan.moves.length}`);
});

test('no shot cuts a card or label in half while it holds, drift included', () => {
  const plan = planCamera(diagram, { dur: 12, view, frame, voiceEnd: 9 });
  const holds = [0.05, ...plan.moves.map((m) => m.start + m.dur + 0.01), 11.9];
  for (const t of holds) {
    const shot = cameraAt(plan, t);
    const visible = diagram.filter((e) => e.at <= t && e.out > t);
    assert.deepEqual(cuts(shot, visible).map((e) => e.kind), [], `t=${t}`);
  }
});

test('the camera is continuous and only reports real moves as moving', () => {
  const plan = planCamera(diagram, { dur: 12, view, frame, voiceEnd: 9 });
  let prev = cameraAt(plan, 0);
  for (let t = 0.01; t < 12; t += 0.01) {
    const c = cameraAt(plan, t);
    assert.ok(Math.abs(c.x - prev.x) < 25 && Math.abs(c.y - prev.y) < 25 && Math.abs(Math.log(c.z / prev.z)) < 0.03, `jump at ${t.toFixed(2)}`);
    prev = c;
  }
  const m = plan.moves[0];
  assert.equal(cameraMoving(plan, m.start + m.dur / 2), true);
  assert.equal(cameraMoving(plan, m.start - 0.01), false);
});

test('a close-up leaves a neighbour out entirely or takes it in, and falls back to the full frame', () => {
  const row = [0, 1, 2, 3, 4].map((i) => el('shape', 805 + i * 205, 335, 190, 130, 3 + i * 0.2));
  const music = el('icon', 1050, 700, 120, 120, 6.7);
  const shot = compose([music], [...row, music], view, frame);
  assert.ok(shot.z > 1.2);
  assert.deepEqual(cuts(shot, row), []);
  // A neighbour hugging the subject on every side cannot be avoided.
  const subject = el('shape', 900, 500, 120, 80, 1);
  const ring = [el('text', 700, 380, 600, 60, 0), el('text', 700, 640, 600, 60, 0), el('text', 560, 380, 60, 320, 0), el('text', 1300, 380, 60, 320, 0)];
  const tight = compose([subject], [subject, ...ring], view, frame);
  assert.deepEqual(cuts(tight, ring), []);
  const v = viewRect(tight, view);
  assert.ok(subject.box.x - subject.box.w / 2 >= v.x0 && subject.box.x + subject.box.w / 2 <= v.x1);
});

test('a scene continues the one before it when its first frame is that scene\'s last picture', () => {
  const a = [el('shape', 200, 450, 260, 140, 0), el('shape', 780, 450, 260, 140, 1), el('text', 780, 640, 260, 40, 2)];
  const b = [el('shape', 200, 450, 260, 140, -1), el('shape', 780, 450, 260, 140, -1), el('text', 780, 640, 260, 40, -1), el('shape', 1360, 450, 260, 140, 2)];
  const everything = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
  assert.equal(continues(a, b, everything), true);
  // Not when A ends on something B leaves out.
  assert.equal(continues(a, b.filter((e) => e.kind !== 'text'), everything), false);
  // Not when A's last close-up shows little of what B carries.
  const closeUp = { x0: 760, y0: 620, x1: 1060, y1: 700 };
  assert.equal(continues(a, b, closeUp), false);
  // Not when B draws its own picture.
  assert.equal(continues(a, [el('shape', 100, 100, 200, 100, -1), el('shape', 400, 100, 200, 100, -1)], everything), false);
});

test('a continued scene starts where the last camera stopped and holds through the dissolve', () => {
  const from = { x: 700, y: 520, z: 1.4 };
  const plan = planCamera(diagram, { dur: 12, view, frame, from, still: 0.6 });
  assert.deepEqual(plan.start, from);
  assert.ok(plan.moves.every((m) => m.start >= 0.6));
  const c = cameraAt(plan, 0);
  assert.ok(Math.abs(c.x - from.x) < 1e-9 && Math.abs(c.z - from.z) < 1e-9);
});

test('pace makes the camera quicker', () => {
  const slow = planCamera(diagram, { dur: 12, view, frame, pace: 1 });
  const fast = planCamera(diagram, { dur: 12, view, frame, pace: 1.5 });
  assert.ok(slow.moves.length && fast.moves.length);
  assert.ok(fast.moves[0].dur < slow.moves[0].dur);
});

test('the opening shot cuts nothing that is on screen before the first move', () => {
  // Two opening cards leave at 1s; the close-up on the card at 2s would cut them.
  const opening = [el('shape', 160, 150, 1600, 100, 0, 1), el('shape', 700, 440, 400, 200, 0, 1), el('shape', 1300, 465, 200, 150, 2)];
  const plan = planCamera(opening, { dur: 8, view, frame });
  for (const t of [0.05, 0.5, 0.9]) {
    const visible = opening.filter((e) => e.at <= t && e.out > t);
    assert.deepEqual(cuts(cameraAt(plan, t), visible).map((e) => e.box.x), [], `t=${t}`);
  }
});

test('every move ends before its scene does', () => {
  const late = [el('shape', 200, 450, 260, 140, 0), el('shape', 1500, 700, 200, 120, 7.5)];
  const plan = planCamera(late, { dur: 8, view, frame });
  for (const m of plan.moves) assert.ok(m.start + m.dur <= 8 + 1e-9, `move ${m.start}+${m.dur}`);
});

test('a full-frame shot does not drift what fits the free part of the frame into the app overlays', () => {
  const tall = { W: 1080, H: 1920 };
  const safe = { x: 119, y: 240, w: 745, h: 1027 };
  const usable = { x0: 119, y0: 240, x1: 864, y1: 1267 };
  const cards = [el('shape', 119, 703, 200, 100, 0), el('shape', 664, 703, 200, 100, 0.2)];
  const plan = planCamera(cards, { dur: 8, view: safe, frame: tall, usable });
  for (const t of [0.5, 4, 7.9]) {
    const cam = cameraAt(plan, t);
    const cx = safe.x + safe.w / 2;
    for (const e of cards) {
      const x0 = cx + (e.box.x - e.box.w / 2 - cam.x) * cam.z;
      const x1 = cx + (e.box.x + e.box.w / 2 - cam.x) * cam.z;
      assert.ok(x0 >= usable.x0 - 0.5 && x1 <= usable.x1 + 0.5, `t=${t}: ${x0.toFixed(1)}..${x1.toFixed(1)}`);
    }
  }
});

// Boxes given by their center, as the engine measures them.
const centered = (kind, x, y, w, h, at, out = Infinity, extra = {}) => ({ kind, box: { x, y, w, h }, at, out, ...extra });
const whole = (shot, e, v = view) => {
  const r = frameRect(shot, v, frame);
  return e.box.x - e.box.w / 2 >= r.x0 - 0.5 && e.box.x + e.box.w / 2 <= r.x1 + 0.5 && e.box.y - e.box.h / 2 >= r.y0 - 0.5 && e.box.y + e.box.h / 2 <= r.y1 + 0.5;
};

test('a move that keeps something new whole is made however small it is', () => {
  const wide = { x: 76, y: 76, w: 1768, h: 928 };
  const items = [centered('shape', 1525, 650, 500, 100, 0), centered('shape', 1000, 450, 550, 300, 3), centered('shape', 900, 300, 400, 100, 4.5), centered('shape', 1200, 900, 500, 200, 6)];
  const plan = planCamera(items, { dur: 14, view: wide, frame, voiceEnd: 12 });
  for (let t = 6.2; t < 13.9; t += 0.1) if (!cameraMoving(plan, t)) assert.ok(whole(cameraAt(plan, t), items[3], wide), `t=${t.toFixed(1)}`);
});

test('a focus region is framed whole, and an arrow that fits does not cancel it', () => {
  const pan = [centered('code', 960, 540, 1600, 700, 0), centered('focus', 600, 540, 200, 80, 0, 3.9, { explicit: true }), centered('focus', 1050, 540, 200, 80, 4, Infinity, { explicit: true })];
  const p1 = planCamera(pan, { dur: 14, view, frame, voiceEnd: 12 });
  assert.ok(whole(cameraAt(p1, 6), pan[2]));
  const arrow = [centered('shape', 960, 540, 1400, 700, 0), centered('focus', 960, 540, 200, 80, 3, Infinity, { explicit: true }), centered('arrow', 960, 700, 500, 20, 3.9)];
  const p2 = planCamera(arrow, { dur: 14, view, frame, voiceEnd: 12 });
  assert.ok(cameraAt(p2, 6).z > 1.5, 'the close-up happens');
});

test('a push in is held for a while before the camera pulls back', () => {
  const items = [centered('shape', 500, 350, 600, 300, 0), centered('shape', 1400, 350, 600, 300, 0), centered('text', 1400, 725, 300, 50, 8.5)];
  const plan = planCamera(items, { dur: 12, view, frame, voiceEnd: 10 });
  for (let i = 0; i < plan.moves.length; i++) {
    const m = plan.moves[i];
    if (m.to.z <= m.from.z * 1.1) continue;
    const next = plan.moves[i + 1]?.start ?? 12;
    assert.ok(next - (m.start + m.dur) >= 1.5 - 1e-9, `held ${(next - m.start - m.dur).toFixed(2)}s`);
  }
});

test('a large chart is the picture, and a label inside it gets no close-up', () => {
  const items = [centered('chart', 960, 540, 1600, 800, 0), centered('line', 960, 540, 1400, 0, 3), centered('text', 960, 700, 160, 40, 6.5)];
  const plan = planCamera(items, { dur: 12, view, frame, voiceEnd: 10 });
  for (let t = 0.1; t < 11.9; t += 0.5) assert.ok(whole(cameraAt(plan, t), items[0]), `t=${t.toFixed(1)}`);
});

test('a push in makes way for a focus point that comes soon after', () => {
  const items = [centered('shape', 500, 350, 600, 300, 0), centered('shape', 1400, 350, 600, 300, 0), centered('text', 500, 725, 300, 50, 3), centered('focus', 1400, 350, 200, 80, 5.5, Infinity, { explicit: true })];
  const plan = planCamera(items, { dur: 12, view, frame, voiceEnd: 10 });
  for (let i = 0; i < plan.moves.length; i++) {
    const m = plan.moves[i];
    const next = plan.moves[i + 1]?.start ?? 12;
    if (m.to.z > m.from.z * 1.1) assert.ok(next - (m.start + m.dur) >= 1.5 - 1e-9, `held ${(next - m.start - m.dur).toFixed(2)}s`);
  }
  assert.ok(whole(cameraAt(plan, 8), items[3]) && cameraAt(plan, 8).z > 1.5, 'the focus gets its close-up');
});

test('a scene too short for the pull-back still ends on the whole picture', () => {
  // Three steps in a row; the last one comes a second before the scene ends.
  // They stay until the end, also when they leave right at the end.
  for (const out of [Infinity, 5.6]) {
    const steps = [0, 1, 2].map((i) => el('shape', 300 + i * 520, 470, 260, 140, [0.3, 2.4, 4.4][i], out));
    const plan = planCamera(steps, { dur: 5.6, view, frame, voiceEnd: 5 });
    const end = cameraAt(plan, 5.55);
    for (const e of steps) assert.ok(whole(end, e), `step at ${e.at}, out ${out}`);
  }
});

test('a last move in that becomes a wide shot keeps later things whole', () => {
  const boxes = [[1383, 438, 382, 227, 0], [1632, 306, 119, 209, 0.89], [622, 541, 303, 71, 1.38], [737, 839, 113, 70, 2.19], [252, 632, 252, 163, 3.06]];
  const items = boxes.map(([x, y, w, h, at]) => centered('shape', x, y, w, h, at));
  const plan = planCamera(items, { dur: 5.7, view, frame, pace: 1 });
  const settled = Math.max(3.06, ...plan.moves.map((m) => m.start + m.dur));
  for (let t = settled + 0.05; t < 5.7; t += 0.1) assert.ok(whole(cameraAt(plan, t), items[4]), `t=${t.toFixed(2)}`);
});

test('a continued scene also ends on the whole picture', () => {
  const items = [centered('shape', 350, 540, 260, 140, 0), centered('shape', 850, 540, 260, 140, 0), centered('shape', 1450, 540, 260, 140, 3.5)];
  const plan = planCamera(items, { dur: 4.8, view, frame, from: { x: 600, y: 540, z: 1.7 }, still: 0.7 });
  const end = cameraAt(plan, 4.75);
  for (const e of items) assert.ok(whole(end, e), `box at ${e.box.x}`);
});

test("an arrow's label is kept whole, and a labelled arrow gets no close-up", () => {
  const els = [
    el('shape', 300, 420, 300, 160, 0.3),
    el('shape', 1100, 420, 300, 160, 0.3),
    el('arrow', 600, 480, 500, 40, 4),
    el('label', 700, 380, 300, 40, 4),
    el('shape', 1300, 760, 300, 120, 9),
  ];
  const plan = planCamera(els, { dur: 14, view, frame });
  assert.ok(!plan.moves.some((m) => m.start > 3 && m.start < 5.5), JSON.stringify(plan.moves.map((m) => m.start)));
  for (let t = 0; t < 14; t += 0.05) {
    if (cameraMoving(plan, t)) continue;
    const shown = els.filter((e) => e.at <= t && e.out > t);
    assert.deepEqual(cuts(cameraAt(plan, t), shown), [], `t=${t.toFixed(2)}`);
  }
  // A close-up next to an arrow leaves its label out or takes it in.
  const label = el('label', 520, 300, 360, 50, 0);
  const shot = compose([el('shape', 860, 360, 200, 120, 0)], [label, el('arrow', 400, 360, 460, 30, 0)], view, frame);
  assert.ok(shot.z > 1.2, `z ${shot.z}`);
  assert.deepEqual(cuts(shot, [label]), []);
});
