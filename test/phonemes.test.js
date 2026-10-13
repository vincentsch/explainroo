import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapPhonemes, phonemize, espeakVersion, generateSpeech } from '../src/phonemes.js';

function fake(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-espeak-'));
  const file = path.join(dir, 'fake espeak');
  fs.writeFileSync(file, '#!/usr/bin/env node\n' + source, { mode: 0o755 });
  const previous = process.env.EXPLAINROO_ESPEAK;
  process.env.EXPLAINROO_ESPEAK = file;
  t.after(() => {
    if (previous === undefined) delete process.env.EXPLAINROO_ESPEAK;
    else process.env.EXPLAINROO_ESPEAK = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return file;
}

test('maps every misaki v1.0 tie sequence and leaves language-specific IPA intact', () => {
  assert.equal(mapPhonemes(' a^ɪ a^ʊ d^z d^ʒ e^ɪ o^ʊ ə^ʊ s^s t^s t^ʃ ɔ^ɪ '), 'I W ʣ ʤ A O Q S ʦ ʧ Y');
  assert.equal(mapPhonemes('«ʧˈit-t^sːa» r x ɬ ʲ œ̃ ɔ̃ ɑ̃ ɛ̃ ɐ̃ ʊ̃ n̩'), '(ʧˈitʦːa) r x ɬ ʲ œ̃ ɔ̃ ɑ̃ ɛ̃ ɐ̃ ʊ̃ n̩');
  assert.equal(mapPhonemes('कˈʌcʰcʰi'), 'कˈʌcʰcʰi');
});

const posix = { skip: process.platform === 'win32' && 'the fake espeak-ng is a POSIX script' };

test('batches text through stdin, preserves punctuation and removes language flags', posix, async t => {
  fake(t, `
    if (process.argv.includes('--version')) { console.log('eSpeak NG 1.51'); process.exit(0); }
    const assert = require('node:assert/strict');
    assert.deepEqual(process.argv.slice(2), ['-q', '-b', '1', '-v', 'fr-fr', '--ipa=1', '--tie=^']);
    let text = '';
    process.stdin.on('data', d => text += d);
    process.stdin.on('end', () => {
      assert.equal(text, ['bonjour', 'merci', 'שלום $HOME \`echo bad\`', 'encore'].join('\\n') + '\\n');
      process.stdout.write('(en) t^ʃa\\nd^ʒa\\ne^ɪ\\no^ʊ\\n');
    });
  `);
  assert.equal(espeakVersion(), 'eSpeak NG 1.51');
  const result = await phonemize(['«bonjour», (merci)!', 'שלום $HOME `echo bad`\nencore'], 'fr');
  assert.deepEqual(result, ['“ʧa”, (ʤa)!', 'A\nO']);
});

test('punctuation-only text needs no program', async t => {
  const file = fake(t, 'process.exit(1);');
  fs.rmSync(file);
  assert.deepEqual(await phonemize(['¿?!', '(…)'], 'es'), ['¿?!', '(…)']);
  assert.equal(espeakVersion(), null);
});

test('missing and non-executable programs give install instructions for every platform', posix, async t => {
  const file = fake(t, '');
  for (const missing of [false, true]) {
    if (missing) fs.rmSync(file);
    else fs.chmodSync(file, 0o644);
    await assert.rejects(phonemize(['Hola'], 'es'), e => {
      assert.match(e.message, /sudo apt install espeak-ng/);
      assert.match(e.message, /brew install espeak-ng/);
      assert.match(e.message, /espeak-ng\/espeak-ng\/releases/);
      assert.match(e.message, /EXPLAINROO_ESPEAK/);
      return true;
    });
  }
});

test('failed and incomplete output gives a friendly error', posix, async t => {
  const file = fake(t, 'process.stderr.write("failure"); process.exit(2);');
  await assert.rejects(phonemize(['Hola'], 'es'), /could not read the text/);
  fs.writeFileSync(file, '#!/usr/bin/env node\nconsole.log("one");');
  await assert.rejects(phonemize(['Hola', 'Adiós'], 'es'), /incomplete phonemes/);
  await assert.rejects(phonemize(['안녕'], 'ko'), /supports es, fr, it, pt-br and hi/);
});

test('English keeps generate; other languages tokenize mapped phonemes and call generate_from_ids', async () => {
  const calls = [];
  const ids = { dims: [1, 4] };
  const tts = {
    generate(text, options) { calls.push(['english', text, options]); return 'audio'; },
    tokenizer(text, options) { calls.push(['tokens', text, options]); return { input_ids: ids }; },
    generate_from_ids(input, options) { calls.push(['ids', input, options]); return 'audio'; },
  };
  assert.equal(await generateSpeech(tts, 'Hello.', { voice: 'af_heart', speed: 0.9 }), 'audio');
  assert.equal(await generateSpeech(tts, 'Bonjour.', { language: 'fr', voice: 'ff_siwis', speed: 1, phonemes: 'bɔ̃ʒˈuʁ.' }), 'audio');
  assert.deepEqual(calls, [
    ['english', 'Hello.', { voice: 'af_heart', speed: 0.9 }],
    ['tokens', 'bɔ̃ʒˈuʁ.', { truncation: true }],
    ['ids', ids, { voice: 'ff_siwis', speed: 1 }],
  ]);
});
