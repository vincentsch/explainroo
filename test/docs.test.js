import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, LANGUAGE_NAMES } from '../src/models.js';
import { SERVICES, needsKey } from '../src/services.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'explainroo.js');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const topics = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

test('the help names the docs command', () => {
  const { stdout } = run('--help');
  assert.match(stdout, /^Docs: .*explainroo docs/m);
  assert.match(stdout, /^ {2}docs \[topic\]/m);
});

test('docs prints AGENTS.md, and --json gives the text and the file', () => {
  const agents = path.join(root, 'AGENTS.md');
  const text = fs.readFileSync(agents, 'utf8');
  const r = run('docs');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${text.trimEnd()}\n`);
  assert.deepEqual(JSON.parse(run('docs', '--json').stdout), { topic: null, file: agents, text });
});

test('docs <topic> prints the page, and --json gives the text and the file', () => {
  assert.ok(topics.length >= 2);
  for (const topic of topics) {
    const file = path.join(root, 'docs', `${topic}.md`);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(run('docs', topic).stdout, `${text.trimEnd()}\n`);
    assert.deepEqual(JSON.parse(run('docs', topic, '--json').stdout), { topic, file, text });
  }
});

test('docs --list lists the topics', () => {
  assert.equal(run('docs', '--list').stdout, `${topics.join('\n')}\n`);
  assert.deepEqual(JSON.parse(run('docs', '--list', '--json').stdout), { topics });
  // The flag takes no value, so a word after it stays out of it.
  assert.equal(run('docs', '--list', topics[0]).stdout, `${topics.join('\n')}\n`);
});

test('an unknown topic is an error that lists the real ones, and a path is no topic', () => {
  for (const topic of ['nope', '../package', '../AGENTS', 'media']) {
    const r = run('docs', topic);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(`there is no docs topic "${topic}"`));
    for (const real of topics) assert.ok(r.stderr.includes(real));
  }
  const json = run('docs', 'nope', '--json');
  assert.equal(json.status, 1);
  assert.match(JSON.parse(json.stdout).error, /there is no docs topic/);
});

// The start page is what `explainroo docs` prints, and the skill carries it too.
// Agents' tools cut off a long page, so it stays short enough to read in one go,
// and the rest is one topic away. Each topic stays short enough to read whole.
const START_CEILING = 12000;
const TOPIC_CEILING = 24000;
// A Windows checkout may have CRLF line ends, and the checks read lines.
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const start = read('AGENTS.md');
const page = (topic) => read(`docs/${topic}.md`);
const oneLine = (text) => text.replace(/\s+/g, ' ');

// The parts of the start page: each "## " heading outside a fenced block, with
// the text up to the next one.
const parts = new Map();
{
  let fenced = false;
  let current = null;
  for (const line of start.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) parts.set(current = line.slice(3), []);
    else if (current) parts.get(current).push(line);
  }
}
function part(heading) {
  assert.ok(parts.has(heading), `the start page has no part "${heading}"`);
  return parts.get(heading).join('\n');
}

// The topics in the table at the end of the start page.
const listed = [...part('Topics').matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map((m) => m[1]);

test('the start page stays under 12,000 bytes, and every topic under 24,000', () => {
  const size = Buffer.byteLength(start);
  assert.ok(size < START_CEILING, `AGENTS.md is ${size} bytes. Keep it under ${START_CEILING}, and move details to a topic in docs/.`);
  for (const topic of topics) {
    const bytes = Buffer.byteLength(page(topic));
    assert.ok(bytes < TOPIC_CEILING, `docs/${topic}.md is ${bytes} bytes. Keep it under ${TOPIC_CEILING}, or split it into two topics.`);
  }
});

test('the start page has its parts in order', () => {
  assert.deepEqual([...parts.keys()], [
    'What explainroo does', 'The hard limits', 'Before you start', 'When to ask the user', 'From a brief to a finished video', 'Topics',
  ]);
});

test('the start page starts by saying how to run the tool, and writes plain explainroo after that', () => {
  const [opening, ...rest] = start.split('\n\n').slice(1);
  assert.ok(opening.startsWith('Run explainroo with `npx --yes explainroo`.'));
  for (const words of ['node bin/explainroo.js', 'source checkout', 'plain `explainroo`', 'PATH']) assert.ok(opening.includes(words), words);
  assert.ok(!rest.join('\n\n').includes('node bin/explainroo.js'));
  // The skill carries this text, so it names no file of the checkout.
  assert.doesNotMatch(start, /git clone|AGENTS\.md/);
  for (const text of [start, ...topics.map(page)]) assert.doesNotMatch(text, /the explainroo folder|Git ignores that folder/);
});

test('people who change explainroo itself find their topic from the start page', () => {
  assert.ok(listed.includes('contributing'));
  const contributing = page('contributing');
  for (const words of ['git clone https://github.com/vincentsch/explainroo.git', 'node bin/explainroo.js', 'npm test', 'npm run test:pack', 'AGENTS.md', 'SKILL.md']) assert.ok(contributing.includes(words), words);
});

test('the start page lists every topic once, and only topics that exist', () => {
  assert.equal(new Set(listed).size, listed.length, `a topic is listed twice: ${listed.join(', ')}`);
  for (const topic of listed) assert.ok(topics.includes(topic), `the start page lists the topic "${topic}", and docs/${topic}.md does not exist`);
  for (const topic of topics) assert.ok(listed.includes(topic), `the start page does not list docs/${topic}.md`);
  assert.ok(part('Topics').includes('npx --yes explainroo docs <topic>'));
});

test('every "explainroo docs <topic>" in the docs, the README and the messages names a topic', () => {
  const named = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]).filter((t) => !/^[-<]/.test(t));
  const pages = ['AGENTS.md', 'README.md', 'skills/explainroo/SKILL.md', ...topics.map((t) => `docs/${t}.md`)];
  for (const file of pages) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const topic of named(text, /`(?:npx --yes )?explainroo docs ([^`\s]+)`/g)) assert.ok(topics.includes(topic), `${file} names the topic "${topic}", and docs/${topic}.md does not exist`);
  }
  // Messages quote the command, like "explainroo docs publishing" says more.
  const code = ['src/services.json', 'templates/starter/scenes.js', ...fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
  for (const file of code) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const topic of named(text, /explainroo docs ([a-z][a-z0-9-]*)/g)) assert.ok(topics.includes(topic), `${file} names the topic "${topic}", and docs/${topic}.md does not exist`);
  }
  // Each step of the start page names the topic with its details.
  assert.ok(named(part('From a brief to a finished video'), /`explainroo docs ([^`\s]+)`/g).length >= 8);
});

test('the hard limits name every language and every service that needs a key or a sign-in', () => {
  const limits = part('The hard limits');
  for (const code of new Set([...Object.keys(LANGUAGES), ...Object.keys(LANGUAGE_NAMES)])) {
    assert.ok(LANGUAGE_NAMES[code], `${code} has no name in LANGUAGE_NAMES`);
    assert.ok(limits.includes(`\`${code}\``), `the hard limits on the start page don't name the language code ${code}`);
    assert.ok(limits.includes(LANGUAGE_NAMES[code]), `the hard limits on the start page don't name ${LANGUAGE_NAMES[code]}`);
  }
  const keyed = SERVICES.filter(needsKey).map((service) => service.id);
  assert.ok(keyed.length >= 6);
  for (const id of keyed) {
    assert.ok(new RegExp(`(^|[^\\w-])${id}(?![\\w-])`, 'i').test(limits), `the hard limits on the start page don't name ${id}`);
  }
  // One OpenRouter key makes images and clips, and the start page says how to set it up.
  assert.match(oneLine(limits), /\| OpenRouter \| AI images \(`image`\) and AI clips \(`clip`\) \| one key for both, from `connect openrouter` \|/);
  assert.ok(oneLine(limits).includes('`services` reads the same list when it lists clips, at most once a day.'));
  for (const words of ['No other language works yet', 'espeak-ng', 'misaki', 'creating the key starts its paid plan', 'Nothing else leaves the computer']) assert.ok(oneLine(limits).includes(words), words);
});

