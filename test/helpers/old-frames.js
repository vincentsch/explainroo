// Projects for checking that a project without "defaults" renders the frames it
// did before the defaults of 0.5: a copy of an example, and a small project with
// the parts whose look the line changes. Both get made-up narration, so no voice
// model is needed. frameHashes renders them with the modules it is given, so the
// same projects can be measured with an older copy of explainroo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cachedVoice } from './cached-voice.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function folder(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `explainroo-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function narrate(dir) {
  const script = fs.readFileSync(path.join(dir, 'script.md'), 'utf8');
  for (const [, id] of script.matchAll(/^## ([^\s{]+)/gm)) cachedVoice(dir, id);
}

// A copy of an example, with `settings` added to its video.json.
export function exampleCopy(t, name, settings = {}) {
  const dir = folder(t, name);
  fs.cpSync(path.join(ROOT, 'examples', name), dir, { recursive: true, filter: (from) => !/[\\/](build|out|history)$/.test(from) });
  const file = path.join(dir, 'video.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...settings }, null, 2));
  narrate(dir);
  return dir;
}

// Arrow labels, an arrow from a labelled icon, gap between two points, a
// sticker's keyword, a dark brand accent in captions and the automatic cover.
export function partsProject(t, settings = {}) {
  const dir = folder(t, 'parts');
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ title: 'Parts', theme: 'clean', size: '1280x720', music: false, sfx: false, captions: true, brand: { accent: '#1e3a8a' }, ...settings }, null, 2));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Parts\n\n## arrows\nThe syringe brings a piece of the virus to the cell.\n\n## sticker\nIt cannot make you sick, and it flows on.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default {
  arrows(s) {
    s.icon('syringe', { id: 'shot', x: 300, y: 220, size: 110, label: 'Vaccine', at: 0 });
    s.box('Virus piece', { id: 'piece', x: 300, y: 560, at: 0.3 });
    s.arrow('shot', 'piece', { label: 'brings', at: 'piece' });
    s.circle({ id: 'cell', x: 900, y: 400, r: 120, label: 'Cell', at: 'cell' });
    s.arrow('piece', 'cell', { label: 'to the cell', bend: 0.3, at: 'cell' });
  },
  sticker(s) {
    s.short.sticker('Cannot make you *sick*', { color: 'green', x: 640, y: 260, at: 0 });
    s.arrow([300, 520], [980, 520], { gap: 40, label: 'flows', at: 'flows' });
  },
};
`);
  narrate(dir);
  return dir;
}

// Hashes of every `every`-th frame and the last frame of each scene, and of the
// cover, with the given modules of explainroo: { loadProject, prepare,
// withEngine, render, qa }.
export async function frameHashes(mod, dir, { every = 10, scale = 0.5 } = {}) {
  const project = mod.loadProject(dir);
  const { timeline } = await mod.prepare(project, { log: () => {} });
  const fps = timeline.fps;
  const list = new Set();
  for (let f = 0; f < timeline.frames; f += every) list.add(f);
  for (const sc of timeline.scenes) list.add(Math.max(0, Math.round((sc.start + sc.dur) * fps) - 1));
  const frames = [...list].sort((a, b) => a - b);
  const set = mod.render.coverTime ? mod.render.coverTime(project.config, timeline).T : mod.qa.resolveTimes(timeline, [mod.render.coverSpec(project.config, timeline)])[0].T;
  const hash = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  return mod.withEngine(project, timeline, { scale }, async (page) => {
    const out = {};
    for (let i = 0; i < frames.length; i += 40) {
      const part = frames.slice(i, i + 40);
      const data = await page.evaluate(([l]) => window.explainroo.frames(l, 1), [part]);
      part.forEach((f, k) => { out[f] = hash(data[k]); });
    }
    const T = set ?? await page.evaluate(() => window.explainroo.coverMoment());
    const [cover] = await page.evaluate(([f]) => window.explainroo.frames([f], 1), [Math.round(T * fps)]);
    return { frames: out, cover: { T: Math.round(T * 1000) / 1000, hash: hash(cover) } };
  });
}
