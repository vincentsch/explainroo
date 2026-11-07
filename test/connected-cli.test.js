// Runs the real command line against the fake services, with a counter on every
// paid request. Later commands that buy or send something add their cases here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const PAID = 'POST /api/v1/chat/completions';
const PROMPT_A = 'A red bicycle leaning on a wall';
const PROMPT_B = 'A blue boat on a calm lake';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-connected-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeProject(t) {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), '{}');
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first\nHello.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { first() {} };');
  return dir;
}

async function setup(t) {
  const fake = await startFakeServices();
  t.after(fake.close);
  const dir = makeProject(t);
  const env = { ...process.env, ...fake.env, OPENROUTER_API_KEY: GOOD_KEY };
  const start = (args, extra = {}) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, text: stderr + stdout }));
    });
    return { child, result };
  };
  const cli = (args, extra) => start(args, extra).result;
  const image = (name, prompt, ...flags) => ['image', dir, name, prompt, ...flags];
  return { fake, dir, env, start, cli, image, purchases: () => fake.count('openrouter', PAID) };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const jobs = (dir) => (fs.existsSync(path.join(dir, 'history/jobs')) ? fs.readdirSync(path.join(dir, 'history/jobs')).map((f) => JSON.parse(read(dir, `history/jobs/${f}`))) : []);

test('an image goes through the record: one purchase, a job with its price, and the old log stays unwritten', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  const r = await cli([...image('hero', PROMPT_A), '--json']);
  assert.equal(r.code, 0, r.text);
  const out = JSON.parse(r.stdout);
  assert.equal(out.file, path.join(dir, 'assets/hero.png'));
  assert.equal(out.cost_usd, 0.1);
  assert.equal(out.reused, false);
  assert.equal(out.total_usd, 0.1);
  assert.equal(purchases(), 1);
  const [body] = fake.requests('openrouter', PAID).map((q) => q.body);
  assert.match(body.messages[0].content[0].text, /red bicycle/);
  assert.deepEqual(body.modalities, ['image', 'text']);
  assert.ok(fs.readFileSync(out.file).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));

  const [job] = jobs(dir);
  assert.equal(job.kind, 'image');
  assert.equal(job.provider, 'openrouter');
  assert.equal(job.status, 'done');
  assert.equal(job.attempt, 1);
  assert.equal(job.cost_usd, 0.1);
  assert.equal(job.estimated_usd, 0.13);
  assert.equal(job.output.name, 'assets/hero.png');
  assert.equal(job.output.file, 'assets/hero.png');
  assert.equal(job.request.prompt, PROMPT_A);
  assert.equal(job.request.aspect, '16:9');
  assert.ok(job.created && job.updated);
  assert.doesNotMatch(read(dir, `history/jobs/${fs.readdirSync(path.join(dir, 'history/jobs'))[0]}`), new RegExp(GOOD_KEY));
  assert.equal(fs.existsSync(path.join(dir, 'build/images/usage.jsonl')), false);

  const listed = JSON.parse((await cli(['images', dir, '--json'])).stdout);
  assert.equal(listed.total_usd, 0.1);
  assert.equal(listed.images[0].file, 'assets/hero.png');
  const human = await cli(['images', dir]);
  assert.match(human.stdout, /assets\/hero\.png.*\$0\.1000/);
  assert.match(human.stdout, /1 image request\(s\), \$0\.1000/);
});

test('the same request again returns the file at no cost and says so, also with no key', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const before = read(dir, 'assets/hero.png');
  const again = await cli(image('hero', PROMPT_A), { OPENROUTER_API_KEY: '' });
  assert.equal(again.code, 0, again.text);
  assert.match(again.stdout, /already bought on .*nothing was spent/);
  assert.match(again.stdout, /--new/);
  assert.equal(JSON.parse((await cli([...image('hero', PROMPT_A), '--json'])).stdout).reused, true);
  assert.equal(purchases(), 1);
  assert.equal(read(dir, 'assets/hero.png'), before);
});

