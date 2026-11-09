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
import { ZOOM_ALIGNS, ZOOM_SECONDS, ZOOM_SCALES } from '../engine/recording.js';

export const STEP_KINDS = ['open', 'click', 'type', 'hover', 'scroll', 'wait', 'zoom', 'mark'];
// The keys each kind of step takes, besides do, cue, before and the element.
const STEP_KEYS = {
  open: ['url'],
  click: ['duration'],
  type: ['value', 'press', 'cps', 'duration'],
  hover: ['duration'],
  scroll: ['y', 'duration'],
  wait: ['seconds'],
  zoom: ['scale', 'align'],
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
// How many characters a second a type step types at pace 1, and the range a
// step's cps may take.
export const TYPE_CPS = 14;
const CPS_RANGE = [2, 60];
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

// The line record prints for a step that ran: its label, and what it found,
// like: step 3 (click "Save"): <button> "Save invoice".
export function stepLine(label, entry) {
  const m = entry.match;
  if (!m) return label;
  const skipped = m.hidden ? `, skipping ${m.hidden} hidden match${m.hidden === 1 ? '' : 'es'} of the selector` : '';
  return `${label}: <${m.tag}>${m.text ? ` ${quoted(m.text.length > 60 ? `${m.text.slice(0, 57)}...` : m.text)}` : ' with no words'}${skipped}`;
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
  const viewport = checkViewport(script.viewport, fail);
  const pace = script.pace ?? 1;
  if (typeof pace !== 'number' || !(pace >= PACES[0] && pace <= PACES[1])) fail(`pace must be a number from ${PACES[0]} to ${PACES[1]}: 2 moves the pointer, scrolls and types twice as fast, 0.5 half as fast`);
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
      if (raw.cps !== undefined) {
        if (typeof raw.cps !== 'number' || !(raw.cps >= CPS_RANGE[0] && raw.cps <= CPS_RANGE[1])) bad(`cps must be the characters it types a second, from ${CPS_RANGE[0]} to ${CPS_RANGE[1]}. ${TYPE_CPS} is the default, and the script's pace makes it faster or slower`);
        step.cps = raw.cps;
      }
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
    if (raw.align !== undefined) {
      if (!has.length) bad('a zoom without an element goes back out, so it takes no align');
      if (!ZOOM_ALIGNS.includes(raw.align)) bad(`align must be one of ${ZOOM_ALIGNS.join(', ')}: the side of the element the zoom holds in view, like "left" for a row whose words start at the left`);
      if (raw.align !== 'center') step.align = raw.align;
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

// The window a recording or an inspection runs in, 1920 x 1080 by default.
export function checkViewport(v, fail) {
  const viewport = { width: 1920, height: 1080 };
  if (v === undefined) return viewport;
  if (!v || typeof v !== 'object' || Object.keys(v).some((k) => !['width', 'height'].includes(k))) fail('viewport must be like { "width": 1920, "height": 1080 }');
  for (const k of ['width', 'height']) {
    if (v[k] === undefined) continue;
    if (!Number.isInteger(v[k]) || v[k] < 320 || v[k] > 3840 || v[k] % 2) fail(`viewport.${k} must be an even number of pixels from 320 to 3840`);
    viewport[k] = v[k];
  }
  return viewport;
}

export function checkUrl(value, fail, key, base) {
  let url;
  try { url = base ? new URL(value, base) : new URL(value); } catch {}
  if (typeof value !== 'string' || !url || !['http:', 'https:'].includes(url.protocol)) fail(`${key} must be an http:// or https:// address${base ? ', or a path like "/settings"' : ''}, like "http://localhost:3000/"`);
  if (url.username || url.password) fail(`${key} can't hold a username or password. Log in with type steps marked "before": true, and blur what must not show`);
  return url;
}

// The hash of what a script does, kept in the log. check compares it, so a
// scene never plays an old recording of a script that has changed. A step's
// cue only says when playback shows it, so it is left out, and a new cue
// needs no new recording.
export function scriptHash(script) {
  const steps = Array.isArray(script?.steps) ? script.steps.map((st) => {
    if (!st || typeof st !== 'object' || Array.isArray(st)) return st;
    const { cue, ...rest } = st;
    return rest;
  }) : script?.steps;
  return wholeHash(script && typeof script === 'object' && !Array.isArray(script) ? { ...script, steps } : script);
}

// The hash of the whole script, cues too, which logs kept before the cue
// was left out.
export function wholeHash(script) {
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
// the words the page shows, for the message when it isn't there. With `all`,
// it keeps every match in window.__explainrooHits and returns their number.
function findInPage({ text, selector, nth = 1, forTyping = false, all = false }) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const EDITABLE = '[contenteditable=""], [contenteditable=true], [contenteditable=plaintext-only]';
  const ACTIVE = `button, a, input, select, textarea, summary, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], ${EDITABLE}`;
  // An editor like CodeMirror shows its placeholder as an element inside the
  // field, like <span class="cm-placeholder">, and the field is what takes clicks.
  const HOLDER = '[class*=placeholder], [data-placeholder]';
  // A button inside the placeholder, like "browse files", stays itself.
  const editorOf = (el) => {
    const holder = el.closest(HOLDER);
    const editor = holder?.parentElement?.closest(EDITABLE);
    const active = el.closest(ACTIVE);
    return !editor || (active && holder.contains(active)) ? null : editor;
  };
  const placeholders = (el) => {
    const out = [el.getAttribute('placeholder'), el.getAttribute('aria-placeholder')];
    if (el.matches(EDITABLE)) {
      for (const h of el.querySelectorAll(HOLDER)) {
        if (h.parentElement?.closest(EDITABLE) === el) out.push(h.getAttribute('data-placeholder') || h.innerText);
      }
    }
    return out.map(norm).filter(Boolean);
  };
  const named = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt'), el.matches('input[type=submit], input[type=button]') ? el.value : null].map(norm).filter(Boolean);
  // A long placeholder matches its first part, up to a comma or the end of a sentence.
  const leads = (p, want, same) => same(p, want) || (p.length > want.length && same(p.slice(0, want.length), want) && /^\s*[,.;:!?(–—-]/.test(p.slice(want.length)));
  let hits = [];
  // How many matches of a selector are hidden, which nth leaves out.
  let hidden = 0;
  if (selector !== undefined) {
    let found;
    try { found = [...document.querySelectorAll(selector)]; } catch { return { error: 'selector' }; }
    hits = found.filter(visible);
    hidden = found.length - hits.length;
  } else {
    const want = norm(text);
    const pick = (same) => {
      const out = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (!visible(el)) continue;
        // Its own words count too, like a label's around its field.
        const ownText = norm([...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '));
        const own = named(el).some((n) => same(n, want)) || placeholders(el).some((p) => leads(p, want, same)) || (ownText && same(ownText, want));
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
      const editor = editorOf(el);
      if (editor) return editor;
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
  if (all) {
    window.__explainrooHits = hits;
    return { found: hits.length };
  }
  let el = hits[nth - 1];
  if (!el) {
    const words = new Set();
    for (const e of document.body.querySelectorAll(ACTIVE + ', h1, h2, h3, h4, th, [placeholder], [aria-label]')) {
      if (!visible(e)) continue;
      for (const w of [norm(e.innerText), ...named(e), ...placeholders(e)]) if (w && w.length <= 60) words.add(w);
    }
    return { found: hits.length, hidden, words: [...words] };
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
  return { box: { x, y, w: r.width, h: r.height }, inView, hidden };
}

// What the element findInPage found last is: its tag, the words it shows,
// cut at 80 characters, and a selector that matches only it.
function matchedInPage() {
  const el = window.__explainrooTarget;
  if (!el?.isConnected) return null;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // A field goes by its label, as it is empty before a type step types.
  const label = [...(el.labels ?? [])].map((l) => norm([...l.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ')) || norm(l.innerText)).find(Boolean);
  const shown = el.matches('input, textarea, select') ? label || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('placeholder')) : norm(el.innerText);
  const words = shown || norm(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'));
  let selector = null;
  try { selector = window.__explainrooSelector?.(el) ?? null; } catch {}
  return { tag: el.tagName.toLowerCase(), text: words.length > 80 ? `${words.slice(0, 77)}...` : words, selector };
}

// A short mark of what the page shows: its address, where it is scrolled to,
// its words and how many elements it has. When it differs after a step, the
// step changed the page.
function pageStateInPage() {
  const words = document.body?.innerText ?? '';
  let h = 0;
  for (let i = 0; i < words.length; i++) h = (h * 31 + words.charCodeAt(i)) | 0;
  return `${location.href}|${Math.round(scrollX)},${Math.round(scrollY)}|${words.length}:${h}|${document.getElementsByTagName('*').length}`;
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

// The browser profile of a run. Every run starts from an empty profile, so
// nothing a site stored in an earlier run shows. --keep-profile keeps one
// profile per project, so a login or a closed banner stays for the next run.
function browserProfile(dir, keepProfile) {
  const profiles = path.join(cacheRoot(), 'record', 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  const profile = keepProfile ? path.join(profiles, crypto.createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 16)) : fs.mkdtempSync(path.join(profiles, 'run-'));
  fs.mkdirSync(profile, { recursive: true });
  return profile;
}

const BROWSER_ARGS = ['--deny-permission-prompts', '--disable-notifications', '--no-first-run', '--no-default-browser-check', '--disable-smooth-scrolling'];

export async function record(dirArg, name, { log = () => {}, keepProfile = false, findSeconds = FIND_SECONDS } = {}) {
  const dir = findProjectDir(dirArg);
  const script = readRecordingScript(dir, name);
  const outDir = path.join(dir, 'assets', 'recordings');
  const fetch = `"${selfCommand()} doctor --fetch"`;
  if (!(await recordEncoder()).ready) throw new ProjectError(`record needs Playwright's own ffmpeg to save the video, and it isn't there yet. Run ${fetch} once.`);
  const profile = browserProfile(dir, keepProfile);
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
      }, BROWSER_ARGS);
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
    await page.addInitScript({ content: SELECTOR_SCRIPT });
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
    // The hidden matches of a step's selector, which nth leaves out.
    let hidden = 0;
    const find = async (step, n, { forTyping = false, seconds = findSeconds, inView = false } = {}) => {
      const until = Date.now() + seconds * 1000;
      for (;;) {
        const r = await page.evaluate(findInPage, { text: step.text, selector: step.selector, nth: step.nth ?? 1, forTyping }).catch((e) => ({ error: e.message }));
        if (r.error === 'selector') await fail(step, n, `${quoted(step.selector)} is not a valid CSS selector.`);
        hidden = r.hidden ?? 0;
        if (r.box && (r.inView || !inView)) return r.box;
        if (r.box && Date.now() > until) {
          const scroll = { do: 'scroll', ...(step.text !== undefined ? { text: step.text } : { selector: step.selector }), ...(step.nth ? { nth: step.nth } : {}) };
          await fail(step, n, `the element is outside the window, and finding it never scrolls the page. Put a scroll step to it first, like ${jsonLine(scroll)}.`);
        }
        if (Date.now() > until) {
          const close = r.words ? suggest(step.text ?? '', r.words, 6) : [];
          const skipped = r.hidden ? `, and left out ${r.hidden} hidden one${r.hidden === 1 ? '' : 's'}` : '';
          const many = r.found ? ` It found ${r.found} visible${skipped}, and nth asks for number ${step.nth}.` : r.hidden ? ` The selector matches ${r.hidden} hidden element${r.hidden === 1 ? '' : 's'}, which a step leaves out.` : '';
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
    const state = () => page.evaluate(pageStateInPage).catch(() => null);
    let start = null;
    for (const [i, step] of script.steps.entries()) {
      const n = i + 1;
      if (!step.before && start === null) {
        await sleep(400);
        start = round(now());
      }
      const label = `${stepLabel(step, n)}${step.before ? ', before the video' : ''}`;
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
          log(`${label}: found nothing, skipped`);
          skipped.push(`${stepLabel(step, n)} found nothing and was skipped. ${keepProfile ? 'That\'s fine when an earlier run did it already, and the kept profile remembers it.' : 'Check the step if the page should show it on every visit.'}`);
          continue;
        }
      }
      const entry = { step: n, do: step.do, start: round(now()) };
      for (const k of ['text', 'selector', 'nth', 'name', 'cue', 'before', 'scale', 'align']) if (step[k] !== undefined) entry[k] = step[k];
      // What the step found, kept in the log and said in its line, so a wrong
      // match shows right after recording.
      const matched = async () => {
        const m = await page.evaluate(matchedInPage).catch(() => null);
        if (m) entry.match = { ...m, ...(hidden ? { hidden } : {}) };
      };
      if (step.do === 'open') {
        entry.t = entry.start;
        await page.goto(step.url, { waitUntil: 'load' }).catch((e) => fail(step, n, `could not open ${step.url}: ${e.message.split('\n')[0]}.`));
        await settle();
        await sleep(600);
      } else if (step.do === 'click' || step.do === 'type' || step.do === 'hover') {
        const forTyping = step.do === 'type';
        const box = await clear(step, n, await find(step, n, { forTyping }), forTyping);
        entry.box = roundBox(box);
        await matched();
        const before = step.do === 'hover' ? await state() : null;
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
            // The script's pace makes typing faster or slower too.
            await page.keyboard.type(step.value, { delay: 1000 / ((step.cps ?? TYPE_CPS) * script.pace) });
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
          await matched();
        }
        entry.until = round(now());
        await sleep(300);
      } else if (step.do === 'wait') {
        entry.t = entry.start;
        const before = await state();
        if (step.seconds !== undefined) await sleep(step.seconds * 1000);
        else {
          entry.box = roundBox(await find(step, n, { seconds: Math.max(findSeconds, 30), inView: true }));
          await matched();
          await sleep(300);
        }
        entry.changed = before === null || before !== await state();
      } else if (step.do === 'zoom') {
        if (step.text !== undefined || step.selector !== undefined) {
          entry.box = roundBox(await find(step, n, { inView: true }));
          await matched();
        }
        entry.t = round(now());
        await sleep(ZOOM_SECONDS * 1000 + 500);
      } else if (step.do === 'mark') {
        entry.t = entry.start;
      }
      entry.end = round(now());
      steps.push(entry);
      log(stepLine(label, entry));
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
    const shots = await stepShots(webm, out, path.join(dir, 'build', 'record', name));
    const notes = [...skipped, ...missed.map((b) => `blur ${b.i + 1} (${b.selector !== undefined ? `selector ${quoted(b.selector)}` : `text ${quoted(b.text)}`}) matched nothing on any page. Check it, or take it out.`)];
    return { name, video: rel(webm), log: rel(json), duration: out.duration, start: out.start, steps: steps.length, width, height, notes,
      matched: steps.filter((st) => st.match).map((st) => ({ step: st.step, do: st.do, ...st.match, ...(shots[st.step] ? { picture: rel(shots[st.step]) } : {}) })),
      ...(Object.keys(shots).length ? { pictures: rel(path.join(dir, 'build', 'record', name)) } : {}) };
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(videos, { recursive: true, force: true });
    if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true });
  }
}

// How large a picture of a step's element is at most, and the room around it.
const SHOT_SIZE = { w: 480, h: 320 };
const SHOT_ROOM = 12;

// The moment of the video that shows what a step found: a click as the
// pointer gets there, before it presses, typing and a scroll once they are
// done, a wait once it found its element, a hover and a zoom as they start.
function shotTime(st) {
  if (st.do === 'type' || st.do === 'scroll') return st.until ?? st.end;
  if (st.do === 'wait') return st.end;
  if (st.do === 'click') return Math.max(st.start, Math.min(st.move?.t1 ?? st.t, st.t - 0.1));
  return st.t;
}

// A small picture of each step's element, cut from the video at shotTime, in
// `folder`/step-<n>.png. The pictures of an earlier run go first. Returns the
// files by step number; a picture that fails is left out.
async function stepShots(video, log, folder) {
  fs.rmSync(folder, { recursive: true, force: true });
  const shots = {};
  for (const st of log.steps) {
    if (!st.box || st.before) continue;
    const x0 = Math.max(0, Math.floor(st.box.x - st.box.w / 2 - SHOT_ROOM));
    const y0 = Math.max(0, Math.floor(st.box.y - st.box.h / 2 - SHOT_ROOM));
    const x1 = Math.min(log.width, Math.ceil(st.box.x + st.box.w / 2 + SHOT_ROOM));
    const y1 = Math.min(log.height, Math.ceil(st.box.y + st.box.h / 2 + SHOT_ROOM));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) continue;
    const k = Math.min(1, SHOT_SIZE.w / w, SHOT_SIZE.h / h);
    const file = path.join(folder, `step-${st.step}.png`);
    fs.mkdirSync(folder, { recursive: true });
    const at = Math.max(0, Math.min(log.duration - 0.05, shotTime(st)));
    try {
      await ffmpeg(['-loglevel', 'error', '-y', '-ss', String(at), '-i', video, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x0}:${y0},scale=${Math.max(2, Math.round(w * k))}:${Math.max(2, Math.round(h * k))}`, file]);
      if (fs.existsSync(file)) shots[st.step] = file;
    } catch {}
  }
  return shots;
}

// --- inspect ---------------------------------------------------------------

// A CSS selector that matches only `el`, in the page: its id, a test id, a
// name or a class when one of those is enough, or else the path from the
// nearest parent with an id. It is in every page as window.__explainrooSelector.
function selectorInPage(el) {
  const quote = (v) => `"${v.replace(/["\\]/g, '\\$&')}"`;
  // An id a script made up while it built the page, like "base-ui-_r_2_" or
  // "radix-:r1:", which can be another one on the next visit.
  const madeUp = (id) => /(^|[-_:])r[-_:]?[0-9a-z]{1,3}[-_:]|_r_|:r|^(radix|base-ui|headlessui|mui|react-aria|ember|ext-gen)|[0-9a-f]{8,}|\d{4,}/i.test(id);
  const only = (sel, el) => {
    try {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch { return false; }
  };
  const tag = el.tagName.toLowerCase();
  const tries = [];
  if (el.id && !madeUp(el.id)) tries.push(`#${CSS.escape(el.id)}`);
  for (const a of ['data-testid', 'data-test', 'aria-label', 'name', 'placeholder', 'title']) {
    const v = el.getAttribute(a);
    if (v && v.length <= 80) tries.push(`${tag}[${a}=${quote(v)}]`);
  }
  if (tag === 'a' && el.getAttribute('href') && el.getAttribute('href').length <= 80) tries.push(`a[href=${quote(el.getAttribute('href'))}]`);
  // Classes that say a state, like "active", change while the video runs.
  const classes = [...el.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/^(on|active|selected|current|open|focus|hover|checked|disabled|is-|has-)/i.test(c)).map((c) => `.${CSS.escape(c)}`);
  for (const c of classes) tries.push(`${tag}${c}`);
  if (classes.length > 1) tries.push(`${tag}${classes.join('')}`);
  for (const a of ['aria-label', 'name', 'placeholder']) {
    const v = el.getAttribute(a);
    if (v && v.length <= 80 && classes.length) tries.push(`${tag}${classes[0]}[${a}=${quote(v)}]`);
  }
  const hit = tries.find((sel) => only(sel, el));
  if (hit) return hit;
  // The path from the nearest parent with an id, or from the body.
  const parts = [];
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e !== el && e.id && !madeUp(e.id)) {
      parts.unshift(`#${CSS.escape(e.id)}`);
      break;
    }
    const same = [...(e.parentElement?.children ?? [])].filter((c) => c.tagName === e.tagName);
    parts.unshift(same.length > 1 ? `${e.tagName.toLowerCase()}:nth-of-type(${same.indexOf(e) + 1})` : e.tagName.toLowerCase());
    if (only(parts.join(' > '), el)) return parts.join(' > ');
  }
  return parts[0]?.startsWith('#') ? parts.join(' > ') : `body > ${parts.join(' > ')}`;
}

const SELECTOR_SCRIPT = `window.__explainrooSelector = ${selectorInPage.toString()};`;

// Lists every visible element of the page a person can click or type into,
// with what a step finds it by: a text that finds it, with nth when it is not
// the first match, and a CSS selector that matches only it. findInPage has to
// be in the page as window.__explainrooFind.
function inspectInPage({ limit, all = false, holding = null }) {
  const find = window.__explainrooFind;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const EDITABLE = '[contenteditable=""], [contenteditable=true], [contenteditable=plaintext-only]';
  const CLICKABLE = `button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=checkbox], [role=radio], [role=switch], [role=textbox], [role=combobox], [role=searchbox], [role=slider], ${EDITABLE}`;
  const HOLDER = '[class*=placeholder], [data-placeholder]';
  const placeholder = (el) => {
    const own = norm(el.getAttribute('placeholder') || el.getAttribute('aria-placeholder'));
    if (own || !el.matches(EDITABLE)) return own;
    const holder = [...el.querySelectorAll(HOLDER)].find((h) => h.parentElement?.closest(EDITABLE) === el);
    return holder ? norm(holder.getAttribute('data-placeholder') || holder.innerText) : '';
  };
  const kind = (el) => {
    if (el.matches(EDITABLE)) return 'editor';
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'input') return `input ${el.type}`;
    return tag;
  };
  const selectorOf = window.__explainrooSelector;
  // A text that finds the element, as a step looks for it. A field also takes
  // the words of its label.
  const textOf = (el, words, aria, holder) => {
    // A label's own words, without the options of a select inside it.
    const labels = [...(el.labels ?? [])].map((l) => norm([...l.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ')) || norm(l.innerText));
    // A long placeholder is found by its first part, up to a comma or a full stop.
    const lead = holder.match(/^(.{3,}?)\s*[,.;:!?]/)?.[1];
    // Words without two letters in a row, like "×", come after the other names.
    const wordy = /\p{L}{2}|\p{N}/u.test(words);
    const tries = [wordy ? words : '', aria, ...labels, lead, holder, norm(el.getAttribute('title')), words];
    let best = null;
    for (const text of tries) {
      if (!text || text.length > 80) continue;
      find({ text, all: true });
      const at = window.__explainrooHits.findIndex((h) => h === el || (h.matches('label') && h.control === el));
      if (at === 0) return { text };
      if (at > 0 && (!best || at + 1 < best.nth)) best = { text, nth: at + 1 };
    }
    return best;
  };
  const describe = (el, more = {}) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const words = el.matches('input, textarea, select, img') ? '' : norm(el.innerText);
    const aria = norm(el.getAttribute('aria-label'));
    const alt = el.matches('img') ? norm(el.getAttribute('alt')) : '';
    const holder = placeholder(el);
    const text = textOf(el, words.length <= 80 ? words : '', aria || alt, holder);
    return {
      kind: kind(el),
      ...more,
      ...(words ? { words: words.length > 120 ? `${words.slice(0, 117)}...` : words } : {}),
      ...(aria ? { aria_label: aria } : {}),
      ...(alt ? { alt } : {}),
      ...(holder ? { placeholder: holder } : {}),
      ...(text ?? {}),
      selector: selectorOf(el),
      box: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) },
      in_view: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
    };
  };
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const order = (a, b) => top(a) - top(b) || a.getBoundingClientRect().left - b.getBoundingClientRect().left;
  // With `holding`, the elements that hold those words: the smallest one, and
  // the larger ones around it, each a zoom or scroll target of its own.
  if (holding !== null) {
    const want = norm(holding).toLowerCase();
    const holds = (el) => [norm(el.innerText), norm(el.getAttribute('aria-label')), el.matches('img') ? norm(el.getAttribute('alt')) : ''].some((w) => w.toLowerCase().includes(want));
    const hits = [...document.body.querySelectorAll('*')].filter((el) => visible(el) && holds(el));
    const smallest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o))).sort(order);
    const entries = [];
    for (const el of smallest) {
      entries.push(describe(el, { level: 0 }));
      let last = el.getBoundingClientRect();
      let level = 0;
      for (let up = el.parentElement; up && up !== document.body && level < 4; up = up.parentElement) {
        const r = up.getBoundingClientRect();
        // A parent with the same box shows nothing more.
        if (!visible(up) || (Math.abs(r.width - last.width) < 4 && Math.abs(r.height - last.height) < 4)) continue;
        entries.push(describe(up, { level: ++level }));
        last = r;
      }
    }
    return { title: document.title, total: entries.length, matches: smallest.length, elements: entries.slice(0, limit) };
  }
  const found = [...document.body.querySelectorAll(CLICKABLE)].filter(visible);
  // A link around a button with the same words is one thing to click.
  const list = found.filter((el) => !found.some((o) => o !== el && el.contains(o) && norm(o.innerText) === norm(el.innerText)));
  // With `all`, also what a zoom or a scroll goes to: headings, sections and images.
  const content = [];
  if (all) {
    const taken = new Set(list);
    for (const el of document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading], section, article, figure, table, [role=region], [role=figure], img, svg[role=img], [role=img], picture, video, canvas')) {
      if (taken.has(el) || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      const heading = el.matches('h1, h2, h3, h4, h5, h6, [role=heading]');
      if (heading ? !norm(el.innerText) : r.width < 24 || r.height < 24) continue;
      // An image inside a picture is the same picture.
      if (el.matches('img') && el.parentElement?.matches('picture') && taken.has(el.parentElement)) continue;
      taken.add(el);
      content.push(el);
    }
  }
  const clickable = new Set(list);
  const every = [...list, ...content].sort(order);
  return {
    title: document.title,
    total: every.length,
    ...(all ? { content: content.length } : {}),
    elements: every.slice(0, limit).map((el) => describe(el, all ? { group: clickable.has(el) ? 'click' : 'content' } : {})),
  };
}

// How many elements inspect reads at most, and how many of them it prints.
const INSPECT_LIMIT = 1000;
const INSPECT_PRINTED = 200;

// Opens a page in the browser record uses and lists what a step can click or
// type into, so a script never has to guess a button.
export async function inspect(dirArg, url, { viewport, keepProfile = false, all = false, holding = null, log = () => {} } = {}) {
  const dir = findProjectDir(dirArg);
  const fail = (m) => { throw new ProjectError(m); };
  const address = checkUrl(url, fail, '--inspect').href;
  if (holding !== null && (typeof holding !== 'string' || !holding.trim())) fail('--text needs the words to look for, like --text "Solutions"');
  const size = checkViewport(viewport, (m) => fail(m.replace('viewport must be like { "width": 1920, "height": 1080 }', '--viewport must be like 1280x720').replace(/^viewport\.(width|height)/, '--viewport $1')));
  const profile = browserProfile(dir, keepProfile);
  log(`opening ${address} at ${size.width}x${size.height}${keepProfile ? ', with the profile of earlier runs' : ''}`);
  let context;
  try {
    try {
      context = await launchProfile(profile, { viewport: size, deviceScaleFactor: 1, acceptDownloads: false }, BROWSER_ARGS);
    } catch (e) {
      if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(e.message)) throw new ProjectError('a recording of this project is running and uses its browser profile. Wait for it to finish.');
      throw e;
    }
    for (const p of context.pages().slice(1)) await p.close();
    const page = context.pages()[0] ?? await context.newPage();
    await page.addInitScript(pageSetup, []);
    await page.addInitScript({ content: SELECTOR_SCRIPT });
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(address, { waitUntil: 'load' }).catch((e) => { throw new ProjectError(`could not open ${address}: ${e.message.split('\n')[0]}. Start the app first, and check the address.`); });
    // A page that builds itself with scripts gets a moment to finish.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => {});
    await sleep(500);
    await page.evaluate(`window.__explainrooFind = ${findInPage.toString()}`);
    const r = await page.evaluate(inspectInPage, { limit: INSPECT_LIMIT, all, holding });
    return { url: page.url(), title: r.title, viewport: size, ...(holding !== null ? { text: holding, matches: r.matches } : all ? { all: true, content: r.content } : {}), total: r.total, elements: r.elements };
  } finally {
    if (context) await context.close().catch(() => {});
    if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true });
  }
}

