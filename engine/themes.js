// The six looks. A theme decides colors, fonts, how strokes are drawn, how
// elements enter, the default transition, the sound palette and the music.
import { mulberry32, mixColor, withAlpha, parseColor, rgba, clamp } from './util.js';

const PAPER = {
  name: 'paper',
  background: 'paper',
  music: 'warm',
  dark: false,
  bg: '#f7f3ea',
  ink: '#26221d',
  muted: '#857f73',
  surface: '#fffdf8',
  accent: 'red',
  colors: {
    red: '#df5a3f', orange: '#ee8f3a', yellow: '#f1c04e', green: '#4f9a66', teal: '#2c9c8f',
    blue: '#3c6fa8', purple: '#7b5fa6', pink: '#e07397', gray: '#8f887b', ink: '#26221d',
  },
  fonts: {
    display: { family: 'Kalam', weight: 700 },
    body: { family: 'Kalam', weight: 400 },
    hand: { family: 'Patrick Hand', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: true, roughness: 1.15, bowing: 1.2, width: 4.5, fillStyle: 'solid', hachureGap: 11, fillWeight: 2.4 },
  radius: 14,
  tintStrength: 0.2,
  shadow: null,
  enter: { shape: 'draw', text: 'write', title: 'write', icon: 'draw', image: 'pop', list: 'write', code: 'fade', chart: 'grow', number: 'fade' },
  transition: 'brush',
  sfx: { shape: 'scribble', arrow: 'scribble', line: 'scribble', icon: 'pop', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'scribble', chart: 'scribble', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#2b2723', fg: '#f3ede2', comment: '#8f887b', keyword: '#f19a6b', string: '#a8d08d', number: '#f1c04e', fn: '#8cc4f2', punct: '#c9c1b3', lineNo: '#6d665b', highlight: 'rgba(241,192,78,0.18)', border: '#26221d' },
  terminal: { bg: '#23201c', fg: '#f3ede2', prompt: '#f1c04e', muted: '#9c9486', bar: '#35302a' },
  caption: { bg: 'rgba(38,34,29,0.86)', fg: '#fffdf8', active: '#f1c04e' },
};

const CLEAN = {
  name: 'clean',
  background: 'dots',
  music: 'upbeat',
  dark: false,
  bg: '#f4f6fb',
  ink: '#111827',
  muted: '#667085',
  surface: '#ffffff',
  accent: 'blue',
  colors: {
    red: '#f04452', orange: '#ff8a3d', yellow: '#f5b829', green: '#12b886', teal: '#0ea5a4',
    blue: '#3b6cf6', purple: '#7c5cff', pink: '#ec4899', gray: '#98a2b3', ink: '#111827',
  },
  fonts: {
    display: { family: 'Plus Jakarta Sans', weight: 800 },
    body: { family: 'Inter', weight: 400 },
    hand: { family: 'Kalam', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: false, width: 3.5 },
  radius: 22,
  tintStrength: 0.12,
  shadow: { color: 'rgba(16,24,40,0.12)', blur: 30, y: 12 },
  enter: { shape: 'pop', text: 'rise', title: 'rise', icon: 'pop', image: 'pop', list: 'rise', code: 'rise', chart: 'grow', number: 'rise', arrow: 'draw', line: 'draw' },
  transition: 'slide',
  sfx: { shape: 'pop', arrow: 'whoosh', line: 'whoosh', icon: 'pop', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'whoosh', chart: 'whoosh', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#0f172a', fg: '#e2e8f0', comment: '#64748b', keyword: '#c084fc', string: '#86efac', number: '#fbbf24', fn: '#7dd3fc', punct: '#94a3b8', lineNo: '#475569', highlight: 'rgba(59,108,246,0.25)', border: '#0f172a' },
  terminal: { bg: '#0f172a', fg: '#e2e8f0', prompt: '#34d399', muted: '#94a3b8', bar: '#1e293b' },
  caption: { bg: 'rgba(17,24,39,0.82)', fg: '#ffffff', active: '#7aa2ff' },
};

const CHALK = {
  name: 'chalk',
  background: 'chalk',
  music: 'calm',
  dark: true,
  bg: '#233d31',
  ink: '#f2f0e6',
  muted: '#a9b8ae',
  surface: '#2b4a3c',
  accent: 'yellow',
  colors: {
    red: '#f28b82', orange: '#f7b267', yellow: '#f6e27f', green: '#a8e6a1', teal: '#84dcc6',
    blue: '#9fd3ef', purple: '#c7aef2', pink: '#f6a8bf', gray: '#c9d1cb', ink: '#f2f0e6',
  },
  fonts: {
    display: { family: 'Cabin Sketch', weight: 700 },
    body: { family: 'Patrick Hand', weight: 400 },
    hand: { family: 'Patrick Hand', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: true, roughness: 1.35, bowing: 1.1, width: 5, fillStyle: 'solid', hachureGap: 13, fillWeight: 2.6, texture: 'chalk' },
  radius: 12,
  tintStrength: 0.16,
  shadow: null,
  enter: { shape: 'draw', text: 'write', title: 'write', icon: 'draw', image: 'fade', list: 'write', code: 'fade', chart: 'grow', number: 'fade' },
  transition: 'brush',
  sfx: { shape: 'chalk', arrow: 'chalk', line: 'chalk', icon: 'chalk', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'chalk', chart: 'chalk', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#1b3027', fg: '#f2f0e6', comment: '#8fa497', keyword: '#f6e27f', string: '#a8e6a1', number: '#f7b267', fn: '#9fd3ef', punct: '#c9d1cb', lineNo: '#6f8577', highlight: 'rgba(246,226,127,0.16)', border: '#f2f0e6' },
  terminal: { bg: '#172a21', fg: '#f2f0e6', prompt: '#f6e27f', muted: '#a9b8ae', bar: '#1f3a2d' },
  caption: { bg: 'rgba(20,34,27,0.88)', fg: '#f2f0e6', active: '#f6e27f' },
};

const BLUEPRINT = {
  name: 'blueprint',
  background: 'grid',
  music: 'tech',
  dark: true,
  bg: '#12508f',
  ink: '#f1f7ff',
  muted: '#a9cbef',
  surface: '#185c9f',
  accent: 'yellow',
  colors: {
    red: '#ff8a80', orange: '#ffbd70', yellow: '#ffd866', green: '#a3f0b8', teal: '#8ff0e4',
    blue: '#9fd6ff', purple: '#d0b8ff', pink: '#ffb3d1', gray: '#c3daf2', ink: '#f1f7ff',
  },
  fonts: {
    display: { family: 'Architects Daughter', weight: 400 },
    body: { family: 'Architects Daughter', weight: 400 },
    hand: { family: 'Architects Daughter', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: true, roughness: 0.55, bowing: 0.6, width: 3.5, fillStyle: 'solid', hachureGap: 14, fillWeight: 1.4 },
  radius: 6,
  tintStrength: 0.14,
  shadow: null,
  enter: { shape: 'draw', text: 'write', title: 'write', icon: 'draw', image: 'fade', list: 'write', code: 'fade', chart: 'grow', number: 'fade' },
  transition: 'wipe',
  sfx: { shape: 'scribble', arrow: 'whoosh', line: 'scribble', icon: 'click', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'scribble', chart: 'scribble', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#0d3d6e', fg: '#f1f7ff', comment: '#8fb6dd', keyword: '#ffd866', string: '#a3f0b8', number: '#ffbd70', fn: '#9fd6ff', punct: '#c3daf2', lineNo: '#6f9ccc', highlight: 'rgba(255,216,102,0.16)', border: '#f1f7ff' },
  terminal: { bg: '#0b345e', fg: '#f1f7ff', prompt: '#ffd866', muted: '#a9cbef', bar: '#0e4478' },
  caption: { bg: 'rgba(8,40,74,0.88)', fg: '#f1f7ff', active: '#ffd866' },
};

const MIDNIGHT = {
  name: 'midnight',
  background: 'glow',
  music: 'tech',
  dark: true,
  bg: '#0b1020',
  ink: '#e8eef8',
  muted: '#8a97ad',
  surface: '#141c31',
  accent: 'teal',
  colors: {
    red: '#fb7185', orange: '#fb923c', yellow: '#fcd34d', green: '#34d399', teal: '#22d3ee',
    blue: '#60a5fa', purple: '#a78bfa', pink: '#f472b6', gray: '#64748b', ink: '#e8eef8',
  },
  fonts: {
    display: { family: 'Space Grotesk', weight: 700 },
    body: { family: 'Inter', weight: 400 },
    hand: { family: 'Kalam', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: false, width: 3, glow: 14 },
  radius: 18,
  tintStrength: 0.16,
  shadow: { color: 'rgba(0,0,0,0.45)', blur: 34, y: 14 },
  enter: { shape: 'pop', text: 'rise', title: 'rise', icon: 'pop', image: 'pop', list: 'rise', code: 'rise', chart: 'grow', number: 'rise', arrow: 'draw', line: 'draw' },
  transition: 'zoom',
  sfx: { shape: 'pop', arrow: 'whoosh', line: 'whoosh', icon: 'pop', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'whoosh', chart: 'whoosh', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#0f172a', fg: '#e2e8f0', comment: '#64748b', keyword: '#c084fc', string: '#86efac', number: '#fbbf24', fn: '#67e8f9', punct: '#94a3b8', lineNo: '#475569', highlight: 'rgba(34,211,238,0.16)', border: '#26324a' },
  terminal: { bg: '#070b16', fg: '#e2e8f0', prompt: '#34d399', muted: '#94a3b8', bar: '#141c31' },
  caption: { bg: 'rgba(7,11,22,0.82)', fg: '#e8eef8', active: '#22d3ee' },
};

const EDITORIAL = {
  name: 'editorial',
  background: 'paper',
  music: 'calm',
  dark: false,
  bg: '#f5f1ea',
  ink: '#1c1a17',
  muted: '#76706a',
  surface: '#fffdf9',
  accent: 'red',
  colors: {
    red: '#c2462b', orange: '#c7782a', yellow: '#b8932a', green: '#3d7a57', teal: '#2c7a74',
    blue: '#2f5b88', purple: '#6a4e8c', pink: '#b04870', gray: '#8a847b', ink: '#1c1a17',
  },
  fonts: {
    display: { family: 'Instrument Serif', weight: 400 },
    body: { family: 'Inter', weight: 400 },
    hand: { family: 'Instrument Serif', weight: 400 },
    mono: { family: 'JetBrains Mono', weight: 400 },
  },
  stroke: { rough: false, width: 2.5 },
  radius: 8,
  tintStrength: 0.1,
  shadow: { color: 'rgba(40,32,20,0.10)', blur: 24, y: 8 },
  enter: { shape: 'fade', text: 'rise', title: 'rise', icon: 'fade', image: 'fade', list: 'rise', code: 'fade', chart: 'grow', number: 'rise', arrow: 'draw', line: 'draw' },
  transition: 'fade',
  sfx: { shape: 'pop', arrow: 'whoosh', line: 'whoosh', icon: 'pop', image: 'pop', text: null, title: null, list: 'blip', number: 'tick', annotate: 'whoosh', chart: 'whoosh', code: 'type', terminal: 'type', burst: 'sparkle', transition: 'swipe' },
  code: { bg: '#1c1a17', fg: '#f3eee6', comment: '#8a847b', keyword: '#e0896f', string: '#a9c49a', number: '#e3b866', fn: '#9cc3dd', punct: '#bdb6aa', lineNo: '#6b655d', highlight: 'rgba(227,184,102,0.16)', border: '#1c1a17' },
  terminal: { bg: '#1c1a17', fg: '#f3eee6', prompt: '#e3b866', muted: '#a49d92', bar: '#2c2925' },
  caption: { bg: 'rgba(28,26,23,0.86)', fg: '#fffdf9', active: '#e3b866' },
};

export const THEMES = { paper: PAPER, clean: CLEAN, chalk: CHALK, blueprint: BLUEPRINT, midnight: MIDNIGHT, editorial: EDITORIAL };

export function getTheme(name, look = null) {
  const t = THEMES[look ? look.extends : name];
  if (!t) throw new Error(`unknown theme "${name}". Themes: ${Object.keys(THEMES).join(', ')}`);
  if (!look) return t;
  const { extends: base, ...overrides } = look;
  const merge = (a, b) => Object.fromEntries(Object.entries({ ...a, ...b }).map(([k, v]) =>
    [k, v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k], v) : v]));
  return merge(t, overrides);
}

// Resolves a color name ("blue", "accent", "ink", "muted") or passes a CSS color through.
export function colorOf(theme, c, fallback) {
  if (c === undefined || c === null) return fallback === undefined ? theme.ink : colorOf(theme, fallback);
  if (c === 'accent') return theme.colors[theme.accent];
  if (c === 'ink') return theme.ink;
  if (c === 'muted') return theme.muted;
  if (c === 'bg') return theme.bg;
  if (c === 'surface') return theme.surface;
  if (c === 'none' || c === false) return 'none';
  if (theme.colors[c]) return theme.colors[c];
  return c;
}

// A light fill for a color on light themes, a translucent one on dark themes.
export function tintOf(theme, c) {
  const base = colorOf(theme, c, 'accent');
  if (base === 'none') return 'none';
  if (theme.dark) return withAlpha(base, theme.tintStrength);
  return mixColor(theme.surface, base, theme.tintStrength);
}

export function fontString(theme, role = 'body', size = 48, weight) {
  const f = theme.fonts[role] || theme.fonts.body;
  const w = weight ?? f.weight;
  const fallback = role === 'mono' ? 'monospace' : 'sans-serif';
  return `${w} ${Math.round(size * 100) / 100}px "${f.family}", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans SC", ${fallback}`;
}

// Background textures are rendered once and reused on every frame.
export function makeBackground(theme, W, H, seed = 1) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rand = mulberry32(seed * 7919 + theme.name.length);
  const base = Object.values(THEMES).find((t) => t.background === theme.background);
  const bg = parseColor(theme.bg);
  const original = parseColor(base?.bg || theme.bg);
  // Shift the original tones with the background, keeping built-in pixels unchanged.
  const tone = (color) => {
    if (theme.bg === base?.bg) return color;
    const p = parseColor(color);
    return rgba({ r: clamp(p.r + bg.r - original.r, 0, 255), g: clamp(p.g + bg.g - original.g, 0, 255), b: clamp(p.b + bg.b - original.b, 0, 255), a: p.a });
  };
  const noise = (count, alphaMax, color, sizeMax = 1.6) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = withAlpha(color, rand() * alphaMax);
      const s = 0.5 + rand() * sizeMax;
      g.fillRect(rand() * W, rand() * H, s, s);
    }
  };
  switch (theme.background) {
    case 'paper': {
      g.fillStyle = theme.bg;
      g.fillRect(0, 0, W, H);
      noise(Math.round(W * H * 0.05), 0.07, tone('#6b5a3d'));
      noise(Math.round(W * H * 0.02), 0.08, tone('#ffffff'), 2);
      g.lineWidth = 0.7;
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = withAlpha(tone('#8a7654'), 0.05 + rand() * 0.05);
        const x = rand() * W;
        const y = rand() * H;
        const a = rand() * Math.PI;
        const l = 8 + rand() * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, tone('rgba(120,96,60,0)'));
      v.addColorStop(1, tone('rgba(120,96,60,0.10)'));
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      break;
    }
    case 'dots': {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, tone('#f7f8fc'));
      gr.addColorStop(1, tone('#eef1f8'));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.fillStyle = tone('rgba(17,24,39,0.045)');
      const step = 48;
      for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
      break;
    }
    case 'chalk': {
      const gr = g.createRadialGradient(W * 0.45, H * 0.4, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
      gr.addColorStop(0, tone('#2a4a3b'));
      gr.addColorStop(1, tone('#1b3127'));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const r = 80 + rand() * 320;
        const s = g.createRadialGradient(x, y, 0, x, y, r);
        s.addColorStop(0, tone('rgba(235,240,230,0.035)'));
        s.addColorStop(1, tone('rgba(235,240,230,0)'));
        g.fillStyle = s;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      noise(Math.round(W * H * 0.03), 0.06, tone('#e8efe6'));
      break;
    }
    case 'grid': {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, tone('#14589d'));
      gr.addColorStop(1, tone('#0f4680'));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      const minor = Math.round(Math.min(W, H) / 34);
      g.lineWidth = 1;
      for (let x = 0; x <= W; x += minor) {
        g.strokeStyle = tone(x % (minor * 5) === 0 ? 'rgba(190,225,255,0.20)' : 'rgba(190,225,255,0.08)');
        g.beginPath();
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, H);
        g.stroke();
      }
      for (let y = 0; y <= H; y += minor) {
        g.strokeStyle = tone(y % (minor * 5) === 0 ? 'rgba(190,225,255,0.20)' : 'rgba(190,225,255,0.08)');
        g.beginPath();
        g.moveTo(0, y + 0.5);
        g.lineTo(W, y + 0.5);
        g.stroke();
      }
      noise(Math.round(W * H * 0.01), 0.05, tone('#ffffff'));
      break;
    }
    case 'glow': {
      g.fillStyle = theme.bg;
      g.fillRect(0, 0, W, H);
      const glow = (x, y, r, color) => {
        const s = g.createRadialGradient(x, y, 0, x, y, r);
        s.addColorStop(0, color);
        s.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = s;
        g.fillRect(0, 0, W, H);
      };
      glow(W * 0.12, H * 0.08, Math.max(W, H) * 0.6, tone('rgba(34,211,238,0.10)'));
      glow(W * 0.92, H * 0.95, Math.max(W, H) * 0.55, tone('rgba(167,139,250,0.10)'));
      noise(Math.round(W * H * 0.01), 0.05, tone('#ffffff'));
      break;
    }
    default:
      g.fillStyle = theme.bg;
      g.fillRect(0, 0, W, H);
  }
  return c;
}