test('a killed request is not sent again, the message says both things it can mean, and history continues it', async (t) => {
  const { dir, start, cli, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { hang: true });
  const killed = start(image('hero', PROMPT_A));
  await fake.until('openrouter', PAID);
  killed.child.kill('SIGKILL');
  assert.equal((await killed.result).signal, 'SIGKILL');

  const again = await cli(image('hero', PROMPT_A));
  assert.equal(again.code, 1);
  assert.equal(purchases(), 1);
  assert.match(again.stderr, /no answer was saved/);
  assert.match(again.stderr, /Another run may still be working on it/);
  assert.match(again.stderr, /an earlier run stopped before it got an answer/);
  assert.match(again.stderr, /may have cost money/);
  assert.match(again.stderr, /To check, run .* history /);
  assert.match(again.stderr, /--new/);
  assert.equal(fs.existsSync(path.join(dir, 'assets/hero.png')), false);

  // A new session has only the record. The command it finds has to work as printed.
  const history = await cli(['history', dir, '--json']);
  const [open] = JSON.parse(history.stdout).open;
  assert.equal(open.kind, 'image');
  assert.equal(open.status, 'requesting');
  assert.match(open.command, /--resume \w+ --new$/);
  assert.match((await cli(['history', dir])).stdout, new RegExp(`Open jobs[\\s\\S]*${open.id}[\\s\\S]*To continue: `));
  const printed = await new Promise((resolve) => {
    const child = spawn(open.command, { shell: true, env: { ...process.env, ...fake.env, OPENROUTER_API_KEY: GOOD_KEY }, stdio: 'pipe' });
    child.on('close', resolve);
  });
  assert.equal(printed, 0);
  assert.equal(purchases(), 2);
  assert.ok(fs.existsSync(path.join(dir, 'assets/hero.png')));
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
  assert.deepEqual(jobs(dir).map((j) => j.attempt).toSorted(), [1, 2]);
});

test('two identical commands at once buy once', async (t) => {
  const { dir, start, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { hold: true });
  const runs = [start(image('hero', PROMPT_A)).result, start(image('hero', PROMPT_A)).result];
  // The request stays open until the other command has answered, however slow this computer is.
  const loser = await Promise.race(runs);
  assert.equal(loser.code, 1, loser.text);
  assert.match(loser.stderr, /Another run may still be working on it/);
  await fake.until('openrouter', PAID);
  fake.release();
  const results = await Promise.all(runs);
  assert.equal(purchases(), 1);
  assert.deepEqual(results.map((r) => r.code).toSorted(), [0, 1]);
  assert.equal(jobs(dir).length, 1);
  assert.equal(jobs(dir)[0].status, 'done');
});

test('reusing a name loses nothing: A, then B, then A again buys twice and brings A back', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const a = read(dir, 'assets/hero.png');
  const b = await cli(image('hero', PROMPT_B));
  assert.equal(b.code, 0, b.text);
  assert.match(b.stdout, /moved to history\/replaced\/.*brings it back/);
  const bFile = read(dir, 'assets/hero.png');
  assert.notEqual(a, bFile);
  assert.equal(purchases(), 2);

  const back = await cli(image('hero', PROMPT_A));
  assert.equal(back.code, 0, back.text);
  assert.match(back.stdout, /already bought/);
  assert.equal(read(dir, 'assets/hero.png'), a);
  assert.equal(purchases(), 2);
  const moved = JSON.parse((await cli(['history', dir, '--json'])).stdout).jobs.find((j) => j.request.prompt === PROMPT_B);
  assert.match(moved.output.file, /^history\/replaced\//);
  assert.equal(read(dir, moved.output.file), bFile);

  await cli(image('hero', PROMPT_B));
  assert.equal(read(dir, 'assets/hero.png'), bFile);
  assert.equal(purchases(), 2);
});

test('two different requests for one name at once buy twice and lose neither file', async (t) => {
  const { dir, start, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { delay: 400 }, { delay: 400 });
  const results = await Promise.all([start(image('hero', PROMPT_A)).result, start(image('hero', PROMPT_B)).result]);
  assert.deepEqual(results.map((r) => r.code), [0, 0], results.map((r) => r.text).join('\n'));
  assert.equal(purchases(), 2);
  const bought = jobs(dir);
  assert.equal(bought.length, 2);
  for (const job of bought) assert.ok(fs.existsSync(path.join(dir, job.output.file)), job.output.file);
  assert.equal(bought.filter((job) => job.output.file === 'assets/hero.png').length, 1);
  assert.equal(bought.filter((job) => job.output.file.startsWith('history/replaced/')).length, 1);
});

