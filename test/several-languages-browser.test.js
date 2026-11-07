// One video in several languages through the real command line: each language
// draws its own strings and writes into out/<lang>/, and package, share and
// publish use that language's file and link, never the main language's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { sha256File } from '../src/history.js';
import { runCli as cli } from './helpers/tiny-project.js';
import { startFakeServices } from './helpers/fake-services.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome = null;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

// Two scenes without narration, so no voice model is needed. The words on
// screen come from the strings of each language.
function bakery(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-bakery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    'video.json': JSON.stringify({ size: '320x180', theme: 'clean', fps: 24, motionBlur: false, sfx: false, end: 0, ...settings }),
    'script.md': '# Making bread\n\n## intro {min=1}\n\n## outro {min=1}\n',
    'script.es.md': '# Cómo hacer pan\n\n## intro {min=1}\n\n## outro {min=1}\n',
    'strings.json': JSON.stringify({ title: 'Bread', steps: { first: 'Flour' } }),
    'strings.es.json': JSON.stringify({ title: 'Pan', steps: { first: 'Harina' } }),
    'scenes.js': [
      'export default {',
      "  intro(s) { s.text(s.str('title'), { x: s.cx, y: s.safe.y + s.safe.h * 0.35, size: 22, at: 0 }); s.text(s.lang, { x: s.cx, y: s.safe.y + s.safe.h * 0.7, size: 14, at: 0 }); },",
      "  outro(s) { s.text(s.str('steps.first'), { x: s.cx, y: s.cy, size: 22, at: 0 }); },",
      '};',
    ].join('\n'),
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

async function json(args, env) {
  const r = await cli([...args, '--json'], env);
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  return { ...r, out };
}

test('--lang picks the language, and a language with no script is an error that lists the ones there are', async (t) => {
  const dir = bakery(t);
  const r = await json(['voice', dir, '--lang', 'fr']);
  assert.equal(r.code, 1);
  assert.match(r.out.error, /this video has no fr version\. Add script\.fr\.md for it\. The languages it has: en, es/);
  const missing = await json(['check', dir, '--lang']);
  assert.equal(missing.code, 1);
  assert.match(missing.out.error, /--lang needs a value/);
});

test('each language draws its own strings into its own folder, and check names a missing text', { skip, timeout: 240000 }, async (t) => {
  const dir = bakery(t);
  for (const lang of [[], ['--lang', 'es']]) {
    const r = await json(['check', dir, ...lang]);
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(r.out.issues.filter((i) => i.level !== 'hint'), [], r.text);
  }
  const main = await json(['still', dir, 'intro@end']);
  const es = await json(['still', dir, 'intro@end', '--lang', 'es']);
  assert.equal(main.code, 0, main.text);
  assert.equal(es.code, 0, es.text);
  assert.equal(main.out.stills[0].file, path.join(dir, 'out/stills/intro@end.png'));
  assert.equal(es.out.stills[0].file, path.join(dir, 'out/es/stills/intro@end.png'));
  assert.notEqual(sha256File(main.out.stills[0].file), sha256File(es.out.stills[0].file), 'the Spanish frame shows other words');

  // A text that only one language has: a warning in every check, and an error where a scene needs it.
  fs.writeFileSync(path.join(dir, 'strings.json'), JSON.stringify({ title: 'Bread', steps: { first: 'Flour', second: 'Water' } }));
  fs.writeFileSync(path.join(dir, 'scenes.js'), fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8').replace("s.str('steps.first')", "s.str('steps.second')"));
  const english = await json(['check', dir]);
  assert.equal(english.code, 0, english.text);
  assert.deepEqual(english.out.issues.filter((i) => i.level === 'warn').map((i) => i.message), ['strings.es.json is missing 1 text that another language has: "steps.second"']);
  const spanish = await json(['check', dir, '--lang', 'es']);
  assert.equal(spanish.code, 1);
  const error = spanish.out.issues.find((i) => i.level === 'error');
  assert.equal(error.scene, 'outro');
  assert.match(error.message, /s\.str\("steps\.second"\): strings\.es\.json has no "steps\.second"\. Close keys: steps\.first/);

  // A render of one language leaves the other language's files alone.
  fs.writeFileSync(path.join(dir, 'scenes.js'), fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8').replace("s.str('steps.second')", "s.str('steps.first')"));
  const before = sha256File(main.out.stills[0].file);
  const video = await json(['render', dir, '--lang', 'es', '--workers', '1']);
  assert.equal(video.code, 0, video.text);
  assert.equal(video.out.out, path.join(dir, 'out/es/video.mp4'));
  assert.ok(fs.existsSync(path.join(dir, 'out/es/video.cover.jpg')));
  assert.ok(fs.existsSync(path.join(dir, 'build/es/timeline.json')));
  assert.equal(fs.existsSync(path.join(dir, 'out/video.mp4')), false);
  assert.equal(sha256File(main.out.stills[0].file), before);

  // The web player of one language carries its strings in its state, because it never reads JSON from the project.
  const player = await json(['export', dir, '--lang', 'es']);
  assert.equal(player.code, 0, player.text);
  assert.equal(player.out.out, path.join(dir, 'out/es/player'));
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'out/es/player/state.json'), 'utf8'));
  assert.deepEqual(state.text.strings, { title: 'Pan', 'steps.first': 'Harina' });
  assert.equal(state.config.language, 'es');
  assert.ok(fs.existsSync(path.join(dir, 'out/es/player/audio.m4a')));
});

