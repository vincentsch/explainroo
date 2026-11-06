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

// Agents pay for every token of AGENTS.md. New features get a page in docs/ and
// a few lines here. The ceiling leaves room for the services rule and those lines.
const AGENTS_CEILING = 66000;
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

test('AGENTS.md stays under its size ceiling', () => {
  const size = Buffer.byteLength(agents);
  assert.ok(size <= AGENTS_CEILING, `AGENTS.md is ${size} bytes. Move long parts to docs/ and keep it under ${AGENTS_CEILING}.`);
});

test('AGENTS.md starts by saying how to run the tool, and writes plain explainroo after that', () => {
  const [opening, ...rest] = agents.split('\n\n').slice(1);
  assert.ok(opening.startsWith('Run explainroo with `npx --yes explainroo`.'));
  for (const words of ['node bin/explainroo.js', 'source checkout', 'plain `explainroo`', 'PATH']) assert.ok(opening.includes(words), words);
  const below = rest.join('\n\n');
  // One note for people who change explainroo itself, at the very end.
  assert.equal(below.split('node bin/explainroo.js').length, 2);
  assert.ok(below.indexOf('node bin/explainroo.js') > below.indexOf('## Working on explainroo itself'));
  assert.equal(below.split('git clone').length, 2);
  assert.ok(below.indexOf('git clone') > below.indexOf('## Working on explainroo itself'));
  assert.doesNotMatch(agents, /the explainroo folder|Git ignores that folder/);
});

test('every docs topic named in AGENTS.md exists, and every page is named there', () => {
  const named = new Set([...agents.matchAll(/`(?:npx --yes )?explainroo docs ([^`\s]+)`/g)].map((m) => m[1]).filter((t) => !/^[-<]/.test(t)));
  assert.ok(named.has('product-demos') && named.has('japanese-and-chinese'));
  for (const topic of named) assert.ok(topics.includes(topic), `AGENTS.md names the topic "${topic}", and docs/${topic}.md does not exist`);
  for (const topic of topics) assert.ok(named.has(topic), `nothing in AGENTS.md leads to docs/${topic}.md`);
});

test('the instructions link to examples on GitHub, because the package has none', () => {
  for (const file of ['AGENTS.md', ...topics.map((t) => `docs/${t}.md`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const links = /\[[^\]]*\]\(https:\/\/github\.com\/vincentsch\/explainroo\/tree\/main\/examples[^)]*\)/g;
    assert.doesNotMatch(text.replace(links, ''), /\bexamples\//, file);
  }
});

// The anchor GitHub gives a heading.
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

test('links between the README and the instructions lead somewhere', () => {
  for (const file of ['README.md', 'AGENTS.md', ...topics.map((t) => `docs/${t}.md`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, target, anchor] of text.matchAll(/\]\((?!https?:)([^)#\s]*)(?:#([^)\s]+))?\)/g)) {
      const dest = target ? path.join(path.dirname(path.join(root, file)), target) : path.join(root, file);
      assert.ok(fs.existsSync(dest), `${file} links to ${target}`);
      if (anchor) {
        const headings = [...fs.readFileSync(dest, 'utf8').matchAll(/^#+ (.*)$/gm)].map((m) => slug(m[1]));
        assert.ok(headings.includes(anchor), `${file} links to ${target}#${anchor}`);
      }
    }
  }
});

test('the README installs with npx, its prompt runs the docs command, and cloning stays for changing the code', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const prompt = readme.match(/```text\n([\s\S]*?)```/)[1];
  assert.ok(prompt.includes('npx --yes explainroo docs'));
  assert.doesNotMatch(prompt, /clone/);
  const install = readme.slice(readme.indexOf('## Install it yourself'), readme.indexOf('## The watermark'));
  assert.equal(install.match(/```bash\n(.*)\n/)[1], 'npx --yes explainroo doctor --fetch');
  assert.ok(install.indexOf('git clone') > install.indexOf('To change the code'));
});
