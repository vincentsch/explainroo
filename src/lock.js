// One run at a time in a step. A lock is a folder with one file in it, named after
// the run that holds it. A run makes that folder under a name of its own first and
// then renames it into place, so a lock that is held always has its file.
//
// A lock never runs out with time. While the process that holds it runs, everyone
// else waits, however long that takes. A run that dies leaves its lock behind, and
// the next run takes it over. It deletes that one file by its exact name, then the
// empty folder, and then tries the rename again. When two runs both found the same
// old lock, one of them gets in first, and the other one's delete finds no such
// file, so it can't touch the new holder's lock. A folder is only deleted while it
// is empty, and a held lock never is. A run that dies halfway through a takeover
// leaves an empty folder, which counts as free.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProjectError } from './errors.js';

const OWNER = /^held-by-(\d+)-([0-9a-f]{16})$/;
// The folder a run makes before it renames it into place.
const STAGING = /^\.lock-(\d+)-([0-9a-f]{16})$/;
// What a rename onto a lock that is there says on Linux, macOS and Windows.
const THERE = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY', 'ENOTDIR']);
// What deleting a lock folder says when it is gone or no longer empty.
const NOT_EMPTY = new Set(['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EBUSY', 'EPERM']);

// True while a process with this id runs on this computer. EPERM means it runs
// under another user. This works the same on Linux, macOS and Windows.
export function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

let bootId;

// Runs a program that reads a start time: quietly, in English and in UTC, without
// a window on Windows, and for a few seconds at most. Its output, or it throws.
function runQuietly(command, args) {
  return execFileSync(command, args, { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true });
}

// Output as text. wmic writes UTF-16 when its output goes to a pipe.
function outputText(out) {
  if (!Buffer.isBuffer(out)) return String(out ?? '');
  return (out.includes(0) ? out.toString('utf16le') : out.toString('latin1')).replace(/^\uFEFF/, '');
}

// Microseconds between 1601, where Windows counts from, and 1970.
const FROM_1601_US = 11644473600000000n;

// PowerShell's answer: when the process was created, in steps of 100 nanoseconds
// since 1601, in UTC.
export function fromFileTime(out) {
  const text = outputText(out).trim();
  if (!/^\d{1,20}$/.test(text)) return null;
  const us = BigInt(text) / 10n - FROM_1601_US;
  return us > 0n ? `win:${us}` : null;
}

// wmic's answer: CreationDate=20261108061234.567890+060, local time to the
// microsecond and the minutes it is ahead of UTC.
export function fromCimTime(out) {
  const m = /CreationDate=(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})/.exec(outputText(out));
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, micro, sign, offset] = m;
  const local = BigInt(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec))) * 1000n + BigInt(micro);
  const us = local - (sign === '-' ? -1n : 1n) * BigInt(offset) * 60000000n;
  return us > 0n ? `win:${us}` : null;
}

