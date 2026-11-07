// Runs the real package command where it can reuse a render, and where it has to stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { readVersions, sha256File } from '../src/history.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { runCli as cli, speechCheckModel, tinyProject as tiny } from './helpers/tiny-project.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';
// verify listens to narration, which needs the speech check model.
const narrated = skip || (!speechCheckModel && 'the speech check model is not downloaded');

async function pack(dir, platform, ...flags) {
  const r = await cli(['package', dir, '--platform', platform, '--workers', '1', '--json', ...flags]);
  assert.equal(r.code, 0, r.text);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  return JSON.parse(r.stdout);
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a full render is copied and all the files next to it are written again, and an earlier verify of the same file counts', { skip: narrated, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9' });
  const rendered = await cli(['render', dir, '--workers', '1', '--json']);
  assert.equal(rendered.code, 0, rendered.text);
  const verified = await cli(['verify', dir, '--json']);
  assert.equal(verified.code, 0, verified.text);
  // The package writes these itself rather than hoping they are still there.
  for (const ext of ['srt', 'vtt', 'cover.jpg', 'chapters.txt']) fs.rmSync(path.join(dir, `out/video.${ext}`));
  const r = await pack(dir, 'youtube');
  assert.deepEqual(r.source, { how: 'copied', file: 'out/video.mp4' });
  assert.equal(r.verified, 'earlier');
  const folder = path.join(dir, 'out/package/youtube');
  assert.deepEqual(fs.readFileSync(path.join(folder, 'video.mp4')), fs.readFileSync(path.join(dir, 'out/video.mp4')));
  for (const name of ['video.srt', 'video.vtt', 'video.cover.jpg', 'video.chapters.txt', 'description.txt', 'credits.txt', 'report.json', 'post.json']) assert.ok(fs.statSync(path.join(folder, name)).size > 0, name);
  const report = read(path.join(folder, 'report.json'));
  assert.equal(report.sha256, r.post.sha256);
  assert.equal(report.file, path.join(folder, 'video.mp4'));
  assert.equal(r.post.watermark, true);
  const line = readVersions(dir).at(-1);
  assert.equal(line.event, 'package');
  assert.equal(line.source, 'out/video.mp4');
  assert.match((await cli(['history', dir])).stdout, /out\/package\/youtube\/video\.mp4 .*final, full video, watermark on, package for youtube, verify passed/);
  // What the agent looked at with --size tiktok --no-watermark is reused for TikTok.
  const look = await cli(['render', dir, '--size', 'tiktok', '--no-watermark', '--workers', '1', '--json']);
  assert.equal(look.code, 0, look.text);
  const tiktok = await pack(dir, 'tiktok');
  assert.deepEqual(tiktok.source, { how: 'copied', file: 'out/video-tiktok-no-watermark.mp4' });
  assert.equal(tiktok.verified, 'now');
});

test('a --from/--to render and a --scale render are never reused, so package renders the whole video', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9' }, { narrated: false });
  const part = await cli(['render', dir, '--from', '0', '--to', '0.5', '--workers', '1']);
  assert.equal(part.code, 0, part.text);
  const first = await pack(dir, 'youtube');
  assert.equal(first.source.how, 'rendered');
  assert.equal(first.post.duration, 1);
  fs.rmSync(path.join(dir, 'out/package'), { recursive: true });
  const small = await cli(['render', dir, '--scale', '0.5', '--workers', '1']);
  assert.equal(small.code, 0, small.text);
  const second = await pack(dir, 'youtube');
  assert.equal(second.source.how, 'rendered');
  assert.deepEqual([second.post.width, second.post.height], [1920, 1080]);
  assert.notEqual(second.post.sha256, sha256File(path.join(dir, 'out/video.mp4')));
});

