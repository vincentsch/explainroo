// YouTube: uploads to the user's own channel with their own Google OAuth client,
// as a resumable upload, and reads the status back.
//
//   sign-in   https://accounts.google.com/o/oauth2/v2/auth, a Desktop client with PKCE
//   tokens    POST {EXPLAINROO_YOUTUBE_AUTH_URL or https://oauth2.googleapis.com}/token
//   API       {EXPLAINROO_YOUTUBE_URL or https://www.googleapis.com}/youtube/v3/...
//   upload    POST .../upload/youtube/v3/videos?uploadType=resumable gives a session
//             address. A PUT there sends the file, and a PUT with
//             "Content-Range: bytes */<size>" asks how much arrived.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { tokenRequest } from '../oauth.js';
import { serviceUrl } from '../services.js';

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
export const YOUTUBE_REDIRECT = 'http://127.0.0.1:8976/callback';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const auth = { id: 'youtube-auth', name: 'Google sign-in', baseUrl: 'https://oauth2.googleapis.com' };
const ENV = { id: 'YOUTUBE_CLIENT_ID', secret: 'YOUTUBE_CLIENT_SECRET', refresh: 'YOUTUBE_REFRESH_TOKEN' };
const READ_TRIES = 3;

function fail(message) {
  throw new ProjectError(message);
}

const command = 'explainroo connect youtube';

// The saved client and login. The client id is no secret, but the other two are.
function saved(dir) {
  return {
    id: findEnv(ENV.id, dir),
    secret: rememberSecret(findEnv(ENV.secret, dir)),
    refresh: rememberSecret(findEnv(ENV.refresh, dir)),
  };
}

function login(dir) {
  const s = saved(dir);
  if (s.id && s.secret && s.refresh) return { ok: true };
  return { ok: false, missing: `There is no YouTube login yet. Run "${command}", which says how to make your own Google client and sign in.` };
}

// One access token per run, from the saved refresh token. Google keeps the same
// refresh token, so nothing is written back.
let cached = null;

async function accessToken(dir) {
  if (cached) return cached;
  const s = saved(dir);
  if (!(s.id && s.secret && s.refresh)) fail(login(dir).missing);
  const r = await tokenRequest(`${serviceUrl(auth)}/token`, { client_id: s.id, client_secret: s.secret, refresh_token: s.refresh, grant_type: 'refresh_token' }, { name: 'Google' });
  if (!r.ok) {
    if (r.reason === 'invalid-grant') fail(`Google no longer accepts the saved YouTube login (${r.message}). A Google client in testing status gives logins that end after 7 days. Run "${command}" again to sign in. Nothing was sent.`);
    if (r.reason === 'no-answer') fail('Google did not answer, so the YouTube login could not be renewed. Check your connection and run the same command again. Nothing was sent.');
    fail(`the YouTube login could not be renewed: ${r.message}. Nothing was sent.`);
  }
  cached = r.json.access_token;
  return cached;
}

function said(json) {
  const error = json?.error;
  const reason = error?.errors?.[0]?.reason;
  const text = typeof error === 'string' ? error : error?.message;
  return [reason, text].filter(Boolean).join(': ').replace(/[\s\p{Cc}]+/gu, ' ').slice(0, 300);
}

function retryWords(value) {
  return value ? ` It asks to wait ${/^\d+$/.test(value.trim()) ? `${value.trim()} seconds` : `until ${value}`} first.` : '';
}

// A read that costs nothing and changes nothing. It may go again after a dropped
// connection, a 5xx or a token that ran out.
async function read(dir, path, query) {
  const url = new URL(`${serviceUrl(connector)}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  let trouble = '';
  for (let tries = 1; tries <= READ_TRIES; tries++) {
    let res;
    let json = null;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${await accessToken(dir)}` } });
      json = await res.json().catch(() => null);
    } catch (e) {
      if (e instanceof ProjectError) throw e;
      trouble = 'YouTube did not answer';
      await sleep(250 * tries);
      continue;
    }
    if (res.ok && json) return json;
    if (res.status === 401 && tries < READ_TRIES) {
      cached = null;
      continue;
    }
    if (res.status === 429) fail(`YouTube has had too many requests.${retryWords(res.headers.get('retry-after'))} Nothing more was sent.`);
    if (res.status >= 500) {
      trouble = `YouTube answered with HTTP ${res.status}`;
      await sleep(250 * tries);
      continue;
    }
    throw new ServiceError(`YouTube answered with HTTP ${res.status}${said(json) ? ` (${said(json)})` : ''}`, 'refused');
  }
  throw new ServiceError(trouble, 'later');
}

