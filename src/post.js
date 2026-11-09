// What a post says on each platform. The agent writes post.json next to
// video.json, and package settles the words, the AI label and the credits for one
// platform and writes the result into the delivery folder.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError } from './errors.js';
import { listJobs } from './history.js';
import { oldImageLog } from './images.js';
import { findService } from './services.js';

// Where a package can go, with the size from FORMATS. The TikTok file has no
// watermark, because TikTok's rules for posting tools forbid one. X takes any
// size with --size.
export const PLATFORMS = {
  youtube: { name: 'YouTube', size: 'youtube' },
  shorts: { name: 'YouTube Shorts', size: 'shorts' },
  tiktok: { name: 'TikTok', size: 'tiktok', watermark: false },
  reels: { name: 'Instagram Reels', size: 'reels' },
  linkedin: { name: 'LinkedIn', size: 'linkedin' },
  x: { name: 'X', size: 'square', anySize: true },
};

// What each platform takes, from its help pages and its posting API on the date
// below. Platforms change these, so package warns and never stops on them.
export const LIMITS_CHECKED = '2026-11-07';
export const LIMITS = {
  youtube: { title: 100, description: 5000, seconds: 15 * 60, length: 'YouTube takes videos over 15 minutes only from verified accounts' },
  shorts: { title: 100, description: 5000, seconds: 3 * 60, length: 'YouTube makes Shorts of videos up to 3 minutes long' },
  tiktok: { text: 2200, seconds: 10 * 60, length: 'posting tools can send TikTok videos of up to 10 minutes' },
  reels: { text: 2200, hashtags: 5, seconds: 3 * 60, length: 'Instagram does not show Reels over 3 minutes to new viewers' },
  linkedin: { text: 3000, seconds: 15 * 60, length: 'LinkedIn takes videos of up to 15 minutes' },
  x: { text: 280, seconds: 140, length: 'X takes videos of up to 2 minutes 20 seconds from accounts without Premium' },
};

// YouTube's category for Education.
export const DEFAULT_CATEGORY = '27';
const FIELDS = ['title', 'description', 'hashtags', 'ai_label', 'credits', 'made_for_kids', 'category'];

