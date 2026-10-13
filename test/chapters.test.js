import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChapters, chapterHints, toChaptersText, toChapterMetadata } from '../src/chapters.js';

const timeline = { duration: 40, scenes: [
  { id: 'intro', start: 0, attrs: {} },
  { id: 'first', start: 12, attrs: { chapter: 'First chapter' } },
  { id: 'second', start: 26, attrs: { chapter: 'Second chapter' } },
] };

test('chapters start on named scenes and fill the opening with the video title', () => {
  assert.deepEqual(buildChapters(timeline, 'Video title'), [
    { title: 'Video title', scene: 'intro', start: 0, end: 12 },
    { title: 'First chapter', scene: 'first', start: 12, end: 26 },
    { title: 'Second chapter', scene: 'second', start: 26, end: 40 },
  ]);
  assert.equal(timeline.scenes[0].attrs.chapter, undefined);
  const namedIntro = { ...timeline, scenes: [{ ...timeline.scenes[0], attrs: { chapter: 'Opening' } }, ...timeline.scenes.slice(1)] };
  assert.equal(buildChapters(namedIntro, 'Video title')[0].title, 'Opening');
  assert.deepEqual(buildChapters({ scenes: [{ start: 0, attrs: {} }] }, 'Title'), []);
});

test('YouTube hints explain ignored chapters without warnings', () => {
  const chapters = buildChapters(timeline, 'Title');
  assert.deepEqual(chapterHints(chapters), []);
  assert.deepEqual(chapterHints([]), []);
  const hints = chapterHints([{ title: 'Short', scene: 'a', start: 0, end: 9.99 }]);
  assert.equal(hints.length, 2);
  assert.ok(hints.every((h) => h.level === 'hint' && /YouTube shows chapters only when/.test(h.message)));
  assert.match(hints[0].message, /3 chapters/);
  assert.match(hints[1].message, /10 seconds/);
  assert.equal(chapterHints([{ start: 0, end: 10 }]).length, 1);
});

test('chapter text uses m:ss below an hour and h:mm:ss from an hour', () => {
  assert.equal(toChaptersText([{ start: 0, title: 'Opening' }, { start: 65.9, title: 'Next' }, { start: 3599, title: 'Later' }, { start: 3600, title: 'Hour' }, { start: 7325, title: 'End' }]), '0:00 Opening\n1:05 Next\n59:59 Later\n1:00:00 Hour\n2:02:05 End\n');
});

test('ffmetadata keeps millisecond boundaries and escapes special title characters', () => {
  assert.equal(toChapterMetadata([{ start: 0, end: 12.345, title: 'A=B; #C\\D' }]), ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12345\ntitle=A\\=B\\; \\#C\\\\D\n');
});