function channelName(item) {
  const title = item?.snippet?.title;
  const handle = item?.snippet?.customUrl;
  return [title, handle && handle !== title ? `(${handle})` : ''].filter(Boolean).join(' ') || item.id;
}

// The channel of the login. An upload always goes there.
async function destinations(dir) {
  let json;
  try {
    json = await read(dir, '/youtube/v3/channels', { part: 'snippet', mine: 'true' });
  } catch (e) {
    if (e instanceof ServiceError) fail(`the YouTube channel could not be read: ${e.message}. Nothing was sent.`);
    throw e;
  }
  const items = Array.isArray(json.items) ? json.items.filter((item) => typeof item?.id === 'string') : [];
  if (!items.length) fail('the Google account of this login has no YouTube channel. Make one on youtube.com, then run the same command again. Nothing was sent.');
  return { account: null, list: items.map((item) => ({ id: item.id, name: channelName(item) })) };
}

// Starts an upload. Nothing can become a video until bytes go to the session, so a
// start that goes wrong can go again. The session address is only used on the same
// origin as the API, because the token goes along with every request to it.
async function startUpload(dir, start) {
  const base = serviceUrl(connector);
  const url = new URL(`${base}/upload/youtube/v3/videos`);
  for (const [name, value] of Object.entries(start.query)) url.searchParams.set(name, value);
  for (let tries = 1; ; tries++) {
    let res;
    let json = null;
    try {
      res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${await accessToken(dir)}`, 'Content-Type': 'application/json; charset=UTF-8', ...start.headers },
        body: JSON.stringify(start.body),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      if (e instanceof ProjectError) throw e;
      throw new ServiceError(thrownOutcome(e) === 'refused' ? 'could not reach YouTube' : 'the connection to YouTube dropped before the upload could start', 'refused');
    }
    if (res.status === 401 && tries === 1) {
      cached = null;
      continue;
    }
    const location = res.headers.get('location');
    if (res.ok && location) {
      let session;
      try {
        session = new URL(location, base);
      } catch {}
      if (!session || session.origin !== new URL(base).origin) throw new ServiceError('YouTube answered with an upload address on another server, so the upload did not start', 'refused');
      return { session: rememberSecret(session.toString()) };
    }
    if (res.status === 429) throw new ServiceError(`YouTube has had too many requests.${retryWords(res.headers.get('retry-after'))}`, 'refused', { retry_after: res.headers.get('retry-after') });
    throw new ServiceError(`YouTube refused to start the upload (HTTP ${res.status}${said(json) ? `, ${said(json)}` : ''})`, 'refused');
  }
}

// How much a 308 answer says arrived: "bytes=0-999" means 1000 bytes.
function received(res) {
  const m = /^bytes=0-(\d+)$/.exec(res.headers.get('range') ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

async function uploadAnswer(res) {
  if (res.status === 200 || res.status === 201) {
    const video = await res.json().catch(() => null);
    if (typeof video?.id === 'string') return { video: { id: video.id, status: video.status?.uploadStatus ?? null } };
    throw new ServiceError('YouTube finished the upload but sent no video id', 'later');
  }
  if (res.status === 308) return { received: received(res) };
  if (res.status === 404 || res.status === 410) throw new ServiceError(`YouTube no longer knows this upload (HTTP ${res.status})`, 'gone');
  if (res.status === 401) {
    cached = null;
    throw new ServiceError('the YouTube login ran out during the upload', 'later');
  }
  if ([500, 502, 503, 504].includes(res.status)) throw new ServiceError(`YouTube answered with HTTP ${res.status}`, 'later');
  const json = await res.json().catch(() => null);
  throw new ServiceError(`YouTube refused the upload (HTTP ${res.status}${said(json) ? `, ${said(json)}` : ''})`, 'failed');
}

// Sends the file from `offset` to the end. The file goes up as a stream from disk.
async function upload(dir, session, file, offset, size) {
  const blob = (await fs.openAsBlob(file)).slice(offset, size);
  let res;
  try {
    res = await fetch(session, {
      method: 'PUT',
      body: blob,
      signal: AbortSignal.timeout(60 * 60 * 1000),
      headers: { Authorization: `Bearer ${await accessToken(dir)}`, 'Content-Type': 'video/mp4', ...(offset > 0 ? { 'Content-Range': `bytes ${offset}-${size - 1}/${size}` } : {}) },
    });
  } catch (e) {
    if (e instanceof ProjectError) throw e;
    throw new ServiceError(e?.name === 'TimeoutError' ? 'the upload took more than an hour' : 'the connection dropped during the upload', 'later');
  }
  return uploadAnswer(res);
}

// Asks the session how much arrived. This changes nothing, so it may go again.
async function uploadStatus(dir, session, size) {
  let last = null;
  for (let tries = 1; tries <= READ_TRIES; tries++) {
    try {
      const res = await fetch(session, { method: 'PUT', body: '', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${await accessToken(dir)}`, 'Content-Range': `bytes */${size}` } });
      return await uploadAnswer(res);
    } catch (e) {
      if (e instanceof ProjectError && !(e instanceof ServiceError)) throw e;
      if (e instanceof ServiceError && e.outcome !== 'later') throw e;
      last = e instanceof ServiceError ? e : new ServiceError('YouTube did not answer', 'later');
      await sleep(250 * tries);
    }
  }
  throw last;
}

