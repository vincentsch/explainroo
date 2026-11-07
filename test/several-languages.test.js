// One video in several languages: script.md is the main language, each
// script.<lang>.md adds one, and strings files hold the on-screen text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { languageIssues, loadProject, normalizeConfig, outputPath, ProjectError, readStrings } from '../src/project.js';
import { ScriptError } from '../src/script.js';
import { buildTimeline } from '../src/timeline.js';
import { makeState, reloadProject } from '../src/pipeline.js';
import { readPostFile, postWords } from '../src/post.js';
import { continueCommand } from '../src/history.js';
import { sceneHash, sceneChunks } from '../src/voice.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function project(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-languages-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const all = {
    'video.json': {},
    'script.md': '# Making bread\n\n## intro\nBread needs four things. [#flour] Flour comes first.\n\n## outro\nThat is all.\n',
    'scenes.js': 'export default { intro() {}, outro() {} };',
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    if (text === null) continue;
    fs.writeFileSync(path.join(dir, name), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
}

const SPANISH = '# Cómo hacer pan\n\n## intro\nEl pan necesita cuatro cosas. [#flour] Primero va la harina.\n\n## outro\nEso es todo.\n';

test('a project with no other language files keeps its paths, its config and its voice cache', (t) => {
  const dir = project(t);
  const p = loadProject(dir);
  assert.equal(p.language, 'en');
  assert.deepEqual(p.languages, ['en']);
  assert.equal(p.strings, null);
  assert.equal(p.paths.build, path.join(dir, 'build'));
  assert.equal(p.paths.out, path.join(dir, 'out'));
  assert.equal(p.paths.voice, path.join(dir, 'build', 'voice'));
  assert.equal(p.paths.script, path.join(dir, 'script.md'));
  assert.equal('languages' in p.config, false);
  assert.equal(outputPath(p, 'video', '.mp4'), path.join(dir, 'out', 'video.mp4'));
  // The state has nothing new, so the page and its version stay as they were.
  const timeline = buildTimeline(p, {});
  const state = makeState(p, timeline);
  assert.equal('text' in state, false);
  assert.equal(timeline.scenes[0].voice, null);
  const withVoice = buildTimeline(p, { intro: { duration: 1, words: [], marks: {}, chunks: [] } });
  assert.equal(withVoice.scenes[0].voice.url, 'build/voice/intro.wav');
  // --lang with the main language is the same project.
  assert.deepEqual(loadProject(dir, { lang: 'en' }).paths, p.paths);
});

test('script.<lang>.md adds a language that builds into build/<lang>/ and out/<lang>/', (t) => {
  const dir = project(t, { 'script.es.md': SPANISH, 'script.pt-br.md': SPANISH.replace('Cómo hacer pan', 'Como fazer pão') });
  const main = loadProject(dir);
  assert.deepEqual(main.languages, ['en', 'es', 'pt-br']);
  assert.equal(main.paths.build, path.join(dir, 'build'));
  const es = loadProject(dir, { lang: 'es' });
  assert.equal(es.language, 'es');
  assert.equal(es.config.language, 'es');
  assert.equal(es.paths.build, path.join(dir, 'build', 'es'));
  assert.equal(es.paths.out, path.join(dir, 'out', 'es'));
  assert.equal(es.paths.voice, path.join(dir, 'build', 'es', 'voice'));
  assert.equal(es.paths.script, path.join(dir, 'script.es.md'));
  assert.equal(es.paths.strings, path.join(dir, 'strings.es.json'));
  assert.equal(es.paths.post, path.join(dir, 'post.es.json'));
  assert.equal(es.script.scenes[0].spoken, 'El pan necesita cuatro cosas. Primero va la harina.');
  // The title comes from the language's own script, and its voice is the language's default.
  assert.equal(es.config.title, 'Cómo hacer pan');
  assert.equal(es.config.voice, 'ef_dora');
  assert.equal(loadProject(dir, { lang: 'pt-br' }).config.voice, 'pf_dora');
  assert.equal(outputPath(loadProject(dir, { lang: 'es', size: 'tiktok' }), 'video', '.mp4'), path.join(dir, 'out', 'es', 'video-tiktok.mp4'));
  const withVoice = buildTimeline(es, { intro: { duration: 1, words: [], marks: {}, chunks: [] } });
  assert.equal(withVoice.scenes[0].voice.url, 'build/es/voice/intro.wav');
  // Reloading keeps the language.
  assert.equal(reloadProject(loadProject(dir, { lang: 'es', size: 'tiktok' })).language, 'es');
});

