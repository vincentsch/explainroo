// doctor: every part is ready, not needed or missing, judged by what the setup needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupNeeds, projectSetup } from '../src/doctor.js';
import { ASR_MODEL, MULTILINGUAL_ASR_MODEL, TTS_MODEL } from '../src/models.js';
import { espeakInstall } from '../src/phonemes.js';
import { projectWord } from '../src/history.js';
import { loadProject } from '../src/project.js';

const bin = fileURLToPath(new URL('../bin/explainroo.js', import.meta.url));
const MODELS = [TTS_MODEL, ASR_MODEL, MULTILINGUAL_ASR_MODEL];

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-doctor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A cache folder, with the three model folders when `models` is true.
function cache(t, models) {
  const dir = temp(t);
  if (models) for (const model of MODELS) fs.mkdirSync(path.join(dir, 'models', model), { recursive: true });
  return dir;
}

function project(t, settings, scripts = { 'script.md': '## intro\nHello.\n' }) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(settings));
  for (const [name, text] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  return dir;
}

// espeak-ng is "there" when its binary answers --version, as Node does.
function doctor(args, { models = false, espeak = false, t }) {
  const env = { ...process.env, EXPLAINROO_CACHE: cache(t, models), EXPLAINROO_ESPEAK: espeak ? process.execPath : path.join(os.tmpdir(), 'explainroo-no-espeak'), EXPLAINROO_PYTHON: path.join(os.tmpdir(), 'explainroo-no-python') };
  const r = spawnSync(process.execPath, [bin, 'doctor', ...args], { encoding: 'utf8', env });
  assert.doesNotMatch(r.stderr, /test guard: blocked/);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: args.includes('--json') ? JSON.parse(r.stdout) : null };
}

const row = (r, name) => r.json.checks.find((c) => c.name === name);

// The advice for a missing espeak-ng. On a computer with apt-get and dpkg it also
// says that doctor --fetch can set up a copy without root.
function espeakAdvice(detail, start) {
  const plain = `${start} ${espeakInstall()}`;
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(detail, new RegExp(`^${escaped}( On this computer, ".+ doctor --fetch[^"]*" sets up such a copy by itself\\.)?$`));
}

test('an English setup needs no language model, espeak-ng or misaki, installed or not, and exits 0', (t) => {
  for (const models of [false, true]) {
    for (const espeak of [false, true]) {
      const r = doctor(['--json'], { models, espeak, t });
      assert.equal(r.status, 0, r.stdout);
      assert.equal(r.json.ok, true);
      assert.deepEqual(r.json.setup, [{ language: 'en', voice: 'kokoro' }]);
      for (const name of ['language model', 'espeak-ng', 'misaki ja', 'misaki zh']) {
        assert.equal(row(r, name).state, 'not needed', `${name} with models ${models}, espeak ${espeak}`);
        assert.equal(row(r, name).ok, true);
      }
      assert.match(row(r, 'language model').detail, models ? /It is installed\.$/ : /other languages than English$/);
      assert.match(row(r, 'espeak-ng').detail, espeak ? /It is installed\.$/ : /Brazilian Portuguese and Hindi$/);
      for (const name of ['voice model', 'speech check model']) assert.equal(row(r, name).state, models ? 'ready' : 'missing', name);
    }
  }
  // A model that downloads on first use says how it arrives and doesn't fail the run.
  const fresh = doctor(['--json'], { t });
  assert.equal(row(fresh, 'voice model').ok, false);
  assert.match(row(fresh, 'voice model').detail, /^not downloaded yet\. ".*doctor --fetch" or the first voice run fetches it, 326 MB\.$/);
  assert.match(row(fresh, 'speech check model').detail, /, 80 MB\.$/);
});