function fail(message) {
  throw new ProjectError(message);
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// "dns", "#dns" and "#DNS" are one hashtag, stored with its #.
export function hashtag(word, where = 'hashtags') {
  const tag = String(word).trim().replace(/^#+/, '');
  if (!/^[\p{L}\p{M}\p{N}_]+$/u.test(tag)) fail(`${where}: "${String(word).slice(0, 60)}" is not a hashtag. A hashtag is one word of letters, digits and _, like "#dns".`);
  return `#${tag}`;
}

export function hashtagList(words, where) {
  const seen = new Set();
  return words.map((word) => hashtag(word, where)).filter((tag) => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
}

// The words for --hashtags, written as "dns networking" or "#dns,#networking".
export function hashtagFlag(value) {
  return hashtagList(String(value).split(/[\s,]+/).filter(Boolean), '--hashtags');
}

function checkWords(words, where, top) {
  if (!isObject(words)) fail(`${where} must be an object like { "title": "...", "description": "..." }`);
  const known = top ? [...FIELDS, 'platforms'] : FIELDS;
  const unknown = Object.keys(words).filter((key) => !known.includes(key));
  if (unknown.length) fail(`${where} has unknown setting(s): ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  const at = (key) => `${where}: ${key}`;
  if (words.title !== undefined && !(typeof words.title === 'string' && words.title.trim())) fail(`${at('title')} must be a short text`);
  if (words.description !== undefined && typeof words.description !== 'string') fail(`${at('description')} must be a text`);
  if (words.hashtags !== undefined) {
    if (!Array.isArray(words.hashtags)) fail(`${at('hashtags')} must be a list like ["#dns", "#networking"]`);
    hashtagList(words.hashtags, at('hashtags'));
  }
  if (words.ai_label !== undefined && typeof words.ai_label !== 'boolean') fail(`${at('ai_label')} must be true or false`);
  if (words.credits !== undefined && !(Array.isArray(words.credits) && words.credits.every((c) => typeof c === 'string' && c.trim()))) fail(`${at('credits')} must be a list of short texts, like ["Photos: Jane Doe"]`);
  if (words.made_for_kids !== undefined && typeof words.made_for_kids !== 'boolean') fail(`${at('made_for_kids')} must be true or false`);
  if (words.category !== undefined && !(['string', 'number'].includes(typeof words.category) && /^\d{1,3}$/.test(String(words.category)))) fail(`${at('category')} must be a YouTube category id like "27"`);
  if (top && words.platforms !== undefined) {
    if (!isObject(words.platforms)) fail(`${at('platforms')} must be an object like { "tiktok": { "description": "..." } }`);
    for (const [name, block] of Object.entries(words.platforms)) {
      if (!Object.hasOwn(PLATFORMS, name)) fail(`${at('platforms')} has "${name}", and the platforms are ${Object.keys(PLATFORMS).join(', ')}`);
      checkWords(block, `${where} platforms.${name}`, false);
    }
  }
}

// Which file the words came from, kept out of what is written anywhere.
const FROM = Symbol('file');

// post.json next to video.json, or post.<lang>.json when the version in another
// language has one. It is optional, and a mistake in it is an error that names the
// field. `project` can also be a project folder, for the main language.
export function readPostFile(project) {
  const own = typeof project === 'string' ? null : project.paths?.post;
  const file = own && fs.existsSync(own) ? own : path.join(typeof project === 'string' ? project : project.dir, 'post.json');
  const name = path.basename(file);
  if (!fs.existsSync(file)) return {};
  let words;
  try {
    words = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${name} is not valid JSON: ${e.message}`);
  }
  checkWords(words, name, true);
  return name === 'post.json' ? words : { ...words, [FROM]: name };
}

// Each field is settled in this order, and a later one wins: the defaults, then
// post.json, then its block for the platform, then the flags. Credits only add up.
export function settleWords(defaults, file, platform, flags = {}) {
  const block = file.platforms?.[platform] ?? {};
  const words = { ...defaults };
  for (const layer of [file, block, flags]) {
    for (const key of FIELDS) if (key !== 'credits' && layer[key] !== undefined) words[key] = layer[key];
  }
  words.credits = [...(file.credits ?? []), ...(block.credits ?? [])];
  words.hashtags = hashtagList(words.hashtags, 'hashtags');
  words.category = String(words.category);
  const name = file[FROM] ?? 'post.json';
  words.ai_label_from = block.ai_label !== undefined ? `${name} platforms.${platform}` : file.ai_label !== undefined ? name : null;
  return words;
}

function hasTag(text, tag) {
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])#${tag.slice(1)}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu').test(text);
}

// The words, then the hashtags they don't already have.
export function withHashtags(words, hashtags) {
  const missing = hashtags.filter((tag) => !hasTag(words, tag));
  return [words, missing.join(' ')].filter(Boolean).join('\n\n');
}

// What the project says about AI, from its settings and its record: a voice that
// is not a recording, and the AI clips and images that were bought. A bought file
// that no scene uses still counts, which errs on the side of saying too much.
export function aiFacts(project) {
  const reasons = [];
  const credits = [];
  const notes = [];
  const { voice, music } = project.config;
  const provider = typeof voice === 'string' ? 'kokoro' : voice.provider;
  const narrated = project.script.scenes.some((scene) => scene.units.some((unit) => unit.type === 'word'));
  if (narrated && provider !== 'recording') {
    const name = findService(provider)?.name ?? provider;
    reasons.push(`voice: ${name}`);
    credits.push(`Voice: ${name}`);
  }
  if (music?.src) {
    if (music.credit) credits.push(`Music: ${music.credit.trim()}`);
    else notes.push(`the music file ${music.src} has no credit. If its license asks for one, add "credit" to music in video.json.`);
  } else if (music) credits.push('Music: made by explainroo');
  const models = { clip: new Set(), image: new Set() };
  for (const job of listJobs(project.dir)) {
    if (Object.hasOwn(models, job.kind ?? '') && job.status === 'done' && typeof job.request?.model === 'string') models[job.kind].add(job.request.model);
  }
  for (const entry of oldImageLog(project)) if (typeof entry.model === 'string') models.image.add(entry.model);
  for (const model of models.clip) {
    reasons.push(`clip: ${model}`);
    credits.push(`Video clips: made with ${model}`);
  }
  for (const model of models.image) {
    reasons.push(`image: ${model}`);
    credits.push(`Illustrations: made with ${model}`);
  }
  // A presenter is a realistic AI person, which every platform asks to label.
  const presenters = new Set(listJobs(project.dir).filter((job) => job.kind === 'presenter' && job.status === 'done').map((job) => String(job.request?.avatar_name ?? job.request?.avatar ?? 'an avatar')));
  for (const name of presenters) {
    reasons.push(`presenter: ${name}, an AI person`);
    credits.push(`Presenter: ${name}, an AI person made by a presenter service`);
  }
  return { reasons, credits, notes, presenter: presenters.size > 0 };
}

