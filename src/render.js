// Renders video or GIF: frames in parallel pages, encode, mux and extra files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outdatedLine, outdatedRenders, prepare, renderIdentity, scriptStamp, withEngine, VERSION } from './pipeline.js';
import { projectUrl, roughTime } from './timeline.js';
import { AUDIO_CODECS, finishMix, frameEncoder, ffmpeg } from './ffmpeg.js';
import { subtitleCues, toSrt, toVtt } from './subtitles.js';
import { buildChapters, toChaptersText, toChapterMetadata } from './chapters.js';
import { resolveTimes } from './qa.js';
import { outputPath, scriptName, TALL_FORMATS } from './project.js';
import { newDefaults } from '../engine/util.js';
import { recordVersion, relativeFile, sha256File, versionLines } from './history.js';
import { cacheRoot } from './models.js';

export function renderFormat({ format = 'mp4', out, transparent = false } = {}) {
  if (!['mp4', 'gif', 'webm', 'mov'].includes(format)) throw new Error('--format must be mp4, gif, webm or mov');
  if (transparent && !['webm', 'mov'].includes(format)) throw new Error('--transparent needs --format webm or --format mov');
  if (out && path.extname(out).toLowerCase() !== `.${format}`) throw new Error(`--out must end in .${format} for --format ${format}`);
  return format;
}

export function renderOutput(project, opts = {}) {
  const format = renderFormat(opts);
  return outputPath(project, opts.draft ? 'draft' : 'video', `.${format}`, opts.out);
}

export async function render(project, opts = {}) {
  const log = opts.log || (() => {});
  // A bad flag stops here, before anything is built.
  const out = renderOutput(project, opts);
  const t0 = Date.now();
  const { timeline } = await prepare(project, { log });
  const prepared = (Date.now() - t0) / 1000;
  const { from, to, partial } = frameRange(project, timeline, opts);
  // A cover at a scene that isn't there, or a caption word that is too long, stops
  // the render here, before any frame is drawn.
  const plan = planExtras(project, timeline, { range: { from: from / project.config.fps, to: to / project.config.fps }, full: !partial });
  // The finished video at `out` is this exact video and only the cover changed:
  // it stays, and only the files next to it are written, as package does.
  const kept = partial ? null : coverOnly(project, timeline, out, opts);
  if (kept) {
    const files = await step('writing the subtitles, chapters and cover', log, () => writeExtras(project, timeline, out.slice(0, -path.extname(out).length), { plan, log }));
    recordVersion(project.dir, { ...kept, time: new Date().toISOString(), cover: project.config.cover, kept: true });
    const made = files.coverMade;
    log(`${path.relative(process.cwd(), out) || out} is still this exact video and only "cover" changed, so the video stays. Cover: ${made.how === 'unchanged' ? `unchanged, from ${made.at}` : `${made.how} from ${made.at}`}`);
    const secs = (Date.now() - t0) / 1000;
    return { out, ...files, kept: true, cover_made: made, duration: kept.duration, frames: Math.round(kept.duration * project.config.fps), seconds: secs, width: kept.width, height: kept.height, sha256: kept.sha256, identity: kept.identity };
  }
  const video = await encodeVideo(project, timeline, { ...opts, out, log });
  const files = await step('writing the subtitles, chapters and cover', log, () => writeExtras(project, timeline, video.out.slice(0, -path.extname(video.out).length), { plan, log }));
  recordVersion(project.dir, versionLine(project, video));
  const secs = (Date.now() - t0) / 1000;
  // Where the time went: the narration and the pages before the first frame,
  // the frames, and the sound, the file and the cover after the last one.
  const { ready, frames } = video.timing;
  const after = Math.max(0, secs - prepared - ready - frames);
  log(`wrote ${path.relative(process.cwd(), video.out) || video.out} in ${secs.toFixed(1)}s: ${(prepared + ready).toFixed(1)}s before the first frame, ${frames.toFixed(1)}s of frames and ${after.toFixed(1)}s after them`);
  // Another size that says an older script is out of date now. It is only named, never rendered here.
  const outdated = outdatedRenders(project);
  for (const r of outdated) log(outdatedLine(r));
  return { out: video.out, ...files, duration: video.duration, frames: video.frames, seconds: secs, timing: { before_frames: Math.round((prepared + ready) * 10) / 10, frames: Math.round(frames * 10) / 10, after_frames: Math.round(after * 10) / 10 }, estimated_seconds: video.estimated_seconds, width: video.width, height: video.height, sha256: video.sha256, identity: video.identity, ...(outdated.length ? { outdated } : {}) };
}

