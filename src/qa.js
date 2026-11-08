// Quality tools for the agent: layout checks, stills, contact sheets and a
// verification pass over the rendered video.
import fs from 'node:fs';
import path from 'node:path';
import { prepare, withEngine } from './pipeline.js';
import { dbtp, probe, loudness, ffmpeg, PEAK_CEILING } from './ffmpeg.js';
import { transcribeWords } from './models.js';
import { readWav } from './wav.js';
import { alignWords, nearList, readAlike } from './align.js';
import { heardInstead } from './voice.js';
import { buildChapters, chapterHints } from './chapters.js';
import { coverTime } from './render.js';
import { languageIssues, outputPath, ProjectError, scriptName } from './project.js';
import { recordVersion, relativeFile, sha256File } from './history.js';
import { decodedSound } from './server.js';

// "2 words only nearly matched: Soundroo (heard "Soundru"), Codex (heard "codecs")".
// The same word heard the same way counts once, with how often.
export function nearlyText(nearly) {
  const seen = new Map();
  for (const { word, heard } of nearly) {
    const text = heard ? `${word} (heard "${heard}")` : word;
    seen.set(text, (seen.get(text) ?? 0) + 1);
  }
  const list = [...seen].slice(0, 8).map(([text, n]) => (n > 1 ? `${text} ${n} times` : text));
  const more = seen.size > 8 ? `, and ${seen.size - 8} more` : '';
  return `${nearly.length} word${nearly.length === 1 ? '' : 's'} only nearly matched: ${list.join(', ')}${more}`;
}

// The shown and spoken text of an override without the punctuation after it,
// which the script writes after the braces.
function override(word) {
  const after = /[.,;:!?…)\]"'’”]+$/u;
  const end = after.exec(word.text)?.[0];
  return end && word.spoken.endsWith(end) ? { shown: word.text.slice(0, -end.length), spoken: word.spoken.slice(0, -end.length) } : { shown: word.text, spoken: word.spoken };
}

// What to do about words the voice check couldn't confirm. A word that already
// has {shown|spoken} needs another spoken spelling, so that advice isn't repeated.
// `others` says whether a word without an override wasn't confirmed either.
function unconfirmedAdvice(overridden, others, script) {
  const general = `If a word is mispronounced, write it as {shown|spoken} in ${script}.`;
  if (!overridden.length) return general;
  const said = overridden.map(({ word, heard }) => {
    const { shown, spoken } = override(word);
    return `{${shown}|${spoken}} was ${heard ? `heard as "${heard}"` : 'not heard as written'}`;
  });
  const one = overridden.length === 1;
  const ask = `${said.join(', and ')}, so ${one ? 'the override' : 'the overrides'} didn't help. Try a different spoken spelling, like {${override(overridden[0].word).shown}|another spelling}, or reword the sentence.`;
  return others ? `${ask} If another word is mispronounced, write it as {shown|spoken} in ${script}.` : ask;
}

// A saved word whose shown and spoken text differ, from {shown|spoken}.
const hasOverride = (word) => word.spoken !== undefined && word.spoken !== word.text;

