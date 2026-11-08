import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.js';
import { configRoot } from './models.js';
import { ProjectError } from './errors.js';
import { fileKey, lockWords, secondsWords, withLock, withLockSync } from './lock.js';

export function readEnvFile(file, name) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

// The file for keys that every project can use.
export function settingsEnvFile() {
  return path.join(configRoot(), '.env');
}

// Where connect saves a key. A source checkout keeps its keys in its own folder,
// as it always has. An installed copy can be thrown away, so it uses the settings
// folder, and so does anyone who set EXPLAINROO_CONFIG.
export function keyFile({ project = null, root = ROOT, env = process.env } = {}) {
  if (project) return path.join(project, '.env');
  if (!env.EXPLAINROO_CONFIG && fs.existsSync(path.join(root, '.git'))) return path.join(root, '.env');
  return settingsEnvFile();
}

// How long a run waits for another one that writes the same .env file. A login
// renewal holds it for one request with a timeout of 30 seconds. Tests set it
// shorter.
export const envLockMs = () => Number(process.env.EXPLAINROO_LOGIN_LOCK_MS) || 60 * 1000;

// One short name per .env file, from its real path, so a link to the file or
// another letter case gets the same one.
export function envFileId(file) {
  return crypto.createHash('sha256').update(fileKey(file)).digest('hex').slice(0, 16);
}

// The lock of one .env file. A login renewal holds it from reading the old refresh
// token to saving the new one, and every other write to the file takes it too, so
// none of them can write over what another one saved.
export function envLock(file) {
  const lock = path.join(configRoot(), 'locks', envFileId(file));
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  return lock;
}

function envBusy(file, waitMs) {
  return (lock) => new ProjectError(`another run is renewing a login in ${file} or saving a key there right now, and this one waited ${secondsWords(waitMs)} for it. Nothing was saved. Run the same command again in a minute. ${lockWords(lock)}`);
}

// Runs fn while this run holds the lock of the .env file. fn writes with writeKeys.
export function withEnvLock(file, fn) {
  const waitMs = envLockMs();
  return withLock(envLock(file), fn, { waitMs, pauseMs: 100, busy: envBusy(file, waitMs) });
}

// Writes one line of a .env file. An existing line is replaced, other lines stay,
// and a new file can only be read by its owner.
export function saveKey(file, name, value) {
  saveKeys(file, { [name]: value });
}

// The same for several lines, under the lock of the file.
export function saveKeys(file, values) {
  const waitMs = envLockMs();
  withLockSync(envLock(file), () => writeKeys(file, values), { waitMs, busy: envBusy(file, waitMs) });
}

// Writes several lines at once, so a run that dies leaves all of them or none. The
// new file is on the disk before it takes the old one's place, so a computer that
// loses power right then keeps one of the two whole. Only for a run that holds the
// lock of the file. Everyone else uses saveKeys.
export function writeKeys(file, values) {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const mode = old === null ? 0o600 : fs.statSync(target).mode & 0o777;
  const lines = old === null ? [] : old.split('\n');
  for (const [name, value] of Object.entries(values)) {
    const isKey = (line) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line);
    const at = lines.findIndex(isKey);
    if (at === -1) {
      if (lines.at(-1) === '') lines.pop();
      lines.push(`${name}=${value}`, '');
    } else {
      lines[at] = `${name}=${value}`;
      for (let i = lines.length - 1; i > at; i--) if (isKey(lines[i])) lines.splice(i, 1);
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, lines.join('\n'), { mode, flush: true });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, target);
}

// Where a value is found, in the same order as findEnv. `file` is null when it
// comes from the environment, which no command can change.
export function findEnvSource(name, projectDir, root = ROOT) {
  if (process.env[name]) return { value: process.env[name], file: null };
  for (const file of [path.join(projectDir, '.env'), path.join(root, '.env'), settingsEnvFile()]) {
    const value = readEnvFile(file, name);
    if (value) return { value, file };
  }
  return null;
}

export function findEnv(name, projectDir, root = ROOT) {
  return findEnvSource(name, projectDir, root)?.value ?? null;
}

// A setting for every project, like EXPLAINROO_ESPEAK: from the environment, or
// else from the .env of a source checkout or the settings file, so it is set once.
export function settingValue(name, root = ROOT) {
  return findEnv(name, root, root);
}
