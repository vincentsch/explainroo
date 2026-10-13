// ffmpeg and ffprobe helpers.
import { spawn, spawnSync } from 'node:child_process';

export function ffmpegPath() {
  return process.env.EXPLAINROO_FFMPEG || 'ffmpeg';
}

export function ffprobePath() {
  return process.env.EXPLAINROO_FFPROBE || 'ffprobe';
}

export function ffmpegVersion() {
  const r = spawnSync(ffmpegPath(), ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split('\n')[0];
}

export function run(bin, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`${bin} could not start: ${e.message}. Install ffmpeg or set EXPLAINROO_FFMPEG.`)));
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${bin} ${args.slice(0, 6).join(' ')} ... failed (${code}):\n${err.split('\n').slice(-12).join('\n')}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

export function ffmpeg(args, opts) {
  return run(ffmpegPath(), ['-hide_banner', '-y', ...args], opts);
}

// A long-running encoder fed with JPEG frames on stdin.
export function frameEncoder({ fps, out, draft }) {
  const args = [
    '-hide_banner', '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '24' : '17',
    '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2),
    out,
  ];
  const p = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((resolve, reject) => {
    p.on('error', (e) => reject(new Error(`ffmpeg could not start: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encoder failed (${code}): ${err.slice(-800)}`))));
  });
  done.catch(() => {});
  return {
    write(buf) {
      if (p.stdin.write(buf)) return Promise.resolve();
      return new Promise((r) => p.stdin.once('drain', r));
    },
    async close() {
      p.stdin.end();
      await done;
    },
    kill() {
      try { p.kill('SIGKILL'); } catch {}
    },
  };
}

// Two-pass loudness normalization to `target` LUFS, peak-limited.
export async function normalizeLoudness(input, output, target = -14, sampleRate = 48000) {
  const base = `I=${target}:TP=-1.5:LRA=11`;
  const pass1 = await ffmpeg(['-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']);
  const json = pass1.stderr.slice(pass1.stderr.lastIndexOf('{'), pass1.stderr.lastIndexOf('}') + 1);
  const m = JSON.parse(json);
  // Silence and very short clips have no measurable integrated loudness.
  if (!Number.isFinite(Number(m.input_i))) {
    await ffmpeg(['-i', input, '-ar', String(sampleRate), '-c:a', 'pcm_s16le', output]);
    return { inputI: Number(m.input_i), inputTP: Number(m.input_tp) };
  }
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  await ffmpeg(['-i', input, '-af', `loudnorm=${base}:${measured}:linear=true:print_format=summary`, '-ar', String(sampleRate), '-c:a', 'pcm_s16le', output]);
  return { inputI: Number(m.input_i), inputTP: Number(m.input_tp) };
}

export async function probe(file) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(stdout);
}

export async function loudness(file) {
  const { stderr } = await ffmpeg(['-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const I = /I:\s*(-?[\d.]+) LUFS/.exec(summary);
  const LRA = /LRA:\s*(-?[\d.]+) LU/.exec(summary);
  const peak = /Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(summary);
  return { integrated: I ? Number(I[1]) : null, range: LRA ? Number(LRA[1]) : null, truePeak: peak ? Number(peak[1]) : null };
}
