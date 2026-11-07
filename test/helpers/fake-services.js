// A local server that behaves like the outside services, so that tests spend
// nothing and post nothing. Each service gets a table of routes under its own
// path, and fake.env points the connectors at them. The test guard stops anything
// that tries to go further than this machine.
//
//   const fake = await startFakeServices();
//   t.after(fake.close);
//   spawn(cli, { env: { ...process.env, ...fake.env } });
//   fake.count('openrouter', 'POST /api/v1/chat/completions');
//   fake.plan('openrouter', 'POST /api/v1/chat/completions', { status: 500 }, { drop: true }, { delay: 200 }, { hang: true }, { hold: true }, { raw: Buffer.from('x') });
//   fake.plan('cloud', 'POST /api/v1/shares', { cut: true }, { status: 404, html: '<p>Not found</p>' }, { status: 429, headers: { 'Retry-After': '120' } });
//   fake.release();   // answers every request that a { hold: true } kept waiting
//
// { cut: true } drops the connection while the request body is still coming in.
// Each request keeps its raw body, so a test can read a multipart upload. A plan
// step the server doesn't know goes to the route, such as { keep: 1000 } for a
// YouTube upload. fake-publishing.js has the posting services and their sign-ins.
//
// To add a service, add its routes to ROUTES. A connector with the id "my-service"
// reads its address from EXPLAINROO_MY_SERVICE_URL.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath } from '../../src/ffmpeg.js';
import { PUBLISHING_ROUTES, approveLink, expireAccess, loginLines, publishingState } from './fake-publishing.js';

// The one key the fake services accept.
export const GOOD_KEY = 'fake-key-for-tests';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// A sound that differs per text and per purchase, long enough to look like speech.
export function fakeSpeech(text, take = 1, rate = 24000) {
  const seed = crypto.createHash('sha256').update(text).digest()[0];
  const samples = Math.round(rate * Math.max(0.3, 0.05 * [...text].length));
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * (220 + seed + take * 10) * i) / rate)), i * 2);
  return pcm;
}

// A saved copy of the public list, and the price per second these clips are charged at.
const VIDEO_MODELS = fs.readFileSync(new URL('../fixtures/openrouter-video-models.json', import.meta.url));
export const FAKE_CLIP_USD_PER_SECOND = 0.03;

// A small real MP4 of the asked length. It differs per purchase, and it has a sound if one was asked for.
export function fakeClip({ duration = 6, generate_audio: audio = false }, take) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-fake-clip-'));
  try {
    const file = path.join(dir, 'clip.mp4');
    const hue = crypto.createHash('sha256').update(String(take)).digest()[0];
    const made = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=30:d=${duration},hue=h=${hue}`, ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${duration}`] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', ...(audio ? ['-c:a', 'aac'] : []), file]);
    if (made.status !== 0) throw new Error(`the fake could not make a clip: ${made.stderr}`);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const videoId = (pathname) => decodeURIComponent(pathname.split('/')[4]);

// Cartesia as its API reference describes it on 2026-11-07: the key in a Bearer
// header, the version in Cartesia-Version, raw PCM from /tts/bytes and a voice
// list in pages of at most 100.
export const CARTESIA_VERSION_HEADER = '2026-08-14';
const CARTESIA_MODELS = ['sonic-3.6', 'sonic-3.5', 'sonic-3', 'sonic-latest'];
const CARTESIA_RATES = [8000, 16000, 22050, 24000, 44100, 48000];
export const CARTESIA_VOICES = [
  { id: 'calm-reader', name: 'Calm Reader', gender: 'feminine', accents: [{ accent: 'us', locale: 'en-US', is_native: true }], is_owner: false },
  { id: 'warm-teacher', name: 'Warm Teacher', gender: 'masculine', accents: [{ accent: 'gb', locale: 'en-GB', is_native: true }], is_owner: false },
  { id: 'voz-clara', name: 'Voz Clara', gender: 'feminine', accents: [{ accent: 'es', locale: 'es-ES', is_native: true }], is_owner: false },
  { id: 'my-own-voice', name: 'My Own Voice', gender: null, accents: [{ accent: 'br', locale: 'pt-BR', is_native: true }], is_owner: true },
];