test('the start page has the rule about outside services where it says when to ask the user', () => {
  const rule = 'Explainroo makes the whole video for free. When the user asks for something that can use an outside service, run `explainroo services <step> --json` and tell the user the options, free ones first. Say which cost money and which are paid partners. Let the user choose. Never pick a paid service for them and never call a partner the best.';
  const section = part('When to ask the user');
  assert.ok(oneLine(section).includes(rule));
  assert.match(section, /explainroo connect openrouter/);
});

test('the start page says how to set up a key, and the settings page says where it goes', () => {
  const before = oneLine(part('Before you start'));
  for (const words of ['npx --yes explainroo doctor --fetch', '`ready`', '`missing`', '`not needed`', 'npx --yes explainroo docs <topic>', 'explainroo connect <service>', 'Never print a key', '`explainroo docs settings`']) assert.ok(before.includes(words), words);
  const keys = oneLine(page('settings').slice(page('settings').indexOf('## Where keys go')));
  for (const words of ['--key-stdin', 'A key never goes on the command line', '$EXPLAINROO_CONFIG/.env', '%APPDATA%\\explainroo\\.env', '$XDG_CONFIG_HOME/explainroo/.env', '~/.config/explainroo/.env', 'then the settings folder', 'Never print a key']) assert.ok(keys.includes(words), words);
});

test('the page about adding a service says what it takes, and implies nothing about payment', () => {
  const page = fs.readFileSync(path.join(root, 'docs/connectors.md'), 'utf8');
  for (const words of ['src/services.json', 'src/connectors/', 'test/helpers/fake-services.js', 'Anyone can send one', 'Nothing about payment is implied']) assert.ok(page.includes(words), words);
});

test('the page about clips says honestly what they are good and bad at, and what they cost', () => {
  const page = fs.readFileSync(path.join(root, 'docs/clips.md'), 'utf8');
  const honest = page.slice(page.indexOf('## What clips are good and bad at'), page.indexOf('## See the price first'));
  for (const words of ['a street, food, weather', 'hands', 'a mood', 'Readable text and numbers', 'Diagrams, app screens and logos', 'The same character across clips', 'Timing to a word', 'use drawings and screenshots', 'Do not ask\nfor real people', 'a failed try may cost money']) assert.ok(honest.includes(words), words);
  for (const words of ['--dry-run', '--max-cost', '--seconds', '--aspect', '--model', '--resolution', '--audio', '--name', '--no-wait', '--new', '--resume <id>', 'google/veo-3.1-lite', 'google/veo-3.1', 'history/failed-check/', 'history/replaced/', 'The prompt goes to OpenRouter and to the company that runs the model', 'zero data retention']) assert.ok(page.includes(words), words);
  assert.doesNotMatch(page, /\bbest\b/i);
  // The price without a project, and where today's prices come from.
  const price = oneLine(page.slice(page.indexOf('## See the price first')));
  for (const words of ['The dry run also works without a project.', 'explainroo clip "A busy street at dusk in the rain" --seconds 6 --dry-run', 'Without a project the price is for 16:9 at 720p without sound, unless the flags say otherwise.', 'A dry run writes nothing, with or without a project. Buying needs a project', '`services clips` works out the price per second of the cheap and the quality model from the same list in the same way', 'It keeps the list it read for a day', '`EXPLAINROO_OFFLINE=1` is set.', 'The list could not be read within a few seconds.', '`services` sends it at most once a day, and only when it lists clips.']) assert.ok(price.includes(words), words);
});

