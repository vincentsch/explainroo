// The download line of a model: one line, a total that never changes, and no
// warning about files that come without a size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASR_MODEL, DOWNLOAD_BYTES, MULTILINGUAL_ASR_MODEL, TTS_MODEL, downloadProgress, downloadSize, withoutSizeWarning } from '../src/models.js';

// A clock that moves a second with every reading, so that every update may show.
function clock() {
  let now = 0;
  return () => (now += 1000);
}

// A log that keeps its lines, with log.update on a terminal.
function logger(terminal) {
  const lines = [];
  const updates = [];
  const log = (m) => lines.push(m);
  if (terminal) log.update = (m) => updates.push(m);
  return { log, lines, updates };
}

// The events transformers.js sends for files of `sizes` bytes: initiate, download,
// progress for each chunk and done. A file without a Content-Length header reports
// `loaded` equal to a `total` that grows with every chunk.
function events(model, sizes, { sized = true, chunk = 4e6 } = {}) {
  const list = [];
  for (const [file, size] of Object.entries(sizes)) {
    list.push({ status: 'initiate', name: model, file }, { status: 'download', name: model, file });
    for (let loaded = Math.min(chunk, size); ; loaded = Math.min(size, loaded + chunk)) {
      list.push({ status: 'progress', name: model, file, loaded, total: sized ? size : loaded, progress: sized ? (loaded / size) * 100 : 100 });
      if (loaded === size) break;
    }
    list.push({ status: 'done', name: model, file });
  }
  return list;
}

const totals = (lines) => lines.map((l) => /: (\d+) \/ (\d+) MB$/.exec(l)).map((m) => [Number(m[1]), Number(m[2])]);

test('a model with sized files has one line whose total comes from the table and is never passed', () => {
  const sizes = { 'config.json': 2197, 'onnx/encoder_model_quantized.onnx': 23159173, 'onnx/decoder_model_merged_quantized.onnx': 53712196 };
  const { log, lines, updates } = logger(true);
  const progress = downloadProgress(ASR_MODEL, 'q8', log, { cached: () => false, now: clock() });
  for (const e of events(ASR_MODEL, sizes)) progress.callback(e);
  progress.finish(true);
  assert.ok(updates.length > 10);
  for (const [shown, total] of totals(updates)) {
    assert.equal(total, 80);
    assert.ok(shown <= total);
  }
  assert.ok(updates.every((u) => u.startsWith('downloading the speech check model: ')));
  // The last line says what came, which is less than the table's total when some small files were there.
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^downloaded the speech check model: 77 MB in \d+s$/);
});

test('files sent without a size count toward the same line, and its total stays the table total', () => {
  const sizes = { 'onnx/encoder_model_quantized.onnx': 92240498, 'onnx/decoder_model_merged_quantized.onnx': 156795750, 'tokenizer.json': 2480466 };
  const { log, lines, updates } = logger(true);
  const progress = downloadProgress(MULTILINGUAL_ASR_MODEL, 'q8', log, { cached: () => false, now: clock() });
  for (const e of events(MULTILINGUAL_ASR_MODEL, sizes, { sized: false })) progress.callback(e);
  progress.finish(true);
  const shown = totals(updates);
  assert.ok(shown.every(([, total]) => total === 252));
  assert.ok(shown.every(([amount]) => amount <= 252));
  // The amount only grows, file after file.
  assert.deepEqual(shown.map(([amount]) => amount), [...shown.map(([amount]) => amount)].sort((a, b) => a - b));
  assert.equal(shown.at(-1)[0], 252);
  assert.match(lines.at(-1), /^downloaded the language model: 252 MB in \d+s$/);
});

test('without a terminal a download prints one line when it starts and one when it is done', () => {
  const { log, lines } = logger(false);
  const progress = downloadProgress(TTS_MODEL, 'fp32', log, { cached: () => false, now: clock() });
  for (const e of events(TTS_MODEL, { 'config.json': 44, 'tokenizer.json': 3497, 'onnx/model.onnx': 325532232 })) progress.callback(e);
  progress.finish(true);
  assert.deepEqual(lines.map((l) => l.replace(/in \d+s$/, 'in Ns')), ['downloading the voice model, 326 MB', 'downloaded the voice model: 326 MB in Ns']);
});

test('files already in the cache print nothing, and a download that breaks off says how far it got', () => {
  const quiet = logger(false);
  const cached = downloadProgress(ASR_MODEL, 'q8', quiet.log, { cached: () => true, now: clock() });
  for (const e of events(ASR_MODEL, { 'onnx/encoder_model_quantized.onnx': 23159173 })) cached.callback(e);
  cached.finish(true);
  assert.deepEqual(quiet.lines, []);

  const broken = logger(true);
  const progress = downloadProgress(ASR_MODEL, 'q8', broken.log, { cached: () => false, now: clock() });
  for (const e of events(ASR_MODEL, { 'onnx/decoder_model_merged_quantized.onnx': 53712196 }).slice(0, 6)) progress.callback(e);
  progress.finish(false);
  assert.deepEqual(broken.lines, ['the download of the speech check model stopped after 16 MB']);
});

test('the table has each model at the dtype explainroo loads it with', () => {
  assert.deepEqual(Object.keys(DOWNLOAD_BYTES[TTS_MODEL]), ['fp32', 'fp16', 'q8', 'q4', 'q4f16']);
  assert.equal(downloadSize(TTS_MODEL), '326 MB');
  assert.equal(downloadSize(ASR_MODEL), '80 MB');
  assert.equal(downloadSize(MULTILINGUAL_ASR_MODEL), '252 MB');
});

test('the warning about a missing content-length is left out, and other warnings come through', () => {
  const seen = [];
  const warn = withoutSizeWarning((...args) => seen.push(args.join(' ')));
  warn('Unable to determine content-length from response headers. Will expand buffer when needed.');
  warn('Unable to add response to browser cache: QuotaExceededError.');
  warn('something else', 42);
  assert.deepEqual(seen, ['Unable to add response to browser cache: QuotaExceededError.', 'something else 42']);
});