test('a language with no script is an error that lists the languages the video has', (t) => {
  const dir = project(t, { 'script.es.md': SPANISH });
  assert.throws(() => loadProject(dir, { lang: 'fr' }), (e) => e instanceof ProjectError && /no fr version/.test(e.message) && /script\.fr\.md/.test(e.message) && /en, es/.test(e.message));
  assert.throws(() => loadProject(dir, { lang: 'de' }), (e) => e instanceof ProjectError && /--lang must be one of en, es, fr, it, pt-br, hi, ja or zh/.test(e.message));
});

test('scripts that are not a language of the video are left alone, and check says so', (t) => {
  const dir = project(t, { 'script.en.md': 'old notes', 'script.de.md': 'Notizen', 'script.old.md': 'old' });
  const p = loadProject(dir);
  assert.deepEqual(p.languages, ['en']);
  assert.deepEqual(languageIssues(p).map((i) => i.message).sort(), [
    'script.de.md is not used: explainroo speaks en, es, fr, it, pt-br, hi, ja or zh, and not de',
    'script.en.md is not used: en is the main language, and its narration is script.md',
  ]);
});

test('script errors name the language file', (t) => {
  const dir = project(t, { 'script.es.md': '# Pan\n\n## intro\nUn {error sin cerrar\n' });
  assert.throws(() => loadProject(dir, { lang: 'es' }), (e) => e instanceof ScriptError && e.message.startsWith('script.es.md line 4: '));
  assert.doesNotThrow(() => loadProject(dir));
});

