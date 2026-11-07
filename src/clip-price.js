// What a clip costs, worked out from OpenRouter's public list of video models.
// Each name in pricing_skus says what a rate is for. The list states no currency,
// and the values under duration_seconds names fit dollars per second. A name this
// file doesn't know counts as no price, and without a price nothing gets bought.
import { ProjectError } from './errors.js';
import { oneOf } from './services.js';

// Rates for another way of making a clip, or for what goes in. Only text-to-video counts.
const OTHER_MODE = /^(image_to_video_|reference_|long_)|image_input|video_continuation|with_video_input/;

// Dollars per second for one unit of the rate, or null if it can't be priced by the
// second, such as video_tokens or cents_per_megapixel_second.
function perSecond(name) {
  const plain = name.replace(/^text_to_video_/, '');
  if (plain.startsWith('duration_seconds')) return 1;
  if (plain.startsWith('cents_per_video_output_second') || plain.startsWith('cents_per_second_output')) return 0.01;
  return null;
}

function secondRates(skus) {
  return Object.entries(skus).flatMap(([name, value]) => {
    const unit = OTHER_MODE.test(name) ? null : perSecond(name);
    const rate = Number(value);
    if (!unit || !(rate > 0)) return [];
    const sound = /_without_audio(_|$)/.test(name) ? 'without' : /_with_audio(_|$)/.test(name) ? 'with' : 'plain';
    return [{ name, usd_per_second: Math.round(rate * unit * 1e7) / 1e7, sound, size: /_(\d+[pk])(_|$)/i.exec(name)?.[1].toLowerCase() ?? null }];
  });
}

// The rate for a request. Generation mode comes first, then sound, then size, and
// a later filter never undoes an earlier one. So an audio request never uses a
// silent rate, however well its size fits. A silent request may fall back to an
// audio rate, which can only overstate the price.
export function clipRate(skus, { audio, resolution }) {
  const rates = secondRates(skus ?? {});
  const sounds = (sound) => rates.filter((r) => r.sound === sound);
  const mentionsAudio = Object.keys(skus ?? {}).some((name) => name.includes('audio'));
  const left = audio
    ? (mentionsAudio ? sounds('with') : sounds('plain'))
    : ([sounds('without'), sounds('plain'), sounds('with')].find((list) => list.length) ?? []);
  const wanted = resolution?.toLowerCase();
  const exact = left.filter((r) => r.size === wanted);
  const fits = exact.length ? exact : left.filter((r) => r.size === null);
  // Two names can be left. The higher one can only overstate the price.
  return fits.reduce((high, r) => (!high || r.usd_per_second > high.usd_per_second ? r : high), null);
}

// True when the sound can't be turned off, so a silent request pays the audio rate.
function soundStaysOn(model) {
  return model.generate_audio !== true && secondRates(model.pricing_skus ?? {}).some((r) => r.sound === 'with');
}

// The estimated price of a request, or null when it can't be worked out.
export function clipPrice(model, { seconds, audio, resolution }) {
  const billedAudio = audio || soundStaysOn(model);
  const rate = clipRate(model.pricing_skus, { audio: billedAudio, resolution: model.supported_resolutions?.length ? resolution : null });
  if (!rate) return null;
  const minimum = Number(model.pricing_skus.minimum_cents_per_generation) / 100 || 0;
  const usd = Math.max(rate.usd_per_second * seconds, minimum);
  return { usd: Math.round(usd * 10000) / 10000, usd_per_second: rate.usd_per_second, rate_name: rate.name, minimum_usd: minimum || null, billed_audio: billedAudio };
}

// The settings are checked against the model's own list, before anything is spent.
export function checkClipRequest(model, { seconds, aspect, resolution, audio }) {
  const { id, supported_durations: durations, supported_aspect_ratios: aspects, supported_resolutions: sizes } = model;
  if (!durations?.length) throw new ProjectError(`${id} lists no lengths, so it is not a text-to-video model this command can price. Nothing was spent. Try another model with --model.`);
  if (!durations.includes(seconds)) throw new ProjectError(`${id} takes ${oneOf(durations.toSorted((a, b) => a - b).map(String))} seconds, not ${seconds}. Nothing was spent.`);
  if (aspects?.length && !aspects.includes(aspect)) throw new ProjectError(`${id} takes --aspect ${oneOf(aspects)}, not ${aspect}. Nothing was spent.`);
  if (sizes?.length && !sizes.includes(resolution)) throw new ProjectError(`${id} takes --resolution ${oneOf(sizes)}, not ${resolution}. Nothing was spent.`);
  if (audio && model.generate_audio === false) throw new ProjectError(`${id} makes no sound, so --audio can't be used with it. Nothing was spent.`);
}
