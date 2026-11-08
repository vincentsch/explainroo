// The lock that keeps clip purchases in one project from spending past the budget
// together. Each case starts real processes, because a lock is about several runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HISTORY = new URL('../src/history.js', import.meta.url).href;
const RACE = new URL('./helpers/lock-race.js', import.meta.url).href;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A run that takes the clip purchase lock, writes when it got in and when it left,
// and checks that nobody else is inside meanwhile. `crash` ends it inside the lock.
const RUN = `
import fs from 'node:fs';
import path from 'node:path';
import { withProjectLock } from ${JSON.stringify(HISTORY)};
const [dir, holdMs, rounds, crash, waitMs] = process.argv.slice(1);
const log = path.join(dir, 'log');
const inside = path.join(dir, 'inside');
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let round = 0; round < Number(rounds); round++) {
  await withProjectLock(dir, 'clip-purchase', () => {
    if (crash === 'crash') process.kill(process.pid, 'SIGKILL');
    try {
      fs.closeSync(fs.openSync(inside, 'wx'));
    } catch {
      fs.appendFileSync(log, 'two at once ' + process.pid + '\\n');
    }
    fs.appendFileSync(log, 'in ' + process.pid + ' ' + (performance.timeOrigin + performance.now()) + '\\n');
    Atomics.wait(pause, 0, 0, Number(holdMs));
    fs.appendFileSync(log, 'out ' + process.pid + ' ' + (performance.timeOrigin + performance.now()) + '\\n');
    fs.rmSync(inside, { force: true });
  }, { waitMs: Number(waitMs), busy: () => new Error('waited too long') });
}
`;

