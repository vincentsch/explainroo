// Runs the voice step in its own process with a fake transcribe, so that a test
// can kill it at an exact moment without needing the speech models.
//   node voice-run.js <project> [stop-after-first-transcribe-file]
// With the second argument, it creates that file on the first transcribe and then
// waits, which is the moment between a saved answer and the next purchase.
import fs from 'node:fs';
import { loadProject } from '../../src/project.js';
import { synthesize } from '../../src/voice.js';

const [project, marker] = process.argv.slice(2);
await synthesize(loadProject(project), {
  transcribe: async () => {
    if (marker) {
      fs.writeFileSync(marker, 'transcribing');
      await new Promise(() => setInterval(() => {}, 1000));
    }
    return { text: '', words: [] };
  },
});
