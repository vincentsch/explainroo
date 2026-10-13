#!/usr/bin/env node
// Downloads the bundled OFL fonts from Google Fonts into fonts/ and writes
// fonts/fonts.json. The fonts are committed, so users never need this script;
// it exists so the bundle can be rebuilt or extended.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'fonts');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const FAMILIES = [
  ['Kalam', [400, 700]],
  ['Patrick Hand', [400]],
  ['Cabin Sketch', [400, 700]],
  ['Architects Daughter', [400]],
  ['Inter', [400, 600, 800]],
  ['Plus Jakarta Sans', [600, 800]],
  ['Space Grotesk', [500, 700]],
  ['JetBrains Mono', [400, 700]],
];
const SUBSETS = new Set(['latin', 'latin-ext']);

fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.woff2')) fs.rmSync(path.join(dir, f));
const manifest = [];
const seen = new Map(); // variable fonts serve one file for several weights
for (const [family, weights] of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(';')}&display=block`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const blocks = css.split('/* ').slice(1);
  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf(' */')).trim();
    if (!SUBSETS.has(subset)) continue;
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)[1]);
    const src = /src:\s*url\(([^)]+)\)/.exec(block)[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)[1].trim();
    if (seen.has(src)) {
      manifest.push({ family, weight, subset, file: seen.get(src), unicodeRange: range });
      continue;
    }
    const file = `${family.replace(/\s+/g, '')}-${weight}-${subset}.woff2`;
    const buf = Buffer.from(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(dir, file), buf);
    seen.set(src, file);
    manifest.push({ family, weight, subset, file, unicodeRange: range });
    console.log(`${file}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}
for (const [weight, style] of [[400, 'Regular'], [700, 'Bold']]) {
  const file = `NotoSansDevanagari-${weight}.ttf`;
  const res = await fetch(`https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-${style}.ttf`);
  if (!res.ok) throw new Error(`no ${file} (${res.status})`);
  fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
  manifest.push({ family: 'Noto Sans Devanagari', weight, subset: 'devanagari', file, unicodeRange: 'U+0900-097F,U+1CD0-1CFF,U+200C-200D,U+20B9,U+25CC,U+A8E0-A8FF' });
}
fs.writeFileSync(path.join(dir, 'fonts.json'), JSON.stringify(manifest, null, 2) + '\n');

// SIL Open Font License texts, one per family.
fs.mkdirSync(path.join(dir, 'licenses'), { recursive: true });
for (const [family] of [...FAMILIES, ['Noto Sans Devanagari']]) {
  const slug = family.toLowerCase().replace(/\s+/g, '');
  const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`);
  if (!res.ok) throw new Error(`no OFL.txt for ${family} (${res.status})`);
  fs.writeFileSync(path.join(dir, 'licenses', `${family.replace(/\s+/g, '')}-OFL.txt`), await res.text());
}
console.log(`${manifest.length} font files`);
