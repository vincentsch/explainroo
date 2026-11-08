// A finished render of one size says the script it was made from. When another
// size is made from a different script, voice, render and package name the file
// that is out of date, and never render it again on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { outdatedLine, outdatedRenders, scriptStamp } from '../src/pipeline.js';
import { versionLine } from '../src/render.js';
import { recordVersion, sha256File } from '../src/history.js';
import { formatPackage } from '../src/package.js';
import { main } from '../src/cli.js';
import { tinyProject } from './helpers/tiny-project.js';

// A finished render of `size` at `file`, made from the script `stamp`.
function finished(dir, { file = 'out/video-shorts.mp4', size = 'shorts', stamp, lang = 'en', ...fields }) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), `video of ${size} ${stamp}`);
  recordVersion(dir, { time: new Date().toISOString(), file, format: 'mp4', draft: false, transparent: false, scale: 1, full: true, size, lang, script: stamp, sha256: sha256File(path.join(dir, file)), ...fields });
}

test('every render records its language and what its script said', (t) => {
  const project = loadProject(tinyProject(t));
  const line = versionLine(project, { out: path.join(project.dir, 'out/video.mp4'), format: 'mp4', range: { from: 0, to: 1 } });
  assert.equal(line.lang, 'en');
  assert.equal(line.script, scriptStamp(project));
  // Markers, pauses and stars don't change what the script says.
  const dir = project.dir;
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny video\n\n## intro {min=1 chapter="Intro"}\n[#start] *Hello.* [pause 0.2]');
  assert.equal(scriptStamp(loadProject(dir)), scriptStamp(project));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny video\n\n## intro {min=1 chapter="Intro"}\nHello there.');
  assert.notEqual(scriptStamp(loadProject(dir)), scriptStamp(project));
});

test('a finished render of another size from another script is named, and nothing else is', (t) => {
  const dir = tinyProject(t);
  const project = loadProject(dir);
  finished(dir, { stamp: 'older' });
  assert.deepEqual(outdatedRenders(project), [{ file: 'out/video-shorts.mp4', size: 'shorts' }]);
  assert.equal(outdatedLine(outdatedRenders(project)[0]), 'out/video-shorts.mp4 (shorts) was made from the old script. Render it again so both say the same.');
  // Rendered again from this script, it is up to date.
  finished(dir, { stamp: scriptStamp(project) });
  assert.deepEqual(outdatedRenders(project), []);
  // A draft, a part, the same size, another language, a render from before the
  // record had the script, and a file that changed since are left out.
  finished(dir, { file: 'out/draft-shorts.mp4', stamp: 'older', draft: true });
  finished(dir, { file: 'out/part-shorts.mp4', stamp: 'older', full: false });
  finished(dir, { file: 'out/other.mp4', size: '320x180', stamp: 'older' });
  finished(dir, { file: 'out/es/video-shorts.mp4', stamp: 'older', lang: 'es' });
  finished(dir, { file: 'out/before.mp4', stamp: undefined });
  finished(dir, { file: 'out/changed.mp4', stamp: 'older' });
  fs.writeFileSync(path.join(dir, 'out/changed.mp4'), 'another file');
  assert.deepEqual(outdatedRenders(project), []);
  // A package says to package it again.
  finished(dir, { file: 'out/package/shorts/video.mp4', stamp: 'older', event: 'package', platform: 'shorts' });
  const [pkg] = outdatedRenders(project);
  assert.deepEqual(pkg, { file: 'out/package/shorts/video.mp4', size: 'shorts', platform: 'shorts' });
  assert.equal(outdatedLine(pkg), 'out/package/shorts/video.mp4 (shorts) was made from the old script. Package it again with --platform shorts so both say the same.');
});

test('voice names the out of date file in its table and its JSON, and package in its summary', async (t) => {
  const dir = tinyProject(t);
  finished(dir, { file: 'out/video-tiktok.mp4', size: 'tiktok', stamp: 'older' });
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  t.mock.method(process.stderr, 'write', () => true);
  assert.equal(await main(['voice', dir]), 0);
  assert.match(output, /^out\/video-tiktok\.mp4 \(tiktok\) was made from the old script\. Render it again so both say the same\.$/m);
  output = '';
  assert.equal(await main(['voice', dir, '--json']), 0);
  assert.deepEqual(JSON.parse(output).outdated, [{ file: 'out/video-tiktok.mp4', size: 'tiktok' }]);
  // The file itself is never touched.
  assert.equal(fs.readFileSync(path.join(dir, 'out/video-tiktok.mp4'), 'utf8'), 'video of tiktok older');
  const post = { platform: 'x', width: 1080, height: 1080, duration: 1, watermark: true, title: 'T', text: 'T', ai_label: true, ai_reasons: [], credits: [], files: { video: 'video.mp4', report: 'report.json' }, verify: { ok: true, errors: [], warnings: [], understood: 1 }, warnings: [] };
  const text = formatPackage({ platform: 'x', folder: dir, source: { how: 'rendered' }, verified: 'now', post, outdated: [{ file: 'out/video.mp4', size: '16:9' }] });
  assert.match(text, /^out\/video\.mp4 \(16:9\) was made from the old script\. Render it again so both say the same\.$/m);
});
