// Local HTTP server for the engine pages, the project files and uploads from
// the page (rendered audio, stills and sheets). Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractClip, VIDEO_FILE } from './clips.js';
import { typesetMath, mathHash, MAX_TEX_LENGTH } from './math.js';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveModule(spec) {
  return fileURLToPath(import.meta.resolve(spec));
}

function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}

// Project files the engine page may read: scenes.js and the modules it
// imports, images, fonts, audio and video. Never dotfiles such as .env, and
// no JSON, Markdown or text files, which can hold keys or private notes.
const PROJECT_FILES = /\.(m?js|png|jpe?g|webp|gif|svg|wav|mp3|mp4|mov|webm|m4v|woff2?|ttf|otf)$/i;

function allowedName(rel) {
  const parts = rel.split(/[\\/]+/);
  return !parts.some((x) => x.startsWith('.')) && PROJECT_FILES.test(rel);
}

function realInside(base, target) {
  const root = fs.realpathSync(base);
  return target === root || target.startsWith(root + path.sep);
}

// The rules apply to where a file really is: a symlink such as
// assets/logo.png -> ../../.env is followed and then refused.
function projectFile(projectDir, rel) {
  if (!allowedName(rel)) return null;
  const file = safeJoin(projectDir, rel);
  if (!file || !fs.existsSync(file)) return null;
  const real = fs.realpathSync(file);
  if (!realInside(projectDir, real)) return null;
  const realRel = path.relative(fs.realpathSync(projectDir), real);
  return allowedName(realRel) ? real : null;
}

function clipFile(projectDir, rel) {
  if (!rel.startsWith('assets/') || !VIDEO_FILE.test(rel)) return null;
  const file = projectFile(projectDir, rel);
  const assets = path.join(fs.realpathSync(projectDir), 'assets');
  if (!file || !VIDEO_FILE.test(file) || !file.startsWith(assets + path.sep) || !fs.statSync(file).isFile()) return null;
  return file;
}

function clipCacheFile(projectDir, rel) {
  const file = uploadFile(projectDir, rel);
  if (!file) return null;
  const realRel = path.relative(fs.realpathSync(projectDir), fs.realpathSync(path.dirname(file)));
  return realRel.split(path.sep).some((p) => p.startsWith('.')) ? null : file;
}

const clipJobs = new Map();

async function cachedClip(projectDir, file, fps) {
  const hash = crypto.createHash('sha256').update(JSON.stringify({ fps, width: 1920, version: 1 }));
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const rel = `build/clips/${hash.digest('hex')}`;
  const infoFile = clipCacheFile(projectDir, `${rel}/info.json`);
  if (!infoFile) throw new Error('clip cache must stay in build/. Remove symlinks from build/clips/.');
  const key = infoFile;
  if (!clipJobs.has(key)) {
    const job = (async () => {
      if (fs.existsSync(infoFile)) return { rel, info: JSON.parse(fs.readFileSync(infoFile, 'utf8')) };
      const temp = fs.mkdtempSync(path.join(path.dirname(infoFile), 'extract-'));
      try {
        const info = await extractClip(file, temp, fps);
        for (const name of fs.readdirSync(temp)) {
          const dest = clipCacheFile(projectDir, `${rel}/${name}`);
          if (!dest) throw new Error('clip cache must stay in build/. Remove symlinks from build/clips/.');
          fs.renameSync(path.join(temp, name), dest);
        }
        fs.writeFileSync(infoFile, JSON.stringify(info));
        return { rel, info };
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    })();
    clipJobs.set(key, job);
    job.finally(() => clipJobs.delete(key)).catch(() => {});
  }
  return clipJobs.get(key);
}

// Uploads from the page may only land in build/ or out/: checked after the
// path is normalized (so "build/../scenes.js" is refused), and again on the
// real folder, and never onto a symlink.
function uploadFile(projectDir, rel) {
  const dest = safeJoin(projectDir, rel);
  if (!dest) return null;
  const root = ['build', 'out'].find((d) => dest.startsWith(path.join(projectDir, d) + path.sep));
  if (!root) return null;
  const realProject = fs.realpathSync(projectDir);
  const realRoot = path.join(realProject, root);
  const underRoot = (p) => p === realRoot || p.startsWith(realRoot + path.sep);
  // Check the folders that already exist before creating any.
  let probe = path.dirname(dest);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realProject && !underRoot(realProbe)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!underRoot(fs.realpathSync(path.dirname(dest)))) return null;
  return isSymlink(dest) ? null : dest;
}

