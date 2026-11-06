// Catches accidents in tests: no request leaves this computer and the real
// settings stay out of reach. npm test and CI load this file with --import. It
// uses only Node's own modules, so it also works around an installed copy.
import childProcess from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Every Node program a test starts gets the guard too, from any folder. The
// file: address stays one absolute word, also with spaces in the path.
const flag = `--import=${import.meta.url}`;
if (!process.env.NODE_OPTIONS?.includes(flag)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, flag].filter(Boolean).join(' ');
}

if (!process.env.EXPLAINROO_CONFIG) {
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-settings-'));
  process.env.EXPLAINROO_CONFIG = settings;
  process.on('exit', () => fs.rmSync(settings, { recursive: true, force: true }));
}

// A blocked request fails the run, also when the code under test catches the
// error or a CLI sets its own exit code afterwards.
let blocked = false;
process.on('exit', () => {
  if (blocked) process.exitCode = 1;
});

// For the guard's own tests, which make blocked requests on purpose.
export function forgetBlockedRequests() {
  blocked = false;
}

function refuse(target) {
  const message = `test guard: blocked a request to ${target}`;
  process.stderr.write(`${message}\n`);
  blocked = true;
  return new Error(message);
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const realFetch = globalThis.fetch;
globalThis.fetch = async function fetch(input, init) {
  let url = null;
  try { url = new URL(input?.url ?? input); } catch {}
  if (url && /^https?:$/.test(url.protocol) && !LOCAL.has(url.hostname)) throw refuse(url.origin);
  return realFetch(input, init);
};

// Every other way out of Node opens a socket here: http, https, tls and the
// Playwright client that capture downloads with. This stops them before they
// even look up the name.
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const target = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof target === 'object' ? target?.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (!host || LOCAL.has(host)) return realConnect.apply(this, args);
  const error = refuse(host);
  // Fail a moment later, like a real connection, when the caller is listening.
  this.connecting = true;
  setImmediate(() => this.destroy(error));
  return this;
};

// NODE_OPTIONS can't reach what Chrome requests itself, so every browser that
// Playwright starts gets a rule that only the local machine has an address.
const HOST_RULES = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
const realSpawn = childProcess.spawn;
childProcess.spawn = function spawn(command, args, options) {
  const chrome = Array.isArray(args) && args.some((a) => String(a).startsWith('--remote-debugging-'));
  return realSpawn.call(this, command, chrome ? [...args, HOST_RULES] : args, options);
};
