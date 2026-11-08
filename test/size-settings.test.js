// Settings for one size: "sizes" in video.json, the order the settings come in,
// the build folder of a size with a pace of its own, the cover of tall videos and
// the numbers formats prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject, normalizeConfig, outputPath, sizeArg, FORMATS, ProjectError } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';
import { renderIdentity } from '../src/pipeline.js';
import { coverSpec, planExtras } from '../src/render.js';
import { resolveTimes } from '../src/qa.js';
import { packageOverrides } from '../src/package.js';
import { continueCommand } from '../src/history.js';
import { layoutAreas } from '../engine/layout.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const examples = fileURLToPath(new URL('../examples/', import.meta.url));

function project(t, settings = {}, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-sizes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n## intro {min=3}\n## outro {min=2}\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {}, outro() {} };');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const SPANISH = '# Prueba\n## intro {min=3}\n## outro {min=2}\n';
const pick = (cfg) => ({ size: cfg.size, captions: cfg.captions, cover: cfg.cover, pace: cfg.pace, watermark: cfg.watermark });

test('the settings come in order: general, the language, the size, then the run and the platform', (t) => {
  const settings = {
    captions: true, cover: 'intro@1', pace: 1.05, watermark: 'example.com',
    languages: { es: { cover: 'intro@2', pace: 1.1, watermark: 'ejemplo.com' } },
    sizes: { tiktok: { captions: 'bold', pace: 1.2, watermark: 'tiktok.example.com' } },
  };
  const dir = project(t, settings, { 'script.es.md': SPANISH });
  assert.deepEqual(pick(loadProject(dir).config), { size: '16:9', captions: true, cover: 'intro@1', pace: 1.05, watermark: 'example.com' });
  assert.deepEqual(pick(loadProject(dir, { lang: 'es' }).config), { size: '16:9', captions: true, cover: 'intro@2', pace: 1.1, watermark: 'ejemplo.com' });
  assert.deepEqual(pick(loadProject(dir, { size: 'tiktok' }).config), { size: 'tiktok', captions: 'bold', cover: 'intro@1', pace: 1.2, watermark: 'tiktok.example.com' });
  // The block wins over the language, and what the block leaves out comes from the language.
  assert.deepEqual(pick(loadProject(dir, { lang: 'es', size: 'tiktok' }).config), { size: 'tiktok', captions: 'bold', cover: 'intro@2', pace: 1.2, watermark: 'tiktok.example.com' });
  // --no-watermark wins over the block.
  assert.equal(loadProject(dir, { size: 'tiktok', watermark: false }).config.watermark, false);
  // A TikTok package has no watermark, whatever the block says.
  const own = loadProject(dir);
  assert.deepEqual(packageOverrides(own, 'tiktok'), { size: 'tiktok', watermark: false });
  assert.equal(loadProject(dir, packageOverrides(own, 'tiktok')).config.watermark, false);
  // A language's size picks the block too.
  const sized = project(t, { languages: { es: { size: 'tiktok' } }, sizes: { tiktok: { captions: 'bold' } } }, { 'script.es.md': SPANISH });
  assert.equal(loadProject(sized, { lang: 'es' }).config.captions, 'bold');
  assert.equal(loadProject(sized).config.captions, false);
});

test('a block follows its exact size name, so youtube and 16:9 are two names with two blocks', () => {
  const settings = { sizes: { '16:9': { captions: true }, youtube: { pace: 1.2 }, '1080x1350': { captions: 'bold' } } };
  const at = (size) => pick(normalizeConfig(settings, '.', { overrides: { size } }));
  assert.deepEqual(at('16:9'), { size: '16:9', captions: true, cover: 'auto', pace: 1, watermark: 'explainroo.com' });
  assert.deepEqual(at('youtube'), { size: 'youtube', captions: false, cover: 'auto', pace: 1.2, watermark: 'explainroo.com' });
  assert.deepEqual(pick(normalizeConfig(settings)), at('16:9'), 'the default size is 16:9');
  assert.equal(at('1080x1350').captions, 'bold');
  assert.equal(at('linkedin').captions, true, 'linkedin gives 1080x1350 and has no block');
  assert.equal(at('instagram').captions, true);
});

test('a block takes captions, cover, pace, watermark and targetSeconds with the checks of the top level, and its name must be a size', () => {
  const four = /A size can set captions, cover, pace, watermark and targetSeconds\./;
  for (const [settings, message] of [
    [{ sizes: [] }, /^sizes must be an object like \{ "tiktok": \{ "captions": "bold", "pace": 1\.2 \} \}$/],
    [{ sizes: 'tiktok' }, /^sizes must be an object/],
    [{ sizes: { tiktok: 'bold' } }, /^sizes\.tiktok must be an object with the settings of that size/],
    [{ sizes: { tiktok: { theme: 'chalk' } } }, /^sizes\.tiktok has setting\(s\) that can't be set for one size: theme\./],
    [{ sizes: { tiktok: { size: 'youtube', fps: 60 } } }, /: size, fps\. A size can set/],
    [{ sizes: { myspace: {} } }, /^sizes: "myspace" is not a size\. Name each block after a size the way "size" takes one: a format \(youtube, shorts, .*\), a ratio \(16:9, 9:16, 1:1, 4:5\) or WIDTHxHEIGHT in even numbers\.$/],
    [{ sizes: { '1081x1350': {} } }, /^sizes: "1081x1350" is not a size/],
    [{ sizes: { constructor: {} } }, /^sizes: "constructor" is not a size/],
    [{ sizes: { tiktok: { pace: 3 } } }, /^sizes\.tiktok: pace must be between 0\.7 and 1\.6/],
    [{ sizes: { tiktok: { captions: 'big' } } }, /^sizes\.tiktok: captions must be true, false, "auto" or "bold"$/],
    [{ sizes: { tiktok: { cover: 'intro@' + 'x' } } }, /^sizes\.tiktok: cover must be "auto", seconds like 12\.5, or a still spec like "intro@end"$/],
    [{ sizes: { tiktok: { watermark: 'x'.repeat(41) } } }, /^sizes\.tiktok: watermark must be false or a short text/],
    [{ speed: 1.2, sizes: { tiktok: { pace: 1.6 } } }, /^sizes\.tiktok: speed 1\.2 times pace 1\.6 makes the voice too fast/],
    [{ languages: { es: { sizes: { tiktok: { pace: 1.2 } } } } }, /^languages\.es has setting\(s\) that can't be set for one language: sizes$/],
  ]) {
    assert.throws(() => normalizeConfig(settings), (e) => e instanceof ProjectError && message.test(e.message), JSON.stringify(settings));
  }
  assert.throws(() => normalizeConfig({ sizes: { tiktok: { theme: 'chalk' } } }), (e) => four.test(e.message));
  // A mistake in the general settings is theirs, also at a size with a block.
  assert.throws(() => normalizeConfig({ fps: 31, sizes: { tiktok: { pace: 1.2 } } }, '.', { overrides: { size: 'tiktok' } }), (e) => e.message === 'fps must be 24, 25, 30, 50 or 60');
  // Every block is checked, also when another size is asked for. A note in a block is fine.
  assert.throws(() => normalizeConfig({ sizes: { tiktok: { pace: 3 } } }, '.', { overrides: { size: 'youtube' } }), (e) => /^sizes\.tiktok: pace/.test(e.message));
  assert.equal(normalizeConfig({ sizes: { tiktok: { _note: 'for the hook', pace: 1.2 } } }, '.', { overrides: { size: 'tiktok' } }).pace, 1.2);
  // Bold captions in a block don't suit Japanese, which stops only the Japanese version at that size.
  const ja = { languages: { ja: {} }, sizes: { tiktok: { captions: 'bold' } } };
  assert.equal(normalizeConfig(ja, '.', { language: 'ja' }).captions, false);
  assert.throws(() => normalizeConfig(ja, '.', { language: 'ja', overrides: { size: 'tiktok' } }), (e) => /^sizes\.tiktok: "captions": "bold" does not work for Japanese.* The block of a size comes after "languages", so the Japanese version gets the captions of the block too\.$/.test(e.message));
});

test('"sizes" leaves the resolved settings, so one block never changes another size or a project without blocks', (t) => {
  const dir = project(t, { sizes: { tiktok: { captions: 'bold' } } });
  const identity = (overrides) => {
    const p = loadProject(dir, overrides);
    assert.equal('sizes' in p.config, false);
    return renderIdentity(p, buildTimeline(p, {}));
  };
  const wide = identity({});
  const tall = identity({ size: 'tiktok' });
  const reels = identity({ size: 'reels' });
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ sizes: { tiktok: { captions: true }, reels: { pace: 1.1 } } }));
  assert.equal(identity({}), wide);
  assert.notEqual(identity({ size: 'tiktok' }), tall);
  assert.notEqual(identity({ size: 'reels' }), reels);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({}));
  assert.equal(identity({}), wide, 'a project without blocks has the identity it had');
  // A block adds no suffix to any file name.
  const sized = project(t, { sizes: { youtube: { watermark: false }, '16:9': { watermark: false } } });
  assert.equal(outputPath(loadProject(sized), 'video', '.mp4'), path.join(sized, 'out', 'video.mp4'));
  assert.equal(outputPath(loadProject(sized, { size: 'youtube' }), 'video', '.mp4'), path.join(sized, 'out', 'video-youtube.mp4'));
});

