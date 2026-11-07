// explainroo publish: posts a package through YouTube, Buffer or Blotato. It stays
// thin. One function builds the request. A dry run prints it, and a real run sends
// that same request after a typed yes, or --yes when there is no terminal. There
// is no scheduler and no queue: a post goes out when the command runs.
//
// Each post has a job in the record, and the job has a stage:
//
//   planned         approved, and nothing that makes a post has gone out
//   media_uploaded  Blotato has the file at the saved publicUrl, and the post has not gone out
//   sending         saved right before the write that makes the post
//   accepted        the service answered, and its id for the post is saved
//   finished        the status was read, and the post is there
//   failed          the status was read, and the service says the post failed
//
// A run that finds `planned` or `media_uploaded` goes on, because the next write was
// never attempted. A run that finds `sending` stops, because nobody knows whether the
// post exists, and only --new posts again. A YouTube upload is the exception: its
// session can say how much arrived, so it goes on from there.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { ProjectError, ServiceError, hideSecrets } from './errors.js';
import { createJob, historyDir, jobKey, listAttempts, projectWord, relativeFile, selfCommand, sha256File, shortId, updateJob, withNameLock, writePrivate } from './history.js';
import { packageDir } from './package.js';
import { langArg } from './project.js';
import { DEFAULT_CATEGORY, PLATFORMS, withHashtags } from './post.js';
import { liveShare } from './share.js';
import { allOf, oneOf } from './services.js';
import youtube from './connectors/youtube.js';
import buffer, { BUFFER_VALUES } from './connectors/buffer.js';
import blotato from './connectors/blotato.js';

export const VIA = { youtube, buffer, blotato };

// Which package goes where, and the network it lands on. This is the whole list.
// Any other pair stops before anything is uploaded or sent.
export const ROUTES = {
  youtube: { youtube: 'youtube', shorts: 'youtube' },
  buffer: { youtube: 'youtube', shorts: 'youtube', tiktok: 'tiktok', reels: 'instagram', linkedin: 'linkedin', x: 'twitter' },
  blotato: { youtube: 'youtube', shorts: 'youtube', tiktok: 'tiktok', reels: 'instagram', linkedin: 'linkedin', x: 'twitter' },
};

export const NETWORKS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

const PRIVACY = ['private', 'unlisted', 'public'];
// Blotato's names for TikTok's privacy.
const TIKTOK_PRIVACY = { private: 'SELF_ONLY', public: 'PUBLIC_TO_EVERYONE' };
// Where Blotato's answer for the uploaded file goes in a request that is not sent yet.
export const UPLOADED_FILE = '<the publicUrl Blotato gives for the uploaded video>';
// A link that runs out within this time gets a warning in the plan.
const SOON_MS = 24 * 60 * 60 * 1000;
// How often the status is read after a post, and for how long. Blotato asks for
// no more than one read every 10 seconds. Tests set these shorter.
const pollMs = () => Number(process.env.EXPLAINROO_PUBLISH_POLL_MS) || 10 * 1000;
const waitMs = () => Number(process.env.EXPLAINROO_PUBLISH_WAIT_MS) || 2 * 60 * 1000;
// A YouTube upload that drops this often in one run stops, and the next run goes on.
const UPLOAD_TRIES = 5;

function fail(message) {
  throw new ProjectError(message);
}

