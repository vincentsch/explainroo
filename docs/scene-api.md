# Scene API

Each scene function draws one frame. explainroo calls it for every frame with
a fresh `s`, so everything in the scene depends only on the time. Keep no
values between calls and use no timers. Give each element an `at` time,
and the look animates it in. Give it an `out` time, and the look animates it
out.

```js
export default {
  intro(s) {
    s.title('How DNS works', { y: s.safe.top + s.safe.h * 0.3, at: 0 });
    s.icon('globe', { y: s.safe.top + s.safe.h * 0.7, size: s.safe.h * 0.25, at: 'browser' });
  },
};
```

The canvas is 1920 x 1080 for 16:9. It is 1080 x 1920 for the vertical sizes,
1080 x 1080 for square, and 1080 x 1350 for `instagram`, `linkedin` and 4:5.
Positions are in pixels, counted from the top left corner. `x` and `y` are
the center of an element unless the method says otherwise.

## One layout for every size

Place things from `s.safe`, the part of the frame that is free for content,
and the same `scenes.js` works in 16:9 and on Reels. Side by side in a wide
frame, stacked in a tall one:

```js
export default {
  ask(s) {
    const { left, top, w, h } = s.safe;
    const u = Math.min(w, h) / 100;
    const spots = s.portrait
      ? [{ x: s.cx, y: top + h * 0.25 }, { x: s.cx, y: top + h * 0.75 }]
      : [{ x: left + w * 0.25, y: s.cy }, { x: left + w * 0.75, y: s.cy }];
    s.box('Your browser', { id: 'you', ...spots[0], size: u * 6, icon: 'globe', at: 0 });
    s.box('Resolver', { id: 'res', ...spots[1], size: u * 6, icon: 'server', at: 'resolver' });
    s.arrow('you', 'res', { label: 'asks', at: 'asks' });
  },
};
```

`s.safe.h` and `s.safe.w` are smaller on Shorts, TikTok and Reels, where the
app covers parts of the frame, and with captions on. Sizes that come from
them, like `u` here, shrink with the space. `explainroo docs sizes` says more.
The examples below use plain numbers for a 1920 x 1080 frame.

`explainroo docs pictures` has whole layouts like this and says what makes a
scene look good, and `explainroo docs troubleshooting` lists the mistakes that
break one.

## Time

| Member | Meaning |
|---|---|
| `s.t` | seconds since the scene started |
| `s.T` | seconds since the video started |
| `s.dur` | length of the scene in seconds |
| `s.voice` | `{ start, end }` of the narration in the scene |
| `s.words` | the spoken words: `{ text, start, end }` in scene seconds |
| `s.cue(word, n = 1)` | when the n-th time a word or phrase is spoken starts |
| `s.cueEnd(word, n = 1)` | when it ends |
| `s.mark(name)` | the time of a `[#name]` marker |
| `s.time(v)` | turns a number, a word or `"#marker"` into seconds |
| `s.pace` | the video's pace (1 is normal) |
| `s.p(at, dur = 0.6, ease = 'inOut')` | 0 to 1 progress for your own animation |
| `s.since(at)`, `s.between(a, b)` | seconds since a time, or whether now is between two times |
| `s.video` | `{ duration, frames, fps, width, height, scenes }` of the whole video |

Every `at` and `out` accepts seconds (`2.4`), a spoken word (`'resolver'`) or
a marker (`'#ask'`). Word cues ignore case and punctuation. A phrase works
too. A wrong word or marker stops with an error that lists the closest words.

A word that is spoken more than once means its first time, and `check` gives
a hint about it. Add `#` and a number for a later time: `'fills#2'` is the
second time "fills" is spoken in the scene, the same as `s.cue('fills', 2)`.
Write `'fills#1'` when you mean the first time, and the hint goes away. This
works wherever a time goes: `at`, `out`, `s.time`, `s.cue` and `s.cueEnd`.
Only digits after the last `#` count, so `'C#'` stays a word and `'#ask'`
stays a marker.

An easing sets how a movement speeds up and slows down. The easing names are
`linear`, `in`, `out`, `inOut`, `outBack`, `outElastic`, `outQuart` and
`inOutSine`. `s.ease.out(p)`, `s.lerp(a, b, p)` and `s.clamp(v, lo, hi)` are
there for your own math.

