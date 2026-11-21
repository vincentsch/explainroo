// The voice runtime: transformers.js and kokoro-js, installed on first use into
// the cache folder. These tests run an installed copy of src/ with a fake npm, so
// nothing is downloaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npmCommand, npmEnv, npmProblem } from '../src/runtime.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function temp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-runtime-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the runtime installs the versions the checkout develops with, and its lock matches it', () => {
  const pkg = read('package.json');
  const runtime = read('runtime/package.json');
  const lock = read('runtime/lock.json');
  for (const name of ['@huggingface/transformers', 'kokoro-js']) {
    assert.equal(runtime.dependencies[name], pkg.devDependencies[name], name);
    assert.equal(pkg.dependencies[name], undefined, `${name} is a dependency of the package again`);
    assert.equal(lock.packages[`node_modules/${name}`].version, runtime.dependencies[name], name);
  }
  assert.deepEqual(lock.packages[''].dependencies, runtime.dependencies);
  assert.deepEqual(runtime.overrides, pkg.overrides);
  assert.ok(pkg.files.includes('runtime/'));
});

test('npm is the one npx ran, else the one next to node, else the one on the PATH', () => {
  const node = path.join('/opt', 'node', 'bin', 'node');
  const bundled = path.join('/opt', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npx = '/home/me/.nvm/npm/bin/npm-cli.js';
  const all = () => true;
  assert.deepEqual(npmCommand({ env: { npm_execpath: npx }, execPath: node, exists: all }), { command: node, args: [npx], shell: false });
  // pnpm and yarn set npm_execpath to themselves.
  assert.deepEqual(npmCommand({ env: { npm_execpath: '/usr/lib/pnpm/bin/pnpm.cjs' }, execPath: node, exists: (f) => f === bundled }), { command: node, args: [bundled], shell: false });
  assert.deepEqual(npmCommand({ env: {}, execPath: node, platform: 'linux', exists: () => false }), { command: 'npm', args: [], shell: false });
  assert.deepEqual(npmCommand({ env: {}, execPath: node, platform: 'win32', exists: () => false }), { command: 'npm.cmd', args: [], shell: true });
});

test("npm gets the user's own settings but not the folder npx ran in", () => {
  const env = npmEnv({ PATH: '/bin', npm_config_registry: 'https://mirror.example', HTTPS_PROXY: 'http://proxy:3128', npm_config_local_prefix: '/project', npm_package_json: '/project/package.json', npm_command: 'exec', INIT_CWD: '/project', npm_lifecycle_event: 'npx', NPM_CONFIG_PREFIX: '/opt' });
  assert.deepEqual(env, { PATH: '/bin', npm_config_registry: 'https://mirror.example', HTTPS_PROXY: 'http://proxy:3128', ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' });
});

test("npm's reason is the line that says what went wrong", () => {
  const output = ['npm error code ENOTFOUND', 'npm error syscall getaddrinfo', 'npm error errno ENOTFOUND',
    'npm error network request to https://registry.npmjs.org/kokoro-js failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
    'npm error network This is a problem related to network connectivity.', 'npm error A complete log of this run can be found in: /home/me/.npm/_logs/x.log'].join('\n');
  assert.equal(npmProblem(output), 'network request to https://registry.npmjs.org/kokoro-js failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org');
});

// A copy of explainroo as npm installs it: no .git, and no transformers.js or
// kokoro-js next to it. Its node_modules has the other dependencies.
function installedCopy(t) {
  const dir = temp(t);
  for (const folder of ['bin', 'src', 'engine', 'fonts', 'formats', 'templates', 'runtime']) fs.cpSync(path.join(ROOT, folder), path.join(dir, folder), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  for (const entry of fs.readdirSync(path.join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['@huggingface', 'kokoro-js'].includes(entry.name)) continue;
    fs.symlinkSync(path.join(ROOT, 'node_modules', entry.name), path.join(dir, 'node_modules', entry.name), 'junction');
  }
  return dir;
}

// A fake npm-cli.js. It writes what it was run with to calls.jsonl, then either
// fails like a network problem or installs two small stand-ins for the libraries.
function fakeNpm(t, { fail = false } = {}) {
  const dir = temp(t);
  const file = path.join(dir, 'npm-cli.js');
  fs.writeFileSync(file, `const fs = require('fs'); const path = require('path');
fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls.jsonl'))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), lock: fs.existsSync('package-lock.json'), npmrc: fs.existsSync('.npmrc') && fs.readFileSync('.npmrc', 'utf8'), cuda: process.env.ONNXRUNTIME_NODE_INSTALL_CUDA, prefix: process.env.npm_config_local_prefix ?? null }) + '\\n');
if (${fail}) { console.error('npm error code ENOTFOUND\\nnpm error network request to https://registry.npmjs.org/kokoro-js failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org'); process.exit(1); }
const put = (name, code) => { fs.mkdirSync(path.join('node_modules', name), { recursive: true }); fs.writeFileSync(path.join('node_modules', name, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' })); fs.writeFileSync(path.join('node_modules', name, 'index.js'), code); };
setTimeout(() => { put('@huggingface/transformers', 'export const env = {}; export function pipeline() {}'); put('kokoro-js', 'export class KokoroTTS {}'); }, 300);
`);
  return { file, calls: () => fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] };
}

// Loads the voice runtime in the installed copy, in a process of its own.
function loadRuntime(copy, env) {
  const code = `const { voiceRuntime } = await import(${JSON.stringify(pathToFileURL(path.join(copy, 'src', 'runtime.js')).href)});
const r = await voiceRuntime({ cache: process.env.EXPLAINROO_CACHE, log: console.log });
console.log(JSON.stringify({ pipeline: typeof r.transformers.pipeline, kokoro: typeof r.KokoroTTS }));`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { r.stdout += d; });
    child.stderr.on('data', (d) => { r.stderr += d; });
    child.on('close', (status) => resolve({ ...r, status }));
  });
}

