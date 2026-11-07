// The Cartesia voice against a fake server that follows its API reference. It is
// one data entry and one connector, so nothing else in the pipeline names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, normalizeConfig, ProjectError } from '../src/project.js';
import { parseScript, speechChunks } from '../src/script.js';
import { synthesize, sceneChunks } from '../src/voice.js';
import { speechKey } from '../src/paid-speech.js';
import { findService, voiceProviders } from '../src/services.js';
import { listJobs } from '../src/history.js';
import cartesia, { CARTESIA_MODEL, CARTESIA_VERSION } from '../src/connectors/cartesia.js';
import { CARTESIA_VERSION_HEADER, GOOD_KEY, startFakeServices } from './helpers/fake-services.js';
import { runCli } from './helpers/tiny-project.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SPEAK = 'POST /tts/bytes';
const noWords = async () => ({ text: '', words: [] });

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
}

async function setup(t, { script = '# Bread\n## intro\nBread needs four things. Flour comes first. [pause 0.4] Then water.\n\nSalt goes in last.\n', settings = {}, files = {} } = {}) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cartesia-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: { provider: 'cartesia', id: 'calm-reader' }, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  setEnv(t, 'EXPLAINROO_CARTESIA_URL', fake.env.EXPLAINROO_CARTESIA_URL);
  setEnv(t, 'CARTESIA_API_KEY', GOOD_KEY);
  t.mock.method(process.stderr, 'write', () => true);
  const voiceRun = (lang, options = {}) => synthesize(loadProject(dir, { lang }), { transcribe: noWords, ...options });
  const sent = () => fake.requests('cartesia', SPEAK);
  return { fake, dir, voiceRun, sent };
}

test('it is one data entry and one connector, and nothing else in the pipeline names it', () => {
  const service = findService('cartesia');
  assert.equal(service.step, 'voice');
  assert.equal(service.free, false);
  assert.equal(service.partner, false);
  assert.equal(service.cost, 'Paid per character on your Cartesia account.');
  assert.equal(service.data_leaves, 'The narration text goes to Cartesia.');
  assert.deepEqual(service.setup.env, ['CARTESIA_API_KEY']);
  assert.equal(voiceProviders().cartesia.defaults.model, CARTESIA_MODEL);
  assert.equal(CARTESIA_VERSION, '2026-08-14');
  assert.equal(CARTESIA_MODEL, 'sonic-3.6');
  const named = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const rel = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(m?js|json)$/.test(entry.name) && /cartesia/i.test(fs.readFileSync(path.join(root, rel), 'utf8'))) named.push(rel);
    }
  };
  walk('src');
  walk('engine');
  assert.deepEqual(named.sort(), ['src/connectors/cartesia.js', 'src/connectors/index.js', 'src/services.json']);
});

test('a Cartesia voice takes an id and a model, and speaks every language at speed 1 by default', () => {
  const cfg = normalizeConfig({ voice: { provider: 'cartesia', id: 'calm-reader' } });
  assert.deepEqual(cfg.voice, { provider: 'cartesia', id: 'calm-reader', model: 'sonic-3.6' });
  assert.equal(cfg.speed, 1);
  assert.equal(normalizeConfig({ voice: { provider: 'cartesia', id: 'calm-reader', model: 'sonic-3' } }).voice.model, 'sonic-3');
  for (const language of ['es', 'fr', 'it', 'pt-br', 'hi', 'ja', 'zh']) assert.equal(normalizeConfig({ language, voice: { provider: 'cartesia', id: 'x' } }).language, language);
  assert.throws(() => normalizeConfig({ voice: { provider: 'cartesia' } }), /voice\.id is required/);
  assert.throws(() => normalizeConfig({ voice: { provider: 'cartesia', id: 'x', language: 'de' } }), /voice has unknown setting\(s\): language/);
  assert.equal(cartesia.speed(1.8), 1.5);
  // A speed inside the range comes back as it is, so voice prints no note about the range.
  assert.equal(cartesia.speed(0.9 * 1.1), 0.9 * 1.1);
  assert.equal(cartesia.speed(0.5), 0.6);
  assert.equal(cartesia.language('pt-br'), 'pt-BR');
  assert.equal(cartesia.language('es'), 'es');
});

