// explainroo share: uploads a finished video to the hosted service, only when
// asked, and gives back a page link. The record keeps each upload, so the same file
// is not sent twice by accident, and an upload that lost its answer is never sent
// again by itself, because the server may have the video.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cloud, { SHARE_TYPES, shareAnswer } from './connectors/cloud.js';
import { ProjectError, ServiceError } from './errors.js';
import { createJob, forgetJob, historyDir, jobKey, listAttempts, projectWord, readVersions, relativeFile, selfCommand, sha256File, updateJob, writePrivate } from './history.js';
import { outputPath } from './project.js';
import { packageDir } from './package.js';
import { PLATFORMS } from './post.js';
import { oneOf, serviceUrl } from './services.js';

function fail(message) {
  throw new ProjectError(message);
}

function when(iso) {
  return `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
}

// The file to send and its title: a package with --platform, any file with
// --file, and otherwise the final video.
function shareTarget(project, { platform, file }) {
  const { dir } = project;
  const run = (command) => `"${selfCommand()} ${command} ${projectWord(dir)}${command === 'package' ? ` --platform ${platform}` : ''}"`;
  if (file !== undefined) {
    const chosen = path.resolve(file);
    if (!fs.existsSync(chosen) || !fs.statSync(chosen).isFile()) fail(`${file} does not exist.`);
    return { file: chosen, title: project.config.title, chosen: true };
  }
  if (platform !== undefined) {
    if (!Object.hasOwn(PLATFORMS, platform)) fail(`there is no platform "${platform}". The platforms are ${oneOf(Object.keys(PLATFORMS))}.`);
    const folder = packageDir(project, platform);
    const video = path.join(folder, 'video.mp4');
    let post;
    try {
      post = JSON.parse(fs.readFileSync(path.join(folder, 'post.json'), 'utf8'));
    } catch {
      fail(`there is no ${platform} package to share yet. Run ${run('package')} first.`);
    }
    if (!fs.existsSync(video) || sha256File(video) !== post.sha256) fail(`${relativeFile(dir, video)} is not the video its post.json describes. Run ${run('package')} again.`);
    return { file: video, title: typeof post.title === 'string' && post.title.trim() ? post.title.trim() : project.config.title };
  }
  const video = outputPath(project, 'video', '.mp4');
  if (!fs.existsSync(video)) {
    const draft = outputPath(project, 'draft', '.mp4');
    const drafted = fs.existsSync(draft) ? ` ${relativeFile(dir, draft)} is a half-size draft, so share never picks it. To share it anyway, pass it with --file.` : '';
    fail(`${relativeFile(dir, video)} does not exist yet. Run ${run('render')} first, or share a package with --platform.${drafted}`);
  }
  return { file: video, title: project.config.title };
}

// Renders are exact, and history/ goes into git, so a copy of someone's project can
// make the very same file. Each copy shares on its own: the key of a share holds an
// id from history/private/, which git leaves out, so a copy never takes another
// copy's link or unanswered upload for its own.
function copyId(dir) {
  const file = historyDir(dir, 'private', 'copy.json');
  const read = () => {
    try {
      const { id } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return /^[0-9a-f]{32}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  };
  const found = read();
  if (found) return found;
  // A link to a whole file is made at once, so two runs agree on one id.
  const temp = writePrivate(dir, `copy.json.${process.pid}`, { id: crypto.randomBytes(16).toString('hex') });
  try {
    fs.linkSync(temp, file);
  } catch (e) {
    // A file system without links gets the plain way.
    if (e.code !== 'EEXIST' && !fs.existsSync(file)) fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return read() ?? fail(`${relativeFile(dir, file)} can't be read. Remove it and run the same command again.`);
}

export function shareKey(dir, sha256, service = serviceUrl(cloud)) {
  return jobKey({ kind: 'share', service, sha256, copy: copyId(dir) });
}

// A link that still works. One without an expiry belongs to an account.
function liveLink(job) {
  if (job.status !== 'done' || !shareAnswer(job.result)) return false;
  const expires = job.result.expires_at;
  return expires === null || Date.parse(expires) > Date.now();
}

// The newest working link for this exact file from this copy of the project, or null.
export function liveShare(project, sha256) {
  const job = listAttempts(project.dir, shareKey(project.dir, sha256)).reverse().find(liveLink);
  return job ? result(project.dir, job, { reused: true }) : null;
}