test('a word cue that only one language says fails there, and the message says why', { skip, timeout: 120000 }, async (t) => {
  const dir = bakery(t);
  fs.writeFileSync(path.join(dir, 'script.md'), '# Making bread\n\n## intro {min=1}\n\n## outro\nBread needs flour.\n');
  fs.writeFileSync(path.join(dir, 'script.es.md'), '# Cómo hacer pan\n\n## intro {min=1}\n\n## outro\nEl pan necesita harina.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text(s.str('title'), { x: s.cx, y: s.cy, size: 22, at: 0 }); }, outro(s) { s.text(s.str('steps.first'), { x: s.cx, y: s.cy, size: 22, at: 'flour' }); } };");
  // Both versions have their narration made already, so no voice model loads.
  cachedVoice(dir, 'outro');
  cachedVoice(dir, 'outro', 'es');
  const english = await json(['check', dir]);
  assert.equal(english.code, 0, english.text);
  const spanish = await json(['check', dir, '--lang', 'es']);
  assert.equal(spanish.code, 1);
  assert.match(spanish.out.issues.find((i) => i.level === 'error').message, /cue\("flour"\) is not in the narration of scene "outro"\. Close words: .*\. Word cues differ between languages, so a scene that every language draws is safer with the same \[#marker\] in each script\./);
});

test('package, share and publish with --lang use that language\'s package, file and link', { skip, timeout: 400000 }, async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-bakery-settings-'));
  t.after(() => fs.rmSync(settings, { recursive: true, force: true }));
  const env = { ...fake.env, EXPLAINROO_CONFIG: settings, EXPLAINROO_CLOUD_KEY: '', BUFFER_CLIENT_ID: '', BUFFER_ACCESS_TOKEN: '', BUFFER_REFRESH_TOKEN: '', BUFFER_TOKEN_EXPIRES: '' };
  const dir = bakery(t);
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ description: 'How bread is made.', hashtags: ['bread'] }));
  fs.writeFileSync(path.join(dir, 'post.es.json'), JSON.stringify({ description: 'Cómo se hace el pan.', hashtags: ['pan'] }));

  // No Spanish video yet: share says which file is missing, with the language in the command.
  const early = await json(['share', dir, '--lang', 'es'], env);
  assert.equal(early.code, 1);
  assert.match(early.out.error, /out\/es\/video\.mp4 does not exist yet\. Run ".* render .* --lang es" first/);

  const packages = {};
  for (const lang of [[], ['--lang', 'es']]) {
    const r = await json(['package', dir, '--platform', 'tiktok', '--workers', '1', ...lang], env);
    assert.equal(r.code, 0, r.text);
    packages[lang.length ? 'es' : 'en'] = r;
  }
  const es = packages.es.out;
  assert.equal(es.folder, path.join(dir, 'out/es/package/tiktok'));
  assert.equal(packages.en.out.folder, path.join(dir, 'out/package/tiktok'));
  assert.equal(es.post.title, 'Cómo hacer pan');
  assert.equal(es.post.text, 'Cómo se hace el pan.\n\n#pan');
  assert.equal(packages.en.out.post.text, 'How bread is made.\n\n#bread');
  assert.notEqual(es.post.sha256, packages.en.out.post.sha256);

  // The main language shares first, so it has a link of its own.
  const shared = {};
  for (const lang of [[], ['--lang', 'es']]) {
    const r = await json(['share', dir, '--platform', 'tiktok', ...lang], env);
    assert.equal(r.code, 0, r.text);
    shared[lang.length ? 'es' : 'en'] = r.out;
  }
  assert.equal(shared.es.file, 'out/es/package/tiktok/video.mp4');
  assert.equal(shared.en.file, 'out/package/tiktok/video.mp4');
  assert.notEqual(shared.es.media_url, shared.en.media_url);
  const uploads = fake.requests('cloud', 'POST /api/v1/shares');
  assert.equal(uploads.length, 2);
  assert.ok(uploads[1].raw.includes(fs.readFileSync(path.join(dir, 'out/es/package/tiktok/video.mp4'))), 'the Spanish file went up');

  for (const [lang, flags] of [['es', ['--lang', 'es']], ['en', []]]) {
    const r = await json(['publish', dir, '--via', 'buffer', '--platform', 'tiktok', '--dry-run', ...flags], env);
    assert.equal(r.code, 0, r.text);
    assert.equal(r.out.plan.media.from, 'share');
    assert.equal(r.out.plan.media.url, shared[lang].media_url, lang);
    assert.equal(r.out.request.variables.input.assets[0].video.url, shared[lang].media_url, lang);
    assert.equal(r.out.plan.file.sha256, packages[lang].out.post.sha256, lang);
  }
  // A language without a share link of its own never borrows the main language's.
  fs.rmSync(path.join(dir, 'history/jobs'), { recursive: true });
  const none = await json(['publish', dir, '--via', 'buffer', '--platform', 'tiktok', '--dry-run', '--lang', 'es'], env);
  assert.equal(none.code, 0, none.text);
  assert.equal(none.out.plan.media.url, null);
  assert.match(none.out.missing.join(' '), /share .* --lang es --platform tiktok/);
});
