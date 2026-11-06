import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../src/browser.js';
import { configRoot } from '../src/models.js';
import { forgetBlockedRequests } from './helpers/guard.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
const run = promisify(execFile);
let chrome;
try { chrome = findChrome(); } catch {}

// A server on every local address. Without the Chrome rule, 127.0.0.2 reaches
// it too, so these tests prove the rule with no outside computer involved.
async function localServer(t, head = () => '') {
  const hosts = [];
  const server = http.createServer((req, res) => {
    hosts.push(req.headers.host);
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>local</title>${head(server.address().port)}<p>local</p>`);
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

// These requests are blocked on purpose, so they must not fail this test file.
function expectBlockedRequests(t) {
  t.mock.method(process.stderr, 'write', () => true);
  t.after(forgetBlockedRequests);
}

test('a request from the test process to an outside host fails, and one to this machine works', async (t) => {
  expectBlockedRequests(t);
  for (const input of ['https://example.com/', new URL('https://example.com/'), new Request('https://example.com/'), 'http://93.184.216.34/']) {
    await assert.rejects(fetch(input), /test guard: blocked a request to/);
  }
  const { port, hosts } = await localServer(t);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
  assert.equal(hosts.length, 2);
});

test('Node\'s other clients stop at the same place, before they look up a name', async (t) => {
  expectBlockedRequests(t);
  const { port, hosts } = await localServer(t);
  const lookup = () => assert.fail('the guard should stop the client before it looks up a name');
  const clients = [
    http.get(`http://127.0.0.2:${port}/`),
    http.get('http://example.com/', { lookup }),
    https.get('https://example.com/', { lookup }),
    net.connect(port, '127.0.0.2'),
    net.connect({ host: 'example.com', port: 80, lookup }),
  ];
  for (const client of clients) {
    const [error] = await once(client, 'error');
    assert.match(error.message, /test guard: blocked a request to/);
  }
  assert.deepEqual(hosts, []);
  const [local] = await once(http.get(`http://127.0.0.1:${port}/`), 'response');
  assert.equal(local.statusCode, 200);
  local.resume();
  assert.deepEqual(hosts, [`127.0.0.1:${port}`]);
});

test('Playwright\'s request client in the test process reaches this machine and nothing else', { skip: !chrome }, async (t) => {
  expectBlockedRequests(t);
  const { port, hosts } = await localServer(t);
  const browser = await launch();
  try {
    const context = await browser.newContext();
    assert.equal((await context.request.get(`http://127.0.0.1:${port}/logo.png`)).status(), 200);
    for (const url of [`http://127.0.0.2:${port}/logo.png`, 'https://example.com/logo.png']) {
      await assert.rejects(context.request.get(url), /test guard: blocked a request to/);
    }
    assert.deepEqual(hosts, [`127.0.0.1:${port}`]);
  } finally {
    await browser.close();
  }
});

test('a blocked request fails a program that catches the error and exits with 0', () => {
  const script = "fetch('https://example.com/').catch(() => {}).finally(() => process.exit(0))";
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /test guard: blocked a request to https:\/\/example\.com/);
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

test('capture in a spawned CLI downloads no logo from outside this machine, and that fails the run', { skip: !chrome }, async (t) => {
  const { port, hosts } = await localServer(t, (p) => `<link rel="icon" type="image/png" href="http://127.0.0.2:${p}/logo.png"><meta property="og:image" content="https://example.com/social.png">`);
  await assert.rejects(run(process.execPath, [bin, 'capture', projectFolder(t), `http://127.0.0.1:${port}/`, '--json'], { cwd: os.tmpdir() }), (e) => {
    assert.equal(e.code, 1);
    assert.match(e.stderr, /test guard: blocked a request to 127\.0\.0\.2/);
    assert.match(e.stderr, /test guard: blocked a request to example\.com/);
    // capture carries on without the logos, so only the guard makes this fail.
    const { notes } = JSON.parse(e.stdout);
    assert.ok(notes.includes(`Could not save a logo from http://127.0.0.2:${port}/logo.png.`), notes.join('\n'));
    assert.ok(notes.includes('Could not save a logo from https://example.com/social.png.'), notes.join('\n'));
    return true;
  });
  assert.ok(hosts.length > 0);
  for (const host of hosts) assert.equal(host, `127.0.0.1:${port}`);
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
