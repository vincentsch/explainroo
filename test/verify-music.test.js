// verify says how loud the music is: its level in the pauses of the narration
// and how far under the voice it sits, or that no music can be heard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/project.js';
import { formatVerify, musicLevel, musicLine, verify } from '../src/qa.js';
import { ffmpeg } from '../src/ffmpeg.js';
import { writeWav } from '../src/wav.js';
import { mulberry32 } from '../engine/util.js';

const RATE = 16000;
const SPANS = [{ start: 2, end: 4 }, { start: 5.5, end: 7.5 }];

// A voice on the spans, music `under` dB below it that ducks 8 dB while the
// voice speaks, and a short loud effect in a pause.
function mix(under, { effect = true } = {}) {
  const random = mulberry32(7);
  const duration = 10;
  const voice = 0.3;
  const music = under === null ? 0 : voice * 10 ** (-under / 20) * Math.sqrt(3);
  return Float32Array.from({ length: duration * RATE }, (_, i) => {
    const t = i / RATE;
    const speaking = SPANS.some((s) => t >= s.start && t < s.end);
    const bed = music * (random() * 2 - 1) * (speaking ? 10 ** (-8 / 20) : 1);
    const said = speaking ? voice * Math.SQRT2 * Math.sin(2 * Math.PI * 220 * t) : 0;
    const boom = effect && t >= 4.6 && t < 4.75 ? 0.6 * Math.sin(2 * Math.PI * 80 * t) : 0;
    return said + bed + boom;
  });
}

test('the music level in the pauses, and how far under the voice it sits', () => {
  for (const under of [12, 18, 24]) {
    const m = musicLevel(mix(under), RATE, SPANS, 10);
    assert.equal(m.heard, true);
    assert.ok(Math.abs(m.under - under) <= 1, `${under} dB: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.pauses - (-10.5 - under)) <= 1, `${under} dB: ${JSON.stringify(m)}`);
  }
  assert.deepEqual(musicLevel(mix(null), RATE, SPANS, 10), { heard: false });
  // A narration without pauses can't say.
  assert.equal(musicLevel(mix(18), RATE, [{ start: 0, end: 10 }], 10), null);
  assert.equal(musicLine({ music: { heard: true, pauses: -40, under: 18 } }), 'music: about 18 dB under the voice, at -40 dB in the pauses of the narration');
  assert.equal(musicLine({ music: { heard: false } }), 'music: none can be heard in the pauses of the narration');
  assert.equal(musicLine({ speech: null }), '', 'a video without music has no line');
});

test('verify prints the music line for a project with music, and none without', async (t) => {
  const run = async (settings, under) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-verify-music-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ size: '320x180', fps: 24, sfx: false, ...settings }));
    fs.writeFileSync(path.join(dir, 'script.md'), '# Music\n\n## intro\nHello there.\n');
    fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { intro() {} };');
    const project = loadProject(dir);
    fs.mkdirSync(project.paths.out, { recursive: true });
    fs.mkdirSync(project.paths.build, { recursive: true });
    const wav = path.join(project.paths.build, 'mix.wav');
    writeWav(wav, mix(under, { effect: false }), RATE);
    await ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=10:r=24', '-i', wav, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(project.paths.out, 'video.mp4')]);
    fs.writeFileSync(path.join(project.paths.build, 'timeline.json'), JSON.stringify({ duration: 10, voiceSpans: SPANS, scenes: [{ id: 'intro', start: 0, dur: 10 }] }));
    const said = { text: 'Hello there.', words: [{ text: 'Hello', start: 2, end: 2.5 }, { text: 'there.', start: 2.6, end: 3 }] };
    return verify(project, { transcribe: async () => said });
  };
  const loud = await run({ music: true }, 18);
  assert.equal(loud.music.heard, true);
  assert.ok(Math.abs(loud.music.under - 18) <= 1.5, JSON.stringify(loud.music));
  assert.match(formatVerify(loud), /^music: about 1[78] dB under the voice, at -\d+ dB in the pauses of the narration$/m);
  const silent = await run({ music: true }, null);
  assert.match(formatVerify(silent), /^music: none can be heard in the pauses of the narration$/m);
  const none = await run({ music: false }, null);
  assert.equal('music' in none, false);
  assert.doesNotMatch(formatVerify(none), /^music:/m);
});
