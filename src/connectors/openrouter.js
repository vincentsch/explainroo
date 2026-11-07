// OpenRouter: AI models on the user's own account, used here for illustrations.
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

function findKey(dir) {
  return rememberSecret(findEnv('OPENROUTER_API_KEY', dir));
}

function apiKey(dir) {
  const key = findKey(dir);
  if (!key) throw new ProjectError(`images need an OpenRouter API key. Ask the user for one (openrouter.ai/keys), then run "explainroo connect openrouter". You can also set OPENROUTER_API_KEY or put OPENROUTER_API_KEY=... in ${settingsEnvFile()}.`);
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
  if (!res.ok) {
    const said = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new ServiceError(`OpenRouter rejected the API key (${said}). Ask the user to check it.`, 'refused');
    if (res.status === 402) throw new ServiceError(`the OpenRouter account has no credit left (${said}).`, 'refused');
    throw new ServiceError(`OpenRouter error: ${said}`, res.status === 408 || res.status >= 500 ? 'failed' : 'refused');
  }
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
};

export default connector;
