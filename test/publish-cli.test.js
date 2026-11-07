// publish through the real command line against the fake posting services. Every
// request that changes something at a service is counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { startFakeServices } from './helpers/fake-services.js';
import { BLOTATO_KEY, BUFFER_CLIENT, BUFFER_REDIRECT } from './helpers/fake-publishing.js';
import { DIE_BEFORE, GQL, NONE, PLACEHOLDER, SESSION, UPLOAD, bin, jobs, linkChecks, mutations, setup, writePackage } from './helpers/publishing.js';
import { readEnvFile } from '../src/env.js';

// --- The dry run shows what a real run sends ------------------------------------

test('a YouTube dry run works without a login and says what is missing, and sends nothing at all', async (t) => {
  const { json, publish, fake } = await setup(t, { platforms: ['youtube'] });
  const r = await json('--via', 'youtube', '--dry-run');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out.dry_run, true);
  assert.equal(r.out.would, 'stop');
  assert.match(r.out.missing.join(' '), /There is no YouTube login yet\. Run ".*connect youtube"/);
  assert.equal(r.out.plan.destination, null);
  assert.equal(r.out.request.start.body.status.privacyStatus, 'private');
  const human = await publish('--via', 'youtube', '--dry-run');
  assert.match(human.stdout, /^This is what a real run would post\. Nothing was posted\./);
  assert.match(human.stdout, /^Channel: {3}not known yet$/m);
  assert.match(human.stdout, /^Before it can post:\n {2}There is no YouTube login yet/m);
  assert.equal(fake.total(), 0);
});

test('a dry run on each service reads the account and changes nothing, and a real run then sends that same request', async (t) => {
  const { json, fake, changes, packages } = await setup(t, { platforms: ['youtube', 'tiktok'], login: ['youtube', 'buffer', 'blotato'] });
  const mediaUrl = 'https://media.example/dns-tiktok.mp4';

  const yt = await json('--via', 'youtube', '--dry-run');
  assert.equal(yt.code, 0, yt.text);
  assert.equal(yt.out.would, 'post');
  assert.deepEqual(yt.out.plan.destination, { id: 'UCfakechannel0000000000', name: 'Fake Channel (@fakechannel)' });
  const buffer = await json('--via', 'buffer', '--platform', 'tiktok', '--media-url', mediaUrl, '--dry-run');
  assert.equal(buffer.code, 0, buffer.text);
  assert.equal(buffer.out.plan.destination.id, 'ch-tiktok');
  const blotato = await json('--via', 'blotato', '--platform', 'tiktok', '--dry-run');
  assert.equal(blotato.code, 0, blotato.text);
  assert.equal(blotato.out.plan.destination.id, '102');
  assert.deepEqual(changes(), NONE, 'the dry runs changed nothing');
  assert.equal(fake.count('youtube', 'GET /youtube/v3/channels'), 1);
  assert.equal(fake.count('blotato', 'GET /users/me/accounts'), 1);
  for (const r of [yt, buffer, blotato]) assert.doesNotMatch(r.text, /ya29\.|buffer-access-|buffer-refresh-|1\/\/fake-refresh|fake-google-secret|fake-blotato-key/);
  assert.deepEqual(fs.readdirSync(path.dirname(packages.youtube.file)).filter((f) => f === 'history'), []);

  // The real runs send exactly what the dry runs printed.
  assert.equal((await json('--via', 'youtube', '--yes')).code, 0);
  const [session] = fake.publishing.youtube.sessions.values();
  assert.deepEqual(session.meta, yt.out.request.start.body);
  assert.deepEqual(session.headers, { length: yt.out.request.start.headers['X-Upload-Content-Length'], type: yt.out.request.start.headers['X-Upload-Content-Type'] });
  for (const [name, value] of Object.entries(yt.out.request.start.query)) assert.equal(session.query[name], value, name);
  assert.equal(session.video.sha256, yt.out.request.file.sha256, 'the bytes that arrived are the packaged file');
  assert.equal((await json('--via', 'buffer', '--platform', 'tiktok', '--media-url', mediaUrl, '--yes')).code, 0);
  assert.deepEqual(mutations(fake).map((r) => r.body), [buffer.out.request]);
  assert.equal((await json('--via', 'blotato', '--platform', 'tiktok', '--yes')).code, 0);
  const [upload] = fake.publishing.blotato.uploads.values();
  assert.equal(upload.bytes, packages.tiktok.sha256, 'Blotato got the packaged file');
  const sent = fake.requests('blotato', 'POST /posts')[0].body;
  const expected = structuredClone(blotato.out.request.post);
  assert.deepEqual(expected.post.content.mediaUrls, [PLACEHOLDER]);
  expected.post.content.mediaUrls = [upload.publicUrl];
  assert.deepEqual(sent, expected);
  assert.equal(fake.count('blotato', 'POST /media/uploads'), 1);
  assert.deepEqual(blotato.out.request.upload, { filename: 'video.mp4' });
});

test('the plan says everything a person needs before posting under their own name', async (t) => {
  const { publish } = await setup(t, { platforms: ['youtube', 'tiktok'], login: ['youtube', 'buffer'] });
  const yt = await publish('--via', 'youtube', '--dry-run');
  assert.equal(yt.code, 0, yt.text);
  for (const line of [
    /^Video: {5}out\/package\/youtube\/video\.mp4 \(YouTube package\)$/m,
    /^ {11}6 KB, 0:42 long, sha256 [0-9a-f]{64}$/m,
    /^ {11}verify passed$/m,
    /^Through: {3}YouTube$/m,
    /^Channel: {3}Fake Channel \(@fakechannel\) on YouTube \(id UCfakechannel0000000000\)$/m,
    /^Title: {5}How DNS finds a website$/m,
    /^Description:\n {11}\| Your browser asks a resolver for the address\.\n {11}\|\s*\n {11}\| #dns$/m,
    /^Hashtags: {2}#dns, in the description$/m,
    /^Privacy: {3}private\. Only you can see it until you change that in YouTube Studio\.$/m,
    /^AI label: {2}yes \(voice: Kokoro\)\. YouTube gets it as containsSyntheticMedia: true\.$/m,
    /^For kids: {2}no$/m,
    /^Category: {2}27 \(Education\)$/m,
    /^Subscribers are not notified\.$/m,
    /^The file goes up to YouTube from this computer\.$/m,
  ]) assert.match(yt.stdout, line);
  const tiktok = await publish('--via', 'buffer', '--platform', 'tiktok', '--media-url', 'https://media.example/v.mp4', '--dry-run');
  assert.match(tiktok.stdout, /^Through: {3}Buffer, account Fake Org$/m);
  assert.match(tiktok.stdout, /^Channel: {3}@fakehandle on TikTok \(id ch-tiktok\)$/m);
  assert.match(tiktok.stdout, /^Text:\n {11}\| Your browser asks a resolver for the address\.\n {11}\|\s*\n {11}\| #dns$/m);
  assert.doesNotMatch(tiktok.stdout, /^Title:/m);
  assert.match(tiktok.stdout, /^Privacy: {3}public\. TikTok through Buffer has no privacy setting, so the post goes public right away\.$/m);
  assert.match(tiktok.stdout, /^AI label: {2}yes \(voice: Kokoro\)\. Buffer marks the post as AI assisted: true\. TikTok gets isAiGenerated: true\.$/m);
  assert.match(tiktok.stdout, /^For kids: {2}no\. Only YouTube asks this, so it is not sent\.$/m);
  assert.match(tiktok.stdout, /^Video link: https:\/\/media\.example\/v\.mp4, from --media-url$/m);
  assert.match(tiktok.stdout, /^Link size: 6,012 bytes, the same as the file$/m);
  assert.doesNotMatch(tiktok.stdout, /^Draft:/m);
});

// --- Which package goes where ---------------------------------------------------

test('each pair in the table posts with the fields it needs, and the title has its own field only on YouTube', async (t) => {
  const platforms = ['youtube', 'shorts', 'tiktok', 'reels', 'linkedin', 'x'];
  const { json, fake, changes, dir } = await setup(t, { platforms, login: ['youtube', 'buffer', 'blotato'] });
  const description = 'Your browser asks a resolver for the address.\n\n#dns';
  const text = 'Your browser asks a resolver for the address.\n\n#dns';

  for (const platform of ['youtube', 'shorts']) {
    const r = await json('--via', 'youtube', '--platform', platform, '--yes');
    assert.equal(r.code, 0, r.text);
    assert.equal(r.out.stage, 'finished');
    assert.equal(r.out.post.link, `https://www.youtube.com/${platform === 'shorts' ? 'shorts/' : 'watch?v='}${r.out.post.id}`);
  }
  const metas = [...fake.publishing.youtube.sessions.values()].map((s) => s.meta);
  assert.deepEqual(metas[0], { snippet: { title: 'How DNS finds a website', description, categoryId: '27' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } });
  assert.deepEqual(metas[1], metas[0]);
  assert.equal([...fake.publishing.youtube.sessions.values()][0].query.notifySubscribers, 'false');

  const buffer = {
    youtube: ['ch-youtube', { youtube: { title: 'How DNS finds a website', categoryId: '27', privacy: 'private', madeForKids: false, notifySubscribers: false, isAiGenerated: true } }],
    shorts: ['ch-youtube', { youtube: { title: 'How DNS finds a website', categoryId: '27', privacy: 'private', madeForKids: false, notifySubscribers: false, isAiGenerated: true } }],
    tiktok: ['ch-tiktok', { tiktok: { isAiGenerated: true } }],
    reels: ['ch-instagram', { instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: true } }],
    linkedin: ['ch-linkedin', undefined],
    x: ['ch-twitter', { twitter: { isAiGenerated: true } }],
  };
  for (const [platform, [channel, metadata]] of Object.entries(buffer)) {
    const r = await json('--via', 'buffer', '--platform', platform, '--media-url', `https://media.example/${platform}.mp4`, '--yes');
    assert.equal(r.code, 0, `${platform}: ${r.text}`);
    assert.equal(r.out.stage, 'finished', platform);
    const { input } = mutations(fake).at(-1).body.variables;
    assert.deepEqual(input, {
      channelId: channel,
      text: platform === 'youtube' || platform === 'shorts' ? description : text,
      mode: 'shareNow',
      schedulingType: 'automatic',
      needsApproval: false,
      aiAssisted: true,
      assets: [{ video: { url: `https://media.example/${platform}.mp4`, metadata: { thumbnailOffset: 0 } } }],
      ...(metadata ? { metadata } : {}),
    }, platform);
  }

  const blotato = {
    youtube: ['101', { targetType: 'youtube', title: 'How DNS finds a website', privacyStatus: 'private', shouldNotifySubscribers: false, isMadeForKids: false, containsSyntheticMedia: true }],
    shorts: ['101', { targetType: 'youtube', title: 'How DNS finds a website', privacyStatus: 'private', shouldNotifySubscribers: false, isMadeForKids: false, containsSyntheticMedia: true }],
    tiktok: ['102', { targetType: 'tiktok', privacyLevel: 'SELF_ONLY', disabledComments: false, disabledDuet: false, disabledStitch: false, isBrandedContent: false, isYourBrand: false, isAiGenerated: true }],
    reels: ['103', { targetType: 'instagram', mediaType: 'reel' }],
    linkedin: ['104', { targetType: 'linkedin' }],
    x: ['105', { targetType: 'twitter' }],
  };
  for (const [platform, [account, target]] of Object.entries(blotato)) {
    const r = await json('--via', 'blotato', '--platform', platform, '--yes');
    assert.equal(r.code, 0, `${platform}: ${r.text}`);
    assert.equal(r.out.stage, 'finished', platform);
    const { post } = fake.requests('blotato', 'POST /posts').at(-1).body;
    const upload = [...fake.publishing.blotato.uploads.values()].at(-1);
    assert.deepEqual(post, { accountId: account, content: { text: platform === 'youtube' || platform === 'shorts' ? description : text, mediaUrls: [upload.publicUrl], platform: target.targetType }, target }, platform);
  }
  assert.deepEqual(changes(), { youtube: 4, buffer: 6, blotato: 18 });
  const done = jobs(dir);
  assert.equal(done.length, 14);
  assert.ok(done.every((job) => job.kind === 'publish' && job.stage === 'finished'));
});

