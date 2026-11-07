// AI video clips through OpenRouter. The price comes first, a cap is enforced, and
// each purchase has a job in the project record. The paid request goes out once.
// After that there are only reads, which cost nothing, so a run can die at any
// point and the next one picks up from the job id in the record.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ProjectError, ServiceError } from './errors.js';
import { createJob, decide, ensureIgnored, findJob, historyDir, jobKey, listAttempts, listJobs, placeOutput, projectWord, saveOutputFile, selfCommand, shortId, stopSentence, updateJob } from './history.js';
import { checkClipRequest, clipPrice } from './clip-price.js';
import { probe } from './ffmpeg.js';
import { serviceUrl, usd } from './services.js';
import openrouter from './connectors/openrouter.js';

export const CLIP_MODELS = {
  cheap: 'google/veo-3.1-lite',
  quality: 'google/veo-3.1',
};

export const DEFAULT_RESOLUTION = '720p';
// How long a run waits for the job, then says how to go on. OpenRouter's docs
// suggest reading the status about every 30 seconds. Tests set these shorter.
const waitMs = () => Number(process.env.EXPLAINROO_CLIP_WAIT_MS) || 10 * 60 * 1000;
const pollMs = () => Number(process.env.EXPLAINROO_CLIP_POLL_MS) || 30 * 1000;
const DOWNLOAD_TRIES = 3;
// A partial download older than this was left by a run that died.
const STALE_DOWNLOAD_MS = 60 * 60 * 1000;
// The paid request gets its answer within this time, or the run records that none came.
const SEND_MS = 2 * 60 * 1000;

// True while the run that claimed this attempt may still be waiting for the answer
// to its paid request. Only an older claim was left by a run that died.
function beingSent(job) {
  return job?.status === 'requesting' && !job.job_id && Date.now() - Date.parse(job.created) < SEND_MS + 30 * 1000;
}

// A short name from the prompt. The end comes from the whole prompt, so two prompts
// that start the same way don't take each other's file.
export function clipName(prompt) {
  const words = prompt.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const short = words.slice(0, 5).join('-').slice(0, 40).replace(/-$/, '') || 'clip';
  return `${short}-${crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 4)}`;
}

function clipModelId(name) {
  if (!name) return CLIP_MODELS.cheap;
  if (Object.hasOwn(CLIP_MODELS, name)) return CLIP_MODELS[name];
  if (/^[\w.-]+\/[\w.:-]+$/.test(name)) return name;
  throw new ProjectError(`--model must be "cheap", "quality" or an OpenRouter model id like ${CLIP_MODELS.cheap}`);
}

// What makes it the same clip, from what the command says. It needs no model list,
// so a job can be picked up with no connection to that list. Without a project,
// which only a dry run allows, the aspect is 16:9.
export function clipRequest(project, { prompt, seconds, aspect, model, resolution, audio = false, name }) {
  const text = String(prompt ?? '').trim();
  if (text.length < 8) throw new ProjectError('describe the clip in a sentence or two');
  if (seconds === undefined) throw new ProjectError('clip needs --seconds, because the length sets the price. --dry-run shows the price and spends nothing.');
  const frame = project?.config;
  const [, number, unit] = /^(\d+)([pk])$/i.exec(resolution ?? DEFAULT_RESOLUTION) ?? [];
  return {
    name: name ?? clipName(text),
    prompt: text,
    model: clipModelId(model),
    seconds,
    aspect: aspect ?? (!frame || frame.width > frame.height ? '16:9' : '9:16'),
    resolution: number ? `${number}${unit.toLowerCase() === 'k' ? 'K' : 'p'}` : resolution,
    audio: !!audio,
  };
}

function clipKey(request) {
  return jobKey({ kind: 'clip', provider: openrouter.id, ...request });
}

