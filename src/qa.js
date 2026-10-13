// Quality tools for the agent: layout checks, stills, contact sheets and a
// verification pass over the rendered video.
import fs from 'node:fs';
import path from 'node:path';
import { prepare, withEngine } from './pipeline.js';
import { probe, loudness, ffmpeg } from './ffmpeg.js';
import { transcribeWords } from './models.js';
import { readWav } from './wav.js';
import { alignWords } from './align.js';
import { buildChapters, chapterHints } from './chapters.js';
import { outputPath } from './project.js';

export async function check(project, { log = () => {}, step = 0.25, viewWidth = null } = {}) {
  if (viewWidth !== null && (!Number.isFinite(viewWidth) || viewWidth <= 0)) throw new Error("--view-width must be a positive number");
  const { voices, timeline } = await prepare(project, { log });
  const issues = chapterHints(buildChapters(timeline, project.script.title || project.config.title));
  for (const sc of project.script.scenes) {
    const v = voices[sc.id];
    const suspicious = v ? v.unmatched.filter((w) => w.replace(/[^\p{L}\p{M}\p{N}]/gu, '').length > 3) : [];
    if (v && v.duration && (v.matchRate < 0.9 || suspicious.length)) {
      issues.push({ level: 'warn', scene: sc.id, t: null, message: `the voice check could not confirm ${suspicious.length ? suspicious.slice(0, 8).map((w) => `"${w}"`).join(', ') : `${Math.round((1 - v.matchRate) * 100)}% of the words`}. It heard: "${v.transcript.slice(0, 200)}". ${project.config.voice.provider === 'recording' ? 'The recording does not match script.md here. Make script.md say what was actually said.' : 'If a word is mispronounced, write it as {shown|spoken} in script.md.'}` });
    }
    if (v && v.duration > 40) issues.push({ level: 'hint', scene: sc.id, t: null, message: `the narration runs ${v.duration.toFixed(0)}s; long scenes are easier to follow when split` });
  }
  const pageIssues = await withEngine(project, timeline, { scale: 0.5, log }, (page) => page.evaluate(([s, w]) => window.explainroo.check(s, w), [step, viewWidth]));
  issues.push(...pageIssues);
  const order = { error: 0, warn: 1, hint: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { issues, duration: timeline.duration, scenes: timeline.scenes.length };
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

export async function sheet(project, { scene = null, every = null, cols = null, log = () => {} } = {}) {
  const { timeline } = await prepare(project, { log });
  let times = [];
  let labels = [];
  const file = path.relative(project.dir, outputPath(project, scene ? `sheet-${scene}` : 'sheet', '.jpg')).split(path.sep).join('/');
  if (scene) {
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
  const c = cols ?? (times.length > 20 ? 6 : times.length > 9 ? 5 : 4);
  const thumb = timeline.width >= timeline.height ? 320 : 200;
  await withEngine(project, timeline, { scale: 0.5, log }, (page) => page.evaluate((o) => window.explainroo.sheet(o), { times, labels, cols: c, thumb, path: file }));
  return { file: path.join(project.dir, file), frames: times.length };
}

export async function verify(project, { file = null, log = () => {} } = {}) {
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
  if (loud && loud.truePeak !== null && loud.truePeak > -0.5) issues.push({ level: 'warn', message: `true peak ${loud.truePeak} dBFS is close to clipping` });

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
    const spokenWords = (sc) => sc.units.filter((u) => u.type === 'word').map((u) => ({ spoken: u.spoken }));
    const byId = new Map(project.script.scenes.map((sc) => [sc.id, sc]));
    const sameScenes = timeline && timeline.scenes.length === project.script.scenes.length && timeline.scenes.every((t) => byId.has(t.id)) && Math.abs(timeline.duration - duration) < 1;
    if (sameScenes) {
      const texts = [];
      const scenes = [];
      let total = 0;
      let matched = 0;
      for (const t of timeline.scenes) {
        const words = spokenWords(byId.get(t.id));
        if (!words.length) continue;
        const from = Math.max(0, Math.floor(t.start * 16000));
        const to = Math.min(samples.length, Math.ceil((t.start + t.dur) * 16000));
        const heard = await transcribeWords(samples.subarray(from, to), { log, language: project.config.language });
        texts.push(heard.text);
        const rate = alignWords(words, heard.words, t.dur, project.config.language).matchRate;
        scenes.push({ id: t.id, matchRate: Math.round(rate * 1000) / 1000 });
        total += words.length;
        matched += rate * words.length;
        if (rate < 0.8) issues.push({ level: 'warn', message: `scene "${t.id}": only ${Math.round(rate * 100)}% of the narration was understood in the final mix; it heard "${heard.text.slice(0, 120)}"` });
      }
      const rate = total ? matched / total : 1;
      speech = { matchRate: Math.round(rate * 1000) / 1000, transcript: texts.join(' '), scenes };
    } else {
      const heard = await transcribeWords(samples, { log, language: project.config.language });
      const script = project.script.scenes.flatMap(spokenWords);
      speech = { matchRate: Math.round(alignWords(script, heard.words, duration, project.config.language).matchRate * 1000) / 1000, transcript: heard.text };
    }
    if (speech.matchRate < 0.85) issues.push({ level: 'warn', message: `only ${Math.round(speech.matchRate * 100)}% of the script was understood in the final mix; lower music.volume or check pronunciation` });
    fs.rmSync(wav, { force: true });
  }
  const report = {
    file: video,
    duration: Math.round(duration * 100) / 100,
    video: v ? { width: v.width, height: v.height, fps: v.r_frame_rate, codec: v.codec_name } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
    loudness: loud,
    blackSegments: blacks,
    silences,
    speech,
    issues,
  };
  fs.mkdirSync(project.paths.out, { recursive: true });
  fs.writeFileSync(path.join(project.paths.out, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
