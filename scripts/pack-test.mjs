// Proves the package works when installed. It packs this repository, installs
// the tarball in a temp folder and makes a real video from there, reusing the
// models in ~/.cache/explainroo. Run it with "npm run test:pack".
//
// The temp folder has to be outside the checkout. Node looks for packages by
// walking up the folders, so inside the repo it would find the repo's own
// node_modules and hide missing dependencies.
//
// To test another command, add an entry to the list of steps below.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOOD_KEY, formFields, startFakeServices } from '../test/helpers/fake-services.js';
import { BLOTATO_KEY, GOOGLE_CLIENT } from '../test/helpers/fake-publishing.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = new URL('../test/helpers/guard.js', import.meta.url).href;
const STEP_TIMEOUT = 20 * 60 * 1000;
const MIN_NARRATION_UNDERSTOOD = 0.85;
// The German example: a recording that voice has to confirm for each scene.
const GERMAN = 'leap-years-de';
const MIN_GERMAN_CONFIRMED = 0.9;
const CLIP_PROMPT = 'A busy street at dusk in the rain';
const PRICE_LIST = 'GET /api/v1/videos/models';
// services keeps the price list it reads in the cache folder. These steps get one of
// their own, so the fake's prices never land in ~/.cache/explainroo.
const priceCache = ({ temp }) => ({ EXPLAINROO_CACHE: path.join(temp, 'cache') });
// What a step saw before it ran, for the checks that compare.
let before = {};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const topics = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));

// npm runs outside the test guard, because its download is part of what this
// proves. The installed CLI runs inside it, so it may not reach the network.
const { NODE_OPTIONS, ...outside } = process.env;

let stopRunning = null;
let stoppedBy = null;

