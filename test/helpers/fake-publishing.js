// Fakes of the three posting services and their sign-ins, for fake-services.js.
// They follow the services' docs as far as a test needs: PKCE is checked, a code
// works once, Buffer gives a new refresh token on each refresh and ends the whole
// login when an old one comes back, a YouTube session answers 308 with the bytes it
// has, and a request that lacks a required field is refused.
import crypto from 'node:crypto';

export const GOOGLE_CLIENT = { id: 'fake-client.apps.googleusercontent.com', secret: 'fake-google-secret' };
// Buffer knows explainroo's public client, which is built in, and one that a user
// made of their own and put in BUFFER_CLIENT_ID.
export const BUFFER_CLIENT = 'bV6YR9jmW9kqN6sXNGwfza2QAwLF5NeRH-YzvfuHyTo';
export const OWN_BUFFER_CLIENT = 'fake-own-buffer-client';
const BUFFER_CLIENTS = [BUFFER_CLIENT, OWN_BUFFER_CLIENT];
// Some Blotato keys end in "=", and this one does too.
export const BLOTATO_KEY = 'fake-blotato-key==';
export const YOUTUBE_REDIRECT = 'http://127.0.0.1:8976/callback';
export const BUFFER_REDIRECT = 'https://localhost:8976/callback';
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

const s256 = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function publishingState() {
  return {
    serial: 0,
    codes: new Map(),
    grants: new Map(),
    tokens: new Map(),
    youtube: {
      channels: [{ id: 'UCfakechannel0000000000', snippet: { title: 'Fake Channel', customUrl: '@fakechannel' } }],
      sessions: new Map(),
      videos: new Map(),
    },
    buffer: {
      organizations: [{ id: 'org-1', name: 'Fake Org' }],
      channels: [
        { id: 'ch-youtube', organizationId: 'org-1', name: 'fakechannel', displayName: 'Fake Channel', service: 'youtube', isLocked: false, isDisconnected: false },
        { id: 'ch-tiktok', organizationId: 'org-1', name: 'fakehandle', displayName: '@fakehandle', service: 'tiktok', isLocked: false, isDisconnected: false },
        { id: 'ch-instagram', organizationId: 'org-1', name: 'fakegram', displayName: '@fakegram', service: 'instagram', isLocked: false, isDisconnected: false },
        { id: 'ch-linkedin', organizationId: 'org-1', name: 'fakeperson', displayName: 'Fake Person', service: 'linkedin', isLocked: false, isDisconnected: false },
        { id: 'ch-twitter', organizationId: 'org-1', name: 'fakebird', displayName: '@fakebird', service: 'twitter', isLocked: false, isDisconnected: false },
      ],
      posts: new Map(),
    },
    blotato: {
      accounts: [
        { id: '101', platform: 'youtube', fullname: 'Fake Channel', username: 'fakechannel' },
        { id: '102', platform: 'tiktok', fullname: 'Fake Handle', username: 'fakehandle' },
        { id: '103', platform: 'instagram', fullname: 'Fake Gram', username: 'fakegram' },
        { id: '104', platform: 'linkedin', fullname: 'Fake Person', username: 'fakeperson' },
        { id: '105', platform: 'twitter', fullname: 'Fake Bird', username: 'fakebird' },
      ],
      uploads: new Map(),
      posts: new Map(),
    },
  };
}

function next(state, prefix) {
  state.serial += 1;
  return `${prefix}${state.serial}`;
}

