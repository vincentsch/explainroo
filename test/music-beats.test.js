import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMusic } from '../engine/audio/music.js';
import { BLOCK } from '../engine/audio/synth.js';
import { loadProject } from '../src/project.js';
import { buildTimeline, musicGrid } from '../src/timeline.js';

function project(t, settings, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-beats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'studio', size: '640x360', ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};');
  return dir;
}

// The music's energy in its first seconds, in a mono mix.
function opening(options, seconds = 4, sr = 16000) {
  const { synth, plan } = createMusic({ style: 'upbeat', duration: 12, sampleRate: sr, ...options });
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  let sum = 0;
  for (let i0 = 0; i0 < seconds * sr; i0 += BLOCK) {
    L.fill(0);
    R.fill(0);
    synth.renderBlock(i0, BLOCK, L, R);
    for (let k = 0; k < BLOCK; k++) sum += L[k] * L[k];
  }
  return { rms: Math.sqrt(sum / (seconds * sr)), plan };
}

test('music for a video without narration starts in its groove, and its closing hit lands on the last bar line', () => {
  const quiet = opening({});
  const groove = opening({ groove: true, ringOut: 1 });
  assert.ok(groove.rms > quiet.rms * 1.6, `drums from the first bar: ${groove.rms} against ${quiet.rms}`);
  // 12 seconds at 112 bpm: the usual ring of 1.8 seconds leaves 4 bars, a ring of 1 second 5.
  assert.equal(quiet.plan.bars, 4);
  assert.equal(groove.plan.bars, 5);
  assert.ok(Math.abs(groove.plan.endHit - (0.05 + 5 * groove.plan.barLen)) < 1e-9);
});

test('scenes with bars end on the bar lines of the music, and the end of the video holds after the last one', (t) => {
  const dir = project(t, { music: true, end: 1.4 }, '## a {bars=2}\n\n## b {bars=4}\n\n## c {bars=1}\n');
  const p = loadProject(dir);
  const grid = musicGrid(p.config);
  assert.equal(grid.bpm, 112);
  const tl = buildTimeline(p, {});
  assert.deepEqual(tl.music, grid);
  const frame = 1 / p.config.fps;
  let bars = 0;
  for (const [i, n] of [2, 4, 1].entries()) {
    bars += n;
    const sc = tl.scenes[i];
    const end = sc.start + sc.dur - (i === 2 ? 1.4 : 0);
    assert.ok(Math.abs(end - (grid.start + bars * grid.bar)) <= frame / 2 + 1e-9, `scene ${sc.id} ends at ${end}, bar line ${grid.start + bars * grid.bar}`);
  }
  // A faster pace plays the built-in music faster, and bars follow it.
  const fast = loadProject(project(t, { music: true, pace: 1.44 }, '## a {bars=2}\n'));
  assert.ok(Math.abs(musicGrid(fast.config).bpm - 112 * 1.2) < 1e-6);
});

test('bars need music with a tempo, and say how to get one', (t) => {
  assert.throws(() => buildTimeline(loadProject(project(t, { music: false }, '## a {bars=2}\n')), {}), /scene "a" lasts \{bars=2\}, and bars need music\. Turn on the built-in music with "music": true/);
  assert.throws(() => loadProject(project(t, {}, '## a {bars=0}\n')), /bars is how many bars of the music the scene lasts, a whole number like \{bars=4\}, not "0"/);
  assert.throws(() => loadProject(project(t, {}, '## a {bars=2.5}\n')), /not "2\.5"/);
  // A music file has a tempo when it says so.
  const file = (music) => {
    const dir = project(t, { music }, '## a {bars=2}\n');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets/song.mp3'), '');
    return dir;
  };
  assert.throws(() => buildTimeline(loadProject(file({ src: 'assets/song.mp3' })), {}), /bars need the tempo of the music file\. Add "bpm" to the "music" block/);
  const grid = buildTimeline(loadProject(file({ src: 'assets/song.mp3', bpm: 120, offset: 0.5 })), {}).music;
  assert.deepEqual(grid, { bpm: 120, start: 0.5, beat: 0.5, bar: 2 });
  assert.throws(() => loadProject(file({ src: 'assets/song.mp3', bpm: 300 })), /music\.bpm must be the tempo of the file in beats a minute, from 40 to 240/);
  assert.throws(() => loadProject(file({ src: 'assets/song.mp3', offset: 1 })), /music\.offset goes with music\.bpm/);
});