## Layout

| Member | Meaning |
|---|---|
| `s.W`, `s.H`, `s.cx`, `s.cy` | canvas size and its center (on Shorts, TikTok and Reels the center of `s.safe`) |
| `s.portrait` | true when the frame is taller than wide |
| `s.safe` | `{ x, y, w, h, left, top, right, bottom }`: the area for content (a 7% margin, or the part a platform leaves free) |
| `s.full` | the same for the whole frame, for pictures that fill it, see `explainroo docs short-video` |
| `s.row(n, { width, x })` | n x positions spread over a width |
| `s.col(n, { height, y })` | n y positions spread over a height, centered in `s.safe` |
| `s.grid(cols, rows, { x, y, w, h, gap })` | cells `{ x, y, w, h }`, row by row, filling `s.safe` |
| `s.get(id)` | size and position of an element drawn earlier with that `id` |

Most elements return `{ x, y, w, h, left, right, top, bottom }`, so you can
place the next thing below or beside them.

## Options most elements take

| Option | Meaning |
|---|---|
| `at`, `out` | when it appears and when it leaves |
| `enter` | `draw`, `write`, `type`, `words`, `sync`, `pop`, `rise`, `fade`, `zoom`, `drop`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `none` |
| `exit` | `fade`, `pop`, `rise`, `drop`, `slide-left`, `slide-right`, `none` |
| `dur` | length of the entrance in seconds (shortened by the pace) |
| `outDur` | length of the exit in seconds (0.45) |
| `id` | a name for arrows, `annotate` and `s.get` |
| `color` | a color name (`blue`, `accent`, `ink`, `muted`, ...) or any CSS color |
| `opacity`, `scale`, `rotate` | extra changes, `rotate` in degrees |
| `float` | pixels of slow drift that keeps a still element alive |
| `sfx` | the sound on entrance, `false` for none, or `true` for its usual sound after `s.quiet()` |
| `overlap` | `true` when the shape may overlap other shapes, so `check` says nothing about it |
| `camera` | `false` keeps the automatic camera from moving to it |

`out` is when the exit starts, so an element is still fading while the next
one comes in. To swap one label for another in the same place, give the old
one `exit: 'none'` and the new one the same time as its `at`.

In `paper`, `chalk` and `blueprint`, shapes are drawn line by line and text
is written out. In `clean` and `midnight`, shapes pop and text rises. In
`editorial`, shapes fade in and text rises. In `studio`, shapes and text
rise. Use `at: -1` for things that were already on screen in the previous scene. They
are there from the start and make no sound.

## Text

```js
s.title('How DNS works', { at: 0 });                     // display font, 104 px, at 44% height
s.subtitle('the phone book of the internet', { at: 1 }); // 46 px, muted, at 60% height
s.text('Every site has an *address*', { y: 300, size: 64, at: 'address' });
s.note('about 20 ms', { x: 1400, y: 820, at: 3 });        // 32 px, muted
```

`s.str('key')` gives on-screen text from the strings file of the language
drawn, and `s.lang` its code.

`s.text(str, options)` takes these options: `x`, `y`, `size` (48), `font`
(`display`, `body`, `hand`, `mono`), `weight` or `bold: true`, `align`
(`left` means x is the left edge), `valign` (`top` means y is the top),
`maxWidth`, `lineHeight`, `color`, `mark` (color of `*starred*` words), `bg`
(a card behind the text), `padding`, `radius`, `border`. Text can also enter
with `write`, `type` (with `cps`), `words` and `sync`. `sync` shows each word
as the voice says it. Words in `*stars*` get the accent color. `\n` starts a
new line.

## Math

```js
s.math('E = mc^2', { y: 420, size: 96, at: 'energy' });
s.math(String.raw`\int_0^1 x^2\,dx = \tfrac{1}{3}`, { x: 960, y: 700, size: 72, color: 'accent', at: '#integral', id: 'area' });
```

`s.math(tex, options)` draws a TeX formula. Options: `x`, `y` (the center),
`size` (72), `color` (ink), `align` (`center` or `left`, where x is the left
edge), `display` (true for display style), and the common element options.
It returns a box like text. Its `id` works with arrows and `s.annotate`.
In `paper`, `chalk` and `blueprint`, the outlines draw first, then fill in.
Other looks use their text entrance. You can also use `fade`, `pop` or `rise`.

