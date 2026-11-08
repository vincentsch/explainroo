// s.clip with full: true fills the frame edge to edge, and speed: 'fit' stretches
// or squeezes a clip so that it ends with its scene. check reports any freeze that
// is left, with its length.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { ffmpeg } from '../src/ffmpeg.js';

let chrome;
try { chrome = findChrome(); } catch {}

// Two seconds of video: one red, one green.
async function project(t, settings, scenes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-fit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'color=lime:s=160x90:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-threads', '1', path.join(dir, 'assets/two.mp4')]);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ captions: false, watermark: false, music: false, sfx: false, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), `## ${Object.keys(scenes).join('\n\n## ')}\n`);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { ${Object.entries(scenes).map(([id, body]) => `${id}(s) { ${body} }`).join(', ')} };`);
  return loadProject(dir);
}

function timeline(p, durs) {
  let start = 0;
  const scenes = Object.entries(durs).map(([id, dur], index) => {
    const scene = { id, index, start, dur, words: [], marks: {}, voice: null, lead: 0, transition: 'none' };
    start += dur;
    return scene;
  });
  return { pace: 1, duration: start, frames: Math.round(start * 30), fps: 30, width: p.config.width, height: p.config.height, transitionSeconds: 0, scenes };
}

// The color of a few points of a still at each time, as 'red', 'green' or 'other'.
async function colors(page, times, points) {
  return page.evaluate(async ([times, points]) => {
    await window.explainroo.stills(times.map((T, i) => ({ T, path: `out/stills/${i}.png` })));
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const img = new Image();
      img.src = `/project/out/stills/${i}.png?${Date.now()}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      out.push(points.map(([x, y]) => {
        const [r, g, b] = ctx.getImageData(Math.min(img.width - 1, Math.round(x * img.width)), Math.min(img.height - 1, Math.round(y * img.height)), 1, 1).data;
        return r > 200 && g < 60 && b < 60 ? 'red' : g > 200 && r < 60 && b < 60 ? 'green' : 'other';
      }));
    }
    return out;
  }, [times, points]);
}

const CORNERS = [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]];

test('full: true fills the frame edge to edge in a wide and a tall frame, with no frame, shadow or entrance', { skip: !chrome }, async (t) => {
  for (const size of ['16:9', 'shorts']) {
    // The clean look gives a clip rounded corners, a shadow and a pop entrance by default.
    const p = await project(t, { theme: 'clean', size }, {
      full: "s.clip('assets/two.mp4', { full: true, at: 0.2, x: 10, w: 50, frame: 'browser' });",
      plain: "s.clip('assets/two.mp4', { w: s.W, h: s.H, at: 0.2 });",
    });
    await withEngine(p, timeline(p, { full: 2, plain: 2 }), { scale: 0.25 }, async (page) => {
      const [justIn, later, plain] = await colors(page, [0.25, 0.9, 2.9], CORNERS);
      // Already whole a moment after it starts, and still whole while the camera drifts.
      assert.deepEqual(justIn, ['red', 'red', 'red', 'red', 'red'], size);
      assert.deepEqual(later, ['red', 'red', 'red', 'red', 'red'], size);
      // The same size without full keeps the look's rounded corners.
      assert.equal(plain[4], 'red');
      assert.ok(plain.slice(0, 4).includes('other'), `${size}: ${plain}`);
      const issues = await page.evaluate(() => window.explainroo.check());
      assert.deepEqual(issues.filter((i) => i.level === 'error'), [], size);
    });
  }
});