function when(iso) {
  return `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
}

function megabytes(bytes) {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

function clock(seconds) {
  const s = Math.round(Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The package to post. Without --platform, YouTube takes the youtube package. The
// other services take the one package they can post, and list them when there are more.
function pickPlatform(project, via, platform) {
  if (platform !== undefined) {
    if (!Object.hasOwn(PLATFORMS, platform)) fail(`there is no platform "${platform}". The platforms are ${allOf(Object.keys(PLATFORMS))}.`);
    return platform;
  }
  if (via === 'youtube') return 'youtube';
  const ready = Object.keys(ROUTES[via]).filter((name) => fs.existsSync(path.join(packageDir(project, name), 'post.json')));
  if (ready.length === 1) return ready[0];
  if (!ready.length) fail(`there is no package to post through ${VIA[via].name} yet. Run "${selfCommand()} package ${projectWord(project.dir)}${langArg(project)} --platform <name>" first. ${VIA[via].name} takes ${oneOf(Object.keys(ROUTES[via]))}.`);
  fail(`more than one package could go through ${VIA[via].name}: ${oneOf(ready)}. Say which one with --platform. Nothing was sent.`);
}

function checkPair(via, platform) {
  const network = ROUTES[via][platform];
  if (network) return network;
  const others = Object.keys(VIA).filter((name) => ROUTES[name][platform]);
  fail(`${VIA[via].name} does not take the ${platform} package. It takes ${oneOf(Object.keys(ROUTES[via]))}. The ${platform} package can go through ${oneOf(others.map((name) => `--via ${name}`))}. Nothing was uploaded or sent.`);
}

// The delivery folder, as package left it. publish never renders, and it never
// posts a file that changed since, or one that verify found errors in.
function readPackage(project, platform) {
  const { dir } = project;
  const folder = packageDir(project, platform);
  const again = `"${selfCommand()} package ${projectWord(dir)}${langArg(project)} --platform ${platform}"`;
  const missingHint = platform === 'youtube' && fs.existsSync(path.join(packageDir(project, 'shorts'), 'post.json')) ? ' There is a shorts package. To post that one, add --platform shorts.' : '';
  let post;
  try {
    post = JSON.parse(fs.readFileSync(path.join(folder, 'post.json'), 'utf8'));
  } catch {
    fail(`there is no ${platform} package yet. Run ${again} first. publish posts a package and never renders by itself.${missingHint}`);
  }
  const text = (value) => typeof value === 'string';
  const complete = post && post.platform === platform && /^[0-9a-f]{64}$/.test(post.sha256) && text(post.title) && post.title.trim() && text(post.description) && text(post.text)
    && Array.isArray(post.hashtags) && typeof post.ai_label === 'boolean' && typeof post.made_for_kids === 'boolean' && /^\d{1,3}$/.test(String(post.category)) && post.verify && typeof post.verify === 'object';
  if (!complete) fail(`${relativeFile(dir, path.join(folder, 'post.json'))} is not a package that publish can read. Run ${again} again.`);
  const video = path.join(folder, 'video.mp4');
  const name = relativeFile(dir, video);
  if (!fs.existsSync(video) || sha256File(video) !== post.sha256) fail(`${name} is not the video its post.json describes, so it was not posted. Run ${again} again.`);
  const errors = Array.isArray(post.verify.errors) ? post.verify.errors : [];
  if (post.verify.ok !== true || errors.length) fail(`verify found errors in ${name}${errors.length ? `: ${errors.join(' ')}` : '.'} Fix them and run ${again} again. Nothing was sent.`);
  return { folder, file: video, name, bytes: fs.statSync(video).size, sha256: post.sha256, post, again };
}

// YouTube refuses a title or a description with < or >, on every route, so that
// stops here, before anything is sent.
function checkYoutubeWords(network, pkg) {
  if (network !== 'youtube') return;
  const field = /[<>]/.test(pkg.post.title) ? 'title' : /[<>]/.test(pkg.post.description) || pkg.post.hashtags.some((tag) => /[<>]/.test(tag)) ? 'description' : null;
  if (field) fail(`YouTube does not take < or > in a ${field}. Change it in post.json and run ${pkg.again} again. Nothing was sent.`);
}

// What --privacy can be at each destination. YouTube has all three on every route,
// and TikTok through Blotato has two. The others have no such setting, so a post
// there goes public at once, and --privacy is refused rather than ignored.
function settlePrivacy(via, network, asked) {
  const where = `${NETWORKS[network]} through ${VIA[via].name}`;
  if (asked !== undefined && !PRIVACY.includes(asked)) fail(`--privacy must be ${oneOf(PRIVACY)}`);
  if (network === 'youtube') return { value: asked ?? 'private', setting: true };
  if (via === 'blotato' && network === 'tiktok') {
    if (asked === 'unlisted') fail(`${where} can be private or public, and has no unlisted. Nothing was uploaded or sent.`);
    return { value: asked ?? 'private', setting: true };
  }
  if (asked !== undefined) fail(`${where} has no privacy setting, so a post there goes public right away. --privacy can't change that, so nothing was uploaded or sent. Leave out --privacy to post it in public.`);
  return { value: 'public', setting: false };
}

// Buffer asks for a public, direct and stable https address.
function checkLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('--media-url must be a public https address like https://example.com/video.mp4');
  }
  if (url.protocol !== 'https:') fail('--media-url must be a public https address like https://example.com/video.mp4');
  if (url.username || url.password) fail('--media-url must not hold a user name or password, because it goes in the record and to the service');
  return url.toString();
}

// Where the service gets the video. YouTube takes the file itself, and so does
// Blotato unless --media-url names a link. Buffer has no upload, so it needs a public
// link to this exact file: --media-url, or a link that share made for it.
function mediaFor(project, via, platform, pkg, flag) {
  if (via === 'youtube') return null;
  if (flag !== undefined) return { url: checkLink(flag), from: 'flag', expires_at: null };
  if (via === 'blotato') return { url: null, from: 'upload', expires_at: null };
  const shared = liveShare(project, pkg.sha256);
  if (shared?.media_url) return { url: shared.media_url, from: 'share', expires_at: shared.expires_at };
  return { url: null, from: null, expires_at: null, missing: `Buffer needs a public link to this exact file, and there is none. Run "${selfCommand()} share ${projectWord(project.dir)}${langArg(project)} --platform ${platform}" first, or pass --media-url with a link to this file.` };
}

