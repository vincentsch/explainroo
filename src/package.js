// explainroo package: a delivery folder with everything a person or a tool needs
// to post a video on one platform, in out/package/<platform>/. It checks the
// exact setup it ships, reuses a render only when that render is this exact
// video, and verifies the file it wrote.
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, resolveSize, ProjectError } from './project.js';
import { prepare, renderIdentity, VERSION } from './pipeline.js';
import { check, verify } from './qa.js';
import { encodeVideo, versionLine, writeExtras } from './render.js';
import { buildChapters, toChaptersText } from './chapters.js';
import { moveFile, projectWord, readVersions, recordVersion, relativeFile, selfCommand, sha256File, versionLines } from './history.js';
import { PLATFORMS, hashtagFlag, postWords, readPostFile } from './post.js';
import { oneOf } from './services.js';

function fail(message) {
  throw new ProjectError(message);
}

export function packageDir(project, platform) {
  return path.join(project.paths.out, 'package', platform);
}

// The settings a package changes for its platform. A project whose own size gives
// the same frame and free area keeps it, so that its normal render can be reused.
export function packageOverrides(project, platform, size) {
  const spec = PLATFORMS[platform];
  if (size !== undefined && !spec.anySize) fail(`--size works only with --platform x. A ${platform} package always has the ${spec.size} size.`);
  const target = size ?? spec.size;
  const wanted = resolveSize(target);
  const own = resolveSize(project.config.size);
  const same = own.width === wanted.width && own.height === wanted.height && JSON.stringify(own.safe ?? null) === JSON.stringify(wanted.safe ?? null);
  return { ...(same ? {} : { size: target }), ...(spec.watermark === false ? { watermark: false } : {}) };
}

