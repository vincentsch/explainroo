import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../src/cli.js';
import { loadProject, THEME_MUSIC } from '../src/project.js';
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
  assert.deepEqual(fs.readFileSync(path.join(target, '.gitignore'), 'utf8').trim().split('\n'), ['build/', 'out/', '.env', 'history/private/', 'history/locks/']);
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
  assert.equal(one.stdout, '1 icon matches "anchor":\n  anchor  (exact name; also found by: ship)\n');
  const many = icons('cloud');
  const [head, ...rows] = many.stdout.trimEnd().split('\n');
  assert.match(head, /^\d+ icons match "cloud", best first:$/);
  assert.equal(rows[0], '  cloud  (exact name; also found by: weather)');
  for (const row of rows.slice(1)) assert.match(row, /^ {2}[a-z0-9-]+(?: {2}\(also found by: [^)]+\))?$/);
  assert.deepEqual(JSON.parse(icons('anchor', '--json').stdout), { icons: ['anchor'], exact: 'anchor' });
  // The icon named exactly the word comes first, also when other names hold it too.
  const music = icons('music').stdout.trimEnd().split('\n');
  assert.match(music[1], /^ {2}music {2}\(exact name(; also found by: [^)]+)?\)$/);
  assert.ok(music.slice(2).some((row) => row.startsWith('  keyboard-music')));
  assert.equal(JSON.parse(icons('arrow', 'right', '--json').stdout).exact, 'arrow-right');
  assert.equal(JSON.parse(icons('ship', '--json').stdout).exact, 'ship');
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

