import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFormat } from '../src/render.js';
import { normalizeConfig } from '../src/project.js';
import { resolveTimes, verify } from '../src/qa.js';

test('render accepts only mp4 and gif with matching output extensions', () => {
  assert.equal(renderFormat(), 'mp4');
  assert.equal(renderFormat({ out: 'x/y.mp4' }), 'mp4');
  assert.equal(renderFormat({ format: 'gif', out: 'x/y.gif' }), 'gif');
  assert.equal(renderFormat({ format: 'mp4', out: 'x/y.MP4' }), 'mp4');
  assert.throws(() => renderFormat({ format: 'webm' }), /mp4 or gif/);
  assert.throws(() => renderFormat({ out: 'x/y.gif' }), /\.mp4/);
  assert.throws(() => renderFormat({ format: 'gif', out: 'x/y.mp4' }), /\.gif/);
  assert.throws(() => renderFormat({ out: 'x/y' }), /\.mp4/);
});

test('cover validates its type and syntax while allowing still specs', () => {
  assert.equal(normalizeConfig({}).cover, 'auto');
  for (const cover of [0, 12.5, '12.5', 'intro', 'intro@2.4', 'intro@end', 'intro@start']) assert.equal(normalizeConfig({ cover }).cover, cover);
  for (const cover of [false, null, -1, Infinity, {}, '', 'intro@bad', 'intro@2@3']) assert.throws(() => normalizeConfig({ cover }), /cover must be/);
  const timeline = { duration: 8, fps: 30, scenes: [{ id: 'intro', start: 0, dur: 3 }, { id: 'next', start: 3, dur: 5 }] };
  assert.equal(resolveTimes(timeline, ['intro@end'])[0].T, 2.7);
  assert.equal(resolveTimes(timeline, ['next@2.4'])[0].T, 5.4);
  assert.equal(resolveTimes(timeline, [1e21])[0].T, 8 - 1 / 30);
  assert.throws(() => resolveTimes(timeline, ['missing']), /no scene "missing".*intro, next/);
});

test('verify explains that GIF is unsupported', async () => {
  await assert.rejects(verify({ paths: { out: '/tmp' } }, { file: '/tmp/video.gif' }), /verify checks MP4 files/);
});
