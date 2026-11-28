import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { buildTimeline } from '../src/timeline.js';

let chrome;
try { chrome = findChrome(); } catch {}

test('s.beat and s.bar give the scene times of the beats of the music, counted from 1 in each scene', { skip: !chrome && 'no browser here' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-beat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'studio', size: '320x180', captions: false, music: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## a {bars=2}\n\n## b {bars=2}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {
    a(s) { globalThis.__a = { beat1: s.beat(1), beat2: s.beat(2), bar2: s.bar(2) }; },
    b(s) {
      globalThis.__b = { beat1: s.beat(1), offbeat: s.beat(2.5), bar2: s.bar(2) };
      try { s.beat(0); } catch (e) { globalThis.__b.error = e.message; }
    },
  };`);
  const project = loadProject(dir);
  const timeline = buildTimeline(project, {});
  const { beat, bar, start } = timeline.music;
  await withEngine(project, timeline, {}, async (page) => {
    await page.evaluate((T) => window.explainroo.stills([{ T, path: 'out/a.png' }, { T: T + 2 * 4 * 60 / 112, path: 'out/b.png' }]), 0.5);
    const a = await page.evaluate(() => globalThis.__a);
    const b = await page.evaluate(() => globalThis.__b);
    // The first scene starts at 0 and the music's first beat at `start`.
    assert.ok(Math.abs(a.beat1 - start) < 1e-9 && Math.abs(a.beat2 - (start + beat)) < 1e-9, JSON.stringify(a));
    assert.ok(Math.abs(a.bar2 - (start + bar)) < 1e-9);
    // The second scene starts on a bar line, in whole frames, so its first beat is at once.
    const frame = 1 / project.config.fps;
    assert.ok(Math.abs(b.beat1) <= frame / 2 + 1e-9, JSON.stringify(b));
    assert.ok(Math.abs(b.offbeat - b.beat1 - 1.5 * beat) < 1e-9);
    assert.ok(Math.abs(b.bar2 - b.beat1 - bar) < 1e-9);
    assert.match(b.error, /s\.beat counts from 1, the first beat in the scene/);
  });
});
