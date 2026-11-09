// Formats: ready ways of making one kind of video. A format is a folder that is
// also a project, so its example renders as it is:
//   format.json  name, description, author and version
//   guide.md     short guidance for the agent, under 4 KB
//   format.js    scene helpers that scenes.js imports
//   video.json   the settings a new project starts with
//   script.md    the example narration
//   scenes.js    the example scenes
//   assets/      optional files the example uses
// Built-in formats live in formats/ of the package. "formats add" installs one
// from a Git address into the cache. Installing runs no code from the format:
// its format.js and scenes.js run only in the render page of a project that an
// agent made from it with "init --format".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProjectError } from './errors.js';
import { cacheRoot } from './models.js';
import { normalizeConfig } from './project.js';
import { findService } from './services.js';
import { ROOT } from './server.js';

export const BUILT_IN = path.join(ROOT, 'formats');
export const GUIDE_LIMIT = 4096;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NEEDED = ['format.json', 'guide.md', 'video.json', 'script.md', 'scenes.js'];
// What init copies into a new project. format.md is the guide.
const COPIED = ['script.md', 'scenes.js', 'format.js'];

export function installedRoot() {
  return path.join(cacheRoot(), 'formats');
}

function fail(message) {
  throw new ProjectError(message);
}

function readJson(file, where) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${where} is not valid JSON: ${e.message}`);
  }
}

// Every file of a format folder, relative to it. A link could point anywhere on
// this computer, so a format with one is refused.
function formatFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const name = path.join(rel, entry.name);
    if (entry.name.startsWith('.') || ['build', 'out', 'history'].includes(name)) continue;
    if (entry.isSymbolicLink()) fail(`the format has a link, ${name.split(path.sep).join('/')}, and a format may only hold plain files`);
    if (entry.isDirectory()) out.push(...formatFiles(dir, name));
    else if (entry.isFile()) out.push(name.split(path.sep).join('/'));
  }
  return out.sort();
}

// Reads and checks one format folder. `where` names it in messages.
export function readFormat(dir, where = path.basename(dir)) {
  for (const file of NEEDED) if (!fs.existsSync(path.join(dir, file))) fail(`${where} has no ${file}. A format needs ${NEEDED.join(', ')}, see "explainroo docs formats"`);
  const info = readJson(path.join(dir, 'format.json'), `${where}/format.json`);
  if (!info || typeof info !== 'object' || Array.isArray(info)) fail(`${where}/format.json must be an object with name, description, author and version`);
  for (const key of ['name', 'description', 'author', 'version']) {
    if (typeof info[key] !== 'string' || !info[key].trim()) fail(`${where}/format.json needs "${key}" as a text`);
  }
  if (!NAME.test(info.name)) fail(`${where}/format.json: the name "${info.name}" may only use small letters, digits and "-", up to 40 characters`);
  if (info.description.length > 200) fail(`${where}/format.json: keep the description under 200 characters`);
  const guide = fs.readFileSync(path.join(dir, 'guide.md'), 'utf8');
  if (Buffer.byteLength(guide) > GUIDE_LIMIT) fail(`${where}/guide.md has ${Buffer.byteLength(guide)} bytes, and a guide stays under ${GUIDE_LIMIT}, because an agent reads all of it`);
  const settings = readJson(path.join(dir, 'video.json'), `${where}/video.json`);
  try {
    normalizeConfig({ title: info.name, ...settings }, dir);
  } catch (e) {
    if (e instanceof ProjectError) fail(`${where}/video.json: ${e.message}`);
    throw e;
  }
  // A format never brings in a service that costs money. The user picks one.
  const voice = settings.voice;
  const provider = voice && typeof voice === 'object' ? voice.provider : null;
  if (provider && !findService(provider)?.free) fail(`${where}/video.json sets the voice to ${findService(provider)?.name ?? provider}, which costs money. A format starts with a free voice, and the user picks a paid one`);
  const files = formatFiles(dir);
  return { ...info, dir, guide, settings, files, code: files.filter((f) => /\.m?js$/.test(f)) };
}

function source(dir) {
  const file = path.join(dir, '.source.json');
  return fs.existsSync(file) ? readJson(file, file) : null;
}

// The built-in formats, then the installed ones. A folder that doesn't check out
// is listed with its problem, so one broken install doesn't hide the others.
export function listFormats() {
  const found = [];
  for (const [root, origin] of [[BUILT_IN, 'built-in'], [installedRoot(), 'installed']]) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort()) {
      const dir = path.join(root, name);
      if (name.startsWith('.') || !fs.statSync(dir).isDirectory()) continue;
      if (origin === 'installed' && found.some((f) => f.name === name)) continue;
      try {
        found.push({ ...readFormat(dir, name), origin, source: origin === 'installed' ? source(dir) : null });
      } catch (e) {
        if (!(e instanceof ProjectError)) throw e;
        found.push({ name, origin, dir, broken: e.message });
      }
    }
  }
  return found;
}

export function findFormat(name) {
  const all = listFormats();
  const f = all.find((x) => x.name === name);
  if (!f) fail(`there is no format "${name}". The formats are ${all.map((x) => x.name).join(', ')}. Run "explainroo formats" to see them`);
  if (f.broken) fail(`the format "${name}" can't be used: ${f.broken}`);
  return f;
}