// A file in versions.jsonl can be anywhere, also in a stranger's project. Only a
// file inside this project is used.
function insideProject(dir, file) {
  try {
    const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(file));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// A render that the folder can use instead of rendering again: a final MP4 of the
// whole video at full scale, with the same frame, frame rate, size and watermark,
// made with the current render identity, and whose file still has the hash it
// was recorded with. Drafts, --scale renders and --from or --to renders never
// qualify. The newest one wins.
export function reusableRender(dir, lines, { width, height, fps, size, watermark, identity }) {
  for (const line of [...lines].reverse()) {
    if (line.format !== 'mp4' || line.draft !== false || line.transparent !== false || line.full !== true || line.scale !== 1) continue;
    if (line.width !== width || line.height !== height || line.fps !== fps || line.size !== size || line.watermark !== watermark || line.identity !== identity) continue;
    if (typeof line.file !== 'string' || typeof line.sha256 !== 'string') continue;
    const file = path.resolve(dir, line.file);
    if (insideProject(dir, file) && sha256File(file) === line.sha256) return { line, file };
  }
  return null;
}

// The report of an earlier verify of this exact file, if it is still there.
function earlierReport(dir, sha256) {
  for (const line of versionLines(dir).reverse()) {
    if (line.event !== 'verify' || line.sha256 !== sha256 || typeof line.report !== 'string') continue;
    const file = path.resolve(dir, line.report);
    if (!insideProject(dir, file)) continue;
    try {
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (report.sha256 === sha256 && Array.isArray(report.issues)) return report;
    } catch {}
  }
  return null;
}

function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function setupWords(project) {
  const { size, width, height, watermark } = project.config;
  return `the ${size} size (${width}x${height}), ${watermark === false ? 'without' : 'with'} the watermark`;
}

// Writes out/package/<platform>/. `title`, `description` and `hashtags` come from
// the flags and win over post.json.
export async function packageVideo(arg, { platform, size, title, description, hashtags, workers, log = () => {} } = {}) {
  if (platform === undefined) fail(`package needs --platform ${oneOf(Object.keys(PLATFORMS))}`);
  if (!Object.hasOwn(PLATFORMS, platform)) fail(`there is no platform "${platform}". The platforms are ${oneOf(Object.keys(PLATFORMS))}.`);
  if (title !== undefined && !title.trim()) fail('--title needs words');
  const spec = PLATFORMS[platform];
  const own = loadProject(arg);
  const overrides = packageOverrides(own, platform, size);
  const project = loadProject(own.dir, overrides);
  const { dir } = project;
  const file = readPostFile(dir);
  const flags = { title, description, hashtags: hashtags === undefined ? undefined : hashtagFlag(hashtags) };
  const setup = setupWords(project);

  // The check runs in the exact setup of the file, also when a render is reused.
  log(`checking the ${spec.name} package at ${setup}`);
  const checked = await check(project, { log });
  const errors = checked.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    const command = `${selfCommand()} check ${projectWord(dir)}${overrides.size ? ` --size ${overrides.size}` : ''}${overrides.watermark === false ? ' --no-watermark' : ''}`;
    const moved = overrides.size ? ` A layout made for ${own.config.size} may not fit ${overrides.size}, so place things from s.safe.` : '';
    return { ok: false, failed: 'check', platform, setup, command, issues: checked.issues, error: `the ${platform} package failed check at ${setup}, so nothing was packaged.${moved} To see the same findings, run: ${command}` };
  }

  const { timeline } = await prepare(project, { log });
  const identity = renderIdentity(project, timeline);
  const folder = packageDir(project, platform);
  const target = path.join(folder, 'video.mp4');
  const { width, height, fps } = project.config;
  const watermark = project.config.watermark !== false;
  const found = reusableRender(dir, readVersions(dir), { width, height, fps, size: project.config.size, watermark, identity });
  fs.mkdirSync(folder, { recursive: true });
  let video;
  let source;
  if (found && found.file === target) {
    video = { ...found.line, out: target };
    source = { how: 'kept', file: null };
    log(`${relativeFile(dir, target)} is still this exact video, so it stays`);
  } else {
    // Until its post.json is written again, the folder is not a package.
    fs.rmSync(path.join(folder, 'post.json'), { force: true });
    const temp = path.join(project.paths.build, `package-${platform}.mp4`);
    fs.mkdirSync(project.paths.build, { recursive: true });
    if (found) {
      log(`${relativeFile(dir, found.file)} is this exact video, so it is copied instead of rendered again`);
      fs.copyFileSync(found.file, temp, fs.constants.COPYFILE_FICLONE);
      video = { ...found.line, out: target };
      source = { how: 'copied', file: relativeFile(dir, found.file) };
    } else {
      video = { ...(await encodeVideo(project, timeline, { format: 'mp4', out: temp, workers, log })), out: target };
      source = { how: 'rendered', file: null };
    }
    moveFile(temp, target);
    recordVersion(dir, { event: 'package', platform, ...versionLine(project, video), source: source.file });
  }

  const extras = await writeExtras(project, timeline, path.join(folder, 'video'), { chapters: platform === 'youtube', log });
  const earlier = earlierReport(dir, video.sha256);
  const reportFile = path.join(folder, 'report.json');
  let report;
  if (earlier) {
    report = { ...earlier, file: target };
    writeAtomic(reportFile, JSON.stringify(report, null, 2));
  } else report = await verify(project, { file: target, report: reportFile, log });

  const chapters = platform === 'youtube' ? toChaptersText(buildChapters(timeline, project.script.title || project.config.title)) : '';
  const words = postWords(project, platform, { file, flags, chapters, duration: video.duration });
  const level = (name) => report.issues.filter((i) => i.level === name).map((i) => i.message);
  const files = {
    video: 'video.mp4',
    cover: extras.cover ? 'video.cover.jpg' : null,
    subtitles: extras.subtitles ? { srt: 'video.srt', vtt: 'video.vtt' } : null,
    chapters: extras.chapters ? 'video.chapters.txt' : null,
    description: 'description.txt',
    credits: 'credits.txt',
    report: 'report.json',
  };
  const post = {
    platform,
    title: words.title,
    description: words.description,
    text: words.text,
    hashtags: words.hashtags,
    ai_label: words.ai_label,
    ai_reasons: words.ai_reasons,
    credits: words.credits,
    made_for_kids: words.made_for_kids,
    category: words.category,
    size: project.config.size,
    width: video.width,
    height: video.height,
    fps: video.fps,
    duration: video.duration,
    watermark,
    file: 'video.mp4',
    sha256: video.sha256,
    identity,
    verify: { ok: !level('error').length, errors: level('error'), warnings: level('warn'), loudness: report.loudness?.integrated ?? null, understood: report.speech?.matchRate ?? null, report: 'report.json' },
    warnings: [
      ...words.warnings.map((message) => ({ from: 'post', message })),
      ...checked.issues.filter((i) => i.level === 'warn').map((i) => ({ from: 'check', scene: i.scene ?? null, t: i.t ?? null, message: i.message })),
    ],
    files,
    made: new Date().toISOString(),
    version: VERSION,
  };
  writeAtomic(path.join(folder, 'description.txt'), words.box ? `${words.box}\n` : '');
  writeAtomic(path.join(folder, 'credits.txt'), `${words.credits.join('\n')}\n`);
  // Written last: a folder with a post.json is complete.
  writeAtomic(path.join(folder, 'post.json'), JSON.stringify(post, null, 2) + '\n');
  return { ok: post.verify.ok, platform, folder, setup, source, verified: earlier ? 'earlier' : 'now', post };
}

