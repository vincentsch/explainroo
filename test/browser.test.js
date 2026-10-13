import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { findChrome } from '../src/browser.js';

test('finds the headless shell that Playwright installs on Windows', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-pw-'));
  const exe = path.join(base, 'chromium_headless_shell-1300', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  const saved = { pw: process.env.PLAYWRIGHT_BROWSERS_PATH, ex: process.env.EXPLAINROO_CHROME, cp: process.env.CHROME_PATH };
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = base;
    delete process.env.EXPLAINROO_CHROME;
    delete process.env.CHROME_PATH;
    assert.equal(findChrome(), exe);
  } finally {
    for (const [k, v] of [['PLAYWRIGHT_BROWSERS_PATH', saved.pw], ['EXPLAINROO_CHROME', saved.ex], ['CHROME_PATH', saved.cp]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
});

let chrome;
try { chrome = findChrome(); } catch {}

test('a page load that hangs is tried once more with a fresh page', { skip: !chrome }, async () => {
  const { launch, openEngine } = await import('../src/browser.js');
  let requests = 0;
  const hung = [];
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/frame.html')) return res.writeHead(404).end();
    // The first load never answers, like a stalled page on a busy machine.
    if (++requests === 1) return hung.push(res);
    res.writeHead(200, { 'content-type': 'text/html' }).end('<script>window.explainrooReady = Promise.resolve();</script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  try {
    const page = await openEngine(browser, `http://127.0.0.1:${server.address().port}`, { timeout: 1500 });
    assert.equal(requests, 2);
    assert.equal(browser.contexts().flatMap((c) => c.pages()).length, 1);
    assert.equal(await page.evaluate(() => typeof window.explainrooReady), 'object');
    requests = 0;
    server.removeAllListeners('request');
    server.on('request', (req, res) => hung.push(res));
    await assert.rejects(openEngine(browser, `http://127.0.0.1:${server.address().port}`, { timeout: 500 }), { name: 'TimeoutError' });
  } finally {
    await browser.close();
    for (const res of hung) res.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
