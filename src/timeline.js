// Lays scenes end to end. A scene lasts for its lead-in, its narration and a
// short hold; scenes without narration last `min` seconds (default 3).
// `pace` shortens every lead-in, hold and transition (the voice is already
// faster). All times are snapped to the frame grid. With "targetSeconds", a
// video that comes out shorter gets the missing time spread over the holds of
// its scenes.
import path from 'node:path';
import { normWord, speechChunks } from './script.js';

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

// The words a minute that a voice says at its normal speed, by language, as
// Kokoro's voices say them at their default speed of 0.9. Japanese and Chinese
// count characters. Faster speech says more words a minute, though not in step
// with the speed: 15% faster says about 9% more.
const SPOKEN_A_MINUTE = { en: 180, es: 160, fr: 160, it: 160, 'pt-br': 160, hi: 150, de: 150, ja: 300, zh: 230 };

// How long a video will be about, from its script and settings alone, before
// any narration exists: the speech, and per scene its lead, its hold and the
// pauses between its sentences. A recording has its own length, so it has none.
export function estimateLength(project) {
  const { config, script } = project;
  if (config.voice?.provider === 'recording') return null;
  const cjk = ['ja', 'zh'].includes(config.language);
  const pace = config.pace || 1;
  const normal = typeof config.voice === 'string' ? 0.9 : 1;
  const perMinute = Math.round((SPOKEN_A_MINUTE[config.language] ?? 160) * ((config.speed * pace) / normal) ** 0.65);
  let words = 0;
  let speech = 0;
  let total = 0;
  script.scenes.forEach((scene, index) => {
    const a = scene.attrs;
    const isLast = index === script.scenes.length - 1;
    const count = cjk ? Array.from(normWord(scene.spoken).normalize('NFC')).length : scene.spoken.split(/\s+/).filter(Boolean).length;
    let dur;
    if (count) {
      const talk = (count / perMinute) * 60;
      const chunks = speechChunks(scene.units, { sentenceGap: config.sentenceGap, paragraphGap: config.paragraphGap, pace, language: config.language });
      const pauses = chunks.slice(1).reduce((n, c) => n + c.gapBefore, 0);
      dur = ((a.lead ?? config.lead) + (a.hold ?? config.hold) + (isLast ? config.end : 0)) / pace + talk + pauses;
      words += count;
      speech += talk;
    } else dur = ((a.min ?? 3) + (isLast ? config.end : 0)) / pace;
    if (a.min) dur = Math.max(dur, a.min / pace);
    total += Math.max(dur, 1);
  });
  if (!words) return null;
  const tenth = (v) => Math.round(v * 10) / 10;
  return {
    seconds: tenth(total),
    [cjk ? 'characters' : 'words']: words,
    perMinute,
    perScene: tenth((total - speech) / script.scenes.length),
    scenes: script.scenes.length,
    ...(config.targetSeconds ? { targetSeconds: config.targetSeconds } : {}),
  };
}

// "about 46 s: 105 words of speech at about 180 a minute, plus about 1.4 s per
// scene for leads, holds and pauses", and what that means for targetSeconds.
export function estimateLine(e) {
  const unit = e.characters !== undefined ? 'characters' : 'words';
  const count = e.characters ?? e.words;
  const line = `about ${Math.round(e.seconds)} s: ${count} ${unit} of speech at about ${e.perMinute} a minute, plus about ${e.perScene.toFixed(1)} s per scene for leads, holds and pauses`;
  if (!e.targetSeconds) return line;
  const over = e.seconds - e.targetSeconds;
  if (over > 0.5) return `${line}. That is about ${Math.round(over)} s over targetSeconds ${e.targetSeconds}, so cut about ${Math.max(1, Math.round((over / 60) * e.perMinute))} ${unit}.`;
  return `${line}. The holds get longer to reach targetSeconds ${e.targetSeconds}.`;
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