// The one place a request is made. A dry run prints it, and a real run saves it in
// the record and sends it. It holds no token. YouTube destinations get the title in
// their own field and the description with the hashtags as the body. Every other
// destination has one text field, and gets the text from the package.
export function buildRequest(via, { network, pkg, privacy, media, destination }) {
  const post = pkg.post;
  const isYoutube = network === 'youtube';
  const body = isYoutube ? withHashtags(post.description.trim(), post.hashtags) : post.text;
  if (via === 'youtube') {
    return {
      start: {
        query: { uploadType: 'resumable', part: 'snippet,status', notifySubscribers: 'false' },
        headers: { 'X-Upload-Content-Length': String(pkg.bytes), 'X-Upload-Content-Type': 'video/mp4' },
        body: {
          snippet: { title: post.title, description: body, categoryId: String(post.category) },
          status: { privacyStatus: privacy.value, selfDeclaredMadeForKids: post.made_for_kids, containsSyntheticMedia: post.ai_label },
        },
      },
      file: { name: pkg.name, bytes: pkg.bytes, sha256: pkg.sha256 },
    };
  }
  if (via === 'buffer') {
    const metadata = {
      youtube: { youtube: { title: post.title, categoryId: String(post.category), privacy: BUFFER_VALUES.privacy[privacy.value], madeForKids: post.made_for_kids, notifySubscribers: false, isAiGenerated: post.ai_label } },
      tiktok: { tiktok: { isAiGenerated: post.ai_label } },
      instagram: { instagram: { type: BUFFER_VALUES.reel, shouldShareToFeed: true, isAiGenerated: post.ai_label } },
      linkedin: null,
      twitter: { twitter: { isAiGenerated: post.ai_label } },
    }[network];
    return buffer.createPostRequest({
      channelId: destination?.id ?? null,
      text: body,
      mode: BUFFER_VALUES.mode,
      schedulingType: BUFFER_VALUES.schedulingType,
      needsApproval: false,
      aiAssisted: post.ai_label,
      assets: buffer.videoAssets(media.url),
      ...(metadata ? { metadata } : {}),
    });
  }
  const target = {
    youtube: { targetType: 'youtube', title: post.title, privacyStatus: privacy.value, shouldNotifySubscribers: false, isMadeForKids: post.made_for_kids, containsSyntheticMedia: post.ai_label },
    tiktok: { targetType: 'tiktok', privacyLevel: TIKTOK_PRIVACY[privacy.value], disabledComments: false, disabledDuet: false, disabledStitch: false, isBrandedContent: false, isYourBrand: false, isAiGenerated: post.ai_label },
    instagram: { targetType: 'instagram', mediaType: 'reel' },
    linkedin: { targetType: 'linkedin' },
    twitter: { targetType: 'twitter' },
  }[network];
  return {
    upload: media.url ? null : { filename: 'video.mp4' },
    file: media.url ? null : { name: pkg.name, bytes: pkg.bytes, sha256: pkg.sha256 },
    post: { post: { accountId: destination?.id ?? null, content: { text: body, mediaUrls: [media.url ?? UPLOADED_FILE], platform: network }, target } },
  };
}

// The body of Blotato's POST /posts, with the address of the uploaded file in place.
function blotatoPost(request, publicUrl) {
  const { post } = request.post;
  return { post: { ...post, content: { ...post.content, mediaUrls: post.content.mediaUrls.map((url) => (url === UPLOADED_FILE ? publicUrl : url)) } } };
}

// What the AI label does at each destination, in words for the plan.
function aiWords(via, network, label) {
  if (via === 'youtube') return `YouTube gets it as containsSyntheticMedia: ${label}.`;
  if (via === 'buffer') {
    const field = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', twitter: 'X' }[network];
    return `Buffer marks the post as AI assisted: ${label}.${field ? ` ${field} gets isAiGenerated: ${label}.` : ` ${NETWORKS[network]} has no field for it there.`}`;
  }
  if (network === 'youtube') return `YouTube gets it as containsSyntheticMedia: ${label}.`;
  if (network === 'tiktok') return `TikTok gets it as isAiGenerated: ${label}.`;
  return `${NETWORKS[network]} through Blotato has no field for it, so it is not sent.`;
}

function privacyWords(via, network, privacy) {
  if (!privacy.setting) return `public. ${NETWORKS[network]} through ${VIA[via].name} has no privacy setting, so the post goes public right away.`;
  if (privacy.value === 'private') return network === 'youtube' ? 'private. Only you can see it until you change that in YouTube Studio.' : 'private. Only you can see it until you change that on TikTok.';
  if (privacy.value === 'unlisted') return 'unlisted. Anyone with the link can see it, and it is not listed on your channel or in search.';
  return 'public. Everyone can see it right away.';
}

// The facts of a post, for a person about to post it under their own name.
function planFacts(via, platform, network, { pkg, privacy, media, destination, account, choices, request }) {
  const post = pkg.post;
  const isYoutube = network === 'youtube';
  const text = via === 'youtube' ? request.start.body.snippet.description : via === 'buffer' ? request.variables.input.text : request.post.post.content.text;
  const warnings = [];
  if (media?.expires_at && Date.parse(media.expires_at) - Date.now() < SOON_MS) warnings.push(`The link to the video expires on ${when(media.expires_at)}, in less than a day. ${VIA[via].name} has to fetch the video before then.`);
  return {
    via,
    service: VIA[via].name,
    platform,
    network,
    file: { name: pkg.name, bytes: pkg.bytes, sha256: pkg.sha256, duration: post.duration ?? null, verify: 'passed' },
    account: account ?? null,
    destination: destination ? { id: destination.id, name: destination.name } : null,
    choices: choices ?? [],
    title: isYoutube ? post.title : null,
    text,
    hashtags: post.hashtags,
    privacy: { value: privacy.value, setting: privacy.setting, words: privacyWords(via, network, privacy) },
    ai_label: { value: post.ai_label, reasons: Array.isArray(post.ai_reasons) ? post.ai_reasons : [], words: aiWords(via, network, post.ai_label) },
    made_for_kids: { value: post.made_for_kids, sent: isYoutube },
    category: isYoutube ? String(post.category) : null,
    notify_subscribers: isYoutube ? false : null,
    media: media ? { url: media.url, from: media.from, expires_at: media.expires_at } : null,
    warnings,
  };
}

function quoteBlock(text) {
  return String(text).split('\n').map((line) => `           | ${line}`).join('\n');
}

