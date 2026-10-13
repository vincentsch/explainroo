import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig, loadProject, ProjectError } from '../src/project.js';
import { parseScript, speechChunks } from '../src/script.js';
import { findEnv, readEnvFile } from '../src/env.js';
import { findKey } from '../src/images.js';
import { elevenSpeech, elevenSpeed, decodePCM, elevenVoices, elevenUsage } from '../src/elevenlabs.js';
import { recordingCuts, recordingFiles, decodeRecording, saveRecording } from '../src/recordings.js';
import { sceneHash } from '../src/voice.js';
import { readWav, writeWav } from '../src/wav.js';
import { loudness } from '../src/ffmpeg.js';
import { main } from '../src/cli.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-voices-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function project(t, voice = { provider: 'elevenlabs', id: 'test-voice' }) {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.\n## silent\n## second\nGoodbye.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {}, silent() {}, second() {} };');
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

function mockAPI(t, fn) {
  t.mock.method(globalThis, 'fetch', fn);
  setEnv(t, 'ELEVENLABS_API_KEY', 'secret-test-key');
}

test('voice config accepts strings and all providers, with provider speed defaults', () => {
  assert.equal(normalizeConfig({}).voice, 'af_heart');
  assert.equal(normalizeConfig({ voice: 'am_michael' }).speed, 0.9);
  assert.equal(normalizeConfig({ voice: { provider: 'kokoro', id: 'af_heart' } }).voice, 'af_heart');
  assert.equal(normalizeConfig({ voice: { provider: 'kokoro', id: 'af_heart' } }).speed, 0.9);
  const cfg = normalizeConfig({ voice: { provider: 'elevenlabs', id: 'voice' }, pace: 1.6 });
  assert.deepEqual(cfg.voice, { provider: 'elevenlabs', id: 'voice', model: 'eleven_multilingual_v2' });
  assert.equal(cfg.speed, 1);
  assert.equal(normalizeConfig({ voice: { provider: 'elevenlabs', id: 'voice', model: 'eleven_flash_v2_5' }, speed: 0.8 }).speed, 0.8);
  for (const src of ['assets/narration.wav', 'assets/narration/', 'assets/take.m4a']) {
    assert.equal(normalizeConfig({ voice: { provider: 'recording', src } }).speed, 1);
    assert.equal(normalizeConfig({ voice: { provider: 'recording', src }, speed: 1.2 }).speed, 1.2);
  }
  assert.throws(() => normalizeConfig({ speed: 1.6, pace: 1.6 }), /too fast/);
});

test('voice config rejects bad providers, missing ids, unknown keys and unsafe paths', () => {
  for (const voice of [null, [], 1, {}, { provider: 'bad' }, { provider: 'toString' }, { provider: ['kokoro'], id: 'af_heart' },
    { provider: 'kokoro' }, { provider: 'kokoro', id: 'bad' }, { provider: 'kokoro', id: 'toString' },
    { provider: 'kokoro', id: 'af_heart', model: 'x' }, { provider: 'elevenlabs' },
    { provider: 'elevenlabs', id: '' }, { provider: 'elevenlabs', id: 'v', model: 4 },
    { provider: 'elevenlabs', id: 'v', key: 'secret' }, { provider: 'recording' },
    { provider: 'recording', src: '../take.wav' }, { provider: 'recording', src: 'assets/../take.wav' },
    { provider: 'recording', src: 'assets/..\\take.wav' }, { provider: 'recording', src: 'assets/a.wav', id: 'x' }]) {
    assert.throws(() => normalizeConfig({ voice }), ProjectError);
  }
});

test('shared env reader keeps environment, project, root precedence and quoted exports', (t) => {
  const dir = temp(t);
  const root = temp(t);
  const name = 'EXPLAINROO_TEST_KEY';
  const file = path.join(dir, '.env');
  setEnv(t, name, 'environment');
  fs.writeFileSync(path.join(root, '.env'), `${name}=root\n`);
  fs.writeFileSync(file, `UNRELATED=x\n  export ${name} = "project"  \nOPENROUTER_API_KEY='image-key'\n`);
  assert.equal(readEnvFile(file, name), 'project');
  assert.equal(findEnv(name, dir, root), 'environment');
  process.env[name] = '';
  assert.equal(findEnv(name, dir, root), 'project');
  setEnv(t, 'OPENROUTER_API_KEY', '');
  assert.equal(findKey(dir), 'image-key');
  fs.writeFileSync(file, `${name}=''\n`);
  assert.equal(findEnv(name, dir, root), 'root');
  fs.rmSync(file);
  assert.equal(readEnvFile(file, name), null);
});

