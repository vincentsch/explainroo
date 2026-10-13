import { spawn, spawnSync } from 'node:child_process';

const ESPEAK_LANGUAGES = { es: 'es', fr: 'fr-fr', it: 'it', 'pt-br': 'pt-br', hi: 'hi' };
// Adapted from misaki's EspeakG2P (Apache-2.0, see licenses/).
// https://github.com/hexgrad/misaki/blob/main/misaki/espeak.py
// Kokoro v1.0 keeps nasal vowels, unlike misaki's v2.0 mapping.
const E2M = {
  'a^ɪ': 'I', 'a^ʊ': 'W', 'd^z': 'ʣ', 'd^ʒ': 'ʤ', 'e^ɪ': 'A',
  'o^ʊ': 'O', 'ə^ʊ': 'Q', 's^s': 'S', 't^s': 'ʦ', 't^ʃ': 'ʧ', 'ɔ^ɪ': 'Y',
};

export function mapPhonemes(ipa) {
  let ps = ipa.trim();
  for (const [old, replacement] of Object.entries(E2M).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) ps = ps.replaceAll(old, replacement);
  return ps.replaceAll('^', '').replaceAll('-', '').replaceAll('«', '(').replaceAll('»', ')');
}

function binary() {
  return process.env.EXPLAINROO_ESPEAK || 'espeak-ng';
}

const INSTALL = 'espeak-ng is needed for this language. Linux: sudo apt install espeak-ng. macOS: brew install espeak-ng. Windows: use the installer at https://github.com/espeak-ng/espeak-ng/releases. Or set EXPLAINROO_ESPEAK to its binary.';

export function espeakVersion() {
  const r = spawnSync(binary(), ['--version'], { encoding: 'utf8', timeout: 5000 });
  return !r.error && r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

export async function phonemize(texts, language) {
  const lang = ESPEAK_LANGUAGES[language];
  if (!lang) throw new Error('espeak-ng supports es, fr, it, pt-br and hi here.');
  const input = [];
  const parts = texts.map(text => {
    // Preserve punctuation outside espeak, as misaki's phonemizer backend does.
    const prepared = text.replaceAll('«', '“').replaceAll('»', '”').replaceAll('(', '«').replaceAll(')', '»');
    return prepared.split(/([;:,.!?¡¿—…"«»“”{}\[\]।]+|\s*\n\s*)/u).map((part, i) => {
      if (i % 2 || !part.trim()) return { text: part };
      const index = input.length;
      input.push(part.trim());
      return { index, before: /^\s*/.exec(part)[0], after: /\s*$/.exec(part)[0] };
    });
  });
  if (!input.length) return parts.map(p => mapPhonemes(p.map(x => x.text).join('')));
  const output = await new Promise((resolve, reject) => {
    // Without --stdin, espeak processes each input line separately.
    const child = spawn(binary(), ['-q', '-b', '1', '-v', lang, '--ipa=1', '--tie=^'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    child.on('error', e => reject(new Error(['ENOENT', 'EACCES'].includes(e.code) ? INSTALL : 'espeak-ng could not start. Check EXPLAINROO_ESPEAK.')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) return reject(new Error('espeak-ng could not read the text. Check its installation and EXPLAINROO_ESPEAK.'));
      const lines = stdout.trimEnd().split(/\r?\n/);
      if (lines.length !== input.length || lines.some(line => !line.trim()) || stderr.trim()) return reject(new Error('espeak-ng returned incomplete phonemes. Check its installation and EXPLAINROO_ESPEAK.'));
      resolve(lines.map(line => line.replace(/\([a-z-]+\)/g, '').trim()));
    });
    child.stdin.end(input.join('\n') + '\n');
  });
  return parts.map(p => mapPhonemes(p.map(x => x.index === undefined ? x.text : x.before + output[x.index] + x.after).join('')));
}

export function generateSpeech(tts, text, { language = 'en', voice, speed, phonemes } = {}) {
  if (language === 'en') return tts.generate(text, { voice, speed });
  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  return tts.generate_from_ids(input_ids, { voice, speed });
}
