import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject, normalizeConfig, outputPath, FORMATS } from '../src/project.js';
import { prepare, reloadProject } from '../src/pipeline.js';
import { sceneHash, voicePaths } from '../src/voice.js';
import { speechChunks } from '../src/script.js';
import { Stage } from '../engine/stage.js';
import { getTheme } from '../engine/themes.js';
import { layoutAreas } from '../engine/layout.js';

function fixture(t, raw = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-multi-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'youtube', ...raw }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## intro {min=1}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) {} };');
  return dir;
}

test('size overrides normalize captions, dimensions and safe areas without changing the project file', t => {
  const dir = fixture(t);
  const before = fs.readFileSync(path.join(dir, 'video.json'), 'utf8');
  for (const size of [...Object.keys(FORMATS), '16:9', '9:16', '1:1', '4:5', '1080x1350']) {
    const project = loadProject(dir, { size });
    const expected = normalizeConfig({ size });
    for (const key of ['size', 'format', 'width', 'height', 'captions', 'safe']) assert.deepEqual(project.config[key], expected[key], `${size}: ${key}`);
    assert.deepEqual(layoutAreas(project.config, project.config.width, project.config.height), layoutAreas(expected, expected.width, expected.height));
    assert.equal(project.config.captions, expected.height >= expected.width);
    assert.equal(project.sizeOverride, size);
    assert.equal(reloadProject(project).config.size, size);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'), before);
  assert.equal(loadProject(dir).config.size, 'youtube');
  assert.equal(loadProject(dir).sizeOverride, undefined);
  assert.throws(() => loadProject(dir, { size: 'bad' }), /size must be/);
  assert.throws(() => loadProject(dir, { size: '1081x1350' }), /even numbers/);
});

test('overriding a platform size clears its safe area and recalculates auto captions', t => {
  const dir = fixture(t, { size: 'tiktok' });
  const cfg = loadProject(dir, { size: 'youtube' }).config;
  assert.equal(cfg.captions, false);
  assert.equal(cfg.safe, null);
  const areas = layoutAreas(cfg, cfg.width, cfg.height);
  assert.equal(areas.app, null);
  assert.equal(areas.band, null);
  const platform = loadProject(dir).config;
  const tall = layoutAreas(platform, platform.width, platform.height);
  assert.ok(tall.app);
  assert.ok(tall.safe.top > tall.app.top);
  assert.ok(tall.safe.bottom < tall.band.top);
});

test('explicit captions settings survive a size override', t => {
  for (const captions of [true, false]) {
    const dir = fixture(t, { captions });
    for (const size of ['youtube', 'tiktok', 'square']) assert.equal(loadProject(dir, { size }).config.captions, captions);
  }
});

test('output paths keep existing names or add the explicit size to every output type', () => {
  const project = { paths: { out: '/tmp/video/out' } };
  const names = [
    ['video', '.mp4'], ['draft', '.mp4'], ['video', '.gif'], ['draft', '.gif'],
    ['video', '.srt'], ['video', '.vtt'], ['video', '.cover.jpg'], ['video', '.chapters.txt'],
    ['draft', '.srt'], ['draft', '.vtt'], ['draft', '.cover.jpg'], ['draft', '.chapters.txt'],
    ['stills', ''], ['sheet', '.jpg'], ['sheet-intro', '.jpg'],
  ];
  for (const [name, ext] of names) {
    assert.equal(outputPath(project, name, ext), path.resolve(`/tmp/video/out/${name}${ext}`));
    for (const size of ['tiktok', 'youtube', '9:16', '1:1', '1080x1350']) {
      assert.equal(outputPath({ ...project, sizeOverride: size }, name, ext), path.resolve(`/tmp/video/out/${name}-${size.replace(':', '-')}${ext}`));
    }
  }
  for (const sizeOverride of [undefined, 'tiktok']) {
    for (const name of ['video', 'draft']) {
      assert.equal(outputPath({ ...project, sizeOverride }, name, '.mp4', 'chosen.mp4'), path.resolve('chosen.mp4'));
      assert.equal(outputPath({ ...project, sizeOverride }, name, '.gif', '/tmp/chosen.gif'), path.resolve('/tmp/chosen.gif'));
    }
  }
});

test('portrait is true only when the frame is taller than wide', () => {
  for (const size of ['youtube', 'vertical', 'linkedin', 'square', '400x400', '800x600']) {
    const config = normalizeConfig({ size });
    const { width: W, height: H } = config;
    const engine = { config, W, H, theme: getTheme('paper'), safeArea: layoutAreas(config, W, H).safe,
      timeline: { duration: 1, frames: 30, fps: 30, width: W, height: H, scenes: [{}] } };
    const scene = { id: 'intro', index: 0, start: 0, dur: 1, words: [], marks: {} };
    assert.equal(new Stage(engine, null, scene, 0).portrait, H > W, size);
  }
});

test('sizes share voice hashes and caches, while prepare rebuilds the timeline for the current frame', async t => {
  const dir = fixture(t);
  const wide = loadProject(dir);
  const tall = loadProject(dir, { size: 'vertical' });
  const { timeline: first } = await prepare(wide);
  const voiceFile = voicePaths(wide, 'intro').json;
  const mtime = fs.statSync(voiceFile).mtimeMs;
  const { timeline: second } = await prepare(tall);
  assert.equal(voicePaths(tall, 'intro').json, voiceFile);
  assert.equal(fs.statSync(voiceFile).mtimeMs, mtime);
  assert.deepEqual(first.scenes, second.scenes);
  assert.equal(first.duration, second.duration);
  assert.equal(first.width, 1920);
  assert.equal(second.width, 1080);
  assert.equal(second.height, 1920);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'build/timeline.json'), 'utf8')), second);
  const scene = { ...wide.script.scenes[0], units: [{ type: 'word', display: 'Hello', spoken: 'Hello' }] };
  const chunks = speechChunks(scene.units);
  assert.equal(sceneHash(scene, chunks, wide.config), sceneHash(scene, chunks, tall.config));
});
