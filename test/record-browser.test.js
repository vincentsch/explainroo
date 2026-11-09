import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { record } from '../src/record.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { execFileSync } from 'node:child_process';
import { ffmpeg, ffmpegPath } from '../src/ffmpeg.js';
import { serveDemoApp } from './fixtures/demo-app/serve.js';

let chrome;
try { chrome = findChrome(); } catch {}

// A project with one recording script, and a cache of its own for the browser profile.
function project(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-record-'));
  const cache = process.env.EXPLAINROO_CACHE;
  process.env.EXPLAINROO_CACHE = path.join(dir, '.cache');
  t.after(() => {
    if (cache === undefined) delete process.env.EXPLAINROO_CACHE;
    else process.env.EXPLAINROO_CACHE = cache;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', captions: false, watermark: false, music: false, sfx: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo\nNow click it.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo(s) {} };');
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify(script));
  return dir;
}

// The color of one pixel of an image file, through ffmpeg.
// The colors of a w x h area, one value per channel and pixel.
const rgbAt = (file, x, y, w = 1, h = 1) => [...execFileSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-vf', `format=rgb24,crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

// The same for a JPEG frame from the engine page.
function pixel(dir, jpeg, x, y, w, h) {
  const file = path.join(dir, 'frame.jpg');
  fs.writeFileSync(file, Buffer.from(jpeg, 'base64'));
  return rgbAt(file, x, y, w, h);
}

test('record runs the steps in a clean window, logs each one and blurs what it names', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const script = {
    url: `${app.url}#/invoices`,
    viewport: { width: 1280, height: 720 },
    steps: [
      { do: 'click', text: 'Accept', before: true },
      { do: 'click', text: 'New invoice', cue: 'click' },
      { do: 'type', text: 'Amount', value: '75' },
      { do: 'zoom', selector: 'form' },
      { do: 'click', text: 'Save invoice' },
      { do: 'mark', name: 'saved' },
    ],
    blur: [{ selector: '.email' }, { text: 'Jane Doe' }, { text: 'Nobody here' }],
  };
  const dir = project(t, script);
  const r = await record(dir, 'invoice');
  assert.equal(r.video, 'assets/recordings/invoice.webm');
  assert.deepEqual([r.width, r.height, r.steps], [1280, 720, 6]);
  assert.deepEqual(r.notes, ['blur 3 (text "Nobody here") matched nothing on any page. Check it, or take it out.']);
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.json'), 'utf8'));
  assert.deepEqual(log.blur.map((b) => b.found), [true, true, false]);
  assert.equal(log.steps[0].before, true);
  assert.ok(log.start > log.steps[0].end, 'the video starts after the steps marked before');
  // Each step starts after the one before it, and its action comes inside it.
  for (const [i, st] of log.steps.entries()) {
    assert.ok(st.start <= st.t && st.t <= st.end, JSON.stringify(st));
    if (i) assert.ok(st.start >= log.steps[i - 1].end);
  }
  const click = log.steps[1];
  assert.equal(click.cue, 'click');
  assert.equal(click.click, click.t);
  // "New invoice" sits at the top right of the page, and the pointer went there.
  assert.ok(click.box.x > 1000 && click.box.y < 120, JSON.stringify(click.box));
  assert.deepEqual([click.move.x1, click.move.y1], [click.box.x, click.box.y]);
  assert.ok(log.steps[2].box.w > 200, 'the label of a field types into the field');
  assert.ok(log.steps[3].box.h > 150, 'zoom has the box of the form');
  assert.ok(log.duration >= log.end - 0.2);
  const probe = await ffmpeg(['-hide_banner', '-i', path.join(dir, r.video)]).catch((e) => e);
  assert.match(String(probe.stderr ?? probe.message), /1280x720/);
  // The cookie banner was closed before the video starts: its middle shows the page.
  const frame = path.join(dir, 'start.png');
  await ffmpeg(['-loglevel', 'error', '-ss', String(log.start + 0.2), '-i', path.join(dir, r.video), '-frames:v', '1', frame]);
  const page = rgbAt(frame, 640, 680);
  assert.ok(page.every((c) => c > 236 && c < 250), `page where the banner was: ${page}`);
  // The run reuses its profile, where the banner was closed already, so the
  // step before the video finds nothing and is skipped with a note.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Accept', before: true }, { do: 'mark', name: 'a' }] }));
  const again = await record(dir, 'invoice');
  assert.deepEqual([again.steps, again.notes], [1, ['step 1 (click "Accept") found nothing and was skipped. That\'s fine when an earlier run did it already, and "record --fresh" starts without that.']]);
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify(script));
  const good = await record(dir, 'invoice', { fresh: true });
  assert.deepEqual([good.steps, good.notes.length], [6, 1]);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.json'), 'utf8'));
  // A step that isn't there stops with its number, close words and a picture.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'a' }, { do: 'click', text: 'New invoices' }] }));
  await assert.rejects(record(dir, 'invoice', { findSeconds: 1 }), (e) => {
    assert.match(e.message, /^recordings\/invoice\.json step 2 \(click "New invoices"\): no visible element with the text "New invoices" after 1 s\. Close words on the page: "New invoice"/);
    assert.match(e.message, /The page at that moment is in .*build\/record\/invoice-step-2\.png\.$/);
    return true;
  });
  assert.ok(fs.statSync(path.join(dir, 'build/record/invoice-step-2.png')).size > 1000);
  // The failed run left the last good recording in place.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.json'), 'utf8')), kept);
});

