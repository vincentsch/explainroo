// Shared steps: voice + timeline, the page state the engine loads, and a
// session that runs the engine in headless Chrome.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureFonts } from './fonts.js';
import { synthesize } from './voice.js';
import { buildTimeline } from './timeline.js';
import { listAssets, loadProject } from './project.js';
import { startServer, ROOT } from './server.js';
import { launch, openEngine } from './browser.js';

export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export async function prepare(project, { log = () => {}, ...voice } = {}) {
  await ensureFonts(project.config.language, { log });
  const voices = await synthesize(project, { log, ...voice });
  const timeline = buildTimeline(project, voices);
  fs.mkdirSync(project.paths.build, { recursive: true });
  fs.writeFileSync(path.join(project.paths.build, 'timeline.json'), JSON.stringify(timeline, null, 2));
  return { voices, timeline };
}

function fileStamp(p) {
  try {
    const st = fs.statSync(p);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

export function makeState(project, timeline) {
  const assets = listAssets(project.dir);
  const stamp = [
    fileStamp(project.paths.scenes),
    ...(project.paths.look ? [fileStamp(project.paths.look)] : []),
    ...assets.map((a) => a + '@' + fileStamp(path.join(project.dir, a))),
    ...fs.readdirSync(project.dir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs')).map((f) => f + '@' + fileStamp(path.join(project.dir, f))),
  ].join('|');
  const version = crypto.createHash('sha1').update(stamp + JSON.stringify(timeline) + JSON.stringify(project.config)).digest('hex').slice(0, 12);
  return { config: project.config, timeline, assets, version, title: project.config.title };
}

// The Node files that shape frames and sound, next to the page engine.
const RENDER_FILES = ['src/render.js', 'src/ffmpeg.js', 'src/pipeline.js', 'src/sounds.js'];
// Folders in a project that no scene imports from.
const NOT_SCRIPTS = new Set(['build', 'out', 'history', 'assets']);

function filesUnder(root, folder = '', skip = () => false) {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((entry) => {
    const rel = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return skip(entry.name, folder) ? [] : filesUnder(root, rel, skip);
    return entry.isFile() ? [rel] : [];
  });
}

function hashFiles(hash, root, files) {
  for (const rel of files) hash.update(rel).update('\0').update(fs.readFileSync(path.join(root, rel)));
  return hash;
}

const codeHashes = new Map();

export function renderingCodeHash(root = ROOT, version = VERSION) {
  const id = `${root}\0${version}`;
  if (!codeHashes.has(id) || root !== ROOT) codeHashes.set(id, hashFiles(crypto.createHash('sha256').update(version), root, [...filesUnder(root, 'engine'), ...RENDER_FILES]).digest('hex'));
  return codeHashes.get(id);
}

// Says whether an existing video still matches its project. makeState().version
// only has to reload files in the page: it misses helpers in subfolders and the
// engine's own code. Narration stays out of this, so a new engine version renders
// frames again and makes no voice again.
export function renderIdentity(project, timeline) {
  const skip = (name, folder) => name === 'node_modules' || name.startsWith('.') || (!folder && NOT_SCRIPTS.has(name));
  const scripts = filesUnder(project.dir, '', skip).filter((f) => /\.m?js$/.test(f));
  const hash = crypto.createHash('sha256').update(makeState(project, timeline).version).update('\0').update(renderingCodeHash()).update('\0');
  return hashFiles(hash, project.dir, scripts).digest('hex').slice(0, 32);
}

// Runs fn(page, ctx) with the engine loaded at `scale`, then cleans up.
export async function withEngine(project, timeline, { scale = 1, pages = 1, transparent = false, log = () => {} } = {}, fn) {
  const state = makeState(project, timeline);
  const server = await startServer({ projectDir: project.dir, getState: () => state, log });
  let browser = null;
  try {
    browser = await launch();
    const list = [];
    for (let i = 0; i < pages; i++) {
      list.push(await openEngine(browser, server.url, { scale, transparent, onConsole: (type, text) => { if (type === 'error') log(`page: ${text}`); } }));
    }
    return await fn(pages === 1 ? list[0] : list, { server, state });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

export function reloadProject(project) {
  return loadProject(project.dir, project.overrides ?? { size: project.sizeOverride });
}
