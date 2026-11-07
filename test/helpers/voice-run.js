// Runs the voice step in its own process with a fake transcribe, so that a test
// can kill it at an exact moment without needing the speech models.
//   node voice-run.js <project> [stop-after-first-transcribe-file] [--size <size>] [--lang <lang>]
// With the file, it creates that file on the first transcribe and then waits,
// which is the moment between a saved answer and the next purchase. --size and
// --lang pick the version of the video, as they do for "explainroo voice".
import fs from 'node:fs';
import { loadProject } from '../../src/project.js';
import { synthesize } from '../../src/voice.js';

const args = process.argv.slice(2);
const overrides = {};
for (const name of ['size', 'lang']) {
  const at = args.indexOf(`--${name}`);
  if (at !== -1) overrides[name] = args.splice(at, 2)[1];
}
const [project, marker] = args;
await synthesize(loadProject(project, overrides), {
  transcribe: async () => {
    if (marker) {
      fs.writeFileSync(marker, 'transcribing');
      await new Promise(() => setInterval(() => {}, 1000));
    }
    return { text: '', words: [] };
  },
});
