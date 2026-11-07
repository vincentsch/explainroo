// explainroo connect against the fake services, through the real command line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keyFile, readEnvFile, saveKey, settingsEnvFile } from '../src/env.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const KEY_CHECK = { openrouter: 'GET /api/v1/key', elevenlabs: 'GET /v2/voices' };

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-connect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function setup(t) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const settings = temp(t);
  const cli = (args, input) => new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, ...fake.env, EXPLAINROO_CONFIG: settings, ELEVENLABS_API_KEY: '', OPENROUTER_API_KEY: '' },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) child.stdin.end(input);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, text: stdout + stderr }));
  });
  return { fake, settings, env: path.join(settings, '.env'), cli };
}

function projectFolder(t) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'video.json'), '{}');
  return dir;
}

test('a free service needs nothing and says how to use it', async (t) => {
  const { fake, cli } = await setup(t);
  const r = await cli(['connect', 'kokoro']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Kokoro is free and needs no setting up/);
  assert.match(r.stdout, /explainroo voices/);
  const json = JSON.parse((await cli(['connect', 'recording', '--json'])).stdout);
  assert.equal(json.needs_key, false);
  assert.match(json.use, /"provider": "recording"/);
  assert.equal(fake.count('openrouter', KEY_CHECK.openrouter), 0);
});

test('an unknown service is an error that lists the real ones, and no service prints the usage', async (t) => {
  const { cli } = await setup(t);
  const r = await cli(['connect', 'nope']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /there is no service with that name.*kokoro.*openrouter/);
  const usage = await cli(['connect']);
  assert.equal(usage.code, 1);
  assert.match(usage.stderr, /usage: explainroo connect <service>/);
  assert.match(usage.stderr, /elevenlabs, openrouter/);
});

test('with no terminal and no --key-stdin it prints the steps and how to finish, and changes nothing', async (t) => {
  const { fake, env, cli } = await setup(t);
  const r = await cli(['connect', 'openrouter']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Cost: Paid per image/);
  assert.match(r.stdout, /Data that leaves this computer: The prompt/);
  assert.match(r.stdout, /1\. Make an account/);
  assert.match(r.stdout, /no terminal/);
  assert.match(r.stdout, /connect openrouter --key-stdin/);
  assert.equal(fs.existsSync(env), false);
  assert.equal(fake.count('openrouter', KEY_CHECK.openrouter), 0);
  const json = JSON.parse((await cli(['connect', 'elevenlabs', '--json'])).stdout);
  assert.equal(json.needs_key, true);
  assert.equal(json.env, 'ELEVENLABS_API_KEY');
  assert.ok(json.steps.length > 0);
  assert.match(json.finish.stdin, /--key-stdin$/);
  assert.match(json.cost, /Paid per character/);
});

test('a good key is tested, then saved in a new file only the owner can read, and it is never printed', async (t) => {
  const { fake, env, cli } = await setup(t);
  for (const [service, name] of [['openrouter', 'OPENROUTER_API_KEY'], ['elevenlabs', 'ELEVENLABS_API_KEY']]) {
    const r = await cli(['connect', service, '--key-stdin'], `${GOOD_KEY}\n`);
    assert.equal(r.code, 0, r.text);
    assert.ok(!r.text.includes(GOOD_KEY));
    assert.match(r.stdout, /The key works, and it is saved in /);
    assert.ok(r.stdout.includes(env));
    assert.equal(fake.count(service, KEY_CHECK[service]), 1);
    assert.equal(readEnvFile(env, name), GOOD_KEY);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(env).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(env, 'utf8'), `OPENROUTER_API_KEY=${GOOD_KEY}\nELEVENLABS_API_KEY=${GOOD_KEY}\n`);
  const json = JSON.parse((await cli(['connect', 'openrouter', '--key-stdin', '--json'], GOOD_KEY)).stdout);
  assert.deepEqual([json.service, json.connected, json.file, json.env], ['openrouter', true, env, 'OPENROUTER_API_KEY']);
  assert.ok(!JSON.stringify(json).includes(GOOD_KEY));
  assert.equal(JSON.parse((await cli(['services', 'images', '--json'])).stdout).services.find((s) => s.id === 'openrouter').connected, true);
});