// What check says about the speech check of each scene, from the narration that
// voice made: the words it couldn't confirm and what to do about them, and the
// words that only nearly matched. `speech` has one entry per narrated scene.
export function speechFindings(project, voices) {
  const issues = [];
  const speech = [];
  const script = scriptName(project);
  const recording = project.config.voice.provider === 'recording';
  for (const sc of project.script.scenes) {
    const v = voices[sc.id];
    const suspicious = v ? v.unmatched.filter((w) => w.replace(/[^\p{L}\p{M}\p{N}]/gu, '').length > 3) : [];
    // A word that already has {shown|spoken} counts at any length, like {SQL|sequel},
    // because its override didn't help.
    const missed = !recording && Array.isArray(v?.words) ? v.words.map((word, k) => ({ word, k })).filter(({ word }) => !word.matched) : [];
    const overridden = missed.filter(({ word }) => hasOverride(word));
    if (v && v.duration && (v.matchRate < 0.9 || suspicious.length || overridden.length)) {
      // In the order of the script, the long words and every word with an override.
      const listed = overridden.length ? missed.filter(({ word }) => hasOverride(word) || suspicious.includes(word.text)).slice(0, 8) : null;
      const shown = listed ? listed.filter(({ word }) => hasOverride(word)) : [];
      // What was heard in place of each listed override.
      const instead = shown.length ? heardInstead(v, project.config.language) : {};
      const names = listed ? listed.map(({ word }) => word.text) : suspicious.slice(0, 8);
      const advice = recording
        ? `The recording does not match ${script} here. Make ${script} say what was actually said.`
        : unconfirmedAdvice(shown.map(({ word, k }) => ({ word, heard: instead[k] })), missed.some(({ word }) => !hasOverride(word)), script);
      issues.push({ level: 'warn', scene: sc.id, t: null, message: `the voice check could not confirm ${names.length ? names.map((w) => `"${w}"`).join(', ') : `${Math.round((1 - v.matchRate) * 100)}% of the words`}. It heard: "${v.transcript.slice(0, 200)}". ${advice}` });
    }
    if (v && v.duration > 40) issues.push({ level: 'hint', scene: sc.id, t: null, message: `the narration runs ${v.duration.toFixed(0)}s; long scenes are easier to follow when split` });
    if (v && v.duration) {
      const nearly = v.nearly ?? [];
      speech.push({ scene: sc.id, matchRate: v.matchRate, nearly });
      if (nearly.length) issues.push({ level: 'hint', scene: sc.id, t: null, message: `understood ${Math.round(v.matchRate * 100)}%, ${nearlyText(nearly)}` });
    }
  }
  return { issues, speech };
}

