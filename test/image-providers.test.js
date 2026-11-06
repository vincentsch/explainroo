import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig, loadProject, ProjectError } from '../src/project.js';
import { generateImage, imageLog, imageSpend } from '../src/images.js';
import { miniapiBody, miniapiImage, resolveMiniapiModel } from '../src/miniapi.js';

const QUEUE = 'https://api.minicut.ai/v1/queue';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function project(t, images = { provider: 'miniapi' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-images-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ images }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  return loadProject(dir);
}

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A fake MiniAPI: the submit, `statuses` in turn, the result, then the image download.
function fakeMiniapi(t, { model = 'gpt-image-2', statuses = [{ status: 'COMPLETED', error: null }], submit } = {}) {
  setEnv(t, 'MINIAPI_KEY', 'mapi_test_key');
  const calls = [];
  const job = `${QUEUE}/${model}/requests/req-1`;
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === `${QUEUE}/${model}`) {
      if (submit) return submit(calls.length);
      return json({ request_id: 'req-1', status: 'IN_QUEUE', price: '0.159000', currency: 'USD' });
    }
    if (url === `${job}/status`) return json(statuses.shift() ?? { status: 'COMPLETED', error: null });
    if (url === job) {
      return json({ images: [{ url: 'https://files.example.com/out.png?sig=x', content_type: 'image/png' }], billing: { price: '0.159000', currency: 'USD' } });
    }
    if (url === 'https://files.example.com/out.png?sig=x') return new Response(PNG);
    throw new Error(`unexpected request to ${url}`);
  });
  return calls;
}

test('images config accepts a provider and refuses unknown ones', () => {
  assert.equal(normalizeConfig({ images: { provider: 'miniapi' } }).images.provider, 'miniapi');
  assert.equal(normalizeConfig({ images: { provider: 'openrouter', model: 'cheap' } }).images.provider, 'openrouter');
  for (const images of [{ provider: 'bad' }, { provider: 1 }, { provider: 'miniapi', key: 'x' }]) {
    assert.throws(() => normalizeConfig({ images }), ProjectError);
  }
});

test('MiniAPI models: best and cheap are the same two models, ids pass through, other names are refused', () => {
  assert.equal(resolveMiniapiModel(undefined), 'gpt-image-2');
  assert.equal(resolveMiniapiModel('best'), 'gpt-image-2');
  assert.equal(resolveMiniapiModel('cheap'), 'nano-banana-2');
  assert.equal(resolveMiniapiModel('nano-banana-pro'), 'nano-banana-pro');
  for (const name of ['openai/gpt-5.4-image-2', 'Bad Name', '../x']) assert.throws(() => resolveMiniapiModel(name), ProjectError);
});

