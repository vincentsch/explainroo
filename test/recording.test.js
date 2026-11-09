import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRecordingScript, readRecordingScript, scriptHash, stepLabel, videoOffset } from '../src/record.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { recordingClock, videoTime, sceneTime, cursorAt, viewAt, focusRect, coverRect, ZOOM_SECONDS, MAX_ZOOM, CATCH_UP } from '../engine/recording.js';
import { makeState } from '../src/pipeline.js';
import { loadProject } from '../src/project.js';

const URL = 'http://127.0.0.1:4500/';
const fails = (script, pattern) => assert.throws(() => checkRecordingScript(script, 'recordings/demo.json'), pattern);

test('a recording script gets its defaults and keeps what each step needs', () => {
  const s = checkRecordingScript({
    url: URL,
    steps: [
      { do: 'click', text: 'Accept', before: true },
      { do: 'open', url: '/#/invoices' },
      { do: 'click', text: 'New invoice', cue: 'click' },
      { do: 'type', text: 'Amount', value: '2400', press: 'Enter' },
      { do: 'hover', selector: 'tr:last-child', nth: 1 },
      { do: 'scroll', y: 400 },
      { do: 'scroll', text: 'End of the list' },
      { do: 'wait', seconds: 0.5 },
      { do: 'wait', text: 'Saved' },
      { do: 'zoom', selector: 'form' },
      { do: 'zoom' },
      { do: 'mark', name: 'saved', cue: '#done' },
    ],
    blur: [{ selector: '.email' }, { text: 'Jane Doe' }],
  });
  assert.deepEqual(s.viewport, { width: 1920, height: 1080 });
  assert.equal(s.steps[1].url, 'http://127.0.0.1:4500/#/invoices');
  assert.deepEqual(s.steps[0], { do: 'click', text: 'Accept', before: true });
  assert.deepEqual(s.steps[3], { do: 'type', text: 'Amount', value: '2400', press: 'Enter' });
  assert.deepEqual(s.steps[11], { do: 'mark', name: 'saved', cue: '#done' });
  assert.deepEqual(s.blur, [{ selector: '.email' }, { text: 'Jane Doe' }]);
  assert.deepEqual(checkRecordingScript({ url: URL, viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'a' }] }).viewport, { width: 1280, height: 720 });
  assert.equal(stepLabel(s.steps[2], 3), 'step 3 (click "New invoice")');
  assert.equal(stepLabel(s.steps[11], 12), 'step 12 (mark "saved")');
});

