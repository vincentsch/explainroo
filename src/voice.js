// Turns each scene's narration into a WAV file plus word timings.
// Results are cached per scene in build/voice/<scene>.json and only
// regenerated when the spoken words, the voice, speed or pacing change. When
// only markers moved, the narration stays and the cue times are worked out again.
// Paid voices also save each response in the project record, see paid-speech.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { speechChunks, resolveMarks, normWord, spokenWords } from './script.js';
import { alignSpeech, alignWords, bareWord, nearList } from './align.js';
import { loadTTS, transcribeWords, TTS_MODEL, TTS_SAMPLE_RATE, ttsDtype, asrModel } from './models.js';
import { phonemize, generateSpeech } from './phonemes.js';
import { writeWav, readWav, resample, trimSilence } from './wav.js';
import { openSpeech, speechConnector, speechKey } from './paid-speech.js';
import { recordingFiles, decodeRecording, saveRecording, recordingCuts } from './recordings.js';
import { scriptName } from './project.js';
import { estimateLength, estimateLine, roughTime } from './timeline.js';
import { estimatedChapterHints } from './chapters.js';

const PIPELINE = 7;
// The rules of the speech check that a scene was checked with. A scene checked
// with older rules is looked at again from its transcript once, without new
// speech, and the result is saved. 4 reads maths written with signs.
export const CHECK = 4;

// The key of the narration itself: the spoken words, the gaps between them and
// the voice settings. Markers and the shown text are not part of it.
export function speechHash(scene, chunks, config, recording = null) {
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
      words: scene.units.filter((u) => u.type === 'word').map((u) => u.spoken),
      ...(recording ? { recording } : {}),
      ...(config.language && config.language !== 'en' ? { language: config.language } : {}),
    }))
    .digest('hex')
    .slice(0, 16);
}

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
      // Markers and the shown text of each word are saved with the timings, so
      // moving a [#marker] or changing {shown|spoken} changes the hash. When only
      // markers moved, the narration is kept, see speechHash.
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

// How long the voice speaks in a scene: its spoken pieces added up, without the
// silences between them. A recorded scene is one piece.
export function narrationTime(info) {
  return round((info.chunks || []).reduce((sum, c) => sum + (c.end - c.start), 0));
}

// The words of a scene that only nearly matched, as [{ word, heard }]. A scene
// made before they were saved gets them by aligning its saved transcript again,
// so no voice is made again. Japanese and Chinese compare characters, which
// match exactly or not at all.
export function nearMatches(info, language) {
  if (Array.isArray(info.nearly)) return info.nearly;
  const again = realign(info, language);
  // Only words that the scene confirmed when it was made can have nearly matched.
  return again ? nearList(again.words, again.aligned.map((a, k) => (info.words[k].matched ? a : { ...a, nearly: false }))) : [];
}

// What was heard in place of each word of a scene that wasn't confirmed, as
// { [index of the word]: text }, from its saved transcript.
export function heardInstead(info, language) {
  const again = realign(info, language);
  return again ? Object.fromEntries(again.aligned.flatMap((a, k) => (a.heard && !info.words[k].matched ? [[k, a.heard]] : []))) : {};
}

