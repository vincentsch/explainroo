// explainroo record: runs a recording script in a real browser and saves the
// video with a log of every step. The script is recordings/<name>.json in the
// project. The video goes to assets/recordings/<name>.webm, and the log, with
// the time and the box of each step, to assets/recordings/<name>.log.json,
// where s.recording reads it. The browser starts from an empty profile under
// the cache on every run, or with --keep-profile from the project's own one,
// never the one a person uses.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchProfile, recordEncoder } from './browser.js';
import { ProjectError, findProjectDir } from './project.js';
import { cacheRoot } from './models.js';
import { ffmpeg, probe } from './ffmpeg.js';
import { selfCommand } from './history.js';
import { dropClipFrames } from './clips.js';
import { ease, suggest } from '../engine/util.js';
import { ZOOM_SECONDS, ZOOM_SCALES } from '../engine/recording.js';

export const STEP_KINDS = ['open', 'click', 'type', 'hover', 'scroll', 'wait', 'zoom', 'mark'];
// The keys each kind of step takes, besides do, cue, before and the element.
const STEP_KEYS = {
  open: ['url'],
  click: ['duration'],
  type: ['value', 'press', 'duration'],
  hover: ['duration'],
  scroll: ['y', 'duration'],
  wait: ['seconds'],
  zoom: ['scale'],
  mark: ['name'],
};
const ELEMENT = { click: 'needs', type: 'needs', hover: 'needs', scroll: 'may', wait: 'may', zoom: 'may', open: 'no', mark: 'no' };
const COMMON = ['do', 'cue', 'before', 'text', 'selector', 'nth'];
// How long a step looks for its element before it fails.
const FIND_SECONDS = 10;
// How long the video goes on after the last step, so its end can hold still.
const TAIL_SECONDS = 1;
// How long the pointer takes to move to an element, and a scroll of one window
// height, at pace 1. A script's pace divides them, and a step's duration
// replaces them for that step.
export const MOVE_SECONDS = 0.6;
export const SCROLL_SECONDS = 1;
const PACES = [0.5, 2];

const quoted = (v) => JSON.stringify(v);
// A small object as one line of JSON with spaces, like { "do": "scroll", "text": "Pricing" }.
const jsonLine = (o) => `{ ${Object.entries(o).map(([k, v]) => `${quoted(k)}: ${quoted(v)}`).join(', ')} }`;

export function isRecordingName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(name);
}

export function scriptPath(dir, name) {
  return path.join(dir, 'recordings', `${name}.json`);
}

// The step log of a recording, which s.recording reads. Logs made before it
// had its own name are <name>.json, and they still play.
export function logPath(dir, name) {
  return path.join(dir, 'assets', 'recordings', `${name}.log.json`);
}

export function oldLogPath(dir, name) {
  return path.join(dir, 'assets', 'recordings', `${name}.json`);
}

