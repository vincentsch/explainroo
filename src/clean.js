// explainroo clean: takes out what build/ holds that the next run makes again
// by itself, like the frames taken from clips and recordings, decoded sounds
// and the parts of a render, and says how much room that frees. It keeps the
// narration, which takes a voice run to make again and may have cost money,
// and the old log of bought images.
import fs from 'node:fs';
import path from 'node:path';
import { findProjectDir, ProjectError } from './project.js';
import { LANGUAGES } from './models.js';

// What clean keeps: build/voice/, also inside a language or pace folder, and
// build/images/, the log of images bought before the project record.
const KEEP = new Set(['voice', 'images']);

// The size of a file, or of a folder with everything in it. Links count as
// themselves and are never followed.
function sizeOf(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(file).reduce((sum, name) => sum + sizeOf(path.join(file, name)), 0);
}

// The parts of build/ clean takes out. A language folder like build/es/ and a
// pace folder like build/pace-1.2/ are looked into, so their narration stays.
export function cleanable(dir) {
  const build = path.join(dir, 'build');
  const stat = fs.lstatSync(build, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) throw new ProjectError('build/ is a link or a file, so clean leaves it alone. Move it, and the next run makes a new one.');
  const parts = [];
  const walk = (folder) => {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name);
      const isFolder = fs.lstatSync(file).isDirectory();
      if (isFolder && KEEP.has(name)) continue;
      if (isFolder && (Object.hasOwn(LANGUAGES, name) || /^pace-[\d.]+$/.test(name))) walk(file);
      else parts.push({ file, rel: path.relative(dir, file).split(path.sep).join('/') + (isFolder ? '/' : ''), bytes: sizeOf(file) });
    }
  };
  walk(build);
  return parts;
}

export function clean(dirArg, { dryRun = false } = {}) {
  const dir = findProjectDir(dirArg);
  const parts = cleanable(dir);
  if (!dryRun) for (const part of parts) fs.rmSync(part.file, { recursive: true, force: true });
  return { project: dir, dryRun, removed: parts.map(({ rel, bytes }) => ({ path: rel, bytes })), bytes: parts.reduce((sum, p) => sum + p.bytes, 0) };
}

export function sizeWords(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} bytes`;
}

export function formatClean(r) {
  if (!r.removed.length) return 'build/ holds nothing to take out. The narration in build/voice/ stays.';
  const width = Math.max(...r.removed.map((p) => p.path.length));
  return [
    ...r.removed.map((p) => `${p.path.padEnd(width)}  ${sizeWords(p.bytes)}`),
    `${r.dryRun ? 'would free' : 'freed'} ${sizeWords(r.bytes)}. The next run makes these again when it needs them. The narration in build/voice/ stays.`,
  ].join('\n');
}
