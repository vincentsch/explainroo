// Only "explainroo share" sends a video to the hosted service. With the narration and
// the models already here, render, package and verify make no outside request at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome } from '../src/browser.js';
import { startFakeServices } from './helpers/fake-services.js';
import { runCli, speechCheckModel, tinyProject } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}

test('render, package and verify make no outside requests, and nothing reaches the hosted service', { skip: (!chrome && 'no browser here') || (!speechCheckModel && 'the speech check model is not downloaded'), timeout: 300000 }, async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = tinyProject(t);
  for (const args of [['render', dir, '--workers', '1'], ['package', dir, '--platform', 'tiktok', '--workers', '1'], ['package', dir, '--platform', 'youtube', '--workers', '1'], ['verify', dir]]) {
    // The hosted service and every other service point at the fake here.
    const r = await runCli([...args, '--json'], fake.env);
    assert.equal(r.code, 0, r.text);
    // Each process runs under the test guard, which stops a request to anywhere else.
    assert.doesNotMatch(r.stderr, /test guard: blocked/, args[0]);
  }
  assert.equal(fake.total(), 0);
});