export async function check(project, { log = () => {}, step = 0.25, viewWidth = null } = {}) {
  if (viewWidth !== null && (!Number.isFinite(viewWidth) || viewWidth <= 0)) throw new Error("--view-width must be a positive number");
  const { voices, timeline } = await prepare(project, { log });
  const issues = chapterHints(buildChapters(timeline, project.script.title || project.config.title));
  const { issues: spoken, speech } = speechFindings(project, voices);
  issues.push(...spoken);
  if (project.languages) issues.push(...languageIssues(project));
  if (project.config.music?.src) {
    try {
      await decodedSound(project.dir, project.config.music.src);
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      issues.push({ level: 'error', scene: null, t: null, message: `music: ${e.message}` });
    }
  }
  // The cover's moment. One at a scene that isn't there is an error, which
  // would stop render.
  let cover = null;
  try {
    cover = coverTime(project.config, timeline);
  } catch (e) {
    issues.push({ level: 'error', scene: null, t: null, message: `cover: ${e.message}` });
  }
  const pageIssues = await withEngine(project, timeline, { scale: 0.5, log }, async (page) => [
    ...(await page.evaluate(([s, w]) => window.explainroo.check(s, w), [step, viewWidth])),
    ...(await page.evaluate(() => window.explainroo.soundFileIssues())),
    ...(cover ? [await page.evaluate((T) => window.explainroo.coverIssue(T), cover.T)].filter(Boolean) : []),
  ]);
  issues.push(...pageIssues);
  const order = { error: 0, warn: 1, hint: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { issues, duration: timeline.duration, scenes: timeline.scenes.length, speech };
}

// Specs: "12.5" (seconds into the video), "scene" (end of the scene, when it
// is fully built), "scene@2.4" (seconds into the scene), "scene@end".
export function resolveTimes(timeline, specs) {
  const byId = new Map(timeline.scenes.map((s) => [s.id, s]));
  const endOf = (sc) => sc.start + Math.max(0, sc.dur - 0.3);
  if (!specs.length) return timeline.scenes.map((sc) => ({ T: endOf(sc), label: `${sc.id}@end` }));
  return specs.map((spec) => {
    if (typeof spec === 'number' || /^\d+(\.\d+)?$/.test(spec)) {
      const T = Math.min(Number(spec), timeline.duration - 1 / timeline.fps);
      return { T, label: `t${T.toFixed(2)}` };
    }
    const [id, at] = spec.split('@');
    const sc = byId.get(id);
    if (!sc) throw new Error(`no scene "${id}". Scenes: ${[...byId.keys()].join(', ')}`);
    if (!at || at === 'end') return { T: endOf(sc), label: `${id}@end` };
    if (at === 'start') return { T: sc.start, label: `${id}@start` };
    const local = Number(at);
    if (!Number.isFinite(local)) throw new Error(`"${spec}": use scene@seconds, for example ${id}@1.5`);
    // Keep the time as written, so "ask@7.0" saves as ask@7.0.png.
    return { T: sc.start + Math.min(local, sc.dur - 0.01), label: `${id}@${at}` };
  });
}

export async function stills(project, specs, { log = () => {}, scale = 1, transparent = false } = {}) {
  const { timeline } = await prepare(project, { log });
  const dir = path.relative(project.dir, outputPath(project, 'stills')).split(path.sep).join('/');
  const list = resolveTimes(timeline, specs).map((x) => ({ ...x, path: `${dir}/${x.label.replace(/[^\w@.-]/g, '_')}.png` }));
  await withEngine(project, timeline, { scale, transparent, log }, (page) => page.evaluate((l) => window.explainroo.stills(l), list));
  return list.map((x) => ({ time: Math.round(x.T * 100) / 100, label: x.label, file: path.join(project.dir, x.path) }));
}

// `times` takes what still takes, like ["3", "intro@2"], and shows just those
// moments, in that order, in a sheet of its own.
export async function sheet(project, { scene = null, every = null, times: moments = null, cols = null, log = () => {} } = {}) {
  if (moments && (scene || (every !== null && every !== undefined))) throw new ProjectError(`--times picks the moments itself, so it can't go with --${scene ? 'scene' : 'every'}. Leave out one of them.`);
  const { timeline } = await prepare(project, { log });
  let times = [];
  let labels = [];
  const file = path.relative(project.dir, outputPath(project, moments ? 'sheet-times' : scene ? `sheet-${scene}` : 'sheet', '.jpg')).split(path.sep).join('/');
  if (moments) {
    const list = resolveTimes(timeline, moments);
    times = list.map((x) => x.T);
    labels = list.map((x) => x.label);
  } else if (scene) {
    const sc = timeline.scenes.find((s) => s.id === scene);
    if (!sc) throw new Error(`no scene "${scene}". Scenes: ${timeline.scenes.map((s) => s.id).join(', ')}`);
    const step = every ?? Math.max(0.25, Math.min(1, sc.dur / 16));
    for (let t = 0; t < sc.dur - 0.01; t += step) {
      times.push(sc.start + t);
      labels.push(`${sc.id} ${t.toFixed(2)}s`);
    }
    times.push(sc.start + sc.dur - 0.05);
    labels.push(`${sc.id} end`);
  } else {
    const step = every ?? Math.max(0.5, Math.min(3, timeline.duration / 30));
    for (let T = 0; T < timeline.duration; T += step) {
      const sc = [...timeline.scenes].reverse().find((s) => T >= s.start) || timeline.scenes[0];
      times.push(T);
      labels.push(`${sc.id} ${(T - sc.start).toFixed(1)}s`);
    }
  }
  const c = cols ?? Math.min(times.length, times.length > 20 ? 6 : times.length > 9 ? 5 : 4);
  const thumb = timeline.width >= timeline.height ? 320 : 200;
  await withEngine(project, timeline, { scale: 0.5, log }, (page) => page.evaluate((o) => window.explainroo.sheet(o), { times, labels, cols: c, thumb, path: file }));
  return { file: path.join(project.dir, file), frames: times.length, ...(moments ? { times: times.map((T, i) => ({ time: Math.round(T * 100) / 100, label: labels[i] })) } : {}) };
}

// The report goes to `report`, and by default to out/report.json, also for a
// file given with --file. `transcribe` replaces Whisper in tests.
export async function verify(project, { file = null, report: reportFile = null, log = () => {}, transcribe = transcribeWords } = {}) {
  const video = path.resolve(file || path.join(project.paths.out, 'video.mp4'));
  if (path.extname(video).toLowerCase() === '.gif') throw new Error('verify checks MP4, WebM and MOV files. Pass a video with --file.');
  if (!fs.existsSync(video)) throw new Error(`${video} does not exist. Run "explainroo render" first.`);
  const issues = [];
  const info = await probe(video);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format.duration);
  if (!v) issues.push({ level: 'error', message: 'the file has no video stream' });
  if (!a) issues.push({ level: 'error', message: 'the file has no audio stream' });
  const loud = a ? await loudness(video) : null;
  if (loud && loud.integrated !== null && Math.abs(loud.integrated - project.config.loudness) > 1.5) {
    issues.push({ level: 'warn', message: `loudness is ${loud.integrated} LUFS, target is ${project.config.loudness}` });
  }
  if (loud?.truePeak > 0) {
    issues.push({ level: 'error', message: `the true peak is ${dbtp(loud.truePeak)}, above 0 dBTP, so the sound is clipping. Render the video again with this version of explainroo, which holds the peak at ${dbtp(PEAK_CEILING)}. If it still clips, lower "loudness" in video.json.` });
  } else if (loud?.truePeak > PEAK_CEILING) {
    issues.push({ level: 'warn', message: `the true peak is ${dbtp(loud.truePeak)}, above the ceiling of ${dbtp(PEAK_CEILING)}` });
  }

  const alpha = v && (String(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE) === '1' || /^(yuva|rgba|bgra|gbrap|argb|abgr)/.test(v.pix_fmt || ''));
  let blacks = [];
  if (alpha) issues.push({ level: 'hint', message: 'black-frame detection is skipped because the video has alpha' });
  else if (v) {
    const { stderr: bd } = await ffmpeg(['-nostats', '-i', video, '-vf', 'blackdetect=d=0.4:pix_th=0.08', '-an', '-f', 'null', '-']);
    blacks = [...bd.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  }
  for (const [s, e] of blacks) issues.push({ level: 'warn', message: `black frames from ${s.toFixed(2)}s to ${e.toFixed(2)}s` });

  let silences = [];
  if (a) {
    const { stderr: sd } = await ffmpeg(['-nostats', '-i', video, '-af', 'silencedetect=n=-50dB:d=2.5', '-vn', '-f', 'null', '-']);
    const starts = [...sd.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
    const ends = [...sd.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    silences = starts.map((s, i) => [s, ends[i] ?? duration]);
    for (const [s, e] of silences) issues.push({ level: 'hint', message: `near silence from ${s.toFixed(1)}s to ${e.toFixed(1)}s` });
  }

  // Can the narration be understood over the music and effects? Each scene
  // is transcribed on its own: Whisper sometimes drops a whole 30 second
  // chunk of a long file ("(bell dings)"), and per scene the report can say
  // where the voice is hard to follow.
  let speech = null;
  if (a) {
    const wav = path.join(project.paths.build, 'verify-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const { samples } = readWav(wav);
    log('checking that the narration is understandable in the final mix');
    const tlFile = path.join(project.paths.build, 'timeline.json');
    const timeline = fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, 'utf8')) : null;
    const spokenWords = (sc) => sc.units.filter((u) => u.type === 'word').map((u) => ({ spoken: u.spoken, display: u.display }));
    const byId = new Map(project.script.scenes.map((sc) => [sc.id, sc]));
    const sameScenes = timeline && timeline.scenes.length === project.script.scenes.length && timeline.scenes.every((t) => byId.has(t.id)) && Math.abs(timeline.duration - duration) < 1;
    if (sameScenes) {
      const texts = [];
      const scenes = [];
      const nearly = [];
      let total = 0;
      let matched = 0;
      for (const t of timeline.scenes) {
        const words = spokenWords(byId.get(t.id));
        if (!words.length) continue;
        const from = Math.max(0, Math.floor(t.start * 16000));
        const to = Math.min(samples.length, Math.ceil((t.start + t.dur) * 16000));
        const heard = await transcribe(samples.subarray(from, to), { log, language: project.config.language });
        texts.push(heard.text);
        const alike = await readAlike(words, heard.words, project.config.language);
        const aligned = alignWords(alike.words, alike.heard, t.dur, project.config.language);
        const rate = aligned.matchRate;
        const near = nearList(words, aligned.words);
        scenes.push({ id: t.id, matchRate: Math.round(rate * 1000) / 1000, nearly: near });
        nearly.push(...near.map((n) => ({ scene: t.id, ...n })));
        total += words.length;
        matched += rate * words.length;
        if (rate < 0.8) issues.push({ level: 'warn', message: `scene "${t.id}": only ${Math.round(rate * 100)}% of the narration was understood in the final mix; it heard "${heard.text.slice(0, 120)}"` });
      }
      const rate = total ? matched / total : 1;
      speech = { matchRate: Math.round(rate * 1000) / 1000, transcript: texts.join(' '), scenes, nearly };
    } else {
      // The whole file at once, so a word that only nearly matched has no scene.
      const heard = await transcribe(samples, { log, language: project.config.language });
      const script = project.script.scenes.flatMap(spokenWords);
      const alike = await readAlike(script, heard.words, project.config.language);
      const aligned = alignWords(alike.words, alike.heard, duration, project.config.language);
      speech = { matchRate: Math.round(aligned.matchRate * 1000) / 1000, transcript: heard.text, nearly: nearList(script, aligned.words) };
    }
    if (speech.matchRate < 0.85) issues.push({ level: 'warn', message: `only ${Math.round(speech.matchRate * 100)}% of the script was understood in the final mix; lower music.volume or check pronunciation` });
    fs.rmSync(wav, { force: true });
  }
  const sha256 = sha256File(video);
  const report = {
    file: video,
    sha256,
    duration: Math.round(duration * 100) / 100,
    video: v ? { width: v.width, height: v.height, fps: v.r_frame_rate, codec: v.codec_name } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
    loudness: loud,
    blackSegments: blacks,
    silences,
    speech,
    issues,
  };
  const target = path.resolve(reportFile || path.join(project.paths.out, 'report.json'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  recordVersion(project.dir, {
    event: 'verify',
    time: new Date().toISOString(),
    file: relativeFile(project.dir, video),
    sha256,
    ok: !issues.some((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warn').length,
    loudness: loud?.integrated ?? null,
    understood: speech?.matchRate ?? null,
    report: relativeFile(project.dir, target),
  });
  return report;
}

// What verify prints: the file, the narration understood with the words that
// only nearly matched, and each finding.
export function formatVerify(r) {
  const nearly = r.speech?.nearly?.length ? `, ${nearlyText(r.speech.nearly)}` : '';
  return [
    `${r.file}: ${r.duration}s, ${r.video ? `${r.video.width}x${r.video.height}` : 'no video'}, loudness ${r.loudness?.integrated ?? '?'} LUFS, true peak ${dbtp(r.loudness?.truePeak)}`,
    r.speech ? `narration understood: ${Math.round(r.speech.matchRate * 100)}%${nearly}` : '',
    ...r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.message}`),
  ].filter(Boolean).join('\n');
}