test('a Spanish project with a Kokoro voice and no espeak-ng says how to install it and exits 1', (t) => {
  const dir = project(t, { language: 'es' }, { 'script.md': '## intro\nHola.\n' });
  const r = doctor([dir, '--json'], { t });
  assert.equal(r.status, 1);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.project, dir);
  assert.deepEqual(r.json.setup, [{ language: 'es', voice: 'kokoro' }]);
  assert.equal(row(r, 'espeak-ng').state, 'missing');
  assert.equal(row(r, 'espeak-ng').ok, false);
  espeakAdvice(row(r, 'espeak-ng').detail, 'needed for Kokoro voices in Spanish.');
  assert.equal(row(r, 'speech check model').state, 'not needed');
  // With espeak-ng it passes, and the language model comes with the first voice run.
  const ready = doctor([dir, '--json'], { espeak: true, t });
  assert.equal(ready.status, 0);
  assert.equal(row(ready, 'espeak-ng').state, 'ready');
  assert.equal(row(ready, 'language model').state, 'missing');
  const text = doctor([dir], { t });
  assert.match(text.stdout, /^missing {5}espeak-ng {11}needed for Kokoro voices in Spanish\. Install it/m);
});

test('a Spanish project with a recording needs no espeak-ng, and its language model comes with the first voice run', (t) => {
  const dir = project(t, { language: 'es', voice: { provider: 'recording', src: 'assets/take.wav' } }, { 'script.md': '## intro\nHola.\n' });
  const r = doctor([dir, '--json'], { t });
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.setup, [{ language: 'es', voice: 'recording' }]);
  for (const name of ['espeak-ng', 'voice model', 'speech check model']) assert.equal(row(r, name).state, 'not needed', name);
  assert.equal(row(r, 'language model').state, 'missing');
  assert.equal(row(r, 'language model').ok, false);
  assert.match(row(r, 'language model').detail, /^not downloaded yet\. ".* doctor --fetch \S+" or the first voice run fetches it, 252 MB\.$/);
  const text = doctor([dir], { t });
  assert.equal(text.stdout.split('\n')[0], `For ${projectWord(dir)}: Spanish with a recording.`);
});

test('a project with only a paid voice needs no voice model, also when it is installed', (t) => {
  const dir = project(t, { voice: { provider: 'elevenlabs', id: 'sample' } });
  for (const models of [false, true]) {
    const r = doctor([dir, '--json'], { models, t });
    assert.equal(r.status, 0);
    assert.equal(row(r, 'voice model').state, 'not needed');
    assert.equal(row(r, 'voice model').detail, `only needed for Kokoro voices${models ? '. It is installed.' : ''}`);
    assert.equal(row(r, 'speech check model').state, models ? 'ready' : 'missing');
  }
});

test('every row has ok, and every row but the keys file has one of three states', (t) => {
  const settings = temp(t);
  const r = spawnSync(process.execPath, [bin, 'doctor', '--json'], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_CONFIG: settings, EXPLAINROO_PYTHON: path.join(settings, 'none') } });
  const { checks } = JSON.parse(r.stdout);
  assert.deepEqual(checks.map((c) => c.name), ['node', 'ffmpeg', 'chrome', 'espeak-ng', 'misaki ja', 'misaki zh', 'voice model', 'speech check model', 'language model', 'keys file', 'runs from', 'examples']);
  for (const check of checks) {
    assert.equal(typeof check.ok, 'boolean', check.name);
    if (check.info) continue;
    assert.ok(['ready', 'not needed', 'missing'].includes(check.state), check.name);
    assert.equal(check.ok, check.state !== 'missing', check.name);
  }
  assert.deepEqual(checks.at(-3), { name: 'keys file', ok: true, info: true, detail: `${path.join(settings, '.env')}; only needed for services that use your own key, and for settings like EXPLAINROO_ESPEAK that every command reads` });
  // The text prints the keys file and where explainroo is as lines after the rows.
  const text = spawnSync(process.execPath, [bin, 'doctor'], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_CONFIG: settings, EXPLAINROO_PYTHON: path.join(settings, 'none') } }).stdout.trim().split('\n');
  assert.equal(text.at(-3), `keys file: ${path.join(settings, '.env')}; only needed for services that use your own key, and for settings like EXPLAINROO_ESPEAK that every command reads`);
  assert.match(text.at(-2), /^runs from: \//);
  assert.equal(text.length, checks.length + 1);
  for (const line of text.slice(1, -3)) assert.match(line, /^(ready {7}|not needed {2}|missing {5})\S/);
});