// What the person does in the browser: approve the link, which sends the browser to
// the redirect address with a code. A link without what the service needs fails here.
export function approveLink(state, link, { deny = false, scope } = {}) {
  const url = new URL(link);
  const p = url.searchParams;
  const service = url.host === 'accounts.google.com' ? 'youtube' : url.host === 'auth.buffer.com' ? 'buffer' : null;
  if (!service) throw new Error(`the fake has no sign-in at ${url.host}`);
  for (const name of ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']) {
    if (!p.get(name)) throw new Error(`the sign-in link has no ${name}`);
  }
  if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256') throw new Error('the sign-in link does not ask for a code with S256');
  const redirect = new URL(p.get('redirect_uri'));
  if (service === 'buffer' && (p.get('redirect_uri') !== BUFFER_REDIRECT || !BUFFER_CLIENTS.includes(p.get('client_id')))) throw new Error('Buffer only knows the registered clients and redirect address');
  if (service === 'youtube' && (p.get('redirect_uri') !== YOUTUBE_REDIRECT || p.get('access_type') !== 'offline')) throw new Error('the Google link has another redirect address or no offline access');
  if (deny) {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('state', p.get('state'));
    return redirect.toString();
  }
  const code = next(state, `${service}-code-`);
  const granted = scope ?? p.get('scope');
  state.codes.set(code, { service, client_id: p.get('client_id'), redirect_uri: p.get('redirect_uri'), challenge: p.get('code_challenge'), scope: granted, used: false });
  redirect.searchParams.set('state', p.get('state'));
  redirect.searchParams.set('code', code);
  if (service === 'youtube') redirect.searchParams.set('scope', granted);
  return redirect.toString();
}

function issue(state, grantId, { refresh }) {
  const grant = state.grants.get(grantId);
  const access = next(state, grant.service === 'youtube' ? 'ya29.fake-access-' : 'buffer-access-');
  state.tokens.set(access, { type: 'access', grant: grantId, expires: Date.now() + 3600 * 1000 });
  const answer = { access_token: access, expires_in: 3600, token_type: 'Bearer', scope: grant.scope };
  if (refresh) {
    const token = next(state, grant.service === 'youtube' ? '1//fake-refresh-' : 'buffer-refresh-');
    state.tokens.set(token, { type: 'refresh', grant: grantId });
    grant.refresh = token;
    answer.refresh_token = token;
  }
  return answer;
}

// The grant behind an access token, or null when it is unknown, ran out or was ended.
export function grantOf(state, header, service) {
  const token = /^Bearer (.+)$/.exec(header ?? '')?.[1];
  const entry = token && state.tokens.get(token);
  if (!entry || entry.type !== 'access' || entry.expires < Date.now()) return null;
  const grant = state.grants.get(entry.grant);
  return grant && !grant.revoked && grant.service === service ? grant : null;
}

// A login made without the browser steps, as the lines connect saves, for tests
// that are about something else. A Buffer login uses the built-in client, so it
// has no BUFFER_CLIENT_ID line.
export function loginLines(state, service) {
  const grantId = next(state, 'grant-');
  const scope = service === 'youtube' ? `${UPLOAD_SCOPE} ${READ_SCOPE}` : 'account:read posts:read posts:write offline_access';
  state.grants.set(grantId, { service, scope, revoked: false, refresh: null, client_id: service === 'youtube' ? GOOGLE_CLIENT.id : BUFFER_CLIENT });
  const tokens = issue(state, grantId, { refresh: true });
  if (service === 'youtube') return { YOUTUBE_CLIENT_ID: GOOGLE_CLIENT.id, YOUTUBE_CLIENT_SECRET: GOOGLE_CLIENT.secret, YOUTUBE_REFRESH_TOKEN: tokens.refresh_token };
  return { BUFFER_ACCESS_TOKEN: tokens.access_token, BUFFER_REFRESH_TOKEN: tokens.refresh_token, BUFFER_TOKEN_EXPIRES: new Date(Date.now() + 3600 * 1000).toISOString() };
}

// Makes the access tokens of a service run out, as an hour would.
export function expireAccess(state, service) {
  for (const entry of state.tokens.values()) {
    if (entry.type === 'access' && state.grants.get(entry.grant)?.service === service) entry.expires = 0;
  }
}