Double each backslash in a regular JS string, for example `'\\frac{1}{2}'`.
`String.raw` keeps backslashes as written, as in the second example above.
Only fixed TeX strings work. Always call `s.math`, and use `at` and `out` for
timing. `check` reports formulas that change with `s.t` or appear only later.
Formulas are typeset on this computer and cached in `build/math/`.

## Shapes and arrows

```js
s.box('Resolver', { id: 'res', x: 960, y: 540, icon: 'server', color: 'blue', at: 'resolver' });
s.circle({ id: 'you', x: 400, y: 540, r: 90, label: 'You', at: 0.5 });
s.arrow('you', 'res', { label: 'asks', at: 'asks' });
s.arrow([300, 900], [1600, 900], { bend: 0.3, dashed: true, at: 5 });
s.arrow([960, 260], [960, 820], { label: 'answers', labelSide: 'right', at: 'answers' });
s.line([[200, 800], [900, 700]], { color: 'accent', at: 2 });
s.path('M0 0 C 200 -150 400 150 600 0', { x: 660, y: 540, at: 3 });
```

`s.box(label, options)` is a card that fits its label. Options: `w`, `h`,
`minW`, `minH`, `size`, `font`, `icon`, `iconSize`, `iconColor`, `color`
(outline and a light fill), `fill`, `stroke`, `width`, `dashed`,
`border: false`, `radius`, `shape: 'ellipse'`, `textColor`, `fillStyle`
(hand-drawn looks: `solid`, `hachure`, `cross-hatch`, `zigzag`, `dots`),
`maxWidth`. The label wraps at `maxWidth`, 560 pixels, or inside `w`.
`minW` only widens the box, so to keep a long label on one line, raise
`maxWidth`. `s.circle({ r, label })` takes the same options.

`s.line(points, options)` and `s.path(d, options)` take `color`, `width`,
`dashed`, `fill` and `glow`. `s.path` also takes `fillStyle`, and
`single: true` draws a hand-drawn path with one stroke instead of two.

`s.arrow(from, to, options)` draws an arrow. `from` and `to` are `[x, y]`,
`{ x, y }` or the `id` of an element drawn earlier. With an `id`, the arrow
stops at the edge of that element. The label of an icon counts as part of the
icon here, so an arrow leaves or reaches a labelled icon outside its label.
Options: `bend` (about -1 to 1: a positive one curves to the right of the
way the arrow points, so one from left to right sags down, and a negative
one to the left; at 1 its middle moves a quarter of its length), `head`
(`end`, `start`, `both`, `none`),
`label`, `labelSize` (48, the size of body text), `labelColor`, `labelFont`
(the handwritten font by default; `'body'` suits `clean`), `labelOffset`,
`labelSide`, `gap`, `dashed`, `width`, `headSize`. `s.connect` does the same.
`gap` is the space in pixels between each end of the arrow and what it points
at: from the edge of an element (14 by default), and from a point, where it
is 0 unless you set it. So `gap: 20` between two points leaves 20 pixels free
at both ends.

A label sits above a straight arrow, left of a vertical one and on the outer
side of a curve, `labelOffset` away from the arrow's middle. Its size and
offset depend on the `"defaults"` line, which `explainroo docs settings`
explains.
`labelSide: 'left'`, `'right'`, `'above'` or `'below'` puts it on that side
instead. The third arrow above is vertical, and its label goes to the right,
for example because the left side is near the edge or full. `check` treats
the label as text. So it finds a label that overlaps other text or runs off
the frame, the same way it does for any text.

## Icons, images and video clips

```js
s.icon('database', { x: 1500, y: 540, size: 140, color: 'purple', at: 'database' });
s.icon('lock', { bg: 'circle', color: 'green', label: 'Encrypted', at: 4 });
s.image('assets/app.png', { w: 1100, frame: 'browser', url: 'app.example.com', at: 0.5 });
s.image('assets/cables.png', { w: 1000, frame: 'card', at: 'cables', kenburns: true });
```

