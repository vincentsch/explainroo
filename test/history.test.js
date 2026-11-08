import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createJob, decide, ensureIgnored, findJob, goodOutput, historyDir, historyReport, jobKey, listAttempts, listJobs, moveAside, placeOutput, readVersions, recordVersion, saveOutput, selfCommand, sha256File, shellWord, shortId, updateJob, writePrivate } from '../src/history.js';
import { ProjectError, hideSecrets, rememberSecret } from '../src/errors.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

function buy(dir, key, data, name = 'assets/hero.png', attempt = 1) {
  const job = createJob(dir, key, { kind: 'image', provider: 'made-up', attempt, request: { name: 'hero', prompt: 'a hero' } });
  const output = saveOutput(dir, name, Buffer.from(data));
  const done = updateJob(dir, job, { status: 'done', cost_usd: 0.1, output });
  return placeOutput(dir, done).job;
}

test('a job file holds what the record promises, and a key does not depend on field order', (t) => {
  const dir = temp(t);
  const key = jobKey({ kind: 'image', prompt: 'a', model: 'b' });
  assert.equal(key, jobKey({ model: 'b', prompt: 'a', kind: 'image' }));
  assert.notEqual(key, jobKey({ kind: 'image', prompt: 'c', model: 'b' }));
  createJob(dir, key, { kind: 'image', provider: 'made-up', estimated_usd: 0.2, request: { prompt: 'a' } });
  const saved = JSON.parse(fs.readFileSync(historyDir(dir, 'jobs', `${key}.json`), 'utf8'));
  for (const field of ['kind', 'provider', 'attempt', 'job_id', 'status', 'estimated_usd', 'cost_usd', 'output', 'request', 'created', 'updated']) assert.ok(field in saved, field);
  assert.equal(saved.attempt, 1);
  assert.equal(saved.status, 'requesting');
  assert.equal(saved.estimated_usd, 0.2);
  assert.equal(saved.job_id, null);
});

test('attempts get their own files, and the second one is named <key>.2.json', (t) => {
  const dir = temp(t);
  const key = jobKey({ a: 1 });
  const first = createJob(dir, key, { kind: 'image' });
  const second = createJob(dir, key, { kind: 'image', attempt: 2 });
  assert.ok(fs.existsSync(historyDir(dir, 'jobs', `${key}.json`)));
  assert.ok(fs.existsSync(historyDir(dir, 'jobs', `${key}.2.json`)));
  assert.equal(shortId(first), key.slice(0, 8));
  assert.equal(shortId(second), `${key.slice(0, 8)}.2`);
  assert.deepEqual(listAttempts(dir, key).map((a) => a.attempt), [1, 2]);
  assert.equal(findJob(dir, key.slice(0, 8)).attempt, 2);
  assert.equal(findJob(dir, `${key.slice(0, 8)}.2`).attempt, 2);
  assert.throws(() => findJob(dir, 'ffffffff'), /no job "ffffffff"/);
  assert.throws(() => findJob(dir, `${key.slice(0, 8)}.9`), /no job/);
});