// The ways to read it on Windows, the quickest that is usually there first.
// PowerShell comes with every Windows since 7, and pwsh is the newer PowerShell.
// wmic is older and missing on new installs.
function windowsReads(pid) {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const shell = ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`];
  return [
    [path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), shell, fromFileTime],
    ['pwsh', shell, fromFileTime],
    [path.win32.join(root, 'System32', 'wbem', 'WMIC.exe'), ['process', 'where', `ProcessId=${pid}`, 'get', 'CreationDate', '/value'], fromCimTime],
  ];
}

// When a process started, as the system tells it, or null where it doesn't. Once a
// process is gone, a new one can get the same id, and the start time tells the two
// apart. Linux has it in /proc, in clock ticks since the computer started, so the
// id of that boot goes with it. macOS and the BSDs give it through ps, to the
// second, and a process id doesn't come back within the same second. Windows gives
// it through PowerShell or wmic, to the microsecond. That takes a moment, so a run
// reads its own start once, and a run that waits reads the holder's now and then.
//
// Where reading it fails, a lock goes by the process id alone. Then a holder that
// died, whose id another process got by chance, still counts as running. The next
// run waits for it and stops with a message, and it never takes over a lock whose
// holder may still run.
//
// A process that has ended and that its parent hasn't collected yet still has its
// id. It gets " ended" after its start time, so it never passes for a holder. On
// Windows such a process already counts as gone.
//
// `run` runs a program and returns its output, for tests.
export function startOf(pid, platform = process.platform, run = runQuietly) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (platform === 'win32') {
      for (const [command, args, parse] of windowsReads(pid)) {
        try {
          const started = parse(run(command, args));
          if (started) return started;
        } catch {}
      }
      return null;
    }
    if (platform === 'linux' || platform === 'android') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The name of the program is in brackets and may hold spaces, so the fields
      // are counted from the last ")". The state is field 3, the start time field 22.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = fields[19];
      if (!/^\d+$/.test(ticks ?? '')) return null;
      if (bootId === undefined) {
        try {
          bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
        } catch {
          bootId = '';
        }
      }
      return `${bootId}:${ticks}${/^[ZXx]/.test(fields[0]) ? ' ended' : ''}`;
    }
    const out = outputText(run('ps', ['-o', 'stat=', '-o', 'lstart=', '-p', String(pid)]));
    const [, state, started] = /^\s*(\S+)\s+(.+?)\s*$/.exec(out) ?? [];
    if (!started) return null;
    return `${started.replace(/\s+/g, ' ')}${state.startsWith('Z') ? ' ended' : ''}`;
  } catch {
    return null;
  }
}

// Whether two readings are of the same process. PowerShell counts in steps of 100
// nanoseconds and wmic in microseconds, so on Windows two readings of one process
// can be a microsecond apart. A new process that got a dead holder's id started
// long after that holder took its lock.
export function sameStart(a, b) {
  if (a === b) return true;
  const x = /^win:(\d+)$/.exec(a ?? '');
  const y = /^win:(\d+)$/.exec(b ?? '');
  if (!x || !y) return false;
  const gap = BigInt(x[1]) - BigInt(y[1]);
  return (gap < 0n ? -gap : gap) <= 1000n;
}

let ownStart;

function myStart() {
  if (ownStart === undefined) ownStart = startOf(process.pid);
  return ownStart;
}

// What a holder's file says: its start time, or null when the file has none, like
// one from an older copy of explainroo. `released` once the file is gone.
function readHolder(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    // Windows may refuse to open a file while it is being deleted. That holder is
    // still there for a moment, so it counts as running.
    return e.code === 'ENOENT' ? { released: true } : { started: null };
  }
  try {
    const saved = JSON.parse(text);
    return { started: typeof saved?.started === 'string' && saved.started ? saved.started : null };
  } catch {
    return { started: null };
  }
}

// Holders whose start time matched a moment ago. Reading it again only matters
// once the process could have ended and its id gone to a new one, and a run that
// waits asks many times a second. A read that takes long, like PowerShell, is
// repeated less often. A holder kept here a little too long only makes a run wait
// a little longer.
const confirmed = new Map();
const CONFIRMED_MS = 1000;

// A lock is left behind once its holder is gone: no process with its id runs on
// this computer, or the one that runs started at another time than the holder.
export function processGone(owner) {
  if (!processRuns(owner.pid)) return true;
  const holder = readHolder(owner.file);
  if (holder.released) return true;
  if (!holder.started) return false;
  const key = `${owner.name}\n${holder.started}`;
  const seen = confirmed.get(key);
  if (seen !== undefined && Date.now() - seen.at < Math.max(CONFIRMED_MS, 5 * seen.took)) return false;
  const began = Date.now();
  const now = startOf(owner.pid);
  if (now === null || sameStart(now, holder.started)) {
    if (confirmed.size > 100) confirmed.clear();
    confirmed.set(key, { at: Date.now(), took: Date.now() - began });
    return false;
  }
  return true;
}

// The end of the message of a run that waited too long: where the lock is, and
// when it is safe to move it away.
export function lockWords(lock) {
  return `The lock is the folder ${lock}. It is safe to move that folder away only when no explainroo command is running.`;
}

// How long a run waited, for a message.
export function secondsWords(ms) {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

// The same name for every way to write the path of one file: links are followed,
// and on Windows and macOS, whose disks usually don't tell letter case apart, case
// doesn't count either. A file that doesn't exist yet gets the real path of the
// nearest folder above it that does. With `follow: false` a link at the end keeps
// its own name, for a step that replaces whatever is at that place in its folder.
export function fileKey(file, { follow = true, platform = process.platform } = {}) {
  const full = path.resolve(file);
  let at = follow ? full : path.dirname(full);
  const rest = follow || at === full ? [] : [path.basename(full)];
  for (;;) {
    let real = null;
    for (const resolve of [fs.realpathSync.native, fs.realpathSync]) {
      try {
        real = resolve(at);
        break;
      } catch {}
    }
    if (real !== null) {
      at = path.join(real, ...rest);
      break;
    }
    const up = path.dirname(at);
    if (up === at) {
      at = path.join(at, ...rest);
      break;
    }
    rest.unshift(path.basename(at));
    at = up;
  }
  // Two names that the disk may take for the same file share a lock. Two that it
  // keeps apart and share one anyway only wait for each other.
  return platform === 'win32' || platform === 'darwin' ? at.normalize('NFC').toUpperCase().toLowerCase() : at;
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
// left the lock behind, from its { name, pid, file }. take() is true once this run
// holds the lock, release() gives it back, and drop() cleans up after a run that
// gave up. The holder's file names its process and when that process started.
export function lockFolder(lock, { left = processGone } = {}) {
  const folder = path.dirname(lock);
  fs.mkdirSync(folder, { recursive: true });
  clearStaging(folder);
  const token = crypto.randomBytes(8).toString('hex');
  const name = `held-by-${process.pid}-${token}`;
  const staging = path.join(folder, `.lock-${process.pid}-${token}`);
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, name), JSON.stringify({ pid: process.pid, started: myStart() }) + '\n');
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
// for the lock up to `waitMs`, and then throws what busy(lock) returns.
export function withLockSync(lock, fn, { waitMs = Infinity, busy, ...options } = {}) {
  const handle = lockFolder(lock, options);
  const deadline = Date.now() + waitMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  try {
    while (!handle.take()) {
      if (Date.now() >= deadline) throw busy(lock);
      Atomics.wait(pause, 0, 0, 50);
    }
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

// Waits for the lock up to `waitMs`, and then throws what busy(lock) returns.
export async function withLock(lock, fn, { waitMs, busy, pauseMs = 50, ...options }) {
  const handle = lockFolder(lock, options);
  const deadline = Date.now() + waitMs;
  try {
    while (!handle.take()) {
      if (Date.now() >= deadline) throw busy(lock);
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