The 1,854 icons come from Lucide. Search them with `explainroo icons <word>`.
Old Lucide names work too. Icon options: `size` (120), `color`, `weight` (2),
`bg` (`true`, `'circle'`, `'square'` or a color), `bgScale`, `label`,
`labelSize`, `labelColor`, `labelFont`. Its `bottom` is the icon's own, above
its label. With a label, it also returns `label`, the label's box, and
`outer`, a box with both, so `y: ic.outer.bottom + 40` goes below the label.

`s.image(src, options)` draws a file from `assets/`. Options: `w` and/or `h`
(the image keeps its shape), `fit` (`cover` or `contain`), `radius`, `frame`
(`none`, `card`, `browser`, `window`, `phone`), `url` (for the browser frame),
`border`, `shadow: false`, `kenburns: true` for a slow zoom.

`s.clip(src, options)` draws a video from `assets/` (`.mp4`, `.mov`, `.webm`
or `.m4v`). It takes the layout, frame and timing options of `s.image`, and
returns its box. `s.presenter(name)` plays an AI presenter from
`explainroo presenter` beside the content (`explainroo docs presenters`).

```js
s.clip('assets/clips/waves-3f2a.mp4', { full: true, speed: 'fit', at: 0 });
s.clip('assets/signup.mp4', { w: 1200, frame: 'browser', url: 'app.example.com', at: 'signup' });
s.clip('assets/demo.mov', { x: 1400, y: 540, h: 600, from: 12.5, speed: 1.5, at: '#demo', out: 9 });
```

Like an image, a clip has no frame by default, and it gets the look's
shadow, rounded corners and entrance for images. `shadow: false`,
`radius: 0` and `enter: 'none'` turn these off.

- `full: true` fills the whole frame, edge to edge, for a clip behind the
  whole scene. It has no frame, shadow, corners or entrance, and it ignores
  `x`, `y`, `w` and `h`.
- `from` (0) is the second in the clip where playback starts, at `at`.
- `speed` (1) goes from 0.25 to 4. `speed: 'fit'` plays the clip at the
  speed that makes it end with the scene, or at `out`, from half to twice the
  speed. Slower, it freezes at the end. Faster, it is cut off.
- `loop` (false) repeats the whole clip. Otherwise it holds the last frame,
  and `check` warns when that lasts more than 0.3 seconds.
- `volume` (0) goes from 0 to 1. Sound plays only at `speed: 1`, stops at
  `out`, the clip's end or the scene's end, and repeats with a loop. Music
  ducks under it as it does under the voice.

`at: -1` starts a clip one second into it, and `at: 0, enter: 'none'` shows
it from its first frame when the scene starts. `check` cannot read text
inside a clip, so look at stills of those moments.

## Recordings

`s.recording(name, options)` plays a recording of a real app that
`explainroo record` made (`explainroo docs product-demos recording`). A cursor
moves from step to step and a ring shows each click. It takes the layout,
frame and timing options of `s.clip`, and fills `s.safe` without `w` and `h`.

```js
const r = s.recording('new-invoice', { frame: 'browser', url: 'app.example.com', cues: { saved: '#saved' } });
s.text('Saved', { y: 120, at: r.times.saved });
```

A step with a `cue` happens on its word: the video holds the frame before
it until its action lands on the cue, or plays up to twice as fast when the
steps before take longer than the words. `check` warns about a
step late even then. `cues` sets cues by mark name or step number, and
`r.times` has each step's scene time, by number and name. It also takes
`cursor: false`, `zoom: false` and `sound: false` for the clicks. The
automatic camera keeps out, as its zoom steps are the camera.

## Pointing things out

```js
s.text('It is *not* magic', { id: 'claim', y: 400, at: 0 });
s.annotate('claim', { type: 'underline', at: 'magic' });
s.annotate({ x: 960, y: 700, w: 400, h: 90 }, { type: 'circle', color: 'red', at: 3 });
```

`s.annotate(target, options)` marks an element or a box. `type` is
`underline`, `circle`, `box`, `highlight`, `strike`, `cross` or `bracket`.
Options: `color`, `padding`, `width`, `dur`, `out`. An icon's `id` covers the icon
without its label, so a circle around it can run through the label. `check`
warns about that. Mark a box that holds both instead, like
`s.annotate({ x, y, w, h })`.

