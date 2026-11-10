// explainroo doctor: whether this computer has what a setup needs. Every part is
// "ready", "not needed" or "missing". Whether the setup needs a part decides first,
// so a part it doesn't need is "not needed" also when it is there. Without a
// project the setup is English with a Kokoro voice. With one, it is each language
// of the project with the voice that language uses.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome, installRecordEncoder, recordEncoder } from './browser.js';
import { saveKeys, settingValue, settingsEnvFile } from './env.js';
import { ffmpegVersion } from './ffmpeg.js';
import { projectWord, selfCommand } from './history.js';
import { ASR_MODEL, asrModel, cacheRoot, downloadSize, LANGUAGE_NAMES, LANGUAGES, loadASR, loadTTS, MODEL_NAMES, MULTILINGUAL_ASR_MODEL, TTS_MODEL, ttsDtype } from './models.js';
import { espeakInstall, espeakVersion, misakiAvailable, misakiInstall, phonemeProgram } from './phonemes.js';
import { checkLanguage, normalizeConfig, ProjectError } from './project.js';
import { allOf, voiceProviders } from './services.js';
import { ROOT } from './server.js';

// The examples come with the package. A copy without them can still read them here.
const EXAMPLES_URL = 'https://github.com/vincentsch/explainroo/tree/main/examples';

export const DEFAULT_SETUP = [{ language: 'en', voice: LANGUAGES.en }];

// Each language of a project with the voice it uses.
export function projectSetup(project) {
  const raw = JSON.parse(fs.readFileSync(path.join(project.dir, 'video.json'), 'utf8'));
  return project.languages.map((language) => ({
    language,
    voice: language === project.language ? project.config.voice : normalizeConfig(raw, project.dir, { language }).voice,
  }));
}

// The setup of `doctor --language es,fr` before a project exists: each language
// with its Kokoro voice, or with no voice yet when Kokoro has none for it.
export function languageSetup(value) {
  const languages = [...new Set(String(value).split(',').map((x) => x.trim()).filter(Boolean))];
  if (!languages.length) throw new ProjectError(`--language needs a code, like --language es. The codes are ${Object.keys(LANGUAGES).join(', ')}.`);
  for (const language of languages) checkLanguage(language);
  return languages.map((language) => ({ language, voice: LANGUAGES[language] }));
}

// "kokoro" for a Kokoro voice, otherwise the provider of the voice. A language
// that Kokoro doesn't speak has no voice until a project picks one.
function voiceRoute(voice) {
  if (voice === null) return null;
  return typeof voice === 'string' ? 'kokoro' : voice.provider;
}

// The parts a setup needs, each with the languages that need it. A Kokoro voice
// needs the voice model, and some languages need a program that turns their text
// into sounds. Every voice needs the speech check model of its language, which
// finds the word times.
export function setupNeeds(setup) {
  const needs = new Map();
  const need = (part, language) => needs.set(part, [...new Set([...(needs.get(part) ?? []), language])]);
  for (const { language, voice } of setup) {
    if (voiceRoute(voice) === 'kokoro') {
      need(MODEL_NAMES[TTS_MODEL], language);
      const program = phonemeProgram(language);
      if (program) need(program === 'misaki' ? `misaki ${language}` : program, language);
    }
    need(MODEL_NAMES[asrModel(language)], language);
  }
  return needs;
}

const names = (languages) => allOf(languages.map((language) => LANGUAGE_NAMES[language]));

// The packages of espeak-ng on Debian and Ubuntu.
export const ESPEAK_PACKAGES = ['espeak-ng', 'espeak-ng-data', 'libespeak-ng1', 'libpcaudio0', 'libsonic0'];

// Starts the copy of espeak-ng next to it. The library folder depends on the
// processor, like x86_64-linux-gnu, so it is found and not named. espeak-ng reads
// only the first 159 characters of ESPEAK_DATA_PATH, so a longer path is given
// from inside the folder.
const LAUNCHER = `#!/bin/sh
# Starts the copy of espeak-ng that "explainroo doctor --fetch" unpacked here.
here=$(cd "$(dirname "$0")" && pwd)
lib=$(dirname "$(find "$here/root/usr/lib" -name 'libespeak-ng.so*' | head -n 1)")
export LD_LIBRARY_PATH="$lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
data="$lib/espeak-ng-data"
if [ \${#data} -gt 150 ]; then cd "$data" || exit 1; data=.; fi
export ESPEAK_DATA_PATH="$data"
exec "$here/root/usr/bin/espeak-ng" "$@"
`;

