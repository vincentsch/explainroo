// Today's clip prices in "explainroo services", through the real command line
// against the fake OpenRouter list. The cache folder is a temp folder, so no test
// keeps a price in ~/.cache/explainroo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const LIST = 'GET /api/v1/videos/models';
const HOUR = 60 * 60 * 1000;
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => day(new Date());
// What the default models take: from the list, and from explainroo's own table when
// the range shows instead.
const TAKES = {
  cheap: { seconds: [4, 6, 8], aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p'] },
  quality: { seconds: [4, 6, 8], aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p', '4K'] },
};
const range = (because) => ({ shown: 'range', because, models: [
  { name: 'cheap', id: 'google/veo-3.1-lite', takes: { ...TAKES.cheap, from: 'table' } },
  { name: 'quality', id: 'google/veo-3.1', takes: { ...TAKES.quality, from: 'table' } },
] });

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-prices-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A key is in the environment, and it must never go along with the list.
async function setup(t, options) {
  const fake = await startFakeServices(options);
  t.after(fake.close);
  const cache = temp(t);
  const empty = temp(t);
  const env = { ...process.env, ...fake.env, EXPLAINROO_CACHE: cache, EXPLAINROO_CONFIG: temp(t), EXPLAINROO_OFFLINE: '', OPENROUTER_API_KEY: GOOD_KEY };
  const cli = (args, extra = {}) => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [bin, ...args], { cwd: empty, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
  });
  const prices = async (extra) => {
    const r = await cli(['services', 'clips', '--json'], extra);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /test guard/);
    return JSON.parse(r.stdout).services.find((s) => s.id === 'openrouter').prices;
  };
  const keptFiles = () => (fs.existsSync(path.join(cache, 'prices')) ? fs.readdirSync(path.join(cache, 'prices')).map((name) => path.join(cache, 'prices', name)) : []);
  const kept = () => JSON.parse(fs.readFileSync(keptFiles()[0], 'utf8'));
  // Makes the kept answer look read `hours` ago.
  const age = (hours) => {
    const file = keptFiles()[0];
    fs.writeFileSync(file, JSON.stringify({ ...kept(), read: new Date(Date.now() - hours * HOUR).toISOString() }));
  };
  t.after(() => assert.ok(fake.requests('openrouter', LIST).every((q) => q.headers.authorization === undefined), 'a request for the price list carried a key'));
  return { fake, cache, empty, cli, prices, keptFiles, kept, age, requests: () => fake.count('openrouter', LIST) };
}