A mark stays until its own `out`. With `"defaults": "0.5"` in `video.json`, a
mark on an element's `id` that has no `out` of its own leaves with that
element. Without the line, give it the element's `out`. `check` warns when a
mark stays on screen more than 0.3 seconds after what it marks has left.

## Lists, numbers and charts

```js
s.list(['Browser cache', 'Resolver', 'Root server'], { x: 360, y: 280, at: 'first', stagger: 1.1 });
s.number(1500000, { suffix: ' requests', at: 'million', y: 480 });
s.bars([{ label: '2023', value: 19 }, { label: '2024', value: 31 }], { at: 1, suffix: 'k' });
s.lineChart([3, 5, 4, 8, 13, 21], { labels: ['M', 'T', 'W', 'T', 'F', 'S'], at: 1 });
s.pie([{ label: 'Images', value: 55 }, { label: 'Other', value: 45 }], { donut: 0.55, at: 1 });
```

- `s.list(items, options)`: items are text or `{ text, at, icon, color, out }`.
  `x` is the left edge and `y` the top. Options: `size` (50), `width`, `gap`,
  `bullet` (`dot`, `dash`, `number`, `badge`, `check`, `arrow` or an icon
  name), `card: false` (no cards in `studio`),
  `bulletColor`, `at` (a start time or a list of times), `stagger` (0.7),
  `enter`.
- `s.number(value, options)` counts up with ticking sounds. Options: `from`,
  `dur` (1.4), `prefix`, `suffix`, `decimals`, `separator`, `group: false`,
  plus the text options.
- `s.bars(data, options)`: items are `{ label, value, color, at }`. A bar
  with its own `at` grows when that word is spoken. Options: `x`, `y`, `w`,
  `h`, `max`, `stagger`, `growDur`, `values: false`, `prefix`, `suffix`,
  `format(v)`, `labelSize`, `valueSize`, `fillStyle`.
- `s.lineChart(values, options)`: `x`, `y`, `w`, `h`, `min`, `max`,
  `labels`, `dots: false`, `area: false`, `color`, `dur`.
- `s.pie(data, options)`: `x`, `y`, `r`, `donut` (0 to 0.8), `labels: false`,
  `labelOffset`, `dur`.

## Code and terminal

```js
s.code("const res = await fetch(url);", { lang: 'js', title: 'app.js', at: 0.5 });
s.terminal(['$ npm install', 'added 42 packages in 3s'], { at: 1 });
```

`s.code(source, options)` shows code. Options: `x` and `y` (the center of
the window), `lang` (`js`, `ts`, `py`,
`go`, `rust`, `php`, `sh`, `sql`, `json`, `md`), `size` (32), `w`, `title`
(or `false`), `lineNumbers: false`, `reveal` (`type`, `lines`, `none`),
`cps`, `lineDelay`, `highlight` (line numbers) and `highlightAt`. `check`
reports lines that are wider than the window.

Use steps to show a change, a refactor or a fix:

```js
s.code([
  { code: 'const total = items.length;', at: 0.5 },
  { code: 'const total = items\n  .filter((i) => i.active)\n  .length;', at: 'filter', highlight: [2] },
  { code: 'const activeCount = items\n  .filter((i) => i.active)\n  .length;', at: '#rename' },
], { lang: 'js', title: 'stats.js' });
```

Parts that stay slide to their new place, removed parts fade out and new
parts fade in. Each later step starts at its own `at`, and the change takes
`morphDur` seconds (0.8, shortened by `pace`). The element's `at` defaults to
the first step's. `reveal` applies to the first step only. A step's
`highlight` replaces the earlier one. The window is as wide as the widest
step, up to 86% of the frame, unless you set `w`, and its height follows the
line count. `check` checks the lines of every step.

`s.terminal(lines, options)` shows a terminal. Lines that start with `$ ` are
typed as commands. Other lines are output. A line can also be `{ cmd, at }`
or `{ out, at, color }`. `{ cmd }` adds the prompt itself, so write
`{ cmd: 'npm test' }`, not `'$ npm test'`. Options: `w`, `size`, `rows`,
`title`, `prompt`, `cps` (22), `outputDelay`, `lineGap`. With `"defaults":
"0.5"`, a terminal without an `at` of its own comes in with its first line,
like code with steps. `check` warns about a window that is empty for more
than a second, and about a command that starts with the prompt.

## Short videos

