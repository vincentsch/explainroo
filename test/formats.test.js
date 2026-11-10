// Formats: the built-in ones, "formats" and "formats <name>", "init --format",
// and "formats add", which shows what it will run and installs from Git only
// with --yes, at a fixed commit, into the cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../src/project.js';
import { BUILT_IN, GUIDE_LIMIT, readFormat } from '../src/formats.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const SHIPPED = ['narrated-explainer', 'product-ad', 'product-launch', 'vertical-short'];

function temp(t, prefix = 'explainroo-formats-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The command line with its own cache, so nothing lands in the real one.
function cli(t, args, cache = temp(t)) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_CACHE: cache } });
  return { ...r, json: () => JSON.parse(r.stdout) };
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Jane Doe', '-c', 'user.email=jane@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// A Git repository with a format in it, made from a built-in one, with its own
// name and author. Returns the folder and its commits, oldest first.
function formatRepo(t, { name = 'recipe-card', change } = {}) {
  const dir = temp(t, 'explainroo-format-repo-');
  for (const file of ['guide.md', 'video.json', 'script.md', 'scenes.js', 'format.js']) fs.copyFileSync(path.join(BUILT_IN, 'narrated-explainer', file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'format.json'), JSON.stringify({ name, description: 'A recipe in one minute.', author: 'Jane Doe', version: '0.1.0' }));
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  const first = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'format.json'), JSON.stringify({ name, description: 'A recipe in one minute.', author: 'Jane Doe', version: '0.2.0' }));
  change?.(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'second');
  return { dir, commits: [first, git(dir, 'rev-parse', 'HEAD')] };
}