test('it reads from pause to pause, and every other voice keeps its sentence chunks', () => {
  const [scene] = parseScript('## intro\nBread needs four things. Flour comes first. [pause 0.4] Then water.\n\nSalt goes in last.\n').scenes;
  const config = normalizeConfig({});
  assert.deepEqual(speechChunks(scene.units, { ...config, chunks: 'pauses' }).map((c) => [c.gapBefore, c.text]), [
    [0, 'Bread needs four things. Flour comes first.'],
    [0.4, 'Then water.'],
    [0.55, 'Salt goes in last.'],
  ]);
  const sentences = [[0, 'Bread needs four things.'], [0.3, 'Flour comes first.'], [0.7, 'Then water.'], [0.55, 'Salt goes in last.']];
  assert.deepEqual(speechChunks(scene.units, config).map((c) => [c.gapBefore, c.text]), sentences);
  for (const voice of ['af_heart', { provider: 'elevenlabs', id: 'x' }]) {
    const project = { config: normalizeConfig({ voice }) };
    assert.deepEqual(sceneChunks(project, scene).map((c) => [c.gapBefore, c.text]), sentences);
  }
  assert.equal(sceneChunks({ config: normalizeConfig({ voice: { provider: 'cartesia', id: 'x' } }) }, scene).length, 3);
});

test('each request carries the text, the voice, the model, the language and the speed, and is saved under its key', async (t) => {
  const { dir, voiceRun, sent } = await setup(t, { settings: { speed: 0.9, pace: 1.1 } });
  await voiceRun();
  const requests = sent();
  assert.deepEqual(requests.map((r) => r.body.transcript), ['Bread needs four things. Flour comes first.', 'Then water.', 'Salt goes in last.']);
  for (const r of requests) {
    assert.equal(r.headers.authorization, `Bearer ${GOOD_KEY}`);
    assert.equal(r.headers['cartesia-version'], CARTESIA_VERSION_HEADER);
    assert.deepEqual(r.body.voice, { id: 'calm-reader' });
    assert.equal(r.body.model_id, 'sonic-3.6');
    assert.equal(r.body.language, 'en');
    assert.deepEqual(r.body.output_format, { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 });
    assert.equal(r.body.generation_config.speed, 0.99);
  }
  const project = loadProject(dir);
  const jobs = listJobs(dir);
  assert.equal(jobs.length, 3);
  for (const job of jobs) {
    assert.equal(job.provider, 'cartesia');
    assert.equal(job.status, 'done');
    assert.equal(job.request.language, 'en');
    assert.equal(job.key, speechKey(cartesia, project.config, job.request.text));
    assert.ok(fs.existsSync(path.join(dir, job.output.file)));
  }
  // A restart and a moved marker buy nothing again.
  await voiceRun();
  fs.writeFileSync(path.join(dir, 'script.md'), '# Bread\n## intro\n[#start] Bread needs four things. Flour comes first. [pause 0.4] Then water.\n\nSalt goes in last.\n');
  fs.rmSync(path.join(dir, 'build'), { recursive: true });
  await voiceRun();
  assert.equal(sent().length, 3);
});

test('the language goes to Cartesia as its API names it, and the same text in another language is another request', async (t) => {
  const { voiceRun, sent } = await setup(t, {
    script: '# Pan\n## intro\nHola.\n',
    settings: { languages: { es: { voice: { provider: 'cartesia', id: 'voz-clara' } }, 'pt-br': { voice: { provider: 'cartesia', id: 'my-own-voice' } } } },
    files: { 'script.es.md': '# Pan\n## intro\nHola.\n', 'script.pt-br.md': '# Pão\n## intro\nHola.\n' },
  });
  await voiceRun();
  await voiceRun('es');
  await voiceRun('pt-br');
  assert.deepEqual(sent().map((r) => [r.body.transcript, r.body.language, r.body.voice.id]), [['Hola.', 'en', 'calm-reader'], ['Hola.', 'es', 'voz-clara'], ['Hola.', 'pt-BR', 'my-own-voice']]);
});

test('a refusal costs nothing, a server error gets one more try, and a lost answer is never sent again', async (t) => {
  const { dir, fake, voiceRun, sent } = await setup(t, { script: '# Bread\n## intro\nFlour comes first.\n' });
  fake.plan('cartesia', SPEAK, { status: 401, body: { message: 'Invalid API key.' } });
  await assert.rejects(voiceRun(), /Cartesia rejected the API key/);
  fake.plan('cartesia', SPEAK, { status: 402 });
  await assert.rejects(voiceRun(), /no credits left/);
  fake.plan('cartesia', SPEAK, { status: 503 }, { status: 503 });
  await assert.rejects(voiceRun(), (e) => /answered with an error/.test(e.message) && /may have cost money/.test(e.message) && / voice .* --new/.test(e.message));
  assert.equal(sent().length, 4);
  await assert.rejects(voiceRun(), (e) => e instanceof ProjectError && /nothing more was bought/.test(e.message));
  assert.equal(sent().length, 4);
  fake.plan('cartesia', SPEAK, { drop: true });
  await voiceRun(undefined, { fresh: true }).catch(() => {});
  assert.equal(sent().length, 5);
  await assert.rejects(voiceRun(), /nothing more was bought/);
  await voiceRun(undefined, { fresh: true });
  assert.equal(sent().length, 6);
  assert.deepEqual(listJobs(dir).map((j) => j.status).sort(), ['done', 'failed', 'lost', 'refused', 'refused']);
});

