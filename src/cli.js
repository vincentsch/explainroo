// explainroo command line.
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, ProjectError, THEMES, MUSIC_STYLES, FORMATS, resolveSize, normalizeConfig } from './project.js';
import { layoutAreas } from '../engine/layout.js';
import { ScriptError } from './script.js';
import { prepare, makeState } from './pipeline.js';
import { render } from './render.js';
import { check, stills, sheet, verify } from './qa.js';
import { startServer, ROOT } from './server.js';
import { VOICES, LANGUAGES, voiceLanguage, loadTTS, loadASR, cacheRoot, ttsDtype, TTS_SAMPLE_RATE, MULTILINGUAL_ASR_MODEL } from './models.js';
import { espeakVersion, phonemize, generateSpeech } from './phonemes.js';
import { writeWav } from './wav.js';
import { ffmpegVersion } from './ffmpeg.js';
import { findChrome } from './browser.js';
import { generateImage, imageLog, imageSpend, IMAGE_MODELS } from './images.js';
import { elevenVoices, elevenUsage, elevenSpeed } from './elevenlabs.js';
import { capture } from './capture.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `explainroo ${VERSION}: narrated explainer videos from code

Usage: explainroo <command> [project] [options]

Make a video
  init <dir>            create a project (--theme, --size, --pace, --language es, --voice, --title)
  voice [project]       make the narration (Kokoro, ElevenLabs or a recording) and word timings
  preview [project]     live preview in your browser, reloads on save (--port)
  still [project] [t…]  PNG stills: "12.5", "scene", "scene@2.4" (--transparent, default: end of every scene)
  sheet [project]       contact sheet of the whole video (--scene id, --every s)
  check [project]       find layout, timing and pronunciation problems (--view-width pixels)
  render [project]      write the video with subtitles, chapters and a cover (--format mp4|gif|webm|mov,
                        --transparent, --draft, --from s, --to s, --workers n, --out file)
  verify [project]      check the video: loudness, black frames, narration (--file)

Product demos
  capture [project] <url>  save screenshots, wording, colors, fonts and logo of a live site (--mobile)

Images (optional, needs an OpenRouter API key)
  image [project] <name> "<what to draw>"   save an illustration as assets/<name>.png
                        (--model best|cheap, --aspect 16:9, --ref assets/a.png,assets/b.png, --no-style)
  images [project]      list generated images and what they cost

Reference
  voices [project]      list Kokoro voices (--language es for one language, --elevenlabs for your ElevenLabs key)
  say "text"            hear a Kokoro voice (--voice am_michael, --speed 1, --out sample.wav)
  themes                list looks
  formats               list sizes for YouTube, Shorts, TikTok, Reels, Instagram, LinkedIn
  icons <word…>         search the 1,800+ built-in icons
  doctor                check ffmpeg, Chrome, espeak-ng and models (--fetch downloads English models)

Options: --json for machine-readable output. The project defaults to the current folder.
Docs: AGENTS.md (for coding agents) and https://www.explainroo.com/docs/`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !BOOL.has(a.slice(2))) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else if (a === '-h') flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}
const BOOL = new Set(['json', 'draft', 'transparent', 'force', 'fetch', 'help', 'version', 'quiet', 'open', 'no-style', 'elevenlabs', 'mobile']);