// A program on the PATH, or null.
function onPath(name) {
  for (const folder of (process.env.PATH || '').split(path.delimiter)) {
    if (!folder) continue;
    const file = path.join(folder, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return null;
}

// On Debian and Ubuntu, a copy of espeak-ng that needs no root: the packages from
// "apt-get download", unpacked with "dpkg -x" into the cache folder, with a
// launcher there, and EXPLAINROO_ESPEAK in the settings file. It says what it
// does before it starts. Null where apt-get and dpkg aren't there. A copy that
// fails its own --version replaces nothing.
export function setupEspeak({ notice = () => {} } = {}) {
  if (process.platform === 'win32') return null;
  const apt = onPath('apt-get');
  const dpkg = onPath('dpkg');
  if (!apt || !dpkg) return null;
  const folder = path.join(cacheRoot(), 'espeak-ng');
  const launcher = path.join(folder, 'espeak-ng');
  const settings = settingsEnvFile();
  notice(`espeak-ng is missing, so explainroo sets up a copy that needs no root. It downloads the packages ${ESPEAK_PACKAGES.join(', ')} with "apt-get download" and unpacks them with "dpkg -x" into ${folder}. It writes a launcher there and saves EXPLAINROO_ESPEAK=${launcher} in ${settings}.`);
  const temp = `${folder}.${process.pid}.tmp`;
  const packages = path.join(temp, 'packages');
  const run = (program, args, what) => {
    const r = spawnSync(program, args, { cwd: packages, encoding: 'utf8', timeout: 5 * 60 * 1000 });
    if (r.error || r.status !== 0) {
      const said = String(r.stderr || r.error?.message || '').trim().split('\n').filter(Boolean).at(-1) ?? `exit code ${r.status}`;
      throw new ProjectError(`${what} failed: ${said}`);
    }
  };
  let version;
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(packages, { recursive: true });
    run(apt, ['download', ...ESPEAK_PACKAGES], '"apt-get download"');
    const debs = fs.readdirSync(packages).filter((name) => name.endsWith('.deb')).sort();
    if (!debs.length) throw new ProjectError('"apt-get download" got no packages');
    for (const deb of debs) run(dpkg, ['-x', path.join(packages, deb), path.join(temp, 'root')], `"dpkg -x ${deb}"`);
    fs.rmSync(packages, { recursive: true, force: true });
    fs.writeFileSync(path.join(temp, 'espeak-ng'), LAUNCHER, { mode: 0o755 });
    // It has to read a word, which needs its data too, not only start.
    const check = spawnSync(path.join(temp, 'espeak-ng'), ['-q', '--ipa=1', '-v', 'es', 'hola'], { encoding: 'utf8', timeout: 10000 });
    if (check.error || check.status !== 0 || !check.stdout.trim()) throw new ProjectError(`the unpacked copy did not read a word: ${String(check.stderr || check.error?.message || '').trim().split('\n').at(-1) || 'no answer'}`);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.renameSync(temp, folder);
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw e;
  }
  const started = spawnSync(launcher, ['--version'], { encoding: 'utf8', timeout: 10000 });
  version = String(started.stdout || '').trim().split('\n')[0];
  saveKeys(settings, { EXPLAINROO_ESPEAK: launcher });
  // A value in the environment, or in the .env of a source checkout, comes first.
  const used = settingValue('EXPLAINROO_ESPEAK');
  return { folder, launcher, settings, version, ...(used !== launcher ? { shadowed: process.env.EXPLAINROO_ESPEAK ? 'the environment' : `the .env of ${ROOT}` } : {}) };
}

// Whether a project has a recording script in recordings/.
function hasRecordings(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'recordings')).some((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
}

// `project` is a loaded project, `language` the codes of --language, or neither for
// the default setup. Only `fetch` downloads anything, and it fetches the models
// that setup needs: the voice model for a Kokoro voice, the English speech check
// model for English, and the language model for every other language.
export async function doctor({ project = null, language = null, fetch = false, record = false, log = () => {}, notice = log } = {}) {
  if (project && language !== null) throw new ProjectError('doctor checks a project or the languages of --language, not both. With a project it checks the languages in its video.json.');
  const setup = project ? projectSetup(project) : language !== null ? languageSetup(language) : DEFAULT_SETUP;
  const needs = setupNeeds(setup);
  const command = selfCommand();
  const rows = [];
  // A part that every setup needs.
  const always = (name, found, ready, missing) => rows.push({ name, state: found ? 'ready' : 'missing', ok: !!found, detail: found ? ready : missing, fails: true });
  // A part that only some setups need. The parts explainroo can't get by itself fail the exit code.
  const some = (name, { found, ready, missing, notNeeded, fails = false }) => {
    const languages = needs.get(name);
    const state = !languages ? 'not needed' : found ? 'ready' : 'missing';
    const unused = typeof notNeeded === 'function' ? notNeeded(found) : `${notNeeded}${found ? '. It is installed.' : ''}`;
    const detail = state === 'ready' ? ready(languages) : state === 'missing' ? missing(languages) : unused;
    rows.push({ name, state, ok: state !== 'missing', detail, fails });
  };

  // The voice library (kokoro-js) needs import.meta.dirname, added in Node 20.11.
  const [major, minor] = process.versions.node.split('.').map(Number);
  always('node', major > 20 || (major === 20 && minor >= 11), `v${process.versions.node}`, `v${process.versions.node} is too old. Install Node 20.11 or newer.`);
  const ff = ffmpegVersion();
  always('ffmpeg', ff, ff, 'not found. Install ffmpeg, or set EXPLAINROO_FFMPEG to its binary.');
  let chrome = null;
  let noChrome = null;
  try {
    chrome = findChrome();
  } catch (e) {
    noChrome = e.message;
  }
  always('chrome', chrome, chrome, noChrome);
  // The same setup, with --fetch.
  const again = `${command} doctor --fetch${language !== null ? ` --language ${language}` : project ? ` ${projectWord(project.dir)}` : ''}`;
  // Only record needs Playwright's ffmpeg, so a missing one doesn't fail the
  // run. It counts for a project with recordings and with --record. record
  // downloads it the first time otherwise.
  const recording = record || (!!project && hasRecordings(project.dir));
  let encoder = await recordEncoder();
  let encoderFailed = null;
  if (!encoder.ready && recording && fetch && process.env.EXPLAINROO_OFFLINE !== '1') {
    try {
      encoder = await installRecordEncoder({ log });
    } catch (e) {
      encoderFailed = String(e.message).split('\n').map((l) => l.trim()).find(Boolean);
    }
  }
  const fetchRecord = `${command} doctor --fetch${project ? ` ${projectWord(project.dir)}` : ' --record'}`;
  rows.push({
    name: 'playwright ffmpeg',
    state: !recording ? 'not needed' : encoder.ready ? 'ready' : 'missing',
    ok: encoder.ready || !recording,
    detail: !recording ? (encoder.ready ? `only "record" needs it. It is installed: ${encoder.file}` : `only "record" needs it, and it downloads it the first time. "${fetchRecord}" gets it now`)
      : encoder.ready ? `${encoder.file}, for the video of "record"`
      : `only "record" needs it. ${encoderFailed ? `The download failed: ${encoderFailed}` : `"${fetchRecord}" downloads it, and so does "record" the first time.`}`,
    fails: false,
  });

  let espeak = espeakVersion();
  // --fetch sets up a copy that needs no root, where apt-get and dpkg can.
  let copy = null;
  let failed = null;
  if (!espeak && fetch && needs.has('espeak-ng')) {
    try {
      copy = setupEspeak({ notice });
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      failed = e.message;
    }
    espeak = espeakVersion();
  }
  const espeakLanguages = Object.keys(LANGUAGES).filter((language) => phonemeProgram(language) === 'espeak-ng');
  some('espeak-ng', {
    found: espeak,
    ready: (languages) => `${espeak}, for Kokoro voices in ${names(languages)}${copy ? `. The copy without root is in ${copy.folder}, and ${copy.settings} names it` : ''}`,
    missing: (languages) => `needed for Kokoro voices in ${names(languages)}. ${failed ? `The copy without root could not be set up: ${failed}. ` : ''}${copy?.shadowed ? `The copy without root is in ${copy.folder}, but EXPLAINROO_ESPEAK in ${copy.shadowed} comes first. Remove it there. ` : ''}${espeakInstall()}${fetch || process.platform === 'win32' || !onPath('apt-get') || !onPath('dpkg') ? '' : ` On this computer, "${command} doctor --fetch${language !== null ? ` --language ${language}` : project ? ` ${projectWord(project.dir)}` : ''}" sets up such a copy by itself.`}`,
    notNeeded: `only needed for Kokoro voices in ${names(espeakLanguages)}`,
    fails: true,
  });
  for (const language of ['ja', 'zh']) {
    some(`misaki ${language}`, {
      found: misakiAvailable(language),
      ready: () => `Python with misaki, for Kokoro voices in ${names([language])}`,
      missing: () => misakiInstall(language),
      notNeeded: `only needed for Kokoro voices in ${names([language])}`,
      fails: true,
    });
  }

  if (fetch) {
    if (needs.has(MODEL_NAMES[TTS_MODEL])) await loadTTS({ log });
    for (const model of [ASR_MODEL, MULTILINGUAL_ASR_MODEL]) {
      const languages = needs.get(MODEL_NAMES[model]);
      if (languages) await loadASR({ log, language: languages[0] });
    }
  }
  const models = path.join(cacheRoot(), 'models');
  const has = (model) => fs.existsSync(path.join(models, model));
  const fetched = (model) => `not downloaded yet. "${again}" or the first voice run fetches it, ${downloadSize(model)}.`;
  some(MODEL_NAMES[TTS_MODEL], {
    found: has(TTS_MODEL),
    ready: () => `Kokoro 82M (${ttsDtype()}) in ${path.dirname(path.join(models, TTS_MODEL))}`,
    missing: () => fetched(TTS_MODEL),
    notNeeded: 'only needed for Kokoro voices',
  });
  some(MODEL_NAMES[ASR_MODEL], {
    found: has(ASR_MODEL),
    ready: () => 'Whisper base.en, for English narration',
    missing: () => fetched(ASR_MODEL),
    notNeeded: (installed) => `Whisper base.en checks only English narration, so this setup doesn't need it${installed ? '. It can stay installed' : ''}`,
  });
  some(MODEL_NAMES[MULTILINGUAL_ASR_MODEL], {
    found: has(MULTILINGUAL_ASR_MODEL),
    ready: (languages) => `Whisper small, for narration in ${names(languages)}`,
    missing: () => fetched(MULTILINGUAL_ASR_MODEL),
    notNeeded: 'only needed for narration in other languages than English',
  });
  rows.push({ name: 'keys file', ok: true, info: true, detail: `${settingsEnvFile()}; only needed for services that use your own key, and for settings like EXPLAINROO_ESPEAK that every command reads` });
  // Where this copy of explainroo is, for reading its engine/ and docs/, and its examples.
  rows.push({ name: 'runs from', ok: true, info: true, detail: ROOT });
  const examples = path.join(ROOT, 'examples');
  rows.push({ name: 'examples', ok: true, info: true, detail: fs.existsSync(examples) ? examples : `not in this copy; they are at ${EXAMPLES_URL}` });

  return {
    ok: rows.every((r) => r.ok || !r.fails),
    ...(copy ? { espeak_copy: copy } : {}),
    project: project ? project.dir : null,
    languages: language !== null ? setup.map((s) => s.language) : null,
    setup: setup.map(({ language, voice }) => ({ language, voice: voiceRoute(voice) })),
    checks: rows.map(({ fails, ...row }) => row),
  };
}

const ROUTE_WORDS = { kokoro: 'a Kokoro voice', recording: 'a recording' };

export function formatDoctor(r, command = selfCommand()) {
  const voices = r.setup.map(({ language, voice }) => `${LANGUAGE_NAMES[language]} with ${voice === null ? 'a paid voice or a recording, because Kokoro has no voice for it' : ROUTE_WORDS[voice] ?? voiceProviders()[voice].name}`);
  const lines = [r.project
    ? `For ${projectWord(r.project)}: ${allOf(voices)}.`
    : r.languages
      ? `For ${allOf(voices)}. Once the project exists, "${command} doctor <project>" checks what it needs.`
      : `For English narration with a Kokoro voice. "${command} doctor --language es" checks what another language needs, and "${command} doctor <project>" what a project needs.`];
  for (const row of r.checks.filter((c) => !c.info)) lines.push(`${row.state.padEnd(10)}  ${row.name.padEnd(18)}  ${row.detail}`);
  for (const row of r.checks.filter((c) => c.info)) lines.push(`${row.name}: ${row.detail}`);
  return lines.join('\n');
}
