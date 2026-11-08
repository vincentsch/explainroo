// The price of a clip, against a small saved copy of OpenRouter's public list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkClipRequest, clipOptions, clipPrice, clipRate, KNOWN_OPTIONS } from '../src/clip-price.js';
import { CLIP_MODELS } from '../src/ai-clips.js';
import { clipOptionsText } from '../src/services.js';
import { ProjectError } from '../src/errors.js';

const list = JSON.parse(fs.readFileSync(new URL('./fixtures/openrouter-video-models.json', import.meta.url), 'utf8')).data;
const model = (id) => list.find((m) => m.id === id);
const silent = { seconds: 6, audio: false, resolution: '720p' };
const price = (id, request = {}) => clipPrice(model(id), { ...silent, ...request });
const made = (skus, more = {}) => ({ id: 'example/model', supported_durations: [2, 6, 20], supported_resolutions: ['720p', '1080p'], supported_aspect_ratios: ['16:9'], generate_audio: true, pricing_skus: skus, ...more });

test('the order matters: six seconds on Kling with audio is $1.008, and without audio $0.672', () => {
  const withAudio = price('kwaivgi/kling-v3.0-pro', { audio: true });
  assert.equal(withAudio.usd, 1.008);
  assert.equal(withAudio.rate_name, 'duration_seconds_with_audio');
  const without = price('kwaivgi/kling-v3.0-pro');
  assert.equal(without.usd, 0.672);
  assert.equal(without.rate_name, 'text_to_video_duration_seconds_720p');
  // A cap of 0.80 refuses the first and allows the second.
  assert.ok(withAudio.usd > 0.8);
  assert.ok(without.usd <= 0.8);
});

test('the default model: six silent seconds at 720p come to about 18 cents', () => {
  const cheap = price('google/veo-3.1-lite');
  assert.equal(cheap.usd, 0.18);
  assert.equal(cheap.usd_per_second, 0.03);
  assert.equal(cheap.rate_name, 'duration_seconds_without_audio_720p');
  assert.equal(price('google/veo-3.1-lite', { audio: true }).usd, 0.3);
  // No exact size at 1080p, so the name with no size applies.
  assert.equal(price('google/veo-3.1-lite', { resolution: '1080p' }).usd, 0.3);
  assert.equal(price('google/veo-3.1-lite', { audio: true, resolution: '1080p' }).usd, 0.48);
  assert.equal(price('google/veo-3.1').usd, 1.2);
  assert.equal(price('google/veo-3.1', { audio: true, resolution: '4K' }).usd, 3.6);
});

test('names in cents are read as cents, and a size in capitals still matches', () => {
  assert.equal(price('x-ai/grok-imagine-video').usd, 0.42);
  assert.equal(price('runway/gen-4.5').usd, 0.72);
  assert.equal(price('black-forest-labs/flux-3-video').usd, 1.02);
  assert.equal(price('black-forest-labs/flux-3-video', { resolution: '4K' }).usd, 2.46);
  assert.equal(price('black-forest-labs/flux-3-video', { resolution: '2K' }).usd, 1.68);
});

test('only text-to-video rates count', () => {
  // Image, reference, long and input rates are all listed here, and none of them may be used.
  assert.equal(price('heygen/heygen-video-1', { resolution: '1080p' }).rate_name, 'duration_seconds_1080p');
  assert.equal(price('heygen/heygen-video-1', { resolution: '480p' }).usd, 0.12);
  assert.equal(price('alibaba/wan-2.6').rate_name, 'text_to_video_duration_seconds_720p');
  assert.equal(price('alibaba/wan-2.6').usd, 0.48);
  assert.equal(clipRate({ image_to_video_duration_seconds_720p: '0.1', reference_duration_seconds_720p: '0.1', long_duration_seconds_720p: '0.1', cents_per_image_input: '1', cents_per_second_video_continuation_720p: '5', duration_seconds_with_video_input: '0.1' }, { audio: false, resolution: '720p' }), null);
});