test('a recording script names the step and what to write for each mistake', () => {
  fails({ steps: [{ do: 'mark', name: 'a' }] }, /recordings\/demo\.json: url must be an http/);
  fails({ url: 'file:///etc/passwd', steps: [{ do: 'mark', name: 'a' }] }, /url must be an http/);
  fails({ url: 'http://me:secret@127.0.0.1/', steps: [{ do: 'mark', name: 'a' }] }, /can't hold a username or password/);
  fails({ url: URL, steps: [] }, /steps must be a list with at least one step/);
  fails({ url: URL, step: [] }, /unknown key "step"/);
  fails({ url: URL, viewport: { width: 1921 }, steps: [{ do: 'mark', name: 'a' }] }, /viewport\.width must be an even number/);
  fails({ url: URL, steps: [{ do: 'klick', text: 'Save' }] }, /step 1: "do" must be one of .*Did you mean "click"\?/);
  fails({ url: URL, steps: [{ do: 'click' }] }, /step 1: a click step needs the element/);
  fails({ url: URL, steps: [{ do: 'click', text: 'Save', selector: 'button' }] }, /give text or selector, not both/);
  fails({ url: URL, steps: [{ do: 'click', label: 'Save' }] }, /a click step has no "label"\. It takes cue, before, text, selector, nth/);
  fails({ url: URL, steps: [{ do: 'type', text: 'Amount' }] }, /a type step needs "value"/);
  fails({ url: URL, steps: [{ do: 'mark', name: 'a' }, { do: 'mark', name: 'a' }] }, /step 2: the mark name "a" is used twice/);
  fails({ url: URL, steps: [{ do: 'mark' }] }, /a mark step needs a "name"/);
  fails({ url: URL, steps: [{ do: 'mark', name: 'a', text: 'x' }] }, /a mark step has no element, so leave out text/);
  fails({ url: URL, steps: [{ do: 'scroll' }] }, /a scroll step needs "y"/);
  fails({ url: URL, steps: [{ do: 'wait' }] }, /a wait step needs "seconds"/);
  fails({ url: URL, steps: [{ do: 'wait', seconds: 90 }] }, /at most 60/);
  fails({ url: URL, steps: [{ do: 'click', text: 'Save', nth: 0 }] }, /nth must be 1 or more/);
  fails({ url: URL, steps: [{ do: 'mark', name: 'a' }, { do: 'click', text: 'Accept', before: true }] }, /step 2: .*has to come before every other step/);
  fails({ url: URL, steps: [{ do: 'click', text: 'Accept', before: true, cue: 'now' }, { do: 'mark', name: 'a' }] }, /can have no cue/);
  fails({ url: URL, steps: [{ do: 'click', text: 'Accept', before: true }] }, /nothing is left for the video/);
  fails({ url: URL, steps: [{ do: 'mark', name: 'a' }], blur: ['.email'] }, /blur 1 must be \{ "selector"/);
});

test('readRecordingScript says where the script goes and lists the ones there', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-record-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => readRecordingScript(dir, 'new invoice'), /can't be a recording name/);
  assert.throws(() => readRecordingScript(dir, 'demo'), /recordings\/demo\.json is missing\. Write the script there first/);
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings/other.json'), '{');
  assert.throws(() => readRecordingScript(dir, 'demo'), /Scripts in recordings\/: other/);
  assert.throws(() => readRecordingScript(dir, 'other'), /recordings\/other\.json is not valid JSON/);
});

test('a cued step holds the frame before it until its action lands on the cue', () => {
  // Step 2 starts at 4 s of video and clicks at 5 s; its cue is at 8 s of the scene.
  const cued = [{ step: 2, start: 4, t: 5, cueAt: 8 }];
  const clock = recordingClock(cued, { at: 0, from: 1 });
  assert.deepEqual(clock.parts, [{ at: 0, until: 3, v: 1, speed: 1 }, { at: 3, until: 7, v: 4, speed: 0 }]);
  assert.equal(clock.held, 4);
  assert.equal(videoTime(clock, -0.5), null);
  assert.equal(videoTime(clock, 2), 3);
  assert.equal(videoTime(clock, 5), 4);
  assert.equal(videoTime(clock, 8), 5);
  assert.equal(sceneTime(clock, 5), 8);
  assert.equal(sceneTime(clock, 3), 2);
  // At twice the speed the hold is longer, and the click still lands on 8 s.
  const fast = recordingClock(cued, { at: 1, from: 1, speed: 2 });
  assert.equal(sceneTime(fast, 5), 8);
  assert.equal(videoTime(fast, 8), 5);
  // A cue the video reaches too late plays the part before the step faster
  // to catch up, here at 1.5 times, and the step at its own speed.
  const quick = recordingClock([{ step: 3, start: 4, t: 5, cueAt: 3.5 }], { from: 1 });
  assert.deepEqual(quick.parts, [{ at: 0, until: 2.5, v: 1, speed: 3 / 2.5 }]);
  assert.deepEqual(quick.late, []);
  assert.equal(sceneTime(quick, 5), 3.5);
  assert.equal(videoTime(quick, 3), 4.5);
  // Faster than CATCH_UP times it doesn't go, and the step is late.
  const late = recordingClock([{ step: 3, start: 4, t: 5, cueAt: 2 }], { from: 1 });
  assert.deepEqual(late.parts, [{ at: 0, until: 3 / CATCH_UP, v: 1, speed: CATCH_UP }]);
  assert.equal(late.late[0].step, 3);
  assert.ok(Math.abs(late.late[0].by - 0.5) < 1e-9);
  // Steps before from are not played, so their cues don't count.
  assert.deepEqual(recordingClock([{ step: 1, start: 0.2, t: 0.5, cueAt: 5 }], { from: 1 }).parts, []);
});

test('two cued steps hold one after the other, and video times map back to the scene', () => {
  const clock = recordingClock([{ step: 4, start: 6, t: 6.5, cueAt: 10 }, { step: 2, start: 2, t: 3, cueAt: 4 }], { at: 0.5, from: 0 });
  assert.equal(clock.parts.filter((p) => p.speed === 0).length, 2);
  for (const [v, want] of [[3, 4], [6.5, 10]]) assert.ok(Math.abs(sceneTime(clock, v) - want) < 1e-9);
  for (let t = 0.5; t < 14; t += 0.37) {
    const v = videoTime(clock, t);
    const back = sceneTime(clock, v);
    // Inside a hold the scene time comes back as the hold's start.
    assert.ok(back <= t + 1e-9, `${t} -> ${v} -> ${back}`);
  }
});

const LOG = {
  width: 1920,
  height: 1080,
  cursor: { x: 960, y: 540 },
  steps: [
    { step: 1, do: 'click', start: 1, t: 2, move: { t0: 1, t1: 1.5, x0: 960, y0: 540, x1: 100, y1: 100 }, box: { x: 100, y: 100, w: 80, h: 40 } },
    { step: 2, do: 'zoom', start: 3, t: 3, box: { x: 400, y: 300, w: 200, h: 100 } },
    { step: 3, do: 'hover', start: 5, t: 5.5, move: { t0: 5, t1: 5.5, x0: 100, y0: 100, x1: 300, y1: 200 } },
    { step: 4, do: 'zoom', start: 6, t: 6 },
  ],
};

test('the cursor waits, then eases between the places record moved it to', () => {
  assert.deepEqual(cursorAt(LOG, 0), { x: 960, y: 540, moving: false });
  const mid = cursorAt(LOG, 1.25);
  assert.ok(mid.moving && mid.x < 960 && mid.x > 100);
  assert.equal(mid.x, 530);
  assert.deepEqual(cursorAt(LOG, 2), { x: 100, y: 100, moving: false });
  assert.deepEqual(cursorAt(LOG, 4.9), { x: 100, y: 100, moving: false });
  assert.deepEqual(cursorAt(LOG, 9), { x: 300, y: 200, moving: false });
});

test('a zoom step eases to its box in the shape of the view and back out', () => {
  const whole = viewAt(LOG, 2, 16 / 9);
  assert.deepEqual(whole, { x: 0, y: 0, w: 1920, h: 1080, moving: false });
  const during = viewAt(LOG, 3 + ZOOM_SECONDS / 2, 16 / 9);
  assert.ok(during.moving && during.w < 1920 && during.w > 960);
  const close = viewAt(LOG, 3 + ZOOM_SECONDS, 16 / 9);
  assert.equal(close.moving, false);
  // A small box zooms in no further than MAX_ZOOM.
  assert.equal(close.w, 1920 / MAX_ZOOM);
  assert.ok(Math.abs(close.w / close.h - 16 / 9) < 1e-9);
  assert.ok(close.x <= 400 - 100 && close.x + close.w >= 400 + 100);
  assert.deepEqual(viewAt(LOG, 9, 16 / 9), { x: 0, y: 0, w: 1920, h: 1080, moving: false });
  assert.deepEqual(viewAt(LOG, 4, 16 / 9, { zoom: false }), { x: 0, y: 0, w: 1920, h: 1080, moving: false });
  // A tall view shows the middle of the recording, and a zoom keeps inside it.
  assert.deepEqual(coverRect(1920, 1080, 9 / 16), { x: 960 - 303.75, y: 0, w: 607.5, h: 1080 });
  const edge = focusRect({ x: 1900, y: 1070, w: 600, h: 300 }, coverRect(1920, 1080, 16 / 9), 1920, 1080);
  assert.ok(edge.x + edge.w <= 1920 && edge.y + edge.h <= 1080);
});

test('the page gets the step log of each recording, and a project without one keeps its state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-record-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ title: 'T' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## a\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a(s) {} };');
  const timeline = { scenes: [] };
  const before = makeState(loadProject(dir), timeline);
  assert.equal('recordings' in before, false);
  const script = { url: URL, steps: [{ do: 'mark', name: 'a' }] };
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings/demo.json'), JSON.stringify(script));
  fs.mkdirSync(path.join(dir, 'assets/recordings'), { recursive: true });
  const log = { version: 1, width: 1920, height: 1080, duration: 3, start: 0.5, end: 2, cursor: { x: 960, y: 540 }, script: scriptHash(script), steps: [] };
  fs.writeFileSync(path.join(dir, 'assets/recordings/demo.json'), JSON.stringify(log));
  // A log without its video is not a recording yet.
  assert.equal('recordings' in makeState(loadProject(dir), timeline), false);
  fs.writeFileSync(path.join(dir, 'assets/recordings/demo.webm'), '');
  assert.deepEqual(makeState(loadProject(dir), timeline).recordings, { demo: log });
  fs.writeFileSync(path.join(dir, 'recordings/demo.json'), JSON.stringify({ ...script, steps: [{ do: 'mark', name: 'b' }] }));
  assert.equal(makeState(loadProject(dir), timeline).recordings.demo.changed, true);
});

