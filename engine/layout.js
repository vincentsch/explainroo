// Where scene content may go, and where the captions sit.
//
// Normal sizes keep a 7% margin. Platform formats (tiktok, reels, shorts,
// vertical) keep clear of the app's own buttons and text, and put the
// watermark in the top right corner of the part the app leaves free.
// With captions on, `safe` ends above the caption band, so content placed from
// `s.safe` never sits under a caption.
const LINES = 2;

// Bold captions ("captions": "bold") are one line of big words, in a band of
// their own. A chunk too wide for one line shrinks first, and then fits in two
// lines inside the same band.
export const BOLD_CAPTION_SIZE = { tall: 74, wide: 58 };

export function layoutAreas(config, W, H) {
  const m = Math.round(Math.min(W, H) * 0.07);
  const f = config.safe;
  const wmSize = Math.round(Math.min(W, H) * 0.028);
  const wmBox = Math.round(wmSize * 1.6);
  const bold = config.captions === 'bold';
  const capSize = H > W ? 58 : 44;
  const capBoxH = bold ? Math.round((H > W ? BOLD_CAPTION_SIZE.tall : BOLD_CAPTION_SIZE.wide) * 1.3 + 20) : Math.round(capSize * 1.3 * LINES + capSize * 0.55);

  let left;
  let right;
  let top;
  let bottom;
  let app = null;
  let captions = null;

  if (f) {
    left = Math.round(W * f.left);
    right = W - Math.round(W * f.right);
    const appTop = Math.round(H * f.top);
    const appBottom = H - Math.round(H * f.bottom);
    app = { left, top: appTop, right, bottom: appBottom };
    top = config.watermark ? appTop + wmBox + 16 : appTop;
    bottom = appBottom;
    if (config.captions) captions = { cx: (left + right) / 2, bottom: appBottom - (bold ? 24 : 10), maxWidth: right - left };
  } else {
    left = m;
    right = W - m;
    top = m;
    bottom = H - m;
    if (config.captions) {
      const maxWidth = W * (H > W ? 0.8 : 0.7) + capSize * 1.1;
      if (H >= W * 1.5) {
        // Tall 9:16 without a platform: captions a quarter of the way up.
        captions = { cx: W / 2, bottom: Math.round(H * 0.74 + capBoxH / 2), maxWidth };
      } else {
        // Wide, square and 4:5: captions at the bottom, clear of the watermark.
        const clear = config.watermark ? wmSize + wmBox + 12 : Math.round(m * 0.6);
        captions = { cx: W / 2, bottom: H - clear, maxWidth };
      }
    }
  }

  // Bold captions sit in the middle of their band.
  if (captions && bold) captions.cy = captions.bottom - capBoxH / 2;
  let band = null;
  if (captions) {
    band = {
      left: captions.cx - captions.maxWidth / 2,
      right: captions.cx + captions.maxWidth / 2,
      top: captions.bottom - capBoxH,
      bottom: captions.bottom,
    };
    bottom = Math.min(bottom, band.top - 24);
  }

  return {
    safe: { x: left, y: top, w: right - left, h: bottom - top, left, top, right, bottom },
    captions,
    band,
    app,
  };
}
