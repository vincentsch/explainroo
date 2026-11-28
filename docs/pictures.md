# What makes the pictures good

Every video should look finished, as if someone designed it for this topic.
Nothing should look like a template with new words in it. The rules below and
the worked example after them are how you get there.

- **Show it when it is said.** A picture appears as the voice mentions it.
  Use word cues. A cue names a word or a number, not a symbol: for "5 %" the
  cue is `'5'`. `explainroo words` prints the cue of every word. A time with
  `~` there is estimated, and `check` names a word nearby with a measured
  time when a cue sits on one.
- **Something changes every 2 to 4 seconds.** A new element, an arrow or a
  highlight. The camera adds its own moves. `check` points out long stretches
  where nothing new appears.
- **Short screen text.** Labels, numbers and key phrases of a few words. The
  whole narration never goes on screen. When the narration should be readable,
  turn on captions (`"captions": true`). Then do not also show the sentence
  the voice is saying as text.
- **Few things at once.** At most five or six elements. Take things off the
  screen with `out` before the next idea.
- **Big and readable.** Titles 80 to 110 px, labels 40 to 56 px, small text
  at least 32 px on a 1920 x 1080 canvas. Stay inside `s.safe`.
- **Same meaning, same color.** Give each thing one color and one place and
  keep them. Use the accent color for the one thing that matters most.
- **Real examples.** A command you can run, a number with its source or a
  picture of the real screen is better than three boxes with general words.
- **A clear last frame** that shows the main point.

## From a card to a picture

A first draft often puts the idea in words on a card. The viewer reads the
card while the voice says the same words, and learns nothing from the
picture. Draw what the sentence is about instead, so the viewer sees it
happen.

The narration of this scene is: "A hash function turns your password into a
long string. Change one letter, and you get a different string."

Before, a title and a card:

```js
hash(s) {
  s.title('Passwords are hashed', { at: 0 });
  s.box('A hash function turns your password into a long string', { y: 720, at: 'function' });
},
```

After, the passwords, the step and the results, each on its word:

```js
hash(s) {
  const { left, top, w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  const [y1, y2] = [top + h * 0.34, top + h * 0.66];
  const [x1, x2] = [left + w * 0.13, left + w * 0.82];
  s.box('hash', { id: 'fn', x: s.cx, y: s.cy, size: u * 6, icon: 'cog', color: 'accent', at: 'function' });
  s.text('hunter2', { id: 'pw', x: x1, y: y1, font: 'mono', size: u * 7, at: 'password' });
  s.arrow('pw', 'fn', { at: 'password' });
  s.text('f52fbd32…a3f6c7', { id: 'out', x: x2, y: y1, font: 'mono', size: u * 5.5, at: 'string#1' });
  s.arrow('fn', 'out', { at: 'string#1' });
  // One letter more, and the whole string changes with it.
  s.text('hunter3', { id: 'pw2', x: x1, y: y2, font: 'mono', size: u * 7, at: 'letter' });
  s.arrow('pw2', 'fn', { at: 'letter' });
  s.text('fb8c2e2b…21cfa57a', { id: 'out2', x: x2, y: y2, font: 'mono', size: u * 5.5, color: 'red', at: 'different' });
  s.arrow('fn', 'out2', { at: 'different' });
},
```

The second version shows what goes in, what happens and what comes out. The
second row proves the last sentence instead of repeating it. The strings are
the real SHA-256 of both passwords, because a viewer may check. The box comes
first, because the voice says "function" before "password". "String" is
spoken twice, so the first result waits for `string#1`, and the second one
comes on "different".

## What makes a video great

- **A hook in the first two seconds.** The first frame shows what the video
  is about with a picture, not only a title. The first sentence asks the
  question or shows the problem.
- **Something to see in every sentence.** Before you write a scene's code,
  decide what the viewer sees on each sentence: a diagram, a number, a real
  screen or an object that moves. A sentence with nothing to see needs a
  picture, or it can go.
- **Show the mechanism.** Draw the parts and what they do to each other.
  Something travels along an arrow, a number counts up, a value changes color.
- **A new layout when the idea changes.** Scene after scene of a title over
  three cards reads as a template. Switch between a big number, a comparison,
  steps, a close-up of one thing and a picture that fills the frame.