// Chrome sends the first frame of a recording a little after the page opens,
// by an amount that depends on the browser and the load. record paints the
// time as 24 black and white blocks before the app opens, and reads how far
// the video is from the log from those frames.
test('videoOffset reads how far the video is from the log, from the frames that paint the time', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [width, height, fps] = [480, 270, 25];
  const zero = 1762690000123;
  // Frame i shows the page at i / 25 + ahead seconds. Under load Chrome sends
  // a frame twice, and the page is white before it paints.
  const make = async (file, ahead) => {
    const frames = [];
    for (let i = 0; i < fps * 2; i++) {
      const frame = Buffer.alloc(width * height, 0x88);
      const repeat = i % 7 === 3 ? 1 : 0;
      const t = Math.round(zero + ((i - repeat) / fps + ahead) * 1000) % 16777216;
      for (let b = 0; b < 24; b++) {
        for (let y = 0; y < height; y++) frame.fill(i < 2 ? 255 : (t >> b) & 1 ? 255 : 0, y * width + b * 20, y * width + b * 20 + 20);
      }
      frames.push(frame);
    }
    await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-c:v', 'libvpx', '-b:v', '2M', file], { input: Buffer.concat(frames) });
  };
  for (const ahead of [0.14, -0.03, 0.5]) {
    const file = path.join(dir, `ahead-${ahead}.webm`);
    await make(file, ahead);
    const got = await videoOffset(file, { width, height, zero });
    assert.ok(Math.abs(got - ahead) < 0.02, `${ahead}: ${got}`);
  }
  // A video without the blocks, or no video at all, leaves the times as they are.
  const plain = path.join(dir, 'plain.webm');
  await ffmpeg(['-f', 'lavfi', '-i', `color=gray:s=${width}x${height}:d=1`, '-c:v', 'libvpx', plain]);
  assert.equal(await videoOffset(plain, { width, height, zero }), 0);
  assert.equal(await videoOffset(path.join(dir, 'missing.webm'), { width, height, zero }), 0);
});
