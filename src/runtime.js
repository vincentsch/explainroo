// The voice runtime: transformers.js and kokoro-js, which run Kokoro and Whisper
// on the CPU through ONNX Runtime. Together they are about 450 MB, more than all
// the rest of explainroo, and only the free voice and the speech check use them.
// So the package doesn't depend on them. The first command that needs them, or
// `doctor --fetch`, installs them into the cache folder with npm, from the lock
// file in runtime/. npm runs there without install scripts. The only one that
// matters is ONNX Runtime's, and it downloads CUDA files for Linux from GitHub,
// which explainroo never uses, because it runs on the CPU.
//
// A source checkout has both as devDependencies and uses those.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProjectError } from './errors.js';
import { withLock } from './lock.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(ROOT, 'runtime');
// Each file of runtime/ and its name in the installed folder. npm never packs a
// file named package-lock.json, so the package carries the lock as lock.json.
const FILES = { 'package.json': 'package.json', 'lock.json': 'package-lock.json', 'index.js': 'index.mjs' };
export const RUNTIME_SIZE = '450 MB';
const LIBRARIES = ['@huggingface/transformers', 'kokoro-js'];

const NPM_FLAGS = ['ci', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error'];

// The versions the runtime installs, like "transformers.js 3.8.1 and kokoro-js 1.2.1".
export function runtimeVersions() {
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8'));
  return `transformers.js ${dependencies['@huggingface/transformers']} and kokoro-js ${dependencies['kokoro-js']}`;
}

// A source checkout with its devDependencies installed uses its own copies.
function inCheckout() {
  return fs.existsSync(path.join(ROOT, '.git')) && LIBRARIES.every((name) => fs.existsSync(path.join(ROOT, 'node_modules', name, 'package.json')));
}

// The folder of the installed runtime. A new lock file, or another processor,
// gets a folder of its own, so an update never installs into a runtime in use.
// An older one stays, because another copy of explainroo may still use it.
export function runtimeDir(cache) {
  const hash = crypto.createHash('sha256');
  for (const file of Object.keys(FILES)) hash.update(fs.readFileSync(path.join(SOURCE, file)));
  return path.join(cache, 'runtime', `${process.platform}-${process.arch}-${hash.digest('hex').slice(0, 12)}`);
}

const isReady = (dir) => fs.existsSync(path.join(dir, 'ready.json'));

// Where the runtime is, and whether it is there yet.
export function runtimeState(cache) {
  if (inCheckout()) return { ready: true, where: path.join(ROOT, 'node_modules'), checkout: true };
  const dir = runtimeDir(cache);
  return { ready: isReady(dir), where: dir, checkout: false };
}

let loaded = null;

// The module of runtime/index.js: { transformers, KokoroTTS }. It installs the
// runtime first when it is missing.
export function voiceRuntime({ cache, log = () => {} }) {
  if (!loaded) {
    loaded = load(cache, log);
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}

async function load(cache, log) {
  if (inCheckout()) return import(pathToFileURL(path.join(SOURCE, 'index.js')).href);
  const dir = runtimeDir(cache);
  if (!isReady(dir)) await installRuntime(dir, log);
  return import(pathToFileURL(path.join(dir, 'index.mjs')).href);
}

async function installRuntime(dir, log) {
  const { selfCommand } = await import('./history.js');
  const fetch = `"${selfCommand()} doctor --fetch"`;
  if (process.env.EXPLAINROO_OFFLINE === '1') {
    throw new ProjectError(`the free voice and the speech check need the voice runtime (${RUNTIME_SIZE}), and EXPLAINROO_OFFLINE=1 keeps it from downloading. Run ${fetch} once while online.`);
  }
  // Another command may be installing it right now. Then this one waits for it.
  const waiting = setTimeout(() => log('waiting for another explainroo command that installs the voice runtime'), 1000);
  await withLock(`${dir}.lock`, async () => {
    clearTimeout(waiting);
    if (isReady(dir)) return;
    const partial = `${dir}.partial`;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    for (const [from, to] of Object.entries(FILES)) fs.copyFileSync(path.join(SOURCE, from), path.join(partial, to));
    // npx may have installed explainroo from a registry that the .npmrc of the
    // folder it ran in names, with a login. npm reads that file only in that
    // folder, so the install gets a copy, and the copy goes again right after.
    const projectNpmrc = process.env.npm_config_local_prefix ? path.join(process.env.npm_config_local_prefix, '.npmrc') : null;
    const npmrc = path.join(partial, '.npmrc');
    if (projectNpmrc && fs.existsSync(projectNpmrc)) fs.copyFileSync(projectNpmrc, npmrc);
    const started = Date.now();
    log(`installing the voice runtime, ${RUNTIME_SIZE}, once`);
    try {
      await runNpm(partial, { log, started, fetch });
    } finally {
      fs.rmSync(npmrc, { force: true });
    }
    await checkRuntime(partial);
    fs.writeFileSync(path.join(partial, 'ready.json'), JSON.stringify({ installed: new Date().toISOString(), node: process.version }) + '\n');
    fs.rmSync(dir, { recursive: true, force: true });
    await renameFolder(partial, dir);
    log(`installed the voice runtime in ${Math.round((Date.now() - started) / 1000)}s`);
  }, { waitMs: Infinity, pauseMs: 500, busy: () => null });
  clearTimeout(waiting);
}

// Windows can refuse a rename for a moment while a virus scanner reads the new
// files, so it tries a few times.
async function renameFolder(from, to) {
  for (let tries = 1; ; tries++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (tries === 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// npm itself: the one that started this command through npx, else the one that
// came with this Node, else the npm on the PATH.
export function npmCommand({ env = process.env, execPath = process.execPath, platform = process.platform, exists = fs.existsSync } = {}) {
  const bin = path.dirname(execPath);
  const scripts = [
    env.npm_execpath && path.basename(env.npm_execpath) === 'npm-cli.js' ? env.npm_execpath : null,
    path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const script = scripts.find((file) => file && exists(file));
  if (script) return { command: execPath, args: [script], shell: false };
  return platform === 'win32' ? { command: 'npm.cmd', args: [], shell: true } : { command: 'npm', args: [], shell: false };
}

// What npx tells the command it starts about the folder it ran in. Passed on, it
// could send npm's install there, so it stays out. Everything else stays, like a
// registry, a proxy or a certificate the user set for npm.
const FROM_NPX = /^(npm_command|npm_package_.*|npm_lifecycle_.*|npm_config_(local_prefix|prefix|global|location|workspaces?|include_workspace_root)|init_cwd)$/i;

export function npmEnv(env = process.env) {
  const out = Object.fromEntries(Object.entries(env).filter(([key]) => !FROM_NPX.test(key)));
  out.ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip';
  return out;
}

// The line of npm's output that says what went wrong, like "network request to
// https://registry.npmjs.org/... failed, reason: getaddrinfo ENOTFOUND".
export function npmProblem(output) {
  const said = output.split('\n').filter((l) => /^npm (error|ERR!)/.test(l)).map((l) => l.replace(/^npm (error|ERR!)\s*/, '').trim());
  return said.find((l) => l && !/^(code|errno|syscall|path|command)\b|^A complete log|^\//.test(l)) ?? output.trim().split('\n').at(-1) ?? '';
}

function runNpm(cwd, { log, started, fetch }) {
  const { command, args, shell } = npmCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, ...NPM_FLAGS], { cwd, env: npmEnv(), shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const keep = (d) => { output = (output + d).slice(-20000); };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    const ticker = log.update ? setInterval(() => log.update(`installing the voice runtime, ${RUNTIME_SIZE}: ${Math.round((Date.now() - started) / 1000)}s`), 1000) : null;
    const done = (error) => {
      clearInterval(ticker);
      if (!error) return resolve();
      // The line that counted the seconds goes, so the error starts a line.
      if (ticker) log.update('');
      reject(error);
    };
    child.on('error', (e) => done(e.code === 'ENOENT'
      ? new ProjectError(`the voice runtime installs with npm, and npm was not found. Install Node.js with npm, then run ${fetch}.`)
      : e));
    child.on('close', (status) => done(status === 0 ? null
      : new ProjectError(`the voice runtime could not be installed: ${npmProblem(output) || `npm stopped with exit code ${status}`}. Run ${fetch} to try again.`)));
  });
}

// Loads the new runtime in a process of its own, so a runtime that can't run on
// this computer never counts as installed, and this process loads it only once.
function checkRuntime(dir) {
  const entry = pathToFileURL(path.join(dir, 'index.mjs')).href;
  const code = `const m = await import(${JSON.stringify(entry)}); if (typeof m.KokoroTTS !== 'function' || typeof m.transformers.pipeline !== 'function') throw new Error('it is missing a part');`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.setEncoding('utf8').on('data', (d) => { err = (err + d).slice(-8000); });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status === 0) return resolve();
      const reason = err.split('\n').map((l) => l.trim()).find((l) => /^\w*Error\b/.test(l)) ?? `exit code ${status}`;
      reject(new ProjectError(`the voice runtime does not run on this computer (${process.platform} ${process.arch}): ${reason.replace(/^Error: /, '')}`));
    });
  });
}
