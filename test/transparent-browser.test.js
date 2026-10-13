import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { withEngine } from '../src/pipeline.js';
import { render } from '../src/render.js';
import { stills, verify } from '../src/qa.js';
import { ffmpegPath, ffmpegVersion, probe } from '../src/ffmpeg.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome || !ffmpegVersion();

function pixels(file, decoder = []) {
  const r = spawnSync(ffmpegPath(), ['-v', 'error', ...decoder, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-threads', '1', '-'], { maxBuffer: 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr.toString());
  return r.stdout;
}
const alphaAt = (data, x, y, w = 320) => data[(y * w + x) * 4 + 3];

function projectFiles(dir) {
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: '320x180', fps: 24, captions: false, watermark: false, music: false, sfx: false, end: 0 }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## box {min=2 chapter="Box"}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { box(s) {
    s.box('', { x: 160, y: 90, w: 80, h: 60, fill: '#245cff', border: false, at: 0, enter: 'none' });
  } };`);
  return loadProject(dir);
}

test('transparent WebM and MOV retain alpha, audio, chapters and opaque covers', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-alpha-'));
  try {
    const project = projectFiles(dir);
    for (const format of ['webm', 'mov']) {
      const r = await render(project, { format, transparent: true, workers: 2 });
      assert.equal(r.out, path.join(dir, `out/video.${format}`));
      assert.equal(r.duration, 2);
      assert.equal(r.chapters, path.join(dir, 'out/video.chapters.txt'));
      assert.equal(r.cover, path.join(dir, 'out/video.cover.jpg'));
      const info = await probe(r.out);
      const video = info.streams.find((s) => s.codec_type === 'video');
      const audio = info.streams.find((s) => s.codec_type === 'audio');
      assert.equal(audio.codec_name, format === 'webm' ? 'opus' : 'pcm_s16le');
      // ffprobe's native VP9 decoder hides the alpha plane. libvpx exposes it.
      if (format === 'webm') {
        assert.equal(video.codec_name, 'vp9');
        assert.equal(video.tags.alpha_mode ?? video.tags.ALPHA_MODE, '1');
        const decoded = spawnSync(ffmpegPath(), ['-c:v', 'libvpx-vp9', '-i', r.out, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
        assert.equal(decoded.status, 0, decoded.stderr);
        assert.match(decoded.stderr, /yuva420p/);
      } else {
        assert.equal(video.codec_name, 'prores');
        assert.equal(video.codec_tag_string, 'ap4h');
        assert.match(video.pix_fmt, /^yuva444p/);
      }
      const chapters = spawnSync(process.env.EXPLAINROO_FFPROBE || 'ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', r.out], { encoding: 'utf8' });
      assert.equal(chapters.status, 0, chapters.stderr);
      assert.equal(JSON.parse(chapters.stdout).chapters[0].tags.title, 'Box');
      const data = pixels(r.out, format === 'webm' ? ['-c:v', 'libvpx-vp9'] : []);
      assert.equal(alphaAt(data, 0, 0), 0);
      assert.equal(alphaAt(data, 160, 90), 255);
      assert.equal(alphaAt(pixels(r.cover), 0, 0), 255);
      const report = await verify(project, { file: r.out });
      assert.deepEqual(report.blackSegments, []);
      assert.ok(report.issues.some((i) => /skipped because the video has alpha/.test(i.message)));
      assert.ok(!report.issues.some((i) => i.level === 'error'));
    }
    const [still] = await stills(project, ['box@1'], { transparent: true });
    const data = pixels(still.file);
    assert.equal(alphaAt(data, 0, 0), 0);
    assert.equal(alphaAt(data, 160, 90), 255);
    for (const format of ['webm', 'mov']) {
      const r = await render(project, { format, draft: true, workers: 1 });
      assert.equal(r.out, path.join(dir, `out/draft.${format}`));
      assert.equal(alphaAt(pixels(r.out), 0, 0, 160), 255);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every transparent transition keeps empty pixels clear and clears old frames', { skip: !chrome }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-transitions-'));
  try {
    const project = projectFiles(dir);
    const names = ['fade', 'slide', 'wipe', 'zoom', 'brush', 'cut'];
    const timeline = { duration: 14, frames: 336, fps: 24, width: 320, height: 180, transitionSeconds: 0.7,
      scenes: ['none', ...names].map((transition, index) => ({ id: 'box', index, start: index * 2, dur: 2, words: [], marks: {}, voice: null, transition })) };
    await withEngine(project, timeline, { transparent: true }, async (page) => {
      const results = await page.evaluate(async () => {
        const { boot } = await import('/engine/runtime.js');
        const { engine } = await boot({ canvas: document.createElement('canvas'), transparent: true });
        engine.scenesModule.box = (s) => {
          s.ctx.fillStyle = '#245cff';
          s.ctx.fillRect(s.scene.index % 2 ? 160 : 80, 60, 80, 60);
        };
        const sample = (T) => {
          engine.renderFrame(T);
          const ctx = engine.ctx;
          return [0, 100, 180].map((x) => ctx.getImageData(x, x ? 90 : 0, 1, 1).data[3]);
        };
        return engine.timeline.scenes.slice(1).map((sc) => ({
          name: sc.transition, middle: sample(sc.start + 0.35), end: sample(sc.start + 0.8), repeat: sample(sc.start + 0.35),
        }));
      });
      for (const [i, r] of results.entries()) {
        assert.equal(r.middle[0], 0, r.name);
        assert.equal(r.end[0], 0, r.name);
        assert.deepEqual(r.repeat, r.middle, r.name);
        const outgoing = i % 2 ? 2 : 1;
        const incoming = i % 2 ? 1 : 2;
        assert.equal(r.end[outgoing], 0, r.name);
        assert.equal(r.end[incoming], 255, r.name);
        if (r.name !== 'cut') {
          assert.ok(Math.abs(r.middle[outgoing] - 128) <= 1, JSON.stringify(r));
          assert.ok(Math.abs(r.middle[incoming] - 128) <= 1, JSON.stringify(r));
        }
      }
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
