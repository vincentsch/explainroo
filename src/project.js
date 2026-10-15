// Loads and validates a video project folder:
//   video.json   settings
//   script.md    narration, one "## scene-id" per scene
//   scenes.js    one drawing function per scene id
//   assets/      optional images (logos, screenshots)
import fs from 'node:fs';
import path from 'node:path';
import { parseScript } from './script.js';
import { VOICES, LANGUAGES, voiceLanguage } from './models.js';
import { THEMES as LOOKS } from '../engine/themes.js';
import { parseColor } from '../engine/util.js';

export const THEMES = Object.keys(LOOKS);
export const MUSIC_STYLES = ['warm', 'upbeat', 'calm', 'tech', 'playful'];
export const TRANSITIONS = ['auto', 'fade', 'slide', 'wipe', 'zoom', 'brush', 'cut'];
export const THEME_MUSIC = Object.fromEntries(THEMES.map((name) => [name, LOOKS[name].music]));
const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

// Named formats for the usual places a video goes. Vertical apps draw their
// own buttons, names and captions over the video; `safe` is the part of the
// frame they leave free, as fractions of the frame. The numbers follow the
// platforms' safe-zone templates as of 2026 and move a little with app updates.
export const FORMATS = {
  youtube: { size: [1920, 1080], use: 'YouTube and other wide players' },
  shorts: { size: [1080, 1920], use: 'YouTube Shorts', safe: { top: 0.15, right: 0.12, bottom: 0.35, left: 0.06 } },
  tiktok: { size: [1080, 1920], use: 'TikTok', safe: { top: 0.125, right: 0.2, bottom: 0.34, left: 0.11 } },
  reels: { size: [1080, 1920], use: 'Instagram and Facebook Reels', safe: { top: 0.14, right: 0.11, bottom: 0.35, left: 0.06 } },
  vertical: { size: [1080, 1920], use: 'one file for Shorts, TikTok and Reels', safe: { top: 0.15, right: 0.2, bottom: 0.35, left: 0.11 } },
  instagram: { size: [1080, 1350], use: 'Instagram and Facebook feed posts' },
  linkedin: { size: [1080, 1350], use: 'the LinkedIn feed' },
  square: { size: [1080, 1080], use: 'square posts on X, LinkedIn and Facebook' },
};

export const DEFAULTS = {
  title: null,
  theme: 'paper',
  size: '16:9',
  fps: 30,
  language: 'en',
  voice: 'af_heart',
  speed: 0.9,
  pace: 1,
  music: true,
  sfx: true,
  captions: 'auto',
  cover: 'auto',
  transition: 'auto',
  camera: 'auto',
  motionBlur: true,
  lead: 0.35,
  hold: 0.7,
  end: 1.4,
  sentenceGap: 0.3,
  paragraphGap: 0.55,
  loudness: -14,
  seed: 1,
  boil: 0,
  watermark: 'explainroo.com',
  images: null,
  brand: null,
  fonts: [],
};

// Settings for the UI kit (s.ui), for product demos in a brand's own look.
export const BRAND_KEYS = ['accent', 'background', 'ink', 'font', 'headline', 'logo', 'colors'];
// The UI kit's neutral colors that brand.colors can replace.
export const BRAND_COLORS = ['text', 'soft', 'muted', 'faint', 'line', 'field', 'surface', 'panel'];
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
const HEX = /^#[0-9a-f]{6}$/i;

export class ProjectError extends Error {}

function fail(msg) {
  throw new ProjectError(msg);
}

const LOOK_KEYS = ['extends', 'name', 'dark', 'bg', 'ink', 'muted', 'surface', 'accent', 'colors', 'fonts', 'background', 'stroke', 'radius', 'transition', 'music', 'code', 'terminal', 'caption'];
const TEXTURES = ['paper', 'dots', 'chalk', 'grid', 'glow', 'plain'];
const BUILTIN_FONTS = [...new Set(JSON.parse(fs.readFileSync(new URL('../fonts/fonts.json', import.meta.url), 'utf8')).map((f) => f.family))];

function lookPath(theme) {
  return typeof theme === 'string' && theme.endsWith('.json') && !path.isAbsolute(theme) && !path.win32.isAbsolute(theme);
}

