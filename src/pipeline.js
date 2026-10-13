// Shared steps: voice + timeline, the page state the engine loads, and a
// session that runs the engine in headless Chrome.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { synthesize } from './voice.js';
import { buildTimeline } from './timeline.js';
import { listAssets, loadProject } from './project.js';
import { startServer } from './server.js';
import { launch, openEngine } from './browser.js';

export async function prepare(project, { log = () => {}, force = false } = {}) {
  const voices = await synthesize(project, { log, force });
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

// Runs fn(page, ctx) with the engine loaded at `scale`, then cleans up.
export async function withEngine(project, timeline, { scale = 1, pages = 1, transparent = false, log = () => {} } = {}, fn) {
  const state = makeState(project, timeline);
  const server = await startServer({ projectDir: project.dir, getState: () => state });
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
  return loadProject(project.dir);
}
