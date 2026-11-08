// The lock that keeps clip purchases in one project from spending past the budget
// together. Each case starts real processes, because a lock is about several runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
const [dir, holdMs, rounds, crash] = process.argv.slice(1);
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
  }, { waitMs: 60000, busy: () => new Error('waited too long') });
}
`;

function run(dir, { holdMs = 0, rounds = 1, crash = false, env = {} } = {}) {
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --import=${RACE}`.trim();
  const child = spawn(process.execPath, ['--input-type=module', '-e', RUN, dir, String(holdMs), String(rounds), crash ? 'crash' : ''], {
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
