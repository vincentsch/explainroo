// Lays scenes end to end. A scene lasts for its lead-in, its narration and a
// short hold; scenes without narration last `min` seconds (default 3).
// `pace` shortens every lead-in, hold and transition (the voice is already
// faster). All times are snapped to the frame grid. With "targetSeconds", a
// video that comes out shorter gets the missing time spread over the holds of
// its scenes.
import path from 'node:path';
import { normWord, speechChunks, spokenWords } from './script.js';

export const TRANSITION_SECONDS = 0.7;

// A folder of the project as the engine page asks for it, like "build/es/voice".
export function projectUrl(project, dir) {
  return path.relative(project.dir, dir).split(path.sep).join('/');
}

export function buildTimeline(project, voices) {
  const { config, script } = project;
  const voiceDir = project.paths ? projectUrl(project, project.paths.voice) : 'build/voice';
  const fps = config.fps;
  const pace = config.pace || 1;
  const snap = (t) => Math.round(t * fps) / fps;
  const voiceOf = (scene) => voices[scene.id] || { duration: 0, words: [], marks: {}, chunks: [] };
  const leadOf = (scene) => (voiceOf(scene).duration ? (scene.attrs.lead ?? config.lead) / pace : 0);
  const durs = script.scenes.map((scene, index) => {
    const v = voiceOf(scene);
    const a = scene.attrs;
    const isLast = index === script.scenes.length - 1;
    const hold = ((a.hold ?? config.hold) + (isLast ? config.end : 0)) / pace;
    let dur = v.duration ? leadOf(scene) + v.duration + hold : ((a.min ?? 3) + (isLast ? config.end : 0)) / pace;
    if (a.min) dur = Math.max(dur, a.min / pace);
    return Math.max(snap(dur), 1);
  });
  const target = config.targetSeconds ? fitTarget(durs, config.targetSeconds, fps) : null;
  const scenes = [];
  const voiceSpans = [];
  let t = 0;
  script.scenes.forEach((scene, index) => {
    const v = voiceOf(scene);
    const shown = scene.units.filter((u) => u.type === 'word');
    const a = scene.attrs;
    const lead = leadOf(scene);
    const dur = target ? target.durs[index] : durs[index];
    const start = snap(t);
    const transition = index === 0 ? 'none' : (a.transition || config.transition);
    scenes.push({
      id: scene.id,
      index,
      start,
      dur,
      lead,
      text: scene.text,
      transition,
      voice: v.duration ? { url: `${voiceDir}/${scene.id}.wav`, start: start + lead, dur: v.duration } : null,
      // A keyword for bold captions is display information. It always comes from
      // the current script and never from a voice cache, matched to the cached
      // words by position, so adding or removing *stars* needs no new voice.
      words: v.words.map((w, k) => ({ text: w.text, start: lead + w.start, end: lead + w.end, ...(shown[k]?.key && shown[k].display === w.text ? { key: true } : {}) })),
      marks: Object.fromEntries(Object.entries(v.marks || {}).map(([k, m]) => [k, lead + m])),
      attrs: a,
    });
    for (const c of v.chunks || []) voiceSpans.push({ start: start + lead + c.start, end: start + lead + c.end });
    t = start + dur;
  });
  return {
    fps,
    ...(['ja', 'zh'].includes(config.language) ? { language: config.language } : {}),
    width: config.width,
    height: config.height,
    duration: snap(t),
    frames: Math.round(snap(t) * fps),
    transitionSeconds: TRANSITION_SECONDS / pace,
    pace,
    scenes,
    voiceSpans,
    // Only a video with "targetSeconds" has this, so every other timeline stays as it was.
    ...(target ? { target: target.report } : {}),
  };
}

// Spreads the time a video lacks to reach `seconds` evenly over its scenes, in
// whole frames, so it ends at the target. A longer video stays as it is.
function fitTarget(durs, seconds, fps) {
  const frames = durs.map((d) => Math.round(d * fps));
  const natural = frames.reduce((a, b) => a + b, 0);
  const missing = Math.round(seconds * fps) - natural;
  const round = (v) => Math.round(v * 100) / 100;
  if (missing <= 0) return { durs, report: { seconds, natural: round(natural / fps), added: 0, ...(missing < 0 ? { over: round(-missing / fps) } : {}) } };
  const each = Math.floor(missing / frames.length);
  const rest = missing - each * frames.length;
  return {
    durs: frames.map((f, k) => (f + each + (k < rest ? 1 : 0)) / fps),
    report: { seconds, natural: round(natural / fps), added: round(missing / frames.length / fps) },
  };
}

