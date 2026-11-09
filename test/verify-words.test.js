// verify lists every word of the narration it could not confirm in the final
// mix, with its time in the video, and it uses the same rules as voice: near
// matches, words that sound the same, two words heard as one, and units.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { formatVerify, mathWord, mixAdvice, unconfirmedText, verdictOf, verify } from '../src/qa.js';
import { ffmpeg } from '../src/ffmpeg.js';

// Scene texts heard in the final mix, one per call, with words 0.2 s apart.
const says = (texts) => {
  let call = 0;
  return async () => {
    const text = texts[call++];
    return { text, words: text.split(' ').map((w, i) => ({ text: w, start: i * 0.2, end: i * 0.2 + 0.15 })) };
  };
};

async function videoProject(t, script, scenes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, music: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default {};');
  const project = loadProject(dir);
  fs.mkdirSync(project.paths.out, { recursive: true });
  fs.mkdirSync(project.paths.build, { recursive: true });
  const duration = scenes.reduce((n, s) => n + s.dur, 0);
  await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=white:s=320x180:d=${duration}:r=24`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(project.paths.out, 'video.mp4')]);
  let start = 0;
  const timeline = { duration, scenes: scenes.map((s) => { const scene = { ...s, start }; start += s.dur; return scene; }) };
  fs.writeFileSync(path.join(project.paths.build, 'timeline.json'), JSON.stringify(timeline));
  return project;
}

test('verify names each word it could not confirm with its time, and confirms what voice confirms', async (t) => {
  const project = await videoProject(t, '# Demo\n\n## intro\nIt holds a harmless piece of it.\n\n## costs\nSee costs at 300,000 kilometers per second.\n\n## key\nNo API key needed.\n', [{ id: 'intro', dur: 2 }, { id: 'costs', dur: 2 }, { id: 'key', dur: 2 }]);
  const r = await verify(project, { transcribe: says(['It holds a harmless peace of it.', 'Seacosts at 300,000 km/s.', 'No API can eat it.']) });
  // Two words that weren't heard share the time after the last word that was.
  assert.deepEqual(r.speech.unconfirmed, [{ scene: 'key', word: 'key', time: 4.35, heard: 'eat' }, { scene: 'key', word: 'needed', time: 4.85, heard: 'it' }]);
  assert.deepEqual(r.speech.scenes.map((s) => s.matchRate), [1, 1, 0.5]);
  assert.deepEqual(r.speech.nearly.map((n) => `${n.scene} ${n.word}${n.alike ? ' alike' : ''}${n.joined ? ' joined' : ''}`), ['intro piece alike', 'costs See joined', 'costs costs joined']);
  const warning = r.issues.find((i) => i.message.startsWith('the speech check could not confirm'));
  assert.equal(warning.level, 'warn');
  assert.equal(warning.message, 'the speech check could not confirm 2 words in the final mix: "key" at 4.3 s (heard "eat"), "needed" at 4.8 s (heard "it")');
  assert.match(formatVerify(r), /^WARN  the speech check could not confirm 2 words in the final mix: "key" at 4\.3 s/m);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project.paths.out, 'report.json'), 'utf8')).speech.unconfirmed, r.speech.unconfirmed);
  // Without a timeline that fits the file, the words have no scene and their time is in the whole file.
  fs.rmSync(path.join(project.paths.build, 'timeline.json'));
  const whole = await verify(project, { transcribe: says(['It holds a harmless peace of it. Seacosts at 300,000 km/s. No API key.']) });
  assert.deepEqual(whole.speech.unconfirmed, [{ word: 'needed', time: 2.75 }]);
  // Everything heard leaves no warning.
  fs.writeFileSync(path.join(project.paths.build, 'timeline.json'), JSON.stringify({ duration: 6, scenes: [{ id: 'intro', start: 0, dur: 2 }, { id: 'costs', start: 2, dur: 2 }, { id: 'key', start: 4, dur: 2 }] }));
  const clean = await verify(project, { transcribe: says(['It holds a harmless piece of it.', 'See costs at 300,000 kilometers per second.', 'No API key needed.']) });
  assert.deepEqual(clean.speech.unconfirmed, []);
  assert.ok(!clean.issues.some((i) => i.message.includes('could not confirm')));
});

test('a long list of unconfirmed words is cut after twelve', () => {
  const list = Array.from({ length: 15 }, (_, i) => ({ word: `w${i}`, time: i }));
  assert.match(unconfirmedText(list), /^the speech check could not confirm 15 words in the final mix: "w0" at 0\.0 s, .*"w11" at 11\.0 s, and 3 more$/);
  assert.equal(unconfirmedText([{ word: 'key', time: 2 }]), 'the speech check could not confirm 1 word in the final mix: "key" at 2.0 s');
});

test('verify ends with a verdict, in the text and in JSON: passed, passed with warnings, or failed with its problems', async (t) => {
  const project = await videoProject(t, '# Demo\n\n## key\nNo API key needed.\n', [{ id: 'key', dur: 2 }]);
  const r = await verify(project, { transcribe: says(['No API can eat it.']) });
  const warnings = r.issues.filter((i) => i.level === 'warn').length;
  assert.ok(warnings >= 1, JSON.stringify(r.issues));
  assert.equal(r.verdict, `passed with ${warnings} warning${warnings === 1 ? '' : 's'}`);
  assert.equal(r.passed, true);
  assert.equal(formatVerify(r).split('\n').at(-1), r.verdict);
  const saved = JSON.parse(fs.readFileSync(path.join(project.paths.out, 'report.json'), 'utf8'));
  assert.deepEqual([saved.passed, saved.verdict], [true, r.verdict]);
  // Hints count for neither, and an error fails it.
  assert.deepEqual(verdictOf([]), { passed: true, verdict: 'passed' });
  assert.deepEqual(verdictOf([{ level: 'hint' }]), { passed: true, verdict: 'passed' });
  assert.deepEqual(verdictOf([{ level: 'warn' }, { level: 'hint' }]), { passed: true, verdict: 'passed with 1 warning' });
  assert.deepEqual(verdictOf([{ level: 'error' }]), { passed: false, verdict: 'failed: 1 problem' });
  assert.deepEqual(verdictOf([{ level: 'error' }, { level: 'warn' }, { level: 'error' }]), { passed: false, verdict: 'failed: 2 problems' });
  // A report from before has its verdict worked out when it is printed.
  const { passed, verdict, ...older } = { ...r, issues: [{ level: 'error', message: 'the file has no audio stream' }] };
  assert.equal(formatVerify(older).split('\n').at(-1), 'failed: 1 problem');
});

test('a word the narration alone confirmed and the final mix did not names music.volume 3 dB lower', async (t) => {
  const { cachedVoice } = await import('./helpers/cached-voice.js');
  const project = await videoProject(t, '# Demo\n\n## intro\nFree and open source.\n', [{ id: 'intro', dur: 2 }]);
  const settings = (music) => fs.writeFileSync(path.join(project.dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, music }));
  settings({ style: 'tech', volume: 0.5 });
  cachedVoice(project.dir, 'intro');
  const r = await verify(loadProject(project.dir), { transcribe: says(['Free open source.']) });
  assert.deepEqual(r.speech.unconfirmed, [{ scene: 'intro', word: 'and', time: 0.15, mix: true }]);
  const warning = r.issues.find((i) => i.message.startsWith('the speech check could not confirm'));
  assert.equal(warning.message, 'the speech check could not confirm 1 word in the final mix: "and" at 0.1 s. The narration alone confirmed it, so the music may cover it: set music.volume in video.json to 0.35, from 0.5, which is 3 dB quieter');
  // Without music there is nothing to turn down.
  settings(false);
  const quiet = await verify(loadProject(project.dir), { transcribe: says(['Free open source.']) });
  assert.doesNotMatch(quiet.issues.find((i) => i.message.startsWith('the speech check could not confirm')).message, /music/);
  // A music block without a style keeps the look's music, and music under the
  // default volume gets no lower volume: listening comes next.
  settings({ volume: 0.35 });
  const lowered = await verify(loadProject(project.dir), { transcribe: says(['Free open source.']) });
  assert.match(lowered.issues.find((i) => i.message.startsWith('the speech check could not confirm')).message, /\. The narration alone confirmed it\. The music is already at 0\.35, quieter than the default 0\.5, so listen at that time before you lower it more$/);
});

test('the music advice leaves out number and maths words, and never goes under 0.2', () => {
  const maths = ['squared', 'minus', 'equals', 'halves', 'two'].map((word, i) => ({ word, time: i, mix: true }));
  assert.equal(mixAdvice(maths, { volume: 0.5 }), '. The narration alone confirmed them. They are number or maths words, which the speech check often hears written another way in the final mix, so quieter music may not help. Listen at those times to be sure');
  assert.match(mixAdvice([...maths, { word: 'and', time: 6, mix: true }], { volume: 0.5 }), /so the music may cover them: set music\.volume in video\.json to 0\.35, from 0\.5/);
  assert.match(mixAdvice([{ word: 'menos', mix: true }, { word: 'medios', mix: true }], { volume: 0.5 }, 'es'), /number or maths words/);
  assert.match(mixAdvice([{ word: 'and', mix: true }], { volume: 0.9 }), /to 0\.63, from 0\.9, which is 3 dB quieter$/);
  for (const volume of [0.1, 0.2, 0.3, 0.49]) assert.match(mixAdvice([{ word: 'and', mix: true }], { volume }), /listen at that time before you lower it more$/, String(volume));
  for (const volume of [0.5, 0.6, 0.75, 1]) {
    const lower = Number(/to ([\d.]+), from/.exec(mixAdvice([{ word: 'and', mix: true }], { volume }))[1]);
    assert.ok(lower >= 0.2 && lower < volume, `${volume} to ${lower}`);
  }
  for (const word of ['two', '5', 'minus', 'squared', 'halves', 'equals']) assert.equal(mathWord(word), true, word);
  for (const word of ['and', 'is', 'second', 'free']) assert.equal(mathWord(word), false, word);
});
