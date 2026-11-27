import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/browser.js';
import { runCli } from './helpers/tiny-project.js';

let chrome;
try { chrome = findChrome(); } catch {}

function project(t, script, scenes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-motion-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: 'clean', size: '640x360', captions: false, sfx: false, music: false, watermark: false }));
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'scenes.js'), scenes);
  return dir;
}

async function issues(dir) {
  const r = await runCli(['check', dir, '--json']);
  assert.ok(r.stdout.trim().startsWith('{'), r.text);
  return JSON.parse(r.stdout).issues;
}

test('check finds a scene that keeps values from one frame to the next', { skip: !chrome && 'no browser here', timeout: 120000 }, async (t) => {
  const kept = project(t, '## spin {min=4}\n', `let turns = 0;
export default { spin(s) {
  s.text('Spin', { y: 80, at: -1 });
  turns += 1;
  s.draw({ x: s.cx, y: s.cy, at: 0 }, (ctx) => { ctx.rotate(turns * 0.3); ctx.fillStyle = '#245cff'; ctx.fillRect(-60, -60, 120, 120); });
} };`);
  const found = (await issues(kept)).filter((x) => /drawn again after other moments/.test(x.message));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].level, 'warn');
  assert.match(found[0].message, /Work out everything from s\.t, or from life\.local in s\.draw/);
  // The same picture worked out from the time is fine.
  const pure = project(t, '## spin {min=4}\n', `export default { spin(s) {
  s.text('Spin', { y: 80, at: -1 });
  s.draw({ x: s.cx, y: s.cy, at: 0 }, (ctx, life) => { ctx.rotate(life.local * 0.9); ctx.fillStyle = '#245cff'; ctx.fillRect(-60, -60, 120, 120); });
} };`);
  assert.deepEqual((await issues(pure)).filter((x) => /drawn again|draws nothing/.test(x.message)), []);
});

test('animation in s.draw counts as change, and a drawing that draws nothing gets a warning', { skip: !chrome && 'no browser here', timeout: 120000 }, async (t) => {
  const draw = (body) => `export default { orbit(s) {
  s.text('Orbit', { y: 60, at: -1 });
  s.draw({ x: s.cx, y: s.cy + 20, at: 0 }, (ctx, life) => { ${body} });
} };`;
  const moving = project(t, '## orbit {min=14}\n', draw("const a = life.local; ctx.fillStyle = '#245cff'; ctx.beginPath(); ctx.arc(Math.cos(a) * 120, Math.sin(a) * 80, 24, 0, Math.PI * 2); ctx.fill();"));
  assert.deepEqual((await issues(moving)).filter((x) => /no new element/.test(x.message)), []);
  // A still drawing gets the usual hint about a long stretch without change.
  const still = project(t, '## orbit {min=14}\n', draw("ctx.fillStyle = '#245cff'; ctx.beginPath(); ctx.arc(120, 0, 24, 0, Math.PI * 2); ctx.fill();"));
  assert.ok((await issues(still)).some((x) => /no new element for/.test(x.message)));
  // A drawing whose code never reaches a drawing call.
  const blank = project(t, '## orbit {min=3}\n', draw("if (life.local > 99) ctx.fillRect(0, 0, 10, 10);"));
  const empty = (await issues(blank)).filter((x) => /draws nothing/.test(x.message));
  assert.equal(empty.length, 1, JSON.stringify(empty));
  assert.match(empty[0].message, /^the 1st s\.draw draws nothing while it is on screen/);
});