// What "formats" prints for each format.
export function formatEntry(f) {
  if (f.broken) return { name: f.name, origin: f.origin, broken: f.broken };
  return {
    name: f.name, description: f.description, author: f.author, version: f.version, origin: f.origin,
    size: f.settings.size ?? '16:9', theme: f.settings.theme ?? 'paper', dir: f.dir, code: f.code,
    ...(f.source ? { source: f.source } : {}),
  };
}

export function formatList(entries) {
  const rows = entries.map((f) => {
    if (f.broken) return `${f.name.padEnd(20)} can't be used: ${f.broken}`;
    const from = f.origin === 'built-in' ? 'built in' : `installed from ${f.source?.url ?? '?'} at ${String(f.source?.commit ?? '?').slice(0, 12)}`;
    return `${f.name.padEnd(20)} ${f.description}\n${''.padEnd(21)}${f.size}, ${f.theme}, by ${f.author}, version ${f.version}, ${from}`;
  });
  return `${rows.join('\n')}\n\nStart a project from one with "explainroo init videos/<name> --format <format>". "explainroo formats <format>" prints its guide.\nInstall one from a Git address with "explainroo formats add <address>". The sizes moved to "explainroo sizes".`;
}

// The first heading of the example script becomes the title of the new video.
function retitle(script, title) {
  return /^# .*$/m.test(script) ? script.replace(/^# .*$/m, `# ${title}`) : `# ${title}\n\n${script}`;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

// Fills a new project folder from a format. `config` is what init settled from
// the format's video.json and the flags.
export function startFromFormat(f, target, config) {
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(target, 'video.json'), JSON.stringify(config, null, 2) + '\n');
  for (const file of COPIED) {
    const from = path.join(f.dir, file);
    if (!fs.existsSync(from)) continue;
    const text = fs.readFileSync(from, 'utf8');
    fs.writeFileSync(path.join(target, file), file === 'script.md' ? retitle(text, config.title) : text);
  }
  if (fs.existsSync(path.join(f.dir, 'assets'))) copyTree(path.join(f.dir, 'assets'), path.join(target, 'assets'));
  fs.writeFileSync(path.join(target, 'format.md'), `<!-- The guide of the format "${f.name}" ${f.version} by ${f.author}. -->\n\n${f.guide}`);
  // Someone else's format gets its credit in every package of the video.
  if (f.author.trim().toLowerCase() !== 'explainroo') {
    fs.writeFileSync(path.join(target, 'post.json'), JSON.stringify({ credits: [`Format: ${f.name} by ${f.author}`] }, null, 2) + '\n');
  }
}

// ---------- installing from Git ----------

// Git runs with no hooks, no links and no prompts, and only over https, ssh,
// git or a local path.
function gitArgs(args) {
  return ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.symlinks=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.git.allow=always', '-c', 'protocol.file.allow=always', ...args];
}

