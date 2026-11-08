// Signing in to a service with OAuth, in two commands, so that it needs no
// certificate and no process left running. That suits a person and an agent whose
// commands time out alike.
//
//   connect <service>                       prints a link, and keeps the PKCE verifier and
//                                           the state in a small file in the settings folder
//   (the person approves in the browser, which then lands on the redirect address and
//    shows an error page, because nothing listens there)
//   connect <service> --callback-url '...'  checks the state and trades the code for tokens
//
// The code in that address works once, and only with the saved verifier, so it is safe
// on a command line, unlike a key. Refreshing a token lives here too.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile, saveKeys } from './env.js';
import { ProjectError, rememberSecret } from './errors.js';
import { configRoot } from './models.js';
import { secondsWords, withLock } from './lock.js';

// Retry-After holds seconds or a date.
function waitWords(value) {
  if (!value) return '';
  return /^\d+$/.test(value.trim()) ? ` ${value.trim()} seconds` : ` until ${value.trim()}`;
}

// A sign-in that waits longer than this has to start again. The services keep
// their codes for minutes, so this only catches a link from another day.
const SIGN_IN_MS = 60 * 60 * 1000;
// A saved access token is used while it is good for at least this much longer.
const MARGIN_MS = 5 * 60 * 1000;
// How long a run waits for another one that renews the same login. A renewal is one
// request with a timeout of 30 seconds. Tests set it shorter.
const loginLockMs = () => Number(process.env.EXPLAINROO_LOGIN_LOCK_MS) || 60 * 1000;

function fail(message) {
  throw new ProjectError(message);
}

function randomWord(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// The verifier stays here, and only its hash goes into the link.
export function pkcePair() {
  const verifier = randomWord(32);
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

export function signInFile(service) {
  return path.join(configRoot(), `sign-in-${service}.json`);
}

function writePrivateFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}

// Starts a sign-in and returns the link to open. `target` is the .env file that
// gets the tokens, so the second step saves them where the first one said.
export function startSignIn(service, { authorizeUrl, clientId, redirectUri, scopes, params = {}, target }) {
  const { verifier, challenge } = pkcePair();
  const state = randomWord(16);
  const link = new URL(authorizeUrl);
  for (const [name, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', ...params })) {
    link.searchParams.set(name, value);
  }
  const file = signInFile(service);
  writePrivateFile(file, { service, state, verifier, client_id: clientId, redirect_uri: redirectUri, scopes, target, created: new Date().toISOString() });
  return { link: link.toString(), file };
}

export function forgetSignIn(service) {
  fs.rmSync(signInFile(service), { force: true });
}

// Reads the address the browser landed on. Nothing in it is ever printed, because
// it holds the code. The waiting sign-in stays when the address doesn't belong to
// it, so the right one can still be pasted.
export function readCallback(service, address, { name, command, target }) {
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(signInFile(service), 'utf8'));
  } catch {
    fail(`no ${name} sign-in is waiting. Run "${command}" first, open the link it prints and approve. Then run this again with the address the browser landed on.`);
  }
  if (!(Date.now() - Date.parse(pending.created) < SIGN_IN_MS)) {
    forgetSignIn(service);
    fail(`that ${name} sign-in started more than an hour ago. Run "${command}" again for a new link.`);
  }
  if (pending.target !== target) fail(`the ${name} sign-in started with the tokens going to ${pending.target}. Run this with the same --project as the first step, or start again.`);
  const redirect = new URL(pending.redirect_uri);
  let url = null;
  const text = String(address).trim();
  for (const candidate of [text, `${redirect.protocol}//${text}`]) {
    try {
      url = new URL(candidate);
      break;
    } catch {}
  }
  if (!url || url.host !== redirect.host || url.pathname !== redirect.pathname) {
    fail(`--callback-url needs the whole address from the browser's address bar after you approve. It starts with ${pending.redirect_uri}?`);
  }
  const params = url.searchParams;
  if (params.get('state') !== pending.state) fail(`that address belongs to another ${name} sign-in. Use the address from the newest link, or run "${command}" again.`);
  const refused = params.get('error');
  if (refused) {
    forgetSignIn(service);
    fail(`the sign-in was not approved (${refused.replace(/[^\w.-]/g, '').slice(0, 60)}). Nothing was saved. Run "${command}" again to try once more.`);
  }
  const code = rememberSecret(params.get('code'));
  if (!code) fail(`that address has no code in it. Copy the whole address from the browser's address bar after you approve.`);
  return { code, pending, granted: params.get('scope') };
}

function said(json) {
  const words = [json?.error, json?.error_description].filter((w) => typeof w === 'string' && w).join(': ');
  return words.replace(/[\s\p{Cc}]+/gu, ' ').slice(0, 200);
}

