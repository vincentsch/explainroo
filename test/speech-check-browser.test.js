// What check says about the speech check: words that only nearly matched, next
// to the scene's rate, and a word whose {shown|spoken} didn't help. The narration
// is a cache from before near matches were saved, so check finds them without
// making a voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { speechChunks } from '../src/script.js';
import { CHECK, sceneHash, voicePaths } from '../src/voice.js';
import { writeWav } from '../src/wav.js';
import { runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}

const SCRIPT = `# Speech

## intro
Try Soundroo and Codex.

## site
Visit {soundroo.com|sound roo dot com}.

## both
Visit {soundroo.com|sound roo dot com} with Gravitation.

## plain
Gravitation pulls.
`;

// What Whisper heard in each scene, and the words it didn't confirm.
const SAVED = {
  intro: { transcript: 'Try Soundru and codecs.', unmatched: [] },
  site: { transcript: 'Visit soundray.com.', unmatched: ['soundroo.com.'], matchRate: 0.8 },
  both: { transcript: 'Visit soundray.com with the station.', unmatched: ['soundroo.com', 'Gravitation.'], matchRate: 0.67 },
  plain: { transcript: 'The station pulls.', unmatched: ['Gravitation'], matchRate: 0.5 },
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-speech-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', theme: 'clean', fps: 24, music: false, sfx: false, lead: 0, hold: 0, end: 0 }));
  fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
  fs.writeFileSync(path.join(dir, 'scenes.js'), `export default { ${Object.keys(SAVED).map((id) => `${id}(s) { s.text('${id}', { x: s.cx, y: s.cy, size: 20, at: 0 }); }`).join(', ')} };`);
  const project = loadProject(dir);
  fs.mkdirSync(project.paths.voice, { recursive: true });
  for (const scene of project.script.scenes) {
    const saved = SAVED[scene.id];
    const files = voicePaths(project, scene.id);
    const words = scene.units.filter((u) => u.type === 'word').map((u, i) => ({ text: u.display, spoken: u.spoken, start: i * 0.2, end: i * 0.2 + 0.15, matched: !saved.unmatched.includes(u.display) }));
    writeWav(files.wav, Float32Array.from({ length: 24000 }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
    fs.writeFileSync(files.json, JSON.stringify({ hash: sceneHash(scene, speechChunks(scene.units, project.config), project.config), id: scene.id, duration: 1, words, marks: {},
      chunks: [{ start: 0, end: 1, text: scene.spoken }], transcript: saved.transcript, matchRate: saved.matchRate ?? 1, unmatched: saved.unmatched, check: CHECK }));
  }
  return { dir, voice: project.paths.voice };
}

test('check lists near matches with the rate, and says when an override did not help', { skip: !chrome, timeout: 180000 }, async (t) => {
  const { dir, voice } = fixture(t);
  const before = Object.fromEntries(fs.readdirSync(voice).map((f) => [f, fs.readFileSync(path.join(voice, f))]));
  const json = await runCli(['check', dir, '--json']);
  assert.equal(json.code, 0, json.text);
  const r = JSON.parse(json.stdout);
  // Each near match has its time in the video.
  assert.ok(r.speech[0].nearly.every((n) => typeof n.time === 'number'), JSON.stringify(r.speech[0]));
  assert.deepEqual(r.speech.map((s) => ({ ...s, nearly: s.nearly.map(({ time, ...n }) => n) })), [
    { scene: 'intro', matchRate: 1, nearly: [{ word: 'Soundroo', heard: 'Soundru' }, { word: 'Codex', heard: 'codecs' }] },
    { scene: 'site', matchRate: 0.8, nearly: [] },
    { scene: 'both', matchRate: 0.67, nearly: [] },
    { scene: 'plain', matchRate: 0.5, nearly: [] },
  ]);
  const finding = (scene, level) => r.issues.find((i) => i.scene === scene && i.level === level)?.message;
  const [soundroo, codex] = r.speech[0].nearly.map((n) => n.time.toFixed(1));
  assert.equal(finding('intro', 'hint'), `understood 100%, 2 words only nearly matched: Soundroo at ${soundroo} s (heard "Soundru"), Codex at ${codex} s (heard "codecs"). No fix is needed unless one of them sounds wrong when you listen at those times. If they are said right, add this to video.json, and check and verify stop naming them: "heard": {"Soundroo": ["Soundru"], "Codex": ["codecs"]}`);
  // An override heard as something else: the hint says that it didn't help.
  const site = finding('site', 'warn');
  assert.match(site, /\{soundroo\.com\|sound roo dot com\} was heard as "soundray\.com", so the override didn't help\. Try a different spoken spelling, like \{soundroo\.com\|another spelling\}, or reword the sentence\.$/);
  assert.doesNotMatch(site, /write it as \{shown\|spoken\}/);
  // A word without an override keeps the advice it had.
  assert.match(finding('plain', 'warn'), /could not confirm "Gravitation"\. It heard: "The station pulls\."\. If the voice says a word wrong, write it as \{shown\|spoken\} in script\.md\. If it is said right and only heard wrong, reword the sentence\.$/);
  assert.match(finding('both', 'warn'), /the override didn't help\. .* If the voice says another word wrong, write it as \{shown\|spoken\} in script\.md\.$/);
  const text = await runCli(['check', dir]);
  assert.match(text.stdout, /^HINT +intro: understood 100%, 2 words only nearly matched: Soundroo at \d+\.\d s \(heard "Soundru"\), Codex at \d+\.\d s \(heard "codecs"\)\. No fix is needed unless one of them sounds wrong when you listen at those times\. If they are said right, .*"heard": \{"Soundroo": \["Soundru"\], "Codex": \["codecs"\]\}$/m);
  // No voice was made, and the saved narration is as it was.
  for (const [f, bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(voice, f)), bytes, f);
});
