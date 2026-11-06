// Optional illustrations through MiniAPI (api.minicut.ai). Needs MINIAPI_KEY in the
// environment or in a .env file in the project folder or the explainroo folder.
// A job goes into the queue, its status is read until it ends, and the finished
// picture is downloaded from the link in the result.
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv } from './env.js';
import { ProjectError } from './project.js';

export const MINIAPI_QUEUE = 'https://api.minicut.ai/v1/queue';

// The same two models as the OpenRouter route.
export const MINIAPI_MODELS = {
  best: 'gpt-image-2',
  cheap: 'nano-banana-2',
};

// GPT Image 2 takes a named size, or a width and height. The other models take the aspect ratio as it is.
const GPT_IMAGE_SIZES = {
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '3:2': { width: 1536, height: 1024 },
  '2:3': { width: 1024, height: 1536 },
};

export function findMiniapiKey(projectDir) {
  return findEnv('MINIAPI_KEY', projectDir);
}

export function resolveMiniapiModel(name) {
  if (!name) return MINIAPI_MODELS.best;
  if (MINIAPI_MODELS[name]) return MINIAPI_MODELS[name];
  if (/^[a-z0-9][a-z0-9.-]*$/.test(name)) return name;
  throw new ProjectError(`image model must be "best", "cheap" or a MiniAPI model id like ${MINIAPI_MODELS.best} (see https://api.minicut.ai/models?utm_source=vincentsch-explainroo&utm_medium=repo-pr)`);
}

export function miniapiBody(model, prompt, aspect) {
  if (model === MINIAPI_MODELS.best) return { prompt, image_size: GPT_IMAGE_SIZES[aspect] };
  return { prompt, aspect_ratio: aspect };
}

function errorText(res, json) {
  if (Array.isArray(json?.detail)) return json.detail.map((d) => `${(d.loc || []).slice(1).join('.')} ${d.msg}`.trim()).join('; ');
  return json?.error?.message || (typeof json?.detail === 'string' ? json.detail : '') || `HTTP ${res.status}`;
}

function failure(res, json) {
  const msg = errorText(res, json);
  if (res.status === 401 || res.status === 403) return new ProjectError(`MiniAPI rejected the API key (${msg}). Ask the user to check it.`);
  if (res.status === 402) return new ProjectError(`the MiniAPI balance does not cover this image (${msg}).`);
  if (res.status === 404) return new ProjectError(`MiniAPI has no model with that id (${msg}). See https://api.minicut.ai/models?utm_source=vincentsch-explainroo&utm_medium=repo-pr`);
  if (res.status === 422) return new ProjectError(`MiniAPI could not make this image: ${msg}`);
  return new Error(`MiniAPI error: ${msg}`);
}

async function send(url, key, deadline, options = {}) {
  const headers = { Authorization: `Key ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  try {
    const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    return { res, json: await res.json().catch(() => null) };
  } catch (error) {
    return { error };
  }
}

function reason(error) {
  return error.name === 'TimeoutError' || error.name === 'AbortError' ? 'no answer after 5 minutes' : error.message;
}

// Makes one image and returns its bytes, type and price. `pollMs` is the wait between status reads.
export async function miniapiImage({ key, model, prompt, aspect, log = () => {}, pollMs = 2000 }) {
  const deadline = Date.now() + 300000;
  const base = `${MINIAPI_QUEUE}/${encodeURIComponent(model)}`;
  // A second try with the same key returns the first job, so a retry never pays twice.
  const idempotencyKey = crypto.randomUUID();
  let job;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await send(base, key, deadline, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(miniapiBody(model, prompt, aspect)),
    });
    if (r.error) {
      if (attempt === 2) throw new Error(`MiniAPI request failed: ${reason(r.error)}`);
      log('MiniAPI did not answer, trying once more');
      continue;
    }
    if (r.res.status >= 500 && attempt === 1) {
      log(`MiniAPI returned ${r.res.status}, trying once more`);
      continue;
    }
    if (!r.res.ok) throw failure(r.res, r.json);
    job = r.json;
    break;
  }
  const id = job?.request_id;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('MiniAPI returned no request id');
  const jobUrl = `${base}/requests/${id}`;

  for (;;) {
    const r = await send(`${jobUrl}/status`, key, deadline);
    if (r.res && !r.res.ok && r.res.status !== 429 && r.res.status < 500) throw failure(r.res, r.json);
    const status = r.res?.ok ? r.json : null;
    if (status?.error) {
      const said = status.error.message ? `: ${status.error.message}` : '';
      throw new ProjectError(`MiniAPI could not make this image (${status.error.code}${said}). Failed jobs are not charged. Try another wording or the other model.`);
    }
    if (status?.status === 'COMPLETED') break;
    if (Date.now() + pollMs >= deadline) throw new Error(`MiniAPI request ${id} did not finish within 5 minutes`);
    await sleep(pollMs);
  }

  const r = await send(jobUrl, key, deadline);
  if (r.error) throw new Error(`MiniAPI request failed: ${reason(r.error)}`);
  if (!r.res.ok) throw failure(r.res, r.json);
  const file = r.json?.images?.[0];
  if (typeof file?.url !== 'string' || !file.url.startsWith('https://')) throw new Error('MiniAPI returned no image');
  let img;
  try {
    img = await fetch(file.url, { signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
  } catch (error) {
    throw new Error(`downloading the MiniAPI image failed: ${reason(error)}`);
  }
  if (!img.ok) throw new Error(`downloading the MiniAPI image failed (HTTP ${img.status})`);
  const buf = Buffer.from(await img.arrayBuffer());
  const price = Number(r.json?.billing?.price ?? job.price);
  return {
    buf,
    mime: file.content_type || img.headers.get('content-type') || 'image/png',
    cost_usd: Number.isFinite(price) ? price : null,
    request_id: id,
  };
}
