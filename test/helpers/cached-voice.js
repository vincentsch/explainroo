// Narration that is already made, for a scene of any language: a short tone with
// the scene's words spread over it, saved where the voice step looks for it and
// with the hash it expects. So a test can check and render narrated scenes, also
// in languages whose voice can't run here, without loading a voice model.
import fs from 'node:fs';
import { loadProject } from '../../src/project.js';
import { resolveMarks } from '../../src/script.js';
import { sceneChunks, sceneHash, voicePaths } from '../../src/voice.js';
import { writeWav } from '../../src/wav.js';

const WORD = 0.3;

export function cachedVoice(dir, sceneId, lang) {
  const project = loadProject(dir, { lang });
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  const files = voicePaths(project, scene.id);
  const times = [];
  const words = [];
  scene.units.forEach((u, i) => {
    if (u.type !== 'word') return;
    times[i] = { start: words.length * WORD, end: words.length * WORD + WORD * 0.8 };
    words.push({ text: u.display, spoken: u.spoken, ...times[i], matched: true });
  });
  const duration = words.length * WORD;
  fs.mkdirSync(project.paths.voice, { recursive: true });
  writeWav(files.wav, Float32Array.from({ length: Math.round(duration * 24000) }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
  fs.writeFileSync(files.json, JSON.stringify({
    hash: sceneHash(scene, sceneChunks(project, scene), project.config),
    id: scene.id,
    duration,
    words,
    marks: resolveMarks(scene.units, times),
    chunks: [{ start: 0, end: duration, text: scene.spoken }],
    transcript: scene.spoken,
    matchRate: 1,
    unmatched: [],
  }));
  return project;
}