test('a pair that is not in the table stops before any request, and lists what works', async (t) => {
  const { publish, fake } = await setup(t, { platforms: ['tiktok', 'reels', 'linkedin', 'x'], login: ['youtube', 'buffer', 'blotato'] });
  for (const platform of ['tiktok', 'reels', 'linkedin', 'x']) {
    for (const extra of [[], ['--dry-run'], ['--yes']]) {
      const r = await publish('--via', 'youtube', '--platform', platform, ...extra);
      assert.equal(r.code, 1, r.text);
      assert.match(r.stderr, new RegExp(`YouTube does not take the ${platform} package\\. It takes youtube or shorts\\. The ${platform} package can go through --via buffer or --via blotato\\. Nothing was uploaded or sent\\.`));
    }
  }
  assert.match((await publish('--via', 'vimeo')).stderr, /--via must be youtube, buffer or blotato/);
  assert.match((await publish('--platform', 'tiktok')).stderr, /publish needs --via youtube, buffer or blotato/);
  assert.match((await publish('--via', 'buffer', '--platform', 'myspace')).stderr, /there is no platform "myspace"/);
  assert.equal(fake.total(), 0, 'not even a login was read');
});

test('privacy is settled per destination, and a value a destination can\'t honour is refused before anything is sent', async (t) => {
  const { json, publish, fake, changes } = await setup(t, { platforms: ['youtube', 'tiktok', 'reels', 'linkedin', 'x'], login: ['youtube', 'buffer', 'blotato'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  for (const platform of ['tiktok', 'reels', 'linkedin', 'x']) {
    for (const privacy of ['private', 'unlisted', 'public']) {
      const r = await publish('--via', 'buffer', '--platform', platform, ...media, '--privacy', privacy, '--yes');
      assert.equal(r.code, 1, r.text);
      assert.match(r.stderr, /through Buffer has no privacy setting, so a post there goes public right away\. --privacy can't change that, so nothing was uploaded or sent\./);
    }
  }
  for (const platform of ['reels', 'linkedin', 'x']) {
    const r = await publish('--via', 'blotato', '--platform', platform, '--privacy', 'private', '--yes');
    assert.equal(r.code, 1, r.text);
    assert.match(r.stderr, /through Blotato has no privacy setting/);
  }
  const unlisted = await publish('--via', 'blotato', '--platform', 'tiktok', '--privacy', 'unlisted', '--yes');
  assert.match(unlisted.stderr, /TikTok through Blotato can be private or public, and has no unlisted\. Nothing was uploaded or sent\./);
  assert.match((await publish('--via', 'youtube', '--privacy', 'friends')).stderr, /--privacy must be private, unlisted or public/);
  assert.deepEqual(changes(), NONE);
  assert.equal(fake.count('youtube-auth', 'POST /token') + fake.count('blotato', 'GET /users/me/accounts'), 0, 'refused before any read');

  // Where there is a setting, each value goes in that API's own field.
  assert.equal((await json('--via', 'youtube', '--privacy', 'unlisted', '--dry-run')).out.request.start.body.status.privacyStatus, 'unlisted');
  assert.equal((await json('--via', 'buffer', '--platform', 'youtube', ...media, '--privacy', 'public', '--dry-run')).out.request.variables.input.metadata.youtube.privacy, 'public');
  assert.equal((await json('--via', 'blotato', '--platform', 'youtube', '--privacy', 'unlisted', '--dry-run')).out.request.post.post.target.privacyStatus, 'unlisted');
  assert.equal((await json('--via', 'blotato', '--platform', 'tiktok', '--privacy', 'public', '--dry-run')).out.request.post.post.target.privacyLevel, 'PUBLIC_TO_EVERYONE');
  assert.equal((await json('--via', 'blotato', '--platform', 'tiktok', '--dry-run')).out.request.post.post.target.privacyLevel, 'SELF_ONLY');
  const plain = await json('--via', 'buffer', '--platform', 'reels', ...media, '--dry-run');
  assert.deepEqual(plain.out.plan.privacy, { value: 'public', setting: false, words: 'public. Instagram through Buffer has no privacy setting, so the post goes public right away.' });
  assert.deepEqual(changes(), NONE);
});

// --- Nothing goes out without a yes ----------------------------------------------

test('without --yes and without a terminal, a real run prints the plan, sends nothing and fails', async (t) => {
  const { publish, json, fake, changes, dir } = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const r = await publish('--via', 'blotato');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^This is the post\. Nothing has been sent yet\.\nVideo: {5}out\/package\/tiktok\/video\.mp4/m);
  assert.match(r.stderr, /error: Nothing was sent\. There is no terminal here to type yes\. Show this plan to the user, and if they say yes, run the same command with --yes\./);
  const j = await json('--via', 'blotato');
  assert.equal(j.code, 1);
  assert.equal(j.out.confirmed, false);
  assert.match(j.out.error, /run the same command with --yes/);
  assert.equal(j.out.plan.destination.id, '102');
  assert.equal(j.out.request.post.post.accountId, '102');
  assert.deepEqual(changes(), NONE);
  assert.deepEqual(jobs(dir), [], 'nothing was approved, so nothing is in the record');
  assert.equal(fake.count('blotato', 'GET /users/me/accounts'), 2);
});

// A real terminal, through the script program, to prove that a person has to type yes.
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;

test('in a terminal the person has to type yes, and anything else stops', { skip: !hasScript && 'needs the script program on Linux' }, async (t) => {
  const { env, fake, changes, dir } = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const run = (answer) => new Promise((resolve) => {
    const child = spawn('script', ['-qec', `${process.execPath} ${bin} publish ${dir} --via blotato`, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    let asked = false;
    child.stdout.on('data', (d) => {
      text += d;
      if (!asked && text.includes('Type yes to post this under your name')) {
        asked = true;
        child.stdin.write(`${answer}\r`);
      }
    });
    child.on('close', (code) => resolve({ code, text }));
  });
  const no = await run('no');
  assert.equal(no.code, 1, no.text);
  assert.match(no.text, /This is the post\. Nothing has been sent yet\./);
  assert.deepEqual(changes(), NONE);
  assert.deepEqual(jobs(dir), []);
  const yes = await run('yes');
  assert.equal(yes.code, 0, yes.text);
  assert.match(yes.text, /Posted to @fakehandle on TikTok through Blotato\./);
  assert.equal(fake.count('blotato', 'POST /posts'), 1);
});

// --- Posting, reading back and never twice ---------------------------------------

test('a normal post on each service reads the status back, and a repeat prints it and posts nothing', async (t) => {
  const { publish, json, cli, fake, changes, dir } = await setup(t, { platforms: ['youtube', 'tiktok'], login: ['youtube', 'buffer', 'blotato'] });
  const runs = [
    ['--via', 'youtube'],
    ['--via', 'buffer', '--platform', 'tiktok', '--media-url', 'https://media.example/v.mp4'],
    ['--via', 'blotato', '--platform', 'tiktok'],
  ];
  const yt = await publish(...runs[0], '--yes');
  assert.equal(yt.code, 0, yt.text);
  assert.match(yt.stdout.trimEnd(), /^Posted to Fake Channel \(@fakechannel\) on YouTube\.\nStatus: processed \(privacy private, processing succeeded\)\nLink: https:\/\/www\.youtube\.com\/watch\?v=vid\d+\nYouTube Studio: https:\/\/studio\.youtube\.com\/video\/vid\d+\/edit\nAdd the cover \(video\.cover\.jpg\) and the captions \(video\.srt\) from the package folder there\.$/);
  assert.equal(fake.count('youtube', 'GET /youtube/v3/videos'), 1);
  const buffer = await publish(...runs[1], '--yes');
  assert.equal(buffer.code, 0, buffer.text);
  assert.match(buffer.stdout.trimEnd(), /^Posted to @fakehandle on TikTok through Buffer\.\nStatus: sent\nLink: https:\/\/social\.example\/fakehandle\/post-\d+$/);
  const blotato = await publish(...runs[2], '--yes');
  assert.equal(blotato.code, 0, blotato.text);
  assert.match(blotato.stdout, /Status: published\nLink: https:\/\/social\.example\/blotato\/submission-\d+/);
  const after = changes();
  assert.deepEqual(after, { youtube: 2, buffer: 1, blotato: 3 });

  for (const args of runs) {
    for (const extra of [['--yes'], []]) {
      const again = await publish(...args, ...extra);
      assert.equal(again.code, 0, again.text);
      assert.match(again.stdout, /^This file was already posted to .* \(job \w+\), so nothing was sent\.\nStatus: \w+/);
      assert.match(again.stdout.trimEnd(), /To post it again anyway, run the same command with --new\.$/);
    }
    assert.equal((await json(...args, '--dry-run')).out.would, 'nothing');
  }
  assert.deepEqual(changes(), after, 'repeats posted nothing');
  const report = await cli(['history', dir]);
  assert.match(report.stdout, /^Posts\n {2}\w+ youtube youtube to Fake Channel \(@fakechannel\) posted https:\/\/www\.youtube\.com\/watch\?v=vid\d+\n {2}\w+ buffer tiktok to @fakehandle posted https:\/\/social\.example/m);
  assert.match(report.stdout, /^Nothing bought yet\.$/m, 'a post costs nothing in the record');
  const record = jobs(dir);
  assert.deepEqual(record.map((job) => job.stage).toSorted(), ['finished', 'finished', 'finished']);
  for (const job of record) {
    assert.ok(job.request && job.plan && job.destination && job.job_id, job.provider);
    assert.doesNotMatch(JSON.stringify(job), /ya29\.|buffer-access|buffer-refresh|1\/\/fake|fake-google-secret|fake-blotato-key|upload_id/);
  }
  // --new is the deliberate way to post the same file there again.
  const fresh = await publish(...runs[2], '--new', '--yes');
  assert.equal(fresh.code, 0, fresh.text);
  assert.equal(fake.count('blotato', 'POST /posts'), 2);
});

// --- Buffer drafts ------------------------------------------------------------------

test('--draft saves the post as a draft in Buffer and reads it back, and a repeat with or without --draft makes nothing new until --new', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  const args = ['--via', 'buffer', ...media, '--draft'];
  const plan = await s.json(...args, '--dry-run');
  assert.equal(plan.code, 0, plan.text);
  assert.equal(plan.out.would, 'post');
  assert.equal(plan.out.draft, true);
  assert.equal(plan.out.plan.draft, true);
  const { input } = plan.out.request.variables;
  assert.equal(input.saveToDraft, true);
  assert.equal(input.mode, 'addToQueue', 'the mode of Buffer\'s example of a draft');
  assert.equal(input.needsApproval, false);
  const human = await s.publish(...args, '--dry-run');
  assert.match(human.stdout, /^This is the draft a real run would save in Buffer\. Nothing was sent\.\nVideo: /);
  assert.match(human.stdout, /^Draft: {5}yes\. Buffer keeps it as a draft, and nothing is published until you schedule it there\.$/m);
  assert.match(human.stdout, /^Privacy: {3}public once it goes out\. TikTok through Buffer has no privacy setting\.$/m);
  assert.match(human.stdout, /saves the draft only after a typed yes, or with --yes when there is no terminal\.$/m);
  assert.deepEqual(s.changes(), NONE);

  const saved = await s.publish(...args, '--yes');
  assert.equal(saved.code, 0, saved.text);
  assert.match(saved.stderr, /^This is the draft\. Nothing has been sent yet\.\nVideo: /m);
  assert.match(saved.stdout.trimEnd(), /^Saved as a draft for @fakehandle on TikTok in Buffer \(id post-\d+\)\. Nothing was published\.\nStatus: draft\nTo post it, schedule the draft in Buffer\.$/);
  assert.deepEqual(mutations(s.fake).map((r) => r.body), [plan.out.request], 'the real run sent what the dry run printed');
  const [post] = s.fake.publishing.buffer.posts.values();
  assert.equal(post.status, 'draft');
  assert.equal(post.reads, 1, 'the draft was read back');
  const [job] = s.jobs();
  assert.equal(job.stage, 'finished');
  assert.equal(job.plan.draft, true);
  assert.equal(job.result.status, 'draft');

  // The draft counts as the post of this file to this channel.
  for (const extra of [['--draft'], []]) {
    for (const yes of [['--yes'], []]) {
      const again = await s.publish('--via', 'buffer', ...media, ...extra, ...yes);
      assert.equal(again.code, 0, again.text);
      assert.match(again.stdout.trimEnd(), /^This file was already saved as a draft for @fakehandle on TikTok in Buffer \(job \w+\), so nothing was sent\.\nSchedule that draft in Buffer to post it\. To save another draft or post it anyway, run the same command with --new\.$/);
    }
    const dry = await s.json('--via', 'buffer', ...media, ...extra, '--dry-run');
    assert.equal(dry.out.would, 'nothing');
    assert.equal(dry.out.draft, true);
  }
  assert.match((await s.publish('--via', 'buffer', ...media, '--dry-run')).stdout, /^This file was already saved as a draft there \(job \w+\)\. The real run sends nothing\. To save another draft or post it anyway, add --new\.$/m);
  assert.equal(mutations(s.fake).length, 1, 'no second draft and no post');
  assert.match((await s.cli(['history', s.dir])).stdout, /^ {2}\w+ buffer tiktok to @fakehandle saved as a draft$/m);

  const another = await s.json(...args, '--new', '--yes');
  assert.equal(another.code, 0, another.text);
  assert.equal(another.out.stage, 'finished');
  assert.equal(another.out.draft, true);
  assert.equal(another.out.post.status, 'draft');
  assert.equal(another.out.attempt, 2);
  assert.equal(mutations(s.fake).length, 2);
});

test('only Buffer takes --draft, and the other routes refuse it before anything is read or sent', async (t) => {
  const s = await setup(t, { platforms: ['youtube', 'tiktok'], login: ['youtube', 'blotato'] });
  for (const args of [['--via', 'youtube'], ['--via', 'blotato', '--platform', 'tiktok'], ['--via', 'blotato', '--platform', 'youtube']]) {
    for (const extra of [['--dry-run'], ['--yes'], []]) {
      const r = await s.publish(...args, '--draft', ...extra);
      assert.equal(r.code, 1, r.text);
      assert.match(r.stderr, /--draft is for --via buffer\. explainroo can save a post as a draft only in Buffer\. Nothing was sent\./);
    }
  }
  assert.equal(s.fake.total(), 0);
  assert.deepEqual(s.jobs(), []);
});

test('two Buffer channels on one network stay two destinations: the run asks which, and each gets the file once', async (t) => {
  const { publish, json, fake, changes, dir } = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  fake.publishing.buffer.channels.push(
    { id: 'ch-tiktok-2', organizationId: 'org-1', name: 'secondhandle', displayName: '@secondhandle', service: 'tiktok', isLocked: false, isDisconnected: false },
    { id: 'ch-tiktok-locked', organizationId: 'org-1', name: 'lockedhandle', displayName: '@lockedhandle', service: 'tiktok', isLocked: true, isDisconnected: false },
  );
  const media = ['--media-url', 'https://media.example/v.mp4'];
  const plan = await json('--via', 'buffer', ...media, '--dry-run');
  assert.equal(plan.code, 0, plan.text);
  assert.deepEqual(plan.out.plan.choices, [{ id: 'ch-tiktok', name: '@fakehandle' }, { id: 'ch-tiktok-2', name: '@secondhandle' }], 'the locked channel is not offered');
  assert.match(plan.out.missing.join(' '), /Buffer has 2 TikTok channels\. Say which one with --channel <id>\./);
  const human = await publish('--via', 'buffer', ...media, '--dry-run');
  assert.match(human.stdout, /^Channel: {3}not chosen yet\. Buffer has 2 on TikTok:\n {13}ch-tiktok {2}@fakehandle\n {13}ch-tiktok-2 {2}@secondhandle$/m);
  const unchosen = await publish('--via', 'buffer', ...media, '--yes');
  assert.equal(unchosen.code, 1);
  assert.match(unchosen.stderr, /Say which one with --channel <id>\. Nothing was sent\./);
  const locked = await publish('--via', 'buffer', ...media, '--channel', 'ch-tiktok-locked', '--yes');
  assert.equal(locked.code, 1);
  assert.match(locked.stderr, /@lockedhandle on Buffer can't post right now: it is locked in Buffer\. Nothing was sent\./);
  assert.deepEqual(changes(), NONE);

  for (const channel of ['ch-tiktok', 'ch-tiktok-2']) {
    const r = await json('--via', 'buffer', ...media, '--channel', channel, '--yes');
    assert.equal(r.code, 0, r.text);
    assert.equal(r.out.destination.id, channel);
  }
  for (const channel of ['ch-tiktok', 'ch-tiktok-2']) {
    const again = await json('--via', 'buffer', ...media, '--channel', channel, '--yes');
    assert.equal(again.out.already, true, channel);
  }
  assert.deepEqual(mutations(fake).map((r) => r.body.variables.input.channelId), ['ch-tiktok', 'ch-tiktok-2']);
  assert.equal(new Set(jobs(dir).map((job) => job.key)).size, 2, 'one job key per channel');
});

// A run killed while the write that makes the post waits for its answer. `reads`
// is how many requests to the same route come before that write.
async function killWhileSending(s, args, service, route, reads = 0) {
  s.fake.plan(service, route, ...Array.from({ length: reads }, () => ({})), { hang: true });
  const run = s.start(['publish', s.dir, ...args, '--yes']);
  await s.fake.until(service, route, reads + 1);
  run.child.kill('SIGKILL');
  assert.equal((await run.result).signal, 'SIGKILL');
}

test('a Buffer post whose answer never came blocks a second post until --new', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const args = ['--via', 'buffer', '--media-url', 'https://media.example/v.mp4'];
  // The organizations and the channels are read first, on the same address.
  await killWhileSending(s, args, 'buffer', GQL, 2);
  assert.equal(jobs(s.dir)[0].stage, 'sending');
  for (const extra of [['--yes'], []]) {
    const r = await s.publish(...args, ...extra);
    assert.equal(r.code, 1, r.text);
    assert.match(r.stderr, /went out to Buffer on .*, and no answer was saved\. Another run may still be sending it, or a run stopped before the answer came\. So the post may or may not exist\. Look at the channel in Buffer for the post\. Explainroo will not post it again by itself\. To post it again anyway, run the same command with --new\./);
  }
  assert.equal((await s.json(...args, '--dry-run')).out.would, 'stop');
  assert.equal(s.changes().buffer, 1);
  const again = await s.publish(...args, '--new', '--yes');
  assert.equal(again.code, 0, again.text);
  assert.equal(s.changes().buffer, 2);
});

test('a Blotato post whose answer never came blocks a second post until --new', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  await killWhileSending(s, ['--via', 'blotato'], 'blotato', 'POST /posts');
  const [job] = jobs(s.dir);
  assert.equal(job.stage, 'sending');
  assert.match(job.media.public_url, /^https:\/\/database\.blotato\.example\//);
  const r = await s.publish('--via', 'blotato', '--yes');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /went out to Blotato on .*, and no answer was saved\..*Look at your posts in Blotato for it\..*--new/);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 1);
  assert.equal((await s.publish('--via', 'blotato', '--new', '--yes')).code, 0);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 2);
  assert.equal(s.fake.count('blotato', 'POST /media/uploads'), 2, 'a new try uploads its own copy');
});

// --- YouTube: a resumable upload --------------------------------------------------

test('a dropped YouTube upload asks how much arrived and goes on from that byte, in the same run', async (t) => {
  const { json, fake, packages, dir } = await setup(t, { platforms: ['youtube'], login: ['youtube'] });
  fake.plan('youtube', SESSION, { keep: 2500 });
  const r = await json('--via', 'youtube', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out.stage, 'finished');
  const puts = fake.requests('youtube', SESSION);
  assert.deepEqual(puts.map((q) => q.headers['content-range'] ?? null), [null, `bytes */${packages.youtube.bytes.length}`, `bytes 2500-${packages.youtube.bytes.length - 1}/${packages.youtube.bytes.length}`]);
  assert.deepEqual(puts[2].raw, packages.youtube.bytes.subarray(2500), 'the rest of the file, from the byte YouTube reported');
  assert.equal(fake.count('youtube', UPLOAD), 1, 'one upload session');
  const [video] = fake.publishing.youtube.videos.values();
  assert.equal(video.sha256, packages.youtube.sha256);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'history/private')).filter((f) => f.startsWith('publish-')), [], 'the session address goes once the video is there');
});

