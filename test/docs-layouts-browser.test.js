// The four layouts in "explainroo docs pictures" pass check in a wide and in a
// tall frame, with made-up narration that has their markers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { loadProject } from '../src/project.js';
import { check } from '../src/qa.js';
import { cachedVoice } from './helpers/cached-voice.js';

let chrome;
try { chrome = findChrome(); } catch {}
const skip = !chrome && 'no browser here';

const SCRIPT = `# Layouts

## number
About a million [#number] requests come in [#caption] every day.

## compare
Callbacks nest [#left] while async await [#right] reads from top to bottom.

## steps
The browser asks [#step2] a resolver, which finds [#step3] the address.

## hub
One login server [#hub] serves email [#spoke1] the calendar [#spoke2] and files [#spoke3] for the whole team.
`;

test('the layouts in the pictures topic pass check in a wide and in a tall frame', { skip, timeout: 240000 }, async (t) => {
  const doc = fs.readFileSync(new URL('../docs/pictures.md', import.meta.url), 'utf8');
  const start = doc.indexOf('```js\nexport default {') + 6;
  const code = doc.slice(start, doc.indexOf('```', start));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-layouts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', music: false, sfx: false, defaults: '0.5' }));
  fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
  fs.writeFileSync(path.join(dir, 'scenes.js'), code);
  for (const scene of ['number', 'compare', 'steps', 'hub']) cachedVoice(dir, scene);
  for (const size of ['youtube', 'shorts']) {
    const { issues } = await check(loadProject(dir, { size }));
    // The first scene is a number alone, so the cover hint is all there is.
    assert.deepEqual(issues.filter((i) => !/"cover"/.test(i.message)), [], `${size}: ${JSON.stringify(issues)}`);
  }
});