// The part of a scene's transcript where the words at `indexes` should have
// been, with four whole words on each side and "…" where it is cut, like
// "…a harmless peace of the virus…". Places that overlap are quoted once, and
// several places are joined with "and". Null when the transcript can't say.
export function heardQuote(info, language, indexes, around = 4) {
  const again = realign(info, language);
  if (!again || !indexes.length) return null;
  const heard = info.transcript.split(/\s+/).filter(Boolean);
  // Each word's time in the realigned scene counts heard words, so it is a place in the transcript.
  const ranges = indexes.map((k) => {
    const from = Math.floor(again.aligned[k].start + 1e-6);
    const to = Math.max(from, Math.ceil(again.aligned[k].end - 1e-6));
    return [Math.max(0, from - around), Math.min(heard.length, to + around)];
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.map(([a, b]) => `"${a > 0 ? '…' : ''}${heard.slice(a, b).join(' ')}${b < heard.length ? '…' : ''}"`).join(' and ');
}

// A scene's words aligned again with its saved transcript. Its times count
// heard words, so they say where in the transcript a word is, and are never
// used as times.
function realign(info, language, accept = null) {
  if (['ja', 'zh'].includes(language) || !info.duration || !info.transcript || !Array.isArray(info.words)) return null;
  const words = info.words.map((w) => ({ spoken: w.spoken ?? w.text, display: w.text }));
  const heard = info.transcript.split(/\s+/).filter(Boolean).map((text, i) => ({ text, start: i, end: i + 1 }));
  return { words, heard, aligned: alignWords(words, heard, heard.length, language, { accept }).words };
}

// A scene from the cache, with its near matches, looked at again with today's
// speech check when it was made with older rules and has words it couldn't
// confirm. A word that the check confirms now counts as confirmed, with its old
// time. No speech is made, and reviewed() saves the result.
export async function reviewSpeech(info, language) {
  // Older rules may have found near matches that today's rules confirm fully.
  const base = { ...info, nearly: nearMatches(info.check === CHECK ? info : { ...info, nearly: undefined }, language) };
  if (info.check === CHECK || !Array.isArray(info.words) || info.words.every((w) => w.matched)) return base;
  const again = realign(info, language);
  if (!again) return base;
  const now = (await alignSpeech(again.words, again.heard, again.heard.length, language)).words;
  const newly = info.words.map((w, k) => !w.matched && now[k].matched);
  if (!newly.some(Boolean)) return base;
  const tokens = (w) => Math.max(1, spokenWords(w.spoken ?? w.text).length);
  const total = info.words.reduce((n, w) => n + tokens(w), 0);
  const gained = info.words.reduce((n, w, k) => n + (newly[k] ? tokens(w) : 0), 0);
  const unmatched = [...(info.unmatched ?? [])];
  info.words.forEach((w, k) => {
    const at = newly[k] ? unmatched.indexOf(w.text) : -1;
    if (at !== -1) unmatched.splice(at, 1);
  });
  return {
    ...base,
    words: info.words.map((w, k) => (newly[k] ? { ...w, matched: true } : w)),
    matchRate: Math.min(1, round((info.matchRate ?? 0) + gained / total)),
    unmatched,
    // In the order of the script, from the words confirmed then and now.
    nearly: nearList(again.words, now.map((a, k) => (info.words[k].matched || newly[k] ? a : { ...a, nearly: false }))),
  };
}

// A scene with the forms of "heard" in video.json: a word heard as one of its
// forms, in the saved transcript, counts as confirmed, and as no near match.
// Its time stays. Nothing is saved, so the scene follows video.json.
export function withHeard(info, language, accept) {
  if (!accept || !Object.keys(accept).length || !Array.isArray(info?.words)) return info;
  const again = realign(info, language, accept);
  if (!again) return info;
  const keys = new Set(Object.keys(accept).map(normWord));
  const own = (w) => keys.has(normWord(w.text)) || keys.has(normWord(w.spoken ?? w.text));
  const taken = info.words.map((w, k) => own(w) && again.aligned[k].matched && !again.aligned[k].nearly);
  if (!taken.some(Boolean)) return info;
  const newly = info.words.map((w, k) => taken[k] && !w.matched);
  const tokens = (w) => Math.max(1, spokenWords(w.spoken ?? w.text).length);
  const total = info.words.reduce((n, w) => n + tokens(w), 0);
  const gained = info.words.reduce((n, w, k) => n + (newly[k] ? tokens(w) : 0), 0);
  const unmatched = [...(info.unmatched ?? [])];
  info.words.forEach((w, k) => {
    const at = newly[k] ? unmatched.indexOf(w.text) : -1;
    if (at !== -1) unmatched.splice(at, 1);
  });
  const names = new Set(info.words.filter((w, k) => taken[k]).map((w) => w.text));
  return {
    ...info,
    words: info.words.map((w, k) => (newly[k] ? { ...w, matched: true } : w)),
    matchRate: Math.min(1, round((info.matchRate ?? 0) + gained / total)),
    unmatched,
    nearly: (info.nearly ?? []).filter((n) => !names.has(n.word)),
  };
}

// What each word was heard as when the check didn't confirm it, and each word
// with a {shown|spoken} override also when it only nearly matched:
// { [shown word]: heard }.
function wordsHeard(info, language) {
  if (!Array.isArray(info?.words)) return {};
  const instead = heardInstead(info, language);
  const near = new Map((info.nearly ?? []).map((n) => [n.word, n.heard]));
  const out = {};
  info.words.forEach((w, k) => {
    if (w.text in out) return;
    const override = w.spoken !== undefined && w.spoken !== w.text;
    const heard = w.matched ? (override ? near.get(w.text) : null) : instead[k];
    if (heard) out[w.text] = heard;
  });
  return out;
}

// Two heard spellings that are the same apart from case and punctuation.
export const sameHeard = (a, b) => a.split(/\s+/).map(normWord).join(' ') === b.split(/\s+/).map(normWord).join(' ');

// The words that the scene before and the scene made now both heard the same
// way, as [{ word, heard }]. That is likely how the word is said, so "heard"
// in video.json can accept it.
export function heardTwice(before, after, language) {
  const then = wordsHeard(before, language);
  const now = wordsHeard(after, language);
  return Object.entries(now).filter(([word, heard]) => then[word] && sameHeard(then[word], heard)).map(([word, heard]) => ({ word, heard }));
}

// The "heard" block for video.json that accepts these words as heard.
export function heardEntry(list) {
  const map = Object.fromEntries(list.map(({ word, heard }) => [bareWord(word), [heard]]));
  return `"heard": ${JSON.stringify(map).replace(/":/g, '": ').replace(/,"/g, ', "')}`;
}

// The line voice prints for words heard the same way twice in a row.
export function heardLine(list) {
  const names = list.map(({ word, heard }) => `"${bareWord(word)}" as "${heard}"`).join(', ');
  return `the speech check heard ${names} twice in a row. If that is how ${list.length > 1 ? 'they are' : 'it is'} said, add this to video.json, and the check accepts it: ${heardEntry(list)}`;
}

// A cached scene with today's speech check. A scene checked with older rules is
// saved with the result, so the next command takes it as it is. Its times stay.
async function reviewed(project, id, info) {
  const now = await reviewSpeech(info, project.config.language);
  if (info.check === CHECK || !Array.isArray(info.words)) return now;
  const saved = { ...now, check: CHECK };
  fs.writeFileSync(voicePaths(project, id).json, JSON.stringify(saved, null, 2));
  return saved;
}

// The scene with its markers put back where an older cache had them: each
// marker before the word that starts at its time, or after the last word. The
// cache doesn't say on which side of a pause a marker stood, so both are given.
function oldLayouts(scene, cached) {
  if (!Array.isArray(cached.words)) return [];
  const marks = new Map();
  for (const [name, time] of Object.entries(cached.marks || {})) {
    const at = cached.words.findIndex((w) => w.start === time);
    const index = at === -1 ? cached.words.length : at;
    marks.set(index, [...(marks.get(index) || []), { type: 'mark', name }]);
  }
  return ['after', 'before'].map((side) => {
    const units = [];
    let word = 0;
    let pauses = [];
    for (const u of scene.units) {
      if (u.type === 'mark') continue;
      if (u.type === 'pause') { pauses.push(u); continue; }
      const here = marks.get(word) || [];
      units.push(...(side === 'after' ? [...pauses, ...here] : [...here, ...pauses]), u);
      pauses = [];
      word++;
    }
    units.push(...(side === 'after' ? [...pauses, ...(marks.get(word) || [])] : [...(marks.get(word) || []), ...pauses]));
    return { ...scene, units };
  });
}

// Whether a file starts like a WAV file, so narration kept for new cues can be played.
function wavFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
    return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE';
  } catch {
    return false;
  }
}

