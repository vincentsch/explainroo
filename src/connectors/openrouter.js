// OpenRouter: AI models on the user's own account, used here for illustrations
// and video clips.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

function findKey(dir) {
  return rememberSecret(findEnv('OPENROUTER_API_KEY', dir));
}

function apiKey(dir) {
  const key = findKey(dir);
  if (!key) throw new ProjectError(`images and clips need an OpenRouter API key. Ask the user for one (openrouter.ai/keys), then run "explainroo connect openrouter". You can also set OPENROUTER_API_KEY or put OPENROUTER_API_KEY=... in ${settingsEnvFile()}.`);
  return key;
}

// Sends one paid request. A clear 5xx answer gets one more try. A request with
// no answer never does, because the first one may have been charged.
async function post(key, body, { log, timeout }) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    let text;
    try {
      res = await fetch(`${serviceUrl(connector)}/api/v1/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://explainroo.com',
          'X-Title': 'explainroo',
        },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (e) {
      if (e.name === 'AbortError') throw new ServiceError(`OpenRouter did not answer in ${Math.round(timeout / 60000)} minutes`, 'lost');
      const outcome = thrownOutcome(e);
      throw new ServiceError(outcome === 'refused' ? 'could not reach OpenRouter. Check your connection and try again' : 'the connection to OpenRouter dropped before the answer came', outcome);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500 && attempt === 1) {
      log(`OpenRouter returned ${res.status}, trying once more`);
      continue;
    }
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { res, json };
  }
}

// An answer that is no result. A bad request or a rejected key can't have cost
// anything, and an error from the service after that may have.
function failure(res, json) {
  const said = json?.error?.message || (typeof json?.error === 'string' && json.error) || `HTTP ${res.status}`;
  if (res.status === 401) return new ServiceError(`OpenRouter rejected the API key (${said}). Ask the user to check it.`, 'refused');
  if (res.status === 402) return new ServiceError(`the OpenRouter account has no credit left (${said}).`, 'refused');
  return new ServiceError(`OpenRouter error: ${said}`, res.status === 408 || res.status >= 500 ? 'failed' : 'refused');
}

// Asks for one image. Returns its bytes and what it cost.
async function image(dir, { model, text, refs = [], aspect }, { log = () => {}, timeout = 300000 } = {}) {
  const { res, json } = await post(apiKey(dir), {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text }, ...refs.map((url) => ({ type: 'image_url', image_url: { url } }))] }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: aspect },
    usage: { include: true },
  }, { log, timeout });
  const usage = json?.usage || {};
  const cost_usd = typeof usage.cost === 'number' ? usage.cost : null;
  if (!res.ok) throw failure(res, json);
  const message = json?.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url;
  const [, mime, b64] = /^data:([^;]+);base64,(.*)$/s.exec(typeof url === 'string' ? url : '') || [];
  if (!b64) {
    const said = typeof message?.content === 'string' ? message.content.slice(0, 300) : '';
    throw new ServiceError(`the model returned no image${said ? `. It said: "${said}"` : ''}. Try another wording or the other model.`, 'failed', { cost_usd });
  }
  return {
    bytes: Buffer.from(b64, 'base64'),
    ext: mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png',
    cost_usd,
    served_by: json.model || model,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
  };
}

// The address of the list of video models with their prices.
function videoModelsUrl() {
  return `${serviceUrl(connector)}/api/v1/videos/models`;
}

// The list of video models with their prices. It is public, so this sends no key.
async function videoModels({ timeout = 30000 } = {}) {
  let res;
  let json = null;
  try {
    res = await fetch(videoModelsUrl(), { signal: AbortSignal.timeout(timeout) });
    if (res.ok) json = await res.json();
  } catch {
    throw new ProjectError('could not read the list of video models from OpenRouter. Check your connection and try again. Nothing was spent.');
  }
  if (!Array.isArray(json?.data)) throw new ProjectError(`OpenRouter's list of video models answered with HTTP ${res.status} and no list. Try again in a moment. Nothing was spent.`);
  return json.data;
}

// Starts one paid video job, and answers with its id. The service has no way to
// spot a repeat, so this request is never sent again here, whatever happens.
async function startVideo(dir, body, { timeout = 120000 } = {}) {
  const key = apiKey(dir);
  let res;
  let text;
  try {
    res = await fetch(`${serviceUrl(connector)}/api/v1/videos`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://explainroo.com', 'X-Title': 'explainroo' },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (e) {
    if (e.name === 'TimeoutError') throw new ServiceError(`OpenRouter did not answer in ${Math.round(timeout / 60000)} minutes`, 'lost');
    const outcome = thrownOutcome(e);
    throw new ServiceError(outcome === 'refused' ? 'could not reach OpenRouter. Check your connection and try again' : 'the connection to OpenRouter dropped before the answer came', outcome);
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw failure(res, json);
  if (!json?.id) throw new ServiceError('OpenRouter accepted the request and gave no job id', 'failed');
  return { id: String(json.id) };
}

// A read that costs nothing. The address comes from here and the job id, and never
// from an answer or a job file, because the key goes along with it. The outcome
// says what a problem means: "later" is worth another try, "gone" is not.
async function readVideo(dir, id, suffix, timeout) {
  const key = apiKey(dir);
  let res;
  try {
    res = await fetch(`${serviceUrl(connector)}/api/v1/videos/${encodeURIComponent(id)}${suffix}`, { signal: AbortSignal.timeout(timeout), headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new ServiceError('OpenRouter did not answer', 'later');
  }
  if (res.status === 401 || res.status === 403) throw new ProjectError(`OpenRouter rejected the API key (HTTP ${res.status}), so the job could not be read. Ask the user to check it. Nothing more was bought.`);
  if (res.status === 404 || res.status === 410) throw new ServiceError(`OpenRouter no longer has it (HTTP ${res.status})`, 'gone');
  if (!res.ok) throw new ServiceError(`OpenRouter answered with HTTP ${res.status}`, 'later');
  return res;
}

// What a job is doing now, and what it cost once that is known.
async function videoStatus(dir, id, { timeout = 60000 } = {}) {
  const res = await readVideo(dir, id, '', timeout);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ServiceError('OpenRouter sent an answer that could not be read', 'later');
  }
  const error = typeof json?.error === 'string' ? json.error : json?.error?.message;
  return { status: String(json?.status), cost_usd: typeof json?.usage?.cost === 'number' ? json.usage.cost : null, error: error ? String(error).slice(0, 300) : null };
}

// Writes a finished clip to `file`. A partial file doesn't stay behind.
async function downloadVideo(dir, id, file, { timeout = 300000 } = {}) {
  const res = await readVideo(dir, id, '/content?index=0', timeout);
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  } catch {
    fs.rmSync(file, { force: true });
    throw new ServiceError('the download from OpenRouter stopped partway', 'later');
  }
}

// Reading the key's own details is free, so this checks a key without spending.
async function test(key) {
  let res;
  try {
    res = await fetch(`${serviceUrl(connector)}/api/v1/key`, { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new ProjectError('OpenRouter did not answer, so the key could not be tested. Check your connection and try again.');
  }
  if (res.status === 401 || res.status === 403) throw new ProjectError('OpenRouter rejected the key. Check that you copied all of it.');
  if (!res.ok) throw new ProjectError(`OpenRouter answered with HTTP ${res.status}, so the key could not be tested. Try again in a moment.`);
}

const connector = {
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai',
  findKey,
  key: apiKey,
  test,
  image,
  videoModelsUrl,
  videoModels,
  startVideo,
  videoStatus,
  downloadVideo,
};

export default connector;
