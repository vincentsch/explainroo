# Product demos

A product demo is the kind of video software companies make to show their
app. When the user asks to show the real site or app, and it runs on this
computer or on a site you can open, record it: `explainroo record` clicks
through the real app in a browser and saves the video, and `s.recording`
plays it with a pointer, click rings and zooms on the words of the voice.
Every button in it is a real one. See "Recording the real app".

When the app can't be recorded, rebuild its screens with `s.ui`, in the
app's colors and fonts. A mouse pointer clicks through the screens and
types into the fields, and the camera zooms in on what the voice talks
about. See "Rebuilding the screens with s.ui".
[examples/recording-demo](https://github.com/vincentsch/explainroo/tree/main/examples/recording-demo)
and
[examples/unspar-demo](https://github.com/vincentsch/explainroo/tree/main/examples/unspar-demo)
are complete ones. The examples also come with the package, and
`explainroo doctor` prints their folder. recording-demo comes with its step
file, `recordings/new-invoice.json`, but not with its video, and its README
says how to record it.

## Recording the real app

Write the steps of a recording in `recordings/<name>.json`:

```json
{
  "url": "http://localhost:3000/invoices",
  "viewport": { "width": 1280, "height": 720 },
  "steps": [
    { "do": "click", "text": "Accept cookies", "before": true },
    { "do": "click", "text": "New invoice", "cue": "#new" },
    { "do": "type", "text": "Amount", "value": "2400", "press": "Tab" },
    { "do": "press", "key": "Enter", "cue": "#add" },
    { "do": "zoom", "selector": "form", "cue": "#check" },
    { "do": "click", "text": "Save invoice", "cue": "save" },
    { "do": "zoom" },
    { "do": "scroll", "text": "Total" },
    { "do": "mark", "name": "saved" }
  ],
  "blur": [{ "selector": ".email" }, { "text": "jane@example.com" }]
}
```

To see what a step can use, run this before you write the steps:

```bash
explainroo record videos/<name> --inspect https://example.com --viewport 1280x720
```

It opens the page in the browser `record` uses, records nothing, and lists
every visible element you can click or type into: its words, `aria-label`
and placeholder, a `text` and a `selector` that find only it, and its box.
Copy the text or the selector into the step as it is. Use the viewport of
your script, because the page may lay itself out differently in another
size. `--json` gives the same list as JSON, and `--keep-profile` opens the
page with the kept profile, for a page behind a login. Without the project
folder, `record --inspect <url>` opens the page in `en-US` at 1920 x 1080,
and `--viewport` and `--locale de-DE` change that.

Fields that look like a text box but aren't an `input`, like the math
editor of a graphing calculator, are listed too: elements with
`contenteditable` or `role="textbox"`, and the visible element around a
hidden input, as a "field around a hidden textarea". A click on that element
focuses the input, so its selector works for `click` and `type`. The last
lines name the element that has the focus after the page loads, which is
where a `press` step without an element presses its key.

`--selector ".expression"` says what a selector matches: how many elements,
how many of them are visible, and each visible one with its words and box.
Use it to try a selector before it goes into a step. It goes with `--text`.

A zoom or a scroll often goes to plain content, like a heading, a section of
results or a chart. `--all` adds the visible headings, sections and images to
the list, each with its words and a selector. `--text "Solutions"` lists only
the elements that hold those words: the smallest one, and then the larger
ones around it, like the section the heading starts. It waits up to 15
seconds for the words, for a page that shows its results a moment after it
opens. Pick the one whose box holds what the voice talks about.

Then run `explainroo record videos/<name> <name>`. It runs the steps in a
browser of its own, which asks sites for the project's `language`: `en-US`
for `en`, `es-ES`, `fr-FR`, `it-IT`, `pt-BR`, `hi-IN`, `ja-JP`, `zh-CN` or
`de-DE`. `"locale": "en-GB"` in the script sets another one. The first line
of `record` and the step log name it. It saves `assets/recordings/<name>.webm` and its step
log, `assets/recordings/<name>.log.json`. The video shows only the page,
with no browser bars or pop-ups. `record` needs Playwright's own ffmpeg, and
the first recording downloads it and says so. `explainroo doctor --fetch
--record` gets it ahead of time.

`record` prints one line per step with what it found, like
`step 7 (zoom "section.results", nth 2): <section> "Solutions: x = 1 ..."`,
and saves a small picture of each step's element in
`build/record/<name>/step-<n>.png`. The step log keeps the element's words
and a selector that matches only it, under `match`. Open the pictures before
you write the scene, because a step that found the wrong element still
records.

- A step finds its element by `text` or by a CSS `selector`. `text` is the
  words the element shows, and its `aria-label`, label or placeholder count
  too. A long placeholder also matches its first part, up to a comma or a
  full stop. An editor like CodeMirror shows its placeholder as an element
  inside the field, and that counts as the field's placeholder: the step
  clicks or types into the field. `nth: 2` takes the second match from the
  top. `nth` counts visible elements only. When a selector also matches
  hidden ones, `record` says how many it skipped.
- `open` goes to `url`, an address or a path. `click`, `hover` and `type`
  move the pointer to the element. `type` clicks the field and types
  `value` at 14 characters a second, or at `cps`, and `press` presses a key
  after it. `press` presses `key`, like `"Enter"`, or a combination like
  `"Control+A"`, where the focus is, or on its element when it has `text` or
  a `selector`. `scroll` takes `y` in pixels
  or the element to scroll to the middle of the window. `wait` takes
  `seconds` or the element to wait for. `zoom` moves in on the element, and
  without one back out. `mark` names a moment with `name`.
- Only `scroll` steps move the page. A `zoom` or `wait` on an element
  outside the window stops and asks for a `scroll` step first. A click,
  hover or type on an element that something covers, like a bar that stays
  at the bottom of the window, scrolls it to the middle first. When it is
  still covered there, `record` stops and names what covers it.
- A zoom fits its element into about 70% of the frame, from 1.4 to 2.5
  times closer. `"scale": 2` on a zoom step sets how close it goes. It
  holds the middle of the element in view. `"align": "left"` holds its left
  edge instead, for a wide row whose words start at the left, and `right`,
  `top` and `bottom` work the same way. A corner, like `top-left`, holds
  two edges, for a tall list whose first rows are at its top. When the
  element is larger than what the zoom shows, `record` says so for that
  step. When almost all of what a zoom shows is one colour, `record` warns
  with the step and its picture, because the zoom may show empty space.
- A pointer move takes about 0.6 seconds, and a scroll of one window height
  about 1 second. `"pace": 1.5` in the script makes moves, scrolls and
  typing faster, from 0.5 to 2. `"duration": 1.2` on a step sets the seconds
  of its own move or scroll, and `"cps": 20` on a `type` step the characters
  it types a second, which the pace speeds up too.
- `cue` is a spoken word or a `[#marker]` of the scene that plays it.
  Several steps may share one cue, like a `zoom` and the `type` after it.
  They run in order, and the first lands on the cue. A cue only changes
  playback, so a new cue needs no new recording. A change to the steps in
  `recordings/<name>.json` other than `cue` does, and so does a change to
  its `url`, `viewport`, `locale`, `pace` or `blur`. `check` says so.
- Steps with `"before": true` run before the video starts, like closing a
  cookie banner or logging in. A step before the video that finds nothing
  is skipped, in every run, with or without `--keep-profile`, so it can
  close a pop-up that shows only sometimes. `record` names each step it
  skipped. Every run starts with an empty browser profile, so the site has
  no cookies or stored data from an earlier run. For a site that needs a
  login, `--keep-profile` keeps the profile for the next run.
- `blur` blurs elements by CSS selector or exact text on every page, before
  anything is recorded. Use it for real email addresses and keys.
- `viewport` is 1920 x 1080 by default, which is too large for most
  videos. Pick it from the size the page plays at: the content area, less
  a small margin and the bar of the browser frame that `s.recording` draws.
  The viewport has that shape and is about 1.8 times smaller, so the page's
  16 px text plays at about 29 px. These are the numbers for a recording
  that fills the content area in a `browser` frame:

  | Size | Content area | Played size | Viewport |
  | --- | --- | --- | --- |
  | 16:9 (`youtube`) | 1768 x 928 | 1697 x 829 | 942 x 460 |
  | 4:5 (`instagram`, `linkedin`) | 928 x 977 | 891 x 872 | 494 x 484 |
  | `shorts` with bold captions | 885 x 732 | 848 x 654 | 472 x 364 |
  | `tiktok`, its package with bold captions | 745 x 863 | 715 x 769 | 398 x 428 |
  | `reels` with bold captions | 896 x 751 | 860 x 669 | 478 x 372 |

  A page this narrow may lay itself out as on a phone, which often reads
  best in a tall video. An app with a side panel or a canvas, like a
  graphing calculator or a design tool, needs room: record it bigger, at
  1280 wide or more, and zoom on the parts the narration names. `check`
  warns when a recording's 16 px text would play under 24 px. It names the
  content area, the size the page plays at, and a viewport that fits. A
  zoom makes the text larger only while it holds. When every `type` step
  and every step with a `cue` on an element plays inside a zoom, the
  warning becomes a hint that says where the whole page plays small. A
  recording that plays at under 60% of its size with no zoom step gets its
  own warning, which names the zoom step to add.

The step log has the time of each step in seconds of the video, and the
`box` of its element in pixels of the video: `x` and `y` are its middle,
and `w` and `h` its width and height.

When a step can't find its element, `record` stops and names the step. It
lists close words from the page and saves a picture of the page in
`build/record/`. Fix the script from what the page shows or what
`--inspect` lists, and never guess a button. Then play it with `s.recording`, which
`explainroo docs scene-api recordings` explains. `from` skips the first
seconds of the video, and `to` stops it, so one recording can play in several
scenes. Write the narration around what the video shows, and look at stills.

You can also show any screen recording with `s.clip` in a `browser` frame.
One long file is enough for every scene, so there is no need to cut it into
pieces first. This plays seconds 31 to 38.5 of it:

```js
s.clip('assets/take.mp4', { from: 31, to: 38.5, crop: [0, 120, 1280, 720], speed: 'fit' });
```

It shows only the part of the screen in `crop`, in the file's own pixels,
and `speed: 'fit'` fits those seconds into the scene.

## Capture the live site

```bash
explainroo capture videos/<name> https://example.com --mobile
```

`capture` opens the page in a fresh browser, without cookies or logins, and
saves what a demo needs in `assets/capture/<hostname>/`:

- `page.png` (the first screen) and `full.png` (the whole page, up to 8000
  pixels tall), at twice the pixel density, so they stay sharp when the
  camera zooms in. `--mobile` adds `mobile.png` and `mobile-full.png`.
- `capture.json` with the colors, fonts, logo candidates and the page's
  wording: headings, navigation, buttons and form labels. Copy the wording
  exactly. `text.body` has the readable text of the whole page in page
  order, up to 30 KB, so you can check claims and example values against it.
  `images` lists the page's pictures with their address, alt text and size,
  and says whether each one is on the first screen.
- Up to three logo files.
- The font files the page loaded, in the weights it uses, in `fonts/`. Their
  `fonts.json` gives each file's family, weight, style and the address it
  came from. Fonts that come with explainroo are not copied.

It prints a `brand` and `fonts` block to paste into `video.json`, and one line
for each font it saved. The accent is the color of the page's buttons, or,
when they show none, the page's `theme-color` tag, and then `capture` says
so. Check the block against the screenshots. A font on a
website isn't always free to use in a video, so check the license of each
saved font before you publish, and copy the license file next to it. For a
font it could not save, get the files yourself. A font that comes with the
visitor's computer, like Segoe UI or San Francisco, has no file on the page.
`capture` names it in one line and leaves it out of the block, because it
may not be used in a video without a license. Cookie banners and chat
widgets can appear in the screenshots, as they do for any visitor. Use a
screenshot, or a part of one, without them. Capturing the same site again
replaces these files.

To keep several pages of one site, give each page a name:

```bash
explainroo capture videos/<name> https://example.com/pricing --name pricing
```

This saves the same files in `assets/capture/example.com/pricing/`, and
`capture.json`, the logo path and the block for `video.json` point there.
Capturing again with the same name replaces only that folder. A capture
without a name replaces its own files and keeps the named folders. A name
uses letters, digits and hyphens and starts with a letter or a digit. It
can't be `fonts`, because a capture without a name keeps its fonts there.

## Keep it true

A demo is advertising, so everything in it has to be right.

- Take the wording from the app itself: its templates and language files
  (for example `lang/en/*.php`, `locales/`, or the components). Copy labels,
  buttons and status names exactly.
- Show only features that exist and that customers can use. Leave out admin
  screens, debug views and plans that are not built yet.
- Example data must look like example data: `example.com`, a made up project,
  a made up article title. Never invent customers, numbers or results.
- Claims in the narration come from the product's live website. Show prices
  only if the website shows them.
- Ask the user if the website and the app say different things.

## Set up the brand

Set up the brand in `video.json`. Use the `studio` look for a product demo.
When the video starts from a format, keep the format's own look: the product
formats use `studio`, and `vertical-short` uses `midnight`, a dark look made
for feeds, also for a product short.

```json
{
  "theme": "studio",
  "brand": {
    "accent": "#245cff",
    "background": "#f8f6f1",
    "font": "Figtree",
    "headline": "Instrument Serif",
    "logo": "assets/logo.svg"
  },
  "fonts": [
    { "family": "Figtree", "src": "assets/fonts/Figtree-600.woff2", "weight": 600 }
  ]
}
```

- `accent` is the main button color. Find it in the app's Tailwind config or
  CSS. `background` is the color behind the screens, `ink` the color of text
  drawn right on it. With `"defaults": "0.6"`, `accent` also colors the
  `*starred*` words of `s.title` and `s.text`, and `background` is the
  background of every scene. An accent that is hard to read there keeps its
  hue and gets lighter or darker.
- With captions on, `accent` also colors the word being spoken. A look file
  that sets `caption` colors decides instead. When the accent is hard to read
  on the caption background (a contrast below 3:1), with `"defaults": "0.5"`
  the captions keep its hue and make it lighter on a dark background, or
  darker on a light one, until it reads at 4.5:1. Without it they use the
  look's highlight. `check` names the color in a hint. Bold captions keep
  their own colors.
- `font` is the app's font. Inter is built in. Other fonts go in
  `assets/fonts/` and in `fonts`, with one entry per weight. The files can be
  `.woff2`, `.woff`, `.ttf` or `.otf`. A variable font takes
  `"weight": "100 900"`, and an italic file takes `"style": "italic"`. Copy
  the font's license file next to it.
- `headline` is the font for big headlines. Instrument Serif is built in.
  `capture` suggests the font of the site's first heading. If the brand has
  no serif, set `headline` to the brand's own font, like `"headline": "Inter"`,
  and pass `{ weight: 700, italic: false }` to `u.headline()`. The options
  alone keep Instrument Serif.
- `logo` is the product's logo from the app or website, best as SVG.

## Rebuilding the screens with s.ui

Build a scene in this order: background, camera, headline, screens, cursor
last so it stays on top.

```js
hook(s) {
  const u = s.ui;
  u.backdrop();
  u.floaters();
  s.camera([{ at: '#site', x: 900, y: 600, zoom: 1.3 }]);
  u.headline('Tell it what to *write about*', s.W / 2, 178, { size: 84, at: 0.15 });
  u.panel(410, 270, 1100, 600, { at: 0.3 }, (x, y, w, h) => {
    u.input(x + 56, y + 296, 560, 62, { label: 'Website URL', value: u.typed('https://example.com', '#site', 24), focus: 1, caret: true });
    u.button('Get ideas', x + 760, y + 516, 280, 60, { press: u.press('#go') });
  });
  u.cursor([
    { at: 0.5, x: 1500, y: 900 },
    { at: s.time('#site') - 0.7, x: 740, y: 596 },
    { at: '#site', click: true },
  ]);
}
```

Draw the headline after `s.camera()`, or the zoomed screens slide under it.
When the camera zooms in, either keep the headline fully in view (zoom up to
about 1.1) or zoom far enough that it leaves the frame (about 1.3 and more).
In between it gets cut in half.

Time every click to a `[#marker]` in the script, so it happens when the voice
says it. A cursor move starts at its `at` and arrives `dur` seconds later
(0.7 by default), so start the move a little more than `dur` before the
click. The first 0.7 seconds of a scene are covered by the transition from
the scene before, so put no clicks there.

The watermark sits in the bottom right corner. When the camera zooms in, it
can cover what is there, so keep important text out of that corner.

Use the product's name as plain text in the first frame. Many apps show the
first frame as the cover.

## The s.ui reference

Positions are in the frame (1920 wide for 16:9). Times take seconds, spoken
words or `"#markers"`, like everywhere else.

| Call | What it draws |
|---|---|
| `u.backdrop(color?)`, `u.floaters({ alpha, tint })` | the brand background, and faint cards drifting around the edges (`tint: 'white'` on a colored background) |
| `u.panel(x, y, w, h, { at, out, from, rise, sfx, fill, border, lift }, fn)` | a card that pops in at `at`; `fn(x, y, w, h)` draws inside it |
| `u.card(x, y, w, h, o)` | a card without an entrance |
| `u.browser(x, y, w, h, { url, at }, fn)` | a panel with a browser bar; `fn` gets the page area |
| `u.modal(x, y, w, h, { at, out }, fn)`, `u.over(fn)` | a dialog over a dimmed frame, and a layer for your own menus or popups; `check` does not report text in one layer as overlapping text in another |
| `u.toast(text, { at, out, icon, tone, size })` | a message that slides up, with a chime |
| `u.headline(text, x, y, { size, at, out, align, weight, italic, color, accent, tracking, lineHeight })` | big text that blurs in word by word; `*stars*` mark words in the `accent` color, and with `"defaults": "0.6"` `\n` starts a new line below `y` |
| `u.text(text, x, y, { size, weight, color, accent, align, base, lh, font, italic, tracking, alpha, maxW, check })`, `u.para(text, x, y, maxW, o)`, `u.eyebrow(text, x, y)` | text, wrapped text, and a small uppercase label; `font` is `'ui'`, `'headline'` or a family; `check: false` hides text from `check`; `u.measure(text, size, weight)` gives the width. `\n` starts a new line in `u.para`, and with `"defaults": "0.6"` in all three, where `*stars*` also mark words in the `accent` color. `check` warns about stars or a `\n` that show as written |
| `u.button(label, x, y, w, h, { variant, press, icon, loading, color, caps })` | `primary`, `secondary` or `ghost` |
| `u.input(x, y, w, h, { label, value, placeholder, focus, caret, icon })`, `u.textarea(x, y, w, h, o)` | a text field, and a taller one where the text wraps |
| `u.select(x, y, w, h, { label, value, open, options, hover, selected })` | a dropdown; returns the y of each option row |
| `u.toggle(x, y, on)`, `u.checkbox(x, y, on)`, `u.radio(x, y, on)` | `on` goes from 0 to 1, so it can animate |
| `u.chip(label, x, y, { selected, size })`, `u.chipWidth(label, o, selected)` | option chips; a selected chip grows by its check mark, so leave room |
| `u.pill(label, x, y, tone, { align, dot, pulse, size })` | a status badge: `gray`, `blue`, `yellow`, `green`, `red`, `purple` or `accent` |
| `u.spinner(x, y, r)`, `u.progress(x, y, w, p)`, `u.avatar(x, y, r, initials, { image })`, `u.icon(name, x, y, size, color)`, `u.lines(x, y, w, n)`, `u.logo(x, y, w)` | small parts; `lines` draws grey bars in place of body text |
| `u.pop(at, cx, cy, fn, { sfx })` | pops anything in around a point |
| `u.wipe(at, { color })` | the accent color spreads out until it fills the frame |
| `u.cursor(keys, { out })` | the mouse; a key `{ at, x, y, dur, arc }` moves it (`arc` bends the path, 0 is straight), `{ at, click: true }` clicks with a sound |
| `u.press(at)`, `u.typed(text, at, cps, { gain, sfx })`, `u.stream(text, at, wps)`, `u.count(to, at, dur)` | a button press (0 to 1 and back), text typed so far with typing sounds, text appearing word by word like an AI reply, a number counting up |
| `u.colors` | `accent`, `accentDark`, `accentTint`, `background`, `ink`, `text`, `soft`, `muted`, `faint`, `line`, `field`, `surface`, `panel`; `brand.colors` in `video.json` replaces the grays, for example `{ "text": "#141413", "line": "#e8e6dc" }` for a warm brand |

`lift` sets the shadow under a panel or card. It is a multiplier from 0 to
2: 0 is no shadow, 1 the normal shadow and 2 twice the normal shadow. Some
parts of the kit use their own default, like 1.4 for a dialog. A larger
`lift` spreads the shadow across much of the frame, so `check` warns about a
`lift` above 2.

`check` sees the text of `s.ui` too. It reports text that runs off the frame
(not while the camera zooms in), text that is too small and text that
overlaps. It measures the words of pills, chips and toasts like any text,
so they must read on a phone, where the rest of an app screen may be small.
With `"defaults": "0.6"` they are 40 pixels or more in a tall frame, and
`size` sets them. A dropdown or dialog may cover what is under it. Look at stills at
the moments the camera is zoomed in, and check the cursor does not hide the
word it points at.

Panels and headlines from `s.ui` make no sound unless you pass `sfx`.
`check` does not see clipping: text you hide by clipping still counts, so
do not draw text that should not show. Try a product name with its plain
spelling first; only respell it when the speech check mishears it.

Many sounds under the voice make it hard to follow, and `verify` then
understands less of it. Keep long typing quiet (`u.typed(text, at, cps, {
gain: 0.25 })`) and give each moment one sound.

A blur filter on every frame makes rendering slow. The kit blurs things once
and reuses them. Do the same if you add your own blur.
