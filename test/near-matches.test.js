// Words the speech check only nearly matched: which ones count, where they are
// saved, and how voice, check and verify show them. Reporting them never moves a
// word time or a match rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords, nearList } from '../src/align.js';
import { loadProject } from '../src/project.js';
import { speechChunks } from '../src/script.js';
import { nearMatches, sceneHash, synthesize, voiceLine, voicePaths } from '../src/voice.js';
import { formatVerify, nearlyText, speechFindings, verify } from '../src/qa.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { writeWav } from '../src/wav.js';
import { main } from '../src/cli.js';
import { GOOD_KEY, startFakeServices } from './helpers/fake-services.js';

const heard = (list) => list.map(([text, start, end]) => ({ text, start, end }));
const near = (r) => r.words.map((w) => (w.nearly ? `near:${w.heard}` : w.matched ? 'exact' : `no:${w.heard ?? ''}`));

function setEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => (previous === undefined ? delete process.env[name] : (process.env[name] = previous)));
}

// A project whose scenes have narration made before: a short tone, and the JSON
// that voice saved for it, without near matches like a cache from before them.
function cachedProject(t, script, scenes, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-near-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', theme: 'clean', fps: 24, music: false, sfx: false, lead: 0, hold: 0, end: 0, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { ${Object.keys(scenes).map((id) => `${id}(s) { s.text('${id}', { x: s.cx, y: s.cy, size: 20, at: 0 }); }`).join(', ')} };`);
  const project = loadProject(dir);
  fs.mkdirSync(project.paths.voice, { recursive: true });
  for (const scene of project.script.scenes) {
    const saved = scenes[scene.id];
    const files = voicePaths(project, scene.id);
    const words = scene.units.filter((u) => u.type === 'word').map((u, i) => ({ text: u.display, spoken: u.spoken, start: i * 0.2, end: i * 0.2 + 0.15, matched: !saved.unmatched?.includes(u.display) }));
    writeWav(files.wav, Float32Array.from({ length: 24000 }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
    fs.writeFileSync(files.json, JSON.stringify({ hash: sceneHash(scene, speechChunks(scene.units, project.config), project.config), id: scene.id, duration: saved.duration ?? 1, words, marks: {},
      chunks: saved.chunks ?? [{ start: 0, end: 1, text: scene.spoken }], transcript: saved.transcript, matchRate: saved.matchRate ?? 1, unmatched: saved.unmatched ?? [] }));
  }
  return dir;
}

test('a word that similar had to accept is a near match, with what was heard', () => {
  const r = alignWords([{ spoken: 'Try' }, { spoken: 'Soundroo' }, { spoken: 'and' }, { spoken: 'Codex.' }, { spoken: 'xylophone' }],
    heard([['Try', 0, 0.3], ['Soundru', 0.3, 0.9], ['and', 0.9, 1.1], ['codecs.', 1.1, 1.7], ['banana', 1.8, 2.2]]), 2.3);
  assert.deepEqual(near(r), ['exact', 'near:Soundru', 'exact', 'near:codecs', 'no:banana']);
  const exact = alignWords([{ spoken: 'Soundroo' }], heard([['Soundroo.', 0, 0.5]]), 0.6);
  assert.deepEqual(near(exact), ['exact']);
  assert.deepEqual(nearList([{ spoken: 'Soundroo' }, { spoken: 'Codex.', display: 'Codex.' }], [r.words[1], r.words[3]]), [{ word: 'Soundroo', heard: 'Soundru' }, { word: 'Codex', heard: 'codecs' }]);
});

test('what the check already reads as the same is exact, and a word with an override counts once', () => {
  const number = alignWords([{ spoken: 'about' }, { spoken: '20' }], heard([['about', 0, 0.3], ['twenty', 0.3, 0.6]]), 0.7);
  assert.deepEqual(near(number), ['exact', 'exact']);
  const shown = alignWords([{ spoken: 'The' }, { spoken: 'sequel', display: 'SQL' }], heard([['The', 0, 0.2], ['SQL', 0.2, 0.7]]), 0.8);
  assert.deepEqual(near(shown), ['exact', 'exact']);
  // The spoken form nearly matches first, and the shown form heard as it is still makes it exact.
  const both = alignWords([{ spoken: 'Kubernetis', display: 'Kubernetes' }], heard([['Kubernetes', 0, 0.6]]), 0.7);
  assert.deepEqual(near(both), ['exact']);
  const group = alignWords([{ spoken: 'The' }, { spoken: 'D N S', display: 'DNS' }, { spoken: 'lookup' }], heard([['The', 0, 0.2], ['DNS', 0.2, 0.7], ['lookup', 0.8, 1.2]]), 1.3);
  assert.deepEqual(near(group), ['exact', 'exact', 'exact']);
  const several = alignWords([{ spoken: 'post gres sequel', display: 'PostgreSQL' }], heard([['post', 0, 0.2], ['gress', 0.2, 0.5], ['sequel', 0.5, 0.9]]), 1);
  assert.deepEqual(near(several), ['near:post gress sequel']);
  assert.equal(nearList([{ spoken: 'post gres sequel', display: 'PostgreSQL' }], several.words).length, 1);
});

test('a word heard exactly stays exact when a path of the same cost nearly matched it', () => {
  // The path pairs "But" with "but" and part of "2000", and the times stay as they were.
  const year = alignWords([{ spoken: 'year.' }, { spoken: 'But' }, { spoken: 'two thousand', display: '2000' }, { spoken: 'divided' }], heard([['year.', 0, 1], ['but', 1, 2], ['2000', 2, 3], ['divided', 3, 4]]), 4);
  assert.deepEqual(near(year), ['exact', 'exact', 'exact', 'exact']);
  assert.deepEqual(year.words.map((w) => [w.start, w.end]), [[0, 1], [1, 2.5], [2.5, 3], [3, 4]]);
  // "slices yellow" heard as "slice is yellow": only "slices" nearly matched.
  const slices = alignWords([{ spoken: 'the' }, { spoken: 'slices' }, { spoken: 'yellow,' }], heard([['the', 0, 0.2], ['slice', 0.2, 0.6], ['is', 0.6, 0.7], ['yellow', 0.7, 1.1]]), 1.2);
  assert.deepEqual(near(slices), ['exact', 'near:slice', 'exact']);
});

test('joined number pieces and a word heard as two words report exact and near the same way', () => {
  const amount = (spoken, pieces) => near(alignWords([{ spoken }], heard(pieces), 1));
  assert.deepEqual(amount('one thousand dollars', [['$1,000', 0, 1]]), ['exact']);
  assert.deepEqual(amount('one thousand dollars', [['$1', 0, 0.5], [',000', 0.5, 1]]), ['exact']);
  // "dollar" and "dollars" are the same unit word, and a misspelled one only nearly matches.
  assert.deepEqual(amount('one thousand dollar', [['$1,000', 0, 1]]), ['exact']);
  assert.deepEqual(amount('one thousand dolars', [['$1,000', 0, 1]]), ['near:$1,000']);
  assert.deepEqual(amount('one thousand dolars', [['$1', 0, 0.5], [',000', 0.5, 1]]), ['near:$1,000']);
  assert.deepEqual(amount('Soundroo', [['Sound', 0, 0.4], ['roo', 0.4, 0.8]]), ['exact']);
  assert.deepEqual(amount('Soundroo', [['Sound', 0, 0.4], ['ru', 0.4, 0.8]]), ['near:Sound ru']);
});

test('near matches change no rate and no time, in English and Spanish', () => {
  // The results these cases had before near matches were reported.
  const cases = [
    ['en', [{ spoken: 'Try' }, { spoken: 'Soundroo' }, { spoken: 'and' }, { spoken: 'Codex.' }], heard([['Try', 0, 0.3], ['Soundru', 0.3, 0.9], ['and', 0.9, 1.1], ['codecs.', 1.1, 1.7]]), 1.8,
      [[0, 0.3, true], [0.3, 0.9000000000000001, true], [0.9, 1.1, true], [1.1, 1.7, true]], 1],
    ['en', [{ spoken: 'Visit' }, { spoken: 'sound roo dot com.', display: 'soundroo.com.' }], heard([['Visit', 0, 0.3], ['soundru.com.', 0.3, 1.4]]), 1.5, [[0, 0.3, true], [0.3, 1.4, false]], 0.8],
    ['es', [{ spoken: 'Usa' }, { spoken: 'Soundroo' }, { spoken: 'hoy.' }], heard([['Usa', 0, 0.3], ['Soundru', 0.3, 0.9], ['hoy.', 0.9, 1.2]]), 1.3, [[0, 0.3, true], [0.3, 0.9000000000000001, true], [0.9, 1.2, true]], 1],
    ['es', [{ spoken: 'El' }, { spoken: 'navegador' }, { spoken: 'pregunta' }, { spoken: 'otra' }, { spoken: 'vez.' }], heard([['El', 0, 0.2], ['navegadora', 0.2, 0.8], ['pregunto', 0.8, 1.3], ['vez.', 1.4, 1.7]]), 1.8,
      [[0, 0.2, true], [0.2, 0.8, true], [0.8, 1.3, true], [1.3, 1.4, false], [1.4, 1.7, true]], 0.8],
  ];
  for (const [language, words, said, duration, times, rate] of cases) {
    const r = alignWords(words, said, duration, language);
    assert.deepEqual(r.words.map((w) => [w.start, w.end, w.matched]), times);
    assert.equal(r.matchRate, rate);
    assert.ok(r.words.some((w) => w.nearly || w.heard));
  }
});

test('a scene saved before near matches gets them from its transcript, and no voice is made again', async (t) => {
  const dir = cachedProject(t, '# Old\n\n## intro\nTry Soundroo and Codex.\n\n## quiet {min=1}\n', { intro: { transcript: 'Try Soundru and codecs.' }, quiet: { transcript: '' } });
  const project = loadProject(dir);
  const files = voicePaths(project, 'intro');
  const before = [fs.readFileSync(files.json, 'utf8'), fs.readFileSync(files.wav)];
  const voices = await synthesize(project, { transcribe: () => { throw new Error('no voice should be made'); } });
  assert.deepEqual(voices.intro.nearly, [{ word: 'Soundroo', heard: 'Soundru' }, { word: 'Codex', heard: 'codecs' }]);
  assert.deepEqual(voices.quiet.nearly, []);
  assert.equal(fs.readFileSync(files.json, 'utf8'), before[0]);
  assert.deepEqual(fs.readFileSync(files.wav), before[1]);
  // Only a word the scene confirmed when it was made can have nearly matched.
  const unconfirmed = { ...voices.intro, nearly: undefined, words: voices.intro.words.map((w) => ({ ...w, matched: w.text !== 'Codex.' })) };
  assert.deepEqual(nearMatches(unconfirmed, 'en'), [{ word: 'Soundroo', heard: 'Soundru' }]);
  // A saved list wins, and Japanese and Chinese compare characters, which never nearly match.
  assert.deepEqual(nearMatches({ ...voices.intro, nearly: [] }, 'en'), []);
  assert.deepEqual(nearMatches({ ...voices.intro, nearly: undefined }, 'ja'), []);
});

test('a new voice build saves the near matches of each scene, and the voice line says what its numbers are', async (t) => {
  const fake = await startFakeServices();
  t.after(fake.close);
  setEnv(t, 'EXPLAINROO_ELEVENLABS_URL', fake.env.EXPLAINROO_ELEVENLABS_URL);
  setEnv(t, 'ELEVENLABS_API_KEY', GOOD_KEY);
  t.mock.method(process.stderr, 'write', () => true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-near-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ voice: { provider: 'elevenlabs', id: 'fake-voice' } }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Test\n\n## intro\nTry Soundroo today. [pause 1] It is free.\n');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
  const said = { 'Try Soundroo today.': 'Try Soundru today.', 'It is free.': 'It is free.' };
  const transcribe = async (samples) => {
    const text = Object.values(said)[transcribe.calls++];
    return { text, words: text.split(' ').map((w, i) => ({ text: w, start: i * 0.1, end: i * 0.1 + 0.08 })) };
  };
  transcribe.calls = 0;
  const lines = [];
  const voices = await synthesize(loadProject(dir), { transcribe, log: (line) => lines.push(line) });
  const info = voices.intro;
  assert.deepEqual(info.nearly, [{ word: 'Soundroo', heard: 'Soundru' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'build/voice/intro.json'), 'utf8')).nearly, info.nearly);
  // The sentence gap and the [pause] are in "with pauses" and not in "of narration".
  const spoken = info.chunks.reduce((sum, c) => sum + c.end - c.start, 0);
  assert.ok(Math.abs(info.duration - spoken - 1.3) < 0.01, `${info.duration} and ${spoken}`);
  const line = lines.find((l) => l.startsWith('voice intro:'));
  assert.match(line, new RegExp(`^voice intro: ${spoken.toFixed(1)} s of narration \\(${info.duration.toFixed(1)} s with pauses\\), made in \\d+\\.\\d s$`));
  assert.equal(voiceLine('intro', { duration: 13.04, chunks: [{ start: 0, end: 4.1 }, { start: 4.6, end: 8 }, { start: 9.2, end: 11.9 }] }, 13.1), 'intro: 10.2 s of narration (13.0 s with pauses), made in 13.1 s');
  assert.equal(voiceLine('intro', { duration: 12.4, chunks: [{ start: 0, end: 12.4 }] }, 0.4, true), 'intro: a 12.4 s cut of the recording, pauses included, made in 0.4 s');
});

test('the voice command adds the narration time to its table and JSON, and keeps its fields', async (t) => {
  const dir = cachedProject(t, '# Old\n\n## intro\nOne. Two.\n', { intro: { transcript: 'One. Two.', duration: 1.4, chunks: [{ start: 0, end: 0.5, text: 'One.' }, { start: 0.8, end: 1.4, text: 'Two.' }] } }, { voice: 'af_heart' });
  let output = '';
  t.mock.method(process.stdout, 'write', (s) => { output += s; return true; });
  t.mock.method(process.stderr, 'write', () => true);
  assert.equal(await main(['voice', dir, '--json']), 0);
  const [row] = JSON.parse(output).scenes;
  assert.deepEqual(Object.keys(row), ['scene', 'voice', 'narration', 'confirmed', 'unconfirmed', 'marks']);
  assert.deepEqual([row.voice, row.narration], [1.4, 1.1]);
  output = '';
  assert.equal(await main(['voice', dir]), 0);
  assert.match(output, /^intro +1\.1 s of narration \(1\.4 s with pauses\) +100% confirmed$/m);
});

test('verify lists near matches next to the rate, by scene, and without scenes for the whole file', async (t) => {
  const dir = cachedProject(t, '# Demo\n\n## intro\nTry Soundroo.\n\n## outro\nAsk Codex today.\n', { intro: { transcript: 'Try Soundroo.' }, outro: { transcript: 'Ask Codex today.' } });
  const project = loadProject(dir);
  fs.mkdirSync(project.paths.out, { recursive: true });
  const video = path.join(project.paths.out, 'video.mp4');
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  fs.writeFileSync(path.join(project.paths.build, 'timeline.json'), JSON.stringify({ duration: 2, scenes: [{ id: 'intro', start: 0, dur: 1 }, { id: 'outro', start: 1, dur: 1 }] }));
  const scenes = ['Try Soundru.', 'Ask codecs today.'];
  const says = (texts) => {
    let call = 0;
    return async () => {
      const text = texts[call++];
      return { text, words: text.split(' ').map((w, i) => ({ text: w, start: i * 0.2, end: i * 0.2 + 0.15 })) };
    };
  };
  const r = await verify(project, { transcribe: says(scenes) });
  assert.equal(r.speech.matchRate, 1);
  assert.deepEqual(r.speech.nearly, [{ scene: 'intro', word: 'Soundroo', heard: 'Soundru' }, { scene: 'outro', word: 'Codex', heard: 'codecs' }]);
  assert.deepEqual(r.speech.scenes, [{ id: 'intro', matchRate: 1, nearly: [{ word: 'Soundroo', heard: 'Soundru' }] }, { id: 'outro', matchRate: 1, nearly: [{ word: 'Codex', heard: 'codecs' }] }]);
  assert.match(formatVerify(r), /^narration understood: 100%, 2 words only nearly matched: Soundroo \(heard "Soundru"\), Codex \(heard "codecs"\)$/m);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project.paths.out, 'report.json'), 'utf8')).speech.nearly, r.speech.nearly);
  // Without a timeline that fits the file, verify listens to the whole file.
  fs.rmSync(path.join(project.paths.build, 'timeline.json'));
  const whole = await verify(project, { transcribe: says([scenes.join(' ')]) });
  assert.deepEqual(whole.speech.nearly, [{ word: 'Soundroo', heard: 'Soundru' }, { word: 'Codex', heard: 'codecs' }]);
  assert.equal(whole.speech.scenes, undefined);
  const clean = await verify(project, { transcribe: says(['Try Soundroo. Ask Codex today.']) });
  assert.deepEqual(clean.speech.nearly, []);
  assert.match(formatVerify(clean), /^narration understood: 100%$/m);
});

