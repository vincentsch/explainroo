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
- **Bold captions** (`"captions": "bold"`) show two to four words at a time
  in the safe area. Put `*stars*` on one or two words a sentence for the
  keyword color.
- **A visual change at least every 2 seconds.** A new picture, a sticker, a
  camera punch or a new scene counts. A background that drifts doesn't.
  `check` gives a hint when a short goes longer than 2 seconds without a
  change.
- One promise per video, paid off before the end.
- Short sentences of 6 to 14 words, spoken to one person.
- Text at least 48 pixels, and the subject fills the content area.
- The payoff is the clearest frame of the video.

## The helpers in format.js

- `hookFrame(s, title, { icon, color, kicker })` draws the background, the
  hook title and the subject, all at 0 seconds.
- `beats(s, [{ at, icon, label, color }])` shows one big picture per cue, each
  one replacing the one before. Give each beat its own `[#marker]`, at most 2
  seconds apart.
- `fact(s, '*20*%', { at })` puts one fact on a tilted sticker.
- `punch(s, at)` gives camera keys for a fast zoom. Use it as
  `s.camera(punch(s, '#back'))`, first in the scene.
- `backdrop(s, { glow, pattern })` draws the background of a scene.
- `payoff(s, title, lines)` is the closing card.

`explainroo docs short-video` has the whole `s.short` kit, and `s.safe` keeps
text out of the apps' buttons.

## Check before you render

Run `check`, and look at `still <project> hook@0`, the cover. It shows the
title and the subject. Then look at a `sheet` and see the picture change
every few seconds.