test('--new makes a new attempt, the earlier one keeps its cost, and a repeat returns the newest', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const first = read(dir, 'assets/hero.png');
  const newer = await cli([...image('hero', PROMPT_A), '--new']);
  assert.equal(newer.code, 0, newer.text);
  const second = read(dir, 'assets/hero.png');
  assert.notEqual(first, second);
  assert.equal(purchases(), 2);
  const repeat = await cli([...image('hero', PROMPT_A), '--json']);
  assert.equal(JSON.parse(repeat.stdout).reused, true);
  assert.equal(JSON.parse(repeat.stdout).attempt, 2);
  assert.equal(read(dir, 'assets/hero.png'), second);
  assert.equal(purchases(), 2);
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  assert.equal(report.spend.usd, 0.2);
  assert.equal(report.spend.attempts, 2);
  assert.deepEqual(report.jobs.map((j) => j.cost_usd), [0.1, 0.1]);
  assert.ok(fs.existsSync(path.join(dir, 'history/jobs', `${report.jobs[0].key}.2.json`)));
  assert.equal(read(dir, report.jobs.find((j) => j.attempt === 1).output.file), first);
  assert.match((await cli(['history', dir])).stdout, /\$0\.2000 in known prices/);
});

test('a job never returns a file with another hash: a deleted or changed file asks for --new', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const file = path.join(dir, 'assets/hero.png');
  fs.writeFileSync(file, 'changed by hand');
  const changed = await cli(image('hero', PROMPT_A));
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /It was bought on .*but assets\/hero\.png has changed/);
  assert.match(changed.stderr, /--new/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed by hand');
  fs.rmSync(file);
  const deleted = await cli(image('hero', PROMPT_A));
  assert.equal(deleted.code, 1);
  assert.match(deleted.stderr, /It was bought on .*but assets\/hero\.png is gone/);
  assert.equal(purchases(), 1);
  const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
  assert.equal(open.reason, 'deleted');

  fs.writeFileSync(file, 'changed again');
  const bought = await cli([...image('hero', PROMPT_A), '--new']);
  assert.equal(bought.code, 0, bought.text);
  assert.equal(purchases(), 2);
  // The file that no job knows about moved aside, and it was not deleted.
  assert.match(bought.stdout, /moved to history\/replaced\//);
  const replaced = fs.readdirSync(path.join(dir, 'history/replaced')).map((f) => read(dir, `history/replaced/${f}`));
  assert.ok(replaced.includes('changed again'));
});

test('an image from before the record moves aside instead of being deleted, and images still counts the old log', async (t) => {
  const { dir, cli, image } = await setup(t);
  fs.writeFileSync(path.join(dir, 'assets/hero.jpg'), 'bought before the record');
  fs.mkdirSync(path.join(dir, 'build/images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build/images/usage.jsonl'), `${JSON.stringify({ time: '2026-10-01T10:00:00.000Z', name: 'hero', file: 'assets/hero.jpg', provider: 'openrouter', model: 'old/model', cost_usd: 0.25 })}\n`);
  const r = await cli(image('hero', PROMPT_A));
  assert.equal(r.code, 0, r.text);
  assert.equal(fs.existsSync(path.join(dir, 'assets/hero.jpg')), false);
  assert.match(r.stdout, /assets\/hero\.jpg moved to history\/replaced\//);
  const saved = fs.readdirSync(path.join(dir, 'history/replaced')).find((f) => f.endsWith('.jpg'));
  assert.equal(read(dir, `history/replaced/${saved}`), 'bought before the record');
  const listed = JSON.parse((await cli(['images', dir, '--json'])).stdout);
  assert.equal(listed.images.length, 2);
  assert.equal(listed.total_usd, 0.35);
  assert.equal(JSON.parse((await cli(['history', dir, '--json'])).stdout).spend.usd, 0.35);
});

test('a clear 5xx gets one more try, and a second one needs --new, because it may have cost money', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { status: 503 });
  const retried = await cli(image('one', PROMPT_A));
  assert.equal(retried.code, 0, retried.text);
  assert.equal(purchases(), 2);

  fake.plan('openrouter', PAID, { status: 500 }, { status: 502 });
  const failed = await cli(image('two', PROMPT_A));
  assert.equal(failed.code, 1);
  assert.equal(purchases(), 4);
  assert.match(failed.stderr, /may have cost money/);
  const again = await cli(image('two', PROMPT_A));
  assert.equal(again.code, 1);
  assert.equal(purchases(), 4);
  assert.match(again.stderr, /It failed on .*--new/);
  assert.equal(jobs(dir).find((j) => j.request.name === 'two').status, 'failed');
  assert.equal((await cli([...image('two', PROMPT_A), '--new'])).code, 0);
  assert.equal(purchases(), 5);
});

