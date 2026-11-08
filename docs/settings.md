# Project files and settings

A project is a folder with these files:

```
videos/<name>/
  .gitignore    keeps build/, out/, .env and history/private/ out of git
  video.json    look, size, language, voice, music, captions, watermark
  script.md     the narration, one "## scene-id" per scene
  scenes.js     one drawing function per scene
  post.json     the words for package, optional
  assets/       images, generated illustrations, clips and sound files
  build/        voice, timing and audio made by explainroo (safe to delete,
                because paid speech and paid images stay in history/)
  out/          video.mp4, draft.mp4, stills/, sheets, report.json, package/
  history/      what was paid for and rendered, so keep it. A new session runs
                "explainroo history" to see open jobs and how to continue them
```

`video.json` settings, all optional. `explainroo set videos/<name> <key>
<value>` writes one of them, like `explainroo set videos/<name> targetSeconds
40`. A dotted key like `sizes.shorts.pace` sets a setting of one size. The
value is JSON when it reads as JSON, like `40`, `false` or `{"pace": 1.2}`,
and text otherwise, and `null` takes the key out. The settings get the same
check as every command first, so a mistake changes nothing, and the rest of
the file keeps its order.

| Setting | Default | What it does |
|---|---|---|
| `title` | from the script | shown in the preview |
| `theme` | `paper` | a built-in look, or a relative path to a `.json` look file (see Custom looks) |
| `size` | `16:9` | a platform (`youtube`, `shorts`, `tiktok`, `reels`, `vertical`, `instagram`, `linkedin`, `square`), `16:9`, `9:16`, `1:1`, `4:5` or `WIDTHxHEIGHT`; see `explainroo docs sizes` |
| `fps` | 30 | 24, 25, 30, 50 or 60 |
| `language` | `en` | narration language: `en`, `es`, `fr`, `it`, `pt-br`, `hi`, `ja` or `zh`, and `de` with a paid voice or a recording; see `explainroo docs languages` |
| `voice` | the language's voice | a Kokoro id or a provider object for Kokoro, ElevenLabs, Cartesia or a recording; English uses `af_heart`; see `explainroo docs voices` |
| `languages` | none | settings for one language, like `{ "es": { "voice": "ef_dora" } }`; see `explainroo docs languages` |
| `sizes` | none | `captions`, `cover`, `pace`, `watermark` and `targetSeconds` for one size, like `{ "tiktok": { "captions": "bold", "pace": 1.2 } }`; see `explainroo docs sizes` |
| `speed` | 0.9 for Kokoro, 1 otherwise | voice speed only, 0.6 to 1.6; paid voices limit speed times pace, see `explainroo docs voices` |
| `pace` | 1 | speed of the whole video (voice, pauses, animations), 0.7 to 1.6; see `explainroo docs sizes` |
| `music` | `true` | `true` (the look's style), `warm`, `upbeat`, `calm`, `tech`, `playful`, `{ "style", "volume" }`, `false`, or your own file as `{ "src", "volume", "credit", "loop" }`, see `explainroo docs music` |
| `sfx` | `true` | sound effects: `true`, `"minimal"` or `false` |
| `captions` | `"auto"` | text of the narration at the bottom; `"auto"` turns it on for vertical, 4:5 and square videos, and leaves it off for 16:9; `"bold"` shows 2 to 4 big words at a time, with numbers, money and `*starred*` words in color |
| `cover` | `"auto"` | full-size JPEG, without captions. With `"defaults": "0.5"`, `"auto"` takes the frame of the first scene with the most elements fully arrived, a frame with a shape, icon, image or clip first. Without it, `"auto"` is the end of the first scene, or 1.0 second into it on Shorts, TikTok and Reels. Or a still spec: `12.5`, `"intro"`, `"intro@2.4"`, `"intro@end"`. A new cover needs no new render |
| `transition` | `"auto"` | the look's default, or `fade`, `slide`, `wipe`, `zoom`, `brush`, `cut` |
| `camera` | `"auto"` | `"auto"` films each scene with a camera that follows the narration; `"still"` keeps every frame as written |
| `motionBlur` | `true` | motion blur on moving frames in the final render; `render --quality fast` leaves it out for one run |
| `lead`, `hold`, `end` | 0.35, 0.7, 1.4 | seconds before the voice, after it, and extra at the very end |
| `targetSeconds` | none | the length the video should have, like `40`, also in a block under `"sizes"`. After `voice`, a shorter video gets the missing time spread over the scene holds, and `voice` and `check` warn when it is longer. See `explainroo docs writing` |
| `sentenceGap`, `paragraphGap` | 0.3, 0.55 | pauses in generated narration; recordings keep their own pauses |
| `loudness` | -14 | target loudness in LUFS |
| `boil` | 0 | redraws per second of hand-drawn lines; 0 keeps them still |
| `watermark` | `"explainroo.com"` | small text in a corner, on by default, or `false` to turn it off. A TikTok package always leaves it out |
| `images` | none | `{ "model": "best" or "cheap", "style": "..." }` |
| `clipBudget` | none | the most all AI clips of the project may cost together, in US dollars, like `0.40`. `clip` stops before a clip that would go over it; see `explainroo docs clips` |
| `brand` | none | colors, fonts and logo for `s.ui`; its `accent` also colors the spoken word in captions; see `explainroo docs product-demos` |
| `fonts` | none | the video's own font files, see `explainroo docs product-demos` |
| `defaults` | none | `"0.5"` gives the project the defaults of explainroo 0.5, see below. `init` writes it |

### The defaults of a version

Some defaults change how a video looks. So that a finished video comes out
the same after an update, they apply only to a project with `"defaults":
"0.5"` in `video.json`. `init` writes that line. A project without it keeps
the look it had, frame for frame, also its cover. To give an older project
the new look, add the line, then look at `still` and `sheet` again, because
labels may move. The line changes these:

- Arrow labels are body size, 48 pixels, and sit 44 pixels from the arrow.
  Before, they were 34 pixels, 34 pixels from it.
- An arrow to or from an icon with a label starts and ends outside the label.
- `gap` on an arrow leaves that many pixels free at a point end too, not only
  at an element.
- When the camera moves to an element, the shot also takes in the arrows and
  marks attached to it.
- The default highlight of a sticker's `*keywords*` picks a red that reads on
  that sticker's color.
- A `brand.accent` that is hard to read on the caption background keeps its
  hue in the captions, made lighter or darker. Before, the captions used the
  look's highlight.
- `"cover": "auto"` takes the fullest frame of the first scene, as above.

`check` finds the same problems with or without the line.

The looks:

| Look | What it looks like | Transition | Music |
|---|---|---|---|
| `paper` | marker drawings on warm paper | brush | warm |
| `clean` | flat cards with soft shadows | slide | upbeat |
| `chalk` | chalk on a green board | brush | calm |
| `blueprint` | white drawings on blueprint blue | wipe | tech |
| `midnight` | dark background with glowing colors | zoom | tech |
| `editorial` | serif headlines and fine lines on warm paper, like a magazine | fade | calm |

## Custom looks

A look file gives a project its own colors, fonts and texture without
changing explainroo. Set `"theme": "../brand/acme-look.json"` in `video.json`.
The path is relative to the video folder, so a file outside it can give
several videos the same look.

```json
{
  "extends": "clean",
  "name": "acme",
  "bg": "#fbfaf7",
  "ink": "#1d1b16",
  "accent": "orange",
  "colors": { "orange": "#e8590c" },
  "background": "dots",
  "transition": "fade",
  "music": "calm"
}
```

`extends` names the built-in look to start from. Every other key is
optional and changes only what it lists: `name`, `dark`, `bg`, `ink`, `muted`,
`surface`, `accent`, `colors`, `fonts`, `background`, `stroke`, `radius`,
`transition`, `music`, `code`, `terminal` and `caption`. In the nested ones,
like `colors` or `caption`, list only the values you change. `name` defaults
to the file name and cannot be a built-in name. Set `"dark": true` when you
give a light look a dark `bg`, so fills and shadows suit it.

Use colors like `"#e8590c"`. `caption.bg` and `code.highlight` also accept
`rgba(...)`. `accent` names one of the ten colors: red, orange, yellow,
green, teal, blue, purple, pink, gray or ink.

`fonts` sets the `display`, `body`, `hand` and `mono` roles. Each takes a
`family` and a numeric `weight`, for example
`"body": { "family": "Inter", "weight": 500 }`. Families must be built in
or listed in `video.json` under `fonts`. The look file does not load fonts.

`background` picks a texture: `paper` (paper grain), `dots` (a dot grid),
`chalk` (board smudges), `grid` (drafting lines), `glow` (two glows) or
`plain` (one flat color). Each uses your `bg`. Leave it out to keep the base
texture. `transition` and `music` set the look's defaults. Settings in
`video.json` still win. `preview` picks up look edits, and `check` warns
when `ink` or `muted` has too little contrast against `bg`.

## Where keys go

`explainroo connect <service>` sets up a key. It says what the service costs and
what data leaves the computer, tests the key, and saves it only if the test
passes. In a terminal it asks with a hidden prompt. With no terminal it prints
the steps and two ways to finish: the user runs it in their own terminal, or the
key comes in on stdin with `--key-stdin`. A key never goes on the command line.

A key is a line like `OPENROUTER_API_KEY=...` in a `.env` file. `connect` saves it
in the settings folder, so every project can use it. In a source checkout it uses
the `.env` in that folder, and `--project <dir>` uses that project's `.env`.
`doctor` prints the settings file as `keys file`. It is the first of these that
applies:

- `$EXPLAINROO_CONFIG/.env`, when that is set
- On Windows, `%APPDATA%\explainroo\.env`
- `$XDG_CONFIG_HOME/explainroo/.env`, when that is set
- `~/.config/explainroo/.env`

explainroo uses the first value it finds. It looks in the environment, then
`.env` in the project folder, then `.env` in a source checkout, then the
settings folder. New projects list `.env` in their `.gitignore`. An older
project may not, so check before you put a key there. Never print a key, and
never put it in a script, a commit or a log.
