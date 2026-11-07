// The hosted service at explainroo.com, which gives a finished video a page link.
// Only "explainroo share" sends anything to it.
//
//   POST {EXPLAINROO_CLOUD_URL}/api/v1/shares
//   multipart form: video (the file), title
//   optional header: Authorization: Bearer <EXPLAINROO_CLOUD_KEY>
//   answer: 201 with { id, url, media_url, expires_at, claim_url }
import fs from 'node:fs';
import path from 'node:path';
import { findEnv } from '../env.js';
import { ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

export const SHARE_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm' };

// A key from an account is optional. Without one, the link expires.
function key(dir) {
  return rememberSecret(findEnv('EXPLAINROO_CLOUD_KEY', dir));
}

// The server checks the file before it answers, so this is generous: ten minutes,
// plus a second for every 100 KB on its way up.
function timeout(bytes) {
  return Number(process.env.EXPLAINROO_SHARE_TIMEOUT_MS) || 10 * 60 * 1000 + Math.ceil(bytes / 100000) * 1000;
}

// What a request that threw means. A refused connection or an unknown name means
// that nothing was sent. Anything after that may have reached the server.
export function failedRequest(error) {
  if (error?.name === 'TimeoutError') return 'timeout';
  return thrownOutcome(error) === 'refused' ? 'unreachable' : 'dropped';
}

function link(value) {
  if (typeof value !== 'string') return null;
  try {
    return /^https?:$/.test(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}

// The answer, or null when it is no share: an HTML page, or JSON without a link.
export function shareAnswer(json) {
  const url = link(json?.url);
  if (!url) return null;
  const expires = json.expires_at;
  return {
    id: json.id === undefined || json.id === null ? null : String(json.id),
    url,
    media_url: link(json.media_url),
    expires_at: typeof expires === 'string' && expires ? expires : null,
    claim_url: link(json.claim_url),
  };
}

// The words of an error answer, also in the shape { message, errors: { field: [..] } }.
function said(json) {
  if (!json || typeof json !== 'object') return null;
  const first = json.errors && typeof json.errors === 'object' ? Object.values(json.errors).flat().find((m) => typeof m === 'string') : null;
  const text = (typeof json.message === 'string' && json.message) || first || (typeof json.error === 'string' && json.error) || (typeof json.error?.message === 'string' && json.error.message);
  return text ? String(text).replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, 300) : null;
}

// Uploads one file. The file goes up as a stream from disk, so a large video is
// never read into memory. Throws a ServiceError whose `details.reason` says what
// happened: "refused" means the server can't have published anything, and "lost"
// means it may have.
async function share(dir, { file, title }) {
  const apiKey = key(dir);
  const base = serviceUrl(connector);
  const { size } = fs.statSync(file);
  const form = new FormData();
  form.append('video', await fs.openAsBlob(file, { type: SHARE_TYPES[path.extname(file).toLowerCase()] }), path.basename(file));
  form.append('title', title);
  const details = (reason, extra = {}) => ({ reason, service: base, keyed: !!apiKey, ...extra });
  let res;
  let text;
  try {
    res = await fetch(`${base}/api/v1/shares`, {
      method: 'POST',
      body: form,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout(size)),
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    });
    text = await res.text();
  } catch (e) {
    const reason = failedRequest(e);
    const ms = timeout(size);
    const limit = ms >= 120000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`;
    throw new ServiceError(reason === 'unreachable' ? 'nothing answered' : reason === 'timeout' ? `the upload did not finish in ${limit}` : 'the connection dropped during the upload', reason === 'unreachable' ? 'refused' : 'lost', details(reason, { code: e?.cause?.code ?? e?.code ?? null }));
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const { status } = res;
  const words = said(json);
  if (status === 200 || status === 201) {
    const answer = shareAnswer(json);
    if (answer) return answer;
    throw new ServiceError(`HTTP ${status} with no share link`, 'refused', details('not-running', { status }));
  }
  if (status === 401) throw new ServiceError(`HTTP 401${words ? `: ${words}` : ''}`, 'refused', details('key', { status, said: words }));
  if ([413, 415, 422].includes(status)) throw new ServiceError(`HTTP ${status}${words ? `: ${words}` : ''}`, 'refused', details('file', { status, said: words }));
  if (status === 429) throw new ServiceError('HTTP 429', 'refused', details('busy', { status, retry_after: res.headers.get('retry-after') }));
  if (status === 503) throw new ServiceError('HTTP 503', 'refused', details('checking', { status }));
  if (status >= 500) throw new ServiceError(`HTTP ${status}`, 'lost', details('server', { status }));
  if (status === 404 || status === 405 || (status >= 300 && status < 400) || !json) throw new ServiceError(`HTTP ${status}`, 'refused', details('not-running', { status }));
  throw new ServiceError(`HTTP ${status}${words ? `: ${words}` : ''}`, 'refused', details('said-no', { status, said: words }));
}

const connector = {
  id: 'cloud',
  name: 'explainroo.com',
  baseUrl: 'https://www.explainroo.com',
  key,
  share,
};

export default connector;
