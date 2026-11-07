// ElevenLabs: speech on the user's own account.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

const SPEED_RANGE = [0.7, 1.2];

export function elevenSpeed(speed) {
  return Math.max(SPEED_RANGE[0], Math.min(SPEED_RANGE[1], speed));
}

function apiKey(dir) {
  const key = rememberSecret(findEnv('ELEVENLABS_API_KEY', dir));
  if (!key) throw new ProjectError(`ElevenLabs needs an API key. Ask the user for one from elevenlabs.io, then run "explainroo connect elevenlabs". You can also set ELEVENLABS_API_KEY or put ELEVENLABS_API_KEY=... in ${settingsEnvFile()}.`);
  return key;
}

async function request(url, key, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(120000), headers: { 'xi-api-key': key, 'Content-Type': 'application/json' } });
    } catch (e) {
      throw new ServiceError('ElevenLabs did not answer. Check your connection and try again.', thrownOutcome(e));
    }
    if (res.ok) return res;
    const body = await res.json().catch(() => null);
    const status = body?.detail?.status;
    if (status === 'quota_exceeded' || res.status === 402) throw new ServiceError('the ElevenLabs account has no characters left. Ask the user to check their plan.', 'refused');
    if (status === 'voice_not_found' || res.status === 404) throw new ServiceError('ElevenLabs could not find that voice id. Run "explainroo voices --elevenlabs" and check voice.id.', 'refused');
    if (res.status === 401 || res.status === 403) throw new ServiceError('ElevenLabs rejected the API key. Ask the user to check the key and its permissions.', 'refused');
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(250 * 2 ** attempt);
      continue;
    }
    throw res.status === 429 || res.status >= 500
      ? new ServiceError('ElevenLabs is busy. Try again in a moment.', res.status === 429 ? 'refused' : 'failed')
      : new ServiceError('ElevenLabs could not make the voice. Check voice.id and voice.model in video.json.', 'refused');
  }
}

export function decodePCM(buffer) {
  const bytes = Buffer.from(buffer);
  if (!bytes.length || bytes.length % 2) throw new ServiceError('ElevenLabs returned unreadable audio. Try the voice command again.', 'failed');
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

export function elevenUsage(project) {
  const file = path.join(project.paths.voice, 'elevenlabs-usage.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

export async function elevenSpeech(project, scene, text, { previous, next } = {}) {
  const key = apiKey(project.dir);
  const { voice, speed, pace } = project.config;
  const res = await request(`${serviceUrl(connector)}/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=pcm_24000`, key, {
    method: 'POST',
    // Without voice_settings ElevenLabs uses the voice's own saved settings.
    body: JSON.stringify({ text, model_id: voice.model, ...(elevenSpeed(speed * pace) !== 1 ? { voice_settings: { speed: elevenSpeed(speed * pace) } } : {}),
      ...(previous && voice.model !== 'eleven_v3' ? { previous_text: previous } : {}), ...(next && voice.model !== 'eleven_v3' ? { next_text: next } : {}) }),
  });
  const entry = { time: new Date().toISOString(), scene, characters: [...text].length, model: voice.model, voice_id: voice.id };
  fs.mkdirSync(project.paths.voice, { recursive: true });
  fs.appendFileSync(path.join(project.paths.voice, 'elevenlabs-usage.jsonl'), JSON.stringify(entry) + '\n');
  let buffer;
  try { buffer = await res.arrayBuffer(); }
  catch { throw new ServiceError('ElevenLabs audio download failed. Check your connection and try again.', 'lost'); }
  return { audio: decodePCM(buffer), sampling_rate: 24000 };
}

export async function elevenVoices(dir) {
  const key = apiKey(dir);
  const voices = [];
  let token;
  do {
    const url = new URL(`${serviceUrl(connector)}/v2/voices`);
    url.searchParams.set('page_size', '100');
    if (token) url.searchParams.set('next_page_token', token);
    let data;
    try { data = await (await request(url, key)).json(); }
    catch (e) {
      if (e instanceof ProjectError) throw e;
      throw new ProjectError('ElevenLabs returned an unreadable voice list. Try again.');
    }
    voices.push(...data.voices.map((v) => ({ name: v.name, id: v.voice_id, labels: v.labels || {} })));
    token = data.has_more ? data.next_page_token : null;
  } while (token);
  return voices;
}

// The voice list is free, so this checks a key without spending anything.
async function test(key) {
  const url = new URL(`${serviceUrl(connector)}/v2/voices`);
  url.searchParams.set('page_size', '1');
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'xi-api-key': key } });
  } catch {
    throw new ProjectError('ElevenLabs did not answer, so the key could not be tested. Check your connection and try again.');
  }
  if (res.status === 401 || res.status === 403) throw new ProjectError('ElevenLabs rejected the key. Check the key, and that it may read voices.');
  if (!res.ok) throw new ProjectError(`ElevenLabs answered with HTTP ${res.status}, so the key could not be tested. Try again in a moment.`);
}

const connector = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  baseUrl: 'https://api.elevenlabs.io',
  key: apiKey,
  test,
  speak: elevenSpeech,
  speed: elevenSpeed,
  speedRange: SPEED_RANGE,
  voices: elevenVoices,
};

export default connector;