test('icons with several words lists the matches of each word, and words that name one icon stay one search', () => {
  const bin = new URL('../bin/explainroo.js', import.meta.url).pathname;
  const icons = (...args) => spawnSync(process.execPath, [bin, 'icons', ...args], { encoding: 'utf8' });
  const r = icons('lock', 'key', 'zzqx');
  assert.equal(r.status, 0);
  const parts = r.stdout.trimEnd().split('\n\n');
  assert.equal(parts.length, 3);
  assert.match(parts[0], /^\d+ icons match "lock"\. These are the 10 best:\n {2}lock {2}\(exact name/);
  assert.match(parts[1], /^\d+ icons match "key"\. These are the 10 best:\n {2}key {2}\(exact name/);
  assert.match(parts[2], /^no icon matches "zzqx"\. Close names: /);
  const json = JSON.parse(icons('lock', 'key', '--json').stdout);
  assert.deepEqual(json.words.map((w) => [w.word, w.exact, w.icons.length]), [['lock', 'lock', 10], ['key', 'key', 10]]);
  assert.equal(JSON.parse(icons('arrow', 'right', '--json').stdout).exact, 'arrow-right');
});

test('an unknown command names the docs topic of that name, or the closest command', () => {
  const bin = new URL('../bin/explainroo.js', import.meta.url).pathname;
  const run = (word) => spawnSync(process.execPath, [bin, word], { encoding: 'utf8' });
  const topic = run('commands');
  assert.equal(topic.status, 2);
  assert.equal(topic.stderr, 'unknown command "commands". "commands" is a docs topic. Read it with: explainroo docs commands\n');
  assert.equal(run('rendr').stderr, 'unknown command "rendr". Did you mean "explainroo render"?\n');
  assert.equal(run('picture').stderr, 'unknown command "picture". Did you mean the docs topic "explainroo docs pictures"?\n');
  // Nothing close: the list of commands.
  assert.match(run('xyzzy').stderr, /^unknown command "xyzzy"\n\nexplainroo /);
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
  // One line says what the "defaults" line is for, and where its changes are listed.
  assert.match(r.out, /^"defaults": "0\.6" in video\.json keeps this look when explainroo changes later\. ".+ docs settings defaults" lists what it changes\.$/m);
  assert.equal(r.out.match(/"defaults"/g).length, 1);
  const docs = await runAll(['docs', 'settings', 'defaults']);
  assert.equal(docs.code, 0, docs.err);
  assert.match(docs.out, /^## The defaults of a version\n\nThe `"defaults"` line keeps a video looking the same when you update\nexplainroo\./);
  assert.match(docs.out, /^`"0\.5"` changes these, and `"0\.6"` has them too:$/m);
  assert.match(docs.out, /^`"0\.6"` also changes these:$/m);
  const made = JSON.parse(fs.readFileSync(path.join(target, 'video.json'), 'utf8'));
  assert.equal(made.defaults, '0.6');
  assert.equal(made.theme, 'studio');
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
  assert.match(still.out, /^Usage: explainroo still \[project\] \[time…\] \[options\], or still <video\.mp4> \[seconds…\]\n\nWrites PNG stills/);
  assert.match(still.out, /^ {2}--platform <name> {2}the size, its block in "sizes" and the watermark rule that "package --platform <name>" uses$/m);
  assert.match(still.out, /^Example:\n {2}explainroo still videos\/how-dns-works intro@2\.4 resolver@end\n$/m);
  assert.equal((await runAll(['help', 'still'])).out, still.out);
  assert.match((await runAll(['words', '-h'])).out, /^Usage: explainroo words \[project\] \[scene…\] \[options\]/);
  // Without a command, or with an unknown one, the general help.
  assert.match((await runAll(['--help'])).out, /^explainroo .*: narrated explainer videos from code\n/);
  assert.match((await runAll(['help', 'nothing'])).out, /"explainroo <command> --help" prints the options of one command and an example\./);
});

// A flag a command doesn't take is an error that names its flags, and the
// closest one when it is only a typo away. Every flag the code reads stays taken.
test('every command refuses a flag it does not take, and takes every flag it reads', async () => {
  const { COMMAND_HELP, commandFlags } = await import('../src/help.js');
  const source = fs.readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  const reads = (text) => [...text.matchAll(/flags\.([a-z]+)\b|flags\['([a-z-]+)'\]|(?:textFlag|num)\(flags(?:, |\.|\[')'?([a-z-]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  // What the helpers a command calls read.
  const body = (name) => source.slice(source.indexOf(`function ${name}(`)).split(/\n}\n/)[0];
  const helpers = ['runProject', 'runOverrides', 'langOverride', 'qualityOverride', 'timesFlag', 'init', 'preview', 'say', 'docs', 'services', 'formats'];
  const blocks = source.split(/^ {6}case '/m).slice(1).map((b) => [b.slice(0, b.indexOf("'")), b.split(/^ {6}default:/m)[0]]);
  for (const [cmd, block] of blocks) {
    if (cmd === 'connect') continue;
    const read = new Set(reads(block).filter((f) => !['help', 'json', 'quiet', 'version'].includes(f)));
    for (const name of helpers) if (block.includes(`${name}(`)) for (const f of reads(body(name))) read.add(f);
    if (block.includes('runProject(')) for (const f of reads(body('runOverrides'))) read.add(f);
    // check and verify read the flags of a video file in videoFileCheck.
    const takes = commandFlags(cmd);
    assert.deepEqual([...read].filter((f) => f !== 'flag' && !takes.includes(f)), [], `${cmd} takes every flag it reads`);
  }
  assert.ok(Object.keys(COMMAND_HELP).length > 25);

  const dir = tempDir();
  const still = await runAll(['still', dir, '--at', 'demo@2']);
  assert.equal(still.code, 1);
  assert.equal(still.out, '');
  assert.match(still.err, /^error: still does not take --at\. It takes --size, --platform, --no-watermark, --transparent, --scale, --lang, --json\. Times go after the project, like: explainroo still videos\/<name> intro@2\.4\n$/);
  assert.match((await run(['render', dir, '--sacle', '0.5'])).err, /^error: render does not take --sacle\. Did you mean --scale\? It takes --draft, /);
  assert.match((await run(['sheet', dir, '--time=3'])).err, /Did you mean --times\?/);
  assert.match((await run(['images', dir, '--all'])).err, /^error: images does not take --all\. It takes only --json\.\n$/);
  // A flag only a video file takes is named as such with a project.
  assert.match((await run(['check', dir, '--script', 'a.txt'])).err, /--script is for a video file, like: explainroo check video\.mp4 --script script\.txt\./);
  // The older flag of a paid voice list still takes no value.
  const { CONNECTORS } = await import('../src/connectors/index.js');
  const paid = CONNECTORS.find((c) => c.voices).id;
  assert.ok(commandFlags('voices').includes(paid));
  // The checks come before anything else, also before a project is loaded.
  assert.equal(fs.readdirSync(dir).length, 0);
});

// A word a command would ignore stops it with its usage, before anything runs.
// Commands that take a list keep taking it.
test('a command that takes a fixed number of words stops on one more, and sheet names its scenes', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  const dir = tinyProject(t, {}, { narrated: false });
  const render = await run(['render', dir, 'final']);
  assert.equal(render.code, 1);
  assert.equal(render.err, 'error: render takes one project, so it would ignore "final". Usage: explainroo render [project] [options]\n');
  assert.match((await run(['sheet', dir, 'intro', 'outro'])).err, /^error: sheet takes a project and a scene, so it would ignore "outro"\. Usage: explainroo sheet \[project\] \[scene\] \[options\], or sheet <video\.mp4> \[options\]\n$/);
  assert.match((await run(['themes', 'dark', 'light'])).err, /^error: themes takes no words, so it would ignore "dark" and "light"\./);
  assert.match((await run(['verify', dir, 'twice'])).err, /verify takes one project or one video file/);
  assert.match((await run(['init', path.join(dir, 'a'), 'b'])).err, /init takes one folder, so it would ignore "b"/);
  // An unknown scene names the scenes, before any narration is made.
  const nosuch = await run(['sheet', dir, 'nosuch']);
  assert.equal(nosuch.code, 1);
  assert.match(nosuch.err, /^error: there is no scene "nosuch" in script\.md\. Its scenes are: intro\n$/);
  assert.match((await run(['sheet', dir, 'intro', '--scene', 'outro'])).err, /the scene is named twice, as "intro" and with --scene outro\. Leave out one of them\./);
  assert.equal(fs.existsSync(path.join(dir, 'build')), false);
  // Lists stay lists.
  const { extraWords } = await import('../src/cli.js');
  for (const cmd of ['still', 'words', 'icons', 'say', 'docs', 'image']) assert.equal(extraWords(cmd, ['a', 'b', 'c', 'd']), null);
});

test('record --inspect takes a project or none and an address, and --viewport, --all, --text, --selector and --locale go only with it', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  const dir = tinyProject(t, {}, { narrated: false });
  assert.match((await run(['record', dir, 'demo', '--inspect', 'http://127.0.0.1:9/'])).err, /usage: explainroo record \[project\] --inspect <url> \[--all\] \[--text "<words>"\] \[--selector "<css>"\] \[--viewport 1280x720\] \[--locale en-US\]/);
  assert.match((await run(['record', dir, '--inspect', 'http://127.0.0.1:9/', '--all', '--selector', 'td'])).err, /--selector says only what that selector matches, so leave out --all/);
  assert.match((await run(['record', dir, 'demo', '--selector', 'td'])).err, /--selector goes with --inspect <url>, which lists what is on a page\./);
  assert.match((await run(['record', dir, 'demo', '--locale', 'de-DE'])).err, /--locale goes with --inspect <url>, which lists what is on a page\. A recording takes its locale from the project's language, or from "locale" in recordings\/<name>\.json\./);
  assert.match((await run(['record', '--inspect', 'http://127.0.0.1:9/', '--locale', 'German'])).err, /--locale must be a language tag like en-US or de-DE/);
  assert.match((await run(['record', '--inspect', 'http://127.0.0.1:9/', '--keep-profile'])).err, /--keep-profile opens the page with the kept profile of a project, so put the project folder first/);
  assert.match((await run(['record', dir, '--inspect', 'http://127.0.0.1:9/', '--all', '--text', 'Total'])).err, /--text lists only the elements that hold its words, so leave out --all/);
  assert.match((await run(['record', dir, '--inspect', 'http://127.0.0.1:9/', '--text'])).err, /--text needs a value/);
  assert.match((await run(['record', dir, 'demo', '--all'])).err, /--all goes with --inspect <url>, which lists what is on a page\./);
  assert.match((await run(['record', dir, '--inspect'])).err, /--inspect needs a value/);
  assert.match((await run(['record', dir, '--inspect', 'ftp://example.com/'])).err, /--inspect must be an http:\/\/ or https:\/\/ address/);
  assert.match((await run(['record', dir, '--inspect', 'http://127.0.0.1:9/', '--viewport', 'big'])).err, /--viewport must be like 1280x720/);
  assert.match((await run(['record', dir, '--inspect', 'http://127.0.0.1:9/', '--viewport', '1281x720'])).err, /--viewport width must be an even number of pixels from 320 to 3840/);
  assert.match((await run(['record', dir, 'demo', '--viewport', '1280x720'])).err, /--viewport goes with --inspect\. A recording takes its viewport from recordings\/<name>\.json\./);
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
  // A start the speech check estimated has a ~, and "estimated" in JSON.
  const { voicePaths } = await import('../src/voice.js');
  const file = voicePaths(loadProject(dir), 'intro').json;
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  info.words[3].estimated = true;
  fs.writeFileSync(file, JSON.stringify(info));
  const marked = (await runAll(['words', dir, 'intro'])).out;
  assert.match(marked, /^ {3}0\.90~ and$/m);
  assert.match(marked, /^ {3}0\.60  fills {2}\(cue "fills#1"\)$/m);
  assert.match(marked, /^ {2}~ estimated: the speech check heard no start of its own for this word, so a cue on it may land a little early or late$/m);
  assert.deepEqual(JSON.parse((await runAll(['words', dir, 'intro', '--json'])).out).scenes[0].words[3], { text: 'and', start: 0.9, end: 1.14, cue: 'and', estimated: true });
  const wrong = await runAll(['words', dir, 'middle']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /there is no scene "middle" in script\.md\. Its scenes are: intro, outro/);
});

// "%" has no letters or digits, so it takes the cue of the number before it,
// and never an empty cue or one that looks like a marker. A word shown with a
// space keeps it out of its cue, which a cue reads as two words.
test('words gives a symbol the cue of the word or number it follows', async (t) => {
  const { tinyProject } = await import('./helpers/tiny-project.js');
  const { cachedVoice } = await import('./helpers/cached-voice.js');
  const dir = tinyProject(t, { language: 'fr', voice: 'ff_siwis' }, { narrated: false });
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny\n\n## intro\nÀ 5 % par an, puis à 5 %. Soit {52,50 €|cinquante-deux euros cinquante}.\n');
  cachedVoice(dir, 'intro');
  const json = JSON.parse((await runAll(['words', dir, '--json'])).out);
  const cues = json.scenes[0].words.map((w) => [w.text, w.cue]);
  assert.deepEqual(cues, [['À', 'À#1'], ['5', '5#1'], ['%', '5#1'], ['par', 'par'], ['an,', 'an'], ['puis', 'puis'], ['à', 'à#2'], ['5', '5#2'], ['%.', '5#2'], ['Soit', 'Soit'], ['52,50 €.', '52,50€']]);
  assert.ok(json.scenes[0].words.every((w) => w.cue && !w.cue.startsWith('#')));
  assert.match((await runAll(['words', dir])).out, /^ {3}\d\.\d\d {2}%\. {2}\(cue "5#2"\)$/m);
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

test('voice --estimate prints the estimate with the target advice and makes nothing', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ targetSeconds: 5 }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## a\nThe resolver asks the root servers where the name lives. Then it asks again.\n\n## b\nIt keeps the answer for a while.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a() {}, b() {} };');
  const r = await runAll(['voice', dir, '--estimate']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^about \d+ s \(\d+ to \d+ s\): 21 words of speech at about \d+ a minute take \d+\.\d s\. The 2 scenes add 1\.05 s each for their lead and hold, and the pauses between sentences add 0\.3 s\. The end of the video adds 1\.4 s\. That is about \d+ s over targetSeconds 5, so cut about \d+ words\.\nNothing was made\.\n$/);
  const json = JSON.parse((await runAll(['voice', dir, '--estimate', '--json'])).out);
  assert.deepEqual([json.estimate.words, json.estimate.scenes, json.estimate.targetSeconds], [21, 2, 5]);
  assert.equal(fs.existsSync(path.join(dir, 'build')), false, 'no voice was made');
  assert.equal(r.err, '', 'no model was loaded');
});

test('voice --estimate gives a hint for chapters that will likely be under 10 seconds in a video for YouTube', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const long = 'The resolver asks the root servers where the name lives, and then it asks the servers of the top level domain, and then the servers of the domain itself. '.repeat(2);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '16:9' }));
  fs.writeFileSync(path.join(dir, 'script.md'), `# DNS\n\n## a {chapter="The question"}\nYou type a name.\n\n## b {chapter="The answer"}\n${long}\n\n## c {chapter="The cache"}\n${long}\n`);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a() {}, b() {}, c() {} };');
  const r = await runAll(['voice', dir, '--estimate']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\nHINT  chapter "The question" will likely last about \d+s, and YouTube shows chapters only when each lasts at least 10 seconds\. Start it at another scene or join it with the next one\.\nNothing was made\.\n$/);
  assert.doesNotMatch(r.out, /"The answer"|"The cache"/);
  const json = JSON.parse((await runAll(['voice', dir, '--estimate', '--json'])).out);
  assert.deepEqual(json.notes.map((n) => [n.level, n.scene]), [['hint', 'a']]);
  assert.deepEqual(Object.keys(json.estimate.sceneSeconds), ['a', 'b', 'c']);
  // A tall video has no YouTube chapters, so it gets no hint.
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: 'shorts' }));
  assert.doesNotMatch((await runAll(['voice', dir, '--estimate'])).out, /HINT/);
});

