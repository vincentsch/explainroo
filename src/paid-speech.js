// Paid speech is bought one request at a time, so it is saved one request at a
// time. Each response goes to history/voice/<key>.wav before it is transcribed
// and before the next purchase. The key is the provider, voice, model, speed and
// spoken text. Markers, shown text and neighbouring sentences are not part of it,
// so moving a marker buys nothing, and editing one sentence buys only that one.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError, ServiceError } from './errors.js';
import { createJob, decide, historyDir, jobKey, listAttempts, listJobs, projectWord, selfCommand, sha256File, shortId, stopSentence, unsettled, updateJob } from './history.js';
import { serviceUrl } from './services.js';
import { findConnector } from './connectors/index.js';
import { readWav, writeWav } from './wav.js';
import { langArg } from './project.js';

// The connector of a voice that is bought per request, or null for free voices.
export function speechConnector(config) {
  const connector = findConnector(config.voice.provider);
  return connector?.speak ? connector : null;
}

// A service that is told the language gets it in each request, and so in the key.
function speechRequest(paid, config, text) {
  return { provider: paid.id, voice: config.voice.id, model: config.voice.model ?? null, speed: paid.speed(config.speed * config.pace), ...(paid.language ? { language: paid.language(config.language) } : {}), text };
}

export function speechKey(paid, config, text) {
  return jobKey({ kind: 'speech', ...speechRequest(paid, config, text) });
}

// The characters of every request that was answered, for reporting what one run bought.
export function boughtCharacters(dir) {
  return listJobs(dir).filter((job) => job.kind === 'speech' && job.status === 'done' && !job.imported).reduce((n, job) => n + (job.characters || 0), 0);
}

function saveSpeech(dir, key, attempt, samples, sampleRate) {
  fs.mkdirSync(historyDir(dir, 'voice'), { recursive: true });
  const name = attempt > 1 ? `${key}.${attempt}.wav` : `${key}.wav`;
  const file = historyDir(dir, 'voice', name);
  const temp = `${file}.${process.pid}.tmp`;
  writeWav(temp, samples, sampleRate);
  fs.renameSync(temp, file);
  return { file: `history/voice/${name}`, sha256: sha256File(file), bytes: fs.statSync(file).size };
}

// Everything this run needs from the record. `force` buys every sentence again.
// `fresh` buys again only what has no good answer.
export function openSpeech(project, paid, { force = false, fresh = false, log = () => {}, notice = log } = {}) {
  const { dir, config } = project;
  const boughtNow = new Set();
  const keyOf = (text) => speechKey(paid, config, text);
  // A sentence of another language than the main one says so, for the command that continues it.
  const version = langArg(project) ? { lang: project.language } : {};

  const decision = (key) => {
    if (boughtNow.has(key)) return decide(dir, key);
    return decide(dir, key, { fresh: force || (fresh && unsettled(dir, key)) });
  };

  const stopMessage = (stuck) => {
    const lines = stuck.map(({ job, reason, scene, text }) => `  ${shortId(job)} in scene ${scene}: "${text.slice(0, 60)}"\n    ${stopSentence(job, reason)}`);
    const command = `${selfCommand()} voice ${projectWord(dir)}${langArg(project)} --new`;
    const check = stuck.some((s) => s.reason === 'unknown' || s.reason === 'lost')
      ? `\nTo check, run "${selfCommand()} history ${projectWord(dir)}" again in a few minutes: a run that is still working saves its answer by then. Your ${paid.name} account shows what was charged.`
      : '';
    return `the voice stopped, and nothing more was bought. ${stuck.length === 1 ? '1 paid sentence has' : `${stuck.length} paid sentences have`} no usable saved speech:\n${lines.join('\n')}${check}\nTo buy only ${stuck.length === 1 ? 'that sentence' : 'those sentences'} again, run: ${command}`;
  };

  return {
    // Whether a scene that looks finished still has a request to settle.
    needsNew: (chunks) => fresh && chunks.some((chunk) => unsettled(dir, keyOf(chunk.text))),

    knows: (text) => listAttempts(dir, keyOf(text)).length > 0,

    // Before anything is bought: stop on every unclear request at once, make
    // sure there is a key, and say what --force is about to buy.
    check(todo) {
      const seen = new Set();
      const stuck = [];
      const buys = [];
      for (const { scene, chunks } of todo) {
        for (const chunk of chunks) {
          const key = keyOf(chunk.text);
          if (seen.has(key)) continue;
          seen.add(key);
          const d = decision(key);
          if (d.action === 'stop') stuck.push({ job: d.job, reason: d.reason, scene: scene.id, text: chunk.text });
          if (d.action === 'buy') buys.push(chunk.text);
        }
      }
      if (stuck.length) throw new ProjectError(stopMessage(stuck));
      if (buys.length) {
        paid.key(dir);
        serviceUrl(paid);
      }
      if (force && buys.length) {
        const characters = buys.reduce((n, text) => n + [...text].length, 0);
        notice(`voice --force makes every scene again. With ${paid.name} this buys ${buys.length} sentence${buys.length === 1 ? '' : 's'} again (${characters} characters) on your account. Earlier takes stay in history/.`);
      }
    },

    // Returns the audio of one request, from the record or by buying it now.
    async get(sceneId, chunks, index) {
      const { text } = chunks[index];
      const key = keyOf(text);
      const d = decision(key);
      if (d.action === 'stop') throw new ProjectError(stopMessage([{ job: d.job, reason: d.reason, scene: sceneId, text }]));
      let file = d.file;
      if (d.action === 'use' && d.newer) log(`voice ${sceneId}: a newer try of "${text.slice(0, 40)}" has no good answer, so this uses the earlier take`);
      if (d.action === 'buy') {
        let job;
        try {
          job = createJob(dir, key, { kind: 'speech', provider: paid.id, attempt: d.attempt, scene: sceneId, characters: [...text].length, ...version, request: speechRequest(paid, config, text) });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          throw new ProjectError(stopMessage([{ job: listAttempts(dir, key).find((a) => a.attempt === d.attempt), reason: 'unknown', scene: sceneId, text }]));
        }
        try {
          const audio = await paid.speak(project, sceneId, text, { previous: chunks[index - 1]?.text, next: chunks[index + 1]?.text });
          const output = saveSpeech(dir, key, d.attempt, audio.audio, audio.sampling_rate);
          updateJob(dir, job, { status: 'done', output });
          file = output.file;
          boughtNow.add(key);
        } catch (e) {
          const outcome = e instanceof ServiceError ? e.outcome : 'lost';
          updateJob(dir, job, { status: outcome, error: e.message });
          if (outcome === 'refused') throw e;
          throw new ServiceError(`${e.message.replace(/\.$/, '')}. That request may have cost money, so it is not sent again by itself. To buy it again, run: ${selfCommand()} voice ${projectWord(dir)}${langArg(project)} --new`, outcome);
        }
      }
      // A scene is built from the saved file every time, so a rebuild gives the
      // same result as the run that bought the speech.
      const { samples, sampleRate } = readWav(path.join(dir, file));
      return { audio: samples, sampling_rate: sampleRate };
    },

    // Adds a request the record does not know yet, from a finished scene.
    add(sceneId, text, samples, sampleRate) {
      const key = keyOf(text);
      const output = saveSpeech(dir, key, 1, samples, sampleRate);
      try {
        createJob(dir, key, { kind: 'speech', provider: paid.id, status: 'done', imported: true, scene: sceneId, characters: [...text].length, ...version, output, request: speechRequest(paid, config, text) });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    },
  };
}
