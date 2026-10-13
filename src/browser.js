// Finds a Chrome or Chromium binary and runs the engine page headless.
// Every browser started here is closed again, also on errors and Ctrl+C.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where "npx playwright install" puts browsers on each system.
function playwrightBase() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

function playwrightCandidates() {
  const base = playwrightBase();
  if (!fs.existsSync(base)) return [];
  const dirs = fs.readdirSync(base)
    .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()) || (a.includes('headless') ? -1 : 1));
  const out = [];
  for (const d of dirs) {
    const root = path.join(base, d);
    for (const sub of fs.readdirSync(root)) {
      for (const bin of ['headless_shell', 'chrome', 'Chromium.app/Contents/MacOS/Chromium', 'chrome-headless-shell', 'headless_shell.exe', 'chrome.exe', 'chrome-headless-shell.exe']) {
        out.push(path.join(root, sub, bin));
      }
    }
  }
  return out;
}

export function findChrome() {
  const env = process.env.EXPLAINROO_CHROME || process.env.CHROME_PATH;
  if (env) {
    if (!fs.existsSync(env)) throw new Error(`EXPLAINROO_CHROME points to ${env}, which does not exist`);
    return env;
  }
  const system = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
          path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const p of [...playwrightCandidates(), ...system]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no Chrome or Chromium found. Install Google Chrome, or run "npx playwright install chromium-headless-shell", or set EXPLAINROO_CHROME.');
}

const open = new Set();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  const closeAll = async () => {
    await Promise.allSettled([...open].map((b) => b.close()));
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      await closeAll();
      process.exit(130);
    });
  }
}

export async function launch() {
  const { chromium } = await import('playwright-core');
  hookExit();
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'];
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args });
  open.add(browser);
  const origClose = browser.close.bind(browser);
  browser.close = async () => {
    open.delete(browser);
    await origClose().catch(() => {});
  };
  return browser;
}

// Opens the render page and waits until the engine has loaded fonts, icons,
// images and the scenes module. Throws with the page's error if boot fails.
export async function openEngine(browser, serverUrl, { scale = 1, transparent = false, onConsole } = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  page.on('console', (m) => {
    if (onConsole) onConsole(m.type(), m.text());
  });
  await page.goto(`${serverUrl}/frame.html?scale=${scale}${transparent ? '&transparent=1' : ''}`, { waitUntil: 'load' });
  const boot = await page.evaluate(async () => {
    try {
      await window.explainrooReady;
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e && e.message ? e.message : String(e), stack: e && e.stack };
    }
  });
  if (!boot.ok) throw new Error(`engine failed to start: ${boot.message}`);
  if (errors.length) throw new Error(`engine page error: ${errors[0].message}`);
  return page;
}