- **Motion with a purpose.** Things move to show cause and effect or to lead
  the eye. One thing moves at a time, so the viewer knows where to look.
- **Time to read.** Give a label about a second for every three words before
  the next thing comes. Let the picture hold after the last sentence of a
  scene, so it lands before the cut.
- **One thing matters most.** It is the biggest and gets the accent color.
  The rest is smaller and quieter.
- **An ending that answers the opening.** The last scene comes back to the
  first question and shows the answer in one picture.

## Before you render

`explainroo sheet` prints these questions under the path of its image. Look
at the sheet and at a still of each scene, answer each question, and fix
what fails before you render:

1. Hook: does the first frame show what the video is about with a picture, and do the first two seconds give a reason to keep watching?
2. Pictures: does each frame show what its sentence says, with a diagram, a number, a real screen or an object, and not a card that repeats the words?
3. Variety: do the scenes look different from each other, with a new layout when the idea changes?
4. Phone: can every word be read on a phone, with one clear thing to look at in each frame?
5. Ending: does the last frame show the main point, the answer to the opening?

## Layouts that work

These four layouts cover many scenes: one big number, a comparison, steps in
order, and one main thing with its parts. Start from the one that fits and
change the words, colors and cues. Each one also works in tall and square
frames.

```js
export default {
  // One big number with a short caption under it.
  number(s) {
    const { w, h } = s.safe;
    const u = Math.min(w, h) / 100;
    // The number also has to fit across a narrow, tall frame.
    const n = s.number(1000000, { y: s.cy - u * 4, size: Math.min(u * 20, w / 6), at: '#number' });
    s.text('requests a day', { y: n.bottom + u * 6, size: u * 7, color: 'muted', at: '#caption' });
  },

  // Two things side by side, or stacked in a tall frame.
  compare(s) {
    const { w, h } = s.safe;
    const u = Math.min(w, h) / 100;
    const cells = s.grid(s.portrait ? 1 : 2, s.portrait ? 2 : 1, { gap: u * 8 });
    const sides = [
      { title: 'Callbacks', note: 'one function inside another', color: 'orange', at: '#left' },
      { title: 'async / await', note: 'reads from top to bottom', color: 'green', at: '#right' },
    ];
    sides.forEach(({ title, note, color, at }, i) => {
      const c = cells[i];
      // The note hangs from the card, so a note that wraps grows downward.
      const card = s.box(title, { x: c.x, y: c.y - u * 6, w: c.w * 0.8, size: u * 8, color, at });
      s.text(note, { x: c.x, y: card.bottom + u * 2.5, valign: 'top', size: u * 6, color: 'muted', maxWidth: c.w * 0.85, at });
    });
  },

  // Steps in order, left to right, or top to bottom in a tall frame.
  steps(s) {
    const { w, h } = s.safe;
    const u = Math.min(w, h) / 100;
    const labels = ['Browser', 'Resolver', 'Address'];
    const xs = s.portrait ? labels.map(() => s.cx) : s.row(labels.length, { width: w * 0.72 });
    const ys = s.portrait ? s.col(labels.length) : labels.map(() => s.cy);
    labels.forEach((label, i) => {
      const at = i ? `#step${i + 1}` : 0.3;
      s.box(label, { id: `step${i}`, x: xs[i], y: ys[i], size: u * 7, at });
      if (i) s.arrow(`step${i - 1}`, `step${i}`, { at });
    });
  },

  // One main thing with its parts around it. A tall frame has no room
  // beside it, so the parts sit in a row underneath.
  hub(s) {
    const { w, h } = s.safe;
    const u = Math.min(w, h) / 100;
    const parts = ['Email', 'Calendar', 'Files'];
    const hubY = s.portrait ? s.cy - h * 0.18 : s.cy;
    const spots = s.portrait
      ? s.row(parts.length, { width: w * 0.72 }).map((x) => ({ x, y: s.cy + h * 0.16 }))
      : [-90, 30, 150].map((d) => ({ x: s.cx + Math.cos((d * Math.PI) / 180) * w * 0.34, y: s.cy + Math.sin((d * Math.PI) / 180) * h * 0.3 }));
    s.box('Login server', { id: 'hub', x: s.cx, y: hubY, size: u * 8, color: 'accent', at: '#hub' });
    parts.forEach((label, i) => {
      const at = `#spoke${i + 1}`;
      s.box(label, { id: `part${i}`, ...spots[i], size: u * (s.portrait ? 6 : 6.5), at });
      s.arrow('hub', `part${i}`, { at });
    });
  },
};
```

Text sizes come from `u`, a hundredth of the short side of `s.safe`, the
same rule as the `scenes.js` that `init` writes and the `scene-api` examples.
`s.safe` is the part of the frame that is free for content, so the sizes fit
wide and tall frames alike. A big number also has to fit across a narrow
frame.
`explainroo docs scene-api` lists every call these layouts use, with all
its options.

Numbers follow the video's language with `"defaults": "0.6"`. In a French
video, `s.number` writes `1 050 €` and `52,50 €`, and a line chart compares
two curves on one scale:

```js
const years = Array.from({ length: 21 }, (_, n) => n);
s.number(1050, { suffix: ' €', at: 'passe' });
s.number(52.5, { decimals: 2, suffix: ' €', y: 800, at: 'alors' });
s.lineChart({
  'Intérêts composés': years.map((n) => 1000 * 1.05 ** n),
  'Intérêts simples': years.map((n) => 1000 + 50 * n),
}, { labels: years.map((n) => (n % 5 ? '' : `${n} ans`)), at: 'vingt' });
```

Each line gets its name at its end, in the look's colors.

## The camera

explainroo films each scene with a camera that follows the narration. It
opens on the picture. When a scene starts small, the camera starts close and
widens as new things need room. Something new that already fits the shot
needs no move. Now and then the camera moves in on what the voice talks
about, for example a new card and the one it relates to, when the viewer has
time to look. Then it follows new things at that distance. Near the end of
the scene it pulls back, so the last frame shows the whole idea. During each
scene it also pushes in very slowly.

While a shot holds, every card and label is either fully in the shot or out
of it. With `"defaults": "0.5"`, when the camera moves to an element, the
arrows that point at it and the marks around it come along whole. Other arrows and lines may run off the
edge, but their labels stay whole, and so do the labels of charts. While the
camera moves from one shot to the next, things may pass the edge of the frame
for a moment. `camera: false` on an element keeps the camera from moving to it.
Shots stay clear of the captions and of the parts the app covers on Shorts,
TikTok and Reels.

Lay out each scene as one picture on the full frame, the way it should look
at the end, and let the camera find the close-ups:

- Put the next element near the one it follows, so one shot shows both.
- A scene that starts with one thing and grows gets the most camera moves.
  The camera starts close and widens with the picture.
- Keep a box with its label, or an icon with its caption, together as one
  unit. Things far apart get their own shots.
- Lines, arrows and things added inside an element already on screen, like
  a line in a chart, get no close-up of their own. Neither does an icon
  without a label or a box without words, because up close it shows nothing
  new. Give it a label, or use `s.focus` when one should get a close-up.
- When a scene goes on with the same picture, draw the carried elements with
  `at: -1` in the same places. The camera then goes on from where it
  stopped, and the two scenes fade into each other.

The camera measures every element, including what `s.draw` draws, and
follows the `at` and `out` times. It measures each element where it is at
the end of the scene. When something travels across the frame during a
scene, keep that scene's camera still with `s.camera([])`. Anything drawn straight on `s.ctx` counts
as one block that is there for the whole scene, so the camera keeps it whole
and cannot film it on its own. Use `s.draw` for a drawing that appears on a
cue. Highlighted code lines and terminal commands get close-ups of their own
when they are small in the shot. `s.focus` points the camera at any part of
the picture.

`"camera": "still"` in `video.json` turns the camera off for the whole video.
`check` checks the layout as you wrote it. It also judges text at the size the
camera shows it, and warns about text or a shape that a held shot cuts at the
edge, and about a table of texts whose header it leaves out. Stills, sheets and renders show the camera.

The final render adds motion blur to frames where something moves, like a
film camera. Drafts skip it. `"motionBlur": false` turns it off.