const DONE = new Set(['uploaded', 'processed']);
const FAILED = new Set(['failed', 'rejected', 'deleted']);

// What YouTube says about an uploaded video.
async function postStatus(dir, id, { platform } = {}) {
  const json = await read(dir, '/youtube/v3/videos', { part: 'status,processingDetails', id });
  const item = Array.isArray(json.items) ? json.items.find((v) => v?.id === id) : null;
  if (!item) throw new ServiceError('YouTube does not list the video yet', 'later');
  const upload = String(item.status?.uploadStatus ?? 'unknown');
  const processing = item.processingDetails?.processingStatus ?? null;
  const why = item.status?.failureReason ?? item.status?.rejectionReason ?? null;
  const state = FAILED.has(upload) ? 'failed' : DONE.has(upload) ? 'finished' : 'pending';
  return {
    state,
    status: upload,
    link: `https://www.youtube.com/${platform === 'shorts' ? `shorts/${id}` : `watch?v=${id}`}`,
    error: state === 'failed' ? `${upload}${why ? ` (${why})` : ''}` : null,
    details: [`privacy ${item.status?.privacyStatus ?? 'unknown'}`, processing ? `processing ${processing}` : null].filter(Boolean).join(', '),
  };
}

// A new login is tested by reading its channel. Returns the channel's name.
async function test(accessTokenValue) {
  let res;
  let json = null;
  try {
    res = await fetch(`${serviceUrl(connector)}/youtube/v3/channels?part=snippet&mine=true`, { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${accessTokenValue}` } });
    json = await res.json().catch(() => null);
  } catch {
    fail('YouTube did not answer, so the login could not be tested. Check your connection and run connect youtube again.');
  }
  if (!res.ok) fail(`YouTube answered with HTTP ${res.status}${said(json) ? ` (${said(json)})` : ''}, so the login could not be tested`);
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  if (!item?.id) fail('the Google account you signed in with has no YouTube channel. Make one on youtube.com, then sign in again');
  return channelName(item);
}

// The lines a new login adds to the .env file. The client is saved in the first step.
function loginLines(tokens) {
  return { [ENV.refresh]: rememberSecret(tokens.refresh_token) };
}

const connector = {
  id: 'youtube',
  name: 'YouTube',
  baseUrl: 'https://www.googleapis.com',
  signIn: {
    authorizeUrl: AUTHORIZE,
    tokenUrl: () => `${serviceUrl(auth)}/token`,
    redirectUri: YOUTUBE_REDIRECT,
    scopes: YOUTUBE_SCOPES,
    // A refresh token comes only with offline access, and every time only with consent.
    params: { access_type: 'offline', prompt: 'consent' },
    env: ENV,
  },
  saved,
  login,
  loginLines,
  test,
  destinations,
  startUpload,
  upload,
  uploadStatus,
  postStatus,
};

export default connector;
