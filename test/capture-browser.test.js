import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { capture } from '../src/capture.js';
import { normalizeConfig } from '../src/project.js';
import { captureFixture } from './capture-fixture.js';

let chrome;
try { chrome = findChrome(); } catch {}
const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const run = promisify(execFile);
const dimensions = (file) => {
  const png = fs.readFileSync(file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

test('capture saves a local site, its loaded fonts and desktop and phone screenshots', { skip: !chrome }, async () => {
  const site = await captureFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-capture-'));
  try {
    const config = '{"title":"Existing project"}\n';
    fs.writeFileSync(path.join(dir, 'video.json'), config);
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'keep.txt'), 'Keep this file');
    const result = await capture(dir, `${site.url}/redirect`, { mobile: true, googleHostCheck: (host) => host === '127.0.0.1' });
    const root = path.join(dir, 'assets/capture/127.0.0.1');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'capture.json'))), result);
    assert.equal(result.url, `${site.url}/`);
    assert.equal(result.title, 'Fixture Studio');
    assert.equal(result.description, 'A local page for capture tests.');
    assert.equal(result.themeColor, '#245cff');
    assert.equal(result.colors.accent, '#245cff');
    assert.equal(result.colors.background, '#f8f6f1');
    assert.equal(result.colors.text, '#202020');
    assert.equal(result.colors.heading, '#163469');
    assert.equal(result.colors.link, '#245cff');
    assert.ok(result.colors.other.length <= 6);
    assert.equal(result.fonts.body, 'Fixture Sans');
    assert.deepEqual(result.fonts.headings, ['Fixture Sans']);
    assert.deepEqual(result.fonts.buttons, ['Fixture Sans']);
    assert.equal(result.suggestion.fonts.length, 1);
    assert.equal(result.suggestion.fonts[0].weight, 400);
    assert.equal(site.requests.includes('/unused.woff2'), false);
    assert.deepEqual(fs.readFileSync(path.join(dir, result.suggestion.fonts[0].src)), fs.readFileSync(path.join(site.dir, 'fixture.woff2')));
    // fonts.json says where each saved file came from. Inter comes with explainroo, so it stays out.
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'fonts/fonts.json'), 'utf8'));
    assert.deepEqual(saved, [{ family: 'Fixture Sans', weight: 400, style: 'normal', file: result.suggestion.fonts[0].src, source: saved[0].source }]);
    assert.match(saved[0].source, /^http:\/\/127\.0\.0\.1:\d+\/fixture\.woff2$/);
    assert.deepEqual(result.fonts.saved, saved);
    assert.deepEqual(result.fonts.families.map((f) => f.family), ['Fixture Sans', 'Inter']);
    // The desktop and the phone page each load the fonts once.
    assert.equal(site.requests.filter((r) => r === '/inter.woff2').length, 2);
    assert.ok(result.notes.includes('Inter is built into explainroo. It needs no font files.'));
    assert.ok(result.notes.includes('Fixture Sans: saved 1 font file from Google Fonts in assets/capture/127.0.0.1/fonts/, check the license before you publish.'), result.notes.join('\n'));
    // The file came with the page, so capture didn't ask for it again.
    assert.equal(site.requests.filter((r) => r === '/fixture.woff2').length, 2);
    // The readable text in page order, without what is hidden.
    const text = result.text.body;
    assert.equal(result.text.bodyCut, false);
    for (const words of ['Fixture Studio', 'Build a clear product demo', 'Keep your colors, fonts and wording together. Start it with npx explainroo.', 'Capture once, use the files', 'A long page checks the screenshot height limit.']) assert.ok(text.includes(words), words);
    assert.ok(text.indexOf('Build a clear product demo') < text.indexOf('Keep your colors') && text.indexOf('Keep your colors') < text.indexOf('Your brand on every screen'));
    assert.doesNotMatch(text, /Hidden action|Hidden placeholder/);
    // The images in page order, with what they show and whether they are on the first screen.
    assert.deepEqual(result.images, [
      { src: `${site.url}/photo.png`, alt: 'The demo editor with two scenes', width: 320, height: 180, naturalWidth: 1, naturalHeight: 1, firstScreen: true },
      { src: `${site.url}/social.png`, alt: '', width: 64, height: 64, naturalWidth: 1, naturalHeight: 1, firstScreen: false },
    ]);
    assert.deepEqual(result.text.h1, ['Build a clear product demo']);
    assert.deepEqual(result.text.h2, ['Your brand on every screen', 'Capture once, use the files']);
    assert.deepEqual(result.text.navigation, ['Features', 'Plans']);
    assert.deepEqual(result.text.buttons, ['Start a project', 'See examples', 'Create project']);
    assert.deepEqual(result.text.labels, ['Project name']);
    assert.deepEqual(result.text.placeholders, ['My first demo']);
    assert.equal(result.brand.logo, 'assets/capture/127.0.0.1/logo.svg');
    assert.equal(result.logo.picked, result.brand.logo);
    assert.deepEqual(result.logo.candidates.map((c) => path.basename(c.file)), ['logo.svg', 'logo-2.svg', 'logo-3.png']);
    assert.match(fs.readFileSync(path.join(root, 'logo.svg'), 'utf8'), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(fs.readFileSync(path.join(root, 'logo.svg'), 'utf8'), /fill: rgb\(36, 92, 255\)/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'logo.svg'), 'utf8'), /currentColor/i);
    assert.deepEqual(dimensions(path.join(root, 'page.png')), [2880, 1800]);
    assert.deepEqual(dimensions(path.join(root, 'full.png')), [2880, 16000]);
    assert.deepEqual(dimensions(path.join(root, 'mobile.png')), [780, 1688]);
    assert.deepEqual(dimensions(path.join(root, 'mobile-full.png')), [780, 16000]);
    assert.ok(result.files.every((file) => fs.existsSync(path.join(dir, file))));
    assert.deepEqual(normalizeConfig(result.suggestion).brand, result.brand);
    assert.equal(fs.readFileSync(path.join(dir, 'video.json'), 'utf8'), config);
    assert.equal(fs.readFileSync(path.join(dir, 'assets', 'keep.txt'), 'utf8'), 'Keep this file');
    await assert.rejects(capture(dir, `${site.url}/missing`), /page did not load/);
    assert.ok(fs.existsSync(path.join(root, 'mobile.png')));
    fs.writeFileSync(path.join(root, 'stale.txt'), 'old capture');
    const cli = await run(process.execPath, [bin, 'capture', dir, site.url, '--json'], { timeout: 60000 });
    const json = JSON.parse(cli.stdout);
    assert.equal(json.colors.accent, '#245cff');
    // Any font the page loaded is saved, not only those from Google Fonts.
    assert.equal(json.suggestion.fonts.length, 1);
    assert.ok(json.notes.includes('Fixture Sans: saved 1 font file in assets/capture/127.0.0.1/fonts/, check the license before you publish.'), json.notes.join('\n'));
    assert.equal(fs.existsSync(path.join(root, 'stale.txt')), false);
    assert.equal(fs.existsSync(path.join(root, 'mobile.png')), false);
    const human = await run(process.execPath, [bin, 'capture', '--mobile', site.url], { cwd: dir, timeout: 60000 });
    assert.match(human.stdout, /accent: #245cff/);
    assert.match(human.stdout, /logo: assets\/capture\/127.0.0.1\/logo.svg/);
    assert.match(human.stdout, /Paste into video.json:/);
    assert.match(human.stdout, /^page: [\d,]+ characters of text and 2 images \(1 on the first screen\) in capture\.json$/m);
    assert.match(human.stdout, /^Fixture Sans: saved 1 font file in assets\/capture\/127\.0\.0\.1\/fonts\/, check the license before you publish\.$/m);
    assert.ok(fs.existsSync(path.join(root, 'mobile.png')));
  } finally {
    await site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('named captures of one site stay side by side, and a capture without a name keeps them', { skip: !chrome, timeout: 240000 }, async () => {
  const site = await captureFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-capture-named-'));
  const fonts = { googleHostCheck: (host) => host === '127.0.0.1' };
  const root = path.join(dir, 'assets/capture/127.0.0.1');
  const files = (folder) => fs.readdirSync(folder).sort();
  try {
    fs.writeFileSync(path.join(dir, 'video.json'), '{}');
    for (const name of ['pricing', 'about']) {
      const r = await capture(dir, site.url, { name, ...fonts });
      const folder = `assets/capture/127.0.0.1/${name}`;
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, folder, 'capture.json'))), r);
      assert.deepEqual(r.files, [`${folder}/capture.json`, `${folder}/fonts/Fixture-Sans-400-1.woff2`, `${folder}/fonts/fonts.json`, `${folder}/full.png`, `${folder}/logo-2.svg`, `${folder}/logo-3.png`, `${folder}/logo.svg`, `${folder}/page.png`]);
      assert.ok(r.files.every((file) => fs.existsSync(path.join(dir, file))));
      assert.equal(r.brand.logo, `${folder}/logo.svg`);
      assert.deepEqual(r.suggestion.fonts.map((f) => f.src), [`${folder}/fonts/Fixture-Sans-400-1.woff2`]);
    }
    assert.deepEqual(files(root), ['about', 'pricing']);
    fs.writeFileSync(path.join(root, 'about', 'notes.txt'), 'mine');

    // Without a name, capture writes the site's folder as before and keeps the pages in it.
    const plain = await capture(dir, site.url, fonts);
    assert.equal(plain.brand.logo, 'assets/capture/127.0.0.1/logo.svg');
    assert.deepEqual(files(root), ['about', 'capture.json', 'fonts', 'full.png', 'logo-2.svg', 'logo-3.png', 'logo.svg', 'page.png', 'pricing']);
    assert.ok(plain.files.every((file) => !file.includes('/pricing/') && !file.includes('/about/')));
    assert.equal(fs.readFileSync(path.join(root, 'about', 'notes.txt'), 'utf8'), 'mine');
    // Again without a name: its own old files go, the named folders stay.
    fs.writeFileSync(path.join(root, 'stale.txt'), 'old capture');
    await capture(dir, site.url, { mobile: true, ...fonts });
    assert.equal(fs.existsSync(path.join(root, 'stale.txt')), false);
    assert.ok(fs.existsSync(path.join(root, 'mobile.png')));
    assert.deepEqual(files(path.join(root, 'pricing')), ['capture.json', 'fonts', 'full.png', 'logo-2.svg', 'logo-3.png', 'logo.svg', 'page.png']);
    assert.equal(fs.readFileSync(path.join(root, 'about', 'notes.txt'), 'utf8'), 'mine');

    // The same name again replaces only that folder.
    fs.writeFileSync(path.join(root, 'pricing', 'stale.txt'), 'old page');
    const cli = await run(process.execPath, [bin, 'capture', dir, site.url, '--name', 'pricing', '--json'], { timeout: 60000 });
    const json = JSON.parse(cli.stdout);
    assert.equal(json.brand.logo, 'assets/capture/127.0.0.1/pricing/logo.svg');
    assert.equal(fs.existsSync(path.join(root, 'pricing', 'stale.txt')), false);
    assert.ok(fs.existsSync(path.join(root, 'pricing', 'capture.json')));
    assert.equal(fs.readFileSync(path.join(root, 'about', 'notes.txt'), 'utf8'), 'mine');
    assert.ok(fs.existsSync(path.join(root, 'mobile.png')));
    // The printed list, the logo and the block for video.json name the page's folder.
    const human = await run(process.execPath, [bin, 'capture', site.url, '--name', 'home'], { cwd: dir, timeout: 60000 });
    assert.match(human.stdout, /^saved:\n  assets\/capture\/127\.0\.0\.1\/home\/capture\.json\n/);
    assert.match(human.stdout, /logo: assets\/capture\/127\.0\.0\.1\/home\/logo\.svg/);
    assert.match(human.stdout, /"logo": "assets\/capture\/127\.0\.0\.1\/home\/logo\.svg"/);
    assert.deepEqual(files(root).filter((f) => !f.includes('.')), ['about', 'fonts', 'home', 'pricing']);
    // No temp folder is left behind.
    assert.deepEqual(files(path.join(dir, 'assets/capture')), ['127.0.0.1']);
  } finally {
    await site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
