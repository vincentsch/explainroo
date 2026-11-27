# Motion of your own

The scene API animates its elements for you: they come in on their cue and
leave at `out`. This topic is for motion you write yourself, like a planet on
its orbit, a line that grows along a path, a logo that builds itself, or a
short piece with no narration that moves to music.

## The one rule

A scene function draws one frame from the time. explainroo calls it for every
frame with a fresh `s`, and each render page draws its own part of the video,
in any order. So work out every position, angle and color from `s.t` (or from
`life.local` in `s.draw`). Keep no counter that grows from frame to frame and
no value outside the scene function. `Date.now()` and `performance.now()`
give a different video every time.

```js
// Wrong: the square turns a bit more on every call, and jumps between pages.
let angle = 0;
spin(s) { angle += 0.05; /* ... */ }

// Right: the angle comes from the time.
spin(s) { const angle = s.t * 1.5; /* ... */ }
```

`check` draws a moment of each scene, then other moments, then the first one
again, and warns when the two pictures differ. `Math.random()` is fine: it
gives the same numbers on every frame and every render.

## Your own drawing

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
  - `check` warns about a drawing that draws nothing while it is on screen.
    Where a drawing moves, the picture counts as changing, so a scene with
    steady motion gets no hint about a long stretch without anything new.

Put words in `s.text` next to a drawing, not in `ctx.fillText`, because
`check` reads only text from the scene API: its size, its contrast and
whether it runs off the frame.

## Illustrations from SVG files

For an illustration, like a rocket, a house or a server rack, write it as an
SVG file in `assets/` and draw it with `s.image`. It stays sharp at any size,
and the camera can zoom into it. To move parts of it on their own, put each
part in a file of its own and give each its own `at`, `x` and `y`. For a line
that draws itself on, take the path data of the line into `s.path`, whose
`enter: 'draw'` draws it from one end to the other. Text in an SVG file uses
the fonts of the computer, so put labels in `s.text` instead.

## Keyframes and paths

```js
// The x of a ball: still until 1 s, then over to 1400 on the word "fast".
const x = s.keys([{ at: 1, v: 300 }, { at: 'fast', v: 1400, ease: 'outBack' }]);
// A point and a color work the same way.
const [px, py] = s.keys([{ at: 0, v: [200, 800] }, { at: 3, v: [1600, 300] }]);
const fill = s.keys([{ at: 0, v: 'muted' }, { at: '#hot', v: 'red' }]);
```

`s.keys(frames, t = s.t)` gives the value at a time from keyframes. `at` takes
anything a time takes: seconds, a spoken word or a `#marker`. The value holds
before the first key and after the last. `ease` on a key shapes the way into
it, and the default is `inOut`. Values can be numbers, lists of numbers like a
point, objects of numbers like `{ x, y }`, or colors, as names of the look or
CSS colors.

`s.along(path, p)` gives `{ x, y, angle }` at `p`, from 0 to 1, along SVG path
data or a list of points. `angle` is in degrees, like `rotate`, so something
that travels can face where it goes:

```js
const route = 'M 300 800 C 700 200 1200 200 1600 600';
const p = s.p('launch', 3, 'inOut');
const at = s.along(route, p);
s.icon('rocket', { x: at.x, y: at.y, rotate: at.angle + 45, size: 80, at: 0 });
```

`s.p(at, dur, 'spring')` springs a little past the end and settles. To start a
row of things one after another, give each a later time, like
`at: s.time('list') + i * 0.12`.

## Beats and videos without words

The built-in music knows its tempo. `s.beat(n)` gives the scene time of the
n-th beat of the music in the scene, counted from 1, and `s.bar(n)` the n-th
bar line, four beats apart. They go wherever a time goes:

```js
s.title('Launch day', { at: s.bar(1) });
s.icon('rocket', { at: s.beat(3), enter: 'pop' });
s.sfx('rise', s.bar(1), { dur: s.bar(2) - s.bar(1) });
s.sfx('impact', s.bar(2));
```

`s.beat(2.5)` is the off-beat between beats 2 and 3. A music file has beats
when its `"music"` block gives `bpm`, and `offset` when its first beat isn't
at 0 (`explainroo docs music`).

For a piece without narration, give each scene a length in bars in the
script. Each scene then ends on a bar line, so every cut lands on the beat:

```markdown
# Launch

## logo {bars=2}

## promise {bars=4}

## end {bars=2}
```

With `"defaults": "0.7"`, music under a video without narration starts in
its full groove on the first beat, and its closing hit lands on the bar line
where the last scene ends. The end of the video holds after it.

Sound makes a reveal land. `rise` builds up to a moment, so start it one bar
early with `dur` set to that bar, and `impact` is the hit on the beat itself.
Keep it to one or two big moments in a piece, or none of them feel big.

## Motion that looks designed

- **Everything moves for a reason.** Motion shows what causes what, where
  something goes or what matters now. Decoration that moves all the time
  pulls the eye away from the point.
- **One thing at a time.** Start a new movement when the last one has
  landed, or let things follow each other by about 0.1 second.
- **Ease every move.** Things speed up and slow down. `inOut` for moves
  across the frame, `out` for things that arrive, `outBack` or `spring` for a
  small overshoot when something lands. `linear` only for things that turn or
  flow without end, like a wheel or a river.
- **Wind up and follow through.** A small move back before a big move forward,
  and a little overshoot at the end, make motion feel physical.
- **Hold.** After a move, keep the picture still long enough to read it,
  about a second for every three words on screen.
- **Big things move slowly, small things fast.** A planet takes seconds, a
  spark a fraction of one.
- **Keep the camera calm** during your own motion. Two moving layers at once
  are hard to follow, so keep the scene still with `s.camera([])` when the
  drawing itself moves across the frame.