test('of many processes creating the same job at once, exactly one gets it', async (t) => {
  const dir = temp(t);
  const history = new URL('../src/history.js', import.meta.url).href;
  const script = `import { createJob } from ${JSON.stringify(history)};
    try { createJob(${JSON.stringify(dir)}, 'abcd1234abcd1234', { kind: 'image' }); process.exitCode = 0; }
    catch (e) { process.exitCode = e.code === 'EEXIST' ? 3 : 4; }`;
  const runs = Array.from({ length: 8 }, () => spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' }));
  const codes = await Promise.all(runs.map(async (child) => (await once(child, 'close'))[0]));
  assert.deepEqual(codes.toSorted(), [0, 3, 3, 3, 3, 3, 3, 3]);
  assert.equal(JSON.parse(fs.readFileSync(historyDir(dir, 'jobs', 'abcd1234abcd1234.json'), 'utf8')).kind, 'image');
});

test('a job file that was opened and not written yet counts as a request that went out', (t) => {
  const dir = temp(t);
  fs.mkdirSync(historyDir(dir, 'jobs'), { recursive: true });
  fs.writeFileSync(historyDir(dir, 'jobs', 'abcd1234.json'), '');
  const d = decide(dir, 'abcd1234');
  assert.equal(d.action, 'stop');
  assert.equal(d.reason, 'unknown');
});

test('an update replaces the file whole and leaves no temp file', (t) => {
  const dir = temp(t);
  const job = createJob(dir, 'abcd1234', { kind: 'image' });
  updateJob(dir, job, { status: 'done' });
  assert.deepEqual(fs.readdirSync(historyDir(dir, 'jobs')), ['abcd1234.json']);
  const saved = listAttempts(dir, 'abcd1234')[0];
  assert.equal(saved.status, 'done');
  assert.ok(saved.updated >= saved.created);
});

test('the rules for buying: nothing yet, a running job, a good output, and each kind of trouble', (t) => {
  const dir = temp(t);
  assert.deepEqual(decide(dir, 'aaaa1111'), { action: 'buy', attempt: 1 });

  const running = createJob(dir, 'bbbb2222', { kind: 'image', status: 'running', job_id: 'outside-1' });
  const resumed = decide(dir, 'bbbb2222');
  assert.equal(resumed.action, 'resume');
  assert.equal(resumed.job.job_id, running.job_id);

  createJob(dir, 'cccc3333', { kind: 'image' });
  const open = decide(dir, 'cccc3333');
  assert.equal(open.action, 'stop');
  assert.equal(open.reason, 'unknown');
  assert.deepEqual(decide(dir, 'cccc3333', { fresh: true }), { action: 'buy', attempt: 2 });

  for (const [key, status] of [['dddd4444', 'failed'], ['eeee5555', 'lost']]) {
    updateJob(dir, createJob(dir, key, { kind: 'image' }), { status });
    assert.equal(decide(dir, key).action, 'stop');
    assert.equal(decide(dir, key).reason, status);
  }

  updateJob(dir, createJob(dir, 'ffff6666', { kind: 'image' }), { status: 'refused' });
  assert.deepEqual(decide(dir, 'ffff6666'), { action: 'buy', attempt: 2 });

  const bought = buy(dir, 'abab7777', 'first');
  const use = decide(dir, 'abab7777');
  assert.equal(use.action, 'use');
  assert.equal(use.file, 'assets/hero.png');
  assert.equal(use.newer, null);
  assert.equal(use.job.attempt, bought.attempt);
});

test('a repeat returns the newest good attempt, and says when a newer try has no answer', (t) => {
  const dir = temp(t);
  const key = 'abcd1234';
  buy(dir, key, 'first');
  buy(dir, key, 'second', 'assets/hero.png', 2);
  assert.equal(decide(dir, key).job.attempt, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'assets/hero.png'), 'utf8'), 'second');
  createJob(dir, key, { kind: 'image', attempt: 3 });
  const d = decide(dir, key);
  assert.equal(d.action, 'use');
  assert.equal(d.job.attempt, 2);
  assert.equal(d.newer.attempt, 3);
});

test('a deleted or changed output is never returned', (t) => {
  const dir = temp(t);
  const job = buy(dir, 'abcd1234', 'bought');
  const file = path.join(dir, 'assets/hero.png');
  fs.writeFileSync(file, 'changed by hand');
  assert.equal(goodOutput(dir, job), null);
  assert.equal(decide(dir, 'abcd1234').reason, 'changed');
  fs.rmSync(file);
  assert.equal(decide(dir, 'abcd1234').reason, 'deleted');
  assert.deepEqual(decide(dir, 'abcd1234', { fresh: true }), { action: 'buy', attempt: 2 });
});