test('set writes one setting into video.json, dotted keys reach into blocks, null takes a key out, and the rest of the file stays as it was', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## a\nHello there.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a() {} };');
  const file = path.join(dir, 'video.json');
  fs.writeFileSync(file, '{\n  "title": "Bees",\n  "theme": "paper",\n  "music": true\n}\n');
  const set = async (...args) => runAll(['set', dir, ...args]);
  for (const [key, value, said] of [
    ['targetSeconds', '40', 'set targetSeconds to the number 40 in video.json'],
    ['targetSeconds', '40', 'kept targetSeconds at the number 40 in video.json'],
    ['cover', 'intro@2', 'set cover to the text "intro@2" in video.json'],
    ['sizes.shorts.pace', '1.15', 'set sizes.shorts.pace to the number 1.15 in video.json'],
    ['sizes.shorts.captions', 'bold', 'set sizes.shorts.captions to the text "bold" in video.json'],
    ['music', 'false', 'set music to false in video.json'],
    // Text needs no quotes.
    ['brand.accent', '#e8a24a', 'set brand.accent to the text "#e8a24a" in video.json'],
    ['clipBudget', '0.40', 'set clipBudget to the number 0.4 in video.json'],
    ['title', 'null', 'took title out of video.json'],
  ]) {
    const r = await set(key, value);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `${said}\n`);
  }
  // The keys keep their places, new ones come last, and so does the indentation.
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "theme": "paper",\n  "music": false,\n  "targetSeconds": 40,\n  "cover": "intro@2",\n  "sizes": {\n    "shorts": {\n      "pace": 1.15,\n      "captions": "bold"\n    }\n  },\n  "brand": {\n    "accent": "#e8a24a"\n  },\n  "clipBudget": 0.4\n}\n');
  // A whole block as JSON, and the JSON output.
  const json = JSON.parse((await set('sizes.tiktok', '{"captions": "bold", "pace": 1.2}', '--json')).out);
  assert.deepEqual([json.key, json.value, json.type, json.changed], ['sizes.tiktok', { captions: 'bold', pace: 1.2 }, 'block', true]);
  // A setting that changes its type says so.
  const retyped = JSON.parse((await set('music', '{"volume": 0.3}', '--json')).out);
  assert.deepEqual(retyped.retyped, { key: 'music', before: false, after: { volume: 0.3 } });
  assert.equal((await set('music', 'true')).out, 'set music to true in video.json. music was the block {"volume": 0.3} and is now true\n');
  // A file on one line, or indented with tabs, keeps that.
  fs.writeFileSync(file, '{"theme":"paper"}');
  await set('fps', '25');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"theme":"paper","fps":25}');
  fs.writeFileSync(file, '{\n\t"theme": "paper"\n}\n');
  await set('fps', '25');
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n\t"theme": "paper",\n\t"fps": 25\n}\n');
});