function tokenRoute(service) {
  return ({ req, res, raw, state }) => {
    const p = state.publishing;
    if (!/application\/x-www-form-urlencoded/.test(req.headers['content-type'] ?? '')) return sendJson(res, 400, { error: 'invalid_request', error_description: 'form encoded body required' });
    const form = new URLSearchParams(raw.toString('utf8'));
    const bad = (error, description, status = 400) => sendJson(res, status, { error, error_description: description });
    if (service === 'youtube' && (form.get('client_id') !== GOOGLE_CLIENT.id || form.get('client_secret') !== GOOGLE_CLIENT.secret)) return bad('invalid_client', 'Unauthorized', 401);
    // A public client has no secret to send.
    if (service === 'buffer' && (!BUFFER_CLIENTS.includes(form.get('client_id')) || form.has('client_secret'))) return bad('invalid_client', 'Unknown public client', 401);
    if (form.get('grant_type') === 'authorization_code') {
      const code = p.codes.get(form.get('code'));
      if (!code || code.service !== service || code.used) return bad('invalid_grant', 'Malformed auth code.');
      code.used = true;
      if (form.get('redirect_uri') !== code.redirect_uri || form.get('client_id') !== code.client_id) return bad('invalid_grant', 'redirect_uri or client_id does not match');
      if (s256(form.get('code_verifier') ?? '') !== code.challenge) return bad('invalid_grant', 'Invalid code verifier.');
      const grantId = next(p, 'grant-');
      p.grants.set(grantId, { service, scope: code.scope, revoked: false, refresh: null, client_id: code.client_id });
      const offline = service === 'youtube' || code.scope.split(' ').includes('offline_access');
      return sendJson(res, 200, issue(p, grantId, { refresh: offline }));
    }
    if (form.get('grant_type') === 'refresh_token') {
      const entry = p.tokens.get(form.get('refresh_token'));
      const grant = entry?.type === 'refresh' ? p.grants.get(entry.grant) : null;
      if (!grant || grant.service !== service || grant.revoked) return bad('invalid_grant', 'Token has been expired or revoked.');
      // Only the client that made a login can renew it.
      if (form.get('client_id') !== grant.client_id) return bad('invalid_grant', 'The refresh token belongs to another client.');
      if (service === 'buffer') {
        // A refresh token works once. One that comes back ends the whole login.
        if (grant.refresh !== form.get('refresh_token')) {
          grant.revoked = true;
          return bad('invalid_grant', 'Refresh token reuse detected. The grant was revoked.');
        }
        return sendJson(res, 200, issue(p, entry.grant, { refresh: true }));
      }
      return sendJson(res, 200, issue(p, entry.grant, { refresh: false }));
    }
    return bad('unsupported_grant_type', 'unsupported grant type');
  };
}

function googleError(res, status, reason, message) {
  sendJson(res, status, { error: { code: status, message, errors: [{ reason, message, domain: 'youtube' }] } });
}

function youtubeVideo(p, session) {
  const id = next(p, 'vid');
  const video = { kind: 'youtube#video', id, snippet: session.meta.snippet, status: { uploadStatus: 'uploaded', ...session.meta.status }, sha256: sha256(Buffer.concat(session.chunks)) };
  p.youtube.videos.set(id, video);
  session.video = video;
  return video;
}

function sessionAnswer(res, session) {
  if (session.video) return sendJson(res, 200, { kind: 'youtube#video', id: session.video.id, snippet: session.video.snippet, status: session.video.status });
  const have = session.chunks.reduce((n, c) => n + c.length, 0);
  res.writeHead(308, have ? { Range: `bytes=0-${have - 1}` } : {});
  return res.end();
}