test('services clips shows the price per second of the cheap and the quality model, with the date the list was read', async (t) => {
  const { fake, cli, prices, requests, empty } = await setup(t);
  const r = await cli(['services', 'clips']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Prices at 720p without sound, from OpenRouter's list read on ${today()}:\\n {6}cheap {4}google/veo-3\\.1-lite {2}\\$0\\.03 a second\\n {15}takes 4, 6 or 8 seconds, 16:9 or 9:16, at 720p or 1080p\\n {6}quality  google/veo-3\\.1 {7}\\$0\\.20 a second\\n {15}takes 4, 6 or 8 seconds, 16:9 or 9:16, at 720p, 1080p or 4K\\n`));
  assert.doesNotMatch(r.stdout, /half a cent|Offline mode|could not be read/);
  assert.equal(requests(), 1);

  const json = await prices();
  assert.deepEqual(Object.keys(json), ['shown', 'read', 'url', 'settings', 'models']);
  assert.equal(json.shown, 'prices');
  assert.equal(json.url, `${fake.env.EXPLAINROO_OPENROUTER_URL}/api/v1/videos/models`);
  assert.ok(Date.now() - Date.parse(json.read) < HOUR);
  assert.deepEqual(json.settings, { resolution: '720p', audio: false });
  assert.deepEqual(json.models, [
    { name: 'cheap', id: 'google/veo-3.1-lite', usd_per_second: 0.03, rate_name: 'duration_seconds_without_audio_720p', takes: { ...TAKES.cheap, from: 'openrouter' } },
    { name: 'quality', id: 'google/veo-3.1', usd_per_second: 0.2, rate_name: 'duration_seconds_without_audio', takes: { ...TAKES.quality, from: 'openrouter' } },
  ]);
  // Plain services lists the clips step, so it shows them too, from the same kept answer.
  assert.match((await cli(['services'])).stdout, /quality {2}google\/veo-3\.1 {7}\$0\.20 a second/);
  assert.equal(requests(), 1);

  // The dry run works the price out the same way, from a fresh list of its own.
  for (const [i, model] of ['cheap', 'quality'].entries()) {
    const dry = JSON.parse((await cli(['clip', 'A busy street at dusk in the rain', '--seconds', '6', '--dry-run', '--model', model, '--json'])).stdout);
    assert.deepEqual([dry.model, dry.usd_per_second, dry.rate_name, dry.takes], [json.models[i].id, json.models[i].usd_per_second, json.models[i].rate_name, json.models[i].takes]);
  }
  assert.equal(requests(), 3);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('a kept answer younger than a day makes no request, and an older one is read again and kept', async (t) => {
  const { cli, prices, requests, kept, keptFiles, age } = await setup(t);
  const first = await prices();
  assert.equal(requests(), 1);
  assert.equal(keptFiles().length, 1);
  assert.equal(kept().read, first.read);
  assert.ok(Array.isArray(kept().data));

  age(23);
  const young = await prices();
  assert.equal(requests(), 1);
  assert.equal(young.read, kept().read);
  assert.equal(young.models[0].usd_per_second, 0.03);

  age(25);
  const old = kept().read;
  const fresh = await prices();
  assert.equal(requests(), 2);
  assert.notEqual(fresh.read, old);
  assert.ok(Date.now() - Date.parse(fresh.read) < HOUR);
  assert.equal(kept().read, fresh.read);
  assert.match((await cli(['services', 'clips'])).stdout, new RegExp(`list read on ${today()}`));
  assert.equal(requests(), 2);
  assert.equal(keptFiles().length, 1);
});

// The JSON keeps the time in UTC, and the text gives the user's own date. Each zone
// is picked so that its date differs from the UTC date of the read.
test('services clips gives the date the list was read in the time zone of the computer', async (t) => {
  const { cli, prices, requests, age } = await setup(t);
  await prices();
  age(1);
  const { read } = await prices();
  const ahead = new Date(read).getUTCHours() >= 12;
  const zone = ahead ? 'Pacific/Kiritimati' : 'Etc/GMT+12';
  const local = new Date(Date.parse(read) + (ahead ? 14 : -12) * HOUR).toISOString().slice(0, 10);
  assert.notEqual(local, read.slice(0, 10));
  const r = await cli(['services', 'clips'], { TZ: zone });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`list read on ${local}:`));
  assert.equal(requests(), 1);
});

test('offline mode shows the range at once, without a request, also when a fresh answer is kept', async (t) => {
  const { cli, prices, requests, keptFiles } = await setup(t);
  const offline = { EXPLAINROO_OFFLINE: '1' };
  assert.deepEqual(await prices(offline), range('offline'));
  assert.equal(requests(), 0);
  assert.deepEqual(keptFiles(), []);
  await prices();
  assert.equal(requests(), 1);
  const r = await cli(['services', 'clips'], offline);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Prices: Offline mode is on \(EXPLAINROO_OFFLINE=1\), so here is the range instead of today's prices\. On 2026-11-07 the video models explainroo can price cost from about half a cent to 60 cents a second\./);
  assert.doesNotMatch(r.stdout, /a second\n {6}cheap|list read on/);
  assert.match(r.stdout, /\n {4}The models:\n {6}cheap {4}google\/veo-3\.1-lite\n {15}takes 4, 6 or 8 seconds, 16:9 or 9:16, at 720p or 1080p, from explainroo's own table\n/);
  assert.deepEqual(await prices(offline), range('offline'));
  assert.equal(requests(), 1);
});

test('when the list cannot be read, it shows the range and says why, and never an answer older than a day', async (t) => {
  const { fake, cli, prices, requests, kept, age } = await setup(t);
  await prices();
  age(25);
  const old = kept();
  for (const step of [{ status: 503 }, { drop: true }, { status: 200, body: { error: 'no list' } }]) {
    fake.plan('openrouter', LIST, step);
    assert.deepEqual(await prices(), range('unreadable'), JSON.stringify(step));
  }
  fake.plan('openrouter', LIST, { status: 503 });
  const r = await cli(['services', 'clips']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Prices: Today's prices could not be read, so here is the range\. On 2026-11-07 the video models/);
  assert.equal(requests(), 5);
  // The old answer stays as it was, and it is still too old to show.
  assert.deepEqual(kept(), old);
  // With the fake gone, it is the same.
  await fake.close();
  assert.deepEqual(await prices(), range('unreadable'));
});

test('a list that does not answer holds services up for a few seconds at most', async (t) => {
  const { fake, cli, requests, keptFiles } = await setup(t);
  fake.plan('openrouter', LIST, { hang: true });
  const r = await cli(['services', 'clips', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).services.find((s) => s.id === 'openrouter').prices, range('unreadable'));
  assert.equal(requests(), 1);
  // A dry run waits up to 30 seconds for the same list. services gives up after 4.
  assert.ok(r.ms < 15000, `services took ${r.ms} ms`);
  assert.deepEqual(keptFiles(), []);
});

test('a default model that is not in the list gets the range, and the other one keeps its price', async (t) => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/openrouter-video-models.json', import.meta.url), 'utf8'));
  const withoutQuality = { ...fixture, data: fixture.data.filter((m) => m.id !== 'google/veo-3.1') };
  const { cli, prices } = await setup(t, { routes: { openrouter: { [LIST]: ({ res }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(withoutQuality)); } } } });
  const json = await prices();
  assert.equal(json.shown, 'prices');
  assert.deepEqual(json.models.map((m) => [m.id, m.usd_per_second]), [['google/veo-3.1-lite', 0.03], ['google/veo-3.1', null]]);
  const r = await cli(['services', 'clips']);
  assert.match(r.stdout, /cheap {4}google\/veo-3\.1-lite {2}\$0\.03 a second\n.*\n {6}quality  google\/veo-3\.1 {7}no price in that list\n {15}takes 4, 6 or 8 seconds, 16:9 or 9:16, at 720p, 1080p or 4K, from explainroo's own table\n {4}A model with no price in that list has the range\. On 2026-11-07 the video models/);
  assert.deepEqual(json.models[1].takes, { ...TAKES.quality, from: 'table' });
});

test('each address keeps its own answer in the cache folder, so prices from a fake never mix with real ones', async (t) => {
  const one = await setup(t);
  const other = await startFakeServices();
  t.after(other.close);
  await one.prices();
  const viaOther = await one.prices({ ...other.env });
  assert.equal(viaOther.url, `${other.env.EXPLAINROO_OPENROUTER_URL}/api/v1/videos/models`);
  const files = one.keptFiles();
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => path.dirname(file) === path.join(one.cache, 'prices')));
  assert.deepEqual(files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')).url).sort(), [`${one.fake.env.EXPLAINROO_OPENROUTER_URL}/api/v1/videos/models`, viaOther.url].sort());
  for (const file of files) assert.match(path.basename(file), /^127\.0\.0\.1-\d+-[0-9a-f]{12}\.json$/);
  assert.equal(one.requests() + other.count('openrouter', LIST), 2);
});
