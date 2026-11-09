# Short videos

`s.short` is a kit for Shorts, TikTok and Reels. It draws the parts these
videos tend to share, like a hook title that is there on the first frame and a
payoff card at the end. It also gives camera keys for a punch-in or a slow
drift, and a few short effects. Each part is described below.

It works best with a platform size (`tiktok`, `shorts`, `reels` or `vertical`)
and `"captions": "bold"`, which shows two to four big words at a time. When the
same project also makes a 16:9 video, give the tall size its settings in a block
of its own. Then the 16:9 version keeps the settings at the top of `video.json`:

```json
"sizes": {
  "tiktok": { "captions": "bold", "pace": 1.2 }
}
```

`render --size tiktok` and `package --platform tiktok` use that block.
`explainroo docs sizes` says how blocks work, and that a size with a pace of its
own gets narration of its own. `"captions": "auto"` means no captions on 16:9
and captions on tall, 4:5 and square sizes, so set `"captions"` yourself when
you want them in the 16:9 video too.

## The rules of a short

A stranger scrolls past in the first second, so a short follows a few rules.
`explainroo init videos/<name> --format vertical-short --size tiktok` starts
from a short that keeps them, with helpers for each one. Without `--size` it
stays `vertical`, a tall frame for no app in particular, so give it the size of
the app it goes on: `tiktok`, `shorts` or `reels`. With that size in
`video.json`, `check`, `render` and `verify` use the app's content area without
`--platform`. Add `--platform tiktok` to get exactly what the TikTok package
gets, which is the video without the watermark.

- **The hook is in the first second.** Give the first scene `{lead=0}`, so
  the voice starts at once, and show the title and the subject on the first
  frame. The first spoken line names the stakes or the question. No greeting
  and no setup.
- **Bold captions** sit in the safe area, two to four words at a time.
- **The picture changes at least every 2 seconds.** A second hook halfway,
  like "Here's the good part", keeps people watching. These count as a
  change:
  - an element that enters, like a sticker, a kicker or an icon;
  - a camera key from `s.camera`, `s.short.punch` or the start of
    `s.short.drift`;
  - `s.short.jolt`, `s.short.flash` and `s.short.interrupt`;
  - a clip while it plays;
  - a new scene.

  A background that drifts, like the turning rays of a backdrop, doesn't.
- Short sentences of 6 to 14 words, spoken to one person, with one promise
  that is paid off before the end. The payoff is the clearest frame.

`check` treats a tall video of up to 3 minutes as a short. It gives a hint for
each stretch of more than 2 seconds without a change, up to the last spoken
word, and when the voice starts later than half a second in. Show something
new on a word in that stretch, or move the camera with `s.short.punch`.

## A layout of its own for the tall frame

Most scenes placed from `s.safe` work in both sizes. When a scene needs another
picture in the tall frame, the same scene function draws it when `s.portrait`
is true:

```js
hook(s) {
  if (s.portrait) {
    s.short.hook('How vaccines *train* your body');
    s.icon('syringe', { y: s.safe.top + s.safe.h * 0.6, size: 240, at: '#shot' });
    return;
  }
  s.title('How vaccines train your body', { y: 300, at: 0 });
  s.icon('syringe', { x: 1400, y: 680, size: 260, at: '#shot' });
},
```

Both layouts share the narration and its cues, so the cue words and markers
work in both.

## Fill the whole frame

On Shorts, TikTok and Reels, `s.safe` ends above the captions, so a scene
placed only from it leaves the lower 40% of the frame empty. With
`"defaults": "0.6"`, pictures and backgrounds may run into the parts the app
covers with its buttons and post text. Only words and the details the viewer
must see stay in `s.safe`. `s.full` is the whole frame, `{ x, y, w, h, left,
top, right, bottom }`, for the pictures that fill it:

```js
problem(s) {
  const { top, h, bottom } = s.safe;
  const u = Math.min(s.safe.w, h) / 100;
  s.short.hook('How *noise-cancelling* headphones work', { y: top + h * 0.15 });
  s.icon('plane', { y: top + h * 0.47, size: u * 22, label: 'Plane engines', at: 0.1 });
  s.icon('headphones', { y: top + h * 0.8, size: u * 22, label: 'Noise-cancelling', at: 'headphones' });
  // A band fills the bottom of the frame, edge to edge, behind the captions,
  // with the hum drawn on it.
  const band = s.full.bottom - bottom;
  s.box({ x: s.full.w / 2, y: bottom + band / 2, w: s.full.w, h: band, fill: s.tint('blue'), border: false, radius: 0, at: 'hum' });
  for (let i = 0; i < 4; i++) {
    const y = bottom + (s.full.bottom - bottom) * (0.2 + i * 0.22);
    s.line([[s.full.left, y], [s.full.right, y]], { color: 'blue', width: 8 - i * 2, at: 'hum' });
  }
},
```