// How fast Kokoro's voices speak at their default speed of 0.9, in letters a
// second. Letters say more than words, whose length differs from text to text and
// from language to language: the same rate fits English and Spanish within a few
// percent. A digit counts as LETTERS_A_DIGIT letters, because the voice reads
// "1972" as "nineteen seventy-two". Faster speech says more, though not in step
// with the speed: 15% faster says about 9% more.
const LETTERS_A_SECOND = 12.95;
const LETTERS_A_DIGIT = 4;
// How fast each English voice speaks next to af_heart, measured on the same
// sentences at speed 0.9. The others count as 1.
const VOICE_RATES = {
  af_bella: 0.95, af_nicole: 0.62, af_aoede: 1.01, af_kore: 0.97, af_sarah: 0.99, af_nova: 1.04, af_alloy: 0.98, af_jessica: 1.11, af_river: 1.09,
  am_michael: 0.88, am_fenrir: 0.97, am_puck: 0.97, am_echo: 0.99, am_eric: 1.09, am_liam: 1.05, am_onyx: 1.03, am_santa: 0.87,
  bf_emma: 1.02, bf_alice: 0.96, bf_lily: 0.97, bm_george: 0.87, bm_fable: 0.9, bm_lewis: 0.91,
};
// Hindi writes many of its sounds as marks on a letter, and Japanese and Chinese
// count characters, so these count words or characters a minute instead.
const SPOKEN_A_MINUTE = { hi: 150, ja: 300, zh: 230 };

// How long the voice speaks a text, in seconds, at `factor` times its normal rate.
function talkSeconds(text, language, count, factor) {
  if (Object.hasOwn(SPOKEN_A_MINUTE, language)) return (count / (SPOKEN_A_MINUTE[language] * factor)) * 60;
  const letters = (text.match(/\p{L}/gu) || []).length + LETTERS_A_DIGIT * (text.match(/\p{N}/gu) || []).length;
  return letters / (LETTERS_A_SECOND * factor);
}

// How long a video will be about, from its script and settings alone, before
// any narration exists: the speech, and per scene its lead, its hold and the
// pauses between its sentences, and the end. A recording has its own length, so
// it has none. Each part comes from the settings the video uses.
export function estimateLength(project) {
  const { config, script } = project;
  if (config.voice?.provider === 'recording') return null;
  const cjk = ['ja', 'zh'].includes(config.language);
  const pace = config.pace || 1;
  const normal = typeof config.voice === 'string' ? 0.9 : 1;
  const factor = ((config.speed * pace) / normal) ** 0.65 * (VOICE_RATES[config.voice] ?? 1);
  let words = 0;
  let speech = 0;
  let leads = 0;
  let narrated = 0;
  let pauses = 0;
  let total = 0;
  script.scenes.forEach((scene, index) => {
    const a = scene.attrs;
    const isLast = index === script.scenes.length - 1;
    const count = cjk ? Array.from(normWord(scene.spoken).normalize('NFC')).length : spokenWords(scene.spoken).length;
    let dur;
    if (count) {
      const talk = talkSeconds(scene.spoken, config.language, count, factor);
      const chunks = speechChunks(scene.units, { sentenceGap: config.sentenceGap, paragraphGap: config.paragraphGap, pace, language: config.language });
      const gaps = chunks.slice(1).reduce((n, c) => n + c.gapBefore, 0);
      const around = ((a.lead ?? config.lead) + (a.hold ?? config.hold)) / pace;
      dur = around + (isLast ? config.end / pace : 0) + talk + gaps;
      words += count;
      speech += talk;
      leads += around;
      narrated++;
      pauses += gaps;
    } else dur = ((a.min ?? 3) + (isLast ? config.end : 0)) / pace;
    if (a.min) dur = Math.max(dur, a.min / pace);
    total += Math.max(dur, 1);
  });
  if (!words) return null;
  const tenth = (v) => Math.round(v * 10) / 10;
  const end = config.end / pace;
  return {
    seconds: tenth(total),
    [cjk ? 'characters' : 'words']: words,
    // For this text: its words, or characters, over the time the voice speaks them.
    perMinute: Math.round((words / speech) * 60),
    speechSeconds: tenth(speech),
    // Each narrated scene's lead and hold, as the settings give them.
    perScene: Math.round((leads / narrated) * 100) / 100,
    scenes: narrated,
    pauses: tenth(pauses),
    end: tenth(end),
    // What a min on a scene, or a scene without narration, adds.
    other: tenth(Math.max(0, total - speech - leads - pauses - end)),
    ...(config.targetSeconds ? { targetSeconds: config.targetSeconds } : {}),
  };
}