test('a key that fails its test saves nothing, and the reason leaves the key out', async (t) => {
  const { fake, env, cli } = await setup(t);
  const bad = 'not-the-right-key-1234';
  for (const service of ['openrouter', 'elevenlabs']) {
    for (const flags of [[], ['--json']]) {
      const r = await cli(['connect', service, '--key-stdin', ...flags], `${bad}\n`);
      assert.equal(r.code, 1);
      assert.match(r.text, /rejected the key/);
      assert.match(r.text, /Nothing was saved/);
      assert.ok(!r.text.includes(bad));
    }
  }
  assert.equal(fs.existsSync(env), false);

  fake.plan('openrouter', KEY_CHECK.openrouter, { status: 500 });
  const busy = await cli(['connect', 'openrouter', '--key-stdin'], GOOD_KEY);
  assert.equal(busy.code, 1);
  assert.match(busy.stderr, /HTTP 500.*could not be tested.*Nothing was saved/);
  fake.plan('openrouter', KEY_CHECK.openrouter, { drop: true });
  const gone = await cli(['connect', 'openrouter', '--key-stdin'], GOOD_KEY);
  assert.equal(gone.code, 1);
  assert.match(gone.stderr, /did not answer.*Nothing was saved/);
  assert.ok(!(busy.text + gone.text).includes(GOOD_KEY));
  assert.equal(fs.existsSync(env), false);
});

test('an empty key, and one that could break a header, stop before any request', async (t) => {
  const { fake, env, cli } = await setup(t);
  const empty = await cli(['connect', 'openrouter', '--key-stdin'], '\n\n');
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /no key came in/);
  const spaced = await cli(['connect', 'openrouter', '--key-stdin'], 'two words here\n');
  assert.equal(spaced.code, 1);
  assert.match(spaced.stderr, /does not look like a key/);
  assert.ok(!spaced.text.includes('two words'));
  assert.equal(fake.count('openrouter', KEY_CHECK.openrouter), 0);
  assert.equal(fs.existsSync(env), false);
});

test('a key on the command line is refused and never repeated', async (t) => {
  const { fake, env, cli } = await setup(t);
  const key = 'sk-on-the-command-line-1234';
  for (const args of [['connect', key], ['connect', 'openrouter', key], ['connect', 'openrouter', '--key', key], [`connect`, 'openrouter', `--key=${key}`], ['connect', 'openrouter', '--key-stdin', key], ['connect', 'openrouter', `--${key}`]]) {
    for (const flags of [[], ['--json']]) {
      const r = await cli([...args, ...flags]);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.text, /never goes on the command line/);
      assert.ok(!r.text.includes(key), args.join(' '));
    }
  }
  assert.equal(fake.count('openrouter', KEY_CHECK.openrouter), 0);
  assert.equal(fs.existsSync(env), false);
});

test('--project saves in that project, keeps the other lines and adds .env to its .gitignore', async (t) => {
  const { settings, cli } = await setup(t);
  const dir = projectFolder(t);
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'FIRST=1\n# a comment\nexport OPENROUTER_API_KEY="old"\nLAST=2\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'build/\n');
  fs.chmodSync(file, 0o640);
  const r = await cli(['connect', 'openrouter', '--project', dir, '--key-stdin'], `${GOOD_KEY}\n`);
  assert.equal(r.code, 0, r.text);
  assert.equal(fs.readFileSync(file, 'utf8'), `FIRST=1\n# a comment\nOPENROUTER_API_KEY=${GOOD_KEY}\nLAST=2\n`);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').trim().split('\n'), ['build/', '.env']);
  assert.deepEqual(fs.readdirSync(dir).toSorted(), ['.env', '.gitignore', 'video.json']);
  assert.equal(fs.existsSync(path.join(settings, '.env')), false);
  const notProject = await cli(['connect', 'openrouter', '--project', temp(t), '--key-stdin'], GOOD_KEY);
  assert.equal(notProject.code, 1);
  assert.match(notProject.stderr, /not a video project/);
});

test('--project refuses a .env that is a link, because the key could end up in a tracked file', async (t) => {
  const { cli } = await setup(t);
  const dir = projectFolder(t);
  fs.writeFileSync(path.join(dir, 'notes.md'), 'notes\n');
  fs.symlinkSync('notes.md', path.join(dir, '.env'));
  const r = await cli(['connect', 'openrouter', '--project', dir, '--key-stdin'], GOOD_KEY);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is a link/);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), 'notes\n');
  assert.ok(!r.text.includes(GOOD_KEY));
});

test('--project refuses a .env that git tracks, because ignoring it would not keep the key out of a commit', { skip: spawnSync('git', ['--version']).status !== 0 && 'needs git' }, async (t) => {
  const { cli } = await setup(t);
  const dir = projectFolder(t);
  fs.writeFileSync(path.join(dir, '.env'), 'OTHER=1\n');
  const git = (...args) => assert.equal(spawnSync('git', args, { cwd: dir }).status, 0, args.join(' '));
  git('init', '-q');
  // Not tracked yet, so it saves, and the .gitignore keeps it out.
  const first = await cli(['connect', 'openrouter', '--project', dir, '--key-stdin'], GOOD_KEY);
  assert.equal(first.code, 0, first.text);
  fs.rmSync(path.join(dir, '.gitignore'));
  git('add', '.env');
  const before = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  const r = await cli(['connect', 'openrouter', '--project', dir, '--key-stdin'], GOOD_KEY);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /git tracks .*\.env/);
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), before);
  assert.ok(!r.text.includes(GOOD_KEY));
});