export function planText(plan) {
  const name = NETWORKS[plan.network];
  const lines = [
    `Video:     ${plan.file.name} (${PLATFORMS[plan.platform].name} package)`,
    `           ${megabytes(plan.file.bytes)}, ${clock(plan.file.duration)} long, sha256 ${plan.file.sha256}`,
    `           verify ${plan.file.verify}`,
    `Through:   ${plan.service}${plan.account?.name ? `, account ${plan.account.name}` : ''}`,
  ];
  if (plan.destination) lines.push(`${plan.via === 'blotato' ? 'Account' : 'Channel'}:   ${plan.destination.name} on ${name} (id ${plan.destination.id})`);
  else if (plan.choices.length) lines.push(`${plan.via === 'blotato' ? 'Account' : 'Channel'}:   not chosen yet. ${plan.service} has ${plan.choices.length} on ${name}:`, ...plan.choices.map((c) => `             ${c.id}  ${c.name}`));
  else lines.push(`${plan.via === 'blotato' ? 'Account' : 'Channel'}:   not known yet`);
  if (plan.title !== null) lines.push(`Title:     ${plan.title}`);
  lines.push(plan.title !== null ? 'Description:' : 'Text:', quoteBlock(plan.text));
  lines.push(`Hashtags:  ${plan.hashtags.length ? `${plan.hashtags.join(' ')}, in the ${plan.title !== null ? 'description' : 'text'}` : 'none'}`);
  lines.push(`Privacy:   ${plan.privacy.words}`);
  lines.push(`AI label:  ${plan.ai_label.value ? 'yes' : 'no'}${plan.ai_label.reasons.length ? ` (${plan.ai_label.reasons.join('; ')})` : ''}. ${plan.ai_label.words}`);
  lines.push(`For kids:  ${plan.made_for_kids.value ? 'yes' : 'no'}${plan.made_for_kids.sent ? '' : '. Only YouTube asks this, so it is not sent.'}`);
  if (plan.category !== null) lines.push(`Category:  ${plan.category}${plan.category === DEFAULT_CATEGORY ? ' (Education)' : ''}`);
  if (plan.notify_subscribers === false) lines.push('Subscribers are not notified.');
  if (plan.media) {
    const from = { flag: 'from --media-url', share: 'from explainroo share', upload: 'the file goes up to Blotato first' }[plan.media.from];
    if (plan.media.url) lines.push(`Video link: ${plan.media.url}, ${from}${plan.media.expires_at ? `. It expires on ${when(plan.media.expires_at)}` : ''}`);
    else if (plan.media.from === 'upload') lines.push(`Video link: none needed, ${from}`);
    else lines.push('Video link: none yet');
  } else lines.push('The file goes up to YouTube from this computer.');
  for (const warning of plan.warnings) lines.push(`Warning:   ${warning}`);
  return lines.join('\n');
}

// The id that makes a destination, so two channels under one account stay apart.
function destinationKey(via, network, destination) {
  return via === 'blotato' ? `${destination.id}:${network}` : destination.id;
}

export function publishKey(via, sha256, network, destination) {
  return jobKey({ kind: 'publish', service: via, sha256, destination: destinationKey(via, network, destination) });
}

// The channel or account to post to. One is picked by itself. Several are listed,
// and --channel or --account picks one. Locked or disconnected Buffer channels are
// never offered.
async function chooseDestination(via, network, dir, { channel, account }) {
  const asked = via === 'buffer' ? channel : via === 'blotato' ? account : undefined;
  const flag = via === 'buffer' ? '--channel' : '--account';
  const found = await VIA[via].destinations(dir, network);
  const usable = found.list.filter((d) => d.usable !== false);
  if (asked !== undefined) {
    const picked = found.list.find((d) => d.id === asked);
    if (!picked) fail(`${VIA[via].name} has no ${NETWORKS[network]} ${via === 'blotato' ? 'account' : 'channel'} with the id ${asked}.${usable.length ? ` These can post: ${usable.map((d) => `${d.id} (${d.name})`).join(', ')}.` : ''}`);
    if (picked.usable === false) fail(`${picked.name} on ${VIA[via].name} can't post right now: ${picked.why}. Nothing was sent.`);
    return { destination: picked, account: picked.account ?? found.account, choices: usable };
  }
  if (usable.length === 1) return { destination: usable[0], account: usable[0].account ?? found.account, choices: usable };
  if (!usable.length) {
    const hidden = found.list.length ? ` ${found.list.length} ${found.list.length === 1 ? 'is' : 'are'} there, but locked or disconnected.` : '';
    return { destination: null, account: found.account, choices: [], missing: `${VIA[via].name} has no ${NETWORKS[network]} ${via === 'blotato' ? 'account' : 'channel'} that can post.${hidden} Connect one in ${VIA[via].name} first.` };
  }
  return { destination: null, account: found.account, choices: usable, missing: `${VIA[via].name} has ${usable.length} ${NETWORKS[network]} ${via === 'blotato' ? 'accounts' : 'channels'}. Say which one with ${flag} <id>.` };
}

