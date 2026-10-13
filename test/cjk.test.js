import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenizeNarration, parseScript, speechChunks, normWord, resolveMarks } from '../src/script.js';
import { alignWords, readAlike, spreadReadings } from '../src/align.js';
import { subtitleCues, toSrt, toVtt } from '../src/subtitles.js';
import { buildPhrases, drawCaptions } from '../engine/captions.js';
import { getTheme } from '../engine/themes.js';
import { phonemize, misakiAvailable } from '../src/phonemes.js';
import { languageFonts, ensureFonts } from '../src/fonts.js';
import { cacheRoot } from '../src/models.js';
import { normalizeConfig } from '../src/project.js';
import { buildTimeline } from '../src/timeline.js';

function env(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

const native = { ja: '住所を解析します。次の画面を表示します！終わりです？', zh: '浏览器解析地址。下一步显示网页！完成了吗？' };

for (const [language, text] of Object.entries(native)) {
  test(`${language} segments words, keeps punctuation and preserves markers and overrides`, () => {
    const units = tokenizeNarration('[#first]' + text + '[pause 0.4][#last]{住所|じゅうしょ}です。', 0, language);
    const words = units.filter(u => u.type === 'word');
    assert.equal(words.map(w => w.display).join(''), text + '住所です。');
    assert.ok(words.some(w => w.display === '解析'));
    assert.deepEqual(words.find(w => w.display === '住所' && w.spoken !== w.display), { type: 'word', display: '住所', spoken: 'じゅうしょ', space: true });
    assert.equal(normWord('解析。'), '解析');
    assert.deepEqual(tokenizeNarration('次に「解析」を行う。', 0, language).filter(u => u.type === 'word').map(u => u.display).join(''), '次に「解析」を行う。');
    assert.ok(tokenizeNarration('次に「解析」を行う。', 0, language).filter(u => u.type === 'word').every(u => normWord(u.display)));
    assert.deepEqual(tokenizeNarration('{住所|じゅうしょ}。次。', 0, language).filter(u => u.type === 'word').map(u => u.display), ['住所。', '次。']);
    assert.deepEqual(speechChunks(tokenizeNarration('{住所|じゅうしょ}。「解析」。', 0, language), { language }).map(c => c.text), ['じゅうしょ。', '「解析」。']);
    assert.equal(normWord('が'), normWord('が'.normalize('NFD')));
    const times = units.map((u, i) => u.type === 'word' ? { start: i, end: i + 0.5 } : null);
    assert.equal(resolveMarks(units, times).first, 1);
    assert.equal(resolveMarks(units, times).last, units.findIndex(u => u.spoken === 'じゅうしょ'));
    const chunks = speechChunks(units, { language });
    assert.deepEqual(chunks.map(c => c.text), [...text.match(/[^。！？]+[。！？]/g), 'じゅうしょです。']);
    assert.equal(chunks.at(-1).gapBefore, 0.7);
    assert.equal(parseScript('## intro\n' + text, { language }).scenes[0].text, text);
    for (const ending of ['。', '！', '？', '.', '!', '?']) {
      assert.equal(speechChunks(tokenizeNarration(`解析${ending}解析${ending}`, 0, language), { language }).length, 2);
    }
  });

  test(`${language} alignment ignores Whisper word boundaries and times each word's characters`, () => {
    const words = [{ spoken: '解析' }, { spoken: '地址。' }];
    const whole = alignWords(words, [{ text: '解析地址', start: 0.2, end: 1 }], 1.2, language);
    const single = alignWords(words, [...'解析地址'].map((text, i) => ({ text, start: 0.2 + i * 0.2, end: 0.4 + i * 0.2 })), 1.2, language);
    assert.equal(whole.matchRate, 1);
    assert.deepEqual(whole.words, single.words);
    assert.ok(Math.abs(whole.words[0].start - 0.2) < 1e-9);
    assert.ok(Math.abs(whole.words[0].end - 0.6) < 1e-9);
    const shown = alignWords([{ spoken: 'じゅうしょ', display: '住所' }, { spoken: 'です。' }], [{ text: '住所です', start: 0, end: 1 }], 1, language);
    assert.equal(shown.matchRate, 1);
    assert.ok(shown.words.every(w => w.matched));
    const missing = alignWords([{ spoken: '解析' }, { spoken: '地' }, { spoken: '址' }], [{ text: '解析址', start: 0, end: 0.9 }], 1, language);
    assert.equal(missing.matchRate, 0.75);
    assert.equal(missing.words[1].matched, false);
    assert.ok(missing.words.every(w => w.start <= w.end));
    assert.equal(alignWords([{ spoken: 'かな' }], [{ text: 'かな'.normalize('NFD'), start: 0, end: 1 }], 1, language).matchRate, 1);
  });

  test(`${language} captions and subtitles join without spaces and limit lines at word boundaries`, () => {
    const text = native[language].repeat(3);
    const words = tokenizeNarration(text, 0, language).filter(u => u.type === 'word').map((u, i) => ({ text: u.display, start: i * 0.2, end: (i + 1) * 0.2 }));
    const timeline = buildTimeline({ config: normalizeConfig({ language, captions: true }), script: parseScript('## intro\n' + text, { language }) }, { intro: { duration: words.length * 0.2, words, marks: {} } });
    const cues = subtitleCues(timeline);
    assert.equal(cues.map(c => c.text.replaceAll('\n', '')).join(''), text);
    assert.ok(cues.every(c => c.text.split('\n').every(line => line.length <= 18)));
    assert.ok(toSrt(cues).includes('解析'));
    assert.ok(toVtt(cues).includes('解析'));
    const phrases = buildPhrases(timeline, 46);
    assert.equal(phrases.map(p => p.words.map(w => w.text).join(p.separator)).join(''), text);
    assert.ok(phrases.every(p => p.words.map(w => w.text).join('').length <= 18));
    const drawn = [];
    const ctx = new Proxy({ measureText: text => ({ width: text.length * 44 }), fillText: (text, x) => drawn.push({ text, x }) }, { get: (o, key) => o[key] ?? (() => {}) });
    drawCaptions(ctx, phrases, phrases[0].start + 0.1, getTheme('clean'), 1920, 1080);
    assert.equal(drawn[1].x - drawn[0].x, drawn[0].text.length * 44);
    const long = { language, scenes: [{ start: 0, words: Array.from({ length: 30 }, (_, i) => ({ text: '解析', start: i * 0.1, end: (i + 1) * 0.1 })) }] };
    assert.ok(subtitleCues(long).every(c => c.text.split('\n').every(line => line.length <= 18 && line.length % 2 === 0)));
    assert.throws(() => subtitleCues({ language, scenes: [{ words: [{ text: '長'.repeat(19) }] }] }), /longer than 18/);
  });
}

test('subtitle lines and caption phrases do not start with a Japanese or Chinese particle', () => {
  const timed = list => list.map((text, i) => ({ text, start: i * 0.3, end: (i + 1) * 0.3 }));
  const ja = timed(['地球', 'の', '動き', 'と', 'カレンダー', 'に', 'ズレ', 'が', 'たまり', 'ます。']);
  const [cue] = subtitleCues({ language: 'ja', scenes: [{ start: 0, words: ja }] });
  assert.equal(cue.text, '地球の動きとカレンダーに\nズレがたまります。');
  const phrases = buildPhrases({ language: 'ja', scenes: [{ start: 0, words: ja }] }, 46);
  assert.equal(phrases.length, 2);
  assert.ok(phrases.every(p => !/^[\u3041-\u3096]/.test(p.words[0].text)), phrases.map(p => p.words.map(w => w.text).join('')).join(' / '));
  const [counter] = subtitleCues({ language: 'ja', scenes: [{ start: 0, words: timed(['そこで、', '基本', 'は', '4', '年', 'ごと', 'に', '1', '日', 'を', '足し', 'ます。']) }] });
  assert.equal(counter.text, 'そこで、基本は4年ごとに\n1日を足します。');
  // Breaking before or after に balances the lines equally; に stays with the word before.
  const [even] = subtitleCues({ language: 'ja', scenes: [{ start: 0, words: timed(['アイウエオカキクケ', 'に', 'サシスセソタチツテ。']) }] });
  assert.equal(even.text, 'アイウエオカキクケに\nサシスセソタチツテ。');
  const zh = timed(['这', '是', '我们', '最', '常用', '的', '密码', '保存', '方法', '之一', '，', '也', '很', '安全', '的', '做法', '吗', '？']);
  for (const p of buildPhrases({ language: 'zh', scenes: [{ start: 0, words: zh }] }, 46)) assert.ok(!['的', '吗'].includes(p.words[0].text), p.words.map(w => w.text).join(''));
  for (const c of subtitleCues({ language: 'zh', scenes: [{ start: 0, words: zh }] })) for (const line of c.text.split('\n')) assert.ok(!/^[的吗]/.test(line), line);
});

test('Mandarin alignment reads Traditional characters as Simplified, Japanese keeps them', () => {
  const rate = language => alignWords([{ spoken: '浏览器' }, { spoken: '会询问网址。' }], [{ text: '瀏覽器會詢問網址', start: 0, end: 1.6 }], 1.6, language).matchRate;
  assert.equal(rate('zh'), 1);
  assert.equal(rate('ja'), 0.25);
});

test('Mandarin alignment accepts a character with the same sound, not a different one', () => {
  const words = [{ spoken: '哈希值' }, { spoken: '和' }, { spoken: '盐。' }];
  const heard = text => [{ text, start: 0, end: 1 }];
  // Whisper writes 直 for 值 and 研 for 盐; all are read zhi and yan.
  assert.equal(alignWords(words, heard('哈希直和研'), 1, 'zh').matchRate, 1);
  assert.equal(alignWords(words, heard('哈希職和研'), 1, 'zh').matchRate, 1);
  const wrong = alignWords(words, heard('哈希值和鸡'), 1, 'zh');
  assert.equal(wrong.matchRate, 0.8);
  assert.equal(wrong.words[2].matched, false);
  assert.equal(alignWords(words, heard('哈希直和研'), 1, 'ja').matchRate, 0.6);
  const shown = alignWords([{ spoken: '哈希', display: '哈希值' }], heard('哈希直'), 1, 'zh');
  assert.equal(shown.matchRate, 1);
});

test('Japanese readings are shared out over the characters they cover', () => {
  assert.deepEqual(spreadReadings(['うるう', '年', 'には'], [[0, 4, 'ウルードシ'], [4, 5, 'ニ'], [5, 6, 'ワ']]), ['ウルード', 'シ', 'ニワ']);
  assert.deepEqual(spreadReadings(['ウルードシ', '、'], [[0, 5, 'うるーどし'], [5, 6, '、']]), ['ウルードシ', '、']);
  assert.deepEqual(spreadReadings(['今日', 'は'], [[0, 2, 'キョー']]), ['キョー', '']);
});

test('the Japanese speech check compares readings, and falls back to characters without Python', { skip: process.platform === 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-readings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'python');
  env(t, 'EXPLAINROO_PYTHON', file);
  // A tiny dictionary: 世紀 and 正規 are both read セーキ.
  fs.writeFileSync(file, `#!/usr/bin/env node
    const assert = require('node:assert/strict');
    assert.equal(process.argv[3], 'ja-readings');
    const words = { 世紀: 'セーキ', 正規: 'セーキ', の: 'ノ', 年: 'トシ', とし: 'トシ' };
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      for (const text of input.trimEnd().split('\\n').map(JSON.parse)) {
        const out = [];
        for (let i = 0; i < text.length;) {
          const w = Object.keys(words).find(w => text.startsWith(w, i));
          if (w) { out.push([i, i + w.length, words[w]]); i += w.length; } else i++;
        }
        console.log(JSON.stringify(out));
      }
    });
  `, { mode: 0o755 });
  const words = [{ spoken: '世紀', display: '世紀' }, { spoken: 'の', display: 'の' }, { spoken: '年。', display: '年。' }];
  const heard = [{ text: '正規の', start: 0, end: 0.6 }, { text: 'とし', start: 0.6, end: 1 }];
  const alike = await readAlike(words, heard, 'ja');
  assert.deepEqual(alike.words.map(w => w.spoken), ['セーキ', 'ノ', 'トシ']);
  assert.deepEqual(alike.heard.map(h => h.text), ['セーキノ', 'トシ']);
  assert.equal(alignWords(alike.words, alike.heard, 1, 'ja').matchRate, 1);
  assert.deepEqual(await readAlike(words, heard, 'zh'), { words, heard });
  fs.rmSync(file);
  assert.deepEqual(await readAlike(words, heard, 'ja'), { words, heard });
  assert.ok(alignWords(words, heard, 1, 'ja').matchRate < 0.7);
});