test('an installed copy installs the runtime once, with npm and without install scripts, also for two commands at once', async (t) => {
  const copy = installedCopy(t);
  const cache = temp(t);
  const npm = fakeNpm(t);
  // The folder npx ran in, with an .npmrc that names a registry and its login.
  const project = temp(t);
  fs.writeFileSync(path.join(project, '.npmrc'), 'registry=https://npm.example/\n//npm.example/:_authToken=secret\n');
  const env = { EXPLAINROO_CACHE: cache, npm_execpath: npm.file, npm_config_local_prefix: project, EXPLAINROO_OFFLINE: '' };
  const [first, second] = await Promise.all([loadRuntime(copy, env), loadRuntime(copy, env)]);
  for (const r of [first, second]) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').at(-1), '{"pipeline":"function","kokoro":"function"}');
  }
  const calls = npm.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'ci');
  assert.ok(calls[0].args.includes('--ignore-scripts'));
  assert.equal(calls[0].lock, true);
  assert.equal(calls[0].cuda, 'skip');
  assert.equal(calls[0].prefix, null);
  assert.equal(calls[0].npmrc, 'registry=https://npm.example/\n//npm.example/:_authToken=secret\n');
  const folder = path.join(cache, 'runtime');
  const [installed] = fs.readdirSync(folder).filter((name) => !name.includes('.'));
  assert.match(installed, new RegExp(`^${process.platform}-${process.arch}-[0-9a-f]{12}$`));
  assert.ok(fs.existsSync(path.join(folder, installed, 'ready.json')));
  assert.ok(!fs.existsSync(path.join(folder, installed, '.npmrc')), 'the copy of the .npmrc stayed');
  assert.equal(path.dirname(calls[0].cwd), folder);
  assert.match(first.stdout + second.stdout, /installing the voice runtime, [\d.]+ MB, once\n/);

  // The next command finds it ready and runs npm no more.
  const again = await loadRuntime(copy, env);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(npm.calls().length, 1);
});

test('a failed or offline install says why and how to try again, and leaves no runtime that looks ready', async (t) => {
  const copy = installedCopy(t);
  const cache = temp(t);
  const npm = fakeNpm(t, { fail: true });
  const failed = await loadRuntime(copy, { EXPLAINROO_CACHE: cache, npm_execpath: npm.file, EXPLAINROO_OFFLINE: '' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /the voice runtime could not be installed: network request to https:\/\/registry\.npmjs\.org\/kokoro-js failed, reason: getaddrinfo ENOTFOUND registry\.npmjs\.org\. Run ".* doctor --fetch" to try again\./);
  assert.ok(!fs.readdirSync(path.join(cache, 'runtime')).some((name) => fs.existsSync(path.join(cache, 'runtime', name, 'ready.json'))));

  const offline = await loadRuntime(copy, { EXPLAINROO_CACHE: cache, npm_execpath: npm.file, EXPLAINROO_OFFLINE: '1' });
  assert.notEqual(offline.status, 0);
  assert.match(offline.stderr, /the free voice and the speech check need the voice runtime \([\d.]+ MB\), and EXPLAINROO_OFFLINE=1 keeps it from downloading\. Run ".* doctor --fetch" once while online\./);
  assert.equal(npm.calls().length, 1);
});
