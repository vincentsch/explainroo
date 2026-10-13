import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.js';
import { ProjectError, findProjectDir } from './project.js';

const BUILT_IN_FONTS = new Set(JSON.parse(fs.readFileSync(new URL('../fonts/fonts.json', import.meta.url), 'utf8')).map((f) => f.family));

export function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || ['.', '..'].includes(url.hostname)) {
    throw new ProjectError('capture needs an http:// or https:// URL.');
  }
  if (url.username || url.password) throw new ProjectError('capture does not log in. Remove the username and password from the URL.');
  return url;
}

export function isGoogleFont(value, hostCheck = (host) => host === 'fonts.gstatic.com') {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && hostCheck(url.hostname);
  } catch { return false; }
}

export function pickColors(samples, exclude = []) {
  const totals = new Map();
  for (const { color, area = 1 } of samples) {
    if (!/^#[0-9a-f]{6}$/i.test(color) || area <= 0) continue;
    const key = color.toLowerCase();
    const item = totals.get(key) || { color: key, area: 0, count: 0 };
    item.area += area;
    item.count++;
    totals.set(key, item);
  }
  const saturated = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((n) => parseInt(n, 16) / 255);
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    return hi > 0.15 && lo < 0.9 && hi - lo > 0.12 && (hi - lo) / hi > 0.25;
  };
  const ranked = [...totals.values()].sort((a, b) => b.area * b.count - a.area * a.count || a.color.localeCompare(b.color));
  const sum = [...totals.values()].reduce((n, x) => n + x.area, 0);
  return {
    accent: ranked.find((x) => saturated(x.color))?.color || null,
    other: [...totals.values()].filter((x) => !exclude.includes(x.color)).sort((a, b) => b.area - a.area || a.color.localeCompare(b.color)).slice(0, 6)
      .map((x) => ({ color: x.color, share: Math.round(x.area / sum * 1000) / 1000 })),
  };
}

