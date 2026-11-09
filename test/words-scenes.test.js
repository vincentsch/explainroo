// words takes several scene names, and an unknown one is an error that names
// the scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, tinyProject } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

function project(t) {
  const dir = tinyProject(t, {}, { narrated: false });
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny\n\n## hook\nWhich model?\n\n## why\nA gateway.\n\n## tip\nTry it.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { hook() {}, why() {}, tip() {} };');
  for (const id of ['hook', 'why', 'tip']) cachedVoice(dir, id);
  return dir;
}

test('words lists every scene it is given, in the order of the video', async (t) => {
  const dir = project(t);
  const r = await runCli(['words', dir, 'tip', 'hook', '--json']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(JSON.parse(r.stdout).scenes.map((s) => s.scene), ['hook', 'tip']);
  const text = await runCli(['words', dir, 'hook', 'why', 'tip']);
  assert.match(text.stdout, /^hook: .*\n[\s\S]*\n\nwhy: [\s\S]*\n\ntip: /);
});

test('words fails on a scene name it doesn\'t know, and names the scenes', async (t) => {
  const dir = project(t);
  const r = await runCli(['words', dir, 'hook', 'whyy', 'end']);
  assert.equal(r.code, 1);
  assert.match(r.text, /there is no scene "whyy" or "end" in script\.md\. Its scenes are: hook, why, tip/);
});
