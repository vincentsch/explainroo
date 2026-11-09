// Every connector. Adding one means one line here, one entry in
// ../services.json and one test against a fake server. See docs/connectors.md.
// Connector code runs with the user's keys, so it is never loaded from a project.
import blotato from './blotato.js';
import buffer from './buffer.js';
import cartesia from './cartesia.js';
import cloud from './cloud.js';
import elevenlabs from './elevenlabs.js';
import openrouter from './openrouter.js';
import presenter from './presenter.js';
import youtube from './youtube.js';

export const CONNECTORS = [elevenlabs, cartesia, openrouter, presenter, cloud, youtube, buffer, blotato];

export function findConnector(id) {
  return CONNECTORS.find((c) => c.id === id) ?? null;
}
