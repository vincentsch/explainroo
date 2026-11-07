// A one-second project with its narration already made, so that a test can render,
// package and verify it without loading the speech models for the voice. A short
// tone stands in for the narration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../src/project.js';
import { speechChunks } from '../../src/script.js';
import { sceneHash, voicePaths } from '../../src/voice.js';
import { writeWav } from '../../src/wav.js';

const bin = fileURLToPath(new URL('../../bin/explainroo.js', import.meta.url));

// One scene of a second with a chapter, placed from s.safe so that it fits every size.
export function tinyProject(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-tiny-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', theme: 'clean', fps: 24, motionBlur: false, sfx: false, lead: 0, hold: 0, end: 0, ...settings }));
  fs.writeFileSync(path.join(dir, 'script.md'), '# Tiny video\n\n## intro {min=1 chapter="Intro"}\nHello.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), "export default { intro(s) { s.text('Tiny', { x: s.cx, y: s.safe.y + s.safe.h / 2, size: Math.min(s.W, s.H) * 0.08, at: 0 }); } };");
  const project = loadProject(dir);
  const scene = project.script.scenes[0];
  fs.mkdirSync(project.paths.voice, { recursive: true });
  const files = voicePaths(project, scene.id);
  writeWav(files.wav, Float32Array.from({ length: 6000 }, (_, i) => 0.1 * Math.sin(i * Math.PI / 24)), 24000);
  fs.writeFileSync(files.json, JSON.stringify({ hash: sceneHash(scene, speechChunks(scene.units, project.config), project.config), id: scene.id,
    duration: 0.25, words: [{ text: 'Hello.', spoken: 'Hello.', start: 0, end: 0.25, matched: true }],
    marks: {}, chunks: [{ start: 0, end: 0.25, text: 'Hello.' }], transcript: 'Hello.', matchRate: 1, unmatched: [] }));
  return dir;
}

// Runs the real command line and resolves with what it printed.
export function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, text: stderr + stdout }));
  });
}
