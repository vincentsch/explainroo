// Finds lines of text in a video frame without knowing what the text says, and
// how tall the text is, so that check can judge the text of any video by the
// rules it uses for its own. A frame comes as gray pixels, one byte each.
//
// A pixel is ink when it is clearly darker, or clearly lighter, than the pixels
// around it. Ink pixels that touch form a shape, and shapes of a letter's size
// and fill that stand side by side on one line, close together and about as tall
// as each other, are a line of text. The tallest letters, like "d", "k" and "p",
// are about 0.76 of the font size in most fonts, so the font size is the height of
// a line's taller letters divided by that.

// How tall the taller letters of a font are, as a part of its size.
export const LETTER_HEIGHT = 0.76;

// How much darker or lighter than its surroundings a pixel has to be to count as
// ink, on the 0 to 255 scale.
const CONTRAST = 28;

// How much the background behind a line of text may vary, as the standard
// deviation of its gray.
const PLAIN = 15;

// Every line of text in a frame, smallest font first: its box, the font size
// in pixels of the frame, and how many shapes it is made of.
export function textLines(gray, width, height) {
  const r = Math.max(8, Math.round(Math.min(width, height) / 30));
  const stack = new Int32Array(width * height);
  const sums = integral(gray, width, height);
  const lines = inkMasks(gray, width, height, r, sums)
    .flatMap((mask, i) => linesOf(stacked(components(mask, width, height, gray, stack)), width, height, i === 0));
  // Holes inside the letters of one color look like small letters of the other,
  // and the strokes of big letters can break into pieces. A line that lies mostly
  // inside a line with taller letters is such holes or pieces, so it goes.
  const kept = lines.filter((a) => !lines.some((b) => b !== a && b.size > a.size * 1.2 && overlap(a, b) > 0.6))
    .filter((line) => plainBehind(line, gray, width, height, r, sums));
  return kept.sort((a, b) => a.size - b.size).map(({ dark, ...line }) => line);
}

// How much of the box of `a` lies inside the box of `b`, from 0 to 1.
function overlap(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? (w * h) / ((a.x1 - a.x0) * (a.y1 - a.y0)) : 0;
}

// The pixels clearly darker, and those clearly lighter, than the mean of the
// square around them, `r` pixels on each side, with by how much. The square is a
// fifteenth of the frame's short side, so that the strokes of big letters count
// as ink all the way through. Text covers less of the page than its background,
// so dark ink counts only in light tiles, and light ink only in dark ones.
// Without that, the background close to light letters would count as dark ink,
// being darker than the mean there.
function inkMasks(gray, width, height, r, sums) {
  const tile = r * 2;
  const { light, cols } = lightTiles(gray, width, height, tile);
  const dark = new Uint8Array(width * height);
  const bright = new Uint8Array(width * height);
  const W = width + 1;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    const row = Math.floor(y / tile) * cols;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum = sums[y1 * W + x1] - sums[y0 * W + x1] - sums[y1 * W + x0] + sums[y0 * W + x0];
      const diff = gray[y * width + x] - sum / ((x1 - x0) * (y1 - y0));
      if (light[row + Math.floor(x / tile)]) {
        if (diff < -CONTRAST) dark[y * width + x] = Math.min(255, Math.round(-diff));
      } else if (diff > CONTRAST) bright[y * width + x] = Math.min(255, Math.round(diff));
    }
  }
  return [dark, bright];
}

// For each square tile of `size` pixels, whether most of it is on the light side:
// its mean is above the middle between its darkest and lightest pixels, leaving
// out the darkest and lightest 3%, which can be noise.
function lightTiles(gray, width, height, size) {
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const light = new Uint8Array(cols * rows);
  const hist = new Uint32Array(256);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      hist.fill(0);
      let sum = 0;
      let n = 0;
      for (let y = ty * size; y < Math.min(height, (ty + 1) * size); y++) {
        for (let x = tx * size; x < Math.min(width, (tx + 1) * size); x++) {
          const v = gray[y * width + x];
          hist[v]++;
          sum += v;
          n++;
        }
      }
      let low = 0;
      let high = 255;
      for (let seen = 0; low < 255 && (seen += hist[low]) < n * 0.03;) low++;
      for (let seen = 0; high > 0 && (seen += hist[high]) < n * 0.03;) high--;
      light[ty * cols + tx] = sum / n > (low + high) / 2 ? 1 : 0;
    }
  }
  return { light, cols };
}

function integral(gray, width, height) {
  const W = width + 1;
  const sums = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sums[(y + 1) * W + x + 1] = sums[y * W + x + 1] + row;
    }
  }
  return sums;
}

// The shapes of touching ink pixels, with their box, pixel count, summed
// contrast and summed gray. It clears the mask as it goes.
function components(mask, width, height, gray, stack) {
  const shapes = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    const shape = { x0: width, y0: height, x1: 0, y1: 0, pixels: 0, contrast: 0, gray: 0 };
    let top = 0;
    stack[top++] = start;
    shape.contrast += mask[start];
    mask[start] = 0;
    while (top) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      shape.pixels++;
      shape.gray += gray[p];
      if (x < shape.x0) shape.x0 = x;
      if (x > shape.x1) shape.x1 = x;
      if (y < shape.y0) shape.y0 = y;
      if (y > shape.y1) shape.y1 = y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const q = ny * width + nx;
          if (!mask[q]) continue;
          shape.contrast += mask[q];
          mask[q] = 0;
          stack[top++] = q;
        }
      }
    }
    shape.x1++;
    shape.y1++;
    shapes.push(shape);
  }
  return shapes;
}