function git(args, cwd) {
  const r = spawnSync('git', gitArgs(args), { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error?.code === 'ENOENT') fail('formats add needs git. Install git and try again');
  if (r.status !== 0) fail(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
  return r.stdout.trim();
}

export function checkAddress(url) {
  if (typeof url !== 'string' || !url || url.startsWith('-')) fail('usage: explainroo formats add <git address> [--commit <commit>] [--yes]');
  const ok = /^(https|ssh|git):\/\//.test(url) || /^file:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url) || path.isAbsolute(url) || url.startsWith('.');
  if (!ok) fail(`"${url}" is no Git address. Use one like https://github.com/<user>/<repo>.git`);
  return url;
}

function checkCommit(commit) {
  if (commit === undefined) return null;
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/i.test(commit)) fail('--commit needs a commit id, like 3f2a9c1');
  return commit.toLowerCase();
}

// What "formats add" will run, printed before anything runs.
export function addPlan(url, { commit } = {}) {
  checkAddress(url);
  const pinned = checkCommit(commit);
  const temp = path.join(installedRoot(), '.incoming');
  return {
    url,
    commit: pinned,
    commands: [
      `git clone --no-checkout --quiet ${url} ${temp}`,
      `git checkout --quiet --detach ${pinned ?? 'HEAD'}`,
    ],
    into: installedRoot(),
    steps: [
      pinned ? `It takes the files of commit ${pinned}.` : 'It takes the files of the newest commit of the default branch, and keeps that commit.',
      'Git runs with hooks turned off, so nothing in the repository runs.',
      'Then it checks format.json, guide.md and video.json, and copies the folder to the cache.',
      'Nothing from the format runs now. Its format.js and scenes.js run only in the render page of a project you make with "explainroo init --format".',
    ],
  };
}

export function formatPlan(plan) {
  return [
    `"formats add" will run:`,
    ...plan.commands.map((c) => `  ${c}`),
    ...plan.steps,
    `It installs into ${plan.into}.`,
    'Run the same command with --yes to install it.',
  ].join('\n');
}

export function addFormat(url, { commit } = {}) {
  const plan = addPlan(url, { commit });
  const root = installedRoot();
  fs.mkdirSync(root, { recursive: true });
  const temp = fs.mkdtempSync(path.join(root, '.incoming-'));
  try {
    git(['clone', '--no-checkout', '--quiet', url, temp]);
    git(['checkout', '--quiet', '--detach', plan.commit ?? 'HEAD'], temp);
    const sha = git(['rev-parse', 'HEAD'], temp);
    const f = readFormat(temp, url);
    if (fs.existsSync(path.join(BUILT_IN, f.name))) fail(`a built-in format is called "${f.name}". Ask the format's author to rename it`);
    const target = path.join(root, f.name);
    const replaced = fs.existsSync(target) ? source(target) : null;
    // A copy without .git, so the cache holds the files and the record only.
    const staged = fs.mkdtempSync(path.join(root, '.staged-'));
    for (const file of f.files) {
      fs.mkdirSync(path.dirname(path.join(staged, file)), { recursive: true });
      fs.copyFileSync(path.join(temp, file), path.join(staged, file));
    }
    const record = { url, commit: sha, installed: new Date().toISOString() };
    fs.writeFileSync(path.join(staged, '.source.json'), JSON.stringify(record, null, 2) + '\n');
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staged, target);
    return { ...formatEntry({ ...readFormat(target, f.name), origin: 'installed', source: record }), ...(replaced ? { replaced } : {}) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function formatAdded(r) {
  return [
    `installed ${r.name} ${r.version} by ${r.author} from ${r.source.url} at ${r.source.commit}`,
    ...(r.replaced ? [`It replaced the copy from ${r.replaced.url} at ${String(r.replaced.commit).slice(0, 12)}.`] : []),
    `  ${r.description}`,
    `Its code runs in the render page of a project made from it: ${r.code.join(', ') || 'none'}. Read it before you use the format.`,
    `Read its guide with "explainroo formats ${r.name}", and start a project with "explainroo init videos/<name> --format ${r.name}".`,
  ].join('\n');
}