test('doctor judges each language of a project with the voice it uses, and a folder without video.json fails', (t) => {
  // The English main voice is paid, so the Spanish version gets its default Kokoro voice.
  const dir = project(t, { voice: { provider: 'cartesia', id: 'sample' }, languages: { ja: { voice: { provider: 'recording', src: 'assets/ja/' } } } },
    { 'script.md': '## intro\nHello.\n', 'script.es.md': '## intro\nHola.\n', 'script.ja.md': '## intro\nこんにちは。\n' });
  const setup = projectSetup(loadProject(dir));
  assert.deepEqual(setup.map(({ language, voice }) => [language, typeof voice === 'string' ? voice : voice.provider]), [['en', 'cartesia'], ['es', 'ef_dora'], ['ja', 'recording']]);
  assert.deepEqual(Object.fromEntries(setupNeeds(setup)), {
    'speech check model': ['en'],
    'voice model': ['es'],
    'espeak-ng': ['es'],
    'language model': ['es', 'ja'],
  });
  const r = doctor([dir, '--json'], { t });
  assert.equal(row(r, 'misaki ja').state, 'not needed');
  assert.equal(row(r, 'espeak-ng').state, 'missing');
  const text = doctor([dir], { t });
  assert.equal(text.stdout.split('\n')[0], `For ${projectWord(dir)}: English with Cartesia, Spanish with a Kokoro voice and Japanese with a recording.`);

  const empty = temp(t);
  const none = doctor([empty], { t });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /is not a video project \(no video\.json\)/);
});

// Before init there is no project to read, so --language says which language the
// video will be in. Without it, doctor judges English, and espeak-ng is "not needed".
test('doctor --language checks what a language needs before the project exists', (t) => {
  const plain = doctor(['--json'], { t });
  assert.equal(row(plain, 'espeak-ng').state, 'not needed');
  assert.equal(plain.json.languages, null);
  const r = doctor(['--language', 'es', '--json'], { t });
  assert.equal(r.status, 1);
  assert.equal(r.json.project, null);
  assert.deepEqual(r.json.languages, ['es']);
  assert.deepEqual(r.json.setup, [{ language: 'es', voice: 'kokoro' }]);
  assert.equal(row(r, 'espeak-ng').state, 'missing');
  espeakAdvice(row(r, 'espeak-ng').detail, 'needed for Kokoro voices in Spanish.');
  assert.match(espeakInstall('linux'), /^Install it with "sudo apt install espeak-ng"\. A copy that is not installed for the whole system works too, also without root: set EXPLAINROO_ESPEAK to its espeak-ng program, or to a script that starts it\. To set it once, put the line EXPLAINROO_ESPEAK=<path> in .+\.env\.$/);
  assert.equal(row(r, 'language model').state, 'missing');
  assert.equal(row(r, 'speech check model').state, 'not needed');
  const ready = doctor(['--language', 'es'], { espeak: true, t });
  assert.match(ready.stdout, /^For Spanish with a Kokoro voice\. Once the project exists, ".*doctor <project>" checks what it needs\.$/m);
  assert.match(ready.stdout, /^ready {7}espeak-ng {11}.*, for Kokoro voices in Spanish$/m);
  // Several languages, and German, which Kokoro has no voice for.
  const both = doctor(['--language', 'fr,de', '--json'], { espeak: true, t });
  assert.deepEqual(both.json.setup, [{ language: 'fr', voice: 'kokoro' }, { language: 'de', voice: null }]);
  assert.equal(row(both, 'espeak-ng').detail.endsWith('for Kokoro voices in French'), true);
  assert.match(doctor(['--language', 'de'], { t }).stdout, /^For German with a paid voice or a recording, because Kokoro has no voice for it\./);
  assert.match(doctor([], { t }).stdout, /^For English narration with a Kokoro voice\. ".*doctor --language es" checks what another language needs, and ".*doctor <project>" what a project needs\.$/m);
  // A code it doesn't know, no code, and a project with --language are errors.
  const bad = doctor(['--language', 'xx'], { t });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^error: language must be one of en, es,/);
  assert.match(doctor(['--language'], { t }).stderr, /^error: --language needs a value/);
  const dir = project(t, { language: 'es' }, { 'script.md': '## intro\nHola.\n' });
  assert.match(doctor([dir, '--language', 'fr'], { t }).stderr, /^error: doctor checks a project or the languages of --language, not both\./);
});