test('Python batches JSON lines without shell expansion and accepts misaki phonemes unchanged', { skip: process.platform === 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-python-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fake python');
  env(t, 'EXPLAINROO_PYTHON', file);
  fs.writeFileSync(file, `#!/usr/bin/env node
    const assert = require('node:assert/strict');
    assert.equal(process.argv[2].endsWith('/g2p.py'), true);
    assert.ok(['ja', 'zh'].includes(process.argv[3]));
    let input = '';
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      const texts = input.trimEnd().split('\\n').map(JSON.parse);
      process.stdout.write(texts.map(t => JSON.stringify(t + '↗')).join('\\n') + '\\n');
    });
  `, { mode: 0o755 });
  for (const language of ['ja', 'zh']) {
    const texts = ['解析。\n次の行', '$(　) `＊` "中文" $@'];
    assert.deepEqual(await phonemize(texts, language), texts.map(t => t + '↗'));
    assert.equal(misakiAvailable(language), true);
    assert.deepEqual(await phonemize(['およそ365.2422日。'], language), [language === 'ja' ? 'およそ365点二四二二日。↗' : 'およそ365.2422日。↗']);
    // Latin words are read as English between the misaki pieces.
    assert.deepEqual(await phonemize(['我用JavaScript写代码。', 'API。'], language), ['我用↗ dʒˈɑːvə skɹˈɪpt 写代码。↗', 'ˌeɪpˌiːˈaɪ 。↗']);
  }
  fs.writeFileSync(file, '#!/usr/bin/env node\nconsole.log("not JSON");');
  await assert.rejects(phonemize(['解析'], 'ja'), /incomplete phonemes/);
  assert.equal(misakiAvailable('ja'), false);
  fs.writeFileSync(file, '#!/usr/bin/env node\nconsole.log(JSON.stringify("one"));');
  await assert.rejects(phonemize(['解析', '次'], 'ja'), /incomplete phonemes/);
  fs.writeFileSync(file, '#!/usr/bin/env node\nconsole.error("ModuleNotFoundError: No module named \'misaki\'"); process.exit(1);');
  await assert.rejects(phonemize(['解析'], 'zh'), /pip install "misaki\[zh\]".*Python said: ModuleNotFoundError: No module named 'misaki'/);
  fs.chmodSync(file, 0o644);
  await assert.rejects(phonemize(['解析'], 'ja'), /EXPLAINROO_PYTHON/);
  fs.rmSync(file);
  assert.equal(misakiAvailable('ja'), false);
  await assert.rejects(phonemize(['解析'], 'ja'), /-m unidic download/);
  assert.deepEqual(await phonemize([], 'ja'), []);
});

