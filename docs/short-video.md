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
  "tiktok": { "captions": "bold", "pace": 1.2, "cover": "hook@0.5" }
}
```

`render --size tiktok` and `package --platform tiktok` use that block.
`explainroo docs sizes` says how blocks work, and that a size with a pace of its
own gets narration of its own.

## The first frame

Feeds often show the first frame before anyone presses play, and many apps use
it as the cover. A title that draws itself in leaves that frame empty.
`s.short.hook` is there on the first frame by default, with no entrance, so the
frame says what the video is about. Give it a later `at` only when the scene
starts with something else to look at.

The cover that `render` and `package` write shows the hook too. With
`"cover": "auto"`, a `shorts`, `tiktok`, `reels` or `vertical` video takes its
cover 1.0 second into the first scene. A hook that leaves sooner needs a
`cover` of its own, like `"hook@0.5"`, at the top of `video.json` or in the
block of the size.

## The caption band

Bold captions sit in a band of their own in the lower middle of the content
area. On Shorts, TikTok and Reels the apps cover the bottom and the right side
of the frame with their own buttons and text, and the band sits right above
that. `s.safe` ends above the band, so place everything from `s.safe`. `check`
warns about text in the band and about text where the app's buttons go.

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
`at`, `out`, `sfx`, `id`, and `screen: true`, which keeps the title still while
the camera moves. It returns the block's box.

### `kicker(text, options)`

A small uppercase label in a pill, like "QUICK TIP". `x`, `y`, `size`, `color`,
`icon` (an icon name), `at`, `out`, `sfx`.

### `sticker(text, options)`

A tilted box with bold text for one fact, like "*2* days". `x`, `y`,
`size`, `color` (the box), `textColor`, `keyColor`, `rotate` (degrees, -4 by
default), `border`, `at`, `out`, `sfx`, `id`.

### `step(n, total, options)`

"STEP 2/4" with dots at the top of the content area, outside the camera. Step
`n` fills at `at`. `word` replaces "STEP", like `word: s.str('step')` in a video
in several languages. Also `label`, `x`, `y`, `size`, `color`, `at`, `out`,
`sfx`.

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
`from`, `x`, `y`, `zoom` (1.06) and `dur`.

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