test('a run killed during the YouTube upload is picked up by the next run, which asks first and makes no second video', async (t) => {
  const s = await setup(t, { platforms: ['youtube'], login: ['youtube'] });
  const { fake, dir, packages } = s;
  const size = packages.youtube.bytes.length;
  fake.plan('youtube', SESSION, { keep: 4000, then: 'hang' });
  const run = s.start(['publish', dir, '--via', 'youtube', '--yes']);
  await fake.until('youtube', SESSION);
  run.child.kill('SIGKILL');
  await run.result;
  const [job] = jobs(dir);
  assert.equal(job.stage, 'sending');
  // The session address acts like a password, so it is only in history/private/.
  const [saved] = fs.readdirSync(path.join(dir, 'history/private')).filter((f) => f.startsWith('publish-'));
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'history/private', saved), 'utf8')).session, /upload_id=/);
  assert.equal(fs.statSync(path.join(dir, 'history/private', saved)).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^history\/private\/$/m);
  assert.doesNotMatch(JSON.stringify(jobs(dir)), /upload_id/);
  assert.equal((await s.json('--via', 'youtube', '--dry-run')).out.would, 'resume');

  // It goes on with what was approved, so it asks again first.
  const asked = await s.publish('--via', 'youtube');
  assert.equal(asked.code, 1);
  assert.match(asked.stderr, /This goes on with the post approved on .*, from where it stopped\./);
  const r = await s.json('--via', 'youtube', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out.stage, 'finished');
  assert.equal(r.out.continued, true);
  assert.equal(fake.count('youtube', UPLOAD), 1, 'no second upload session');
  const puts = fake.requests('youtube', SESSION).map((q) => q.headers['content-range'] ?? null);
  assert.deepEqual(puts, [null, `bytes */${size}`, `bytes 4000-${size - 1}/${size}`]);
  assert.equal([...fake.publishing.youtube.videos.values()].length, 1);
});

