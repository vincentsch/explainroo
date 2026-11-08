import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SERVICES, STEPS, findService, findStep, forStep, formatServices, needsKey, oneOf, serviceLabels, serviceSteps, stepServices, voiceProviders } from '../src/services.js';
import { CONNECTORS, findConnector } from '../src/connectors/index.js';
import { normalizeConfig, ProjectError } from '../src/project.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
// services reads OpenRouter's price list when it lists clips. Offline mode keeps
// these runs from asking for it, and a test that wants the list uses the fake.
const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_OFFLINE: '1', ...env } });
// Every entry as it reads under each step it serves.
const views = SERVICES.flatMap((s) => serviceSteps(s).map((step) => forStep(s, step)));

test('the steps are the ones the docs name', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['voice', 'timing', 'images', 'clips', 'music', 'sharing', 'posting']);
  for (const step of STEPS) assert.ok(step.name && step.what, step.id);
});

test('every entry says what it costs, what data leaves and how to set it up for each step it serves, and none is a paid partner', () => {
  assert.equal(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length);
  for (const s of SERVICES) {
    const steps = serviceSteps(s);
    assert.ok(steps.length > 0 && steps.every((step) => STEPS.some((x) => x.id === step)), `${s.id}: ${s.step} is not a step`);
    assert.equal(new Set(steps).size, steps.length, s.id);
    // What differs per step is in per_step, which an entry with one step doesn't need.
    if (steps.length > 1) {
      assert.deepEqual(Object.keys(s.per_step), steps, s.id);
      for (const field of ['cost', 'data_leaves', 'use']) assert.equal(Object.hasOwn(s.setup, field) || Object.hasOwn(s, field), false, `${s.id}: ${field} belongs in per_step`);
    } else assert.equal(s.per_step, undefined, s.id);
    assert.equal(s.connector, undefined, `${s.id}: every entry has its own connector now`);
    assert.equal(typeof s.free, 'boolean', s.id);
    assert.equal(s.partner, false, s.id);
    assert.ok(['available', 'coming'].includes(s.status), s.id);
    assert.ok(Array.isArray(s.setup.env), s.id);
    assert.ok(s.setup.steps.length > 0 && s.setup.steps.every((step) => typeof step === 'string' && step.trim()), s.id);
  }
  for (const s of views) {
    for (const field of ['name', 'about', 'cost', 'data_leaves']) assert.ok(typeof s[field] === 'string' && s[field].trim(), `${s.id} under ${s.step}: ${field}`);
    assert.equal(typeof s.step, 'string', s.id);
    assert.ok(typeof s.setup.use === 'string' && s.setup.use.trim(), `${s.id} under ${s.step}`);
    if (s.free) {
      // A free service needs no key, at most a login to the user's own account.
      if (s.setup.login !== 'oauth') assert.deepEqual(s.setup.env, [], `${s.id} is free, so it needs no key`);
      assert.match(s.cost, /^Free/, s.id);
    } else assert.match(s.cost, /Paid/, `${s.id} under ${s.step}`);
  }
});

test('within each step free entries come first, and the first entry of every step is free', () => {
  for (const step of STEPS) {
    const entries = stepServices(step.id);
    assert.ok(entries.length > 0, step.id);
    assert.equal(entries[0].free, true, step.id);
    assert.equal(entries.findIndex((s) => !s.free) === -1 || entries.slice(entries.findIndex((s) => !s.free)).every((s) => !s.free), true, step.id);
  }
});

test('the first list holds what exists today', () => {
  assert.deepEqual(SERVICES.map((s) => s.id), ['kokoro', 'recording', 'elevenlabs', 'cartesia', 'whisper', 'own-images', 'own-footage', 'openrouter', 'built-in-music', 'own-music', 'soundroo', 'web-player', 'cloud', 'package', 'youtube', 'buffer', 'blotato']);
});

test('the hosted link is coming and says what leaves the computer, and package is the free route for posting', () => {
  const link = findService('cloud');
  assert.equal(link.step, 'sharing');
  assert.equal(link.status, 'coming');
  assert.equal(link.free, true);
  assert.match(link.data_leaves, /^The video file and its title go to explainroo\.com, and only when you run "explainroo share"\.$/);
  assert.match(link.cost, /without an account expires/);
  assert.match(link.setup.steps.join(' '), /EXPLAINROO_CLOUD_KEY/);
  assert.equal(findConnector('cloud').baseUrl, 'https://www.explainroo.com');
  const posting = SERVICES.filter((s) => s.step === 'posting');
  assert.equal(posting[0].id, 'package');
  assert.equal(posting[0].free, true);
  assert.match(posting[0].setup.use, /explainroo package <project> --platform tiktok/);
  assert.match(posting[0].data_leaves, /Nothing leaves your computer until you upload/);
  assert.equal(findService('upload-by-hand'), null);
  assert.match(run(['services', 'sharing']).stdout, /Hosted link on explainroo\.com \(free, coming\)/);
  const connect = run(['connect', 'cloud']);
  assert.equal(connect.status, 0, connect.stderr);
  assert.match(connect.stdout, /needs no setting up/);
});