test('a dropped connection is never sent again by itself', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  for (const [name, step] of [['one', { drop: true }], ['two', { dropBody: true }]]) {
    fake.plan('openrouter', PAID, step);
    const before = purchases();
    const lost = await cli(image(name, PROMPT_A));
    assert.equal(lost.code, 1, lost.text);
    assert.equal(purchases(), before + 1);
    assert.match(lost.stderr, /may have cost money/);
    assert.equal(jobs(dir).find((j) => j.request.name === name).status, 'lost');
    const again = await cli(image(name, PROMPT_A));
    assert.equal(again.code, 1);
    assert.match(again.stderr, /No answer came back/);
    assert.equal(purchases(), before + 1);
  }
});

test('an image that takes too long stops, and the request is not sent again', async (t) => {
  const { dir, env, fake, purchases } = await setup(t);
  const { generateImage } = await import('../src/images.js');
  const { loadProject } = await import('../src/project.js');
  const before = { url: process.env.EXPLAINROO_OPENROUTER_URL, key: process.env.OPENROUTER_API_KEY };
  process.env.EXPLAINROO_OPENROUTER_URL = env.EXPLAINROO_OPENROUTER_URL;
  process.env.OPENROUTER_API_KEY = GOOD_KEY;
  t.after(() => {
    for (const [name, value] of [['EXPLAINROO_OPENROUTER_URL', before.url], ['OPENROUTER_API_KEY', before.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(process.stderr, 'write', () => true);
  fake.plan('openrouter', PAID, { hang: true });
  await assert.rejects(generateImage(loadProject(dir), { name: 'hero', prompt: PROMPT_A, timeout: 2000 }), /did not answer.*may have cost money.*--new/);
  assert.equal(purchases(), 1);
  assert.equal(jobs(dir)[0].status, 'lost');
});

test('a refusal costs nothing, so fixing the problem needs no --new', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { status: 402, body: { error: { message: 'Insufficient credits' } } });
  const noCredit = await cli(image('hero', PROMPT_A));
  assert.equal(noCredit.code, 1);
  assert.match(noCredit.stderr, /no credit left/);
  assert.doesNotMatch(noCredit.stderr, /--new/);
  assert.equal(jobs(dir)[0].status, 'refused');
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  assert.equal(report.spend.unknown_price, 0);
  assert.doesNotMatch(report.open[0].command, /--new/);
  const fixed = await cli(image('hero', PROMPT_A));
  assert.equal(fixed.code, 0, fixed.text);
  assert.equal(purchases(), 2);
  assert.deepEqual(jobs(dir).map((j) => j.status).toSorted(), ['done', 'refused']);

  const rejected = await cli(image('other', PROMPT_A), { OPENROUTER_API_KEY: 'bad-key-value' });
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /rejected the API key/);
  assert.doesNotMatch(rejected.text, /bad-key-value/);
  assert.equal((await cli(image('other', PROMPT_A))).code, 0);
});

test('without a key nothing is sent or recorded, and the error points at connect', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  // A .env in a source checkout may hold a real key, and that one would win.
  if (fs.existsSync(path.join(path.dirname(bin), '..', '.env'))) return;
  const r = await cli(image('hero', PROMPT_A), { OPENROUTER_API_KEY: '', EXPLAINROO_CONFIG: temp(t) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /explainroo connect openrouter/);
  assert.equal(purchases(), 0);
  assert.deepEqual(jobs(dir), []);
});

test('the name, prompt, style, model, size and the contents of a reference each make a new request', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  fs.writeFileSync(path.join(dir, 'assets/ref.png'), 'one');
  const base = [...image('hero', PROMPT_A), '--ref', 'assets/ref.png'];
  assert.equal((await cli(base)).code, 0);
  assert.equal(purchases(), 1);
  await cli(base);
  assert.equal(purchases(), 1);
  let expected = 1;
  for (const args of [[...base, '--no-style'], [...base, '--model', 'cheap'], [...base, '--aspect', '1:1'], [...image('other', PROMPT_A), '--ref', 'assets/ref.png'], [...image('hero', PROMPT_B), '--ref', 'assets/ref.png']]) {
    assert.equal((await cli(args)).code, 0);
    assert.equal(purchases(), ++expected, args.join(' '));
  }
  fs.writeFileSync(path.join(dir, 'assets/ref.png'), 'two');
  await cli(base);
  assert.equal(purchases(), ++expected);
});

test('--resume continues a job by its short id, and an unknown id is an error', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const [{ id }] = JSON.parse((await cli(['history', dir, '--json'])).stdout).jobs;
  const r = await cli(['image', dir, '--resume', id, '--json']);
  assert.equal(r.code, 0, r.text);
  assert.equal(JSON.parse(r.stdout).reused, true);
  assert.equal(purchases(), 1);
  assert.equal((await cli(['image', dir, '--resume', id, '--new'])).code, 0);
  assert.equal(purchases(), 2);
  const bad = await cli(['image', dir, '--resume', 'abcdef12']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /no job "abcdef12"/);
});