test('music.volume works without a style: set turns "music": true into a block, and the look keeps its own music', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## a\nHello there.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a() {} };');
  const file = path.join(dir, 'video.json');
  fs.writeFileSync(file, '{\n  "theme": "midnight",\n  "music": true\n}\n');
  const r = await runAll(['set', dir, 'music.volume', '0.35']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'set music.volume to the number 0.35 in video.json. music was true and is now the block {"volume": 0.35}, with the same music\n');
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "theme": "midnight",\n  "music": {\n    "volume": 0.35\n  }\n}\n');
  const { config } = loadProject(dir);
  assert.deepEqual([config.music.style, config.music.volume], [THEME_MUSIC.midnight, 0.35]);
  // A style written as text stays that style.
  fs.writeFileSync(file, '{\n  "theme": "midnight",\n  "music": "calm"\n}\n');
  assert.equal((await runAll(['set', dir, 'music.volume', '0.3'])).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).music, { style: 'calm', volume: 0.3 });
  // The docs name each look's own music.
  const docs = fs.readFileSync(new URL('../docs/music.md', import.meta.url), 'utf8');
  for (const [look, style] of Object.entries(THEME_MUSIC)) assert.match(docs, new RegExp(`\\| \`${look}\` \\| \`${style}\` \\|`), look);
});