// The newest line of the record for the video at `out`, when that file is still
// the video this run would draw, with the same kind of render, and the record
// has another cover setting than now. Older lines without the cover never match.
function coverOnly(project, timeline, out, opts) {
  const file = relativeFile(project.dir, out);
  const line = versionLines(project.dir).filter((l) => l.file === file && !l.event).at(-1);
  if (!line || !Object.hasOwn(line, 'cover') || JSON.stringify(line.cover) === JSON.stringify(project.config.cover)) return null;
  const format = renderFormat(opts);
  const draft = !!opts.draft;
  const same = line.format === format && line.draft === draft && line.transparent === !!opts.transparent && line.full === true
    && line.scale === (opts.scale ?? (draft ? 0.5 : 1)) && line.size === project.config.size && line.watermark === (project.config.watermark !== false)
    && line.identity === renderIdentity(project, timeline);
  return same && fs.existsSync(out) && sha256File(out) === line.sha256 ? line : null;
}

// The frames that --from and --to ask for.
function frameRange(project, timeline, opts) {
  const fps = project.config.fps;
  const total = timeline.frames;
  const from = Math.max(0, Math.floor((opts.from ?? 0) * fps));
  const to = Math.min(total, opts.to !== undefined ? Math.ceil(opts.to * fps) : total);
  if (to <= from) throw new Error('nothing to render: --from must be before --to');
  return { from, to, partial: from > 0 || to < total };
}

// How fast final renders run on this computer, kept in the cache folder. Each kind
// of render has its own speed: the samples per frame for motion blur, alpha and
// the number of pages. A render of fewer frames than this says little about it.
const SPEED_FRAMES = 90;
export const renderSpeedFile = () => path.join(cacheRoot(), 'render-speed.json');

export function renderKind({ samples, transparent, workers }) {
  return `${samples} sample${samples === 1 ? '' : 's'}${transparent ? ', alpha' : ''}, ${workers} worker${workers === 1 ? '' : 's'}`;
}

function readSpeeds() {
  try {
    const kept = JSON.parse(fs.readFileSync(renderSpeedFile(), 'utf8'));
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch {
    return {};
  }
}

// A cache folder that can't be written only means no estimate next time.
function keepSpeed(kind, measured) {
  const file = renderSpeedFile();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ ...readSpeeds(), [kind]: measured }, null, 2) + '\n');
    fs.renameSync(temp, file);
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

// The time a render of `frames` frames of `pixels` pixels takes, from the last
// measured speed of the same kind of render. The speed scales with the pixels of a
// frame, so a tall video after a wide one of the same size gets the same speed.
export function renderEstimate(measured, { frames, pixels }) {
  if (!(measured?.frames_per_second > 0 && measured.pixels > 0 && pixels > 0)) return null;
  const rate = measured.frames_per_second * measured.pixels / pixels;
  return { seconds: frames / rate, frames_per_second: rate, frames };
}

// "about 1 min 40 s: 1,240 frames at about 14 a second here"
export function estimateText({ seconds, frames, frames_per_second: rate }) {
  const time = roughTime(seconds);
  const speed = rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10;
  return `about ${time}: ${frames.toLocaleString('en-US')} frames at about ${speed} a second here`;
}

// Runs one step of a render, and says which step it is once it has taken 2
// seconds, so a long wait after the frames never goes quiet.
export async function step(name, log, fn) {
  const timer = setTimeout(() => log(`${name}…`), 2000);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
  }
}

