import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { speechChunks } from '../src/script.js';
import { sceneHash, voicePaths } from '../src/voice.js';
import { writeWav } from '../src/wav.js';
import { probe } from '../src/ffmpeg.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch {}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sizes-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', theme: 'clean', fps: 24, music: false, sfx: false, end: 0, lead: 0, hold: 0 }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Sizes\n\n## intro {min=0.5 chapter="Intro"}\nHello.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { intro(s) {
    s.text(s.portrait ? 'Tall' : 'Wide', { x: s.cx, y: s.safe.y + s.safe.h / 2, size: s.W * 0.05, at: 0 });
  } };`);
  // A short cached tone avoids loading speech models for output tests.
  const project = loadProject(dir);
  const scene = project.script.scenes[0];
  const chunks = speechChunks(scene.units, project.config);
  fs.mkdirSync(project.paths.voice, { recursive: true });
  const files = voicePaths(project, scene.id);
  writeWav(files.wav, Float32Array.from({ length: 6000 }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
  fs.writeFileSync(files.json, JSON.stringify({ hash: sceneHash(scene, chunks, project.config), id: scene.id,
    duration: 0.25, words: [{ text: 'Hello.', spoken: 'Hello.', start: 0, end: 0.25, matched: true }],
    marks: {}, chunks: [{ start: 0, end: 0.25, text: 'Hello.' }], transcript: 'Hello.', matchRate: 1, unmatched: [] }));
  return dir;
}

function run(command, dir, flags = []) {
  const r = spawnSync(process.execPath, [bin, command, dir, ...flags, '--json'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, `${command}: ${r.stderr}\n${r.stdout}`);
  return JSON.parse(r.stdout);
}

test('CLI renders use size names for every extra file and --out wins with and without --draft', { skip: !chrome, timeout: 300000 }, async t => {
  const dir = fixture(t);
  const voiceFile = voicePaths(loadProject(dir), 'intro').json;
  const mtime = fs.statSync(voiceFile).mtimeMs;
  const cases = [
    [[], 'video'],
    [['--draft'], 'draft'],
    [['--out', path.join(dir, 'plain.mp4')], '../plain'],
    [['--draft', '--out', path.join(dir, 'plain-draft.mp4')], '../plain-draft'],
    [['--size', 'tiktok'], 'video-tiktok'],
    [['--size', 'tiktok', '--draft'], 'draft-tiktok'],
    [['--size', 'youtube', '--out', path.join(dir, 'custom.mp4')], '../custom'],
    [['--size', 'youtube', '--draft', '--out', path.join(dir, 'custom-draft.mp4')], '../custom-draft'],
  ];
  for (const [flags, name] of cases) {
    const result = run('render', dir, [...flags, '--scale', '0.1', '--workers', '1']);
    const base = path.resolve(dir, 'out', name);
    assert.equal(result.out, `${base}.mp4`);
    assert.deepEqual(result.subtitles, { srt: `${base}.srt`, vtt: `${base}.vtt` });
    assert.equal(result.cover, `${base}.cover.jpg`);
    assert.equal(result.chapters, `${base}.chapters.txt`);
    for (const ext of ['mp4', 'srt', 'vtt', 'cover.jpg', 'chapters.txt']) assert.ok(fs.statSync(`${base}.${ext}`).size > 0);
    const info = await probe(result.out);
    const video = info.streams.find(s => s.codec_type === 'video');
    assert.equal(video.width, result.width);
    assert.equal(video.height, result.height);
  }
  assert.equal(fs.statSync(voiceFile).mtimeMs, mtime);
  assert.ok(fs.existsSync(path.join(dir, 'out/video.mp4')));
  assert.ok(fs.existsSync(path.join(dir, 'out/video-tiktok.mp4')));
});

test('CLI still, sheet and check use the override, while existing names stay unchanged', { skip: !chrome, timeout: 180000 }, t => {
  const dir = fixture(t);
  for (const [flags, suffix] of [[[], ''], [['--size', 'tiktok'], '-tiktok']]) {
    const still = run('still', dir, [...flags, '--scale', '0.1']).stills[0];
    assert.equal(still.file, path.join(dir, `out/stills${suffix}/intro@end.png`));
    assert.ok(fs.statSync(still.file).size > 0);
    for (const scene of [null, 'intro']) {
      const result = run('sheet', dir, [...flags, ...(scene ? ['--scene', scene] : [])]);
      assert.equal(result.file, path.join(dir, `out/sheet${scene ? '-intro' : ''}${suffix}.jpg`));
      assert.ok(fs.statSync(result.file).size > 0);
    }
    const result = run('check', dir, flags);
    assert.deepEqual(result.issues.filter(i => i.level !== 'hint'), []);
    const timeline = JSON.parse(fs.readFileSync(path.join(dir, 'build/timeline.json'), 'utf8'));
    assert.equal(timeline.width, suffix ? 1080 : 320);
    assert.equal(timeline.height, suffix ? 1920 : 180);
  }
});

test('preview keeps the size override after settings change', { timeout: 15000 }, async t => {
  const dir = fixture(t);
  const child = spawn(process.execPath, [bin, 'preview', dir, '--size', 'tiktok', '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  const until = async fn => {
    for (let i = 0; i < 80; i++) {
      const value = await fn();
      if (value) return value;
      await setTimeout(100);
    }
    assert.fail(`preview did not update: ${logs}`);
  };
  try {
    const url = await until(() => /preview: (http:\/\/127\.0\.0\.1:\d+)/.exec(logs)?.[1]);
    const state = async () => (await fetch(url + '/__state.json')).json();
    const first = await state();
    assert.equal(first.config.size, 'tiktok');
    assert.equal(first.config.captions, true);
    assert.equal(first.timeline.height, 1920);
    const settings = path.join(dir, 'video.json');
    fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), size: 'square', title: 'Changed' }));
    const changed = await until(async () => { const s = await state(); return s.title === 'Changed' && s; });
    assert.equal(changed.config.size, 'tiktok');
    assert.equal(changed.config.captions, true);
    assert.deepEqual(changed.config.safe, first.config.safe);
    assert.equal(changed.timeline.width, 1080);
    assert.equal(changed.timeline.height, 1920);
    assert.notEqual(changed.version, first.version);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
