// Turns each scene's narration into a WAV file plus word timings.
// Results are cached per scene in build/voice/<scene>.json and only
// regenerated when the words, markers, voice, speed or pacing change.
// Paid voices also save each response in the project record, see paid-speech.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { speechChunks, resolveMarks, normWord } from './script.js';
import { alignWords, readAlike } from './align.js';
import { loadTTS, transcribeWords, TTS_MODEL, TTS_SAMPLE_RATE, ttsDtype, asrModel } from './models.js';
import { phonemize, generateSpeech } from './phonemes.js';
import { writeWav, readWav, resample, trimSilence } from './wav.js';
import { openSpeech, speechConnector, speechKey } from './paid-speech.js';
import { recordingFiles, decodeRecording, saveRecording, recordingCuts } from './recordings.js';

const PIPELINE = 7;

export function sceneHash(scene, chunks, config, recording = null) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      PIPELINE,
      TTS_MODEL,
      ASR_MODEL: asrModel(config.language),
      dtype: ttsDtype(),
      voice: config.voice,
      speed: config.speed * config.pace,
      chunks: recording ? scene.spoken : chunks.map((c) => [c.gapBefore, c.text]),
      // Markers and the shown text of each word are saved with the timings,
      // so moving a [#marker] or changing {shown|spoken} makes the scene again.
      layout: (recording ? scene.units.filter((u) => u.type !== 'pause') : scene.units).map((u) => (u.type === 'mark' ? `#${u.name}` : u.type === 'word' ? u.display : '')).join('|'),
      // Added last and only for recordings, so Kokoro scenes keep their cache.
      ...(recording ? { recording } : {}),
      ...(config.language && config.language !== 'en' ? { language: config.language } : {}),
    }))
    .digest('hex')
    .slice(0, 16);
}

export function voicePaths(project, id) {
  return { wav: path.join(project.paths.voice, `${id}.wav`), json: path.join(project.paths.voice, `${id}.json`) };
}

export function readVoice(project, id) {
  const p = voicePaths(project, id);
  if (!fs.existsSync(p.json)) return null;
  try {
    return JSON.parse(fs.readFileSync(p.json, 'utf8'));
  } catch {
    return null;
  }
}

// The chunks of one scene with the project's gaps and pace.
export function sceneChunks(project, scene) {
  const { config } = project;
  return speechChunks(scene.units, { sentenceGap: config.sentenceGap, paragraphGap: config.paragraphGap, pace: config.pace, language: config.language });
}

// The paid requests of the current script, for telling open jobs from old ones.
export function currentSpeechKeys(project) {
  const paid = speechConnector(project.config);
  if (!paid) return new Set();
  return new Set(project.script.scenes.flatMap((scene) => sceneChunks(project, scene).map((chunk) => speechKey(paid, project.config, chunk.text))));
}