function count(text, unit) {
  if (unit === 'bytes') return Buffer.byteLength(text);
  if (unit === 'utf16') return text.length;
  return [...text].length;
}

function clock(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Warnings about words and a length that a platform may not take.
export function limitWarnings(platform, { title, box, hashtags, duration }) {
  const limit = LIMITS[platform];
  const name = PLATFORMS[platform].name;
  const asOf = `(limits as of ${LIMITS_CHECKED})`;
  const warnings = [];
  const number = (n) => n.toLocaleString('en-US');
  if (limit.title && count(title) > limit.title) warnings.push(`the title has ${number(count(title))} characters, and ${name} takes ${number(limit.title)} ${asOf}.`);
  if (limit.description && count(box, 'bytes') > limit.description) warnings.push(`the description takes ${number(count(box, 'bytes'))} bytes, and ${name} takes ${number(limit.description)}. Letters with accents, other scripts and emoji take more than one byte each ${asOf}.`);
  const unit = platform === 'tiktok' ? 'utf16' : 'characters';
  if (limit.text && count(box, unit) > limit.text) warnings.push(`the text has ${number(count(box, unit))} characters, and ${name} takes ${number(limit.text)} ${asOf}.`);
  if (limit.hashtags && hashtags.length > limit.hashtags) warnings.push(`there are ${hashtags.length} hashtags, and ${name} takes at most ${limit.hashtags} on a post ${asOf}.`);
  if (duration > limit.seconds) warnings.push(`the video is ${clock(duration)} long, and ${limit.length} ${asOf}.`);
  return warnings;
}

// The settled words for one platform. `chapters` is the chapter list that YouTube
// reads from the description. `box` is what goes in the platform's text box, which
// description.txt holds: on YouTube and Shorts the title has its own field, so it
// is the description with the hashtags, and elsewhere it is `text`.
export function postWords(project, platform, { file = readPostFile(project), flags = {}, chapters = '', duration = 0 } = {}) {
  const facts = aiFacts(project);
  const words = settleWords({ title: project.config.title, description: '', hashtags: [], ai_label: facts.reasons.length > 0, made_for_kids: false, category: DEFAULT_CATEGORY }, file, platform, flags);
  const title = words.title.trim();
  const written = words.description.trim();
  const description = [written, platform === 'youtube' ? chapters.trim() : ''].filter(Boolean).join('\n\n');
  const text = withHashtags(description || title, words.hashtags);
  const box = platform === 'youtube' || platform === 'shorts' ? withHashtags(description, words.hashtags) : text;
  // A video with an AI presenter keeps its label, whatever post.json says.
  const overruled = facts.presenter && words.ai_label === false;
  if (overruled) words.ai_label = true;
  const reasons = words.ai_label_from && !overruled ? [...facts.reasons, `set to ${words.ai_label} in ${words.ai_label_from}`] : facts.reasons;
  const credits = [...new Set([...facts.credits, ...words.credits.map((c) => c.trim()), 'Made with explainroo'])];
  const warnings = [
    ...(written ? [] : [`there is no description yet. Write a few plain sentences about what the viewer learns as "description" in ${file[FROM] ?? 'post.json'} next to video.json.`]),
    ...facts.notes,
    ...(overruled ? [`${words.ai_label_from} sets ai_label to false, but the video has an AI presenter, so the AI label stays on.`] : []),
    ...limitWarnings(platform, { title, box, hashtags: words.hashtags, duration }),
  ];
  return { title, description, text, box, hashtags: words.hashtags, ai_label: words.ai_label, ai_presenter: facts.presenter, ai_reasons: reasons, credits, made_for_kids: words.made_for_kids, category: words.category, warnings };
}