// One form-encoded request to a token address. Every token in the answer is
// remembered as a secret first, so no message can show it.
export async function tokenRequest(url, form, { name, timeout = 30000 }) {
  let res;
  let json = null;
  try {
    res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form) });
    json = await res.json().catch(() => null);
  } catch {
    return { ok: false, reason: 'no-answer', message: `${name} did not answer` };
  }
  rememberSecret(json?.access_token);
  rememberSecret(json?.refresh_token);
  rememberSecret(json?.id_token);
  if (res.ok && typeof json?.access_token === 'string' && json.access_token) return { ok: true, json };
  const words = said(json);
  return { ok: false, reason: json?.error === 'invalid_grant' ? 'invalid-grant' : res.status === 429 ? 'busy' : 'refused', status: res.status, retry_after: res.headers.get('retry-after'), message: `${name} answered with HTTP ${res.status}${words ? ` (${words})` : ''}` };
}

// When a token runs out, from the seconds a token answer gives.
export function expiresAt(json, now = Date.now()) {
  const seconds = Number(json.expires_in);
  return new Date(now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000).toISOString();
}

// One short name per .env file, for its lock and its renewal mark.
function fileId(file) {
  return crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 16);
}

function lockFile(file) {
  return path.join(configRoot(), 'locks', fileId(file));
}

// A renewal that went out and whose answer is not saved yet leaves this mark. It
// holds a hash of the refresh token that was sent, never the token itself.
function renewalFile(file) {
  return path.join(configRoot(), 'renewals', `${fileId(file)}.json`);
}

const tokenId = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);

function renewalToken(marker) {
  try {
    return JSON.parse(fs.readFileSync(marker, 'utf8')).token ?? null;
  } catch {
    return null;
  }
}

// One run at a time refreshes the tokens of one .env file. While the run that holds
// the lock is still running, the others wait for it, also when it is paused, and
// then stop. A lock counts as left behind only once its run is gone (src/lock.js).
async function withTokenLock(file, name, fn) {
  const lock = lockFile(file);
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const waitMs = loginLockMs();
  return withLock(lock, fn, {
    waitMs,
    pauseMs: 100,
    busy: () => new ProjectError(`another run is renewing the ${name} login right now, and this one waited ${secondsWords(waitMs)} for it. Nothing was sent. Run the same command again in a minute.`),
  });
}

// A working access token from tokens saved in a .env file, for a service that
// gives a new refresh token with each refresh and kills the old one. Reusing an
// old one can end the whole login, so the new one is saved the moment it arrives,
// together with the access token and its expiry, in one write, under a lock. A run
// that waited for the lock reads the file again and uses what the other run saved.
//
// A run can still stop between the answer and the save. So before the request it
// leaves a mark, and it takes the mark away once the new tokens are saved. When a
// later run finds the mark for the token it has, and the service no longer takes
// that token, the message says that the last renewal was cut off.
//
// `names` are the three lines in the .env file, and `refresh(token)` sends one
// refresh and returns what tokenRequest returns.
export async function rotatingAccessToken({ source, names, refresh, name, command }) {
  const good = (expires) => Date.parse(expires) - Date.now() > MARGIN_MS;
  const { file } = source;
  if (!file) fail(`${names.refresh} is set in the environment. ${name} gives a new refresh token each time the login is renewed and the old one stops working, so explainroo keeps it in a .env file it can update. Remove ${names.refresh} from the environment and run "${command}".`);
  return withTokenLock(file, name, async () => {
    const access = readEnvFile(file, names.access);
    if (access && good(readEnvFile(file, names.expires))) return rememberSecret(access);
    const old = rememberSecret(readEnvFile(file, names.refresh));
    if (!old) fail(`the ${name} login in ${file} has no refresh token. Run "${command}" again.`);
    const marker = renewalFile(file);
    // An earlier run sent this same token, and its answer was never saved.
    const cutOff = renewalToken(marker) === tokenId(old);
    writePrivateFile(marker, { renewing: name, token: tokenId(old), sent: new Date().toISOString() });
    const r = await refresh(old);
    if (r.ok) {
      saveKeys(file, { [names.refresh]: rememberSecret(r.json.refresh_token) || old, [names.access]: r.json.access_token, [names.expires]: expiresAt(r.json) });
      fs.rmSync(marker, { force: true });
      return r.json.access_token;
    }
    // A refusal means no new token was given for this request. Without an answer,
    // or with one that was cut off, there may be one, so the mark stays.
    if (!cutOff && r.status >= 400 && r.status < 500) fs.rmSync(marker, { force: true });
    if (r.reason === 'invalid-grant' && cutOff) fail(`the last renewal of the ${name} login was cut off before the new token was saved, and now ${name} no longer accepts the old one. Run "${command}" to sign in again. Nothing was sent.`);
    if (r.reason === 'invalid-grant') fail(`${name} no longer accepts the saved login (${r.message}). Run "${command}" again to sign in. Nothing was sent.`);
    if (r.reason === 'busy') fail(`${name} has had too many requests and asks to wait${waitWords(r.retry_after)} before the next one. Nothing was sent, and nothing is sent again by itself.`);
    fail(`the ${name} login could not be renewed: ${r.message}. Nothing was sent. Run the same command again in a moment.`);
  });
}