test('languages holds settings for one language, with the same checks as the main settings', () => {
  const cfg = normalizeConfig({ voice: 'am_michael', speed: 1.1, languages: { es: { voice: 'em_alex', title: 'Pan' }, fr: {} } });
  assert.equal(cfg.voice, 'am_michael');
  assert.equal('languages' in cfg, false);
  const es = normalizeConfig({ voice: 'am_michael', speed: 1.1, languages: { es: { voice: 'em_alex', title: 'Pan' } } }, '.', { language: 'es' });
  assert.equal(es.voice, 'em_alex');
  assert.equal(es.title, 'Pan');
  assert.equal(es.speed, 1.1);
  assert.equal(es.language, 'es');
  assert.equal(normalizeConfig({ voice: 'am_michael', languages: { fr: {} } }, '.', { language: 'fr' }).voice, 'ff_siwis');
  assert.equal(normalizeConfig({ voice: { provider: 'elevenlabs', id: 'abc' } }, '.', { language: 'it' }).voice, 'if_sara');
  for (const [languages, message] of [
    [[], /languages must be an object/],
    [{ de: {} }, /languages: "de" is not a language explainroo speaks/],
    [{ en: { voice: 'af_heart' } }, /en is the main language/],
    [{ es: 'ef_dora' }, /languages\.es must be an object/],
    [{ es: { language: 'fr' } }, /can't be set for one language: language/],
    [{ es: { colour: 'red' } }, /can't be set for one language: colour/],
    [{ es: { speed: 9 } }, /languages\.es: speed must be between 0\.6 and 1\.6/],
    [{ es: { voice: 'af_heart' } }, /languages\.es: voice "af_heart" does not speak es/],
  ]) {
    assert.throws(() => normalizeConfig({ languages }), (e) => e instanceof ProjectError && message.test(e.message), JSON.stringify(languages));
  }
});

test('strings files hold the on-screen text, with nested groups as dotted keys', (t) => {
  const dir = project(t, {
    'script.es.md': SPANISH,
    'strings.json': { title: 'Making bread', steps: { first: 'Flour', list: ['Flour', 'Water'] } },
    'strings.es.json': { title: 'Cómo hacer pan', steps: { first: 'Harina' } },
  });
  assert.deepEqual(loadProject(dir).strings, { title: 'Making bread', 'steps.first': 'Flour', 'steps.list': ['Flour', 'Water'] });
  const es = loadProject(dir, { lang: 'es' });
  assert.deepEqual(es.strings, { title: 'Cómo hacer pan', 'steps.first': 'Harina' });
  const state = makeState(es, buildTimeline(es, {}));
  assert.deepEqual(state.text, { strings: es.strings, files: { script: 'script.es.md', strings: 'strings.es.json' }, languages: ['en', 'es'] });
  // check warns about texts that one file has and another lacks, in every language's check.
  for (const p of [loadProject(dir), es]) {
    assert.deepEqual(languageIssues(p).map((i) => [i.level, i.message]), [['warn', 'strings.es.json is missing 1 text that another language has: "steps.list"']]);
  }
  fs.rmSync(path.join(dir, 'strings.es.json'));
  assert.deepEqual(languageIssues(loadProject(dir)).map((i) => i.message), ['there is no strings.es.json, and another language has 3 texts: "title", "steps.first", "steps.list"']);
  for (const [text, message] of [['{', /strings\.json is not valid JSON/], ['[]', /strings\.json must be an object/], ['{ "n": 3 }', /strings\.json: "n" must be a text/], ['{ "a": { "b": [1] } }', /"a\.b" must be a text/]]) {
    fs.writeFileSync(path.join(dir, 'strings.json'), text);
    assert.throws(() => readStrings(path.join(dir, 'strings.json')), message);
  }
});

test('a strings-only edit changes the page version, and narration stays out of it', (t) => {
  const dir = project(t, { 'strings.json': { title: 'Making bread' } });
  const before = loadProject(dir);
  const timeline = buildTimeline(before, {});
  const first = makeState(before, timeline).version;
  fs.writeFileSync(path.join(dir, 'strings.json'), JSON.stringify({ title: 'Baking bread' }));
  const after = loadProject(dir);
  assert.notEqual(makeState(after, timeline).version, first);
  const scene = after.script.scenes[0];
  assert.equal(sceneHash(scene, sceneChunks(after, scene), after.config), sceneHash(before.script.scenes[0], sceneChunks(before, before.script.scenes[0]), before.config));
});

test('package words come from post.<lang>.json when there is one, and post.json otherwise', (t) => {
  const dir = project(t, { 'script.es.md': SPANISH, 'script.fr.md': SPANISH.replace('Cómo hacer pan', 'Faire du pain'), 'post.json': { description: 'How bread is made.', ai_label: true }, 'post.es.json': { description: 'Cómo se hace el pan.', hashtags: ['pan'] } });
  assert.deepEqual(readPostFile(loadProject(dir)), { description: 'How bread is made.', ai_label: true });
  const es = loadProject(dir, { lang: 'es' });
  assert.equal(readPostFile(es).description, 'Cómo se hace el pan.');
  assert.equal(readPostFile(loadProject(dir, { lang: 'fr' })).description, 'How bread is made.');
  const words = postWords(es, 'tiktok');
  assert.equal(words.text, 'Cómo se hace el pan.\n\n#pan');
  assert.equal(words.title, 'Cómo hacer pan');
  fs.writeFileSync(path.join(dir, 'post.es.json'), '{ "titel": "x" }');
  assert.throws(() => readPostFile(es), /post\.es\.json has unknown setting\(s\): titel/);
  fs.writeFileSync(path.join(dir, 'post.es.json'), JSON.stringify({ ai_label: false }));
  assert.deepEqual(postWords(loadProject(dir, { lang: 'es' }), 'tiktok').ai_reasons.at(-1), 'set to false in post.es.json');
});

test('a paid sentence of another language continues with --lang, and a strange language never reaches the command', () => {
  const job = (lang) => ({ kind: 'speech', key: 'abc', attempt: 1, lang });
  assert.match(continueCommand('/tmp/x', job('es'), 'lost'), / voice .+ --lang es --new$/);
  assert.doesNotMatch(continueCommand('/tmp/x', job(undefined), 'lost'), /--lang/);
  assert.doesNotMatch(continueCommand('/tmp/x', job('es; rm -rf ~'), 'lost'), /--lang|rm -rf/);
});

test('preview --lang watches the script and the strings of that language', { timeout: 20000 }, async (t) => {
  const dir = project(t, { 'script.es.md': '# Pan\n\n## intro {min=1}\n\n## outro {min=1}\n', 'strings.es.json': { title: 'Pan' } });
  const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
  const child = spawn(process.execPath, [bin, 'preview', dir, '--port', '0', '--lang', 'es'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill('SIGTERM');
    await exited;
  });
  let logs = '';
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      const value = await fn();
      if (value) return value;
      await sleep(100);
    }
    assert.fail(`preview did not update: ${logs}`);
  };
  const url = await until(() => /preview: (http:\/\/127\.0\.0\.1:\d+)/.exec(logs)?.[1]);
  const state = async () => (await fetch(`${url}/__state.json`)).json();
  const first = await state();
  assert.equal(first.config.language, 'es');
  assert.deepEqual(first.text.strings, { title: 'Pan' });
  fs.writeFileSync(path.join(dir, 'strings.es.json'), JSON.stringify({ title: 'Pan casero' }));
  const changed = await until(async () => { const s = await state(); return s.text?.strings.title === 'Pan casero' && s; });
  assert.notEqual(changed.version, first.version);
  fs.writeFileSync(path.join(dir, 'script.es.md'), '# Pan\n\n## intro {min=2}\n\n## outro {min=1}\n');
  await until(async () => (await state()).timeline.scenes[0].dur === 2);
});
