# Motion of your own

The scene API animates its elements for you: they come in on their cue and
leave at `out`. This topic is for motion you write yourself, like a planet on
its orbit in 3D, a line that grows along a path, a logo that builds itself, or
a short piece with no narration that moves to music.

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
    A drawing behind everything, like a sky or a backdrop, needs no `box`, or
    `overlap: true` with it, so text on top isn't an overlap.
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

## 3D scenes

`s.three(options, { setup, frame })` draws a 3D scene with three.js, version
0.187. Use it where depth shows the idea: a planet on its tilted axis, the
layers of a chip, a molecule, a product from every side. Flat diagrams read
better with the 2D elements.

```js
tilt(s) {
  const lean = (23.4 * Math.PI) / 180;
  const earth = s.three({ id: 'earth', at: -1 }, {
    setup({ THREE, scene, color }) {
      const axis = new THREE.Group();
      axis.rotation.z = -lean;
      const globe = new THREE.Mesh(new THREE.SphereGeometry(2.2, 64, 48), new THREE.MeshStandardMaterial({ color: color('blue'), roughness: 0.5 }));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 6.4), new THREE.MeshStandardMaterial({ color: color('ink') }));
      axis.add(globe, pole);
      scene.add(axis);
      return { globe };
    },
    frame({ t, state }) {
      state.globe.rotation.y = t * 0.6;
    },
  });
  // The top of the axis, in the frame, for a label beside it.
  const top = earth.point([3.2 * Math.sin(lean), 3.2 * Math.cos(lean), 0]);
  s.text('The axis leans 23.4°', { x: top.x + 280, y: top.y, size: 48, at: 'leans' });
},
```

- **The box.** `x`, `y`, `w` and `h` place it like an image, and `at`, `out`,
  `enter`, `exit` and `id` work the same way. Without `w` and `h` it fills
  `s.safe`, and `full: true` fills the frame. Either way it is the shot
  itself, so the automatic camera keeps out of that scene. A smaller box is an
  element like any other for the camera.
- **`setup({ THREE, scene, camera, lights, texture, color, w, h })`** runs once
  before the element first draws. Build the geometry, materials and lights
  here, and return what `frame` needs. It can't be async.
  `texture('assets/wood.jpg')` gives an image from `assets/` as a texture at
  once. `Math.random()` gives the same numbers on every render page here too.
- **`frame({ t, local, s, state, scene, camera, lights, THREE, color, texture })`**
  runs on every frame, in `check` and for each motion blur sample. Set every
  position, rotation and color from `t`, the scene time, or `local`, the
  seconds since `at`. Its `s` is the scene's own, so `s.keys` and `s.p` work
  inside it.
- **The stage.** The camera is a perspective camera 10 units back, looking at
  the middle. `lights.sky` lights from above, `lights.key` from the upper
  right and `lights.fill` softly from the left. A soft studio light makes
  shiny and metal surfaces reflect. The background is clear, so the look's
  background shows. `scene.background = color('bg')` paints it. Colors from
  `color(name)` are the look's, as in 2D. For light from one side only, like
  the Sun in space, turn the stage's light off in `setup` and add your own:
  `lights.sky.visible = lights.key.visible = lights.fill.visible = false` and
  `scene.environment = null`. What `setup` changes stays, and `frame` can
  change it again.
- **`point([x, y, z])`** on what `s.three` returns gives the place of a 3D
  point in the frame, `{ x, y, behind }`, for labels in `s.text`. Put words in
  `s.text`, not in the 3D scene: they stay sharp, and `check` reads them.
- **What there is.** The core of three.js: geometries, materials, lights,
  groups, curves and textures from images. No add-ons, so no model loaders,
  no post-processing and no controls. `.glb` models come later.

### 3D that looks good

- One object, big and clear: about half the height of the frame, with room
  for its labels.
- Matte materials (`roughness` 0.4 to 0.8) look calm. Use `metalness` only
  for metal.
- Light from above, like the stage does. Shadows (`castShadow`) cost a lot
  of time and rarely help.
- Move the camera slowly along one path per idea, with `s.keys` on
  `camera.position`, and look at the object with `camera.lookAt(0, 0, 0)`.
  Or keep it still and turn the object.

### How long 3D takes

Chrome draws 3D on the processor. On 8 cores, a second of 1080p video at 30
frames a second takes about 3 to 4 seconds, and more render pages don't make
it faster. A draft at half size takes about a third of that. Keep geometry lean,
like 64 segments for a sphere. Motion blur draws each frame several times,
but 3D draws once a frame and is shared, so 3D motion itself has no blur.
The camera's blur still applies.

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

`{bars=n}` sets the length of a scene alone: `hold`, `min` and `lead` don't
apply to it. `explainroo docs music` lists the tempo of each built-in style,
so you can plan the bars before anything is made, and
`explainroo voice <project> --estimate` prints the length of the video.
`"transition": "cut"` in `video.json` keeps every cut hard. A fade between
two scenes that go on with the same object shows it twice.

With `"defaults": "0.7"`, music under a video without narration starts in
its full groove on the first beat, and its closing hit lands on the bar line
where the last scene ends. The end of the video then holds for `"end"`
seconds, 1.4 by default, which you set in `video.json`. Wide capitals for a
tagline come from `tracking: 0.3` on `s.text`.

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
