// Edge: the neural voices of Microsoft Edge's read-aloud, through the edge-tts
// Python package. It needs no key and costs nothing, but the narration text goes
// to Microsoft. It speaks many languages explainroo has no Kokoro voice for,
// like Thai. edge-tts follows the changes Microsoft makes to that service, so
// explainroo runs it instead of speaking to the service itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { ProjectError, ServiceError } from '../errors.js';
import { ffmpeg } from '../ffmpeg.js';
import { readWav } from '../wav.js';

const SAMPLE_RATE = 24000;
const SPEED_RANGE = [0.5, 2];
const ATTEMPTS = 5;

function python() {
  return process.env.EXPLAINROO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const INSTALL = () => `Edge voices need Python with the edge-tts package. Run: ${python()} -m pip install edge-tts. Or set EXPLAINROO_PYTHON to a Python that has it.`;

function edgeSpeed(speed) {
  return Math.max(SPEED_RANGE[0], Math.min(SPEED_RANGE[1], speed));
}

// edge-tts takes the speed as a change in percent, like "+10%" or "-20%".
export function edgeRate(speed) {
  const percent = Math.round((edgeSpeed(speed) - 1) * 100);
  return `${percent < 0 ? '-' : '+'}${Math.abs(percent)}%`;
}

// Runs Python and returns what it printed. Nothing is bought, so a failure is
// "refused": the same command may simply try again.
function runPython(args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(python(), args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    } catch {
      reject(new ServiceError(INSTALL(), 'refused'));
      return;
    }
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', () => {
      clearTimeout(timer);
      reject(new ServiceError(INSTALL(), 'refused'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const said = Buffer.concat(err).toString('utf8');
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      if (/No module named ['"]?edge_tts/.test(said)) return reject(new ServiceError(INSTALL(), 'refused'));
      const line = said.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
      reject(new ServiceError(`Edge could not make the voice${line ? `: ${line.slice(0, 200)}` : ''}. Check your connection and voice.id, then run voice again.`, 'refused'));
    });
  });
}

async function speak(project, scene, text) {
  const { voice, speed, pace } = project.config;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-edge-'));
  try {
    const input = path.join(dir, 'text.txt');
    const mp3 = path.join(dir, 'speech.mp3');
    const wav = path.join(dir, 'speech.wav');
    fs.writeFileSync(input, text, 'utf8');
    // The service now and then sends no audio for a text it reads fine a few
    // seconds later. It is free, so another try costs nothing.
    for (let attempt = 1; ; attempt++) {
      try {
        await runPython(['-m', 'edge_tts', '--voice', voice.id, `--rate=${edgeRate(speed * pace)}`, '--file', input, '--write-media', mp3]);
        break;
      } catch (e) {
        const again = /NoAudioReceived|WSServerHandshakeError|ClientConnector|TimeoutError/.test(e.message);
        if (again && attempt >= ATTEMPTS && /NoAudioReceived/.test(e.message)) {
          throw new ServiceError(`Edge sent no audio for "${text.slice(0, 60)}" in ${ATTEMPTS} tries. A voice of the service sometimes refuses texts that another voice reads, like th-TH-PremwadeeNeural where th-TH-NiwatNeural works. Try another voice.id ("explainroo voices --provider edge --language ${project.config.language}"), or wait a few minutes, then run voice again.`, 'refused');
        }
        if (!again || attempt >= ATTEMPTS) throw e;
        await sleep(2000 * attempt);
      }
    }
    if (!fs.existsSync(mp3) || !fs.statSync(mp3).size) throw new ServiceError('Edge returned no audio. Check voice.id with "explainroo voices --provider edge", then run voice again.', 'refused');
    await ffmpeg(['-loglevel', 'error', '-i', mp3, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wav]);
    const { samples, sampleRate } = readWav(wav);
    return { audio: samples, sampling_rate: sampleRate };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// explainroo's language codes as the start of Edge's locales.
const LOCALE = { en: 'en-', es: 'es-', fr: 'fr-', it: 'it-', 'pt-br': 'pt-BR', hi: 'hi-', ja: 'ja-', zh: 'zh-CN', de: 'de-', th: 'th-' };

const LIST = 'import asyncio, json, edge_tts\nprint(json.dumps(asyncio.run(edge_tts.list_voices())))';

async function voices(dir, { language } = {}) {
  let list;
  try {
    list = JSON.parse(await runPython(['-c', LIST], { timeout: 30000 }));
  } catch (e) {
    throw new ProjectError(e instanceof ServiceError ? e.message : 'Edge returned an unreadable voice list. Try again.');
  }
  if (!Array.isArray(list)) throw new ProjectError('Edge returned an unreadable voice list. Try again.');
  const prefix = language ? LOCALE[language] : null;
  return list
    .filter((v) => !prefix || String(v.Locale ?? '').startsWith(prefix))
    .map((v) => ({ name: String(v.FriendlyName ?? v.ShortName ?? ''), id: String(v.ShortName ?? ''), labels: { accent: String(v.Locale ?? ''), ...(v.Gender ? { gender: String(v.Gender).toLowerCase() } : {}) } }));
}

const connector = {
  id: 'edge',
  name: 'Edge',
  baseUrl: 'https://speech.platform.bing.com',
  // No key: Edge's read-aloud is free.
  key: () => null,
  async test() {},
  speak,
  speed: edgeSpeed,
  speedRange: SPEED_RANGE,
  // One request reads everything between two pauses, so the sentences flow.
  chunks: 'pauses',
  voices,
};

export default connector;