// The same rules as for buying: a working link is used again, an upload that the
// service refused can go again, and one that may have reached the server waits
// for --new.
function decide(dir, key, fresh) {
  const attempts = listAttempts(dir, key);
  const newest = attempts.at(-1);
  const attempt = (newest?.attempt ?? 0) + 1;
  if (!newest || fresh) return { action: 'upload', attempt };
  const live = [...attempts].reverse().find(liveLink);
  if (live) return { action: 'use', job: live, newer: live === newest ? null : newest };
  if (newest.status === 'refused' || newest.status === 'done') return { action: 'upload', attempt };
  return { action: 'stop', job: newest };
}

const NOT_AGAIN = 'No share link was received. The server may have received the video. Explainroo will not upload it again automatically. To upload it again anyway, run the same command with --new.';

function stopped(job) {
  if (job.status === 'requesting') return new ProjectError(`an upload of this file started on ${when(job.created)}, and no answer was saved. Another run may still be uploading it, or a run stopped before the answer came. ${NOT_AGAIN}`);
  return new ProjectError(`an upload of this file on ${when(job.created)} ended without an answer. ${NOT_AGAIN}`);
}

function privateFile(job) {
  return `share-${job.key}${job.attempt > 1 ? `.${job.attempt}` : ''}.json`;
}

function claimUrl(dir, job) {
  try {
    const saved = JSON.parse(fs.readFileSync(historyDir(dir, 'private', privateFile(job)), 'utf8'));
    return typeof saved.claim_url === 'string' ? saved.claim_url : null;
  } catch {
    return null;
  }
}

function retryWords(value) {
  if (value && /^\d+$/.test(value.trim())) {
    const seconds = Number(value);
    return seconds < 120 ? `in ${seconds} seconds` : `in ${Math.ceil(seconds / 60)} minutes`;
  }
  return value && !Number.isNaN(Date.parse(value)) ? `after ${when(new Date(value).toISOString())}` : 'later';
}

// What the user is told depends on what really happened, and it never claims more.
function failure(e, dir) {
  const d = e.details;
  const others = `You can still put the video online yourself: "${selfCommand()} export ${projectWord(dir)}" writes a web player for your own site, and "${selfCommand()} package ${projectWord(dir)} --platform <name>" makes a folder to upload by hand.`;
  const heard = d.said ? `: ${d.said}` : '';
  switch (d.reason) {
    case 'unreachable': return `the hosted service doesn't answer at ${d.service} yet. The video was not sent. ${others}`;
    case 'insecure': return `the connection to ${d.service} failed its security check (${d.code}). The video was not sent. Check the address and your network, and run the same command again.`;
    case 'not-sent': return `${e.message}. The video was not sent.`;
    case 'not-running': return `the hosted service isn't running at ${d.service} yet (it answered with HTTP ${d.status}). No share link was made. ${others}`;
    case 'key': return d.keyed
      ? `the hosted service rejected the key in EXPLAINROO_CLOUD_KEY (HTTP 401${heard}). No share link was made, and the video was not shared without the key. Check the key and run the same command again.`
      : `the hosted service at ${d.service} wants a key (HTTP 401${heard}). No share link was made. Put a key from your explainroo.com account in EXPLAINROO_CLOUD_KEY and run the same command again.`;
    case 'file': return `the hosted service refused the file (HTTP ${d.status}${heard}). No share link was made. ${d.status === 413 ? 'The file is too large for it. A shorter video helps.' : d.status === 415 ? 'It takes MP4 and WebM files with a video stream.' : 'Change what it names and run the same command again.'}`;
    case 'busy': return `the hosted service has had too many uploads. Try again ${retryWords(d.retry_after)}. No share link was made.`;
    case 'checking': return 'the hosted service could not check the file in time and published nothing. Try again later.';
    case 'said-no': return `the hosted service refused the upload (HTTP ${d.status}${heard}). No share link was made.`;
    case 'server': return `the hosted service answered with HTTP ${d.status}. ${NOT_AGAIN}`;
    // The connection dropped during the upload, or it took too long.
    default: return `${e.message}. ${NOT_AGAIN}`;
  }
}

// `asked` is what this run wanted to share. A link used again may have gone out
// under another file name or title, and the result says so.
function result(dir, job, { reused, newer = null, asked = job.request }) {
  const r = job.result;
  return {
    id: r.id,
    url: r.url,
    media_url: r.media_url,
    expires_at: r.expires_at,
    claim_url: reused ? claimUrl(dir, job) : r.claim_url,
    file: asked.file,
    sha256: job.request.sha256,
    title: job.request.title,
    shared: job.updated,
    reused,
    ...(asked.file !== job.request.file ? { shared_file: job.request.file } : {}),
    ...(asked.title !== job.request.title ? { asked_title: asked.title } : {}),
    ...(newer ? { newer_attempt: newer.attempt } : {}),
  };
}

