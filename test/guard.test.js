import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../src/browser.js';
import { configRoot } from '../src/models.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
const run = promisify(execFile);
let chrome;
try { chrome = findChrome(); } catch {}

// A server on every local address. Without the Chrome rule, 127.0.0.2 reaches
// it too, so these tests prove the rule with no outside computer involved.
async function localServer(t) {
  const hosts = [];
  const server = http.createServer((req, res) => {
    hosts.push(req.headers.host);
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>local</title><p>local</p>');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { hosts, port: server.address().port };
}

function projectFolder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), '{}');
  return dir;
}

test('npm test and CI both load the guard, and it uses only Node\'s own modules', () => {
  const flag = '--import ./test/helpers/guard.js --test';
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.test.includes(flag));
  assert.ok(fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8').includes(flag));
  const guard = fs.readFileSync(path.join(root, 'test/helpers/guard.js'), 'utf8');
  for (const [, from] of guard.matchAll(/^import .* from '(.*)';$/gm)) assert.match(from, /^node:/);
});

test('a request from the test process to an outside host fails, and one to this machine works', async (t) => {
  t.mock.method(process.stderr, 'write', () => true);
  t.after(() => { process.exitCode = undefined; });
  for (const input of ['https://example.com/', new URL('https://example.com/'), new Request('https://example.com/'), 'http://93.184.216.34/']) {
    await assert.rejects(fetch(input), /test guard: blocked a request to/);
  }
  assert.equal(process.exitCode, 1);
  const { port, hosts } = await localServer(t);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
  assert.equal(hosts.length, 2);
});

test('a request from a spawned CLI to an outside host fails, also from another folder', (t) => {
  const r = spawnSync(process.execPath, [bin, 'voices', projectFolder(t), '--elevenlabs'], {
    cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, ELEVENLABS_API_KEY: 'not-a-real-key' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /test guard: blocked a request to https:\/\/api\.elevenlabs\.io/);
});

test('a Chrome page in the test process reaches this machine and nothing else', { skip: !chrome }, async (t) => {
  const { port, hosts } = await localServer(t);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    assert.equal((await page.goto(`http://127.0.0.1:${port}/`)).status(), 200);
    await assert.rejects(page.goto('https://example.com/'), /ERR_NAME_NOT_RESOLVED/);
    await assert.rejects(page.goto(`http://127.0.0.2:${port}/`), /ERR_NAME_NOT_RESOLVED/);
    assert.deepEqual(hosts, [`127.0.0.1:${port}`]);
  } finally {
    await browser.close();
  }
});

test('a Chrome page in a spawned CLI reaches nothing outside this machine', { skip: !chrome }, async (t) => {
  const { port, hosts } = await localServer(t);
  const dir = projectFolder(t);
  for (const url of ['https://example.com/', `http://127.0.0.2:${port}/`]) {
    await assert.rejects(run(process.execPath, [bin, 'capture', dir, url], { cwd: os.tmpdir() }), (e) => {
      assert.match(e.stderr, /the page did not load/);
      return true;
    });
  }
  assert.deepEqual(hosts, []);
});

test('the settings folder is a fresh temp folder, unless one is already set', () => {
  const inherited = process.env.EXPLAINROO_CONFIG;
  assert.equal(configRoot(), inherited);
  assert.equal(path.dirname(inherited), os.tmpdir());
  assert.match(process.env.NODE_OPTIONS, /--import=file:/);
  const settings = (env) => spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.EXPLAINROO_CONFIG)'], { encoding: 'utf8', env }).stdout;
  assert.equal(settings(process.env), inherited);
  assert.equal(settings({ ...process.env, EXPLAINROO_CONFIG: '/some/settings' }), '/some/settings');
  const { EXPLAINROO_CONFIG, ...unset } = process.env;
  const fresh = settings(unset);
  assert.equal(path.dirname(fresh), os.tmpdir());
  assert.notEqual(fresh, inherited);
  assert.equal(fs.existsSync(fresh), false, 'the guard removes the folder it made');
});