function cartesiaAllowed(req, res) {
  if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
    sendJson(res, 401, { message: 'Invalid API key.' });
    return false;
  }
  if (req.headers['cartesia-version'] !== CARTESIA_VERSION_HEADER) {
    sendJson(res, 400, { message: 'Cartesia-Version must be 2026-08-14.' });
    return false;
  }
  return true;
}

// What the reference requires of a request to /tts/bytes, or null.
function cartesiaProblem(body) {
  if (!body || typeof body !== 'object') return 'The body must be JSON.';
  if (!CARTESIA_MODELS.includes(body.model_id)) return `model_id must be one of ${CARTESIA_MODELS.join(', ')}.`;
  if (typeof body.transcript !== 'string' || !body.transcript.trim()) return 'transcript is required.';
  const voice = typeof body.voice === 'string' ? body.voice : body.voice?.id;
  if (typeof voice !== 'string' || !voice) return 'voice must be an id or { "id": "..." }.';
  if (!CARTESIA_VOICES.some((v) => v.id === voice)) return 'voice not found.';
  if (body.language !== undefined && body.locale !== undefined) return 'Send language or locale, not both.';
  const format = body.output_format;
  if (!format || !['raw', 'wav', 'mp3'].includes(format.container)) return 'output_format.container must be raw, wav or mp3.';
  if (format.container === 'raw' && (!['pcm_f32le', 'pcm_s16le', 'pcm_mulaw', 'pcm_alaw'].includes(format.encoding) || !CARTESIA_RATES.includes(format.sample_rate))) return 'raw output needs an encoding and a sample_rate.';
  const speed = body.generation_config?.speed;
  if (speed !== undefined && !(speed >= 0.6 && speed <= 1.5)) return 'generation_config.speed must be between 0.6 and 1.5.';
  return null;
}

// What a request with a multipart body sent.
export async function formFields(request) {
  return new Response(request.raw, { headers: { 'content-type': request.headers['content-type'] ?? '' } }).formData();
}

// The hosted service: a share with no key expires and has a claim link, and one
// with an account's key does not.
const SHARE_DAYS = 7;
async function shareRoute({ req, res, raw, count }) {
  const auth = req.headers.authorization;
  if (auth !== undefined && auth !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { message: 'Unauthenticated.' });
  let form;
  try {
    form = await formFields({ raw, headers: req.headers });
  } catch {
    return sendJson(res, 422, { message: 'The video field is required.', errors: { video: ['The video field is required.'] } });
  }
  const video = form.get('video');
  const title = form.get('title');
  if (!(video instanceof Blob)) return sendJson(res, 422, { message: 'The video field is required.', errors: { video: ['The video field is required.'] } });
  if (typeof title !== 'string' || !title.trim()) return sendJson(res, 422, { message: 'The title field is required.', errors: { title: ['The title field is required.'] } });
  const head = Buffer.from(await video.slice(0, 12).arrayBuffer());
  const mp4 = head.subarray(4, 8).toString('latin1') === 'ftyp';
  const webm = head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!mp4 && !webm) return sendJson(res, 415, { message: 'The video must be an MP4 or WebM file.' });
  const id = `share${count}`;
  const account = auth !== undefined;
  sendJson(res, 201, {
    id,
    url: `https://www.explainroo.com/v/${id}`,
    media_url: `https://www.explainroo.com/media/${id}.${mp4 ? 'mp4' : 'webm'}`,
    expires_at: account ? null : new Date(Date.now() + SHARE_DAYS * 86400000).toISOString(),
    claim_url: account ? null : `https://www.explainroo.com/claim/${id}-secret`,
  });
}