// "about 46 s: 105 words of speech at about 180 a minute take 35.0 s. The 6
// scenes add 1.05 s each for their lead and hold, and the pauses between
// sentences add 2.1 s. The end of the video adds 1.4 s." And what that means for
// targetSeconds.
export function estimateLine(e) {
  const unit = e.characters !== undefined ? 'characters' : 'words';
  const count = e.characters ?? e.words;
  const scenes = e.scenes === 1 ? `The scene adds ${e.perScene} s for its lead and hold` : `The ${e.scenes} scenes add ${e.perScene} s each for their lead and hold`;
  const pauses = e.pauses ? `, and the pauses between sentences add ${e.pauses.toFixed(1)} s` : '';
  const other = e.other ? ` Scenes with a min, or without narration, add ${e.other.toFixed(1)} s more.` : '';
  const line = `about ${Math.round(e.seconds)} s: ${count} ${unit} of speech at about ${e.perMinute} a minute take ${e.speechSeconds.toFixed(1)} s. ${scenes}${pauses}. The end of the video adds ${e.end.toFixed(1)} s.${other}`;
  if (!e.targetSeconds) return line;
  const over = e.seconds - e.targetSeconds;
  if (over > 0.5) return `${line} That is about ${Math.round(over)} s over targetSeconds ${e.targetSeconds}, so cut about ${Math.max(1, Math.round((over / 60) * e.perMinute))} ${unit}.`;
  return `${line} The holds get longer to reach targetSeconds ${e.targetSeconds}.`;
}

// A time to wait, rounded the way a person says it: "5 s", "40 s", "1 min 40 s".
export function roughTime(seconds) {
  const rounded = seconds < 60 ? Math.max(5, Math.round(seconds / 5) * 5) : Math.round(seconds / 10) * 10;
  return rounded < 60 ? `${rounded} s` : `${Math.floor(rounded / 60)} min${rounded % 60 ? ` ${rounded % 60} s` : ''}`;
}

// What voice and check say about "targetSeconds": a video that is longer, with
// its three longest scenes, and holds that grew by more than 3 seconds.
export function targetNotes(timeline, perMinute = null) {
  const t = timeline.target;
  if (!t) return [];
  if (t.over) {
    const longest = [...timeline.scenes].sort((a, b) => b.dur - a.dur).slice(0, 3).map((s) => `${s.id} (${s.dur.toFixed(1)} s)`);
    const list = longest.length > 1 ? `${longest.slice(0, -1).join(', ')} and ${longest.at(-1)}` : longest[0];
    const cut = perMinute ? ` Cut about ${Math.max(1, Math.round((t.over / 60) * perMinute))} words, or raise targetSeconds.` : '';
    return [{ level: 'warn', message: `the video runs ${t.natural.toFixed(1)} s, ${t.over.toFixed(1)} s over targetSeconds ${t.seconds}. The longest ${longest.length === 1 ? 'scene is' : 'scenes are'} ${list}.${cut}` }];
  }
  if (t.added > 3) return [{ level: 'warn', message: `targetSeconds ${t.seconds} adds ${t.added.toFixed(1)} s to the hold of every scene, because the narration with its pauses runs ${t.natural.toFixed(1)} s. Write more narration, or lower targetSeconds.` }];
  return [];
}
