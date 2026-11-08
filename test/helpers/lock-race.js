// Puts a run into the moments that matter for a lock. Only tests load this, through
// NODE_OPTIONS.
//
//   EXPLAINROO_TEST_RACE_PID      a process that is gone. The first time this run asks
//                                 whether it still runs, the run notes that in
//   EXPLAINROO_TEST_RACE_DIR      and waits until
//   EXPLAINROO_TEST_RACE_PARTIES  runs have got there, so they all saw the same lock,
//   EXPLAINROO_TEST_RACE_DELAY    and then waits this many ms more.
//   EXPLAINROO_TEST_SLOW_CLAIM    waits this many ms before it creates a job file, so the
//                                 run stays inside the lock of a clip purchase for a while.
//   EXPLAINROO_TEST_DIE_AT        "<fs function>:<pattern>[:<n>]" ends the run right before
//                                 the nth call of that function on a path that matches.
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const pause = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => { if (ms > 0) Atomics.wait(pause, 0, 0, ms); };

if (env.EXPLAINROO_TEST_RACE_PID) {
  const pid = Number(env.EXPLAINROO_TEST_RACE_PID);
  const dir = env.EXPLAINROO_TEST_RACE_DIR;
  const parties = Number(env.EXPLAINROO_TEST_RACE_PARTIES || 2);
  const delay = Number(env.EXPLAINROO_TEST_RACE_DELAY || 0);
  const realKill = process.kill.bind(process);
  let raced = false;
  process.kill = function kill(target, signal) {
    if (signal === 0 && Number(target) === pid && !raced) {
      raced = true;
      fs.writeFileSync(path.join(dir, String(process.pid)), '');
      const until = Date.now() + 20000;
      while (fs.readdirSync(dir).length < parties && Date.now() < until) sleep(5);
      sleep(delay);
    }
    return realKill(target, signal);
  };
}

if (env.EXPLAINROO_TEST_SLOW_CLAIM) {
  const ms = Number(env.EXPLAINROO_TEST_SLOW_CLAIM);
  const realOpen = fs.openSync;
  fs.openSync = function openSync(file, flags, ...rest) {
    if (flags === 'wx' && /[\\/]history[\\/]jobs[\\/]/.test(String(file))) sleep(ms);
    return realOpen.call(this, file, flags, ...rest);
  };
}

if (env.EXPLAINROO_TEST_DIE_AT) {
  const [name, pattern, nth = '1'] = env.EXPLAINROO_TEST_DIE_AT.split(':');
  const match = new RegExp(pattern);
  const real = fs[name];
  let calls = 0;
  fs[name] = function dieAt(file, ...rest) {
    if (match.test(String(file)) && ++calls === Number(nth)) process.kill(process.pid, 'SIGKILL');
    return real.call(this, file, ...rest);
  };
}
