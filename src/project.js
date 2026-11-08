// Loads and validates a video project folder:
//   video.json   settings
//   script.md    narration, one "## scene-id" per scene
//   scenes.js    one drawing function per scene id
//   assets/      optional images (logos, screenshots)
// A video in several languages adds script.<lang>.md for each language beside
// the main one, and strings.json or strings.<lang>.json holds the on-screen text.
// The main language builds into build/ and out/, every other one into
// build/<lang>/ and out/<lang>/.
import fs from 'node:fs';
import path from 'node:path';
import { parseScript } from './script.js';
import { VOICES, LANGUAGES, LANGUAGE_NAMES, voiceLanguage } from './models.js';
import { ProjectError } from './errors.js';
import { voiceProviders, oneOf } from './services.js';
import { THEMES as LOOKS } from '../engine/themes.js';
import { AUDIO_FILE, parseColor } from '../engine/util.js';

export { ProjectError };

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

// The tall formats, for apps that open on the first seconds of a video.
export const TALL_FORMATS = ['shorts', 'tiktok', 'reels', 'vertical'];

// What a block under "sizes" in video.json can set for one size.
const SIZE_SETTINGS = ['captions', 'cover', 'pace', 'watermark'];

export const DEFAULTS = {
  title: null,
  theme: 'paper',
  size: '16:9',
  fps: 30,
  language: 'en',
  languages: null,
  sizes: null,
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
  // The most that all AI clips of the project may cost, in US dollars. It changes
  // no frame, so it stays out of the resolved settings and the render identity.
  clipBudget: null,
};

// Settings for the UI kit (s.ui), for product demos in a brand's own look.
export const BRAND_KEYS = ['accent', 'background', 'ink', 'font', 'headline', 'logo', 'colors'];
// The UI kit's neutral colors that brand.colors can replace.
export const BRAND_COLORS = ['text', 'soft', 'muted', 'faint', 'line', 'field', 'surface', 'panel'];
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
const HEX = /^#[0-9a-f]{6}$/i;

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
  if (Object.hasOwn(FORMATS, size)) return { width: FORMATS[size].size[0], height: FORMATS[size].size[1], safe: FORMATS[size].safe || null };
  if (Object.hasOwn(ASPECTS, size)) return { width: ASPECTS[size][0], height: ASPECTS[size][1] };
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(size));
  if (!m) fail(`size must be a format (${Object.keys(FORMATS).join(', ')}), a ratio (${Object.keys(ASPECTS).join(', ')}) or WIDTHxHEIGHT, not "${size}"`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width % 2 || height % 2) fail('size width and height must be even numbers (H.264 needs that)');
  return { width, height };
}

// "music" with a file instead of a style. Only what the user wrote and the
// defaults go in here: the config is part of the page's version hash.
function musicFileSetting(music) {
  if ('style' in music) fail('music takes a style or a src, not both. Remove one of them.');
  const known = ['src', 'volume', 'credit', 'loop'];
  const extra = Object.keys(music).filter((k) => !known.includes(k));
  if (extra.length) fail(`music has unknown setting(s) for a file: ${extra.join(', ')}. Known: ${known.join(', ')}`);
  const { src } = music;
  if (!(typeof src === 'string' && /^assets\/.+/.test(src) && !src.split('/').includes('..') && !src.includes('\\') && AUDIO_FILE.test(src))) {
    fail('music.src must be a wav, mp3, m4a, aac, flac, ogg or opus file inside assets/, with no ..');
  }
  const file = { volume: 0.5, loop: true, ...music };
  if (!(typeof file.volume === 'number' && file.volume >= 0 && file.volume <= 1)) fail('music.volume must be between 0 and 1');
  if (typeof file.loop !== 'boolean') fail('music.loop must be true or false');
  if (file.credit !== undefined && !(typeof file.credit === 'string' && file.credit.trim())) fail('music.credit must be a short text that says who made the music');
  return file;
}

// Every voice but Kokoro speaks every language explainroo has. They come from
// services.json, a recording first because it is free.
const otherVoices = () => Object.entries(voiceProviders()).filter(([id]) => id !== 'kokoro');