const SENTENCE_END = /[.!?…।。！？]["'’)\]」』）]*$/;

// A scene's JSON doesn't say which voice made it, and its hash does. The hash
// also covers the words, markers and gaps of that time, and those are in the JSON.
// So this rebuilds them and asks whether today's voice settings give the saved hash.
function sameTake(chunks, cached, hash, config) {
  if (cached.hash === hash) return true;
  if (!Array.isArray(cached.words)) return false;
  const sentenceGap = config.sentenceGap / config.pace;
  const gaps = [sentenceGap, config.paragraphGap / config.pace, ...chunks.map((c) => c.gapBefore)];
  const old = cached.chunks.map((c, i) => {
    const measured = i ? c.start - cached.chunks[i - 1].end : null;
    return { text: c.text, start: c.start, gapBefore: i ? gaps.find((g) => Math.abs(g - measured) < 0.002) ?? round(measured) : chunks[0]?.gapBefore ?? 0 };
  });
  const paused = (i) => (i ? old[i].gapBefore !== sentenceGap || !SENTENCE_END.test(old[i - 1].text) : old[0].gapBefore > 0);
  // A marker's time is the start of the word after it, or the end of the last word.
  const marks = new Map();
  for (const [name, time] of Object.entries(cached.marks || {})) {
    const at = cached.words.findIndex((w) => w.start === time);
    const index = at === -1 ? cached.words.length : at;
    marks.set(index, [...(marks.get(index) || []), { type: 'mark', name }]);
  }
  // The JSON doesn't say on which side of a pause a marker stood, so both are tried.
  return ['after', 'before'].some((side) => {
    const units = [];
    let next = 0;
    for (let i = 0; i <= cached.words.length; i++) {
      const word = cached.words[i];
      const pause = [];
      if (word && next < old.length && word.start >= old[next].start) {
        if (paused(next)) pause.push({ type: 'pause' });
        next++;
      }
      const here = marks.get(i) || [];
      units.push(...(side === 'after' ? [...pause, ...here] : [...here, ...pause]));
      if (word) units.push({ type: 'word', display: word.text });
    }
    return sceneHash({ units }, old, config) === cached.hash;
  });
}

// A paid scene from before the record, or with its record removed: its WAV is
// cut into requests using the times in its JSON, so a later rebuild costs nothing.
function addFinishedScene(project, speech, scene, chunks, cached, hash, log) {
  const file = voicePaths(project, scene.id).wav;
  if (!Array.isArray(cached?.chunks) || !cached.chunks.length || !fs.existsSync(file)) return;
  const unknown = cached.chunks.filter((c) => !speech.knows(c.text));
  if (!unknown.length || !sameTake(chunks, cached, hash, project.config)) return;
  let samples, sampleRate;
  try {
    ({ samples, sampleRate } = readWav(file));
  } catch {
    return;
  }
  for (const c of unknown) speech.add(scene.id, c.text, samples.subarray(Math.round(c.start * sampleRate), Math.round(c.end * sampleRate)), sampleRate);
  log(`voice ${scene.id}: saved ${unknown.length} paid request${unknown.length === 1 ? '' : 's'} from the finished scene in history/voice/`);
}

// Returns { [sceneId]: voiceInfo } and generates whatever is missing or stale.
// `fresh` buys again only the paid requests that have no good answer. `transcribe`
// replaces Whisper in tests.
export async function synthesize(project, { force = false, fresh = false, log = () => {}, notice = log, only = null, transcribe = transcribeWords } = {}) {
  fs.mkdirSync(project.paths.voice, { recursive: true });
  const { config } = project;
  const provider = config.voice.provider || 'kokoro';
  const paid = speechConnector(config);
  const speech = paid ? openSpeech(project, paid, { force, fresh, log, notice }) : null;
  const recordings = provider === 'recording' ? recordingFiles(project) : null;
  const result = {};
  const todo = [];
  for (const scene of project.script.scenes) {
    const chunks = sceneChunks(project, scene);
    const recording = recordings?.files[scene.id];
    const hash = sceneHash(scene, chunks, config, recording ? {
      content: recording.hash,
      scenes: recordings.folder ? null : project.script.scenes.map((s) => s.spoken),
    } : null);
    const cached = readVoice(project, scene.id);
    const hasAudio = !chunks.length || fs.existsSync(voicePaths(project, scene.id).wav);
    if (speech && chunks.length) addFinishedScene(project, speech, scene, chunks, cached, hash, log);
    if (!force && cached && cached.hash === hash && hasAudio && !speech?.needsNew(chunks)) {
      result[scene.id] = cached;
    } else if (only && !only.includes(scene.id) && cached) {
      result[scene.id] = cached;
    } else {
      todo.push({ scene, chunks, hash });
    }
  }
  if (!todo.length) return result;
  speech?.check(todo);

  const needsSpeech = todo.some((t) => t.chunks.length);
  const tts = needsSpeech && provider === 'kokoro' ? await loadTTS({ log }) : null;
  const wanted = config.speed * config.pace;
  let take = null;
  let cuts = [];
  let heardTake = null;
  if (needsSpeech && recordings && !recordings.folder) {
    log('transcribing the recording and finding scene boundaries');
    take = await decodeRecording(Object.values(recordings.files)[0].file, project.paths.build, wanted);
    heardTake = await transcribe(resample(take.samples, take.sampleRate, 16000), { log, language: config.language });
    cuts = recordingCuts(project.script.scenes, heardTake.words, take.samples.length / take.sampleRate, config.language);
  }
  for (const { scene, chunks, hash } of todo) {
    const t0 = Date.now();
    const info = recordings && chunks.length
      ? await recordingScene(project, scene, hash, recordings.files[scene.id], take, cuts.find((c) => c.scene.id === scene.id), heardTake, log, transcribe)
      : await synthesizeScene(project, scene, chunks, hash, tts, speech, log, transcribe);
    result[scene.id] = info;
    if (chunks.length) {
      const warn = info.matchRate < 0.85 ? (recordings
        ? `, recording does not match script.md here (${Math.round(info.matchRate * 100)}% of words confirmed). Make script.md say what was actually said.`
        : `, check pronunciation (${Math.round(info.matchRate * 100)}% of words confirmed)`) : '';
      log(`voice ${scene.id}: ${info.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s${warn}`);
    }
  }
  return result;
}

async function synthesizeScene(project, scene, chunks, hash, tts, speech, log, transcribe) {
  const { config } = project;
  const files = voicePaths(project, scene.id);
  if (!chunks.length) {
    const info = { hash, id: scene.id, duration: 0, words: [], marks: resolveMarks(scene.units, []), chunks: [], transcript: '', matchRate: 1, unmatched: [] };
    if (fs.existsSync(files.wav)) fs.rmSync(files.wav);
    fs.writeFileSync(files.json, JSON.stringify(info, null, 2));
    return info;
  }
  const sr = TTS_SAMPLE_RATE;
  const pieces = [];
  let cursor = 0;
  const chunkInfo = [];
  const wordTimes = [];
  const transcripts = [];
  const unmatched = [];
  let matchedTokens = 0;
  let totalTokens = 0;

  const phonemes = !speech && config.language !== 'en'
    ? await phonemize(chunks.map(c => c.text), config.language) : null;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const gap = ci === 0 ? 0 : chunk.gapBefore;
    if (gap > 0) {
      pieces.push(new Float32Array(Math.round(gap * sr)));
      cursor += Math.round(gap * sr);
    }
    const audio = speech
      ? await speech.get(scene.id, chunks, ci)
      : await generateSpeech(tts, chunk.text, { language: config.language, voice: config.voice, speed: config.speed * config.pace, phonemes: phonemes?.[ci] });
    const samples = trimSilence(audio.audio, audio.sampling_rate || sr);
    const start = cursor / sr;
    const dur = samples.length / sr;
    pieces.push(samples);
    cursor += samples.length;

    const heard = await transcribe(resample(samples, sr, 16000), { log, language: config.language });
    transcripts.push(heard.text);
    const alike = await readAlike(chunk.words, heard.words, config.language);
    const aligned = alignWords(alike.words, alike.heard, dur, config.language);
    chunk.words.forEach((w, k) => {
      const a = aligned.words[k];
      wordTimes[w.unitIndex] = { start: start + a.start, end: start + a.end, matched: a.matched };
      if (!a.matched) unmatched.push(w.display);
    });
    const tokens = chunk.words.reduce((n, w) => n + (['ja', 'zh'].includes(config.language) ? Array.from(normWord(w.spoken).normalize('NFC')).length : w.spoken.split(/\s+/).length), 0);
    totalTokens += tokens;
    matchedTokens += aligned.matchRate * tokens;
    chunkInfo.push({ start, end: start + dur, text: chunk.text });
  }

  const total = new Float32Array(cursor);
  let off = 0;
  for (const p of pieces) {
    total.set(p, off);
    off += p.length;
  }
  writeWav(files.wav, total, sr);

  const words = [];
  scene.units.forEach((u, i) => {
    if (u.type !== 'word' || !wordTimes[i]) return;
    words.push({ text: u.display, spoken: u.spoken, start: round(wordTimes[i].start), end: round(wordTimes[i].end), matched: wordTimes[i].matched });
  });
  const info = {
    hash,
    id: scene.id,
    duration: round(cursor / sr),
    words,
    marks: Object.fromEntries(Object.entries(resolveMarks(scene.units, wordTimes)).map(([k, v]) => [k, round(v)])),
    chunks: chunkInfo.map((c) => ({ ...c, start: round(c.start), end: round(c.end) })),
    transcript: transcripts.join(' '),
    matchRate: totalTokens ? Math.round((matchedTokens / totalTokens) * 1000) / 1000 : 1,
    unmatched,
  };
  fs.writeFileSync(files.json, JSON.stringify(info, null, 2));
  return info;
}

