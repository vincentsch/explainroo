// Renders video or GIF: frames in parallel pages, encode, mux and extra files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepare, renderIdentity, withEngine, VERSION } from './pipeline.js';
import { frameEncoder, ffmpeg, normalizeLoudness } from './ffmpeg.js';
import { subtitleCues, toSrt, toVtt } from './subtitles.js';
import { buildChapters, toChaptersText, toChapterMetadata } from './chapters.js';
import { resolveTimes } from './qa.js';
import { outputPath } from './project.js';
import { recordVersion, relativeFile, sha256File } from './history.js';

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
  const { from, to, partial } = frameRange(project, timeline, opts);
  // A cover at a scene that isn't there, or a caption word that is too long, stops
  // the render here, before any frame is drawn.
  const plan = planExtras(project, timeline, { range: { from: from / project.config.fps, to: to / project.config.fps }, full: !partial });
  const video = await encodeVideo(project, timeline, { ...opts, out, log });
  const files = await writeExtras(project, timeline, video.out.slice(0, -path.extname(video.out).length), { plan, log });
  recordVersion(project.dir, versionLine(project, video));
  const secs = (Date.now() - t0) / 1000;
  log(`wrote ${path.relative(process.cwd(), video.out) || video.out} in ${secs.toFixed(1)}s`);
  return { out: video.out, ...files, duration: video.duration, frames: video.frames, seconds: secs, width: video.width, height: video.height, sha256: video.sha256, identity: video.identity };
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
  // Final renders get motion blur. Drafts, GIFs and transparent videos skip it.
  const samples = draft || format === 'gif' || transparent || project.config.motionBlur === false ? 1 : 6;
  const segDir = path.join(project.paths.build, 'segments');
  fs.rmSync(segDir, { recursive: true, force: true });
  fs.mkdirSync(segDir, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  log(`rendering ${((to - from) / fps).toFixed(1)}s (${to - from} frames at ${fps} fps, ${Math.round(project.config.width * scale)}x${Math.round(project.config.height * scale)}) with ${workers} worker${workers > 1 ? 's' : ''}`);

  const mix = path.join(project.paths.build, 'mix.wav');
  const mixNorm = path.join(project.paths.build, 'mix-norm.wav');
  const encoders = [];
  try {
    await withEngine(project, timeline, { scale, pages: workers, transparent, log }, async (pages) => {
      const list = Array.isArray(pages) ? pages : [pages];
      let norm;
      if (format !== 'gif') {
        const ta = Date.now();
        const sound = await list[0].evaluate((p) => window.explainroo.soundtrack(p), 'build/mix.wav');
        log(`soundtrack: ${sound.cues} sound cues, mixed in ${((Date.now() - ta) / 1000).toFixed(1)}s`);
        norm = normalizeLoudness(mix, mixNorm, project.config.loudness);
        norm.catch(() => {});
      }

      const per = Math.ceil((to - from) / list.length);
      let done = 0;
      let lastLog = Date.now();
      const tf = Date.now();
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
      log(`frames done in ${((Date.now() - tf) / 1000).toFixed(1)}s`);
      await norm;
    });
  } catch (e) {
    for (const enc of encoders) enc.kill();
    throw e;
  }

  const segs = fs.readdirSync(segDir).filter((f) => f.endsWith(`.${segmentFormat}`)).sort();
  const listFile = path.join(segDir, 'list.txt');
  fs.writeFileSync(listFile, segs.map((s) => `file '${path.join(segDir, s).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const audioArgs = partial ? ['-ss', String(from / fps), '-t', String((to - from) / fps), '-i', mixNorm] : ['-i', mixNorm];
  const metadata = path.join(project.paths.build, 'chapters.ffmeta');
  if (chapters.length) fs.writeFileSync(metadata, toChapterMetadata(chapters));
  const metadataArgs = chapters.length ? ['-f', 'ffmetadata', '-i', metadata, '-map_metadata', '2', '-map_chapters', '2'] : [];
  let width = 2 * Math.round(project.config.width * scale / 2);
  let height = 2 * Math.round(project.config.height * scale / 2);
  if (format === 'gif') {
    const temp = path.join(project.paths.build, 'gif.mp4');
    const palette = path.join(project.paths.build, 'gif-palette.png');
    const ratio = Math.min(1, 960 / Math.max(width, height));
    width = Math.max(2, 2 * Math.floor(width * ratio / 2));
    height = Math.max(2, 2 * Math.floor(height * ratio / 2));
    const filter = `fps=15,scale=${width}:${height}:flags=lanczos`;
    try {
      await ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0:v', '-c:v', 'copy', '-an', temp]);
      await ffmpeg(['-loglevel', 'error', '-i', temp, '-vf', `${filter},palettegen=stats_mode=diff`, '-frames:v', '1', '-threads', '1', palette]);
      await ffmpeg(['-loglevel', 'error', '-i', temp, '-i', palette, '-lavfi', `${filter}[v];[v][1:v]paletteuse=dither=sierra2_4a`, '-an', out]);
    } finally {
      fs.rmSync(temp, { force: true });
      fs.rmSync(palette, { force: true });
    }
  } else {
    const audioCodec = format === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k']
      : format === 'mov' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
    const containerArgs = format === 'webm' ? [] : ['-movflags', '+faststart'];
    await ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, ...audioArgs, ...metadataArgs, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioCodec, ...containerArgs, '-shortest', out]);
  }
  fs.rmSync(segDir, { recursive: true, force: true });
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
    sha256: sha256File(out),
    identity,
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
    watermark: project.config.watermark !== false,
    duration: video.duration,
    sha256: video.sha256,
    version: VERSION,
    identity: video.identity,
  };
}

// What goes next to a video: its caption cues, its chapters and the time of its
// cover. Only a full video gets chapters and a cover, and `chapters: false` leaves
// out the chapter list. Work it out before rendering, because a bad setting throws.
export function planExtras(project, timeline, { range = { from: 0, to: timeline.frames / timeline.fps }, full = true, chapters = true } = {}) {
  return {
    cues: subtitleCues(timeline, range),
    chapters: full && chapters ? buildChapters(timeline, project.script.title || project.config.title) : [],
    coverTime: full ? resolveTimes(timeline, [project.config.cover === 'auto' ? `${timeline.scenes[0].id}@end` : project.config.cover])[0] : null,
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
      await withEngine(project, timeline, { scale: 1, log }, (page) => page.evaluate((T) => window.explainroo.stills([{ T, path: 'build/cover.jpg' }], { type: 'image/jpeg', quality: 0.9, captions: false }), coverTime.T));
      files.cover = `${base}.cover.jpg`;
      fs.copyFileSync(temp, files.cover);
    } finally { fs.rmSync(temp, { force: true }); }
  } else fs.rmSync(`${base}.cover.jpg`, { force: true });
  return files;
}
