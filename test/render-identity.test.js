import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject, normalizeConfig } from '../src/project.js';
import { parseScript, speechChunks } from '../src/script.js';
import { sceneHash } from '../src/voice.js';
import { buildTimeline } from '../src/timeline.js';
import { makeState, renderIdentity, renderingCodeHash } from '../src/pipeline.js';
import { readVersions, sha256File } from '../src/history.js';
import { findChrome } from '../src/browser.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
let chrome = null;
try { chrome = findChrome(); } catch {}

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-identity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeProject(t, script = '# Test\n## first {min=1}\n') {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'lib/deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24 }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'lib/deep/helper.js'), 'export const size = 40;\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "import { size } from './lib/deep/helper.js';\nexport default { first(s) { s.title('Hi', { size, at: 0 }); } };\n");
  return dir;
}

function identity(dir) {
  const project = loadProject(dir);
  const timeline = buildTimeline(project, {});
  return { project, timeline, identity: renderIdentity(project, timeline), version: makeState(project, timeline).version };
}

test('editing a helper in a subfolder changes the identity, while the page version and the voice cache stay', (t) => {
  const dir = makeProject(t, '# Test\n## first\nHello there.\n');
  const before = identity(dir);
  const scene = before.project.script.scenes[0];
  const hash = sceneHash(scene, speechChunks(scene.units), before.project.config);
  fs.writeFileSync(path.join(dir, 'lib/deep/helper.js'), 'export const size = 41;\n');
  const after = identity(dir);
  assert.notEqual(after.identity, before.identity);
  assert.equal(after.version, before.version);
  const edited = after.project.script.scenes[0];
  assert.equal(sceneHash(edited, speechChunks(edited.units), after.project.config), hash);
});

test('the identity covers scripts in any folder, and leaves out build, out, history, assets, node_modules and dot folders', (t) => {
  const dir = makeProject(t);
  const write = (rel, text = 'export default 1;\n') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  // Files with the same stamps as the page sees them today.
  for (const folder of ['build', 'out', 'history', 'node_modules', '.hidden', 'lib/node_modules', 'lib/.hidden']) write(`${folder}/x.js`);
  const base = identity(dir).identity;
  for (const folder of ['build', 'out', 'history', 'node_modules', '.hidden', 'lib/node_modules', 'lib/.hidden']) write(`${folder}/x.js`, 'export default 2;\n');
  assert.equal(identity(dir).identity, base);
  write('lib/other.mjs');
  const withMjs = identity(dir).identity;
  assert.notEqual(withMjs, base);
  write('lib/build/x.js');
  assert.notEqual(identity(dir).identity, withMjs, 'only the top folder called build is left out');
});

test('the same project gives the same identity, and settings change it', (t) => {
  const dir = makeProject(t);
  const base = identity(dir);
  assert.equal(identity(dir).identity, base.identity);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, watermark: false }));
  assert.notEqual(identity(dir).identity, base.identity);
  assert.notEqual(makeState(loadProject(dir), base.timeline).version, base.version);
  assert.equal(normalizeConfig({}).watermark, 'explainroo.com');
});

test('the rendering code in the identity is the version, engine/ and the Node files that shape frames and sound', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'engine/audio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'));
  for (const rel of ['engine/stage.js', 'engine/audio/mix.js', 'src/render.js', 'src/ffmpeg.js', 'src/pipeline.js', 'src/sounds.js', 'src/voice.js']) fs.writeFileSync(path.join(root, rel), rel);
  const base = renderingCodeHash(root, '1.0.0');
  assert.equal(renderingCodeHash(root, '1.0.0'), base);
  assert.notEqual(renderingCodeHash(root, '1.0.1'), base);
  for (const rel of ['engine/stage.js', 'engine/audio/mix.js', 'src/render.js', 'src/ffmpeg.js', 'src/pipeline.js', 'src/sounds.js']) {
    fs.appendFileSync(path.join(root, rel), 'x');
    const changed = renderingCodeHash(root, '1.0.0');
    assert.notEqual(changed, base, rel);
    fs.writeFileSync(path.join(root, rel), rel);
  }
  fs.appendFileSync(path.join(root, 'src/voice.js'), 'x');
  assert.equal(renderingCodeHash(root, '1.0.0'), base, 'the voice code stays out, so it never makes a voice again');
});

