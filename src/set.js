// explainroo set: writes one setting into video.json. A dotted key like
// sizes.shorts.pace reaches into a block. The value is JSON when it reads as
// JSON, and text otherwise, and null takes the key out. The changed settings get
// the same check as every command, before anything is written. The rest of the
// file keeps its content, its order and its indentation.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError } from './errors.js';
import { findProjectDir, loadProject } from './project.js';

const NO_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) {
  throw new ProjectError(message);
}

// The indentation of a file written with JSON.stringify, or 0 for one line.
function indentOf(text) {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 0;
}

export function setSetting(arg, key, text) {
  const dir = findProjectDir(arg);
  const file = path.join(dir, 'video.json');
  if (!fs.existsSync(file)) fail(`${file} is missing. Run "explainroo init" to make a project.`);
  if (typeof key !== 'string' || !key) fail('set needs a key and a value, like: explainroo set videos/<name> targetSeconds 40');
  if (text === undefined) fail(`set needs a value for ${key}, like: explainroo set videos/<name> ${key} <value>. null takes it out.`);
  const parts = key.split('.');
  if (parts.some((part) => !part || NO_KEYS.has(part))) fail(`"${key}" is no setting. Write a key like targetSeconds, or a dotted one like sizes.shorts.pace.`);
  const before = fs.readFileSync(file, 'utf8');
  let settings;
  try {
    settings = JSON.parse(before);
  } catch (e) {
    fail(`video.json is not valid JSON: ${e.message}`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) fail('video.json must be an object like { "title": "How DNS works" }');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  const next = structuredClone(settings);
  let block = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const here = parts.slice(0, i + 1).join('.');
    if (block[part] === undefined || block[part] === null) {
      if (value === null) return { file, key, value: null, removed: false, changed: false };
      block[part] = {};
    } else if (here === 'music' && (block[part] === true || typeof block[part] === 'string')) {
      // "music": true is the look's own music, and "music": "calm" a style.
      // Both become a block that keeps the same music.
      block[part] = block[part] === true ? {} : { style: block[part] };
    } else if (typeof block[part] !== 'object' || Array.isArray(block[part])) {
      fail(`${here} is ${Array.isArray(block[part]) ? 'a list' : `${JSON.stringify(block[part])}`}, not a block of settings, so it has no ${parts[i + 1]}. Set ${here} as a whole instead.`);
    }
    block = block[part];
  }
  const last = parts.at(-1);
  const had = Object.hasOwn(block, last);
  if (value === null) delete block[last];
  else block[last] = value;
  // The same check as every command. A mistake stops here, and the file stays as it was.
  loadProject(dir, {}, { settings: next });
  const indent = indentOf(before);
  const written = JSON.stringify(next, null, indent) + (before.endsWith('\n') ? '\n' : '');
  const changed = written !== before;
  if (changed) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, written);
    fs.renameSync(temp, file);
  }
  return { file, key, value: value === null ? null : value, removed: value === null && had, changed };
}

export function formatSet(r) {
  const where = path.basename(r.file);
  if (r.value === null) return r.removed ? `took ${r.key} out of ${where}` : `${where} has no ${r.key}, so nothing changed`;
  return `${r.changed ? 'set' : 'kept'} ${r.key} to ${JSON.stringify(r.value)} in ${where}`;
}