// EXPLAINROO_ESPEAK set once in the settings file counts for every command, and
// doctor says where explainroo runs from.
test('EXPLAINROO_ESPEAK in the settings file is used, a missing espeak-ng names that file, and doctor says where explainroo and its examples are', (t) => {
  const config = temp(t);
  const run = (extra) => {
    const env = { ...process.env, EXPLAINROO_CACHE: cache(t, false), EXPLAINROO_PYTHON: path.join(os.tmpdir(), 'explainroo-no-python'), EXPLAINROO_CONFIG: config };
    delete env.EXPLAINROO_ESPEAK;
    Object.assign(env, extra);
    const r = spawnSync(process.execPath, [bin, 'doctor', '--language', 'fr', '--json'], { encoding: 'utf8', env });
    return { status: r.status, json: JSON.parse(r.stdout) };
  };
  const missing = run({});
  assert.equal(row(missing, 'espeak-ng').state, 'missing');
  assert.ok(row(missing, 'espeak-ng').detail.includes(`To set it once, put the line EXPLAINROO_ESPEAK=<path> in ${path.join(config, '.env')}.`), row(missing, 'espeak-ng').detail);
  fs.writeFileSync(path.join(config, '.env'), `EXPLAINROO_ESPEAK=${process.execPath}\n`);
  const found = run({});
  assert.equal(row(found, 'espeak-ng').state, 'ready');
  const root = path.dirname(path.dirname(bin));
  assert.equal(row(found, 'runs from').detail, root);
  assert.equal(row(found, 'examples').detail, path.join(root, 'examples'));
  // The environment still wins.
  assert.equal(row(run({ EXPLAINROO_ESPEAK: path.join(os.tmpdir(), 'explainroo-no-espeak') }), 'espeak-ng').state, 'missing');
});

// A fake apt-get and dpkg on the PATH, for the copy of espeak-ng without root. apt-get
// writes one file per package, and dpkg unpacks what each package holds. `log` gets
// one line per call. With `fail`, apt-get stops like it does without the package lists.
function fakeApt(t, { fail = false } = {}) {
  const bin = temp(t);
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'apt-get'), `#!/bin/sh
echo "apt-get $* in $(pwd)" >> "${log}"
${fail ? 'echo "E: Unable to locate package espeak-ng" >&2; exit 100' : 'shift; for p in "$@"; do echo "$p" > "$p"_1.0_amd64.deb; done'}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'dpkg'), `#!/bin/sh
echo "dpkg $*" >> "${log}"
p=$(cat "$2"); d="$3"
case "$p" in
  espeak-ng) mkdir -p "$d/usr/bin"; printf '#!/bin/sh\\n[ "$1" = --version ] && echo "eSpeak NG text-to-speech: 1.51 (fake) Data at: $ESPEAK_DATA_PATH" && exit 0\\n[ -d "$ESPEAK_DATA_PATH" ] && echo "ˈo_l_a"\\n' > "$d/usr/bin/espeak-ng"; chmod +x "$d/usr/bin/espeak-ng" ;;
  libespeak-ng1) mkdir -p "$d/usr/lib/fake-linux-gnu"; touch "$d/usr/lib/fake-linux-gnu/libespeak-ng.so.1" ;;
  espeak-ng-data) mkdir -p "$d/usr/lib/fake-linux-gnu/espeak-ng-data" ;;
  *) mkdir -p "$d/usr/share/doc/$p" ;;
