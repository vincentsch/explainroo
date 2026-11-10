import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome, launch } from '../src/browser.js';
import { formatInspect, formatRecord, inspect, keyDelay, record } from '../src/record.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { execFileSync } from 'node:child_process';
import { ffmpeg, ffmpegPath, probe } from '../src/ffmpeg.js';
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
  assert.match(text, /^http:\/\/127\.0\.0\.1:\d+\/#\/notes at 1280x720 in en-US: 7 elements to click or type into, from the top\n/);
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
  // The keys come no faster than the delay between them: 32 characters take at
  // least 2.3 s at 14 a second, 1.1 s at 28, and 0.6 s at 28 with pace 2. A busy
  // computer only makes them slower, so these are lower bounds.
  const plain = await typing({});
  assert.ok(plain >= value.length / 14 - 0.05, `${plain}`);
  const quick = await typing({ cps: 28 });
  assert.ok(quick >= value.length / 28 - 0.05, `${quick}`);
  const paced = await typing({ cps: 28 }, 2);
  assert.ok(paced >= value.length / 56 - 0.05, `${paced}`);
  // The delay itself: 14 keys a second by default, a step's cps, and the pace.
  assert.equal(keyDelay({}), 1000 / 14);
  assert.equal(keyDelay({ cps: 28 }), 1000 / 28);
  assert.equal(keyDelay({ cps: 28 }, 2), 1000 / 56);
  assert.equal(keyDelay({}, 0.5), 1000 / 7);
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
  // Shown 1200 pixels wide, its 16 px text plays under 24 px, and check names
  // the content area, the size it plays at, and a viewport of the shape it
  // plays in. 1.5 times its size is enough.
  const text = async () => withEngine(loadProject(dir), timeline, { scale: 0.25 }, async (page) => (await page.evaluate(() => window.explainroo.check(0.25))).filter((i) => /16px text/.test(i.message)).map((i) => `${i.level}: ${i.message}`));
  writeLog();
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { w: 1200 }); } };");
  assert.deepEqual(await text(), ['warn: recording "invoice" plays its 1280x720 page at 1200x675 in a content area of 1200x675, so the page\'s 16px text shows 15px tall, under 24px and hard to read on a phone. A zoom helps only while it holds. Record it with "viewport": { "width": 666, "height": 376 } in recordings/invoice.json: that shape fits the 1200x675 the page can take there, and its 16px text shows about 29px tall']);
  // Where even the smallest viewport plays small, it has to show larger.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { w: 768 }); } };");
  assert.deepEqual(await text(), ['warn: recording "invoice" plays its 1280x720 page at 768x432 in a content area of 768x432, so the page\'s 16px text shows 10px tall, under 24px and hard to read on a phone. A zoom helps only while it holds. Show it larger: in the 768x432 the page can take there, even the smallest viewport, { "width": 568, "height": 320 }, plays its 16px text at about 22px']);
  // Without a size, it fills the safe area, less a small margin and the bar of its frame.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice'); } };");
  assert.deepEqual(await text(), ['warn: recording "invoice" plays its 1280x720 page at 1584x891 in a content area of 1768x928, so the page\'s 16px text shows 20px tall, under 24px and hard to read on a phone. A zoom helps only while it holds. Record it with "viewport": { "width": 942, "height": 494 } in recordings/invoice.json: that shape fits the 1697x891 the page can take there, and its 16px text shows about 29px tall']);
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { frame: 'browser' }); } };");
  assert.deepEqual(await text(), ['warn: recording "invoice" plays its 1280x720 page at 1473x829 in a content area of 1768x928, with its browser frame, so the page\'s 16px text shows 18px tall, under 24px and hard to read on a phone. A zoom helps only while it holds. Record it with "viewport": { "width": 942, "height": 460 } in recordings/invoice.json: that shape fits the 1697x829 the page can take there, and its 16px text shows about 29px tall']);
  // The viewport it names plays its text at about 29 px in that frame, and check is quiet.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { w: 1920 }); } };");
  assert.deepEqual(await text(), []);
  // When every type step and every cued step on an element plays inside a
  // zoom, it is a hint that names where the page plays whole.
  const zoomed = [
    { step: 1, do: 'click', text: 'Accept', before: true, start: 0.1, t: 0.2, end: 0.3 },
    { step: 2, do: 'zoom', selector: 'form', start: 0.9, t: 1, end: 1.4, box: { x: 600, y: 300, w: 600, h: 300 } },
    { step: 3, do: 'click', text: 'New invoice', cue: '#new', start: 1.4, t: 1.5, click: 1.5, end: 2, box: { x: 1100, y: 80, w: 140, h: 44 } },
    { step: 4, do: 'type', selector: '#amount', start: 2, t: 2.6, click: 2.4, end: 3, box: { x: 600, y: 300, w: 400, h: 44 } },
    { step: 5, do: 'zoom', start: 3, t: 3, end: 3.2 },
  ];
  fs.writeFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), JSON.stringify({ version: 1, url: 'http://127.0.0.1:4500/', width: 1280, height: 720, duration: 4, start: 0.5, end: 3.5, cursor: { x: 640, y: 360 }, steps: zoomed, blur: [] }));
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { frame: 'browser' }); } };");
  const [hint] = await text();
  assert.match(hint, /^hint: recording "invoice" plays its 1280x720 page at 1473x829 in a content area of 1768x928, with its browser frame, so the page's 16px text shows 18px tall where it doesn't zoom, from 0\.0 to 0\.5s and 2\.5 to 4\.0s of the scene\. Every type step and every cued step on an element plays inside a zoom, so that is fine when the viewer needs to read nothing there\. For larger text everywhere: record it with "viewport": \{ "width": 942, "height": 460 \}/);
  // zoom: false keeps the zooms out, so it warns again.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { frame: 'browser', zoom: false }); } };");
  assert.match((await text())[0], /^warn: /);
  // A log made from other steps asks for a new recording, and says what needs one.
  fs.writeFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), JSON.stringify({ version: 1, url: 'http://127.0.0.1:4500/', width: 1280, height: 720, duration: 4, start: 0.5, end: 3.5, cursor: { x: 640, y: 360 }, script: 'made-from-old', steps: zoomed, blur: [] }));
  const changed = await withEngine(loadProject(dir), timeline, { scale: 0.25 }, async (page) => (await page.evaluate(() => window.explainroo.check(0.25))).filter((i) => /changed after/.test(i.message)).map((i) => i.message));
  assert.deepEqual(changed, ['recordings/invoice.json changed after recording "invoice" was made: a change to its steps other than a cue, or to its url, viewport, locale, pace or blur, needs a new recording; run "explainroo record <project> invoice" again']);
  writeLog();
  // 700 pixels wide is 55% of the 1280 of the video.
  assert.deepEqual(await findings({ w: 700 }), ['recording "invoice" plays at 55% of its size, 1280 pixels wide in 700, and none of its steps zooms in, so its text is small to read. Add a zoom step to recordings/invoice.json before step 2, like { "do": "zoom", "text": "New invoice", "cue": "#new" }, and record it again']);
  // From 60% on it's fine, and so is a zoom step.
  assert.deepEqual(await findings({ w: 768 }), []);
  writeLog([{ step: 4, do: 'zoom', selector: 'form', start: 3, t: 3, end: 3.4, box: { x: 600, y: 300, w: 600, h: 300 } }]);
  assert.deepEqual(await findings({ w: 700 }), []);
  assert.deepEqual(await findings({ h: 300, zoom: false }), ['recording "invoice" plays at 42% of its size, 1280 pixels wide in 533, and zoom: false keeps its zooms out, so its text is small to read. Take out zoom: false, or show it larger']);
});

