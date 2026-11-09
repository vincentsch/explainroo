import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome, launch } from '../src/browser.js';
import { formatInspect, inspect, record } from '../src/record.js';
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
  assert.equal(r.log, 'assets/recordings/invoice.log.json');
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), 'utf8'));
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
  // Every run starts with an empty profile, so the banner shows again and
  // its step runs. With keepProfile the next run remembers the cookie, so
  // the step finds nothing and is skipped with a note.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Accept', before: true }, { do: 'mark', name: 'a' }] }));
  const again = await record(dir, 'invoice');
  assert.deepEqual([again.steps, again.notes], [2, []]);
  // A step before the video that finds nothing is skipped in every run, also
  // without keepProfile, like a pop-up that shows only sometimes.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Accept', before: true }, { do: 'click', text: 'No thanks', before: true }, { do: 'mark', name: 'a' }] }));
  const sometimes = await record(dir, 'invoice');
  assert.deepEqual([sometimes.steps, sometimes.notes], [2, ['step 2 (click "No thanks") found nothing and was skipped. Check the step if the page should show it on every visit.']]);
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Accept', before: true }, { do: 'mark', name: 'a' }] }));
  await record(dir, 'invoice', { keepProfile: true });
  const kept1 = await record(dir, 'invoice', { keepProfile: true });
  assert.deepEqual([kept1.steps, kept1.notes], [1, ['step 1 (click "Accept") found nothing and was skipped. That\'s fine when an earlier run did it already, and the kept profile remembers it.']]);
  // The empty profiles of the runs are gone, and the kept one stays.
  assert.equal(fs.readdirSync(path.join(dir, '.cache/record/profiles')).length, 1);
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify(script));
  const good = await record(dir, 'invoice');
  assert.deepEqual([good.steps, good.notes.length], [6, 1]);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), 'utf8'));
  // A step that isn't there stops with its number, close words and a picture.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'a' }, { do: 'click', text: 'New invoices' }] }));
  await assert.rejects(record(dir, 'invoice', { findSeconds: 1 }), (e) => {
    assert.match(e.message, /^recordings\/invoice\.json step 2 \(click "New invoices"\): no visible element with the text "New invoices" after 1 s\. Close words on the page: "New invoice"/);
    assert.match(e.message, /The page at that moment is in .*build\/record\/invoice-step-2\.png\.$/);
    return true;
  });
  assert.ok(fs.statSync(path.join(dir, 'build/record/invoice-step-2.png')).size > 1000);
  // The failed run left the last good recording in place.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), 'utf8')), kept);
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
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), 'utf8'));
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

