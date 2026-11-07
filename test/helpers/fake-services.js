// A local server that behaves like the outside services, so that tests spend
// nothing and post nothing. Each service gets a table of routes under its own
// path, and fake.env points the connectors at them. The test guard stops anything
// that tries to go further than this machine.
//
//   const fake = await startFakeServices();
//   t.after(fake.close);
//   spawn(cli, { env: { ...process.env, ...fake.env } });
//   fake.count('openrouter', 'POST /api/v1/chat/completions');
//   fake.plan('openrouter', 'POST /api/v1/chat/completions', { status: 500 }, { drop: true }, { delay: 200 }, { hang: true }, { hold: true });
//   fake.release();   // answers every request that a { hold: true } kept waiting
//
// To add a service, add its routes to ROUTES. A connector with the id "my-service"
// reads its address from EXPLAINROO_MY_SERVICE_URL.
import http from 'node:http';
import crypto from 'node:crypto';

// The one key the fake services accept.
export const GOOD_KEY = 'fake-key-for-tests';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// A sound that differs per text and per purchase, long enough to look like speech.
export function fakeSpeech(text, take = 1) {
  const rate = 24000;
  const seed = crypto.createHash('sha256').update(text).digest()[0];
  const samples = Math.round(rate * Math.max(0.3, 0.05 * [...text].length));
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * (220 + seed + take * 10) * i) / rate)), i * 2);
  return pcm;
}

export const ROUTES = {
  openrouter: {
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

function matches(route, method, pathname) {
  const [routeMethod, pattern] = route.split(' ');
  if (routeMethod !== method) return false;
  return pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

export async function startFakeServices({ routes = {} } = {}) {
  const table = Object.fromEntries(Object.keys({ ...ROUTES, ...routes }).map((service) => [service, { ...ROUTES[service], ...routes[service] }]));
  const requests = [];
  const plans = new Map();
  const waiting = [];
  let holding = [];
  const planKey = (service, route) => `${service} ${route}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const [, service, ...rest] = url.pathname.split('/');
    const pathname = `/${rest.join('/')}`;
    const route = Object.keys(table[service] ?? {}).find((r) => matches(r, req.method, pathname));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = JSON.parse(text); } catch {}
    if (!route) return sendJson(res, 404, { error: { message: `the fake has no route for ${req.method} ${pathname}` } });
    const count = requests.filter((r) => r.service === service && r.route === route).length + 1;
    requests.push({ service, route, method: req.method, pathname, search: url.search, headers: req.headers, body });
    for (const wait of waiting.filter((w) => w.service === service && w.route === route && count >= w.n)) wait.resolve();
    const step = plans.get(planKey(service, route))?.shift() ?? {};
    if (step.hang) return;
    if (step.drop) return req.socket.destroy();
    if (step.delay) await new Promise((resolve) => setTimeout(resolve, step.delay));
    if (step.hold) await new Promise((resolve) => holding.push(resolve));
    if (step.status) return sendJson(res, step.status, step.body ?? { error: { message: `fake error ${step.status}` } });
    if (step.dropBody) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
      res.write('{"cut off');
      return setTimeout(() => req.socket.destroy(), 20);
    }
    table[service][route]({ req, res, body, count });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    env: Object.fromEntries(Object.keys(table).map((service) => [`EXPLAINROO_${service.toUpperCase().replace(/-/g, '_')}_URL`, `${base}/${service}`])),
    requests: (service, route) => requests.filter((r) => r.service === service && r.route === route),
    count: (service, route) => requests.filter((r) => r.service === service && r.route === route).length,
    // The next answers of a route, one for each request.
    plan: (service, route, ...steps) => plans.set(planKey(service, route), steps),
    release: () => {
      for (const resolve of holding) resolve();
      holding = [];
    },
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
