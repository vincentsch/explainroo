# Things that break

## Installing and running

- `npx --yes explainroo` that prints nothing and stops. On Linux, installing
  explainroo makes ONNX Runtime download its graphics card files from GitHub,
  and when that download fails, `npx` says nothing. explainroo doesn't use
  those files. Run the command again with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`
  in front of it.
- A render that stops with a closed browser or `EPIPE` on a busy computer.
  Run it again with fewer pages, for example `render --workers 2`.
- Running explainroo on one project from two computers at once, or from a
  container and its host, through a network drive, a synced folder or a
  shared mount. Its locks only work within one computer, so a purchase or a
  post there isn't protected from a second run.
- "Another run is busy" when no other explainroo command runs, for example
  after a crash on Windows, where the process id went to another program.
  Each lock is a folder: in the project's `history/locks/` for posts, clip
  purchases and files put in place, and for sign-ins in `locks/` next to the
  keys file that `explainroo doctor` prints. Move that folder away only while
  no explainroo command runs.
- Long video clips fill `build/clips/` with frames, taken once at the
  project's fps and at most 1920 pixels wide. Trim footage to the part you
  show before you add it. Deleting `build/clips/` is safe.
- Screen recordings often have a variable frame rate. explainroo converts
  them to the project's fps, so a frame can repeat or drop. Record at a fixed
  frame rate when the motion matters.

## Scene code

- Calling an element only sometimes, like `if (s.t > 3) s.box(...)`. Always
  call it, and use `at` and `out` for the timing. The sound effects and the
  checks depend on this.
- Changing the TeX in `s.math` over time. Use fixed strings for each formula,
  and give each one its own `at` and `out`.
- An arrow or annotation that points to an `id` drawn later in the function.
- `s.camera()` after other elements. It has to come first.
- An `at` later than the end of the scene. Make the scene longer with
  `{hold=2}` or `{min=6}` in the script.
- Random values from anything other than `s.rand()`, `s.noise()` or
  `Math.random()` inside the scene function. Only those three come out the
  same on every render.
- Elements inside `s.group`. Each one makes its sound at its own `at`, even
  while the group is still hidden. Give them the group's `at`, or
  `sfx: false`.

## Narration and cues

- A cue word that is spoken twice. `at: 'writes'` means the first time, and
  `check` lists such words as hints. Write `'writes#2'` for the second time,
  or a `[#marker]`. Write `'writes#1'` when you mean the first time, and the
  hint goes away.
- Apostrophes in cue words. Cues ignore punctuation, so "visitor's" is heard
  as "visitors". `at: 'visitor'` then waits for the next plain "visitor".
  Use a `[#marker]` there. A French or Italian article is different:
  `at: 'ombre'` finds "l'ombre".
- Words that sound like other words. When the speech check hears "plain" as
  "plane", it counts the word and lists it as sounding the same, so it needs
  no fix. In German it can't tell, and `{shown|spoken}` cannot fix that, so
  reword the sentence there. For acronyms that are spelled out letter by letter, write
  `{API|A, P, I}`. Do not write `A.P.I.`, because the voice reads the dots
  like a web address.

## Pictures and text

- Text in AI images. Put words on screen with `s.text`.
- Growing a shape by changing `w` or `h` over time in the hand-drawn looks.
  The outline is drawn fresh every frame, so it wobbles. Animate `scale`
  instead.
- A scene change in the middle of one diagram. The default transition of
  `clean` slides the whole frame. Give scenes that share a diagram
  `{transition=fade}` or `{transition=cut}`.
- A mark around an icon that has a label. The `id` of an icon covers the icon
  without its label, so `s.annotate('id', { type: 'circle' })` can run through
  the label. Mark a box that holds both, like `s.annotate({ x, y, w, h })`.
  With `"defaults": "0.5"`, arrows leave and reach a labelled icon outside
  its label.
- Shapes that partly cover each other, like two cards that grow into each
  other after you make their text bigger. Move them apart. A badge meant to sit
  on a card's corner takes `overlap: true`.
- An arrow label near the edge. A vertical arrow's label sits on its left.
  Move it with `labelSide: 'right'`, or `'above'` or `'below'`.
- Text with a background but no words, like `s.text('   ', { bg: 'surface' })`
  for an empty field. It shrinks to a thin empty card. Draw the field with
  `s.box({ w: 520, h: 72 })` or another shape with a size. `check` warns
  about it.
- Colored text in `paper` and `clean`. Green, orange and red are light enough
  for shapes but often too light for text. `check` warns about low contrast.
  It suggests a readable color and shows its contrast ratio.
- Exact geometry in `paper`, `chalk` and `blueprint`. Their outlines are
  hand drawn, so a circle's edge wanders a little from its radius. When a
  line has to meet an outline exactly, like a radius that ends on the
  circle, draw both with `s.draw`.

## What check finds in text

`check` looks at text and math formulas, and an arrow's label counts as
text. It finds text that is:

- off the frame, or closer than 3.5% to the edge. On Shorts, TikTok and Reels
  it is anything outside the content area, `s.safe`, see
  `explainroo docs sizes`
- too small at the size it is shown, with the camera's zoom. In a tall or
  square frame, which people watch on a phone, text below 40 pixels at 1080p
  gets a hint too
- low in contrast against the page, a background from `s.bg` or
  `s.short.backdrop`, or its own sticker, box or `bg`, the `*starred*` words
  too. It suggests a darker or lighter shade of the same color first, so the
  color keeps its meaning, and the look's `ink` second
- on top of other text, or under the captions
- partly over a shape, like a note on the edge of a box or a word that sits
  on its border: text that reaches more than 4 pixels into the line drawn
  around the shape, from outside or from inside. Text fully inside or fully
  outside is fine. A shape's own text, text in its group and `overlap: true`
  don't count
- crossed by the line of an arrow or of a mark from `s.annotate`
- cut at the edge of the frame by the camera while the shot holds still,
  the words of charts too. For a table of texts in rows and columns, a held
  shot that shows some rows without the header counts as cut. Keep that scene still with `s.camera([])`

## What else check finds

`check` also finds:

- shapes that partly overlap: boxes, cards, panels, images, icons and stickers
- a sticker that covers an icon, an image, a clip, a drawing or text, also
  with `overlap: true`, which lets a sticker cover backgrounds only
- shapes in the caption band, and on Shorts, TikTok and Reels shapes outside
  the content area. A shape that fills the whole frame is a background and
  doesn't count. With `"defaults": "0.6"` a tall video's pictures may fill
  `s.full`, and only text outside `s.safe` counts
- a mark from `s.annotate` that stays on screen more than 0.3 seconds after
  the element it marks has left
- a code window or a terminal that is on screen empty for more than a second
  before its first line or step, and a terminal command that starts with the
  prompt, like `{ cmd: '$ npm test' }`, which shows `$ $ npm test`
- an arrow whose line runs through a shape or icon that is not one of its
  ends, and an arrow line off the frame, near its edge, outside the content
  area or in the caption band
- an arrow that points at nothing for a while: it starts from an element
  that isn't on screen yet, or its tip arrives before the element it points
  at. Give it the `at` of that element or a later one
- code that types itself or shows its lines one by one, a terminal, a number
  that counts or text that writes itself, when it isn't all there by the end
  of its scene or by its `out`. It says how much is missing and which option
  changes that
- as a hint, different text of two scenes in the same place during a `zoom`
  between them, for more than two frames, because the zoom shows the two at
  different sizes. Give the scene `{transition=cut}` or `{transition=push}`,
  which moves the scenes side by side. A `fade` that blends one text into
  another is not a finding
- a scene that shows only its background for more than 1.5 seconds, at the
  start or later, when everything has left and nothing new has come yet
- a cover with only text on an empty background
- a cover that shows an image cut by `fit: 'cover'`, the default when an image
  has both `w` and `h`. It fills the box and cuts off what doesn't fit, which
  can cut words or a face in the thumbnail. Give the box the image's shape, or
  use `fit: 'contain'`
- a first frame that shows only the background, or only elements still on
  their way in. Buffer, LinkedIn and other services use the first frame as
  the thumbnail, and a blank one looks like a broken video. The hint names an
  element of the scene's fullest frame, a picture first. Give it `at: -1`, and
  it is there from the first frame, without an entrance or a sound
- a text placed `at: 0`, like the product's name, that is still coming in on
  the first frame, so the thumbnail misses it. `at: -1` puts it there from the
  start
- text with a background but no words
- a `lift` above 2 in `s.ui`
- a cue or a `#marker` that isn't in the narration. That is an error, and
  `check` goes on with the rest of the scene as if the cue were at the scene
  start, so one run shows all of its findings. A marker needs its `#`, as in
  `at: '#listen'`. When a cue without it has the name of a marker in that
  scene, the error asks first whether you meant the marker

## How check names elements

A finding names the element it is about by what it shows, like the box
"Your phone", with its `id` when it has one. An element with neither is named
by its call and where it is, like "the 2nd s.draw at 960,735", the second
`s.draw` of that scene. So give an element an `id` when a scene has several
of the same kind.

It does not see what a drawing made with `s.draw` or straight on `s.ctx`
holds. Give `s.draw` a `box`, and `check` treats that box as a shape: for
overlaps, text over its edge, the frame edge and the content area. Look at the
stills for the rest.