test('names that can\'t be priced by the second count as no price', () => {
  assert.equal(price('bytedance/seedance-2.0-mini'), null);
  assert.equal(price('black-forest-labs/flux-video-upscale'), null);
  assert.equal(clipPrice(made({ cents_per_frame_output: '1' }), silent), null);
  assert.equal(clipPrice(made({ duration_seconds: 'free' }), silent), null);
  assert.equal(clipPrice(made({ duration_seconds: '0' }), silent), null);
  assert.equal(clipPrice(made({}), silent), null);
  assert.equal(clipPrice(made(null), silent), null);
});

test('a request with audio never uses a silent rate', () => {
  // A plain name is fine only when no name mentions audio at all.
  assert.equal(clipPrice(made({ duration_seconds: '0.1' }), { ...silent, audio: true }).usd, 0.6);
  assert.equal(clipPrice(made({ duration_seconds: '0.1', duration_seconds_without_audio: '0.05' }), { ...silent, audio: true }), null);
  assert.equal(clipPrice(made({ duration_seconds_720p: '0.1', image_to_video_duration_seconds_with_audio_720p: '0.2' }), { ...silent, audio: true }), null);
  assert.equal(clipPrice(made({ duration_seconds_without_audio_720p: '0.05', duration_seconds_with_audio: '0.2' }), { ...silent, audio: true }).usd, 1.2);
});

test('a silent request prefers a silent rate, then a plain name, and falls back to an audio rate', () => {
  assert.equal(clipPrice(made({ duration_seconds_with_audio: '0.3', duration_seconds: '0.2', duration_seconds_without_audio: '0.1' }), silent).rate_name, 'duration_seconds_without_audio');
  assert.equal(clipPrice(made({ duration_seconds_with_audio: '0.3', duration_seconds: '0.2' }), silent).rate_name, 'duration_seconds');
  assert.equal(clipPrice(made({ duration_seconds_with_audio: '0.3' }), silent).rate_name, 'duration_seconds_with_audio');
});

test('a later filter never undoes an earlier one', () => {
  // The silent rate is only for another size. Going back to the audio rate would undo the sound filter.
  assert.equal(clipPrice(made({ duration_seconds_without_audio_4k: '0.4', duration_seconds_with_audio: '0.2' }), silent), null);
  // An exact size wins over no size, and another size never applies.
  assert.equal(clipPrice(made({ duration_seconds: '0.2', duration_seconds_720p: '0.1' }), silent).usd, 0.6);
  assert.equal(clipPrice(made({ duration_seconds: '0.2', duration_seconds_1080p: '0.1' }), silent).usd, 1.2);
  assert.equal(clipPrice(made({ duration_seconds_1080p: '0.1' }), silent), null);
});

test('when two names are left, the higher one sets the price', () => {
  assert.equal(clipPrice(made({ duration_seconds_720p: '0.1', cents_per_second_output_720p: '20' }), silent).usd, 1.2);
  assert.equal(clipPrice(made({ text_to_video_duration_seconds_720p: '0.3', duration_seconds_720p: '0.1' }), silent).usd, 1.8);
});

test('the minimum charge applies when it is larger', () => {
  const skus = { cents_per_second_output: '5', minimum_cents_per_generation: '50' };
  const short = clipPrice(made(skus), { ...silent, seconds: 2 });
  assert.equal(short.usd, 0.5);
  assert.equal(short.minimum_usd, 0.5);
  assert.equal(clipPrice(made(skus), { ...silent, seconds: 20 }).usd, 1);
  assert.equal(clipPrice(made({ minimum_cents_per_generation: '50' }), silent), null);
});

test('when the sound can\'t be turned off, a silent request counts as audio if the model has an audio rate', () => {
  const skus = { duration_seconds: '0.1', duration_seconds_with_audio: '0.2' };
  for (const generate_audio of [null, false, undefined]) {
    const counted = clipPrice(made(skus, { generate_audio }), silent);
    assert.equal(counted.usd, 1.2);
    assert.equal(counted.billed_audio, true);
  }
  const canTurnOff = clipPrice(made(skus), silent);
  assert.equal(canTurnOff.usd, 0.6);
  assert.equal(canTurnOff.billed_audio, false);
  // No audio rate, so the plain rate is all there is.
  const grok = price('x-ai/grok-imagine-video');
  assert.equal(grok.billed_audio, false);
  assert.equal(grok.usd, 0.42);
});