export function formatInspect(r) {
  const cut = (v) => (v.length > 60 ? `${v.slice(0, 57)}...` : v);
  const lines = r.elements.slice(0, INSPECT_PRINTED).map((e, i) => {
    const said = [e.words ? quoted(cut(e.words)) : '', e.alt ? `alt ${quoted(cut(e.alt))}` : '', e.aria_label && e.aria_label !== e.words ? `aria-label ${quoted(cut(e.aria_label))}` : '', e.placeholder && e.placeholder !== e.words ? `placeholder ${quoted(cut(e.placeholder))}` : ''].filter(Boolean).join(', ');
    const where = `at ${e.box.x},${e.box.y}, ${e.box.w}x${e.box.h}${e.in_view ? '' : ', outside the window'}`;
    const by = e.text !== undefined ? `text ${quoted(e.text)}${e.nth ? `, nth ${e.nth}` : ''}, or selector ${e.selector}` : `selector ${e.selector}`;
    // Around the words of --text, each larger element is one step further in.
    const pad = ' '.repeat(2 * (e.level ?? 0));
    const kind = e.level ? `in ${e.kind}` : e.kind;
    return `${String(i + 1).padStart(3)}. ${pad}${kind}${said ? ` ${said}` : ''}  ${where}\n     ${pad}${by}`;
  });
  const more = r.total > lines.length ? [`and ${r.total - lines.length} more${r.elements.length > lines.length ? ', which --json lists' : ''}`] : [];
  const size = `${r.viewport.width}x${r.viewport.height}`;
  const head = r.text !== undefined
    ? r.matches
      ? `${r.url} at ${size}: ${r.matches} element${r.matches === 1 ? '' : 's'} hold${r.matches === 1 ? 's' : ''} ${quoted(r.text)}, each with the larger ones around it, from the top`
      : `${r.url} at ${size}: no visible element holds ${quoted(r.text)}. The words are matched without case, also inside longer text.`
    : r.all
      ? `${r.url} at ${size}: ${r.total} element${r.total === 1 ? '' : 's'}, ${r.total - r.content} to click or type into, and ${r.content} of the headings, sections and images to zoom or scroll to, from the top`
      : `${r.url} at ${size}: ${r.total} element${r.total === 1 ? '' : 's'} to click or type into, from the top`;
  const tail = r.text !== undefined || r.all
    ? 'A step takes the text or the selector as it is, like { "do": "zoom", "selector": "#results", "align": "left" }. An element outside the window needs a scroll step to it first.'
    : 'A step takes the text or the selector as it is, like { "do": "click", "text": "Save" }. An element outside the window needs a scroll step to it first. --all also lists headings, sections and images, and --text "<words>" the elements that hold those words.';
  return [head, ...lines, ...more, tail].join('\n');
}

export function formatRecord(r) {
  return [
    `recorded ${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.duration.toFixed(1)} s at ${r.width}x${r.height}`,
    `video: ${r.video}`,
    `step log: ${r.log}`,
    ...(r.pictures ? [`what each step found: ${r.pictures}/step-<n>.png. Open them to check that every step found the right element.`] : []),
    ...r.notes,
    `Play it in a scene with s.recording('${r.name}'). Look at it with "explainroo still" before you write the narration around it.`,
  ].join('\n');
}
