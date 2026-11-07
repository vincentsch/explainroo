// Real renders and packages of a project with settings for one size, and what
// render says about the file it writes and about motion blur.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { renderIdentity } from '../src/pipeline.js';
import { readVersions } from '../src/history.js';
import { probe } from '../src/ffmpeg.js';
import { runCli as cli, seedNarration, tinyProject as tiny } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const TIKTOK = { captions: 'bold', pace: 1.2 };

async function render(dir, ...flags) {
  const r = await cli(['render', dir, '--workers', '1', '--json', ...flags]);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  return JSON.parse(r.stdout);
}

async function pack(dir, platform) {
  const r = await cli(['package', dir, '--platform', platform, '--workers', '1', '--json']);
  assert.equal(r.code, 0, r.text);
  return JSON.parse(r.stdout);
}

// The identity a render of this setup has, from the timeline its last run wrote.
function identity(dir, overrides = {}) {
  const project = loadProject(dir, overrides);
  return renderIdentity(project, JSON.parse(fs.readFileSync(path.join(project.paths.build, 'timeline.json'), 'utf8')));
}

const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const voiceFiles = (dir) => ['build/voice', 'build/pace-1.2/voice'].flatMap((folder) => fs.readdirSync(path.join(dir, folder)).sort().map((name) => {
  const file = path.join(dir, folder, name);
  return `${folder}/${name} ${hashFile(file)} ${fs.statSync(file).mtimeMs}`;
}));

test('one project, two sizes: the 16:9 render keeps its settings, the TikTok render gets its block and its own narration, and switching makes no narration again', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9', sizes: { tiktok: TIKTOK } });
  seedNarration(loadProject(dir, { size: 'tiktok' }));
  const voices = voiceFiles(dir);
  const wide = await render(dir);
  const tall = await render(dir, '--size', 'tiktok');
  const again = await cli(['render', dir, '--workers', '1']);
  assert.equal(again.code, 0, again.text);
  assert.deepEqual(voiceFiles(dir), voices, 'no narration was made again');
  assert.doesNotMatch(again.stderr, /^voice /m);
  // Each pace has its own timeline and mix, next to the normal build.
  const timeline = (folder) => JSON.parse(fs.readFileSync(path.join(dir, folder, 'timeline.json'), 'utf8'));
  assert.equal(timeline('build').pace, 1);
  assert.equal(timeline('build/pace-1.2').pace, 1.2);
  assert.equal(timeline('build/pace-1.2').scenes[0].voice.url, 'build/pace-1.2/voice/intro.wav');
  assert.ok(fs.statSync(path.join(dir, 'build/pace-1.2/mix.wav')).size > 0);
  // The renders are made from those settings: 16:9 as before, TikTok with bold captions at 1.2.
  assert.equal(loadProject(dir).config.captions, false);
  assert.equal(loadProject(dir, { size: 'tiktok' }).config.captions, 'bold');
  assert.equal(wide.identity, identity(dir));
  assert.equal(tall.identity, identity(dir, { size: 'tiktok' }));
  assert.equal(path.relative(dir, tall.out), 'out/video-tiktok.mp4', 'a block adds nothing to the file name');
  // Without the block, the TikTok render is another video.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), sizes: {} }));
  assert.equal(loadProject(dir, { size: 'tiktok' }).config.captions, true);
  assert.equal(loadProject(dir, { size: 'tiktok' }).paths.build, path.join(dir, 'build'));
});