test('every example resolves to the settings it had before size blocks, as it is and as a TikTok package', () => {
  // Made with the settings code from before "sizes", and the same with every example's own video.json.
  const before = JSON.parse(fs.readFileSync(new URL('./fixtures/example-settings.json', import.meta.url), 'utf8'));
  const names = fs.readdirSync(examples).filter((name) => fs.existsSync(path.join(examples, name, 'video.json'))).sort();
  assert.deepEqual(names, Object.keys(before));
  for (const name of names) {
    const dir = path.join(examples, name);
    assert.deepEqual(loadProject(dir).config, before[name].own, name);
    assert.deepEqual(loadProject(dir, { size: 'tiktok', watermark: false }).config, before[name]['tiktok without the watermark'], `${name} as a TikTok package`);
  }
});

test('a size whose block gives its own pace builds in build/pace-<pace>/, also for another language', (t) => {
  const dir = project(t, { languages: { es: {} }, sizes: { tiktok: { pace: 1.2, captions: 'bold' }, reels: { pace: 1 }, shorts: { pace: 1.2 } } }, { 'script.es.md': SPANISH });
  const paths = (overrides) => loadProject(dir, overrides).paths;
  assert.equal(paths({}).build, path.join(dir, 'build'));
  assert.equal(paths({ size: 'tiktok' }).build, path.join(dir, 'build', 'pace-1.2'));
  assert.equal(paths({ size: 'tiktok' }).voice, path.join(dir, 'build', 'pace-1.2', 'voice'));
  assert.equal(paths({ size: 'shorts' }).voice, paths({ size: 'tiktok' }).voice, 'two sizes at one pace share their narration');
  assert.equal(paths({ size: 'reels' }).build, path.join(dir, 'build'), 'a block with the general pace has no folder of its own');
  assert.equal(paths({ size: 'tiktok', lang: 'es' }).build, path.join(dir, 'build', 'es', 'pace-1.2'));
  assert.equal(paths({ size: 'tiktok' }).out, path.join(dir, 'out'));
  assert.equal(paths({ size: 'tiktok', lang: 'es' }).out, path.join(dir, 'out', 'es'));
  assert.deepEqual(loadProject(dir, { size: 'tiktok' }).ownPace, { size: 'tiktok', pace: 1.2 });
  assert.equal(sizeArg(loadProject(dir, { size: 'tiktok' })), ' --size tiktok');
  assert.equal(sizeArg(loadProject(dir, { size: 'reels' })), '');
  assert.equal(buildTimeline(loadProject(dir, { size: 'tiktok' }), { intro: { duration: 1, words: [], marks: {}, chunks: [] } }).scenes[0].voice.url, 'build/pace-1.2/voice/intro.wav');
  // A project whose own size has a block speaks at the general pace at every other size.
  const tall = project(t, { size: 'tiktok', pace: 1.1, sizes: { tiktok: { pace: 1.3 } } });
  assert.equal(loadProject(tall).paths.build, path.join(tall, 'build', 'pace-1.3'));
  assert.equal(loadProject(tall, { size: 'youtube' }).paths.build, path.join(tall, 'build'));
  assert.equal(loadProject(tall, { size: 'youtube' }).config.pace, 1.1);
  // A project without blocks keeps its paths.
  const plain = project(t, { pace: 1.2 });
  assert.equal(loadProject(plain, { size: 'tiktok' }).paths.build, path.join(plain, 'build'));
  assert.equal(loadProject(plain).ownPace, null);
});

