// Ends the process right before it writes a file whose text matches the pattern in
// EXPLAINROO_TEST_DIE_BEFORE, like a run that is killed at that very moment. For
// example '"stage": "sending"' stops a post between two of its stages. Only tests
// load this, through NODE_OPTIONS.
//
// EXPLAINROO_TEST_STOP_BEFORE pauses the run there instead, the first time: it
// writes its process id to the file EXPLAINROO_TEST_STOPPED and stops itself until
// the test sends it SIGCONT. That is a run that hangs at that moment while it holds
// whatever it holds, like one that a debugger holds up.
import fs from 'node:fs';

const pattern = process.env.EXPLAINROO_TEST_DIE_BEFORE ? new RegExp(process.env.EXPLAINROO_TEST_DIE_BEFORE) : null;
const pause = process.env.EXPLAINROO_TEST_STOP_BEFORE ? new RegExp(process.env.EXPLAINROO_TEST_STOP_BEFORE) : null;
let paused = false;

if (pattern || pause) {
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function writeFileSync(file, data, ...rest) {
    if (typeof data === 'string' && pattern?.test(data)) process.kill(process.pid, 'SIGKILL');
    if (typeof data === 'string' && !paused && pause?.test(data)) {
      paused = true;
      realWrite(process.env.EXPLAINROO_TEST_STOPPED, String(process.pid));
      process.kill(process.pid, 'SIGSTOP');
    }
    return realWrite.call(this, file, data, ...rest);
  };
}
