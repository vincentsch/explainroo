import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cacheRoot, TTS_MODEL, ASR_MODEL } from '../src/models.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const run = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 120000 });

test('the CLI passes on exit codes', () => {
  assert.equal(run(['nosuchcommand']).status, 2);
  assert.equal(run(['check', path.join(cacheRoot(), 'no-such-project')]).status, 1);
});

// ONNX Runtime aborts with "mutex lock failed" on macOS when process.exit()
// runs while the models are loaded. doctor --fetch loads both.
const cached = [TTS_MODEL, ASR_MODEL].every((m) => fs.existsSync(path.join(cacheRoot(), 'models', m)));
test('the CLI exits cleanly after loading the speech models', { skip: !cached && 'speech models not downloaded' }, () => {
  const r = run(['doctor', '--fetch']);
  assert.doesNotMatch(r.stderr, /mutex lock failed/);
  assert.equal(r.signal, null);
  assert.equal(r.status, 0, r.stderr);
});
