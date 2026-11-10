# Vertical short

A short of 20 to 60 seconds for Shorts, TikTok and Reels. A stranger is
scrolling. In the first second they decide whether to stay, so everything
here serves that second and keeps the picture moving after it.

| Scene | Job |
| --- | --- |
| `hook` | The hook: the subject and a title of 2 to 6 words, on the first frame, and the voice from 0 seconds |
| `why` | The first step, within 3 seconds |
| `turn` | A second hook halfway, like "Here's the good part", then the answer |
| `tip` | The payoff: one thing to remember, held for a second |

## The rules of the mode

- **The first second carries the hook.** The first scene has `{lead=0}`, so
  the voice starts at once. The title and the subject are there at 0
  seconds, never drawing in. The first spoken line names the stakes or the
  question. No greeting and no setup.
- **Bold captions** (`"captions": "bold"`) show two to four words at a time.
  Put `*stars*` on one or two words a sentence for the keyword color.
- **A visual change at least every 2 seconds.** A new picture, a sticker, a
  camera punch or a new scene counts. A background that drifts doesn't.
  `check` gives a hint after 2 seconds without one.
- One promise per video, paid off before the end.
- Short sentences of 6 to 14 words, spoken to one person.
- Text at least 48 pixels, and the subject fills the content area. Words
  stay in `s.safe`. The picture below the captions comes from `s.full`.
- The payoff is the clearest frame of the video.

## Colors

The background and the glow come from `"brand"` in `video.json`:
`brand.background` and `brand.accent` when they are set, and the look's
background and accent otherwise. The hook's keywords and its kicker take
`brand.accent` too, darker where white words need it. So set brand colors
in `video.json`, not in `format.js`. The format starts in the dark
`midnight` look, which suits a feed.

## The helpers in format.js

- `hookFrame(s, title, { icon, color, kicker })` draws the background, the
  hook title and the subject, all at 0 seconds. The title and the kicker stay
  in the content area at the zoom of the scene's `punch()`.
- `beats(s, [{ at, icon, label, color }])` shows one big picture per cue, each
  one replacing the one before. Give each beat its own `[#marker]`, at most 2
  seconds apart. It leaves room above them for a `fact()`.
- `echo(s, icon, { color, at, out })` draws a large, faint copy of the
  subject below the captions, edge to edge in `s.full`. `hookFrame`, `beats`
  and `payoff` call it, so the tall frame is never empty at the bottom. The
  apps cover part of it with their buttons, so nothing there must be read.
- `fact(s, '*20%*', { at })` puts one fact on a tilted sticker. It finds a
  free place near its `x` and `y`, clear of the hook title, the step label
  and the pictures that `hookFrame` and `beats` drew, so call it after
  them, but not of an `s.draw`. `check` warns when a sticker covers a picture or text.
- `punch(s, at)` gives camera keys for a fast zoom, held for a second. Use it
  as `s.camera(punch(s, '#back'))`, first in the scene. Then `fact()` and
  `beats()` keep their words in the content area at that zoom: a sticker moves
  in and a long label gets smaller. A scene can punch more than once: put the
  keys in one call, like `s.camera([...punch(s, '#one'), ...punch(s, '#two')])`,
  at least 1.5 seconds apart.
- `backdrop(s, { glow, pattern })` draws a scene's background.
- `payoff(s, title, lines, { icon, w })` is the closing card, with `icon`
  on it and as its echo. In a tall frame it is as wide as the content area.
  It returns the card's box, for a sticker's `top: card.bottom + 24`.

`explainroo docs short-video` has the whole `s.short` kit.

## Scene changes

`"transition": "push"` in `video.json` pushes the old scene out, so the words
of two scenes never show in one place. `{transition=cut}` on a scene cuts.

## Check before you render

Run `check`, and look at `still <project> hook@0`, the cover. It shows the
title and the subject. Then look at a `sheet` and see the picture change
every few seconds.