// The request of an earlier job, so a new session can continue it from its id. A job
// file can arrive with a stranger's project, so it has to fit the id it is stored under.
export function clipJobRequest(project, id) {
  const job = findJob(project.dir, id);
  if (job.kind !== 'clip' || !job.request) throw new ProjectError(`job ${id} is not a clip job. Run "explainroo history" to see what continues it.`);
  const { name, prompt, model, seconds, aspect, resolution, audio } = job.request;
  const request = { name, prompt, model, seconds, aspect, resolution, audio };
  if (clipKey(request) !== job.key) throw new ProjectError(`job ${id} does not match its own file, so it was not used. Run the clip command with the prompt instead.`);
  return request;
}

const publicName = (request) => `assets/clips/${request.name}.mp4`;
// Fills the frame and crops what doesn't fit, in any frame size. s.clip is silent
// unless it has a volume, so a clip bought with sound gets one.
const clipLine = (request) => `s.clip('${publicName(request)}', { w: s.safe.w, h: s.safe.h, fit: 'cover', ${request.audio ? 'volume: 1, ' : ''}at: 0 });`;

function clipSpend(project) {
  return Math.round(listJobs(project.dir).filter((job) => job.kind === 'clip').reduce((sum, job) => sum + (job.cost_usd || 0), 0) * 10000) / 10000;
}

function stopped(job, reason) {
  if (reason === 'unknown' && beingSent(job)) {
    return new ProjectError(`The clip "${job.request?.name}" with this prompt is job ${shortId(job)}. Another run sent its request less than three minutes ago and may still be waiting for the answer. Run the same command again in a minute or two, without --new. Once that run has the job id, this picks the job up and buys nothing.`);
  }
  const parts = [`The clip "${job.request?.name}" with this prompt is job ${shortId(job)}. ${stopSentence(job, reason)}`];
  if (reason === 'unknown') parts.push('So the request may or may not have gone through. The activity page of your OpenRouter account shows what was charged.');
  parts.push('To buy it again anyway, run the same command with --new.');
  return new ProjectError(parts.join(' '));
}

// The model's entry and the price, from the public list. This needs no key.
async function quote(request) {
  const models = await openrouter.videoModels();
  const model = models.find((m) => m.id === request.model);
  if (!model) throw new ProjectError(`${request.model} is not in OpenRouter's list of video models. Nothing was spent. The list has: ${models.map((m) => m.id).join(', ')}.`);
  checkClipRequest(model, request);
  const price = clipPrice(model, request);
  if (!price) {
    const others = Object.values(CLIP_MODELS).filter((id) => id !== request.model);
    throw new ProjectError(`the price of ${request.model} at these settings can't be worked out from OpenRouter's list, so nothing was spent. Try another model, such as ${others.join(' or ')}.`);
  }
  return { model, price };
}

function result(project, job, fields) {
  const r = job.request;
  return {
    job: shortId(job),
    attempt: job.attempt,
    name: r.name,
    file: path.join(project.dir, publicName(r)),
    clip_line: clipLine(r),
    model: r.model,
    seconds: r.seconds,
    aspect: r.aspect,
    resolution: r.resolution,
    audio: r.audio,
    time: job.created,
    estimated_usd: job.estimated_usd,
    cost_usd: job.cost_usd,
    max_cost_usd: job.max_cost_usd ?? null,
    total_usd: clipSpend(project),
    ...fields,
  };
}

function finished(project, job, { reused, moved, newer = null }) {
  const overCap = typeof job.cost_usd === 'number' && typeof job.max_cost_usd === 'number' && job.cost_usd > job.max_cost_usd;
  return result(project, job, { status: 'done', reused, moved, over_cap: overCap, ...(newer ? { newer_attempt: shortId(newer) } : {}) });
}

function stillRunning(project, job, why) {
  const command = `${selfCommand()} clip ${projectWord(project.dir)} --resume ${shortId(job)}`;
  return result(project, job, { status: 'running', why, command });
}

// Null when the file looks right, or else what is wrong with it. A problem running
// ffprobe itself says nothing about the file, so that one stops the run instead.
async function fileProblem(file, seconds) {
  let info;
  try {
    info = await probe(file);
  } catch (e) {
    if (e.code) throw e;
    return 'ffprobe could not read it as a video';
  }
  if (!info.streams.some((s) => s.codec_type === 'video')) return 'it has no video stream';
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration)) return 'it has no readable length';
  if (Math.abs(duration - seconds) > Math.max(1, seconds * 0.25)) return `it is ${duration.toFixed(1)} seconds long, and ${seconds} were asked for`;
  return null;
}