test('record says what each step found, with a picture of it, and nth leaves out hidden matches', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, {
    url: `${app.url}#/invoices`,
    viewport: { width: 1280, height: 720 },
    steps: [
      { do: 'click', text: 'Accept', before: true },
      // The closed cookie banner keeps its <p>, hidden, so "p" number 2 is the total.
      { do: 'zoom', selector: 'p', nth: 2, align: 'left' },
      { do: 'click', selector: 'h1' },
      { do: 'click', text: 'New invoice' },
      { do: 'type', text: 'Amount', value: '75' },
      { do: 'mark', name: 'typed' },
    ],
  });
  const lines = [];
  const r = await record(dir, 'invoice', { log: (l) => lines.push(l) });
  const log = JSON.parse(fs.readFileSync(path.join(dir, r.log), 'utf8'));
  const [, zoom, heading, click, type, mark] = log.steps;
  assert.equal(log.changes, true);
  assert.deepEqual(zoom.match, { tag: 'p', text: 'Total $2,430', selector: 'p.total', hidden: 1 });
  assert.equal(zoom.align, 'left');
  assert.deepEqual(click.match, { tag: 'button', text: 'New invoice', selector: '#new' });
  assert.deepEqual([type.match.tag, type.match.selector], ['input', '#amount']);
  assert.equal(mark.match, undefined);
  // A click on a heading changes nothing, and one that opens the form does.
  assert.deepEqual([heading.changed, click.changed], [false, true]);
  // Typing moves the picture until its last key.
  assert.ok(type.until > type.t + 0.05 && type.until <= type.end, JSON.stringify(type));
  // One line per step, with what it found.
  assert.deepEqual(lines.filter((l) => /^step/.test(l)), [
    'step 1 (click "Accept"), before the video: <button> "Accept"',
    'step 2 (zoom "p"): <p> "Total $2,430", skipping 1 hidden match of the selector',
    'step 3 (click "h1"): <h1> "Invoices"',
    'step 4 (click "New invoice"): <button> "New invoice"',
    'step 5 (type "Amount"): <input> "Amount"',
    'step 6 (mark "typed")',
  ]);
  // A small picture of each element the video shows, from the video.
  assert.equal(r.pictures, 'build/record/invoice');
  // A step before the video is not in it, so it has no picture.
  assert.deepEqual(r.matched.map((m) => [m.step, m.picture]), [[1, undefined], ...[2, 3, 4, 5].map((n) => [n, `build/record/invoice/step-${n}.png`])]);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'build/record/invoice')).sort(), ['step-2.png', 'step-3.png', 'step-4.png', 'step-5.png']);
  const size = async (file) => (await probe(file)).streams.map((st) => [st.width, st.height])[0];
  // The button with 12 pixels around it, and the wide field scaled to 480 at most.
  assert.deepEqual(await size(path.join(dir, 'build/record/invoice/step-4.png')), [click.box.w + 24, click.box.h + 24]);
  const [w] = await size(path.join(dir, 'build/record/invoice/step-5.png'));
  assert.ok(w <= 480, w);
  // The button is blue in its picture.
  const mid = rgbAt(path.join(dir, 'build/record/invoice/step-4.png'), Math.round(click.box.w / 2) + 12, 14);
  assert.ok(mid[2] > 200 && mid[0] < 90, `the button: ${mid}`);
  assert.match(formatRecord(r), /\nwhat each step found: build\/record\/invoice\/step-<n>\.png\. Open them/);
  // A selector with only hidden matches says so when it stops.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/invoices`, viewport: { width: 1280, height: 720 }, steps: [{ do: 'zoom', selector: '#toast' }] }));
  await assert.rejects(record(dir, 'invoice', { findSeconds: 1 }), /no visible element with the selector "#toast" after 1 s\. The selector matches 1 hidden element, which a step leaves out\./);
});