export const ROUTES = {
  ...PUBLISHING_ROUTES,
  cloud: {
    'POST /api/v1/shares': shareRoute,
  },
  openrouter: {
    'GET /api/v1/videos/models': ({ res }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(VIDEO_MODELS);
    },
    'POST /api/v1/videos': ({ req, res, body, count, state }) => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { error: { message: 'No auth credentials found' } });
      const id = `job_${count}`;
      state.videos.set(id, { body, take: count });
      sendJson(res, 202, { id, polling_url: `http://elsewhere.invalid/api/v1/videos/${id}`, status: 'pending' });
    },
    'GET /api/v1/videos/*/content': ({ req, res, pathname, state }) => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { error: { message: 'No auth credentials found' } });
      const video = state.videos.get(videoId(pathname));
      if (!video) return sendJson(res, 404, { error: { message: 'not found' } });
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(fakeClip(video.body, video.take));
    },
    'GET /api/v1/videos/*': ({ req, res, pathname, state }) => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { error: { message: 'No auth credentials found' } });
      const id = videoId(pathname);
      const video = state.videos.get(id);
      if (!video) return sendJson(res, 404, { error: { message: 'not found' } });
      sendJson(res, 200, {
        id,
        generation_id: `gen-${id}`,
        status: 'completed',
        unsigned_urls: [`http://elsewhere.invalid/api/v1/videos/${id}/content?index=0`],
        usage: { cost: Math.round(FAKE_CLIP_USD_PER_SECOND * (video.body.duration ?? 6) * 10000) / 10000, is_byok: false },
      });
    },
    'GET /api/v1/key': ({ req, res }) => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { error: { message: 'No auth credentials found' } });
      sendJson(res, 200, { data: { label: 'fake', usage: 0 } });
    },
    'POST /api/v1/chat/completions': ({ req, res, body, count }) => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return sendJson(res, 401, { error: { message: 'No auth credentials found' } });
      const bytes = Buffer.concat([PIXEL, Buffer.from(`${count}:${body.messages?.[0]?.content?.[0]?.text}`)]);
      sendJson(res, 200, {
        model: body.model,
        choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] } }],
        usage: { cost: 0.1, prompt_tokens: 10, completion_tokens: 20 },
      });
    },
  },
  cartesia: {
    'GET /voices': ({ req, res }) => {
      if (!cartesiaAllowed(req, res)) return;
      const query = new URL(req.url, 'http://fake').searchParams;
      const limit = Number(query.get('limit') ?? 10);
      if (!(Number.isInteger(limit) && limit >= 1 && limit <= 100)) return sendJson(res, 400, { message: 'limit must be between 1 and 100.' });
      const language = query.get('language')?.toLowerCase().replace('_', '-');
      const all = CARTESIA_VOICES.filter((v) => !language || v.accents.some((a) => a.locale.toLowerCase() === language || a.locale.toLowerCase().startsWith(`${language}-`)));
      const after = query.get('starting_after');
      const from = after ? all.findIndex((v) => v.id === after) + 1 : 0;
      const page = all.slice(from, from + limit);
      const more = from + limit < all.length;
      sendJson(res, 200, { data: page, has_more: more, next_page: more ? page.at(-1).id : null });
    },
    'POST /tts/bytes': ({ req, res, body, count }) => {
      if (!cartesiaAllowed(req, res)) return;
      const problem = cartesiaProblem(body);
      if (problem) return sendJson(res, problem === 'voice not found.' ? 404 : 400, { message: problem });
      if (body.output_format.encoding !== 'pcm_s16le') return sendJson(res, 400, { message: 'this fake makes pcm_s16le only' });
      res.writeHead(200, { 'Content-Type': 'audio/pcm' });
      res.end(fakeSpeech(body.transcript, count, body.output_format.sample_rate));
    },
  },
  elevenlabs: {
    'GET /v2/voices': ({ req, res }) => {
      if (req.headers['xi-api-key'] !== GOOD_KEY) return sendJson(res, 401, { detail: { status: 'invalid_api_key' } });
      sendJson(res, 200, { voices: [{ name: 'Fake', voice_id: 'fake-voice', labels: {} }], has_more: false });
    },
    'POST /v1/text-to-speech/*': ({ req, res, body, count }) => {
      if (req.headers['xi-api-key'] !== GOOD_KEY) return sendJson(res, 401, { detail: { status: 'invalid_api_key' } });
      res.writeHead(200, { 'Content-Type': 'audio/pcm' });
      res.end(fakeSpeech(body.text, count));
    },
  },
};