export function loadLook(dir, file, fonts = []) {
  const bad = (key, message) => fail(`${file}: ${key} ${message}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(dir, file), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') bad('theme', 'file is missing. Check the path in video.json.');
    bad('theme', `file could not be read as JSON: ${e.message}`);
  }
  const object = (value, key, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad(key, 'must be an object');
    for (const k of Object.keys(value)) if (!keys.includes(k)) bad(`${key}.${k}`, `is unknown. Known: ${keys.join(', ')}`);
  };
  const oneOf = (value, key, values) => {
    if (!values.includes(value)) bad(key, `must be one of ${values.join(', ')}`);
  };
  const number = (value, key, min, max) => {
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)) bad(key, `must be a number between ${min} and ${max}`);
  };
  const color = (value, key, alpha = false) => {
    const p = typeof value === 'string' && /^rgba\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/.test(value) ? parseColor(value) : null;
    if (!(typeof value === 'string' && HEX.test(value)) && !(alpha && p && [p.r, p.g, p.b].every((v) => v <= 255) && p.a <= 1)) {
      bad(key, `must be a color like "#2563eb"${alpha ? ' or "rgba(17,24,39,0.82)"' : ''}`);
    }
  };
  object(raw, 'look', LOOK_KEYS);
  oneOf(raw.extends, 'extends', THEMES);
  const name = raw.name === undefined ? path.basename(file, '.json') : raw.name;
  if (!(typeof name === 'string' && name.trim()) || THEMES.includes(name)) bad('name', 'must be a non-empty name that is not a built-in look');
  if (raw.dark !== undefined && typeof raw.dark !== 'boolean') bad('dark', 'must be true or false');
  for (const k of ['bg', 'ink', 'muted', 'surface']) if (raw[k] !== undefined) color(raw[k], k);
  if (raw.accent !== undefined) oneOf(raw.accent, 'accent', Object.keys(LOOKS.paper.colors));
  if (raw.background !== undefined) oneOf(raw.background, 'background', TEXTURES);
  if (raw.transition !== undefined) oneOf(raw.transition, 'transition', TRANSITIONS.filter((v) => v !== 'auto'));
  if (raw.music !== undefined) oneOf(raw.music, 'music', MUSIC_STYLES);
  if (raw.radius !== undefined) number(raw.radius, 'radius', 0, 200);
  for (const group of ['colors', 'code', 'terminal', 'caption']) {
    if (raw[group] === undefined) continue;
    const base = LOOKS[raw.extends][group];
    object(raw[group], group, Object.keys(base));
    for (const [k, v] of Object.entries(raw[group])) color(v, `${group}.${k}`, String(base[k]).startsWith('rgba('));
  }
  if (raw.fonts !== undefined) {
    object(raw.fonts, 'fonts', Object.keys(LOOKS.paper.fonts));
    for (const [role, f] of Object.entries(raw.fonts)) {
      const key = `fonts.${role}`;
      object(f, key, ['family', 'weight']);
      if (f.family !== undefined && ![...BUILTIN_FONTS, ...fonts.map((v) => v.family)].includes(f.family)) bad(`${key}.family`, `must be listed in video.json fonts or be built in. Built-in families: ${BUILTIN_FONTS.join(', ')}`);
      if (f.weight !== undefined) {
        number(f.weight, `${key}.weight`, 1, 1000);
        if (!Number.isInteger(f.weight)) bad(`${key}.weight`, 'must be a whole number');
      }
    }
  }
  if (raw.stroke !== undefined) {
    const ranges = { width: [0, 20], roughness: [0, 5], bowing: [0, 5], hachureGap: [1, 100], fillWeight: [0, 20], glow: [0, 100] };
    object(raw.stroke, 'stroke', ['rough', ...Object.keys(ranges), 'fillStyle', 'texture']);
    for (const [k, v] of Object.entries(raw.stroke)) {
      if (ranges[k]) number(v, `stroke.${k}`, ...ranges[k]);
      else if (k === 'rough' && typeof v !== 'boolean') bad('stroke.rough', 'must be true or false');
      else if (k === 'fillStyle') oneOf(v, 'stroke.fillStyle', ['solid', 'hachure', 'cross-hatch', 'zigzag', 'dots']);
      else if (k === 'texture') oneOf(v, 'stroke.texture', ['chalk']);
    }
  }
  return { ...raw, name };
}

export function resolveSize(size) {
  if (FORMATS[size]) return { width: FORMATS[size].size[0], height: FORMATS[size].size[1], safe: FORMATS[size].safe || null };
  if (ASPECTS[size]) return { width: ASPECTS[size][0], height: ASPECTS[size][1] };
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(size));
  if (!m) fail(`size must be a format (${Object.keys(FORMATS).join(', ')}), a ratio (${Object.keys(ASPECTS).join(', ')}) or WIDTHxHEIGHT, not "${size}"`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width % 2 || height % 2) fail('size width and height must be even numbers (H.264 needs that)');
  return { width, height };
}

export function normalizeConfig(raw, dir = '.') {
  const cfg = { ...DEFAULTS, ...raw };
  if (typeof cfg.language !== 'string' || !Object.hasOwn(LANGUAGES, cfg.language)) fail(`language must be one of ${Object.keys(LANGUAGES).join(', ')}`);
  if (raw.voice === undefined) cfg.voice = LANGUAGES[cfg.language];
  const unknown = Object.keys(raw).filter((k) => !(k in DEFAULTS) && !k.startsWith('_'));
  if (unknown.length) fail(`video.json has unknown setting(s): ${unknown.join(', ')}. Known: ${Object.keys(DEFAULTS).join(', ')}`);
  if (!THEMES.includes(cfg.theme) && !lookPath(cfg.theme)) fail(`theme must be one of ${THEMES.join(', ')} or a relative path to a .json look file, not "${cfg.theme}"`);
  if (typeof cfg.voice === 'object') {
    const v = cfg.voice;
    if (!v || Array.isArray(v)) fail('voice must be a Kokoro id or an object with provider');
    const keys = { kokoro: ['provider', 'id'], elevenlabs: ['provider', 'id', 'model'], recording: ['provider', 'src'] };
    if (typeof v.provider !== 'string' || !Object.hasOwn(keys, v.provider)) fail('voice.provider must be kokoro, elevenlabs or recording');
    const extra = Object.keys(v).filter((k) => !keys[v.provider].includes(k));
    if (extra.length) fail(`voice has unknown setting(s): ${extra.join(', ')}. Known: ${keys[v.provider].join(', ')}`);
    if (v.provider === 'recording') {
      if (!(typeof v.src === 'string' && /^assets\/.+/.test(v.src) && !v.src.split('/').includes('..') && !v.src.includes('\\'))) {
        fail('voice.src must be a file or folder inside assets/, with no ..');
      }
    } else if (!(typeof v.id === 'string' && v.id.trim())) fail('voice.id is required');
    if (v.provider === 'kokoro') cfg.voice = v.id;
    if (v.provider === 'elevenlabs') {
      if (v.model !== undefined && !(typeof v.model === 'string' && v.model.trim())) fail('voice.model must be an ElevenLabs model id');
      cfg.voice = { ...v, model: v.model ?? 'eleven_multilingual_v2' };
    }
  }
  if (typeof cfg.voice === 'string') {
    if (!Object.hasOwn(VOICES, cfg.voice)) fail(`voice "${cfg.voice}" does not exist. Run "explainroo voices" for the list.`);
    if (voiceLanguage(cfg.voice) !== cfg.language) fail(`voice "${cfg.voice}" does not speak ${cfg.language}. Use ${Object.keys(VOICES).filter(id => voiceLanguage(id) === cfg.language).join(', ')}.`);
  } else if (!cfg.voice || typeof cfg.voice !== 'object') fail('voice must be a Kokoro id or an object with provider');
  if (typeof cfg.voice !== 'string' && raw.speed === undefined) cfg.speed = 1;
  if (!(cfg.speed >= 0.6 && cfg.speed <= 1.6)) fail('speed must be between 0.6 and 1.6');
  if (!(cfg.pace >= 0.7 && cfg.pace <= 1.6)) fail('pace must be between 0.7 and 1.6 (1 is normal, 1.3 is 30% faster)');
  if (typeof cfg.voice === 'string' && cfg.speed * cfg.pace > 1.8) fail(`speed ${cfg.speed} times pace ${cfg.pace} makes the voice too fast; keep speed x pace at 1.8 or below`);
  if (![24, 25, 30, 50, 60].includes(cfg.fps)) fail('fps must be 24, 25, 30, 50 or 60');
  if (!TRANSITIONS.includes(cfg.transition)) fail(`transition must be one of ${TRANSITIONS.join(', ')}`);
  if (!['auto', 'still'].includes(cfg.camera)) fail('camera must be "auto" (the camera follows the narration) or "still"');
  if (typeof cfg.motionBlur !== 'boolean') fail('motionBlur must be true or false');
  if (![true, false, 'minimal'].includes(cfg.sfx)) fail('sfx must be true, false or "minimal"');
  if (![true, false, 'auto'].includes(cfg.captions)) fail('captions must be true, false or "auto"');
  const cover = cfg.cover;
  const [scene, at, extra] = typeof cover === 'string' ? cover.split('@') : [];
  const coverTime = typeof cover === 'number' && Number.isFinite(cover) && cover >= 0;
  const coverSpec = typeof cover === 'string' && (/^\d+(\.\d+)?$/.test(cover) || (
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(scene) && extra === undefined &&
    (at === undefined || at === '' || at === 'end' || at === 'start' || Number.isFinite(Number(at)))
  ));
  if (!coverTime && !coverSpec) fail('cover must be "auto", seconds like 12.5, or a still spec like "intro@end"');
  for (const k of ['lead', 'hold', 'end', 'sentenceGap', 'paragraphGap']) {
    if (!(typeof cfg[k] === 'number' && cfg[k] >= 0 && cfg[k] <= 10)) fail(`${k} must be a number of seconds between 0 and 10`);
  }
  if (!(cfg.loudness <= -8 && cfg.loudness >= -30)) fail('loudness must be between -30 and -8 LUFS');
  if (!(cfg.boil >= 0 && cfg.boil <= 12)) fail('boil must be between 0 (off) and 12 redraws per second');
  if (cfg.watermark !== false && !(typeof cfg.watermark === 'string' && cfg.watermark.trim() && cfg.watermark.length <= 40)) {
    fail('watermark must be false or a short text of up to 40 characters, like "example.com"');
  }
  if (cfg.images !== null) {
    if (typeof cfg.images !== 'object' || Array.isArray(cfg.images)) fail('images must be an object like { "model": "best", "style": "..." }');
    const extra = Object.keys(cfg.images).filter((k) => !['model', 'style'].includes(k));
    if (extra.length) fail(`images has unknown setting(s): ${extra.join(', ')}. Known: model, style`);
  }

  if (cfg.brand !== null) {
    if (typeof cfg.brand !== 'object' || Array.isArray(cfg.brand)) fail('brand must be an object like { "accent": "#2563eb", "logo": "assets/logo.svg" }');
    const extra = Object.keys(cfg.brand).filter((k) => !BRAND_KEYS.includes(k));
    if (extra.length) fail(`brand has unknown setting(s): ${extra.join(', ')}. Known: ${BRAND_KEYS.join(', ')}`);
    for (const k of ['accent', 'background', 'ink']) {
      if (cfg.brand[k] !== undefined && !HEX.test(cfg.brand[k])) fail(`brand.${k} must be a color like "#2563eb", not ${JSON.stringify(cfg.brand[k])}`);
    }
    for (const k of ['font', 'headline']) {
      if (cfg.brand[k] !== undefined && !(typeof cfg.brand[k] === 'string' && cfg.brand[k].trim())) fail(`brand.${k} must be a font family name, like "Inter"`);
    }
    if (cfg.brand.colors !== undefined) {
      const c = cfg.brand.colors;
      if (!c || typeof c !== 'object' || Array.isArray(c)) fail(`brand.colors must be an object like { "text": "#141413", "line": "#e8e6dc" }`);
      for (const [k, v] of Object.entries(c)) {
        if (!BRAND_COLORS.includes(k)) fail(`brand.colors has an unknown color "${k}". Known: ${BRAND_COLORS.join(', ')}`);
        if (!HEX.test(v)) fail(`brand.colors.${k} must be a color like "#141413", not ${JSON.stringify(v)}`);
      }
    }
    if (cfg.brand.logo !== undefined && !(typeof cfg.brand.logo === 'string' && /^assets\/.+\.(svg|png|webp|jpe?g)$/i.test(cfg.brand.logo))) {
      fail('brand.logo must be an image in the assets/ folder, like "assets/logo.svg"');
    }
  }
  if (!Array.isArray(cfg.fonts)) fail('fonts must be a list like [{ "family": "Figtree", "src": "assets/fonts/figtree-600.woff2", "weight": 600 }]');
  cfg.fonts.forEach((f, i) => {
    const where = `fonts[${i}]`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) fail(`${where} must be an object with family and src`);
    const extra = Object.keys(f).filter((k) => !['family', 'src', 'weight', 'style'].includes(k));
    if (extra.length) fail(`${where} has unknown setting(s): ${extra.join(', ')}. Known: family, src, weight, style`);
    if (!(typeof f.family === 'string' && f.family.trim())) fail(`${where}.family must be a font family name`);
    if (!(typeof f.src === 'string' && f.src.startsWith('assets/') && FONT_FILE.test(f.src) && !f.src.split('/').includes('..'))) {
      fail(`${where}.src must be a font file in the assets/ folder (.woff2, .woff, .ttf or .otf), like "assets/fonts/figtree-600.woff2"`);
    }
    const w = f.weight ?? 400;
    const range = typeof w === 'string' ? w.split(/\s+/).map(Number) : [w];
    if (!(range.length <= 2 && range.every((x) => Number.isInteger(x) && x >= 1 && x <= 1000))) fail(`${where}.weight must be a number like 600, or a range like "100 900" for a variable font`);
    if (f.style !== undefined && !['normal', 'italic'].includes(f.style)) fail(`${where}.style must be "normal" or "italic"`);
  });

  if (lookPath(cfg.theme)) cfg.look = loadLook(dir, cfg.theme, cfg.fonts);
  let music = cfg.music;
  if (music === true) music = { style: cfg.look ? (cfg.look.music ?? THEME_MUSIC[cfg.look.extends]) : THEME_MUSIC[cfg.theme] };
  else if (typeof music === 'string') music = { style: music };
  if (music) {
    // A faster pace plays the music a little faster too.
    music = { volume: 0.5, seed: cfg.seed, tempo: Math.sqrt(cfg.pace), ...music };
    if (!MUSIC_STYLES.includes(music.style)) fail(`music style must be one of ${MUSIC_STYLES.join(', ')}, not "${music.style}"`);
    if (!(music.volume >= 0 && music.volume <= 1)) fail('music.volume must be between 0 and 1');
  }
  cfg.music = music || null;

  const { width, height, safe } = resolveSize(cfg.size);
  cfg.width = width;
  cfg.height = height;
  cfg.format = FORMATS[cfg.size] ? cfg.size : null;
  cfg.safe = safe || null;
  if (cfg.captions === 'auto') cfg.captions = height >= width;
  return cfg;
}

export function findProjectDir(arg) {
  const dir = path.resolve(arg || '.');
  if (fs.existsSync(path.join(dir, 'video.json'))) return dir;
  if (arg) fail(`${dir} is not a video project (no video.json). Create one with "explainroo init ${arg}".`);
  fail('no video.json here. Run the command in a video folder or pass the project folder, for example "explainroo <command> videos/my-video".');
}

export function loadProject(arg, { size } = {}) {
  const dir = findProjectDir(arg);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  } catch (e) {
    fail(`video.json is not valid JSON: ${e.message}`);
  }
  const config = normalizeConfig(size === undefined ? raw : { ...raw, size }, dir);
  for (const f of [...config.fonts.map((x) => x.src), ...(config.brand?.logo ? [config.brand.logo] : [])]) {
    if (!fs.existsSync(path.join(dir, f))) fail(`${f} is listed in video.json but the file is missing`);
  }
  const scriptPath = path.join(dir, 'script.md');
  if (!fs.existsSync(scriptPath)) fail(`${scriptPath} is missing`);
  const script = parseScript(fs.readFileSync(scriptPath, 'utf8'), { language: config.language });
  if (!config.title) config.title = script.title || path.basename(dir);
  const scenesPath = path.join(dir, 'scenes.js');
  if (!fs.existsSync(scenesPath)) fail(`${scenesPath} is missing`);
  const build = path.join(dir, 'build');
  const out = path.join(dir, 'out');
  return { dir, config, script, sizeOverride: size, paths: { build, out, voice: path.join(build, 'voice'), scenes: scenesPath, script: scriptPath, look: config.look ? path.resolve(dir, config.theme) : null } };
}

export function outputPath(project, name, ext = '', out = null) {
  const suffix = project.sizeOverride === undefined ? '' : `-${project.sizeOverride.replace(':', '-')}`;
  return path.resolve(out || path.join(project.paths.out, `${name}${suffix}${ext}`));
}

export function listAssets(dir) {
  const root = path.join(dir, 'assets');
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}
