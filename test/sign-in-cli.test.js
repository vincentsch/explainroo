// The logins that publish needs, through the real command line against the fakes:
// the two-step browser sign-in for YouTube and Buffer, and the Blotato key.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { BLOTATO_KEY, BUFFER_CLIENT, BUFFER_REDIRECT, GOOGLE_CLIENT, YOUTUBE_REDIRECT } from './helpers/fake-publishing.js';
import { bin, setup } from './helpers/publishing.js';
import { readEnvFile } from '../src/env.js';

const link = (text) => text.match(/^https:\/\/(?:accounts\.google\.com|auth\.buffer\.com)\S+$/m)?.[0];

test('connect youtube explains the own Google client, and with no terminal says how to finish, changing nothing', async (t) => {
  const { cli, fake, envFile, settings } = await setup(t);
  const r = await cli(['connect', 'youtube']);
  assert.equal(r.code, 0, r.text);
  for (const words of ['YouTube with your own Google client', 'Desktop app', 'YouTube Data API v3', 'test user', 'client id and client secret', 'Cost: Free.', 'The video, its title and its description go to YouTube']) assert.ok(r.stdout.includes(words), words);
  assert.match(r.stdout, /two lines, the id first: printf '%s\\n%s\\n' "\$YOUTUBE_CLIENT_ID" "\$YOUTUBE_CLIENT_SECRET" \| .* connect youtube --key-stdin/);
  assert.equal(fs.existsSync(envFile), false);
  assert.deepEqual(fs.readdirSync(settings), []);
  assert.equal(fake.total(), 0);
});

test('the YouTube sign-in: two lines on stdin, a PKCE link, the address the browser lands on, and a login that is tested and saved', async (t) => {
  const { cli, fake, envFile, settings } = await setup(t);
  const first = await cli(['connect', 'youtube', '--key-stdin', '--json'], { input: `${GOOGLE_CLIENT.id}\n${GOOGLE_CLIENT.secret}\n` });
  assert.equal(first.code, 0, first.text);
  const out = JSON.parse(first.stdout);
  const url = new URL(out.link);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = url.searchParams;
  assert.equal(p.get('client_id'), GOOGLE_CLIENT.id);
  assert.equal(p.get('redirect_uri'), YOUTUBE_REDIRECT);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('prompt'), 'consent');
  assert.deepEqual(p.get('scope').split(' '), ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']);
  assert.equal(out.redirect_uri, YOUTUBE_REDIRECT);
  // The client is saved now, the verifier waits in the settings folder, and no token exists yet.
  assert.equal(readEnvFile(envFile, 'YOUTUBE_CLIENT_ID'), GOOGLE_CLIENT.id);
  assert.equal(readEnvFile(envFile, 'YOUTUBE_CLIENT_SECRET'), GOOGLE_CLIENT.secret);
  assert.equal(readEnvFile(envFile, 'YOUTUBE_REFRESH_TOKEN'), null);
  const pending = path.join(settings, 'sign-in-youtube.json');
  assert.equal(fs.statSync(pending).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(pending, 'utf8'));
  assert.equal(crypto.createHash('sha256').update(saved.verifier).digest('base64url'), p.get('code_challenge'));
  assert.equal(saved.state, p.get('state'));
  assert.ok(!first.text.includes(GOOGLE_CLIENT.secret), 'the secret is never printed');
  assert.equal(fake.total(), 0, 'the first step sends nothing');

  // The browser lands on the redirect address with a code.
  const landed = fake.approve(out.link);
  const done = await cli(['connect', 'youtube', '--callback-url', landed]);
  assert.equal(done.code, 0, done.text);
  assert.match(done.stdout, /^Signed in to YouTube as Fake Channel \(@fakechannel\)\. The login is saved in /);
  assert.equal(fake.count('youtube-auth', 'POST /token'), 1);
  const exchange = new URLSearchParams(fake.requests('youtube-auth', 'POST /token')[0].raw.toString());
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('code_verifier'), saved.verifier);
  assert.equal(exchange.get('redirect_uri'), YOUTUBE_REDIRECT);
  assert.equal(fake.count('youtube', 'GET /youtube/v3/channels'), 1, 'the login is tested by reading the channel');
  const refresh = readEnvFile(envFile, 'YOUTUBE_REFRESH_TOKEN');
  assert.match(refresh, /^1\/\/fake-refresh-/);
  assert.ok(!done.text.includes(refresh) && !done.text.includes(new URL(landed).searchParams.get('code')));
  assert.equal(fs.existsSync(pending), false, 'the verifier is gone once the code was used');
  const listed = JSON.parse((await cli(['services', 'posting', '--json'])).stdout).services.find((s) => s.id === 'youtube');
  assert.equal(listed.connected, true);

  // The same address again finds no sign-in waiting, and changes nothing.
  const again = await cli(['connect', 'youtube', '--callback-url', landed]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /no YouTube sign-in is waiting/);
  assert.equal(readEnvFile(envFile, 'YOUTUBE_REFRESH_TOKEN'), refresh);
});