test('an upload that finished while its answer was lost is found by asking, and is not sent again', async (t) => {
  const s = await setup(t, { platforms: ['youtube'], login: ['youtube'] });
  s.fake.plan('youtube', SESSION, { hold: true });
  const run = s.start(['publish', s.dir, '--via', 'youtube', '--yes']);
  await s.fake.until('youtube', SESSION);
  run.child.kill('SIGKILL');
  await run.result;
  s.fake.release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const r = await s.json('--via', 'youtube', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out.stage, 'finished');
  assert.equal(s.fake.requests('youtube', SESSION).filter((q) => q.raw.length).length, 1, 'the file went up once');
  assert.equal(s.fake.publishing.youtube.videos.size, 1);
});

test('a YouTube upload with no saved session, or one YouTube no longer knows, blocks a second video until --new', async (t) => {
  const s = await setup(t, { platforms: ['youtube'], login: ['youtube'] });
  const { fake, dir } = s;
  fake.plan('youtube', SESSION, { keep: 1000, then: 'hang' });
  const run = s.start(['publish', dir, '--via', 'youtube', '--yes']);
  await fake.until('youtube', SESSION);
  run.child.kill('SIGKILL');
  await run.result;
  const privateDir = path.join(dir, 'history/private');
  const [saved] = fs.readdirSync(privateDir).filter((f) => f.startsWith('publish-'));
  const session = fs.readFileSync(path.join(privateDir, saved));
  fs.rmSync(path.join(privateDir, saved));
  const lost = await s.publish('--via', 'youtube', '--yes');
  assert.equal(lost.code, 1);
  assert.match(lost.stderr, /its session address is not in history\/private\/ any more, so nobody can ask YouTube how much arrived\. So the post may or may not exist\. Look in YouTube Studio \(https:\/\/studio\.youtube\.com\) for the video\..*--new/);
  assert.equal((await s.json('--via', 'youtube', '--dry-run')).out.would, 'stop');
  // YouTube forgets a session after a while.
  fs.writeFileSync(path.join(privateDir, saved), session);
  for (const value of fake.publishing.youtube.sessions.values()) value.gone = true;
  const expired = await s.publish('--via', 'youtube', '--yes');
  assert.equal(expired.code, 1);
  assert.match(expired.stderr, /YouTube no longer knows the upload to Fake Channel \(@fakechannel\) on YouTube that started on .* \(HTTP 404\)/);
  assert.match(expired.stderr, /To post it again anyway, run the same command with --new\./);
  assert.equal(fake.count('youtube', UPLOAD), 1);
  const fresh = await s.publish('--via', 'youtube', '--new', '--yes');
  assert.equal(fresh.code, 0, fresh.text);
  assert.equal(fake.count('youtube', UPLOAD), 2);
  assert.equal(fake.publishing.youtube.videos.size, 1);
});

