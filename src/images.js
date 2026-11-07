// Optional illustrations through OpenRouter. Each purchase has a job in the
// project record (history/), so the same request never buys twice. Spending from
// before the record is still in build/images/usage.jsonl, and images reads both.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError, ServiceError } from './errors.js';
import { createJob, decide, findJob, jobKey, listAttempts, listJobs, placeOutput, projectWord, relativeFile, saveOutput, selfCommand, sha256File, shortId, stopSentence, updateJob } from './history.js';
import { serviceUrl } from './services.js';
import openrouter from './connectors/openrouter.js';

export const IMAGE_MODELS = {
  best: 'openai/gpt-5.4-image-2',
  cheap: 'google/gemini-3.1-flash-image',
};

// Rough prices per image for the record. The real price comes with the answer.
const ESTIMATED_USD = { [IMAGE_MODELS.best]: 0.13, [IMAGE_MODELS.cheap]: 0.07 };

const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'];

export const DEFAULT_STYLE =
  'Flat illustration for a friendly how-to video, soft colors, simple shapes, clear subject in the middle, plain light background, no text, no letters, no numbers, no logos, no watermark.';

export function findKey(projectDir) {
  return openrouter.findKey(projectDir);
}

export function resolveModel(name) {
  if (!name) return IMAGE_MODELS.best;
  if (IMAGE_MODELS[name]) return IMAGE_MODELS[name];
  if (/^[\w.-]+\/[\w.:-]+$/.test(name)) return name;
  throw new ProjectError(`image model must be "best", "cheap" or an OpenRouter model id like ${IMAGE_MODELS.best}`);
}

