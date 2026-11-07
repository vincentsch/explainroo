import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { sha256File } from '../src/history.js';
import { packageDir, packageOverrides, reusableRender } from '../src/package.js';

function project(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-package-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## intro {min=1}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  return dir;
}

test('each platform gets its size, TikTok loses the watermark, and a size with the same frame and free area stays', (t) => {
  const wide = loadProject(project(t));
  assert.deepEqual(packageOverrides(wide, 'youtube'), {}, 'the default 16:9 is the YouTube frame, so the normal render can be reused');
  assert.deepEqual(packageOverrides(wide, 'shorts'), { size: 'shorts' });
  assert.deepEqual(packageOverrides(wide, 'tiktok'), { size: 'tiktok', watermark: false });
  assert.deepEqual(packageOverrides(wide, 'reels'), { size: 'reels' });
  assert.deepEqual(packageOverrides(wide, 'linkedin'), { size: 'linkedin' });
  assert.deepEqual(packageOverrides(wide, 'x'), { size: 'square' });
  // X takes another size, and one that gives this frame keeps the project's own.
  assert.deepEqual(packageOverrides(wide, 'x', '16:9'), {});
  assert.deepEqual(packageOverrides(wide, 'x', 'youtube'), {});
  assert.deepEqual(packageOverrides(wide, 'x', '9:16'), { size: '9:16' });
  assert.throws(() => packageOverrides(wide, 'tiktok', '9:16'), /--size works only with --platform x\. A tiktok package always has the tiktok size/);
  assert.throws(() => packageOverrides(wide, 'x', 'huge'), /size must be/);
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: 'tiktok' })), 'tiktok'), { watermark: false });
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: '4:5' })), 'linkedin'), {});
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: 'instagram' })), 'linkedin'), {});
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: '1:1' })), 'x'), {});
  // The same frame with another free area is not the same setup.
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: 'vertical' })), 'tiktok'), { size: 'tiktok', watermark: false });
  assert.deepEqual(packageOverrides(loadProject(project(t, { size: '9:16' })), 'shorts'), { size: 'shorts' });
  assert.equal(packageDir(wide, 'tiktok'), path.join(wide.dir, 'out', 'package', 'tiktok'));
});

test('only a final MP4 of the whole video at full scale, made from this exact setup and still unchanged, can be reused', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, 'out'));
  const write = (name, text) => {
    fs.writeFileSync(path.join(dir, 'out', name), text);
    return { file: `out/${name}`, sha256: sha256File(path.join(dir, 'out', name)) };
  };
  const setup = { width: 1080, height: 1920, fps: 30, size: 'tiktok', watermark: false, identity: 'abc' };
  const good = { format: 'mp4', draft: false, transparent: false, full: true, scale: 1, ...setup, ...write('good.mp4', 'one') };
  assert.equal(reusableRender(dir, [good], setup).file, path.join(dir, 'out/good.mp4'));
  for (const [what, change] of [
    ['a draft', { draft: true }],
    ['a --scale render', { scale: 0.5 }],
    ['a --from or --to render', { full: false }],
    ['a GIF', { format: 'gif' }],
    ['a transparent video', { transparent: true }],
    ['another width', { width: 1920 }],
    ['another height', { height: 1080 }],
    ['another frame rate', { fps: 24 }],
    ['another size', { size: 'vertical' }],
    ['the watermark', { watermark: true }],
    ['another render identity', { identity: 'old' }],
  ]) assert.equal(reusableRender(dir, [{ ...good, ...change }], setup), null, what);
  // The file must still be the one that was recorded, and inside the project.
  fs.writeFileSync(path.join(dir, 'out/good.mp4'), 'changed');
  assert.equal(reusableRender(dir, [good], setup), null, 'a changed file');
  fs.rmSync(path.join(dir, 'out/good.mp4'));
  assert.equal(reusableRender(dir, [good], setup), null, 'a deleted file');
  const outside = path.join(os.tmpdir(), `explainroo-outside-${process.pid}.mp4`);
  fs.writeFileSync(outside, 'two');
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.equal(reusableRender(dir, [{ ...good, file: outside, sha256: sha256File(outside) }], setup), null, 'a file outside the project');
  fs.symlinkSync(outside, path.join(dir, 'out/link.mp4'));
  assert.equal(reusableRender(dir, [{ ...good, file: 'out/link.mp4', sha256: sha256File(outside) }], setup), null, 'a link out of the project');
  // The newest good one wins.
  const older = { ...good, ...write('older.mp4', 'older') };
  const newer = { ...good, ...write('newer.mp4', 'newer') };
  assert.equal(reusableRender(dir, [older, newer, { ...good, draft: true }], setup).file, path.join(dir, 'out/newer.mp4'));
});
