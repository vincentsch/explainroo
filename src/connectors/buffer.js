// Buffer: posts through the user's Buffer account. It signs in with OAuth and
// PKCE as a public client, which has no secret. The API is GraphQL.
//
//   sign-in   https://auth.buffer.com/auth, with the redirect address below
//   tokens    POST {EXPLAINROO_BUFFER_AUTH_URL or https://auth.buffer.com}/token, form encoded
//   API       POST {EXPLAINROO_BUFFER_URL or https://api.buffer.com} with Authorization: Bearer
//
// Each refresh gives a new refresh token and kills the old one. src/oauth.js saves
// the new one before anything uses it.
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv, findEnvSource } from '../env.js';
import { ProjectError, ServiceError, rememberSecret, thrownOutcome } from '../errors.js';
import { expiresAt, rotatingAccessToken, tokenRequest } from '../oauth.js';
import { serviceUrl } from '../services.js';

// The public client that explainroo signs in with. A public client has no secret,
// so its id can be in the code. BUFFER_CLIENT_ID replaces it with a client of the
// user's own.
export const BUFFER_CLIENT_ID = 'bV6YR9jmW9kqN6sXNGwfza2QAwLF5NeRH-YzvfuHyTo';
export const BUFFER_REDIRECT = 'https://localhost:8976/callback';
// The client allows the first three. offline_access is not a permission of the
// client. The sign-in asks for it, and only then does Buffer give a refresh token.
export const BUFFER_SCOPES = ['account:read', 'posts:read', 'posts:write', 'offline_access'];

// Values that Buffer's reference does not list. mode and schedulingType are known
// to work in real posts. The others follow the same form, and no real post has
// confirmed them yet.
export const BUFFER_VALUES = {
  mode: 'shareNow',
  schedulingType: 'automatic',
  privacy: { private: 'private', unlisted: 'unlisted', public: 'public' },
  services: { youtube: 'youtube', tiktok: 'tiktok', instagram: 'instagram', linkedin: 'linkedin', twitter: 'twitter' },
  reel: 'reel',
};

const AUTHORIZE = 'https://auth.buffer.com/auth';
const auth = { id: 'buffer-auth', name: 'Buffer sign-in', baseUrl: 'https://auth.buffer.com' };
const ENV = { access: 'BUFFER_ACCESS_TOKEN', refresh: 'BUFFER_REFRESH_TOKEN', expires: 'BUFFER_TOKEN_EXPIRES', client: 'BUFFER_CLIENT_ID' };
const command = 'explainroo connect buffer';
const READ_TRIES = 3;

export const CREATE_POST = 'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id status externalLink } } ... on MutationError { message } } }';
const READ_POST = 'query ReadPost($input: PostInput!) { post(input: $input) { id status externalLink sentAt error { message } } }';
const ORGANIZATIONS = 'query Organizations { account { organizations { id name } } }';
const CHANNELS = 'query Channels($input: ChannelsInput!) { channels(input: $input) { id name displayName service isLocked isDisconnected } }';

function fail(message) {
  throw new ProjectError(message);
}

function clientId(dir) {
  return findEnv(ENV.client, dir) || BUFFER_CLIENT_ID;
}

function login(dir) {
  if (findEnv(ENV.refresh, dir) || findEnv(ENV.access, dir)) return { ok: true };
  return { ok: false, missing: `There is no Buffer login yet. Run "${command}", which says how to sign in.` };
}

// A working access token. A saved one that is still good is used, and otherwise the
// refresh token gets a new one, saved before it is used.
async function accessToken(dir) {
  const source = findEnvSource(ENV.refresh, dir);
  if (!source) {
    const access = findEnv(ENV.access, dir);
    if (access) return rememberSecret(access);
    fail(login(dir).missing);
  }
  rememberSecret(source.value);
  return rotatingAccessToken({
    source,
    names: ENV,
    name: 'Buffer',
    command,
    refresh: (old) => tokenRequest(`${serviceUrl(auth)}/token`, { grant_type: 'refresh_token', refresh_token: old, client_id: clientId(dir) }, { name: 'Buffer' }),
  });
}

function retryWords(value) {
  return value ? ` It asks to wait ${/^\d+$/.test(value.trim()) ? `${value.trim()} seconds` : `until ${value}`} first.` : '';
}

function gqlWords(json) {
  const first = Array.isArray(json?.errors) ? json.errors.find((e) => typeof e?.message === 'string') : null;
  return first ? first.message.replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, 300) : '';
}