test('a replaced file moves aside with the job pointing at it, and a file no job knows moves the same way', (t) => {
  const dir = temp(t);
  const first = buy(dir, 'aaaa1111', 'first');
  buy(dir, 'bbbb2222', 'second');
  const moved = listAttempts(dir, 'aaaa1111')[0];
  assert.equal(moved.output.file, `history/replaced/${sha('first')}.png`);
  assert.equal(moved.output.name, 'assets/hero.png');
  assert.equal(goodOutput(dir, moved), moved.output.file);
  assert.equal(first.output.sha256, sha('first'));
  assert.equal(fs.readFileSync(path.join(dir, 'assets/hero.png'), 'utf8'), 'second');

  const unknown = path.join(dir, 'assets/old.png');
  fs.writeFileSync(unknown, 'from before');
  const m = moveAside(dir, 'assets/old.png');
  assert.equal(m.known, false);
  assert.equal(fs.existsSync(unknown), false);
  assert.equal(fs.readFileSync(path.join(dir, m.to), 'utf8'), 'from before');
  assert.equal(moveAside(dir, 'assets/none.png'), null);
});

test('a job finds its output by hash when the same bytes are already set aside', (t) => {
  const dir = temp(t);
  const output = saveOutput(dir, 'assets/hero.png', Buffer.from('same'));
  assert.equal(output.sha256, sha('same'));
  assert.equal(sha256File(path.join(dir, output.file)), output.sha256);
  const job = updateJob(dir, createJob(dir, 'abcd1234', { kind: 'image', request: { name: 'hero' } }), { status: 'done', output: { ...output, file: 'gone/elsewhere.png' } });
  assert.equal(goodOutput(dir, job), output.file);
});

test('where a job\'s output may be comes from the code, and never from the job file', (t) => {
  const dir = temp(t);
  const output = saveOutput(dir, 'assets/hero.png', Buffer.from('bytes'));
  const job = (kind, changes, request = { name: 'hero' }, attempt = 1) => ({ key: 'abcd1234', attempt, kind, status: 'done', request, output: { ...output, ...changes } });
  assert.equal(goodOutput(dir, job('image', {})), output.file);
  // Each of these would write or read somewhere else, with a hash that fits.
  for (const name of ['.git/hooks/pre-commit', '../outside.png', '/tmp/outside.png', 'assets/other.png', 'assets/sub/hero.png', 'scenes.js', 'assets/hero.sh']) {
    assert.equal(goodOutput(dir, job('image', { name })), null, name);
  }
  assert.equal(goodOutput(dir, job('image', {}, { name: '../hero' })), null);
  assert.equal(goodOutput(dir, job('image', {}, {})), null);
  assert.equal(goodOutput(dir, job('image', { sha256: `../${output.sha256}` })), null);
  assert.equal(goodOutput(dir, job('something-else', {})), null);
  assert.equal(goodOutput(dir, { ...job('speech', { file: output.file, name: undefined }) }), null);
  fs.mkdirSync(historyDir(dir, 'voice'));
  fs.writeFileSync(historyDir(dir, 'voice', 'abcd1234.2.wav'), 'bytes');
  assert.equal(goodOutput(dir, job('speech', {}, null, 2)), 'history/voice/abcd1234.2.wav');
});

test('a link under a public name is removed and never copied, so a key can\'t reach the record', (t) => {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=a-real-key\n');
  fs.symlinkSync('../.env', path.join(dir, 'assets/hero.png'));
  assert.deepEqual(moveAside(dir, 'assets/hero.png'), { from: 'assets/hero.png', to: null, known: false });
  assert.equal(fs.existsSync(path.join(dir, 'assets/hero.png')), false);
  assert.equal(fs.existsSync(historyDir(dir, 'replaced')), false);
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'OPENROUTER_API_KEY=a-real-key\n');
});