`s.short` is a kit for Shorts, TikTok and Reels: a hook title that is there on
the first frame, stickers, a step pill, a payoff card and camera punch-ins.
Read `explainroo docs short-video` first.

## Camera, groups and your own drawing

- `s.camera([{ at, x, y, zoom, dur, rotate }])` moves the view by hand
  instead of the automatic camera (see "The camera" in
  `explainroo docs pictures`). Call it first in the
  scene function. `s.camera([])` keeps the scene still.
- `s.focus(target, { at, out })` points the automatic camera at an element
  or a region on a cue, for example one row of a table. `target` is an `id`
  drawn earlier, `{ x, y, w, h }` (center and size) or `[x, y, w, h]`. It
  draws nothing.
- `s.group({ x, y, scale, rotate, at, out, enter }, () => { ... })` moves a
  set of elements together. Inside the group, positions count from `x`, `y`.
- `s.draw({ x, y, at, out, enter, dur, exit }, (ctx, life) => { ... })` gives
  you the canvas 2D context, so you can draw anything the other methods
  cannot. `s.ctx` is also available.
  - `ctx` is already moved to `x`, `y`, turned by `rotate` and sized by
    `scale`, so draw around 0, 0. Without `x` and `y`, 0, 0 is the top left
    corner of the frame, and you draw in frame pixels.
  - Nothing shows before `at`. The drawing is there at once, because `enter`
    is `'none'` unless you set it. Another entrance, like `enter: 'fade'`,
    brings the whole drawing in like any element. At `out` it leaves with
    `exit`, which fades by default.
  - `life.p` goes from 0 to 1 over `dur` seconds after `at`, or at once
    without `dur`, for your own drawing progress. `life.local` counts the
    seconds since `at`, for motion that keeps going.
  - The automatic camera measures a drawing once, as it looks at the end of
    the scene with `life.p` at 1, and keeps that box in the shot from `at` to
    `out`. So a drawing that moves is measured where it ends up. Keep the
    scene still with `s.camera([])` when that matters.
  - `check` sees that something is drawn, for the empty start and the cover,
    but not what. `box: { x, y, w, h }`, the center and size of what you
    draw, around 0, 0 like the drawing, makes `check` treat it as a shape
    for overlaps, text over its edge, the frame edge and the content area.
    `round: true` in it makes it an ellipse. Without `box` it sees no more.
- `s.burst({ x, y, at, count, colors })` fires confetti.
- `s.bg(color)` paints over the background.
- `s.rand(i)`, `s.noise(x)` and `s.wiggle(amount, speed)` give random values
  that come out the same every time you render.

## Sound

Elements make a sound when they enter. The look picks the sound. Drawn lines
scribble, cards pop, arrows whoosh, list items play rising notes, numbers
tick, typing clicks, and scenes change with a swipe. `sfx: false` silences
one element. `s.quiet()` at the top of a scene turns off the entrance sounds
of everything after it in that scene, for example when twelve circles appear
and one sound is enough. Give that one `sfx: true`. The chime of `s.ui.toast`
and the swipe of `s.ui.wipe` count as their entrance sounds too. `"sfx": "minimal"` in
`video.json` keeps only the transitions and the sounds you add yourself, and
`sfx: true` there plays an element's usual sound too.

`s.sfx(name, at, { gain, dur, pitch })` adds a sound: `pop`, `click`,
`whoosh`, `swipe`, `tick`, `type`, `ding`, `chime`, `thud`, `scribble`,
`chalk`, `rise`, `sparkle`, `blip`, `error`. `dur` sets the length of `type`,
`scribble`, `chalk` and `rise` (`rise` ends at `at + dur`). The music is made
to fit the video, and it gets quieter while the voice speaks.

`s.sound('assets/door.mp3', { at, out, volume })` plays your own file on a cue,
lowered under the voice. `"sfx": false` doesn't silence it.

## Colors and fonts

For product demos in a brand's own colors and fonts, run
`explainroo docs product-demos`.

Color names: `accent`, `ink`, `muted`, `bg`, `surface`, `red`, `orange`,
`yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`. Each look has its
own version of each color, so scenes keep working when you change the look.
`s.color(name)` returns the CSS color and `s.tint(name)` the light fill. The
font roles are `display`, `body`, `hand` and `mono`.