// Those voices as they go in video.json. A version in "languages" needs a
// recording of its own.
function voiceLines(language, version) {
  return otherVoices().map(([id, { name, keys }]) => {
    const voice = keys.includes('src')
      ? `{ "provider": "${id}", "src": "${version ? `assets/narration-${language}.m4a` : 'assets/narration.m4a'}" }`
      : `{ "provider": "${id}", "id": "<voice id>" }`;
    return `  ${name}: ${version ? `"languages": { "${language}": { "voice": ${voice} } }` : `"voice": ${voice}`}`;
  });
}

// A language without a Kokoro voice has no default voice. This one message
// answers every place that would need one. `place` is "main" for the language at
// the top of video.json, "version" for another language of the video, "init"
// and "voices" for those commands.
export function noKokoroVoice(language, place = 'main') {
  const name = LANGUAGE_NAMES[language];
  const lists = otherVoices().filter(([, { keys }]) => keys.includes('id')).map(([id]) => `"explainroo voices --provider ${id} --language ${language}"`);
  const next = {
    main: 'Set "voice" in video.json to one of these:',
    version: `Give the ${name} version its own voice in video.json with one of these:`,
    init: `init can only set up a Kokoro voice, so create the project without --language. Then set "language": "${language}" and one of these in video.json:`,
    voices: `${oneOf(lists)} lists the ${name} voices of that service. Set one in video.json like this:`,
  }[place];
  return [
    `Kokoro, the free voice, has no ${name} voice. ${name} narration needs your own recording or a paid voice. ${next}`,
    ...voiceLines(language, place === 'version'),
    'Run "explainroo services voice" to see what each one costs and what leaves your computer.',
  ].join('\n');
}

// The settings of one language: the general ones, with that language's own from
// "languages" on top. The main voice speaks the main language, so another
// language without a voice of its own gets its default voice.
export function languageSettings(raw, language) {
  const { languages, ...general } = raw;
  if (language === (raw.language ?? DEFAULTS.language)) return general;
  const { voice, ...rest } = general;
  return { ...rest, ...(languages?.[language] ?? {}), language };
}

// "languages": { "es": { "voice": "ef_dora" } } holds the settings of one
// language. Their shape is checked first, because the settings of a language
// are made from them.
function checkLanguages(raw) {
  const { languages } = raw;
  if (languages === undefined || languages === null) return [];
  if (typeof languages !== 'object' || Array.isArray(languages)) fail('languages must be an object like { "es": { "voice": "ef_dora" } }');
  const main = raw.language ?? DEFAULTS.language;
  for (const [code, own] of Object.entries(languages)) {
    if (!Object.hasOwn(LANGUAGES, code)) fail(`languages: "${code}" is not a language explainroo speaks. Use ${oneOf(Object.keys(LANGUAGES))}.`);
    if (code === main) fail(`languages: ${code} is the main language, so its settings go at the top of video.json`);
    const voice = LANGUAGES[code] ? `"${LANGUAGES[code]}"` : `{ "provider": "recording", "src": "assets/narration-${code}.m4a" }`;
    if (!own || typeof own !== 'object' || Array.isArray(own)) fail(`languages.${code} must be an object with the settings of that language, like { "voice": ${voice} }`);
    const bad = Object.keys(own).filter((k) => (!(k in DEFAULTS) && !k.startsWith('_')) || k === 'language' || k === 'languages' || k === 'sizes');
    if (bad.length) fail(`languages.${code} has setting(s) that can't be set for one language: ${bad.join(', ')}`);
  }
  return Object.keys(languages);
}

// Whether `size` is a size the way "size" and --size take one.
export function isSize(size) {
  try {
    resolveSize(size);
    return true;
  } catch (e) {
    if (e instanceof ProjectError) return false;
    throw e;
  }
}