test('a damaged copy in history/replaced never costs the original', (t) => {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/hero.png'), 'the original');
  fs.mkdirSync(historyDir(dir, 'replaced'), { recursive: true });
  const saved = historyDir(dir, 'replaced', `${sha('the original')}.png`);
  fs.writeFileSync(saved, 'the orig');
  moveAside(dir, 'assets/hero.png');
  assert.equal(fs.readFileSync(saved, 'utf8'), 'the original');
  assert.deepEqual(fs.readdirSync(historyDir(dir, 'replaced')), [path.basename(saved)]);
});

// The lock as a run makes it: a folder with the file of its holder. `started` is
// what the file says about when the holder started, and without it the file has
// only the process id, like one from an older copy.
function nameLock(dir, key, pid, { time, started } = {}) {
  const lock = historyDir(dir, 'locks', sha(key).slice(0, 16));
  fs.mkdirSync(lock, { recursive: true });
  const file = path.join(lock, `held-by-${pid}-0123456789abcdef`);
  fs.writeFileSync(file, started === undefined ? `${pid}\n` : JSON.stringify({ pid, started }) + '\n');
  if (time) fs.utimesSync(file, time, time);
  return file;
}

function shortLockWait(t, ms) {
  const before = process.env.EXPLAINROO_NAME_LOCK_MS;
  process.env.EXPLAINROO_NAME_LOCK_MS = String(ms);
  t.after(() => {
    if (before === undefined) delete process.env.EXPLAINROO_NAME_LOCK_MS;
    else process.env.EXPLAINROO_NAME_LOCK_MS = before;
  });
}

const BUSY = /^another run is moving files in this project right now, and this one waited 0\.3 seconds for it\. The file this run has is kept in the record\. Run the same command again in a minute, and it puts the file in place without buying it again\.$/;

test('a lock never runs out with time: a holder that still runs is waited for, however old or new its file is, and then the move stops with a message', async (t) => {
  const { startOf } = await import('../src/lock.js');
  const dir = temp(t);
  shortLockWait(t, 300);
  const job = updateJob(dir, createJob(dir, 'abcd1234', { kind: 'image', request: { name: 'hero' } }), { status: 'done', output: saveOutput(dir, 'assets/hero.png', Buffer.from('bytes')) });
  const holders = [
    { time: new Date(Date.now() - 3600000) },
    { time: new Date(Date.now() + 3600000) },
    { time: new Date(Date.now() - 3600000), started: startOf(process.pid) },
    // Where the system gives no start time, the process id alone counts.
    { time: new Date(Date.now() - 3600000), started: null },
  ];
  for (const holder of holders) {
    const file = nameLock(dir, 'abcd1234', process.pid, holder);
    const started = Date.now();
    assert.throws(() => placeOutput(dir, job), (e) => e instanceof ProjectError && BUSY.test(e.message), JSON.stringify(holder));
    assert.ok(Date.now() - started >= 250, 'it waited for the holder');
    assert.equal(fs.existsSync(file), true, 'the holder keeps its lock');
    assert.equal(fs.existsSync(path.join(dir, 'assets/hero.png')), false);
    assert.deepEqual(fs.readdirSync(historyDir(dir, 'locks')), [sha('abcd1234').slice(0, 16)], 'the run that gave up left nothing of its own');
    fs.rmSync(path.dirname(file), { recursive: true });
  }
  // The same command once the lock is free puts the file in place, and buys nothing.
  assert.equal(placeOutput(dir, job).job.output.file, 'assets/hero.png');
});