test('package uses the platform\'s own block first, and a project without blocks packages as before', (t) => {
  const instagram = (sizes) => loadProject(project(t, { size: 'instagram', ...(sizes ? { sizes } : {}) }));
  assert.deepEqual(packageOverrides(instagram(), 'linkedin'), {}, 'the same frame and free area, so the instagram render can be reused');
  assert.deepEqual(packageOverrides(instagram({ linkedin: { captions: false } }), 'linkedin'), { size: 'linkedin' });
  assert.deepEqual(packageOverrides(instagram({ instagram: { pace: 1.1 } }), 'linkedin'), {}, 'a block of the project\'s own size changes nothing here');
  const wide = (sizes) => loadProject(project(t, { ...(sizes ? { sizes } : {}) }));
  assert.deepEqual(packageOverrides(wide(), 'youtube'), {});
  assert.deepEqual(packageOverrides(wide({ youtube: { captions: true } }), 'youtube'), { size: 'youtube' });
  assert.deepEqual(packageOverrides(wide({ '16:9': { captions: true } }), 'youtube'), {}, 'a 16:9 block is not the youtube block');
  assert.deepEqual(packageOverrides(wide({ youtube: { pace: 1.2 } }), 'x', 'youtube'), { size: 'youtube' }, 'X with --size looks for that size\'s block');
  const tiktok = loadProject(project(t, { size: 'tiktok', sizes: { tiktok: { watermark: 'tiktok.example.com' } } }));
  assert.deepEqual(packageOverrides(tiktok, 'tiktok'), { watermark: false }, 'the project\'s own size stays, with its block');
});

