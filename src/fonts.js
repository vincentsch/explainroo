import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { cacheRoot } from './models.js';

const SOURCE = 'https://raw.githubusercontent.com/googlefonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans';
const THAI = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/6da9d59fd18f429cb8dbfa87e87669204f77ddab/fonts/NotoSansThai/hinted/ttf';
const CJK_LICENSE = { file: 'NotoSansCJK-OFL.txt', url: `${SOURCE}/LICENSE`, hash: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2' };
const FONTS = {
  ja: { family: 'Noto Sans JP', ext: 'otf', size: '17 MB', license: CJK_LICENSE, hashes: ['68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5', 'e53dcb0dcb2922e45d01aae1ebd2f382bb81d4229b18b6b883bd170678af1f76'], url: (bold) => `${SOURCE}/OTF/Japanese/NotoSansCJKjp-${bold ? 'Bold' : 'Regular'}.otf` },
  zh: { family: 'Noto Sans SC', ext: 'otf', size: '17 MB', license: CJK_LICENSE, hashes: ['2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b', 'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a'], url: (bold) => `${SOURCE}/OTF/SimplifiedChinese/NotoSansCJKsc-${bold ? 'Bold' : 'Regular'}.otf` },
  th: {
    family: 'Noto Sans Thai', ext: 'ttf', size: '40 KB',
    license: { file: 'NotoSansThai-OFL.txt', url: 'https://raw.githubusercontent.com/notofonts/thai/cb0f07f16aacc38e855371b8021866e789d214ce/OFL.txt', hash: 'dad6e6abc2bf3fc37cc698af7607c3f4d4235039695713b222e5a034fb5b9b1c' },
    hashes: ['61cf814eec46b294d6ea4401ac295d0cecd5207bd2331dcc5a15e7301d30ee44', '2ac6c6e8a478e23b15f76e4894af1fa2210f8f350e4e6e54aad530bec03efbfb'],
    url: (bold) => `${THAI}/NotoSansThai-${bold ? 'Bold' : 'Regular'}.ttf`,
  },
};

// The languages whose font explainroo downloads the first time it is needed.
export const FONT_LANGUAGES = Object.keys(FONTS);

export function languageFonts(language) {
  if (!Object.hasOwn(FONTS, language)) return [];
  const f = FONTS[language];
  return [400, 700].map((weight, i) => ({
    family: f.family, weight, file: `${language}-${weight}.${f.ext}`,
    path: path.join(cacheRoot(), 'fonts', `${language}-${weight}.${f.ext}`),
    url: f.url(i === 1),
    hash: f.hashes[i],
    size: f.size,
  }));
}

// The license of a language's downloaded font: { file, path }, or null.
export function languageFontLicense(language) {
  if (!Object.hasOwn(FONTS, language)) return null;
  const { file } = FONTS[language].license;
  return { file, path: path.join(cacheRoot(), 'fonts', file) };
}

// An OpenType font with CFF outlines starts with OTTO, one with TrueType outlines with 0x00010000.
function valid(data, hash) {
  const head = data.subarray(0, 4);
  return (head.toString() === 'OTTO' || head.equals(Buffer.from([0, 1, 0, 0]))) && crypto.createHash('sha256').update(data).digest('hex') === hash;
}

export async function ensureFonts(language, { log = () => {} } = {}) {
  const fonts = languageFonts(language);
  if (!fonts.length) return;
  for (const f of fonts) {
    if (fs.existsSync(f.path) && valid(fs.readFileSync(f.path), f.hash)) continue;
    if (process.env.EXPLAINROO_OFFLINE === '1') throw new Error(`${f.family} is missing or damaged. Run this command once without EXPLAINROO_OFFLINE to download the fonts.`);
    log(`downloading ${f.family} ${f.weight === 700 ? 'Bold' : 'Regular'} (about ${f.size}, first use only)`);
    try {
      const response = await fetch(f.url);
      if (!response.ok) throw new Error();
      const data = Buffer.from(await response.arrayBuffer());
      if (!valid(data, f.hash)) throw new Error();
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      const temp = `${f.path}.${crypto.randomBytes(8).toString('hex')}.part`;
      try {
        fs.writeFileSync(temp, data);
        fs.renameSync(temp, f.path);
      } finally { fs.rmSync(temp, { force: true }); }
    } catch {
      throw new Error(`${f.family} could not be downloaded or checked. Check your connection and run the command again.`);
    }
  }
  const { license: source } = FONTS[language];
  const license = path.join(cacheRoot(), 'fonts', source.file);
  if (!fs.existsSync(license)) {
    if (process.env.EXPLAINROO_OFFLINE === '1') throw new Error('the Noto font license is missing. Run once without EXPLAINROO_OFFLINE to download it.');
    const response = await fetch(source.url);
    if (!response.ok) throw new Error('the Noto font license could not be downloaded. Check your connection and try again.');
    const data = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(data).digest('hex') !== source.hash) throw new Error('the Noto font license could not be checked. Try again.');
    fs.writeFileSync(license, data);
  }
}

let hb;

// Keeps only the characters in text, so an exported player loads a few
// kilobytes of font instead of the full 16 MB file.
export function subsetFont(data, text) {
  hb ??= new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')))).exports;
  const pointer = hb.malloc(data.byteLength);
  new Uint8Array(hb.memory.buffer).set(data, pointer);
  const blob = hb.hb_blob_create(pointer, data.byteLength, 2, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const c of new Set(text)) hb.hb_set_add(unicodes, c.codePointAt(0));
  const result = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  hb.hb_face_destroy(face);
  hb.free(pointer);
  if (!result) throw new Error('a font could not be reduced to the characters of the video.');
  const out = hb.hb_face_reference_blob(result);
  const start = hb.hb_blob_get_data(out, 0);
  const bytes = Buffer.from(new Uint8Array(hb.memory.buffer).slice(start, start + hb.hb_blob_get_length(out)));
  hb.hb_blob_destroy(out);
  hb.hb_face_destroy(result);
  return bytes;
}