test('inspect --all lists headings, sections and images, and --text what holds the words', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, { url: app.url, steps: [{ do: 'mark', name: 'a' }] });
  const viewport = { width: 1280, height: 720 };
  const plain = await inspect(dir, `${app.url}#/invoices`, { viewport });
  const all = await inspect(dir, `${app.url}#/invoices`, { viewport, all: true });
  const content = all.elements.filter((e) => e.group === 'content');
  assert.equal(all.content, content.length);
  assert.equal(all.total, plain.total + content.length);
  assert.deepEqual(content.map((e) => e.kind), ['h1', 'table']);
  assert.deepEqual([content[0].words, content[0].text, content[0].selector], ['Invoices', 'Invoices', 'h1']);
  assert.match(formatInspect(all), /^http:\/\/127\.0\.0\.1:\d+\/#\/invoices at 1280x720 in en-US: \d+ elements, \d+ to click or type into, and 2 of the headings, sections and images to zoom or scroll to, from the top\n/);
  const held = await inspect(dir, `${app.url}#/invoices`, { viewport, holding: 'total' });
  assert.equal(held.matches, 1);
  assert.deepEqual(held.elements.map((e) => [e.level, e.kind]), [[0, 'p'], [1, 'main']]);
  assert.deepEqual([held.elements[0].words, held.elements[0].selector], ['Total $2,430', 'p.total']);
  const text = formatInspect(held);
  assert.match(text, /: 1 element holds "total", each with the larger ones around it, from the top\n {2}1\. p "Total \$2,430" {2}at \d+,\d+, \d+x\d+\n {5}text "Total \$2,430", or selector p\.total\n {2}2\. {3}in main /);
  // Words that come a moment after the page opens, like search results, get a while to show.
  const later = await inspect(dir, `${app.url}#/search`, { viewport, holding: 'Results:' });
  assert.deepEqual(later.elements.map((e) => [e.level, e.kind, e.selector]), [[0, 'h2', 'h2'], [1, 'section', 'section.hits'], [2, 'main', '#main']]);
  const none = formatInspect(await inspect(dir, `${app.url}#/invoices`, { viewport, holding: 'Nothing like it' }));
  assert.match(none, /: no visible element holds "Nothing like it", also after 15 s\./);
});