`check` still warns about text outside `s.safe`, and about any picture that
runs off the frame. Look at the frame with `still --platform tiktok`: the
app's buttons may cover part of a picture down there, so keep what matters
higher up.

## The first frame

Feeds often show the first frame before anyone presses play, and many apps use
it as the cover. A title that draws itself in leaves that frame empty.
`s.short.hook` is there on the first frame by default, with no entrance, so the
frame says what the video is about. Give it a later `at` only when the scene
starts with something else to look at. `check` gives a hint when the first frame of
the video shows only the background, or only elements still on their way in,
and names one to give `at: -1`.

The cover that `render` and `package` write shows the hook too. With
`"cover": "auto"` and `"defaults": "0.5"` it is the frame of the first scene
with the most elements fully arrived, a frame with a picture first, so it
shows the hook with the picture when both are there. Code still typing and a
number still counting have not arrived yet. Without `"defaults"` it
is 1.0 second into the first scene. `check` gives a hint when the cover shows
only text on an empty background. A cover has no captions. A `cover` of your
own goes at the top of `video.json` or in the block of the size, like
`"hook@2.5"`, and needs no new render: `render` and `package` keep the video
and write only the new cover.

## The caption band

Bold captions sit in a band of their own in the lower middle of the content
area. On Shorts, TikTok and Reels the apps cover the bottom and the right side
of the frame with their own buttons and text, and the band sits right above
that. `s.safe` ends above the band, so place everything from `s.safe`. `check`
warns about text and shapes in the band and where the app's buttons go.
`explainroo docs sizes` has the content area of each size in pixels.

Numbers, amounts of money and words with `*stars*` in `script.md` get the
keyword color in bold captions. Use stars for one or two words a sentence, or
the color stops meaning anything.

## The camera

The kit draws straight on the canvas, so the automatic camera keeps what it
draws as one block and does not move in on its parts. A scene that wants a move
sets its own camera first, with keys from `punch` or `drift`:

```js
tip(s) {
  s.camera(s.short.punch('#bag', { x: s.cx, y: s.safe.y + s.safe.h * 0.5, zoom: 1.3, hold: 1.2 }));
  s.short.backdrop({ color: '#1b2440', pattern: 'grid' });
  s.icon('shopping-bag', { y: s.safe.y + s.safe.h * 0.5, size: 300, color: 'orange', label: 'Paper bag', labelColor: '#ffffff', at: '#bag' });
},
```

`s.camera` comes before everything else in the scene, as always.

## What the kit draws

Times are seconds, spoken words or `"#markers"`. A higher `pace` shortens the
kit's animations, as it does for other elements. Every
method that draws text lets `check` see it, and every entrance makes its sound
and counts as something new on screen.

### `backdrop(options)`

A full-frame background: a vertical gradient, an optional glow behind the
subject, a faint pattern and a vignette. Call it first in the scene, right
after `s.camera` if the scene has one.
`color` (top of the gradient), `color2` (bottom), `glow` (a color), `gx` and
`gy` (the glow's center), `glowR`, `pattern` (`'dots'`, `'grid'`, `'rays'` or
`'none'`), `patternAlpha`, `vignette` (0 to 1). Rays turn slowly, so the
background is never quite still.

The backdrop is dark, and the look's own text colors may be dark too. Give text
you draw on it a light color, like `color: '#ffffff'` or
`labelColor: '#ffffff'`. `check` measures text against the backdrop.

### `hook(text, options)`

The title for the first frame: big, uppercase, at most two lines, shrinking
until it fits. Words in `*stars*` are keywords. `style` is `'slab'` (white
boxes with dark text, the default), `'stroke'` (white text with a dark outline)
or `'plain'` (the look's ink). Other options: `x`, `y` (the middle of the
block), `size`, `width`, `maxLines`, `upper: false`, `color`, `keyColor`,
`keyBg`, `slab`, `kicker` (a small label above), `kickerColor`, `kickerIcon`,
`kickerSize`, `kickerY`, `at`, `out`, `sfx`, `id`, and `screen: true`, which
keeps the title still while the camera moves. It returns the block's box.

With `"defaults": "0.6"`, the kicker is 44 pixels in a tall frame and stays
inside `s.safe`, below the watermark. When `y` would put it above `s.safe`,
the kicker and the title move down together. `area` sets another box to stay
in, like the part of `s.safe` that a zoom keeps on screen.

Keywords are yellow by default, and with `"defaults": "0.6"` they take
`brand.accent` from `video.json` when it reads: as the box behind the white
keywords of a slab, or as their color on what is behind them. When it doesn't
read, `check` gives a hint with the color, its contrast and the color used
instead. With
`"defaults": "0.5"`, a `'plain'` hook
picks colors that read on what is behind it. On a light look the keywords take
the look's accent, made darker if it needs that. When the look's ink is too
dark for a backdrop, the words are white. `check` measures a plain hook against
the backdrop or `s.bg` behind it.

