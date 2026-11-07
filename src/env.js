import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.js';
import { configRoot } from './models.js';

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

// Writes one line of a .env file. An existing line is replaced, other lines stay,
// and a new file can only be read by its owner.
export function saveKey(file, name, value) {
  saveKeys(file, { [name]: value });
}

// Writes several lines at once, so a run that dies leaves all of them or none.
export function saveKeys(file, values) {
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
  fs.writeFileSync(temp, lines.join('\n'), { mode });
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
