import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';

// Run the CLI in-process and collect what it wrote to stderr.
async function run(args) {
  const write = process.stderr.write;
  let err = '';
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    const code = await main(args);
    return { code, err };
  } finally {
    process.stderr.write = write;
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cli-'));
}

test('init rejects an unknown theme and creates no folder', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--theme', 'nope']);
  assert.equal(r.code, 1);
  assert.match(r.err, /theme must be one of/);
  assert.equal(fs.existsSync(target), false);
});

test('init rejects a bad pace without leaving a folder behind', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--pace', 'fast']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--pace must be a number/);
  assert.equal(fs.existsSync(target), false);
});

test('init names a text flag that was given without a value', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--title']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--title needs a value/);
  assert.equal(fs.existsSync(target), false);
});

test('a numeric flag without a value is an error, not 1', async () => {
  const base = tempDir();
  const r = await run(['init', path.join(base, 'video'), '--pace']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--pace needs a value/);
});

test('init with valid settings writes video.json and the starter files', async () => {
  const base = tempDir();
  const target = path.join(base, 'my-first-video');
  const r = await run(['init', target, '--theme', 'clean', '--pace', '1.2']);
  assert.equal(r.code, 0);
  const config = JSON.parse(fs.readFileSync(path.join(target, 'video.json'), 'utf8'));
  assert.equal(config.theme, 'clean');
  assert.equal(config.pace, 1.2);
  assert.equal(config.title, 'My first video');
  assert.ok(fs.existsSync(path.join(target, 'assets')));
  assert.ok(fs.existsSync(path.join(target, 'script.md')));
});

test('render rejects bad formats, mismatched extensions and missing text flags before building', async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), '{}');
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) {} };');
    for (const [flags, message] of [
      [['--format', 'avi'], /mp4, gif, webm or mov/],
      [['--transparent'], /--format webm or --format mov/],
      [['--transparent', '--format', 'gif'], /--format webm or --format mov/],
      [['--format', 'webm', '--out', 'file.mp4'], /must end in .webm/],
      [['--format', 'mov', '--out', 'file.webm'], /must end in .mov/],
      [['--out', 'file.gif'], /must end in .mp4/],
      [['--format', 'gif', '--out', 'file.mp4'], /must end in .gif/],
      [['--format'], /--format needs a value/],
      [['--out'], /--out needs a value/],
    ]) {
      const r = await run(['render', dir, ...flags]);
      assert.equal(r.code, 1);
      assert.match(r.err, message);
      assert.equal(fs.existsSync(path.join(dir, 'build')), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('size overrides reject missing values and invalid sizes before building for all five commands', async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), '{}');
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) {} };');
    for (const command of ['render', 'still', 'sheet', 'check', 'preview']) {
      for (const [flags, message] of [
        [['--size'], /--size needs a value/],
        [['--size', 'bad'], /size must be/],
        [['--size', '1081x1350'], /even numbers/],
      ]) {
        const r = await run([command, dir, ...flags]);
        assert.equal(r.code, 1, command);
        assert.match(r.err, message);
        assert.equal(fs.existsSync(path.join(dir, 'build')), false);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