test('font paths follow EXPLAINROO_CACHE, offline mode refuses missing or damaged fonts', async t => {
  assert.equal(languageFonts('ja')[0].path, path.join(cacheRoot(), 'fonts', 'ja-400.otf'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainroo-font-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  env(t, 'EXPLAINROO_CACHE', dir);
  env(t, 'EXPLAINROO_OFFLINE', '1');
  assert.deepEqual(languageFonts('en'), []);
  for (const language of ['ja', 'zh']) {
    const fonts = languageFonts(language);
    assert.deepEqual(fonts.map(f => f.weight), [400, 700]);
    assert.equal(fonts[0].path, path.join(dir, 'fonts', `${language}-400.otf`));
    await assert.rejects(ensureFonts(language), /without EXPLAINROO_OFFLINE/);
    fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
    fs.writeFileSync(fonts[0].path, 'OTTOcorrupt');
    await assert.rejects(ensureFonts(language), /missing or damaged/);
  }
  await ensureFonts('en');
  process.env.EXPLAINROO_OFFLINE = '0';
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => Buffer.from('OTTOcorrupt') }));
  await assert.rejects(ensureFonts('ja'), /could not be downloaded or checked/);
  assert.equal(fs.readFileSync(languageFonts('ja')[0].path, 'utf8'), 'OTTOcorrupt');
});
