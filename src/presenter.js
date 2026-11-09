// "explainroo presenter": a clip of an AI presenter who speaks one scene's
// narration, saved as assets/presenters/<name>.mp4 for s.presenter. The scene's
// own narration goes to the service, so the presenter's lips follow the voice of
// the video. Each clip is a job in the project record, so it is never bought twice.
//
// The consent rule: no real person's face or voice without the consent flow of
// the presenter service. An avatar with a real person's face needs that person's
// verified consent for their face, and narration from a recording, which is a
// real person's voice, needs it for their voice too. explainroo never sends a
// photo or a voice sample of its own. Anything else is refused before a request
// goes out, so a refusal costs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError, ServiceError } from './errors.js';
import { createJob, decide, jobKey, listAttempts, placeOutput, projectWord, saveOutput, selfCommand, sha256File, shortId, stopSentence, updateJob } from './history.js';
import { scriptName } from './project.js';
import { voicePaths } from './voice.js';
import { readWav } from './wav.js';
import presenter from './connectors/presenter.js';

// Flags that would send a face or a voice of explainroo's own. There are none,
// and asking for one gets the rule.
export const LIKENESS_FLAGS = ['photo', 'face', 'image', 'voice-sample', 'clone'];

export function consentRule() {
  return 'explainroo never makes a real person\'s face or voice without the consent flow of the presenter service. The person finishes that flow at the service, and its avatar then shows the consent as verified.';
}

// Why an avatar can't be used for this project, or null when it can.
export function consentProblem(avatar, project) {
  const recorded = project.config.voice?.provider === 'recording';
  const verified = avatar.consent.status === 'verified';
  if (avatar.likeness !== 'synthetic' && !(verified && avatar.consent.covers.includes('face'))) {
    const state = avatar.consent.status === 'pending' ? 'its consent is still pending' : 'the service has no verified consent from that person';
    return `the avatar "${avatar.name}" shows a real person, and ${state}. ${consentRule()} Pick a made-up avatar, or ask the user to have the person finish that flow.`;
  }
  if (recorded && !(verified && avatar.consent.covers.includes('voice'))) {
    return `the narration is a recording, which is a real person's voice, and the avatar "${avatar.name}" has no verified consent for that voice. ${consentRule()} Use a made-up voice like Kokoro, or ask the user to have the speaker finish that flow for their voice.`;
  }
  return null;
}

function checkName(name) {
  if (!/^[\w-]+$/.test(name)) throw new ProjectError('the presenter name may only use letters, digits, "-" and "_" (it becomes assets/presenters/<name>.mp4)');
  return name;
}

function aspectOf(project) {
  const { width, height } = project.config;
  return height > width ? '9:16' : height === width ? '1:1' : '16:9';
}

export async function avatarList(project) {
  const list = await presenter.avatars(project.dir);
  return list.map((a) => ({ ...a, usable: !consentProblem(a, project), problem: consentProblem(a, project) }));
}

export function formatAvatars(list) {
  if (!list.length) return 'The presenter service has no avatars for this key.';
  return `${list.map((a) => `${a.id.padEnd(16)} ${a.name}, ${a.likeness === 'synthetic' ? 'a made-up person' : 'a real person'}, consent ${a.consent.status}${a.usd_per_second !== null ? `, $${a.usd_per_second} a second` : ''}${a.usable ? '' : '. Can\'t be used here'}`).join('\n')}\n${consentRule()}`;
}

function stopped(project, job, reason) {
  return new ProjectError(`The presenter clip "${job.request?.name}" is job ${shortId(job)}. ${stopSentence(job, reason)} To make it again anyway, run the same command with --new.`);
}