test('--resume says so when a reference of the job has changed', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  fs.writeFileSync(path.join(dir, 'assets/ref.png'), 'one');
  await cli([...image('hero', PROMPT_A), '--ref', 'assets/ref.png']);
  const [{ id }] = JSON.parse((await cli(['history', dir, '--json'])).stdout).jobs;
  fs.writeFileSync(path.join(dir, 'assets/ref.png'), 'two');
  const r = await cli(['image', dir, '--resume', id, '--new']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /reference image of that job has changed/);
  assert.equal(purchases(), 1);
});

test('an address override prints one line, also with --json, and a .env file can never set it', async (t) => {
  const { dir, cli, image, fake, env } = await setup(t);
  const r = await cli([...image('hero', PROMPT_A), '--json']);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.stderr.split('\n').filter((l) => l.includes('EXPLAINROO_OPENROUTER_URL')).length, 1);
  assert.ok(r.stderr.includes(fake.base));
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  const quiet = await cli(['images', dir]);
  assert.doesNotMatch(quiet.stderr, /EXPLAINROO_OPENROUTER_URL/);

  fs.writeFileSync(path.join(dir, '.env'), `EXPLAINROO_OPENROUTER_URL=${fake.base}/openrouter\nOPENROUTER_API_KEY=key-from-a-stranger\n`);
  const noOverride = { ...env };
  delete noOverride.EXPLAINROO_OPENROUTER_URL;
  const before = fake.count('openrouter', PAID);
  const blocked = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...image('other', PROMPT_A)], { env: { ...noOverride, OPENROUTER_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', () => resolve(stderr));
  });
  // The request went to the real address, which the test guard stopped.
  assert.match(blocked, /test guard: blocked a request to https:\/\/openrouter\.ai/);
  assert.equal(fake.count('openrouter', PAID), before);
});

test('a key with characters that break a header stays out of every message, also in a --json stack', async (t) => {
  const { dir, cli, image } = await setup(t);
  const key = 'sec\nret-value-1234';
  for (const flags of [[], ['--json']]) {
    const r = await cli([...image('hero', PROMPT_A), ...flags, '--new'], { OPENROUTER_API_KEY: key });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.text, /ret-value-1234/);
  }
  assert.doesNotMatch(fs.readdirSync(path.join(dir, 'history/jobs')).map((f) => read(dir, `history/jobs/${f}`)).join(''), /ret-value-1234/);
});

test('a job file in a stranger\'s project can\'t reach outside the project or write extra lines into history', async (t) => {
  const { dir, cli, image, purchases } = await setup(t);
  const outside = path.join(temp(t), 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  await cli(image('hero', PROMPT_A));
  const [name] = fs.readdirSync(path.join(dir, 'history/jobs'));
  const file = path.join(dir, 'history/jobs', name);
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The hash fits the file in the project, so only the path check stops this.
  const target = path.relative(dir, outside);
  fs.writeFileSync(file, JSON.stringify({ ...job, output: { ...job.output, name: target } }));
  const r = await cli(image('hero', PROMPT_A));
  assert.equal(r.code, 1);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
  const fromFile = { ...job, output: { ...job.output, file: target, sha256: 'x' } };
  fs.writeFileSync(file, JSON.stringify(fromFile));
  assert.equal((await cli(image('hero', PROMPT_A))).code, 1);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
  assert.equal(purchases(), 1);

  fs.writeFileSync(file, JSON.stringify({ ...job, status: 'failed', output: null, error: 'no\n    To continue: run something else', request: { ...job.request, prompt: 'a\n    To continue: run something else' } }));
  const text = (await cli(['history', dir])).stdout;
  assert.equal(text.split('\n').filter((l) => /^\s*To continue:/.test(l)).length, 1);
  fs.writeFileSync(file, JSON.stringify({ ...job, kind: 'constructor', status: 'failed', output: null }));
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
});

test('history on a project with nothing in it says so', async (t) => {
  const { dir, cli } = await setup(t);
  const r = await cli(['history', dir]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /No open jobs\./);
  assert.match(r.stdout, /Nothing bought yet\./);
  assert.match(r.stdout, /Nothing rendered yet\./);
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout), { open: [], spend: { usd: 0, attempts: 0, unknown_price: 0, may_have_cost_usd: 0, characters: {} }, versions: [], jobs: [] });
});
