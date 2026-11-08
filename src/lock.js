// One run at a time in a step. A lock is a folder with one file in it, named after
// the run that holds it. A run makes that folder under a name of its own first and
// then renames it into place, so a lock that is held always has its file.
//
// A run that dies leaves its lock behind, and the next run takes it over. It deletes
// that one file by its exact name, then the empty folder, and then tries the rename
// again. When two runs both found the same old lock, one of them gets in first, and
// the other one's delete finds no such file, so it can't touch the new holder's
// lock. A folder is only deleted while it is empty, and a held lock never is. A run
// that dies halfway through a takeover leaves an empty folder, which counts as free.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError } from './errors.js';

const OWNER = /^held-by-(\d+)-([0-9a-f]{16})$/;
// The folder a run makes before it renames it into place.
const STAGING = /^\.lock-(\d+)-([0-9a-f]{16})$/;
// What a rename onto a lock that is there says on Linux, macOS and Windows.
const THERE = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY', 'ENOTDIR']);
// What deleting a lock folder says when it is gone or no longer empty.
const NOT_EMPTY = new Set(['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EBUSY', 'EPERM']);

export function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// The usual test: a lock is left behind once its process is gone.
export const processGone = (owner) => !processRuns(owner.pid);

// How long ago a holder took its lock, from its file. A time in the future counts
// the same, so a clock that jumped can't hold anyone up.
export function lockAge(owner) {
  const stat = fs.statSync(owner.file, { throwIfNoEntry: false });
  return stat ? Math.abs(Date.now() - stat.mtimeMs) : Infinity;
}

function ignore(fn, codes) {
  try {
    fn();
  } catch (e) {
    if (!codes.has(e.code)) throw e;
  }
}

// The folders that runs which are gone made and never renamed into place. Nobody
// else uses them.
function clearStaging(folder) {
  for (const name of fs.readdirSync(folder)) {
    const m = STAGING.exec(name);
    if (m && !processRuns(Number(m[1]))) fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

// Clears a lock that nobody holds: an empty folder, or one whose holder `left` says
// has left it behind. 'held' when a holder is still there, 'missing' when there is
// no lock, and 'cleared' otherwise. Every step is safe while another run takes the
// lock at the same moment.
function clearLeft(lock, left) {
  let names;
  try {
    names = fs.readdirSync(lock);
  } catch (e) {
    if (e.code === 'ENOENT') return 'missing';
    if (e.code === 'ENOTDIR') throw new ProjectError(`${lock} is a file, and explainroo needs that name for a lock. Move the file somewhere else and run the same command again.`);
    throw e;
  }
  const owners = names.flatMap((name) => {
    const m = OWNER.exec(name);
    return m ? [{ name, pid: Number(m[1]), file: path.join(lock, name) }] : [];
  });
  if (owners.some((owner) => !left(owner))) return 'held';
  // Only the files seen here go. A newer holder's file has another name.
  for (const name of names) {
    if (OWNER.test(name)) ignore(() => fs.unlinkSync(path.join(lock, name)), new Set(['ENOENT']));
    else fs.rmSync(path.join(lock, name), { recursive: true, force: true });
  }
  ignore(() => fs.rmdirSync(lock), NOT_EMPTY);
  return 'cleared';
}

// Gets ready to take the lock at `lock`. `left(owner)` says whether a holder has
// left the lock behind, from its { pid, file }. take() is true once this run holds
// the lock, release() gives it back, and drop() cleans up after a run that gave up.
export function lockFolder(lock, { left = processGone } = {}) {
  const folder = path.dirname(lock);
  fs.mkdirSync(folder, { recursive: true });
  clearStaging(folder);
  const token = crypto.randomBytes(8).toString('hex');
  const name = `held-by-${process.pid}-${token}`;
  const staging = path.join(folder, `.lock-${process.pid}-${token}`);
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, name), `${process.pid}\n`);
  const take = () => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        fs.renameSync(staging, lock);
        return true;
      } catch (e) {
        if (!THERE.has(e.code)) throw e;
        const state = clearLeft(lock, left);
        if (state === 'held') return false;
        // Windows also says EPERM when it can't rename for another reason.
        if (state === 'missing' && (e.code === 'EPERM' || e.code === 'EACCES') && tries === 2) throw e;
      }
    }
    return false;
  };
  const release = () => {
    ignore(() => fs.unlinkSync(path.join(lock, name)), new Set(['ENOENT']));
    ignore(() => fs.rmdirSync(lock), NOT_EMPTY);
  };
  const drop = () => fs.rmSync(staging, { recursive: true, force: true });
  return { take, release, drop };
}

// The same for a step that may not wait for a timer, like moving a file. It waits
// until it has the lock.
export function withLockSync(lock, fn, options) {
  const handle = lockFolder(lock, options);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  try {
    while (!handle.take()) Atomics.wait(pause, 0, 0, 50);
  } catch (e) {
    handle.drop();
    throw e;
  }
  try {
    return fn();
  } finally {
    handle.release();
  }
}

// Waits for the lock up to `waitMs`, and then throws what busy() returns.
export async function withLock(lock, fn, { waitMs, busy, pauseMs = 50, ...options }) {
  const handle = lockFolder(lock, options);
  const deadline = Date.now() + waitMs;
  try {
    while (!handle.take()) {
      if (Date.now() >= deadline) throw busy();
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  } catch (e) {
    handle.drop();
    throw e;
  }
  try {
    return await fn();
  } finally {
    handle.release();
  }
}
