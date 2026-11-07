// Runs the real package command on a tiny project, one platform after another.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { probe } from '../src/ffmpeg.js';
import { readVersions, sha256File } from '../src/history.js';
import { runCli as cli, tinyProject as tiny } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

async function pack(dir, platform, ...flags) {
  const r = await cli(['package', dir, '--platform', platform, '--workers', '2', '--json', ...flags]);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  return JSON.parse(r.stdout);
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a package for each of the six platforms: the sized video, its words, captions, cover, AI label and credits', { skip, timeout: 400000 }, async (t) => {
  const dir = tiny(t);
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ description: 'A tiny video about tiny things.', hashtags: ['tiny'] }));
  // A file left from an earlier package that no longer applies goes.
  fs.mkdirSync(path.join(dir, 'out/package/x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'out/package/x/video.chapters.txt'), 'old');
  const sizes = { youtube: [1920, 1080, 'youtube'], shorts: [1080, 1920, 'shorts'], tiktok: [1080, 1920, 'tiktok'], reels: [1080, 1920, 'reels'], linkedin: [1080, 1350, 'linkedin'], x: [1080, 1080, 'square'] };
  for (const [platform, [width, height, size]] of Object.entries(sizes)) {
    const r = await pack(dir, platform);
    const folder = path.join(dir, 'out/package', platform);
    assert.equal(r.folder, folder);
    assert.equal(r.ok, true);
    assert.equal(r.source.how, 'rendered', platform);
    const expected = ['credits.txt', 'description.txt', 'post.json', 'report.json', 'video.cover.jpg', 'video.mp4', 'video.srt', 'video.vtt', ...(platform === 'youtube' ? ['video.chapters.txt'] : [])];
    assert.deepEqual(fs.readdirSync(folder).sort(), expected.sort(), platform);
    for (const name of expected) assert.ok(fs.statSync(path.join(folder, name)).size > 0, `${platform}: ${name}`);

    const post = read(path.join(folder, 'post.json'));
    assert.deepEqual(post, r.post);
    assert.equal(post.platform, platform);
    assert.equal(post.size, size);
    assert.deepEqual([post.width, post.height, post.fps, post.duration], [width, height, 24, 1]);
    assert.equal(post.watermark, platform !== 'tiktok', platform);
    assert.equal(post.title, 'Tiny video');
    assert.equal(post.description, platform === 'youtube' ? 'A tiny video about tiny things.\n\n0:00 Intro' : 'A tiny video about tiny things.');
    assert.equal(post.text, `${post.description}\n\n#tiny`);
    assert.deepEqual(post.hashtags, ['#tiny']);
    assert.equal(post.ai_label, true);
    assert.deepEqual(post.ai_reasons, ['voice: Kokoro']);
    assert.deepEqual(post.credits, ['Voice: Kokoro', 'Music: made by explainroo', 'Made with explainroo']);
    assert.equal(post.made_for_kids, false);
    assert.equal(post.category, '27');
    assert.equal(post.sha256, sha256File(path.join(folder, 'video.mp4')));
    assert.equal(post.verify.ok, true);
    assert.equal(post.verify.report, 'report.json');
    assert.equal(read(path.join(folder, 'report.json')).sha256, post.sha256);
    assert.equal(fs.readFileSync(path.join(folder, 'description.txt'), 'utf8'), `${post.text}\n`);
    assert.equal(fs.readFileSync(path.join(folder, 'credits.txt'), 'utf8'), `${post.credits.join('\n')}\n`);
    assert.ok(Array.isArray(post.warnings));

    const info = await probe(path.join(folder, 'video.mp4'));
    const stream = info.streams.find((s) => s.codec_type === 'video');
    assert.deepEqual([stream.width, stream.height], [width, height], platform);
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
    const line = readVersions(dir).at(-1);
    assert.equal(line.event, 'package');
    assert.equal(line.platform, platform);
    assert.equal(line.file, `out/package/${platform}/video.mp4`);
    assert.equal(line.sha256, post.sha256);
    assert.equal(line.watermark, platform !== 'tiktok');
    assert.equal(line.verify.ok, true);
  }
  // The TikTok frame has no watermark, and the free area starts higher without it.
  const tiktok = read(path.join(dir, 'out/package/tiktok/post.json'));
  const reels = read(path.join(dir, 'out/package/reels/post.json'));
  assert.equal(tiktok.watermark, false);
  assert.equal(reels.watermark, true);
});

test('the words are settled from the default, post.json, its platform block and the flags, in that order', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t);
  const words = (file) => fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(file));
  words({ title: 'From post.json', description: 'Words for every platform.', hashtags: ['tiny'], made_for_kids: true, category: 28, platforms: { tiktok: { title: 'For TikTok', hashtags: ['#tok'] } } });
  const flagged = await pack(dir, 'tiktok', '--title', 'From the flag', '--description', 'Words from the flag. #tok', '--hashtags', 'tok,extra');
  assert.equal(flagged.post.title, 'From the flag');
  assert.equal(flagged.post.description, 'Words from the flag. #tok');
  assert.deepEqual(flagged.post.hashtags, ['#tok', '#extra']);
  assert.equal(flagged.post.text, 'Words from the flag. #tok\n\n#extra');
  assert.equal(flagged.post.made_for_kids, true);
  assert.equal(flagged.post.category, '28');
  const block = await pack(dir, 'tiktok');
  assert.equal(block.source.how, 'kept', 'only the words changed, so the video stays');
  assert.equal(block.post.title, 'For TikTok');
  assert.equal(block.post.text, 'Words for every platform.\n\n#tok');
  words({ title: 'From post.json', description: 'Words for every platform.' });
  assert.equal((await pack(dir, 'tiktok')).post.title, 'From post.json');
  fs.rmSync(path.join(dir, 'post.json'));
  const plain = await pack(dir, 'tiktok');
  assert.equal(plain.post.title, 'Tiny video');
  assert.equal(plain.post.description, '');
  assert.equal(plain.post.text, 'Tiny video');
  assert.equal(plain.post.made_for_kids, false);
  assert.equal(plain.post.category, '27');
  assert.match(plain.post.warnings[0].message, /there is no description yet/);
  assert.equal(readVersions(dir).filter((l) => l.event === 'package').length, 1);
});
