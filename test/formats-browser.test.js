// Every built-in format's example passes check, and so does a project that init
// made from it. The narration is cached, so the voice model never loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { BUILT_IN } from '../src/formats.js';
import { cachedVoice } from './helpers/cached-voice.js';
import { runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

for (const name of fs.readdirSync(BUILT_IN).sort()) {
  test(`the ${name} format checks without errors or warnings, from init`, { skip }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-format-check-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'video');
    const made = await runCli(['init', dir, '--format', name]);
    assert.equal(made.code, 0, made.text);
    for (const scene of loadProject(dir).script.scenes) cachedVoice(dir, scene.id);
    const r = await runCli(['check', dir, '--json']);
    const { issues } = JSON.parse(r.stdout);
    const bad = issues.filter((i) => i.level === 'error' || i.level === 'warn');
    assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  });
}
