import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../src/server.js';
import { mathHash, MAX_TEX_LENGTH } from '../src/math.js';

function request(port, { method = 'GET', path: p, host = `127.0.0.1:${port}`, origin, body }) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (origin) headers.origin = origin;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('math only accepts bounded GET input and keeps the cache inside build/math', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-math-server-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-math-outside-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const server = await startServer({ projectDir: dir, getState: () => ({}) });
  t.after(() => server.close());
  const get = (tex, extra = {}) => request(server.port, { path: `/__math?tex=${encodeURIComponent(tex)}`, ...extra });
  const result = await get(String.raw`\frac{1}{2}`);
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).paths.length, 3);
  const file = path.join(dir, 'build/math', `${mathHash(String.raw`\frac{1}{2}`)}.json`);
  assert.equal(fs.readFileSync(file, 'utf8'), result.body);
  assert.equal((await get('x'.repeat(MAX_TEX_LENGTH))).status, 200);
  assert.equal((await get('x'.repeat(MAX_TEX_LENGTH + 1))).status, 400);
  assert.equal((await request(server.port, { path: '/__math' })).status, 400);
  assert.equal((await request(server.port, { path: '/__math?tex=x&display=false' })).status, 400);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) assert.equal((await get('x', { method })).status, 405);
  assert.equal((await get('x', { host: 'evil.example:80' })).status, 403);
  assert.equal((await get('x', { origin: 'https://evil.example' })).status, 403);
  const bad = await get(String.raw`\unknown`);
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.body).error, /Undefined control sequence/);
  assert.equal((await request(server.port, { path: '/project/build/math/' + path.basename(file) })).status, 404);
  fs.symlinkSync(path.join(outside, 'cache.json'), path.join(dir, 'build/math', `${mathHash('x')}.json`));
  assert.equal((await get('x')).status, 400);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmSync(path.join(dir, 'build/math'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'build/math'));
  assert.equal((await get('x')).status, 400);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('chunked uploads are assembled in order and appear only when complete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-chunks-'));
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};');
  const server = await startServer({ projectDir: dir, getState: () => ({}) });
  try {
    const port = server.port;
    const put = (p, query, body) => request(port, { method: 'PUT', path: `/__upload?path=${encodeURIComponent(p)}${query}`, body });
    const piece = (p, id, offset, body, last = false) => put(p, `&upload=${id}&offset=${offset}${last ? '&last=1' : ''}`, body);
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    const build = path.join(dir, 'build');
    const mix = path.join(build, 'mix.wav');
    const parts = () => fs.readdirSync(build).filter((n) => n.endsWith('.part'));
    fs.mkdirSync(build, { recursive: true });
    fs.writeFileSync(mix, 'old');

    // pieces in order; the existing file is replaced only by the last piece
    assert.equal((await piece('build/mix.wav', A, 0, 'aaa')).status, 200);
    assert.equal((await piece('build/mix.wav', A, 3, 'bbb')).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'old');
    // a piece at the wrong offset is refused and changes nothing
    assert.equal((await piece('build/mix.wav', A, 99, 'zzz')).status, 409);
    assert.equal((await piece('build/mix.wav', A, 6, 'cc', true)).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'aaabbbcc');
    assert.deepEqual(parts(), []);

    // uploading the same file again replaces the completed destination
    assert.equal((await piece('build/mix.wav', B, 0, 'second', true)).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'second');

    // an interrupted upload leaves only its part file; a new upload starts clean
    assert.equal((await piece('build/mix.wav', A, 0, 'xxxx')).status, 200);
    assert.equal((await piece('build/mix.wav', A, 4, 'yyyy')).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'second');
    assert.equal((await piece('build/mix.wav', B, 0, 'fresh')).status, 200);
    assert.equal((await piece('build/mix.wav', B, 5, '!', true)).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'fresh!');
    assert.deepEqual(parts(), []);

    // a competing upload never mixes bytes: the older one fails, the newer one wins
    assert.equal((await piece('build/mix.wav', A, 0, '1111')).status, 200);
    assert.equal((await piece('build/mix.wav', B, 0, '2222')).status, 200);
    assert.equal((await piece('build/mix.wav', A, 4, '1111', true)).status, 409);
    assert.equal(fs.readFileSync(mix, 'utf8'), 'fresh!');
    assert.equal((await piece('build/mix.wav', B, 4, '2222', true)).status, 200);
    assert.equal(fs.readFileSync(mix, 'utf8'), '22222222');

    // a continuation without a started upload is refused
    assert.equal((await piece('build/other.wav', A, 5, 'x', true)).status, 409);
    assert.ok(!fs.existsSync(path.join(build, 'other.wav')));
    // malformed offsets and upload ids are refused
    for (const bad of ['-1', '1.5', 'abc', '']) assert.equal((await put('build/mix.wav', `&upload=${A}&offset=${bad}`, 'x')).status, 400);
    for (const bad of ['', 'short', '../../scenes', 'A'.repeat(32), 'g'.repeat(32)]) assert.equal((await put('build/mix.wav', `&upload=${bad}&offset=0`, 'x')).status, 400);
    // an empty upload is one last piece at offset 0
    assert.equal((await piece('out/empty.bin', A, 0, '', true)).status, 200);
    assert.equal(fs.statSync(path.join(dir, 'out', 'empty.bin')).size, 0);
    // the single-request form keeps working, under the same path rules
    assert.equal((await put('out/single.txt', '', 'one')).status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'out', 'single.txt'), 'utf8'), 'one');

    // chunked uploads obey the same path rules, and the part file cannot be a symlink
    assert.equal((await piece('build/../scenes.js', A, 0, 'x', true)).status, 400);
    assert.equal((await piece('assets/x.png', A, 0, 'x', true)).status, 400);
    assert.equal(fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8'), 'export default {};');
    fs.symlinkSync(path.join(dir, 'scenes.js'), path.join(build, `trap.wav.${A}.part`));
    assert.equal((await piece('build/trap.wav', A, 0, 'x', true)).status, 400);
    assert.equal(fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8'), 'export default {};');
    // removing a stale part never follows a symlink to its target
    assert.equal((await piece('build/trap.wav', B, 0, 'x', true)).status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8'), 'export default {};');
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview server keeps secrets and sources safe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-server-'));
  fs.writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=secret');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'private');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'png');
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'));
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'Brand-600.woff2'), 'font');
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'OFL.txt'), 'license');
  const server = await startServer({ projectDir: dir, getState: () => ({}) });
  try {
    const port = server.port;
    assert.equal((await request(port, { path: '/project/scenes.js' })).status, 200);
    assert.equal((await request(port, { path: '/project/assets/logo.png' })).status, 200);
    assert.equal((await request(port, { path: '/project/assets/fonts/Brand-600.woff2' })).status, 200);
    assert.equal((await request(port, { path: '/project/assets/fonts/OFL.txt' })).status, 404);
    assert.equal((await request(port, { path: '/project/.env' })).status, 404);
    assert.equal((await request(port, { path: '/project/notes.md' })).status, 404);
    assert.equal((await request(port, { path: '/project/assets/../.env' })).status, 404);
    assert.equal((await request(port, { path: '/project/scenes.js', host: 'evil.example:80' })).status, 403);
    assert.equal((await request(port, { path: '/project/scenes.js', origin: 'http://evil.example' })).status, 403);
    const put = (p) => request(port, { method: 'PUT', path: `/__upload?path=${encodeURIComponent(p)}`, body: 'x' });
    assert.equal((await put('build/../scenes.js')).status, 400);
    assert.equal(fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8'), 'export default {};');
    assert.equal((await put('out/stills/a.png')).status, 200);
    assert.ok(fs.existsSync(path.join(dir, 'out', 'stills', 'a.png')));

    // Symlinks do not get around the rules.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.png'), 'outside');
    fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'assets', 'alias.png'));
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'assets', 'away.png'));
    assert.equal((await request(port, { path: '/project/assets/alias.png' })).status, 404);
    assert.equal((await request(port, { path: '/project/assets/away.png' })).status, 404);
    fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'scenes.js'), path.join(dir, 'build', 'source-link.js'));
    assert.equal((await put('build/source-link.js')).status, 400);
    assert.equal(fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8'), 'export default {};');
    fs.symlinkSync(path.join(outside, 'new.png'), path.join(dir, 'build', 'dangling.png'));
    assert.equal((await put('build/dangling.png')).status, 400);
    assert.ok(!fs.existsSync(path.join(outside, 'new.png')));
    fs.symlinkSync(outside, path.join(dir, 'out', 'elsewhere'));
    assert.equal((await put('out/elsewhere/x.png')).status, 400);
    assert.ok(!fs.existsSync(path.join(outside, 'x.png')));
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clip endpoints only read video assets and keep the cache inside build', async () => {
  const { ffmpeg } = await import('../src/ffmpeg.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-server-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-clip-outside-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const video = path.join(dir, 'assets/ok.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=80x60:r=30:d=0.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-shortest', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', video]);
  fs.copyFileSync(video, path.join(outside, 'away.mp4'));
  fs.copyFileSync(video, path.join(dir, 'root.mp4'));
  fs.copyFileSync(video, path.join(dir, 'assets/.private.mp4'));
  fs.mkdirSync(path.join(dir, 'assets/.hidden'));
  fs.copyFileSync(video, path.join(dir, 'assets/.hidden/ok.mp4'));
  fs.writeFileSync(path.join(dir, 'assets/notes.md'), 'secret');
  fs.symlinkSync(path.join(outside, 'away.mp4'), path.join(dir, 'assets/away.mp4'));
  fs.symlinkSync(path.join(dir, 'root.mp4'), path.join(dir, 'assets/root-link.mp4'));
  fs.symlinkSync(path.join(dir, 'assets/.private.mp4'), path.join(dir, 'assets/hidden-link.mp4'));
  fs.symlinkSync(path.join(dir, 'assets/notes.md'), path.join(dir, 'assets/notes.mp4'));
  const server = await startServer({ projectDir: dir, getState: () => ({ config: { fps: 30 } }) });
  try {
    for (const endpoint of ['info', 'frame', 'audio']) {
      const url = (p) => `/__clip/${endpoint}?path=${encodeURIComponent(p)}`;
      for (const p of ['root.mp4', 'assets/../root.mp4', 'assets/missing.mp4', 'assets/notes.md', 'assets/ok.avi', 'assets/.private.mp4', 'assets/.hidden/ok.mp4', 'assets/away.mp4', 'assets/root-link.mp4', 'assets/hidden-link.mp4', 'assets/notes.mp4', '../away.mp4', video]) {
        assert.equal((await request(server.port, { path: url(p) })).status, 404, `${endpoint}: ${p}`);
      }
      assert.equal((await request(server.port, { path: url('assets/ok.mp4'), host: 'evil.example' })).status, 403);
      assert.equal((await request(server.port, { path: url('assets/ok.mp4'), origin: 'http://evil.example' })).status, 403);
      assert.equal((await request(server.port, { path: url('assets/ok.mp4'), method: 'POST' })).status, 405);
    }
    for (const [ext, mime] of [['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['webm', 'video/webm'], ['m4v', 'video/mp4']]) {
      fs.copyFileSync(video, path.join(dir, `assets/type.${ext}`));
      const response = await fetch(`${server.url}/project/assets/type.${ext}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), mime);
      await response.arrayBuffer();
    }
    const responses = await Promise.all(Array.from({ length: 4 }, () => request(server.port, { path: '/__clip/info?path=assets/ok.mp4' })));
    assert.ok(responses.every((r) => r.status === 200));
    const info = JSON.parse(responses[0].body);
    assert.deepEqual(info, { frames: 6, fps: 30, width: 80, height: 60, duration: 0.2, hasAudio: true });
    assert.equal(fs.readdirSync(path.join(dir, 'build/clips')).length, 1);
    const frame = await fetch(`${server.url}/__clip/frame?path=assets/ok.mp4&frame=999`);
    assert.equal(frame.headers.get('content-type'), 'image/jpeg');
    const last = await fetch(`${server.url}/__clip/frame?path=assets/ok.mp4&frame=5`);
    assert.deepEqual(Buffer.from(await frame.arrayBuffer()), Buffer.from(await last.arrayBuffer()));
    const audio = await fetch(`${server.url}/__clip/audio?path=assets/ok.mp4`);
    assert.equal(audio.headers.get('content-type'), 'audio/wav');
    assert.equal(Buffer.from(await audio.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
    for (const frame of ['-1', '1.2', 'foo', '9007199254740992']) {
      assert.equal((await request(server.port, { path: `/__clip/frame?path=assets/ok.mp4&frame=${frame}` })).status, 400);
    }
    const silent = path.join(dir, 'assets/silent.mp4');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-an', '-c:v', 'copy', silent]);
    const silentInfo = await request(server.port, { path: '/__clip/info?path=assets/silent.mp4' });
    assert.equal(JSON.parse(silentInfo.body).hasAudio, false);
    assert.equal((await request(server.port, { path: '/__clip/audio?path=assets/silent.mp4' })).status, 404);
    const hash = fs.readdirSync(path.join(dir, 'build/clips')).find((hash) => fs.existsSync(path.join(dir, 'build/clips', hash, 'audio.wav')));
    const cached = path.join(dir, 'build/clips', hash, '00000000.jpg');
    fs.unlinkSync(cached);
    fs.symlinkSync(path.join(outside, 'away.mp4'), cached);
    assert.equal((await request(server.port, { path: '/__clip/frame?path=assets/ok.mp4' })).status, 404);
    fs.rmSync(path.join(dir, 'build/clips'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'build/clips'));
    const other = await startServer({ projectDir: dir, getState: () => ({ config: { fps: 30 } }) });
    try {
      assert.equal((await request(other.port, { path: '/__clip/info?path=assets/ok.mp4' })).status, 500);
      assert.deepEqual(fs.readdirSync(outside), ['away.mp4']);
    } finally { await other.close(); }
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
