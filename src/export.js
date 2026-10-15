// A static player uses the same frames and mix as a render, without a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheRoot } from './models.js';
import { languageFonts, subsetFont } from './fonts.js';
import { prepare, makeState } from './pipeline.js';
import { startServer, projectFile, ROOT } from './server.js';
import { launch, openEngine } from './browser.js';
import { ffmpeg, normalizeLoudness } from './ffmpeg.js';
import { resolveTimes } from './qa.js';
import { subtitleCues, toVtt } from './subtitles.js';

export function localModules(dir, entry = 'scenes.js') {
  const files = new Map();
  const visit = rel => {
    if (files.has(rel)) return;
    const file = projectFile(dir, rel);
    if (!file || !/\.m?js$/i.test(file)) throw new Error(`module "${rel}" cannot be exported. Keep modules inside the project, away from dotfiles.`);
    const source = fs.readFileSync(file, 'utf8');
    files.set(rel, file);
    const imports = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:import|export)\s+(?:[\w\s,*{}$]+\s+from\s*)?['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
    for (const m of source.matchAll(imports)) {
      const spec = m[1] || m[2];
      if (!spec) continue;
      if (!spec.startsWith('./') && !spec.startsWith('../')) throw new Error(`module "${spec}" cannot be exported. Use a relative local import.`);
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec.split(/[?#]/)[0])));
    }
  };
  visit(entry);
  return files;
}

export function copyPlayer(project, timeline, used, out) {
  const copy = (src, rel) => {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };
  const projectModules = localModules(project.dir);
  for (const rel of used.modules || []) for (const [name, file] of localModules(project.dir, rel)) projectModules.set(name, file);
  for (const [rel, file] of projectModules) copy(file, `project/${rel}`);
  for (const rel of used.assets) {
    const file = projectFile(project.dir, rel);
    if (!file || !rel.startsWith('assets/')) throw new Error(`asset "${rel}" cannot be exported. Keep assets inside assets/, away from dotfiles.`);
    if (/\.svg$/i.test(rel) && /(?:href\s*=\s*['"]|url\(\s*['"]?)(?:\/|[a-z]+:)/i.test(fs.readFileSync(file, 'utf8'))) throw new Error(`image "${rel}" uses an outside file. Use a self-contained image.`);
    copy(file, `project/${rel}`);
  }
  const text = (used.text || '') + timeline.scenes.flatMap(s => s.words.map(w => w.text)).join('');
  // Every font string names the Hindi fallback, but only Hindi text needs it.
  const fonts = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
    .filter(f => used.fonts.includes(f.family) && (f.family !== 'Noto Sans Devanagari' || /\p{Script=Devanagari}/u.test(text)));
  for (const f of fonts) copy(path.join(ROOT, 'fonts', f.file), `fonts/${f.file}`);
  for (const family of new Set(fonts.map(f => f.family))) {
    const name = family.replaceAll(' ', '') + '-OFL.txt';
    copy(path.join(ROOT, 'fonts/licenses', name), `fonts/licenses/${name}`);
  }
  fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
  // Japanese and Chinese fonts keep only the characters the video draws.
  for (const f of languageFonts(project.config.language)) {
    fs.writeFileSync(path.join(out, 'fonts', f.file), subsetFont(fs.readFileSync(f.path), text));
    fonts.push({ family: f.family, weight: f.weight, file: f.file });
  }
  if (languageFonts(project.config.language).length) copy(path.join(cacheRoot(), 'fonts', 'NotoSansCJK-OFL.txt'), 'fonts/licenses/NotoSansCJK-OFL.txt');
  fs.writeFileSync(path.join(out, 'fonts/fonts.json'), JSON.stringify(fonts));
  // Audio synthesis and upload code run during export, never during playback.
  const modules = ['runtime', 'stage', 'themes', 'pen', 'transitions', 'captions', 'util', 'layout', 'clips', 'ui', 'readability', 'pathdata', 'text', 'code', 'director'];
  for (const name of modules) copy(path.join(ROOT, 'engine', `${name}.js`), `engine/${name}.js`);
  copy(path.join(ROOT, 'engine/icons/lucide.json'), 'engine/icons/lucide.json');
  copy(path.join(ROOT, 'engine/icons/LICENSE-lucide.txt'), 'engine/icons/LICENSE-lucide.txt');
  const rough = fileURLToPath(import.meta.resolve('roughjs/bundled/rough.esm.js'));
  copy(rough, 'vendor/rough.js');
  copy(path.join(path.dirname(rough), '../LICENSE'), 'vendor/LICENSE-roughjs.txt');
  copy(path.join(ROOT, 'LICENSE'), 'LICENSE');
  copy(path.join(ROOT, 'engine/player.html'), 'index.html');
  copy(path.join(ROOT, 'engine/player.js'), 'engine/player.js');
  const state = makeState(project, timeline);
  state.config = Object.fromEntries(Object.entries(state.config).filter(([key]) => !key.startsWith('_') && key !== 'images'));
  state.config.fonts = state.config.fonts.filter(f => used.assets.includes(f.src));
  if (state.config.brand?.logo && !used.assets.includes(state.config.brand.logo)) {
    state.config.brand = { ...state.config.brand };
    delete state.config.brand.logo;
  }
  // A custom look is already resolved in config.look; its source is private.
  if (state.config.look) state.config.theme = state.config.look.extends;
  if (typeof state.config.voice === 'object' && state.config.voice.provider === 'recording') state.config.voice = { provider: 'recording', src: 'audio.m4a' };
  state.timeline = { ...timeline, scenes: timeline.scenes.map(s => ({ ...s, voice: s.voice ? { ...s.voice, url: 'audio.m4a' } : null })) };
  state.assets = used.assets.filter(a => !/\.(woff2?|ttf|otf)$/i.test(a));
  fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(out, 'math.json'), JSON.stringify(used.math));
  fs.writeFileSync(path.join(out, 'subtitles.vtt'), toVtt(subtitleCues(timeline)));
}

export async function exportPlayer(project, { out, log = () => {} } = {}) {
  out = path.resolve(out || path.join(project.paths.out, 'player'));
  if (fs.existsSync(out) && fs.readdirSync(out).length && (!fs.existsSync(path.join(out, 'index.html')) || !fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('<meta name="generator" content="explainroo web player">'))) throw new Error('output folder is not an exported player. Choose an empty folder with --out.');
  localModules(project.dir);
  const { timeline } = await prepare(project, { log });
  const state = makeState(project, timeline);
  state.assets = state.assets.filter(a => projectFile(project.dir, a));
  let browser, server;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const temp = fs.mkdtempSync(path.join(path.dirname(out), '.player-'));
  try {
    server = await startServer({ projectDir: project.dir, getState: () => state, log });
    browser = await launch();
    const context = await browser.newContext();
    let outside;
    const projectModules = new Set();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== server.url) {
        outside = route.request().url();
        return route.abort();
      }
      if (url.pathname.startsWith('/project/') && /\.m?js$/i.test(url.pathname)) projectModules.add(decodeURIComponent(url.pathname.slice(9)));
      return route.continue();
    });
    // openEngine uses browser.newPage, so keep its requests in this context.
    const page = await openEngine(context, server.url);
    const cover = resolveTimes(timeline, [project.config.cover === 'auto' ? `${timeline.scenes[0].id}@end` : project.config.cover])[0].T;
    const used = await page.evaluate(async cover => {
      const { boot } = await import('/engine/runtime.js');
      const { engine } = await boot({ canvas: document.createElement('canvas') });
      const assets = new Set();
      const fonts = new Set();
      for (const method of ['image', 'clip']) {
        const original = engine[method].bind(engine);
        engine[method] = src => {
          const result = original(src);
          const key = src.replace(/^\.?\//, '');
          assets.add(engine[method === 'image' ? 'images' : 'clips'].has(key) ? key : 'assets/' + key);
          return result;
        };
      }
      const proto = CanvasRenderingContext2D.prototype;
      const font = Object.getOwnPropertyDescriptor(proto, 'font');
      const chars = new Set();
      const drawing = ['fillText', 'strokeText', 'measureText'].map(name => [name, proto[name]]);
      for (const [name, original] of drawing) proto[name] = function (text, ...rest) {
        for (const c of String(text)) chars.add(c);
        return original.call(this, text, ...rest);
      };
      Object.defineProperty(proto, 'font', { ...font, set(value) {
        for (const m of value.matchAll(/["']([^"']+)["']/g)) fonts.add(m[1]);
        font.set.call(this, value);
      } });
      try {
        const { renderAudio } = await import('/engine/runtime.js');
        const audio = await import('/engine/audio/soundtrack.js');
        const { upload } = await import('/engine/upload.js');
        const sound = await renderAudio(engine, audio);
        if (sound.errors.length) throw new Error(sound.errors[0].message);
        // Music-free videos still need their scenes sampled for asset usage.
        const collected = engine.collectEvents();
        if (collected.errors.length) throw new Error(collected.errors[0].message);
        for (const sc of engine.timeline.scenes) engine.renderFrame(sc.start + sc.dur - 1 / engine.fps);
        await engine.prepareFrame(cover);
        engine.renderFrame(cover, undefined, { captions: false });
        await upload('build/player-mix.wav', audio.encodeWav(sound.buffer));
        await upload('build/player-poster.jpg', await new Promise(resolve => engine.canvas.toBlob(resolve, 'image/jpeg', 0.9)));
        if ([...engine.mathCache.values()].some(m => m?.error)) throw new Error('a formula could not be typeset. Run check and fix it before exporting.');
        return { assets: [...assets], fonts: [...fonts], text: [...chars].join(''), math: Object.fromEntries(engine.mathCache) };
      } finally {
        Object.defineProperty(proto, 'font', font);
        for (const [name, original] of drawing) proto[name] = original;
      }
    }, cover);
    if (outside) throw new Error('the project uses an outside URL. Use local files before exporting.');
    used.modules = [...projectModules];
    for (const f of project.config.fonts) if (used.fonts.includes(f.family)) used.assets.push(f.src);
    copyPlayer(project, timeline, used, temp);
    const mix = path.join(project.paths.build, 'player-mix.wav');
    const norm = path.join(project.paths.build, 'player-mix-norm.wav');
    await normalizeLoudness(mix, norm, project.config.loudness);
    await ffmpeg(['-loglevel', 'error', '-i', norm, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(temp, 'audio.m4a')]);
    fs.copyFileSync(path.join(project.paths.build, 'player-poster.jpg'), path.join(temp, 'poster.jpg'));
    if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
    fs.renameSync(temp, out);
    log(`wrote ${out} (${timeline.duration.toFixed(1)}s)`);
    return { out, duration: timeline.duration, width: project.config.width, height: project.config.height };
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