// lstat, not existsSync: a symlink to a missing file must be refused too.
function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function startServer({ projectDir, getState, port = 0 }) {
  const roughPath = resolveModule('roughjs/bundled/rough.esm.js');
  const clips = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      // Only answer requests addressed to this machine. A web page on another
      // site that points its own domain at 127.0.0.1 (DNS rebinding) sends a
      // different Host header and is turned away.
      const port = server.address().port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) return send(res, 403, 'forbidden host');
      const origin = req.headers.origin;
      if (origin && !hosts.some((h) => origin === `http://${h}`)) return send(res, 403, 'forbidden origin');
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      if (p === '/__math') {
        if (req.method !== 'GET') return send(res, 405, 'math only accepts GET');
        const tex = url.searchParams.get('tex');
        const style = url.searchParams.get('display') ?? '1';
        if (tex === null || tex.length > MAX_TEX_LENGTH) return send(res, 400, `use a TeX string of at most ${MAX_TEX_LENGTH} characters`);
        if (!['0', '1'].includes(style)) return send(res, 400, 'display must be 0 or 1');
        const display = style === '1';
        const file = uploadFile(projectDir, `build/math/${mathHash(tex, display)}.json`);
        if (!file) return send(res, 400, 'math cache must stay in build/math/');
        try {
          const result = await typesetMath(tex, display, file);
          return send(res, 200, JSON.stringify(result), TYPES['.json']);
        } catch (e) {
          return send(res, 400, JSON.stringify({ error: e.message }), TYPES['.json']);
        }
      }
      if (req.method === 'PUT' && p === '/__upload') {
        const rel = url.searchParams.get('path') || '';
        const dest = uploadFile(projectDir, rel);
        if (!dest) return send(res, 400, 'uploads go to build/ or out/');
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        // Chunked upload (engine/upload.js): the pieces of one upload carry its
        // random id and their byte offset, and are assembled in
        // "<dest>.<id>.part" next to the target, which replaces the target only
        // when the last piece has arrived. A piece at the wrong offset is
        // refused, an interrupted upload never leaves a half-written file under
        // the real name, and a new upload of the same file (offset 0) removes
        // older partial uploads, so a stale or competing upload fails instead
        // of mixing bytes into the result.
        if (url.searchParams.has('offset')) {
          const rawOffset = url.searchParams.get('offset');
          const offset = Number(rawOffset);
          if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset)) return send(res, 400, 'offset must be a non-negative integer');
          const id = url.searchParams.get('upload') || '';
          if (!/^[0-9a-f]{16,64}$/.test(id)) return send(res, 400, 'upload must be a hexadecimal upload id');
          const part = `${dest}.${id}.part`;
          if (isSymlink(part)) return send(res, 400, 'uploads go to build/ or out/');
          if (offset === 0) {
            const stale = new RegExp(`^${path.basename(dest).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]{16,64}\\.part$`);
            for (const name of fs.readdirSync(path.dirname(dest))) {
              if (stale.test(name)) fs.rmSync(path.join(path.dirname(dest), name), { force: true });
            }
            fs.writeFileSync(part, body);
          } else {
            const have = fs.existsSync(part) ? fs.statSync(part).size : null;
            if (have !== offset) return send(res, 409, `upload piece out of order: expected offset ${have ?? 0}, got ${offset}`);
            fs.appendFileSync(part, body);
          }
          if (url.searchParams.get('last') === '1') fs.renameSync(part, dest);
          return send(res, 200, 'ok');
        }
        fs.writeFileSync(dest, body);
        return send(res, 200, 'ok');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
      if (p === '/favicon.ico') return send(res, 204, '');
      if (p === '/__state.json') {
        const state = await getState();
        return send(res, 200, JSON.stringify(state), TYPES['.json']);
      }
      if (['/__clip/info', '/__clip/frame', '/__clip/audio'].includes(p)) {
        const file = clipFile(projectDir, url.searchParams.get('path') || '');
        if (!file) return send(res, 404, 'clip not found. Put a video in assets/.');
        const state = await getState();
        const stat = fs.statSync(file);
        const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${state.config.fps}`;
        if (clips.get(file)?.stamp !== stamp) {
          const job = cachedClip(projectDir, file, state.config.fps);
          clips.set(file, { stamp, job });
          job.catch(() => { if (clips.get(file)?.job === job) clips.delete(file); });
        }
        const { rel, info } = await clips.get(file).job;
        if (p === '/__clip/info') return send(res, 200, JSON.stringify(info), TYPES['.json']);
        let name = 'audio.wav';
        if (p === '/__clip/frame') {
          const raw = url.searchParams.get('frame') || '0';
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return send(res, 400, 'frame must be a non-negative integer');
          name = `${String(Math.min(Number(raw), info.frames - 1)).padStart(8, '0')}.jpg`;
        } else if (!info.hasAudio) return send(res, 404, 'this clip has no sound');
        const cached = clipCacheFile(projectDir, `${rel}/${name}`);
        if (!cached || !fs.existsSync(cached) || !fs.statSync(cached).isFile()) return send(res, 404, 'clip frame or sound not found');
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(cached).pipe(res);
        return;
      }
      let file = null;
      if (p === '/' || p === '/studio.html') file = path.join(ROOT, 'engine', 'studio.html');
      else if (p === '/frame.html') file = path.join(ROOT, 'engine', 'frame.html');
      else if (p === '/vendor/rough.js') file = roughPath;
      else if (p.startsWith('/engine/')) file = safeJoin(path.join(ROOT, 'engine'), p.slice(8));
      else if (p.startsWith('/fonts/')) file = safeJoin(path.join(ROOT, 'fonts'), p.slice(7));
      else if (p.startsWith('/project/')) file = projectFile(projectDir, p.slice(9));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, `not found: ${p}`);
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, 500, String(e && e.stack || e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ url: `http://127.0.0.1:${actual}`, port: actual, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
    });
  });
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