function run(dir, { holdMs = 0, rounds = 1, crash = false, waitMs = 60000, env = {} } = {}) {
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --import=${RACE}`.trim();
  const child = spawn(process.execPath, ['--input-type=module', '-e', RUN, dir, String(holdMs), String(rounds), crash ? 'crash' : '', String(waitMs)], {
    env: { ...process.env, NODE_OPTIONS: nodeOptions, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal, stderr, pid: child.pid })));
  return { child, done };
}

// A lock left behind by a purchase that died inside it.
async function leftLock(dir) {
  const r = await run(dir, { crash: true }).done;
  assert.equal(r.signal, 'SIGKILL', r.stderr);
  const lock = path.join(dir, 'history/locks/clip-purchase');
  assert.equal(fs.readdirSync(lock).length, 1, 'the lock is still there');
  return r.pid;
}

// Every run's time inside, from the log, and whether two were ever inside at once.
function stays(dir) {
  const lines = fs.existsSync(path.join(dir, 'log')) ? fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n') : [];
  assert.deepEqual(lines.filter((l) => l.startsWith('two at once')), [], 'nobody else was inside');
  const open = new Map();
  const spans = [];
  for (const line of lines) {
    const [what, pid, time] = line.split(' ');
    if (what === 'in') open.set(pid, Number(time));
    else spans.push({ pid, from: open.get(pid), to: Number(time) });
  }
  spans.sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].from >= spans[i - 1].to, `run ${spans[i].pid} got in before run ${spans[i - 1].pid} left`);
  return spans;
}

const lockFiles = (dir) => fs.readdirSync(path.join(dir, 'history/locks'));

// Each run asks whether the dead holder still runs, and waits there until all of
// them have, so they all found the same lock left behind. Then they go on one after
// the other, while the first one is still inside.
test('runs that all find the same lock left behind take it over one at a time', async (t) => {
  const dir = temp(t);
  const dead = await leftLock(dir);
  const race = path.join(dir, 'race');
  fs.mkdirSync(race);
  const runs = [0, 150, 300, 450].map((delay) => run(dir, {
    holdMs: 400,
    env: { EXPLAINROO_TEST_RACE_PID: String(dead), EXPLAINROO_TEST_RACE_DIR: race, EXPLAINROO_TEST_RACE_PARTIES: '4', EXPLAINROO_TEST_RACE_DELAY: String(delay) },
  }));
  const results = await Promise.all(runs.map((r) => r.done));
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readdirSync(race).length, 4, 'all four saw the lock of the run that died');
  assert.equal(stays(dir).length, 4);
  assert.deepEqual(lockFiles(dir), [], 'no lock is left once they are done');
});

// A run can die at any step of a takeover. The next run still gets in at once.
test('a run that dies in the middle of taking over a lock does not hold up the next one', async (t) => {
  const steps = [
    // after it found the lock left behind, before it deleted anything
    'unlinkSync:held-by-',
    // after it deleted the holder's file, so an empty folder is left
    'rmdirSync:clip-purchase$',
    // after it cleared the lock, before it put its own in place
    'renameSync:\\.lock-\\d+-:2',
  ];
  for (const step of steps) {
    const dir = temp(t);
    await leftLock(dir);
    const died = await run(dir, { env: { EXPLAINROO_TEST_DIE_AT: step } }).done;
    assert.equal(died.signal, 'SIGKILL', `${step}: ${died.stderr}`);
    const started = Date.now();
    const next = await run(dir, { holdMs: 10 }).done;
    assert.equal(next.code, 0, `${step}: ${next.stderr}`);
    assert.ok(Date.now() - started < 5000, `${step}: the next run got in without a long wait`);
    assert.equal(stays(dir).length, 1);
    assert.deepEqual(lockFiles(dir), [], `${step}: nothing of the dead runs is left`);
  }
});

// Many runs, while others keep dying inside the lock, so the lock is taken over
// again and again, often by several runs at the same moment.
test('the lock keeps one run inside at a time while other runs keep dying in it', async (t) => {
  const dir = temp(t);
  const workers = Array.from({ length: 6 }, () => run(dir, { holdMs: 1, rounds: 30 }));
  let crashes = 0;
  const crashing = Array.from({ length: 3 }, async () => {
    while (crashes < 24) {
      crashes++;
      const r = await run(dir, { crash: true }).done;
      assert.equal(r.signal, 'SIGKILL', r.stderr);
    }
  });
  const results = await Promise.all([...workers.map((w) => w.done), ...crashing]);
  for (const r of results.slice(0, 6)) assert.equal(r.code, 0, r.stderr);
  assert.equal(stays(dir).length, 180);
  // The last one in may have died there. The next run cleans up after all of them.
  assert.equal((await run(dir).done).code, 0);
  assert.deepEqual(lockFiles(dir), []);
});

test('a file where the lock goes stops the purchase with a plain message', async (t) => {
  const { withProjectLock } = await import('../src/history.js');
  const { ProjectError } = await import('../src/errors.js');
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'history/locks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'history/locks/clip-purchase'), 'not a lock');
  let ran = false;
  await assert.rejects(withProjectLock(dir, 'clip-purchase', () => { ran = true; }, { waitMs: 1000, busy: () => new Error('busy') }), (e) => e instanceof ProjectError && /history[\\/]locks[\\/]clip-purchase is a file, and explainroo needs that name for a lock\. Move the file somewhere else/.test(e.message));
  assert.equal(ran, false);
  assert.deepEqual(lockFiles(dir), ['clip-purchase'], 'the file stays, and nothing of the run is left');
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a process has the same start time each time it is read, and none once it is gone or on Windows', async () => {
  const { startOf } = await import('../src/lock.js');
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  // macOS and the BSDs read it with ps, which most Linux systems have too.
  const hasPs = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)]).status === 0;
  const platforms = [...(process.platform === 'linux' ? ['linux'] : []), ...(hasPs && process.platform !== 'win32' ? ['darwin'] : [])];
  for (const platform of platforms) {
    const mine = startOf(process.pid, platform);
    assert.ok(mine, platform);
    assert.equal(startOf(process.pid, platform), mine, platform);
    assert.equal(startOf(gone, platform), null, platform);
  }
  if (process.platform === 'linux') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
    await sleep(50);
    assert.notEqual(startOf(child.pid, 'linux'), startOf(process.pid, 'linux'), 'another process started at another time');
    child.kill();
  }
  assert.equal(startOf(process.pid, 'win32'), null);
});

// A holder can hang inside the lock, in a debugger or on a busy computer. It still
// holds the lock, so nobody else gets in, however long that takes.
test('a holder that hangs inside the lock keeps it, however old its file is, and the next run waits and then stops', { skip: process.platform === 'win32' && 'needs SIGSTOP' }, async (t) => {
  const { startOf } = await import('../src/lock.js');
  const dir = temp(t);
  const holder = run(dir, { holdMs: 1000 });
  t.after(() => holder.child.kill('SIGKILL'));
  const log = path.join(dir, 'log');
  while (!(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes(`in ${holder.child.pid} `))) await sleep(10);
  holder.child.kill('SIGSTOP');
  const lock = path.join(dir, 'history/locks/clip-purchase');
  const [name] = fs.readdirSync(lock);
  assert.equal(name.startsWith(`held-by-${holder.child.pid}-`), true);
  // The file says when the holder started, so a new process with its id can't pass for it.
  const saved = JSON.parse(fs.readFileSync(path.join(lock, name), 'utf8'));
  assert.equal(saved.pid, holder.child.pid);
  assert.equal(saved.started, startOf(holder.child.pid));
  const time = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(lock, name), time, time);

  const waited = await run(dir, { waitMs: 1000 }).done;
  assert.equal(waited.code, 1);
  assert.match(waited.stderr, /waited too long/);
  assert.deepEqual(fs.readdirSync(lock), [name], 'the lock stays with its holder');
  holder.child.kill('SIGCONT');
  assert.equal((await holder.done).code, 0);
  assert.equal((await run(dir).done).code, 0);
  assert.equal(stays(dir).length, 2);
  assert.deepEqual(lockFiles(dir), []);
});

// A service like Buffer gives a new refresh token each time and kills the old one,
// so two runs must never both renew the login with the same one.
test('two runs that renew a login while an old lock is left behind send one renewal', async (t) => {
  const crypto = await import('node:crypto');
  const { rotatingAccessToken } = await import('../src/oauth.js');
  const config = temp(t);
  const before = process.env.EXPLAINROO_CONFIG;
  process.env.EXPLAINROO_CONFIG = config;
  t.after(() => { process.env.EXPLAINROO_CONFIG = before; });
  const file = path.join(temp(t), '.env');
  fs.writeFileSync(file, `TEST_REFRESH=first\nTEST_ACCESS=old\nTEST_EXPIRES=${new Date(Date.now() - 1000).toISOString()}\n`);
  const lock = path.join(config, 'locks', crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 16));
  fs.mkdirSync(lock, { recursive: true });
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(path.join(lock, `held-by-${gone}-0123456789abcdef`), `${gone}\n`);
  const sent = [];
  const refresh = async (token) => {
    sent.push(token);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { ok: true, json: { access_token: 'new', refresh_token: 'second', expires_in: 3600 } };
  };
  const names = { refresh: 'TEST_REFRESH', access: 'TEST_ACCESS', expires: 'TEST_EXPIRES' };
  const renew = () => rotatingAccessToken({ source: { file }, names, refresh, name: 'Test', command: 'explainroo connect test' });
  assert.deepEqual(await Promise.all([renew(), renew()]), ['new', 'new']);
  assert.deepEqual(sent, ['first']);
  assert.match(fs.readFileSync(file, 'utf8'), /^TEST_REFRESH=second$/m);
  assert.deepEqual(fs.readdirSync(path.join(config, 'locks')), []);
});