test('a sign-in refuses an address from another sign-in, a refusal in the browser, and boxes left unticked', async (t) => {
  const { cli, fake, envFile } = await setup(t);
  const start = async () => link((await cli(['connect', 'youtube', '--key-stdin'], { input: `${GOOGLE_CLIENT.id}\n${GOOGLE_CLIENT.secret}\n` })).stdout);
  const old = await start();
  const current = await start();
  // The older link's state no longer matches, and the waiting sign-in stays.
  const stale = await cli(['connect', 'youtube', '--callback-url', fake.approve(old)]);
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /belongs to another YouTube sign-in/);
  const wrong = await cli(['connect', 'youtube', '--callback-url', 'https://example.com/elsewhere?code=x']);
  assert.match(wrong.stderr, /needs the whole address from the browser's address bar/);
  assert.equal(fake.count('youtube-auth', 'POST /token'), 0);
  // The address without its scheme, as an address bar may copy it, still works.
  const without = fake.approve(current, { scope: 'https://www.googleapis.com/auth/youtube.upload' }).replace(/^http:\/\//, '');
  const narrow = await cli(['connect', 'youtube', '--callback-url', without]);
  assert.equal(narrow.code, 1);
  assert.match(narrow.stderr, /did not allow everything explainroo needs \(https:\/\/www\.googleapis\.com\/auth\/youtube\.readonly is missing\).*Nothing was saved\./);
  assert.equal(readEnvFile(envFile, 'YOUTUBE_REFRESH_TOKEN'), null);
  const denied = await cli(['connect', 'youtube', '--callback-url', fake.approve(await start(), { deny: true })]);
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /the sign-in was not approved \(access_denied\)\. Nothing was saved\./);
  assert.equal(fake.count('youtube-auth', 'POST /token'), 1);
  // A typo in the client id stops before anything is saved.
  const swapped = await cli(['connect', 'youtube', '--key-stdin'], { input: `${GOOGLE_CLIENT.secret}\n${GOOGLE_CLIENT.id}\n` });
  assert.equal(swapped.code, 1);
  assert.match(swapped.stderr, /the first line has to be the client id/);
  assert.ok(!swapped.text.includes(GOOGLE_CLIENT.secret));
});

test('connect buffer without a client explains how to make one, with the exact redirect address', async (t) => {
  const { cli, fake, envFile } = await setup(t);
  const r = await cli(['connect', 'buffer']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /explainroo has none built in yet/);
  assert.ok(r.stdout.includes(`Add the redirect address ${BUFFER_REDIRECT}, exactly as written.`));
  assert.match(r.stdout, /public client, so it has no secret/);
  assert.match(r.stdout, /BUFFER_CLIENT_ID=<the client id>/);
  const json = JSON.parse((await cli(['connect', 'buffer', '--json'])).stdout);
  assert.equal(json.needs_client, true);
  assert.equal(json.redirect_uri, BUFFER_REDIRECT);
  assert.equal(fs.existsSync(envFile), false);
  assert.equal(fake.total(), 0);
});

test('the Buffer sign-in: a public client with PKCE and no secret, and the tokens saved next to the other lines', async (t) => {
  const { cli, fake, envFile } = await setup(t);
  fs.writeFileSync(envFile, 'OTHER_LINE=keep me\n', { mode: 0o600 });
  const human = await cli(['connect', 'buffer'], { extra: { BUFFER_CLIENT_ID: BUFFER_CLIENT } });
  assert.match(human.stdout, /goes to https:\/\/localhost:8976\/callback and shows an error page, because nothing runs there\. That is expected\./);
  assert.match(human.stdout, /connect buffer --callback-url '<the address>'/);
  // A second start replaces the first, so the newest link is the one to approve.
  const first = await cli(['connect', 'buffer', '--json'], { extra: { BUFFER_CLIENT_ID: BUFFER_CLIENT } });
  assert.equal(first.code, 0, first.text);
  const out = JSON.parse(first.stdout);
  const p = new URL(out.link).searchParams;
  assert.equal(new URL(out.link).origin + new URL(out.link).pathname, 'https://auth.buffer.com/auth');
  assert.equal(p.get('client_id'), BUFFER_CLIENT);
  assert.equal(p.get('redirect_uri'), BUFFER_REDIRECT);
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.deepEqual(p.get('scope').split(' '), ['account:read', 'posts:read', 'posts:write', 'offline_access']);
  const done = await cli(['connect', 'buffer', '--callback-url', fake.approve(out.link), '--json'], { extra: { BUFFER_CLIENT_ID: BUFFER_CLIENT } });
  assert.equal(done.code, 0, done.text);
  assert.equal(JSON.parse(done.stdout).account, 'Fake Org');
  const exchange = new URLSearchParams(fake.requests('buffer-auth', 'POST /token')[0].raw.toString());
  assert.equal(exchange.has('client_secret'), false, 'a public client sends no secret');
  assert.equal(exchange.get('client_id'), BUFFER_CLIENT);
  const text = fs.readFileSync(envFile, 'utf8');
  assert.match(text, /^OTHER_LINE=keep me$/m);
  assert.match(readEnvFile(envFile, 'BUFFER_ACCESS_TOKEN'), /^buffer-access-/);
  assert.match(readEnvFile(envFile, 'BUFFER_REFRESH_TOKEN'), /^buffer-refresh-/);
  assert.ok(Date.parse(readEnvFile(envFile, 'BUFFER_TOKEN_EXPIRES')) > Date.now() + 50 * 60 * 1000);
  assert.equal(readEnvFile(envFile, 'BUFFER_CLIENT_ID'), BUFFER_CLIENT, 'only that client can renew the login');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.ok(!done.text.includes(readEnvFile(envFile, 'BUFFER_REFRESH_TOKEN')));
});