// Whether a cached scene says the same words as `scene` with the same voice,
// and only its markers moved. A cache from before the narration key is matched
// by putting its markers back.
function onlyMarkersMoved(project, scene, chunks, config, recording, cached) {
  if (!wavFile(voicePaths(project, scene.id).wav)) return false;
  const shown = scene.units.filter((u) => u.type === 'word').map((u) => u.display);
  if (!Array.isArray(cached.words) || cached.words.length !== shown.length || cached.words.some((w, k) => w.text !== shown[k])) return false;
  if (cached.speech) return cached.speech === speechHash(scene, chunks, config, recording);
  return oldLayouts(scene, cached).some((old) => sceneHash(old, chunks, config, recording) === cached.hash);
}

// The cached narration of a scene with the cue times of today's markers.
function withNewCues(project, scene, chunks, cached, hash, recording) {
  const wordTimes = [];
  let k = 0;
  scene.units.forEach((u, i) => {
    if (u.type === 'word') wordTimes[i] = cached.words[k++];
  });
  const info = {
    ...cached,
    hash,
    speech: speechHash(scene, chunks, project.config, recording),
    marks: Object.fromEntries(Object.entries(resolveMarks(scene.units, wordTimes)).map(([name, v]) => [name, round(v)])),
  };
  fs.writeFileSync(voicePaths(project, scene.id).json, JSON.stringify(info, null, 2));
  return info;
}

