// still and sheet for any video file, like a cut of your own recording. There
// are no scenes, so times are seconds, and the frames come from the file itself.
// Stills go to <name>.stills/ next to the video, and a sheet to <name>.sheet.jpg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, probe } from './ffmpeg.js';
import { launch } from './browser.js';
import { ProjectError } from './project.js';

// The size and length of a video's picture.
async function pictureInfo(file) {
  const info = await probe(file).catch(() => {
    throw new ProjectError(`${file} is not a video that ffmpeg can read`);
  });
  const v = info.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new ProjectError(`${path.basename(file)} has no picture to look at`);
  const [n, d] = String(v.avg_frame_rate ?? '').split('/').map(Number);
  const fps = d ? n / d : 30;
  return { width: v.width, height: v.height, duration: Number(info.format.duration) || Number(v.duration), fps: fps > 0 && fps <= 240 ? fps : 30 };
}

// Times in seconds, kept inside the video.
export function videoTimes(specs, duration, fps, name) {
  return specs.map((spec) => {
    if (typeof spec !== 'number' && !/^\d+(\.\d+)?$/.test(spec)) throw new ProjectError(`"${spec}" isn't a time in seconds. ${name} is a video file without scenes, so give times in seconds, like 3 or 12.5.`);
    // The last frame starts a frame before the end, and a time read past its
    // start finds none.
    const T = Math.min(Number(spec), Math.max(0, duration - 1.5 / fps));
    return { T, label: `t${T.toFixed(2)}` };
  });
}

// One frame at T seconds as a PNG, `width` pixels wide or the video's own size.
async function grab(file, T, out, width = null) {
  const scale = width ? ['-vf', `scale=${width}:-2`] : [];
  await ffmpeg(['-loglevel', 'error', '-ss', T.toFixed(3), '-i', file, '-frames:v', '1', ...scale, '-y', out]);
  // A file whose picture ends before its sound has its last frame earlier.
  if (!fs.existsSync(out)) await ffmpeg(['-loglevel', 'error', '-sseof', '-1', '-i', file, '-update', '1', ...scale, '-y', out]);
  if (!fs.existsSync(out)) throw new ProjectError(`ffmpeg found no frame at ${T.toFixed(2)} s in ${path.basename(file)}`);
}

const base = (file) => file.slice(0, file.length - path.extname(file).length);

// still <video> <times>: a PNG of each moment, or of the start, the middle and
// the end without times.
export async function videoStills(file, specs, { log = () => {} } = {}) {
  const video = path.resolve(file);
  const { duration, fps } = await pictureInfo(video);
  const name = path.basename(video);
  const list = videoTimes(specs.length ? specs : [0, duration / 2, duration].map((t) => Math.round(t * 100) / 100), duration, fps, name);
  const dir = `${base(video)}.stills`;
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const x of list) {
    const target = path.join(dir, `${x.label}.png`);
    log(`still at ${x.T.toFixed(2)} s`);
    await grab(video, x.T, target);
    out.push({ time: Math.round(x.T * 100) / 100, label: x.label, file: target });
  }
  return out;
}

// sheet <video>: frames of the whole video in one picture, each with its time.
// `every` sets the seconds between them, and `times` picks the moments.
export async function videoSheet(file, { every = null, times: moments = null, cols = null, large = false, log = () => {} } = {}) {
  if (moments && every !== null && every !== undefined) throw new ProjectError('--times picks the moments itself, so it can\'t go with --every. Leave out one of them.');
  const video = path.resolve(file);
  const { width, height, duration, fps } = await pictureInfo(video);
  const name = path.basename(video);
  let list;
  if (moments) list = videoTimes(moments, duration, fps, name);
  else {
    const step = every ?? Math.max(0.5, Math.min(3, duration / 30));
    if (!(step > 0)) throw new ProjectError('--every needs seconds, like --every 2');
    list = [];
    for (let T = 0; T < duration; T += step) list.push({ T, label: `${T.toFixed(1)}s` });
  }
  const c = cols ?? Math.min(list.length, large ? 3 : list.length > 20 ? 6 : list.length > 9 ? 5 : 4);
  const thumb = large ? 640 : width >= height ? 320 : 200;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sheet-'));
  const target = `${base(video)}.${moments ? 'sheet-times' : 'sheet'}.jpg`;
  let browser = null;
  try {
    log(`reading ${list.length} frames of ${name}`);
    const frames = [];
    for (const [i, x] of list.entries()) {
      const png = path.join(dir, `${i}.png`);
      await grab(video, x.T, png, thumb);
      frames.push(`data:image/png;base64,${fs.readFileSync(png).toString('base64')}`);
    }
    browser = await launch();
    const page = await browser.newPage();
    // The same layout as the sheet of a project: dark, with the time under each frame.
    const jpeg = await page.evaluate(async ({ frames, labels, cols, tw, th }) => {
      const images = await Promise.all(frames.map((src) => new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = fail;
        img.src = src;
      })));
      const labelH = 30;
      const rows = Math.ceil(images.length / cols);
      const sheet = document.createElement('canvas');
      sheet.width = cols * (tw + 8) + 8;
      sheet.height = rows * (th + labelH + 8) + 8;
      const g = sheet.getContext('2d');
      g.fillStyle = '#16181d';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.textBaseline = 'middle';
      images.forEach((img, i) => {
        const x = 8 + (i % cols) * (tw + 8);
        const y = 8 + Math.floor(i / cols) * (th + labelH + 8);
        g.drawImage(img, x, y, tw, th);
        g.font = '600 17px sans-serif';
        g.fillStyle = '#e6e9ef';
        g.fillText(labels[i], x + 4, y + th + 15);
      });
      return sheet.toDataURL('image/jpeg', 0.88).slice(23);
    }, { frames, labels: list.map((x) => x.label), cols: c, tw: thumb, th: Math.round((thumb * height) / width) });
    fs.writeFileSync(target, Buffer.from(jpeg, 'base64'));
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { file: target, frames: list.length, ...(moments ? { times: list.map((x) => ({ time: Math.round(x.T * 100) / 100, label: x.label })) } : {}), marked: [] };
}