test('package names the render it could copy, and copies that render once it exists, with the TikTok block', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9', sizes: { tiktok: TIKTOK } }, { narrated: false });
  const first = await cli(['package', dir, '--platform', 'tiktok', '--workers', '1']);
  assert.equal(first.code, 0, first.text);
  assert.match(first.stdout, /^Video: 1080x1920, 1\.0s, without the watermark, rendered now$/m);
  assert.match(first.stdout, /^ {2}No render was this exact video\. Next time, "(.+) render \S+ --size tiktok --no-watermark" makes one that package can copy\.$/m);
  assert.match(first.stderr, /^checking the TikTok package at the tiktok size \(1080x1920\) with its settings from "sizes", without the watermark$/m);
  assert.match(first.stderr, /^no render is this exact video, so the package renders it$/m);
  const json = await pack(dir, 'tiktok');
  assert.equal(json.source.how, 'kept');
  const plan = JSON.parse((await cli(['package', dir, '--platform', 'youtube', '--workers', '1', '--json'])).stdout);
  assert.equal(plan.source.how, 'rendered');
  assert.match(plan.source.command, / render \S+$/, 'a 16:9 project goes to YouTube as it is');

  // The command the TikTok package named, run as printed.
  const command = /"(.+ --no-watermark)"/.exec(first.stdout)[1];
  const printed = spawn(command, { shell: true, stdio: 'ignore' });
  assert.equal((await once(printed, 'close'))[0], 0);
  const copied = await pack(dir, 'tiktok');
  assert.deepEqual(copied.source, { how: 'copied', file: 'out/video-tiktok-no-watermark.mp4' });
  assert.equal(copied.post.size, 'tiktok');
  assert.equal(copied.post.identity, identity(dir, { size: 'tiktok', watermark: false }));
  assert.ok(fs.statSync(path.join(dir, 'out/package/tiktok/video.cover.jpg')).size > 0);
});

test('an instagram project packages for LinkedIn with its linkedin block, and as before without one', { skip, timeout: 400000 }, async (t) => {
  const block = { captions: false, pace: 1.2, cover: 'intro@0.5' };
  const dir = tiny(t, { size: 'instagram', sizes: { linkedin: block } }, { narrated: false });
  const settings = path.join(dir, 'video.json');
  const own = await render(dir);
  assert.equal(path.relative(dir, own.out), 'out/video.mp4');
  const linkedin = await pack(dir, 'linkedin');
  assert.equal(linkedin.source.how, 'rendered', 'the instagram render is not this video');
  assert.match(linkedin.source.command, / render \S+ --size linkedin$/);
  assert.equal(linkedin.post.size, 'linkedin');
  assert.equal(linkedin.post.identity, identity(dir, { size: 'linkedin' }));
  assert.equal(loadProject(dir, { size: 'linkedin' }).config.captions, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'build/pace-1.2/timeline.json'), 'utf8')).pace, 1.2);
  // After a render at that size, the package copies it.
  await render(dir, '--size', 'linkedin');
  assert.deepEqual((await pack(dir, 'linkedin')).source, { how: 'copied', file: 'out/video-linkedin.mp4' });
  // Without the block, the project's own instagram render goes to LinkedIn, as before.
  fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), sizes: undefined }));
  const plain = await pack(dir, 'linkedin');
  assert.deepEqual(plain.source, { how: 'copied', file: 'out/video.mp4' });
  assert.equal(plain.post.size, 'instagram');
  assert.equal(plain.post.identity, own.identity, 'the instagram render kept its identity while the linkedin block came and went');
});

test('--quality fast makes a final without motion blur that package takes only when the project has "motionBlur": false', { skip, timeout: 400000 }, async (t) => {
  const dir = tiny(t, { size: '16:9', motionBlur: true }, { narrated: false });
  const settings = path.join(dir, 'video.json');
  for (const [flags, message] of [
    [['--quality', 'fast', '--draft'], /--quality fast makes a final without motion blur, and a draft is already fast\. Leave out one of them\./],
    [['--quality', 'slow'], /--quality must be final or fast, not "slow"/],
    [['--quality'], /--quality needs a value/],
  ]) {
    const r = await cli(['render', dir, ...flags]);
    assert.equal(r.code, 1, flags.join(' '));
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /^rendering /m);
  }
  const fast = await cli(['render', dir, '--quality', 'fast', '--workers', '1']);
  assert.equal(fast.code, 0, fast.text);
  assert.match(fast.stderr, /^rendering 1\.0s \(24 frames at 24 fps\) to a 1920x1080 video with 1 worker$/m);
  assert.doesNotMatch(fast.stderr, /motion blur/);
  assert.equal(path.resolve(fast.stdout.split('\n')[0]), path.join(dir, 'out/video.mp4'), 'a final keeps its name');
  const line = readVersions(dir).at(-1);
  assert.equal(line.file, 'out/video.mp4');
  assert.equal(line.draft, false);
  assert.equal(line.scale, 1);
  assert.equal(line.motionBlur, false);
  assert.equal(line.identity, identity(dir, { motionBlur: false }));
  assert.notEqual(line.identity, identity(dir), 'a fast render is not a final with motion blur');
  assert.match((await cli(['history', dir])).stdout, /out\/video\.mp4 .*final, no motion blur, full video/);
  const blurred = await pack(dir, 'youtube');
  assert.equal(blurred.source.how, 'rendered');
  assert.equal(readVersions(dir).at(-1).motionBlur, true);

  // A project without motion blur makes the same video either way.
  fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, 'utf8')), motionBlur: false }));
  await render(dir, '--quality', 'fast');
  assert.deepEqual((await pack(dir, 'youtube')).source, { how: 'copied', file: 'out/video.mp4' });
});

