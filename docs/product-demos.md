# Product demos

A product demo is the kind of video software companies make to show their
app. You rebuild the app's screens with `s.ui`, in the app's colors and fonts.
The table at the end lists what it draws. A mouse pointer clicks through the
screens and types into the fields, and the camera zooms in on what the voice
talks about.
[examples/unspar-demo](https://github.com/vincentsch/explainroo/tree/main/examples/unspar-demo)
is a complete one.

**Capture the live site first.**

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
  exactly.
- Up to three logo files, and the font files that come from Google Fonts, in
  the weights the page uses.

It prints a `brand` and `fonts` block to paste into `video.json`. Check it
against the screenshots. Fonts built into explainroo need no files. For other
fonts, get the files, check the license and copy the license file next to
them. Cookie banners and chat widgets can appear in the screenshots, as they
do for any visitor. Use a screenshot, or a part of one, without them.
Capturing the same site again replaces its folder.

You can also show a real screen recording with `s.clip` in a `browser`
frame. Use `s.camera` to zoom in on the detail the voice mentions.

**Keep it true.** A demo is advertising, so everything in it has to be right.

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

**Set up the brand** in `video.json`. Use the `clean` look.

```json
{
  "theme": "clean",
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
  drawn right on it.
- `font` is the app's font. Inter is built in. Other fonts go in
  `assets/fonts/` and in `fonts`, with one entry per weight. The files can be
  `.woff2`, `.woff`, `.ttf` or `.otf`. A variable font takes
  `"weight": "100 900"`, and an italic file takes `"style": "italic"`. Copy
  the font's license file next to it.
- `headline` is the font for big headlines. Instrument Serif is built in. If
  the brand has no serif, use its own font and pass `{ weight: 700,
  italic: false }` to `u.headline()`.
- `logo` is the product's logo from the app or website, best as SVG.

**Build a scene** in this order: background, camera, headline, screens,
cursor last so it stays on top.

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

**`s.ui` reference.** Positions are in the frame (1920 wide for 16:9). Times
take seconds, spoken words or `"#markers"`, like everywhere else.

| Call | What it draws |
|---|---|
| `u.backdrop(color?)`, `u.floaters({ alpha, tint })` | the brand background, and faint cards drifting around the edges (`tint: 'white'` on a colored background) |
| `u.panel(x, y, w, h, { at, out, from, rise, sfx, fill, border, lift }, fn)` | a card that pops in at `at`; `fn(x, y, w, h)` draws inside it |
| `u.card(x, y, w, h, o)` | a card without an entrance |
| `u.browser(x, y, w, h, { url, at }, fn)` | a panel with a browser bar; `fn` gets the page area |
| `u.modal(x, y, w, h, { at, out }, fn)`, `u.over(fn)` | a dialog over a dimmed frame, and a layer for your own menus or popups; `check` does not report text in one layer as overlapping text in another |
| `u.toast(text, { at, out, icon, tone })` | a message that slides up, with a chime |
| `u.headline(text, x, y, { size, at, out, align, weight, italic, color, accent, tracking })` | big text that blurs in word by word; `*stars*` mark words in the `accent` color |
| `u.text(text, x, y, { size, weight, color, align, base, font, italic, tracking, alpha, maxW, check })`, `u.para(text, x, y, maxW, o)`, `u.eyebrow(text, x, y)` | text, wrapped text (`\n` starts a new line), and a small uppercase label; `font` is `'ui'`, `'headline'` or a family; `check: false` hides text from `check`; `u.measure(text, size, weight)` gives the width |
| `u.button(label, x, y, w, h, { variant, press, icon, loading, color, caps })` | `primary`, `secondary` or `ghost` |
| `u.input(x, y, w, h, { label, value, placeholder, focus, caret, icon })`, `u.textarea(x, y, w, h, o)` | a text field, and a taller one where the text wraps |
| `u.select(x, y, w, h, { label, value, open, options, hover, selected })` | a dropdown; returns the y of each option row |
| `u.toggle(x, y, on)`, `u.checkbox(x, y, on)`, `u.radio(x, y, on)` | `on` goes from 0 to 1, so it can animate |
| `u.chip(label, x, y, { selected })`, `u.chipWidth(label, o, selected)` | option chips; a selected chip grows by its check mark, so leave room |
| `u.pill(label, x, y, tone, { align, dot, pulse })` | a status badge: `gray`, `blue`, `yellow`, `green`, `red`, `purple` or `accent` |
| `u.spinner(x, y, r)`, `u.progress(x, y, w, p)`, `u.avatar(x, y, r, initials, { image })`, `u.icon(name, x, y, size, color)`, `u.lines(x, y, w, n)`, `u.logo(x, y, w)` | small parts; `lines` draws grey bars in place of body text |
| `u.pop(at, cx, cy, fn, { sfx })` | pops anything in around a point |
| `u.wipe(at, { color })` | the accent color spreads out until it fills the frame |
| `u.cursor(keys, { out })` | the mouse; a key `{ at, x, y, dur, arc }` moves it (`arc` bends the path, 0 is straight), `{ at, click: true }` clicks with a sound |
| `u.press(at)`, `u.typed(text, at, cps, { gain, sfx })`, `u.stream(text, at, wps)`, `u.count(to, at, dur)` | a button press (0 to 1 and back), text typed so far with typing sounds, text appearing word by word like an AI reply, a number counting up |
| `u.colors` | `accent`, `accentDark`, `accentTint`, `background`, `ink`, `text`, `soft`, `muted`, `faint`, `line`, `field`, `surface`, `panel`; `brand.colors` in `video.json` replaces the grays, for example `{ "text": "#141413", "line": "#e8e6dc" }` for a warm brand |

`check` sees the text of `s.ui` too. It reports text that runs off the frame
(not while the camera zooms in), text that is too small and text that
overlaps. A dropdown or dialog may cover what is under it. Look at stills at
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