test('a click on an element under a bar scrolls it clear first, and one that stays covered stops with what covers it', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  // The ninth Play button sits under the player bar at the bottom of the window.
  const dir = project(t, { url: `${app.url}#/tracks`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Play', nth: 9 }, { do: 'mark', name: 'played' }] });
  const r = await record(dir, 'invoice');
  const log = JSON.parse(fs.readFileSync(path.join(dir, r.log), 'utf8'));
  const click = log.steps[0];
  // It scrolled the button to the middle of the window, clear of the bar, and clicked it there.
  assert.ok(Math.abs(click.box.y - 360) < 40, JSON.stringify(click.box));
  const frame = path.join(dir, 'played.png');
  await ffmpeg(['-loglevel', 'error', '-ss', String(log.steps[1].t + 0.1), '-i', path.join(dir, r.video), '-frames:v', '1', frame]);
  // The bar is dark, so its middle shows the white words "Playing Balance Due".
  const bar = rgbAt(frame, 560, 630, 160, 30);
  assert.ok(bar.some((c) => c > 200), 'the bar says what plays');
  // A dialog over the whole page covers the button wherever it scrolls.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/reports`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'click', text: 'Download report' }] }));
  await assert.rejects(record(dir, 'invoice'), (e) => {
    assert.match(e.message, /^recordings\/invoice\.json step 1 \(click "Download report"\): <div\.locked> with the words "Reports come with Little Ledger Pro\." covers the middle of the element at \d+,\d+, also after scrolling it to the middle of the window, so the click would land on that\./);
    return true;
  });
});

test('finding an element never scrolls, a zoom outside the window asks for a scroll step, and pace sets the speed', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, { url: `${app.url}#/customers`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'a' }, { do: 'zoom', text: 'End of the list' }] });
  await assert.rejects(record(dir, 'invoice', { findSeconds: 1 }), /step 2 \(zoom "End of the list"\): the element is outside the window, and finding it never scrolls the page\. Put a scroll step to it first, like \{ "do": "scroll", "text": "End of the list" \}\./);
  // With the scroll step it zooms, and the scroll of 500 pixels in a window
  // 720 tall takes about 0.7 s at pace 1.
  const steps = [{ do: 'click', text: 'Settings' }, { do: 'open', url: '#/customers' }, { do: 'scroll', y: 500 }, { do: 'scroll', text: 'End of the list' }, { do: 'zoom', text: 'End of the list' }];
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/customers`, viewport: { width: 1280, height: 720 }, steps }));
  const slow = JSON.parse(fs.readFileSync(path.join(dir, (await record(dir, 'invoice')).log), 'utf8'));
  assert.ok(slow.steps[4].box.y > 0 && slow.steps[4].box.y < 720, JSON.stringify(slow.steps[4]));
  const seconds = (log, i) => log.steps[i].end - log.steps[i].start;
  const move = (log) => log.steps[0].move.t1 - log.steps[0].move.t0;
  assert.ok(seconds(slow, 2) > 0.6 && seconds(slow, 2) < 2.5, `scroll of 500 px: ${seconds(slow, 2)}`);
  assert.ok(move(slow) > 0.5 && move(slow) < 0.9, `pointer move: ${move(slow)}`);
  // pace 2 takes half as long, and a step's duration sets its own.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/customers`, viewport: { width: 1280, height: 720 }, pace: 2, steps: steps.map((s, i) => (i === 3 ? { ...s, duration: 1.5 } : s)) }));
  const quick = JSON.parse(fs.readFileSync(path.join(dir, (await record(dir, 'invoice')).log), 'utf8'));
  assert.ok(move(quick) > 0.25 && move(quick) < 0.55, `pointer move at pace 2: ${move(quick)}`);
  assert.ok(seconds(quick, 2) < seconds(slow, 2), `scroll at pace 2: ${seconds(quick, 2)}`);
  assert.ok(seconds(quick, 3) > 1.5, `scroll with its own duration: ${seconds(quick, 3)}`);
});

