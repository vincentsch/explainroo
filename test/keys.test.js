import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findEnv, settingsEnvFile } from '../src/env.js';
import { configRoot } from '../src/models.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test('a key is looked up in the environment, the project, the package folder and last the settings folder', (t) => {
  const name = 'EXPLAINROO_TEST_KEY';
  const [project, root, settings] = [temp(t), temp(t), temp(t)];
  setEnv(t, 'EXPLAINROO_CONFIG', settings);
  setEnv(t, name, 'environment');
  for (const [dir, value] of [[project, 'project'], [root, 'package'], [settings, 'settings']]) {
    fs.writeFileSync(path.join(dir, '.env'), `${name}=${value}\n`);
  }
  assert.equal(findEnv(name, project, root), 'environment');
  setEnv(t, name, undefined);
  assert.equal(findEnv(name, project, root), 'project');
  fs.rmSync(path.join(project, '.env'));
  assert.equal(findEnv(name, project, root), 'package');
  fs.rmSync(path.join(root, '.env'));
  assert.equal(findEnv(name, project, root), 'settings');
  fs.rmSync(path.join(settings, '.env'));
  assert.equal(findEnv(name, project, root), null);
});

test('the settings folder follows EXPLAINROO_CONFIG, then XDG_CONFIG_HOME on Linux and macOS, and APPDATA on Windows', (t) => {
  setEnv(t, 'EXPLAINROO_CONFIG', '/some/settings');
  setEnv(t, 'XDG_CONFIG_HOME', '/some/xdg');
  setEnv(t, 'APPDATA', '/some/appdata');
  for (const platform of ['linux', 'darwin', 'win32']) assert.equal(configRoot(platform), '/some/settings');
  assert.equal(settingsEnvFile(), path.join('/some/settings', '.env'));
  setEnv(t, 'EXPLAINROO_CONFIG', undefined);
  assert.equal(configRoot('linux'), path.join('/some/xdg', 'explainroo'));
  assert.equal(configRoot('darwin'), path.join('/some/xdg', 'explainroo'));
  assert.equal(configRoot('win32'), path.join('/some/appdata', 'explainroo'));
  setEnv(t, 'XDG_CONFIG_HOME', undefined);
  setEnv(t, 'APPDATA', undefined);
  assert.equal(configRoot('linux'), path.join(os.homedir(), '.config', 'explainroo'));
  assert.equal(configRoot('darwin'), path.join(os.homedir(), '.config', 'explainroo'));
  assert.equal(configRoot('win32'), path.join(os.homedir(), 'AppData', 'Roaming', 'explainroo'));
});

test('the CLI uses a key from the settings folder, and without one it says where the key goes', (t) => {
  const [project, settings] = [temp(t), temp(t)];
  const env = { ...process.env, EXPLAINROO_CONFIG: settings };
  delete env.ELEVENLABS_API_KEY;
  const voices = () => spawnSync(process.execPath, [bin, 'voices', project, '--elevenlabs'], { encoding: 'utf8', env });
  const missing = voices();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ElevenLabs needs an API key/);
  assert.ok(missing.stderr.includes(path.join(settings, '.env')));
  fs.writeFileSync(path.join(settings, '.env'), 'ELEVENLABS_API_KEY=not-a-real-key\n');
  // With the key it goes on to the request, which the test guard stops.
  assert.match(voices().stderr, /test guard: blocked a request to https:\/\/api\.elevenlabs\.io/);
});

test('doctor names the file for keys', (t) => {
  const settings = temp(t);
  const r = spawnSync(process.execPath, [bin, 'doctor', '--json'], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_CONFIG: settings } });
  const row = JSON.parse(r.stdout).checks.find((c) => c.name === 'keys file');
  assert.ok(row.detail.startsWith(path.join(settings, '.env')));
});
