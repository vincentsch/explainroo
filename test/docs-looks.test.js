// The docs give one look for product videos: studio for a product demo, and the
// format's own look when a video starts from a format, which for vertical-short
// is midnight.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('product-demos says studio for a product demo, and that a format keeps its own look', () => {
  const doc = read('docs/product-demos.md');
  assert.match(doc, /Use the `studio` look for a product demo/);
  assert.match(doc, /keep the format's own look/);
  assert.match(doc, /"theme": "studio"/);
  assert.doesNotMatch(doc, /Use the `clean` look/);
});

test('vertical-short stays midnight, and its guide says so', () => {
  assert.equal(JSON.parse(read('formats/vertical-short/video.json')).theme, 'midnight');
  assert.match(read('formats/vertical-short/guide.md'), /`midnight` look/);
});