test('in a short, typing, scrolling, zooming and a click that changes the page count as picture changes', { skip: !chrome }, async (t) => {
  const dir = project(t, { url: 'http://127.0.0.1:4500/', viewport: { width: 540, height: 960 }, steps: [{ do: 'mark', name: 'a' }] });
  fs.mkdirSync(path.join(dir, 'assets/recordings'), { recursive: true });
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=540x960:r=25:d=9', '-c:v', 'libvpx', '-b:v', '200k', path.join(dir, 'assets/recordings/invoice.webm')]);
  const box = { x: 270, y: 300, w: 400, h: 44 };
  const writeLog = (steps, more = {}) => fs.writeFileSync(path.join(dir, 'assets/recordings/invoice.log.json'), JSON.stringify({ version: 1, url: 'http://127.0.0.1:4500/', width: 540, height: 960, duration: 9, start: 0, end: 8.5, cursor: { x: 270, y: 480 }, steps, blur: [], ...more }));
  const timeline = { pace: 1, duration: 9, frames: 270, fps: 30, width: 1080, height: 1920, transitionSeconds: 0,
    scenes: [{ id: 'demo', index: 0, start: 0, dur: 9, words: [], marks: {}, voice: null, lead: 0, transition: 'none' }] };
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'shorts', theme: 'clean', captions: false, watermark: false, music: false, sfx: false }));
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { demo(s) { s.recording('invoice', { full: true }); } };");
  const still = () => withEngine(loadProject(dir), timeline, { scale: 0.25 }, async (page) => (await page.evaluate(() => window.explainroo.check(0.25))).filter((i) => i.message.startsWith("the picture doesn't change")).map((i) => i.message.split(', and')[0]));
  const steps = [
    { step: 1, do: 'type', selector: '#q', start: 0.5, t: 1, click: 0.8, until: 4, end: 4.5, box },
    { step: 2, do: 'click', text: 'Solve', start: 4.5, t: 5, click: 5, end: 5.5, box, changed: false },
    { step: 3, do: 'scroll', y: 600, start: 5.5, t: 5.5, until: 6.5, end: 6.8 },
    { step: 4, do: 'mark', name: 'end', start: 6.8, t: 6.8, end: 6.8 },
  ];
  writeLog(steps, { changes: true });
  // The typing fills 1 to 4 s, the click changes nothing, and the scroll moves it from 5.5 to 6.5 s.
  assert.deepEqual(await still(), ["the picture doesn't change for 2.5s, from 6.5s"]);
  // A click that changes the page counts, and so does a zoom while it moves.
  writeLog([...steps.slice(0, 3), { step: 4, do: 'zoom', selector: '#q', start: 7.5, t: 7.5, end: 8.8, box }], { changes: true });
  assert.deepEqual(await still(), []);
  writeLog([steps[0], { ...steps[1], changed: true }, { ...steps[1], step: 3, t: 6.5, start: 6.5, end: 7, changed: true }], { changes: true });
  assert.deepEqual(await still(), ["the picture doesn't change for 2.5s, from 6.5s"]);
  // A log from before counts each step at its time, as it did.
  writeLog(steps.map(({ until, changed, ...st }) => st));
  assert.deepEqual(await still(), ["the picture doesn't change for 4.0s, from 1.0s", "the picture doesn't change for 2.2s, from 6.8s"]);
});