test('a model that lists no sizes uses a name with no size', () => {
  assert.equal(clipPrice(made({ duration_seconds: '0.1', duration_seconds_720p: '0.5' }, { supported_resolutions: null }), silent).usd, 0.6);
});

test('the settings are checked against the model\'s own list, and the error says what is allowed', () => {
  const request = { seconds: 6, aspect: '16:9', resolution: '720p', audio: false };
  const fails = (id, change, pattern) => assert.throws(() => checkClipRequest(model(id), { ...request, ...change }), (e) => e instanceof ProjectError && pattern.test(e.message) && /Nothing was spent/.test(e.message));
  assert.doesNotThrow(() => checkClipRequest(model('google/veo-3.1-lite'), request));
  fails('google/veo-3.1-lite', { seconds: 5 }, /google\/veo-3\.1-lite takes 4, 6 or 8 seconds, not 5/);
  fails('google/veo-3.1-lite', { aspect: '1:1' }, /takes --aspect 16:9 or 9:16, not 1:1/);
  fails('google/veo-3.1-lite', { resolution: '4K' }, /takes --resolution 720p or 1080p, not 4K/);
  fails('runway/aleph-2', {}, /lists no lengths, so it is not a text-to-video model/);
  fails('runway/gen-4.5', { audio: true }, /makes no sound, so --audio can't be used/);
  assert.doesNotThrow(() => checkClipRequest(model('x-ai/grok-imagine-video'), { ...request, audio: true }));
});

// The lengths, aspects and resolutions come from the model's entry. The table fills
// only what a default model's entry leaves out, so an agent never has to try lengths.
test('what a model takes comes from the list, and for a default model from the table when the list leaves it out', () => {
  assert.deepEqual(clipOptions(model('google/veo-3.1-lite')), { seconds: [4, 6, 8], aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p'], from: 'openrouter' });
  assert.deepEqual(clipOptions(model('kwaivgi/kling-v3.0-pro')).seconds, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(clipOptionsText(clipOptions(model('google/veo-3.1'))), '4, 6 or 8 seconds, 16:9 or 9:16, at 720p, 1080p or 4K');
  // A default model whose entry lost its lengths still has them, and the check still works.
  const bare = { ...model('google/veo-3.1-lite'), supported_durations: null, supported_aspect_ratios: [] };
  assert.deepEqual(clipOptions(bare), { seconds: [4, 6, 8], aspects: ['16:9', '9:16'], resolutions: ['720p', '1080p'], from: 'table' });
  assert.throws(() => checkClipRequest(bare, { seconds: 5, aspect: '16:9', resolution: '720p', audio: false }), /google\/veo-3\.1-lite takes 4, 6 or 8 seconds, not 5\. Nothing was spent\./);
  assert.deepEqual(clipOptions({ id: 'google/veo-3.1' }), { ...KNOWN_OPTIONS['google/veo-3.1'], from: 'table' });
  // Any other model without lengths can't be priced, as before.
  assert.deepEqual(clipOptions(model('runway/aleph-2')), { seconds: null, aspects: ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'], resolutions: null, from: 'openrouter' });
  assert.equal(clipOptionsText(clipOptions(model('runway/aleph-2'))), '16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16 or 21:9');
});

// The table says what OpenRouter listed for the default models, read on 2026-11-08.
test('the table of the default models matches what OpenRouter listed for them', () => {
  const read = JSON.parse(fs.readFileSync(new URL('./fixtures/openrouter-default-video-models.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(KNOWN_OPTIONS).toSorted(), Object.values(CLIP_MODELS).toSorted());
  for (const entry of read.data) {
    const { from, ...listed } = clipOptions(entry);
    assert.equal(from, 'openrouter');
    assert.deepEqual(listed, KNOWN_OPTIONS[entry.id], entry.id);
  }
});