test('connect cartesia tests the key with the free voice list, and voices --provider cartesia lists them page by page', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cartesia-settings-'));
  t.after(() => fs.rmSync(settings, { recursive: true, force: true }));
  const env = { ...fake.env, EXPLAINROO_CONFIG: settings, CARTESIA_API_KEY: '' };
  const run = (args, input) => new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, [path.join(root, 'bin/explainroo.js'), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => resolve({ code, stdout, stderr, text: stderr + stdout }));
      child.stdin.end(input ?? '');
    });
  });
  const wrong = await run(['connect', 'cartesia', '--key-stdin', '--json'], 'sk_car_wrong\n');
  assert.equal(wrong.code, 1);
  assert.match(JSON.parse(wrong.stdout).error, /Cartesia rejected the key/);
  assert.equal(fs.existsSync(path.join(settings, '.env')), false);
  const r = await run(['connect', 'cartesia', '--key-stdin', '--json'], `${GOOD_KEY}\n`);
  assert.equal(r.code, 0, r.text);
  assert.equal(fs.readFileSync(path.join(settings, '.env'), 'utf8'), `CARTESIA_API_KEY=${GOOD_KEY}\n`);
  assert.ok(!r.text.includes(GOOD_KEY));
  const checks = fake.requests('cartesia', 'GET /voices');
  assert.equal(checks.length, 2);
  assert.equal(checks[1].search, '?limit=1');
  assert.equal(fake.count('cartesia', SPEAK), 0, 'testing the key bought nothing');

  const all = await runCli(['voices', '--provider', 'cartesia', '--json'], env);
  assert.equal(all.code, 0, all.text);
  assert.deepEqual(JSON.parse(all.stdout).voices.map((v) => v.id), ['calm-reader', 'warm-teacher', 'voz-clara', 'my-own-voice']);
  assert.deepEqual(JSON.parse(all.stdout).voices[3], { name: 'My Own Voice', id: 'my-own-voice', labels: { accent: 'pt-BR', owner: 'you' } });
  const spanish = await runCli(['voices', '--provider', 'cartesia', '--language', 'pt-br', '--json'], env);
  assert.deepEqual(JSON.parse(spanish.stdout).voices.map((v) => v.id), ['my-own-voice']);
  assert.match(fake.requests('cartesia', 'GET /voices').at(-1).search, /language=pt-BR/);
  const human = await runCli(['voices', '--cartesia'], env);
  assert.match(human.stdout, /^Calm Reader {2}calm-reader {2}accent: en-US, gender: feminine$/m);
  const services = await runCli(['services', 'voice', '--json'], env);
  assert.equal(JSON.parse(services.stdout).services.find((s) => s.id === 'cartesia').connected, true);
});

test('the voice list follows every page', async (t) => {
  const fake = await startFakeServices({ routes: { cartesia: { 'GET /voices': ({ req, res }) => {
    const after = new URL(req.url, 'http://fake').searchParams.get('starting_after');
    const page = after ? [{ id: 'b', name: 'B' }] : [{ id: 'a', name: 'A' }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: page, has_more: !after, next_page: after ? null : 'a' }));
  } } } });
  t.after(fake.close);
  setEnv(t, 'EXPLAINROO_CARTESIA_URL', fake.env.EXPLAINROO_CARTESIA_URL);
  setEnv(t, 'CARTESIA_API_KEY', GOOD_KEY);
  t.mock.method(process.stderr, 'write', () => true);
  assert.deepEqual((await cartesia.voices('.')).map((v) => v.id), ['a', 'b']);
  assert.match(fake.requests('cartesia', 'GET /voices')[1].search, /starting_after=a/);
});

test('without a key nothing is sent, and the error points at connect', async (t) => {
  const { voiceRun, sent } = await setup(t);
  setEnv(t, 'CARTESIA_API_KEY', '');
  setEnv(t, 'EXPLAINROO_CONFIG', fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-empty-settings-')));
  await assert.rejects(voiceRun(), (e) => e instanceof ProjectError && /explainroo connect cartesia/.test(e.message));
  assert.equal(sent().length, 0);
});