test('a lock whose holder is gone is taken over at once, also when a new process got its id', (t) => {
  const dir = temp(t);
  const job = updateJob(dir, createJob(dir, 'abcd1234', { kind: 'image', request: { name: 'hero' } }), { status: 'done', output: saveOutput(dir, 'assets/hero.png', Buffer.from('bytes')) });
  const gone = Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim());
  // No process has the id any more, with a start time in the file and without.
  // Or a process runs under that id, and it started at another time than the holder.
  for (const [pid, started] of [[gone, undefined], [gone, 'a start time'], [process.pid, 'another start time']]) {
    nameLock(dir, 'abcd1234', pid, { started });
    const begun = Date.now();
    assert.equal(placeOutput(dir, job).job.output.file, 'assets/hero.png');
    assert.ok(Date.now() - begun < 5000, `${pid} ${started}`);
    assert.deepEqual(fs.readdirSync(historyDir(dir, 'locks')), []);
  }
});

test('a lock held by a run that still runs waits for it', (t) => {
  const dir = temp(t);
  const job = updateJob(dir, createJob(dir, 'abcd1234', { kind: 'image', request: { name: 'hero' } }), { status: 'done', output: saveOutput(dir, 'assets/hero.png', Buffer.from('bytes')) });
  const held = nameLock(dir, 'abcd1234', process.pid);
  // The holder lets go in a moment, from another process, while this one waits.
  const child = spawn(process.execPath, ['-e', `setTimeout(() => require('fs').unlinkSync(${JSON.stringify(held)}), 400)`]);
  const started = Date.now();
  assert.equal(placeOutput(dir, job).job.output.file, 'assets/hero.png');
  assert.ok(Date.now() - started >= 300, 'it waited for the holder');
  child.kill();
});

test('versions keep every render, and a verify result joins the render with its hash', (t) => {
  const dir = temp(t);
  assert.deepEqual(readVersions(dir), []);
  recordVersion(dir, { file: 'out/video.mp4', sha256: 'aa', draft: false });
  recordVersion(dir, { file: 'out/draft.mp4', sha256: 'bb', draft: true });
  recordVersion(dir, { event: 'verify', sha256: 'aa', ok: true });
  fs.appendFileSync(historyDir(dir, 'versions.jsonl'), '{"cut off');
  const versions = readVersions(dir);
  assert.deepEqual(versions.map((v) => v.file), ['out/video.mp4', 'out/draft.mp4']);
  assert.equal(versions[0].verify.ok, true);
  assert.equal(versions[1].verify, undefined);
});

test('the .gitignore helper adds a missing line once and keeps the file as it was', (t) => {
  const dir = temp(t);
  assert.equal(ensureIgnored(dir, '.env'), true);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.env\n');
  assert.equal(ensureIgnored(dir, '.env'), false);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'build/\n/history/private');
  assert.equal(ensureIgnored(dir, 'history/private/'), false);
  assert.equal(ensureIgnored(dir, '.env'), true);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'build/\n/history/private\n.env\n');
});

test('the first private file adds the folder to .gitignore, and git-ignored data is readable only by the owner', (t) => {
  const dir = temp(t);
  const file = writePrivate(dir, 'share.json', { claim_url: 'https://example.test/claim' });
  assert.equal(path.dirname(file), historyDir(dir, 'private'));
  assert.deepEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').trim().split('\n'), ['history/private/']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).claim_url, 'https://example.test/claim');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  writePrivate(dir, 'share.json', {});
  assert.deepEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').trim().split('\n'), ['history/private/']);
});

test('no error text in the record can hold a key', (t) => {
  const dir = temp(t);
  rememberSecret('a-secret-for-this-test');
  assert.equal(hideSecrets('the a-secret-for-this-test failed'), 'the [key hidden] failed');
  const job = updateJob(dir, createJob(dir, 'abcd1234', { kind: 'image' }), { status: 'failed', error: 'bad a-secret-for-this-test' });
  assert.equal(job.error, 'bad [key hidden]');
  assert.doesNotMatch(fs.readFileSync(historyDir(dir, 'jobs', 'abcd1234.json'), 'utf8'), /a-secret-for-this-test/);
});

