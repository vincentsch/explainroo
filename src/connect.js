// explainroo connect <service>: walks through setting a service up. A key comes
// from a hidden prompt or from stdin, and never from the command line, because
// arguments end up in shell history and agent logs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectError, rememberSecret } from './errors.js';
import { findEnv, keyFile, saveKey, saveKeys } from './env.js';
import { forgetSignIn, readCallback, startSignIn, tokenRequest } from './oauth.js';
import { ensureIgnored, selfCommand, shellWord } from './history.js';
import { findProjectDir } from './project.js';
import { SERVICES, findService, needsKey } from './services.js';
import { findConnector } from './connectors/index.js';

const FLAGS = new Set(['key-stdin', 'project', 'json', 'quiet', 'callback-url']);

function readHidden(prompt) {
  const { stdin, stderr } = process;
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      // A terminal can wrap pasted text in these markers.
      for (const ch of chunk.replace(/\x1b\[20[01]~/g, '')) {
        if (ch === '\r' || ch === '\n' || ch === '\x04') return finish();
        if (ch === '\x03') return finish(new ProjectError('stopped, and nothing was saved.'));
        if (ch === '\x7f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    // The terminal stops echoing first, so a key pasted at once stays hidden.
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stderr.write(prompt);
  });
}

async function readStdinLines() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readStdin() {
  return (await readStdinLines())[0] ?? '';
}

function explain(service) {
  return [
    service.name,
    service.about,
    `Cost: ${service.cost}`,
    `Data that leaves this computer: ${service.data_leaves}`,
    'Steps:',
    ...service.setup.steps.map((step, i) => `  ${i + 1}. ${step}`),
  ].join('\n');
}

export async function connect(args, flags, { print, log, notice }) {
  const [name, ...rest] = args;
  const known = SERVICES.filter(needsKey).map((s) => s.id);
  if (name === undefined) throw new ProjectError(`usage: explainroo connect <service> [--key-stdin] [--callback-url '<address>'] [--project <dir>]. Services to set up: ${known.join(', ')}. "explainroo services" lists them all.`);
  const service = findService(name);
  // The word itself isn't repeated, because it may be a key typed in the wrong place.
  if (!service) throw new ProjectError(`there is no service with that name. The services are: ${SERVICES.map((s) => s.id).join(', ')}. A key never goes on the command line.`);
  // Whatever else is on the line may be a key, so it is never repeated.
  if (rest.length || Object.keys(flags).some((flag) => !FLAGS.has(flag))) {
    throw new ProjectError('connect only takes the service, --key-stdin, --callback-url and --project. A key never goes on the command line, because it would end up in shell history and logs.');
  }
  if (!needsKey(service)) {
    const use = service.setup.use;
    const coming = service.status === 'coming' ? ' The service is coming, so it may not answer yet.' : '';
    print(`${service.name} ${service.free ? 'is free and ' : ''}needs no setting up.${coming}\n${service.setup.steps.join('\n')}\n${use}`, { service: service.id, free: service.free, needs_key: false, ...(coming ? { coming: true } : {}), steps: service.setup.steps, use });
    return 0;
  }
  if (service.status === 'coming') throw new ProjectError(`${service.name} is not available yet.`);
  const connector = findConnector(service.connector ?? service.id);
  const env = service.setup.env[0];
  if (flags.project === true) throw new ProjectError('--project needs a value');
  const project = flags.project === undefined ? null : findProjectDir(flags.project);
  const file = keyFile({ project });
  const lookIn = project ?? process.cwd();
  // A project's .env can be a link to a file that git tracks, in a stranger's project too.
  if (project && fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ProjectError(`${file} is a link, so a key saved there could end up anywhere. Remove the link, or leave out --project.`);
  // Ignoring a file does nothing once git tracks it, so the next commit would hold the key.
  if (project && spawnSync('git', ['ls-files', '--error-unmatch', '.env'], { cwd: project, stdio: 'ignore' }).status === 0) throw new ProjectError(`git tracks ${file}, so a key saved there would end up in a commit. Leave out --project to save it in the settings folder.`);
  if (service.setup.login === 'oauth') return signIn(service, connector, { flags, project, file, lookIn, print, log, notice });
  if (flags['callback-url'] !== undefined) throw new ProjectError(`--callback-url is for services that sign in through the browser: ${SERVICES.filter((s) => s.setup.login === 'oauth').map((s) => s.id).join(', ')}.`);

  let key;
  // A terminal shows what is typed on stdin, so there the hidden prompt takes over.
  if (flags['key-stdin'] && !process.stdin.isTTY) {
    log(explain(service));
    key = await readStdin();
  } else if (process.stdin.isTTY) {
    notice(explain(service));
    if (findEnv(env, lookIn)) notice(`A key for ${connector.name} is already set up. A new one replaces it in ${file}.`);
    key = await readHidden(`Paste your ${connector.name} key (it will not show): `);
  } else {
    const self = selfCommand();
    const target = project ? ` --project ${shellWord(path.relative(process.cwd(), project) || '.')}` : '';
    const terminal = `${self} connect ${service.id}${target}`;
    const stdin = `printf '%s\\n' "$${env}" | ${self} connect ${service.id}${target} --key-stdin`;
    print(`${explain(service)}\n\nThere is no terminal here to ask for the key, so nothing has changed. To finish, do one of these:\n  Run this in your own terminal, and paste the key when it asks: ${terminal}\n  Or send the key on stdin: ${stdin}\nA key never goes on the command line.`, {
      service: service.id, free: service.free, needs_key: true, connected: !!findEnv(env, lookIn), about: service.about, cost: service.cost, data_leaves: service.data_leaves, url: service.setup.url, steps: service.setup.steps, env, finish: { terminal, stdin },
    });
    return 0;
  }
  rememberSecret(key);
  if (!key) throw new ProjectError('no key came in, so nothing was saved.');
  if (!/^[\x21-\x7e]+$/.test(key)) throw new ProjectError('that does not look like a key, because it has spaces or unusual characters. Nothing was saved.');
  try {
    await connector.test(key);
  } catch (e) {
    if (e instanceof ProjectError) throw new ProjectError(`${e.message.replace(/\.$/, '')}. Nothing was saved.`);
    throw e;
  }
  saveKey(file, env, key);
  if (project) ensureIgnored(project, '.env');
  // The lookup order can put another value first, and the user should know.
  const shadowed = findEnv(env, lookIn) !== key;
  const note = shadowed ? `\nA different ${env} is set in the environment or in a .env file that is read first, so that one is still used.` : '';
  print(`The key works, and it is saved in ${file}.\n${connector.name} is connected. ${service.setup.use}${note}`, { service: service.id, connected: true, file, env, use: service.setup.use, ...(shadowed ? { shadowed: true } : {}) });
  return 0;
}

// The Google client of the user's own Cloud project. It comes from a hidden prompt
// or as two lines on stdin, the way a key does, and a saved one can be kept.
async function googleClient(service, connector, { flags, file, lookIn, project, print, log, notice, again }) {
  const env = connector.signIn.env;
  const savedId = findEnv(env.id, lookIn);
  const savedSecret = findEnv(env.secret, lookIn);
  let id;
  let secret;
  if (flags['key-stdin'] && !process.stdin.isTTY) {
    log(explain(service));
    [id = '', secret = ''] = await readStdinLines();
  } else if (process.stdin.isTTY) {
    notice(explain(service));
    id = await readHidden(`Paste the client id${savedId && savedSecret ? ', or press Enter to keep the saved client' : ''} (it will not show): `);
    if (!id && savedId && savedSecret) return { id: savedId, kept: true };
    secret = await readHidden('Paste the client secret (it will not show): ');
  } else if (savedId && savedSecret) {
    return { id: savedId, kept: true };
  } else {
    const stdin = `printf '%s\\n%s\\n' "$${env.id}" "$${env.secret}" | ${again} --key-stdin`;
    print(`${explain(service)}\n\nThere is no terminal here to ask for the client id and secret, so nothing has changed. To go on, do one of these:\n  Run this in your own terminal, and paste them when it asks: ${again}\n  Or send them on stdin as two lines, the id first: ${stdin}\nA secret never goes on the command line.`, {
      service: service.id, free: service.free, needs_key: true, connected: false, about: service.about, cost: service.cost, data_leaves: service.data_leaves, url: service.setup.url, steps: service.setup.steps, env: [env.id, env.secret], finish: { terminal: again, stdin },
    });
    return null;
  }
  rememberSecret(secret);
  if (!id || !secret) throw new ProjectError('it needs the client id and the client secret, on two lines. Nothing was saved.');
  if (![id, secret].every((value) => /^[\x21-\x7e]+$/.test(value))) throw new ProjectError('that does not look like a client id and secret, because one has spaces or unusual characters. Nothing was saved.');
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new ProjectError('the first line has to be the client id, which ends with .apps.googleusercontent.com, and the second the client secret. Nothing was saved.');
  saveKeys(file, { [env.id]: id, [env.secret]: secret });
  if (project) ensureIgnored(project, '.env');
  return { id, saved: true };
}

// Buffer's public client. Explainroo has no registered one yet, so it comes from
// BUFFER_CLIENT_ID until it does.
function bufferClient(service, connector, { lookIn, print }) {
  const id = connector.clientId(lookIn);
  if (id) return { id };
  const steps = connector.clientSteps();
  print(`${explain(service)}\n\nBuffer needs a public client to sign in with, and explainroo has none built in yet. You can make your own in your Buffer account:\n${steps.map((step, i) => `  ${i + 1}. ${step}`).join('\n')}\nThen put BUFFER_CLIENT_ID=<the client id> in ${keyFile({})}, or set it in the environment, and run this again.`, {
    service: service.id, free: service.free, needs_key: true, connected: false, needs_client: true, about: service.about, cost: service.cost, data_leaves: service.data_leaves, url: service.setup.url, client_steps: steps, redirect_uri: connector.signIn.redirectUri, env: ['BUFFER_CLIENT_ID'],
  });
  return null;
}

// Signing in through the browser, in two steps. See src/oauth.js.
async function signIn(service, connector, options) {
  const { flags, project, file, print } = options;
  const target = project ? ` --project ${shellWord(path.relative(process.cwd(), project) || '.')}` : '';
  const again = `${selfCommand()} connect ${service.id}${target}`;
  const address = flags['callback-url'];
  if (address === true) throw new ProjectError("--callback-url needs the address the browser landed on, in single quotes");
  if (address !== undefined) {
    if (flags['key-stdin']) throw new ProjectError('--callback-url and --key-stdin belong to different steps. Run them one at a time.');
    return finishSignIn(service, connector, { ...options, address, again });
  }
  const client = service.id === 'youtube' ? await googleClient(service, connector, { ...options, again }) : bufferClient(service, connector, options);
  if (!client) return 0;
  const { signIn: s } = connector;
  const { link } = startSignIn(service.id, { authorizeUrl: s.authorizeUrl, clientId: client.id, redirectUri: s.redirectUri, scopes: s.scopes, params: s.params, target: file });
  const finish = `${again} --callback-url '<the address>'`;
  const kept = client.kept ? 'It uses the client that is already saved. ' : client.saved ? `The client is saved in ${file}. ` : '';
  const words = [
    `${kept}Open this link in a browser, sign in to ${connector.name} and approve:`,
    link,
    `The browser then goes to ${s.redirectUri} and shows an error page, because nothing runs there. That is expected.`,
    'Copy the whole address from the address bar, and run:',
    `  ${finish}`,
    `The link works for an hour. The login is saved only in that step.`,
  ].join('\n');
  print(words, { service: service.id, link, redirect_uri: s.redirectUri, file, client: client.kept ? 'kept' : client.saved ? 'saved' : 'built in', finish });
  return 0;
}

async function finishSignIn(service, connector, { address, again, file, lookIn, project, print }) {
  const s = connector.signIn;
  const { code, pending } = readCallback(service.id, address, { name: connector.name, command: again, target: file });
  const form = { grant_type: 'authorization_code', code, redirect_uri: pending.redirect_uri, client_id: pending.client_id, code_verifier: pending.verifier };
  if (service.id === 'youtube') {
    if (findEnv(s.env.id, lookIn) !== pending.client_id) throw new ProjectError(`the saved Google client is not the one this sign-in started with. Run "${again}" again.`);
    form.client_secret = rememberSecret(findEnv(s.env.secret, lookIn));
  }
  // The code works once, so the waiting sign-in goes as soon as the code is sent.
  forgetSignIn(service.id);
  const r = await tokenRequest(s.tokenUrl(), form, { name: service.id === 'youtube' ? 'Google' : connector.name });
  if (!r.ok) {
    if (r.reason === 'no-answer') throw new ProjectError(`${service.id === 'youtube' ? 'Google' : connector.name} did not answer, so the sign-in was not finished. Run "${again}" for a new link. Nothing was saved.`);
    throw new ProjectError(`${r.message}, so the sign-in was not finished. A code from the browser works once and for a few minutes. Run "${again}" for a new link. Nothing was saved.`);
  }
  const tokens = r.json;
  const granted = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : null;
  const left = granted ? s.scopes.filter((scope) => !granted.includes(scope)) : [];
  if (left.length) throw new ProjectError(`the sign-in did not allow everything explainroo needs (${left.join(', ')} is missing). Run "${again}" again and allow all of it. Nothing was saved.`);
  if (!tokens.refresh_token) throw new ProjectError(`${connector.name} gave no refresh token, so the login would end within the hour. Run "${again}" again. Nothing was saved.`);
  let who;
  try {
    who = await connector.test(tokens.access_token);
  } catch (e) {
    if (e instanceof ProjectError) throw new ProjectError(`${e.message.replace(/\.$/, '')}. Nothing was saved.`);
    throw e;
  }
  const values = connector.loginLines(tokens, pending);
  saveKeys(file, values);
  if (project) ensureIgnored(project, '.env');
  const refreshName = Object.keys(values).find((name) => /REFRESH_TOKEN$/.test(name));
  const shadowed = findEnv(refreshName, lookIn) !== values[refreshName];
  const note = shadowed ? `\nA different ${refreshName} is set in the environment or in a .env file that is read first, so that one is still used.` : '';
  print(`Signed in to ${connector.name}${who ? ` as ${who}` : ''}. The login is saved in ${file}.\n${service.setup.use}${note}`, { service: service.id, connected: true, file, account: who ?? null, ...(shadowed ? { shadowed: true } : {}) });
  return 0;
}