// A job file can come with a stranger's project, and a run that goes on sends the
// request it holds. So that request has to be for this package and this place, and
// say what its plan says, or it is not used.
function storedRequestFits(job, { via, network, pkg, destination }) {
  const r = job.request ?? {};
  const p = job.plan ?? {};
  const file = r.file ?? null;
  const sameFile = !file || (file.name === pkg.name && file.sha256 === pkg.sha256 && file.bytes === pkg.bytes);
  if (job.provider !== via || job.network !== network || p.platform !== pkg.post.platform || p.text === undefined || !sameFile) return false;
  if (via === 'youtube') {
    const { snippet = {}, status = {} } = r.start?.body ?? {};
    return !!file && r.start?.headers?.['X-Upload-Content-Length'] === String(pkg.bytes) && snippet.title === p.title && snippet.description === p.text && status.privacyStatus === p.privacy?.value;
  }
  if (via === 'buffer') {
    const input = r.variables?.input ?? {};
    const youtubeMeta = input.metadata?.youtube;
    return input.channelId === destination.id && input.text === p.text && input.assets?.[0]?.video?.url === p.media?.url
      && (!youtubeMeta || (youtubeMeta.title === p.title && youtubeMeta.privacy === BUFFER_VALUES.privacy[p.privacy?.value]));
  }
  const post = r.post?.post ?? {};
  const media = post.content?.mediaUrls ?? [];
  return post.accountId === destination.id && post.content?.platform === network && post.target?.targetType === network && post.content?.text === p.text
    && media.length === 1 && (media[0] === (p.media?.url ?? UPLOADED_FILE)) && (!!file === (media[0] === UPLOADED_FILE))
    && (network !== 'youtube' || (post.target.title === p.title && post.target.privacyStatus === p.privacy?.value));
}

function stageOf(job) {
  return ['planned', 'media_uploaded', 'sending', 'accepted', 'finished', 'failed'].includes(job.stage) ? job.stage : 'unknown';
}

function setStage(dir, job, stage, fields = {}) {
  return updateJob(dir, job, { stage, status: stage, ...fields });
}

function sessionFile(job) {
  return `publish-${job.key}${job.attempt > 1 ? `.${job.attempt}` : ''}.json`;
}

// A YouTube session address acts like a password for the upload, so it stays in
// history/private/, which git leaves out.
function readSession(dir, job) {
  try {
    const saved = JSON.parse(fs.readFileSync(historyDir(dir, 'private', sessionFile(job)), 'utf8'));
    return typeof saved.session === 'string' ? saved.session : null;
  } catch {
    return null;
  }
}

// Moves a job to its next stage, if no other run moved it first. Two runs that go on
// with the same post can't both send it.
function advance(dir, job, from, to, fields = {}, before = () => {}) {
  return withNameLock(dir, `publish ${job.key}.${job.attempt}`, () => {
    const current = listAttempts(dir, job.key).find((a) => a.attempt === job.attempt);
    if (!from.includes(current?.stage)) throw new ProjectError(`another run is posting this right now, or did a moment ago. Run the same command again in a minute to see where it is. Nothing more was sent.`);
    before();
    return setStage(dir, current, to, fields);
  });
}

function destinationWords(job) {
  return `${job.destination?.name ?? '?'} on ${NETWORKS[job.network] ?? job.network}`;
}

// The words for a post whose outcome nobody knows.
function unknownOutcome(job, cause = null) {
  const at = destinationWords(job);
  const look = {
    youtube: 'Look in YouTube Studio (https://studio.youtube.com) for the video',
    buffer: 'Look at the channel in Buffer for the post',
    blotato: 'Look at your posts in Blotato for it',
  }[job.provider];
  const what = cause ?? `The post to ${at} went out to ${VIA[job.provider].name} on ${when(job.updated)}, and no answer was saved. Another run may still be sending it, or a run stopped before the answer came.`;
  return `${what} So the post may or may not exist. ${look}. Explainroo will not post it again by itself. To post it again anyway, run the same command with --new.`;
}

// Reads what became of a post the service accepted. Reading is free, so it can go
// on for a while and stop at any point. A later run picks up from the saved id.
async function follow(project, job, { log, wait = waitMs() }) {
  const { dir } = project;
  const connector = VIA[job.provider];
  const deadline = Date.now() + wait;
  let last = null;
  for (let read = 0; ; read++) {
    let seen = null;
    try {
      seen = await connector.postStatus(dir, job.job_id, { network: job.network, platform: job.plan?.platform });
    } catch (e) {
      // The post is made, so a status that can't be read is only a note. A later
      // run reads it again.
      if (!(e instanceof ProjectError)) throw e;
      if (!(e instanceof ServiceError) || e.outcome !== 'later') return updateJob(dir, job, { note: hideSecrets(e.message.replace(/\.$/, '')) });
      last = e.message;
    }
    if (seen?.state === 'finished' || seen?.state === 'failed') {
      return setStage(dir, job, seen.state, { result: { status: seen.status, link: seen.link ?? null, error: seen.error ?? null, details: seen.details ?? null, read: new Date().toISOString() } });
    }
    if (seen) {
      job = updateJob(dir, job, { result: { status: seen.status, link: seen.link ?? null, error: null, details: seen.details ?? null, read: new Date().toISOString() } });
      last = null;
    }
    // YouTube has the video once the upload is done. Its processing is its own work.
    if (job.provider === 'youtube' && seen) return job;
    const left = deadline - Date.now();
    if (left <= 0 || (job.provider === 'youtube' && read >= 2)) return last ? updateJob(dir, job, { note: hideSecrets(last) }) : job;
    log(`${connector.name} says the post is ${seen?.status ?? 'not readable yet'}, reading again in ${Math.round(Math.min(pollMs(), left) / 1000)}s`);
    await sleep(Math.min(pollMs(), left));
  }
}