test('printed commands name how this copy runs, and paths are safe to paste', () => {
  assert.equal(selfCommand({ npm_command: 'exec', PATH: '' }), 'npx --yes explainroo');
  assert.match(selfCommand({ PATH: '' }), /^node .*explainroo\.js"?$/);
  assert.equal(shellWord('videos/my-video_1.2'), 'videos/my-video_1.2');
  if (process.platform !== 'win32') assert.equal(shellWord("it's a test"), "'it'\\''s a test'");
});

test('the report lists open jobs first with a working command, adds up spend and leaves out what is settled', (t) => {
  const dir = temp(t);
  buy(dir, 'aaaa1111', 'good');
  createJob(dir, 'bbbb2222', { kind: 'image', request: { name: 'late', prompt: 'a late one' }, estimated_usd: 0.13 });
  updateJob(dir, createJob(dir, 'cccc3333', { kind: 'speech', provider: 'made-up', scene: 'intro', characters: 12, request: { text: 'Hello there.' } }), { status: 'lost', error: 'no answer' });
  updateJob(dir, createJob(dir, 'dddd4444', { kind: 'speech', provider: 'made-up', characters: 7, request: { text: 'Refused.' } }), { status: 'refused' });
  createJob(dir, 'eeee5555', { kind: 'speech', provider: 'made-up', characters: 5, request: { text: 'Left the script.' } });
  const speech = createJob(dir, 'ffff6666', { kind: 'speech', provider: 'made-up', characters: 30, request: { text: 'Bought.' } });
  fs.mkdirSync(historyDir(dir, 'voice'), { recursive: true });
  fs.writeFileSync(historyDir(dir, 'voice', 'ffff6666.wav'), 'wav');
  updateJob(dir, speech, { status: 'done', output: { file: 'history/voice/ffff6666.wav', sha256: sha('wav'), bytes: 3 } });

  // A deleted image is no reason to buy, also when something else needs a sentence.
  const gone = createJob(dir, 'abab1111', { kind: 'speech', provider: 'made-up', characters: 3, request: { text: 'Gone.' } });
  updateJob(dir, gone, { status: 'refused' });

  const report = historyReport(dir, { current: (job) => job.key !== 'eeee5555', needed: () => true, otherSpend: [{ cost_usd: 0.5 }] });
  const open = Object.fromEntries(report.open.map((o) => [o.id, o]));
  assert.deepEqual(Object.keys(open).toSorted(), ['abab1111', 'bbbb2222', 'cccc3333', 'dddd4444']);
  assert.match(open.bbbb2222.what, /late: "a late one" with \?/);
  assert.match(open.bbbb2222.command, /image \. --resume bbbb2222 --new$|image .* --resume bbbb2222 --new$/);
  assert.match(open.bbbb2222.message, /Another run may still be working on it, or an earlier run stopped/);
  assert.match(open.cccc3333.command, / voice .* --new$/);
  assert.match(open.cccc3333.message, /no answer/);
  assert.doesNotMatch(open.dddd4444.command, /--new/);
  assert.match(open.dddd4444.message, /cost nothing/);
  assert.equal(report.spend.usd, 0.6);
  assert.equal(report.spend.attempts, 8);
  assert.deepEqual(report.spend.characters, { 'made-up': 30 });
  assert.equal(report.spend.may_have_cost_usd, 0.13);
  assert.equal(report.spend.unknown_price, 3);
  assert.equal(listJobs(dir).length, 7);
});

test('a job is open only when someone would want to continue it', (t) => {
  const dir = temp(t);
  const image = (key, name, status, created) => {
    const job = updateJob(dir, createJob(dir, key, { kind: 'image', request: { name, prompt: 'a prompt for it' } }), { status });
    fs.writeFileSync(historyDir(dir, 'jobs', `${key}.json`), JSON.stringify({ ...job, created }));
  };
  const ids = (...options) => historyReport(dir, ...options).open.map((o) => o.id).toSorted();
  image('aaaa1111', 'hero', 'failed', '2026-01-01T10:00:00.000Z');
  assert.deepEqual(ids(), ['aaaa1111']);
  // Someone reworded the prompt, and the new image came out.
  const newer = createJob(dir, 'bbbb2222', { kind: 'image', request: { name: 'hero', prompt: 'a better prompt' } });
  const bytes = saveOutput(dir, 'assets/hero.png', Buffer.from('bytes'));
  updateJob(dir, newer, { status: 'done', output: bytes });
  assert.deepEqual(ids(), []);
  // The same failure under another name still is open.
  image('cccc3333', 'other', 'lost', '2026-01-01T10:00:00.000Z');
  assert.deepEqual(ids(), ['cccc3333']);
  // A refused sentence is only worth continuing if a scene has to be built from it.
  const refused = createJob(dir, 'dddd4444', { kind: 'speech', status: 'refused', request: { text: 'Hello.' } });
  assert.deepEqual(ids(), ['cccc3333']);
  assert.deepEqual(ids({ needed: (job) => job.key === refused.key }), ['cccc3333', 'dddd4444']);
  fs.rmSync(historyDir(dir, 'jobs', 'dddd4444.json'));
  // A refusal after a good attempt cost nothing and leaves nothing to do.
  updateJob(dir, createJob(dir, 'bbbb2222', { kind: 'image', attempt: 2, request: { name: 'hero' } }), { status: 'refused' });
  assert.deepEqual(ids(), ['cccc3333']);
  // Deleted on purpose: no reason to buy, unless a scene still has to be built from it.
  fs.rmSync(path.join(dir, bytes.file));
  assert.deepEqual(ids(), ['bbbb2222.2', 'cccc3333']);
  fs.rmSync(historyDir(dir, 'jobs', 'bbbb2222.2.json'));
  assert.deepEqual(ids(), ['cccc3333']);
  assert.deepEqual(ids({ needed: (job) => job.key === 'bbbb2222' }), ['bbbb2222', 'cccc3333']);
});

// The text gives each time in the computer's own zone, with the zone, so a render
// made late in the evening shows that evening. The record and the JSON keep UTC.
test('history prints local times with their zone, and its JSON keeps UTC', (t) => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Times\n\n## intro {min=1}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };\n');
  const time = '2026-11-07T23:30:00.000Z';
  recordVersion(dir, { time, file: 'out/video.mp4', format: 'mp4', draft: false, full: true, scale: 1, watermark: true, width: 320, height: 180, duration: 1, sha256: 'a'.repeat(64) });
  const job = createJob(dir, 'abcd1234', { kind: 'clip', provider: 'openrouter', request: { name: 'waves', prompt: 'waves on rocks', model: 'm', seconds: 4 } });
  fs.writeFileSync(historyDir(dir, 'jobs', 'abcd1234.json'), JSON.stringify({ ...updateJob(dir, job, { status: 'failed' }), created: time, updated: time }));
  const bin = new URL('../bin/explainroo.js', import.meta.url).pathname;
  const run = (zone, ...args) => spawnSync(process.execPath, [bin, 'history', dir, ...args], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
  const berlin = run('Europe/Berlin');
  assert.equal(berlin.status, 0, berlin.stderr);
  assert.match(berlin.stdout, /^ {2}2026-11-08 00:30 GMT\+1 out\/video\.mp4 /m);
  assert.match(berlin.stdout, /It failed on 2026-11-08 00:30 GMT\+1, and that try may have cost money\./);
  assert.doesNotMatch(berlin.stdout, /UTC/);
  const utc = run('UTC');
  assert.match(utc.stdout, /^ {2}2026-11-07 23:30 UTC out\/video\.mp4 /m);
  const json = JSON.parse(run('Europe/Berlin', '--json').stdout);
  assert.equal(json.versions[0].time, time);
  assert.equal(json.open[0].created, time);
});