export async function share(project, { platform, file, title, fresh = false, log = () => {} } = {}) {
  const { dir } = project;
  if (platform !== undefined && file !== undefined) fail('share takes --platform or --file, not both.');
  if (title !== undefined && !title.trim()) fail('--title needs words');
  const target = shareTarget(project, { platform, file });
  const name = relativeFile(dir, target.file);
  if (!Object.hasOwn(SHARE_TYPES, path.extname(target.file).toLowerCase())) fail(`the hosted service takes MP4 and WebM files only, and ${name} is neither. Nothing was sent.`);
  const sha256 = sha256File(target.file);
  const recorded = readVersions(dir).filter((v) => v.sha256 === sha256);
  if (!target.chosen && recorded.some((v) => v.draft) && !recorded.some((v) => !v.draft)) fail(`${name} is a half-size draft, so share does not send it. Render the final video, or pass the file with --file to share it anyway.`);
  const service = serviceUrl(cloud);
  cloud.key(dir);
  const key = shareKey(dir, sha256, service);
  // A path outside the project stays out of the record, which git keeps.
  const asked = { file: path.isAbsolute(name) ? path.basename(name) : name, title: title?.trim() ?? target.title };
  const decision = decide(dir, key, fresh);
  if (decision.action === 'use') return result(dir, decision.job, { reused: true, newer: decision.newer, asked });
  if (decision.action === 'stop') throw stopped(decision.job);
  const bytes = fs.statSync(target.file).size;
  const request = { ...asked, sha256, bytes, service };
  let job;
  try {
    job = createJob(dir, key, { kind: 'share', provider: cloud.id, attempt: decision.attempt, cost_usd: 0, request });
  } catch (e) {
    // Another run claimed the same upload a moment ago.
    if (e.code === 'EEXIST') throw stopped(listAttempts(dir, key).find((a) => a.attempt === decision.attempt) ?? { status: 'requesting', created: new Date().toISOString() });
    throw e;
  }
  log(`uploading ${name} (${(bytes / 1e6).toFixed(1)} MB) to ${service}`);
  let answer;
  try {
    answer = await cloud.share(dir, { file: target.file, title: request.title });
  } catch (e) {
    // Nothing left this computer, so there is nothing to remember. An error that is
    // not from the request itself came before anything was sent, too.
    if (!(e instanceof ServiceError) || ['unreachable', 'insecure', 'not-sent'].includes(e.details.reason)) forgetJob(dir, job);
    else updateJob(dir, job, { status: e.outcome, error: e.message, reason: e.details.reason });
    if (e instanceof ServiceError) throw new ProjectError(failure(e, dir));
    throw e;
  }
  // A claim link acts like a password for the video, so it stays out of tracked
  // files. It is saved first, so a run that stops now can't lose it.
  if (answer.claim_url) writePrivate(dir, privateFile(job), { id: answer.id, claim_url: answer.claim_url });
  const done = updateJob(dir, job, { status: 'done', job_id: answer.id, result: { id: answer.id, url: answer.url, media_url: answer.media_url, expires_at: answer.expires_at } });
  return result(dir, { ...done, result: { ...done.result, claim_url: answer.claim_url } }, { reused: false });
}

export function formatShare(r) {
  const lines = [
    r.reused ? `${r.file} was already shared on ${when(r.shared)}${r.shared_file ? `, as the same file ${r.shared_file}` : ''}, so nothing was uploaded.` : `Shared ${r.file} as "${r.title}".`,
    ...(r.reused ? [r.asked_title !== undefined ? `It was shared as "${r.title}". To share it as "${r.asked_title}", run the same command with --new.` : 'To upload it again anyway, run the same command with --new.'] : []),
    ...(r.newer_attempt ? [`A newer upload of it, try ${r.newer_attempt}, got no link, so this is the earlier one.`] : []),
    `Page: ${r.url}`,
    ...(r.media_url ? [`Video file, for posting tools: ${r.media_url}`] : []),
  ];
  if (r.expires_at === null) lines.push('It belongs to the account of the key in EXPLAINROO_CLOUD_KEY, so the link does not expire.');
  else {
    lines.push(`The link expires on ${when(r.expires_at)}.`);
    if (r.claim_url) lines.push(`To keep it, open this claim link and add the video to an account. Anyone with the claim link can take the video, so keep it to yourself:\n${r.claim_url}`);
  }
  return lines.join('\n');
}
