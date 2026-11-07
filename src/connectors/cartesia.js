// Cartesia: Sonic voices on the user's own account. It reads everything between
// two pauses in one request, so the sentences flow into each other like speech.
// Whisper times the words, as it does for every voice.
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

// The API version every request names, and the model a voice uses without
// "model" in video.json. services.json gives the same model to video.json.
export const CARTESIA_VERSION = '2026-08-14';
export const CARTESIA_MODEL = 'sonic-3.6';

const SAMPLE_RATE = 24000;
const SPEED_RANGE = [0.6, 1.5];

// explainroo's language codes as Cartesia names them.
export function cartesiaLanguage(language) {
  return language === 'pt-br' ? 'pt-BR' : language;
}

function cartesiaSpeed(speed) {
  return Math.max(SPEED_RANGE[0], Math.min(SPEED_RANGE[1], speed));
}

function apiKey(dir) {
  const key = rememberSecret(findEnv('CARTESIA_API_KEY', dir));
  if (!key) throw new ProjectError(`Cartesia needs an API key. Ask the user for one from play.cartesia.ai/keys, then run "explainroo connect cartesia". You can also set CARTESIA_API_KEY or put CARTESIA_API_KEY=... in ${settingsEnvFile()}.`);
  return key;
}

function headers(key, json = false) {
  return { Authorization: `Bearer ${key}`, 'Cartesia-Version': CARTESIA_VERSION, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

// A 5xx gets one more try, which the docs for connectors allow, and a 429 means
// nothing was made yet. A dropped connection is never sent again.
async function speechRequest(url, key, body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(120000), headers: headers(key, true), body: JSON.stringify(body) });
    } catch (e) {
      throw new ServiceError('Cartesia did not answer. Check your connection and try again.', thrownOutcome(e));
    }
    if (res.ok) return res;
    const answer = await res.json().catch(() => null);
    const said = typeof answer?.message === 'string' ? answer.message : typeof answer?.error === 'string' ? answer.error : '';
    if (res.status === 401 || res.status === 403) throw new ServiceError('Cartesia rejected the API key. Ask the user to check CARTESIA_API_KEY.', 'refused');
    if (res.status === 402) throw new ServiceError('the Cartesia account has no credits left. Ask the user to check their plan.', 'refused');
    if (res.status === 404) throw new ServiceError('Cartesia could not find that voice id. Run "explainroo voices --provider cartesia" and check voice.id.', 'refused');
    if ((res.status === 429 && attempt < 2) || (res.status >= 500 && attempt < 1)) {
      await sleep(res.status === 429 ? 1000 * (attempt + 1) : 500);
      continue;
    }
    if (res.status === 429) throw new ServiceError('Cartesia is busy. Try again in a moment.', 'refused');
    if (res.status >= 500) throw new ServiceError('Cartesia answered with an error. Try again in a moment.', 'failed');
    throw new ServiceError(`Cartesia could not make the voice${said ? `: ${said.slice(0, 200)}` : ''}. Check voice.id and voice.model in video.json.`, 'refused');
  }
}

export function decodePCM(buffer) {
  const bytes = Buffer.from(buffer);
  if (!bytes.length || bytes.length % 2) throw new ServiceError('Cartesia returned unreadable audio. Try the voice command again.', 'failed');
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

async function speak(project, scene, text) {
  const key = apiKey(project.dir);
  const { voice, speed, pace, language } = project.config;
  const res = await speechRequest(`${serviceUrl(connector)}/tts/bytes`, key, {
    model_id: voice.model ?? CARTESIA_MODEL,
    transcript: text,
    voice: { id: voice.id },
    language: cartesiaLanguage(language),
    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
    generation_config: { speed: Math.round(cartesiaSpeed(speed * pace) * 1000) / 1000 },
  });
  let buffer;
  try { buffer = await res.arrayBuffer(); }
  catch { throw new ServiceError('Cartesia audio download failed. Check your connection and try again.', 'lost'); }
  return { audio: decodePCM(buffer), sampling_rate: SAMPLE_RATE };
}

// Reading the list is free, so it may go again.
async function read(url, key) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: headers(key) });
    } catch {
      if (attempt < 1) continue;
      throw new ProjectError('Cartesia did not answer. Check your connection and try again.');
    }
    if (res.ok) {
      try { return await res.json(); }
      catch { throw new ProjectError('Cartesia returned an unreadable voice list. Try again.'); }
    }
    if (res.status === 401 || res.status === 403) throw new ProjectError('Cartesia rejected the key. Check the key at play.cartesia.ai/keys.');
    if ((res.status === 429 || res.status >= 500) && attempt < 1) {
      await sleep(500);
      continue;
    }
    throw new ProjectError(`Cartesia answered with HTTP ${res.status}. Try again in a moment.`);
  }
}

// The voices the key can use, for one language with `language`.
async function voices(dir, { language } = {}) {
  const key = apiKey(dir);
  const list = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${serviceUrl(connector)}/voices`);
    url.searchParams.set('limit', '100');
    if (language) url.searchParams.set('language', cartesiaLanguage(language));
    if (after) url.searchParams.set('starting_after', after);
    const data = await read(url, key);
    if (!Array.isArray(data?.data)) throw new ProjectError('Cartesia returned an unreadable voice list. Try again.');
    for (const v of data.data) {
      const accent = (v.accents || []).find((a) => a.is_native) ?? v.accents?.[0];
      const labels = { ...(accent?.locale ? { accent: accent.locale } : {}), ...(v.gender ? { gender: v.gender } : {}), ...(v.is_owner ? { owner: 'you' } : {}) };
      list.push({ name: String(v.name ?? ''), id: String(v.id ?? ''), labels });
    }
    if (!data.has_more || !data.next_page) break;
    after = data.next_page;
  }
  return list;
}

// The voice list costs nothing, so this checks a key without spending anything.
async function test(key) {
  const url = new URL(`${serviceUrl(connector)}/voices`);
  url.searchParams.set('limit', '1');
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: headers(key) });
  } catch {
    throw new ProjectError('Cartesia did not answer, so the key could not be tested. Check your connection and try again.');
  }
  if (res.status === 401 || res.status === 403) throw new ProjectError('Cartesia rejected the key. Check the key at play.cartesia.ai/keys.');
  if (!res.ok) throw new ProjectError(`Cartesia answered with HTTP ${res.status}, so the key could not be tested. Try again in a moment.`);
}

const connector = {
  id: 'cartesia',
  name: 'Cartesia',
  baseUrl: 'https://api.cartesia.ai',
  key: apiKey,
  test,
  speak,
  speed: cartesiaSpeed,
  speedRange: SPEED_RANGE,
  // One request reads everything between two pauses, not one sentence.
  chunks: 'pauses',
  // Cartesia is told the language, so it is part of each request and its saved key.
  language: cartesiaLanguage,
  voices,
};

export default connector;
