# Your own footage

A footage project makes a finished video from a recording of the user
talking: to the camera, in a webinar, in an interview, or over a screen
recording. The recording is the narration and the picture. You choose the
parts to keep and their order, and put graphics on the speaker's words:
names, numbers, steps and diagrams. Captions, music, the cover and `verify`
work as in any project. To only cut words out of a recording and get a video
file back, `explainroo docs cut` is quicker.

## Start the project

```bash
explainroo init videos/<name> --footage talk.mp4 --title "How we ship"
```

`init` takes an MP4, MOV, WebM, M4V or MKV file with sound. It makes a
working copy in `assets/footage.mov`, at 24, 25, 30, 50 or 60 frames a
second, whichever is nearest, and at most 1920 pixels on its long side. The
original isn't changed or needed again. Then the speech model listens to it,
on this computer, and `init` writes `script.md` with a scene for each span of
speech, with the words that were said.

- `--size` is the size of the video, not of the recording. `--size tiktok`
  makes a tall video from a wide recording (see "Tall videos" below).
- `--language es` for a recording in another language. A footage project
  has one language, the recording's.
- Footage projects start in the `midnight` look, whose dark pages sit well
  next to a recording. `--theme` picks another.
- When `init` says the speech model heard no words where there is sound,
  listen there. It may be music, noise, or speech it missed.

`video.json` has `"footage"`, the recording's `"fps"`, `"transition": "cut"`
and `"camera": "still"`, so drawings stay where you put them. Music plays
under the voice, and captions are on for tall and square sizes. When the
recording has music of its own, set `"music": false`, or the two play at
once. A footage project takes no `voice`, `speed`, `pace`, `languages` or
`targetSeconds`: the recording is the voice and sets the length. The web
player (`export`) doesn't take footage projects yet.

Look at the recording before you plan: `explainroo sheet videos/<name>`
shows a frame every few seconds. An edited recording may already have a name
tag, titles or captions in the picture. Don't add a second name tag, and
keep punch-ins and your graphics from cutting into what is there.

## Edit in script.md

```markdown
## s03 {from=24.000 to=34.233}
My brother and I were explorers at a very young age.
> pause of 2.1 s after this scene: to cut it, end this scene at 32.700 and start the next at 34.533

## s04 {from=34.233 to=44.533}
Spent a lot of time outside, a lot of time at the Jersey Shore.
```

Each scene is a span of the recording, and `from` and `to` are its seconds.
The video plays the scenes in the order of `script.md`, so you edit there:

- Delete a scene to cut it. Move it to change the order.
- Move `from` later to cut a slow start, and `to` earlier to cut what trails.
- To cut a false start or a sentence in the middle, split the scene in two:
  the first ends before it, the second starts after it.
- Scenes meet in the middle of a pause. A note like the one above says how
  long a pause of 1.5 seconds or more is, and the times that cut it.
- A scene's text is what its span says, and the captions show it. When you
  trim or split a span, move its words with it, and delete the words you cut.
- Fix a misheard word in the text, so the captions say it right. The timing
  stays the recording's. Never add words that weren't said.

`explainroo words videos/<name>` lists each word with two times: seconds
into the scene, for cues, and seconds into the recording, for `from` and
`to`. Cut in the gap between two words. When a span starts or ends inside a
word, `check` warns and gives the times to use. The speech model sometimes
starts the first word after music or a pause too early; such a word gets at
most the time its letters take, and its time is marked `~` as estimated, so
leave a little room before it.

After a change to `script.md`, run `explainroo voice videos/<name>` again.
Nothing is spoken, so it takes seconds, and it prints each span and the
total length. Where one scene ends at the `from` of the next, the sound runs
on without a seam. At a real cut it gets a short fade, and the picture cuts.

A good edit:

- **Starts strong.** Open on the sentence that says what the video is about,
  and cut greetings, "so, um, today" and false starts.
- **Keeps it moving.** Cut long pauses and repeated sentences. A user who
  asks for a length gets it from the spans you keep.
- **Ends on the point.** Cut "that's it, bye" and the outro unless the user
  wants them.

## Graphics on the words

A scene without a function in `scenes.js` shows its span over the whole
frame. A scene with one draws the recording with `s.footage()` first, then
what goes on top, each on its own cue, like any other scene.

`s.footage(options)` takes:

- `zoom` (1 to 8) and `focus` (`[x, y]` from 0 to 1, the point to keep in
  view): a punch-in, like `{ zoom: 1.3, focus: [0.5, 0.35] }` for a face in
  the upper middle. A punch-in on the scene after a cut hides the jump.
- `fit`: `'cover'` (the default) fills the frame or box and crops,
  `'contain'` shows all of the recording.
- `x`, `y`, `w`, `h`: the recording in a box, like beside a chart. It then
  takes `radius`, `frame` and `shadow` like a picture.
- `at` and `out`: when it shows and when it leaves, on a word or a time.
  `out` makes a cutaway, a drawing over the whole frame while the voice goes
  on.
- `blur` (pixels, 0 to 100) and `opacity`: a soft copy of the recording, as
  a background behind a sharp one (see "Tall videos").

Text right on the recording is hard to read where the picture is busy or
light, so `check` warns about it. Give it a card with `bg: true`, or a color
like `bg: '#14161c'`, and keep it off the face. `check` also hints when the
recording shows at more than twice its size and looks soft.