test('a package that fails check says which size failed and writes nothing, and bad flags stop before any work', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9' }, { narrated: false });
  // A position that suits a wide frame runs off a tall one.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text('Wide', { x: 1500, y: 540, size: 60, at: 0 }); } };");
  const failed = await cli(['package', dir, '--platform', 'tiktok']);
  assert.equal(failed.code, 1, failed.text);
  assert.match(failed.stdout, /^ERROR intro @[\d.]+s: "Wide" runs off the frame .* in a 1080x1920 frame/m);
  assert.match(failed.stdout, /the tiktok package failed check at the tiktok size \(1080x1920\), without the watermark, so nothing was packaged/);
  assert.match(failed.stdout, /check \S+ --size tiktok --no-watermark$/m);
  assert.equal(fs.existsSync(path.join(dir, 'out/package')), false);
  const json = JSON.parse((await cli(['package', dir, '--platform', 'tiktok', '--json'])).stdout);
  assert.equal(json.ok, false);
  assert.equal(json.failed, 'check');
  assert.ok(json.issues.some((i) => i.level === 'error'));
  // The same project fits YouTube.
  assert.equal((await pack(dir, 'youtube')).ok, true);
  const folder = path.join(dir, 'out/package/youtube');
  const lines = readVersions(dir).length;
  // A cover at a scene that isn't there stops the package before anything is rendered or copied.
  const settings = path.join(dir, 'video.json');
  const raw = read(settings);
  fs.writeFileSync(settings, JSON.stringify({ ...raw, cover: 'nosuch@end' }));
  const cover = await cli(['package', dir, '--platform', 'youtube']);
  assert.equal(cover.code, 1);
  assert.match(cover.stderr, /no scene "nosuch"/);
  assert.doesNotMatch(cover.stderr, /^rendering /m);
  assert.equal(readVersions(dir).length, lines);
  fs.writeFileSync(settings, JSON.stringify(raw));
  // Once the project no longer passes check, the package from before is out of date.
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text('Wide', { x: 2600, y: 540, size: 60, at: 0 }); } };");
  const stale = await cli(['package', dir, '--platform', 'youtube']);
  assert.equal(stale.code, 1);
  assert.match(stale.stdout, /The youtube package from before is out of date, so its post\.json is removed until a package works again\./);
  assert.equal(fs.existsSync(path.join(folder, 'post.json')), false);
  assert.match((await cli(['share', dir, '--platform', 'youtube'])).stderr, /there is no youtube package to share yet/);

  for (const [flags, message] of [
    [[], /package needs --platform youtube, shorts, tiktok, reels, linkedin or x/],
    [['--platform', 'myspace'], /there is no platform "myspace"/],
    [['--platform'], /--platform needs a value/],
    [['--platform', 'tiktok', '--size', '9:16'], /--size works only with --platform x/],
    [['--platform', 'x', '--hashtags', 'two-words'], /"two-words" is not a hashtag/],
    [['--platform', 'x', '--title', ' '], /--title needs words/],
  ]) {
    const r = await cli(['package', dir, ...flags]);
    assert.equal(r.code, 1, flags.join(' '));
    assert.match(r.stderr, message);
  }
  fs.writeFileSync(path.join(dir, 'post.json'), '{ "titel": "x" }');
  const bad = await cli(['package', dir, '--platform', 'x']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /post\.json has unknown setting\(s\): titel/);
  assert.equal(fs.existsSync(path.join(dir, 'out/package/x')), false);
});

test('a package of a video whose sound clips fails verify with the word clipping', { skip, timeout: 300000 }, async (t) => {
  const dir = tiny(t, { size: '16:9' }, { narrated: false });
  const rendered = await cli(['render', dir, '--workers', '1', '--json']);
  assert.equal(rendered.code, 0, rendered.text);
  // The render's sound changes for a tone above full scale, like a render from before
  // the limiter, and the record gets its hash, so package takes the file as it is.
  const video = path.join(dir, 'out/video.mp4');
  const clipping = path.join(dir, 'out/clipping.mp4');
  await ffmpeg(['-loglevel', 'error', '-i', video, '-f', 'lavfi', '-i', "aevalsrc=exprs='1.12*sin(2*PI*1000*t)':s=48000:d=1", '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', clipping]);
  fs.renameSync(clipping, video);
  const record = path.join(dir, 'history/versions.jsonl');
  const lines = fs.readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  lines.at(-1).sha256 = sha256File(video);
  fs.writeFileSync(record, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const r = await cli(['package', dir, '--platform', 'youtube', '--workers', '1']);
  assert.equal(r.code, 1, r.text);
  assert.match(r.stdout, /, copied from out\/video\.mp4$/m);
  assert.match(r.stdout, /^verify: found errors/m);
  assert.match(r.stdout, /^ERROR the true peak is \+\d\.\d dBTP, above 0 dBTP, so the sound is clipping\./m);
  assert.match(r.stdout, /^Fix the errors and package it again before you post it\.$/m);
  const post = read(path.join(dir, 'out/package/youtube/post.json'));
  assert.equal(post.verify.ok, false);
  assert.match(post.verify.errors[0], /clipping/);
});
