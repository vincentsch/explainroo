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

// The steps an entry serves. An entry that serves several steps on one key has a
// list, and its per_step object holds what differs per step.
export function serviceSteps(service) {
  return [service.step].flat();
}

// An entry as it reads under one of its steps: the cost, the data that leaves and
// the use of that step.
export function forStep(service, step) {
  const { per_step: perStep, ...entry } = service;
  if (!perStep) return entry;
  const { use, ...words } = perStep[step];
  return { ...entry, step, ...words, setup: { ...entry.setup, use } };
}

// The entries of one step, each with the words of that step.
export function stepServices(step, services = SERVICES) {
  return services.filter((s) => serviceSteps(s).includes(step)).map((s) => forStep(s, step));
}

// Dollars the way a price is read, like $0.18, $0.20 or $1.008.
export function usd(value) {
  return `$${value.toFixed(4).replace(/0{1,2}$/, '')}`;
}

// "a, b or c"
export function oneOf(words) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

export function allOf(words) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
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

// Why a step shows its range from this file instead of today's prices.
const RANGE_BECAUSE = {
  offline: "Offline mode is on (EXPLAINROO_OFFLINE=1), so here is the range instead of today's prices.",
  unreadable: "Today's prices could not be read, so here is the range.",
};

// The day a time falls on in this computer's time zone. The time in the JSON is
// in UTC, and its own date can be a day off from the user's.
export function localDay(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The time in this computer's time zone, with the zone, like "2026-11-08 00:30
// GMT+1". A time that can't be read stays as it was written.
export function localTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso ?? '?');
  const pad = (n) => String(n).padStart(2, '0');
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'local time';
  return `${localDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`;
}

// Today's prices of an entry under one step, when they were read, or else its range
// and why. A model the list has no price for gets the range too.
function priceLines(service, prices) {
  if (!service.price_range) return [];
  if (prices?.shown !== 'prices') return [`    Prices: ${prices?.because ? `${RANGE_BECAUSE[prices.because]} ` : ''}${service.price_range}`];
  const { resolution, audio } = prices.settings;
  const nameWidth = Math.max(...prices.models.map((m) => m.name.length));
  const idWidth = Math.max(...prices.models.map((m) => m.id.length));
  const lines = [`    Prices at ${resolution} ${audio ? 'with' : 'without'} sound, from ${service.name}'s list read on ${localDay(prices.read)}:`];
  for (const m of prices.models) lines.push(`      ${m.name.padEnd(nameWidth)}  ${m.id.padEnd(idWidth)}  ${m.usd_per_second === null ? 'no price in that list' : `${usd(m.usd_per_second)} a second`}`);
  if (prices.models.some((m) => m.usd_per_second === null)) lines.push(`    A model with no price in that list has the range. ${service.price_range}`);
  return lines;
}

// The list in plain words. `command` is how to run this tool, `connected` says for
// a service id whether its key is there, and `prices` gives what an entry's prices
// are today under the step it is listed under.
export function formatServices(steps, services, { connected = () => undefined, command = 'explainroo', prices = () => undefined } = {}) {
  return steps.map((step) => {
    const lines = [`${step.name}: ${step.what}`];
    for (const service of stepServices(step.id, services)) {
      lines.push(`  ${service.name} (${serviceLabels(service, connected(service.id)).join(', ')})`);
      lines.push(`    ${service.about}`);
      lines.push(`    Cost: ${service.cost}`);
      lines.push(...priceLines(service, prices(service)));
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
  // A password in the address would show in messages and in the record.
  if (url.username || url.password) throw new ProjectError(`${variable} must not hold a user name or password`);
  if (!announced.has(variable)) {
    announced.add(variable);
    process.stderr.write(`${variable} is set, so ${name} requests go to ${url.origin}${url.pathname.replace(/\/+$/, '')} instead of ${baseUrl}.\n`);
  }
  return override.replace(/\/+$/, '');
}
