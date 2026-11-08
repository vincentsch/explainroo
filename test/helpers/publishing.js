// Shared by the tests of publish and of the sign-ins it needs: a project with
// packages made by hand, the fake services, logins without the browser, and a
// count of every request that changes something at a posting service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeServices } from './fake-services.js';
import { BLOTATO_KEY } from './fake-publishing.js';

export const bin = fileURLToPath(new URL('../../bin/explainroo.js', import.meta.url));
export const DIE_BEFORE = new URL('./die-before.js', import.meta.url).href;
export const UPLOAD = 'POST /upload/youtube/v3/videos';
export const SESSION = 'PUT /upload/youtube/v3/videos';
export const GQL = 'POST /';
// Every size check of a video link, by HEAD or by GET.
export const linkChecks = (fake) => [...fake.requests('media-check', 'HEAD /*'), ...fake.requests('media-check', 'GET /*')];
export const PLACEHOLDER = '<the publicUrl Blotato gives for the uploaded video>';
export const NONE = { youtube: 0, buffer: 0, blotato: 0 };

export function temp(t, prefix = 'explainroo-publish-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// A package folder as package leaves it. publish never renders, so the video only
// has to be bytes with the hash that post.json names.
export function writePackage(dir, platform, { size = 6000, ...words } = {}) {
  const folder = path.join(dir, 'out/package', platform);
  fs.mkdirSync(folder, { recursive: true });
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), crypto.randomBytes(size)]);
  fs.writeFileSync(path.join(folder, 'video.mp4'), bytes);
  const post = {
    platform,
    title: 'How DNS finds a website',
    description: 'Your browser asks a resolver for the address.',
    text: 'Your browser asks a resolver for the address.\n\n#dns',
    hashtags: ['#dns'],
    ai_label: true,
    ai_reasons: ['voice: Kokoro'],
    credits: ['Voice: Kokoro', 'Made with explainroo'],
    made_for_kids: false,
    category: '27',
    duration: 42.4,
    file: 'video.mp4',
    sha256: sha(bytes),
    verify: { ok: true, errors: [], warnings: [], report: 'report.json' },
    ...words,
  };
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify(post, null, 2));
  return { bytes, sha256: post.sha256, post, file: path.join(folder, 'video.mp4') };
}

function makeProject(t, platforms) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'video.json'), '{}');
  fs.writeFileSync(path.join(dir, 'script.md'), '# How DNS works\n## first\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  const packages = Object.fromEntries(platforms.map((platform) => [platform, writePackage(dir, platform)]));
  return { dir, packages };
}

function saveLines(file, lines) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, old + Object.entries(lines).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
}

export function jobs(dir) {
  const folder = path.join(dir, 'history/jobs');
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'))) : [];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A run that pauses right before it writes text that matches `pattern`, while it
// holds whatever lock it holds at that moment. resume() lets it go on.
export async function pausedRun(t, s, args, pattern, extra = {}) {
  const note = path.join(temp(t, 'explainroo-paused-'), 'stopped');
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --import=${DIE_BEFORE}`.trim();
  const run = s.start(args, { extra: { NODE_OPTIONS: nodeOptions, EXPLAINROO_TEST_STOP_BEFORE: pattern, EXPLAINROO_TEST_STOPPED: note, ...extra } });
  // A test that fails while the run is paused still ends it.
  t.after(() => {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
  });
  const deadline = Date.now() + 60000;
  while (!fs.existsSync(note)) {
    if (run.child.exitCode !== null || run.child.signalCode !== null) assert.fail(`the run ended before it paused:\n${(await run.result).text}`);
    if (Date.now() > deadline) assert.fail('the run never paused');
    await sleep(20);
  }
  return { ...run, pid: run.child.pid, resume: () => run.child.kill('SIGCONT') };
}

// The files of the locks that a process holds in a folder of locks.
export function heldBy(folder, pid) {
  return fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).flatMap((e) => {
    return fs.readdirSync(path.join(folder, e.name)).filter((name) => name.startsWith(`held-by-${pid}-`)).map((name) => path.join(folder, e.name, name));
  });
}

// Resolves once a process waits for a lock in that folder: its own folder, which it
// renames into place once it gets the lock, is there.
export async function waitsForLock(folder, pid) {
  const deadline = Date.now() + 60000;
  while (!(fs.existsSync(folder) && fs.readdirSync(folder).some((name) => name.startsWith(`.lock-${pid}-`)))) {
    if (Date.now() > deadline) assert.fail(`process ${pid} never waited for a lock in ${folder}`);
    await sleep(20);
  }
}

// Gives a file the time it would have after a pause of an hour. Locks used to run
// out by the age of the holder's file.
export function anHourOld(file) {
  const time = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(file, time, time);
}

// The end of the message of a run that waited too long for a lock, as plain text.
export const lockWords = (lock) => `The lock is the folder ${lock}. It is safe to move that folder away only when no explainroo command is running.`;

export const mutations = (fake) => fake.requests('buffer', GQL).filter((r) => /\bmutation\b/.test(r.body?.query ?? ''));

// Every request that changes something at a posting service. A YouTube PUT with no
// body only asks how much of an upload arrived.
export function changes(fake) {
  return {
    youtube: fake.count('youtube', UPLOAD) + fake.requests('youtube', SESSION).filter((r) => r.raw.length > 0).length,
    buffer: mutations(fake).length,
    blotato: fake.count('blotato', 'POST /media/uploads') + fake.count('blotato-storage', 'PUT /*') + fake.count('blotato', 'POST /posts'),
  };
}

// `login` names the services that start with a login, made without the browser.
export async function setup(t, { platforms = ['tiktok'], login = [] } = {}) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const settings = temp(t, 'explainroo-publish-settings-');
  const envFile = path.join(settings, '.env');
  const { dir, packages } = makeProject(t, platforms);
  // The packages all have the same size, and a video link leads to a file of that
  // size unless a test puts another answer at it.
  fake.publishing.links.bytes = Object.values(packages)[0]?.bytes.length ?? null;
  const env = {
    ...process.env,
    ...fake.env,
    EXPLAINROO_CONFIG: settings,
    YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: '', YOUTUBE_REFRESH_TOKEN: '',
    BUFFER_CLIENT_ID: '', BUFFER_ACCESS_TOKEN: '', BUFFER_REFRESH_TOKEN: '', BUFFER_TOKEN_EXPIRES: '',
    BLOTATO_API_KEY: '', EXPLAINROO_CLOUD_KEY: '',
    EXPLAINROO_PUBLISH_POLL_MS: '20', EXPLAINROO_PUBLISH_WAIT_MS: '400',
  };
  for (const service of login.filter((s) => s !== 'blotato')) saveLines(envFile, fake.login(service));
  if (login.includes('blotato')) saveLines(envFile, { BLOTATO_API_KEY: BLOTATO_KEY });
  const start = (args, { input, extra = {} } = {}) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...env, ...extra }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== undefined) child.stdin.end(input);
    const result = new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, text: stderr + stdout }));
    });
    return { child, result };
  };
  const cli = (args, options) => start(args, options).result;
  const publish = (...args) => cli(['publish', dir, ...args]);
  const json = async (...args) => {
    const r = await publish(...args, '--json');
    try {
      return { ...r, out: JSON.parse(r.stdout) };
    } catch {
      assert.fail(`no JSON from publish ${args.join(' ')}:\n${r.text}`);
    }
  };
  return { fake, dir, settings, envFile, packages, env, start, cli, publish, json, changes: () => changes(fake), jobs: () => jobs(dir) };
}