esac
`, { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

// A run with that PATH, its own cache and settings folders, and no EXPLAINROO_ESPEAK.
function aptEnv(t, apt) {
  const env = { ...process.env, PATH: `${apt.bin}${path.delimiter}${process.env.PATH}`, EXPLAINROO_CACHE: temp(t), EXPLAINROO_CONFIG: temp(t), EXPLAINROO_OFFLINE: '1' };
  delete env.EXPLAINROO_ESPEAK;
  return env;
}

// Runs fn with exactly `env` as the environment, and puts the old one back after.
async function withEnv(t, env, fn) {
  const before = { ...process.env };
  const use = (values) => {
    for (const key of Object.keys(process.env)) if (!(key in values)) delete process.env[key];
    Object.assign(process.env, values);
  };
  use(env);
  try {
    return await fn();
  } finally {
    use(before);
  }
}

test('with apt-get and dpkg, a copy of espeak-ng without root goes into the cache folder, with a launcher named in the settings file', { skip: process.platform === 'win32' && 'no apt-get on Windows' }, async (t) => {
  const { setupEspeak, ESPEAK_PACKAGES } = await import('../src/doctor.js');
  const { espeakVersion } = await import('../src/phonemes.js');
  const apt = fakeApt(t);
  const env = aptEnv(t, apt);
  await withEnv(t, env, async () => {
    const said = [];
    const folder = path.join(env.EXPLAINROO_CACHE, 'espeak-ng');
    const r = setupEspeak({ notice: (line) => { said.push(line); assert.deepEqual(apt.calls(), [], 'it says what it does before it does it'); } });
    assert.equal(said.length, 1);
    assert.equal(said[0], `espeak-ng is missing, so explainroo sets up a copy that needs no root. It downloads the packages ${ESPEAK_PACKAGES.join(', ')} with "apt-get download" and unpacks them with "dpkg -x" into ${folder}. It writes a launcher there and saves EXPLAINROO_ESPEAK=${path.join(folder, 'espeak-ng')} in ${path.join(env.EXPLAINROO_CONFIG, '.env')}.`);
    assert.deepEqual([r.folder, r.launcher, r.version], [folder, path.join(folder, 'espeak-ng'), `eSpeak NG text-to-speech: 1.51 (fake) Data at: ${folder}/root/usr/lib/fake-linux-gnu/espeak-ng-data`]);
    const calls = apt.calls();
    assert.match(calls[0], new RegExp(`^apt-get download ${ESPEAK_PACKAGES.join(' ')} in `));
    assert.equal(calls.filter((c) => c.startsWith('dpkg -x ')).length, 5);
    assert.equal(fs.readFileSync(path.join(env.EXPLAINROO_CONFIG, '.env'), 'utf8'), `EXPLAINROO_ESPEAK=${r.launcher}\n`);
    // The packages go once they are unpacked, and nothing else is left in the cache.
    assert.deepEqual(fs.readdirSync(env.EXPLAINROO_CACHE), ['espeak-ng']);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['espeak-ng', 'root']);
    // Every command now finds it through the settings file.
    assert.match(espeakVersion(), /^eSpeak NG text-to-speech: 1\.51 \(fake\)/);
  });
});

test('without apt-get there is no copy, and when apt-get fails nothing is changed', { skip: process.platform === 'win32' && 'no apt-get on Windows' }, async (t) => {
  const { setupEspeak } = await import('../src/doctor.js');
  const { ProjectError } = await import('../src/errors.js');
  const none = temp(t);
  const env = { ...aptEnv(t, { bin: none }), PATH: none };
  assert.notEqual(process.env.PATH, none);
  await withEnv(t, env, () => {
    assert.equal(setupEspeak(), null);
    assert.deepEqual(fs.readdirSync(env.EXPLAINROO_CACHE), []);
  });
  const apt = fakeApt(t, { fail: true });
  const failing = aptEnv(t, apt);
  await withEnv(t, failing, () => {
    assert.throws(() => setupEspeak(), (e) => e instanceof ProjectError && e.message === '"apt-get download" failed: E: Unable to locate package espeak-ng');
    assert.deepEqual(fs.readdirSync(failing.EXPLAINROO_CACHE), []);
    assert.equal(fs.existsSync(path.join(failing.EXPLAINROO_CONFIG, '.env')), false);
  });
});

test('doctor --fetch --language es sets up the copy and says so, and without --fetch it says that --fetch can', { skip: process.platform === 'win32' && 'no apt-get on Windows', timeout: 120000 }, async (t) => {
  const apt = fakeApt(t);
  const env = aptEnv(t, apt);
  // The models that --fetch loads for Spanish, from the real cache, read only.
  const real = path.join(os.homedir(), '.cache', 'explainroo', 'models');
  const models = [TTS_MODEL, MULTILINGUAL_ASR_MODEL].every((m) => fs.existsSync(path.join(real, m)));
  if (!models) return t.skip('the voice model and the language model are not downloaded here');
  fs.symlinkSync(real, path.join(env.EXPLAINROO_CACHE, 'models'));
  const run = (args) => spawnSync(process.execPath, [bin, 'doctor', ...args], { encoding: 'utf8', env });
  const before = run(['--language', 'es']);
  assert.equal(before.status, 1);
  assert.match(before.stdout, /^missing +espeak-ng +needed for Kokoro voices in Spanish\. .* On this computer, ".*doctor --fetch --language es" sets up such a copy by itself\.$/m);
  const fetched = run(['--fetch', '--language', 'es']);
  assert.equal(fetched.status, 0, fetched.stdout + fetched.stderr);
  assert.match(fetched.stderr, /^espeak-ng is missing, so explainroo sets up a copy that needs no root\./m);
  assert.match(fetched.stdout, new RegExp(`^ready +espeak-ng +eSpeak NG text-to-speech: 1\\.51 \\(fake\\).*, for Kokoro voices in Spanish\\. The copy without root is in ${path.join(env.EXPLAINROO_CACHE, 'espeak-ng').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
  const after = JSON.parse(run(['--language', 'es', '--json']).stdout);
  assert.equal(after.checks.find((c) => c.name === 'espeak-ng').state, 'ready');
  assert.doesNotMatch(fetched.stderr, /test guard: blocked/);
});