test('the browser asks sites for the project\'s language, and a script\'s locale wins', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const dir = project(t, { url: `${app.url}#/sums`, viewport: { width: 1280, height: 720 }, locale: 'de-DE', steps: [{ do: 'wait', text: 'Eine Zeile pro Rechnung.' }] });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', language: 'es', voice: { provider: 'recording', src: 'assets/n.wav' } }));
  const viewport = { width: 1280, height: 720 };
  const r = await inspect(dir, `${app.url}#/sums`, { viewport });
  assert.equal(r.locale, 'es-ES');
  assert.match(app.languages.at(-1), /^es-ES\b/);
  assert.match(formatInspect(r), /^http:\/\/127\.0\.0\.1:\d+\/#\/sums at 1280x720 in es-ES: /);
  // The script's locale wins, and the step log and the first lines name it.
  const lines = [];
  const rec = await record(dir, 'invoice', { log: (l) => lines.push(l) });
  assert.match(app.languages.at(-1), /^de-DE\b/);
  assert.match(lines[0], /^recording http:\/\/127\.0\.0\.1:\d+\/#\/sums at 1280x720 in de-DE$/);
  assert.match(formatRecord(rec), /^recorded 1 step, \d+\.\d s at 1280x720 in de-DE\n/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, rec.log), 'utf8')).locale, 'de-DE');
  // Without a project, inspect opens the page in en-US at 1920x1080, unless told otherwise.
  const bare = await inspect(null, `${app.url}#/sums`);
  assert.deepEqual([bare.locale, bare.viewport], ['en-US', { width: 1920, height: 1080 }]);
  assert.match(app.languages.at(-1), /^en-US\b/);
  const german = await inspect(null, `${app.url}#/sums`, { locale: 'de-DE', viewport, holding: 'Eine Zeile' });
  assert.deepEqual([german.locale, german.matches], ['de-DE', 1]);
  await assert.rejects(inspect(null, app.url, { locale: 'German' }), /--locale must be a language tag like en-US or de-DE/);
  await assert.rejects(inspect(null, app.url, { keepProfile: true }), /--keep-profile opens the page with the kept profile of a project, so put the project folder first/);
});

test('inspect lists a field that types into a hidden input, names the focus, and says what a selector matches', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const viewport = { width: 1280, height: 720 };
  const r = await inspect(null, `${app.url}#/sums`, { viewport });
  // The line of the sum editor shows no box of its own input, so it goes by
  // the element around the textarea, which a click focuses.
  const fields = r.elements.filter((e) => e.kind === 'field');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].hidden_input, 'textarea');
  assert.ok(fields[0].box.w > 300 && fields[0].box.h >= 30, JSON.stringify(fields[0].box));
  assert.equal(r.focus.selector, fields[0].selector);
  const text = formatInspect(r);
  assert.match(text, /\n {2}\d\. field around a hidden textarea {2}at \d+,\d+, \d+x\d+\n {5}selector \S+\n/);
  assert.match(text, /\nAfter the page loads, the focus is on field around a hidden textarea, selector \S+, so a press step without an element presses its key there\.\n/);
  // A page whose focus stays on the body says so.
  assert.match(formatInspect(await inspect(null, `${app.url}#/invoices`, { viewport })), /\nAfter the page loads, no element has the focus\.\n/);

  // --selector says how many elements match, how many show, and each visible one.
  const cells = await inspect(null, `${app.url}#/invoices`, { viewport, selector: 'td' });
  assert.equal(cells.elements, undefined);
  assert.deepEqual([cells.selector.matches, cells.selector.visible, cells.selector.elements.length], [12, 12, 12]);
  assert.deepEqual([cells.selector.elements[0].words, cells.selector.elements[1].words], ['#1041', 'Harbor Books']);
  assert.match(formatInspect(cells), /^http:\/\/127\.0\.0\.1:\d+\/#\/invoices at 1280x720 in en-US: the selector "td" matches 12 elements, all visible, from the top\n {2}1\. td "#1041" {2}at \d+,\d+, \d+x\d+\n/);
  assert.match(formatInspect(cells), /\nA step with this selector takes the first visible one, and "nth": 2 the second\.\n/);
  // A hidden input matches but doesn't show, and the element around it is named.
  const hidden = await inspect(null, `${app.url}#/sums`, { viewport, selector: '.sum-input textarea' });
  assert.deepEqual([hidden.selector.matches, hidden.selector.visible], [1, 0]);
  assert.equal(hidden.selector.around.selector, fields[0].selector);
  assert.match(formatInspect(hidden), /: the selector "\.sum-input textarea" matches 1 element, 0 of them visible\nA step leaves hidden elements out\. The visible element around the hidden one, which a click focuses, is field around a hidden textarea {2}at /);
  // --text and --selector go together.
  const both = await inspect(null, `${app.url}#/invoices`, { viewport, holding: 'total', selector: 'p.total' });
  assert.deepEqual([both.matches, both.selector.matches, both.selector.visible], [1, 1, 1]);
  assert.match(formatInspect(both), /holds "total".*\n[\s\S]*\nthe selector "p\.total" matches 1 element, and it is visible, from the top\n {2}1\. p "Total \$2,430"/);
  await assert.rejects(inspect(null, app.url, { selector: 'td[' }), /--selector "td\[" is not a valid CSS selector/);

  // The selector inspect gives clicks and types into that field, and a
  // press step presses keys where the focus is, or on its element.
  const dir = project(t, { url: `${app.url}#/sums`, viewport, steps: [
    { do: 'type', selector: fields[0].selector, value: '2+2' },
    { do: 'press', key: 'Enter', cue: 'next' },
    { do: 'press', key: '5' },
    { do: 'wait', text: '5' },
    { do: 'press', key: 'Enter', selector: '.sum-field' },
    { do: 'zoom', selector: '.sum', nth: 3 },
  ] });
  const lines = [];
  const rec = await record(dir, 'invoice', { log: (l) => lines.push(l) });
  const log = JSON.parse(fs.readFileSync(path.join(dir, rec.log), 'utf8'));
  const [typed, enter, five, , onFirst] = log.steps;
  assert.equal(typed.match.tag, 'span');
  assert.deepEqual([enter.key, enter.cue, enter.changed, enter.box, enter.move], ['Enter', 'next', true, undefined, undefined]);
  assert.deepEqual([five.key, five.changed], ['5', true]);
  // On an element that can't take the focus itself, the press clicks it first.
  assert.ok(onFirst.click < onFirst.t && onFirst.box, JSON.stringify(onFirst));
  assert.ok(lines.includes('step 2 (press "Enter")'), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('step 5 (press "Enter" on ".sum-field"): <span>')), lines.join('\n'));
  // A key that isn't one stops with the step.
  fs.writeFileSync(path.join(dir, 'recordings/invoice.json'), JSON.stringify({ url: `${app.url}#/sums`, viewport, steps: [{ do: 'press', key: 'Entr' }] }));
  await assert.rejects(record(dir, 'invoice'), /step 1 \(press "Entr"\): can't press "Entr": .*Key names are like Enter, Tab, Escape or ArrowDown, and a combination is like "Control\+A"\./);
});

