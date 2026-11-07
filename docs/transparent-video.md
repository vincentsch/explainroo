# Transparent video for editors

To put a diagram or a lower third over camera footage, render with an alpha
channel: `render --transparent --format mov` for video editors (ProRes 4444)
or `--format webm` for the web (VP9). The look's background texture is left
out. Everything the scene paints stays, including `s.bg()` and
`s.ui.backdrop()`, and cards, captions and the watermark keep their own
backgrounds. Keep elements readable on footage: use cards or the `bg` option
of text.

The files are `out/video.mov` or `out/video.webm` (`draft.*` with
`--draft`), and the cover stays an opaque JPEG. `slide`, `wipe` and `brush`
transitions become `fade` in a transparent video. Check frames with
`still --transparent`, which keeps the alpha, and the file with
`verify --file out/video.mov`, which skips the black-frame check for
transparent video. Without `--transparent`, WebM and MOV are ordinary opaque
videos.
