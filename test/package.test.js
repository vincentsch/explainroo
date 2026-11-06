import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const pkg = readJson('package.json');

const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });

test('the package holds what an installed copy needs', () => {
  assert.equal(pack.status, 0, pack.stderr);
  const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path.split(path.sep).join('/'));
  for (const folder of ['bin/', 'src/', 'engine/', 'fonts/', 'templates/', 'skills/']) {
    assert.ok(files.some((f) => f.startsWith(folder)), folder);
  }
  for (const file of ['AGENTS.md', 'README.md', 'LICENSE', 'package.json', 'bin/explainroo.js', 'skills/explainroo/SKILL.md']) {
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
});
