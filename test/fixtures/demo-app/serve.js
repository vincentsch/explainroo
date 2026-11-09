// Serves Little Ledger on 127.0.0.1. Run it with "node serve.js [port]", or
// import serveDemoApp in a test.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

export async function serveDemoApp(port = 0) {
  const server = http.createServer((req, res) => {
    const name = FILES[new URL(req.url, 'http://x').pathname];
    if (!name) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(ROOT, name)));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = await serveDemoApp(Number(process.argv[2]) || 4500);
  console.log(`Little Ledger runs at ${app.url}. Stop it with Ctrl+C.`);
}
