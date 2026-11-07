// Ends the process right before it writes a file whose text matches the pattern in
// EXPLAINROO_TEST_DIE_BEFORE, like a run that is killed at that very moment. For
// example '"stage": "sending"' stops a post between two of its stages. Only tests
// load this, through NODE_OPTIONS.
import fs from 'node:fs';

const pattern = process.env.EXPLAINROO_TEST_DIE_BEFORE ? new RegExp(process.env.EXPLAINROO_TEST_DIE_BEFORE) : null;

if (pattern) {
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function writeFileSync(file, data, ...rest) {
    if (typeof data === 'string' && pattern.test(data)) process.kill(process.pid, 'SIGKILL');
    return realWrite.call(this, file, data, ...rest);
  };
}