test('the clips and images topics, the start page and the help set up one OpenRouter key with connect openrouter', () => {
  for (const text of [page('clips'), page('images'), part('When to ask the user')]) assert.match(oneLine(text), /`explainroo connect openrouter`/);
  assert.ok(oneLine(page('clips')).includes('One OpenRouter key makes images and clips'));
  assert.ok(oneLine(page('images')).includes('The same key makes AI video clips'));
  const help = run('--help').stdout;
  assert.match(help, /^Images \(optional, costs money, needs an OpenRouter key from "explainroo connect openrouter"\)$/m);
  assert.match(help, /^AI video clips \(optional, costs money, uses the same OpenRouter key as images\)$/m);
  assert.match(oneLine(help), /--dry-run shows the price and spends nothing\. It needs no key and no project, and without a project it prices 16:9 at 720p without sound/);
  assert.match(oneLine(help), /For clips it shows today's prices from OpenRouter's public list, which it reads at most once a day/);
  // The connectors page explains an entry with several steps, and nothing names a second OpenRouter id.
  const connectors = oneLine(page('connectors'));
  for (const words of ['One entry can serve several steps on the same key.', '"step": ["images", "clips"]', '`per_step`']) assert.ok(connectors.includes(words), words);
  assert.doesNotMatch(connectors, /`connector`/);
  for (const file of ['AGENTS.md', 'README.md', 'skills/explainroo/SKILL.md', 'src/services.json', 'src/cli.js', 'src/connect.js', ...topics.map((t) => `docs/${t}.md`)]) assert.doesNotMatch(read(file), /openrouter-video/, file);
  assert.doesNotMatch(help, /openrouter-video/);
});

