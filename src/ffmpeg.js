// ffmpeg and ffprobe helpers.
import fs from 'node:fs';
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
    p.on('error', (e) => reject(Object.assign(new Error(`${bin} could not start: ${e.message}. Install ffmpeg or set EXPLAINROO_FFMPEG.`), { code: e.code })));
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

// A long-running encoder fed with JPEG or PNG frames on stdin.
export function frameEncoder({ fps, out, draft, format = 'mp4', transparent = false }) {
  const codec = format === 'webm'
    ? ['-c:v', 'libvpx-vp9', '-crf', draft ? '32' : '24', '-b:v', '0', '-deadline', 'good', '-cpu-used', draft ? '4' : '2', '-auto-alt-ref', '0', '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p', '-r', String(fps), '-g', String(fps * 2)]
    : format === 'mov'
      ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', transparent ? 'yuva444p10le' : 'yuv444p10le', '-r', String(fps)]
      : ['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '24' : '17', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2)];
  const args = [
    '-hide_banner', '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', transparent ? 'png' : 'mjpeg', '-i', '-',
    ...codec,
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

// The highest true peak a finished video may have, in dBTP.
export const PEAK_CEILING = -1;

// A true peak as people read it, like "+0.5 dBTP", or "-inf dBTP" for silence.
export function dbtp(peak) {
  if (peak === -Infinity) return '-inf dBTP';
  if (typeof peak !== 'number' || Number.isNaN(peak)) return '? dBTP';
  return `${peak > 0 ? '+' : ''}${peak.toFixed(1)} dBTP`;
}

// The encoder of each video format's sound. ffmpeg's AAC encoder can turn a quiet
// sound into a loud click where it replaces a band with noise. At 192 kbit/s that
// replacement saves nothing, so it is off.
export const AUDIO_CODECS = {
  mp4: ['-c:a', 'aac', '-b:a', '192k', '-aac_pns', '0'],
  webm: ['-c:a', 'libopus', '-b:a', '192k'],
  mov: ['-c:a', 'pcm_s16le'],
};

// The first pass of a two-pass loudness normalization to `target` LUFS. It returns
// the filter for the second pass, or null for silence and very short clips, which
// have no measurable integrated loudness.
async function loudnessFilter(input, target) {
  const base = `I=${target}:TP=-1.5:LRA=11`;
  const pass1 = await ffmpeg(['-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']);
  const json = pass1.stderr.slice(pass1.stderr.lastIndexOf('{'), pass1.stderr.lastIndexOf('}') + 1);
  const m = JSON.parse(json);
  const filter = Number.isFinite(Number(m.input_i))
    ? `loudnorm=${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`
    : null;
  return { filter, inputI: Number(m.input_i), inputTP: Number(m.input_tp) };
}

// Two-pass loudness normalization to `target` LUFS, peak-limited.
export async function normalizeLoudness(input, output, target = -14, sampleRate = 48000) {
  const { filter, inputI, inputTP } = await loudnessFilter(input, target);
  await ffmpeg(['-i', input, ...(filter ? ['-af', filter] : []), '-ar', String(sampleRate), '-c:a', 'pcm_s16le', output]);
  return { inputI, inputTP };
}

let latencyOption;
function limiterTakesLatency() {
  latencyOption ??= /\blatency\b/.test(spawnSync(ffmpegPath(), ['-hide_banner', '-h', 'filter=alimiter'], { encoding: 'utf8' }).stdout ?? '');
  return latencyOption;
}

// A limiter at `db` for sound at 192 kHz. alimiter delays the sound by its attack,
// 959 samples there. ffmpeg 5.1 and newer take the delay back with latency=true.
// Older builds pad the end and cut the start instead, which gives the same samples.
export function limiterFilter(db, latency = limiterTakesLatency()) {
  const limit = `alimiter=limit=${(10 ** (db / 20)).toFixed(6)}:level=false`;
  return latency ? `${limit}:latency=true` : `apad=pad_len=959,${limit},atrim=start_sample=959,asetpts=PTS-STARTPTS`;
}

// The finished soundtrack of a video or a web player at 48 kHz: loudness
// normalization to `target` LUFS, then a limiter on the sound upsampled four times,
// so that the points a player rebuilds between samples stay under the ceiling too.
// The encoder can raise a peak again, by an amount that depends on the sound. So
// the result is encoded with `codec` and measured the way verify measures a video.
// When the encoded sound lands above the ceiling, the limiter goes down by the
// difference and runs again. The encoder doesn't always follow, so it gets up to
// four runs.
export async function finishMix(input, output, target, codec, { log = () => {} } = {}) {
  const { filter } = await loudnessFilter(input, target);
  let limit = PEAK_CEILING;
  for (let run = 1; ; run++) {
    const chain = [filter, 'aresample=48000', 'aresample=192000', limiterFilter(limit), 'aresample=48000'].filter(Boolean).join(',');
    await ffmpeg(['-i', input, '-af', chain, '-ar', '48000', '-c:a', 'pcm_s16le', output]);
    const peak = await encodedPeak(output, codec);
    if (!(peak > PEAK_CEILING) || run === 4) return { limit, truePeak: peak };
    const before = (await loudness(output)).truePeak;
    limit = Math.round((Math.min(limit, before) - (peak - PEAK_CEILING) - 0.2) * 10) / 10;
    log(`soundtrack: the encoded sound peaked at ${dbtp(peak)}, so the limiter runs again at ${limit} dB`);
  }
}

// The true peak of `wav` after encoding it with `codec`.
async function encodedPeak(wav, codec) {
  const file = `${wav}.peak.mka`;
  try {
    await ffmpeg(['-loglevel', 'error', '-i', wav, ...codec, file]);
    return (await loudness(file)).truePeak;
  } finally {
    fs.rmSync(file, { force: true });
  }
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
  // Silence has a peak of -inf, which JSON writes as null.
  return { integrated: I ? Number(I[1]) : null, range: LRA ? Number(LRA[1]) : null, truePeak: peak ? (peak[1] === '-inf' ? -Infinity : Number(peak[1])) : null };
}