// A cache with only the given models of the real one, linked, read only.
function linkedModels(t, models) {
  const real = path.join(os.homedir(), '.cache', 'explainroo', 'models');
  if (!models.every((m) => fs.existsSync(path.join(real, m)))) return null;
  const dir = temp(t);
  for (const m of models) {
    fs.mkdirSync(path.dirname(path.join(dir, 'models', m)), { recursive: true });
    fs.symlinkSync(path.join(real, m), path.join(dir, 'models', m));
  }
  return dir;
}

test('doctor --fetch --language fetches what those languages need, and the English speech check model only for English', { timeout: 120000 }, (t) => {
  // German has no Kokoro voice, so it needs only the language model. Offline, a
  // model that isn't in the cache can't come, so a run that asked for one fails.
  const dir = linkedModels(t, [TTS_MODEL, MULTILINGUAL_ASR_MODEL]);
  if (!dir) return t.skip('the voice model and the language model are not downloaded here');
  const run = (args) => {
    const r = spawnSync(process.execPath, [bin, 'doctor', ...args], { encoding: 'utf8', env: { ...process.env, EXPLAINROO_CACHE: dir, EXPLAINROO_OFFLINE: '1', EXPLAINROO_ESPEAK: process.execPath } });
    assert.doesNotMatch(r.stderr, /test guard: blocked/);
    return r;
  };
  const german = run(['--fetch', '--language', 'de', '--json']);
  assert.equal(german.status, 0, german.stdout + german.stderr);
  const checks = JSON.parse(german.stdout).checks;
  assert.equal(checks.find((c) => c.name === 'language model').state, 'ready');
  assert.equal(checks.find((c) => c.name === 'speech check model').state, 'not needed');
  assert.equal(fs.existsSync(path.join(dir, 'models', ASR_MODEL)), false, 'no English model came along');
  // English, alone or among the languages, asks for the English model.
  for (const args of [['--fetch'], ['--fetch', '--language', 'en,de']]) {
    const english = run(args);
    assert.equal(english.status, 1, english.stdout);
    assert.match(english.stderr, /whisper-base\.en/);
  }
  // Without --fetch, the row says how to get it for this setup.
  const before = JSON.parse(run(['--language', 'en,it', '--json']).stdout);
  assert.match(before.checks.find((c) => c.name === 'speech check model').detail, /^not downloaded yet\. ".* doctor --fetch --language en,it" or the first voice run fetches it, 80 MB\.$/);
});

test('the launcher gives espeak-ng a long data path from inside the folder, because espeak-ng reads only 159 characters of it', { skip: process.platform === 'win32' && 'no apt-get on Windows' }, async (t) => {
  const { setupEspeak } = await import('../src/doctor.js');
  const apt = fakeApt(t);
  const env = aptEnv(t, apt);
  env.EXPLAINROO_CACHE = path.join(env.EXPLAINROO_CACHE, 'a-folder-name-that-makes-the-path-long'.repeat(3));
  await withEnv(t, env, () => {
    const r = setupEspeak();
    assert.ok(path.join(r.folder, 'root/usr/lib/fake-linux-gnu/espeak-ng-data').length > 150);
    assert.equal(r.version, 'eSpeak NG text-to-speech: 1.51 (fake) Data at: .');
  });
});