const youtubeRoutes = {
  'GET /youtube/v3/channels': ({ req, res, state }) => {
    const grant = grantOf(state.publishing, req.headers.authorization, 'youtube');
    if (!grant) return googleError(res, 401, 'authError', 'Invalid Credentials');
    if (!grant.scope.split(' ').includes(READ_SCOPE)) return googleError(res, 403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
    sendJson(res, 200, { kind: 'youtube#channelListResponse', items: state.publishing.youtube.channels });
  },
  'POST /upload/youtube/v3/videos': ({ req, res, body, state }) => {
    const p = state.publishing;
    const grant = grantOf(p, req.headers.authorization, 'youtube');
    if (!grant) return googleError(res, 401, 'authError', 'Invalid Credentials');
    if (!grant.scope.split(' ').includes(UPLOAD_SCOPE)) return googleError(res, 403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
    const url = new URL(req.url, 'http://fake');
    if (url.searchParams.get('uploadType') !== 'resumable' || !String(url.searchParams.get('part')).split(',').includes('status')) return googleError(res, 400, 'invalidParameter', 'resumable upload with part=snippet,status expected');
    const size = Number(req.headers['x-upload-content-length']);
    if (!(size > 0) || !/^video\//.test(req.headers['x-upload-content-type'] ?? '')) return googleError(res, 400, 'invalidParameter', 'X-Upload-Content-Length and X-Upload-Content-Type are required');
    const title = body?.snippet?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 100 || /[<>]/.test(title)) return googleError(res, 400, 'invalidTitle', 'The request metadata specifies an invalid or empty video title.');
    if (!['private', 'unlisted', 'public'].includes(body?.status?.privacyStatus)) return googleError(res, 400, 'invalidVideoMetadata', 'privacyStatus is invalid');
    const id = next(p, 'upload-');
    p.youtube.sessions.set(id, { id, size, meta: body, query: Object.fromEntries(url.searchParams), headers: { length: req.headers['x-upload-content-length'], type: req.headers['x-upload-content-type'] }, chunks: [], video: null });
    res.writeHead(200, { Location: `http://${req.headers.host}/youtube/upload/youtube/v3/videos?uploadType=resumable&upload_id=${id}` });
    res.end();
  },
  // { keep: n } keeps n bytes of a PUT and then drops the connection, or with
  // then: 'hang' never answers, like a run that dies partway.
  'PUT /upload/youtube/v3/videos': ({ req, res, raw, state, step }) => {
    const p = state.publishing;
    const url = new URL(req.url, 'http://fake');
    const session = p.youtube.sessions.get(url.searchParams.get('upload_id'));
    if (!session || session.gone) return googleError(res, 404, 'notFound', 'The upload session no longer exists.');
    if (!grantOf(p, req.headers.authorization, 'youtube')) return googleError(res, 401, 'authError', 'Invalid Credentials');
    const range = req.headers['content-range'] ?? null;
    if (!raw.length) {
      if (range !== `bytes */${session.size}`) return googleError(res, 400, 'badRequest', 'a status check needs Content-Range: bytes */<size>');
      return sessionAnswer(res, session);
    }
    if (session.video) return sessionAnswer(res, session);
    const have = session.chunks.reduce((n, c) => n + c.length, 0);
    const m = range ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range) : null;
    const start = m ? Number(m[1]) : 0;
    if ((range && !m) || start !== have || (m && Number(m[3]) !== session.size)) return googleError(res, 400, 'badRequest', `the upload has ${have} bytes, and this part starts at ${start}`);
    const kept = step?.keep !== undefined ? raw.subarray(0, step.keep) : raw;
    session.chunks.push(Buffer.from(kept));
    session.puts = (session.puts ?? 0) + 1;
    if (step?.keep !== undefined) {
      if (step.then === 'hang') return;
      return req.socket.destroy();
    }
    if (have + kept.length >= session.size) {
      const video = youtubeVideo(p, session);
      return sendJson(res, 201, { kind: 'youtube#video', id: video.id, snippet: video.snippet, status: video.status });
    }
    return sessionAnswer(res, session);
  },
  'GET /youtube/v3/videos': ({ req, res, state }) => {
    const p = state.publishing;
    if (!grantOf(p, req.headers.authorization, 'youtube')) return googleError(res, 401, 'authError', 'Invalid Credentials');
    const url = new URL(req.url, 'http://fake');
    const video = p.youtube.videos.get(url.searchParams.get('id'));
    sendJson(res, 200, { kind: 'youtube#videoListResponse', items: video ? [{ id: video.id, status: { ...video.status, uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] : [] });
  },
};

// Buffer answers GraphQL errors with HTTP 200, and a request it refused before
// running has no data at all. Only a missing login gets a 401.
function gqlError(res, status, message, code) {
  sendJson(res, status, { errors: [{ message, extensions: { code } }] });
}

const REQUIRED_POST = ['channelId', 'mode', 'schedulingType', 'needsApproval', 'assets'];

// What Buffer's reference makes required on createPost, and for each network.
function createPostProblem(input, channel) {
  for (const field of REQUIRED_POST) if (input?.[field] === undefined || input[field] === null) return `Variable "$input" got invalid value; Field "${field}" of required type was not provided.`;
  if (!Array.isArray(input.assets) || !input.assets.some((a) => typeof a?.video?.url === 'string')) return 'Variable "$input" got invalid value; a video asset needs a url.';
  if (input.assets.some((a) => a?.video && Object.hasOwn(a.video, 'thumbnailUrl'))) return 'Variable "$input" got invalid value; Field "thumbnailUrl" is not defined by type "VideoAssetInput".';
  if (!channel) return null;
  const meta = input.metadata ?? {};
  if (channel.service === 'youtube' && (typeof meta.youtube?.title !== 'string' || typeof meta.youtube?.categoryId !== 'string')) return 'Variable "$input" got invalid value; Field "title" and "categoryId" of required type "String!" were not provided in metadata.youtube.';
  if (channel.service === 'instagram' && (typeof meta.instagram?.type !== 'string' || typeof meta.instagram?.shouldShareToFeed !== 'boolean')) return 'Variable "$input" got invalid value; Field "type" and "shouldShareToFeed" are required in metadata.instagram.';
  return null;
}

const bufferRoutes = {
  'POST /': ({ req, res, body, state }) => {
    const p = state.publishing;
    if (!grantOf(p, req.headers.authorization, 'buffer')) return gqlError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    const op = body?.operationName;
    const query = String(body?.query ?? '');
    const input = body?.variables?.input;
    if (op === 'Organizations' && /\borganizations\b/.test(query)) return sendJson(res, 200, { data: { account: { organizations: p.buffer.organizations } } });
    if (op === 'Channels' && /\bchannels\b/.test(query)) {
      if (!input?.organizationId) return gqlError(res, 200, 'Variable "$input" got invalid value; Field "organizationId" of required type "OrganizationId!" was not provided.', 'BAD_USER_INPUT');
      return sendJson(res, 200, { data: { channels: p.buffer.channels.filter((c) => c.organizationId === input.organizationId) } });
    }
    if (op === 'CreatePost' && /\bmutation\b/.test(query) && /\bcreatePost\b/.test(query)) {
      const channel = p.buffer.channels.find((c) => c.id === input?.channelId);
      const problem = createPostProblem(input, channel);
      if (problem) return gqlError(res, 200, problem, 'BAD_USER_INPUT');
      if (!channel) return sendJson(res, 200, { data: { createPost: { __typename: 'NotFoundError', message: 'Channel not found' } } });
      if (channel.isLocked || channel.isDisconnected) return sendJson(res, 200, { data: { createPost: { __typename: 'InvalidInputError', message: 'Channel is locked or disconnected' } } });
      const id = next(p, 'post-');
      p.buffer.posts.set(id, { id, input, channelId: channel.id, status: 'sending', reads: 0 });
      return sendJson(res, 200, { data: { createPost: { __typename: 'PostActionSuccess', post: { id, status: 'sending', externalLink: null } } } });
    }
    if (op === 'ReadPost' && /\bpost\b/.test(query)) {
      const post = p.buffer.posts.get(input?.id);
      if (!post) return sendJson(res, 200, { data: { post: null } });
      post.reads += 1;
      // The first read finds it sent, unless a test set another status.
      if (post.status === 'sending') post.status = post.next ?? 'sent';
      const channel = p.buffer.channels.find((c) => c.id === post.channelId);
      return sendJson(res, 200, { data: { post: { id: post.id, status: post.status, externalLink: post.status === 'sent' ? `https://social.example/${channel.name}/${post.id}` : null, sentAt: post.status === 'sent' ? new Date().toISOString() : null, error: post.status === 'error' ? { message: post.error ?? 'The network refused the video.' } : null } } });
    }
    return gqlError(res, 200, `the fake does not know the operation ${op}`, 'GRAPHQL_VALIDATION_FAILED');
  },
};

function blotatoAuth(req, res) {
  if (req.headers['blotato-api-key'] !== BLOTATO_KEY) {
    sendJson(res, 401, { message: 'Unauthorized: invalid API key' });
    return false;
  }
  return true;
}

const TIKTOK = ['privacyLevel', 'disabledComments', 'disabledDuet', 'disabledStitch', 'isBrandedContent', 'isYourBrand', 'isAiGenerated'];
const YOUTUBE = ['title', 'privacyStatus', 'shouldNotifySubscribers'];

function blotatoPostProblem(p, post) {
  if (!post || typeof post !== 'object') return 'post is required';
  const account = p.blotato.accounts.find((a) => a.id === String(post.accountId));
  if (!account) return 'accountId is not one of your accounts';
  const { content, target } = post;
  if (typeof content?.text !== 'string' || !Array.isArray(content.mediaUrls) || !content.platform) return 'content needs text, mediaUrls and platform';
  if (content.mediaUrls.some((url) => !/^https?:\/\//.test(url))) return 'mediaUrls must be public addresses';
  if (!target?.targetType || target.targetType !== content.platform || content.platform !== account.platform) return 'target.targetType must match content.platform and the account';
  const need = { tiktok: TIKTOK, youtube: YOUTUBE }[target.targetType] ?? [];
  const missing = need.filter((field) => target[field] === undefined);
  if (missing.length) return `target is missing ${missing.join(', ')}`;
  if (target.targetType === 'tiktok' && !['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR'].includes(target.privacyLevel)) return 'privacyLevel is not valid';
  if (target.targetType === 'instagram' && target.mediaType !== 'reel') return 'mediaType must be reel for a video';
  return null;
}

const blotatoRoutes = {
  'GET /users/me/accounts': ({ req, res, state }) => {
    if (!blotatoAuth(req, res)) return;
    const platform = new URL(req.url, 'http://fake').searchParams.get('platform');
    sendJson(res, 200, { items: state.publishing.blotato.accounts.filter((a) => !platform || a.platform === platform) });
  },
  'POST /media/uploads': ({ req, res, body, state }) => {
    if (!blotatoAuth(req, res)) return;
    if (typeof body?.filename !== 'string' || !body.filename) return sendJson(res, 400, { message: 'filename is required' });
    const id = next(state.publishing, 'media-');
    const publicUrl = `https://database.blotato.example/${id}/${body.filename}`;
    state.publishing.blotato.uploads.set(id, { id, publicUrl, bytes: null });
    sendJson(res, 201, { presignedUrl: `http://${req.headers.host}/blotato-storage/${id}?X-Amz-Signature=fake`, publicUrl });
  },
  'POST /posts': ({ req, res, body, state }) => {
    if (!blotatoAuth(req, res)) return;
    const problem = blotatoPostProblem(state.publishing, body?.post);
    if (problem) return sendJson(res, 400, { message: problem });
    const id = next(state.publishing, 'submission-');
    state.publishing.blotato.posts.set(id, { id, body, reads: 0 });
    sendJson(res, 201, { postSubmissionId: id });
  },
  'GET /posts/*': ({ req, res, pathname, state }) => {
    if (!blotatoAuth(req, res)) return;
    const post = state.publishing.blotato.posts.get(decodeURIComponent(pathname.split('/')[2]));
    if (!post) return sendJson(res, 404, { message: 'Post not found' });
    post.reads += 1;
    sendJson(res, 200, { postSubmissionId: post.id, status: 'published', publicUrl: `https://social.example/blotato/${post.id}` });
  },
};

// Where a presigned address points. The key must never come along.
const storageRoutes = {
  'PUT /*': ({ req, res, raw, pathname, state }) => {
    if (req.headers['blotato-api-key'] !== undefined) return sendJson(res, 400, { message: 'a presigned upload takes no API key' });
    const upload = state.publishing.blotato.uploads.get(pathname.slice(1));
    if (!upload) return sendJson(res, 403, { message: 'SignatureDoesNotMatch' });
    upload.bytes = sha256(raw);
    res.writeHead(200);
    res.end();
  },
};

export const PUBLISHING_ROUTES = {
  youtube: youtubeRoutes,
  'youtube-auth': { 'POST /token': tokenRoute('youtube') },
  buffer: bufferRoutes,
  'buffer-auth': { 'POST /token': tokenRoute('buffer') },
  blotato: blotatoRoutes,
  'blotato-storage': storageRoutes,
};
