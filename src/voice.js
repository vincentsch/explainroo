// Turns each scene's narration into a WAV file plus word timings.
// Results are cached per scene in build/voice/<scene>.json and only
// regenerated when the words, markers, voice, speed or pacing change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { speechChunks, resolveMarks } from './script.js';
import { alignWords } from './align.js';
import { loadTTS, transcribeWords, TTS_MODEL, ASR_MODEL, TTS_SAMPLE_RATE, ttsDtype } from './models.js';
import { writeWav, readWav, resample, trimSilence } from './wav.js';
import { elevenSpeech } from './elevenlabs.js';
import { recordingFiles, decodeRecording, saveRecording, recordingCuts } from './recordings.js';

const PIPELINE = 7;

export function sceneHash(scene, chunks, config, recording = null) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      PIPELINE,
      TTS_MODEL,
      ASR_MODEL,
      dtype: ttsDtype(),
      voice: config.voice,
      speed: config.speed * config.pace,
      chunks: recording ? scene.spoken : chunks.map((c) => [c.gapBefore, c.text]),
      // Markers and the shown text of each word are saved with the timings,
      // so moving a [#marker] or changing {shown|spoken} makes the scene again.
      layout: (recording ? scene.units.filter((u) => u.type !== 'pause') : scene.units).map((u) => (u.type === 'mark' ? `#${u.name}` : u.type === 'word' ? u.display : '')).join('|'),
      // Added last and only for recordings, so Kokoro scenes keep their cache.
      ...(recording ? { recording } : {}),
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

// Returns { [sceneId]: voiceInfo } and generates whatever is missing or stale.
export async function synthesize(project, { force = false, log = () => {}, only = null } = {}) {
  fs.mkdirSync(project.paths.voice, { recursive: true });
  const { config } = project;
  const provider = config.voice.provider || 'kokoro';
  const recordings = provider === 'recording' ? recordingFiles(project) : null;
  const result = {};
  const todo = [];
  for (const scene of project.script.scenes) {
    const chunks = speechChunks(scene.units, { sentenceGap: config.sentenceGap, paragraphGap: config.paragraphGap, pace: config.pace });
    const recording = recordings?.files[scene.id];
    const hash = sceneHash(scene, chunks, config, recording ? {
      content: recording.hash,
      scenes: recordings.folder ? null : project.script.scenes.map((s) => s.spoken),
    } : null);
    const cached = readVoice(project, scene.id);
    const hasAudio = !chunks.length || fs.existsSync(voicePaths(project, scene.id).wav);
    if (!force && cached && cached.hash === hash && hasAudio) {
      result[scene.id] = cached;
    } else if (only && !only.includes(scene.id) && cached) {
      result[scene.id] = cached;
    } else {
      todo.push({ scene, chunks, hash });
    }
  }
  if (!todo.length) return result;

  const needsSpeech = todo.some((t) => t.chunks.length);
  const tts = needsSpeech && provider === 'kokoro' ? await loadTTS({ log }) : null;
  const wanted = config.speed * config.pace;
  let take = null;
  let cuts = [];
  let heardTake = null;
  if (needsSpeech && recordings && !recordings.folder) {
    log('transcribing the recording and finding scene boundaries');
    take = await decodeRecording(Object.values(recordings.files)[0].file, project.paths.build, wanted);
    heardTake = await transcribeWords(resample(take.samples, take.sampleRate, 16000), { log });
    cuts = recordingCuts(project.script.scenes, heardTake.words, take.samples.length / take.sampleRate);
  }
  for (const { scene, chunks, hash } of todo) {
    const t0 = Date.now();
    const info = recordings && chunks.length
      ? await recordingScene(project, scene, hash, recordings.files[scene.id], take, cuts.find((c) => c.scene.id === scene.id), heardTake, log)
      : await synthesizeScene(project, scene, chunks, hash, tts, log);
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

async function synthesizeScene(project, scene, chunks, hash, tts, log) {
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

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const gap = ci === 0 ? 0 : chunk.gapBefore;
    if (gap > 0) {
      pieces.push(new Float32Array(Math.round(gap * sr)));
      cursor += Math.round(gap * sr);
    }
    const audio = config.voice.provider === 'elevenlabs'
      ? await elevenSpeech(project, scene.id, chunk.text, { previous: chunks[ci - 1]?.text, next: chunks[ci + 1]?.text })
      : await tts.generate(chunk.text, { voice: config.voice, speed: config.speed * config.pace });
    const samples = trimSilence(audio.audio, audio.sampling_rate || sr);
    const start = cursor / sr;
    const dur = samples.length / sr;
    pieces.push(samples);
    cursor += samples.length;

    const heard = await transcribeWords(resample(samples, sr, 16000), { log });
    transcripts.push(heard.text);
    const aligned = alignWords(chunk.words, heard.words, dur);
    chunk.words.forEach((w, k) => {
      const a = aligned.words[k];
      wordTimes[w.unitIndex] = { start: start + a.start, end: start + a.end, matched: a.matched };
      if (!a.matched) unmatched.push(w.display);
    });
    const tokens = chunk.words.reduce((n, w) => n + w.spoken.split(/\s+/).length, 0);
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

async function recordingScene(project, scene, hash, source, take, cut, heardTake, log) {
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
  } : await transcribeWords(resample(samples, sr, 16000), { log });
  const units = scene.units.filter((u) => u.type === 'word');
  const aligned = alignWords(units, heard.words, duration);
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
