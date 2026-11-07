import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SERVICES, STEPS, findService, formatServices, needsKey, oneOf, serviceLabels, voiceProviders } from '../src/services.js';
import { CONNECTORS, findConnector } from '../src/connectors/index.js';
import { normalizeConfig, ProjectError } from '../src/project.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('the steps are the ones the docs name', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['voice', 'timing', 'images', 'clips', 'music', 'sharing', 'posting']);
  for (const step of STEPS) assert.ok(step.name && step.what, step.id);
});

test('every entry says what it costs, what data leaves and how to set it up, and none is a paid partner', () => {
  assert.equal(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length);
  for (const s of SERVICES) {
    assert.ok(STEPS.some((step) => step.id === s.step), `${s.id}: ${s.step} is not a step`);
    for (const field of ['name', 'about', 'cost', 'data_leaves']) assert.ok(typeof s[field] === 'string' && s[field].trim(), `${s.id}: ${field}`);
    assert.equal(typeof s.free, 'boolean', s.id);
    assert.equal(s.partner, false, s.id);
    assert.ok(['available', 'coming'].includes(s.status), s.id);
    assert.ok(Array.isArray(s.setup.env), s.id);
    assert.ok(s.setup.steps.length > 0 && s.setup.steps.every((step) => typeof step === 'string' && step.trim()), s.id);
    assert.ok(typeof s.setup.use === 'string' && s.setup.use.trim(), s.id);
    if (s.free) {
      // A free service needs no key, at most a login to the user's own account.
      if (s.setup.login !== 'oauth') assert.deepEqual(s.setup.env, [], `${s.id} is free, so it needs no key`);
      assert.match(s.cost, /^Free/, s.id);
    } else assert.match(s.cost, /Paid/, s.id);
  }
});

test('within each step free entries come first, and the first entry of every step is free', () => {
  for (const step of STEPS) {
    const entries = SERVICES.filter((s) => s.step === step.id);
    assert.ok(entries.length > 0, step.id);
    assert.equal(entries[0].free, true, step.id);
    assert.equal(entries.findIndex((s) => !s.free) === -1 || entries.slice(entries.findIndex((s) => !s.free)).every((s) => !s.free), true, step.id);
  }
});

