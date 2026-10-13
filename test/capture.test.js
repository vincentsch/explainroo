import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capture, validateUrl, pickColors, rankLogos, isGoogleFont } from '../src/capture.js';

test('capture accepts only HTTP URLs without login credentials', () => {
  assert.equal(validateUrl('https://example.com/demo').hostname, 'example.com');
  assert.equal(validateUrl('http://127.0.0.1:1234/').port, '1234');
  for (const value of ['file:///tmp/page.html', 'data:text/html,hello', 'ftp://example.com', 'example.com', '', undefined, 'http://../']) {
    assert.throws(() => validateUrl(value), /http:\/\/ or https:\/\//);
  }
  assert.throws(() => validateUrl('https://user:pass@example.com'), /does not log in/);
});

test('accent counts saturated button backgrounds by area and frequency', () => {
  const samples = [
    { color: '#eeeeee', area: 9000 }, { color: '#070707', area: 9000 }, { color: '#888888', area: 9000 },
    { color: '#245CFF', area: 200 }, { color: '#245cff', area: 200 }, { color: '#00aa22', area: 700 },
    { color: '#fffefa', area: 9000 }, { color: null, area: 20 }, { color: '#aa0000', area: 0 },
    { color: '#ee0000', area: 10 }, { color: '#ee00ee', area: 10 },
  ];
  const colors = pickColors(samples, ['#888888']);
  assert.equal(colors.accent, '#245cff');
  assert.equal(colors.other.some((c) => c.color === '#888888'), false);
  assert.equal(colors.other.length, 6);
  assert.ok(colors.other.every((c) => c.share >= 0 && c.share <= 1));
  assert.deepEqual(pickColors([]), { accent: null, other: [] });
  assert.equal(pickColors([{ color: '#aaaaaa' }]).accent, null);
});

test('logos prefer brand SVGs, SVG icons, large PNGs, then the social image', () => {
  const candidates = [
    { url: 'social.png', type: 'png', kind: 'og', area: 100000 },
    { url: 'small.png', type: 'png', kind: 'icon', area: 256 },
    { url: 'large.png', type: 'png', kind: 'icon', area: 10000 },
    { url: 'icon.svg', type: 'svg', kind: 'icon', area: 64 },
    { svg: '<svg/>', type: 'svg', kind: 'brand', area: 32 },
    { url: 'large.png', type: 'png', kind: 'icon', area: 10000 },
    { url: 'photo.jpg', type: 'jpg', kind: 'og', area: 200000 },
  ];
  assert.deepEqual(rankLogos(candidates).map((c) => c.url || c.svg), ['<svg/>', 'icon.svg', 'large.png', 'small.png', 'social.png']);
});

test('Google font downloads require the exact source host', () => {
  assert.equal(isGoogleFont('https://fonts.gstatic.com/s/inter/v1/font.woff2'), true);
  for (const url of ['https://fonts.googleapis.com/style.css', 'https://fonts.gstatic.com.evil.test/font.woff2', 'https://evil.test/fonts.gstatic.com/a', 'file://fonts.gstatic.com/a', 'bad']) assert.equal(isGoogleFont(url), false);
  assert.equal(isGoogleFont('http://127.0.0.1/font.woff2', (host) => host === '127.0.0.1'), true);
});

test('capture refuses to write through a linked assets folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-capture-link-'));
  try {
    fs.mkdirSync(path.join(dir, 'project'));
    fs.mkdirSync(path.join(dir, 'outside'));
    fs.writeFileSync(path.join(dir, 'project', 'video.json'), '{}');
    fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, 'project', 'assets'), 'junction');
    await assert.rejects(capture(path.join(dir, 'project'), 'http://127.0.0.1'), /not a link or file/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'outside')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
