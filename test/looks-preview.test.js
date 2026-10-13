import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('preview reloads an outside look and recovers after invalid or missing look files', { timeout: 15000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-look-preview-'));
  const dir = path.join(root, 'video');
  fs.mkdirSync(dir);
  const settings = path.join(dir, 'video.json');
  const look = path.join(root, 'brand.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: '../brand.json' }));
  fs.writeFileSync(look, JSON.stringify({ extends: 'clean' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo {min=1}');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo() {} };');
  const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
  const child = spawn(process.execPath, [bin, 'preview', dir, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  const until = async fn => {
    for (let i = 0; i < 80; i++) {
      const value = await fn();
      if (value) return value;
      await setTimeout(100);
    }
    assert.fail(`preview did not update: ${logs}`);
  };
  try {
    const url = await until(() => /preview: (http:\/\/127\.0\.0\.1:\d+)/.exec(logs)?.[1]);
    const state = async () => (await fetch(url + '/__state.json')).json();
    const first = await state();
    fs.writeFileSync(look, JSON.stringify({ extends: 'clean', bg: '#ffffff' }));
    const changed = await until(async () => {
      const s = await state();
      return s.config.look.bg === '#ffffff' && s;
    });
    assert.notEqual(changed.version, first.version);
    fs.writeFileSync(look, JSON.stringify({ extends: 'clean', dark: 'yes' }));
    await until(async () => (await state()).error?.includes('dark'));
    fs.writeFileSync(look, JSON.stringify({ extends: 'clean', bg: '#eeeeee' }));
    await until(async () => { const s = await state(); return !s.error && s.config.look.bg === '#eeeeee'; });
    fs.writeFileSync(settings, JSON.stringify({ theme: '../missing.json' }));
    await until(async () => (await state()).error?.includes('missing.json'));
    fs.writeFileSync(path.join(root, 'missing.json'), JSON.stringify({ extends: 'paper' }));
    await until(async () => { const s = await state(); return !s.error && s.config.look.extends === 'paper'; });
  } finally {
    child.kill('SIGTERM');
    await exited;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