// "sizes": { "tiktok": { "captions": "bold", "pace": 1.2 } } holds the settings
// of one size. A block is named after a size the way "size" takes one, and it
// applies only to that exact name: "youtube" and "16:9" are two names with two
// blocks, although they give the same frame.
function checkSizes(raw) {
  const { sizes } = raw;
  if (sizes === undefined || sizes === null) return [];
  if (typeof sizes !== 'object' || Array.isArray(sizes)) fail('sizes must be an object like { "tiktok": { "captions": "bold", "pace": 1.2 } }');
  for (const [name, own] of Object.entries(sizes)) {
    if (!isSize(name)) fail(`sizes: "${name}" is not a size. Name each block after a size the way "size" takes one: a format (${Object.keys(FORMATS).join(', ')}), a ratio (${Object.keys(ASPECTS).join(', ')}) or WIDTHxHEIGHT in even numbers.`);
    if (!own || typeof own !== 'object' || Array.isArray(own)) fail(`sizes.${name} must be an object with the settings of that size, like { "captions": "bold" }`);
    const bad = Object.keys(own).filter((k) => !SIZE_SETTINGS.includes(k) && !k.startsWith('_'));
    if (bad.length) fail(`sizes.${name} has setting(s) that can't be set for one size: ${bad.join(', ')}. A size can set ${SIZE_SETTINGS.slice(0, -1).join(', ')} and ${SIZE_SETTINGS.at(-1)}.`);
  }
  return Object.keys(sizes);
}

// The block of one size, with only the settings a size can have.
function sizeBlock(raw, size) {
  const own = raw.sizes && Object.hasOwn(raw.sizes, size) ? raw.sizes[size] : null;
  return own ? Object.fromEntries(SIZE_SETTINGS.filter((k) => Object.hasOwn(own, k)).map((k) => [k, own[k]])) : null;
}

// The checked settings of one run: the settings of a language, then the block of
// the size the run ends up at, then `overrides`, the settings of the run itself.
// A mistake is blamed on the block only when the settings without it are good.
function sizedSettings(settings, overrides, input, dir) {
  const { sizes, ...general } = settings;
  const size = overrides.size ?? general.size ?? DEFAULTS.size;
  const block = sizeBlock(settings, size);
  if (!block) return settingsOf({ ...general, ...overrides }, input, dir);
  try {
    return settingsOf({ ...general, ...block, ...overrides }, input, dir, block);
  } catch (e) {
    if (!(e instanceof ProjectError)) throw e;
    settingsOf({ ...general, ...overrides }, input, dir);
    fail(`sizes.${size}: ${e.message}`);
  }
}

// `language` picks one language of a video in several languages, and its
// settings come from languageSettings. The block of the size in "sizes" goes on
// top of them. `overrides` are the settings of one run, like --size, which win
// over the settings of any language and any size. The result holds neither
// "languages" nor "sizes", so editing the block of one size never changes the
// settings of another. Once the settings asked for are good, the settings of
// every other language and the block of every other size get the same checks, so
// that a mistake is blamed on the right place. A block is checked with the main
// language, so a block that doesn't suit another language only stops that
// language at that size.
export function normalizeConfig(input, dir = '.', { language: version, overrides = {} } = {}) {
  checkLanguage(input.language ?? DEFAULTS.language);
  const others = checkLanguages(input);
  const sizes = checkSizes(input);
  const main = version === undefined || version === (input.language ?? DEFAULTS.language);
  const cfg = sizedSettings(main ? input : languageSettings(input, version), overrides, input, dir);
  for (const code of others) {
    if (code === cfg.language) continue;
    try {
      sizedSettings(languageSettings(input, code), {}, input, dir);
    } catch (e) {
      if (e instanceof ProjectError) fail(`languages.${code}: ${e.message}`);
      throw e;
    }
  }
  for (const size of sizes) {
    if (!main || size !== cfg.size) sizedSettings(input, { size }, input, dir);
  }
  return cfg;
}

// An amount of US dollars for all clips together, like 0.40.
export function checkClipBudget(value, where) {
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) fail(`${where} must be an amount in US dollars above 0, like 0.40`);
  return value;
}

// A language code that explainroo speaks, like "es".
export function checkLanguage(language) {
  if (typeof language !== 'string' || !Object.hasOwn(LANGUAGES, language)) fail(`language must be one of ${Object.keys(LANGUAGES).join(', ')}`);
}

