# Motion short

A piece of 10 to 30 seconds without narration, cut to the beat of the music:
a logo reveal, a product teaser, a countdown or a loop. The music carries it,
so every move lands on a beat and every cut on a bar line.

| Scene | Job |
| --- | --- |
| `open` | Something moves from the first frame, on the beat |
| `idea` | The one thing the piece says, in a few words, one per beat |
| `reveal` | The hit: the logo or the product lands on the cut |
| `end` | The name and what to do, held to the closing hit of the music |

## The rules of the mode

- **Scenes last bars, not seconds.** `{bars=2}` in the script. Two bars is
  about 4 seconds at the built-in music's tempo. The whole piece is 4 to 8
  scenes.
- **Time everything from the beats.** `s.beat(n)` and `s.bar(n)` give the
  scene time of a beat or a bar line in the scene. Never hard-code seconds,
  so the piece stays on the beat when the tempo changes.
- **One big moment.** A `rise` in the bar before the reveal and an `impact`
  on its first beat. More than one hit and none of them feels big.
- **Few words, large.** At most four words on screen at once, at least
  `unit(s) * 10` tall. The words are the message, so they get the accent
  color for the one that matters.
- **Hard cuts.** `"transition": "cut"` in `video.json`, so no fade blurs
  a cut or the hit.
- **Keep it alive.** Something small moves on the beat in every scene, like
  a ripple or a pulse, also while a picture holds. The name at the end gets
  a line that draws under it, so it can be read while the music finishes.

`"defaults": "0.7"` starts the built-in music in its full groove on the first
beat and puts its closing hit on the bar line where the last scene ends. With
a music file, give `"bpm"` and `"offset"` in its `"music"` block.

## The helpers in format.js

- `unit(s)` is a hundredth of the short side of `s.safe`, for sizes.
- `beatPulse(s, beats, amount)` gives a scale that kicks up on each of the
  first `beats` beats of the scene. Multiply a shape's size by it.
- `beatWords(s, words, { from, y, size, color, accent })` lands the words one
  per beat from beat `from`, in the display font, centered. `accent` lists
  the words in the accent color by their place, like `[0]`.
- `sparks(s, x, y, at, { count, reach, colors })` throws sparks out from a
  point on a hit and fades them within a second.

`explainroo docs motion` has `s.keys`, `s.along`, `s.three` and the rules for
motion that looks designed. For a reveal of the user's own logo, see the
`logo-reveal` example on GitHub.