The recipes below size text from `u`, a hundredth of the short side of
`s.safe`, as the starter `scenes.js` does.

### A name tag

The speaker's name on the word where they say it, or on their first scene:

```js
s09(s) {
  s.footage();
  const { x, bottom, w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  const name = s.text('Ana Ruiz', { x, y: bottom - 20 * u, align: 'left', valign: 'top', size: 6.5 * u, weight: 700, color: '#ffffff', bg: '#14161c', radius: 0, padding: 2.2 * u, at: 'Ana', enter: 'slide-right' });
  s.text('FLIGHT ENGINEER', { x, y: name.bottom, align: 'left', valign: 'top', size: 4.2 * u, weight: 700, tracking: 0.14, color: '#0b0d12', bg: 'accent', radius: 0, padding: 1.4 * u, at: 'Ana', enter: 'slide-right', dur: 0.6 });
},
```

### A number

A number the speaker says, big, in a corner away from the face:

```js
s05(s) {
  s.footage();
  const { right, top, w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  s.text('800 ft', { x: right - 28 * u, y: top + 12 * u, size: 14 * u, weight: 800, bg: true, at: '800-foot' });
},
```

### A punch-in with a headline

```js
s02(s) {
  s.footage({ zoom: 1.3, focus: [0.5, 0.35] });
  const { x, top, w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  s.text('A bunch of *little steps*', { x: x + w * 0.04, y: top + 6 * u, align: 'left', valign: 'top', size: 7 * u, bg: true, at: 'bunch', out: 'build' });
},
```

### A cutaway

When the speaker walks through steps, show them over the whole frame. The
recording leaves on the first step, and the voice goes on:

```js
s08(s) {
  s.footage({ out: 'flight' });
  const { w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  s.text('From the sea to space', { y: s.safe.top + 10 * u, size: 7 * u, font: 'display', at: 'flight' });
  const steps = [['Flight school', 'school'], ['Jets', 'plane'], ['Test pilot', 'gauge'], ['Astronaut', 'rocket']];
  const cues = ['flight', 'jets', 'test', 'astronaut'];
  const xs = s.row(steps.length);
  steps.forEach(([label, icon], i) => s.box(label, { id: `b${i}`, x: xs[i], y: s.cy + 4 * u, icon, size: 4 * u, iconSize: 9 * u, minW: w / 5, minH: 26 * u, at: cues[i] }));
  for (let i = 1; i < steps.length; i++) s.arrow(`b${i - 1}`, `b${i}`, { at: cues[i] });
},
```

To bring the speaker back in the same scene, draw a second
`s.footage({ at: 'word' })` after the drawings, and give the drawings
`out` on that word.

### The speaker beside a chart

```js
s06(s) {
  const { x, y, w, h } = s.safe;
  const u = Math.min(w, h) / 100;
  s.footage({ x: x + w * 0.25, y: s.cy, w: w * 0.48, h: w * 0.48 * 9 / 16, radius: 2 * u });
  s.bars([{ label: '2015', value: 340, at: 'year' }, { label: 'Record', value: 520, at: 'record' }], { x: x + w * 0.76, y: s.cy, w: w * 0.4, h: h * 0.6 });
},
```

## Tall videos

`init --size tiktok` (or `shorts`, `reels`, `vertical`) makes a tall video
from a wide recording. `s.footage()` then fills the frame and crops the
sides, so set `focus` to where the speaker is, like `focus: [0.62, 0.4]` for
a face right of the middle. The crop shows the recording larger, so start
from a sharp one: 1080p shows at 1.8 times its size in a 1080x1920 frame,
and 720p at 2.7, which looks soft. A scene without a function keeps the middle, so
give a scene with the speaker off the middle a function with its `focus`.
Captions are on, in the band at the bottom, so put graphics in the upper
part of `s.safe`, above the face, or make a cutaway.

When the speaker moves around the frame, or the recording isn't sharp enough
to crop, show all of it across the width, with a soft copy behind it and a
headline above:

```js
const wide = (headline) => (s) => {
  const { x, w, h, top, bottom } = s.safe;
  const u = Math.min(w, h) / 100;
  s.footage({ blur: 40, opacity: 0.45 });
  const tall = (s.W * 9) / 16;
  const box = s.footage({ x: s.W / 2, y: bottom - tall / 2, w: s.W, h: tall });
  if (headline) s.text(headline, { x: x + w / 2, y: (top + box.top) / 2, size: 6.5 * u, weight: 800, maxWidth: w, at: -1 });
};

export default {
  s01: wide('From this kid to *astronaut*'),
  s02: wide('A bunch of *little steps*'),
};
```

The recording sits right above the captions, and the headline clear of the
watermark. `explainroo docs
short-video` has the rest of a short.

## Check and render

`check`, `still`, `sheet`, `render` and `verify` work as in any project.
When `verify` finds black frames at the start, the recording fades in from
black: move the `from` of the first scene later.
`sheet` asks its questions for footage: a strong opening, graphics where the
speaker names something, a picture that changes every few seconds, text a
phone can read, and an ending on the point. Rendering reads the recording in
pieces as it needs them, so a long recording renders like a short one.