test('MiniAPI request: GPT Image 2 gets a size for every aspect, other models get the aspect ratio', () => {
  assert.deepEqual(miniapiBody('gpt-image-2', 'p', '16:9'), { prompt: 'p', image_size: 'landscape_16_9' });
  assert.deepEqual(miniapiBody('gpt-image-2', 'p', '9:16'), { prompt: 'p', image_size: 'portrait_16_9' });
  assert.deepEqual(miniapiBody('gpt-image-2', 'p', '3:2'), { prompt: 'p', image_size: { width: 1536, height: 1024 } });
  for (const aspect of ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']) assert.ok(miniapiBody('gpt-image-2', 'p', aspect).image_size);
  assert.deepEqual(miniapiBody('nano-banana-2', 'p', '4:3'), { prompt: 'p', aspect_ratio: '4:3' });
});

test('MiniAPI image: submits, reads the status, downloads the result and logs the price', async (t) => {
  const p = project(t);
  const calls = fakeMiniapi(t);
  const r = await generateImage(p, { name: 'cables', prompt: 'Two cars with jumper cables between the batteries' });

  const [submit, status, result, download] = calls;
  assert.equal(calls.length, 4);
  assert.equal(submit.opts.method, 'POST');
  assert.equal(submit.opts.headers.Authorization, 'Key mapi_test_key');
  assert.match(submit.opts.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  const body = JSON.parse(submit.opts.body);
  assert.equal(body.image_size, 'landscape_16_9');
  assert.match(body.prompt, /^Two cars with jumper cables between the batteries\n\nStyle: Flat illustration/);
  assert.equal(status.url, `${QUEUE}/gpt-image-2/requests/req-1/status`);
  assert.equal(result.url, `${QUEUE}/gpt-image-2/requests/req-1`);
  assert.equal(download.opts.headers, undefined, 'the key is never sent to the download link');

  assert.deepEqual(fs.readFileSync(path.join(p.dir, 'assets', 'cables.png')), PNG);
  assert.equal(r.provider, 'miniapi');
  assert.equal(r.model, 'gpt-image-2');
  assert.equal(r.cost_usd, 0.159);
  assert.equal(r.request_id, 'req-1');
  const [entry] = imageLog(p);
  assert.equal(entry.file, path.join('assets', 'cables.png'));
  assert.equal(imageSpend(p), 0.159);
  assert.ok(!JSON.stringify(entry).includes('mapi_test_key'));
});

test('MiniAPI image: --provider and --model pick the route per image', async (t) => {
  const p = project(t, { provider: 'openrouter' });
  const calls = fakeMiniapi(t, { model: 'nano-banana-2' });
  await generateImage(p, { name: 'cheap', prompt: 'A lighthouse on a rock', model: 'cheap', aspect: '1:1', provider: 'miniapi' });
  assert.deepEqual(JSON.parse(calls[0].opts.body).aspect_ratio, '1:1');
});

test('MiniAPI image: waits while the job runs', async (t) => {
  setEnv(t, 'MINIAPI_KEY', 'mapi_test_key');
  const calls = fakeMiniapi(t, { statuses: [{ status: 'IN_QUEUE', error: null }, { status: 'IN_PROGRESS', error: null }] });
  const r = await miniapiImage({ key: 'mapi_test_key', model: 'gpt-image-2', prompt: 'p', aspect: '16:9', pollMs: 0 });
  assert.equal(calls.filter((c) => c.url.endsWith('/status')).length, 3);
  assert.deepEqual(r.buf, PNG);
});

test('MiniAPI image: a failed job says why and writes no file', async (t) => {
  const p = project(t);
  const calls = fakeMiniapi(t, { statuses: [{ status: 'COMPLETED', state: 'failed', error: { code: 'content_refused', message: 'The prompt was refused.' } }] });
  await assert.rejects(generateImage(p, { name: 'x', prompt: 'something it refuses' }), (e) => e instanceof ProjectError && /content_refused/.test(e.message) && /not charged/.test(e.message));
  assert.equal(calls.length, 2);
  assert.deepEqual(fs.readdirSync(path.join(p.dir, 'assets')), []);
  assert.deepEqual(imageLog(p), []);
});

test('MiniAPI image: a dropped submit is sent again with the same idempotency key', async (t) => {
  const p = project(t);
  const calls = fakeMiniapi(t, {
    submit: (n) => {
      if (n === 1) throw new TypeError('fetch failed');
      return json({ request_id: 'req-1', status: 'IN_QUEUE', price: '0.159000' });
    },
  });
  await generateImage(p, { name: 'retry', prompt: 'A lighthouse on a rock' });
  assert.equal(calls[0].opts.headers['Idempotency-Key'], calls[1].opts.headers['Idempotency-Key']);
});

test('MiniAPI image: key, balance and settings errors are plain messages', async (t) => {
  const p = project(t);
  for (const [status, body, pattern] of [
    [401, { error: { code: 'invalid_api_key', message: 'The key is wrong.' } }, /rejected the API key/],
    [402, { error: { code: 'insufficient_balance', message: 'Your balance is $0.01.' } }, /balance does not cover/],
    [422, { detail: [{ loc: ['body', 'image_size'], msg: 'must be one of square_hd' }] }, /image_size must be one of square_hd/],
  ]) {
    t.mock.restoreAll();
    fakeMiniapi(t, { submit: () => json(body, status) });
    await assert.rejects(generateImage(p, { name: 'x', prompt: 'A lighthouse on a rock' }), (e) => e instanceof ProjectError && pattern.test(e.message));
  }
});

test('MiniAPI image: no key and --ref are refused before anything is sent', async (t) => {
  const p = project(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('nothing may be sent'); });
  setEnv(t, 'MINIAPI_KEY', '');
  await assert.rejects(generateImage(p, { name: 'x', prompt: 'A lighthouse on a rock' }), /MINIAPI_KEY/);
  setEnv(t, 'MINIAPI_KEY', 'mapi_test_key');
  fs.writeFileSync(path.join(p.dir, 'assets', 'a.png'), PNG);
  await assert.rejects(generateImage(p, { name: 'x', prompt: 'A lighthouse on a rock', refs: ['assets/a.png'] }), /--ref works with OpenRouter only/);
  await assert.rejects(generateImage(p, { name: 'x', prompt: 'A lighthouse on a rock', provider: 'other' }), /image provider must be one of/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