// --- Blotato: three steps, and where a run can stop ---------------------------------

test('a run that stops after the Blotato upload and before the post goes on without --new, uploads nothing again and posts once', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --import=${DIE_BEFORE}`.trim();
  // The run dies right where it would mark the post as sending.
  const died = await s.cli(['publish', s.dir, '--via', 'blotato', '--yes'], { extra: { NODE_OPTIONS: nodeOptions, EXPLAINROO_TEST_DIE_BEFORE: '"stage": "sending"' } });
  assert.equal(died.signal, 'SIGKILL', died.text);
  const [job] = jobs(s.dir);
  assert.equal(job.stage, 'media_uploaded');
  assert.equal(job.media.public_url, [...s.fake.publishing.blotato.uploads.values()][0].publicUrl);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 0);
  assert.equal((await s.json('--via', 'blotato', '--dry-run')).out.would, 'continue');

  const r = await s.json('--via', 'blotato', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out.stage, 'finished');
  assert.equal(r.out.continued, true);
  assert.deepEqual(s.changes(), { ...NONE, blotato: 3 }, 'one upload request, one file, one post');
  assert.deepEqual(s.fake.requests('blotato', 'POST /posts')[0].body.post.content.mediaUrls, [job.media.public_url]);
  assert.equal(jobs(s.dir).length, 1);
});

test('a Blotato post that stays in progress is picked up by a later run, which reads and posts nothing', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const busy = { status: 200, body: { postSubmissionId: 'x', status: 'in-progress' } };
  s.fake.plan('blotato', 'GET /posts/*', ...Array.from({ length: 50 }, () => busy));
  const first = await s.publish('--via', 'blotato', '--yes');
  assert.equal(first.code, 0, first.text);
  assert.match(first.stdout, /^Blotato accepted the post to @fakehandle on TikTok \(id submission-\d+\)\.\nStatus: in-progress\nIt is not finished yet\. Run the same command later to read the status\. It will not post again\./);
  assert.ok(s.fake.count('blotato', 'GET /posts/*') >= 2, 'it read the status more than once');
  const [job] = jobs(s.dir);
  assert.equal(job.stage, 'accepted');
  assert.match(job.job_id, /^submission-/);
  assert.equal((await s.json('--via', 'blotato', '--dry-run')).out.would, 'read');

  s.fake.plan('blotato', 'GET /posts/*');
  const later = await s.json('--via', 'blotato');
  assert.equal(later.code, 0, later.text);
  assert.equal(later.out.stage, 'finished');
  assert.equal(later.out.post.status, 'published');
  assert.equal(s.fake.count('blotato', 'POST /posts'), 1);
  assert.equal(s.fake.count('blotato', 'POST /media/uploads'), 1);

  // A post that failed there says why, and only --new posts again.
  const failing = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  failing.fake.plan('blotato', 'GET /posts/*', { status: 200, body: { postSubmissionId: 'x', status: 'failed', errorMessage: 'TikTok refused the video.' } });
  const failed = await failing.publish('--via', 'blotato', '--yes');
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /^Blotato says the post to @fakehandle on TikTok failed: TikTok refused the video\./);
  const blocked = await failing.publish('--via', 'blotato', '--yes');
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /failed at Blotato on .*: TikTok refused the video\. To post it again, run the same command with --new\./);
  assert.equal(failing.fake.count('blotato', 'POST /posts'), 1);
});

// --- Buffer: tokens that rotate, and a 429 ------------------------------------------

function expireBufferLogin(s) {
  s.fake.expireAccess('buffer');
  const text = fs.readFileSync(s.envFile, 'utf8').replace(/^BUFFER_TOKEN_EXPIRES=.*$/m, 'BUFFER_TOKEN_EXPIRES=2020-01-01T00:00:00.000Z');
  fs.writeFileSync(s.envFile, text);
}

test('a Buffer refresh saves the new refresh token before anything uses it, keeps the other lines, and two runs at once refresh once', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  fs.appendFileSync(s.envFile, 'SOMETHING_ELSE=stays\n');
  const old = readEnvFile(s.envFile, 'BUFFER_REFRESH_TOKEN');
  expireBufferLogin(s);
  const media = ['--media-url', 'https://media.example/v.mp4'];
  const runs = await Promise.all([s.json('--via', 'buffer', ...media, '--dry-run'), s.json('--via', 'buffer', ...media, '--dry-run')]);
  for (const r of runs) assert.equal(r.code, 0, r.text);
  assert.equal(s.fake.count('buffer-auth', 'POST /token'), 1, 'the second run waited and used the saved token');
  const sent = new URLSearchParams(s.fake.requests('buffer-auth', 'POST /token')[0].raw.toString());
  assert.equal(sent.get('grant_type'), 'refresh_token');
  assert.equal(sent.get('refresh_token'), old);
  assert.equal(sent.get('client_id'), BUFFER_CLIENT, 'the built-in client renews the login');
  const renewed = readEnvFile(s.envFile, 'BUFFER_REFRESH_TOKEN');
  assert.notEqual(renewed, old);
  assert.ok(Date.parse(readEnvFile(s.envFile, 'BUFFER_TOKEN_EXPIRES')) > Date.now());
  assert.equal(readEnvFile(s.envFile, 'SOMETHING_ELSE'), 'stays');
  assert.equal(readEnvFile(s.envFile, 'BUFFER_CLIENT_ID'), null);
  assert.equal(fs.statSync(s.envFile).mode & 0o777, 0o600);
  for (const r of runs) assert.ok(!r.text.includes(renewed) && !r.text.includes(old));
  const posted = await s.json('--via', 'buffer', ...media, '--yes');
  assert.equal(posted.code, 0, posted.text);
  assert.equal(s.fake.count('buffer-auth', 'POST /token'), 1, 'the new access token was still good');
});

test('an old Buffer refresh token that comes back ends the login, and the message says to sign in again', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  const old = readEnvFile(s.envFile, 'BUFFER_REFRESH_TOKEN');
  expireBufferLogin(s);
  assert.equal((await s.json('--via', 'buffer', ...media, '--dry-run')).code, 0);
  const newest = readEnvFile(s.envFile, 'BUFFER_REFRESH_TOKEN');
  // A copy of the .env from before the refresh brings the spent token back.
  fs.writeFileSync(s.envFile, fs.readFileSync(s.envFile, 'utf8').replace(newest, old));
  expireBufferLogin(s);
  const reused = await s.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(reused.code, 1);
  assert.match(reused.stderr, /Buffer no longer accepts the saved login \(Buffer answered with HTTP 400 \(invalid_grant: Refresh token reuse detected\. The grant was revoked\.\)\)\. Run ".*connect buffer" again to sign in\. Nothing was sent\./);
  assert.ok(!reused.text.includes(old));
  // Buffer ended the whole login, so the newest token is gone too.
  fs.writeFileSync(s.envFile, fs.readFileSync(s.envFile, 'utf8').replace(old, newest));
  const after = await s.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(after.code, 1);
  assert.match(after.stderr, /Buffer no longer accepts the saved login/);
  assert.deepEqual(s.changes(), NONE);
  assert.deepEqual(jobs(s.dir), []);

  // A refresh token in the environment can't be updated, so it is never spent.
  const env = await s.publish('--via', 'buffer', ...media, '--dry-run', '--json');
  assert.equal(env.code, 0);
  const fromEnv = await s.cli(['publish', s.dir, '--via', 'buffer', ...media, '--yes'], { extra: { BUFFER_REFRESH_TOKEN: newest } });
  assert.equal(fromEnv.code, 1);
  assert.match(fromEnv.stderr, /BUFFER_REFRESH_TOKEN is set in the environment\. Buffer gives a new refresh token each time the login is renewed and the old one stops working/);
});

test('a 429 from Buffer stops at once with when to try again, sends nothing again, and the next run goes on without --new', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  s.fake.plan('buffer', GQL, {}, {}, { status: 429, headers: { 'Retry-After': '120' }, body: { errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] } });
  const busy = await s.publish(...['--via', 'buffer', ...media, '--yes']);
  assert.equal(busy.code, 1);
  assert.match(busy.stderr, /Buffer has had too many requests\. It asks to wait 120 seconds first\. Nothing more was sent, and nothing is sent again by itself\. No post was made\./);
  assert.equal(mutations(s.fake).length, 1);
  const [job] = jobs(s.dir);
  assert.equal(job.stage, 'planned');
  assert.match(job.refused.error, /too many requests/);
  assert.equal((await s.json('--via', 'buffer', ...media, '--dry-run')).out.would, 'continue');
  const again = await s.json('--via', 'buffer', ...media, '--yes');
  assert.equal(again.code, 0, again.text);
  assert.equal(again.out.stage, 'finished');
  assert.equal(again.out.continued, true);
  assert.equal(mutations(s.fake).length, 2);
  assert.equal(s.fake.publishing.buffer.posts.size, 1, 'one post exists');
  // A 429 on a read stops too, before anything is sent.
  s.fake.plan('buffer', GQL, { status: 429, headers: { 'Retry-After': '30' }, body: { errors: [{ message: 'Too many requests' }] } });
  const reading = await s.publish('--via', 'buffer', '--platform', 'tiktok', ...media, '--new', '--yes');
  assert.equal(reading.code, 1);
  assert.match(reading.stderr, /Buffer has had too many requests\. It asks to wait 30 seconds first\./);
  assert.equal(mutations(s.fake).length, 2);
});

test('a busy sign-in service says how long to wait, in seconds or until a date', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  expireBufferLogin(s);
  const date = 'Sat, 07 Nov 2026 12:00:00 GMT';
  s.fake.plan('buffer-auth', 'POST /token', { status: 429, headers: { 'Retry-After': date }, body: { error: 'rate_limited' } }, { status: 429, headers: { 'Retry-After': '45' }, body: { error: 'rate_limited' } });
  const dated = await s.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(dated.code, 1);
  assert.match(dated.stderr, new RegExp(`has had too many requests and asks to wait until ${date} before the next one\\. Nothing was sent`));
  const counted = await s.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(counted.code, 1);
  assert.match(counted.stderr, /has had too many requests and asks to wait 45 seconds before the next one\. Nothing was sent/);
  assert.equal(mutations(s.fake).length, 0);
});

// --- What publish checks before anything goes out -------------------------------------

test('publish posts only a package as package left it: missing, changed, failed verify or broken all stop first', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const none = await s.publish('--via', 'blotato', '--platform', 'reels', '--yes');
  assert.equal(none.code, 1);
  assert.match(none.stderr, /there is no reels package yet\. Run ".* package .* --platform reels" first\. publish posts a package and never renders by itself\./);
  const youtube = await s.publish('--via', 'youtube', '--yes');
  assert.match(youtube.stderr, /there is no youtube package yet/);
  const folder = path.join(s.dir, 'out/package/tiktok');
  const video = path.join(folder, 'video.mp4');
  const original = fs.readFileSync(video);
  fs.appendFileSync(video, 'changed');
  const changed = await s.publish('--via', 'blotato', '--yes');
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /out\/package\/tiktok\/video\.mp4 is not the video its post\.json describes, so it was not posted\. Run ".* package .* --platform tiktok" again\./);
  fs.writeFileSync(video, original);
  const post = JSON.parse(fs.readFileSync(path.join(folder, 'post.json'), 'utf8'));
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify({ ...post, verify: { ok: false, errors: ['The video has 2.0 seconds of silence at the end.'], warnings: [] } }));
  const failed = await s.publish('--via', 'blotato', '--yes');
  assert.match(failed.stderr, /verify found errors in out\/package\/tiktok\/video\.mp4: The video has 2\.0 seconds of silence at the end\. Fix them and run ".* package .*" again\. Nothing was sent\./);
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify({ ...post, text: undefined }));
  const broken = await s.publish('--via', 'blotato', '--dry-run');
  assert.match(broken.stderr, /out\/package\/tiktok\/post\.json is not a package that publish can read\. Run ".* package .*" again\./);
  fs.writeFileSync(path.join(folder, 'post.json'), JSON.stringify(post));
  assert.deepEqual(s.changes(), NONE);
  assert.equal(s.fake.count('blotato', 'GET /users/me/accounts'), 0, 'nothing was read either');
  assert.equal((await s.publish('--via', 'blotato', '--yes')).code, 0);
});

test('without --platform YouTube takes the youtube package, and the others take the one package they can post', async (t) => {
  const s = await setup(t, { platforms: ['shorts'], login: ['blotato'] });
  const yt = await s.publish('--via', 'youtube', '--dry-run');
  assert.equal(yt.code, 1);
  assert.match(yt.stderr, /there is no youtube package yet\..* There is a shorts package\. To post that one, add --platform shorts\./);
  const one = await s.json('--via', 'blotato', '--dry-run');
  assert.equal(one.out.platform, 'shorts');
  writePackage(s.dir, 'tiktok');
  const two = await s.publish('--via', 'blotato', '--dry-run');
  assert.equal(two.code, 1);
  assert.match(two.stderr, /more than one package could go through Blotato: shorts or tiktok\. Say which one with --platform\. Nothing was sent\./);
  fs.rmSync(path.join(s.dir, 'out'), { recursive: true });
  assert.match((await s.publish('--via', 'buffer')).stderr, /there is no package to post through Buffer yet\. Run ".* package .* --platform <name>" first\./);
});

test('YouTube refuses < and > in a title or description, so that stops before anything is sent', async (t) => {
  const s = await setup(t, { platforms: ['youtube'], login: ['youtube', 'blotato'] });
  writePackage(s.dir, 'youtube', { title: 'Why 2 < 3' });
  for (const via of ['youtube', 'blotato']) {
    const r = await s.publish('--via', via, '--platform', 'youtube', '--yes');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /YouTube does not take < or > in a title\. Change it in post\.json and run ".* package .* --platform youtube" again\. Nothing was sent\./);
  }
  assert.equal(s.fake.total(), 0);
});

test('Buffer gets the video from --media-url or from a share of this exact file, never from another file', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const none = await s.json('--via', 'buffer', '--dry-run');
  assert.equal(none.code, 0);
  assert.match(none.out.missing.join(' '), /Buffer needs a public link to this exact file, and there is none\. Run ".* share .* --platform tiktok" first, or pass --media-url with a link to this file\./);
  const real = await s.publish('--via', 'buffer', '--yes');
  assert.equal(real.code, 1);
  assert.match(real.stderr, /Buffer needs a public link to this exact file/);

  // A share of out/video.mp4 is another file, so it doesn't count for the TikTok package.
  fs.mkdirSync(path.join(s.dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'out/video.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), crypto.randomBytes(500)]));
  assert.equal((await s.cli(['share', s.dir])).code, 0);
  assert.equal((await s.json('--via', 'buffer', '--dry-run')).out.plan.media.url, null);

  // A share of the package's own file does.
  const shared = await s.cli(['share', s.dir, '--platform', 'tiktok', '--json']);
  assert.equal(shared.code, 0, shared.text);
  const link = JSON.parse(shared.stdout).media_url;
  const plan = await s.json('--via', 'buffer', '--dry-run');
  const size = s.packages.tiktok.bytes.length;
  assert.deepEqual(plan.out.plan.media, { url: link, from: 'share', expires_at: JSON.parse(shared.stdout).expires_at, check: { result: 'same', bytes: size, expected: size, how: 'HEAD' } });
  assert.equal(plan.out.request.variables.input.assets[0].video.url, link);
  assert.deepEqual(plan.out.missing, []);

  // A link that runs out within a day gets a warning in the plan.
  const shareJob = jobs(s.dir).find((job) => job.kind === 'share' && job.request.file === 'out/package/tiktok/video.mp4');
  const jobFile = fs.readdirSync(path.join(s.dir, 'history/jobs')).find((f) => JSON.parse(fs.readFileSync(path.join(s.dir, 'history/jobs', f), 'utf8')).key === shareJob.key);
  const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(s.dir, 'history/jobs', jobFile), JSON.stringify({ ...shareJob, result: { ...shareJob.result, expires_at: soon } }));
  const warned = await s.publish('--via', 'buffer', '--dry-run');
  assert.match(warned.stdout, /^Warning: {3}The link to the video expires on .*, in less than a day\. Buffer has to fetch the video before then\.$/m);
  // One that has run out is not used, and one with no expiry always is.
  fs.writeFileSync(path.join(s.dir, 'history/jobs', jobFile), JSON.stringify({ ...shareJob, result: { ...shareJob.result, expires_at: '2020-01-01T00:00:00.000Z' } }));
  assert.equal((await s.json('--via', 'buffer', '--dry-run')).out.plan.media.url, null);
  fs.writeFileSync(path.join(s.dir, 'history/jobs', jobFile), JSON.stringify({ ...shareJob, result: { ...shareJob.result, expires_at: null } }));
  assert.equal((await s.json('--via', 'buffer', '--dry-run')).out.plan.media.url, link);
  for (const bad of ['ftp://media.example/v.mp4', 'not a link', 'https://user:pass@media.example/v.mp4']) {
    assert.match((await s.publish('--via', 'buffer', '--media-url', bad, '--dry-run')).stderr, /--media-url must/);
  }
  assert.deepEqual(s.changes(), NONE);
});

test('a video link has to lead to a file of the package\'s size: another size or none stops before anything is sent, and --media-url-unchecked skips the check', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer', 'blotato'] });
  const size = s.packages.tiktok.bytes.length;
  const { files } = s.fake.publishing.links;
  const other = 'https://media.example/other.mp4';
  files.set(other, { bytes: 9999 });
  const dry = await s.json('--via', 'buffer', '--media-url', other, '--dry-run');
  assert.equal(dry.code, 0, dry.text);
  assert.equal(dry.out.would, 'stop');
  assert.deepEqual(dry.out.plan.media.check, { result: 'different', bytes: 9999, expected: size, how: 'HEAD' });
  const mismatch = (service) => `The video link ${other} leads to a file of 9,999 bytes, and out/package/tiktok/video.mp4 has 6,012 bytes. So the link is to another video, and ${service} would post that one. Pass a link to this exact file. If you are sure the link is right, add --media-url-unchecked.`;
  assert.ok(dry.out.missing.includes(mismatch('Buffer')), dry.text);
  assert.match((await s.publish('--via', 'buffer', '--media-url', other, '--dry-run')).stdout, /^Link size: 9,999 bytes, and the file has 6,012 bytes, so it is another video$/m);
  for (const via of ['buffer', 'blotato']) {
    const r = await s.publish('--via', via, '--media-url', other, '--yes');
    assert.equal(r.code, 1, r.text);
    assert.ok(r.stderr.includes(`${mismatch(via === 'buffer' ? 'Buffer' : 'Blotato')} Nothing was sent.`), r.text);
  }

  // A host that refuses HEAD is asked for the first byte.
  files.set('https://media.example/no-head.mp4', { bytes: size, head: 405 });
  const ranged = await s.json('--via', 'buffer', '--media-url', 'https://media.example/no-head.mp4', '--dry-run');
  assert.deepEqual(ranged.out.plan.media.check, { result: 'same', bytes: size, expected: size, how: 'GET of the first byte' });
  assert.deepEqual(ranged.out.missing, []);
  const asked = linkChecks(s.fake).filter((r) => r.pathname === '/media.example/no-head.mp4');
  assert.deepEqual(asked.map((r) => [r.method, r.headers.range ?? null]), [['HEAD', null], ['GET', 'bytes=0-0']]);

  // A size that can't be read stops the post too.
  for (const [link, answer, why] of [
    ['https://media.example/gone.mp4', { status: 404 }, 'it answered HTTP 404'],
    ['https://media.example/sizeless.mp4', { head: 405, size: false }, 'it answered without the size of the file'],
  ]) {
    files.set(link, answer);
    const r = await s.publish('--via', 'buffer', '--media-url', link, '--yes');
    assert.equal(r.code, 1, r.text);
    assert.ok(r.stderr.includes(`The size of the file at ${link} could not be read, because ${why}. Buffer fetches the video from this link, so explainroo compares its size with out/package/tiktok/video.mp4 first. Check that the link opens the video without a login, or add --media-url-unchecked to post it without this check. Nothing was sent.`), r.text);
    assert.ok((await s.publish('--via', 'buffer', '--media-url', link, '--dry-run')).stdout.includes(`\nLink size: not known, because ${why}\n`));
  }
  assert.deepEqual(s.changes(), NONE);
  assert.deepEqual(s.jobs(), []);

  // --media-url-unchecked sends the link as it is, and never asks its host.
  const before = linkChecks(s.fake).length;
  const unchecked = ['--via', 'buffer', '--media-url', other, '--media-url-unchecked'];
  const plan = await s.json(...unchecked, '--dry-run');
  assert.equal(plan.out.would, 'post');
  assert.deepEqual(plan.out.plan.media.check, { result: 'unchecked', bytes: null, expected: size });
  assert.match((await s.publish(...unchecked, '--dry-run')).stdout, /^Link size: not checked, because of --media-url-unchecked$/m);
  const posted = await s.json(...unchecked, '--yes');
  assert.equal(posted.code, 0, posted.text);
  assert.equal(posted.out.stage, 'finished');
  assert.equal(mutations(s.fake).at(-1).body.variables.input.assets[0].video.url, other);
  assert.equal(s.jobs()[0].plan.media.check.result, 'unchecked');
  assert.equal(linkChecks(s.fake).length, before, 'the host of the link was not asked');

  // The flag goes with a link.
  assert.match((await s.publish('--via', 'youtube', '--media-url-unchecked', '--dry-run')).stderr, /--media-url-unchecked is for Buffer and Blotato\. YouTube takes the file from this computer, so there is no link to check\./);
  assert.match((await s.publish('--via', 'blotato', '--media-url-unchecked', '--dry-run')).stderr, /--media-url-unchecked goes with --media-url\. Without a link, Blotato gets the file uploaded from this computer, so there is no link to check\./);
});

test('publish refuses flags it does not know, like a time for a post, and flags for another service', async (t) => {
  const s = await setup(t, { platforms: ['youtube'], login: ['youtube'] });
  for (const [args, words] of [
    [['--via', 'buffer', '--at', '2026-12-01T10:00:00Z'], /publish does not take --at\. .* It has no scheduler, so a post goes out when the command runs\. Nothing was sent\./],
    [['--via', 'youtube', '--schedule', 'tomorrow'], /publish does not take --schedule/],
    [['--via', 'youtube', '--channel', 'UC123'], /--channel is for --via buffer/],
    [['--via', 'youtube', '--account', '1'], /--account is for --via blotato/],
    [['--via', 'youtube', '--media-url', 'https://media.example/v.mp4'], /--media-url is for Buffer and Blotato\. YouTube takes the file from this computer\./],
    [['--via', 'youtube', '--privacy'], /--privacy needs a value/],
  ]) {
    const r = await s.publish(...args, '--yes');
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, words);
  }
  assert.equal(s.fake.total(), 0);
});

test('two identical posts at once make one post', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  s.fake.plan('blotato', 'POST /posts', { hold: true });
  const runs = [s.start(['publish', s.dir, '--via', 'blotato', '--yes']).result, s.start(['publish', s.dir, '--via', 'blotato', '--yes']).result];
  const loser = await Promise.race(runs);
  assert.equal(loser.code, 1, loser.text);
  assert.match(loser.stderr, /another run (started the same post a moment ago|is posting this right now|started a post of this file)|went out to Blotato .* no answer was saved/);
  await s.fake.until('blotato', 'POST /posts');
  s.fake.release();
  const results = await Promise.all(runs);
  assert.deepEqual(results.map((r) => r.code).toSorted(), [0, 1]);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 1);
  assert.equal(jobs(s.dir).length, 1);
});

// A run in a real terminal that stops at its question until the test answers it.
function waitingRun(s, flags) {
  const child = spawn('script', ['-qec', `${process.execPath} ${bin} publish ${s.dir} ${flags.join(' ')}`, '/dev/null'], { env: s.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '';
  const asked = new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      text += d;
      if (text.includes('Type yes to post this under your name')) resolve();
    });
  });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, text })));
  return { asked, answer: (words) => child.stdin.write(`${words}\r`), done };
}

test('a run that waits for its yes while another run posts the same file sends nothing, and a --new that another --new beat sends nothing either', { skip: !hasScript && 'needs the script program on Linux' }, async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const waiting = waitingRun(s, ['--via', 'blotato']);
  await waiting.asked;
  const other = await s.publish('--via', 'blotato', '--yes');
  assert.equal(other.code, 0, other.text);
  waiting.answer('yes');
  const late = await waiting.done;
  assert.equal(late.code, 1, late.text);
  assert.match(late.text, /while this run waited for a yes, another run started a post of this file to @fakehandle on TikTok \(job \w+\)\. Nothing was sent\. Run the same command again to see where that post is\. To post it once more anyway, add --new\./);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 1);
  assert.equal(s.fake.count('blotato', 'POST /media/uploads'), 1);
  assert.equal(jobs(s.dir).length, 1);

  // --new posts once more than the run saw, so two of them at once post once.
  const again = waitingRun(s, ['--via', 'blotato', '--new']);
  await again.asked;
  const fresh = await s.publish('--via', 'blotato', '--new', '--yes');
  assert.equal(fresh.code, 0, fresh.text);
  again.answer('yes');
  const beaten = await again.done;
  assert.equal(beaten.code, 1, beaten.text);
  assert.match(beaten.text, /while this run waited for a yes, another run started a post of this file to @fakehandle on TikTok \(job \w+\.2\)\. Nothing was sent\. To post it once more anyway, run the same command again\./);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 2);
  assert.deepEqual(jobs(s.dir).map((job) => job.attempt).toSorted(), [1, 2]);
});

test('a status that can\'t be read after the post leaves it accepted, and a repeat needs no video link to say it was posted', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  // The organizations, the channels and the post go through, and the read of the post is refused.
  s.fake.plan('buffer', GQL, {}, {}, {}, { status: 200, body: { errors: [{ message: 'Cannot query the post right now', extensions: { code: 'UNEXPECTED' } }] } });
  const r = await s.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(r.code, 0, r.text);
  assert.match(r.stdout, /^Buffer accepted the post to @fakehandle on TikTok \(id post-\d+\)\.\n.*The status could not be read: Buffer refused the request \(HTTP 200: Cannot query the post right now\)\. Run the same command later to read the status\. It will not post again\./s);
  assert.equal(jobs(s.dir)[0].stage, 'accepted');
  // Without --media-url and with no share, the post that exists is still found.
  const later = await s.json('--via', 'buffer');
  assert.equal(later.code, 0, later.text);
  assert.equal(later.out.stage, 'finished');
  const repeat = await s.publish('--via', 'buffer', '--yes');
  assert.equal(repeat.code, 0, repeat.text);
  assert.match(repeat.stdout, /^This file was already posted to @fakehandle on TikTok through Buffer/);
  assert.equal(mutations(s.fake).length, 1);
});

// --- The fakes are strict, or they prove nothing -------------------------------------

test('the fakes refuse what the services refuse: a missing field, a reused code, a wrong verifier and a part that does not fit', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const login = fake.login('buffer');
  const gql = (input) => fetch(`${fake.base}/buffer`, { method: 'POST', headers: { Authorization: `Bearer ${login.BUFFER_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: 'CreatePost', query: 'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename } }', variables: { input } }) });
  const full = { channelId: 'ch-tiktok', text: 'x', mode: 'shareNow', schedulingType: 'automatic', needsApproval: false, assets: [{ video: { url: 'https://media.example/v.mp4', metadata: { thumbnailOffset: 0 } } }] };
  // Buffer answers with HTTP 200, and a request refused before it ran has no data.
  const refused = async (input, what) => {
    const res = await gql(input);
    const json = await res.json();
    assert.equal(res.status, 200, what);
    assert.equal(Object.hasOwn(json, 'data'), false, what);
    assert.match(json.errors[0].message, /got invalid value/, what);
    return json;
  };
  for (const field of ['channelId', 'mode', 'schedulingType', 'needsApproval', 'assets']) {
    const { [field]: _, ...input } = full;
    assert.match((await refused(input, field)).errors[0].message, new RegExp(field));
  }
  await refused({ ...full, assets: [{ video: { url: 'https://media.example/v.mp4', thumbnailUrl: 'https://media.example/t.jpg' } }] }, 'thumbnailUrl');
  await refused({ ...full, channelId: 'ch-youtube', metadata: { youtube: { title: 'x' } } }, 'YouTube needs a categoryId');
  await refused({ ...full, channelId: 'ch-instagram', metadata: { instagram: { type: 'reel' } } }, 'Instagram needs shouldShareToFeed');
  assert.equal((await (await gql(full)).json()).data.createPost.__typename, 'PostActionSuccess');
  const noLogin = await fetch(`${fake.base}/buffer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noLogin.status, 401);

  const blotato = (post) => fetch(`${fake.base}/blotato/posts`, { method: 'POST', headers: { 'blotato-api-key': BLOTATO_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ post }) });
  const tiktok = { targetType: 'tiktok', privacyLevel: 'SELF_ONLY', disabledComments: false, disabledDuet: false, disabledStitch: false, isBrandedContent: false, isYourBrand: false, isAiGenerated: true };
  const post = { accountId: '102', content: { text: 'x', mediaUrls: ['https://media.example/v.mp4'], platform: 'tiktok' }, target: tiktok };
  for (const field of Object.keys(tiktok).filter((f) => f !== 'targetType')) {
    const { [field]: _, ...target } = tiktok;
    assert.equal((await blotato({ ...post, target })).status, 400, field);
  }
  assert.equal((await blotato({ ...post, target: { targetType: 'youtube', title: 'x', privacyStatus: 'private' } })).status, 400, 'a target that is not the platform');
  assert.equal((await blotato(post)).status, 201);
  const wrongKey = await fetch(`${fake.base}/blotato/users/me/accounts`, { headers: { 'blotato-api-key': BLOTATO_KEY.replace(/=+$/, '') } });
  assert.equal(wrongKey.status, 401, 'a key without its "=" is rejected');

  // A code works once, and only with its verifier.
  const verifier = 'v'.repeat(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const linkFor = (state) => `https://auth.buffer.com/auth?client_id=${BUFFER_CLIENT}&redirect_uri=${encodeURIComponent(BUFFER_REDIRECT)}&response_type=code&scope=account%3Aread%20offline_access&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
  const token = (form) => fetch(`${fake.base}/buffer-auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: BUFFER_CLIENT, redirect_uri: BUFFER_REDIRECT, grant_type: 'authorization_code', ...form }) });
  const code = new URL(fake.approve(linkFor('s1'))).searchParams.get('code');
  assert.equal((await token({ code, code_verifier: 'w'.repeat(43) })).status, 400, 'a wrong verifier');
  const other = new URL(fake.approve(linkFor('s2'))).searchParams.get('code');
  const ok = await token({ code: other, code_verifier: verifier });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).refresh_token);
  assert.equal((await token({ code: other, code_verifier: verifier })).status, 400, 'a code works once');
  assert.equal((await token({ code: new URL(fake.approve(linkFor('s3'))).searchParams.get('code'), code_verifier: verifier, client_secret: 'x' })).status, 401, 'a public client has no secret');

  // A YouTube session takes the next part only where the last one ended.
  const yt = fake.login('youtube');
  const access = await (await fetch(`${fake.base}/youtube-auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: yt.YOUTUBE_CLIENT_ID, client_secret: yt.YOUTUBE_CLIENT_SECRET, refresh_token: yt.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
  assert.equal(access.refresh_token, undefined, 'Google keeps the same refresh token');
  const auth = { Authorization: `Bearer ${access.access_token}` };
  const start = await fetch(`${fake.base}/youtube/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Length': '10', 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify({ snippet: { title: '' }, status: { privacyStatus: 'private' } }) });
  assert.equal(start.status, 400, 'an empty title');
  const session = (await fetch(`${fake.base}/youtube/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Length': '10', 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify({ snippet: { title: 'x' }, status: { privacyStatus: 'private' } }) })).headers.get('location');
  const part = (body, range) => fetch(session, { method: 'PUT', headers: { ...auth, ...(range ? { 'Content-Range': range } : {}) }, body });
  const first = await part(Buffer.alloc(4));
  assert.equal(first.status, 308);
  assert.equal(first.headers.get('range'), 'bytes=0-3');
  assert.equal((await part(Buffer.alloc(6), 'bytes 5-10/10')).status, 400, 'a part that leaves a gap');
  assert.equal((await part('', 'bytes */10')).headers.get('range'), 'bytes=0-3');
  assert.equal((await part(Buffer.alloc(6), 'bytes 4-9/10')).status, 201);
});

test('an approved post whose record no longer fits its package or its own plan is not sent, and --new posts the package as it is', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['blotato'] });
  const outside = path.join(s.dir, '..', `secret-${path.basename(s.dir)}.txt`);
  fs.writeFileSync(outside, 'not for posting');
  t.after(() => fs.rmSync(outside, { force: true }));
  // A refusal leaves an approved post that never went out.
  s.fake.plan('blotato', 'POST /media/uploads', { status: 503 });
  assert.equal((await s.publish('--via', 'blotato', '--yes')).code, 1);
  const [name] = fs.readdirSync(path.join(s.dir, 'history/jobs'));
  const file = path.join(s.dir, 'history/jobs', name);
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(job.stage, 'planned');
  const tamper = (change) => fs.writeFileSync(file, JSON.stringify(change(structuredClone(job))));
  for (const change of [
    (j) => { j.request.file.name = path.relative(s.dir, outside); return j; },
    (j) => { j.request.post.post.content.text = 'Something else entirely'; return j; },
    (j) => { j.request.post.post.accountId = '105'; return j; },
  ]) {
    tamper(change);
    const r = await s.publish('--via', 'blotato', '--yes');
    assert.equal(r.code, 1, r.text);
    assert.match(r.stderr, /does not match this package or its own plan, so it was not used, and nothing was sent\. To post the package as it is now, run the same command with --new\./);
  }
  assert.equal(s.fake.count('blotato-storage', 'PUT /*'), 0);
  assert.equal(s.fake.count('blotato', 'POST /posts'), 0);
  const fresh = await s.json('--via', 'blotato', '--new', '--yes');
  assert.equal(fresh.code, 0, fresh.text);
  assert.equal(s.fake.requests('blotato', 'POST /posts')[0].body.post.content.text, 'Your browser asks a resolver for the address.\n\n#dns');
});