// A "*" at the end of a route matches the rest of the address, and one in the middle one part of it.
function matches(route, method, pathname) {
  const [routeMethod, pattern] = route.split(' ');
  if (routeMethod !== method) return false;
  if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) return pathname.startsWith(pattern.slice(0, -1));
  return new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`).test(pathname);
}

export async function startFakeServices({ routes = {} } = {}) {
  const table = Object.fromEntries(Object.keys({ ...ROUTES, ...routes }).map((service) => [service, { ...ROUTES[service], ...routes[service] }]));
  const requests = [];
  const plans = new Map();
  const waiting = [];
  const state = { videos: new Map(), publishing: publishingState() };
  let holding = [];
  let unmatched = 0;
  const planKey = (service, route) => `${service} ${route}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const [, service, ...rest] = url.pathname.split('/');
    const pathname = `/${rest.join('/')}`;
    const route = Object.keys(table[service] ?? {}).find((r) => matches(r, req.method, pathname));
    // A cut has to happen while the body is still coming in.
    const cut = route && plans.get(planKey(service, route))?.[0]?.cut ? plans.get(planKey(service, route)).shift() : null;
    const chunks = [];
    const { socket } = req;
    for await (const chunk of req) {
      chunks.push(chunk);
      if (cut) break;
    }
    const raw = Buffer.concat(chunks);
    let body = null;
    try { body = JSON.parse(raw.toString('utf8')); } catch {}
    if (!route) {
      unmatched++;
      return sendJson(res, 404, { error: { message: `the fake has no route for ${req.method} ${pathname}` } });
    }
    const count = requests.filter((r) => r.service === service && r.route === route).length + 1;
    requests.push({ service, route, method: req.method, pathname, search: url.search, headers: req.headers, body, raw });
    for (const wait of waiting.filter((w) => w.service === service && w.route === route && count >= w.n)) wait.resolve();
    if (cut) return socket.destroy();
    const step = plans.get(planKey(service, route))?.shift() ?? {};
    if (step.hang) return;
    if (step.drop) return req.socket.destroy();
    if (step.delay) await new Promise((resolve) => setTimeout(resolve, step.delay));
    if (step.hold) await new Promise((resolve) => holding.push(resolve));
    if (step.raw) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(step.raw);
    }
    if (step.html !== undefined) {
      res.writeHead(step.status ?? 200, { 'Content-Type': 'text/html; charset=utf-8', ...step.headers });
      return res.end(step.html);
    }
    if (step.status) {
      res.writeHead(step.status, { 'Content-Type': 'application/json', ...step.headers });
      return res.end(JSON.stringify(step.body ?? { error: { message: `fake error ${step.status}` } }));
    }
    if (step.dropBody) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
      res.write('{"cut off');
      return setTimeout(() => req.socket.destroy(), 20);
    }
    Promise.resolve(table[service][route]({ req, res, body, raw, count, pathname, state, step })).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { error: { message: `the fake failed: ${e.message}` } });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    env: Object.fromEntries(Object.keys(table).map((service) => [`EXPLAINROO_${service.toUpperCase().replace(/-/g, '_')}_URL`, `${base}/${service}`])),
    requests: (service, route) => requests.filter((r) => r.service === service && r.route === route),
    count: (service, route) => requests.filter((r) => r.service === service && r.route === route).length,
    // Every request, also one to an address the fake doesn't know.
    total: () => requests.length + unmatched,
    // The next answers of a route, one for each request.
    plan: (service, route, ...steps) => plans.set(planKey(service, route), steps),
    release: () => {
      for (const resolve of holding) resolve();
      holding = [];
    },
    // The browser step of a sign-in: approving the printed link gives the address it lands on.
    approve: (link, options) => approveLink(state.publishing, link, options),
    // Channels, accounts, uploads and posts of the posting services, to set up or read.
    publishing: state.publishing,
    // The .env lines of a login to youtube or buffer, made without the browser.
    login: (service) => loginLines(state.publishing, service),
    // Ends the access tokens of a service, as an hour would.
    expireAccess: (service) => expireAccess(state.publishing, service),
    // Resolves once a route has seen n requests.
    until: (service, route, n = 1) => new Promise((resolve) => {
      if (requests.filter((r) => r.service === service && r.route === route).length >= n) resolve();
      else waiting.push({ service, route, n, resolve });
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
