# Product launch

A launch video of about a minute for a new product or a big new version. It
has five scenes, and each one has a job.

| Scene | Job |
| --- | --- |
| `hook` | The product's name and its promise in one line, on the first frame |
| `problem` | The pain the product takes away, in words the buyer uses |
| `demo` | The product at work: one task from start to result |
| `features` | Three features, each with a one-line benefit |
| `outro` | The name again, what to do next and the address |

## Writing

- Get the facts from the user or the product's site. Never make up a feature,
  a number or a price. When you don't know one, ask.
- Say the name in the first sentence. Keep each sentence under 15 words.
- The demo shows one real task. Rebuild the real screen with `s.ui`, or show a
  screenshot with `s.image`. Run `explainroo capture <project> <url>` to get
  the site's wording, colors, fonts and logo, and read
  `explainroo docs product-demos`.
- End with one action, like "Try it for free at example.com". Say the address
  with `{example.com|example dot com}`.

## The helpers in format.js

- `stage(s, headline, { camera })` draws the background, the camera and a
  headline at the top. Put `*stars*` around the words that get the accent.
- `body(s)` is the free area under the headline.
- `nameCard(s, name, promise, { at, promiseAt, icon })` shows the name big
  in the middle, with an icon in a tile above it, or without an icon a small
  "New" label, in the video's language unless `eyebrow` says something else.
  Keep `at: -1`, so the first frame shows it.
- `appWindow(s, { url, at }, (x, y, w, h) => { ... })` draws a browser window
  in the free area. Draw the page inside it with `s.ui`.
- `featureCards(s, [{ icon, title, text, at }])` shows cards one by one.
  Three cards fit best. Find icons with `explainroo icons <word>`.
- `callToAction(s, { name, action, url, at, urlAt })` is the last frame. Its
  button says "Try it for free" in the video's language unless `action` says
  something else.

Time each card, click and list to a `[#marker]` in `script.md`, so it shows
when the voice says it.

## Look and brand

The format starts with the `studio` look. Put the product's colors, fonts and
logo in `"brand"` in `video.json`, from what `capture` found. Keep the
product's real name and address, and leave out logos of other companies.