// The checked settings of one language. `input` is the whole of video.json, and
// `block` the block of the size that `raw` holds, if any.
function settingsOf(raw, input, dir, block = null) {
  const cfg = { ...DEFAULTS, ...raw };
  delete cfg.languages;
  delete cfg.sizes;
  if (cfg.clipBudget !== null) checkClipBudget(cfg.clipBudget, 'clipBudget in video.json');
  delete cfg.clipBudget;
  checkLanguage(cfg.language);
  // A language without a Kokoro voice needs a voice of its own, and never falls back to Kokoro.
  const noKokoro = () => fail(noKokoroVoice(cfg.language, cfg.language === (input.language ?? DEFAULTS.language) ? 'main' : 'version'));
  if (raw.voice === undefined) {
    if (!LANGUAGES[cfg.language]) noKokoro();
    cfg.voice = LANGUAGES[cfg.language];
  }
  const unknown = Object.keys(raw).filter((k) => !(k in DEFAULTS) && !k.startsWith('_'));
  if (unknown.length) fail(`video.json has unknown setting(s): ${unknown.join(', ')}. Known: ${Object.keys(DEFAULTS).join(', ')}`);
  if (!THEMES.includes(cfg.theme) && !lookPath(cfg.theme)) fail(`theme must be one of ${THEMES.join(', ')} or a relative path to a .json look file, not "${cfg.theme}"`);
  if (typeof cfg.voice === 'object') {
    const v = cfg.voice;
    if (!v || Array.isArray(v)) fail('voice must be a Kokoro id or an object with provider');
    const providers = voiceProviders();
    if (typeof v.provider !== 'string' || !Object.hasOwn(providers, v.provider)) fail(`voice.provider must be ${oneOf(Object.keys(providers))}`);
    const spec = providers[v.provider];
    const known = ['provider', ...spec.keys];
    const extra = Object.keys(v).filter((k) => !known.includes(k));
    if (extra.length) fail(`voice has unknown setting(s): ${extra.join(', ')}. Known: ${known.join(', ')}`);
    if (spec.keys.includes('src')) {
      if (!(typeof v.src === 'string' && /^assets\/.+/.test(v.src) && !v.src.split('/').includes('..') && !v.src.includes('\\'))) {
        fail('voice.src must be a file or folder inside assets/, with no ..');
      }
    } else if (!(typeof v.id === 'string' && v.id.trim())) fail('voice.id is required');
    if (spec.keys.includes('model') && v.model !== undefined && !(typeof v.model === 'string' && v.model.trim())) fail(`voice.model must be ${/^[aeiou]/i.test(spec.name) ? 'an' : 'a'} ${spec.name} model id`);
    if (v.provider === 'kokoro') cfg.voice = v.id;
    else if (spec.defaults) cfg.voice = { ...v, ...Object.fromEntries(Object.entries(spec.defaults).map(([k, d]) => [k, v[k] ?? d])) };
  }
  if (typeof cfg.voice === 'string') {
    if (!LANGUAGES[cfg.language]) noKokoro();
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
  if (![true, false, 'auto', 'bold'].includes(cfg.captions)) fail('captions must be true, false, "auto" or "bold"');
  // Bold captions break between words, and Japanese and Chinese have no spaces to break at.
  if (cfg.captions === 'bold' && ['ja', 'zh'].includes(cfg.language)) {
    const name = cfg.language === 'ja' ? 'Japanese' : 'Chinese';
    const version = cfg.language !== (input.language ?? DEFAULTS.language);
    const own = !version ? ''
      : block?.captions === 'bold' ? ` The block of a size comes after "languages", so the ${name} version gets the captions of the block too.`
        : ` For a ${name} version of a video with bold captions, add "languages": { "${cfg.language}": { "captions": true } } to video.json.`;
    fail(`"captions": "bold" does not work for ${name}, whose words have no spaces between them to break at. Use "captions": true.${own}`);
  }
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
  if (music?.src !== undefined) music = musicFileSetting(music);
  else if (music) {
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

// The languages of a project: the main one first, then one for each
// script.<lang>.md beside script.md. Other names, and a script named after the
// main language, are not languages of the video, and check says so.
export function projectLanguages(dir, main) {
  const extra = fs.readdirSync(dir).map((f) => /^script\.([a-z]{2}(?:-[a-z]{2})?)\.md$/.exec(f)?.[1]).filter((code) => code && code !== main && Object.hasOwn(LANGUAGES, code));
  return [main, ...extra.sort()];
}

// The files of one language: script.md, strings.json and post.json for the main
// language, and script.<lang>.md, strings.<lang>.json and post.<lang>.json for
// the others.
export function languageFiles(dir, language, main) {
  const suffix = language === main ? '' : `.${language}`;
  return { script: path.join(dir, `script${suffix}.md`), strings: path.join(dir, `strings${suffix}.json`), post: path.join(dir, `post${suffix}.json`) };
}

// On-screen text as { key: text }, or null without a file. Nested groups become
// dotted keys, like "intro.title". A value is a text or a list of texts.
export function readStrings(file) {
  if (!fs.existsSync(file)) return null;
  const name = path.basename(file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${name} is not valid JSON: ${e.message}`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail(`${name} must be an object like { "title": "How DNS works" }`);
  const out = {};
  const walk = (group, prefix) => {
    for (const [k, v] of Object.entries(group)) {
      const key = prefix + k;
      if (typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) out[key] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${key}.`);
      else fail(`${name}: "${key}" must be a text, a list of texts or a group of texts`);
    }
  };
  walk(json, '');
  return out;
}

// What check says about the other languages: texts that one strings file has and
// another lacks, scripts that are not a language of the video, and settings of
// another language that don't work.
export function languageIssues(project) {
  const issues = [];
  const warn = (message) => issues.push({ level: 'warn', scene: null, t: null, message });
  const main = project.languages[0];
  for (const f of fs.readdirSync(project.dir)) {
    const code = /^script\.([a-z]{2}(?:-[a-z]{2})?)\.md$/.exec(f)?.[1];
    if (code === main) warn(`${f} is not used: ${main} is the main language, and its narration is script.md`);
    else if (code && !Object.hasOwn(LANGUAGES, code)) warn(`${f} is not used: explainroo speaks ${oneOf(Object.keys(LANGUAGES))}, and not ${code}`);
  }
  if (project.languages.length < 2) return issues;
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(project.dir, 'video.json'), 'utf8'));
  } catch {}
  const all = project.languages.map((language) => {
    const file = languageFiles(project.dir, language, main).strings;
    const name = path.basename(file);
    if (language === project.language) return { name, strings: project.strings };
    try {
      normalizeConfig(raw, project.dir, { language });
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      warn(`the ${language} version can't be made: ${e.message}`);
    }
    try {
      return { name, strings: readStrings(file) };
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      warn(e.message);
      return { name, strings: {}, broken: true };
    }
  });
  const keys = [...new Set(all.flatMap((x) => Object.keys(x.strings ?? {})))];
  for (const x of all) {
    const missing = keys.filter((k) => !x.strings || !Object.hasOwn(x.strings, k));
    if (!missing.length || x.broken) continue;
    const list = missing.slice(0, 8).map((k) => `"${k}"`).join(', ') + (missing.length > 8 ? ` and ${missing.length - 8} more` : '');
    warn(x.strings ? `${x.name} is missing ${missing.length} text${missing.length === 1 ? '' : 's'} that another language has: ${list}` : `there is no ${x.name}, and another language has ${missing.length} text${missing.length === 1 ? '' : 's'}: ${list}`);
  }
  return issues;
}

