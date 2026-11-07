// explainroo doctor: whether this computer has what a setup needs. Every part is
// "ready", "not needed" or "missing". Whether the setup needs a part decides first,
// so a part it doesn't need is "not needed" also when it is there. Without a
// project the setup is English with a Kokoro voice. With one, it is each language
// of the project with the voice that language uses.
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from './browser.js';
import { settingsEnvFile } from './env.js';
import { ffmpegVersion } from './ffmpeg.js';
import { projectWord, selfCommand } from './history.js';
import { ASR_MODEL, asrModel, cacheRoot, downloadSize, LANGUAGE_NAMES, LANGUAGES, loadASR, loadTTS, MODEL_NAMES, MULTILINGUAL_ASR_MODEL, TTS_MODEL, ttsDtype } from './models.js';
import { espeakInstall, espeakVersion, misakiAvailable, misakiInstall, phonemeProgram } from './phonemes.js';
import { normalizeConfig } from './project.js';
import { allOf, voiceProviders } from './services.js';

export const DEFAULT_SETUP = [{ language: 'en', voice: LANGUAGES.en }];

// Each language of a project with the voice it uses.
export function projectSetup(project) {
  const raw = JSON.parse(fs.readFileSync(path.join(project.dir, 'video.json'), 'utf8'));
  return project.languages.map((language) => ({
    language,
    voice: language === project.language ? project.config.voice : normalizeConfig(raw, project.dir, { language }).voice,
  }));
}

// "kokoro" for a Kokoro voice, otherwise the provider of the voice.
function voiceRoute(voice) {
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

// `project` is a loaded project, or null for the default setup. Only `fetch`
// downloads anything, and it fetches the English models.
export async function doctor({ project = null, fetch = false, log = () => {} } = {}) {
  const setup = project ? projectSetup(project) : DEFAULT_SETUP;
  const needs = setupNeeds(setup);
  const command = selfCommand();
  const rows = [];
  // A part that every setup needs.
  const always = (name, found, ready, missing) => rows.push({ name, state: found ? 'ready' : 'missing', ok: !!found, detail: found ? ready : missing, fails: true });
  // A part that only some setups need. The parts explainroo can't get by itself fail the exit code.
  const some = (name, { found, ready, missing, notNeeded, fails = false }) => {
    const languages = needs.get(name);
    const state = !languages ? 'not needed' : found ? 'ready' : 'missing';
    const detail = state === 'ready' ? ready(languages) : state === 'missing' ? missing(languages) : `${notNeeded}${found ? '. It is installed.' : ''}`;
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

  const espeak = espeakVersion();
  const espeakLanguages = Object.keys(LANGUAGES).filter((language) => phonemeProgram(language) === 'espeak-ng');
  some('espeak-ng', {
    found: espeak,
    ready: (languages) => `${espeak}, for Kokoro voices in ${names(languages)}`,
    missing: (languages) => `needed for Kokoro voices in ${names(languages)}. ${espeakInstall()}`,
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
    await loadTTS({ log });
    await loadASR({ log });
  }
  const models = path.join(cacheRoot(), 'models');
  const has = (model) => fs.existsSync(path.join(models, model));
  const fetched = (model) => `not downloaded yet. "${command} doctor --fetch" or the first voice run fetches it, ${downloadSize(model)}.`;
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
    notNeeded: 'only needed for English narration',
  });
  some(MODEL_NAMES[MULTILINGUAL_ASR_MODEL], {
    found: has(MULTILINGUAL_ASR_MODEL),
    ready: (languages) => `Whisper small, for narration in ${names(languages)}`,
    missing: () => `not downloaded yet. The first voice run of this project downloads it, ${downloadSize(MULTILINGUAL_ASR_MODEL)}.`,
    notNeeded: 'only needed for narration in other languages than English',
  });
  rows.push({ name: 'keys file', ok: true, info: true, detail: `${settingsEnvFile()}; only needed for services that use your own key` });

  return {
    ok: rows.every((r) => r.ok || !r.fails),
    project: project ? project.dir : null,
    setup: setup.map(({ language, voice }) => ({ language, voice: voiceRoute(voice) })),
    checks: rows.map(({ fails, ...row }) => row),
  };
}

const ROUTE_WORDS = { kokoro: 'a Kokoro voice', recording: 'a recording' };

export function formatDoctor(r, command = selfCommand()) {
  const voices = r.setup.map(({ language, voice }) => `${LANGUAGE_NAMES[language]} with ${ROUTE_WORDS[voice] ?? voiceProviders()[voice].name}`);
  const lines = [r.project
    ? `For ${projectWord(r.project)}: ${allOf(voices)}.`
    : `For English narration with a Kokoro voice. "${command} doctor <project>" checks what a project needs.`];
  for (const row of r.checks.filter((c) => !c.info)) lines.push(`${row.state.padEnd(10)}  ${row.name.padEnd(18)}  ${row.detail}`);
  for (const row of r.checks.filter((c) => c.info)) lines.push(`${row.name}: ${row.detail}`);
  return lines.join('\n');
}