test('an automatic cover is worked out in the page at every size, and a cover that is set wins', (t) => {
  const dir = project(t);
  for (const size of ['shorts', 'tiktok', 'reels', 'vertical', 'youtube', '16:9', 'square', '1:1', 'linkedin', 'instagram', '4:5', '9:16', '1080x1920']) {
    const p = loadProject(dir, { size });
    const tl = buildTimeline(p, {});
    assert.equal(coverSpec(p.config), 'auto', size);
    assert.deepEqual(planExtras(p, tl).coverTime, { auto: true, T: null, label: 'auto' }, size);
  }
  // A cover at the top or in a block wins over "auto".
  const set = project(t, { cover: 'outro@0.5', sizes: { reels: { cover: 'intro@2' } } });
  assert.equal(planExtras(loadProject(set, { size: 'tiktok' }), buildTimeline(loadProject(set, { size: 'tiktok' }), {})).coverTime.T, 3.5);
  assert.equal(planExtras(loadProject(set, { size: 'reels' }), buildTimeline(loadProject(set, { size: 'reels' }), {})).coverTime.T, 2);
  // A cover past the end of its scene gives the scene's last frame.
  const short = project(t, { cover: 'intro@5' });
  fs.writeFileSync(path.join(short, 'script.md'), '# Test\n## intro {min=1}\n## outro {min=2}\n');
  const p = loadProject(short);
  const tl = buildTimeline(p, {});
  assert.equal(planExtras(p, tl).coverTime.T, resolveTimes(tl, ['intro@5'])[0].T);
  assert.ok(planExtras(p, tl).coverTime.T < 1);
});

test('formats prints the content area with and without the watermark, the same areas check uses', (t) => {
  const r = spawnSync(process.execPath, [bin, 'formats', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { formats } = JSON.parse(r.stdout);
  assert.deepEqual(formats.map((f) => f.name), Object.keys(FORMATS));
  // check hands the page the project's settings, and the page measures its areas with layoutAreas.
  const dir = project(t);
  const area = (overrides) => {
    const { config } = loadProject(dir, overrides);
    const { safe } = layoutAreas(config, config.width, config.height);
    return { x: safe.x, y: safe.y, w: safe.w, h: safe.h };
  };
  for (const f of formats) {
    assert.deepEqual(f.content, area({ size: f.name }), `${f.name} with the watermark`);
    assert.deepEqual(f.content_without_watermark, area({ size: f.name, watermark: false }), `${f.name} without the watermark`);
  }
  const tiktok = formats.find((f) => f.name === 'tiktok');
  assert.ok(tiktok.content_without_watermark.y < tiktok.content.y, 'the watermark moves the top down on TikTok');
  assert.equal(tiktok.content_without_watermark.y + tiktok.content_without_watermark.h, tiktok.content.y + tiktok.content.h);
  const text = spawnSync(process.execPath, [bin, 'formats'], { encoding: 'utf8' }).stdout;
  const { content: on, content_without_watermark: off } = tiktok;
  assert.ok(text.includes(`content area ${on.w}x${on.h} at ${on.x},${on.y} with the watermark, ${off.w}x${off.h} at ${off.x},${off.y} without it, captions below it`), text);
  assert.match(text, /"check --size <name> --no-watermark" the one without it/);
});

test('the command that continues a paid sentence at the pace of a size names the size, and a strange size never reaches it', () => {
  const job = (fields) => ({ kind: 'speech', key: 'abc', attempt: 1, ...fields });
  assert.match(continueCommand('/tmp/x', job({ size: 'tiktok' }), 'lost'), / voice \S+ --size tiktok --new$/);
  assert.match(continueCommand('/tmp/x', job({ lang: 'es', size: 'tiktok' }), 'lost'), / voice \S+ --lang es --size tiktok --new$/);
  assert.match(continueCommand('/tmp/x', job({ size: '9:16' }), 'running'), / voice \S+ --size 9:16$/);
  assert.doesNotMatch(continueCommand('/tmp/x', job({}), 'lost'), /--size/);
  for (const size of ['9:16; rm -rf ~', 'constructor', 'myspace', 3, null]) assert.doesNotMatch(continueCommand('/tmp/x', job({ size }), 'lost'), /--size|rm -rf/, String(size));
});
