import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLook, loadProject, normalizeConfig, ProjectError, THEMES } from '../src/project.js';
import { getTheme } from '../engine/themes.js';
import { makeState } from '../src/pipeline.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-look-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'video');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ theme: '../brand.json' }));
  fs.writeFileSync(path.join(dir, 'script.md'), '## demo\nHello.');
  fs.writeFileSync(path.join(dir, 'scenes.js'), 'export default { demo() {} };');
  const file = path.join(root, 'brand.json');
  const write = (raw) => fs.writeFileSync(file, JSON.stringify(raw));
  return { root, dir, file, write };
}

test('a shared look outside the project is loaded in Node and deep merged without changing the base', t => {
  const { dir, write } = fixture(t);
  const base = structuredClone(getTheme('paper'));
  write({ extends: 'paper', bg: '#fbfaf7', colors: { orange: '#e8590c' }, fonts: { display: { weight: 800 } }, stroke: { width: 3 }, code: { bg: '#1d1b16' }, terminal: { prompt: '#e8590c' }, caption: { active: '#e8590c' } });
  const project = loadProject(dir);
  const look = getTheme(project.config.theme, project.config.look);
  assert.equal(project.config.look.name, 'brand');
  assert.equal(project.paths.look, path.resolve(dir, '../brand.json'));
  assert.equal(look.bg, '#fbfaf7');
  assert.equal(look.colors.orange, '#e8590c');
  assert.equal(look.colors.blue, base.colors.blue);
  assert.deepEqual(look.fonts.display, { family: 'Kalam', weight: 800 });
  assert.equal(look.stroke.roughness, base.stroke.roughness);
  assert.equal(look.stroke.width, 3);
  assert.equal(look.code.bg, '#1d1b16');
  assert.equal(look.code.fg, base.code.fg);
  assert.equal(look.terminal.prompt, '#e8590c');
  assert.equal(look.terminal.bg, base.terminal.bg);
  assert.equal(look.caption.active, '#e8590c');
  assert.equal(look.caption.bg, base.caption.bg);
  assert.deepEqual(getTheme('paper'), base);
});

test('look defaults inherit each base texture, transition and music; explicit video settings win', t => {
  const { dir, write } = fixture(t);
  const expected = [['paper', 'paper', 'brush', 'warm'], ['clean', 'dots', 'slide', 'upbeat'], ['chalk', 'chalk', 'brush', 'calm'], ['blueprint', 'grid', 'wipe', 'tech'], ['midnight', 'glow', 'zoom', 'tech']];
  for (const [base, background, transition, music] of expected) {
    write({ extends: base });
    const cfg = loadProject(dir).config;
    const theme = getTheme(cfg.theme, cfg.look);
    assert.equal(theme.background, background);
    assert.equal(theme.transition, transition);
    assert.equal(cfg.transition, 'auto');
    assert.equal(cfg.music.style, music);
    assert.equal(normalizeConfig({ theme: base }).music.style, music);
  }
  write({ extends: 'clean', name: 'acme', background: 'plain', transition: 'fade', music: 'calm' });
  const cfg = loadProject(dir).config;
  assert.equal(getTheme(cfg.theme, cfg.look).background, 'plain');
  assert.equal(getTheme(cfg.theme, cfg.look).transition, 'fade');
  assert.equal(cfg.music.style, 'calm');
  for (const music of ['playful', { style: 'tech', volume: 0.2 }, false]) {
    const explicit = normalizeConfig({ theme: '../brand.json', transition: 'cut', music }, dir);
    assert.equal(explicit.transition, 'cut');
    assert.deepEqual(explicit.music, music === false ? null : { volume: 0.5, seed: 1, tempo: 1, ...(typeof music === 'string' ? { style: music } : music) });
  }
});

test('look fonts must be built in or listed by the video', t => {
  const { dir, write } = fixture(t);
  write({ extends: 'clean', fonts: { body: { family: 'Inter', weight: 500 } } });
  assert.equal(loadProject(dir).config.look.fonts.body.family, 'Inter');
  write({ extends: 'clean', fonts: { display: { family: 'Figtree', weight: 800 } } });
  assert.throws(() => loadProject(dir), /brand.json: fonts.display.family.*Built-in families:.*Inter/);
  const cfg = normalizeConfig({ theme: '../brand.json', fonts: [{ family: 'Figtree', src: 'assets/font.woff2' }] }, dir);
  assert.equal(getTheme(cfg.theme, cfg.look).fonts.display.family, 'Figtree');
});