// A step log read from a file, or null when it isn't one.
export function readLog(file) {
  let log;
  try { log = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  return log?.version === 1 && Array.isArray(log.steps) ? log : null;
}

// What a step looks for, in words for messages: the text "Save" or the
// selector "#total".
export function stepTarget(step) {
  if (step.text !== undefined) return `the text ${quoted(step.text)}${step.nth > 1 ? ` (number ${step.nth})` : ''}`;
  if (step.selector !== undefined) return `the selector ${quoted(step.selector)}${step.nth > 1 ? ` (number ${step.nth})` : ''}`;
  return null;
}

export function stepLabel(step, n) {
  const target = step.text ?? step.selector;
  return `step ${n} (${step.do}${target !== undefined ? ` ${quoted(target)}` : step.name !== undefined ? ` ${quoted(step.name)}` : ''})`;
}

// Reads and checks recordings/<name>.json. Every mistake names its step and
// what to write instead, so a script can be fixed before a browser starts.
export function readRecordingScript(dir, name) {
  if (!isRecordingName(name)) throw new ProjectError(`"${name}" can't be a recording name. A name uses letters, digits and hyphens and starts with a letter or a digit, like "new-invoice".`);
  const file = scriptPath(dir, name);
  const rel = `recordings/${name}.json`;
  if (!fs.existsSync(file)) {
    const have = fs.existsSync(path.join(dir, 'recordings')) ? fs.readdirSync(path.join(dir, 'recordings')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
    throw new ProjectError(`${rel} is missing. Write the script there first, see "explainroo docs scene-api recording".${have.length ? ` Scripts in recordings/: ${have.join(', ')}` : ''}`);
  }
  let script;
  try { script = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ProjectError(`${rel} is not valid JSON: ${e.message}`); }
  return checkRecordingScript(script, rel);
}

export function checkRecordingScript(script, rel = 'the recording script') {
  const fail = (m) => { throw new ProjectError(`${rel}: ${m}`); };
  if (!script || typeof script !== 'object' || Array.isArray(script)) fail('must be an object like { "url": "http://localhost:3000/", "steps": [...] }');
  const unknown = Object.keys(script).filter((k) => !['url', 'viewport', 'pace', 'steps', 'blur'].includes(k));
  if (unknown.length) fail(`unknown key ${quoted(unknown[0])}. The keys are url, viewport, pace, steps and blur`);
  const url = checkUrl(script.url, fail, 'url');
  const viewport = { width: 1920, height: 1080 };
  if (script.viewport !== undefined) {
    const v = script.viewport;
    if (!v || typeof v !== 'object' || Object.keys(v).some((k) => !['width', 'height'].includes(k))) fail('viewport must be like { "width": 1920, "height": 1080 }');
    for (const k of ['width', 'height']) {
      if (v[k] === undefined) continue;
      if (!Number.isInteger(v[k]) || v[k] < 320 || v[k] > 3840 || v[k] % 2) fail(`viewport.${k} must be an even number of pixels from 320 to 3840`);
      viewport[k] = v[k];
    }
  }
  const pace = script.pace ?? 1;
  if (typeof pace !== 'number' || !(pace >= PACES[0] && pace <= PACES[1])) fail(`pace must be a number from ${PACES[0]} to ${PACES[1]}: 2 moves the pointer and scrolls twice as fast, 0.5 half as fast`);
  if (!Array.isArray(script.steps) || !script.steps.length) fail('steps must be a list with at least one step, like [{ "do": "click", "text": "New invoice" }]');
  const names = new Set();
  const steps = script.steps.map((raw, i) => {
    const n = i + 1;
    const bad = (m) => fail(`step ${n}: ${m}`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('must be an object like { "do": "click", "text": "Save" }');
    if (!STEP_KINDS.includes(raw.do)) bad(`"do" must be one of ${STEP_KINDS.join(', ')}${typeof raw.do === 'string' ? `, not ${quoted(raw.do)}${suggest(raw.do, STEP_KINDS, 1).length ? `. Did you mean ${quoted(suggest(raw.do, STEP_KINDS, 1)[0])}?` : ''}` : ''}`);
    const allowed = [...COMMON, ...STEP_KEYS[raw.do]];
    const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
    if (extra.length) bad(`a ${raw.do} step has no ${quoted(extra[0])}. It takes ${allowed.filter((k) => k !== 'do' && (ELEMENT[raw.do] !== 'no' || !['text', 'selector', 'nth'].includes(k))).join(', ')}`);
    const step = { do: raw.do };
    const has = ['text', 'selector'].filter((k) => raw[k] !== undefined);
    if (has.length === 2) bad('give text or selector, not both');
    if (ELEMENT[raw.do] === 'no' && has.length) bad(`a ${raw.do} step has no element, so leave out ${has[0]}`);
    if (ELEMENT[raw.do] === 'needs' && !has.length) bad(`a ${raw.do} step needs the element: "text" with the words it shows, or a CSS "selector"`);
    for (const k of has) {
      if (typeof raw[k] !== 'string' || !raw[k].trim()) bad(`${k} must be a non-empty string`);
      step[k] = raw[k];
    }
    if (raw.nth !== undefined) {
      if (!has.length) bad('nth counts matches of text or selector, so it needs one of them');
      if (!Number.isInteger(raw.nth) || raw.nth < 1) bad('nth must be 1 or more: 2 is the second match from the top');
      step.nth = raw.nth;
    }
    if (raw.cue !== undefined) {
      if (typeof raw.cue !== 'string' || !raw.cue.trim() || raw.cue === '#') bad('cue must be a spoken word or a "#marker" of the scene that plays the recording');
      step.cue = raw.cue;
    }
    if (raw.before !== undefined) {
      if (typeof raw.before !== 'boolean') bad('before must be true or false');
      if (raw.before && script.steps.slice(0, i).some((s) => !s?.before)) bad('a step with "before": true runs before the video starts, so it has to come before every other step');
      if (raw.before && raw.cue !== undefined) bad('a step with "before": true is not in the video, so it can have no cue');
      if (raw.before) step.before = true;
    }
    if (raw.do === 'open') step.url = checkUrl(raw.url, bad, 'url', url).href;
    if (raw.do === 'type') {
      if (typeof raw.value !== 'string') bad('a type step needs "value", the words it types, like { "do": "type", "text": "Customer", "value": "Acme Inc." }');
      step.value = raw.value;
      if (raw.press !== undefined) {
        if (typeof raw.press !== 'string' || !raw.press) bad('press must be a key name like "Enter" or "Tab"');
        step.press = raw.press;
      }
    }
    if (raw.do === 'scroll') {
      if (raw.y !== undefined && has.length) bad('give y or the element to scroll to, not both');
      if (raw.y === undefined && !has.length) bad('a scroll step needs "y", the pixels to scroll down (negative goes up), or the element to scroll to');
      if (raw.y !== undefined) {
        if (typeof raw.y !== 'number' || !Number.isFinite(raw.y) || raw.y === 0 || Math.abs(raw.y) > 20000) bad('y must be the pixels to scroll, like 600 or -300');
        step.y = raw.y;
      }
    }
    if (raw.do === 'wait') {
      if (raw.seconds !== undefined && has.length) bad('give seconds or the element to wait for, not both');
      if (raw.seconds === undefined && !has.length) bad('a wait step needs "seconds", or the element to wait for, like { "do": "wait", "text": "Saved" }');
      if (raw.seconds !== undefined) {
        if (typeof raw.seconds !== 'number' || !(raw.seconds > 0 && raw.seconds <= 60)) bad('seconds must be more than 0 and at most 60');
        step.seconds = raw.seconds;
      }
    }
    if (raw.duration !== undefined) {
      if (typeof raw.duration !== 'number' || !(raw.duration > 0 && raw.duration <= 10)) bad(`duration must be the seconds the ${raw.do === 'scroll' ? 'scroll' : 'pointer move'} takes, more than 0 and at most 10`);
      step.duration = raw.duration;
    }
    if (raw.scale !== undefined) {
      if (!has.length) bad('a zoom without an element goes back out, so it takes no scale');
      if (typeof raw.scale !== 'number' || !(raw.scale >= ZOOM_SCALES[0] && raw.scale <= ZOOM_SCALES[1])) bad(`scale must be how many times closer the zoom goes, from ${ZOOM_SCALES[0]} to ${ZOOM_SCALES[1]}`);
      step.scale = raw.scale;
    }
    if (raw.do === 'mark') {
      if (!isRecordingName(raw.name)) bad('a mark step needs a "name" with letters, digits and hyphens, like "saved"');
      if (names.has(raw.name)) bad(`the mark name ${quoted(raw.name)} is used twice`);
      names.add(raw.name);
      step.name = raw.name;
    }
    return step;
  });
  if (steps.every((s) => s.before)) fail('every step has "before": true, so nothing is left for the video');
  const blur = [];
  if (script.blur !== undefined) {
    if (!Array.isArray(script.blur)) fail('blur must be a list like [{ "selector": ".email" }, { "text": "jane@example.com" }]');
    for (const [i, b] of script.blur.entries()) {
      const keys = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b) : [];
      if (keys.length !== 1 || !['selector', 'text'].includes(keys[0]) || typeof b[keys[0]] !== 'string' || !b[keys[0]].trim()) fail(`blur ${i + 1} must be { "selector": "<CSS selector>" } or { "text": "<the exact words>" }`);
      blur.push({ [keys[0]]: b[keys[0]] });
    }
  }
  return { url: url.href, viewport, pace, steps, blur };
}

function checkUrl(value, fail, key, base) {
  let url;
  try { url = base ? new URL(value, base) : new URL(value); } catch {}
  if (typeof value !== 'string' || !url || !['http:', 'https:'].includes(url.protocol)) fail(`${key} must be an http:// or https:// address${base ? ', or a path like "/settings"' : ''}, like "http://localhost:3000/"`);
  if (url.username || url.password) fail(`${key} can't hold a username or password. Log in with type steps marked "before": true, and blur what must not show`);
  return url;
}

// The hash of a script, kept in the log. check compares it, so a scene never
// plays an old recording of a script that has changed.
export function scriptHash(script) {
  return crypto.createHash('sha256').update(JSON.stringify(script)).digest('hex').slice(0, 16);
}

// --- in the page -----------------------------------------------------------

// Runs in every page before its own scripts: blurs what the script names, and
// keeps links and window.open in this tab, so the video follows them.
function pageSetup(blur) {
  const seen = new Set();
  window.__explainrooBlurSeen = seen;
  const selectors = blur.map((b, i) => ({ ...b, i })).filter((b) => b.selector);
  const texts = blur.map((b, i) => ({ ...b, i })).filter((b) => b.text);
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const STYLE = 'filter: blur(9px) !important;';
  const style = document.createElement('style');
  style.textContent = selectors.map((b) => `${b.selector} { ${STYLE} }`).join('\n');
  const mark = (el, i) => {
    seen.add(i);
    if (el.style.getPropertyValue('filter') !== 'blur(9px)') el.style.setProperty('filter', 'blur(9px)', 'important');
  };
  const pass = () => {
    if (!style.isConnected) (document.head || document.documentElement).append(style);
    for (const b of selectors) {
      try { if (document.querySelector(b.selector)) seen.add(b.i); } catch {}
    }
    if (!texts.length || !document.body) return;
    for (const b of texts) {
      const want = norm(b.text);
      for (const el of document.body.querySelectorAll('*')) {
        if (el.matches('input, textarea')) {
          if (norm(el.value) === want) mark(el, b.i);
          continue;
        }
        if (norm(el.textContent) !== want) continue;
        // The smallest element with exactly these words.
        if ([...el.children].some((c) => norm(c.textContent) === want)) continue;
        mark(el, b.i);
      }
    }
  };
  new MutationObserver(pass).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', pass, true);
  document.addEventListener('DOMContentLoaded', pass);
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[target]') : null;
    if (a) a.target = '_self';
  }, true);
  window.open = (u) => { if (u) location.href = u; return window; };
  pass();
}