// Shapes stacked on each other with a small gap are one letter: the dot and stem
// of an "i", or the two loops of an "8" drawn with a thin pen.
function stacked(shapes) {
  const list = shapes.filter((s) => s.y1 - s.y0 >= 2).sort((a, b) => a.x0 - b.x0);
  const gone = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (gone.has(a)) continue;
    for (let j = i + 1; j < list.length && list[j].x0 < a.x1; j++) {
      const b = list[j];
      if (gone.has(b)) continue;
      const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (across < Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.5 || gap < 0 || gap > Math.max(2, Math.max(a.y1 - a.y0, b.y1 - b.y0) * 0.3)) continue;
      Object.assign(a, { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), pixels: a.pixels + b.pixels, contrast: a.contrast + b.contrast, gray: a.gray + b.gray });
      gone.add(b);
    }
  }
  return list.filter((s) => !gone.has(s));
}

// Whether the background behind a line is plain, as text on a page, a screen or
// a caption bar has. The pixels of the line's box that aren't ink must be close
// to one gray. Leaves, grass and stones behind a row of shapes are not. Big
// letters leave soft edges in their box that this would count, so it only
// judges lines up to 4.5% of the frame's short side, about 48 pixels at 1080p,
// which covers every size that check calls small.
function plainBehind(line, gray, width, height, r, sums) {
  if (line.size > Math.min(width, height) * 0.045) return true;
  const W = width + 1;
  let n = 0;
  let sum = 0;
  let squares = 0;
  for (let y = line.y0; y < line.y1; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = line.x0; x < line.x1; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const mean = (sums[y1 * W + x1] - sums[y0 * W + x1] - sums[y1 * W + x0] + sums[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      const v = gray[y * width + x];
      if (Math.abs(v - mean) > CONTRAST) continue;
      n++;
      sum += v;
      squares += v * v;
    }
  }
  if (!n) return true;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, squares / n - mean * mean)) <= PLAIN;
}

// Shapes that could be a letter, or a few letters run together: at least 5 pixels
// tall, at most a tenth of the frame, not much wider than a short word, and
// neither a solid block nor a thin frame around nothing.
function letters(shapes, width, height) {
  const tallest = Math.min(width, height) / 10;
  return shapes.filter((s) => {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    if (h < 5 || h > tallest || w > h * 8 || w < 1) return false;
    const fill = s.pixels / (w * h);
    return fill > 0.12 && fill < 0.85;
  });
}

// Letters that stand next to each other on one line: about the same height, most
// of their height side by side, and a gap of at most a bit more than their height.
// A line needs at least three of them, and is at least three times as wide as
// tall. Its font size comes from its taller letters.
function linesOf(shapes, width, height, dark = true) {
  const list = letters(shapes, width, height).sort((a, b) => a.x0 - b.x0);
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const ha = a.y1 - a.y0;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const hb = b.y1 - b.y0;
      const big = Math.max(ha, hb);
      if (b.x0 - a.x1 > big * 1.2) {
        if (b.x0 - a.x1 > tallestGap(width, height)) break;
        continue;
      }
      if (Math.max(ha, hb) > Math.min(ha, hb) * 2.2) continue;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (overlap < Math.min(ha, hb) * 0.6) continue;
      parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  list.forEach((s, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  });
  const lines = [];
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const box = { x0: Math.min(...group.map((s) => s.x0)), y0: Math.min(...group.map((s) => s.y0)), x1: Math.max(...group.map((s) => s.x1)), y1: Math.max(...group.map((s) => s.y1)) };
    const tall = tallLetters(group.map((s) => s.y1 - s.y0));
    if (box.x1 - box.x0 < tall * 3) continue;
    // Letters stand on one baseline, with a few that reach below it, like "p" and
    // "g". Stones in a wall, leaves and other texture don't.
    const bottoms = group.map((s) => s.y1).sort((a, b) => a - b);
    const base = bottoms[Math.floor(bottoms.length / 2)];
    const onBase = bottoms.filter((y) => Math.abs(y - base) <= Math.max(1.5, tall * 0.12)).length;
    if (onBase < group.length * 0.6) continue;
    // How far the mean gray of each letter is from that of the others, and how
    // much the letters differ from their surroundings.
    const grays = group.map((s) => s.gray / s.pixels);
    const meanGray = grays.reduce((a, b) => a + b, 0) / grays.length;
    const spread = Math.sqrt(grays.reduce((a, b) => a + (b - meanGray) ** 2, 0) / grays.length);
    const contrast = group.reduce((a, s) => a + s.contrast, 0) / group.reduce((a, s) => a + s.pixels, 0);
    // Letters of one line have one color, and stand out clearly. Texture in a
    // photo, like snow on trees, is softer and mixed.
    if (spread > 20 || contrast < 60) continue;
    // Shapes all of one size, like the squares of a checkerboard, are a pattern.
    const same = (list) => Math.max(...list) - Math.min(...list) <= 1;
    if (same(group.map((s) => s.x1 - s.x0)) && same(group.map((s) => s.y1 - s.y0))) continue;
    lines.push({ ...box, size: Math.round((tall / LETTER_HEIGHT) * 10) / 10, letters: group.length, dark });
  }
  return lines;
}

// The height of the taller letters of a line. Most letters of a line are as tall
// as an "x", and letters like "d", "k" and "p" are about 1.4 times that. A line
// without them is most likely in capitals, or digits, and those are as tall as
// the taller letters. Two letters that run together, like "lp", are taller
// still, so they don't count.
function tallLetters(heights) {
  const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const middle = median([...heights]);
  const tall = heights.filter((h) => h > middle * 1.2 && h < middle * 1.65);
  return tall.length ? median(tall) : middle;
}

// Gaps grow with the letters, so the search along a row stops at the widest gap
// that the tallest letter allows.
const tallestGap = (width, height) => (Math.min(width, height) / 10) * 1.2;