// Sends what a job still has to send, from the stage it is at.
async function carryOut(project, job, { log, notice }) {
  const { dir } = project;
  if (job.provider === 'youtube') return uploadToYoutube(project, job, { log, notice });
  if (job.provider === 'blotato' && job.stage === 'planned' && job.request.upload) {
    log(`uploading ${job.request.file.name} (${megabytes(job.request.file.bytes)}) to Blotato`);
    let uploaded;
    try {
      uploaded = await blotato.uploadMedia(dir, path.join(dir, job.request.file.name));
    } catch (e) {
      // An upload makes no post, so it can go again, by the next run.
      if (e instanceof ServiceError) fail(`${e.message.replace(/\.$/, '')}. The video did not reach Blotato, and no post was made. Run the same command again to try once more.`);
      throw e;
    }
    job = advance(dir, job, ['planned'], 'media_uploaded', { media: { public_url: uploaded.publicUrl, uploaded: new Date().toISOString() } });
  }
  const before = job.stage;
  const body = job.provider === 'blotato' ? blotatoPost(job.request, job.media?.public_url) : job.request;
  // A login that has to be renewed is renewed first, so nothing can fail between
  // the stage that says sending and the request itself.
  const login = await VIA[job.provider].ready(dir);
  job = advance(dir, job, ['planned', 'media_uploaded'], 'sending');
  let answer;
  try {
    answer = await VIA[job.provider].createPost(dir, body, login);
  } catch (e) {
    if (e instanceof ServiceError && e.outcome === 'refused') {
      // The service said no, so no post exists, and the next run may go on.
      setStage(dir, job, before, { refused: { error: hideSecrets(e.message), at: new Date().toISOString() } });
      throw new ProjectError(`${e.message.replace(/\.$/, '')}. No post was made.${e.details?.retry_after !== undefined ? '' : ' Fix what it names, then run the same command again.'}`);
    }
    const said = e instanceof ServiceError ? e.message : 'the connection broke';
    updateJob(dir, job, { note: hideSecrets(said) });
    throw new ProjectError(unknownOutcome(job, `${said.replace(/\.$/, '')}. The request for the post to ${destinationWords(job)} went out.`));
  }
  job = setStage(dir, job, 'accepted', { job_id: answer.id, accepted: new Date().toISOString(), result: { status: answer.status ?? null, link: answer.link ?? null, error: null } });
  notice(`${VIA[job.provider].name} accepted the post (id ${answer.id}).`);
  return follow(project, job, { log });
}

// A resumable upload. The session address is saved before the first byte. After a
// dropped connection or a 5xx, the session says how much arrived, and the upload
// goes on from there, in this run or the next one.
async function uploadToYoutube(project, job, { log, notice }) {
  const { dir } = project;
  const file = path.join(dir, job.request.file.name);
  const size = job.request.file.bytes;
  let session = job.stage === 'sending' ? readSession(dir, job) : null;
  let offset = 0;
  let video = null;
  if (job.stage === 'planned') {
    let started;
    try {
      started = await youtube.startUpload(dir, job.request.start);
    } catch (e) {
      if (e instanceof ServiceError) fail(`${e.message.replace(/\.$/, '')}. Nothing was uploaded yet, and no video was made.${e.details?.retry_after !== undefined ? '' : ' Run the same command again to try once more.'}`);
      throw e;
    }
    session = started.session;
    job = advance(dir, job, ['planned'], 'sending', {}, () => writePrivate(dir, sessionFile(job), { session }));
  } else {
    if (!session) throw new ProjectError(unknownOutcome(job, `An upload to ${destinationWords(job)} started on ${when(job.updated)}, and its session address is not in history/private/ any more, so nobody can ask YouTube how much arrived.`));
    const status = await youtube.uploadStatus(dir, session, size).catch((e) => statusTrouble(job, e));
    if (status.video) video = status.video;
    else offset = status.received;
  }
  for (let tries = 0; !video; tries++) {
    if (tries >= UPLOAD_TRIES) fail(`the upload to YouTube was cut off ${UPLOAD_TRIES} times, at ${megabytes(offset)} of ${megabytes(size)}. Run the same command again later. It goes on from where the upload stopped, and makes no second video.`);
    log(offset ? `going on with the upload at ${megabytes(offset)} of ${megabytes(size)}` : `uploading ${job.request.file.name} (${megabytes(size)}) to YouTube`);
    let answer;
    try {
      answer = await youtube.upload(dir, session, file, offset, size);
    } catch (e) {
      if (!(e instanceof ServiceError) || e.outcome !== 'later') throw e instanceof ServiceError && e.outcome === 'gone' ? new ProjectError(expired(job)) : e;
      log(`${e.message}, asking YouTube how much arrived`);
      await sleep(Math.min(pollMs(), 2000) * (tries + 1));
      answer = await youtube.uploadStatus(dir, session, size).catch((err) => statusTrouble(job, err));
    }
    if (answer.video) video = answer.video;
    else offset = answer.received;
  }
  job = setStage(dir, job, 'accepted', { job_id: video.id, accepted: new Date().toISOString(), result: { status: video.status ?? null, link: null, error: null } });
  fs.rmSync(historyDir(dir, 'private', sessionFile(job)), { force: true });
  notice(`YouTube has the video (id ${video.id}).`);
  return follow(project, job, { log });
}

function expired(job) {
  return unknownOutcome(job, `YouTube no longer knows the upload to ${destinationWords(job)} that started on ${when(job.updated)} (HTTP 404), so it can't go on, and nobody can tell from here whether it finished.`);
}

// A session that can't be asked stops the run, and the next run asks again.
function statusTrouble(job, e) {
  if (e instanceof ServiceError && e.outcome === 'gone') throw new ProjectError(expired(job));
  if (e instanceof ServiceError) fail(`${e.message.replace(/\.$/, '')}, so it is not known how much of the upload arrived. Run the same command again in a moment. It asks again, and makes no second video.`);
  throw e;
}

// Asks for a typed yes. Without a terminal, --yes is the only way past.
async function confirmed({ yes, ask }) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  return ask();
}

