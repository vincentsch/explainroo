import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const pkg = readJson('package.json');

// npm has its own HTTP client and checks for updates about once a week. The
// test guard stops that request, and a new npm cache makes the check due every
// time, so leaving the flag out can't go unnoticed.
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-npm-cache-'));
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--no-update-notifier'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: cache },
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});
fs.rmSync(cache, { recursive: true, force: true });

test('npm packs without asking the network', () => {
  assert.equal(pack.status, 0, pack.stderr);
  // npm sets its own exit code, so only its stderr shows a blocked request.
  assert.doesNotMatch(pack.stderr, /test guard/);
});

test('the package holds what an installed copy needs', () => {
  const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path.split(path.sep).join('/'));
  for (const folder of ['bin/', 'src/', 'engine/', 'fonts/', 'templates/', 'skills/']) {
    assert.ok(files.some((f) => f.startsWith(folder)), folder);
  }
  for (const file of ['AGENTS.md', 'README.md', 'LICENSE', 'package.json', 'bin/explainroo.js', 'skills/explainroo/SKILL.md', 'src/services.json', 'src/connectors/index.js']) {
    assert.ok(files.includes(file), file);
  }
  const pages = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md'));
  assert.ok(pages.length >= 2);
  for (const page of pages) assert.ok(files.includes(`docs/${page}`), page);
});

test('the package holds nothing else, and no .env anywhere', () => {
  const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path.split(path.sep).join('/'));
  const allowed = new Set(['bin', 'src', 'engine', 'fonts', 'templates', 'skills', 'docs', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'LICENSE', 'package.json']);
  assert.deepEqual(files.filter((f) => !allowed.has(f.split('/')[0])), []);
  // Only pages directly under docs/. Pictures and other folders stay out.
  assert.deepEqual(files.filter((f) => f.startsWith('docs/') && !/^docs\/[^/]+\.md$/.test(f)), []);
  assert.deepEqual(files.filter((f) => /^(docs\/media|examples|videos|test|scratchpad|\.scratch)(\/|$)/.test(f)), []);
  assert.deepEqual(files.filter((f) => /(^|\/)\.env/.test(f)), []);
});

test('the description promises what a free local copy does', () => {
  assert.doesNotMatch(pkg.description, /no API keys/);
  assert.match(pkg.description, /no account and no key/);
  assert.equal(pkg.bin.explainroo, 'bin/explainroo.js');
  assert.equal(pkg.scripts['test:pack'], 'node scripts/pack-test.mjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts/pack-test.mjs')));
});
