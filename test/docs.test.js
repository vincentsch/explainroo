import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// Agents pay for every token of AGENTS.md. New features get a page in docs/ and
// a few lines here. The ceiling leaves room for the services rule and those lines.
const AGENTS_CEILING = 66000;
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

test('AGENTS.md stays under its size ceiling', () => {
  const size = Buffer.byteLength(agents);
  assert.ok(size <= AGENTS_CEILING, `AGENTS.md is ${size} bytes. Move long parts to docs/ and keep it under ${AGENTS_CEILING}.`);
});

test('AGENTS.md starts by saying how to run the tool, and writes plain explainroo after that', () => {
  const [opening, ...rest] = agents.split('\n\n').slice(1);
  assert.ok(opening.startsWith('Run explainroo with `npx --yes explainroo`.'));
  for (const words of ['node bin/explainroo.js', 'source checkout', 'plain `explainroo`', 'PATH']) assert.ok(opening.includes(words), words);
  const below = rest.join('\n\n');
  // One note for people who change explainroo itself, at the very end.
  assert.equal(below.split('node bin/explainroo.js').length, 2);
  assert.ok(below.indexOf('node bin/explainroo.js') > below.indexOf('## Working on explainroo itself'));
  assert.equal(below.split('git clone').length, 2);
  assert.ok(below.indexOf('git clone') > below.indexOf('## Working on explainroo itself'));
  assert.doesNotMatch(agents, /the explainroo folder|Git ignores that folder/);
});

test('every docs topic named in AGENTS.md exists, and every page is named there', () => {
  const named = new Set([...agents.matchAll(/`(?:npx --yes )?explainroo docs ([^`\s]+)`/g)].map((m) => m[1]).filter((t) => !/^[-<]/.test(t)));
  assert.ok(named.has('product-demos') && named.has('japanese-and-chinese'));
  for (const topic of named) assert.ok(topics.includes(topic), `AGENTS.md names the topic "${topic}", and docs/${topic}.md does not exist`);
  for (const topic of topics) assert.ok(named.has(topic), `nothing in AGENTS.md leads to docs/${topic}.md`);
});

test('AGENTS.md has the rule about outside services near when to ask the user', () => {
  const rule = 'Explainroo makes the whole video for free. When the user asks for something that can use an outside service, run `explainroo services <step> --json` and tell the user the options, free ones first. Say which cost money and which are paid partners. Let the user choose. Never pick a paid service for them and never call a partner the best.';
  const section = agents.slice(agents.indexOf('### When to ask the user'), agents.indexOf('### Where keys go'));
  assert.ok(section.replace(/\s+/g, ' ').includes(rule));
  assert.match(section, /explainroo connect openrouter|connect openrouter/);
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

test('AGENTS.md has a few lines on clips and music, and points at their pages', () => {
  const start = agents.indexOf('## AI video clips');
  const section = agents.slice(start, agents.indexOf('\n## ', start));
  for (const words of ['explainroo docs clips', '--dry-run', '--max-cost', 'assets/clips/<name>.mp4', 'never buys twice']) assert.ok(section.includes(words), words);
  assert.ok(section.split('\n').length < 16, 'keep it short: the rest is on the page');
  assert.match(agents, /^\| `music` .*`\{ "src", "volume", "credit", "loop" \}`.*`explainroo docs music`/m);
  assert.match(agents, /^`s\.sound\('assets\/door\.mp3', \{ at, out, volume \}\)`/m);
  assert.match(agents, /^\| `clip \[project\] "<prompt>"` \|/m);
});

test('AGENTS.md says what history/ is, and no longer calls paid work safe to delete', () => {
  const files = agents.slice(agents.indexOf('## Project files and settings'), agents.indexOf('`video.json` settings'));
  assert.match(files, /history\/ {6}what was paid for and rendered/);
  assert.match(files, /safe to delete,\s+because paid speech and paid images stay in history\//);
  assert.doesNotMatch(agents, /elevenlabs-usage\.jsonl/);
  for (const row of ['`services [step]`', '`connect <service>`', '`history [project]`', '`--new`', '`--resume <id>`', '`--force`', '`--key-stdin`']) assert.ok(agents.includes(row), row);
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

test('AGENTS.md has a few lines on posting, the pointer, the TikTok sentence and every new flag', () => {
  const start = agents.indexOf('## Posting a video');
  const section = agents.slice(start, agents.indexOf('\n## ', start));
  for (const words of ['explainroo package', '--platform tiktok', 'post.json', 'explainroo docs publishing', 'explainroo share', 'only command that uploads a video']) assert.ok(section.includes(words), words);
  assert.ok(section.split('\n').length < 14, 'keep it short: the rest is on the page');
  const watermark = agents.slice(agents.indexOf('## The watermark'), agents.indexOf('## Project files and settings'));
  assert.match(watermark.replace(/\s+/g, ' '), /A TikTok package has no watermark/);
  assert.match(agents, /^\| `package \[project\]` \|.*`--platform`.*`--title`.*`--description`.*`--hashtags`.*`--size` for x/m);
  assert.match(agents, /^\| `share \[project\]` \|.*`--platform`.*`--file`.*`--title`.*`--new`/m);
  for (const command of ['preview', 'still', 'sheet', 'check', 'render']) assert.match(agents, new RegExp(`^\\| \`${command} \\[project\\][^|]*\\|.*\`--no-watermark\``, 'm'), command);
});

test('the instructions link to examples on GitHub, because the package has none', () => {
  for (const file of ['AGENTS.md', ...topics.map((t) => `docs/${t}.md`)]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const links = /\[[^\]]*\]\(https:\/\/github\.com\/vincentsch\/explainroo\/tree\/main\/examples[^)]*\)/g;
    assert.doesNotMatch(text.replace(links, ''), /\bexamples\//, file);
  }
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