test('ElevenLabs requests PCM, neighbouring text, speed, and logs usage without secrets', async (t) => {
  const p = project(t);
  p.config.speed = 1.1;
  p.config.pace = 1.3;
  const pcm = Buffer.alloc(6);
  pcm.writeInt16LE(-32768, 0);
  pcm.writeInt16LE(0, 2);
  pcm.writeInt16LE(16384, 4);
  mockAPI(t, async (url, opts) => {
    assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/test-voice?output_format=pcm_24000');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['xi-api-key'], 'secret-test-key');
    assert.deepEqual(JSON.parse(opts.body), { text: 'Hello.', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1.2 }, previous_text: 'Before.', next_text: 'After.' });
    return new Response(pcm);
  });
  const audio = await elevenSpeech(p, 'first', 'Hello.', { previous: 'Before.', next: 'After.' });
  assert.equal(audio.sampling_rate, 24000);
  assert.deepEqual([...audio.audio], [-1, 0, 0.5]);
  const usage = elevenUsage(p);
  assert.equal(usage.length, 1);
  assert.deepEqual(Object.keys(usage[0]), ['time', 'scene', 'characters', 'model', 'voice_id']);
  assert.equal(usage[0].scene, 'first');
  assert.equal(usage[0].characters, 6);
  assert.equal(usage[0].voice_id, 'test-voice');
  assert.equal(usage[0].model, 'eleven_multilingual_v2');
  assert.ok(Number.isFinite(Date.parse(usage[0].time)));
  assert.ok(!JSON.stringify(usage).includes('secret-test-key'));
  assert.throws(() => decodePCM(Buffer.alloc(1)), /unreadable audio/);
  assert.throws(() => decodePCM(Buffer.alloc(0)), /unreadable audio/);
  assert.equal(elevenSpeed(0.42), 0.7);
  assert.equal(elevenSpeed(2.56), 1.2);
  assert.equal(elevenSpeed(1), 1);
});

test('ElevenLabs keeps the saved voice settings at normal speed', async (t) => {
  const p = project(t);
  p.config.speed = 1;
  p.config.pace = 1;
  mockAPI(t, async (url, opts) => {
    assert.equal(JSON.parse(opts.body).voice_settings, undefined);
    return new Response(Buffer.alloc(2));
  });
  await elevenSpeech(p, 'first', 'Hello.');
});

test('ElevenLabs omits unsupported continuity for v3 and reports unreadable downloads safely', async (t) => {
  const p = project(t, { provider: 'elevenlabs', id: 'test-voice', model: 'eleven_v3' });
  mockAPI(t, async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.model_id, 'eleven_v3');
    assert.equal(body.previous_text, undefined);
    assert.equal(body.next_text, undefined);
    return new Response(Buffer.alloc(2));
  });
  await elevenSpeech(p, 'first', 'Hello.', { previous: 'Before.', next: 'After.' });
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { throw new Error('secret-test-key'); } });
  await assert.rejects(() => elevenSpeech(p, 'first', 'Hello.'), (e) => {
    assert.match(e.message, /download failed/);
    assert.ok(!e.message.includes('secret-test-key'));
    return true;
  });
  assert.equal(elevenUsage(p).length, 2);
});

test('ElevenLabs gives friendly errors without echoing the key or server body', async (t) => {
  const p = project(t);
  mockAPI(t, async () => { throw new Error('secret-test-key'); });
  const error = async (pattern) => assert.rejects(() => elevenSpeech(p, 'first', 'Hello.'), (e) => {
    assert.match(e.message, pattern);
    assert.ok(!e.message.includes('secret-test-key'));
    return true;
  });
  await error(/connection/);
  for (const [http, status, pattern] of [[401, 'invalid_api_key', /rejected/], [403, '', /permissions/],
    [404, 'voice_not_found', /voice id/], [400, 'voice_not_found', /voice id/], [401, 'quota_exceeded', /no characters/],
    [402, '', /no characters/], [422, '', /voice.model/]]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: { status, message: 'secret-test-key' } }), { status: http });
    await error(pattern);
  }
  assert.deepEqual(elevenUsage(p), []);
  process.env.ELEVENLABS_API_KEY = '';
  await error(/Ask the user.*elevenlabs.io.*\.env/);
});

test('ElevenLabs retries 429 and server failures, but stops after three attempts', async (t) => {
  const p = project(t);
  let calls = 0;
  mockAPI(t, async () => {
    calls++;
    return calls < 3 ? new Response('{}', { status: calls === 1 ? 429 : 503 }) : new Response(Buffer.alloc(2));
  });
  await elevenSpeech(p, 'first', 'Hello.');
  assert.equal(calls, 3);
  assert.equal(elevenUsage(p).length, 1);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('secret-test-key', { status: 500 }); };
  await assert.rejects(() => elevenSpeech(p, 'first', 'Hello.'), /busy/);
  assert.equal(calls, 3);
  assert.equal(elevenUsage(p).length, 1);
});

