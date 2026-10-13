import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export async function captureFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-capture-site-'));
  fs.copyFileSync(fileURLToPath(new URL('../fonts/Inter-400-latin.woff2', import.meta.url)), path.join(dir, 'fixture.woff2'));
  fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#245cff"/></svg>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK3sAAAAASUVORK5CYII=', 'base64');
  for (const name of ['touch.png', 'social.png']) fs.writeFileSync(path.join(dir, name), png);
  const requests = [];
  // A second local origin makes the font stylesheet's CSSOM unreadable.
  const styles = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/font.css') {
      res.setHeader('Content-Type', 'text/css');
      return res.end("@font-face { font-family: 'Fixture Sans'; src: url('fixture.woff2'); font-weight: 400; } @font-face { font-family: 'Fixture Sans'; src: url('unused.woff2'); font-weight: 900; }");
    }
    if (req.url === '/fixture.woff2') {
      res.setHeader('Content-Type', 'font/woff2');
      return res.end(fs.readFileSync(path.join(dir, 'fixture.woff2')));
    }
    res.writeHead(404);
    res.end('Not found');
  });
  await new Promise((resolve) => styles.listen(0, '127.0.0.1', resolve));
  const html = fs.readFileSync(fileURLToPath(new URL('./fixtures/capture.html', import.meta.url)), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'), html.replace('__FONT_CSS__', `http://127.0.0.1:${styles.address().port}/font.css`));
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/' }); return res.end(); }
    const name = req.url === '/' ? 'index.html' : ['/fixture.woff2', '/icon.svg', '/touch.png', '/social.png'].includes(req.url) ? req.url.slice(1) : null;
    if (!name) { res.writeHead(404); return res.end('Not found'); }
    const type = { '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(name)];
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(path.join(dir, name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { dir, requests, url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    await Promise.all([server, styles].map((s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); })));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}
