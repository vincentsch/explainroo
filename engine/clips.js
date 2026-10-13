export const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i;

export function clipFrame(info, t, { at = 0, from = 0, speed = 1, loop = false } = {}) {
  if (t < at) return null;
  let time = from + (t - at) * speed;
  if (loop) time = ((time % info.duration) + info.duration) % info.duration;
  return Math.max(0, Math.min(info.frames - 1, Math.floor(time * info.fps + 1e-8)));
}

export function clipURL(kind, src, frame) {
  return `/__clip/${kind}?path=${encodeURIComponent(src)}${frame === undefined ? '' : '&frame=' + frame}`;
}

export async function loadClips(assets, state = null) {
  const clips = new Map();
  await Promise.all(assets.filter((a) => VIDEO_FILE.test(a)).map(async (src) => {
    if (state) {
      const video = document.createElement('video');
      video.hidden = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = './project/' + src.split('/').map(encodeURIComponent).join('/');
      document.body.append(video);
      const loaded = () => new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error(`clip "${src}" could not be loaded. Use a browser-supported video format.`));
      });
      await loaded();
      // Servers without byte ranges cannot seek a media URL in Chrome.
      if (!video.seekable.length || video.seekable.end(video.seekable.length - 1) < video.duration - 0.1) {
        const res = await fetch(video.src);
        if (!res.ok) throw new Error(`clip "${src}" could not be loaded`);
        video.src = URL.createObjectURL(await res.blob());
        await loaded();
      }
      clips.set(src, { src, video, duration: video.duration, width: video.videoWidth, height: video.videoHeight, fps: state.config.fps, frames: Math.max(1, Math.ceil(video.duration * state.config.fps)) });
      return;
    }
    const res = await fetch(clipURL('info', src));
    if (!res.ok) throw new Error(`clip "${src}" could not be loaded. Put a video in the project's assets/ folder.`);
    clips.set(src, { src, ...await res.json() });
  }));
  return clips;
}

export class ClipFrames {
  constructor() {
    this.frames = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.closed = false;
  }

  key(clip, frame) { return `${clip.src}|${frame}`; }

  async load(clip, frame) {
    const key = this.key(clip, frame);
    if (this.frames.has(key)) return;
    if (!this.pending.has(key)) {
      const job = (async () => {
        const res = await fetch(clipURL('frame', clip.src, frame));
        if (!res.ok) throw new Error(`clip "${clip.src}" frame ${frame} could not be loaded`);
        const bitmap = await createImageBitmap(await res.blob());
        if (this.closed) { bitmap.close(); return; }
        this.frames.set(key, { clip, frame, bitmap });
      })();
      this.pending.set(key, job);
      job.finally(() => this.pending.delete(key)).catch(() => {});
    }
    return this.pending.get(key);
  }

  get(clip, frame) {
    const key = this.key(clip, frame);
    const entry = this.frames.get(key);
    if (entry) {
      this.frames.delete(key);
      this.frames.set(key, entry);
      return entry.bitmap;
    }
    return null;
  }

  nearest(clip, frame) {
    let best;
    for (const entry of this.frames.values()) {
      if (entry.clip.src === clip.src && (!best || Math.abs(entry.frame - frame) < Math.abs(best.frame - frame))) best = entry;
    }
    return best?.bitmap;
  }

  trim(keep = new Set()) {
    for (const [key, entry] of this.frames) {
      if (this.frames.size <= Math.max(24, keep.size)) break;
      if (keep.has(key)) continue;
      entry.bitmap.close();
      this.frames.delete(key);
    }
  }

  close() {
    this.closed = true;
    for (const entry of this.frames.values()) entry.bitmap.close();
    this.frames.clear();
  }
}
