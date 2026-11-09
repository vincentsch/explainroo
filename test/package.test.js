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
  const allowed = new Set(['bin', 'src', 'engine', 'fonts', 'templates', 'formats', 'skills', 'docs', 'examples', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'LICENSE', 'package.json']);
  assert.deepEqual(files.filter((f) => !allowed.has(f.split('/')[0])), []);
  // Only pages directly under docs/. Pictures and other folders stay out.
  assert.deepEqual(files.filter((f) => f.startsWith('docs/') && !/^docs\/[^/]+\.md$/.test(f)), []);
  assert.deepEqual(files.filter((f) => /^(docs\/media|videos|test|scratchpad|\.scratch)(\/|$)/.test(f)), []);
  assert.deepEqual(files.filter((f) => /(^|\/)\.env/.test(f)), []);
});

// The examples' sources come along, so an agent can read them without the
// repository, and nothing that a render or a purchase makes.
test('the package has the sources and assets of every example and format, and no build, out or history', () => {
  const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path.split(path.sep).join('/'));
  const examples = fs.readdirSync(path.join(root, 'examples')).filter((name) => fs.existsSync(path.join(root, 'examples', name, 'video.json')));
  assert.ok(examples.length >= 10);
  for (const name of examples) {
    for (const file of ['video.json', 'script.md', 'scenes.js']) assert.ok(files.includes(`examples/${name}/${file}`), `${name}/${file}`);
  }
  for (const file of ['examples/unspar-demo/assets/unspar-logo.svg', 'examples/leap-years-de/assets/narration.m4a', 'examples/callbacks-to-async-await/code-versions.js']) assert.ok(files.includes(file), file);
  assert.deepEqual(files.filter((f) => /^examples\/[^/]+\/(build|out|history)\//.test(f)), []);
  assert.deepEqual(files.filter((f) => f.startsWith('examples/') && !/^examples\/[^/]+\/(video\.json|script[^/]*\.md|strings[^/]*\.json|[^/]+\.js|README\.md|recordings\/[^/]+\.json|assets\/.+)$/.test(f)), []);
  // A recording's step file and its log come along, and its video stays out.
  for (const file of ['examples/recording-demo/recordings/new-invoice.json', 'examples/recording-demo/assets/recordings/new-invoice.log.json']) assert.ok(files.includes(file), file);
  assert.deepEqual(files.filter((f) => f.endsWith('.webm')), []);
  // The formats come with their sources only, so init --format works from npx.
  for (const name of fs.readdirSync(path.join(root, 'formats'))) {
    for (const file of ['format.json', 'guide.md', 'format.js', 'video.json', 'script.md', 'scenes.js']) assert.ok(files.includes(`formats/${name}/${file}`), `formats/${name}/${file}`);
  }
  assert.deepEqual(files.filter((f) => f.startsWith('formats/') && !/^formats\/[^/]+\/([^/]+\.(json|md|js)|assets\/.+)$/.test(f)), []);
  // Under 2 MB packed.
  assert.ok(JSON.parse(pack.stdout)[0].size < 2 * 1024 * 1024, String(JSON.parse(pack.stdout)[0].size));
});

test('the description promises what a free local copy does', () => {
  assert.doesNotMatch(pkg.description, /no API keys/);
  assert.match(pkg.description, /no account and no key/);
  assert.equal(pkg.bin.explainroo, 'bin/explainroo.js');
  assert.equal(pkg.scripts['test:pack'], 'node scripts/pack-test.mjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts/pack-test.mjs')));
});