// Finds the element of a step in the page. Returns its box in the viewport, or
// the words the page shows, for the message when it isn't there.
function findInPage({ text, selector, nth = 1, forTyping = false }) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const ACTIVE = 'button, a, input, select, textarea, summary, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [contenteditable=""], [contenteditable=true]';
  const named = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('alt'), el.matches('input[type=submit], input[type=button]') ? el.value : null].map(norm).filter(Boolean);
  let hits = [];
  if (selector !== undefined) {
    let all;
    try { all = [...document.querySelectorAll(selector)]; } catch { return { error: 'selector' }; }
    hits = all.filter(visible);
  } else {
    const want = norm(text);
    const pick = (same) => {
      const out = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (!visible(el)) continue;
        // Its own words count too, like a label's around its field.
        const ownText = norm([...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '));
        const own = named(el).some((n) => same(n, want)) || (ownText && same(ownText, want));
        const words = !el.matches('input, textarea, select') && same(norm(el.innerText), want);
        if (!own && !words) continue;
        // The smallest element with these words, unless a button or link
        // around it shows the same words: then that is what a person clicks.
        if (words && !own && [...el.children].some((c) => visible(c) && same(norm(c.innerText), want))) continue;
        out.push(el);
      }
      return out;
    };
    hits = pick((a, b) => a === b);
    if (!hits.length) hits = pick((a, b) => a.toLowerCase() === b.toLowerCase());
    hits = hits.map((el) => {
      const up = el.parentElement?.closest(ACTIVE);
      return !el.matches(ACTIVE) && up && norm(up.innerText) === norm(el.innerText) ? up : el;
    });
    hits = [...new Set(hits)].filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    hits.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
  }
  let el = hits[nth - 1];
  if (!el) {
    const words = new Set();
    for (const e of document.body.querySelectorAll(ACTIVE + ', h1, h2, h3, h4, th, [placeholder], [aria-label]')) {
      if (!visible(e)) continue;
      for (const w of [norm(e.innerText), ...named(e)]) if (w && w.length <= 60) words.add(w);
    }
    return { found: hits.length, words: [...words] };
  }
  // A label types into its field.
  if (forTyping && el.matches('label') && el.control) el = el.control;
  // Kept for the steps that follow: what covers it, and scrolling to it.
  window.__explainrooTarget = el;
  const r = el.getBoundingClientRect();
  // Finding never scrolls, so the video shows no jump. The middle of the
  // element has to be in the window for a step to use it.
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const inView = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
  return { box: { x, y, w: r.width, h: r.height }, inView };
}

