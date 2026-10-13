import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  if (['ja', 'zh'].includes(language)) return misakiPhonemes(texts, language);
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

function python() {
  return process.env.EXPLAINROO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function misakiInstall(language) {
  return `Python with misaki is needed for ${language === 'ja' ? 'Japanese' : 'Chinese'}. Run: ${python()} -m pip install "misaki[${language}]".${language === 'ja' ? ` Then run: ${python()} -m unidic download.` : ''} Or set EXPLAINROO_PYTHON to a Python with these packages.`;
}

export function misakiAvailable(language) {
  const r = spawnSync(python(), [fileURLToPath(new URL('./g2p.py', import.meta.url)), language], { input: JSON.stringify(language === 'ja' ? '日本語' : '中文') + '\n', encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return false;
  try {
    const phonemes = JSON.parse(r.stdout);
    return typeof phonemes === 'string' && !!phonemes.trim();
  } catch { return false; }
}

// misaki leaves Latin words like "API" or "JavaScript" as letters, which the
// Japanese and Chinese voices garble. They are read as English instead, with
// the espeak-ng build and fixes kokoro-js uses for English.
const LATIN = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:[\s-]+[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;

async function englishPhonemes(text) {
  const { phonemize: espeakWasm } = await import('phonemizer');
  return (await espeakWasm(text, 'en-us')).join(' ').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').trim();
}

// misaki reads "365.2422" as 365, a pause and 2422. In Japanese the digits
// after the point are read one by one: 365点二四二二.
function japaneseDecimals(text) {
  return text.replace(/(\d)\.(\d+)/g, (m, whole, digits) => whole + '点' + Array.from(digits, d => '〇一二三四五六七八九'[d]).join(''));
}

async function misakiPhonemes(texts, language) {
  if (language === 'ja') texts = texts.map(japaneseDecimals);
  const parts = texts.map(text => {
    const list = [];
    let last = 0;
    for (const m of text.matchAll(LATIN)) {
      if (m.index > last) list.push({ text: text.slice(last, m.index) });
      list.push({ text: m[0], latin: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) list.push({ text: text.slice(last) });
    return list;
  });
  const native = parts.flat().filter(p => !p.latin && p.text.trim());
  const phonemes = await runMisaki(native.map(p => p.text), language, line => typeof line === 'string');
  native.forEach((p, i) => { p.phonemes = phonemes[i]; });
  for (const p of parts.flat()) if (p.latin) p.phonemes = await englishPhonemes(p.text);
  return parts.map(list => {
    const joined = list.map(p => p.phonemes?.trim()).filter(Boolean).join(' ');
    if (!joined) throw new Error('misaki returned incomplete phonemes. Check its installation and EXPLAINROO_PYTHON.');
    return joined;
  });
}

// Katakana readings of Japanese text, from the dictionary misaki installs:
// [start, end, reading] for each word, counted in characters.
export function japaneseReadings(texts) {
  return runMisaki(texts, 'ja-readings', line => Array.isArray(line) && line.every(t => Array.isArray(t) && t.length === 3));
}

async function runMisaki(texts, mode, valid) {
  const language = mode.slice(0, 2);
  if (!texts.length) return [];
  return new Promise((resolve, reject) => {
    const child = spawn(python(), [fileURLToPath(new URL('./g2p.py', import.meta.url)), mode], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error(misakiInstall(language))));
    child.on('close', code => {
      if (code !== 0) {
        const said = stderr.trim().split(/\r?\n/).at(-1);
        return reject(new Error(misakiInstall(language) + (said ? ` Python said: ${said}` : '')));
      }
      try {
        // misaki drops punctuation in Japanese, so a piece may come back empty.
        const lines = stdout.trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
        if (lines.length !== texts.length || !lines.every(valid)) throw new Error();
        resolve(lines);
      } catch {
        reject(new Error('misaki returned incomplete phonemes. Check its installation and EXPLAINROO_PYTHON.'));
      }
    });
    child.stdin.end(texts.map(text => JSON.stringify(text)).join('\n') + '\n');
  });
}