// Makes the clip of one scene. `dryRun` shows what it would send and costs nothing.
export async function makePresenter(project, { scene: sceneId, avatar: avatarId, name, maxCost, dryRun = false, fresh = false, log = () => {}, wait } = {}) {
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new ProjectError(`${scriptName(project)} has no scene "${sceneId}". The scenes are ${project.script.scenes.map((s) => s.id).join(', ')}`);
  if (!avatarId) throw new ProjectError(`--avatar needs the id of an avatar. Run "${selfCommand()} presenter ${projectWord(project.dir)} --avatars" to list them.`);
  const clipName = checkName(name ?? scene.id);
  const { wav } = voicePaths(project, scene.id);
  if (!fs.existsSync(wav)) throw new ProjectError(`scene "${scene.id}" has no narration yet. Run "${selfCommand()} voice ${projectWord(project.dir)}" first, because the presenter speaks it.`);
  const audio = fs.readFileSync(wav);
  const sound = readWav(wav);
  const seconds = Math.round((sound.samples.length / sound.sampleRate) * 10) / 10;
  // The rule is checked against the service's own word before anything is bought.
  const avatar = (await presenter.avatars(project.dir)).find((a) => a.id === avatarId);
  if (!avatar) throw new ProjectError(`the presenter service has no avatar "${avatarId}". Run "${selfCommand()} presenter ${projectWord(project.dir)} --avatars" to list them.`);
  const problem = consentProblem(avatar, project);
  if (problem) throw new ProjectError(problem);
  const estimate = avatar.usd_per_second === null ? null : Math.round(avatar.usd_per_second * seconds * 10000) / 10000;
  const request = { name: clipName, scene: scene.id, avatar: avatar.id, avatar_name: avatar.name, likeness: avatar.likeness, consent_id: avatar.consent.id, aspect: aspectOf(project), audio_sha256: sha256File(wav), seconds };
  const plan = { ...request, file: `assets/presenters/${clipName}.mp4`, estimated_usd: estimate, sends: `the narration of scene "${scene.id}" (${seconds} s of sound) and the avatar id` };
  if (dryRun) return { dry_run: true, ...plan };

  const key = jobKey({ kind: 'presenter', provider: presenter.id, name: clipName, avatar: avatar.id, audio: request.audio_sha256, aspect: request.aspect });
  const decision = decide(project.dir, key, { fresh });
  const places = [`assets/presenters/${clipName}.mp4`];
  if (decision.action === 'use') {
    const placed = placeOutput(project.dir, decision.job, places);
    return { ...plan, reused: true, job: shortId(placed.job), cost_usd: placed.job.cost_usd, file: path.join(project.dir, placed.job.output.name) };
  }
  let job = decision.job;
  if (decision.action === 'stop') throw stopped(project, job, decision.reason);
  if (decision.action === 'buy') {
    // Only buying needs a cap. Using or fetching what was bought costs nothing.
    if (maxCost === undefined) throw new ProjectError(`add --max-cost, the most this clip may cost in US dollars${estimate !== null ? `. The service asks about $${estimate} for it` : ''}. --dry-run shows the plan and costs nothing.`);
    if (estimate !== null && estimate > maxCost) throw new ProjectError(`the clip costs about $${estimate}, more than --max-cost ${maxCost}. Nothing was bought.`);
    presenter.key(project.dir);
    try {
      job = createJob(project.dir, key, { kind: 'presenter', provider: presenter.id, attempt: decision.attempt, estimated_usd: estimate, max_cost_usd: maxCost, request });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      throw stopped(project, listAttempts(project.dir, key).find((a) => a.attempt === decision.attempt), 'unknown');
    }
    try {
      const started = await presenter.start(project.dir, { avatar: avatar.id, consentId: avatar.consent.id, audio, aspect: request.aspect });
      job = updateJob(project.dir, job, { status: 'running', job_id: started.id });
    } catch (e) {
      const outcome = e instanceof ServiceError ? e.outcome : 'lost';
      updateJob(project.dir, job, { status: outcome, error: e.message });
      if (outcome === 'refused') throw e;
      throw new ServiceError(`${e.message.replace(/\.$/, '')}. That try may have cost money, so it is not sent again by itself. To make it again anyway, run the same command with --new.`, outcome);
    }
  }
  log(`presenter: job ${shortId(job)} is running at the service`);
  let result;
  try {
    result = await presenter.finish(project.dir, job.job_id, { log, wait });
  } catch (e) {
    const outcome = e instanceof ServiceError ? e.outcome : 'lost';
    // A clip that may still come stays running, so the same command fetches it later.
    if (outcome === 'lost') throw new ServiceError(`${e.message.replace(/\.$/, '')}. The job is still open: run the same command again to fetch the clip, which buys nothing.`, 'lost');
    updateJob(project.dir, job, { status: outcome, error: e.message });
    throw e;
  }
  const output = saveOutput(project.dir, places[0], result.bytes);
  const done = updateJob(project.dir, job, { status: 'done', cost_usd: result.cost_usd, output });
  const placed = placeOutput(project.dir, done, places);
  return { ...plan, reused: false, job: shortId(placed.job), cost_usd: result.cost_usd, file: path.join(project.dir, placed.job.output.name) };
}

export function formatPresenter(r) {
  const cost = r.estimated_usd === null ? 'the service gives no price' : `about $${r.estimated_usd}`;
  if (r.dry_run) return `presenter plan for scene ${r.scene}, nothing was sent:\n  avatar ${r.avatar_name} (${r.likeness === 'synthetic' ? 'a made-up person' : 'a real person with verified consent'}), ${r.aspect}\n  sends ${r.sends}\n  cost ${cost}\n  saves ${r.file}\nRun it with --max-cost to make the clip. Every package of this video then gets the AI label.`;
  return `${r.reused ? 'already made' : 'made'}: ${r.file} (job ${r.job}${r.cost_usd !== null && r.cost_usd !== undefined ? `, $${r.cost_usd}` : ''})\nShow it with s.presenter('${r.name}') in scene ${r.scene}. Every package of this video gets the AI label.`;
}
