import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../src/cli.js';
import { ASR_MODEL, TTS_MODEL, cacheRoot } from '../src/models.js';

// Run the CLI in-process and collect what it wrote to stderr.
async function run(args) {
  const write = process.stderr.write;
  let err = '';
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    const code = await main(args);
    return { code, err };
  } finally {
    process.stderr.write = write;
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-cli-'));
}

// The real command line in its own process: { code, out, err }.
async function runAll(args) {
  const { runCli } = await import('./helpers/tiny-project.js');
  const r = await runCli(args);
  return { code: r.code, out: r.stdout, err: r.stderr };
}

const hasModels = [TTS_MODEL, ASR_MODEL].every((m) => fs.existsSync(path.join(cacheRoot(), 'models', m)));

test('init rejects an unknown theme and creates no folder', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--theme', 'nope']);
  assert.equal(r.code, 1);
  assert.match(r.err, /theme must be one of/);
  assert.equal(fs.existsSync(target), false);
});

test('init rejects a bad pace without leaving a folder behind', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--pace', 'fast']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--pace must be a number/);
  assert.equal(fs.existsSync(target), false);
});

test('init names a text flag that was given without a value', async () => {
  const base = tempDir();
  const target = path.join(base, 'video');
  const r = await run(['init', target, '--title']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--title needs a value/);
  assert.equal(fs.existsSync(target), false);
});

test('a numeric flag without a value is an error, not 1', async () => {
  const base = tempDir();
  const r = await run(['init', path.join(base, 'video'), '--pace']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--pace needs a value/);
});

test('init with valid settings writes video.json and the starter files', async () => {
  const base = tempDir();
  const target = path.join(base, 'my-first-video');
  const r = await run(['init', target, '--theme', 'clean', '--pace', '1.2']);
  assert.equal(r.code, 0);
  const config = JSON.parse(fs.readFileSync(path.join(target, 'video.json'), 'utf8'));
  assert.equal(config.theme, 'clean');
  assert.equal(config.pace, 1.2);
  assert.equal(config.title, 'My first video');
  assert.ok(fs.existsSync(path.join(target, 'assets')));
  assert.ok(fs.existsSync(path.join(target, 'script.md')));
  assert.deepEqual(fs.readFileSync(path.join(target, '.gitignore'), 'utf8').trim().split('\n'), ['build/', 'out/', '.env', 'history/private/']);
});