test('the first list holds what exists today', () => {
  assert.deepEqual(SERVICES.map((s) => s.id), ['kokoro', 'recording', 'elevenlabs', 'whisper', 'own-images', 'openrouter', 'own-footage', 'openrouter-video', 'built-in-music', 'own-music', 'soundroo', 'web-player', 'cloud', 'package', 'youtube', 'buffer', 'blotato']);
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
    const connector = findConnector(s.connector ?? s.id);
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

test('the entries for clips and music say what they cost, what leaves the computer and how to use them', () => {
  const video = findService('openrouter-video');
  assert.equal(video.step, 'clips');
  assert.equal(video.connector, 'openrouter');
  assert.deepEqual(video.setup.env, findService('openrouter').setup.env);
  assert.match(video.cost, /per second/);
  assert.match(video.cost, /cents a second/);
  assert.match(video.cost, /--dry-run/);
  assert.match(video.cost, /failed try may cost money/);
  assert.match(video.data_leaves, /prompt goes to OpenRouter and to the company that runs/);
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
  const all = run(['services']);
  assert.equal(all.status, 0, all.stderr);
  for (const step of STEPS) assert.ok(all.stdout.includes(`${step.name}: ${step.what}`), step.id);
  for (const s of SERVICES) {
    assert.ok(all.stdout.includes(s.name), s.id);
    assert.ok(all.stdout.includes(s.cost), s.id);
  }
  assert.ok(all.stdout.indexOf('Kokoro') < all.stdout.indexOf('ElevenLabs'));
  const voice = run(['services', 'voice']).stdout;
  assert.match(voice, /^Voice: /);
  assert.match(voice, /Kokoro \(free\)/);
  assert.match(voice, /ElevenLabs \(costs money\)/);
  assert.match(voice, /connect elevenlabs/);
  assert.doesNotMatch(voice, /OpenRouter/);
  const clips = run(['services', 'clips']).stdout;
  assert.match(clips, /Your own footage \(free\)/);
});

test('services --json gives the same data plus whether a key is there, and never the key', () => {
  const key = 'a-key-that-must-not-show';
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-services-'));
  try {
    const noKeys = { EXPLAINROO_CONFIG: settings, ELEVENLABS_API_KEY: '', OPENROUTER_API_KEY: '' };
    const raw = run(['services', '--json'], noKeys);
    const data = JSON.parse(raw.stdout);
    assert.deepEqual(data.steps, STEPS);
    assert.deepEqual(data.services.map((s) => s.id), SERVICES.map((s) => s.id));
    for (const s of data.services) {
      const { connected, ...rest } = s;
      assert.deepEqual(rest, findService(s.id));
      assert.equal(typeof connected, needsKey(s) ? 'boolean' : 'undefined', s.id);
    }
    // A .env in a source checkout may hold a real key, and that one would count.
    if (!fs.existsSync(path.join(root, '.env'))) assert.equal(data.services.find((s) => s.id === 'elevenlabs').connected, false);
    const withKey = run(['services', 'voice', '--json'], { ...noKeys, ELEVENLABS_API_KEY: key });
    assert.equal(JSON.parse(withKey.stdout).services.find((s) => s.id === 'elevenlabs').connected, true);
    assert.ok(!(withKey.stdout + withKey.stderr).includes(key));
      const connected = run(['services', 'voice'], { ...noKeys, ELEVENLABS_API_KEY: key }).stdout;
    assert.match(connected, /ElevenLabs \(costs money, connected\)/);
    assert.match(connected, /Use: Run "explainroo voices --elevenlabs"/);
    assert.ok(!connected.includes(key));

    fs.writeFileSync(path.join(settings, 'video.json'), '{}');
    fs.writeFileSync(path.join(settings, '.env'), `OPENROUTER_API_KEY=${key}\n`);
    const fromProject = run(['services', 'images', '--project', settings, '--json'], noKeys);
    assert.equal(JSON.parse(fromProject.stdout).services.find((s) => s.id === 'openrouter').connected, true);
    assert.ok(!fromProject.stdout.includes(key));
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
});

test('services and connect make no network calls for a free service', () => {
  for (const args of [['services'], ['services', 'voice', '--json'], ['connect', 'kokoro'], ['connect', 'openrouter']]) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.doesNotMatch(r.stderr, /test guard/, args.join(' '));
  }
});

test('voice settings are checked against the data, and the lists in errors come from it', () => {
  const providers = voiceProviders();
  assert.deepEqual(Object.keys(providers), ['kokoro', 'recording', 'elevenlabs']);
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
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /eleven/i, file);
  }
});

test('the help is made from the data, and names every new command', () => {
  const help = run(['--help']).stdout;
  assert.match(help, /--elevenlabs for your ElevenLabs key/);
  for (const words of [/^ {2}services \[step\]/m, /^ {2}connect <service>/m, /^ {2}history \[project\]/m, /--new/, /--resume <id>/, /--key-stdin/, /^ {2}clip \[project\]/m, /--dry-run/, /--max-cost/, /--seconds/, /--aspect/, /--model cheap\|quality/, /--resolution/, /--audio/, /--name/, /--no-wait/, /^ {2}publish \[project\]/m, /--via youtube\|buffer\|blotato/, /--privacy private\|unlisted\|public/, /--media-url/, /--channel id for Buffer/, /--account id for Blotato/, /--yes when there is no terminal/, /--callback-url/]) assert.match(help, words);
});

test('the data names no paid partner, and it has no ranking words', () => {
  const text = fs.readFileSync(path.join(root, 'src/services.json'), 'utf8');
  assert.doesNotMatch(text, /"partner": true/);
  assert.doesNotMatch(text, /\bbest\b/i);
});