// What a click at x,y would hit instead of the element findInPage found last:
// null when the hit is the element, inside it, or a button or link around it,
// as when a label inside a button lets clicks through.
function coverInPage({ x, y }) {
  const el = window.__explainrooTarget;
  if (!el?.isConnected) return null;
  const hit = document.elementFromPoint(x, y);
  if (hit && (hit === el || el.contains(hit) || (hit.contains(el) && hit.matches('button, a, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option]')) || hit.control === el)) return null;
  if (!hit) return 'nothing, as the point is outside the window';
  const words = String(hit.innerText ?? '').replace(/\s+/g, ' ').trim();
  const classes = [...hit.classList].slice(0, 3).map((c) => `.${c}`).join('');
  return `<${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${classes}>${words ? ` with the words "${words.length > 40 ? words.slice(0, 37) + '...' : words}"` : ''}`;
}

// How far the window has to scroll down, less than 0 for up, to put the
// element findInPage found last in its middle.
function scrollToMiddle() {
  const el = window.__explainrooTarget;
  if (!el?.isConnected) return 0;
  const r = el.getBoundingClientRect();
  return r.top + r.height / 2 - innerHeight / 2;
}

// --- the run ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 1000) / 1000;
const roundBox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

// The video's clock. Chrome sends the first frame of the video a moment after
// the page opens, and how long that takes depends on the browser and on how
// busy the computer is: up to a few tenths of a second, enough to show a
// button already pressed while playback holds the frame before its click.
// So before the app opens, the page paints the time as SYNC_BITS black and
// white blocks across its middle, and the frames of that say how far the
// video's clock is from the log's. The video before start is never shown.
const SYNC_BITS = 24;
const SYNC_SECONDS = 0.8;
function syncPage() {
  const c = document.createElement('canvas');
  c.width = innerWidth;
  c.height = innerHeight;
  c.style.cssText = 'position:fixed;inset:0';
  document.body.style.margin = '0';
  document.body.append(c);
  const ctx = c.getContext('2d');
  const w = Math.floor(innerWidth / 24);
  const paint = () => {
    const t = Date.now() % 16777216;
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = (t >> i) & 1 ? '#fff' : '#000';
      ctx.fillRect(i * w, 0, w, innerHeight);
    }
    requestAnimationFrame(paint);
  };
  paint();
}