function toDataUrl(file) {
  const ext = path.extname(file).toLowerCase().slice(1);
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function publicNames(name) {
  return ['png', 'jpg', 'webp'].map((ext) => `assets/${name}.${ext}`);
}

function stopped(project, job, reason, label) {
  const parts = [`${label} is job ${shortId(job)}. ${stopSentence(job, reason)}`];
  if (reason === 'unknown') parts.push(`To check, run "${selfCommand()} history ${projectWord(project.dir)}" again in a few minutes: a run that is still working saves its result within 5 minutes. The activity page of your OpenRouter account shows what was charged.`);
  parts.push('To buy it again anyway, run the same command with --new.');
  return new ProjectError(parts.join(' '));
}

function jobEntry(job) {
  const r = job.request || {};
  return {
    time: job.created,
    name: r.name,
    file: job.output?.name ?? `assets/${r.name}`,
    provider: job.provider,
    model: r.model ?? '?',
    served_by: job.served_by ?? r.model,
    aspect: r.aspect,
    prompt: r.prompt,
    style: r.style,
    refs: (r.refs || []).map((ref) => ref.file),
    cost_usd: job.cost_usd,
    prompt_tokens: job.prompt_tokens ?? null,
    completion_tokens: job.completion_tokens ?? null,
    seconds: job.seconds ?? null,
    bytes: job.output?.bytes ?? null,
    sha256: job.output?.sha256 ?? null,
    job: shortId(job),
    attempt: job.attempt,
    status: job.status,
  };
}

function finished(project, job, { reused, moved, newer = null }) {
  return { ...jobEntry(job), file: path.join(project.dir, job.output.name), total_usd: imageSpend(project), reused, moved, ...(newer ? { newer_attempt: shortId(newer) } : {}) };
}

// Saves one image as assets/<name>.<ext>, unless the same request already has
// one. The name and the prompt are part of the key, so changing either one makes
// a new image, and `fresh` buys this one again anyway.
export async function generateImage(project, { name, prompt, model, aspect, refs = [], style, fresh = false, resumes = null, log = () => {}, timeout } = {}) {
  if (!name || !/^[\w-]+$/.test(name)) throw new ProjectError('the image name may only use letters, digits, "-" and "_" (it becomes assets/<name>.png)');
  if (!prompt || prompt.trim().length < 8) throw new ProjectError('describe the image in a sentence or two');
  const dir = project.dir;
  const cfg = project.config.images || {};
  const modelId = resolveModel(model || cfg.model);
  const ratio = aspect || (project.config.height > project.config.width ? '9:16' : project.config.height === project.config.width ? '1:1' : '16:9');
  if (!ASPECTS.includes(ratio)) throw new ProjectError(`aspect must be one of ${ASPECTS.join(', ')}`);
  const styleText = style === false ? '' : (style || cfg.style || DEFAULT_STYLE);
  const text = `${prompt.trim()}\n\nStyle: ${styleText}\nAspect ratio: ${ratio}.`.trim();
  const refFiles = refs.map((r) => {
    // Accept paths relative to the project (assets/a.png) or to the current folder.
    const file = [path.resolve(dir, r), path.resolve(r)].find((f) => fs.existsSync(f));
    if (!file) throw new ProjectError(`reference image ${r} does not exist (use a path like assets/${path.basename(r)})`);
    return { abs: file, file: relativeFile(dir, file), sha256: sha256File(file) };
  });
  const request = { name, prompt: prompt.trim(), model: modelId, aspect: ratio, style: styleText, refs: refFiles.map(({ file, sha256 }) => ({ file, sha256 })) };
  const key = jobKey({ kind: 'image', provider: openrouter.id, name, prompt: request.prompt, model: modelId, aspect: ratio, style: styleText, refs: refFiles.map((r) => r.sha256) });
  if (resumes && resumes !== key) throw new ProjectError('a reference image of that job has changed since then. Run the image command with the new reference, or put the old file back.');
  const label = `The image "${name}" with this prompt`;

  const decision = decide(dir, key, { fresh });
  if (decision.action === 'use') {
    const placed = placeOutput(dir, decision.job, decision.file, publicNames(name));
    return finished(project, placed.job, { reused: true, moved: placed.moved, newer: decision.newer });
  }
  if (decision.action !== 'buy') throw stopped(project, decision.job, decision.reason, label);

  // Nothing is written to the record until the request can really go out.
  openrouter.key(dir);
  serviceUrl(openrouter);
  let job;
  try {
    job = createJob(dir, key, { kind: 'image', provider: openrouter.id, attempt: decision.attempt, estimated_usd: ESTIMATED_USD[modelId] ?? null, request });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw stopped(project, listAttempts(dir, key).find((a) => a.attempt === decision.attempt), 'unknown', label);
  }
  const t0 = Date.now();
  let result;
  try {
    result = await openrouter.image(dir, { model: modelId, text, refs: refFiles.map((r) => toDataUrl(r.abs)), aspect: ratio }, { log, timeout });
  } catch (e) {
    const outcome = e instanceof ServiceError ? e.outcome : 'lost';
    updateJob(dir, job, { status: outcome, error: e.message, ...(e.details?.cost_usd != null ? { cost_usd: e.details.cost_usd } : {}) });
    if (outcome === 'refused') throw e;
    throw new ServiceError(`${e.message.replace(/\.$/, '')}. That try may have cost money, so it is not sent again by itself. To buy it again anyway, run the same command with --new.`, outcome);
  }
  // The answer is saved and recorded before anything else happens to it.
  const output = saveOutput(dir, `assets/${name}.${result.ext}`, result.bytes);
  const done = updateJob(dir, job, {
    status: 'done',
    cost_usd: result.cost_usd,
    output,
    served_by: result.served_by,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  });
  const placed = placeOutput(dir, done, output.file, publicNames(name));
  return finished(project, placed.job, { reused: false, moved: placed.moved });
}

// The request of an earlier job, so a new session can continue it from its id.
export function jobRequest(project, id) {
  const job = findJob(project.dir, id);
  if (job.kind !== 'image' || !job.request) throw new ProjectError(`job ${id} is not an image job. Run "explainroo history" to see what continues it.`);
  const r = job.request;
  return { name: r.name, prompt: r.prompt, model: r.model, aspect: r.aspect, style: r.style === '' ? false : r.style, refs: r.refs.map((ref) => ref.file), resumes: job.key };
}

// Every image request: the old log, then the record.
export function imageLog(project) {
  const p = path.join(project.paths.build, 'images', 'usage.jsonl');
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return [...old, ...listJobs(project.dir).filter((job) => job.kind === 'image').map(jobEntry)];
}

// The requests that only the old log knows about, for the spend in history.
export function oldImageLog(project) {
  return imageLog(project).filter((entry) => !entry.job);
}

export function imageSpend(project) {
  return Math.round(imageLog(project).reduce((a, e) => a + (e.cost_usd || 0), 0) * 10000) / 10000;
}
