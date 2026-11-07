// The list of outside services and free routes for each step of making a video.
// src/services.json holds the data, so the website can read the same file later.
// This file imports no connector, so project.js can use it.
import fs from 'node:fs';
import { ProjectError } from './errors.js';

const data = JSON.parse(fs.readFileSync(new URL('./services.json', import.meta.url), 'utf8'));

export const STEPS = data.steps;
export const SERVICES = data.services;

export function findService(id) {
  return SERVICES.find((s) => s.id === id) ?? null;
}

export function needsKey(service) {
  return service.setup.env.length > 0;
}

// "a, b or c"
export function oneOf(words) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

// What video.json may say for each voice provider: its settings and defaults.
export function voiceProviders() {
  return Object.fromEntries(SERVICES.filter((s) => s.voice).map((s) => [s.id, { name: s.name, ...s.voice }]));
}

// The labels shown next to a name. "paid partner" appears only when it is true.
export function serviceLabels(service, connected) {
  return [
    service.free ? 'free' : 'costs money',
    ...(service.partner ? ['paid partner'] : []),
    ...(service.status === 'coming' ? ['coming'] : []),
    ...(connected === true ? ['connected'] : []),
  ];
}

// The list in plain words. `command` is how to run this tool, and `connected`
// says for a service id whether its key is there.
export function formatServices(steps, services, { connected = () => undefined, command = 'explainroo' } = {}) {
  return steps.map((step) => {
    const lines = [`${step.name}: ${step.what}`];
    for (const service of services.filter((s) => s.step === step.id)) {
      lines.push(`  ${service.name} (${serviceLabels(service, connected(service.id)).join(', ')})`);
      lines.push(`    ${service.about}`);
      lines.push(`    Cost: ${service.cost}`);
      lines.push(`    Data: ${service.data_leaves}`);
      lines.push(needsKey(service) && connected(service.id) !== true ? `    Set up: ${command} connect ${service.id}` : `    Use: ${service.setup.use}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

const announced = new Set();

// A connector's address, which the environment can replace for tests and for
// self-hosted gateways. This reads process.env and never a .env file, so a
// stranger's project can't send a user's key somewhere else.
export function serviceUrl({ id, name, baseUrl }) {
  const variable = `EXPLAINROO_${id.toUpperCase().replace(/-/g, '_')}_URL`;
  const override = process.env[variable];
  if (!override) return baseUrl;
  let url;
  try {
    url = new URL(override);
  } catch {
    throw new ProjectError(`${variable} must be an address like https://example.com`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new ProjectError(`${variable} must be an address like https://example.com`);
  if (!announced.has(variable)) {
    announced.add(variable);
    process.stderr.write(`${variable} is set, so ${name} requests go to ${url.origin}${url.pathname.replace(/\/+$/, '')} instead of ${baseUrl}.\n`);
  }
  return override.replace(/\/+$/, '');
}
