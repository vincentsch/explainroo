// Blotato: posts through the user's Blotato account, with their API key.
//
//   GET  {EXPLAINROO_BLOTATO_URL or https://backend.blotato.com/v2}/users/me/accounts
//   POST .../media/uploads { filename }, then PUT the file to the presignedUrl it gives
//   POST .../posts { post: { accountId, content, target } } answers 201 with a postSubmissionId
//   GET  .../posts/<id> gives the status: in-progress, scheduled, published or failed
//
// Creating a key ends Blotato's free trial and starts its paid plan, and the
// services entry and connect both say so before the key is made.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

const ENV = 'BLOTATO_API_KEY';
const READ_TRIES = 3;

function fail(message) {
  throw new ProjectError(message);
}

// Some keys end in "=", which stays part of the key.
function findKey(dir) {
  return rememberSecret(findEnv(ENV, dir));
}

function login(dir) {
  if (findKey(dir)) return { ok: true };
  return { ok: false, missing: `There is no Blotato key yet. Creating one ends Blotato's free trial and starts its paid plan, so ask the user first. Then run "explainroo connect blotato", or put ${ENV}=... in ${settingsEnvFile()}.` };
}

function apiKey(dir) {
  const key = findKey(dir);
  if (!key) fail(login(dir).missing);
  if (!/^[\x21-\x7e]+$/.test(key)) fail(`${ENV} has spaces or unusual characters, so it can't be sent. Check that you copied all of the key and nothing else. Nothing was sent.`);
  return key;
}

function said(json) {
  const text = (typeof json?.message === 'string' && json.message) || (typeof json?.error === 'string' && json.error) || (typeof json?.error?.message === 'string' && json.error.message) || '';
  return text.replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, 300);
}

function retryWords(value) {
  return value ? ` It asks to wait ${/^\d+$/.test(value.trim()) ? `${value.trim()} seconds` : `until ${value}`} first.` : '';
}