function askYes() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question('Type yes to post this under your name, or anything else to stop: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

// Text from a job file stays on one line, and a link has to be a web address.
function plainWords(text, length = 300) {
  return text === null || text === undefined ? null : String(text).replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, length);
}

function webLink(value) {
  try {
    return /^https?:$/.test(new URL(value).protocol) ? plainWords(value, 500) : null;
  } catch {
    return null;
  }
}

function result(job, fields = {}) {
  return {
    dry_run: false,
    via: job.provider,
    platform: job.plan?.platform ?? null,
    network: job.network,
    job: shortId(job),
    attempt: job.attempt,
    stage: stageOf(job),
    destination: job.destination ? { id: plainWords(job.destination.id, 100), name: plainWords(job.destination.name, 100) } : null,
    post: { id: plainWords(job.job_id, 100), status: plainWords(job.result?.status, 60), link: webLink(job.result?.link), error: plainWords(job.result?.error), details: plainWords(job.result?.details) },
    approved: job.created,
    ...(job.note ? { note: plainWords(job.note) } : {}),
    ...fields,
  };
}

function needYes(plan, request, continued) {
  const words = `${continued ? 'This goes on with a post that was approved before. ' : ''}Nothing was sent. There is no terminal here to type yes. Show this plan to the user, and if they say yes, run the same command with --yes.`;
  return { ok: false, dry_run: false, confirmed: false, error: words, plan, request };
}

export async function publish(project, { via, platform: asked, privacy: askedPrivacy, mediaUrl, channel, account, dryRun = false, yes = false, fresh = false, log = () => {}, notice = () => {}, ask = askYes } = {}) {
  const { dir } = project;
  if (via === undefined) fail(`publish needs --via ${oneOf(Object.keys(VIA))}`);
  if (!Object.hasOwn(VIA, via)) fail(`--via must be ${oneOf(Object.keys(VIA))}`);
  if (channel !== undefined && via !== 'buffer') fail('--channel is for --via buffer. Blotato takes --account, and YouTube posts to the channel of its login.');
  if (account !== undefined && via !== 'blotato') fail('--account is for --via blotato. Buffer takes --channel, and YouTube posts to the channel of its login.');
  if (mediaUrl !== undefined && via === 'youtube') fail('--media-url is for Buffer and Blotato. YouTube takes the file from this computer.');
  const connector = VIA[via];
  const platform = pickPlatform(project, via, asked);
  const network = checkPair(via, platform);
  const pkg = readPackage(project, platform);
  checkYoutubeWords(network, pkg);
  const privacy = settlePrivacy(via, network, askedPrivacy);
  const media = mediaFor(project, via, platform, pkg, mediaUrl);
  const missing = [];
  const login = connector.login(dir);
  let chosen = { destination: null, account: null, choices: [] };
  if (!login.ok) missing.push(login.missing);
  else {
    try {
      chosen = await chooseDestination(via, network, dir, { channel, account });
    } catch (e) {
      // A dry run says what is wrong and goes on. A real run stops here.
      if (!dryRun || !(e instanceof ProjectError)) throw e;
      missing.push(e.message.replace(/^\w/, (c) => c.toUpperCase()));
    }
    if (chosen.missing) missing.push(chosen.missing);
  }
  const destination = chosen.destination ? { id: chosen.destination.id, name: chosen.destination.name } : null;
  const request = buildRequest(via, { network, pkg, privacy, media, destination });
  const plan = planFacts(via, platform, network, { pkg, privacy, media, destination, account: chosen.account, choices: chosen.choices.map((c) => ({ id: c.id, name: c.name })), request });
  const key = destination ? publishKey(via, pkg.sha256, network, destination) : null;
  const newest = key ? listAttempts(dir, key).at(-1) : null;

  if (dryRun) {
    if (media?.missing && !(newest && !fresh && ['accepted', 'finished'].includes(stageOf(newest)))) missing.push(media.missing);
    let would = missing.length ? 'stop' : 'post';
    if (!missing.length && newest && !fresh) would = { planned: 'continue', media_uploaded: 'continue', sending: via === 'youtube' && readSession(dir, newest) ? 'resume' : 'stop', accepted: 'read', finished: 'nothing', failed: 'stop' }[stageOf(newest)] ?? 'stop';
    // A run that goes on with an earlier post sends what was approved then.
    const earlier = would === 'continue' || would === 'resume';
    const changed = earlier && JSON.stringify(newest.request) !== JSON.stringify(request);
    return { dry_run: true, via, platform, network, would, missing, ...(newest && !fresh ? { job: shortId(newest), stage: stageOf(newest) } : {}), ...(changed ? { changed: true } : {}), plan: earlier ? newest.plan : plan, request: earlier ? newest.request : request };
  }
  if (missing.length) fail(`${missing.join(' ')} Nothing was sent.`);

  if (newest && !fresh) {
    const stage = stageOf(newest);
    if (stage === 'finished') return result(newest, { already: true });
    if (stage === 'failed') fail(`the post of this file to ${destinationWords(newest)} failed at ${VIA[newest.provider].name} on ${when(newest.updated)}${newest.result?.error ? `: ${newest.result.error.replace(/\.$/, '')}` : ''}. To post it again, run the same command with --new.`);
    if (stage === 'accepted') return result(await follow(project, newest, { log }));
    if (stage === 'unknown' || (stage === 'sending' && via !== 'youtube')) fail(unknownOutcome(newest));
    // planned, media_uploaded, or a YouTube upload with a session: it goes on with
    // the request that was approved, not with what post.json says now.
    if (!storedRequestFits(newest, { via, network, pkg, destination })) fail(`the record of the post approved on ${when(newest.created)} does not match this package or its own plan, so it was not used, and nothing was sent. To post the package as it is now, run the same command with --new.`);
    const changed = JSON.stringify(newest.request) !== JSON.stringify(request);
    const expiredLink = newest.plan?.media?.expires_at && Date.parse(newest.plan.media.expires_at) < Date.now() && !newest.media?.public_url;
    if (expiredLink) fail(`the link to the video in the post approved on ${when(newest.created)} expired on ${when(newest.plan.media.expires_at)}, so ${VIA[via].name} can't fetch it. Share the package again, then run the same command with --new. Nothing was sent.`);
    notice(`This goes on with the post approved on ${when(newest.created)}, from where it stopped. It sends what was approved then.${changed ? ' post.json or the flags have changed since. To post the new version instead, run the same command with --new.' : ''}`);
    notice(planText(newest.plan));
    if (!(await confirmed({ yes, ask }))) return needYes(newest.plan, newest.request, true);
    return result(await carryOut(project, newest, { log, notice }), { continued: true });
  }

  if (media?.missing) fail(`${media.missing} Nothing was sent.`);
  notice(`This is the post. Nothing has been sent yet.\n${planText(plan)}`);
  if (!(await confirmed({ yes, ask }))) return needYes(plan, request, false);
  // The attempt comes from what this run saw before it asked: the first one, or with
  // --new one more than the newest it saw. Another run may have started the same
  // post while this one waited for its yes, and then this one sends nothing. The
  // exclusive open below catches a run that starts it in the same moment.
  const attempt = (newest?.attempt ?? 0) + 1;
  const meanwhile = listAttempts(dir, key).at(-1);
  if ((meanwhile?.attempt ?? 0) >= attempt) {
    fail(`while this run waited for a yes, another run started a post of this file to ${destination.name} on ${NETWORKS[network]} (job ${shortId(meanwhile)}). Nothing was sent. ${fresh ? 'To post it once more anyway, run the same command again.' : 'Run the same command again to see where that post is. To post it once more anyway, add --new.'}`);
  }
  let job;
  try {
    job = createJob(dir, key, { kind: 'publish', provider: via, attempt, stage: 'planned', status: 'planned', network, destination: { ...destination, key: destinationKey(via, network, destination) }, account: chosen.account, plan, request });
  } catch (e) {
    if (e.code === 'EEXIST') fail('another run started the same post a moment ago. Run the same command again in a minute to see where it is. Nothing more was sent.');
    throw e;
  }
  return result(await carryOut(project, job, { log, notice }));
}

