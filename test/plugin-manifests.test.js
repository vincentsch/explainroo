import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const { version } = readJson('package.json');

const CLAUDE_MARKETPLACE = '.claude-plugin/marketplace.json';
const CODEX_MARKETPLACE = '.agents/plugins/marketplace.json';
const PLUGIN_ROOT = 'skills';
const PLUGIN_MANIFESTS = [`${PLUGIN_ROOT}/.claude-plugin/plugin.json`, `${PLUGIN_ROOT}/.codex-plugin/plugin.json`];
const SKILL = 'skills/explainroo/SKILL.md';

test('each marketplace lists the plugin and points at its folder', () => {
  const claude = readJson(CLAUDE_MARKETPLACE);
  assert.equal(claude.name, 'explainroo');
  assert.equal(claude.owner.name, 'Vincent Schmalbach');
  assert.deepEqual(claude.plugins.map((p) => [p.name, p.source]), [['explainroo', `./${PLUGIN_ROOT}`]]);
  const codex = readJson(CODEX_MARKETPLACE);
  assert.equal(codex.name, 'explainroo');
  assert.deepEqual(codex.plugins.map((p) => [p.name, p.source.source, p.source.path]), [['explainroo', 'local', `./${PLUGIN_ROOT}`]]);
  for (const plugin of codex.plugins) {
    assert.equal(plugin.policy.installation, 'AVAILABLE');
    assert.equal(plugin.policy.authentication, 'ON_INSTALL');
    assert.equal(plugin.category, 'Productivity');
  }
});

test('each plugin manifest has the package version and reaches the one skill', () => {
  for (const file of PLUGIN_MANIFESTS) {
    const manifest = readJson(file);
    assert.equal(manifest.name, 'explainroo', file);
    assert.equal(manifest.version, version, `${file} has to say the version from package.json`);
    assert.ok(fs.existsSync(path.join(root, PLUGIN_ROOT, manifest.skills, 'SKILL.md')), file);
  }
});

test('no manifest has a version other than the one in package.json', () => {
  for (const file of [CLAUDE_MARKETPLACE, CODEX_MARKETPLACE, ...PLUGIN_MANIFESTS]) {
    const manifest = readJson(file);
    for (const entry of [manifest, ...(manifest.plugins ?? [])]) {
      if (entry.version !== undefined) assert.equal(entry.version, version, file);
    }
  }
});

// A top-level bin/ goes on the agent's PATH without its dependencies, and keeps
// the plugin out of claude.ai and Cowork. A package.json with a lockfile makes
// Claude Code try to install them. So the plugin stays out of the repo root.
test('the plugin folder has no bin folder, package file or symlink', () => {
  const plugin = path.join(root, PLUGIN_ROOT);
  for (const name of ['bin', 'package.json', 'package-lock.json', 'CLAUDE.md']) assert.equal(fs.existsSync(path.join(plugin, name)), false, name);
  for (const entry of fs.readdirSync(plugin, { recursive: true, withFileTypes: true })) assert.equal(entry.isSymbolicLink(), false, entry.name);
});

const inGit = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root }).status === 0;
test('skills.sh finds one SKILL.md', { skip: !inGit && 'not a git checkout' }, () => {
  const tracked = spawnSync('git', ['ls-files', '--', '*SKILL.md'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(tracked.stdout.trim().split('\n'), [SKILL]);
});

test('the skill is short, says when to use it, and is written for npx and the docs command', () => {
  const text = fs.readFileSync(path.join(root, SKILL), 'utf8');
  const [, front] = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.match(front, /^name: explainroo$/m);
  assert.match(front, /^description: .*Use when /m);
  assert.ok(text.includes('npx --yes explainroo docs'));
  assert.doesNotMatch(text, /git clone|AGENTS\.md/);
  assert.ok(Buffer.byteLength(text) < 2500);
});