function num(v, name) {
  if (v === undefined) return undefined;
  if (v === true) throw new ProjectError(`--${name} needs a value`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ProjectError(`--${name} must be a number`);
  return n;
}

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  const json = !!flags.json;
  const log = json || flags.quiet ? () => {} : (m) => process.stderr.write(`${m}\n`);
  const print = (human, data) => {
    if (json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else if (human) process.stdout.write(human + '\n');
  };

  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  if (cmd === 'version' || flags.version) {
    print(VERSION, { version: VERSION });
    return 0;
  }

  try {
    switch (cmd) {
      case 'init': return init(pos[0], flags, print);
      case 'capture': {
        if (pos.length < 1 || pos.length > 2) throw new ProjectError('usage: explainroo capture [project] <url> [--mobile] [--json]');
        const r = await capture(pos.length === 2 ? pos[0] : undefined, pos.at(-1), { mobile: !!flags.mobile });
        const families = r.fonts.families.map((f) => f.family).join(', ') || 'none found';
        print(`saved:\n${r.files.map((f) => '  ' + f).join('\n')}\naccent: ${r.colors.accent || 'none found'}\nfonts: ${families}\nlogo: ${r.logo.picked || 'none found'}\n${r.notes.join('\n')}\nPaste into video.json:\n${JSON.stringify(r.suggestion, null, 2)}\nOpen the screenshots and check them before you use them.`, r);
        return 0;
      }
      case 'voice': {
        const project = loadProject(pos[0]);
        const before = elevenUsage(project).length;
        const { voices, timeline } = await prepare(project, { log, force: !!flags.force });
        const characters = elevenUsage(project).slice(before).reduce((n, e) => n + e.characters, 0);
        const rows = project.script.scenes.map((s) => {
          const v = voices[s.id];
          return { scene: s.id, voice: v.duration, confirmed: v.matchRate, unconfirmed: v.unmatched, marks: v.marks,
            ...(project.config.voice.provider === 'recording' && v.matchRate < 0.85 ? { message: 'The recording does not match script.md here. Make script.md say what was actually said.' } : {}) };
        });
        const mismatch = project.config.voice.provider === 'recording' && rows.some((r) => r.confirmed < 0.85)
          ? '\nThe recording does not match script.md in those scenes. Make script.md say what was actually said.' : '';
        const isEleven = project.config.voice.provider === 'elevenlabs';
        const wanted = project.config.speed * project.config.pace;
        const speed = elevenSpeed(wanted);
        const speedNote = isEleven && speed !== wanted ? `\nElevenLabs speed ${wanted.toFixed(2)} is outside 0.7 to 1.2; using ${speed}.` : '';
        const usage = isEleven ? `\nElevenLabs: ${characters} characters used` : '';
        print(rows.map((r) => `${r.scene.padEnd(18)} ${r.voice.toFixed(1).padStart(5)}s  ${Math.round(r.confirmed * 100)}% confirmed${r.unconfirmed.length ? '  unconfirmed: ' + r.unconfirmed.slice(0, 6).join(', ') : ''}`).join('\n') + `\ntotal ${timeline.duration.toFixed(1)}s` + mismatch + usage + speedNote, { scenes: rows, duration: timeline.duration, ...(isEleven ? { characters, speed, ...(speed !== wanted ? { requested_speed: wanted } : {}) } : {}) });
        return 0;
      }
      case 'preview': return await preview(pos[0], flags, log);
      case 'still': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const project = loadProject(isProject ? pos.shift() : undefined);
        const list = await stills(project, pos, { log, scale: num(flags.scale, 'scale') ?? 1, transparent: !!flags.transparent });
        print(list.map((s) => `${s.label.padEnd(24)} ${s.file}`).join('\n'), { stills: list });
        return 0;
      }
      case 'sheet': {
        const project = loadProject(pos[0]);
        const r = await sheet(project, { scene: flags.scene, every: num(flags.every, 'every'), cols: num(flags.cols, 'cols'), log });
        print(`${r.file} (${r.frames} frames)`, r);
        return 0;
      }
      case 'check': {
        const project = loadProject(pos[0]);
        const r = await check(project, { log, step: num(flags.step, 'step') ?? 0.25, viewWidth: num(flags['view-width'], 'view-width') ?? null });
        const errors = r.issues.filter((i) => i.level === 'error').length;
        const human = r.issues.length
          ? r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.scene ?? ''}${i.t !== null && i.t !== undefined ? ' @' + i.t + 's' : ''}: ${i.message}`).join('\n') + `\n${errors} error(s), ${r.issues.length - errors} other finding(s) in ${r.scenes} scenes (${r.duration.toFixed(1)}s)`
          : `no problems found in ${r.scenes} scenes (${r.duration.toFixed(1)}s)`;
        print(human, r);
        return errors ? 1 : 0;
      }
      case 'render': {
        const project = loadProject(pos[0]);
        const r = await render(project, { log, draft: !!flags.draft, transparent: !!flags.transparent, from: num(flags.from, 'from'), to: num(flags.to, 'to'), workers: num(flags.workers, 'workers'), scale: num(flags.scale, 'scale'), out: textFlag(flags, 'out'), format: textFlag(flags, 'format') });
        print([r.out, r.subtitles?.srt, r.subtitles?.vtt, r.chapters, r.cover].filter(Boolean).map((f) => path.relative(process.cwd(), f) || f).join('\n'), r);
        return 0;
      }
      case 'verify': {
        const project = loadProject(pos[0]);
        const r = await verify(project, { file: flags.file, log });
        const lines = [
          `${r.file}: ${r.duration}s, ${r.video ? `${r.video.width}x${r.video.height}` : 'no video'}, loudness ${r.loudness?.integrated ?? '?'} LUFS, true peak ${r.loudness?.truePeak ?? '?'} dBFS`,
          r.speech ? `narration understood: ${Math.round(r.speech.matchRate * 100)}%` : '',
          ...r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.message}`),
        ].filter(Boolean);
        print(lines.join('\n'), r);
        return r.issues.some((i) => i.level === 'error') ? 1 : 0;
      }
      case 'image': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const project = loadProject(isProject ? pos.shift() : undefined);
        const [name, ...rest] = pos;
        const r = await generateImage(project, {
          name,
          prompt: rest.join(' '),
          model: flags.model,
          aspect: flags.aspect,
          refs: flags.ref ? String(flags.ref).split(',').map((x) => x.trim()).filter(Boolean) : [],
          style: flags['no-style'] ? false : flags.style,
          log,
        });
        print(`${r.file}  ${r.model}  ${r.cost_usd !== null ? '$' + r.cost_usd.toFixed(4) : 'cost unknown'}  (images so far: $${r.total_usd.toFixed(4)})\nOpen the image and check it before you use it.`, r);
        return 0;
      }
      case 'images': {
        const project = loadProject(pos[0]);
        const list = imageLog(project);
        const total = imageSpend(project);
        print(list.length ? list.map((e) => `${e.time.slice(0, 16)}  ${e.file.padEnd(28)} ${e.model.padEnd(32)} ${e.cost_usd !== null ? '$' + e.cost_usd.toFixed(4) : '?'}`).join('\n') + `\n${list.length} image request(s), $${total.toFixed(4)}` : 'no images generated yet', { images: list, total_usd: total, models: IMAGE_MODELS });
        return 0;
      }
      case 'voices': {
        const language = textFlag(flags, 'language');
        if (language !== undefined) normalizeConfig({ language });
        if (flags.elevenlabs) {
          const voices = await elevenVoices(path.resolve(pos[0] || '.'));
          print(voices.map((v) => `${v.name}  ${v.id}  ${Object.entries(v.labels).map(([k, x]) => `${k}: ${x}`).join(', ')}`).join('\n'), { voices });
        } else {
          const voices = Object.fromEntries(Object.entries(VOICES).filter(([id]) => language === undefined || voiceLanguage(id) === language));
          print(Object.entries(voices).map(([k, v]) => `${k.padEnd(12)} ${voiceLanguage(k).padEnd(6)} ${v}`).join('\n') + '\nUse voices --elevenlabs for ElevenLabs, or set voice to { "provider": "recording", "src": "assets/narration.wav" } in video.json.', { voices, languages: Object.fromEntries(Object.keys(voices).map(id => [id, voiceLanguage(id)])) });
        }
        return 0;
      }
      case 'say': return await say(pos.join(' '), flags, log, print);
      case 'themes': {
        const desc = {
          paper: 'hand-drawn marker on warm paper; brush transitions; warm music',
          clean: 'crisp flat product style, cards and soft shadows; slide transitions; upbeat music',
          chalk: 'chalk on a green board with hatched fills; brush transitions; calm music',
          blueprint: 'white technical drafting on blueprint blue with a grid; wipe transitions; tech music',
          midnight: 'dark developer look with glowing accents; zoom transitions; tech music',
        };
        print(THEMES.map((t) => `${t.padEnd(10)} ${desc[t]}`).join('\n') + `\n\nCustom looks: set theme in video.json to a relative .json file that extends a built-in look.\nmusic styles: ${MUSIC_STYLES.join(', ')}`, { themes: desc, music: MUSIC_STYLES });
        return 0;
      }
      case 'formats': {
        // The free area for content with the defaults (watermark on, captions
        // as "auto" decides), the same box scenes get as s.safe.
        const info = Object.entries(FORMATS).map(([name, f]) => {
          const cfg = normalizeConfig({ size: name });
          const { safe } = layoutAreas(cfg, cfg.width, cfg.height);
          return { name, width: f.size[0], height: f.size[1], use: f.use, captions: cfg.captions, content: { x: safe.x, y: safe.y, w: safe.w, h: safe.h } };
        });
        const rows = info.map((r) => `${r.name.padEnd(10)} ${`${r.width}x${r.height}`.padEnd(10)} ${r.use}\n${''.padEnd(22)}content area ${r.content.w}x${r.content.h} at ${r.content.x},${r.content.y}${r.captions ? ', captions below it' : ''}`);
        print(rows.join('\n') + '\n\nAlso: 16:9, 9:16, 1:1, 4:5 or WIDTHxHEIGHT. Set it with "size" in video.json or init --size.', { formats: info });
        return 0;
      }
      case 'icons': return icons(pos, print);
      case 'doctor': return await doctor(flags, log, print);
      default:
        process.stderr.write(`unknown command "${cmd}"\n\n${HELP}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ProjectError || e instanceof ScriptError) {
      if (json) print(null, { error: e.message });
      else process.stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    if (json) print(null, { error: e.message, stack: e.stack });
    else process.stderr.write(`error: ${e.message}\n`);
    if (process.env.EXPLAINROO_DEBUG) process.stderr.write(`${e.stack}\n`);
    return 1;
  }
}

// A text flag given without a value (for example "--title" at the end of the
// line) parses as true. Name the flag instead of failing deep in string code.
function textFlag(flags, name) {
  if (flags[name] === true) throw new ProjectError(`--${name} needs a value`);
  return flags[name];
}

function init(dir, flags, print) {
  if (!dir) throw new ProjectError('usage: explainroo init <dir> [--theme paper] [--size youtube|tiktok|linkedin|...] [--pace 1.2] [--language es] [--voice af_heart] [--title "..."]');
  const target = path.resolve(dir);
  if (fs.existsSync(path.join(target, 'video.json'))) throw new ProjectError(`${target} already has a video.json`);
  const theme = textFlag(flags, 'theme') || 'paper';
  if (!THEMES.includes(theme)) throw new ProjectError(`theme must be one of ${THEMES.join(', ')}`);
  const language = textFlag(flags, 'language') ?? 'en';
  normalizeConfig({ language });
  const voice = textFlag(flags, 'voice') || LANGUAGES[language];
  if (!VOICES[voice]) throw new ProjectError(`voice "${voice}" does not exist. Run "explainroo voices".`);
  const title = textFlag(flags, 'title') || path.basename(target).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const tpl = path.join(ROOT, 'templates', 'starter');
  const size = textFlag(flags, 'size') || '16:9';
  resolveSize(size);
  const config = { title, theme, size, voice, music: true, captions: 'auto' };
  if (flags.language !== undefined) config.language = language;
  if (flags.pace !== undefined) config.pace = num(flags.pace, 'pace');
  normalizeConfig(config);
  // Create the folder only after every setting checks out, so a bad flag
  // leaves nothing behind.
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(target, 'video.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'script.md'), fs.readFileSync(path.join(tpl, 'script.md'), 'utf8').replace('{{title}}', title));
  fs.writeFileSync(path.join(target, 'scenes.js'), fs.readFileSync(path.join(tpl, 'scenes.js'), 'utf8').replace(/\{\{title\}\}/g, title.replace(/'/g, "\\'")));
  fs.writeFileSync(path.join(target, '.gitignore'), 'build/\nout/\n');
  print(`created ${target}\nnext: edit script.md and scenes.js, then run "explainroo preview ${dir}" or "explainroo render ${dir} --draft"`, { dir: target });
  return 0;
}

async function preview(dir, flags, log) {
  let project = loadProject(dir);
  let { timeline } = await prepare(project, { log });
  let state = makeState(project, timeline);
  let lastError = null;
  const server = await startServer({ projectDir: project.dir, getState: () => (lastError ? { ...state, error: lastError } : state), port: num(flags.port, 'port') ?? 4400 });
  log(`preview: ${server.url}  (Ctrl+C to stop)`);
  const watched = ['video.json', 'script.md'];
  const stamp = () => {
    const files = watched.map((f) => path.join(project.dir, f));
    // Read the current path too, so creating a missing look file clears its error.
    try {
      const { theme } = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      if (typeof theme === 'string' && theme.endsWith('.json')) files.push(path.resolve(project.dir, theme));
    } catch {}
    return files.map((f) => { try { const st = fs.statSync(f); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return `${f}:missing`; } }).join('|');
  };
  let last = stamp();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const now = stamp();
    busy = true;
    try {
      if (now !== last) {
        last = now;
        log('script, settings or look changed, updating project');
        project = loadProject(project.dir);
        ({ timeline } = await prepare(project, { log }));
        lastError = null;
      }
      state = makeState(project, timeline);
    } catch (e) {
      lastError = e.message;
      log(`error: ${e.message}`);
    } finally {
      busy = false;
    }
  }, 700);
  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  clearInterval(timer);
  await server.close();
  return 0;
}

async function say(text, flags, log, print) {
  if (!text) throw new ProjectError('usage: explainroo say "text to speak" [--voice af_heart] [--speed 1] [--out sample.wav]');
  const voice = textFlag(flags, 'voice') || 'af_heart';
  if (!VOICES[voice]) throw new ProjectError(`voice "${voice}" does not exist. Run "explainroo voices".`);
  const tts = await loadTTS({ log });
  const language = voiceLanguage(voice);
  const phonemes = language === 'en' ? undefined : (await phonemize([text], language))[0];
  const audio = await generateSpeech(tts, text, { language, voice, speed: num(flags.speed, 'speed') ?? 1, phonemes });
  const out = path.resolve(textFlag(flags, 'out') || `${voice}.wav`);
  writeWav(out, audio.audio, audio.sampling_rate || TTS_SAMPLE_RATE);
  print(out, { file: out, voice });
  return 0;
}

function icons(words, print) {
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'icons', 'lucide-tags.json'), 'utf8'));
  const { aliases = {} } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'icons', 'lucide.json'), 'utf8'));
  for (const [alias, target] of Object.entries(aliases)) all[target] = [...(all[target] || []), alias.replace(/-/g, ' ')];
  const q = words.map((w) => w.toLowerCase());
  if (!q.length) {
    print(`${Object.keys(all).length} icons. Search with: explainroo icons <word…>`, { count: Object.keys(all).length });
    return 0;
  }
  const scored = Object.entries(all)
    .map(([name, tags]) => {
      let score = 0;
      for (const w of q) {
        if (name === w) score += 10;
        else if (name.split('-').includes(w)) score += 6;
        else if (name.includes(w)) score += 3;
        if (tags.some((t) => t === w)) score += 4;
        else if (tags.some((t) => t.includes(w))) score += 1;
      }
      return { name, score, tags };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 40);
  print(scored.map((x) => `${x.name.padEnd(28)} ${x.tags.slice(0, 6).join(', ')}`).join('\n') || `no icons match "${words.join(' ')}"`, { icons: scored.map((x) => x.name) });
  return 0;
}

async function doctor(flags, log, print) {
  const rows = [];
  const add = (name, ok, detail) => rows.push({ name, ok, detail });
  // The voice library (kokoro-js) needs import.meta.dirname, added in Node 20.11.
  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > 20 || (maj === 20 && min >= 11);
  add('node', nodeOk, `v${process.versions.node}${nodeOk ? '' : ' (need 20.11 or newer)'}`);
  const ff = ffmpegVersion();
  add('ffmpeg', !!ff, ff || 'not found; install ffmpeg or set EXPLAINROO_FFMPEG');
  const espeak = espeakVersion();
  add('espeak-ng', true, espeak || 'not found; only needed for other languages');
  try {
    add('chrome', true, findChrome());
  } catch (e) {
    add('chrome', false, e.message);
  }
  const models = path.join(cacheRoot(), 'models', 'onnx-community');
  const has = (n) => fs.existsSync(path.join(models, n));
  if (flags.fetch) {
    log('downloading speech models (about 400 MB the first time)');
    await loadTTS({ log });
    await loadASR({ log });
  }
  add('voice model', has('Kokoro-82M-v1.0-ONNX'), has('Kokoro-82M-v1.0-ONNX') ? `Kokoro 82M (${ttsDtype()}) in ${models}` : 'not downloaded yet; "explainroo doctor --fetch" or the first voice run fetches it');
  add('speech check model', has('whisper-base.en_timestamped'), has('whisper-base.en_timestamped') ? 'Whisper base.en' : 'not downloaded yet; fetched on first use');
  add('language model', has(MULTILINGUAL_ASR_MODEL.split('/')[1]), 'Whisper small for es, fr, it, pt-br and hi; downloaded on first use, not by --fetch');
  const ok = rows.every((r) => r.ok || r.name.includes('model'));
  print(rows.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(20)} ${r.detail}`).join('\n'), { ok, checks: rows });
  return ok ? 0 : 1;
}