test('record says when a zoom\'s element is larger than the frame, and when the zoom shows almost one colour', { skip: !chrome }, async (t) => {
  const app = await serveDemoApp();
  t.after(app.close);
  const viewport = { width: 1280, height: 720 };
  const dir = project(t, { url: `${app.url}#/sums`, viewport, steps: [
    { do: 'click', text: 'Accept', before: true },
    { do: 'type', selector: '.sum-field', value: '1250 + 860 + 320 = 2430' },
    { do: 'zoom', selector: '#sums' },
    { do: 'zoom' },
    { do: 'zoom', selector: '#sums', align: 'top-left', scale: 2.5 },
  ] });
  const rec = await record(dir, 'invoice');
  // The list is 900 pixels tall in a window of 720, and its middle is empty.
  assert.deepEqual(rec.notes.filter((n) => n.startsWith('step 3 ')), [
    'step 3 (zoom "#sums"): the element is 420x900, larger than the 914x514 of the page the zoom shows, so the zoom shows its middle and leaves the rest out. Hold the part the narration names in view with "align", like "top-left", or zoom on a smaller element inside it, which "--inspect --text" lists.',
    'step 3 (zoom "#sums"): almost all of what the zoom shows is one colour, so it may show empty space. Look at build/record/invoice/step-3.png.',
  ]);
  // Held by its top left corner, the zoom shows the first line, with its words.
  assert.deepEqual(rec.notes.filter((n) => n.startsWith('step 5 ')), [
    'step 5 (zoom "#sums"): the element is 420x900, larger than the 512x288 of the page the zoom shows, so the zoom shows its top left part and leaves the rest out. Zoom on a smaller element inside it, which "--inspect --text" lists.',
  ]);
  // The picture of a zoom step is what the zoom shows.
  const size = async (file) => (await probe(file)).streams.map((st) => [st.width, st.height])[0];
  assert.deepEqual(await size(path.join(dir, 'build/record/invoice/step-5.png')), [480, 270]);
  assert.match(formatRecord(rec), /\nstep 3 \(zoom "#sums"\): almost all of what the zoom shows is one colour/);
});
