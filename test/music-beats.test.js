import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMusic, musicPlan } from '../engine/audio/music.js';
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
  // The grid, and the bar line where the last scene ends, for the closing hit.
  const { close, ...beats } = tl.music;
  assert.deepEqual(beats, grid);
  assert.equal(close, 7);
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
  assert.deepEqual(grid, { bpm: 120, start: 0.5, beat: 0.5, bar: 2, close: 2 });
  assert.throws(() => loadProject(file({ src: 'assets/song.mp3', bpm: 300 })), /music\.bpm must be the tempo of the file in beats a minute, from 40 to 240/);
  assert.throws(() => loadProject(file({ src: 'assets/song.mp3', offset: 1 })), /music\.offset goes with music\.bpm/);
});

test('the closing hit lands on the bar line where the last scene ends, at any pace', (t) => {
  for (const settings of [{ pace: 1.5 }, { end: 1 }]) {
    const p = loadProject(project(t, { music: true, ...settings }, '## a {bars=2}\n\n## b {bars=2}\n'));
    const tl = buildTimeline(p, {});
    assert.equal(tl.music.close, 4, JSON.stringify(settings));
    // As the soundtrack calls it: with the tempo that pace gives the music.
    const { plan } = createMusic({ ...p.config.music, bpm: musicPlan(p.config.music).bpm, duration: tl.duration, sampleRate: 8000, groove: true, ringOut: 1, bars: tl.music.close });
    assert.ok(Math.abs(plan.endHit - (tl.music.start + 4 * tl.music.bar)) < 1e-9, JSON.stringify(settings));
  }
});

test('the first bar of a scene is never before the first beat of a music file, and bars do not go with targetSeconds', (t) => {
  const dir = project(t, { music: { src: 'assets/song.mp3', bpm: 120, offset: 3.2 } }, '## a {bars=1}\n');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/song.mp3'), '');
  const tl = buildTimeline(loadProject(dir), {});
  assert.ok(tl.scenes[0].dur - loadProject(dir).config.end >= 3.2 + 2 - 0.02, `the scene ends one bar after the first beat: ${tl.scenes[0].dur}`);
  assert.throws(() => buildTimeline(loadProject(project(t, { music: true, targetSeconds: 20 }, '## a {bars=2}\n')), {}), /\{bars=2\}, and "targetSeconds" sets the length of the video too/);
});

test('voice --estimate gives the length of a video without narration and the tempo of its music', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const dir = project(t, { music: 'warm' }, '## a {bars=2}\n\n## b {bars=3}\n');
  const r = spawnSync(process.execPath, [new URL('../bin/explainroo.js', import.meta.url).pathname, 'voice', dir, '--estimate'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /script\.md has no narration, so its scenes set the length: 15\.7 s, with the end of the video\. The music plays at 84 beats a minute, so a bar lasts 2\.86 s\./);
});
