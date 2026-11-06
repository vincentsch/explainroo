import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--version and version print the version, also as JSON', () => {
  for (const args of [['--version'], ['version'], ['render', '--version']]) {
    const r = run(...args);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${version}\n`);
  }
  for (const args of [['--version', '--json'], ['version', '--json']]) assert.deepEqual(JSON.parse(run(...args).stdout), { version });
});

test('the help still prints without a command', () => {
  for (const args of [[], ['help'], ['--help'], ['-h']]) {
    const r = run(...args);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^explainroo \d+\.\d+\.\d+/);
    assert.match(r.stdout, /^ {2}version/m);
  }
});
