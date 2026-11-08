# What makes the pictures good

- **Show it when it is said.** A picture appears as the voice mentions it.
  Use word cues.
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

## Layouts that work

These four layouts cover many scenes: one big number, a comparison, steps in
order, and one main thing with its parts. Start from the one that fits and
change the words, colors and cues. Each one also works in tall and square
frames.

```js
export default {
  // One big number with a short caption under it.
  number(s) {
    const u = Math.max(s.W, s.H) / 100;
    // The number also has to fit across a narrow, tall frame.
    const n = s.number(1000000, { y: s.cy - u * 2, size: Math.min(u * 10, s.safe.w / 6), at: '#number' });
    s.text('requests a day', { y: n.bottom + u * 3, size: u * 3.6, color: 'muted', at: '#caption' });
  },

  // Two things side by side, or stacked in a tall frame.
  compare(s) {
    const u = Math.max(s.W, s.H) / 100;
    const cells = s.grid(s.portrait ? 1 : 2, s.portrait ? 2 : 1, { gap: u * 4 });
    const sides = [
      { title: 'Callbacks', note: 'one function inside another', color: 'orange', at: '#left' },
      { title: 'async / await', note: 'reads from top to bottom', color: 'green', at: '#right' },
    ];
    sides.forEach(({ title, note, color, at }, i) => {
      const c = cells[i];
      // The note hangs from the card, so a note that wraps grows downward.
      const card = s.box(title, { x: c.x, y: c.y - u * 3, w: c.w * 0.8, size: u * 4, color, at });
      s.text(note, { x: c.x, y: card.bottom + u * 1.2, valign: 'top', size: u * 2.6, color: 'muted', maxWidth: c.w * 0.85, at });
    });
  },

  // Steps in order, left to right, or top to bottom in a tall frame.
  steps(s) {
    const u = Math.max(s.W, s.H) / 100;
    const labels = ['Browser', 'Resolver', 'Address'];
    const xs = s.portrait ? labels.map(() => s.cx) : s.row(labels.length, { width: s.safe.w * 0.72 });
    const ys = s.portrait ? s.col(labels.length) : labels.map(() => s.cy);
    labels.forEach((label, i) => {
      const at = i ? `#step${i + 1}` : 0.3;
      s.box(label, { id: `step${i}`, x: xs[i], y: ys[i], size: u * 3.6, at });
      if (i) s.arrow(`step${i - 1}`, `step${i}`, { at });
    });
  },

  // One main thing with its parts around it. A tall frame has no room
  // beside it, so the parts sit in a row underneath.
  hub(s) {
    const u = Math.max(s.W, s.H) / 100;
    const parts = ['Email', 'Calendar', 'Files'];
    const hubY = s.portrait ? s.cy - s.safe.h * 0.18 : s.cy;
    const spots = s.portrait
      ? s.row(parts.length, { width: s.safe.w * 0.72 }).map((x) => ({ x, y: s.cy + s.safe.h * 0.16 }))
      : [-90, 30, 150].map((d) => ({ x: s.cx + Math.cos((d * Math.PI) / 180) * s.safe.w * 0.34, y: s.cy + Math.sin((d * Math.PI) / 180) * s.safe.h * 0.3 }));
    s.box('Login server', { id: 'hub', x: s.cx, y: hubY, size: u * 4, color: 'accent', at: '#hub' });
    parts.forEach((label, i) => {
      const at = `#spoke${i + 1}`;
      s.box(label, { id: `part${i}`, ...spots[i], size: u * (s.portrait ? 2.4 : 3.2), at });
      s.arrow('hub', `part${i}`, { at });
    });
  },
};
```

Text sizes come from the frame's long side, so they look about the same in
wide and tall frames. A big number also has to fit across a narrow frame.
`explainroo docs scene-api` lists every call these layouts use, with all
its options.

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
edge. Stills, sheets and renders show the camera.

The final render adds motion blur to frames where something moves, like a
film camera. Drafts skip it. `"motionBlur": false` turns it off.
