// AI presenters through the presenter connector, against the local fake: the
// avatars, the plan, the consent rule, buying once, and the AI label that every
// package of such a video gets. s.presenter plays the clip in a real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GOOD_KEY, fakeClip, startFakeServices } from './helpers/fake-services.js';
import { runCli, tinyProject } from './helpers/tiny-project.js';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { postWords } from '../src/post.js';
import { listJobs } from '../src/history.js';
import { writeWav } from '../src/wav.js';

let chrome;
try { chrome = findChrome(); } catch {}

async function fake(t) {
  const f = await startFakeServices();
  t.after(f.close);
  return { ...f, run: (args, env = {}) => runCli(args, { ...f.env, PRESENTER_API_KEY: GOOD_KEY, OPENROUTER_API_KEY: '', ...env }) };
}

const POST = 'POST /v1/videos';

test('without a presenter service set up, the command says so and sends nothing', async (t) => {
  const f = await fake(t);
  const dir = tinyProject(t);
  const r = await runCli(['presenter', dir, '--avatars'], { PRESENTER_API_KEY: GOOD_KEY, EXPLAINROO_PRESENTER_URL: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no presenter service is set up yet/);
  assert.equal(f.total(), 0);
});

test('--avatars lists the avatars with their consent, and which ones this project can use', async (t) => {
  const f = await fake(t);
  const dir = tinyProject(t);
  const r = await f.run(['presenter', dir, '--avatars', '--json']);
  assert.equal(r.code, 0, r.text);
  const { avatars } = JSON.parse(r.stdout);
  assert.deepEqual(avatars.map((a) => [a.id, a.usable]), [['ava', true], ['max', true], ['jane-twin', true], ['sam-twin', false]]);
  const text = (await f.run(['presenter', dir, '--avatars'])).stdout;
  assert.match(text, /^sam-twin\s+Sam Roe, a real person, consent pending, \$0\.1 a second\. Can't be used here$/m);
  assert.match(text, /never makes a real person's face or voice without the consent flow/);
});

test('--dry-run shows what goes out and what it costs, and buys nothing', async (t) => {
  const f = await fake(t);
  const dir = tinyProject(t);
  const r = await f.run(['presenter', dir, 'intro', '--avatar', 'ava', '--dry-run', '--json']);
  assert.equal(r.code, 0, r.text);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.dry_run, true);
  assert.equal(plan.file, 'assets/presenters/intro.mp4');
  assert.equal(plan.estimated_usd, Math.round(0.05 * plan.seconds * 10000) / 10000);
  assert.match(plan.sends, /the narration of scene "intro"/);
  assert.equal(f.count('presenter', POST), 0);
  assert.equal(listJobs(dir).length, 0);
  // A real run needs a cap.
  const capless = await f.run(['presenter', dir, 'intro', '--avatar', 'ava']);
  assert.equal(capless.code, 1);
  assert.match(capless.stderr, /add --max-cost/);
  assert.equal(f.count('presenter', POST), 0);
});

test('the consent rule refuses a real face without verified consent, a recorded voice on any other avatar, and a photo', async (t) => {
  const f = await fake(t);
  const dir = tinyProject(t);
  const pending = await f.run(['presenter', dir, 'intro', '--avatar', 'sam-twin', '--max-cost', '1']);
  assert.equal(pending.code, 1);
  assert.match(pending.stderr, /the avatar "Sam Roe" shows a real person, and its consent is still pending/);
  const photo = await f.run(['presenter', dir, 'intro', '--avatar', 'ava', '--photo', 'me.jpg', '--max-cost', '1']);
  assert.equal(photo.code, 1);
  assert.match(photo.stderr, /presenter takes no --photo\. explainroo never makes a real person's face or voice/);
  // Narration from a recording is a real person's voice.
  const recorded = tinyProject(t);
  fs.mkdirSync(path.join(recorded, 'assets'), { recursive: true });
  writeWav(path.join(recorded, 'assets', 'me.wav'), new Float32Array(2400), 24000);
  const config = JSON.parse(fs.readFileSync(path.join(recorded, 'video.json'), 'utf8'));
  fs.writeFileSync(path.join(recorded, 'video.json'), JSON.stringify({ ...config, voice: { provider: 'recording', src: 'assets/me.wav' } }));
  fs.mkdirSync(path.join(recorded, 'build', 'voice'), { recursive: true });
  writeWav(path.join(recorded, 'build', 'voice', 'intro.wav'), new Float32Array(2400), 24000);
  const voice = await f.run(['presenter', recorded, 'intro', '--avatar', 'ava', '--max-cost', '1']);
  assert.equal(voice.code, 1);
  assert.match(voice.stderr, /the narration is a recording, which is a real person's voice, and the avatar "Ava" has no verified consent for that voice/);
  // The person who gave consent for face and voice may speak their own recording.
  const twin = await f.run(['presenter', recorded, 'intro', '--avatar', 'jane-twin', '--max-cost', '1']);
  assert.equal(twin.code, 0, twin.text);
  assert.equal(f.count('presenter', POST), 1, 'only the allowed one went out');
  assert.equal(JSON.parse(f.requests('presenter', POST)[0].raw.toString()).consent_id, 'consent-1');
  assert.ok(listJobs(dir).every((job) => job.status !== 'requesting'), 'a refusal leaves no open job');
  assert.equal(listJobs(dir).length, 0);
});

test('a presenter clip is bought once, and every package of the video gets the AI label', async (t) => {
  const f = await fake(t);
  const dir = tinyProject(t);
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ description: 'A tiny video.', ai_label: false }));
  const first = await f.run(['presenter', dir, 'intro', '--avatar', 'ava', '--max-cost', '1', '--json']);
  assert.equal(first.code, 0, first.text);
  const made = JSON.parse(first.stdout);
  assert.equal(made.reused, false);
  assert.ok(fs.statSync(path.join(dir, 'assets', 'presenters', 'intro.mp4')).size > 1000);
  const sent = JSON.parse(f.requests('presenter', POST)[0].raw.toString());
  assert.equal(sent.avatar, 'ava');
  assert.equal(sent.aspect, '16:9');
  assert.equal(Buffer.from(sent.audio, 'base64').subarray(0, 4).toString(), 'RIFF', 'the scene narration goes out as sound');
  // Using what was bought needs no cap.
  const again = await f.run(['presenter', dir, 'intro', '--avatar', 'ava', '--json']);
  assert.equal(JSON.parse(again.stdout).reused, true);
  assert.equal(f.count('presenter', POST), 1);
  const words = postWords(loadProject(dir), 'tiktok');
  assert.equal(words.ai_label, true, 'post.json can\'t turn the label off');
  assert.equal(words.ai_presenter, true);
  assert.ok(words.ai_reasons.includes('presenter: Ava, an AI person'));
  assert.ok(words.credits.includes('Presenter: Ava, an AI person made by a presenter service'));
  assert.ok(words.warnings.some((w) => /sets ai_label to false, but the video has an AI presenter, so the AI label stays on/.test(w)));
  const history = await runCli(['history', dir]);
  assert.match(history.stdout, /\$0\.0500 in known prices/, "history counts what the clip cost");
});

test('s.presenter plays the clip beside the content with its label, and check passes', { skip: !chrome && 'no browser here' }, async (t) => {
  const dir = tinyProject(t, { size: '16:9' });
  fs.mkdirSync(path.join(dir, 'assets', 'presenters'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'presenters', 'intro.mp4'), fakeClip({ duration: 1 }, 1));
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text('Tiny', { x: s.safe.left + s.safe.w * 0.3, y: s.cy, size: 80, at: 0 }); s.presenter('intro'); } };");
  const r = await runCli(['check', dir, '--json']);
  assert.equal(r.code, 0, r.text);
  const { issues } = JSON.parse(r.stdout);
  assert.deepEqual(issues.filter((i) => i.level !== 'hint'), []);
  const still = await runCli(['still', dir, 'intro@0.8', '--json']);
  assert.equal(still.code, 0, still.text);
  assert.ok(fs.existsSync(JSON.parse(still.stdout).stills[0].file));
});
