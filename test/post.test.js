import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { createJob, jobKey, updateJob } from '../src/history.js';
import { DEFAULT_CATEGORY, LIMITS, LIMITS_CHECKED, PLATFORMS, aiFacts, hashtagFlag, limitWarnings, postWords, readPostFile, settleWords, withHashtags } from '../src/post.js';

function project(t, settings = {}, script = '# How DNS works\n## intro\nHello there.\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-post-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  return dir;
}

function writePost(dir, words) {
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(words));
}

function boughtJob(dir, kind, model, status = 'done') {
  const request = { name: 'x', prompt: 'a prompt', model };
  const job = createJob(dir, jobKey({ kind, ...request }), { kind, provider: 'openrouter', request });
  updateJob(dir, job, { status });
}

test('each field is settled from the default, then post.json, then its platform block, then the flag', () => {
  const defaults = { title: 'Default', description: '', hashtags: [], ai_label: true, made_for_kids: false, category: '27' };
  const file = { title: 'From the file', platforms: { tiktok: { title: 'For TikTok' } } };
  assert.equal(settleWords(defaults, {}, 'tiktok').title, 'Default');
  assert.equal(settleWords(defaults, { title: 'From the file' }, 'tiktok').title, 'From the file');
  assert.equal(settleWords(defaults, file, 'tiktok').title, 'For TikTok');
  assert.equal(settleWords(defaults, file, 'youtube').title, 'From the file');
  assert.equal(settleWords(defaults, file, 'tiktok', { title: 'From the flag' }).title, 'From the flag');
  assert.equal(settleWords(defaults, file, 'tiktok', { title: undefined }).title, 'For TikTok');
  // Credits from post.json and the block add up, and the rest stay as they were.
  const credits = settleWords(defaults, { credits: ['Photos: Jane'], platforms: { x: { credits: ['Map: OSM'] } } }, 'x');
  assert.deepEqual(credits.credits, ['Photos: Jane', 'Map: OSM']);
  assert.equal(credits.made_for_kids, false);
  assert.equal(settleWords(defaults, { category: 28 }, 'youtube').category, '28');
});

test('hashtags keep their #, lose duplicates and must be one word', () => {
  assert.deepEqual(hashtagFlag('dns #Networking,#dns  web_1'), ['#dns', '#Networking', '#web_1']);
  assert.deepEqual(settleWords({ hashtags: [] }, { hashtags: ['dns', '#DNS', 'été'] }, 'x').hashtags, ['#dns', '#été']);
  assert.throws(() => hashtagFlag('two-words'), /"two-words" is not a hashtag/);
  assert.throws(() => hashtagFlag('#'), /is not a hashtag/);
});

test('the text is the description, or the title without one, then the hashtags it does not already have', () => {
  assert.equal(withHashtags('Learn how #DNS works.', ['#dns', '#web']), 'Learn how #DNS works.\n\n#web');
  assert.equal(withHashtags('A #dnsx and #webby', ['#dns', '#web']), 'A #dnsx and #webby\n\n#dns #web');
  assert.equal(withHashtags('Plain words', []), 'Plain words');
  assert.equal(withHashtags('', ['#a']), '#a');
});

test('the post for each platform: text, the YouTube description with its chapters, and the text box', (t) => {
  const dir = project(t);
  writePost(dir, { description: 'Every site has an address. #dns', hashtags: ['dns', 'networking'], platforms: { x: { description: '' } } });
  const chapters = '0:00 Intro\n0:12 The resolver\n';
  const youtube = postWords(loadProject(dir), 'youtube', { chapters });
  assert.equal(youtube.title, 'How DNS works');
  assert.equal(youtube.description, 'Every site has an address. #dns\n\n0:00 Intro\n0:12 The resolver');
  assert.equal(youtube.text, `${youtube.description}\n\n#networking`);
  assert.equal(youtube.box, youtube.text);
  const tiktok = postWords(loadProject(dir), 'tiktok', { chapters });
  assert.equal(tiktok.description, 'Every site has an address. #dns');
  assert.equal(tiktok.text, 'Every site has an address. #dns\n\n#networking');
  assert.equal(tiktok.box, tiktok.text);
  // No description: the title goes in the text, and nothing appears twice.
  const x = postWords(loadProject(dir), 'x');
  assert.equal(x.description, '');
  assert.equal(x.text, 'How DNS works\n\n#dns #networking');
  assert.match(x.warnings[0], /there is no description yet/);
  // On YouTube and Shorts the title has its own field, so the box never repeats it.
  writePost(dir, { hashtags: ['dns'] });
  const shorts = postWords(loadProject(dir), 'shorts', { chapters });
  assert.equal(shorts.text, 'How DNS works\n\n#dns');
  assert.equal(shorts.box, '#dns');
  assert.equal(shorts.made_for_kids, false);
  assert.equal(shorts.category, DEFAULT_CATEGORY);
});

