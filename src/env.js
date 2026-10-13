import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.js';

export function readEnvFile(file, name) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

export function findEnv(name, projectDir, root = ROOT) {
  return process.env[name] || readEnvFile(path.join(projectDir, '.env'), name) || readEnvFile(path.join(root, '.env'), name);
}
