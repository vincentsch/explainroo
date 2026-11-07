// The project record: a folder next to video.json that says what was paid for,
// rendered and shared. build/ and out/ can be deleted. This folder stays.
//
//   history/jobs/<key>.json        one file per attempt, <key>.2.json for the second
//   history/versions.jsonl         one line per finished render and package, plus verify results
//   history/voice/<key>.wav        paid speech, saved request by request
//   history/replaced/<hash>.<ext>  files that a newer purchase under the same name moved
//   history/failed-check/          what came back for a clip and failed its check
//   history/downloads/             clips on their way in, kept out of git
//   history/private/               links and addresses that act like secrets, kept out of git
//
// Keys never go in here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ProjectError, hideSecrets } from './errors.js';
import { findService } from './services.js';
import { LANGUAGES } from './models.js';
import { isSize } from './project.js';

const BIN = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const JOB_FILE = /^([0-9a-f]+)(?:\.(\d+))?\.json$/;

export function historyDir(dir, ...parts) {
  return path.join(dir, 'history', ...parts);
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = fs.readSync(fd, chunk)) > 0;) hash.update(chunk.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// The key is a hash of what makes it the same asset, whatever order the fields
// are written in.
export function jobKey(fields) {
  const sorted = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

function jobFile(dir, key, attempt) {
  return historyDir(dir, 'jobs', attempt > 1 ? `${key}.${attempt}.json` : `${key}.json`);
}

function readJob(file, key, attempt) {
  try {
    return { ...JSON.parse(fs.readFileSync(file, 'utf8')), key, attempt };
  } catch {
    // Another run has just created this file and not written it yet, or it
    // stopped at that moment. Either way a request may have gone out.
    return { key, attempt, status: 'requesting', kind: null, provider: null, output: null, request: null, created: fs.statSync(file).mtime.toISOString() };
  }
}

function attemptFiles(dir) {
  const folder = historyDir(dir, 'jobs');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).flatMap((name) => {
    const m = JOB_FILE.exec(name);
    return m ? [{ file: path.join(folder, name), key: m[1], attempt: Number(m[2] ?? 1) }] : [];
  });
}

// The attempts of one key, oldest first.
export function listAttempts(dir, key) {
  return attemptFiles(dir).filter((f) => f.key === key).sort((a, b) => a.attempt - b.attempt).map((f) => readJob(f.file, f.key, f.attempt));
}

// Every attempt of every key, oldest first.
export function listJobs(dir) {
  return attemptFiles(dir).map((f) => readJob(f.file, f.key, f.attempt)).sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.attempt - b.attempt);
}

export function shortId(job) {
  return job.key.slice(0, 8) + (job.attempt > 1 ? `.${job.attempt}` : '');
}

// Finds a job by the short id that history prints. Without an attempt number it
// means the newest attempt of that request.
export function findJob(dir, id) {
  const [prefix, attempt] = String(id).split('.');
  const keys = [...new Set(attemptFiles(dir).map((f) => f.key))].filter((k) => k.startsWith(prefix));
  if (!/^[0-9a-f]{4,}$/.test(prefix) || !keys.length) throw new ProjectError(`there is no job "${id}" in this project. Run "explainroo history" to see the jobs.`);
  if (keys.length > 1) throw new ProjectError(`more than one job starts with "${id}". Use more of its id.`);
  const attempts = listAttempts(dir, keys[0]);
  const job = attempt === undefined ? attempts.at(-1) : attempts.find((a) => a.attempt === Number(attempt));
  if (!job) throw new ProjectError(`there is no job "${id}" in this project. Run "explainroo history" to see the jobs.`);
  return job;
}