test('an override of any length that did not help is told so, and other words keep the old advice', async (t) => {
  const dir = cachedProject(t, '# Test\n\n## short\nTry {SQL|sequel}.\n\n## mixed\nTry {SQL|sequel} with Gravitation.\n\n## plain\nTry now.\n\n## long\nThe database speaks {SQL|sequel} with every other program here.\n', {
    short: { transcript: 'Try xylophone,', unmatched: ['SQL.'], matchRate: 0.5 },
    mixed: { transcript: 'Try xylophone with the station.', unmatched: ['SQL', 'Gravitation.'], matchRate: 0.5 },
    plain: { transcript: 'Try cow,', unmatched: ['now.'], matchRate: 0.5 },
    long: { transcript: 'The database speaks xylophone with every other program here.', unmatched: ['SQL'], matchRate: 0.9 },
  });
  const project = loadProject(dir);
  const voices = await synthesize(project, { transcribe: () => { throw new Error('no voice should be made'); } });
  const { issues, speech } = speechFindings(project, voices);
  const warning = (scene) => issues.find((i) => i.scene === scene && i.level === 'warn')?.message;
  assert.equal(warning('short'), 'the voice check could not confirm "SQL.". It heard: "Try xylophone,". {SQL|sequel} was heard as "xylophone", so the override didn\'t help. Try a different spoken spelling, like {SQL|another spelling}, or reword the sentence.');
  assert.equal(warning('mixed'), 'the voice check could not confirm "SQL", "Gravitation.". It heard: "Try xylophone with the station.". {SQL|sequel} was heard as "xylophone", so the override didn\'t help. Try a different spoken spelling, like {SQL|another spelling}, or reword the sentence. If another word is mispronounced, write it as {shown|spoken} in script.md.');
  // Without an override, the message is the one it was.
  assert.equal(warning('plain'), 'the voice check could not confirm 50% of the words. It heard: "Try cow,". If a word is mispronounced, write it as {shown|spoken} in script.md.');
  // A short override that didn't help is reported also when the rest of the scene was heard.
  assert.match(warning('long'), /^the voice check could not confirm "SQL"\. .*\{SQL\|sequel\} was heard as "xylophone", so the override didn't help\./);
  assert.deepEqual(speech.map((s) => s.scene), ['short', 'mixed', 'plain', 'long']);
});

test('the list of near matches counts a word heard the same way once, with how often', () => {
  assert.equal(nearlyText([{ word: 'Soundroo', heard: 'Soundru' }]), '1 word only nearly matched: Soundroo (heard "Soundru")');
  assert.equal(nearlyText([{ word: 'Soundroo', heard: 'Soundru' }, { word: 'Codex', heard: 'codecs' }, { word: 'Soundroo', heard: 'Soundru' }]), '3 words only nearly matched: Soundroo (heard "Soundru") 2 times, Codex (heard "codecs")');
  const many = Array.from({ length: 10 }, (_, i) => ({ word: `Word${i}`, heard: `Wort${i}` }));
  assert.match(nearlyText(many), /^10 words only nearly matched: .*Word7 \(heard "Wort7"\), and 2 more$/);
});
