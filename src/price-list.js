// Today's clip prices for "explainroo services": the price per second of the
// default models, from OpenRouter's public list of video models, which "clip
// --dry-run" reads too. services runs often, so the answer is kept for a day in
// the cache folder. A dry run and a purchase never use the kept answer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CLIP_MODELS, DEFAULT_RESOLUTION } from './ai-clips.js';
import { clipOptions, clipPrice, KNOWN_OPTIONS } from './clip-price.js';
import { cacheRoot } from './models.js';
import openrouter from './connectors/openrouter.js';

export const KEEP_MS = 24 * 60 * 60 * 1000;
// A slow or broken list holds services up for this long at most.
const READ_TIMEOUT_MS = 4000;
const SETTINGS = { resolution: DEFAULT_RESOLUTION, audio: false };

// Where the answer from one address is kept. Each address has its own file, so
// prices from a test server never mix with the real ones.
export function keptPriceList(url) {
  const host = new URL(url).host.replace(/[^\w.-]+/g, '-');
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 12);
  return path.join(cacheRoot(), 'prices', `${host}-${hash}.json`);
}

function readKept(file, url) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return kept?.url === url && Array.isArray(kept.data) && Number.isFinite(Date.parse(kept.read)) ? kept : null;
  } catch {
    return null;
  }
}

// A cache folder that can't be written only means the next run reads the list again.
function keep(file, kept) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(kept));
    fs.renameSync(temp, file);
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

// The price per second of each default model in one answer of the list, worked
// out the way a dry run works out its price, and the lengths, aspects and
// resolutions it takes.
function pricesFrom(kept) {
  return {
    shown: 'prices',
    read: kept.read,
    url: kept.url,
    settings: SETTINGS,
    models: Object.entries(CLIP_MODELS).map(([name, id]) => {
      const model = kept.data.find((m) => m?.id === id);
      const price = model ? clipPrice(model, { seconds: 1, ...SETTINGS }) : null;
      return { name, id, usd_per_second: price?.usd_per_second ?? null, rate_name: price?.rate_name ?? null, takes: clipOptions(model ?? { id }) };
    }),
  };
}

// The range has no list behind it, so what each default model takes comes from
// explainroo's own table.
function range(because) {
  return { shown: 'range', because, models: Object.entries(CLIP_MODELS).map(([name, id]) => ({ name, id, takes: { ...KNOWN_OPTIONS[id], from: 'table' } })) };
}

// Offline mode shows the range at once. Otherwise an answer younger than a day is
// used without a request, and an older one is read again and kept. When the list
// can't be read, it is the range, so an answer older than a day never shows.
export async function clipPricesToday() {
  if (process.env.EXPLAINROO_OFFLINE === '1') return range('offline');
  try {
    const url = openrouter.videoModelsUrl();
    const file = keptPriceList(url);
    let kept = readKept(file, url);
    const age = kept ? Date.now() - Date.parse(kept.read) : Infinity;
    if (!(age >= 0 && age < KEEP_MS)) {
      // The list is public, so the request has no key and nothing about the user.
      const data = await openrouter.videoModels({ timeout: READ_TIMEOUT_MS });
      kept = { url, read: new Date().toISOString(), data };
      keep(file, kept);
    }
    return pricesFrom(kept);
  } catch {
    return range('unreadable');
  }
}

// True for the entry and step that these prices belong to.
export function showsClipPrices(service) {
  return service.id === openrouter.id && service.step === 'clips';
}