test('ElevenLabs voice list paginates and CLI prints names, ids and labels with JSON support', async (t) => {
  const dir = temp(t);
  let calls = 0;
  mockAPI(t, async (url) => {
    calls++;
    assert.equal(url.pathname, '/v2/voices');
    assert.equal(url.searchParams.get('page_size'), '100');
    const page2 = url.searchParams.has('next_page_token');
    if (page2) assert.equal(url.searchParams.get('next_page_token'), 'next');
    return Response.json({ voices: [{ name: page2 ? 'Bob' : 'Alice', voice_id: page2 ? 'b' : 'a', labels: { accent: 'American' } }], has_more: !page2, next_page_token: page2 ? null : 'next' });
  });
  assert.deepEqual(await elevenVoices(dir), [{ name: 'Alice', id: 'a', labels: { accent: 'American' } }, { name: 'Bob', id: 'b', labels: { accent: 'American' } }]);
  assert.equal(calls, 2);
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  assert.equal(await main(['voices', '--elevenlabs', dir, '--json']), 0);
  assert.equal(JSON.parse(output).voices[1].id, 'b');
  output = '';
  assert.equal(await main(['voices', dir, '--elevenlabs']), 0);
  assert.match(output, /Alice  a  accent: American/);
  output = '';
  await main(['voices']);
  assert.match(output, /af_heart/);
  assert.match(output, /voices --elevenlabs.*recording/);
});

test('cached CLI voice output reports recording mismatches and ElevenLabs speed limits', async (t) => {
  const p = project(t, { provider: 'recording', src: 'assets/take.wav' });
  writeWav(path.join(p.dir, 'assets/take.wav'), new Float32Array(24000), 24000);
  const recordings = recordingFiles(p);
  fs.mkdirSync(p.paths.voice, { recursive: true });
  const cache = (recording) => {
    for (const scene of p.script.scenes) {
      const chunks = speechChunks(scene.units, p.config);
      const hash = sceneHash(scene, chunks, p.config, recording && chunks.length
        ? { content: recordings.files[scene.id].hash, scenes: p.script.scenes.map((s) => s.spoken) } : null);
      const info = { hash, id: scene.id, duration: chunks.length ? 1 : 0, words: [], marks: {}, chunks: [], transcript: 'Different words.', matchRate: chunks.length ? 0 : 1, unmatched: chunks.length ? [scene.spoken] : [] };
      fs.writeFileSync(path.join(p.paths.voice, scene.id + '.json'), JSON.stringify(info));
      if (chunks.length) writeWav(path.join(p.paths.voice, scene.id + '.wav'), new Float32Array(24000), 24000);
    }
  };
  cache(true);
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  assert.equal(await main(['voice', p.dir, '--json']), 0);
  assert.match(JSON.parse(output).scenes[0].message, /recording does not match.*actually said/);
  fs.writeFileSync(path.join(p.dir, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'v' }, pace: 1.3 }));
  p.config = loadProject(p.dir).config;
  cache(false);
  output = '';
  assert.equal(await main(['voice', p.dir, '--json']), 0);
  assert.equal(JSON.parse(output).speed, 1.2);
  assert.equal(JSON.parse(output).requested_speed, 1.3);
  assert.equal(JSON.parse(output).characters, 0);
  output = '';
  assert.equal(await main(['voice', p.dir]), 0);
  assert.equal((output.match(/outside 0.7 to 1.2/g) || []).length, 1);
});

test('single-take cuts retain internal pauses and margins, skip silent scenes and avoid overlap', () => {
  const scenes = parseScript('## first\n[#hello] Hello [pause 9] {world|world}.\n## silent\n## second\nGoodbye now.').scenes;
  const heard = [{ text: 'Hello', start: 1, end: 1.5 }, { text: 'world', start: 3, end: 3.5 },
    { text: 'Goodbye', start: 5, end: 5.5 }, { text: 'now', start: 6, end: 6.5 }];
  const cuts = recordingCuts(scenes, heard, 8);
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0].scene.id, 'first');
  assert.equal(cuts[0].start, 0.85);
  assert.equal(cuts[0].end, 3.65);
  assert.deepEqual(cuts[0].words, [{ start: 1, end: 1.5, matched: true }, { start: 3, end: 3.5, matched: true }]);
  assert.equal(cuts[1].start, 4.85);
  assert.equal(cuts[1].end, 6.65);
  heard[2].start = 3.6;
  const close = recordingCuts(scenes, heard, 6.5);
  assert.equal(close[0].end, 3.55);
  assert.equal(close[1].start, 3.55);
  assert.equal(close[1].end, 6.5);
  assert.deepEqual(recordingCuts(scenes.filter((s) => s.id === 'silent'), [], 8), []);
});