// How many seconds the log's clock is ahead of the video's, less than 0 when it
// is behind, from the frames of the sync page, or 0 when they can't be read.
// `zero` is the Date.now() of the log's 0.
export async function videoOffset(file, { width, height, zero }) {
  const w = Math.floor(width / SYNC_BITS);
  const { stdout, stderr } = await ffmpeg(['-loglevel', 'info', '-t', String(SYNC_SECONDS + 2), '-i', file, '-an',
    '-vf', `crop=${w * SYNC_BITS}:2:0:${Math.floor(height / 4) * 2},scale=${SYNC_BITS}:1:flags=area,format=gray,showinfo`, '-f', 'rawvideo', '-'], { binary: true }).catch(() => ({ stdout: Buffer.alloc(0), stderr: '' }));
  const times = [...stderr.matchAll(/\bpts_time:\s*([-\d.e]+)/g)].map((m) => Number(m[1]));
  const n = stdout.length / SYNC_BITS;
  if (!n || times.length !== n) return 0;
  const offsets = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    let v = 0;
    let clean = true;
    for (let b = 0; b < SYNC_BITS; b++) {
      const px = stdout[i * SYNC_BITS + b];
      if (px > 192) v += 2 ** b;
      else if (px > 64) clean = false;
    }
    // Only the first frame that shows a time: a repeated frame shows it late.
    if (!clean || v === last) continue;
    last = v;
    const page = (((v - zero) % 16777216) + 16777216) % 16777216 / 1000;
    if (page <= SYNC_SECONDS + 1) offsets.push(page - times[i]);
  }
  if (offsets.length < 3) return 0;
  offsets.sort((a, b) => a - b);
  return round(offsets[Math.floor(offsets.length / 2)]);
}

// The times of the log moved by `by` seconds, onto the video's clock.
function shiftTimes(out, by) {
  if (!by) return;
  const shift = (o, keys) => {
    for (const k of keys) if (typeof o[k] === 'number') o[k] = round(Math.max(0, o[k] - by));
  };
  shift(out, ['start', 'end']);
  for (const st of out.steps) {
    shift(st, ['start', 't', 'end', 'click']);
    if (st.move) shift(st.move, ['t0', 't1']);
  }
}