export function rankLogos(candidates) {
  const score = (c) => c.type === 'svg' ? (c.kind === 'brand' ? 4 : 3) : (c.kind === 'og' ? 1 : 2);
  const seen = new Set();
  return candidates.filter((c) => ['svg', 'png'].includes(c.type))
    .sort((a, b) => score(b) - score(a) || b.area - a.area)
    .filter((c) => {
      const key = c.url || c.svg;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// This runs in the visited page. Read computed styles so CSS variables and
// inherited colors agree with the screenshots.
function inspectPage({ stylesheets, loadedFonts }) {
  const clean = (v) => (v || '').trim();
  const family = (v) => clean(v.split(',')[0]).replace(/^['"]|['"]$/g, '');
  const style = (el) => getComputedStyle(el);
  const visible = (el) => {
    const r = el.getBoundingClientRect(), c = style(el);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < 8000 && c.display !== 'none' && c.visibility === 'visible' && Number(c.opacity) > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const elements = [...document.querySelectorAll('body *')].filter(visible);
  const select = (q) => [...document.querySelectorAll(q)].filter(visible);
  const labels = (els, attr) => [...new Set(els.map((el) => clean(attr ? el.getAttribute(attr) : el.innerText || el.textContent)).filter(Boolean))].slice(0, 40);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const hex = (value) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const rgb = ctx.getImageData(0, 0, 1, 1).data;
    return rgb[3] ? '#' + [...rgb].slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('') : null;
  };
  const area = (el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(r.right, innerWidth) - Math.max(0, r.left)) * Math.max(0, Math.min(r.bottom, 8000) - Math.max(0, r.top));
  };
  const buttons = elements.filter((el) => el.matches('button, input[type=submit], input[type=button], [role=button]') ||
    (el.matches('a') && (/btn|button/i.test(el.className) || (hex(style(el).backgroundColor) && parseFloat(style(el).paddingLeft) >= 8))));
  const headings = select('h1, h2, h3, h4, h5, h6');
  const links = select('a');
  const body = document.body;
  const colors = {
    background: hex(style(body).backgroundColor) || hex(style(document.documentElement).backgroundColor) || '#ffffff',
    text: hex(style(body).color),
    heading: headings[0] ? hex(style(headings[0]).color) : null,
    link: links[0] ? hex(style(links[0]).color) : null,
  };
  const samples = elements.flatMap((el) => {
    const c = style(el), a = area(el);
    const r = el.getBoundingClientRect();
    return [{ color: hex(c.backgroundColor), area: a }, { color: hex(c.color), area: el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? a : 0 },
      { color: hex(c.borderTopColor), area: parseFloat(c.borderTopWidth) * r.width }, { color: hex(c.borderBottomColor), area: parseFloat(c.borderBottomWidth) * r.width },
      { color: hex(c.borderLeftColor), area: parseFloat(c.borderLeftWidth) * r.height }, { color: hex(c.borderRightColor), area: parseFloat(c.borderRightWidth) * r.height }];
  });
  samples.push({ color: colors.background, area: innerWidth * Math.min(8000, document.documentElement.scrollHeight) });
  const buttonSamples = buttons.map((el) => ({ color: hex(style(el).backgroundColor), area: area(el) }));
  const fonts = { body: family(style(body).fontFamily), headings: [...new Set(headings.map((el) => family(style(el).fontFamily)))], buttons: [...new Set(buttons.map((el) => family(style(el).fontFamily)))], families: [] };
  const names = [...new Set([fonts.body, ...fonts.headings, ...fonts.buttons])].filter(Boolean);
  const used = [body, ...elements];
  for (const name of names) {
    const uses = used.filter((el) => family(style(el).fontFamily) === name).map((el) => ({ weight: Number(style(el).fontWeight), style: style(el).fontStyle }));
    fonts.families.push({ family: name, uses: [...new Map(uses.map((u) => [JSON.stringify(u), u])).values()], faces: [], sources: [] });
  }
  for (const face of document.fonts) {
    const f = fonts.families.find((f) => f.family === family(face.family));
    if (f) f.faces.push({ weight: face.weight, style: face.style, status: face.status });
  }
  const loaded = new Set([...performance.getEntriesByType('resource').map((r) => r.name), ...loadedFonts]);
  const readRules = (rules, base) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const f = fonts.families.find((f) => f.family === family(rule.style.getPropertyValue('font-family')));
        if (!f) continue;
        for (const match of rule.style.getPropertyValue('src').matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
          const url = new URL(match[1], base).href;
          const weight = rule.style.getPropertyValue('font-weight').replace(/normal/g, '400').replace(/bold/g, '700') || '400';
          const source = { url, weight, style: rule.style.getPropertyValue('font-style') || 'normal', loaded: loaded.has(url) };
          if (!f.sources.some((s) => JSON.stringify(s) === JSON.stringify(source))) f.sources.push(source);
        }
      } else if (rule.styleSheet) {
        try { readRules(rule.styleSheet.cssRules, rule.styleSheet.href || base); } catch {}
      } else if (rule.cssRules) readRules(rule.cssRules, base);
    }
  };
  for (const sheet of document.styleSheets) {
    try { readRules(sheet.cssRules, sheet.href || document.baseURI); } catch {}
  }
  // Cross-origin stylesheets may hide their CSSOM. Their already loaded
  // response bodies still let us match font URLs to families without a fetch.
  for (const { css, url } of stylesheets) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      readRules(sheet.cssRules, url);
    } catch {}
  }
  const siteName = clean(document.querySelector('meta[property="og:site_name"]')?.content) || location.hostname.replace(/^www\./, '').split('.')[0];
  const candidates = [];
  const firstHome = [...document.querySelectorAll('a[href]')].find((el) => {
    try { const u = new URL(el.href); return u.origin === location.origin && u.pathname === '/'; } catch { return false; }
  });
  const type = (url, mime = '') => /svg/i.test(mime) || /\.svg(?:[?#]|$)|^data:image\/svg\+xml/i.test(url) ? 'svg' : /png/i.test(mime) || /\.png(?:[?#]|$)|^data:image\/png/i.test(url) ? 'png' : null;
  for (const el of select('header svg, header img, nav svg, nav img, [role=banner] svg, [role=banner] img, a svg, a img')) {
    if (!el.closest('header, nav, [role=banner]') && !firstHome?.contains(el)) continue;
    const parent = el.closest('a');
    const identity = [el, parent].filter(Boolean).flatMap((n) => ['id', 'class', 'alt', 'aria-label', 'src'].map((a) => n.getAttribute(a) || '')).join(' ').toLowerCase();
    if (!identity.includes('logo') && !(siteName.length > 1 && identity.includes(siteName.toLowerCase()))) continue;
    const c = { kind: 'brand', area: area(el), color: style(el).color };
    if (el.tagName.toLowerCase() === 'svg') {
      const copy = el.cloneNode(true);
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const copies = [copy, ...copy.querySelectorAll('*')];
      [el, ...el.querySelectorAll('*')].forEach((original, i) => {
        const target = copies[i], computed = style(original);
        for (const attr of target.getAttributeNames()) target.setAttribute(attr, target.getAttribute(attr).replace(/currentColor/gi, computed.color));
        for (const prop of ['fill', 'stroke', 'color']) target.style.setProperty(prop, computed[prop].replace(/url\(["']?[^)"']*#([^)'" ]+)["']?\)/g, 'url(#$1)'));
      });
      candidates.push({ ...c, type: 'svg', svg: new XMLSerializer().serializeToString(copy) });
    } else candidates.push({ ...c, type: type(el.currentSrc || el.src), url: el.currentSrc || el.src });
  }
  for (const el of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], meta[property="og:image"]')) {
    const url = el.href || new URL(el.content, document.baseURI).href;
    const sizes = (el.getAttribute('sizes') || '').match(/(\d+)x(\d+)/);
    candidates.push({ kind: el.tagName === 'META' ? 'og' : 'icon', type: type(url, el.type), url, area: sizes ? Number(sizes[1]) * Number(sizes[2]) : 0 });
  }
  return {
    url: location.href, title: document.title, description: document.querySelector('meta[name="description"]')?.content || null,
    themeColor: hex(document.querySelector('meta[name="theme-color"]')?.content || 'transparent'),
    colors, samples, buttonSamples, fonts, candidates,
    text: { h1: labels(select('h1')), h2: labels(select('h2')), navigation: labels(select('nav a, [role=navigation] a')), buttons: [...new Set(buttons.map((el) => clean(el.value || el.innerText || el.getAttribute('aria-label'))).filter(Boolean))].slice(0, 40), labels: labels(select('label')), placeholders: labels(select('input[placeholder], textarea[placeholder]'), 'placeholder') },
  };
}

async function loadPage(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    if (!response || !response.ok()) throw new Error('page returned an error');
    validateUrl(page.url());
    // Background polling may never stop. Give it time to settle, then capture
    // the loaded page; fonts still have to finish within the same limit.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.fonts.status === 'loaded', { timeout: 10000 });
  } catch {
    throw new ProjectError('the page did not load. Check the URL and try capture again.');
  }
}

async function screenshots(page, dir, prefix = '') {
  await page.screenshot({ path: path.join(dir, prefix ? 'mobile.png' : 'page.png'), timeout: 15000 });
  const height = await page.evaluate(() => Math.min(8000, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight)));
  await page.screenshot({ path: path.join(dir, `${prefix}full.png`), fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height }, timeout: 15000 });
}

async function download(context, url) {
  if (/^data:/i.test(url)) {
    const match = /^data:image\/(svg\+xml|png)(;base64)?,([\s\S]*)$/i.exec(url);
    if (!match) throw new Error('unsupported image');
    return Buffer.from(match[2] ? match[3] : decodeURIComponent(match[3]), match[2] ? 'base64' : 'utf8');
  }
  validateUrl(url);
  const response = await context.request.get(url, { timeout: 15000 });
  if (!response.ok()) throw new Error('file did not load');
  return response.body();
}

export async function capture(project, value, { mobile = false, googleHostCheck } = {}) {
  const url = validateUrl(value);
  const projectDir = findProjectDir(typeof project === 'string' ? project : project?.dir);
  const host = url.hostname.replace(/[:[\]]/g, '_');
  const relative = `assets/capture/${host}`;
  const dest = path.join(projectDir, relative);
  for (const folder of ['assets', 'assets/capture', relative]) {
    const file = path.join(projectDir, folder);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new ProjectError(`${folder} must be a folder, not a link or file. Move it and try capture again.`);
  }
  const browser = await launch();
  let temp;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const cssResponses = [];
    const loadedFonts = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'stylesheet') {
        cssResponses.push(response.text().then((css) => ({ css, url: response.url() })).catch(() => null));
      }
      if (response.request().resourceType() === 'font' && response.ok()) loadedFonts.push(response.url());
    });
    await loadPage(page, url.href);
    const stylesheets = (await Promise.all(cssResponses)).filter(Boolean);
    const data = await page.evaluate(inspectPage, { stylesheets, loadedFonts });
    const { samples, buttonSamples, candidates, ...result } = data;
    result.colors.accent = pickColors(buttonSamples).accent;
    result.colors.other = pickColors(samples, Object.values(result.colors).filter(Boolean)).other;
    result.brand = {};
    for (const [key, val] of Object.entries({ accent: result.colors.accent, background: result.colors.background, ink: result.colors.text, font: result.fonts.body })) {
      if (val) result.brand[key] = val;
    }
    result.notes = [];
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    temp = fs.mkdtempSync(path.join(path.dirname(dest), `.${host}-`));
    await screenshots(page, temp);
    result.logo = { picked: null, candidates: [] };
    const logos = [];
    for (const candidate of candidates) {
      try {
        const bytes = candidate.svg ? Buffer.from(candidate.svg) : await download(context, candidate.url);
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const type = png ? 'png' : /<svg[\s>]/i.test(bytes.toString()) ? 'svg' : null;
        if (type) logos.push({ ...candidate, bytes, type, area: png && bytes.length >= 24 ? bytes.readUInt32BE(16) * bytes.readUInt32BE(20) : candidate.area });
      } catch { result.notes.push(`Could not save a logo from ${candidate.url || 'the page'}.`); }
    }
    for (const candidate of rankLogos(logos).slice(0, 3)) {
      const n = result.logo.candidates.length;
      const file = `${relative}/logo${n ? '-' + (n + 1) : ''}.${candidate.type}`;
      fs.writeFileSync(path.join(temp, path.basename(file)), candidate.bytes);
      result.logo.candidates.push({ file, source: candidate.url || 'inline SVG', kind: candidate.kind });
    }
    result.logo.picked = result.logo.candidates[0]?.file || null;
    if (result.logo.picked) result.brand.logo = result.logo.picked;
    const savedFonts = [];
    for (const f of result.fonts.families) {
      if (BUILT_IN_FONTS.has(f.family)) {
        result.notes.push(`${f.family} is built into explainroo. It needs no font files.`);
        continue;
      }
      let saved = false;
      for (const source of f.sources) {
        const range = source.weight.split(/\s+/).map(Number);
        const used = f.uses.some((u) => u.weight >= range[0] && u.weight <= range.at(-1) && u.style === source.style);
        if (!source.loaded || !used || !isGoogleFont(source.url, googleHostCheck)) continue;
        try {
          const bytes = await download(context, source.url);
          const ext = /\.(woff2?|ttf|otf)$/i.exec(new URL(source.url).pathname)?.[0] || '.woff2';
          const name = f.family.replace(/[^a-z0-9-]/gi, '-') || 'font';
          const file = `${relative}/fonts/${name}-${source.weight.replace(/\s+/g, '-')}-${savedFonts.length + 1}${ext}`;
          fs.mkdirSync(path.join(temp, 'fonts'), { recursive: true });
          fs.writeFileSync(path.join(temp, 'fonts', path.basename(file)), bytes);
          savedFonts.push({ family: f.family, src: file, weight: range.length === 1 ? range[0] : source.weight, style: source.style });
          saved = true;
        } catch { result.notes.push(`Could not save ${f.family}. Get the font files and check the license.`); }
      }
      if (!saved) result.notes.push(`${f.family}: get the font files and check the license. Copy the license file next to them.`);
    }
    if (mobile) {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const mobilePage = await phone.newPage();
      await loadPage(mobilePage, url.href);
      await screenshots(mobilePage, temp, 'mobile-');
    }
    result.suggestion = { brand: result.brand, fonts: savedFonts };
    const files = fs.readdirSync(temp).filter((name) => name !== 'fonts').map((name) => `${relative}/${name}`);
    result.files = [...files, ...savedFonts.map((f) => f.src), `${relative}/capture.json`].sort();
    fs.writeFileSync(path.join(temp, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(temp, dest);
    return result;
  } finally {
    await browser.close();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}