test('the AI label follows a synthetic voice and bought clips and images, with its reasons, and post.json can change it', (t) => {
  const dir = project(t);
  const kokoro = postWords(loadProject(dir), 'tiktok');
  assert.equal(kokoro.ai_label, true);
  assert.deepEqual(kokoro.ai_reasons, ['voice: Kokoro']);
  assert.deepEqual(kokoro.credits, ['Voice: Kokoro', 'Music: made by explainroo', 'Made with explainroo']);

  // A recording and no AI files: no label, and no voice credit.
  const recorded = project(t, { voice: { provider: 'recording', src: 'assets/narration.m4a' }, music: false });
  assert.equal(postWords(loadProject(recorded), 'tiktok').ai_label, false);
  assert.deepEqual(postWords(loadProject(recorded), 'tiktok').ai_reasons, []);
  assert.deepEqual(postWords(loadProject(recorded), 'tiktok').credits, ['Made with explainroo']);

  // Bought clips and images count, used or not. A try that failed does not.
  boughtJob(recorded, 'clip', 'google/veo-3.1-lite');
  boughtJob(recorded, 'image', 'google/gemini-3.1-flash-image');
  boughtJob(recorded, 'clip', 'some/failed-model', 'failed');
  const bought = postWords(loadProject(recorded), 'reels');
  assert.equal(bought.ai_label, true);
  assert.deepEqual(bought.ai_reasons, ['clip: google/veo-3.1-lite', 'image: google/gemini-3.1-flash-image']);
  assert.deepEqual(bought.credits, ['Video clips: made with google/veo-3.1-lite', 'Illustrations: made with google/gemini-3.1-flash-image', 'Made with explainroo']);

  writePost(recorded, { ai_label: false, credits: ['Photos: Jane Doe'], platforms: { reels: { ai_label: true } } });
  const off = postWords(loadProject(recorded), 'tiktok');
  assert.equal(off.ai_label, false);
  assert.deepEqual(off.ai_reasons, ['clip: google/veo-3.1-lite', 'image: google/gemini-3.1-flash-image', 'set to false in post.json']);
  assert.deepEqual(off.credits.slice(-2), ['Photos: Jane Doe', 'Made with explainroo']);
  assert.deepEqual(postWords(loadProject(recorded), 'reels').ai_reasons.at(-1), 'set to true in post.json platforms.reels');

  // A video with no narration has no voice to label.
  const silent = project(t, {}, '# Quiet\n## intro {min=2}\n');
  assert.deepEqual(aiFacts(loadProject(silent)).reasons, []);
});

test('a music file adds its credit, and one without a credit gets a warning', (t) => {
  const dir = project(t, { music: { src: 'assets/track.mp3', credit: 'Song by Ana' } });
  fs.writeFileSync(path.join(dir, 'assets/track.mp3'), 'x');
  assert.ok(postWords(loadProject(dir), 'x').credits.includes('Music: Song by Ana'));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ music: { src: 'assets/track.mp3' } }));
  const words = postWords(loadProject(dir), 'x');
  assert.ok(!words.credits.some((c) => c.startsWith('Music')));
  assert.ok(words.warnings.some((w) => /assets\/track\.mp3 has no credit/.test(w)));
});

test('post.json mistakes are errors that name the field', (t) => {
  const dir = project(t);
  const fails = (words, message) => {
    fs.writeFileSync(path.join(dir, 'post.json'), typeof words === 'string' ? words : JSON.stringify(words));
    assert.throws(() => readPostFile(dir), message);
  };
  fails('{ nope', /post\.json is not valid JSON/);
  fails([], /post\.json must be an object/);
  fails({ titel: 'x' }, /unknown setting\(s\): titel\. Known: title, description, hashtags, ai_label, credits, made_for_kids, category, platforms/);
  fails({ title: '' }, /post\.json: title must be a short text/);
  fails({ hashtags: '#dns' }, /hashtags must be a list/);
  fails({ hashtags: ['two words'] }, /post\.json: hashtags: "two words" is not a hashtag/);
  fails({ ai_label: 'yes' }, /ai_label must be true or false/);
  fails({ credits: [''] }, /credits must be a list of short texts/);
  fails({ made_for_kids: 1 }, /made_for_kids must be true or false/);
  fails({ category: 'Education' }, /category must be a YouTube category id like "27"/);
  fails({ platforms: { instagram: {} } }, /has "instagram", and the platforms are youtube, shorts, tiktok, reels, linkedin, x/);
  fails({ platforms: { x: { platforms: {} } } }, /post\.json platforms\.x has unknown setting\(s\): platforms/);
  fails({ platforms: { x: { title: 3 } } }, /post\.json platforms\.x: title must be a short text/);
  fs.rmSync(path.join(dir, 'post.json'));
  assert.deepEqual(readPostFile(dir), {});
});

test('limits warn with their date: title, description bytes, text, hashtags and length', () => {
  assert.equal(LIMITS_CHECKED, '2026-11-07');
  assert.deepEqual(Object.keys(LIMITS), Object.keys(PLATFORMS));
  const fine = { title: 'Short', box: 'Short text', hashtags: ['#a'], duration: 30 };
  for (const platform of Object.keys(PLATFORMS)) assert.deepEqual(limitWarnings(platform, fine), [], platform);
  assert.match(limitWarnings('youtube', { ...fine, title: 'x'.repeat(101) })[0], /the title has 101 characters, and YouTube takes 100 \(limits as of 2026-11-07\)/);
  // YouTube counts the description in bytes.
  assert.equal(limitWarnings('youtube', { ...fine, box: 'é'.repeat(2600) }).length, 1);
  assert.equal(limitWarnings('youtube', { ...fine, box: 'e'.repeat(2600) }).length, 0);
  assert.match(limitWarnings('x', { ...fine, box: 'x'.repeat(281) })[0], /the text has 281 characters, and X takes 280/);
  assert.match(limitWarnings('reels', { ...fine, hashtags: ['#a', '#b', '#c', '#d', '#e', '#f'] })[0], /6 hashtags, and Instagram Reels takes at most 5/);
  assert.match(limitWarnings('x', { ...fine, duration: 150 })[0], /the video is 2:30 long, and X takes videos of up to 2 minutes 20 seconds/);
  assert.match(limitWarnings('youtube', { ...fine, duration: 16 * 60 })[0], /only from verified accounts/);
  assert.equal(limitWarnings('tiktok', { ...fine, box: '😀'.repeat(1101) }).length, 1, 'TikTok counts UTF-16 units');
});
