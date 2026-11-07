// explainroo connect <service>: walks through setting a service up. A key comes
// from a hidden prompt or from stdin, and never from the command line, because
// arguments end up in shell history and agent logs.
import path from 'node:path';
import { ProjectError, rememberSecret } from './errors.js';
import { findEnv, keyFile, saveKey } from './env.js';
import { ensureIgnored, selfCommand, shellWord } from './history.js';
import { findProjectDir } from './project.js';
import { SERVICES, findService, needsKey } from './services.js';
import { findConnector } from './connectors/index.js';

const FLAGS = new Set(['key-stdin', 'project', 'json', 'quiet']);

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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
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
  if (name === undefined) throw new ProjectError(`usage: explainroo connect <service> [--key-stdin] [--project <dir>]. Services with a key: ${known.join(', ')}. "explainroo services" lists them all.`);
  const service = findService(name);
  if (!service) throw new ProjectError(`there is no service "${name}". The services are: ${SERVICES.map((s) => s.id).join(', ')}.`);
  // Whatever else is on the line may be a key, so it is never repeated.
  if (rest.length || Object.keys(flags).some((flag) => !FLAGS.has(flag))) {
    throw new ProjectError('connect only takes the service, --key-stdin and --project. A key never goes on the command line, because it would end up in shell history and logs.');
  }
  if (!needsKey(service)) {
    const use = service.setup.use;
    print(`${service.name} ${service.free ? 'is free and ' : ''}needs no setting up.\n${service.setup.steps.join('\n')}\n${use}`, { service: service.id, free: service.free, needs_key: false, steps: service.setup.steps, use });
    return 0;
  }
  if (service.status === 'coming') throw new ProjectError(`${service.name} is not available yet.`);
  const connector = findConnector(service.id);
  const env = service.setup.env[0];
  if (flags.project === true) throw new ProjectError('--project needs a value');
  const project = flags.project === undefined ? null : findProjectDir(flags.project);
  const file = keyFile({ project });
  const lookIn = project ?? process.cwd();

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
  const note = shadowed ? `\nNote: a different ${env} is set in the environment or in a .env file that is read first, so that one is still used.` : '';
  print(`The key works, and it is saved in ${file}.\n${connector.name} is connected. ${service.setup.use}${note}`, { service: service.id, connected: true, file, env, use: service.setup.use, ...(shadowed ? { shadowed: true } : {}) });
  return 0;
}