test('a service with a key has a connector with a free key test, and a connector has an entry', () => {
  for (const s of SERVICES.filter(needsKey)) {
    const connector = findConnector(s.id);
    assert.ok(connector, s.id);
    assert.equal(typeof connector.test, 'function', s.id);
    assert.ok(/^https:\/\//.test(s.setup.url), s.id);
  }
  for (const connector of CONNECTORS) {
    assert.ok(findService(connector.id), connector.id);
    assert.ok(/^https:\/\//.test(connector.baseUrl), connector.id);
    // A service either takes a key or signs in through the browser.
    assert.ok(typeof connector.key === 'function' || (connector.signIn && typeof connector.login === 'function'), connector.id);
  }
  // Paid speech needs all of this from a connector.
  for (const connector of CONNECTORS.filter((c) => c.speak)) {
    assert.equal(typeof connector.speed, 'function');
    assert.equal(connector.speedRange.length, 2);
    assert.ok(findService(connector.id).voice, connector.id);
  }
});

test('one OpenRouter entry serves images and clips on one key, with the words of each step', () => {
  const openrouter = findService('openrouter');
  assert.deepEqual(openrouter.step, ['images', 'clips']);
  assert.equal(openrouter.name, 'OpenRouter');
  assert.match(openrouter.about, /one OpenRouter key for illustrations and for short AI video clips/);
  assert.deepEqual(SERVICES.filter((s) => s.setup.env.includes('OPENROUTER_API_KEY')).map((s) => s.id), ['openrouter']);
  assert.equal(SERVICES.filter((s) => /openrouter/i.test(s.id)).length, 1);
  const [images, clips] = ['images', 'clips'].map((step) => stepServices(step).find((s) => s.id === 'openrouter'));
  assert.equal(images.step, 'images');
  assert.equal(clips.step, 'clips');
  assert.deepEqual(images.setup.env, clips.setup.env);
  assert.match(images.cost, /^Paid per image/);
  assert.match(images.data_leaves, /reference images go to OpenRouter and to the company that runs the image model/);
  assert.match(images.setup.use, /explainroo image <project>/);
  assert.equal(images.price_range, undefined);
  assert.match(clips.cost, /^Paid per second/);
  assert.match(clips.cost, /--dry-run" shows the price of one clip, with no key and no project/);
  assert.match(clips.cost, /failed try may cost money/);
  assert.match(clips.price_range, /^On 2026-11-07 .*cents a second/);
  assert.match(clips.data_leaves, /prompt goes to OpenRouter and to the company that runs the video model/);
  assert.match(clips.setup.use, /explainroo clip <project> .*--dry-run/);
  assert.match(findService('own-music').setup.use, /"src": "assets\/track\.mp3"/);
  const soundroo = findService('soundroo');
  assert.equal(soundroo.free, true);
  assert.match(soundroo.data_leaves, /Nothing leaves your computer unless you run Soundroo's own share command/);
  assert.equal(soundroo.setup.url, 'https://www.soundroo.com');
  assert.match(soundroo.setup.steps.join(' '), /Node 22/);
});

test('the posting services say what they cost and what leaves the computer, and Blotato says that its key starts a paid plan', () => {
  const [youtube, buffer, blotato] = ['youtube', 'buffer', 'blotato'].map(findService);
  for (const s of [youtube, buffer, blotato]) {
    assert.equal(s.step, 'posting', s.id);
    assert.equal(s.partner, false, s.id);
    assert.match(s.setup.use, new RegExp(`explainroo publish <project> --via ${s.id} .*--dry-run`), s.id);
  }
  assert.equal(youtube.free, true);
  assert.equal(youtube.setup.login, 'oauth');
  assert.deepEqual(youtube.setup.env, ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);
  assert.match(youtube.data_leaves, /^The video, its title and its description go to YouTube/);
  assert.match(youtube.setup.steps.join(' '), /Desktop app/);
  assert.equal(buffer.free, true);
  assert.equal(buffer.setup.login, 'oauth');
  assert.match(buffer.data_leaves, /The title, the text and a link to the video go to Buffer/);
  assert.equal(blotato.free, false);
  assert.deepEqual(blotato.setup.env, ['BLOTATO_API_KEY']);
  assert.match(blotato.cost, /Creating an API key ends Blotato's free trial/);
  assert.match(blotato.setup.steps[0], /^Creating an API key ends Blotato's free trial and starts its paid Starter plan/);
  assert.match(blotato.data_leaves, /^The video, its title and its text go to Blotato/);
  const posting = SERVICES.filter((s) => s.step === 'posting').map((s) => s.id);
  assert.deepEqual(posting, ['package', 'youtube', 'buffer', 'blotato']);
});

test('the label "paid partner" appears only when the flag is true', () => {
  const entry = { id: 'made-up', step: 'voice', name: 'Made Up Voices', about: 'A company that does not exist.', free: false, partner: false, status: 'available', cost: 'Paid per word.', data_leaves: 'The text goes to them.', setup: { env: ['MADE_UP_KEY'], steps: ['Make a key.'], use: 'Use it.' } };
  const steps = STEPS.filter((s) => s.id === 'voice');
  assert.doesNotMatch(formatServices(steps, [entry]), /paid partner/);
  assert.match(formatServices(steps, [{ ...entry, partner: true }]), /Made Up Voices \(costs money, paid partner\)/);
  assert.deepEqual(serviceLabels(entry), ['costs money']);
  assert.deepEqual(serviceLabels({ ...entry, status: 'coming' }, true), ['costs money', 'coming', 'connected']);
  assert.deepEqual(serviceLabels({ ...entry, free: true, partner: true }), ['free', 'paid partner']);
  assert.doesNotMatch(formatServices(STEPS, SERVICES), /partner/);
});

test('services prints every step in plain words with free entries first, and a step on its own', () => {
  const all = run(['services'], { OPENROUTER_API_KEY: '' });
  assert.equal(all.status, 0, all.stderr);
  for (const step of STEPS) assert.ok(all.stdout.includes(`${step.name}: ${step.what}`), step.id);
  for (const s of views) {
    assert.ok(all.stdout.includes(s.name), s.id);
    assert.ok(all.stdout.includes(s.cost), `${s.id} under ${s.step}`);
  }
  assert.ok(all.stdout.indexOf('Kokoro') < all.stdout.indexOf('ElevenLabs'));
  // One entry under images and under clips, each time with that step's words and one way to set it up.
  const imagesStep = all.stdout.slice(all.stdout.indexOf('Images: '), all.stdout.indexOf('Clips: '));
  const clipsStep = all.stdout.slice(all.stdout.indexOf('Clips: '), all.stdout.indexOf('Music: '));
  assert.match(imagesStep, /OpenRouter \(costs money(, connected)?\)\n.*\n {4}Cost: Paid per image/);
  assert.match(clipsStep, /OpenRouter \(costs money(, connected)?\)\n.*\n {4}Cost: Paid per second/);
  assert.equal(imagesStep.match(/OpenRouter \(.*\)/)[0], clipsStep.match(/OpenRouter \(.*\)/)[0]);
  // A .env in a source checkout may hold a real key, and that one would count.
  if (!fs.existsSync(path.join(root, '.env'))) {
    for (const part of [imagesStep, clipsStep]) assert.match(part, /Set up: .* connect openrouter$/m);
    assert.equal(all.stdout.match(/connect openrouter$/gm).length, 2);
  }
  assert.doesNotMatch(all.stdout, /openrouter-video|OpenRouter (images|video)/);
  const voice = run(['services', 'voice']).stdout;
  assert.match(voice, /^Voice: /);
  assert.match(voice, /Kokoro \(free\)/);
  assert.match(voice, /ElevenLabs \(costs money\)/);
  assert.match(voice, /connect elevenlabs/);
  assert.doesNotMatch(voice, /OpenRouter/);
  const clips = run(['services', 'clips']).stdout;
  assert.match(clips, /Your own footage \(free\)/);
  assert.ok(clips.indexOf('Your own footage') < clips.indexOf('OpenRouter'));
  // Offline, the prices are the range, and it says why.
  assert.match(clips, /Prices: Offline mode is on \(EXPLAINROO_OFFLINE=1\), so here is the range instead of today's prices\. On 2026-11-07 .*cents a second/);
});

test('services --json gives the same data plus whether a key is there, and never the key', () => {
  const key = 'a-key-that-must-not-show';
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-services-'));
  try {
    const noKeys = { EXPLAINROO_CONFIG: settings, ELEVENLABS_API_KEY: '', OPENROUTER_API_KEY: '' };
    const raw = run(['services', '--json'], noKeys);
    const data = JSON.parse(raw.stdout);
    assert.deepEqual(data.steps, STEPS);
    // Each entry is listed under each step it serves, with the words of that step.
    assert.deepEqual(data.services.map((s) => `${s.step} ${s.id}`), STEPS.flatMap((step) => stepServices(step.id)).map((s) => `${s.step} ${s.id}`));
    for (const s of data.services) {
      const { connected, prices, ...rest } = s;
      assert.deepEqual(rest, forStep(findService(s.id), s.step));
      assert.equal(typeof connected, needsKey(s) ? 'boolean' : 'undefined', s.id);
      // Only the clips step of OpenRouter has prices, and offline they are the range.
      assert.deepEqual(prices, s.id === 'openrouter' && s.step === 'clips' ? { shown: 'range', because: 'offline' } : undefined, `${s.step} ${s.id}`);
    }
    assert.deepEqual(data.services.filter((s) => s.id === 'openrouter').map((s) => [s.step, s.connected]), [['images', false], ['clips', false]]);
    for (const step of ['images', 'clips']) {
      const one = JSON.parse(run(['services', step, '--json'], noKeys).stdout).services.filter((s) => s.id === 'openrouter');
      assert.deepEqual(one.map((s) => [s.step, s.cost]), [[step, forStep(findService('openrouter'), step).cost]], step);
    }
    // A .env in a source checkout may hold a real key, and that one would count.
    if (!fs.existsSync(path.join(root, '.env'))) assert.equal(data.services.find((s) => s.id === 'elevenlabs').connected, false);
    const withKey = run(['services', 'voice', '--json'], { ...noKeys, ELEVENLABS_API_KEY: key });
    assert.equal(JSON.parse(withKey.stdout).services.find((s) => s.id === 'elevenlabs').connected, true);
    assert.ok(!(withKey.stdout + withKey.stderr).includes(key));
      const connected = run(['services', 'voice'], { ...noKeys, ELEVENLABS_API_KEY: key }).stdout;
    assert.match(connected, /ElevenLabs \(costs money, connected\)/);
    assert.match(connected, /Use: Run "explainroo voices --provider elevenlabs"/);
    assert.ok(!connected.includes(key));

    fs.writeFileSync(path.join(settings, 'video.json'), '{}');
    fs.writeFileSync(path.join(settings, '.env'), `OPENROUTER_API_KEY=${key}\n`);
    const fromProject = run(['services', 'images', '--project', settings, '--json'], noKeys);
    assert.equal(JSON.parse(fromProject.stdout).services.find((s) => s.id === 'openrouter').connected, true);
    assert.ok(!fromProject.stdout.includes(key));
    // The same key counts for both steps.
    const both = run(['services', '--project', settings, '--json'], noKeys);
    assert.deepEqual(JSON.parse(both.stdout).services.filter((s) => s.id === 'openrouter').map((s) => [s.step, s.connected]), [['images', true], ['clips', true]]);
    assert.match(run(['services', 'clips', '--project', settings], noKeys).stdout, /OpenRouter \(costs money, connected\)/);
    assert.ok(!both.stdout.includes(key));
  } finally {
    fs.rmSync(settings, { recursive: true, force: true });
  }
});

test('an unknown step is an error that lists the real ones', () => {
  const r = run(['services', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /there is no step "nope"/);
  for (const step of STEPS) assert.ok(r.stderr.includes(step.id));
  const json = run(['services', 'nope', '--json']);
  assert.equal(json.status, 1);
  assert.match(JSON.parse(json.stdout).error, /there is no step/);
  assert.ok(r.stderr.includes('"share" and "publish" also work, for sharing and posting.'));
});

// "explainroo services publish" is what someone types who knows the command.
test('services takes publish and share as names for the posting and sharing steps', () => {
  for (const [command, step] of [['publish', 'posting'], ['share', 'sharing']]) {
    assert.equal(findStep(command).id, step);
    const text = run(['services', command]);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(text.stdout, run(['services', step]).stdout);
    assert.deepEqual(JSON.parse(run(['services', command, '--json']).stdout).steps.map((s) => s.id), [step]);
  }
  assert.equal(findStep('voice').id, 'voice');
  assert.equal(findStep('render'), null);
  assert.match(run(['--help']).stdout, /Steps: voice, timing, images, clips, music, sharing, posting\. The command names share and publish also work/);
});

// Buffer is free, but it can only post a video that is online already.
test('the Buffer entry under posting says it needs a public link that share cannot make yet', () => {
  const posting = run(['services', 'posting']).stdout;
  const buffer = posting.slice(posting.indexOf('  Buffer (free)'), posting.indexOf('  Blotato'));
  assert.match(buffer.split('\n')[1], /Buffer needs a public link to the video, and "explainroo share" can't make one yet, so the video has to be on a host of your own first\.$/);
  assert.equal(findService('cloud').status, 'coming');
});

// The CLI with the fake services, whose server can only answer while this process waits.
function cli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Node's own headers on a plain fetch. A key, a cookie or a name would be more.
const PLAIN_HEADERS = ['host', 'connection', 'accept', 'accept-language', 'sec-fetch-mode', 'user-agent', 'accept-encoding'];

test('services and connect send no key and nothing about the user, and the only request is the public price list, once a day', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-services-cache-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  // A key in the environment stays at home too.
  const env = { ...fake.env, EXPLAINROO_CACHE: cache, EXPLAINROO_OFFLINE: '', OPENROUTER_API_KEY: GOOD_KEY };
  for (const args of [['services'], ['services', 'voice', '--json'], ['services', 'images', '--json'], ['services', 'clips', '--json'], ['services'], ['connect', 'kokoro'], ['connect', 'openrouter']]) {
    const r = await cli(args, env);
    assert.equal(r.code, 0, args.join(' '));
    assert.doesNotMatch(r.stderr, /test guard/, args.join(' '));
  }
  assert.equal(fake.total(), 1);
  const [list] = fake.requests('openrouter', 'GET /api/v1/videos/models');
  assert.deepEqual(Object.keys(list.headers).filter((name) => !PLAIN_HEADERS.includes(name)), []);
  assert.equal(list.headers['user-agent'], 'node');
  assert.equal(list.search, '');
  assert.equal(list.raw.length, 0);
});

test('voice settings are checked against the data, and the lists in errors come from it', () => {
  const providers = voiceProviders();
  assert.deepEqual(Object.keys(providers), ['kokoro', 'recording', 'elevenlabs', 'cartesia']);
  const fails = (voice, pattern) => assert.throws(() => normalizeConfig({ voice }), (e) => e instanceof ProjectError && pattern.test(e.message));
  fails({ provider: 'nope' }, new RegExp(`voice.provider must be ${oneOf(Object.keys(providers))}$`));
  fails({ provider: 'elevenlabs', id: 'v', nope: 1 }, /unknown setting\(s\): nope\. Known: provider, id, model/);
  fails({ provider: 'recording', src: 'assets/a.wav', id: 'v' }, /Known: provider, src/);
  fails({ provider: 'kokoro', id: 'af_heart', model: 'm' }, /Known: provider, id/);
  fails({ provider: 'elevenlabs', id: 'v', model: 4 }, /voice\.model must be an ElevenLabs model id/);
  assert.equal(oneOf(['a']), 'a');
  assert.equal(oneOf(['a', 'b', 'c']), 'a, b or c');
});

test('the code that makes the voice and the command line name no paid service', () => {
  for (const file of ['src/voice.js', 'src/cli.js', 'src/paid-speech.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /eleven|cartesia/i, file);
  }
});

test('the help is made from the data, and names every new command', () => {
  const help = run(['--help']).stdout;
  assert.match(help, /--provider elevenlabs\|cartesia for the\s+voices your key may use/);
  for (const words of [/^ {2}services \[step\]/m, /^ {2}connect <service>/m, /^ {2}history \[project\]/m, /--new/, /--resume <id>/, /--key-stdin/, /^ {2}clip \[project\]/m, /--dry-run/, /--max-cost/, /--seconds/, /--aspect/, /--model cheap\|quality/, /--resolution/, /--audio/, /--name/, /--no-wait/, /^ {2}publish \[project\]/m, /--via youtube\|buffer\|blotato/, /--privacy private\|unlisted\|public/, /--media-url/, /--channel id for Buffer/, /--account id for Blotato/, /--yes when there is no terminal/, /--callback-url/]) assert.match(help, words);
});

test('the data names no paid partner, and it has no ranking words', () => {
  const text = fs.readFileSync(path.join(root, 'src/services.json'), 'utf8');
  assert.doesNotMatch(text, /"partner": true/);
  assert.doesNotMatch(text, /\bbest\b/i);
});