### `kicker(text, options)`

A small uppercase label in a pill, like "QUICK TIP". `x`, `y`, `size` (44 in a
tall frame and 40 in others with `"defaults": "0.6"`, and 34 before), `color`,
`icon` (an icon name), `at`, `out`, `sfx`.

### `sticker(text, options)`

A tilted box with bold text for one fact, like "*2* days". `x`, `y`,
`size`, `color` (the box), `textColor`, `keyColor` (red, made to read at
4.5:1 on the box's color with `"defaults": "0.5"`), `rotate` (degrees, -4 by default), `border`,
`at`, `out`, `sfx`, `id`, `overlap`. `check` measures the text and the
keywords against the box's color, and warns when the sticker partly covers
another shape. `overlap: true` says that is meant.

### `step(n, total, options)`

"STEP 2/4" with dots at the top of the content area, outside the camera. Step
`n` fills at `at`. `word` replaces "STEP", like `word: s.str('step')` in a video
in several languages. Also `label`, `x`, `y`, `size` (48 with
`"defaults": "0.6"`, which reads well on a phone, and 34 before), `color`,
`at`, `out`, `sfx`.

### `progress(options)`

A thin bar above the content area that fills over the whole video. `x`,
`y`, `w`, `h`, `color`.

### `payoff(options)`

The closing card: an icon, a bold title and up to three short lines with check
marks. `tone` (`'good'`, `'bad'`, `'info'` or `'dark'`), `icon`, `title`,
`lines` (texts, or `{ text, at }` for a line on its own cue), `x`, `y`, `w`,
`card` (its color), `at`, `out`, `sfx`, `id`. It returns its box.

### `punch(at, options)` and `drift(options)`

Camera keys to spread into `s.camera([...])`. `punch` zooms fast onto `x`, `y`
at `at`, holds for `hold` seconds and goes back, unless `back: false`. Also
`zoom` (1.35) and `dur`. `drift` pushes in slowly over the rest of the scene:
`from`, `x`, `y`, `zoom` (1.06) and `dur`. A zoom makes everything bigger
around the point it zooms onto, so text near the edge of `s.safe` can leave it.
When the zoom is what puts text outside the content area, `check` says so.

### `jolt(at, options)`, `flash(at, options)` and `interrupt(at, options)`

`jolt` bumps the frame in and shakes it for a moment, so call it before what it
should move. `flash` covers the whole frame with white or a `color` for a
moment. `interrupt` does both with one sound, and suits the start of a new part
of the video. Options: `dur`, `zoom`, `shake` for the jolt, `color` and `alpha`
for the flash, and for `interrupt` also `flash: false` and `sfx`.

## An example

A video about keeping bread fresh, in four scenes. The scenes cue on markers, so
their timing works in every language. For text on screen in several languages,
use `s.str`.

```js
export default {
  hook(s) {
    s.short.backdrop({ color: '#1b2440', glow: '#f59f00', pattern: 'dots' });
    s.short.hook('Your bread is *stale* again?', { kicker: 'Kitchen tip', kickerIcon: 'lightbulb' });
    s.icon('wheat', { y: s.safe.y + s.safe.h * 0.62, size: 260, color: 'yellow', at: '#days' });
    s.short.sticker('*2* days', { x: s.cx + s.safe.w * 0.22, y: s.safe.y + s.safe.h * 0.8, at: '#days' });
  },
  bag(s) {
    s.camera(s.short.punch('#bag', { y: s.safe.y + s.safe.h * 0.55, zoom: 1.3, hold: 1.2 }));
    s.short.backdrop({ color: '#1b2440', pattern: 'grid' });
    s.short.step(1, 2);
    s.short.progress();
    s.icon('shopping-bag', { y: s.safe.y + s.safe.h * 0.5, size: 300, color: 'orange', label: 'Paper bag', labelSize: 64, labelColor: '#ffffff', at: '#bag' });
  },
  freeze(s) {
    s.short.interrupt('#freeze');
    s.short.backdrop({ color: '#10304a', glow: '#4dabf7', pattern: 'rays' });
    s.short.step(2, 2);
    s.short.progress();
    s.icon('snowflake', { y: s.safe.y + s.safe.h * 0.5, size: 300, color: 'blue', label: 'Freeze slices', labelSize: 64, labelColor: '#ffffff', at: '#freeze' });
  },
  payoff(s) {
    s.camera(s.short.drift());
    s.short.backdrop({ color: '#1b2440', glow: '#12a150' });
    s.short.payoff({ title: 'Fresh for weeks', lines: ['Paper bag for two days', { text: 'Freezer for longer', at: '#toast' }], at: 0.2 });
  },
};
```

Look at a sheet of the whole video and at stills of the first frame and the
busiest moments. Check that the hook is there at 0 seconds, that nothing sits
under the captions or the app's buttons, and that no text is cut off.