test('a source checkout saves in its own folder, and an installed copy in the settings folder', (t) => {
  const checkout = temp(t);
  const installed = temp(t);
  fs.mkdirSync(path.join(checkout, '.git'));
  assert.equal(keyFile({ root: checkout, env: {} }), path.join(checkout, '.env'));
  assert.equal(keyFile({ root: installed, env: {} }), settingsEnvFile());
  // Setting the folder on purpose wins, which also keeps tests out of a real checkout.
  assert.equal(keyFile({ root: checkout, env: { EXPLAINROO_CONFIG: '/some/settings' } }), settingsEnvFile());
  assert.equal(keyFile({ project: '/some/project', root: checkout, env: {} }), path.join('/some/project', '.env'));
});

test('saving a key replaces a repeated line once and writes through a link', (t) => {
  const dir = temp(t);
  const real = path.join(dir, 'real.env');
  fs.writeFileSync(real, 'A=1\nKEY_NAME=old\nB=2\nKEY_NAME=older\n');
  const link = path.join(dir, '.env');
  fs.symlinkSync(real, link);
  saveKey(link, 'KEY_NAME', 'new');
  assert.equal(fs.readFileSync(real, 'utf8'), 'A=1\nKEY_NAME=new\nB=2\n');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  const other = path.join(dir, 'no-newline.env');
  fs.writeFileSync(other, 'A=1');
  saveKey(other, 'KEY_NAME', 'new');
  assert.equal(fs.readFileSync(other, 'utf8'), 'A=1\nKEY_NAME=new\n');
  saveKey(path.join(dir, 'sub', 'folder', '.env'), 'KEY_NAME', 'new');
  assert.equal(readEnvFile(path.join(dir, 'sub', 'folder', '.env'), 'KEY_NAME'), 'new');
});

test('connect says when another value is read first', async (t) => {
  const { fake, settings } = await setup(t);
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, 'connect', 'openrouter', '--key-stdin'], { env: { ...process.env, ...fake.env, EXPLAINROO_CONFIG: settings, OPENROUTER_API_KEY: 'another-value-in-the-environment' }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(GOOD_KEY);
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, text }));
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /a different OPENROUTER_API_KEY is set/);
  assert.ok(!r.text.includes('another-value-in-the-environment'));
  assert.ok(!r.text.includes(GOOD_KEY));
});

test('a key that connect saved is the one a command then uses', async (t) => {
  const { fake, settings, cli } = await setup(t);
  assert.equal((await cli(['connect', 'elevenlabs', '--key-stdin'], GOOD_KEY)).code, 0);
  const r = await cli(['voices', '--elevenlabs', '--json']);
  // A .env in a source checkout comes first, so only a clean checkout can say this.
  if (fs.existsSync(path.join(root, '.env'))) return;
  assert.equal(r.code, 0, r.text);
  assert.equal(JSON.parse(r.stdout).voices[0].id, 'fake-voice');
  assert.ok(fs.existsSync(path.join(settings, '.env')));
  assert.equal(fake.requests('elevenlabs', KEY_CHECK.elevenlabs).at(-1).headers['xi-api-key'], GOOD_KEY);
});

// A real terminal, through the script program, to prove the prompt hides the key.
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;

test('in a terminal the key comes from a hidden prompt', { skip: !hasScript && 'needs the script program on Linux' }, async (t) => {
  const { fake, settings, env } = await setup(t);
  const typed = `${GOOD_KEY}x\x7f\r`;
  const run = (input, command = `${process.execPath} ${bin} connect openrouter`) => new Promise((resolve) => {
    const child = spawn('script', ['-qec', command, '/dev/null'], { env: { ...process.env, ...fake.env, EXPLAINROO_CONFIG: settings, OPENROUTER_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (d) => {
      text += d;
      if (text.includes('it will not show') && input !== null) {
        child.stdin.write(input);
        input = null;
      }
    });
    child.on('close', (code) => resolve({ code, text }));
  });
  const r = await run(typed);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Cost: Paid per image/);
  assert.match(r.text, /The key works/);
  assert.ok(!r.text.includes(GOOD_KEY), 'the key shows nowhere on the terminal');
  assert.equal(readEnvFile(env, 'OPENROUTER_API_KEY'), GOOD_KEY);

  const stopped = await run('\x03');
  assert.equal(stopped.code, 1);
  assert.match(stopped.text, /stopped, and nothing was saved/);
  assert.equal(readEnvFile(env, 'OPENROUTER_API_KEY'), GOOD_KEY);
});