// Says which step a scene is on once it has taken 2 seconds: making speech,
// timing words or checking speech. In a terminal one line changes in place.
// Elsewhere the step that runs at that moment gets a short line, and so does
// every step after it when it starts, so the lines come in the order the steps
// run. With several sentences, each line says which sentence it is.
function progress(id, log, sentences) {
  const t0 = Date.now();
  let step = null;
  let sentence = 0;
  let shown = null;
  const show = () => {
    if (!step) return;
    const line = `voice ${id}: ${step}${sentences > 1 ? `, sentence ${sentence} of ${sentences}` : ''}`;
    if (log.update) log.update(line);
    else if (line !== shown) log(line);
    shown = line;
  };
  const timer = setTimeout(show, 2000);
  timer.unref?.();
  return {
    step(name, index = 0) {
      step = name;
      sentence = index + 1;
      if (Date.now() - t0 >= 2000) show();
    },
    done: () => clearTimeout(timer),
  };
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

// The chunks of one scene with the project's gaps and pace. A voice whose
// connector reads from pause to pause gets those chunks instead of sentences.
export function sceneChunks(project, scene) {
  const { config } = project;
  const by = speechConnector(config)?.chunks;
  return speechChunks(scene.units, { sentenceGap: config.sentenceGap, paragraphGap: config.paragraphGap, pace: config.pace, language: config.language, ...(by ? { chunks: by } : {}) });
}

// The paid requests of the current script, for telling open jobs from old ones,
// and those that a scene still has to be built from.
export function speechKeys(project) {
  const current = new Set();
  const unbuilt = new Set();
  const paid = speechConnector(project.config);
  if (!paid) return { current, unbuilt };
  for (const scene of project.script.scenes) {
    const chunks = sceneChunks(project, scene);
    const keys = chunks.map((chunk) => speechKey(paid, project.config, chunk.text));
    keys.forEach((key) => current.add(key));
    const built = readVoice(project, scene.id)?.hash === sceneHash(scene, chunks, project.config) && fs.existsSync(voicePaths(project, scene.id).wav);
    if (!built) keys.forEach((key) => unbuilt.add(key));
  }
  return { current, unbuilt };
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
  const byPause = speechConnector(config)?.chunks === 'pauses';
  const paused = (i) => (i ? byPause || old[i].gapBefore !== sentenceGap || !SENTENCE_END.test(old[i - 1].text) : old[0].gapBefore > 0);
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
function addFinishedScene(project, speech, scene, chunks, cached, hash, log, notice) {
  const file = voicePaths(project, scene.id).wav;
  if (!Array.isArray(cached?.chunks) || !cached.chunks.length || !fs.existsSync(file)) return;
  if (cached.chunks.every((c) => speech.knows(c.text))) return;
  if (!sameTake(chunks, cached, hash, project.config)) {
    notice(`voice ${scene.id}: the finished scene can't be matched to today's voice settings, so any of its sentences that aren't saved yet are bought.`);
    return;
  }
  let samples, sampleRate;
  try {
    ({ samples, sampleRate } = readWav(file));
  } catch {
    return;
  }
  let added = 0;
  // Checked one by one, because a scene can say the same sentence twice.
  for (const c of cached.chunks) {
    if (speech.knows(c.text)) continue;
    speech.add(scene.id, c.text, samples.subarray(Math.round(c.start * sampleRate), Math.round(c.end * sampleRate)), sampleRate);
    added++;
  }
  log(`voice ${scene.id}: saved ${added} paid request${added === 1 ? '' : 's'} from the finished scene in history/voice/`);
}

// What the voice line says about a scene it made, like "intro: 10.1 s of
// narration (13.0 s with pauses), made in 13.1 s". A recorded scene has its
// pauses in the recording, so it says how long its cut is.
export function voiceLine(id, info, seconds, recorded = false) {
  const made = `made in ${seconds.toFixed(1)} s`;
  if (recorded) return `${id}: a ${info.duration.toFixed(1)} s cut of the recording, pauses included, ${made}`;
  return `${id}: ${narrationTime(info).toFixed(1)} s of narration (${info.duration.toFixed(1)} s with pauses), ${made}`;
}

// Returns { [sceneId]: voiceInfo } and generates whatever is missing or stale.
// `fresh` buys again only the paid requests that have no good answer. `transcribe`
// replaces Whisper in tests. Before it makes speech, it logs how long the video
// will be about, and gives that estimate to `onEstimate`.
export async function synthesize(project, { force = false, fresh = false, log = () => {}, notice = log, only = null, transcribe = transcribeWords, onEstimate = () => {} } = {}) {
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
    const key = recording ? {
      content: recording.hash,
      scenes: recordings.folder ? null : project.script.scenes.map((s) => s.spoken),
    } : null;
    const hash = sceneHash(scene, chunks, config, key);
    const cached = readVoice(project, scene.id);
    const hasAudio = !chunks.length || fs.existsSync(voicePaths(project, scene.id).wav);
    if (speech && chunks.length) addFinishedScene(project, speech, scene, chunks, cached, hash, log, notice);
    const keep = !force && cached && hasAudio && !speech?.needsNew(chunks);
    if (keep && cached.hash === hash) {
      result[scene.id] = await reviewed(project, scene.id, cached);
    } else if (keep && chunks.length && onlyMarkersMoved(project, scene, chunks, config, key, cached)) {
      result[scene.id] = await reviewed(project, scene.id, withNewCues(project, scene, chunks, cached, hash, key));
      log(`voice ${scene.id}: kept the narration, updated the cues`);
    } else if (only && !only.includes(scene.id) && cached) {
      result[scene.id] = await reviewSpeech(cached, config.language);
    } else {
      todo.push({ scene, chunks, hash, key, before: cached });
    }
  }
  // Every scene takes the forms of "heard" in video.json.
  const finish = () => {
    for (const id of Object.keys(result)) result[id] = withHeard(result[id], config.language, project.heard);
    return result;
  };
  if (!todo.length) return finish();
  if (!recordings && todo.some((t) => t.chunks.length)) {
    const estimate = estimateLength(project);
    if (estimate) {
      log(`voice: ${estimateLine(estimate)}`);
      // Chapters that will likely be too short for YouTube, before the voice takes its time.
      for (const h of estimatedChapterHints(project, estimate)) log(`voice: ${h.message}`);
      onEstimate(estimate);
    }
  }
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
  // Each scene that is spoken has its number out of all of them, like "scene 4/6",
  // and from the first one on, the time that is left, from how long its words took.
  const spoken = todo.filter((t) => t.chunks.length);
  const weight = (t) => Math.max(1, spokenWords(t.scene.spoken).length);
  const all = spoken.reduce((n, t) => n + weight(t), 0);
  const began = Date.now();
  let done = 0;
  for (const item of todo) {
    const { scene, chunks, hash, key } = item;
    const t0 = Date.now();
    const number = chunks.length ? `scene ${spoken.indexOf(item) + 1}/${spoken.length} ` : '';
    // A recording is cut and checked as one piece, not sentence by sentence.
    const steps = progress(`${number}${scene.id}`, log, recordings ? 1 : chunks.length);
    let info;
    try {
      info = recordings && chunks.length
        ? await recordingScene(project, scene, hash, recordings.files[scene.id], take, cuts.find((c) => c.scene.id === scene.id), heardTake, log, transcribe, key, steps)
        : await synthesizeScene(project, scene, chunks, hash, tts, speech, log, transcribe, steps);
    } finally {
      steps.done();
    }
    result[scene.id] = info;
    const twice = item.before ? heardTwice(withHeard(item.before, config.language, project.heard), withHeard(info, config.language, project.heard), config.language) : [];
    if (twice.length) notice(`voice ${scene.id}: ${heardLine(twice)}`);
    if (chunks.length) {
      const warn = info.matchRate < 0.85 ? (recordings
        ? `, recording does not match ${scriptName(project)} here (${Math.round(info.matchRate * 100)}% of words confirmed). Make ${scriptName(project)} say what was actually said.`
        : `, check pronunciation (${Math.round(info.matchRate * 100)}% of words confirmed)`) : '';
      done += weight(item);
      const left = done < all ? `, about ${roughTime(((Date.now() - began) / done) * (all - done) / 1000)} left` : '';
      log(`voice ${number}${voiceLine(scene.id, info, (Date.now() - t0) / 1000, !!recordings)}${warn}${left}`);
    }
  }
  return finish();
}

async function synthesizeScene(project, scene, chunks, hash, tts, speech, log, transcribe, steps) {
  const { config } = project;
  const files = voicePaths(project, scene.id);
  if (!chunks.length) {
    const info = { hash, speech: speechHash(scene, chunks, config), check: CHECK, id: scene.id, duration: 0, words: [], marks: resolveMarks(scene.units, []), chunks: [], transcript: '', matchRate: 1, unmatched: [], nearly: [] };
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
  const nearly = [];
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
    steps.step('making speech', ci);
    const audio = speech
      ? await speech.get(scene.id, chunks, ci)
      : await generateSpeech(tts, chunk.text, { language: config.language, voice: config.voice, speed: config.speed * config.pace, phonemes: phonemes?.[ci] });
    const samples = trimSilence(audio.audio, audio.sampling_rate || sr);
    const start = cursor / sr;
    const dur = samples.length / sr;
    pieces.push(samples);
    cursor += samples.length;

    steps.step('timing words', ci);
    const heard = await transcribe(resample(samples, sr, 16000), { log, language: config.language });
    transcripts.push(heard.text);
    steps.step('checking speech', ci);
    const aligned = await alignSpeech(chunk.words, heard.words, dur, config.language, { accept: project.heard });
    chunk.words.forEach((w, k) => {
      const a = aligned.words[k];
      wordTimes[w.unitIndex] = { start: start + a.start, end: start + a.end, matched: a.matched };
      if (!a.matched) unmatched.push(w.display);
    });
    nearly.push(...nearList(chunk.words, aligned.words));
    const tokens = chunk.words.reduce((n, w) => n + (['ja', 'zh'].includes(config.language) ? Array.from(normWord(w.spoken).normalize('NFC')).length : Math.max(1, spokenWords(w.spoken).length)), 0);
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
    speech: speechHash(scene, chunks, config),
    check: CHECK,
    id: scene.id,
    duration: round(cursor / sr),
    words,
    marks: Object.fromEntries(Object.entries(resolveMarks(scene.units, wordTimes)).map(([k, v]) => [k, round(v)])),
    chunks: chunkInfo.map((c) => ({ ...c, start: round(c.start), end: round(c.end) })),
    transcript: transcripts.join(' '),
    matchRate: totalTokens ? Math.round((matchedTokens / totalTokens) * 1000) / 1000 : 1,
    unmatched,
    nearly,
  };
  fs.writeFileSync(files.json, JSON.stringify(info, null, 2));
  return info;
}

async function recordingScene(project, scene, hash, source, take, cut, heardTake, log, transcribe, key, steps) {
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
  if (!heardTake) steps.step('timing words');
  const heard = heardTake ? {
    words: heardTake.words.filter((w) => w.start >= cut.start && w.start < cut.end).map(local),
  } : await transcribe(resample(samples, sr, 16000), { log, language: config.language });
  const units = scene.units.filter((u) => u.type === 'word');
  steps.step('checking speech');
  const aligned = await alignSpeech(units, heard.words, duration, config.language, { accept: project.heard });
  const times = cut ? cut.words.map(local) : aligned.words;
  const wordTimes = [];
  let wi = 0;
  scene.units.forEach((u, i) => { if (u.type === 'word') wordTimes[i] = times[wi++]; });
  const files = voicePaths(project, scene.id);
  await saveRecording(files.wav, samples, sr);
  const info = {
    hash, speech: speechHash(scene, null, config, key), check: CHECK, id: scene.id, duration: round(duration),
    words: units.map((u, i) => ({ text: u.display, spoken: u.spoken, start: round(times[i].start), end: round(times[i].end), matched: aligned.words[i].matched })),
    marks: Object.fromEntries(Object.entries(resolveMarks(scene.units, wordTimes)).map(([k, v]) => [k, round(v)])),
    chunks: [{ start: 0, end: round(duration), text: scene.spoken }],
    transcript: heard.words.map((w) => w.text).join(' '),
    matchRate: round(aligned.matchRate), unmatched: units.filter((u, i) => !aligned.words[i].matched).map((u) => u.display),
    nearly: nearList(units, aligned.words),
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