function run(command, args, { cwd, env, input }) {
  return new Promise((resolve) => {
    if (stoppedBy) {
      resolve({ stdout: '', stderr: '', status: null, signal: stoppedBy });
      return;
    }
    // Its own process group, so that a signal reaches npx and the CLI under it.
    const windows = process.platform === 'win32';
    const child = spawn(command, args, { cwd, env, detached: !windows, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], shell: windows });
    if (input !== undefined) child.stdin.end(input);
    stopRunning = (signal) => {
      try {
        if (windows) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = setTimeout(() => stopRunning('SIGTERM'), STEP_TIMEOUT);
    const r = { stdout: '', stderr: '' };
    child.stdout.setEncoding('utf8').on('data', (d) => { r.stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { r.stderr += d; });
    child.on('error', (e) => { r.error = e; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      stopRunning = null;
      resolve({ ...r, status, signal });
    });
  });
}

function outputOf(r) {
  return [r.error?.message, r.stderr?.trim(), r.stdout?.trim()].filter(Boolean).join('\n').slice(-6000);
}

async function npm(args, cwd) {
  const r = await run('npm', args, { cwd, env: outside });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} failed:\n${outputOf(r)}`);
  return r.stdout;
}

function expect(ok, message) {
  if (!ok) throw new Error(message);
}

// A port that nothing listens on, for a share with no server.
function closedPort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Every request that changes something at a posting service.
function postingChanges(fake) {
  return fake.count('youtube', 'POST /upload/youtube/v3/videos') + fake.requests('youtube', 'PUT /upload/youtube/v3/videos').length
    + fake.requests('buffer', 'POST /').filter((r) => /\bmutation\b/.test(r.body?.query ?? '')).length
    + fake.count('blotato', 'POST /media/uploads') + fake.count('blotato-storage', 'PUT /*') + fake.count('blotato', 'POST /posts');
}

// Each step runs "explainroo <args>" and must exit with `status` (0 unless it says
// otherwise). args can be a function of the paths, for a value an earlier step
// found. setup(paths) runs first, like copying an example. input goes to stdin,
// and env(paths) adds to the environment. check gets the parsed --json output and
// a few paths, and the raw output after that. It throws on a problem and can
// return a short note for the report.
const steps = [
  {
    args: ['--version', '--json'],
    check: (r) => expect(r.version === pkg.version, `the installed copy says version ${r.version}, not ${pkg.version}`),
  },
  {
    args: ['doctor', '--json'],
    check: (r) => {
      expect(r.ok, 'doctor found a problem');
      for (const name of ['voice model', 'speech check model']) {
        expect(r.checks.find((c) => c.name === name)?.state === 'ready', `the ${name} is missing. Run "node bin/explainroo.js doctor --fetch" once, so this test can reuse it.`);
      }
      // English with Kokoro needs no other program and no language model, installed or not.
      for (const name of ['espeak-ng', 'misaki ja', 'misaki zh', 'language model']) {
        expect(r.checks.find((c) => c.name === name)?.state === 'not needed', `doctor says English needs the ${name}`);
      }
    },
  },
  {
    args: ['docs', '--json'],
    check: (r, { installed }) => {
      expect(r.file === path.join(installed, 'AGENTS.md'), `docs read ${r.file}, not the installed AGENTS.md`);
      expect(r.text === fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8'), 'the installed copy prints another start page than AGENTS.md in the checkout');
      expect(r.text.includes('npx --yes explainroo'), 'the installed start page does not say how to run the tool');
      const bytes = Buffer.byteLength(r.text);
      expect(bytes < 12000, `the installed start page is ${bytes} bytes, and agents' tools cut off a page over 12,000`);
      return `start page, ${bytes} bytes`;
    },
  },
  {
    args: ['docs', '--list', '--json'],
    check: (r) => expect(topics.every((t) => r.topics.includes(t)), `docs lists ${r.topics.join(', ')}, and the checkout has ${topics.join(', ')}`),
  },
  ...topics.map((topic) => ({
    args: ['docs', topic, '--json'],
    check: (r, { installed }) => {
      expect(r.file === path.join(installed, 'docs', `${topic}.md`), `docs ${topic} read ${r.file}, not the installed page`);
      expect(r.text.length > 0, `the installed page for ${topic} is empty`);
      expect(Buffer.byteLength(r.text) < 24000, `the installed page for ${topic} is ${Buffer.byteLength(r.text)} bytes, over 24,000`);
    },
  })),
  {
    args: ['init', 'video', '--json'],
    check: (r) => {
      const ignored = fs.readFileSync(path.join(r.dir, '.gitignore'), 'utf8').split('\n');
      expect(ignored.includes('.env'), 'the .gitignore of a new project does not list .env');
      expect(ignored.includes('history/private/'), 'the .gitignore of a new project does not list history/private/');
      expect(ignored.includes('history/locks/'), 'the .gitignore of a new project does not list history/locks/');
    },
  },
  {
    // One setting into video.json, checked first, with the rest of the file kept.
    args: ['set', 'video', 'sizes.shorts.pace', '1.15', '--json'],
    check: (r, { temp }) => {
      const settings = JSON.parse(fs.readFileSync(path.join(temp, 'video/video.json'), 'utf8'));
      expect(r.changed && settings.sizes.shorts.pace === 1.15 && settings.defaults === '0.5', `set says ${JSON.stringify(r)}`);
    },
  },
  {
    // No key is saved yet, and a dry run needs none.
    args: ['clip', 'video', CLIP_PROMPT, '--seconds', '6', '--dry-run', '--json'],
    check: (r, { temp, fake }) => {
      expect(r.dry_run && r.model === 'google/veo-3.1-lite' && r.price_usd === 0.18, `the dry run says ${JSON.stringify(r)}`);
      expect(fake.count('openrouter', 'POST /api/v1/videos') === 0, 'the dry run sent a paid request');
      expect(!fs.existsSync(path.join(temp, 'video/history')), 'the dry run wrote to the record');
      return `about $${r.price_usd} with no key`;
    },
  },
  {
    args: ['services', '--json'],
    env: priceCache,
    setup: ({ fake }) => { before = { list: fake.count('openrouter', PRICE_LIST) }; },
    check: (r, { fake }) => {
      expect(r.steps.length === 7 && r.services.length > 0, 'services lists no steps');
      for (const step of r.steps) {
        const first = r.services.find((s) => s.step === step.id);
        expect(first?.free, `the first entry of ${step.id} is not free`);
      }
      expect(r.services.every((s) => s.partner === false), 'a service says it is a paid partner');
      const openrouter = r.services.filter((s) => s.id === 'openrouter');
      expect(openrouter.map((s) => `${s.step} ${s.connected}`).join() === 'images false,clips false', `openrouter is listed as ${JSON.stringify(openrouter.map((s) => [s.step, s.connected]))}`);
      expect(fake.count('openrouter', PRICE_LIST) === before.list + 1, 'services did not read the price list once');
    },
  },
  {
    // The answer from the step before is kept, so this asks for nothing.
    args: ['services', 'clips', '--json'],
    env: priceCache,
    setup: ({ fake }) => { before = { list: fake.count('openrouter', PRICE_LIST) }; },
    check: (r, { fake, temp }) => {
      const { prices } = r.services.find((s) => s.id === 'openrouter');
      expect(prices?.shown === 'prices' && prices.url === `${fake.env.EXPLAINROO_OPENROUTER_URL}/api/v1/videos/models` && Date.now() - Date.parse(prices.read) < 60 * 60 * 1000, `services clips shows ${JSON.stringify(prices)}`);
      expect(prices.models.map((m) => `${m.id} ${m.usd_per_second}`).join() === 'google/veo-3.1-lite 0.03,google/veo-3.1 0.2', `services clips shows ${JSON.stringify(prices.models)}`);
      expect(fake.count('openrouter', PRICE_LIST) === before.list, 'services read the price list again, although it kept an answer from today');
      expect(fs.readdirSync(path.join(temp, 'cache', 'prices')).length === 1, 'services did not keep one answer in its cache folder');
      expect(fake.requests('openrouter', PRICE_LIST).every((q) => q.headers.authorization === undefined), 'a request for the price list carried a key');
      return `cheap $0.03 and quality $0.20 a second, read ${prices.read.slice(0, 10)}`;
    },
  },
  {
    // The temp folder has no video.json, so this is a dry run outside a project.
    args: ['clip', CLIP_PROMPT, '--seconds', '6', '--dry-run', '--json'],
    env: ({ temp }) => ({ EXPLAINROO_CACHE: path.join(temp, 'dry-run-cache') }),
    setup: ({ temp }) => { before = { files: fs.readdirSync(temp).sort().join() }; },
    check: (r, { temp, fake }) => {
      expect(r.dry_run && r.project === null && r.model === 'google/veo-3.1-lite' && r.aspect === '16:9' && r.resolution === '720p' && r.audio === false && r.price_usd === 0.18, `the dry run outside a project says ${JSON.stringify(r)}`);
      expect(!('file' in r) && !('would' in r), 'the dry run outside a project names a file or a record');
      expect(fs.readdirSync(temp).sort().join() === before.files && !fs.existsSync(path.join(temp, 'dry-run-cache')), 'the dry run outside a project wrote something');
      expect(fake.count('openrouter', 'POST /api/v1/videos') === 0, 'the dry run sent a paid request');
      return `about $${r.price_usd} for 16:9 at 720p, with no project`;
    },
  },
  {
    args: ['connect', 'kokoro', '--json'],
    check: (r) => expect(r.needs_key === false && r.use, 'connect does not say that kokoro needs nothing'),
  },
  {
    // No terminal and no stdin: it prints the steps and how to finish.
    args: ['connect', 'openrouter', '--json'],
    check: (r, { settings }) => {
      expect(r.needs_key === true && r.steps.length > 0 && r.finish.stdin.includes('--key-stdin'), 'connect does not print the steps');
      expect(!fs.existsSync(settings), 'connect wrote something with no key');
    },
  },
  {
    // An installed copy saves in the settings folder, after the test against the fake.
    args: ['connect', 'openrouter', '--key-stdin', '--json'],
    input: `${GOOD_KEY}\n`,
    check: (r, { settings, fake }, raw) => {
      expect(r.file === path.join(settings, '.env'), `connect saved the key in ${r.file}, not the settings folder`);
      expect(fake.count('openrouter', 'GET /api/v1/key') === 1, 'connect did not test the key against the fake');
      expect(fs.readFileSync(r.file, 'utf8') === `OPENROUTER_API_KEY=${GOOD_KEY}\n`, 'the .env file does not hold the key');
      expect((fs.statSync(r.file).mode & 0o777) === 0o600 || process.platform === 'win32', 'the .env file can be read by others');
      expect(!raw.includes(GOOD_KEY), 'connect printed the key');
    },
  },
  {
    args: ['services', 'images', '--json'],
    check: (r, paths, raw) => {
      expect(r.services.find((s) => s.id === 'openrouter').connected === true, 'openrouter does not say connected after connect');
      expect(!raw.includes(GOOD_KEY), 'services printed the key');
    },
  },
  {
    args: ['voice', 'video', '--json'],
    check: (r) => {
      expect(r.scenes.length > 0 && r.duration > 0, 'voice made no narration');
      return `${r.duration.toFixed(1)}s of narration`;
    },
  },
  {
    args: ['check', 'video', '--json'],
    check: (r) => `${r.issues.length} finding(s)`,
  },
  {
    args: ['render', 'video', '--json'],
    check: (r, { temp }) => {
      expect(r.out.startsWith(temp), `the video went to ${r.out}, outside the temp folder`);
      for (const file of [r.out, r.subtitles.srt, r.subtitles.vtt, r.cover]) {
        expect(fs.statSync(file).size > 0, `${file} is empty`);
      }
    },
  },
  {
    // verify exits with 0 on warnings about the speech, so this reads its report.
    args: ['verify', 'video', '--json'],
    check: (r) => {
      const errors = r.issues.filter((i) => i.level === 'error');
      expect(!errors.length, `verify found errors: ${errors.map((e) => e.message).join('; ')}`);
      expect(r.speech?.matchRate >= MIN_NARRATION_UNDERSTOOD, `only ${r.speech?.matchRate} of the narration was understood, and ${MIN_NARRATION_UNDERSTOOD} is the minimum`);
      expect(r.loudness.truePeak <= -1 && !r.issues.some((i) => /true peak/.test(i.message)), `the true peak is ${r.loudness.truePeak} dBTP`);
      return `${r.duration}s, ${r.video.width}x${r.video.height}, ${r.loudness.integrated} LUFS, ${r.loudness.truePeak} dBTP, ${Math.round(r.speech.matchRate * 100)}% of the narration understood`;
    },
  },
  {
    // A sheet of chosen moments, in the order given, in a file of its own.
    args: ['sheet', 'video', '--times', 'main@1,2,intro', '--json'],
    check: (r, { temp }) => {
      expect(r.file.startsWith(temp) && r.file.endsWith(path.join('out', 'sheet-times.jpg')) && fs.statSync(r.file).size > 0, `the sheet went to ${r.file}`);
      expect(r.times.map((x) => x.label).join() === 'main@1,t2.00,intro@end', `the sheet shows ${JSON.stringify(r.times)}`);
      return `${r.frames} chosen moments`;
    },
  },
  {
    // The spoken words of a scene with their times, for choosing cues.
    args: ['words', 'video', 'intro', '--json'],
    check: (r) => {
      const [scene] = r.scenes;
      expect(r.scenes.length === 1 && scene.scene === 'intro' && scene.words.length > 3, `words printed ${JSON.stringify(r).slice(0, 200)}`);
      expect(scene.words.every((w, i) => i === 0 || w.start >= scene.words[i - 1].start), 'the word times go back');
      return `${scene.words.length} words in intro`;
    },
  },
  {
    args: ['history', 'video', '--json'],
    check: (r) => {
      expect(r.versions.length === 1 && r.versions[0].full && !r.versions[0].draft && r.versions[0].identity, 'history does not show the render');
      expect(r.versions[0].verify?.ok === true, 'history does not show the verify result');
      expect(r.versions[0].version === pkg.version, `the record says version ${r.versions[0].version}`);
      expect(r.open.length === 0, 'a free video has open paid jobs');
    },
  },
  {
    // One purchase from the fake, with the key connect saved above.
    args: ['clip', 'video', CLIP_PROMPT, '--seconds', '6', '--max-cost', '1', '--json'],
    check: (r, { fake }) => {
      expect(r.status === 'done' && r.cost_usd === 0.18 && fs.statSync(r.file).size > 0, `the purchase says ${JSON.stringify(r)}`);
      expect(fake.count('openrouter', 'POST /api/v1/videos') === 1, 'the purchase did not send one request');
      return `${r.clip_line.slice(0, 40)}...`;
    },
  },
  {
    // The same command again uses the clip it bought.
    args: ['clip', 'video', CLIP_PROMPT, '--seconds', '6', '--max-cost', '1', '--json'],
    check: (r, { fake }) => expect(r.reused && r.status === 'done' && fake.count('openrouter', 'POST /api/v1/videos') === 1, `the same clip again says ${JSON.stringify({ reused: r.reused, status: r.status })}, and the fake counted ${fake.count('openrouter', 'POST /api/v1/videos')} purchases`),
  },
  {
    args: ['history', 'video', '--json'],
    check: (r) => {
      const clip = r.jobs.find((job) => job.kind === 'clip');
      expect(clip?.status === 'done' && clip.cost_usd === 0.18 && clip.output.file.startsWith('assets/clips/'), 'history does not show the clip');
      expect(r.open.length === 0, 'a finished clip is still open');
    },
  },
  {
    // A tiny project for packaging. Its check writes one sentence of real narration.
    args: ['init', 'tiny', '--json'],
    check: (r) => {
      fs.writeFileSync(path.join(r.dir, 'script.md'), '# A tiny video\n\n## hello\nThis short video was packaged for TikTok.\n');
      fs.writeFileSync(path.join(r.dir, 'scenes.js'), "export default { hello(s) { s.title('A tiny video', { y: s.safe.y + s.safe.h * 0.4, at: 0 }); } };\n");
      fs.writeFileSync(path.join(r.dir, 'post.json'), JSON.stringify({ title: 'A tiny video', description: 'A short test of packaging.', hashtags: ['explainroo'] }));
    },
  },
  {
    args: ['package', 'tiny', '--platform', 'tiktok', '--json'],
    check: (r, { temp }) => {
      const folder = path.join(temp, 'tiny/out/package/tiktok');
      expect(r.ok && r.folder === folder && r.source.how === 'rendered', `package says ${JSON.stringify({ ok: r.ok, folder: r.folder, source: r.source })}`);
      for (const name of ['video.mp4', 'post.json', 'description.txt', 'video.srt', 'video.vtt', 'video.cover.jpg', 'credits.txt', 'report.json']) expect(fs.statSync(path.join(folder, name)).size > 0, `the package has no ${name}`);
      const post = JSON.parse(fs.readFileSync(path.join(folder, 'post.json'), 'utf8'));
      expect(post.watermark === false && post.width === 1080 && post.height === 1920, 'the TikTok file is not 1080x1920 without the watermark');
      expect(post.text === 'A short test of packaging.\n\n#explainroo' && post.ai_label === true && post.credits.includes('Made with explainroo'), `post.json says ${JSON.stringify(post)}`);
      expect(post.verify.ok && post.verify.understood >= MIN_NARRATION_UNDERSTOOD, `verify of the package says ${JSON.stringify(post.verify)}`);
      return `${post.width}x${post.height}, ${post.duration.toFixed(1)}s, ${Math.round(post.verify.understood * 100)}% of the narration understood`;
    },
  },
  {
    // Without a server set on purpose, share sends nothing while the hosted service is coming.
    args: ['share', 'tiny', '--platform', 'tiktok', '--json'],
    env: () => ({ EXPLAINROO_CLOUD_URL: '' }),
    status: 1,
    check: (r, { fake }) => expect(/is coming, and it doesn't take videos yet\. Nothing was sent/.test(r.error) && fake.count('cloud', 'POST /api/v1/shares') === 0, `share without a server says ${r.error}`),
  },
  {
    args: ['share', 'tiny', '--platform', 'tiktok', '--json'],
    check: async (r, { fake }) => {
      expect(!r.reused && r.url && r.media_url && r.expires_at && r.claim_url && r.file === 'out/package/tiktok/video.mp4', `share says ${JSON.stringify(r)}`);
      const requests = fake.requests('cloud', 'POST /api/v1/shares');
      expect(requests.length === 1 && requests[0].headers.authorization === undefined, 'share did not send one request without a key');
      const form = await formFields(requests[0]);
      expect([...form.keys()].join() === 'video,title' && form.get('title') === 'A tiny video', 'the upload does not have the video and the title');
      return r.url;
    },
  },
  {
    args: ['share', 'tiny', '--platform', 'tiktok', '--json'],
    check: (r, { fake }) => expect(r.reused && fake.count('cloud', 'POST /api/v1/shares') === 1, 'sharing the same file again uploaded it'),
  },
  {
    // No server at the address: a clear message and an error code.
    args: ['share', 'tiny', '--platform', 'tiktok', '--new', '--json'],
    env: ({ closedPort }) => ({ EXPLAINROO_CLOUD_URL: `http://127.0.0.1:${closedPort}` }),
    status: 1,
    check: (r) => expect(/doesn't answer at .* yet\. The video was not sent/.test(r.error), `share with no server says ${r.error}`),
  },
  {
    args: ['package', 'tiny', '--platform', 'youtube', '--json'],
    check: (r) => expect(r.ok && r.post.width === 1920 && r.post.height === 1080, `package for YouTube says ${JSON.stringify({ ok: r.ok, width: r.post?.width })}`),
  },
  // The other platforms keep the watermark that video.json sets.
  ...[['shorts', 1080, 1920], ['reels', 1080, 1920], ['linkedin', 1080, 1350], ['x', 1080, 1080]].map(([platform, width, height]) => ({
    args: ['package', 'tiny', '--platform', platform, '--json'],
    check: (r, { temp }) => {
      const folder = path.join(temp, 'tiny/out/package', platform);
      expect(r.ok && r.folder === folder && r.post.width === width && r.post.height === height && r.post.watermark !== false, `package for ${platform} says ${JSON.stringify({ ok: r.ok, folder: r.folder, width: r.post?.width, height: r.post?.height, watermark: r.post?.watermark })}`);
      for (const name of ['video.mp4', 'post.json', 'description.txt', 'video.srt', 'video.cover.jpg', 'credits.txt', 'report.json']) expect(fs.statSync(path.join(folder, name)).size > 0, `the ${platform} package has no ${name}`);
      expect(r.post.verify.ok && r.post.verify.understood >= MIN_NARRATION_UNDERSTOOD, `verify of the ${platform} package says ${JSON.stringify(r.post.verify)}`);
      return `${width}x${height}, ${r.source.how}`;
    },
  })),
  {
    // No login yet: the dry run says what is missing and sends nothing.
    args: ['publish', 'tiny', '--via', 'youtube', '--dry-run', '--json'],
    check: (r, { fake }) => {
      expect(r.dry_run && r.would === 'stop' && /no YouTube login/.test(r.missing.join(' ')), `the dry run says ${JSON.stringify(r.missing)}`);
      const youtube = ['GET /youtube/v3/channels', 'POST /upload/youtube/v3/videos', 'PUT /upload/youtube/v3/videos', 'GET /youtube/v3/videos'].reduce((n, route) => n + fake.count('youtube', route), fake.count('youtube-auth', 'POST /token'));
      expect(youtube === 0, 'the dry run with no login sent a request to YouTube');
    },
  },
  {
    // The YouTube sign-in: the client on stdin, then the address the browser lands on.
    args: ['connect', 'youtube', '--key-stdin', '--json'],
    input: `${GOOGLE_CLIENT.id}\n${GOOGLE_CLIENT.secret}\n`,
    check: (r, paths) => {
      expect(r.link?.startsWith('https://accounts.google.com/') && r.redirect_uri === 'http://127.0.0.1:8976/callback', `connect youtube says ${JSON.stringify(r)}`);
      paths.youtubeLink = r.link;
    },
  },
  {
    args: (paths) => ['connect', 'youtube', '--callback-url', paths.fake.approve(paths.youtubeLink), '--json'],
    check: (r, { settings }, raw) => {
      const env = fs.readFileSync(path.join(settings, '.env'), 'utf8');
      expect(r.connected && /^YOUTUBE_REFRESH_TOKEN=1\/\/fake-refresh-/m.test(env), `the YouTube login was not saved: ${JSON.stringify(r)}`);
      expect(!raw.includes(GOOGLE_CLIENT.secret) && !/fake-refresh/.test(raw), 'connect printed a secret');
      return r.account;
    },
  },
  {
    args: ['publish', 'tiny', '--via', 'youtube', '--dry-run', '--json'],
    check: (r, { fake }) => {
      expect(r.would === 'post' && r.plan.destination?.id === 'UCfakechannel0000000000' && r.request.start.body.status.privacyStatus === 'private', `the YouTube dry run says ${JSON.stringify({ would: r.would, destination: r.plan.destination })}`);
      expect(postingChanges(fake) === 0, 'the YouTube dry run changed something');
      return `${r.plan.destination.name}, ${r.plan.privacy.value}`;
    },
  },
  {
    // The TikTok package was shared above, so Buffer has its link, and no login.
    args: ['publish', 'tiny', '--via', 'buffer', '--platform', 'tiktok', '--dry-run', '--json'],
    check: (r, { fake }) => {
      expect(r.plan.media?.from === 'share' && r.request.variables.input.assets[0].video.url === r.plan.media.url, `the Buffer dry run has no link from share: ${JSON.stringify(r.plan.media)}`);
      expect(r.would === 'stop' && /no Buffer login/.test(r.missing.join(' ')), `the Buffer dry run says ${JSON.stringify(r.missing)}`);
      expect(postingChanges(fake) === 0, 'the Buffer dry run changed something');
    },
  },
  {
    args: ['connect', 'blotato', '--key-stdin', '--json'],
    input: `${BLOTATO_KEY}\n`,
    check: (r, { settings }) => expect(r.connected && fs.readFileSync(path.join(settings, '.env'), 'utf8').includes(`BLOTATO_API_KEY=${BLOTATO_KEY}\n`), 'the Blotato key was not saved whole'),
  },
  {
    args: ['publish', 'tiny', '--via', 'blotato', '--platform', 'tiktok', '--dry-run', '--json'],
    check: (r, { fake }) => {
      expect(r.would === 'post' && r.request.post.post.accountId === '102' && r.request.post.post.target.privacyLevel === 'SELF_ONLY', `the Blotato dry run says ${JSON.stringify({ would: r.would, target: r.request.post?.post?.target })}`);
      expect(postingChanges(fake) === 0, 'the Blotato dry run changed something');
    },
  },
  {
    // A real run without a terminal and without --yes sends nothing.
    args: ['publish', 'tiny', '--via', 'blotato', '--platform', 'tiktok', '--json'],
    status: 1,
    check: (r, { fake }) => expect(r.confirmed === false && postingChanges(fake) === 0, `publish without --yes says ${JSON.stringify(r.error)}`),
  },
  {
    args: ['publish', 'tiny', '--via', 'blotato', '--platform', 'tiktok', '--yes', '--json'],
    check: (r, paths) => {
      const { fake, temp } = paths;
      const sent = [...fake.publishing.blotato.uploads.values()][0]?.bytes;
      const packaged = JSON.parse(fs.readFileSync(path.join(temp, 'tiny/out/package/tiktok/post.json'), 'utf8')).sha256;
      expect(r.stage === 'finished' && sent === packaged && fake.count('blotato', 'POST /posts') === 1, `the Blotato post says ${JSON.stringify({ stage: r.stage, sent, packaged })}`);
      paths.postingChanges = postingChanges(fake);
      return r.post.link;
    },
  },
  {
    // The same post again: it went out, so nothing is sent.
    args: ['publish', 'tiny', '--via', 'blotato', '--platform', 'tiktok', '--yes', '--json'],
    check: (r, { fake, postingChanges: before }) => expect(r.already && r.stage === 'finished' && postingChanges(fake) === before, `the same post again says ${JSON.stringify({ already: r.already, stage: r.stage })}, with ${postingChanges(fake) - before} new requests that change something`),
  },
  {
    // The record of the tiny project holds every package, share and post.
    args: ['history', 'tiny', '--json'],
    check: (r) => {
      const packaged = new Set(r.versions.filter((v) => v.event === 'package').map((v) => v.platform));
      expect(['tiktok', 'youtube', 'shorts', 'reels', 'linkedin', 'x'].every((p) => packaged.has(p)), `history lists packages for ${[...packaged].join(', ')}`);
      const shares = r.jobs.filter((job) => job.kind === 'share');
      expect(shares.some((job) => job.status === 'done' && job.result?.url), 'history does not show the share link');
      const posts = r.jobs.filter((job) => job.kind === 'publish');
      expect(posts.length === 1 && posts[0].provider === 'blotato' && posts[0].stage === 'finished', `history shows ${posts.length} posts`);
      expect(r.open.length === 0, `history has open jobs: ${JSON.stringify(r.open)}`);
      return `${packaged.size} packages, ${shares.length} shares, ${posts.length} post`;
    },
  },
  {
    // Settings for TikTok only: bold captions at a quicker pace, with narration of their own.
    setup: ({ temp }) => {
      const file = path.join(temp, 'tiny/video.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), sizes: { tiktok: { captions: 'bold', pace: 1.2 } } }));
    },
    args: ['render', 'tiny', '--size', 'tiktok', '--no-watermark', '--json'],
    check: (r, { temp }) => {
      expect(r.out === path.join(temp, 'tiny/out/video-tiktok-no-watermark.mp4') && r.width === 1080 && r.height === 1920, `the TikTok render went to ${r.out} at ${r.width}x${r.height}`);
      expect(fs.existsSync(path.join(temp, 'tiny/build/pace-1.2/voice/hello.wav')), 'the narration at the pace of the TikTok block is not in build/pace-1.2/');
      return `${r.duration.toFixed(1)}s at pace 1.2`;
    },
  },
  {
    args: ['package', 'tiny', '--platform', 'tiktok', '--json'],
    check: (r) => {
      expect(r.ok && r.source.how === 'copied' && r.source.file === 'out/video-tiktok-no-watermark.mp4', `the package did not copy the TikTok render: ${JSON.stringify(r.source)}`);
      expect(r.post.size === 'tiktok' && r.post.watermark === false && r.post.verify.understood >= MIN_NARRATION_UNDERSTOOD, `post.json says ${JSON.stringify({ size: r.post.size, watermark: r.post.watermark, verify: r.post.verify })}`);
      return `copied from ${r.source.file}, ${Math.round(r.post.verify.understood * 100)}% of the narration understood`;
    },
  },
  {
    args: ['connect', 'cartesia', '--key-stdin', '--json'],
    input: `${GOOD_KEY}\n`,
    check: (r, { settings, fake }, raw) => {
      expect(r.connected && fs.readFileSync(path.join(settings, '.env'), 'utf8').includes(`CARTESIA_API_KEY=${GOOD_KEY}\n`), 'the Cartesia key was not saved');
      expect(fake.count('cartesia', 'GET /voices') === 1 && fake.count('cartesia', 'POST /tts/bytes') === 0, 'connect did not test the key with the free voice list');
      expect(!raw.includes(GOOD_KEY), 'connect printed the key');
    },
  },
  {
    args: ['voices', '--provider', 'cartesia', '--language', 'es', '--json'],
    check: (r) => {
      expect(r.voices.length === 1 && r.voices[0].id === 'voz-clara', `voices lists ${JSON.stringify(r.voices)}`);
      return `${r.voices[0].name} (${r.voices[0].id})`;
    },
  },
  {
    // A video in English and Spanish. The Spanish voice comes from the Cartesia fake.
    args: ['init', 'bilingual', '--size', 'tiktok', '--json'],
    check: (r) => {
      const write = (name, text) => fs.writeFileSync(path.join(r.dir, name), typeof text === 'string' ? text : JSON.stringify(text));
      write('video.json', { title: 'Fresh bread', size: 'tiktok', captions: 'bold', languages: { es: { voice: { provider: 'cartesia', id: 'voz-clara' } } } });
      write('script.md', '# Fresh bread\n\n## tip\nKeep bread in a [#bag] *paper bag*.\n');
      write('script.es.md', '# Pan fresco\n\n## tip\nGuarda el pan en una [#bag] *bolsa de papel*.\n');
      write('strings.json', { tip: { title: 'Fresh bread' } });
      write('strings.es.json', { tip: { title: 'Pan fresco' } });
      write('scenes.js', "export default { tip(s) { s.title(s.str('tip.title'), { y: s.safe.y + s.safe.h * 0.3, enter: 'none' }); s.icon('shopping-bag', { y: s.safe.y + s.safe.h * 0.6, size: 220, at: '#bag' }); } };\n");
    },
  },
  {
    // Spanish with a paid voice needs the language model, and no espeak-ng.
    args: ['doctor', 'bilingual', '--json'],
    check: (r) => {
      expect(JSON.stringify(r.setup) === JSON.stringify([{ language: 'en', voice: 'kokoro' }, { language: 'es', voice: 'cartesia' }]), `doctor judged ${JSON.stringify(r.setup)}`);
      const state = (name) => r.checks.find((c) => c.name === name)?.state;
      expect(r.ok && state('espeak-ng') === 'not needed' && state('voice model') === 'ready' && state('language model') !== 'not needed', `doctor says ${r.checks.map((c) => `${c.name}: ${c.state}`).join(', ')}`);
      return `language model ${state('language model')}`;
    },
  },
  {
    // The fake's sound is no Spanish speech, so the speech check may warn here.
    args: ['check', 'bilingual', '--lang', 'es', '--json'],
    check: (r, { temp, fake }) => {
      const errors = r.issues.filter((i) => i.level === 'error');
      expect(!errors.length, `check --lang es found errors: ${errors.map((e) => e.message).join('; ')}`);
      const sent = fake.requests('cartesia', 'POST /tts/bytes').map((q) => q.body);
      expect(sent.length === 1 && sent[0].language === 'es' && sent[0].transcript === 'Guarda el pan en una bolsa de papel.' && sent[0].voice.id === 'voz-clara', `Cartesia got ${JSON.stringify(sent)}`);
      expect(fs.existsSync(path.join(temp, 'bilingual/build/es/voice/tip.wav')) && !fs.existsSync(path.join(temp, 'bilingual/build/voice')), 'the Spanish narration is not in build/es/');
      return `${r.issues.length} finding(s), ${sent.length} request to the Cartesia fake`;
    },
  },
  {
    // The German example from the checkout, narrated by its recording.
    setup: ({ temp }) => fs.cpSync(path.join(ROOT, 'examples', GERMAN), path.join(temp, 'german'), { recursive: true, filter: (from) => !/[\\/](build|out|history)$/.test(from) }),
    args: ['doctor', 'german', '--json'],
    check: (r) => {
      const state = (name) => r.checks.find((c) => c.name === name)?.state;
      expect(JSON.stringify(r.setup) === JSON.stringify([{ language: 'de', voice: 'recording' }]), `doctor judged ${JSON.stringify(r.setup)}`);
      expect(state('language model') === 'ready', `the language model is missing. Run "node bin/explainroo.js voice examples/${GERMAN}" once in the checkout, which downloads it, so this test can reuse it.`);
      expect(['espeak-ng', 'misaki ja', 'misaki zh', 'voice model'].every((name) => state(name) === 'not needed'), `doctor says ${r.checks.map((c) => `${c.name}: ${c.state}`).join(', ')}`);
    },
  },
  {
    args: ['voice', 'german', '--json'],
    check: (r) => {
      const low = r.scenes.filter((s) => s.confirmed < MIN_GERMAN_CONFIRMED);
      expect(r.scenes.length > 0 && !low.length, `voice confirmed too few words in ${low.map((s) => `${s.scene} (${s.confirmed})`).join(', ')}`);
      return `${r.duration.toFixed(1)}s, ${r.scenes.map((s) => `${s.scene} ${Math.round(s.confirmed * 100)}%`).join(', ')}`;
    },
  },
  {
    args: ['check', 'german', '--json'],
    check: (r) => {
      const errors = r.issues.filter((i) => i.level === 'error');
      expect(!errors.length, `check found errors in the German example: ${errors.map((e) => e.message).join('; ')}`);
      expect(r.speech.length === r.scenes, `check has the speech check of ${r.speech.length} of ${r.scenes} scenes`);
      return `${r.issues.length} finding(s)`;
    },
  },
  {
    args: ['render', 'german', '--json'],
    check: (r, { temp }) => expect(r.out.startsWith(temp) && fs.statSync(r.out).size > 0, `the German video went to ${r.out}`),
  },
  {
    args: ['verify', 'german', '--json'],
    check: (r) => {
      const errors = r.issues.filter((i) => i.level === 'error');
      expect(!errors.length, `verify found errors in the German video: ${errors.map((e) => e.message).join('; ')}`);
      expect(r.speech?.matchRate >= MIN_NARRATION_UNDERSTOOD, `only ${r.speech?.matchRate} of the German narration was understood, and ${MIN_NARRATION_UNDERSTOOD} is the minimum`);
      expect(r.loudness.truePeak <= -1 && !r.issues.some((i) => /true peak/.test(i.message)), `the true peak is ${r.loudness.truePeak} dBTP`);
      return `${r.duration}s, ${r.loudness.integrated} LUFS, ${r.loudness.truePeak} dBTP, ${Math.round(r.speech.matchRate * 100)}% of the narration understood, ${r.speech.nearly.length} word(s) only nearly`;
    },
  },
];

async function runSteps(paths, env) {
  for (const step of steps) {
    const args = typeof step.args === 'function' ? step.args(paths) : step.args;
    const name = args.filter((a) => a !== '--json').map((a) => (/^https?:/.test(a) ? '<address>' : a)).join(' ');
    const started = Date.now();
    await step.setup?.(paths);
    // Without the "--", npx reads a flag like --version as its own.
    const r = await run('npx', ['--no', '--', 'explainroo', ...args], { cwd: paths.temp, env: { ...env, ...step.env?.(paths) }, input: step.input });
    if (r.status !== (step.status ?? 0)) throw new Error(`explainroo ${name} exited with ${r.status ?? r.signal}:\n${outputOf(r)}`);
    // npx sets its own exit code, so only stderr shows a request that it made.
    expect(!r.stderr.includes('test guard: blocked'), `explainroo ${name} tried to reach the network:\n${outputOf(r)}`);
    const note = await step.check(JSON.parse(r.stdout), paths, r.stdout + r.stderr);
    console.log(`ok  ${name.padEnd(28)} ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s${note ? `  ${note}` : ''}`);
  }
}

async function main() {
  // A signal ends the running step, and then the temp folder goes away.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stoppedBy = signal;
      stopRunning?.(signal);
    });
  }
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-pack-')));
  const fake = await startFakeServices();
  try {
    const fromRoot = path.relative(fs.realpathSync(ROOT), temp);
    expect(fromRoot.startsWith('..') || path.isAbsolute(fromRoot), `the temp folder ${temp} is inside the checkout. Point TMPDIR somewhere else.`);
    console.log(`packing into ${temp}`);
    const [{ filename }] = JSON.parse(await npm(['pack', '--json', '--pack-destination', temp], ROOT));
    fs.writeFileSync(path.join(temp, 'package.json'), '{ "private": true }\n');
    console.log(`installing ${filename}`);
    const started = Date.now();
    await npm(['install', '--no-audit', '--no-fund', '--loglevel=error', path.join(temp, filename)], temp);
    console.log(`installed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    const settings = path.join(temp, 'settings');
    // Keys from this computer's own settings have no place in this test.
    const env = { ...outside, ...fake.env, NODE_OPTIONS: `--import=${GUARD}`, EXPLAINROO_CONFIG: settings, OPENROUTER_API_KEY: '', ELEVENLABS_API_KEY: '', CARTESIA_API_KEY: '', EXPLAINROO_CLOUD_KEY: '', EXPLAINROO_CLIP_POLL_MS: '50',
      YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: '', YOUTUBE_REFRESH_TOKEN: '', BUFFER_CLIENT_ID: '', BUFFER_ACCESS_TOKEN: '', BUFFER_REFRESH_TOKEN: '', BUFFER_TOKEN_EXPIRES: '', BLOTATO_API_KEY: '', EXPLAINROO_PUBLISH_POLL_MS: '50', EXPLAINROO_PUBLISH_WAIT_MS: '2000' };
    await runSteps({ temp, settings, fake, closedPort: await closedPort(), installed: path.join(temp, 'node_modules', pkg.name) }, env);
    console.log('pack test passed');
    return 0;
  } catch (e) {
    console.error(`pack test failed: ${e.message}`);
    return 1;
  } finally {
    await fake.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

process.exitCode = await main();