function oneLine(text, length = 100) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

export function formatPackage(r) {
  if (r.failed === 'check') {
    const lines = r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.scene ?? ''}${i.t !== null && i.t !== undefined ? ' @' + i.t + 's' : ''}: ${i.message}`);
    return [...lines, `error: ${r.error}`].join('\n');
  }
  const p = r.post;
  const name = PLATFORMS[r.platform].name;
  const how = r.source.how === 'rendered' ? 'rendered now' : r.source.how === 'copied' ? `copied from ${r.source.file}` : 'the same file as before';
  const { video, subtitles, cover, chapters, description, credits, report } = p.files;
  const listed = [video, 'post.json', description, ...(subtitles ? [subtitles.srt, subtitles.vtt] : []), cover, chapters, credits, report].filter(Boolean);
  const lines = [
    `${name} package in ${path.relative(process.cwd(), r.folder) || r.folder}`,
    `  ${listed.join(', ')}`,
    `Video: ${p.width}x${p.height}, ${p.duration.toFixed(1)}s, ${p.watermark ? 'with' : 'without'} the watermark, ${how}`,
    `Title: ${oneLine(p.title)}`,
    `Text: ${oneLine(p.text)}`,
    `AI label: ${p.ai_label ? 'yes' : 'no'}${p.ai_reasons.length ? ` (${p.ai_reasons.join(', ')})` : ''}`,
    `Credits: ${p.credits.join('; ')}`,
    `verify: ${p.verify.ok ? 'passed' : 'found errors'}${p.verify.understood === null ? '' : `, ${Math.round(p.verify.understood * 100)}% of the narration understood`}${r.verified === 'earlier' ? ' (from an earlier verify of this exact file)' : ''}`,
    ...p.verify.errors.map((m) => `ERROR ${m}`),
    ...p.verify.warnings.map((m) => `WARN  ${m}`),
  ];
  if (p.warnings.length) {
    lines.push('Warnings:');
    for (const w of p.warnings) lines.push(`  ${w.from === 'check' ? `check ${w.scene ?? ''}${w.t !== null ? ` @${w.t}s` : ''}: ` : ''}${w.message}`);
  }
  if (!p.verify.ok) lines.push('Fix the errors and package it again before you post it.');
  if (r.platform === 'tiktok') lines.push('The TikTok file has no watermark, because TikTok asks apps that post to it to add no logo or watermark. "explainroo docs publishing" says more.');
  return lines.join('\n');
}