export async function record(dirArg, name, { log = () => {}, keepProfile = false, findSeconds = FIND_SECONDS } = {}) {
  const dir = findProjectDir(dirArg);
  const script = readRecordingScript(dir, name);
  const outDir = path.join(dir, 'assets', 'recordings');
  const fetch = `"${selfCommand()} doctor --fetch"`;
  if (!(await recordEncoder()).ready) throw new ProjectError(`record needs Playwright's own ffmpeg to save the video, and it isn't there yet. Run ${fetch} once.`);
  // Every run starts from an empty profile, so nothing a site stored in an
  // earlier run shows. --keep-profile keeps one profile per project, so a
  // login or a closed banner stays for the next run.
  const profiles = path.join(cacheRoot(), 'record', 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  const profile = keepProfile ? path.join(profiles, crypto.createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 16)) : fs.mkdtempSync(path.join(profiles, 'run-'));
  fs.mkdirSync(profile, { recursive: true });
  const videos = fs.mkdtempSync(path.join(cacheRoot(), 'record', 'video-'));
  const { width, height } = script.viewport;
  log(`recording ${script.url} at ${width}x${height}${keepProfile ? ', with the profile of earlier runs' : ''}`);
  let context;
  try {
    try {
      context = await launchProfile(profile, {
        viewport: { width, height },
        deviceScaleFactor: 1,
        recordVideo: { dir: videos, size: { width, height } },
        acceptDownloads: false,
      }, ['--deny-permission-prompts', '--disable-notifications', '--no-first-run', '--no-default-browser-check', '--disable-smooth-scrolling']);
    } catch (e) {
      if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(e.message)) throw new ProjectError('another recording of this project is running and uses its browser profile. Wait for it to finish.');
      if (/ffmpeg/i.test(e.message)) throw new ProjectError(`record could not start Playwright's ffmpeg, which saves the video. Run ${fetch} once.`);
      throw e;
    }
    for (const p of context.pages().slice(1)) await p.close();
    const page = context.pages()[0] ?? await context.newPage();
    // The video starts with the page, so its clock starts here too.
    const zero = Date.now();
    const now = () => (Date.now() - zero) / 1000;
    await page.addInitScript(pageSetup, script.blur);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.evaluate(syncPage).catch(() => {});
    await sleep(SYNC_SECONDS * 1000);
    const blurSeen = new Set();
    const readBlur = async () => {
      for (const i of await page.evaluate(() => [...(window.__explainrooBlurSeen ?? [])]).catch(() => [])) blurSeen.add(i);
    };
    const settle = async () => {
      await page.waitForLoadState('load').catch(() => {});
      await page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => {});
    };
    const fail = async (step, n, message) => {
      const shot = path.join(dir, 'build', 'record', `${name}-step-${n}.png`);
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.screenshot({ path: shot }).catch(() => {});
      throw new ProjectError(`recordings/${name}.json ${stepLabel(step, n)}: ${message} The page at that moment is in ${path.relative(process.cwd(), shot) || shot}.`);
    };
    // Finds the element of a step. With `inView`, it waits until the middle
    // of the element is in the window, and fails when it stays outside.
    const find = async (step, n, { forTyping = false, seconds = findSeconds, inView = false } = {}) => {
      const until = Date.now() + seconds * 1000;
      for (;;) {
        const r = await page.evaluate(findInPage, { text: step.text, selector: step.selector, nth: step.nth ?? 1, forTyping }).catch((e) => ({ error: e.message }));
        if (r.error === 'selector') await fail(step, n, `${quoted(step.selector)} is not a valid CSS selector.`);
        if (r.box && (r.inView || !inView)) return r.box;
        if (r.box && Date.now() > until) {
          const scroll = { do: 'scroll', ...(step.text !== undefined ? { text: step.text } : { selector: step.selector }), ...(step.nth ? { nth: step.nth } : {}) };
          await fail(step, n, `the element is outside the window, and finding it never scrolls the page. Put a scroll step to it first, like ${jsonLine(scroll)}.`);
        }
        if (Date.now() > until) {
          const close = r.words ? suggest(step.text ?? '', r.words, 6) : [];
          const many = r.found ? ` It found ${r.found}, and nth asks for number ${step.nth}.` : '';
          const hint = step.text !== undefined && close.length ? ` Close words on the page: ${close.map(quoted).join(', ')}.` : '';
          await fail(step, n, `no visible element with ${stepTarget(step)} after ${seconds} s.${many}${hint}`);
        }
        await sleep(250);
      }
    };
    await page.goto(script.url, { waitUntil: 'load' }).catch((e) => { throw new ProjectError(`recordings/${name}.json: could not open ${script.url}: ${e.message.split('\n')[0]}. Start the app first, and check the address.`); });
    await settle();
    // The pointer waits in the middle until the first step moves it.
    let pos = { x: width / 2, y: height / 2 };
    await page.mouse.move(pos.x, pos.y);
    const moveTo = async (to, seconds) => {
      const t0 = now();
      const from = pos;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      if (dist < 1) return null;
      // The same ease as the cursor that s.recording draws, so a hover effect
      // shows when the drawn cursor gets there.
      const ms = seconds * 1000;
      for (;;) {
        const k = Math.min(1, (Date.now() - t0 * 1000 - zero) / ms);
        const e = ease.inOut(k);
        await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
        if (k >= 1) break;
        await sleep(16);
      }
      pos = to;
      return { t0: round(t0), t1: round(now()), x0: Math.round(from.x), y0: Math.round(from.y), x1: Math.round(to.x), y1: Math.round(to.y) };
    };
    // Scrolls the page by dy pixels with the mouse wheel, as a person does,
    // eased over `seconds`, or over the time its length takes at the pace.
    const scrollBy = async (dy, seconds = Math.max(0.25, (SCROLL_SECONDS * Math.abs(dy)) / height / script.pace)) => {
      const t0 = Date.now();
      let done = 0;
      for (;;) {
        const k = Math.min(1, (Date.now() - t0) / (seconds * 1000));
        const part = Math.round(dy * ease.inOut(k) - done);
        if (part) {
          await page.mouse.wheel(0, part);
          done += part;
        }
        if (k >= 1) break;
        await sleep(16);
      }
      await sleep(150);
    };
    // A click or hover lands on what is at the middle of its element. When
    // something else is there, like a bar that stays on top of the page, the
    // page scrolls the element to the middle of the window, and when it is
    // still covered there, the step stops.
    const clear = async (step, n, box, forTyping) => {
      if (!(await page.evaluate(coverInPage, box))) return box;
      const dy = await page.evaluate(scrollToMiddle);
      if (Math.abs(dy) >= 1) await scrollBy(dy);
      box = await find(step, n, { forTyping });
      const cover = await page.evaluate(coverInPage, box);
      if (cover) await fail(step, n, `${cover} covers the middle of the element at ${Math.round(box.x)},${Math.round(box.y)}, also after scrolling it to the middle of the window, so the ${step.do === 'hover' ? 'pointer' : 'click'} would land on that. Close it with a step before, or pick an element that is not covered.`);
      return box;
    };
    const steps = [];
    const skipped = [];
    let start = null;
    for (const [i, step] of script.steps.entries()) {
      const n = i + 1;
      if (!step.before && start === null) {
        await sleep(400);
        start = round(now());
      }
      log(`${stepLabel(step, n)}${step.before ? ', before the video' : ''}`);
      // A step before the video whose element isn't there is done already,
      // like a banner the kept profile remembers closing, or a login it still has.
      if (step.before && (step.text !== undefined || step.selector !== undefined)) {
        const there = await page.evaluate(findInPage, { text: step.text, selector: step.selector, nth: step.nth ?? 1 }).catch(() => ({}));
        let found = !!there.box;
        for (let k = 0; !found && k < 12; k++) {
          await sleep(250);
          found = !!(await page.evaluate(findInPage, { text: step.text, selector: step.selector, nth: step.nth ?? 1 }).catch(() => ({}))).box;
        }
        if (!found) {
          skipped.push(`${stepLabel(step, n)} found nothing and was skipped. ${keepProfile ? 'That\'s fine when an earlier run did it already, and the kept profile remembers it.' : 'Check the step if the page should show it on every visit.'}`);
          continue;
        }
      }
      const entry = { step: n, do: step.do, start: round(now()) };
      for (const k of ['text', 'selector', 'nth', 'name', 'cue', 'before', 'scale']) if (step[k] !== undefined) entry[k] = step[k];
      if (step.do === 'open') {
        entry.t = entry.start;
        await page.goto(step.url, { waitUntil: 'load' }).catch((e) => fail(step, n, `could not open ${step.url}: ${e.message.split('\n')[0]}.`));
        await settle();
        await sleep(600);
      } else if (step.do === 'click' || step.do === 'type' || step.do === 'hover') {
        const forTyping = step.do === 'type';
        const box = await clear(step, n, await find(step, n, { forTyping }), forTyping);
        entry.box = roundBox(box);
        const move = await moveTo({ x: box.x, y: box.y }, step.duration ?? MOVE_SECONDS / script.pace);
        if (move) entry.move = move;
        if (step.do === 'hover') {
          entry.t = round(now());
          await sleep(700);
        } else {
          await sleep(220);
          entry.click = round(now());
          if (step.do === 'click') entry.t = entry.click;
          await page.mouse.down();
          await sleep(70);
          await page.mouse.up();
          if (step.do === 'type') {
            await sleep(250);
            entry.t = round(now());
            await page.keyboard.type(step.value, { delay: 55 });
            if (step.press) {
              await sleep(250);
              await page.keyboard.press(step.press).catch((e) => fail(step, n, `can't press ${quoted(step.press)}: ${e.message.split('\n')[0]}. Key names are like Enter, Tab, Escape or ArrowDown.`));
            }
          }
          await sleep(300);
          await settle();
          await sleep(400);
        }
      } else if (step.do === 'scroll') {
        entry.t = entry.start;
        if (step.y !== undefined) await scrollBy(step.y, step.duration);
        else {
          await find(step, n);
          const dy = await page.evaluate(scrollToMiddle);
          if (Math.abs(dy) >= 1) await scrollBy(dy, step.duration);
          entry.box = roundBox(await find(step, n, { inView: true, seconds: 2 }));
        }
        await sleep(300);
      } else if (step.do === 'wait') {
        entry.t = entry.start;
        if (step.seconds !== undefined) await sleep(step.seconds * 1000);
        else {
          entry.box = roundBox(await find(step, n, { seconds: Math.max(findSeconds, 30), inView: true }));
          await sleep(300);
        }
      } else if (step.do === 'zoom') {
        if (step.text !== undefined || step.selector !== undefined) entry.box = roundBox(await find(step, n, { inView: true }));
        entry.t = round(now());
        await sleep(ZOOM_SECONDS * 1000 + 500);
      } else if (step.do === 'mark') {
        entry.t = entry.start;
      }
      entry.end = round(now());
      steps.push(entry);
      await readBlur();
    }
    await sleep(TAIL_SECONDS * 1000);
    const end = round(now());
    const video = page.video();
    await context.close();
    context = null;
    const raw = await video.path();
    const info = await probe(raw);
    const duration = Number(info.format?.duration) || end;
    const offset = await videoOffset(raw, { width, height, zero });
    const missed = script.blur.map((b, i) => ({ ...b, i })).filter((b) => !blurSeen.has(b.i));
    const out = {
      version: 1,
      url: script.url,
      width,
      height,
      duration: round(duration),
      start,
      end,
      cursor: { x: width / 2, y: height / 2 },
      script: scriptHash(JSON.parse(fs.readFileSync(scriptPath(dir, name), 'utf8'))),
      steps,
      blur: script.blur.map((b, i) => ({ ...b, found: blurSeen.has(i) })),
    };
    shiftTimes(out, offset);
    fs.mkdirSync(outDir, { recursive: true });
    const webm = path.join(outDir, `${name}.webm`);
    const json = logPath(dir, name);
    const tmpVideo = path.join(outDir, `.${name}-${process.pid}.webm`);
    fs.copyFileSync(raw, tmpVideo);
    fs.renameSync(tmpVideo, webm);
    fs.writeFileSync(json + '.tmp', JSON.stringify(out, null, 2) + '\n');
    fs.renameSync(json + '.tmp', json);
    // The log of an older run, with the name of the script, goes, and so do
    // the frames that were taken from the video this one replaces.
    const old = oldLogPath(dir, name);
    if (readLog(old)) fs.rmSync(old, { force: true });
    dropClipFrames(dir, `assets/recordings/${name}.webm`);
    const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
    const notes = [...skipped, ...missed.map((b) => `blur ${b.i + 1} (${b.selector !== undefined ? `selector ${quoted(b.selector)}` : `text ${quoted(b.text)}`}) matched nothing on any page. Check it, or take it out.`)];
    return { name, video: rel(webm), log: rel(json), duration: out.duration, start: out.start, steps: steps.length, width, height, notes };
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(videos, { recursive: true, force: true });
    if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true });
  }
}

export function formatRecord(r) {
  return [
    `recorded ${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.duration.toFixed(1)} s at ${r.width}x${r.height}`,
    `video: ${r.video}`,
    `step log: ${r.log}`,
    ...r.notes,
    `Play it in a scene with s.recording('${r.name}'). Look at it with "explainroo still" before you write the narration around it.`,
  ].join('\n');
}