test('render rejects bad formats, mismatched extensions and missing text flags before building', async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), '{}');
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) {} };');
    for (const [flags, message] of [
      [['--format', 'avi'], /mp4, gif, webm or mov/],
      [['--transparent'], /--format webm or --format mov/],
      [['--transparent', '--format', 'gif'], /--format webm or --format mov/],
      [['--format', 'webm', '--out', 'file.mp4'], /must end in .webm/],
      [['--format', 'mov', '--out', 'file.webm'], /must end in .mov/],
      [['--out', 'file.gif'], /must end in .mp4/],
      [['--format', 'gif', '--out', 'file.mp4'], /must end in .gif/],
      [['--format'], /--format needs a value/],
      [['--out'], /--out needs a value/],
    ]) {
      const r = await run(['render', dir, ...flags]);
      assert.equal(r.code, 1);
      assert.match(r.err, message);
      assert.equal(fs.existsSync(path.join(dir, 'build')), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('size overrides reject missing values and invalid sizes before building for all five commands', async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), '{}');
    fs.writeFileSync(path.join(dir, 'script.md'), '## intro\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro(s) {} };');
    for (const command of ['render', 'still', 'sheet', 'check', 'preview']) {
      for (const [flags, message] of [
        [['--size'], /--size needs a value/],
        [['--size', 'bad'], /size must be/],
        [['--size', '1081x1350'], /even numbers/],
      ]) {
        const r = await run([command, dir, ...flags]);
        assert.equal(r.code, 1, command);
        assert.match(r.err, message);
        assert.equal(fs.existsSync(path.join(dir, 'build')), false);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// One icon per line, with the words it is found by after it, so that a tag never
// reads as another icon. A word with no match gets up to five close names, and
// the other ways to show it.
test('icons prints one match per line, and close names when nothing matches', () => {
  const bin = new URL('../bin/explainroo.js', import.meta.url).pathname;
  const icons = (...args) => spawnSync(process.execPath, [bin, 'icons', ...args], { encoding: 'utf8' });
  const one = icons('anchor');
  assert.equal(one.status, 0);
  assert.equal(one.stdout, '1 icon matches "anchor":\n  anchor  (also found by: ship)\n');
  const many = icons('cloud');
  const [head, ...rows] = many.stdout.trimEnd().split('\n');
  assert.match(head, /^\d+ icons match "cloud", best first:$/);
  assert.equal(rows[0], '  cloud  (also found by: weather)');
  for (const row of rows) assert.match(row, /^ {2}[a-z0-9-]+(?: {2}\(also found by: [^)]+\))?$/);
  assert.deepEqual(JSON.parse(icons('anchor', '--json').stdout), { icons: ['anchor'] });
  const none = icons('zzqx');
  assert.equal(none.status, 0);
  const close = JSON.parse(icons('zzqx', '--json').stdout);
  assert.deepEqual(close.icons, []);
  assert.ok(close.close.length > 0 && close.close.length <= 5);
  assert.equal(none.stdout, `no icon matches "zzqx". Close names: ${close.close.join(', ')}\nNo icon shows it. Draw it with s.draw, or make a picture with "explainroo image", which costs money.\n`);
  // A word that is only inside other names, like "bee" in "beef" and "beer", is no match either.
  const bee = icons('bee');
  assert.match(bee.stdout, /^no icon matches "bee"\. Close names: beef, [a-z, -]+\nNo icon shows it\. Draw it with s\.draw, or make a picture with "explainroo image", which costs money\.\n$/);
  assert.deepEqual(JSON.parse(icons('bee', '--json').stdout).icons, []);
  // A tag counts as a match.
  assert.match(icons('ship').stdout, /^\d+ icons? match(es)? "ship"/);
  // More than 40 matches name how many there are.
  assert.match(icons('arrow').stdout, /^\d+ icons match "arrow"\. These are the 40 best:\n/);
});

// A new project starts neutral: the same scene names in script.md and scenes.js,
// built on s.safe, the title and one placeholder line per scene, and the
// defaults of this version. voice and check run on it as it is.
test('init writes a neutral starter whose scenes match, with "defaults", and says to write script.md and run voice next', async (t) => {
  const base = tempDir();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, 'bees');
  const r = await runAll(['init', target, '--title', 'How Bees Make Honey']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^next: write the narration in script\.md, then run ".+ voice .+bees"\. After that, draw each scene in scenes\.js and run ".+ check .+bees"\.$/m);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'video.json'), 'utf8')).defaults, '0.5');
  const script = fs.readFileSync(path.join(target, 'script.md'), 'utf8');
  const scenes = fs.readFileSync(path.join(target, 'scenes.js'), 'utf8');
  const { parseScript } = await import('../src/script.js');
  const ids = parseScript(script).scenes.map((s) => s.id);
  const mod = await import(`file://${path.join(target, 'scenes.js')}`);
  assert.deepEqual(Object.keys(mod.default), ids);
  assert.match(scenes, /s\.title\('How Bees Make Honey'/);
  assert.match(scenes, /s\.safe/);
  assert.match(scenes, /s\.portrait/);
  // No pixel sizes written as numbers, and nothing about a topic.
  assert.doesNotMatch(scenes, /size: \d/);
  assert.doesNotMatch(script + scenes, /browser|server|click|link|mouse/i);
});

test('init followed by voice and check gives no errors', { skip: !hasModels && 'the voice and speech check models are not downloaded', timeout: 300000 }, async (t) => {
  const base = tempDir();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, 'starter');
  assert.equal((await run(['init', target, '--title', 'How Bees Make Honey'])).code, 0);
  const voice = await runAll(['voice', target]);
  assert.equal(voice.code, 0, voice.err);
  const checked = await runAll(['check', target, '--json']);
  assert.equal(checked.code, 0, checked.err);
  assert.deepEqual(JSON.parse(checked.out).issues.filter((i) => i.level === 'error'), []);
});

test('a scene without a function lists every such scene of script.md with a stub to paste', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', music: false, sfx: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## hook {min=1}\n## prompt {min=1}\n## outro-2 {min=1}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { hook(s) {}, steps(s) {} };');
  const r = await runAll(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /scenes\.js has no function for the scenes "prompt", "outro-2" of script\.md\. scenes\.js has "steps", which no scene in script\.md uses\. Rename it, or add these to the object that scenes\.js exports:\n {2}prompt\(s\) \{\n {4}s\.text\('prompt', \{ y: s\.safe\.top \+ s\.safe\.h \/ 2, at: 0 \}\);\n {2}\},\n {2}"outro-2"\(s\) \{/);
});

