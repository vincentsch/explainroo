# Web player

Use `export` for a video on a docs site or in an iframe. The canvas draws
at the screen's resolution, so text stays sharp when the player grows.
The folder holds the player's own engine, fonts, soundtrack and subtitles,
so it needs no explainroo server. The voice is made first if needed.

```bash
explainroo export videos/my-video
```

Serve `out/player/` with any static web server. Opening `index.html` as a
local file does not work. Copy the folder to your site, keeping its files
together. It works in a subfolder too.

`export --size tiktok` writes the player of that size to `out/player-tiktok/`,
with the settings of its block in `"sizes"`. `--no-watermark` adds
`-no-watermark` to the folder's name the same way. `--out` still sets the
folder you choose.

For a 1920 x 1080 video, embed it like this. Change the aspect ratio to
match your video's width and height.

```html
<div style="aspect-ratio: 1920 / 1080; width: 100%">
  <iframe src="/videos/my-video/index.html" title="My video"
    style="width: 100%; height: 100%; border: 0"
    allow="autoplay; fullscreen" allowfullscreen></iframe>
</div>
```

`index.html?autoplay=1&muted=1` starts muted playback, subject to the
browser's autoplay rules. `index.html?t=12.5` starts at 12.5 seconds.
Space or K plays and pauses, the arrow keys jump 5 seconds, F goes full
screen and M mutes. A CC button shows text captions.

Clips use the browser's video decoder. Use a format the browser can play.
Their timing can differ a little from the MP4. Math formulas are included
as typeset paths. Project modules must use relative local imports. Dotfiles,
JSON and text files from the project are kept out of the export.

The MP4 remains the file to upload to video platforms.