test('the page about music describes files, s.sound and Soundroo, with public links only', () => {
  const page = fs.readFileSync(path.join(root, 'docs/music.md'), 'utf8');
  for (const words of ['"src": "assets/track.mp3"', '"credit"', '"loop": false', 'fades out at the end', 'stays in stereo', 's.sound(', '"sfx": false', 'wav, mp3, m4a, aac, flac, ogg or opus']) assert.ok(page.includes(words), words);
  const soundroo = page.slice(page.indexOf('## Original music with Soundroo'));
  for (const words of ['https://www.soundroo.com', 'https://github.com/vincentsch/soundroo.git', 'Node 22', 'node bin/soundroo.js init', 'node bin/soundroo.js add', 'node bin/soundroo.js render --all', '/renders/', 'nothing leaves your computer unless you run its\nown share command']) assert.ok(soundroo.includes(words), words);
  assert.doesNotMatch(page, /\/home\//);
  // It isn't on npm, so a command through npx would fail.
  assert.doesNotMatch(page, /npx soundroo/);
  for (const url of page.match(/https?:\/\/[^\s)"]+/g)) assert.ok(['https://www.soundroo.com', 'https://github.com/vincentsch/soundroo.git'].includes(url), url);
});

test('clips and music are one topic away, with the setting, s.sound and the command where they belong', () => {
  for (const topic of ['clips', 'music']) assert.ok(listed.includes(topic), topic);
  const clips = page('clips');
  for (const words of ['--dry-run', '--max-cost', 'assets/clips/<name>.mp4', 'never buys twice']) assert.ok(clips.includes(words), words);
  assert.match(page('settings'), /^\| `music` .*`\{ "src", "volume", "credit", "loop" \}`.*`explainroo docs music`/m);
  assert.match(page('scene-api'), /^`s\.sound\('assets\/door\.mp3', \{ at, out, volume \}\)`/m);
  assert.match(page('commands'), /^\| `clip \[project\] "<prompt>"` \|/m);
});

test('the settings page says what history/ is, and no page calls paid work safe to delete', () => {
  const files = page('settings').slice(0, page('settings').indexOf('`video.json` settings'));
  assert.match(files, /history\/ {6}what was paid for and rendered/);
  assert.match(files, /safe to delete,\s+because paid speech and paid images stay in history\//);
  for (const text of [start, ...topics.map(page)]) assert.doesNotMatch(text, /elevenlabs-usage\.jsonl/);
  const commands = page('commands');
  for (const row of ['`services [step]`', '`connect <service>`', '`history [project]`', '`--new`', '`--resume <id>`', '`--force`', '`--key-stdin`']) assert.ok(commands.includes(row), row);
});

test('the publishing page says why the TikTok file has no watermark, with TikTok\'s own words', () => {
  const page = fs.readFileSync(path.join(root, 'docs/publishing.md'), 'utf8');
  const why = page.slice(page.indexOf('## Why the TikTok file has no watermark'), page.indexOf('## The words'));
  assert.ok(why.includes('[Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)'));
  assert.ok(why.replace(/\s+/g, ' ').includes('"should not superimpose or otherwise include any brand name, logo, watermark, other promotional branding, link or promotional text, on or in any content which is shared to TikTok"'));
  assert.match(why, /its file has no "explainroo\.com" in the\s+corner/);
  assert.match(why, /--size tiktok --no-watermark/);
});

test('the publishing page covers the platforms, post.json, the folder, the limits with their date, and share', () => {
  const page = fs.readFileSync(path.join(root, 'docs/publishing.md'), 'utf8');
  for (const platform of ['youtube', 'shorts', 'tiktok', 'reels', 'linkedin', 'x']) assert.ok(page.includes(`| \`${platform}\` |`), platform);
  for (const file of ['video.mp4', 'post.json', 'description.txt', 'video.srt', 'video.vtt', 'video.cover.jpg', 'video.chapters.txt', 'credits.txt', 'report.json']) assert.ok(page.includes(`\`${file}\``), file);
  for (const field of ['title', 'description', 'hashtags', 'ai_label', 'credits', 'made_for_kids', 'category', 'platforms', 'text', 'ai_reasons']) assert.ok(page.includes(`\`${field}\``), field);
  assert.match(page, /1\. The built-in default\.\n2\. `post\.json`\.\n3\. The block for this platform under `platforms` in `post\.json`\.\n4\. The flags `--title`, `--description` and `--hashtags` on `package`\./);
  assert.match(page, /these were read on 2026-11-07/);
  assert.match(page, /never go into the description by themselves/);
  const share = page.slice(page.indexOf('## Share a link'));
  for (const words of ['The video file and its title leave your computer', 'only when you run this command', 'MP4 and WebM', 'claim link', 'history/private/', 'EXPLAINROO_CLOUD_KEY', 'EXPLAINROO_CLOUD_URL', 'The server may have received the video', 'Only with `--new`', '--new']) assert.ok(share.replace(/\s+/g, ' ').includes(words), words);
});

test('the start page says that a post needs a yes, and the topics have the pointer, the TikTok sentence and every new flag', () => {
  const ask = oneLine(part('When to ask the user'));
  for (const words of ['`share` and `publish` are the only commands that upload a video', 'run them only when the user asks', 'Run `publish` with `--dry-run` first and show the user the plan.', 'Add `--yes` only after the user said yes.']) assert.ok(ask.includes(words), words);
  assert.ok(part('From a brief to a finished video').includes('`explainroo docs publishing`'));
  const publishing = oneLine(page('publishing'));
  for (const words of ['explainroo package videos/<name> --platform tiktok', 'post.json', 'explainroo share', 'explainroo publish', 'only commands that upload a video']) assert.ok(publishing.includes(words), words);
  const sizes = page('sizes');
  assert.match(oneLine(sizes.slice(sizes.indexOf('## The watermark'))), /A TikTok package has no watermark/);
  const commands = page('commands');
  assert.match(commands, /^\| `package \[project\]` \|.*`--platform`.*`--title`.*`--description`.*`--hashtags`.*`--size` for x/m);
  assert.match(commands, /^\| `share \[project\]` \|.*`--platform`.*`--file`.*`--title`.*`--new`/m);
  assert.match(commands, /^\| `publish \[project\]` \|.*`--yes`.*`--via`.*`--platform`.*`--privacy`.*`--media-url`.*`--channel`.*`--account`.*`--dry-run`.*`--new`/m);
  assert.match(commands, /^\| `connect <service>` \|.*`--key-stdin`.*`--callback-url`.*`--project`/m);
  for (const command of ['preview', 'still', 'sheet', 'check', 'render', 'export']) assert.match(commands, new RegExp(`^\\| \`${command} \\[project\\][^|]*\\|.*\`--no-watermark\``, 'm'), command);
});

test('the publishing page covers each route, the logins, the pairs, privacy, the yes and why nothing is sent twice', () => {
  const page = fs.readFileSync(path.join(root, 'docs/publishing.md'), 'utf8');
  const post = page.slice(page.indexOf('## Post a package')).replace(/\s+/g, ' ');
  for (const words of [
    '--via youtube', '--via buffer', '--via blotato', '--dry-run', 'never renders', 'no scheduler',
    'In a terminal, you have to type `yes`', 'Without a terminal it needs `--yes`', 'adds `--yes` only after the user said yes',
    '| `youtube`, `shorts` | yes |', '| `tiktok` | no |', '| `reels` | no |', '| `linkedin` | no |', '| `x` | no |', 'Any other pair stops before anything is uploaded or sent',
    '| YouTube on all three routes | `private` |', '`unlisted` is refused', 'public right away', 'never ignored',
    'Desktop app', '`http://127.0.0.1:8976/callback`', '`https://localhost:8976/callback`', 'shows an error page', 'That is expected', "--callback-url '<the address>'",
    'public client', 'BUFFER_CLIENT_ID', 'new refresh token', "Creating one ends Blotato's free trial", 'end in `=`',
    'explainroo share videos/<name> --platform tiktok', '--media-url', '`--channel <id>`', '`--account <id>`', 'locked or disconnected',
    '| `planned` |', '| `media_uploaded` |', '| `sending` |', '| `accepted` |', '| `finished` |', '| `failed` |',
    'never sent again by itself', 'history/private/', 'YouTube Studio', '`video.cover.jpg`', '`video.srt`', 'never adds the credits',
  ]) assert.ok(post.includes(words), words);
});

test('the instructions link to examples on GitHub, and say that the package has them where doctor says', () => {
  for (const file of ['AGENTS.md', ...topics.map((t) => `docs/${t}.md`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const links = /\[[^\]]*\]\(https:\/\/github\.com\/vincentsch\/explainroo\/tree\/main\/examples[^)]*\)/g;
    assert.doesNotMatch(text.replace(links, ''), /\bexamples\//, file);
  }
  const all = [start, ...topics.map(page)].join('\n');
  for (const example of ['examples)', 'examples/merge-vs-rebase)', 'examples/unspar-demo)']) assert.ok(all.includes(`https://github.com/vincentsch/explainroo/tree/main/${example}`), example);
  for (const topic of ['sizes', 'product-demos', 'languages']) assert.ok(oneLine(page(topic)).includes('The examples also come with the package, and `explainroo doctor` prints their folder.'), topic);
});

// The anchor GitHub gives a heading.
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

test('links between the README and the instructions lead somewhere', () => {
  for (const file of ['README.md', 'AGENTS.md', ...topics.map((t) => `docs/${t}.md`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, target, anchor] of text.matchAll(/\]\((?!https?:)([^)#\s]*)(?:#([^)\s]+))?\)/g)) {
      const dest = target ? path.join(path.dirname(path.join(root, file)), target) : path.join(root, file);
      assert.ok(fs.existsSync(dest), `${file} links to ${target}`);
      if (anchor) {
        const headings = [...fs.readFileSync(dest, 'utf8').matchAll(/^#+ (.*)$/gm)].map((m) => slug(m[1]));
        assert.ok(headings.includes(anchor), `${file} links to ${target}#${anchor}`);
      }
    }
  }
});

test('the README installs with npx, its prompt runs the docs command, and cloning stays for changing the code', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const prompt = readme.match(/```text\n([\s\S]*?)```/)[1];
  assert.ok(prompt.includes('npx --yes explainroo docs'));
  assert.doesNotMatch(prompt, /clone/);
  const install = readme.slice(readme.indexOf('## Install it yourself'), readme.indexOf('## The watermark'));
  assert.equal(install.match(/```bash\n(.*)\n/)[1], 'npx --yes explainroo doctor --fetch');
  assert.ok(install.indexOf('git clone') > install.indexOf('To change the code'));
});

test('the init example on the start page and in making-a-video shows --size, which step 2 asks to pick', () => {
  assert.ok(oneLine(start).includes('`explainroo init videos/<name> --theme paper --size 16:9 --title "..."`. Pick the look for the audience, and the size for the platform'));
  assert.ok(page('making-a-video').includes('explainroo init videos/<name> --theme paper --size 16:9 --title "..."'));
});

test('the README headline is the first sentence of the package description', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const { description } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(readme.match(/<b>([^<]+)<\/b>/)[1], description.slice(0, description.indexOf('.') + 1));
});

// Each command that can send something off the computer has a row in the README.
const SENDS = ['connect', 'voice', 'voices', 'image', 'clip', 'services', 'share', 'publish', 'capture'];

test('the README says what leaves the computer for each command that sends something', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const start = readme.indexOf('## What leaves your computer');
  const section = readme.slice(start, readme.indexOf('\n## ', start));
  const rows = section.split('\n').filter((line) => line.startsWith('| `'));
  for (const command of SENDS) assert.ok(rows.some((row) => row.startsWith(`| \`${command}`)), command);
  // services sends what a dry run of clip sends, and only once a day.
  assert.ok(rows.includes('| `services`, when it lists clips | The same request as `clip --dry-run`, at most once a day. It asks for the list of video models and their prices, without your prompt or a key | OpenRouter |'));
  const words = section.replace(/\s+/g, ' ');
  for (const claim of ['needs no account and no key', 'The voice, the timing, the music and the rendering run on your computer', 'Your coding agent is a separate service with its own terms and prices', 'no telemetry', 'Nothing uploads to the hosted service without the explicit `explainroo share` command.']) assert.ok(words.includes(claim), claim);
  assert.doesNotMatch(readme, /none of this leaves/i);
});

test('the README marks the hosted link and partners as coming, and labels a partner as paid', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const partners = readme.slice(readme.indexOf('## Partners'), readme.indexOf('\n## ', readme.indexOf('## Partners')));
  for (const words of ['Partners are coming', 'There are none yet', '"paid partner"', 'free choices stay first', 'never to pick a paid service for you']) assert.ok(partners.replace(/\s+/g, ' ').includes(words), words);
  assert.match(readme, /`explainroo share`[^]*?That hosted service is coming\./);
});

test('the sizes, settings, short-video and publishing topics explain settings per size, the tall cover and reuse, and the help lists the flags', () => {
  const sizes = oneLine(page('sizes'));
  for (const words of ['"sizes": { "tiktok": { "captions": "bold", "pace": 1.2, "cover": "hook@2.5" } }', 'the 16:9 version stays as it is', 'A block follows its exact size name.', 'A package looks for the block of its platform\'s size first', '`build/pace-<pace>/`', 'A paid voice buys the narration at that pace once', 'explainroo voice videos/<name> --size tiktok', 'every size takes the frame of the first scene with the most elements fully arrived, where a frame with a shape, icon, image or clip comes first', 'A project without `"defaults"` takes the end of the first scene', 'The cover leaves out the captions', '`package` keeps the finished video and writes only the new cover image', '`"captions": "auto"` means no captions on a 16:9 video', 'when `s.portrait` is true', 'with the watermark and without it']) assert.ok(sizes.includes(words), words);
  assert.match(page('settings'), /^\| `sizes` \| none \| `captions`, `cover`, `pace`, `watermark` and `targetSeconds` for one size/m);
  assert.match(page('settings'), /^\| `cover` \| `"auto"` \| .*With `"defaults": "0\.5"`, `"auto"` takes the frame of the first scene with the most elements fully arrived, a frame with a shape, icon, image or clip first\. Code still typing and a number still counting have not arrived\. Without it, `"auto"` is the end of the first scene/m);
  assert.match(page('settings'), /^\| `defaults` \| none \| `"0\.5"` gives the project the defaults of explainroo 0\.5/m);
  assert.match(page('settings'), /^\| `motionBlur` \| .*`render --quality fast` leaves it out for one run/m);
  const short = oneLine(page('short-video'));
  for (const words of ['"tiktok": { "captions": "bold", "pace": 1.2 }', 'the frame of the first scene with the most elements fully arrived, a frame with a picture first', 'A cover has no captions.', '`"captions": "auto"` means no captions on 16:9', 'the same scene function draws it when `s.portrait` is true']) assert.ok(short.includes(words), words);
  const publishing = oneLine(page('publishing'));
  for (const words of ['the package uses that size and its block', 'a TikTok package has no watermark, whatever its block says', 'it is the fullest frame of the first scene', '### Look at a platform\'s version first', 'explainroo render videos/<name> --platform tiktok', '`source.command`', '`"motionBlur": false`']) assert.ok(publishing.includes(words), words);
  const commands = page('commands');
  assert.match(commands, /^\| `voice \[project\]` \|.*`--size`/m);
  assert.match(commands, /^\| `render \[project\]` \|.*`--quality final` or `fast`/m);
  assert.ok(oneLine(commands).includes('`--quality fast` and `--draft` can\'t go together'));
  assert.match(commands, /^\| `export \[project\]` \|.*`--size`.*`out\/player-tiktok\/` with `--size tiktok`/m);
  assert.ok(oneLine(page('web-player')).includes('`export --size tiktok` writes the player of that size to `out/player-tiktok/`, with the settings of its block in `"sizes"`.'));
  const help = oneLine(run('--help').stdout);
  for (const words of ['--size makes the narration of a size whose block in "sizes" sets its own pace', '--quality final|fast', '--quality fast makes a final without it', '"sizes" in video.json sets captions, cover, pace, watermark and targetSeconds for one size', 'export [project] write a web player folder (--out dir, default: out/player/; --size, --no-watermark)', 'override video.json for preview, still, sheet, check, render and export']) assert.ok(help.includes(words), words);
});

test('the scene-api, troubleshooting, product-demos and commands topics and the help cover cues, arrow labels, captures, captions, lift and sheet --times', () => {
  const api = oneLine(page('scene-api'));
  for (const words of ['`\'fills#2\'` is the second time "fills" is spoken in the scene, the same as `s.cue(\'fills\', 2)`', 'Write `\'fills#1\'` when you mean the first time, and the hint goes away.', '`at`, `out`, `s.time`, `s.cue` and `s.cueEnd`', 'so `\'C#\'` stays a word and `\'#ask\'` stays a marker', 's.arrow([960, 260], [960, 820], { label: \'answers\', labelSide: \'right\', at: \'answers\' });', '`labelSide: \'left\'`, `\'right\'`, `\'above\'` or `\'below\'` puts it on that side', 'A label sits above a straight arrow, left of a vertical one and on the outer side of a curve, `labelOffset` away from the arrow\'s middle: 44 for a label of 48 pixels', '`labelSize` (48, the size of body text)', 'an arrow leaves or reaches a labelled icon outside its label', '`s.quiet()` at the top of a scene', '`overlap` | `true` when the shape may overlap other shapes', '`camera` | `false` keeps the automatic camera from moving to it', 'Place things from `s.safe`, the part of the frame that is free for content, and the same `scenes.js` works in 16:9 and on Reels.', '`check` treats the label as text']) assert.ok(api.includes(words), words);
  const trouble = oneLine(page('troubleshooting'));
  for (const words of ['Write `\'writes#2\'` for the second time', 'Write `\'writes#1\'` when you mean the first time, and the hint goes away.', 'Move it with `labelSide: \'right\'`', 'Text with a background but no words', '`s.box({ w: 520, h: 72 })`', 'an arrow\'s label counts as text', 'a `lift` above 2 in `s.ui`', 'crossed by the line of an arrow or of a mark from `s.annotate`', 'shapes that partly overlap: boxes, cards, panels, images, icons and stickers', 'a scene that shows only its background for more than 1.5 seconds, at the start or later', 'cut at the edge of the frame by the camera while the shot holds still', 'It does not see what a drawing made with `s.draw` or straight on `s.ctx` holds. Give `s.draw` a `box`', 'a darker or lighter shade of the same color first', 'goes on with the rest of the scene as if the cue were at the scene start']) assert.ok(trouble.includes(words), words);
  // The return value of an icon with a label, and the box of a drawing.
  const sceneApi = oneLine(page('scene-api'));
  for (const words of ['it also returns `label`, the label\'s box, and `outer`, a box with both', '`box: { x, y, w, h }`, the center and size of what you draw']) assert.ok(sceneApi.includes(words), words);
  assert.doesNotMatch(trouble, /s\.cue\('writes', 2\)/);
  const demos = oneLine(page('product-demos'));
  for (const words of ['explainroo capture videos/<name> https://example.com/pricing --name pricing', '`assets/capture/example.com/pricing/`', 'Capturing again with the same name replaces only that folder.', 'A capture without a name replaces its own files and keeps the named folders.', 'It can\'t be `fonts`, because a capture without a name keeps its fonts there.', 'With captions on, `accent` also colors the word being spoken. A look file that sets `caption` colors decides instead.', 'a contrast below 3:1', 'make it lighter on a dark background, or darker on a light one', 'Bold captions keep their own colors.', 'It is a multiplier from 0 to 2: 0 is no shadow, 1 the normal shadow and 2 twice the normal shadow.', 'like 1.4 for a dialog', '`check` warns about a `lift` above 2.']) assert.ok(demos.includes(words), words);
  assert.doesNotMatch(demos, /Capturing the same site again replaces its folder\./);
  assert.match(page('settings'), /^\| `brand` \| none \| .*its `accent` also colors the spoken word in captions/m);
  const commands = page('commands');
  assert.match(commands, /^\| `sheet \[project\]` \|.*`--times 3,12\.5,intro@2` makes `out\/sheet-times\.jpg` of just those moments, in that order\. It takes every time that `still` takes\. With `--size tiktok` the file is `out\/sheet-times-tiktok\.jpg`/m);
  assert.match(commands, /^\| `capture \[project\] <url>` \|.*`--name pricing` saves to `assets\/capture\/<site>\/pricing\/`/m);
  assert.ok(page('making-a-video').includes('explainroo sheet videos/<name> --times 3,intro@2.5,40'));
  const help = oneLine(run('--help').stdout);
  for (const words of ['--times 3,12.5,intro@2 makes out/sheet-times.jpg of just those moments, written like the times of still', '--name pricing saves to assets/capture/<site>/pricing/, so several pages of one site stay side by side']) assert.ok(help.includes(words), words);
});

test('the docs say that verify takes no --size, that German is a language, and that only Kokoro needs espeak-ng', () => {
  assert.ok(oneLine(page('sizes')).includes('`verify` takes no `--size`, so check such a video with `verify --file out/video-tiktok.mp4`.'));
  assert.ok(oneLine(page('sizes')).includes('Bold captions are one line, so their band is shorter and the content area taller.'));
  assert.match(page('settings'), /^\| `language` \| `en` \| .*and `de` with a paid voice or a recording/m);
  assert.ok(oneLine(read('README.md')).includes('For narration with Kokoro, the free voice, in Spanish, French, Italian, Portuguese or Hindi, also install'));
  assert.ok(oneLine(read('AGENTS.md')).includes('With `--fetch` it also downloads the speech models that setup needs, the first time only: about 400 MB for English, and 252 MB for another language.'));
  const sizes = run('sizes').stdout;
  assert.match(sizes, /--size on init, preview, still, sheet, check, render or export\./);
});

// An agent's tool can cut off a long page, so each part that a command prints
// stays short: every "## " section of a topic, and the opening before the first.
const SECTION_CEILING = 12000;
const sectionsOf = (text) => {
  const out = [{ heading: null, lines: [] }];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) out.push({ heading: line.slice(3).trim(), lines: [line] });
    else out.at(-1).lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, text: `${s.lines.join('\n').trimEnd()}\n` }));
};

test('every section of every topic stays under 12,000 bytes', () => {
  for (const topic of topics) {
    for (const { heading, text } of sectionsOf(page(topic))) {
      const bytes = Buffer.byteLength(text);
      assert.ok(bytes < SECTION_CEILING, `docs/${topic}.md, ${heading ? `section "${heading}"` : 'the part before the first section'}, is ${bytes} bytes. Keep it under ${SECTION_CEILING}, or split it with a "## " heading.`);
    }
  }
});

test('docs <topic> --sections lists the sections with their size, and docs <topic> <section> prints one', () => {
  for (const topic of topics) {
    const sections = sectionsOf(page(topic)).filter((s) => s.heading);
    const listed = JSON.parse(run('docs', topic, '--sections', '--json').stdout);
    assert.deepEqual(listed.sections.map((s) => s.heading), sections.map((s) => s.heading), topic);
    const text = run('docs', topic, '--sections').stdout;
    if (!sections.length) {
      assert.match(text, new RegExp(`^${topic} has no sections\\. It is [\\d.]+ KB, so print it whole with "explainroo docs ${topic}"\\.\\n$`));
      continue;
    }
    assert.equal(text.trimEnd().split('\n').length, sections.length + 1, topic);
    for (const [i, s] of listed.sections.entries()) {
      assert.equal(s.slug, slug(s.heading));
      assert.equal(s.bytes, Buffer.byteLength(sections[i].text));
      assert.match(text, new RegExp(`^ {2}${s.slug.replace(/[.]/g, '\\.')} +[\\d.]+ KB {2}`, 'm'));
      // Each one prints by its name, exactly as it is in the page.
      const one = run('docs', topic, s.slug);
      assert.equal(one.status, 0, `${topic} ${s.slug}: ${one.stderr}`);
      assert.equal(one.stdout, sections[i].text, `${topic} ${s.slug}`);
    }
  }
  const json = JSON.parse(run('docs', 'publishing', 'buffer', '--json').stdout);
  assert.deepEqual([json.topic, json.section, json.slug], ['publishing', 'Buffer', 'buffer']);
  assert.ok(json.text.startsWith('## Buffer\n'));
});

test('a section is found by its heading in any case, by a word only it has, or by a word its heading starts with', () => {
  const docs = (...args) => run('docs', 'publishing', ...args);
  const first = (r) => r.stdout.split('\n')[0];
  assert.equal(first(docs('Post a package')), '## Post a package');
  assert.equal(first(docs('post', 'a', 'PACKAGE')), '## Post a package');
  assert.equal(first(docs('buffer')), '## Buffer');
  assert.equal(first(docs('tiktok')), '## Why the TikTok file has no watermark');
  // Three headings have "package". One of them starts with it.
  assert.equal(first(docs('package')), '## Package a video for a platform');
  assert.equal(first(docs('what', 'package')), '## What package checks');
  // A "### " part, when no section has the words.
  assert.equal(first(docs('privacy')), '### Privacy');
  assert.equal(first(docs('draft')), '### Save a draft in Buffer');
  const many = docs('the');
  assert.equal(many.status, 1);
  assert.match(many.stderr, /^error: more than one section of publishing has "the": why-the-tiktok-file-has-no-watermark, the-words-postjson, the-ai-label-and-the-credits\. Use more words of the heading\./);
  const none = docs('nope');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^error: publishing has no section "nope"\. Its sections are: package-a-video-for-a-platform, .*share-a-link, test-servers\. "explainroo docs publishing --sections" lists them with their size\./);
  assert.match(run('docs', '--sections').stderr, /the start page has no sections to print one by one/);
});

test('publishing starts with the package and the common part of posting, and each route has a section of its own', () => {
  const headings = sectionsOf(page('publishing')).filter((s) => s.heading).map((s) => s.heading);
  assert.deepEqual(headings, ['Package a video for a platform', 'Why the TikTok file has no watermark', 'The words: post.json', 'The AI label and the credits', 'What package checks', 'Post a package', 'YouTube', 'Buffer', 'Blotato', 'Share a link', 'Test servers']);
  const section = (heading) => oneLine(sectionsOf(page('publishing')).find((s) => s.heading === heading).text);
  for (const words of ['Desktop app', '`http://127.0.0.1:8976/callback`', 'connect youtube --callback-url', 'YouTube Studio', 'an upload that can go on after a break']) assert.ok(section('YouTube').includes(words), words);
  for (const words of ['public https link to this exact file', 'BUFFER_CLIENT_ID', '`https://localhost:8976/callback`', '### Save a draft in Buffer', '--draft --dry-run']) assert.ok(section('Buffer').includes(words), words);
  for (const words of ["Creating one ends Blotato's free trial", 'end in `=`', 'its own storage']) assert.ok(section('Blotato').includes(words), words);
  for (const words of ['Nothing goes out without a yes', 'Which package goes where', '`Link size`', '| `sending` |']) assert.ok(section('Post a package').includes(words), words);
  assert.ok(oneLine(page('publishing')).includes('Print only the part you need. `explainroo docs publishing --sections` lists them'));
});

test('the start page says to print only the section of a topic that you need', () => {
  const topicsPart = oneLine(part('Topics'));
  for (const words of ['`npx --yes explainroo docs <topic> --sections`', '`npx --yes explainroo docs <topic> <section>`', 'Print only the section you need']) assert.ok(topicsPart.includes(words), words);
});

// Defaults and choices that are easy to miss, on the page that is read first.
test('the start page has the watermark, captions on 16:9, a choice already made, drafts, the target length and the clip budget', () => {
  const ask = oneLine(part('When to ask the user'));
  assert.ok(ask.includes('When the user has already picked a service or given a budget, use it and don\'t ask again.'));
  assert.ok(ask.includes('A budget for AI clips goes in `video.json` as `"clipBudget": 0.40`. `clip` then stops before a clip that would go over it, and it says how much is left.'));
  const steps = oneLine(part('From a brief to a finished video'));
  for (const words of [
    'The video has a small "explainroo.com" watermark in a corner by default, and `"watermark": false` in `video.json` turns it off.',
    'With `"captions": "auto"`, vertical, 4:5 and square videos get captions, and a 16:9 video gets none.',
    'When the user asks for a length, set it in `video.json`, like `"targetSeconds": 40`.',
    'Make a draft with `--draft` only when you will watch it, because `still` and `sheet` are the cheap way to see frames.',
  ]) assert.ok(steps.includes(words), words);
  assert.doesNotMatch(steps, /render videos\/<name> --draft`, then/);
  assert.match(page('settings'), /^\| `clipBudget` \| none \|/m);
  assert.match(page('settings'), /^\| `targetSeconds` \| none \|/m);
});

test('the scene-api topic says where s.draw puts 0, 0, how the camera measures a drawing, and what at, dur, enter and exit do', () => {
  const api = oneLine(page('scene-api'));
  for (const words of ['`ctx` is already moved to `x`, `y`', 'Without `x` and `y`, 0, 0 is the top left corner of the frame', '`life.p` goes from 0 to 1 over `dur` seconds after `at`', 'At `out` it leaves with `exit`', 'The automatic camera measures a drawing once, as it looks at the end of the scene', 'a drawing that moves is measured where it ends up']) assert.ok(api.includes(words), words);
});

test('the README says a budget makes --max-cost optional, and the recipe for espeak-ng without root finds its library folder on any processor', () => {
  const readme = oneLine(read('README.md'));
  assert.ok(readme.includes('A paid run needs `--max-cost` or a budget'), 'the README names the budget');
  // The cap is checked against the price before buying, and the final cost can come out higher.
  const start = oneLine(read('AGENTS.md'));
  const help = oneLine(spawnSync(process.execPath, [path.join(root, 'bin/explainroo.js'), 'clip', '--help'], { encoding: 'utf8' }).stdout);
  for (const [name, text] of [['README.md', readme], ['AGENTS.md', start], ['clip --help', help]]) {
    assert.match(text, /checks the price against (that|the) cap/, name);
    assert.match(text, /before it buys/i, name);
    assert.match(text, /The final cost is known only after the job, and it can come out a little higher/, name);
  }
  const languages = page('languages');
  assert.match(languages, /lib=\$\(dirname "\$\(find "\$here\/root\/usr\/lib" -name 'libespeak-ng\.so\*' \| head -n 1\)"\)/);
  // The recipe is the launcher that doctor --fetch writes, and it stays out of the home folder.
  const launcher = /```sh\n([\s\S]*?)```/.exec(languages)[1].split('\n').filter((line) => line && !line.startsWith('#'));
  const written = fs.readFileSync(path.join(root, 'src/doctor.js'), 'utf8');
  for (const line of launcher) assert.ok(written.includes(line.replace(/\$\{/g, '\\${')), line);
  assert.ok(!/~\/espeak|\$HOME\/espeak/.test(languages), 'nothing in the top of the home folder');
  assert.ok(oneLine(languages).includes('`explainroo doctor --fetch --language es` sets it up by itself'));
  assert.ok(!/x86_64-linux-gnu\/espeak-ng-data`/.test(languages), 'no fixed x86_64 data path');
  assert.ok(oneLine(languages).includes('put the line in the settings file, the same `.env` that holds keys'));
});

test('every topic sizes text with one rule: a hundredth of the short side of s.safe, as the starter scenes.js does', () => {
  const starter = read('templates/starter/scenes.js');
  assert.ok(starter.includes('const u = Math.min(w, h) / 100;'));
  for (const file of ['AGENTS.md', ...fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]) {
    assert.doesNotMatch(read(file), /Math\.max\(s\.W, s\.H\) \/ 100/, file);
  }
  const pictures = page('pictures');
  assert.equal(pictures.match(/const \{ w, h \} = s\.safe;\n {4}const u = Math\.min\(w, h\) \/ 100;/g).length, 4);
  assert.ok(oneLine(pictures).includes('Text sizes come from `u`, a hundredth of the short side of `s.safe`, the same rule as the `scenes.js` that `init` writes'));
});

test('the writing topic has a part for other languages: the filler words are English, and each language has its pace and its own fillers', () => {
  const part = page('writing').split('## Other languages')[1].split('\n## ')[0];
  assert.ok(oneLine(part).includes('the filler words they name are English'));
  for (const row of ['| Spanish | 175 | realmente, simplemente, básicamente |', '| French | 160 | vraiment, simplement, juste |', '| Italian | 180 | davvero, semplicemente, praticamente |', '| Brazilian Portuguese | 185 | realmente, simplesmente, basicamente |', '| German | 135 | eigentlich, einfach, wirklich |']) assert.ok(part.includes(row), row);
  assert.ok(oneLine(part).includes('For Hindi the estimate counts 150 words a minute, for Japanese 300 characters and for Chinese 230.'));
  assert.ok(oneLine(page('languages')).includes('its part "Other languages" gives the filler words and the pace of each language'));
});

test('the pace in the writing topic is the one the estimate uses: 13 letters a second, and the figures for Hindi, Japanese and Chinese', async () => {
  const { estimateLength } = await import('../src/timeline.js');
  // A thousand words of five letters is about 5,000 letters, at 12.95 a second.
  const words = Array.from({ length: 1000 }, () => 'abcde').join(' ');
  const estimate = (language, text) => estimateLength({ config: { language, voice: 'af_heart', speed: 0.9, pace: 1, lead: 0, hold: 0, end: 0, sentenceGap: 0, paragraphGap: 0 }, script: { scenes: [{ attrs: {}, spoken: text, units: [{ type: 'word', display: text, spoken: text }] }] } });
  assert.equal(estimate('es', words).perMinute, Math.round((12.95 * 60) / 5));
  assert.equal(estimate('hi', words).perMinute, 150);
});