// Only one of two commands running at once gets past this. The exclusive open
// fails for the other one with EEXIST.
export function createJob(dir, key, { attempt = 1, ...fields }) {
  fs.mkdirSync(historyDir(dir, 'jobs'), { recursive: true });
  const now = new Date().toISOString();
  const job = { key, kind: null, provider: null, attempt, job_id: null, status: 'requesting', estimated_usd: null, cost_usd: null, output: null, request: null, ...fields, created: now, updated: now };
  const fd = fs.openSync(jobFile(dir, key, attempt), 'wx', 0o644);
  try {
    fs.writeSync(fd, JSON.stringify(job, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return job;
}

// For an attempt that never left this computer, so that there is nothing to remember.
export function forgetJob(dir, job) {
  fs.rmSync(jobFile(dir, job.key, job.attempt), { force: true });
}

export function updateJob(dir, job, changes) {
  const file = jobFile(dir, job.key, job.attempt);
  const next = { ...readJob(file, job.key, job.attempt), ...changes, updated: new Date().toISOString() };
  if (next.error) next.error = hideSecrets(next.error);
  writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

// Where a job's output may be. A job file can arrive with a stranger's project,
// so this comes from here and not from what the file says. Each kind adds its own.
function outputPlaces(job) {
  const { name, sha256 } = job.output;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return [];
  if (job.kind === 'speech') return [`history/voice/${job.attempt > 1 ? `${job.key}.${job.attempt}` : job.key}.wav`];
  if (job.kind === 'image' && /^[\w-]+$/.test(job.request?.name) && new RegExp(`^assets/${job.request.name}\\.(png|jpg|webp)$`).test(name)) return [name, replacedFile(name, sha256)];
  if (job.kind === 'clip' && /^[\w-]+$/.test(job.request?.name) && name === `assets/clips/${job.request.name}.mp4`) return [name, replacedFile(name, sha256)];
  return [];
}

// Where a job's output is now, but only if it is still the file that was
// bought. A job never hands out a file with another hash.
export function goodOutput(dir, job) {
  if (job.status !== 'done' || !job.output) return null;
  for (const rel of outputPlaces(job)) {
    if (fs.existsSync(path.join(dir, rel)) && sha256File(path.join(dir, rel)) === job.output.sha256) return rel;
  }
  return null;
}

function replacedFile(name, sha256) {
  return path.posix.join('history/replaced', `${sha256}${path.extname(name)}`);
}

function stopReason(dir, job) {
  if (job.status === 'requesting') return 'unknown';
  if (job.status !== 'done') return job.status;
  const name = job.output?.name ?? job.output?.file;
  return name && fs.existsSync(path.join(dir, name)) ? 'changed' : 'deleted';
}

// The rules for buying. An ordinary repeat looks at the attempts of a request:
// the newest one if it is still running, then the newest one with a good
// output. If there is none, the newest attempt decides what happens.
// `fresh` is the user saying "buy this again anyway".
export function decide(dir, key, { fresh = false } = {}) {
  const attempts = listAttempts(dir, key);
  const newest = attempts.at(-1);
  const attempt = (newest?.attempt ?? 0) + 1;
  if (!newest || fresh) return { action: 'buy', attempt };
  if (newest.status === 'running') return { action: 'resume', job: newest };
  for (const job of [...attempts].reverse()) {
    const file = goodOutput(dir, job);
    if (file) return { action: 'use', job, file, newer: job === newest ? null : newest };
  }
  // The service said no, or nothing was sent. That can't have cost anything.
  if (newest.status === 'refused') return { action: 'buy', attempt };
  return { action: 'stop', job: newest, reason: stopReason(dir, newest), attempt };
}

// True when the newest attempt of a request has no good output.
export function unsettled(dir, key) {
  const newest = listAttempts(dir, key).at(-1);
  return !!newest && !goodOutput(dir, newest);
}

function when(iso) {
  return `${oneLine(iso, 16).replace('T', ' ')} UTC`;
}

// Text from a job file stays on one line, so it can't pose as another line of output.
function oneLine(text, length) {
  return String(text ?? '').replace(/[\s\p{Cc}]+/gu, ' ').slice(0, length);
}

function saidBy(job) {
  return job.error ? ` (${oneLine(job.error, 300).replace(/\.$/, '')})` : '';
}

// One or two sentences that say what happened to a job that has no good output.
export function stopSentence(job, reason) {
  const name = oneLine(job.output?.name ?? job.output?.file, 200);
  switch (reason) {
    case 'unknown': return `The request went out on ${when(job.created)} and no answer was saved. Another run may still be working on it, or an earlier run stopped before it got an answer, and that request may have cost money.`;
    case 'lost': return `No answer came back on ${when(job.updated)}${saidBy(job)}, so that request may have cost money.`;
    case 'failed': return `It failed on ${when(job.updated)}${saidBy(job)}, and that try may have cost money.`;
    case 'refused': return `The service refused it on ${when(job.updated)}${saidBy(job)}. That cost nothing.`;
    case 'running': return `It went out on ${when(job.created)}, and its result has not been fetched yet. Continuing it buys nothing.`;
    case 'cancelled': return `The service says it was cancelled on ${when(job.updated)}${saidBy(job)}, and that try may have cost money.`;
    case 'expired': return `The service says it expired on ${when(job.updated)}${saidBy(job)}, and that try may have cost money.`;
    case 'gone': return `It went out on ${when(job.created)}, and by ${when(job.updated)} the service no longer had the result. It keeps results only for a short time, and that try may have cost money.`;
    case 'failed-check': return `The file that came back on ${when(job.updated)} failed the check${saidBy(job)}. It is kept at ${oneLine(job.kept, 200)}, and that try may have cost money.`;
    case 'deleted': return `It was bought on ${when(job.created)}, but ${name} is gone.`;
    case 'changed': return `It was bought on ${when(job.created)}, but ${name} has changed since then.`;
    default: return `Its status is ${oneLine(job.status, 40)}.`;
  }
}

// Moves a file out of the way instead of deleting it, and tells the job that
// bought it where it went. A file no job knows about moves the same way. A link
// is only removed: what it points at could be anything, even a file with a key.
export function moveAside(dir, rel) {
  const from = path.join(dir, rel);
  const stat = fs.lstatSync(from, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    fs.rmSync(from, { force: true });
    return { from: rel, to: null, known: false };
  }
  const sha256 = sha256File(from);
  const to = replacedFile(rel, sha256);
  const saved = path.join(dir, to);
  fs.mkdirSync(historyDir(dir, 'replaced'), { recursive: true });
  // The original only goes once a whole copy is there, also if a run dies halfway.
  if (!fs.existsSync(saved) || sha256File(saved) !== sha256) {
    const temp = `${saved}.${process.pid}.tmp`;
    fs.copyFileSync(from, temp);
    fs.renameSync(temp, saved);
  }
  fs.rmSync(from, { force: true });
  const owners = listJobs(dir).filter((job) => job.output?.sha256 === sha256 && job.output.file === rel);
  for (const job of owners) updateJob(dir, job, { output: { ...job.output, file: to } });
  return { from: rel, to, known: owners.length > 0 };
}

// Saves what a purchase returned before anything else happens to it.
export function saveOutput(dir, name, bytes) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const file = replacedFile(name, sha256);
  fs.mkdirSync(historyDir(dir, 'replaced'), { recursive: true });
  writeAtomic(path.join(dir, file), bytes);
  return { file, name, sha256, bytes: bytes.length };
}

// The same for a file that is already on disk, on its way in from a download.
export function saveOutputFile(dir, name, temp) {
  const sha256 = sha256File(temp);
  const file = replacedFile(name, sha256);
  const { size } = fs.statSync(temp);
  fs.mkdirSync(historyDir(dir, 'replaced'), { recursive: true });
  fs.renameSync(temp, path.join(dir, file));
  return { file, name, sha256, bytes: size };
}

// One run at a time moves files under a public name, or moves a post to its next
// stage. Either takes far less than the 15 seconds after which a lock counts as
// left behind by a dead run.
export function withNameLock(dir, name, fn) {
  fs.mkdirSync(historyDir(dir, 'locks'), { recursive: true });
  const lock = historyDir(dir, 'locks', `${crypto.createHash('sha256').update(name).digest('hex').slice(0, 16)}.lock`);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const stat = fs.statSync(lock, { throwIfNoEntry: false });
      if (stat && Math.abs(Date.now() - stat.mtimeMs) > 15000) fs.rmSync(lock, { force: true });
      Atomics.wait(pause, 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// All at once, so a run that dies never leaves half a file under a public name.
export function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    const temp = `${to}.${process.pid}.tmp`;
    fs.copyFileSync(from, temp);
    fs.renameSync(temp, to);
    fs.rmSync(from, { force: true });
  }
}

// Puts a job's output under its public name. Whatever is there moves aside first,
// and so do the other files in `others`.
export function placeOutput(dir, { key, attempt }, others = []) {
  return withNameLock(dir, others.join() || key, () => {
    const job = listAttempts(dir, key).find((a) => a.attempt === attempt);
    const source = goodOutput(dir, job);
    const { name } = job.output;
    if (!source) throw new ProjectError(`${name} is gone, or it has changed, and no copy of it is left. To buy it again, run the same command with --new.`);
    const moved = others.filter((other) => other !== name && other !== source).map((other) => moveAside(dir, other)).filter(Boolean);
    // Another run may have put the same file in place first. The record says where it is.
    if (source === name) return { job: job.output.file === name ? job : updateJob(dir, job, { output: { ...job.output, file: name } }), moved };
    const pushed = moveAside(dir, name);
    if (pushed) moved.push(pushed);
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    moveFile(path.join(dir, source), path.join(dir, name));
    return { job: updateJob(dir, job, { output: { ...job.output, file: name } }), moved };
  });
}

export function recordVersion(dir, line) {
  fs.mkdirSync(historyDir(dir), { recursive: true });
  fs.appendFileSync(historyDir(dir, 'versions.jsonl'), JSON.stringify(line) + '\n');
}

// Every line of versions.jsonl, oldest first.
export function versionLines(dir) {
  const file = historyDir(dir, 'versions.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((text) => {
    try { return [JSON.parse(text)]; } catch { return []; }
  });
}

// The renders, oldest first. A verify result is its own line, so that a run can
// append it without rewriting the file, and here it joins the render with the
// same file hash.
export function readVersions(dir) {
  const lines = versionLines(dir);
  const results = new Map();
  for (const line of lines) if (line.event === 'verify') results.set(line.sha256, line);
  return lines.filter((line) => line.event !== 'verify').map((line) => (results.has(line.sha256) ? { ...line, verify: results.get(line.sha256) } : line));
}

export function relativeFile(dir, file) {
  const rel = path.relative(dir, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
}

// Adds a line to a project's .gitignore when it is missing.
export function ensureIgnored(dir, entry) {
  const file = path.join(dir, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const plain = (line) => line.trim().replace(/^\/|\/$/g, '');
  if (text.split('\n').some((line) => plain(line) === plain(entry))) return false;
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`);
  return true;
}

// For anything that acts like a secret, such as a claim link or an upload
// session address.
export function writePrivate(dir, name, data) {
  ensureIgnored(dir, 'history/private/');
  const folder = historyDir(dir, 'private');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, name);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

export function shellWord(word) {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  return process.platform === 'win32' ? `"${word}"` : `'${word.replace(/'/g, "'\\''")}'`;
}

// How this copy of the tool is started, so that a printed command works when
// someone pastes it. Through npx there is no explainroo command on the PATH.
export function selfCommand(env = process.env) {
  if (env.npm_command === 'exec') return 'npx --yes explainroo';
  const onPath = (env.PATH || '').split(path.delimiter).some((folder) => {
    try { return fs.realpathSync(path.join(folder || '.', 'explainroo')) === fs.realpathSync(BIN); } catch { return false; }
  });
  return onPath ? 'explainroo' : `node ${shellWord(BIN)}`;
}

export function projectWord(dir, cwd = process.cwd()) {
  return shellWord(path.relative(cwd, dir) || '.');
}

// The command that continues a job. A running job only has its result to fetch, and
// a refused job can go again as it is. Everything else may have cost money, so it
// needs --new. A clip that may be bought again needs a cap, so it repeats the
// user's. That number comes from a file that a stranger's project can bring.
const CONTINUE = {
  image: (job, where, again) => `image ${where} --resume ${shortId(job)}${again}`,
  // A job file can come with a stranger's project, so only a known language and a
  // real size go in the command. A sentence at the pace of a size continues at it.
  speech: (job, where, again) => `voice ${where}${typeof job.lang === 'string' && Object.hasOwn(LANGUAGES, job.lang) ? ` --lang ${job.lang}` : ''}${typeof job.size === 'string' && isSize(job.size) ? ` --size ${job.size}` : ''}${again}`,
  clip: (job, where, again, reason) => {
    const cap = Number(job.max_cost_usd);
    return `clip ${where} --resume ${shortId(job)}${again}${reason !== 'running' && cap > 0 ? ` --max-cost ${cap}` : ''}`;
  },
};

export function continueCommand(dir, job, reason) {
  const again = reason === 'refused' || reason === 'running' ? '' : ' --new';
  return `${selfCommand()} ${CONTINUE[job.kind](job, projectWord(dir), again, reason)}`;
}

const FREE_KINDS = new Set(['share', 'publish']);

function jobLabel(job) {
  const r = job.request || {};
  if (job.kind === 'speech') return `scene ${oneLine(job.scene ?? '?', 60)}: "${oneLine(r.text, 60)}"`;
  if (job.kind === 'image') return `${oneLine(r.name ?? '?', 60)}: "${oneLine(r.prompt, 60)}" with ${oneLine(r.model ?? '?', 60)}`;
  if (job.kind === 'clip') return `${oneLine(r.name ?? '?', 60)}: "${oneLine(r.prompt, 60)}" with ${oneLine(r.model ?? '?', 60)}, ${oneLine(r.seconds ?? '?', 10)} seconds`;
  return oneLine(job.kind ?? 'unknown', 60);
}

// A job is open when someone would want to continue it. A bought file that was
// later deleted or changed is no reason to spend money, unless a scene still needs
// it (`needed`). A refusal cost nothing, so it doesn't matter once an earlier attempt
// is good, or for a sentence no scene has to be built from. And a newer purchase
// under the same name means someone moved on, unless a job is still running: that
// one was paid for, and fetching its result buys nothing.
function isOpen(dir, job, jobs, current, needed) {
  if (!Object.hasOwn(CONTINUE, job.kind ?? '') || !current(job) || goodOutput(dir, job)) return false;
  if (job.status === 'running') return true;
  if (job.status === 'done') return needed(job);
  if (job.status === 'refused' && job.kind === 'speech' && !needed(job)) return false;
  if (job.status === 'refused' && jobs.some((other) => other.key === job.key && goodOutput(dir, other))) return false;
  return !(job.kind !== 'speech' && jobs.some((other) => other.kind === job.kind && other.key !== job.key && other.status === 'done' && other.request?.name === job.request?.name && other.created > job.created));
}

// What history prints. `current` says whether a job is still wanted: a sentence
// that left the script has nothing left to continue.
export function historyReport(dir, { current = () => true, needed = () => false, otherSpend = [] } = {}) {
  const jobs = listJobs(dir);
  const newest = new Map();
  for (const job of jobs) if (job.attempt >= (newest.get(job.key)?.attempt ?? 0)) newest.set(job.key, job);
  const open = [...newest.values()].filter((job) => isOpen(dir, job, jobs, current, needed)).map((job) => {
    const reason = stopReason(dir, job);
    return { id: shortId(job), kind: job.kind, provider: job.provider, status: job.status, reason, what: jobLabel(job), created: job.created, updated: job.updated, message: stopSentence(job, reason), command: continueCommand(dir, job, reason) };
  });
  // Sharing a link costs nothing, so it is no part of the spend.
  const paid = jobs.filter((job) => !FREE_KINDS.has(job.kind));
  const spend = { usd: 0, attempts: paid.length + otherSpend.length, unknown_price: 0, may_have_cost_usd: 0, characters: {} };
  for (const entry of otherSpend) spend.usd += entry.cost_usd || 0;
  for (const job of paid) {
    spend.usd += job.cost_usd || 0;
    const byCharacters = job.status === 'done' && job.characters;
    if (byCharacters) spend.characters[job.provider] = (spend.characters[job.provider] || 0) + job.characters;
    if (job.cost_usd === null && job.status !== 'refused' && !byCharacters) spend.unknown_price++;
    if (job.cost_usd === null && job.status !== 'done' && job.status !== 'refused') spend.may_have_cost_usd += job.estimated_usd || 0;
  }
  spend.usd = Math.round(spend.usd * 10000) / 10000;
  spend.may_have_cost_usd = Math.round(spend.may_have_cost_usd * 10000) / 10000;
  return { open, spend, versions: readVersions(dir), jobs: jobs.map((job) => ({ id: shortId(job), ...job })) };
}

function versionLine(v) {
  const kind = [v.draft ? 'draft' : 'final', ...(!v.draft && v.motionBlur === false ? ['no motion blur'] : []), v.full ? 'full video' : `${v.range?.from}s to ${v.range?.to}s`, ...(v.scale === 1 ? [] : [`scale ${v.scale}`]), `watermark ${v.watermark ? 'on' : 'off'}`, ...(v.event === 'package' ? [`package for ${v.platform}`] : [])];
  const checked = v.verify ? `verify ${v.verify.ok ? 'passed' : 'found errors'}${v.verify.understood == null ? '' : `, ${Math.round(v.verify.understood * 100)}% understood`}` : 'not verified';
  return `  ${oneLine(`${when(v.time)}  ${v.file}  ${v.format} ${v.width}x${v.height}, ${Number(v.duration).toFixed(1)}s, ${kind.join(', ')}, ${checked}`, 400)}`;
}

function clipLine(job) {
  const file = job.output?.file ?? job.kept ?? `${job.request?.name}, no file`;
  const cost = typeof job.cost_usd === 'number' ? `$${job.cost_usd.toFixed(4)}` : job.status === 'refused' ? 'cost nothing' : typeof job.estimated_usd === 'number' ? `about $${job.estimated_usd.toFixed(2)}` : 'cost unknown';
  return `  ${oneLine(`${job.id}  ${job.status}  ${file}  ${cost}`, 400)}`;
}

// What each stage of a post means, for a line in history.
const POST_STAGES = {
  planned: 'approved, nothing sent yet',
  media_uploaded: 'video uploaded, the post not sent yet',
  sending: 'sent, and no answer was saved, so check the channel by hand',
  accepted: 'accepted, the final status not read yet',
  finished: 'posted',
  failed: 'failed',
};

function postLine(job) {
  const r = job.result ?? {};
  const said = job.stage === 'failed' && r.error ? `: ${r.error}` : '';
  const where = `${job.provider ?? '?'} ${job.plan?.platform ?? '?'} to ${job.destination?.name ?? job.destination?.id ?? '?'}`;
  return `  ${oneLine(`${job.id}  ${where}  ${POST_STAGES[job.stage] ?? 'unknown'}${said}${r.link ? `  ${r.link}` : ''}`, 400)}`;
}

function shareLine(job) {
  const r = job.result ?? {};
  const where = job.status === 'done' && r.url
    ? `${r.url}, ${r.expires_at ? `expires ${when(r.expires_at)}` : 'does not expire'}`
    : job.status === 'refused' ? 'not shared' : 'no link came back, and the server may have the video';
  return `  ${oneLine(`${job.id}  ${job.request?.file ?? '?'}  ${where}`, 400)}`;
}

export function formatHistory({ open, spend, versions, jobs = [] }) {
  const parts = [];
  parts.push(open.length ? ['Open jobs', ...open.flatMap((o) => [`  ${o.id}  ${o.kind}  ${o.what}`, `    ${o.message}`, `    To continue: ${o.command}`])].join('\n') : 'No open jobs.');
  const paid = spend.usd || !Object.keys(spend.characters).length ? [`  $${spend.usd.toFixed(4)} in known prices`] : [];
  for (const [provider, characters] of Object.entries(spend.characters)) paid.push(`  ${oneLine(findService(provider)?.name ?? provider, 60)}: ${Number(characters)} characters`);
  if (spend.unknown_price) paid.push(`  ${spend.unknown_price} attempt${spend.unknown_price === 1 ? ' has' : 's have'} no known price and may have cost money${spend.may_have_cost_usd ? `, about $${spend.may_have_cost_usd.toFixed(2)} at the usual price` : ''}.`);
  parts.push(spend.attempts ? [`Spend so far, across ${spend.attempts} attempt${spend.attempts === 1 ? '' : 's'}`, ...paid].join('\n') : 'Nothing bought yet.');
  const clips = jobs.filter((job) => job.kind === 'clip');
  if (clips.length) parts.push(['Clips', ...clips.map(clipLine)].join('\n'));
  const shares = jobs.filter((job) => job.kind === 'share');
  if (shares.length) parts.push(['Shared links', ...shares.map(shareLine)].join('\n'));
  const posts = jobs.filter((job) => job.kind === 'publish');
  if (posts.length) parts.push(['Posts', ...posts.map(postLine)].join('\n'));
  parts.push(versions.length ? ['Rendered versions', ...versions.map(versionLine)].join('\n') : 'Nothing rendered yet.');
  return parts.join('\n\n');
}