test("speed: 'fit' makes a clip end with its scene, from half speed to twice the speed, and check reports any freeze with its length", { skip: !chrome }, async (t) => {
  const p = await project(t, { theme: 'clean', camera: 'still' }, {
    // Two seconds in four: half speed, so red for two seconds and then green.
    slow: "s.clip('assets/two.mp4', { full: true, speed: 'fit', at: 0 });",
    // Two seconds in one: twice the speed, and nothing freezes.
    fast: "s.clip('assets/two.mp4', { full: true, speed: 'fit', at: 0 });",
    // Two seconds in six would need a third of the speed, so it plays at half and freezes for two.
    long: "s.clip('assets/two.mp4', { full: true, speed: 'fit', at: 0 });",
    // At its own speed it ends at 2.0 and the scene at 2.2, and a freeze that short is fine.
    short: "s.clip('assets/two.mp4', { full: true, at: 0 });",
    // Without fit it freezes for two seconds.
    plain: "s.clip('assets/two.mp4', { full: true, at: 0 });",
  });
  const tl = timeline(p, { slow: 4, fast: 1, long: 6, short: 2.2, plain: 4 });
  await withEngine(p, tl, { scale: 0.25 }, async (page) => {
    const center = [[0.5, 0.5]];
    const at = (scene, local) => tl.scenes.find((s) => s.id === scene).start + local;
    const seen = (await colors(page, [at('slow', 1.5), at('slow', 2.5), at('fast', 0.4), at('fast', 0.6), at('plain', 1.5)], center)).map(([c]) => c);
    assert.deepEqual(seen, ['red', 'green', 'red', 'green', 'green']);
    const issues = await page.evaluate(() => window.explainroo.check());
    const freezes = issues.filter((i) => /freezes on its last frame/.test(i.message));
    assert.deepEqual(freezes.map((i) => [i.scene, i.level]), [['long', 'warn'], ['plain', 'warn']], JSON.stringify(issues));
    const long = freezes.find((i) => i.scene === 'long');
    assert.match(long.message, /^clip "assets\/two\.mp4" freezes on its last frame for 2\.0s, from 4\.00s until 6\.00s\. speed: 'fit' goes no slower than 0\.5 times the clip's speed, and this one needs slower\. Use loop: true, a longer clip or an earlier out$/);
    assert.match(freezes.find((i) => i.scene === 'plain').message, /for 2\.0s, from 2\.00s until 4\.00s\. speed: 'fit' plays it slower, so it ends with the scene, and loop: true repeats it$/);
    // A wrong speed names 'fit' too.
    const bad = await page.evaluate(async () => {
      const { boot } = await import('/engine/runtime.js');
      const { engine } = await boot({ canvas: document.createElement('canvas'), scale: 0.25 });
      engine.scenesModule = { slow(s) { s.clip('assets/two.mp4', { speed: 'fast' }); } };
      const found = engine.check();
      engine.clipFrames.close();
      return found;
    });
    assert.ok(bad.some((i) => i.level === 'error' && i.message === "clip speed must be from 0.25 to 4, or 'fit'"), JSON.stringify(bad));
  });
});

// A clip that fills the frame is a picture, also while the camera crops it, and a
// close-up cuts it on purpose. The bees on the comb behind a title, as a scene of
// a real project had them.
test('a full clip counts as a picture for the cover, no camera cut is reported for it, and the camera never moves to it', { skip: !chrome }, async (t) => {
  const p = await project(t, { defaults: '0.5', camera: 'auto' }, {
    hook: "s.clip('assets/two.mp4', { full: true, at: 0, loop: true }); s.title('How bees make honey', { y: s.safe.top + s.safe.h * 0.3, size: 60, at: 0.6 }); s.note('every drop', { x: 600, y: 800, size: 30, at: 1.6 });",
  });
  const tl = timeline(p, { hook: 4 });
  await withEngine(p, tl, { scale: 0.25 }, async (page) => {
    const { issues, framed, cameras, moment } = await page.evaluate(() => ({ issues: window.explainroo.check(0.25), cameras: window.explainroo.cameras(), moment: window.explainroo.coverMoment(), framed: window.explainroo.framed(0, 2.5) }));
    assert.equal(framed.picture, true);
    assert.equal(framed.onlyText, false);
    assert.deepEqual(issues.filter((i) => /cuts off/.test(i.message)), [], JSON.stringify(issues));
    assert.equal(await page.evaluate((T) => window.explainroo.coverIssue(null, true), null), null);
    assert.ok(moment >= 0);
    // Whatever the camera does, no shot is about the clip alone: it is a background.
    for (const shot of Object.values(cameras).flatMap((c) => [c.start, ...c.moves.map((m) => m.to)])) assert.ok(shot.z >= 1);
    assert.ok(!Object.values(cameras).some((c) => (c.elements ?? []).some((e) => e.kind === 'image' && e.box.w >= 1900)), JSON.stringify(cameras));
  });
});
