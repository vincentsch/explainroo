// clean: takes out of build/ what the next run makes again, and keeps the narration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ title: 'T' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## a\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a(s) {} };');
  const files = {
    'build/clips/aaa/00000000.jpg': 3000,
    'build/clips/aaa/00000001.jpg': 3000,
    'build/clips/bbb/00000000.jpg': 2000,
    'build/sounds/ccc.wav': 1500,
    'build/mix.wav': 900,
    'build/timeline.json': 100,
    'build/voice/a.wav': 5000,
    'build/voice/a.json': 200,
    'build/images/usage.jsonl': 50,
    'build/es/voice/a.wav': 4000,
    'build/es/segments/0.mp4': 700,
    'build/pace-1.2/voice/a.wav': 4000,
    'build/pace-1.2/mix.wav': 600,
  };
  for (const [rel, size] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), Buffer.alloc(size));
  }
  return dir;
}

const run = (...args) => {
  const r = spawnSync(process.execPath, [bin, 'clean', ...args], { encoding: 'utf8' });
  return { ...r, json: args.includes('--json') ? JSON.parse(r.stdout) : null };
};

test('clean lists what build/ holds that can be made again, with its size, and keeps the narration', (t) => {
  const dir = project(t);
  const dry = run(dir, '--dry-run', '--json');
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(dry.json.removed, [
    { path: 'build/clips/', bytes: 8000 },
    { path: 'build/es/segments/', bytes: 700 },
    { path: 'build/mix.wav', bytes: 900 },
    { path: 'build/pace-1.2/mix.wav', bytes: 600 },
    { path: 'build/sounds/', bytes: 1500 },
    { path: 'build/timeline.json', bytes: 100 },
  ]);
  assert.equal(dry.json.bytes, 11800);
  assert.ok(fs.existsSync(path.join(dir, 'build/clips/aaa')), 'the dry run takes nothing out');
  const text = run(dir);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^build\/clips\/ +8 KB\n/);
  assert.match(text.stdout, /\nfreed 12 KB\. The next run makes these again when it needs them\. The narration in build\/voice\/ stays\.\n$/);
  for (const rel of ['build/voice/a.wav', 'build/voice/a.json', 'build/images/usage.jsonl', 'build/es/voice/a.wav', 'build/pace-1.2/voice/a.wav']) assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  for (const rel of ['build/clips', 'build/sounds', 'build/mix.wav', 'build/es/segments', 'build/pace-1.2/mix.wav']) assert.ok(!fs.existsSync(path.join(dir, rel)), rel);
  assert.match(run(dir).stdout, /^build\/ holds nothing to take out\./);
});

test('clean leaves a build folder that is a link alone', { skip: process.platform === 'win32' && 'links need rights on Windows' }, (t) => {
  const dir = project(t);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clean-elsewhere-'));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'mine');
  fs.renameSync(path.join(dir, 'build'), path.join(dir, 'build-old'));
  fs.symlinkSync(elsewhere, path.join(dir, 'build'));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /build\/ is a link or a file, so clean leaves it alone/);
  assert.ok(fs.existsSync(path.join(elsewhere, 'keep.txt')));
});