test('s.recording holds the frame before a cued step until the cue, and draws the cursor', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, {
    url: `${app.url}#/invoices`,
    viewport: { width: 1280, height: 720 },
    steps: [{ do: 'click', text: 'Accept', before: true }, { do: 'click', text: 'New invoice', cue: 'click' }, { do: 'mark', name: 'form' }],
  });
  await record(dir, 'invoice');
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.json'), 'utf8'));
  const click = log.steps[1];
  const scene = (o) => `export default { demo(s) {
    const r = s.recording('invoice', { full: true, ...${JSON.stringify(o)} });
    s.text('Form', { at: r.times.form, size: 30, x: 100, y: 1000, enter: 'none' });
  } };`;
  const timeline = (words) => ({ pace: 1, duration: 8, frames: 240, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
    scenes: [{ id: 'demo', index: 0, start: 0, dur: 8, words, marks: {}, voice: null, lead: 0, transition: 'none' }] });
  // The button, in the 480x270 frame: full: true fills 1920x1080 with the 1280x720 video.
  const k = 480 / 1280;
  const button = [Math.round((click.box.x - click.box.w * 0.4) * k), Math.round((click.box.y - click.box.h * 0.36) * k)];
  fs.writeFileSync(path.join(dir, 'scenes.js'), scene({}));
  const cueAt = 5;
  await withEngine(loadProject(dir), timeline([{ text: 'Now', start: 0.3, end: 0.6 }, { text: 'click', start: cueAt, end: 5.3 }, { text: 'it.', start: 5.3, end: 5.6 }]), { scale: 0.25 }, async (page) => {
    const before = cueAt - 0.6;
    const after = cueAt + 1;
    const [held, clicked] = await page.evaluate((list) => window.explainroo.frames(list, 0.95), [before * 30, after * 30].map(Math.round));
    // Until the cue the list shows with its blue button, though the video
    // itself clicked it long before; after the cue the form shows. The
    // pointer is on its way to the button by then, to its middle.
    const blue = pixel(dir, held, ...button);
    assert.ok(blue[2] > 200 && blue[0] < 90, `button before the cue: ${blue}`);
    const page2 = pixel(dir, clicked, ...button);
    assert.ok(page2.every((c) => c > 225), `form after the cue: ${page2}`);
    // While it holds, the pointer waits where the step before left it: on
    // the cookie banner's button, which is gone from the page by then.
    const accept = log.steps[0].box;
    const cursor = await page.evaluate((f) => window.explainroo.frames([f], 0.95), Math.round(1.5 * 30));
    const tip = pixel(dir, cursor[0], Math.round(accept.x * k) - 1, Math.round(accept.y * k) - 1, 6, 10);
    assert.ok(Math.min(...tip) < 110, `the pointer's dark edge: ${Math.min(...tip)}`);
    const empty = pixel(dir, cursor[0], Math.round(accept.x * k) - 40, Math.round(accept.y * k) - 1, 6, 10);
    assert.ok(Math.min(...empty) > 200, `the page beside it: ${Math.min(...empty)}`);
    const report = await page.evaluate(() => window.explainroo.check(0.25));
    assert.deepEqual(report.filter((i) => /recording/.test(i.message)), []);
  });
  // A cue that the video reaches too late gets a warning from check.
  await withEngine(loadProject(dir), timeline([{ text: 'click', start: 0.1, end: 0.4 }]), { scale: 0.25 }, async (page) => {
    const report = await page.evaluate(() => window.explainroo.check(0.25));
    assert.ok(report.some((i) => /recording "invoice" step 2 \(click "New invoice"\) comes \d\.\ds after its cue "click"/.test(i.message)), JSON.stringify(report));
  });
  // A name that isn't recorded says how to make it.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoices'); } };");
  await withEngine(loadProject(dir), timeline([]), { scale: 0.25 }, async (page) => {
    const report = await page.evaluate(() => window.explainroo.check(0.25));
    assert.ok(report.some((i) => /recording "invoices" not found\. Write recordings\/invoices\.json and run "explainroo record <project> invoices".*Did you mean "invoice"\?/.test(i.message)), JSON.stringify(report));
  });
});