test('set refuses an unknown key or a bad value with the check every command runs, and writes nothing', async (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## a\nHello there.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { a() {} };');
  const file = path.join(dir, 'video.json');
  const text = '{\n  "title": "Bees",\n  "targetSeconds": 40\n}\n';
  fs.writeFileSync(file, text);
  for (const [args, said] of [
    [['bogus', '1'], /^error: video\.json has unknown setting\(s\): bogus\. Known: title, /],
    [['targetSeconds', 'forty'], /^error: targetSeconds must be the length you want in seconds/],
    [['sizes.shorts.pace', '9'], /^error: sizes\.shorts: pace must be between 0\.7 and 1\.6/],
    [['sizes.shorts.voice', 'am_adam'], /^error: sizes\.shorts has setting\(s\) that can't be set for one size: voice\./],
    [['sizes.mystery.pace', '1.2'], /^error: sizes: "mystery" is not a size\./],
    [['title.text', 'x'], /^error: title is "Bees", not a block of settings, so it has no text\. Set title as a whole instead\.\n$/],
    [['__proto__.polluted', '1'], /^error: "__proto__\.polluted" is no setting\./],
    [['targetSeconds'], /^error: usage: explainroo set <project> <key> <value>/],
  ]) {
    const r = await runAll(['set', dir, ...args]);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, said, args.join(' '));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'nothing was written');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['scenes.js', 'script.md', 'video.json']);
});