// Draws the frames and writes the video file at `out`, without the files that go
// next to it.
export async function encodeVideo(project, timeline, opts) {
  const log = opts.log || (() => {});
  const format = renderFormat(opts);
  const identity = renderIdentity(project, timeline);
  const draft = !!opts.draft;
  const transparent = !!opts.transparent;
  const segmentFormat = format === 'gif' ? 'mp4' : format;
  const scale = opts.scale ?? (draft ? 0.5 : 1);
  const fps = project.config.fps;
  const { from, to, partial } = frameRange(project, timeline, opts);
  const out = opts.out;
  const chapters = partial ? [] : buildChapters(timeline, project.script.title || project.config.title);
  const workers = Math.max(1, Math.min(opts.workers ?? Math.min(8, Math.max(1, Math.floor(os.cpus().length / 2))), to - from));
  const quality = draft ? 0.82 : 0.93;
  // Final renders get motion blur. Drafts, GIFs and transparent videos skip it,
  // and so does "motionBlur": false, which --quality fast sets for one run.
  const samples = draft || format === 'gif' || transparent || project.config.motionBlur === false ? 1 : 6;
  const segDir = path.join(project.paths.build, 'segments');
  fs.rmSync(segDir, { recursive: true, force: true });
  fs.mkdirSync(segDir, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // The size of the file: frames have even sides for H.264, and a GIF is scaled
  // down to 960 pixels on its long side.
  let width = 2 * Math.round(project.config.width * scale / 2);
  let height = 2 * Math.round(project.config.height * scale / 2);
  if (format === 'gif') {
    const ratio = Math.min(1, 960 / Math.max(width, height));
    width = Math.max(2, 2 * Math.floor(width * ratio / 2));
    height = Math.max(2, 2 * Math.floor(height * ratio / 2));
  }
  log(`rendering ${((to - from) / fps).toFixed(1)}s (${to - from} frames at ${fps} fps) to a ${width}x${height} ${format === 'gif' ? 'GIF' : 'video'} with ${workers} worker${workers > 1 ? 's' : ''}`);
  // `withoutBlur` says how the caller leaves the blur out.
  if (samples > 1) log(`motion blur: a final draws ${samples} samples per frame, which makes it several times slower than a draft. ${opts.withoutBlur ?? '--quality fast'} leaves the blur out.`);
  // A final says up front how long it takes, once this computer has made one.
  const kind = renderKind({ samples, transparent, workers });
  const pixels = Math.round(project.config.width * scale) * Math.round(project.config.height * scale);
  const estimate = draft ? null : renderEstimate(readSpeeds()[kind], { frames: to - from, pixels });
  if (estimate) log(`this takes ${estimateText(estimate)}`);
  const started = Date.now();

  const mix = path.join(project.paths.build, 'mix.wav');
  const mixNorm = path.join(project.paths.build, 'mix-norm.wav');
  const encoders = [];
  // How long the pages took to start, the frames and the steps after them.
  const timing = { ready: 0, frames: 0 };
  const starting = setTimeout(() => log(`starting ${workers} browser page${workers > 1 ? 's' : ''}…`), 2000);
  starting.unref?.();
  try {
    await withEngine(project, timeline, { scale, pages: workers, transparent, log }, async (pages) => {
      clearTimeout(starting);
      const list = Array.isArray(pages) ? pages : [pages];
      let norm;
      if (format !== 'gif') {
        const ta = Date.now();
        const sound = await list[0].evaluate((p) => window.explainroo.soundtrack(p), projectUrl(project, mix));
        log(`soundtrack: ${sound.cues} sound cues, mixed in ${((Date.now() - ta) / 1000).toFixed(1)}s`);
        norm = finishMix(mix, mixNorm, project.config.loudness, AUDIO_CODECS[format], { log });
        norm.catch(() => {});
      }

      const per = Math.ceil((to - from) / list.length);
      let done = 0;
      let lastLog = Date.now();
      const tf = Date.now();
      timing.ready = (tf - started) / 1000;
      await Promise.all(list.map(async (page, k) => {
        const a = from + k * per;
        const b = Math.min(to, a + per);
        if (a >= b) return;
        const enc = frameEncoder({ fps, out: path.join(segDir, `seg-${String(k).padStart(2, '0')}.${segmentFormat}`), draft, format: segmentFormat, transparent });
        encoders.push(enc);
        const batch = 6;
        for (let f = a; f < b; f += batch) {
          const frames = [];
          for (let i = f; i < Math.min(b, f + batch); i++) frames.push(i);
          const jpegs = await page.evaluate(([l, q, n]) => window.explainroo.frames(l, q, n), [frames, quality, samples]);
          for (const j of jpegs) await enc.write(Buffer.from(j, 'base64'));
          done += frames.length;
          if (Date.now() - lastLog > 3000) {
            lastLog = Date.now();
            const rate = done / ((Date.now() - tf) / 1000);
            log(`frames ${done}/${to - from} (${rate.toFixed(1)} fps, about ${Math.ceil((to - from - done) / rate)}s left)`);
          }
        }
        await enc.close();
      }));
      timing.frames = (Date.now() - tf) / 1000;
      log(`frames done in ${timing.frames.toFixed(1)}s`);
      await step('finishing the sound', log, () => norm);
    });
  } catch (e) {
    for (const enc of encoders) enc.kill();
    throw e;
  } finally {
    clearTimeout(starting);
  }

  const segs = fs.readdirSync(segDir).filter((f) => f.endsWith(`.${segmentFormat}`)).sort();
  const listFile = path.join(segDir, 'list.txt');
  fs.writeFileSync(listFile, segs.map((s) => `file '${path.join(segDir, s).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const audioArgs = partial ? ['-ss', String(from / fps), '-t', String((to - from) / fps), '-i', mixNorm] : ['-i', mixNorm];
  const metadata = path.join(project.paths.build, 'chapters.ffmeta');
  if (chapters.length) fs.writeFileSync(metadata, toChapterMetadata(chapters));
  const metadataArgs = chapters.length ? ['-f', 'ffmetadata', '-i', metadata, '-map_metadata', '2', '-map_chapters', '2'] : [];
  if (format === 'gif') {
    const temp = path.join(project.paths.build, 'gif.mp4');
    const palette = path.join(project.paths.build, 'gif-palette.png');
    const filter = `fps=15,scale=${width}:${height}:flags=lanczos`;
    try {
      await step('making the GIF', log, async () => {
        await ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0:v', '-c:v', 'copy', '-an', temp]);
        await ffmpeg(['-loglevel', 'error', '-i', temp, '-vf', `${filter},palettegen=stats_mode=diff`, '-frames:v', '1', '-threads', '1', palette]);
        await ffmpeg(['-loglevel', 'error', '-i', temp, '-i', palette, '-lavfi', `${filter}[v];[v][1:v]paletteuse=dither=sierra2_4a`, '-an', out]);
      });
    } finally {
      fs.rmSync(temp, { force: true });
      fs.rmSync(palette, { force: true });
    }
  } else {
    const audioCodec = AUDIO_CODECS[format];
    const containerArgs = format === 'webm' ? [] : ['-movflags', '+faststart'];
    await step('joining the frames and the sound', log, () => ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, ...audioArgs, ...metadataArgs, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioCodec, ...containerArgs, '-shortest', out]));
  }
  fs.rmSync(segDir, { recursive: true, force: true });
  const seconds = (Date.now() - started) / 1000;
  if (!draft && to - from >= SPEED_FRAMES && seconds > 0) keepSpeed(kind, { frames_per_second: Math.round((to - from) / seconds * 100) / 100, pixels, frames: to - from, seconds: Math.round(seconds * 10) / 10, measured: new Date().toISOString() });
  return {
    out,
    format,
    draft,
    transparent,
    scale,
    range: { from: from / fps, to: to / fps },
    full: !partial,
    width,
    height,
    fps: format === 'gif' ? 15 : fps,
    duration: (to - from) / fps,
    frames: to - from,
    motionBlur: samples > 1,
    sha256: sha256File(out),
    identity,
    estimated_seconds: estimate ? Math.round(estimate.seconds) : null,
    timing,
  };
}

// The line in the project record for a finished video.
export function versionLine(project, video) {
  return {
    time: new Date().toISOString(),
    file: relativeFile(project.dir, video.out),
    format: video.format,
    draft: video.draft,
    transparent: video.transparent,
    scale: video.scale,
    range: video.range,
    full: video.full,
    width: video.width,
    height: video.height,
    fps: video.fps,
    size: project.config.size,
    // The language and what its script said, so a render of another size can tell when they differ.
    lang: project.language,
    script: scriptStamp(project),
    watermark: project.config.watermark !== false,
    // Whether the frames have motion blur. A final with --quality fast has none.
    motionBlur: video.motionBlur,
    // The cover setting it was made with, so a later change of only the cover keeps the video.
    cover: project.config.cover,
    duration: video.duration,
    sha256: video.sha256,
    version: VERSION,
    identity: video.identity,
  };
}

// The moment of the cover, as a still spec, or "auto" for a time the page works
// out. With "defaults": "0.5", "auto" is the fullest frame of the first scene,
// a frame with a picture first, the earliest of those, at every size. Before,
// "auto" was the end of the first scene, and 1.0 second into it for Shorts,
// TikTok and Reels, which open on a hook title that may leave before its end.
export function coverSpec(config, timeline) {
  if (config.cover !== 'auto' || newDefaults(config)) return config.cover;
  return `${timeline.scenes[0].id}@${TALL_FORMATS.includes(config.format) ? '1.0' : 'end'}`;
}

// The time of the cover as resolveTimes gives it, or { auto: true, T: null }
// for a time the page works out. A cover that "auto" picked says so.
export function coverTime(config, timeline) {
  const spec = coverSpec(config, timeline);
  if (spec === 'auto') return { auto: true, T: null, label: 'auto' };
  const [time] = resolveTimes(timeline, [spec]);
  return config.cover === 'auto' ? { ...time, auto: true } : time;
}

// What goes next to a video: its caption cues, its chapters and the time of its
// cover. Only a full video gets chapters and a cover, and `chapters: false` leaves
// out the chapter list. Work it out before rendering, because a bad setting throws.
export function planExtras(project, timeline, { range = { from: 0, to: timeline.frames / timeline.fps }, full = true, chapters = true } = {}) {
  return {
    cues: subtitleCues(timeline, { ...range, script: scriptName(project) }),
    chapters: full && chapters ? buildChapters(timeline, project.script.title || project.config.title) : [],
    coverTime: full ? coverTime(project.config, timeline) : null,
  };
}

// The files that go next to a video, named after `base`: subtitles when there is
// narration, chapters when scenes name them, and the cover. A file that no longer
// applies goes, so nothing old stays next to a new video. `plan` comes from
// planExtras, and without it the other options make one.
export async function writeExtras(project, timeline, base, { plan, log = () => {}, ...options } = {}) {
  const { cues, chapters, coverTime } = plan ?? planExtras(project, timeline, options);
  const files = { subtitles: null, chapters: null, cover: null };
  if (timeline.scenes.some((s) => s.words.length)) {
    files.subtitles = { srt: `${base}.srt`, vtt: `${base}.vtt` };
    fs.writeFileSync(files.subtitles.srt, toSrt(cues));
    fs.writeFileSync(files.subtitles.vtt, toVtt(cues));
  } else {
    for (const ext of ['srt', 'vtt']) fs.rmSync(`${base}.${ext}`, { force: true });
  }
  if (chapters.length) {
    files.chapters = `${base}.chapters.txt`;
    fs.writeFileSync(files.chapters, toChaptersText(chapters));
  } else fs.rmSync(`${base}.chapters.txt`, { force: true });
  if (coverTime) {
    const temp = path.join(project.paths.build, 'cover.jpg');
    try {
      const T = await withEngine(project, timeline, { scale: 1, log }, (page) => page.evaluate(async ([set, file]) => {
        const at = set ?? window.explainroo.coverMoment();
        await window.explainroo.stills([{ T: at, path: file }], { type: 'image/jpeg', quality: 0.9, captions: false });
        return at;
      }, [coverTime.T, projectUrl(project, temp)]));
      files.cover = `${base}.cover.jpg`;
      // Whether the cover image is new, made again or the same as before, and its moment.
      const before = fs.existsSync(files.cover) ? fs.readFileSync(files.cover) : null;
      const how = !before ? 'made' : before.equals(fs.readFileSync(temp)) ? 'unchanged' : 'made again';
      fs.copyFileSync(temp, files.cover);
      Object.defineProperty(files, 'coverMade', { value: { how, at: momentLabel(timeline, T) }, enumerable: false });
    } finally { fs.rmSync(temp, { force: true }); }
  } else fs.rmSync(`${base}.cover.jpg`, { force: true });
  return files;
}

// A time of the video as a moment of a scene, like "hook@5.2".
export function momentLabel(timeline, T) {
  const sc = [...timeline.scenes].reverse().find((s) => T >= s.start - 1e-6) ?? timeline.scenes[0];
  return `${sc.id}@${Math.max(0, T - sc.start).toFixed(1)}`;
}