test('render prints the size of the file it writes, and only a final with motion blur says why it is slow', { skip, timeout: 400000 }, async (t) => {
  const dir = tiny(t, { size: '16:9', motionBlur: true }, { narrated: false });
  const run = async (...flags) => {
    const r = await cli(['render', dir, '--workers', '1', ...flags]);
    assert.equal(r.code, 0, r.text);
    return r.stderr;
  };
  const note = /^motion blur: a final draws 6 samples per frame, which makes it several times slower than a draft\. --quality fast leaves the blur out\.$/m;
  // A draft of a 1080x1350 frame is 540x675, which the encoder makes 540x676.
  const draft = await run('--draft', '--size', 'linkedin');
  assert.match(draft, /^rendering 1\.0s \(24 frames at 24 fps\) to a 540x676 video with 1 worker$/m);
  assert.doesNotMatch(draft, /motion blur/);
  const video = (await probe(path.join(dir, 'out/draft-linkedin.mp4'))).streams.find((s) => s.codec_type === 'video');
  assert.deepEqual([video.width, video.height], [540, 676]);
  const gif = await run('--format', 'gif', '--size', 'youtube');
  assert.match(gif, /to a 960x540 GIF with/);
  assert.doesNotMatch(gif, /motion blur/);
  const image = (await probe(path.join(dir, 'out/video-youtube.gif'))).streams[0];
  assert.deepEqual([image.width, image.height], [960, 540]);
  assert.doesNotMatch(await run('--transparent', '--format', 'webm'), /motion blur/);
  const final = await run();
  assert.match(final, note);
  assert.ok(final.indexOf('motion blur:') < final.indexOf('frames done'), 'it says so before the frames');
  assert.ok(final.indexOf('rendering 1.0s') < final.indexOf('motion blur:'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), motionBlur: false }));
  assert.doesNotMatch(await run(), /motion blur/);
});

test('export --size exports that size with its block into a folder of its own, and --no-watermark too', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9', sizes: { tiktok: { ...TIKTOK, watermark: 'tiktok.example.com' } } });
  seedNarration(loadProject(dir, { size: 'tiktok' }));
  const exported = async (...flags) => {
    const r = await cli(['export', dir, '--json', ...flags]);
    assert.equal(r.code, 0, r.text);
    const json = JSON.parse(r.stdout);
    const { config, timeline } = JSON.parse(fs.readFileSync(path.join(json.out, 'state.json'), 'utf8'));
    return { json, config, timeline };
  };
  const plain = await exported();
  assert.equal(plain.json.out, path.join(dir, 'out/player'));
  assert.deepEqual([plain.json.width, plain.json.height], [1920, 1080]);
  assert.deepEqual([plain.config.size, plain.config.captions, plain.config.pace, plain.config.watermark], ['16:9', false, 1, 'explainroo.com']);
  const before = fs.readFileSync(path.join(dir, 'out/player/state.json'));

  const tall = await exported('--size', 'tiktok');
  assert.equal(tall.json.out, path.join(dir, 'out/player-tiktok'));
  assert.deepEqual([tall.json.width, tall.json.height], [1080, 1920]);
  assert.deepEqual([tall.config.size, tall.config.captions, tall.config.pace, tall.config.watermark], ['tiktok', 'bold', 1.2, 'tiktok.example.com']);
  assert.equal(tall.timeline.pace, 1.2);
  assert.ok(fs.statSync(path.join(dir, 'build/pace-1.2/player-mix.wav')).size > 0, 'the TikTok pace has its own build');
  assert.ok(fs.statSync(path.join(tall.json.out, 'audio.m4a')).size > 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'out/player/state.json')), before, 'the normal player stays as it was');

  const bare = await exported('--size', 'tiktok', '--no-watermark');
  assert.equal(bare.json.out, path.join(dir, 'out/player-tiktok-no-watermark'));
  assert.equal(bare.config.watermark, false);
  assert.equal(bare.config.captions, 'bold');
});
