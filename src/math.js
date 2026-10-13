// Typesets locally in Node. The page gets paths, not fonts or SVG references.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolutize, parsePath, serialize } from '../engine/pathdata.js';

export const MAX_TEX_LENGTH = 4096;
let ready;

export function mathHash(tex, display = true) {
  return crypto.createHash('sha256').update(JSON.stringify(['mathjax-4.1.3-1', tex, display])).digest('hex');
}

export async function typesetMath(tex, display = true, cacheFile = null) {
  if (typeof tex !== 'string' || tex.length > MAX_TEX_LENGTH) throw new Error(`math: use a TeX string of at most ${MAX_TEX_LENGTH} characters`);
  if (typeof display !== 'boolean') throw new Error('math: display must be true or false');
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  ready ??= import('mathjax').then(({ default: mj }) => mj.init({
    // MathJax imports its parts by file path. On Windows a bare path like
    // D:\\... is not a valid import specifier, so hand it a file URL.
    loader: {
      load: ['input/tex', 'output/svg'],
      require: (file) => import(path.isAbsolute(file) ? pathToFileURL(file).href : file),
      failed: (error) => { throw error; },
    },
    tex: {
      packages: { '[-]': ['autoload', 'require', 'noundefined'] },
      formatError: (_jax, error) => { throw new Error(error.message); },
    },
    svg: { fontCache: 'none' },
  }));
  const mj = await ready;
  if (!mj?.startup) throw new Error('math: MathJax could not start. Run npm install in the explainroo folder.');
  // Each formula has its own macros and equation counters, whatever the order.
  const doc = mj.startup.mathjax.document('', { InputJax: mj.startup.getInputJax(), OutputJax: mj.startup.getOutputJax() });
  const node = await doc.convertPromise(tex, { display });
  const a = mj.startup.adaptor;
  const svg = a.firstChild(node);
  const viewBox = a.getAttribute(svg, 'viewBox').split(/\s+/).map(Number);
  const paths = [];
  const walk = (node, matrix) => {
    matrix = svgTransform(matrix, a.getAttribute(node, 'transform') || '');
    const kind = a.kind(node);
    let d = kind === 'path' ? a.getAttribute(node, 'd') : null;
    if (kind === 'rect') {
      const x = Number(a.getAttribute(node, 'x') || 0);
      const y = Number(a.getAttribute(node, 'y') || 0);
      const w = Number(a.getAttribute(node, 'width'));
      const h = Number(a.getAttribute(node, 'height'));
      d = `M${x} ${y}h${w}v${h}h${-w}Z`;
    }
    if (kind === 'text' || kind === 'use') throw new Error('math: this character has no glyph path; use TeX symbols');
    if (d) paths.push(serialize(absolutize(parsePath(d)).map(({ c, v }) => {
      if (c === 'A') throw new Error('math: this glyph has an unsupported arc');
      const points = [];
      for (let i = 0; i < v.length; i += 2) points.push(matrix[0] * v[i] + matrix[2] * v[i + 1] + matrix[4], matrix[1] * v[i] + matrix[3] * v[i + 1] + matrix[5]);
      return { c, v: points };
    })));
    for (const child of a.childNodes(node)) if (!a.kind(child).startsWith('#')) walk(child, matrix);
  };
  walk(svg, [1, 0, 0, 1, 0, 0]);
  const result = { paths, viewBox, unitsPerEm: 1000, ascent: -viewBox[1], descent: viewBox[1] + viewBox[3] };
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function svgTransform(matrix, source) {
  for (const [, name, args] of source.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = args.trim().split(/[\s,]+/).map(Number);
    let m;
    if (name === 'translate') m = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (name === 'scale') m = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (name === 'matrix') m = n;
    else throw new Error(`math: unsupported SVG transform "${name}"`);
    matrix = multiply(matrix, m);
  }
  return matrix;
}
