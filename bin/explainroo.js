#!/usr/bin/env node
import { main } from '../src/cli.js';

// Exit by letting the event loop drain, not with process.exit(). ONNX Runtime
// (voice and speech check models) aborts with "mutex lock failed" on macOS when
// process.exit() runs while its thread pool is alive. The unref'd timer only
// fires if some handle keeps the process up after main() is done.
const finish = (code) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
};

main(process.argv.slice(2)).then(
  (code) => finish(code ?? 0),
  (e) => {
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    finish(1);
  },
);