// One GraphQL request. Buffer answers errors with HTTP 200 too, so the body says what
// happened. A read may go again. A write never does here: one with no answer may
// have made the post, and the caller reads its answer itself.
async function gql(dir, body, { write = false, token } = {}) {
  let trouble = '';
  for (let tries = 1; tries <= (write ? 1 : READ_TRIES); tries++) {
    let res;
    let json = null;
    try {
      res = await fetch(serviceUrl(connector), {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${token ?? (await accessToken(dir))}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      if (e instanceof ProjectError) throw e;
      if (write) throw new ServiceError(thrownOutcome(e) === 'refused' ? 'could not reach Buffer' : 'the connection to Buffer dropped before the answer came', thrownOutcome(e));
      trouble = 'Buffer did not answer';
      await sleep(250 * tries);
      continue;
    }
    if (res.status === 429) throw new ServiceError(`Buffer has had too many requests.${retryWords(res.headers.get('retry-after'))} Nothing more was sent, and nothing is sent again by itself`, 'refused', { retry_after: res.headers.get('retry-after') });
    if (res.status === 401 || res.status === 403) throw new ServiceError(`Buffer did not accept the login (HTTP ${res.status}${gqlWords(json) ? `: ${gqlWords(json)}` : ''}). Run "${command}" again`, 'refused');
    if (res.status >= 500 || !json) {
      if (write) throw new ServiceError(`Buffer answered with HTTP ${res.status}${json ? '' : ' and nothing it could read'}`, 'lost');
      trouble = `Buffer answered with HTTP ${res.status}`;
      await sleep(250 * tries);
      continue;
    }
    if (write) return json;
    if (!json.data || (Array.isArray(json.errors) && json.errors.length)) throw new ServiceError(`Buffer refused the request (HTTP ${res.status}${gqlWords(json) ? `: ${gqlWords(json)}` : ''})`, 'refused');
    return json.data;
  }
  throw new ServiceError(trouble, 'later');
}

// The channels on one network, from every organization of the account. Locked and
// disconnected ones are listed with the reason, and never picked.
async function destinations(dir, network) {
  try {
    const data = await gql(dir, { operationName: 'Organizations', query: ORGANIZATIONS });
    const organizations = Array.isArray(data.account?.organizations) ? data.account.organizations : [];
    const list = [];
    for (const org of organizations) {
      const found = await gql(dir, { operationName: 'Channels', query: CHANNELS, variables: { input: { organizationId: org.id } } });
      for (const c of Array.isArray(found.channels) ? found.channels : []) {
        if (c?.service !== BUFFER_VALUES.services[network]) continue;
        const why = c.isLocked ? 'it is locked in Buffer' : c.isDisconnected ? 'it is disconnected in Buffer' : null;
        list.push({ id: String(c.id), name: String(c.displayName || c.name || c.id), account: { id: String(org.id), name: String(org.name ?? '') }, usable: !why, why });
      }
    }
    return { account: null, list };
  } catch (e) {
    if (e instanceof ServiceError) fail(`the Buffer channels could not be read: ${e.message}. Nothing was sent.`);
    throw e;
  }
}

function createPostRequest(input) {
  return { operationName: 'CreatePost', query: CREATE_POST, variables: { input } };
}

function videoAssets(url) {
  return [{ video: { url, metadata: { thumbnailOffset: 0 } } }];
}

// What a post needs before it goes out: a working access token.
async function ready(dir) {
  return { token: await accessToken(dir) };
}

// Sends the one request that makes a post. It is never sent again here. A post in
// the answer counts, also when errors come with it. Errors with no data at all mean
// GraphQL refused the request before it ran, such as a missing field. Errors while
// it ran leave the outcome unknown.
async function createPost(dir, body, { token }) {
  const json = await gql(dir, body, { write: true, token });
  const answer = json.data?.createPost;
  if (answer?.__typename === 'PostActionSuccess' && answer.post?.id) return { id: String(answer.post.id), status: answer.post.status ?? null, link: answer.post.externalLink ?? null };
  if (typeof answer?.message === 'string') throw new ServiceError(`Buffer refused the post (${answer.__typename ?? 'error'}: ${answer.message.replace(/[\s\p{Cc}]+/gu, ' ').slice(0, 300)})`, 'refused');
  if (!Object.hasOwn(json, 'data') && Array.isArray(json.errors) && json.errors.length) throw new ServiceError(`Buffer refused the request${gqlWords(json) ? ` (${gqlWords(json)})` : ''}`, 'refused');
  throw new ServiceError(`Buffer answered without saying whether it made the post${gqlWords(json) ? ` (${gqlWords(json)})` : ''}`, 'lost');
}

async function postStatus(dir, id) {
  const data = await gql(dir, { operationName: 'ReadPost', query: READ_POST, variables: { input: { id } } });
  const post = data.post;
  if (!post) throw new ServiceError('Buffer does not show the post yet', 'later');
  const status = String(post.status ?? 'unknown');
  const error = typeof post.error?.message === 'string' ? post.error.message : null;
  const state = status === 'sent' ? 'finished' : status === 'error' ? 'failed' : 'pending';
  return { state, status, link: post.externalLink ?? null, error: state === 'failed' ? error ?? 'no reason given' : null };
}

// A new login is tested by reading its organizations and channels.
async function test(token) {
  let data;
  try {
    data = await gql(null, { operationName: 'Organizations', query: ORGANIZATIONS }, { token });
  } catch (e) {
    if (e instanceof ServiceError) fail(`${e.message.replace(/\.$/, '')}, so the login could not be tested`);
    throw e;
  }
  const names = (data.account?.organizations ?? []).map((o) => o?.name).filter(Boolean);
  return names.length ? names.join(', ') : null;
}

// The lines a new login adds to the .env file. A client id that is not built in
// goes along, because only that client can renew the login.
function loginLines(tokens, pending) {
  return {
    [ENV.access]: rememberSecret(tokens.access_token),
    [ENV.refresh]: rememberSecret(tokens.refresh_token),
    [ENV.expires]: expiresAt(tokens),
    ...(pending.client_id !== BUFFER_CLIENT_ID ? { [ENV.client]: pending.client_id } : {}),
  };
}

const connector = {
  id: 'buffer',
  name: 'Buffer',
  baseUrl: 'https://api.buffer.com',
  signIn: {
    authorizeUrl: AUTHORIZE,
    tokenUrl: () => `${serviceUrl(auth)}/token`,
    redirectUri: BUFFER_REDIRECT,
    scopes: BUFFER_SCOPES,
    params: { prompt: 'consent' },
  },
  clientId,
  login,
  loginLines,
  test,
  destinations,
  createPostRequest,
  videoAssets,
  ready,
  createPost,
  postStatus,
};

export default connector;