test('each finished render adds a line with its range, scale and identity, and verify adds its result', { skip: !chrome && 'no browser here' }, (t) => {
  const dir = makeProject(t);
  const render = (...flags) => {
    const r = spawnSync(process.execPath, [bin, 'render', dir, '--workers', '1', '--json', ...flags], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const full = render();
  const draft = render('--draft');
  const part = render('--from', '0.25', '--to', '0.75', '--out', path.join(dir, 'out/part.mp4'));
  const small = render('--scale', '0.5', '--out', path.join(dir, 'out/small.mp4'));
  const gif = render('--format', 'gif');
  const lines = readVersions(dir);
  assert.deepEqual(lines.map((l) => l.file), ['out/video.mp4', 'out/draft.mp4', 'out/part.mp4', 'out/small.mp4', 'out/video.gif']);
  const [one, two, three, four, five] = lines;
  const { identity: current } = identity(dir);
  for (const [line, r] of [[one, full], [two, draft], [three, part], [four, small], [five, gif]]) {
    assert.ok(line.time);
    assert.equal(line.sha256, sha256File(r.out));
    assert.equal(line.sha256, r.sha256);
    assert.equal(line.identity, current);
    assert.equal(line.identity, r.identity);
    assert.equal(line.version, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    assert.equal(line.watermark, true);
    assert.equal(line.size, '320x180');
    assert.equal(line.transparent, false);
  }
  assert.equal(one.format, 'mp4');
  assert.equal(one.draft, false);
  assert.equal(one.scale, 1);
  assert.equal(one.full, true);
  assert.deepEqual([one.width, one.height, one.fps], [320, 180, 24]);
  assert.deepEqual(one.range, { from: 0, to: one.duration });
  assert.equal(two.draft, true);
  assert.equal(two.scale, 0.5);
  assert.deepEqual([two.width, two.height], [160, 90]);
  assert.equal(three.full, false);
  assert.deepEqual(three.range, { from: 6 / 24, to: 18 / 24 });
  assert.equal(three.duration, 0.5);
  assert.equal(four.scale, 0.5);
  assert.equal(four.draft, false);
  assert.equal(five.format, 'gif');
  assert.equal(five.fps, 15);

  const verified = spawnSync(process.execPath, [bin, 'verify', dir, '--json'], { encoding: 'utf8', timeout: 170000 });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const after = readVersions(dir);
  assert.equal(after.length, 5);
  assert.equal(after[0].verify.ok, true);
  assert.equal(after[0].verify.sha256, one.sha256);
  assert.equal(after[1].verify, undefined);
  const raw = fs.readFileSync(path.join(dir, 'history/versions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(raw.at(-1).event, 'verify');
  // The report names the file's hash, and the record says where the report is.
  assert.equal(raw.at(-1).report, 'out/report.json');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'out/report.json'), 'utf8')).sha256, one.sha256);
  // verify --file still writes out/report.json, as it always has.
  const other = spawnSync(process.execPath, [bin, 'verify', dir, '--file', path.join(dir, 'out/part.mp4'), '--json'], { encoding: 'utf8', timeout: 170000 });
  assert.equal(other.status, 0, other.stdout + other.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'out/report.json'), 'utf8')).sha256, three.sha256);
  assert.equal(readVersions(dir)[2].verify.report, 'out/report.json');

  const history = spawnSync(process.execPath, [bin, 'history', dir], { encoding: 'utf8' });
  assert.match(history.stdout, /Rendered versions/);
  assert.match(history.stdout, /out\/video\.mp4 .*final, full video, watermark on, verify passed/);
  assert.match(history.stdout, /out\/draft\.mp4 .*draft, full video, scale 0\.5, watermark on, not verified/);
  assert.match(history.stdout, /out\/part\.mp4 .*0\.25s to 0\.75s/);
  assert.equal(JSON.parse(spawnSync(process.execPath, [bin, 'history', dir, '--json'], { encoding: 'utf8' }).stdout).versions[0].verify.ok, true);

  // Editing a helper makes the old render out of date, and the record shows it.
  fs.writeFileSync(path.join(dir, 'lib/deep/helper.js'), 'export const size = 41;\n');
  assert.notEqual(identity(dir).identity, one.identity);
  assert.equal(fs.existsSync(path.join(dir, 'history/jobs')), false);
});

test('the cover is left out of the identity, since it is a picture next to the video', (t) => {
  const dir = makeProject(t);
  const base = identity(dir).identity;
  for (const cover of ['first@end', '0.5', 'first@0.2']) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, cover }));
    assert.equal(identity(dir).identity, base, cover);
  }
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, cover: 'first@0.2', captions: true }));
  assert.notEqual(identity(dir).identity, base);
});