// Each command has help of its own, and "help <command>" prints the same.
test('every command prints its own usage, options and one example with --help', async (t) => {
  const { COMMAND_HELP } = await import('../src/help.js');
  const source = fs.readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  const cases = [...source.matchAll(/^ {6}case '([a-z]+)':/gm)].map((m) => m[1]);
  assert.deepEqual(cases.filter((c) => !Object.hasOwn(COMMAND_HELP, c)), [], 'every command has help');
  const still = await runAll(['still', '--help']);
  assert.equal(still.code, 0);
  assert.match(still.out, /^Usage: explainroo still \[project\] \[time…\] \[options\]\n\nWrites PNG stills/);
  assert.match(still.out, /^ {2}--platform <name> {2}the size, its block in "sizes" and the watermark rule that "package --platform <name>" uses$/m);
  assert.match(still.out, /^Example:\n {2}explainroo still videos\/how-dns-works intro@2\.4 resolver@end\n$/m);
  assert.equal((await runAll(['help', 'still'])).out, still.out);
  assert.match((await runAll(['words', '-h'])).out, /^Usage: explainroo words \[project\] \[scene\] \[options\]/);
  // Without a command, or with an unknown one, the general help.
  assert.match((await runAll(['--help'])).out, /^explainroo .*: narrated explainer videos from code\n/);
  assert.match((await runAll(['help', 'nothing'])).out, /"explainroo <command> --help" prints the options of one command and an example\./);
});

test('words prints each spoken word of a scene with its start time, the cue of a word spoken twice, and the markers, also in JSON', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  const { cachedVoice } = await import('./helpers/cached-voice.js');
  const dir = tinyProject(t, {}, { narrated: false });
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny\n\n## intro\nThe tank fills [#full] and fills again.\n\n## outro\nDone.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {}, outro() {} };');
  cachedVoice(dir, 'intro');
  cachedVoice(dir, 'outro');
  const r = await runAll(['words', dir, 'intro']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [
    "intro: 0.0 s to 1.8 s of the video. The times are seconds into the scene, as at: 'word' uses them.",
    '   0.00  The',
    '   0.30  tank',
    '   0.60  fills  (cue "fills#1")',
    '   0.90  [#full]',
    '   0.90  and',
    '   1.20  fills  (cue "fills#2")',
    '   1.50  again.  (cue "again")',
    '',
  ].join('\n'));
  const json = JSON.parse((await runAll(['words', dir, '--json'])).out);
  assert.deepEqual(json.scenes.map((s) => s.scene), ['intro', 'outro']);
  assert.deepEqual(json.scenes[0].words[2], { text: 'fills', start: 0.6, end: 0.84, cue: 'fills#1' });
  assert.deepEqual(json.scenes[0].marks, { full: 0.9 });
  const wrong = await runAll(['words', dir, 'middle']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /there is no scene "middle" in script\.md\. Its scenes are: intro, outro/);
});

test('--platform on check, still, sheet and render takes the size and the watermark rule its package uses', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  const dir = tinyProject(t, { size: '16:9', sizes: { tiktok: { captions: false } } }, { narrated: false });
  const tiktok = await runAll(['check', dir, '--platform', 'tiktok', '--json']);
  assert.equal(tiktok.code, 0, tiktok.err);
  const still = JSON.parse((await runAll(['still', dir, 'intro@end', '--platform', 'tiktok', '--json'])).out);
  assert.match(still.stills[0].file, /out\/stills-tiktok-no-watermark\/intro@end\.png$/);
  // A 16:9 project is already the YouTube setup, so its normal stills are the package's.
  const youtube = JSON.parse((await runAll(['still', dir, 'intro@end', '--platform', 'youtube', '--json'])).out);
  assert.match(youtube.stills[0].file, /out\/stills\/intro@end\.png$/);
  for (const [args, message] of [
    [['--platform', 'myspace'], /there is no platform "myspace"\. The platforms are youtube, shorts, tiktok, reels, linkedin and x\./],
    [['--platform', 'tiktok', '--no-watermark'], /--platform tiktok sets the watermark the way its package does, so leave out --no-watermark/],
    [['--platform', 'tiktok', '--size', 'square'], /--size works only with --platform x/],
  ]) {
    const r = await runAll(['check', dir, ...args]);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, message);
  }
});