function removeStaleDownloads(folder) {
  for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder, name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (stat && Date.now() - stat.mtimeMs > STALE_DOWNLOAD_MS) fs.rmSync(file, { force: true });
  }
}

// Gets the finished file, checks it and puts it in place. A download can go again
// for free, so a problem with it leaves the job as it is.
async function fetchClip(project, job, { log }) {
  const { dir } = project;
  const folder = historyDir(dir, 'downloads');
  ensureIgnored(dir, 'history/downloads/');
  fs.mkdirSync(folder, { recursive: true });
  removeStaleDownloads(folder);
  const temp = path.join(folder, `${job.key}.${job.attempt}.${process.pid}.part`);
  for (let tries = 1; ; tries++) {
    try {
      log('downloading the clip');
      await openrouter.downloadVideo(dir, job.job_id, temp);
      break;
    } catch (e) {
      if (e.outcome === 'gone') throw stopped(updateJob(dir, job, { status: 'gone', error: e.message }), 'gone');
      if (e.outcome !== 'later') throw e;
      if (tries >= DOWNLOAD_TRIES) return stillRunning(project, job, `It has finished, but the download did not work: ${e.message}.`);
      await sleep(Math.min(pollMs(), 5000));
    }
  }
  try {
    const problem = await fileProblem(temp, job.request.seconds);
    if (problem) {
      const kept = `history/failed-check/${job.request.name}.${shortId(job)}.mp4`;
      fs.mkdirSync(path.join(dir, path.dirname(kept)), { recursive: true });
      fs.renameSync(temp, path.join(dir, kept));
      throw stopped(updateJob(dir, job, { status: 'failed-check', error: problem, kept }), 'failed-check');
    }
    const output = saveOutputFile(dir, publicName(job.request), temp);
    const placed = placeOutput(dir, updateJob(dir, job, { status: 'done', output }), [publicName(job.request)]);
    return finished(project, placed.job, { reused: false, moved: placed.moved });
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Reads the job until it ends or the wait is over. All of this is free, so it can
// be stopped at any point and started again.
async function followJob(project, job, { log, wait = waitMs() }) {
  const { dir } = project;
  if (!job.job_id) throw stopped(job, 'unknown');
  const started = Date.now();
  const deadline = started + wait;
  for (;;) {
    let seen = null;
    let trouble = null;
    try {
      seen = await openrouter.videoStatus(dir, job.job_id);
    } catch (e) {
      if (e.outcome === 'gone') throw stopped(updateJob(dir, job, { status: 'gone', error: e.message }), 'gone');
      if (e.outcome !== 'later') throw e;
      trouble = `Its status could not be read: ${e.message}.`;
    }
    if (seen?.status === 'completed') {
      const paid = seen.cost_usd === null ? job : updateJob(dir, job, { cost_usd: seen.cost_usd });
      return fetchClip(project, paid, { log });
    }
    if (['failed', 'cancelled', 'expired'].includes(seen?.status)) {
      throw stopped(updateJob(dir, job, { status: seen.status, cost_usd: seen.cost_usd, ...(seen.error ? { error: seen.error } : {}) }), seen.status);
    }
    const left = deadline - Date.now();
    if (left <= 0) return stillRunning(project, job, trouble ?? (wait ? `It is still running after ${Math.round(wait / 60000)} minutes.` : 'It is still running.'));
    log(trouble ?? `the job is ${seen.status}, ${Math.round((Date.now() - started) / 1000)}s so far`);
    await sleep(Math.min(pollMs(), left));
  }
}

// The settings and the price of a dry run, which a project and its record add to.
function priced(request, { model, price }, maxCost) {
  return {
    model: model.id,
    seconds: request.seconds,
    aspect: request.aspect,
    resolution: request.resolution,
    audio: request.audio,
    billed_audio: price.billed_audio,
    price_usd: price.usd,
    usd_per_second: price.usd_per_second,
    rate_name: price.rate_name,
    minimum_usd: price.minimum_usd,
    max_cost_usd: maxCost ?? null,
    within_cap: maxCost === undefined ? null : price.usd <= maxCost,
  };
}

function dryRun(project, request, quoted, decision, maxCost) {
  return {
    dry_run: true,
    project: project.dir,
    name: request.name,
    file: path.join(project.dir, publicName(request)),
    ...priced(request, quoted, maxCost),
    would: decision.action,
    ...(decision.job ? { job: shortId(decision.job) } : {}),
    ...(decision.reason ? { reason: decision.reason } : {}),
    ...(decision.action === 'stop' && beingSent(decision.job) ? { sending: true } : {}),
  };
}

// A dry run outside a project. It reads the price list like any dry run, and it has
// no record to look in and no folder for the file, so it writes nothing.
export async function quoteClip(request, { maxCost } = {}) {
  return { dry_run: true, project: null, ...priced(request, await quote(request), maxCost) };
}

export async function buyClip(project, request, { fresh = false, maxCost, dryRun: dry = false, noWait = false, log = () => {}, notice = () => {} } = {}) {
  const { dir } = project;
  if (!/^[\w-]+$/.test(request.name)) throw new ProjectError('the clip name may only use letters, digits, "-" and "_" (it becomes assets/clips/<name>.mp4)');
  const key = clipKey(request);
  let decision = decide(dir, key, { fresh });
  // --new never buys another while the last try of this request is still running or
  // being sent. That try was paid for, and a command with --new that is run again
  // after a timeout has to pick up its own job.
  const last = fresh ? listAttempts(dir, key).at(-1) : null;
  if (last?.status === 'running') decision = { action: 'resume', job: last, instead: true };
  else if (beingSent(last)) decision = { action: 'stop', job: last, reason: 'unknown' };
  if (dry) return dryRun(project, request, await quote(request), decision, maxCost);
  if (decision.action === 'use') {
    const placed = placeOutput(dir, decision.job, [publicName(request)]);
    return finished(project, placed.job, { reused: true, moved: placed.moved, newer: decision.newer });
  }
  if (decision.action === 'resume') {
    if (decision.instead) notice(`Job ${shortId(decision.job)} with this request is still running, so --new picks it up instead of buying another. Once it has finished, --new buys another.`);
    // With --no-wait it looks once, so the same command repeated still gets the file.
    return followJob(project, decision.job, { log, ...(noWait ? { wait: 0 } : {}) });
  }
  if (decision.action === 'stop') throw stopped(decision.job, decision.reason);

  // Nothing is written to the record until the request can really go out.
  if (maxCost === undefined) throw new ProjectError('this costs money, so it needs --max-cost. Ask the user how much they want to spend. --dry-run shows the price and spends nothing.');
  const { model, price } = await quote(request);
  if (price.usd > maxCost) throw new ProjectError(`this clip costs about ${usd(price.usd)}, which is above the cap of ${usd(maxCost)}. Nothing was spent. Ask the user whether to raise --max-cost, or make it shorter or smaller.`);
  openrouter.key(dir);
  serviceUrl(openrouter);
  let job;
  try {
    job = createJob(dir, key, { kind: 'clip', provider: openrouter.id, attempt: decision.attempt, estimated_usd: price.usd, max_cost_usd: maxCost, rate: { name: price.rate_name, usd_per_second: price.usd_per_second }, request });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw stopped(listAttempts(dir, key).find((a) => a.attempt === decision.attempt), 'unknown');
  }
  const body = {
    model: request.model,
    prompt: request.prompt,
    duration: request.seconds,
    aspect_ratio: request.aspect,
    ...(model.supported_resolutions?.length ? { resolution: request.resolution } : {}),
    // A model that can't take this setting isn't sent it. Its price has allowed for that.
    ...(model.generate_audio === true ? { generate_audio: request.audio } : {}),
  };
  let started;
  try {
    started = await openrouter.startVideo(dir, body, { timeout: SEND_MS });
  } catch (e) {
    const outcome = e instanceof ServiceError ? e.outcome : 'lost';
    updateJob(dir, job, { status: outcome, error: e.message });
    if (outcome === 'refused') throw e;
    throw new ServiceError(`${e.message.replace(/\.$/, '')}. That try may have cost money, so it is not sent again by itself. To buy it again anyway, run the same command with --new.`, outcome);
  }
  // The job id is saved before anything else, so a run that dies can be picked up.
  job = updateJob(dir, job, { status: 'running', job_id: started.id });
  notice(`Job ${shortId(job)} went out at about ${usd(price.usd)}. If this stops, run the same command again. It will not buy again.`);
  if (noWait) return stillRunning(project, job, 'It went out a moment ago.');
  return followJob(project, job, { log });
}

function moveLine(m) {
  return m.to ? `The file that was at ${m.from} moved to ${m.to}.${m.known ? ' Asking for its request again brings it back.' : ''}` : `The link that was at ${m.from} is gone. What it pointed at was not touched.`;
}

export function formatClip(r) {
  if (r.dry_run) {
    const lines = [
      `Model:  ${r.model}`,
      `Length: ${r.seconds} seconds`,
      `Size:   ${r.aspect}, ${r.resolution}`,
      `Sound:  ${r.audio ? 'on' : r.billed_audio ? 'on, because this model always makes sound, and the price counts it' : 'off'}`,
      `Price:  about ${usd(r.price_usd)} (${usd(r.usd_per_second)} a second, from "${r.rate_name}"${r.minimum_usd ? `, with a minimum charge of ${usd(r.minimum_usd)}` : ''})`,
      'That is an estimate. The real cost goes in the record after the job, and a failed try may cost money too.',
    ];
    if (r.within_cap === false) lines.push(`This is above the cap of ${usd(r.max_cost_usd)}, so the real run would refuse.`);
    if (r.project === null) {
      lines.push("No project was used, so the aspect is 16:9 unless --aspect says otherwise. In a project, it follows the project's frame.");
      lines.push('Nothing was spent. A clip is bought into a project. To buy it, put the project folder first and use --max-cost instead of --dry-run. Ask the user how much they want to spend.');
      return lines.join('\n');
    }
    if (r.would === 'use') lines.push(`This request is already bought (job ${r.job}), so the real run returns its file for free.`);
    if (r.would === 'resume') lines.push(`This request is already running (job ${r.job}), so the real run picks it up and buys nothing.`);
    if (r.would === 'stop') lines.push(r.sending ? `Another run is sending this request (job ${r.job}) right now, so the real run stops and asks you to wait for it.` : `An earlier try of this request (job ${r.job}) has no good result, so the real run stops and asks for --new.`);
    lines.push(r.would === 'buy' ? 'Nothing was spent. To buy it, run the same command without --dry-run and with --max-cost. Ask the user how much they want to spend.' : 'Nothing was spent.');
    return lines.join('\n');
  }
  const rel = publicName(r);
  if (r.status === 'running') {
    return `Job ${r.job} for ${rel}: ${r.why} To get the clip, run the same command again, which buys nothing, or run: ${r.command}`;
  }
  const lines = r.reused
    ? [`${rel}  already bought on ${r.time.slice(0, 10)} (job ${r.job}), so nothing was spent. To buy it again, add --new.`]
    : [`${rel}  ${r.model}  ${r.seconds}s ${r.aspect} ${r.resolution}${r.audio ? ' with sound' : ''}  ${r.cost_usd !== null ? usd(r.cost_usd) : `cost unknown, about ${usd(r.estimated_usd)}`}  (clips so far: ${usd(r.total_usd)})`];
  if (r.over_cap) lines.push(`It cost ${usd(r.cost_usd)}, which is above the cap of ${usd(r.max_cost_usd)}. The price before the job was an estimate.`);
  if (r.newer_attempt) lines.push(`A newer try, job ${r.newer_attempt}, has no good answer, so this is the earlier one.`);
  for (const m of r.moved) lines.push(moveLine(m));
  lines.push(`Use it in a scene, and put the word it should start on in "at":\n  ${r.clip_line}`);
  if (!r.reused) lines.push('Look at a still of that scene before you use it. AI clips get details wrong.');
  return lines.join('\n');
}