function linkLines(r) {
  const lines = [];
  if (r.post.link) lines.push(`Link: ${r.post.link}`);
  if (r.via === 'youtube' && r.post.id) {
    lines.push(`YouTube Studio: https://studio.youtube.com/video/${r.post.id}/edit`);
    lines.push('Add the cover (video.cover.jpg) and the captions (video.srt) from the package folder there.');
  }
  return lines;
}

export function formatPublish(r) {
  if (r.dry_run) {
    const lines = [`This is what a real run would post. Nothing was posted.\n${planText(r.plan)}`];
    if (r.missing.length) lines.push('Before it can post:', ...r.missing.map((m) => `  ${m}`));
    const would = {
      post: 'The real run shows this plan again and posts only after a typed yes, or with --yes when there is no terminal.',
      continue: `This post was approved before (job ${r.job}) and stopped before it went out. The real run goes on with it after a yes, and sends what was approved then.${r.changed ? ' post.json or the flags have changed since. To post the new version instead, add --new.' : ''}`,
      resume: `The upload of this post (job ${r.job}) stopped partway. The real run asks YouTube how much arrived and goes on from there after a yes.`,
      read: `This post was accepted before (job ${r.job}). The real run reads its status and posts nothing.`,
      nothing: `This file was already posted there (job ${r.job}). The real run prints its status and link and posts nothing.`,
      stop: r.missing.length ? null : `An earlier try of this post (job ${r.job}) ${r.stage === 'failed' ? 'failed' : 'has no known outcome'}, so the real run stops. --new posts again.`,
    }[r.would];
    if (would) lines.push(would);
    return lines.join('\n');
  }
  if (r.confirmed === false) return '';
  const service = VIA[r.via].name;
  const where = `${r.destination?.name ?? '?'} on ${NETWORKS[r.network]}`;
  const through = r.via === 'youtube' ? '' : ` through ${service}`;
  if (r.already) return [`This file was already posted to ${where}${through} (job ${r.job}), so nothing was sent.`, `Status: ${r.post.status ?? 'unknown'}`, ...linkLines(r), 'To post it again anyway, run the same command with --new.'].join('\n');
  if (r.stage === 'failed') return [`${service} says the post to ${where} failed${r.post.error ? `: ${r.post.error}` : '.'}`, 'Nothing more is sent by itself. To post it again, run the same command with --new.'].join('\n');
  const lines = [r.stage === 'finished' ? `Posted to ${where}${through}.` : `${service} accepted the post to ${where} (id ${r.post.id}).`];
  if (r.post.status) lines.push(`Status: ${r.post.status}${r.post.details ? ` (${r.post.details})` : ''}`);
  lines.push(...linkLines(r));
  if (r.stage === 'accepted') lines.push(`${r.note ? `The status could not be read: ${r.note}.` : 'It is not finished yet.'} Run the same command later to read the status. It will not post again.`);
  return lines.join('\n');
}
