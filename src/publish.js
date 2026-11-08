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
//
// With --draft, Buffer saves the post as a draft, and the job is finished once Buffer
// shows it as one. A draft counts as the post of that file to that channel.
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
import { allOf, oneOf, serviceUrl } from './services.js';
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
// How long the host of a video link has to say the size of its file.
const LINK_SECONDS = 20;

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

function bytesWords(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes`;
}

// Where the size check of a link goes. EXPLAINROO_MEDIA_CHECK_URL sends it to a test
// server, with the host and the path of the link after that address.
function checkAddress(link) {
  if (!process.env.EXPLAINROO_MEDIA_CHECK_URL) return link;
  const base = serviceUrl({ id: 'media-check', name: 'video link', baseUrl: 'the host of each link' }).replace(/\/+$/, '');
  const url = new URL(link);
  return `${base}/${url.host}${url.pathname}${url.search}`;
}

// The size of the file at a link. HEAD comes first. A host that refuses HEAD, or
// answers it without a size, gets a GET for the first byte, and the body is never
// read.
async function linkSize(link) {
  const address = checkAddress(link);
  let why = null;
  for (const method of ['HEAD', 'GET']) {
    let res;
    try {
      res = await fetch(address, { method, signal: AbortSignal.timeout(LINK_SECONDS * 1000), headers: { 'Accept-Encoding': 'identity', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) } });
      await res.body?.cancel().catch(() => {});
    } catch (e) {
      why = e?.name === 'TimeoutError' ? `it did not answer within ${LINK_SECONDS} seconds` : 'nothing answered at that address';
      continue;
    }
    const total = res.status === 206 ? /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1] : res.ok ? res.headers.get('content-length') : null;
    if (/^\d+$/.test(total ?? '')) return { bytes: Number(total), how: method === 'HEAD' ? 'HEAD' : 'GET of the first byte' };
    why = res.ok ? 'it answered without the size of the file' : `it answered HTTP ${res.status}`;
  }
  return { bytes: null, why };
}

// The link a service fetches has to lead to this exact file, or the post shows
// another video. The sizes are compared before anything is sent.
async function checkMedia(link, pkg, unchecked) {
  if (unchecked) return { result: 'unchecked', bytes: null, expected: pkg.bytes };
  const found = await linkSize(link);
  if (found.bytes === null) return { result: 'unknown', bytes: null, expected: pkg.bytes, why: found.why };
  return { result: found.bytes === pkg.bytes ? 'same' : 'different', bytes: found.bytes, expected: pkg.bytes, how: found.how };
}

function checkWords(check) {
  if (check.result === 'same') return `${bytesWords(check.bytes)}, the same as the file`;
  if (check.result === 'different') return `${bytesWords(check.bytes)}, and the file has ${bytesWords(check.expected)}, so it is another video`;
  if (check.result === 'unknown') return `not known, because ${check.why}`;
  return 'not checked, because of --media-url-unchecked';
}

// Why a link stops the post, or null when it may go out.
function linkProblem(check, link, pkg, via) {
  const service = VIA[via].name;
  if (check?.result === 'different') return `The video link ${link} leads to a file of ${bytesWords(check.bytes)}, and ${pkg.name} has ${bytesWords(check.expected)}. So the link is to another video, and ${service} would post that one. Pass a link to this exact file. If you are sure the link is right, add --media-url-unchecked.`;
  if (check?.result === 'unknown') return `The size of the file at ${link} could not be read, because ${check.why}. ${service} fetches the video from this link, so explainroo compares its size with ${pkg.name} first. Check that the link opens the video without a login, or add --media-url-unchecked to post it without this check.`;
  return null;
}

function withCheck(plan, check) {
  return check && plan.media ? { ...plan, media: { ...plan.media, check } } : plan;
}

// The one place a request is made. A dry run prints it, and a real run saves it in
// the record and sends it. It holds no token. YouTube destinations get the title in
// their own field and the description with the hashtags as the body. Every other
// destination has one text field, and gets the text from the package. A Buffer draft
// has saveToDraft and the mode of Buffer's example of a draft.
export function buildRequest(via, { network, pkg, privacy, media, destination, draft = false }) {
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
      mode: draft ? BUFFER_VALUES.draftMode : BUFFER_VALUES.mode,
      schedulingType: BUFFER_VALUES.schedulingType,
      needsApproval: false,
      ...(draft ? { saveToDraft: true } : {}),
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

function privacyWords(via, network, privacy, draft) {
  if (!privacy.setting && draft) return `public once it goes out. ${NETWORKS[network]} through ${VIA[via].name} has no privacy setting.`;
  if (!privacy.setting) return `public. ${NETWORKS[network]} through ${VIA[via].name} has no privacy setting, so the post goes public right away.`;
  if (privacy.value === 'private') return network === 'youtube' ? 'private. Only you can see it until you change that in YouTube Studio.' : 'private. Only you can see it until you change that on TikTok.';
  if (privacy.value === 'unlisted') return 'unlisted. Anyone with the link can see it, and it is not listed on your channel or in search.';
  return 'public. Everyone can see it right away.';
}

// The facts of a post, for a person about to post it under their own name.
function planFacts(via, platform, network, { pkg, privacy, media, destination, account, choices, request, draft = false }) {
  const post = pkg.post;
  const isYoutube = network === 'youtube';
  const text = via === 'youtube' ? request.start.body.snippet.description : via === 'buffer' ? request.variables.input.text : request.post.post.content.text;
  const warnings = [];
  if (media?.expires_at && Date.parse(media.expires_at) - Date.now() < SOON_MS) warnings.push(`The link to the video expires on ${when(media.expires_at)}, in less than a day. ${VIA[via].name} has to fetch the video before then.`);
  else if (draft && media?.expires_at) warnings.push(`The link to the video expires on ${when(media.expires_at)}. Buffer fetches the video when the post goes out, so schedule the draft before then.`);
  return {
    via,
    service: VIA[via].name,
    platform,
    network,
    draft,
    file: { name: pkg.name, bytes: pkg.bytes, sha256: pkg.sha256, duration: post.duration ?? null, verify: 'passed' },
    account: account ?? null,
    destination: destination ? { id: destination.id, name: destination.name } : null,
    choices: choices ?? [],
    title: isYoutube ? post.title : null,
    text,
    hashtags: post.hashtags,
    privacy: { value: privacy.value, setting: privacy.setting, words: privacyWords(via, network, privacy, draft) },
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
  if (plan.draft) lines.push('Draft:     yes. Buffer keeps it as a draft, and nothing is published until you schedule it there.');
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
    if (plan.media.check) lines.push(`Link size: ${checkWords(plan.media.check)}`);
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
    return input.channelId === destination.id && input.text === p.text && input.assets?.[0]?.video?.url === p.media?.url && (input.saveToDraft === true) === (p.draft === true)
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
// with the same post can't both send it. A run that is paused while it holds the
// lock keeps it, so the other run waits, and then stops without sending anything.
function advance(dir, job, from, to, fields = {}, before = () => {}) {
  return withNameLock(dir, `publish ${job.key}.${job.attempt}`, () => {
    const current = listAttempts(dir, job.key).find((a) => a.attempt === job.attempt);
    if (!from.includes(current?.stage)) throw new ProjectError(`another run is posting this right now, or did a moment ago. Run the same command again in a minute to see where it is. Nothing more was sent.`);
    before();
    return setStage(dir, current, to, fields);
  }, (words) => new ProjectError(`another run is posting this right now, and this one waited ${words} for it. Nothing more was sent. Run the same command again in a minute to see where it is.`));
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
      seen = await connector.postStatus(dir, job.job_id, { network: job.network, platform: job.plan?.platform, draft: job.plan?.draft === true });
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
    // A draft waits for the user, so a status that is not draft won't change by itself.
    if ((job.provider === 'youtube' || job.plan?.draft === true) && seen) return job;
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
      if (e instanceof ServiceError) fail(`${e.message.replace(/\.$/, '')}. No post was made. Run the same command again to upload the video once more.`);
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
  notice(`${VIA[job.provider].name} accepted the ${job.plan?.draft === true ? 'draft' : 'post'} (id ${answer.id}).`);
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
async function confirmed({ yes, ask, draft }) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  return ask(draft ? 'Type yes to save this as a draft in your Buffer, or anything else to stop: ' : 'Type yes to post this under your name, or anything else to stop: ');
}

function askYes(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
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
    draft: job.plan?.draft === true,
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

// A run goes on with an earlier request only when both are drafts or both are posts,
// so --draft never sends a post that goes out right away, and the other way round.
function draftMismatch(job, draft) {
  const earlier = job.plan?.draft === true;
  if (earlier === draft) return null;
  return earlier
    ? `the draft approved on ${when(job.created)} (job ${shortId(job)}) stopped before it went out. This run has no --draft, so it does not go on with that draft and post it now. Nothing was sent. To save that draft, add --draft. To post it now instead, run the same command with --new.`
    : `the post approved on ${when(job.created)} (job ${shortId(job)}) was to go out right away, and it stopped before it went out. This run asks for a draft, so it does not go on with that post. Nothing was sent. To save a draft instead, run the same command with --new.`;
}

function needYes(plan, request, continued) {
  const words = `${continued ? 'This goes on with a post that was approved before. ' : ''}Nothing was sent. There is no terminal here to type yes. Show this plan to the user, and if they say yes, run the same command with --yes.`;
  return { ok: false, dry_run: false, confirmed: false, error: words, plan, request };
}

export async function publish(project, { via, platform: asked, privacy: askedPrivacy, mediaUrl, mediaUnchecked = false, channel, account, draft = false, dryRun = false, yes = false, fresh = false, log = () => {}, notice = () => {}, ask = askYes } = {}) {
  const { dir } = project;
  if (via === undefined) fail(`publish needs --via ${oneOf(Object.keys(VIA))}`);
  if (!Object.hasOwn(VIA, via)) fail(`--via must be ${oneOf(Object.keys(VIA))}`);
  if (channel !== undefined && via !== 'buffer') fail('--channel is for --via buffer. Blotato takes --account, and YouTube posts to the channel of its login.');
  if (account !== undefined && via !== 'blotato') fail('--account is for --via blotato. Buffer takes --channel, and YouTube posts to the channel of its login.');
  if (mediaUrl !== undefined && via === 'youtube') fail('--media-url is for Buffer and Blotato. YouTube takes the file from this computer.');
  if (draft && via !== 'buffer') fail('--draft is for --via buffer. explainroo can save a post as a draft only in Buffer. Nothing was sent.');
  if (mediaUnchecked && via === 'youtube') fail('--media-url-unchecked is for Buffer and Blotato. YouTube takes the file from this computer, so there is no link to check.');
  if (mediaUnchecked && via === 'blotato' && mediaUrl === undefined) fail('--media-url-unchecked goes with --media-url. Without a link, Blotato gets the file uploaded from this computer, so there is no link to check.');
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
  const request = buildRequest(via, { network, pkg, privacy, media, destination, draft });
  const plan = planFacts(via, platform, network, { pkg, privacy, media, destination, account: chosen.account, choices: chosen.choices.map((c) => ({ id: c.id, name: c.name })), request, draft });
  const key = destination ? publishKey(via, pkg.sha256, network, destination) : null;
  const newest = key ? listAttempts(dir, key).at(-1) : null;
  // The link the service will fetch: the one this run sends, or the one an approved
  // post that goes on still holds. A post that is already out needs no link.
  const goesOn = !!newest && !fresh && ['planned', 'media_uploaded'].includes(stageOf(newest));
  const link = (goesOn ? newest.plan?.media?.url : !newest || fresh ? media?.url : null) ?? null;

  if (dryRun) {
    if (media?.missing && !(newest && !fresh && ['accepted', 'finished'].includes(stageOf(newest)))) missing.push(media.missing);
    const check = link ? await checkMedia(link, pkg, mediaUnchecked) : null;
    const problem = linkProblem(check, link, pkg, via);
    if (problem) missing.push(problem);
    let would = missing.length ? 'stop' : 'post';
    if (!missing.length && newest && !fresh) would = { planned: 'continue', media_uploaded: 'continue', sending: via === 'youtube' && readSession(dir, newest) ? 'resume' : 'stop', accepted: 'read', finished: 'nothing', failed: 'stop' }[stageOf(newest)] ?? 'stop';
    // A run that goes on with an earlier post sends what was approved then, and
    // stops when that one and this one are not both drafts or both posts.
    const mismatch = (would === 'continue' || would === 'resume') && draftMismatch(newest, draft);
    if (mismatch) would = 'stop';
    const earlier = would === 'continue' || would === 'resume';
    const changed = earlier && JSON.stringify(newest.request) !== JSON.stringify(request);
    // draft says whether the post the real run makes, or the one it finds, is a draft.
    const found = !missing.length && newest && !fresh;
    return { dry_run: true, via, platform, network, would, draft: found ? newest.plan?.draft === true : draft, missing, ...(newest && !fresh ? { job: shortId(newest), stage: stageOf(newest) } : {}), ...(changed ? { changed: true } : {}), ...(mismatch ? { reason: mismatch.replace(/^\w/, (c) => c.toUpperCase()) } : {}), plan: withCheck(earlier ? newest.plan : plan, check), request: earlier ? newest.request : request };
  }
  if (missing.length) fail(`${missing.join(' ')} Nothing was sent.`);

  if (newest && !fresh) {
    const stage = stageOf(newest);
    if (stage === 'finished') return result(newest, { already: true });
    if (stage === 'failed') fail(`the post of this file to ${destinationWords(newest)} failed at ${VIA[newest.provider].name} on ${when(newest.updated)}${newest.result?.error ? `: ${newest.result.error.replace(/\.$/, '')}` : ''}. To post it again, run the same command with --new.`);
    if (stage === 'accepted') return result(await follow(project, newest, { log }));
    if (stage === 'unknown' || (stage === 'sending' && via !== 'youtube')) fail(unknownOutcome(newest));
    // planned, media_uploaded, or a YouTube upload with a session: it goes on with
    // the request that was approved, not with what post.json says now, and only when
    // both runs are drafts or both are posts.
    const mismatch = draftMismatch(newest, draft);
    if (mismatch) fail(mismatch);
    if (!storedRequestFits(newest, { via, network, pkg, destination })) fail(`the record of the post approved on ${when(newest.created)} does not match this package or its own plan, so it was not used, and nothing was sent. To post the package as it is now, run the same command with --new.`);
    const changed = JSON.stringify(newest.request) !== JSON.stringify(request);
    const expiredLink = newest.plan?.media?.expires_at && Date.parse(newest.plan.media.expires_at) < Date.now() && !newest.media?.public_url;
    if (expiredLink) fail(`the link to the video in the post approved on ${when(newest.created)} expired on ${when(newest.plan.media.expires_at)}, so ${VIA[via].name} can't fetch it. Share the package again, then run the same command with --new. Nothing was sent.`);
    const check = link ? await checkMedia(link, pkg, mediaUnchecked) : null;
    const problem = linkProblem(check, link, pkg, via);
    if (problem) fail(`${problem} Nothing was sent.`);
    const earlierDraft = newest.plan?.draft === true;
    const earlierPlan = withCheck(newest.plan, check);
    notice(`This goes on with the ${earlierDraft ? 'draft' : 'post'} approved on ${when(newest.created)}, from where it stopped. It sends what was approved then.${changed ? ' post.json or the flags have changed since. To post the new version instead, run the same command with --new.' : ''}`);
    notice(planText(earlierPlan));
    if (!(await confirmed({ yes, ask, draft: earlierDraft }))) return needYes(earlierPlan, newest.request, true);
    return result(await carryOut(project, newest, { log, notice }), { continued: true });
  }

  if (media?.missing) fail(`${media.missing} Nothing was sent.`);
  const check = link ? await checkMedia(link, pkg, mediaUnchecked) : null;
  const problem = linkProblem(check, link, pkg, via);
  if (problem) fail(`${problem} Nothing was sent.`);
  const approved = withCheck(plan, check);
  notice(`This is the ${draft ? 'draft' : 'post'}. Nothing has been sent yet.\n${planText(approved)}`);
  if (!(await confirmed({ yes, ask, draft }))) return needYes(approved, request, false);
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
    job = createJob(dir, key, { kind: 'publish', provider: via, attempt, stage: 'planned', status: 'planned', network, destination: { ...destination, key: destinationKey(via, network, destination) }, account: chosen.account, plan: approved, request });
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
    const lines = [`${r.plan.draft ? 'This is the draft a real run would save in Buffer. Nothing was sent.' : 'This is what a real run would post. Nothing was posted.'}\n${planText(r.plan)}`];
    if (r.missing.length) lines.push('Before it can post:', ...r.missing.map((m) => `  ${m}`));
    const would = {
      post: r.plan.draft ? 'The real run shows this plan again and saves the draft only after a typed yes, or with --yes when there is no terminal.' : 'The real run shows this plan again and posts only after a typed yes, or with --yes when there is no terminal.',
      continue: `This post was approved before (job ${r.job}) and stopped before it went out. The real run goes on with it after a yes, and sends what was approved then.${r.changed ? ' post.json or the flags have changed since. To post the new version instead, add --new.' : ''}`,
      resume: `The upload of this post (job ${r.job}) stopped partway. The real run asks YouTube how much arrived and goes on from there after a yes.`,
      read: `This post was accepted before (job ${r.job}). The real run reads its status and posts nothing.`,
      nothing: r.draft ? `This file was already saved as a draft there (job ${r.job}). The real run sends nothing. To save another draft or post it anyway, add --new.` : `This file was already posted there (job ${r.job}). The real run prints its status and link and posts nothing.`,
      stop: r.missing.length ? null : r.reason ?? `An earlier try of this post (job ${r.job}) ${r.stage === 'failed' ? 'failed' : 'has no known outcome'}, so the real run stops. --new posts again.`,
    }[r.would];
    if (would) lines.push(would);
    return lines.join('\n');
  }
  if (r.confirmed === false) return '';
  const service = VIA[r.via].name;
  const where = `${r.destination?.name ?? '?'} on ${NETWORKS[r.network]}`;
  const through = r.via === 'youtube' ? '' : ` through ${service}`;
  const draftKept = r.draft && r.post.status === 'draft';
  if (r.already && r.draft && r.post.status !== 'sent') return [`This file was already saved as a draft for ${where} in Buffer (job ${r.job}), so nothing was sent.`, 'Schedule that draft in Buffer to post it. To save another draft or post it anyway, run the same command with --new.'].join('\n');
  if (r.already) return [`This file was already posted to ${where}${through} (job ${r.job}), so nothing was sent.`, `Status: ${r.post.status ?? 'unknown'}`, ...linkLines(r), 'To post it again anyway, run the same command with --new.'].join('\n');
  if (r.stage === 'failed') return [`${service} says the post to ${where} failed${r.post.error ? `: ${r.post.error}` : '.'}`, 'Nothing more is sent by itself. To post it again, run the same command with --new.'].join('\n');
  if (r.stage === 'finished' && draftKept) return [`Saved as a draft for ${where} in Buffer (id ${r.post.id}). Nothing was published.`, 'Status: draft', 'To post it, schedule the draft in Buffer.'].join('\n');
  const first = r.stage === 'finished'
    ? (r.draft ? `Buffer posted it to ${where} instead of keeping it as a draft.` : `Posted to ${where}${through}.`)
    : `${service} accepted the ${r.draft ? 'draft for' : 'post to'} ${where} (id ${r.post.id}).`;
  const lines = [first];
  if (r.post.status) lines.push(`Status: ${r.post.status}${r.post.details ? ` (${r.post.details})` : ''}`);
  lines.push(...linkLines(r));
  const waiting = r.note ? `The status could not be read: ${r.note}.` : r.draft ? 'Buffer does not show it as a draft. Look at the channel in Buffer.' : 'It is not finished yet.';
  if (r.stage === 'accepted') lines.push(`${waiting} Run the same command later to read the status. It will not post again.`);
  return lines.join('\n');
}
