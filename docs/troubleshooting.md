# Things that break

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
- Text in AI images. Put words on screen with `s.text`.
- A cue word that is spoken twice. `at: 'writes'` means the first time, and
  `check` lists such words as hints. Write `'writes#2'` for the second time,
  or a `[#marker]`. Write `'writes#1'` when you mean the first time, and the
  hint goes away.
- Apostrophes in cue words. Cues ignore punctuation, so "visitor's" is heard
  as "visitors". `at: 'visitor'` then waits for the next plain "visitor".
  Use a `[#marker]` there.
- Elements inside `s.group`. Each one makes its sound at its own `at`, even
  while the group is still hidden. Give them the group's `at`, or
  `sfx: false`.
- Words that sound like other words. When the speech check hears "plain" as
  "plane", it counts the word and lists it as sounding the same, so it needs
  no fix. In German it can't tell, and `{shown|spoken}` cannot fix that, so
  reword the sentence there. For acronyms that are spelled out letter by letter, write
  `{API|A, P, I}`. Do not write `A.P.I.`, because the voice reads the dots
  like a web address.
- Growing a shape by changing `w` or `h` over time in the hand-drawn looks.
  The outline is drawn fresh every frame, so it wobbles. Animate `scale`
  instead.
- A scene change in the middle of one diagram. The default transition of
  `clean` slides the whole frame. Give scenes that share a diagram
  `{transition=fade}` or `{transition=cut}`.
- Arrows from an icon that has a label. The `id` of an icon covers the icon
  only, not its label, so an arrow that leaves downward crosses the label.
- An arrow label near the edge. A vertical arrow's label sits on its left.
  Move it with `labelSide: 'right'`, or `'above'` or `'below'`.
- Text with a background but no words, like `s.text('   ', { bg: 'surface' })`
  for an empty field. It shrinks to a thin empty card. Draw the field with
  `s.box({ w: 520, h: 72 })` or another shape with a size. `check` warns
  about it.
- Colored text in `paper` and `clean`. Green, orange and red are light enough
  for shapes but often too light for text. `check` warns about low contrast.
  It suggests a readable color and shows its contrast ratio.
- Long video clips fill `build/clips/` with frames. Trim footage to the part
  you show before you add it. Deleting `build/clips/` is safe.
- Screen recordings often have a variable frame rate. explainroo converts
  them to the project's fps, so a frame can repeat or drop. Record at a fixed
  frame rate when the motion matters.
- Exact geometry in `paper`, `chalk` and `blueprint`. Their outlines are
  hand drawn, so a circle's edge wanders a little from its radius. When a
  line has to meet an outline exactly, like a radius that ends on the
  circle, draw both with `s.draw`.
- A render that stops with a closed browser or `EPIPE` on a busy computer.
  Run it again with fewer pages, for example `render --workers 2`.

`check` looks at text and math formulas, and an arrow's label counts as
text. It finds text that is:

- off the frame, or closer than 3.5% to the edge
- too small
- low in contrast against the page, a background from `s.bg` or
  `s.short.backdrop`, or the text's own `bg`
- on top of other text, or under the captions

It also warns about text with a background but no words, and about a `lift`
above 2 in `s.ui`. It does not see shapes, arrow lines and icons, or drawings
made with `s.draw`. Look at the stills for those.