test('a Buffer answer counts by what it holds: a post with errors is posted, errors while it ran are unknown, and a refusal before it ran sent nothing', async (t) => {
  const s = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  const media = ['--media-url', 'https://media.example/v.mp4'];
  // The organizations and the channels come first, then the post.
  s.fake.plan('buffer', GQL, {}, {}, { status: 200, body: { data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'post-made', status: 'sending', externalLink: null } } }, errors: [{ message: 'externalLink could not be loaded' }] } });
  const made = await s.json('--via', 'buffer', ...media, '--yes');
  assert.equal(made.code, 0, made.text);
  assert.equal(jobs(s.dir)[0].job_id, 'post-made', 'a post in the answer counts, errors or not');

  const unsure = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  unsure.fake.plan('buffer', GQL, {}, {}, { status: 200, body: { data: null, errors: [{ message: 'Unexpected error', extensions: { code: 'UNEXPECTED' } }] } });
  const unknown = await unsure.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Buffer answered without saying whether it made the post \(Unexpected error\)\. The request for the post to @fakehandle on TikTok went out\. So the post may or may not exist\. Look at the channel in Buffer for the post\./);
  assert.equal(jobs(unsure.dir)[0].stage, 'sending');
  assert.match((await unsure.publish('--via', 'buffer', ...media, '--yes')).stderr, /may or may not exist/);
  assert.equal(mutations(unsure.fake).length, 1);

  const before = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  before.fake.plan('buffer', GQL, {}, {}, { status: 200, body: { errors: [{ message: 'Variable "$input" got invalid value', extensions: { code: 'BAD_USER_INPUT' } }] } });
  const refused = await before.publish('--via', 'buffer', ...media, '--yes');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /Buffer refused the request \(Variable "\$input" got invalid value\)\. No post was made\./);
  assert.equal(jobs(before.dir)[0].stage, 'planned');
  const typed = await setup(t, { platforms: ['tiktok'], login: ['buffer'] });
  typed.fake.plan('buffer', GQL, {}, {}, { status: 200, body: { data: { createPost: { __typename: 'LimitReachedError', message: 'You have reached the limit of posts for this channel' } } } });
  const limit = await typed.publish('--via', 'buffer', ...media, '--yes');
  assert.match(limit.stderr, /Buffer refused the post \(LimitReachedError: You have reached the limit of posts for this channel\)\. No post was made\./);
  assert.equal(jobs(typed.dir)[0].stage, 'planned');
});