test('look validation names the file and bad key for every kind of value', t => {
  const { dir, write } = fixture(t);
  const cases = [
    [[], 'look'], [null, 'look'], [{}, 'extends'], [{ extends: 'custom' }, 'extends'],
    [{ typo: true }, 'look.typo'], [{ name: 'clean' }, 'name'], [{ name: '' }, 'name'], [{ name: 2 }, 'name'], [{ name: null }, 'name'],
    [{ dark: 'false' }, 'dark'], [{ bg: 'red' }, 'bg'], [{ ink: '#fff' }, 'ink'], [{ muted: null }, 'muted'], [{ surface: '#gggggg' }, 'surface'],
    [{ accent: 'cyan' }, 'accent'], [{ background: 'clean' }, 'background'], [{ transition: 'auto' }, 'transition'], [{ music: false }, 'music'],
    [{ radius: -1 }, 'radius'], [{ radius: 201 }, 'radius'], [{ radius: '18' }, 'radius'],
    [{ colors: [] }, 'colors'], [{ colors: { cyan: '#000000' } }, 'colors.cyan'], [{ colors: { blue: 'rgba(1,2,3,0.5)' } }, 'colors.blue'],
    [{ fonts: null }, 'fonts'], [{ fonts: { title: {} } }, 'fonts.title'], [{ fonts: { body: [] } }, 'fonts.body'],
    [{ fonts: { body: { style: 'italic' } } }, 'fonts.body.style'], [{ fonts: { body: { family: '' } } }, 'fonts.body.family'],
    [{ fonts: { body: { weight: 0 } } }, 'fonts.body.weight'], [{ fonts: { body: { weight: 1001 } } }, 'fonts.body.weight'], [{ fonts: { body: { weight: 1.5 } } }, 'fonts.body.weight'],
    [{ stroke: null }, 'stroke'], [{ stroke: { wat: 3 } }, 'stroke.wat'], [{ stroke: { rough: 1 } }, 'stroke.rough'],
    [{ stroke: { fillStyle: 'fake' } }, 'stroke.fillStyle'], [{ stroke: { texture: 'paper' } }, 'stroke.texture'],
    [{ stroke: { width: 21 } }, 'stroke.width'], [{ stroke: { roughness: -1 } }, 'stroke.roughness'], [{ stroke: { bowing: '1' } }, 'stroke.bowing'],
    [{ stroke: { hachureGap: 0 } }, 'stroke.hachureGap'], [{ stroke: { fillWeight: 21 } }, 'stroke.fillWeight'], [{ stroke: { glow: 101 } }, 'stroke.glow'],
    [{ code: [] }, 'code'], [{ code: { unknown: '#000000' } }, 'code.unknown'], [{ terminal: { fg: 'white' } }, 'terminal.fg'],
    [{ caption: { bg: 'rgba(256,0,0,0.5)' } }, 'caption.bg'], [{ caption: { bg: 'rgba(1,2,3,1.1)' } }, 'caption.bg'],
    [{ code: { highlight: 'rgba(1,2,3,-1)' } }, 'code.highlight'], [{ code: { highlight: 'rgb(1,2,3)' } }, 'code.highlight'],
    [{ caption: { active: 'rgba(1,2,3,0.5)' } }, 'caption.active'],
  ];
  for (const [raw, key] of cases) {
    write(raw && !Array.isArray(raw) ? { extends: 'clean', ...raw } : raw);
    if (key === 'extends' && Object.keys(raw).length === 0) write(raw);
    assert.throws(() => loadProject(dir), e => e instanceof ProjectError && e.message.includes(`brand.json: ${key} `), JSON.stringify(raw));
  }
  write({ extends: 'clean', caption: { bg: 'rgba(1, 2, 3, .5)' }, code: { highlight: '#abcdef' } });
  assert.equal(loadProject(dir).config.look.caption.bg, 'rgba(1, 2, 3, .5)');
  for (const theme of ['/tmp/look.json', 'C:\\look.json', 'look.txt', 3, null]) assert.throws(() => normalizeConfig({ theme }), /relative path/);
});

test('missing and malformed look files have friendly errors', t => {
  const { dir, file } = fixture(t);
  assert.throws(() => loadProject(dir), /brand.json: theme file is missing/);
  fs.writeFileSync(file, '{');
  assert.throws(() => loadLook(dir, '../brand.json'), /brand.json: theme file could not be read as JSON/);
});

test('editing a look changes the state version and reloads its values', t => {
  const { dir, file, write } = fixture(t);
  write({ extends: 'clean', bg: '#ffffff' });
  const first = makeState(loadProject(dir), {});
  const stamp = fs.statSync(file);
  write({ extends: 'clean', bg: '#eeeeee' });
  fs.utimesSync(file, stamp.atime, stamp.mtime);
  const next = makeState(loadProject(dir), {});
  assert.notEqual(first.version, next.version);
  assert.equal(next.config.look.bg, '#eeeeee');
  assert.deepEqual(THEMES, ['paper', 'clean', 'chalk', 'blueprint', 'midnight', 'editorial']);
});