// The name of the script a project reads, for messages.
export function scriptName(project) {
  return path.basename(project.paths?.script ?? 'script.md');
}

// " --lang es" for a language other than the main one, so that a command in a
// message works on the same version of the video.
export function langArg(project) {
  return project.languages && project.language !== project.languages[0] ? ` --lang ${project.language}` : '';
}

// " --size tiktok" when the block of the size gives the narration a pace of its
// own, so that a command in a message makes the narration at that pace.
export function sizeArg(project) {
  return project.ownPace ? ` --size ${project.ownPace.size}` : '';
}

// `overrides` replace settings of video.json for one run, such as the size from
// --size or the watermark from --no-watermark. The file itself stays as it is.
// `lang` picks one language of a video in several languages.
export function loadProject(arg, overrides = {}) {
  const dir = findProjectDir(arg);
  const set = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null));
  const { lang, ...settings } = set;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'));
  } catch (e) {
    fail(`video.json is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('video.json must be an object like { "title": "How DNS works" }');
  const main = raw.language ?? DEFAULTS.language;
  if (typeof main !== 'string' || !Object.hasOwn(LANGUAGES, main)) normalizeConfig(raw, dir);
  const languages = projectLanguages(dir, main);
  if (lang !== undefined && !languages.includes(lang)) {
    if (!Object.hasOwn(LANGUAGES, lang)) fail(`--lang must be one of ${oneOf(Object.keys(LANGUAGES))}, not "${lang}"`);
    fail(`this video has no ${lang} version. Add script.${lang}.md for it. The languages it has: ${languages.join(', ')}`);
  }
  const language = lang ?? main;
  const config = normalizeConfig(raw, dir, { language, overrides: settings });
  // A version in a language without a Kokoro voice, like German, has no default
  // voice to fall back on. So every command stops until it has one, also when it
  // only has its script.<lang>.md.
  for (const code of languages) {
    if (code !== language && !LANGUAGES[code]) normalizeConfig(raw, dir, { language: code });
  }
  for (const f of [...config.fonts.map((x) => x.src), ...(config.brand?.logo ? [config.brand.logo] : []), ...(config.music?.src ? [config.music.src] : [])]) {
    if (!fs.existsSync(path.join(dir, f))) fail(`${f} is listed in video.json but the file is missing`);
  }
  if (config.music?.src && !fs.realpathSync(path.join(dir, config.music.src)).startsWith(path.join(fs.realpathSync(dir), 'assets') + path.sep)) fail('music.src must stay inside assets/, including links');
  const files = languageFiles(dir, language, main);
  if (!fs.existsSync(files.script)) fail(`${files.script} is missing`);
  const script = parseScript(fs.readFileSync(files.script, 'utf8'), { language: config.language, file: path.basename(files.script) });
  // The main title is in the main language, so another language takes the title of its own script.
  if (language !== main && script.title && raw.languages?.[language]?.title === undefined) config.title = script.title;
  if (!config.title) config.title = script.title || path.basename(dir);
  const scenesPath = path.join(dir, 'scenes.js');
  if (!fs.existsSync(scenesPath)) fail(`${scenesPath} is missing`);
  const strings = readStrings(files.strings);
  const sub = language === main ? [] : [language];
  // A size whose block gives another pace than the language's own has narration
  // of its own, so it builds in build/pace-<pace>/, next to the normal build.
  // Two paces never share a voice file, and switching sizes makes nothing again.
  const pace = Number(config.pace);
  const ownPace = pace === Number(languageSettings(raw, language).pace ?? DEFAULTS.pace) ? null : { size: config.size, pace };
  const build = path.join(dir, 'build', ...sub, ...(ownPace ? [`pace-${pace}`] : []));
  const out = path.join(dir, 'out', ...sub);
  return {
    dir,
    config,
    script,
    language,
    languages,
    strings,
    overrides: set,
    sizeOverride: settings.size,
    // The names of the sizes with a block in "sizes", for package and history.
    sizeBlocks: raw.sizes ? Object.keys(raw.sizes) : [],
    clipBudget: raw.clipBudget ?? null,
    ownPace,
    paths: { build, out, voice: path.join(build, 'voice'), scenes: scenesPath, script: files.script, strings: files.strings, post: files.post, look: config.look ? path.resolve(dir, config.theme) : null },
  };
}

// An override gets its own name, like video-tiktok.mp4 or stills-no-watermark/,
// so it never replaces the normal output.
export function outputPath(project, name, ext = '', out = null) {
  const size = project.sizeOverride === undefined ? '' : `-${project.sizeOverride.replace(':', '-')}`;
  const watermark = project.overrides?.watermark === false ? '-no-watermark' : '';
  return path.resolve(out || path.join(project.paths.out, `${name}${size}${watermark}${ext}`));
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
