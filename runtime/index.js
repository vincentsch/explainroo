// The entry of the voice runtime. explainroo imports both libraries through this
// file, so kokoro-js and explainroo share one copy of transformers.js.
export * as transformers from '@huggingface/transformers';
export { KokoroTTS } from 'kokoro-js';