// One request to the API. A read may go again. A write never does here: one with
// no answer may have worked, and the caller decides what that means.
async function call(dir, method, path, { body, query, write = false, key = apiKey(dir) } = {}) {
  const url = new URL(`${serviceUrl(connector)}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  let trouble = '';
  for (let tries = 1; tries <= (write ? 1 : READ_TRIES); tries++) {
    let res;
    let json = null;
    try {
      res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(60000),
        headers: { 'blotato-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      if (write) throw new ServiceError(thrownOutcome(e) === 'refused' ? 'could not reach Blotato' : 'the connection to Blotato dropped before the answer came', thrownOutcome(e));
      trouble = 'Blotato did not answer';
      await sleep(250 * tries);
      continue;
    }
    if (res.ok) return { status: res.status, json };
    // Blotato says in the message when to try again, and may send no Retry-After.
    if (res.status === 429) throw new ServiceError(`Blotato has had too many requests${said(json) ? ` (${said(json)})` : ''}.${retryWords(res.headers.get('retry-after'))} Nothing more was sent, and nothing is sent again by itself`, 'refused', { retry_after: res.headers.get('retry-after') ?? said(json) });
    if (res.status === 401) throw new ServiceError(`Blotato rejected the key (HTTP 401${said(json) ? `: ${said(json)}` : ''}). Check it, or run "explainroo connect blotato" again`, 'refused');
    // A plan without API access, such as the free trial, gets a 403.
    if (res.status === 403) throw new ServiceError(`Blotato refused the request (HTTP 403${said(json) ? `: ${said(json)}` : ''}${typeof json?.subscriptionStatus === 'string' ? `, subscription ${json.subscriptionStatus}` : ''}). Check that your Blotato plan includes the API`, 'refused');
    if (res.status >= 500) {
      if (write) throw new ServiceError(`Blotato answered with HTTP ${res.status}`, 'lost');
      trouble = `Blotato answered with HTTP ${res.status}`;
      await sleep(250 * tries);
      continue;
    }
    throw new ServiceError(`Blotato refused it (HTTP ${res.status}${said(json) ? `: ${said(json)}` : ''})`, res.status === 404 && !write ? 'gone' : 'refused');
  }
  throw new ServiceError(trouble, 'later');
}

function accountName(item) {
  return item.username ? `@${String(item.username).replace(/^@/, '')}` : String(item.fullname ?? item.id);
}

// The accounts that can post on one network.
async function destinations(dir, network) {
  let answer;
  try {
    answer = await call(dir, 'GET', '/users/me/accounts', { query: { platform: network } });
  } catch (e) {
    if (e instanceof ServiceError) fail(`the Blotato accounts could not be read: ${e.message}. Nothing was sent.`);
    throw e;
  }
  const items = Array.isArray(answer.json?.items) ? answer.json.items : [];
  const list = items.filter((item) => item && typeof item.id !== 'object' && String(item.platform) === network).map((item) => ({ id: String(item.id), name: accountName(item) }));
  return { account: null, list };
}

// Puts the file where Blotato can fetch it. The key never goes to the upload
// address. An upload makes no post, so a failed one can go again.
async function uploadMedia(dir, file) {
  const { json } = await call(dir, 'POST', '/media/uploads', { body: { filename: 'video.mp4' }, write: true });
  const web = (value) => {
    try {
      return /^https?:$/.test(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  if (!web(json?.presignedUrl) || !web(json?.publicUrl)) throw new ServiceError('Blotato gave no address to upload the video to', 'refused');
  const { presignedUrl: target, publicUrl } = json;
  let res;
  try {
    res = await fetch(target, { method: 'PUT', body: await fs.openAsBlob(file), signal: AbortSignal.timeout(60 * 60 * 1000), headers: { 'Content-Type': 'video/mp4' } });
  } catch {
    throw new ServiceError('the upload of the video to Blotato did not finish', 'refused');
  }
  if (!res.ok) throw new ServiceError(`the upload of the video to Blotato failed (HTTP ${res.status})`, 'refused');
  return { publicUrl };
}

// What a post needs before it goes out: a key that can be sent.
async function ready(dir) {
  return { key: apiKey(dir) };
}

// Sends the one request that makes a post. It is never sent again here.
async function createPost(dir, body, { key }) {
  const { json } = await call(dir, 'POST', '/posts', { body, write: true, key });
  const id = json?.postSubmissionId;
  if (typeof id !== 'string' && typeof id !== 'number') throw new ServiceError('Blotato accepted the post and gave no postSubmissionId', 'lost');
  return { id: String(id), status: null, link: null };
}

const STATES = { published: 'finished', failed: 'failed' };

async function postStatus(dir, id) {
  const { json } = await call(dir, 'GET', `/posts/${encodeURIComponent(id)}`);
  const status = String(json?.status ?? 'unknown');
  const link = typeof json?.publicUrl === 'string' ? json.publicUrl : null;
  return { state: STATES[status] ?? 'pending', status, link, error: status === 'failed' ? said({ message: json?.errorMessage }) || 'no reason given' : null };
}

// Reading the accounts is free, so this checks a key without spending.
async function test(key) {
  try {
    await call(null, 'GET', '/users/me/accounts', { key });
  } catch (e) {
    if (e instanceof ServiceError && /rejected the key/.test(e.message)) throw new ProjectError('Blotato rejected the key. Check that you copied all of it, including any "=" at the end.');
    if (e instanceof ServiceError && /HTTP 403/.test(e.message)) throw new ProjectError(`${e.message.replace(/\.$/, '')}. The free trial has no API access.`);
    if (e instanceof ServiceError) throw new ProjectError(`${e.message}, so the key could not be tested. Try again in a moment.`);
    throw e;
  }
}

const connector = {
  id: 'blotato',
  name: 'Blotato',
  baseUrl: 'https://backend.blotato.com/v2',
  key: apiKey,
  login,
  test,
  destinations,
  uploadMedia,
  ready,
  createPost,
  postStatus,
};

export default connector;
