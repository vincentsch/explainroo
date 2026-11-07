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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOOD_KEY, startFakeServices } from '../test/helpers/fake-services.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = new URL('../test/helpers/guard.js', import.meta.url).href;
const STEP_TIMEOUT = 20 * 60 * 1000;
const MIN_NARRATION_UNDERSTOOD = 0.85;

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

// Each step runs "explainroo <args>" and must exit with 0. input goes to stdin.
// check gets the parsed --json output and a few paths, and the raw output after
// that. It throws on a problem and can return a short note for the report.
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
        expect(r.checks.find((c) => c.name === name)?.ok, `the ${name} is missing. Run "node bin/explainroo.js doctor --fetch" once, so this test can reuse it.`);
      }
    },
  },
  {
    args: ['docs', '--json'],
    check: (r, { installed }) => {
      expect(r.file === path.join(installed, 'AGENTS.md'), `docs read ${r.file}, not the installed AGENTS.md`);
      expect(r.text.includes('npx --yes explainroo'), 'the installed AGENTS.md does not say how to run the tool');
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
    },
  })),
  {
    args: ['services', '--json'],
    check: (r) => {
      expect(r.steps.length === 7 && r.services.length > 0, 'services lists no steps');
      for (const step of r.steps) {
        const first = r.services.find((s) => s.step === step.id);
        expect(first?.free, `the first entry of ${step.id} is not free`);
      }
      expect(r.services.every((s) => s.partner === false), 'a service says it is a paid partner');
      expect(r.services.find((s) => s.id === 'openrouter').connected === false, 'openrouter says connected with no key');
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
    args: ['init', 'video', '--json'],
    check: (r) => {
      const ignored = fs.readFileSync(path.join(r.dir, '.gitignore'), 'utf8').split('\n');
      expect(ignored.includes('.env'), 'the .gitignore of a new project does not list .env');
      expect(ignored.includes('history/private/'), 'the .gitignore of a new project does not list history/private/');
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
      return `${r.duration}s, ${r.video.width}x${r.video.height}, ${r.loudness.integrated} LUFS, ${Math.round(r.speech.matchRate * 100)}% of the narration understood`;
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
];

async function runSteps(paths, env) {
  for (const step of steps) {
    const name = step.args.filter((a) => a !== '--json').join(' ');
    const started = Date.now();
    // Without the "--", npx reads a flag like --version as its own.
    const r = await run('npx', ['--no', '--', 'explainroo', ...step.args], { cwd: paths.temp, env, input: step.input });
    if (r.status !== 0) throw new Error(`explainroo ${name} exited with ${r.status ?? r.signal}:\n${outputOf(r)}`);
    // npx sets its own exit code, so only stderr shows a request that it made.
    expect(!r.stderr.includes('test guard: blocked'), `explainroo ${name} tried to reach the network:\n${outputOf(r)}`);
    const note = step.check(JSON.parse(r.stdout), paths, r.stdout + r.stderr);
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
    const env = { ...outside, ...fake.env, NODE_OPTIONS: `--import=${GUARD}`, EXPLAINROO_CONFIG: settings, OPENROUTER_API_KEY: '', ELEVENLABS_API_KEY: '' };
    await runSteps({ temp, settings, fake, installed: path.join(temp, 'node_modules', pkg.name) }, env);
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