test('a new recording takes out the frames of the one it replaces, and s.recording starts at from', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, { url: `${app.url}#/customers`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'top' }, { do: 'wait', seconds: 1.5 }, { do: 'scroll', y: 400 }, { do: 'mark', name: 'down' }] });
  const clips = path.join(dir, 'build/clips');
  for (const [name, src] of [['old', 'assets/recordings/invoice.webm'], ['other', 'assets/clips/intro.mp4']]) {
    fs.mkdirSync(path.join(clips, name), { recursive: true });
    fs.writeFileSync(path.join(clips, name, 'source.json'), JSON.stringify({ src, content: 'x' }));
  }
  await record(dir, 'invoice');
  assert.deepEqual(fs.readdirSync(clips), ['other']);
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), 'utf8'));
  const timeline = { pace: 1, duration: 3, frames: 90, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
    scenes: [{ id: 'demo', index: 0, start: 0, dur: 3, words: [], marks: {}, voice: null, lead: 0, transition: 'none' }] };
  // The blue logo at the top left of the app, 45,45 of the 1280x720 video, in the 480x270 frame.
  const logo = async (o) => {
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) { s.recording('invoice', { full: true, enter: 'none', ...${JSON.stringify(o)} }); } };`);
    return withEngine(loadProject(dir), timeline, { scale: 0.25 }, async (page) => {
      // Half a second in, as a busy computer can send the first frames before the page paints.
      const [frame] = await page.evaluate(() => window.explainroo.frames([15], 0.95));
      return pixel(dir, frame, 16, 16, 2, 2);
    });
  };
  const top = await logo({});
  assert.ok(top[2] > 200 && top[0] < 100, `the top of the page: ${top}`);
  const down = await logo({ from: log.steps[3].t });
  assert.ok(down.every((c) => c > 200), `scrolled down from the start: ${down}`);
  // The frames of the video are in the cache now, named by where they come from.
  const made = fs.readdirSync(clips).filter((n) => n !== 'other');
  assert.equal(made.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(clips, made[0], 'source.json'), 'utf8')).src, 'assets/recordings/invoice.webm');
});

test('inspect lists what a step can click or type into, and every text and selector it gives finds that element', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, { url: app.url, steps: [{ do: 'mark', name: 'a' }] });
  const r = await inspect(dir, `${app.url}#/notes`, { viewport: { width: 1280, height: 720 } });
  assert.deepEqual(r.viewport, { width: 1280, height: 720 });
  const byKind = (kind) => r.elements.filter((e) => e.kind === kind);
  // The editor shows its placeholder as an element inside the field.
  const [editor] = byKind('editor');
  assert.equal(editor.aria_label, 'Note text');
  assert.equal(editor.placeholder, 'Write the note here, or paste one.');
  assert.equal(editor.text, 'Write the note here, or paste one.');
  assert.equal(editor.selector, 'div[aria-label="Note text"]');
  // A button that shows only an icon goes by its aria-label.
  const clear = r.elements.find((e) => e.aria_label === 'Clear note');
  assert.deepEqual([clear.kind, clear.words, clear.text, clear.selector], ['button', '×', 'Clear note', 'button[aria-label="Clear note"]']);
  // A link whose class changes with the page is found by its address or its place.
  const invoices = r.elements.find((e) => e.words === 'Invoices');
  assert.equal(invoices.selector, 'a[href="#/invoices"]');
  assert.ok(r.elements.every((e) => e.in_view && e.box.w > 0), 'the page fits the window');
  const text = formatInspect(r);
  assert.match(text, /^http:\/\/127\.0\.0\.1:\d+\/#\/notes at 1280x720: 7 elements to click or type into, from the top\n/);
  assert.match(text, /\n {2}\d\. editor "Write the note here, or paste one\.", aria-label "Note text" {2}at \d+,\d+, 720x220\n {5}text "Write the note here, or paste one\.", or selector div\[aria-label="Note text"\]\n/);

  // A form: a field goes by the words of its label, and each selector matches
  // only its element.
  const form = await inspect(dir, `${app.url}#/new-invoice`, { viewport: { width: 1280, height: 720 } });
  const amount = form.elements.find((e) => e.selector === '#amount');
  assert.deepEqual([amount.kind, amount.placeholder, amount.text], ['input text', '0', 'Amount']);
  assert.equal(form.elements.find((e) => e.kind === 'select').text, 'Customer');
  // "Cancel" is a button inside a link, one thing to click.
  assert.equal(form.elements.filter((e) => e.words === 'Cancel').length, 1);
  const browser = await launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${app.url}#/new-invoice`);
  for (const e of form.elements) {
    const boxes = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
      const b = el.getBoundingClientRect();
      return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
    }), e.selector);
    assert.deepEqual(boxes, [[e.box.x, e.box.y]], e.selector);
  }

  // A recording types into the editor by the start of its placeholder, and
  // clicks the icon button by its aria-label.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/notes`, viewport: { width: 1280, height: 720 }, steps: [
    { do: 'type', text: 'Write the note here', value: 'Thanks!' },
    { do: 'click', text: 'Clear note' },
  ] }));
  const log = JSON.parse(fs.readFileSync(path.join(dir, (await record(dir, 'invoice')).log), 'utf8'));
  assert.deepEqual(log.steps[0].box, editor.box);
  assert.deepEqual(log.steps[1].box, clear.box);
});

