import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPlayer, localModules, exportPlayer } from '../src/export.js';
import { loadProject } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', _private: 'SECRET', images: { style: 'PRIVATE NOTES' }, fonts: [{ family: 'Own', src: 'assets/own.woff2' }, { family: 'Unused', src: 'assets/unused.woff2' }] }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## intro {min=3}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "import { draw } from './lib/draw.mjs'; export default { intro: draw };");
  fs.writeFileSync(path.join(dir, 'lib/draw.mjs'), "export { draw } from '../helper.js';");
  fs.writeFileSync(path.join(dir, 'helper.js'), 'export function draw(s) { s.title("Hello"); }');
  for (const name of ['used.svg', 'unused.svg', 'own.woff2', 'unused.woff2', '.env', 'secret.json', 'notes.txt', 'notes.md']) fs.writeFileSync(path.join(dir, 'assets', name), name.includes('svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'SECRET');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET');
  fs.mkdirSync(path.join(dir, 'build/clips'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build/clips/frame.jpg'), 'extracted');
  const project = loadProject(dir);
  return { dir, project, timeline: buildTimeline(project, {}) };
}

function files(dir) { return fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => f.split(path.sep).join('/')).sort(); }

test('player copies only used assets, font families and local modules, with public state', t => {
  const { dir, project, timeline } = fixture(t);
  const out = path.join(dir, 'player');
  const math = { '["x",true]': { paths: ['M0 0'], viewBox: [0, 0, 1, 1] } };
  copyPlayer(project, timeline, { assets: ['assets/used.svg', 'assets/own.woff2'], fonts: ['Inter', 'Own'], math }, out);
  const names = files(out);
  for (const name of ['index.html', 'engine/player.js', 'engine/runtime.js', 'vendor/rough.js', 'engine/icons/lucide.json', 'project/scenes.js', 'project/lib/draw.mjs', 'project/helper.js', 'project/assets/used.svg', 'project/assets/own.woff2', 'state.json', 'math.json', 'subtitles.vtt']) assert.ok(names.includes(name), name);
  assert.deepEqual(names.filter(n => n.startsWith('project/assets/')), ['project/assets/own.woff2', 'project/assets/used.svg']);
  assert.ok(!names.some(n => /build|\.env|secret|notes|unused|soundtrack|upload/.test(n)));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'fonts/fonts.json'), 'utf8'));
  assert.deepEqual([...new Set(manifest.map(f => f.family))], ['Inter']);
  assert.deepEqual(names.filter(n => n.startsWith('fonts/') && n.endsWith('.woff2')).sort(), [...new Set(manifest.map(f => 'fonts/' + f.file))].sort());
  const state = JSON.parse(fs.readFileSync(path.join(out, 'state.json'), 'utf8'));
  assert.deepEqual(Object.keys(state).sort(), ['assets', 'config', 'timeline', 'title', 'version']);
  assert.deepEqual(state.assets, ['assets/used.svg']);
  assert.deepEqual(state.config.fonts.map(f => f.family), ['Own']);
  assert.deepEqual(state.timeline, timeline);
  assert.match(state.version, /^[a-f\d]{12}$/);
  assert.ok(!JSON.stringify(state).includes('SECRET'));
  assert.ok(!JSON.stringify(state).includes('PRIVATE NOTES'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'math.json'), 'utf8')), math);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(url.startsWith('./'), url);
  assert.ok(!html.includes('http:') && !html.includes('https:'));
});

test('export follows local imports, refusing private files, outside symlinks and remote modules', t => {
  const { dir, project, timeline } = fixture(t);
  assert.deepEqual([...localModules(dir).keys()], ['scenes.js', 'lib/draw.mjs', 'helper.js']);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `// import 'https://example.com/no.js';
    const label = "import './missing.js'";
    /* export { draw } from './private.js'; */
    import('./lib/draw.mjs?v=1'); export default {};`);
  assert.deepEqual([...localModules(dir).keys()], ['scenes.js', 'lib/draw.mjs', 'helper.js']);
  const out = path.join(dir, 'player');
  for (const rel of ['assets/.env', 'assets/secret.json', 'assets/notes.txt', '../outside.png']) assert.throws(() => copyPlayer(project, timeline, { assets: [rel], fonts: [], math: {} }, out), /cannot be exported/);
  fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'assets/fake.png'));
  assert.throws(() => copyPlayer(project, timeline, { assets: ['assets/fake.png'], fonts: [], math: {} }, out), /cannot be exported/);
  fs.symlinkSync(path.join(os.tmpdir(), 'outside.js'), path.join(dir, 'outside.js'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), "import 'https://example.com/scenes.js';");
  assert.throws(() => localModules(dir), /relative local import/);
  fs.writeFileSync(path.join(dir, 'scenes.js'), "import '/absolute/scenes.js';");
  assert.throws(() => localModules(dir), /relative local import/);
  fs.writeFileSync(path.join(dir, 'scenes.js'), "import('./.private.js');");
  assert.throws(() => localModules(dir), /cannot be exported/);
});

test('export leaves a non-player output folder alone', async t => {
  const { dir, project } = fixture(t);
  const out = path.join(dir, 'keep');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'notes.txt'), 'Keep me');
  await assert.rejects(exportPlayer(project, { out }), /Choose an empty folder/);
  assert.equal(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8'), 'Keep me');
  assert.equal(fs.existsSync(path.join(dir, 'build/voice')), false);
});
