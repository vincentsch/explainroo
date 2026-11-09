# Narrated explainer

A video of about a minute that explains one idea to someone who has never
heard of it. The voice carries the story, and each scene shows one picture
that grows on the words.

| Scene | Job |
| --- | --- |
| `question` | The question the video answers, on the first frame |
| `molecules` | How it works, in two or three steps the viewer can see |
| `number` | One number that makes it concrete |
| `lakes` | Why it matters in daily life |
| `summary` | Two or three things to remember |

Rename the scenes for your topic, in `script.md` and `scenes.js` alike.

## Writing

- One idea per video, and one idea per scene. Cut what the viewer doesn't
  need for the next step.
- Use only facts you can check. Never make up a number. When you use one,
  keep its source in a note for the user.
- Talk to one person, in short sentences of 8 to 15 words.
- Read `explainroo docs writing` for the script syntax, like `[#markers]`,
  `{shown|spoken}` and `[pause]`.

## The helpers in format.js

- `question(s, text, { icon, at, iconAt, color })` shows the question big,
  with an icon under it. Keep `at: -1`, so the first frame shows it.
- `heading(s, text, { at })` puts a heading at the top, and `body(s)` is the
  free area under it.
- `steps(s, [{ label, icon, color, at }])` draws boxes in order with arrows,
  in a row or, in a tall frame, a column.
- `bigNumber(s, value, { prefix, suffix, caption, at, captionAt })` counts
  up one number with a caption.
- `takeaways(s, title, [{ text, at }])` lists what to remember with check
  marks.

Time each picture to a `[#marker]` in `script.md`, so it shows when the
voice says it. Find icons with `explainroo icons <word>`, and read
`explainroo docs pictures` for more layouts.

## Look

The format starts with the `paper` look, where shapes draw themselves like a
marker on paper. `chalk`, `blueprint` and `editorial` suit it too. Run
`explainroo themes` to see them all.

The icon of `question` and the number of `bigNumber` are in `brand.accent`
from `video.json` when it is set, and in the look's accent otherwise.
`brand.background` is the background with `"defaults": "0.6"`.
