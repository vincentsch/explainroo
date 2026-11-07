// Every connector. Adding one means one line here, one entry in
// ../services.json and one test against a fake server. See docs/connectors.md.
// Connector code runs with the user's keys, so it is never loaded from a project.
import cloud from './cloud.js';
import elevenlabs from './elevenlabs.js';
import openrouter from './openrouter.js';

export const CONNECTORS = [elevenlabs, openrouter, cloud];

export function findConnector(id) {
  return CONNECTORS.find((c) => c.id === id) ?? null;
}