test('a type step types at 14 characters a second, at its cps, and faster at a higher pace', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const value = 'Design work for the spring issue';
  const typing = async (step, pace) => {
    const dir = project(t, { url: `${app.url}#/new-invoice`, viewport: { width: 1280, height: 720 }, ...(pace ? { pace } : {}), steps: [{ do: 'type', text: 'Note', value, ...step }, { do: 'mark', name: 'typed' }] });
    const log = JSON.parse(fs.readFileSync(path.join(dir, (await record(dir, 'invoice')).log), 'utf8'));
    // The step ends 0.7 s and a moment to settle after the last key.
    return log.steps[0].end - log.steps[0].t;
  };
  const plain = await typing({});
  const quick = await typing({ cps: 28 });
  const paced = await typing({ cps: 28 }, 2);
  // 32 characters take about 2.3 s at 14 a second, 1.1 s at 28, and 0.6 s at 28 with pace 2.
  assert.ok(plain - quick > 0.6 && plain - quick < 2, `${plain} and ${quick}`);
  assert.ok(quick - paced > 0.2 && quick - paced < 1.2, `${quick} and ${paced}`);
});

test('check warns about a recording that plays small with no zoom, and names the zoom step to add', { skip: !chrome }, async (t) => {
  const dir = project(t, { url: 'http://127.0.0.1:4500/', viewport: { width: 1280, height: 720 }, steps: [{ do: 'mark', name: 'a' }] });
  fs.mkdirSync(path.join(dir, 'assets/recordings'), { recursive: true });
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=1280x720:r=25:d=4', '-c:v', 'libvpx', '-b:v', '200k', path.join(dir, 'assets/recordings/invoice.webm')]);
  const steps = [
    { step: 1, do: 'click', text: 'Accept', before: true, start: 0.1, t: 0.2, end: 0.3 },
    { step: 2, do: 'click', text: 'New invoice', cue: '#new', start: 1, t: 1.5, click: 1.5, end: 2, box: { x: 1100, y: 80, w: 140, h: 44 } },
    { step: 3, do: 'type', selector: '#amount', start: 2, t: 2.6, click: 2.4, end: 3, box: { x: 600, y: 300, w: 400, h: 44 } },
  ];
  const writeLog = (more = []) => fs.writeFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), JSON.stringify({ version: 1, url: 'http://127.0.0.1:4500/', width: 1280, height: 720, duration: 4, start: 0.5, end: 3.5, cursor: { x: 640, y: 360 }, steps: [...steps, ...more], blur: [] }));
  const timeline = { pace: 1, duration: 4, frames: 120, fps: 30, width: 1920, height: 1080, transitionSeconds: 0,
    scenes: [{ id: 'demo', index: 0, start: 0, dur: 4, words: [], marks: { new: 1 }, voice: null, lead: 0, transition: 'none' }] };
  const findings = async (o) => {
    fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { demo(s) { s.recording('invoice', ${JSON.stringify(o)}); } };`);
    return withEngine(loadProject(dir), timeline, { scale: 0.25 }, async (page) => (await page.evaluate(() => window.explainroo.check(0.25))).filter((i) => /plays at/.test(i.message)).map((i) => i.message));
  };
  writeLog();
  // 700 pixels wide is 55% of the 1280 of the video.
  assert.deepEqual(await findings({ w: 700 }), ['recording "invoice" plays at 55% of its size, 1280 pixels wide in 700, and none of its steps zooms in, so its text is small to read. Add a zoom step to recordings/invoice.json before step 2, like { "do": "zoom", "text": "New invoice", "cue": "#new" }, and record it again']);
  // From 60% on it's fine, and so is a zoom step.
  assert.deepEqual(await findings({ w: 768 }), []);
  writeLog([{ step: 4, do: 'zoom', selector: 'form', start: 3, t: 3, end: 3.4, box: { x: 600, y: 300, w: 600, h: 300 } }]);
  assert.deepEqual(await findings({ w: 700 }), []);
  assert.deepEqual(await findings({ h: 300, zoom: false }), ['recording "invoice" plays at 42% of its size, 1280 pixels wide in 533, and zoom: false keeps its zooms out, so its text is small to read. Take out zoom: false, or show it larger']);
});