async function recordingScene(project, scene, hash, source, take, cut, heardTake, log, transcribe) {
  const { config } = project;
  const audio = take || await decodeRecording(source.file, project.paths.build, project.config.speed * project.config.pace);
  const sr = audio.sampleRate;
  let from = cut ? Math.floor(cut.start * sr) : 0;
  let to = cut ? Math.ceil(cut.end * sr) : audio.samples.length;
  let samples = audio.samples.subarray(from, to);
  if (cut) {
    // Whisper can include the silence between scenes in a word's timestamp.
    const trimmed = trimSilence(samples, sr, { keep: 0.15 });
    if (trimmed.length) {
      from += (trimmed.byteOffset - samples.byteOffset) / 4;
      samples = trimmed;
      to = from + samples.length;
    }
  }
  const duration = samples.length / sr;
  const local = (w) => {
    const start = Math.max(0, Math.min(duration, w.start - from / sr));
    return { ...w, start, end: Math.min(duration, Math.max(start + 0.05, w.end - from / sr)) };
  };
  const heard = heardTake ? {
    words: heardTake.words.filter((w) => w.start >= cut.start && w.start < cut.end).map(local),
  } : await transcribe(resample(samples, sr, 16000), { log, language: config.language });
  const units = scene.units.filter((u) => u.type === 'word');
  const alike = await readAlike(units, heard.words, config.language);
  const aligned = alignWords(alike.words, alike.heard, duration, config.language);
  const times = cut ? cut.words.map(local) : aligned.words;
  const wordTimes = [];
  let wi = 0;
  scene.units.forEach((u, i) => { if (u.type === 'word') wordTimes[i] = times[wi++]; });
  const files = voicePaths(project, scene.id);
  await saveRecording(files.wav, samples, sr);
  const info = {
    hash, id: scene.id, duration: round(duration),
    words: units.map((u, i) => ({ text: u.display, spoken: u.spoken, start: round(times[i].start), end: round(times[i].end), matched: aligned.words[i].matched })),
    marks: Object.fromEntries(Object.entries(resolveMarks(scene.units, wordTimes)).map(([k, v]) => [k, round(v)])),
    chunks: [{ start: 0, end: round(duration), text: scene.spoken }],
    transcript: heard.words.map((w) => w.text).join(' '),
    matchRate: round(aligned.matchRate), unmatched: units.filter((u, i) => !aligned.words[i].matched).map((u) => u.display),
  };
  fs.writeFileSync(files.json, JSON.stringify(info, null, 2));
  return info;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

export function voiceSamples(project, id) {
  const p = voicePaths(project, id).wav;
  return fs.existsSync(p) ? readWav(p) : null;
}
