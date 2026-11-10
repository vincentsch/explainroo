// The example of the product-launch format: a launch video for a made-up notes
// app. Replace the words with the real product's, and the screen in "demo" with
// its real screens, from "explainroo capture" or your own screenshots.
import { appWindow, body, callToAction, featureCards, nameCard, stage, unit } from './format.js';

export default {
  hook(s) {
    stage(s, null, { camera: [{ at: 0.2, zoom: 1.04, dur: s.dur, ease: 'linear' }] });
    nameCard(s, 'Acme Notes', 'From meeting notes to *a list of tasks*', { at: -1, promiseAt: '#promise', icon: 'notebook-pen' });
  },

  problem(s) {
    const ui = stage(s, 'Notes end up *everywhere*');
    const b = body(s);
    const u = unit(s);
    const apps = [
      { icon: 'mail', label: 'Email', at: '#scattered' },
      { icon: 'message-square', label: 'Chat', at: s.time('#scattered') + 0.3 },
      { icon: 'file-text', label: 'Docs', at: s.time('#scattered') + 0.6 },
    ];
    const xs = s.portrait ? apps.map(() => b.cx) : s.row(3, { width: b.w * 0.7 });
    const ys = s.portrait ? apps.map((_, i) => b.y + b.h * (0.2 + i * 0.3)) : apps.map((_, i) => b.cy - u * 6 + (i % 2) * u * 8);
    apps.forEach((a, i) => {
      const w = u * 34;
      const h = u * 20;
      ui.panel(xs[i] - w / 2, ys[i] - h / 2, w, h, { at: a.at, sfx: 'pop', out: '#nobody' }, (x, y) => {
        ui.icon(a.icon, x + u * 6, y + u * 6, u * 5, ui.colors.accent, 2.2);
        ui.text(a.label, x + u * 11, y + u * 6, { size: u * 4, weight: 700, color: ui.colors.ink });
        ui.lines(x + u * 4, y + u * 11.5, w - u * 8, 2);
      });
    });
    s.icon('users', { x: b.cx, y: b.cy - u * 10, size: u * 16, color: 'muted', at: '#nobody' });
    s.text('Who does what?', { x: b.cx, y: b.cy + u * 10, size: u * 9, font: 'display', at: '#nobody', color: 'accent' });
  },

  demo(s) {
    const click = s.time('#click');
    const list = s.time('#list');
    const ui = stage(s, 'Paste notes, *get tasks*');
    const win = appWindow(s, { url: 'acme.example', at: 0.2 }, (x, y, w, h) => {
      const u = unit(s);
      const pad = u * 5;
      ui.eyebrow('Meeting notes', x + pad, y + pad, { size: u * 2.4 });
      ui.textarea(x + pad, y + pad + u * 4, w * 0.5 - pad * 1.5, h - pad * 2 - u * 16, {
        value: ui.typed('Ana sends the offer by Friday. Ben checks the budget on Monday. Launch call next week.', s.time('#paste'), 60, { gain: 0.25 }),
        size: u * 3,
        focus: s.t < click ? 1 : 0,
      });
      ui.button('Make tasks', x + pad, y + h - pad - u * 10, w * 0.5 - pad * 1.5, u * 10, { size: u * 3.6, icon: 'sparkles', press: ui.press(click), loading: s.t > click && s.t < list });
      const tasks = [['Send the offer', 'Ana', 'Fri'], ['Check the budget', 'Ben', 'Mon'], ['Book the launch call', 'Ana', 'Next week']];
      const lx = x + w * 0.5 + pad * 0.5;
      const lw = w * 0.5 - pad * 1.5;
      tasks.forEach(([task, who, when], i) => {
        const ty = y + pad + u * 4 + i * u * 14;
        ui.panel(lx, ty, lw, u * 11.5, { at: list + i * 0.35, sfx: i ? null : 'blip', lift: 0.4, r: u * 2 }, () => {
          ui.checkbox(lx + u * 4, ty + u * 5.75, 0);
          ui.text(task, lx + u * 8, ty + u * 4.2, { size: u * 3.2, weight: 600, color: ui.colors.ink, maxW: lw - u * 10 });
          ui.text(`${who}, ${when}`, lx + u * 8, ty + u * 8, { size: u * 2.7, color: ui.colors.muted });
        });
      });
    });
    ui.cursor([
      { at: 0.4, x: win.x + win.w * 0.9, y: win.y + win.h * 0.95 },
      { at: click - 0.8, x: win.x + win.w * 0.25, y: win.y + win.h * 0.86 },
      { at: click, click: true },
      { at: list + 0.4, x: win.x + win.w * 0.47, y: win.y + win.h * 0.97, dur: 0.6 },
    ]);
  },

  features(s) {
    stage(s, 'Three things it does *well*');
    featureCards(s, [
      { icon: 'list-checks', title: 'Finds every task', text: 'Each line that asks someone to act becomes a task.', at: '#f1' },
      { icon: 'user-round', title: 'Names who does it', text: 'The person named in the notes gets the task.', at: '#f2' },
      { icon: 'bell-ring', title: 'Reminds them', text: 'A reminder goes out the day before the date.', at: '#f3' },
    ]);
  },

  outro(s) {
    stage(s, null, { camera: [{ at: 0, zoom: 1.03, dur: s.dur, ease: 'linear' }] });
    callToAction(s, { name: 'Acme Notes', url: 'acme.example', at: '#cta', urlAt: '#url' });
  },
};