test('connect blotato says before the key is made that it ends the trial, and keeps a key that ends in "="', async (t) => {
  const { cli, fake, envFile } = await setup(t);
  const steps = await cli(['connect', 'blotato']);
  assert.equal(steps.code, 0, steps.text);
  const trial = steps.stdout.indexOf("Creating an API key ends Blotato's free trial and starts its paid Starter plan");
  assert.ok(trial !== -1 && trial < steps.stdout.indexOf('make a key'), 'the cost comes before the step that makes the key');
  assert.match(steps.stdout, /Cost: Paid\. It needs a paid Blotato plan, and the Starter plan cost \$29 a month on 2026-11-07\. Creating an API key ends Blotato's free trial and starts that plan on your account\./);
  assert.equal(fake.total(), 0);
  const r = await cli(['connect', 'blotato', '--key-stdin'], { input: `${BLOTATO_KEY}\n` });
  assert.equal(r.code, 0, r.text);
  assert.equal(fake.count('blotato', 'GET /users/me/accounts'), 1);
  assert.equal(fake.requests('blotato', 'GET /users/me/accounts')[0].headers['blotato-api-key'], BLOTATO_KEY);
  assert.equal(fs.readFileSync(envFile, 'utf8'), `BLOTATO_API_KEY=${BLOTATO_KEY}\n`);
  assert.equal(readEnvFile(envFile, 'BLOTATO_API_KEY'), BLOTATO_KEY, 'the "=" at the end stays');
  assert.ok(!r.text.includes(BLOTATO_KEY));
  const cut = await cli(['connect', 'blotato', '--key-stdin'], { input: `${BLOTATO_KEY.replace(/=+$/, '')}\n` });
  assert.equal(cut.code, 1);
  assert.match(cut.stderr, /Blotato rejected the key\. Check that you copied all of it, including any "=" at the end\./);
});


// A real terminal, through the script program, to prove the prompts hide what is pasted.
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;

test('in a terminal the Google client comes from two hidden prompts, and Enter keeps a saved one', { skip: !hasScript && 'needs the script program on Linux' }, async (t) => {
  const { env, envFile, fake } = await setup(t);
  const run = (answers) => new Promise((resolve) => {
    const child = spawn('script', ['-qec', `${process.execPath} ${bin} connect youtube`, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    let asked = 0;
    child.stdout.on('data', (d) => {
      text += d;
      const prompts = text.split('(it will not show)').length - 1;
      while (asked < prompts && asked < answers.length) child.stdin.write(answers[asked++]);
    });
    child.on('close', (code) => resolve({ code, text }));
  });
  const first = await run([`${GOOGLE_CLIENT.id}\r`, `${GOOGLE_CLIENT.secret}\r`]);
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /Desktop app/);
  assert.match(first.text, /Open this link in a browser, sign in to YouTube and approve:/);
  // The id is no secret and is part of the link. The secret never shows.
  assert.ok(!first.text.includes(GOOGLE_CLIENT.secret), 'the secret does not show on the terminal');
  assert.ok(!first.text.split('\n').some((line) => line.trim() === GOOGLE_CLIENT.id), 'what was typed is not echoed');
  assert.equal(readEnvFile(envFile, 'YOUTUBE_CLIENT_SECRET'), GOOGLE_CLIENT.secret);
  const again = await run(['\r']);
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /or press Enter to keep the saved client/);
  assert.match(again.text, /It uses the client that is already saved\./);
  assert.equal(fake.total(), 0);
});
