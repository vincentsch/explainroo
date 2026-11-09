// check and verify take any video file, without a project: blank, black and
// frozen stretches, silence, loudness and true peak, text too small for a phone
// read from frames, and with a script, the speech against it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../src/ffmpeg.js';
import { checkVideo, formatVideoCheck, frameStep, scriptWords, smallText } from '../src/video-check.js';
import { textLines } from '../src/text-size.js';
import { runCli } from './helpers/tiny-project.js';

const fixture = fileURLToPath(new URL('./fixtures/text-sizes.png', import.meta.url));

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-video-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A video of the text fixture: lines of text at 10, 14, 20, 30 and 48 pixels in a
// 1280x720 frame, with a quiet tone. `filter` changes the picture.
async function textVideo(dir, name, filter = 'null', seconds = 3) {
  const file = path.join(dir, name);
  await ffmpeg(['-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', fixture, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-vf', `${filter},format=yuv420p`, '-t', String(seconds), '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-af', 'volume=0.2', '-shortest', file]);
  return file;
}

test('the text of a frame is found with its size, and photo-like patterns are not text', async () => {
  const gray = (await import('node:child_process')).execFileSync('ffmpeg', ['-v', 'error', '-i', fixture, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
  const lines = textLines(gray, 1280, 720).sort((a, b) => a.y0 - b.y0);
  const sizes = [10, 14, 20, 30, 48];
  assert.equal(lines.length, sizes.length);
  lines.forEach((line, i) => {
    assert.ok(Math.abs(line.size - sizes[i]) <= Math.max(2, sizes[i] * 0.2), `the ${sizes[i]}px line reads ${line.size}px`);
    assert.ok(line.x0 >= 70 && line.x0 <= 90, `the ${sizes[i]}px line starts at ${line.x0}`);
  });
  // A checkerboard and flat color have no text.
  const board = new Uint8Array(400 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) board[y * 400 + x] = ((x >> 4) + (y >> 4)) % 2 ? 230 : 30;
  assert.deepEqual(textLines(board, 400, 200), []);
  assert.deepEqual(textLines(new Uint8Array(400 * 200).fill(128), 400, 200), []);
});

test('small text follows the rules of check: hard to read, small on a phone, too small for a player', () => {
  const frames = [
    { t: 0, blank: false, lines: [{ size: 12, box: [10, 10, 100, 20] }, { size: 40, box: [10, 50, 300, 80] }] },
    { t: 1, blank: false, lines: [{ size: 10, box: [10, 10, 100, 18] }] },
    { t: 2, blank: false, lines: [] },
    { t: 3, blank: false, lines: [{ size: 30, box: [10, 10, 200, 40] }] },
  ];
  // Wide 1920x1080: under 24px is hard to read, and nothing is just small on a phone.
  const wide = smallText(frames, { width: 1920, height: 1080 });
  assert.deepEqual(wide.map((s) => [s.kind, s.from, s.to, s.size, s.at]), [['small', 0, 1, 10, 1]]);
  // Tall 1080x1920: 24 to 39px is small on a phone.
  const tall = smallText(frames, { width: 1080, height: 1920 });
  assert.deepEqual(tall.map((s) => [s.kind, s.from, s.to, s.size]), [['small', 0, 1, 10], ['phone', 3, 3, 30]]);
  // A 960px player halves a 1920px frame, so text under 32px is under 16px there.
  const player = smallText(frames, { width: 1920, height: 1080, viewWidth: 960 }).filter((s) => s.kind === 'player');
  assert.deepEqual(player.map((s) => [s.from, s.to, s.shown]), [[0, 1, 5], [3, 3, 15]]);
  assert.equal(frameStep(30), 1);
  assert.equal(frameStep(600), 5);
});

test('check reads small text from the frames of any video, wide or tall, and with a player width', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const wide = await checkVideo(await textVideo(dir, 'wide.mp4', 'null', 4));
  const small = wide.text.small.filter((s) => s.kind === 'small');
  assert.equal(small.length, 1);
  assert.equal(small[0].from, 0);
  assert.equal(small[0].to, 3);
  assert.ok(small[0].size >= 8 && small[0].size <= 13, `smallest ${small[0].size}`);
  assert.equal(small[0].limit, 16);
  assert.ok(!wide.text.small.some((s) => s.kind === 'phone'), 'a wide video has no phone rule');
  const issue = wide.issues.find((i) => i.message.startsWith('small text'));
  assert.equal(issue.level, 'warn');
  assert.equal(small[0].lines, 2);
  assert.match(issue.message, /^small text from 0\.0s to 3\.0s: 2 lines, and the smallest at \d+,\d+ to \d+,\d+ is about \d+px tall at \d\.0s, hard to read \(use at least 16px\)$/);
  // The picture holds still the whole time, which is a hint, and the tone isn't silence.
  assert.ok(wide.issues.some((i) => i.level === 'hint' && /^the picture stands still from 0\.0s/.test(i.message)));
  assert.deepEqual(wide.silences, []);
  assert.equal(wide.passed, true);

  // The same text in a tall frame: 20px is small on a phone there, and 30px reads.
  const tall = await checkVideo(await textVideo(dir, 'tall.mp4', 'crop=720:720:0:0,pad=720:1280:0:280:0xf3f4f8'));
  const phone = tall.text.small.find((s) => s.kind === 'phone');
  assert.ok(phone, 'a phone hint');
  assert.equal(phone.limit, 27);
  assert.ok(phone.size >= 17 && phone.size < 27, `phone ${phone.size}`);
  assert.equal(tall.issues.find((i) => i.message.includes('small on a phone')).level, 'hint');

  const player = await checkVideo(path.join(dir, 'wide.mp4'), { viewWidth: 640 });
  const shown = player.text.small.find((s) => s.kind === 'player');
  assert.ok(shown.shown < 8, `shown ${shown.shown}`);
  assert.match(player.issues.find((i) => i.message.includes('wide player')).message, /shows about [\d.]+px tall at \d\.0s in a 640px wide player, too small there \(aim for at least 16px\)/);
});

test('check finds black, blank and frozen stretches, silence, loudness and clipping in any video', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'parts.mp4');
  await ffmpeg(['-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=5:r=25',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=4',
    '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v];[3]volume=0.4[s];[s][4]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', file]);
  const r = await checkVideo(file);
  assert.equal(r.blackSegments.length, 1);
  assert.ok(r.blackSegments[0][0] < 0.1 && Math.abs(r.blackSegments[0][1] - 1) < 0.1);
  // The white stretch is blank, and still. The black one counts once, as black.
  assert.equal(r.blankSegments.length, 1);
  assert.ok(Math.abs(r.blankSegments[0][0] - 1) <= 1 && r.blankSegments[0][1] >= 2.9, JSON.stringify(r.blankSegments));
  assert.ok(r.issues.some((i) => i.level === 'warn' && /^blank frames, all one color, from/.test(i.message)));
  assert.ok(!r.frozen.some(([s]) => s < 2.5), JSON.stringify(r.frozen));
  // Four seconds of silence at the end.
  assert.equal(r.silences.length, 1);
  assert.ok(Math.abs(r.silences[0][0] - 4) < 0.2);
  assert.ok(r.issues.some((i) => i.level === 'hint' && /^near silence from 4\.\ds to 8\.0s/.test(i.message)));
  // The tone is far louder than -14 LUFS.
  assert.match(r.issues.find((i) => i.message.startsWith('loudness')).message, /^loudness is -?[\d.]+ LUFS, target is -14\. YouTube, TikTok and Instagram play videos at about -14 LUFS\.$/);
  assert.equal(r.passed, true);
  assert.match(formatVideoCheck(r), /^.*parts\.mp4: 8(\.\d+)?s, 320x180, loudness .* LUFS, true peak -[\d.]+ dBTP\nread 8 frames, 1 s apart, for blank frames and small text\n/);

  // A tone driven past full scale clips, which fails.
  const loud = path.join(dir, 'loud.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', '-af', 'volume=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', path.join(dir, 'loud.mov')]);
  await ffmpeg(['-loglevel', 'error', '-i', path.join(dir, 'loud.mov'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', loud]);
  const clipped = await checkVideo(loud);
  assert.equal(clipped.passed, false);
  assert.match(clipped.issues[0].message, /^the true peak is \+[\d.]+ dBTP, above 0 dBTP, so the sound is clipping\. Lower the sound by \d+ dB or more, or put a limiter on it\.$/);

  // A video without sound passes, with a warning.
  const mute = path.join(dir, 'mute.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=2:r=25', '-pix_fmt', 'yuv420p', mute]);
  const silent = await checkVideo(mute);
  assert.equal(silent.audio, null);
  assert.ok(silent.issues.some((i) => i.level === 'warn' && i.message === 'the file has no sound'));
  assert.equal(silent.passed, true);
});

test('with a script, check compares the speech of the video with it', { timeout: 60000 }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'talk.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=3:r=25', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  const script = path.join(dir, 'script.md');
  fs.writeFileSync(script, '# Talk\n\n## intro\nWe check the {API|A P I} key.\n\n## end\nThat is all.\n');
  const plain = path.join(dir, 'script.txt');
  fs.writeFileSync(plain, 'We check the API key.\nThat is all.\n');
  assert.deepEqual(scriptWords(script).map((w) => w.spoken), ['We', 'check', 'the', 'A P I', 'key.', 'That', 'is', 'all.']);
  assert.deepEqual(scriptWords(plain).map((w) => w.display), ['We', 'check', 'the', 'API', 'key.', 'That', 'is', 'all.']);
  const says = (text) => async () => ({ text, words: text.split(' ').map((w, i) => ({ text: w, start: i * 0.3, end: i * 0.3 + 0.25 })) });
  const good = await checkVideo(file, { script, transcribe: says('We check the API key. That is all.') });
  assert.equal(good.speech.matchRate, 1);
  assert.ok(!good.issues.some((i) => /could not confirm|was understood/.test(i.message)));
  const bad = await checkVideo(file, { script: plain, transcribe: says('We chop the API. That is fine.') });
  assert.deepEqual(bad.speech.unconfirmed.map((u) => u.word), ['check', 'key', 'all']);
  assert.match(bad.issues.find((i) => i.message.includes('could not confirm')).message, /^the speech check could not confirm 3 words in the video: "check" at 0\.3 s/);
  assert.match(bad.issues.find((i) => i.message.includes('was understood')).message, /^only 63% of script\.txt was understood in the video\./);
  await assert.rejects(checkVideo(file, { script: path.join(dir, 'nope.txt') }), /nope\.txt does not exist/);
});

test('check and verify take a video file on the command line', { timeout: 120000 }, async (t) => {
  const dir = tempDir(t);
  const file = await textVideo(dir, 'clip.mp4', 'null', 2);
  const json = await runCli(['check', file, '--json']);
  assert.equal(json.code, 0, json.text);
  const r = JSON.parse(json.stdout);
  assert.equal(r.verdict, 'passed with 2 warnings');
  assert.equal(r.text.small[0].kind, 'small');
  const human = await runCli(['verify', file, '--quiet']);
  assert.equal(human.code, 0, human.text);
  assert.match(human.stdout, /clip\.mp4: 2s, 1280x720, loudness -[\d.]+ LUFS, true peak -[\d.]+ dBTP\nread 2 frames, 1 s apart, for blank frames and small text\nWARN  loudness is .*\nWARN  small text from 0\.0s to 1\.0s: 2 lines, and the smallest .*\npassed with 2 warnings\n$/);
  const flag = await runCli(['check', file, '--size', 'tiktok']);
  assert.equal(flag.code, 1);
  assert.match(flag.stderr, /--size works with a project\. For a video file, check takes --script, --language, --view-width, --step, --json\./);
  const missing = await runCli(['verify', path.join(dir, 'nope.mp4')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /nope\.mp4 does not exist/);
});