test('recording folders report all missing scenes, validate files and stay inside assets', (t) => {
  const p = project(t, { provider: 'recording', src: 'assets/narration/' });
  const folder = path.join(p.dir, 'assets/narration');
  fs.mkdirSync(folder);
  assert.throws(() => recordingFiles(p), /missing scene recordings.*first, second/);
  fs.writeFileSync(path.join(folder, 'first.mp3'), 'first');
  fs.writeFileSync(path.join(folder, 'second.M4A'), 'second');
  const files = recordingFiles(p);
  assert.equal(files.folder, true);
  assert.deepEqual(Object.keys(files.files), ['first', 'second']);
  fs.writeFileSync(path.join(folder, 'first.mp3'), 'replaced');
  const changed = recordingFiles(p);
  assert.notEqual(changed.files.first.hash, files.files.first.hash);
  assert.equal(changed.files.second.hash, files.files.second.hash);
  fs.rmSync(path.join(folder, 'first.mp3'));
  const outside = path.join(temp(t), 'outside.wav');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(folder, 'first.wav'));
  assert.throws(() => recordingFiles(p), /including symlinks/);
  p.config.voice.src = 'assets/no.wav';
  assert.throws(() => recordingFiles(p), /missing/);
  p.config.voice.src = 'assets/bad.txt';
  fs.writeFileSync(path.join(p.dir, 'assets/bad.txt'), 'not audio');
  assert.throws(() => recordingFiles(p), /wav, mp3/);
});

test('scene cache includes audio settings and recording contents, ignores recording gaps', () => {
  const scene = parseScript('## first\n[#a] Hello. Goodbye.').scenes[0];
  const cfg = normalizeConfig({});
  const chunks = speechChunks(scene.units);
  const hash = sceneHash(scene, chunks, cfg);
  assert.notEqual(hash, sceneHash(scene, chunks, { ...cfg, voice: 'am_michael' }));
  assert.notEqual(hash, sceneHash(scene, chunks, { ...cfg, speed: 1 }));
  const eleven = normalizeConfig({ voice: { provider: 'elevenlabs', id: 'v' } });
  assert.notEqual(sceneHash(scene, chunks, eleven), sceneHash(scene, chunks, { ...eleven, voice: { ...eleven.voice, model: 'another' } }));
  const recording = normalizeConfig({ voice: { provider: 'recording', src: 'assets/take.wav' } });
  const recHash = sceneHash(scene, chunks, recording, { content: 'abc' });
  assert.notEqual(recHash, sceneHash(scene, chunks, recording, { content: 'def' }));
  assert.equal(recHash, sceneHash(scene, speechChunks(scene.units, { sentenceGap: 9 }), recording, { content: 'abc' }));
  assert.notEqual(recHash, sceneHash(scene, chunks, { ...recording, pace: 1.2 }, { content: 'abc' }));
  const paused = parseScript('## first\n[#a] Hello. [pause 9] Goodbye.').scenes[0];
  assert.equal(recHash, sceneHash(paused, speechChunks(paused.units), recording, { content: 'abc' }));
});

test('recordings preserve sample rate up to 48 kHz, apply tempo and normalize loudness', async (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'tone.wav');
  const sr = 24000;
  const samples = Float32Array.from({ length: sr * 4 }, (_, i) => 0.02 * Math.sin(2 * Math.PI * 440 * i / sr));
  writeWav(file, samples, sr);
  const decoded = await decodeRecording(file, dir, 1.25);
  assert.equal(decoded.sampleRate, sr);
  assert.ok(Math.abs(decoded.samples.length / sr - 3.2) < 0.05);
  const out = path.join(dir, 'out.wav');
  await saveRecording(out, decoded.samples, decoded.sampleRate);
  assert.equal(readWav(out).sampleRate, sr);
  assert.ok(Math.abs((await loudness(out)).integrated - -22.3) < 0.5);
  const high = path.join(dir, 'high.wav');
  writeWav(high, new Float32Array(96000), 96000);
  assert.equal((await decodeRecording(high, dir, 1)).sampleRate, 48000);
  const silent = path.join(dir, 'silent.wav');
  await saveRecording(silent, new Float32Array(sr), sr);
  assert.equal(readWav(silent).samples.length, sr);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('recording-')), []);
});
