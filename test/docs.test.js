import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const topics = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

test('the help names the docs command', () => {
  const { stdout } = run('--help');
  assert.match(stdout, /^Docs: .*explainroo docs/m);
  assert.match(stdout, /^ {2}docs \[topic\]/m);
});

test('docs prints AGENTS.md, and --json gives the text and the file', () => {
  const agents = path.join(root, 'AGENTS.md');
  const text = fs.readFileSync(agents, 'utf8');
  const r = run('docs');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${text.trimEnd()}\n`);
  assert.deepEqual(JSON.parse(run('docs', '--json').stdout), { topic: null, file: agents, text });
});

test('docs <topic> prints the page, and --json gives the text and the file', () => {
  assert.ok(topics.length >= 2);
  for (const topic of topics) {
    const file = path.join(root, 'docs', `${topic}.md`);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(run('docs', topic).stdout, `${text.trimEnd()}\n`);
    assert.deepEqual(JSON.parse(run('docs', topic, '--json').stdout), { topic, file, text });
  }
});

test('docs --list lists the topics', () => {
  assert.equal(run('docs', '--list').stdout, `${topics.join('\n')}\n`);
  assert.deepEqual(JSON.parse(run('docs', '--list', '--json').stdout), { topics });
  // The flag takes no value, so a word after it stays out of it.
  assert.equal(run('docs', '--list', topics[0]).stdout, `${topics.join('\n')}\n`);
});

test('an unknown topic is an error that lists the real ones, and a path is no topic', () => {
  for (const topic of ['nope', '../package', '../AGENTS', 'media']) {
    const r = run('docs', topic);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(`there is no docs topic "${topic}"`));
    for (const real of topics) assert.ok(r.stderr.includes(real));
  }
  const json = run('docs', 'nope', '--json');
  assert.equal(json.status, 1);
  assert.match(JSON.parse(json.stdout).error, /there is no docs topic/);
});
