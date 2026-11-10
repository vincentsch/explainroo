// AI presenters: a clip of a talking person that speaks a scene's narration, to
// place next to product screens. This connector speaks one small API, described
// in docs/presenters.md, so any presenter service can offer it. No service is
// built in yet, so it runs only where EXPLAINROO_PRESENTER_URL names one.
//
//   GET  /v1/avatars        { avatars: [{ id, name, likeness, consent, usd_per_second }] }
//   POST /v1/videos         { avatar, consent_id, audio, aspect } -> { id, status }
//   GET  /v1/videos/<id>    { status, url, cost_usd, error }
//   GET  <url>              the MP4
//
// likeness is "synthetic" for a made-up person, and "real" for the face of a
// real person. consent is { status: "verified" | "pending" | "none", id, covers }
// from the service's own consent flow, where covers lists "face" and "voice".
import { setTimeout as sleep } from 'node:timers/promises';
import { findEnv, settingsEnvFile } from '../env.js';
import { ProjectError, ServiceError, hideSecrets, rememberSecret, thrownOutcome } from '../errors.js';
import { serviceUrl } from '../services.js';

function findKey(dir) {
  return rememberSecret(findEnv('PRESENTER_API_KEY', dir));
}

function apiKey(dir) {
  const key = findKey(dir);
  if (!key) throw new ProjectError(`a presenter service needs an API key. Ask the user for the key of their presenter service, then set PRESENTER_API_KEY or put PRESENTER_API_KEY=... in ${settingsEnvFile()}.`);
  return key;
}

// The service's address. None is built in, so without EXPLAINROO_PRESENTER_URL
// nothing is sent.
function base() {
  const url = serviceUrl(connector);
  if (!url) throw new ProjectError('no presenter service is set up yet. explainroo has the code and the consent rule for one, and a service that speaks its API works when EXPLAINROO_PRESENTER_URL names it. Run "explainroo docs presenters" for the API and the free choice: film yourself and play the clip with s.clip.');
  return url.replace(/\/+$/, '');
}

const headers = (key, json = false) => ({ Authorization: `Bearer ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });

async function answer(res) {
  const body = await res.json().catch(() => null);
  const said = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : '';
  return { body, said: hideSecrets(said).slice(0, 200) };
}

// A request that costs nothing: the list of avatars, or a job's state.
async function read(url, key, what) {
  let res;
  try {
    res = await fetch(url, { headers: headers(key), signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new ServiceError(`the presenter service did not answer while reading ${what}. Check the connection and try again.`, 'refused');
  }
  const { body, said } = await answer(res);
  if (res.status === 401 || res.status === 403) throw new ServiceError('the presenter service rejected the API key. Ask the user to check PRESENTER_API_KEY.', 'refused');
  if (!res.ok) throw new ServiceError(`the presenter service could not give ${what}${said ? `: ${said}` : ''}.`, 'refused');
  return body;
}

async function avatars(dir) {
  const body = await read(`${base()}/v1/avatars`, apiKey(dir), 'its avatars');
  if (!Array.isArray(body?.avatars)) throw new ServiceError('the presenter service sent a list of avatars that explainroo can\'t read.', 'refused');
  return body.avatars.map((a) => ({
    id: String(a.id),
    name: String(a.name ?? a.id),
    likeness: a.likeness === 'synthetic' ? 'synthetic' : 'real',
    consent: { status: ['verified', 'pending'].includes(a.consent?.status) ? a.consent.status : 'none', id: a.consent?.id ?? null, covers: Array.isArray(a.consent?.covers) ? a.consent.covers.map(String) : [] },
    usd_per_second: Number.isFinite(a.usd_per_second) && a.usd_per_second >= 0 ? a.usd_per_second : null,
  }));
}

async function test(key) {
  try {
    await read(`${base()}/v1/avatars`, key, 'its avatars');
  } catch (e) {
    throw new ProjectError(e.message);
  }
}

// Starts a clip. Only an answer with a job id means the work began. A request
// with no answer may have started it, so it is never sent again.
async function start(dir, { avatar, consentId, audio, aspect }) {
  let res;
  try {
    res = await fetch(`${base()}/v1/videos`, { method: 'POST', headers: headers(apiKey(dir), true), signal: AbortSignal.timeout(120000), body: JSON.stringify({ avatar, consent_id: consentId, audio: audio.toString('base64'), aspect }) });
  } catch (e) {
    throw new ServiceError('the presenter service did not answer.', thrownOutcome(e));
  }
  const { body, said } = await answer(res);
  if (res.status === 401 || res.status === 403) throw new ServiceError('the presenter service rejected the API key. Ask the user to check PRESENTER_API_KEY.', 'refused');
  if (res.status === 402) throw new ServiceError('the presenter account has no credit left. Ask the user to check their plan.', 'refused');
  if (res.status === 451) throw new ServiceError(`the presenter service refused the avatar for lack of consent${said ? `: ${said}` : ''}. The person has to finish the service's consent flow first.`, 'refused');
  if (res.status >= 400 && res.status < 500) throw new ServiceError(`the presenter service refused the request${said ? `: ${said}` : ''}.`, 'refused');
  if (!res.ok || typeof body?.id !== 'string') throw new ServiceError(`the presenter service answered with an error${said ? `: ${said}` : ''}.`, 'failed');
  return { id: body.id };
}

// Waits for a job, then fetches its clip.
async function finish(dir, id, { log = () => {}, wait = 3000, timeout = 20 * 60000 } = {}) {
  const key = apiKey(dir);
  const until = Date.now() + timeout;
  for (;;) {
    let job;
    try {
      job = await read(`${base()}/v1/videos/${encodeURIComponent(id)}`, key, 'the state of the clip');
    } catch (e) {
      throw new ServiceError(e.message, 'lost');
    }
    if (job?.status === 'done') {
      if (typeof job.url !== 'string') throw new ServiceError('the presenter service finished without a link to the clip.', 'failed');
      const url = new URL(job.url, `${base()}/`);
      let res;
      try {
        res = await fetch(url, { headers: url.origin === new URL(base()).origin ? headers(key) : {}, signal: AbortSignal.timeout(120000) });
      } catch (e) {
        throw new ServiceError('the clip could not be downloaded.', 'lost');
      }
      if (!res.ok) throw new ServiceError(`the clip could not be downloaded (${res.status}).`, 'lost');
      return { bytes: Buffer.from(await res.arrayBuffer()), cost_usd: Number.isFinite(job.cost_usd) ? job.cost_usd : null };
    }
    if (job?.status === 'failed') throw new ServiceError(`the presenter service could not make the clip${job.error ? `: ${hideSecrets(job.error).slice(0, 200)}` : ''}.`, 'failed');
    if (Date.now() > until) throw new ServiceError('the presenter service took too long.', 'lost');
    log(`presenter: the service is still making the clip (${job?.status ?? 'waiting'})`);
    await sleep(wait);
  }
}

const connector = {
  id: 'presenter',
  name: 'the presenter service',
  baseUrl: null,
  findKey,
  key: apiKey,
  test,
  avatars,
  start,
  finish,
};
export default connector;
