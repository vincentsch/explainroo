// Bold captions in real frames: the keyword color shows in a still and in the
// exported player, a star-only edit needs no new voice, and check keeps scene
// text out of the caption band.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { findChrome, launch } from '../src/browser.js';
import { spawnSync } from 'node:child_process';
import { ffmpegPath } from '../src/ffmpeg.js';
import { normalizeConfig } from '../src/project.js';
import { layoutAreas } from '../engine/layout.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SETTINGS = { size: 'tiktok', captions: 'bold', theme: 'clean', music: false, sfx: false, end: 0, camera: 'still' };
const yellow = (r, g, b) => r > 220 && g > 180 && b < 110;

function bakery(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-bold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(SETTINGS));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.title('Bread', { y: s.safe.y + s.safe.h * 0.3, enter: 'none' }); } };");
  return dir;
}

// Yellow pixels inside the caption band and outside it, in a 1080x1920 frame.
async function yellowIn(file) {
  const config = normalizeConfig(SETTINGS);
  const { band } = layoutAreas(config, config.width, config.height);
  const { stdout } = spawnSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: config.width * config.height * 3 + 1e6 });
  const counts = { band: 0, elsewhere: 0 };
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const i = (y * config.width + x) * 3;
      if (!yellow(stdout[i], stdout[i + 1], stdout[i + 2])) continue;
      counts[y >= band.top && y <= band.bottom ? 'band' : 'elsewhere']++;
    }
  }
  return counts;
}

test('a starred word shows in the keyword color, and a star-only edit makes no new voice', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, '# Bread\n\n## intro\n*Four* loaves of bread.\n');
  const project = cachedVoice(dir, 'intro');
  const voiceFile = path.join(project.paths.voice, 'intro.json');
  const before = fs.readFileSync(voiceFile, 'utf8');

  const still = async () => {
    const r = await cli(['still', dir, 'intro@0.7', '--json']);
    assert.equal(r.code, 0, r.text);
    assert.doesNotMatch(r.stderr, /test guard: blocked/);
    return JSON.parse(r.stdout).stills[0].file;
  };
  const starred = await yellowIn(await still());
  assert.ok(starred.band > 300, `the keyword is yellow in the band: ${JSON.stringify(starred)}`);
  assert.equal(starred.elsewhere, 0);

  fs.writeFileSync(path.join(dir, 'script.md'), '# Bread\n\n## intro\nFour loaves of bread.\n');
  const plain = await yellowIn(await still());
  assert.equal(plain.band, 0, 'without the star no word is yellow');
  assert.equal(fs.readFileSync(voiceFile, 'utf8'), before, 'the narration was not made again');

  // Numbers are keywords without stars.
  fs.writeFileSync(path.join(dir, 'script.md'), '# Bread\n\n## intro\n4 loaves of bread.\n');
  cachedVoice(dir, 'intro');
  assert.ok((await yellowIn(await still())).band > 100);
});

test('bold captions keep their color in the exported player', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t, '# Bread\n\n## intro\n*Four* loaves of bread.\n');
  cachedVoice(dir, 'intro');
  const r = await cli(['export', dir, '--json']);
  assert.equal(r.code, 0, r.text);
  const out = JSON.parse(r.stdout).out;
  const state = JSON.parse(fs.readFileSync(path.join(out, 'state.json'), 'utf8'));
  assert.equal(state.config.captions, 'bold');
  assert.deepEqual(state.timeline.scenes[0].words.filter((w) => w.key).map((w) => w.text), ['Four']);
  assert.ok(JSON.parse(fs.readFileSync(path.join(out, 'fonts/fonts.json'), 'utf8')).some((f) => f.family === 'Inter'), 'the caption font comes along');

  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.vtt': 'text/vtt', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    const file = path.join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(out + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await launch();
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 540, height: 960 } })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?muted=1`);
  await page.evaluate(() => window.explainrooReady);
  await page.locator('#poster').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('k');
  const config = normalizeConfig(SETTINGS);
  const { band } = layoutAreas(config, config.width, config.height);
  const counts = await page.evaluate(([top, bottom]) => {
    const seek = document.querySelector('#seek');
    seek.value = 0.7;
    seek.dispatchEvent(new Event('input'));
    const canvas = document.querySelector('#c');
    const k = canvas.width / 1080;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const result = { band: 0, elsewhere: 0 };
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] > 220 && data[i + 1] > 180 && data[i + 2] < 110)) continue;
      const y = Math.floor(i / 4 / canvas.width) / k;
      result[y >= top && y <= bottom ? 'band' : 'elsewhere']++;
    }
    return result;
  }, [band.top, band.bottom]);
  assert.ok(counts.band > 50, `the keyword is yellow in the player: ${JSON.stringify(counts)}`);
  assert.equal(counts.elsewhere, 0);
});

test('check warns about scene text in the bold caption band', { skip, timeout: 120000 }, async (t) => {
  const dir = bakery(t, '# Bread\n\n## intro\nFour loaves of bread.\n');
  cachedVoice(dir, 'intro');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text('Low note', { y: s.safe.bottom + 60, size: 40, at: 0 }); } };");
  const r = await cli(['check', dir, '--json']);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  const issues = JSON.parse(r.stdout).issues;
  assert.ok(issues.some((i) => i.level === 'warn' && /"Low note" is in the caption band/.test(i.message)), JSON.stringify(issues));
});