test('the four built-in formats check out, each with a short guide, and use no paid service', () => {
  assert.deepEqual(fs.readdirSync(BUILT_IN).sort(), SHIPPED);
  for (const name of SHIPPED) {
    const f = readFormat(path.join(BUILT_IN, name));
    assert.equal(f.name, name);
    assert.equal(f.author, 'explainroo');
    assert.ok(Buffer.byteLength(f.guide) < GUIDE_LIMIT, `${name}/guide.md is under 4 KB`);
    assert.ok(f.code.includes('format.js') && f.code.includes('scenes.js'), name);
    assert.match(fs.readFileSync(path.join(BUILT_IN, name, 'scenes.js'), 'utf8'), /from '\.\/format\.js'/);
    // Each folder is a project, so the example renders as it is.
    const project = loadProject(path.join(BUILT_IN, name));
    assert.equal(typeof project.config.voice, 'string', `${name} speaks with Kokoro`);
  }
  const short = readFormat(path.join(BUILT_IN, 'vertical-short'));
  assert.equal(short.settings.captions, 'bold');
  assert.match(fs.readFileSync(path.join(BUILT_IN, 'vertical-short', 'script.md'), 'utf8'), /^## hook \{lead=0\}/m);
  const ad = loadProject(path.join(BUILT_IN, 'product-ad'));
  assert.ok(ad.config.targetSeconds >= 15 && ad.config.targetSeconds <= 30);
});

test('formats lists the formats, formats <name> prints the guide, and an unknown one names the real ones', (t) => {
  const list = cli(t, ['formats', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const { formats } = list.json();
  assert.deepEqual(formats.map((f) => f.name), SHIPPED);
  assert.ok(formats.every((f) => f.origin === 'built-in' && f.author && f.version && f.description));
  const text = cli(t, ['formats']).stdout;
  assert.match(text, /^product-ad\s+A product ad of 15 to 30 seconds/m);
  assert.match(text, /explainroo init videos\/<name> --format <format>/);
  assert.match(text, /The sizes moved to "explainroo sizes"/);
  const one = cli(t, ['formats', 'vertical-short']);
  assert.equal(one.status, 0);
  assert.ok(one.stdout.includes('The first second carries the hook.'));
  const wrong = cli(t, ['formats', 'nope']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /there is no format "nope". The formats are narrated-explainer, product-ad, product-launch, vertical-short/);
});

test('init --format starts from the format: its settings, example, helpers and guide, with the flags on top', (t) => {
  const dir = path.join(temp(t), 'battery');
  const r = cli(t, ['init', dir, '--format', 'vertical-short', '--title', 'Cold batteries', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().format.name, 'vertical-short');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  assert.equal(config.title, 'Cold batteries');
  assert.equal(config.size, 'vertical');
  assert.equal(config.captions, 'bold');
  assert.equal(config.pace, 1.15);
  assert.equal(config.defaults, readFormat(path.join(BUILT_IN, 'vertical-short')).settings.defaults);
  assert.match(fs.readFileSync(path.join(dir, 'script.md'), 'utf8'), /^# Cold batteries\n/);
  assert.equal(fs.readFileSync(path.join(dir, 'format.js'), 'utf8'), fs.readFileSync(path.join(BUILT_IN, 'vertical-short', 'format.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(dir, 'format.md'), 'utf8'), /The rules of the mode/);
  assert.ok(!fs.existsSync(path.join(dir, 'post.json')), 'a built-in format needs no credit line');
  assert.ok(!fs.existsSync(path.join(dir, 'format.json')));
  assert.equal(loadProject(dir).script.scenes.length, 4);
  // The guide is printed, so the agent reads it at once.
  const shown = cli(t, ['init', path.join(path.dirname(dir), 'ad'), '--format', 'product-ad', '--size', 'linkedin']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.ok(shown.stdout.includes('# Product ad'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(dir), 'ad', 'video.json'), 'utf8')).size, 'linkedin');
  // The example is about the format's own topic, to be replaced.
  assert.match(shown.stdout, /script\.md and scenes\.js hold the format's example, a video about "Acme Invoices"\. Replace it with your own topic, and keep the helpers that scenes\.js imports from format\.js\./);
  assert.doesNotMatch(shown.stdout, /The size is "vertical"/);
  // The vertical short takes --size, and without it, init asks for a platform's size.
  const plain = cli(t, ['init', path.join(path.dirname(dir), 'plain'), '--format', 'vertical-short']);
  assert.match(plain.stdout, /\nThe size is "vertical", a tall frame for no app in particular\. For one app, set its size, so pictures and captions keep clear of its buttons: .* set .*plain size tiktok \(or shorts, or reels\)\.\n/);
  const sized = cli(t, ['init', path.join(path.dirname(dir), 'sized'), '--format', 'vertical-short', '--size', 'tiktok']);
  assert.equal(sized.status, 0, sized.stderr);
  assert.doesNotMatch(sized.stdout, /The size is "vertical"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(dir), 'sized', 'video.json'), 'utf8')).size, 'tiktok');
  // An unknown format leaves nothing behind.
  const none = path.join(path.dirname(dir), 'none');
  const bad = cli(t, ['init', none, '--format', 'nope']);
  assert.equal(bad.status, 1);
  assert.ok(!fs.existsSync(none));
});

test('formats add prints what it will run and installs nothing without --yes', (t) => {
  const cache = temp(t);
  const { dir, commits } = formatRepo(t);
  const plan = cli(t, ['formats', 'add', dir, '--commit', commits[0], '--json'], cache);
  assert.equal(plan.status, 0, plan.stderr);
  const { installed, plan: p } = plan.json();
  assert.equal(installed, false);
  assert.deepEqual(p.commands.map((c) => c.split(' ').slice(0, 2).join(' ')), ['git clone', 'git checkout']);
  assert.ok(p.commands[1].includes(commits[0]));
  const text = cli(t, ['formats', 'add', dir], cache).stdout;
  assert.match(text, /"formats add" will run:\n  git clone --no-checkout --quiet /);
  assert.match(text, /Nothing from the format runs now/);
  assert.match(text, /Run the same command with --yes to install it\./);
  assert.ok(!fs.existsSync(path.join(cache, 'formats')), 'the cache is untouched');
});

test('formats add --yes installs at the commit, lists it with its source, and init credits its author', (t) => {
  const cache = temp(t);
  const { dir, commits } = formatRepo(t);
  const r = cli(t, ['formats', 'add', dir, '--commit', commits[0], '--yes', '--json'], cache);
  assert.equal(r.status, 0, r.stderr);
  const { format } = r.json();
  assert.equal(format.name, 'recipe-card');
  assert.equal(format.version, '0.1.0', 'the pinned commit, not the newest');
  assert.equal(format.source.commit, commits[0]);
  assert.ok(!fs.existsSync(path.join(cache, 'formats', 'recipe-card', '.git')));
  assert.deepEqual(fs.readdirSync(path.join(cache, 'formats')).filter((f) => f.startsWith('.')), [], 'no temp folders stay');
  const listed = cli(t, ['formats', '--json'], cache).json().formats.find((f) => f.name === 'recipe-card');
  assert.equal(listed.origin, 'installed');
  assert.equal(listed.source.url, dir);
  assert.match(cli(t, ['formats'], cache).stdout, /recipe-card .*\n.*by Jane Doe, version 0\.1\.0, installed from .* at [0-9a-f]{12}/);
  const project = path.join(temp(t), 'soup');
  assert.equal(cli(t, ['init', project, '--format', 'recipe-card'], cache).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'post.json'), 'utf8')), { credits: ['Format: recipe-card by Jane Doe'] });
  // Without --commit it takes the newest commit, and a second install replaces the first.
  const again = cli(t, ['formats', 'add', dir, '--yes'], cache);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /installed recipe-card 0\.2\.0 by Jane Doe/);
  assert.match(again.stdout, /It replaced the copy from/);
  assert.match(again.stdout, /Its code runs in the render page of a project made from it: format\.js, scenes\.js\. Read it before you use the format\./);
});

test('formats add refuses a format with a link, a paid voice, a long guide or the name of a built-in one', (t) => {
  const cases = [
    [{ change: (d) => fs.symlinkSync('/etc/hostname', path.join(d, 'assets-link.png')) }, /a format may only hold plain files|no links|link/],
    [{ change: (d) => fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'abc' } })) }, /costs money\. A format starts with a free voice/],
    [{ change: (d) => fs.writeFileSync(path.join(d, 'guide.md'), 'x'.repeat(5000)) }, /guide\.md has 5000 bytes, and a guide stays under 4096/],
    [{ name: 'product-ad' }, /a built-in format is called "product-ad"/],
  ];
  for (const [options, message] of cases) {
    const cache = temp(t);
    const { dir } = formatRepo(t, options);
    const r = cli(t, ['formats', 'add', dir, '--yes'], cache);
    if (options.change && /link/.test(String(message))) {
      // Git writes a link as a plain file with core.symlinks off, so it is never followed.
      if (r.status === 0) {
        const file = path.join(cache, 'formats', 'recipe-card', 'assets-link.png');
        assert.ok(!fs.lstatSync(file).isSymbolicLink());
        assert.equal(fs.readFileSync(file, 'utf8'), '/etc/hostname');
        continue;
      }
    }
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, message);
    assert.deepEqual(fs.existsSync(path.join(cache, 'formats')) ? fs.readdirSync(path.join(cache, 'formats')) : [], [], 'nothing stays in the cache');
  }
  // A bad commit id or address is refused before git runs.
  assert.match(cli(t, ['formats', 'add', 'https://example.com/a.git', '--commit', 'main']).stderr, /--commit needs a commit id/);
  assert.match(cli(t, ['formats', 'add', 'ext::sh -c touch% /tmp/x']).stderr, /is no Git address/);
});

test('punch() of vertical-short works more than once in a scene, and the words keep to the largest zoom', async () => {
  const { punch, wordArea } = await import('../formats/vertical-short/format.js');
  const s = { cx: 540, cy: 960, safe: { x: 60, y: 200, w: 960, h: 1300 }, short: { punch: (at, o) => [{ at, ...o }, { at: at + o.hold, zoom: 1 }] } };
  const keys = [...punch(s, 1), ...punch(s, 3, { zoom: 1.4 }), ...punch(s, 5, { zoom: 1.1 })];
  assert.equal(keys.length, 6);
  assert.deepEqual(keys.filter((k) => k.zoom > 1).map((k) => k.zoom), [1.25, 1.4, 1.1]);
  const once = { ...s };
  punch(once, 3, { zoom: 1.4 });
  assert.deepEqual(wordArea(s), wordArea(once));
});
