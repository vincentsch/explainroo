# Sizes for each platform

Set `size` to the place the video goes. `explainroo formats` lists the sizes.

| Size | Pixels | For |
|---|---|---|
| `youtube` (or `16:9`) | 1920 x 1080 | YouTube and other wide players |
| `shorts` | 1080 x 1920 | YouTube Shorts |
| `tiktok` | 1080 x 1920 | TikTok |
| `reels` | 1080 x 1920 | Instagram and Facebook Reels |
| `vertical` | 1080 x 1920 | one file for Shorts, TikTok and Reels |
| `instagram` | 1080 x 1350 | Instagram and Facebook feed posts |
| `linkedin` | 1080 x 1350 | the LinkedIn feed |
| `square` (or `1:1`) | 1080 x 1080 | square posts on X, LinkedIn and Facebook |

`9:16`, `4:5` and `WIDTHxHEIGHT` also work.

YouTube and LinkedIn take the `.srt` file as captions when you upload the
video.

Shorts, TikTok and Reels put their own buttons, the account name and the post
text on top of the video. With `shorts`, `tiktok`, `reels` and `vertical`,
explainroo keeps your content away from those spots. `s.safe` is the part the
app leaves free, and `s.cx` and `s.cy` are its center. The captions sit right
above the app's bottom band, and the watermark moves to the top right corner.
`check` warns about any text outside that area. Plain `9:16` has no such
margins, so use it only when the video is not meant for those apps.

Vertical videos have little room. Stack things instead of putting them side
by side, use fewer words on screen, and place everything from `s.safe`.
`explainroo formats` prints the content area of each size in pixels, with the
watermark and without it. On TikTok it is 745 x 746 with the watermark and
745 x 810 without it, which is what a TikTok package uses. `check --size tiktok`
measures the first, and `check --size tiktok --no-watermark` the second.
`explainroo docs short-video` has a kit for the parts these videos share, like a
hook title on the first frame.

## Where the captions sit

Captions are on by default for vertical, 4:5 and square videos. On Shorts,
TikTok and Reels they sit right above the app's bottom band. On 4:5, square
and wide videos they sit at the bottom, above the watermark. On a plain
`9:16` video they sit about a quarter of the way up. In every case `s.safe`
ends above them. So anything placed inside `s.safe` stays clear of them, and
`check` warns about text in the caption band. Do not put the same sentence on
screen as text while the captions show it.

The first frame is often the cover picture on social apps. When the first
elements draw themselves in, frame one is empty. Give the title
`enter: 'none'` so it is there from the first frame, or pick another cover
frame in the app.

`render` writes its own cover, `video.cover.jpg`, from the `cover` setting.
With `"auto"`, `shorts`, `tiktok`, `reels` and `vertical` take it 1.0 second
into the first scene, while the hook title is still on screen. A first scene
shorter than that gives its last frame. Every other size, plain `9:16`
included, takes the end of the first scene. A cover you set yourself always
wins.

## One project, several sizes

Use `--size <size>` on `preview`, `still`, `sheet`, `check`, `render` and
`export` to use another size for one run. It leaves `video.json` alone. The narration
and word times are shared between sizes, unless a size has a pace of its own
(see below). Captions set to `"auto"` follow the size you choose.

Place things from `s.safe`, `s.cx`, `s.cy`, `s.row`, `s.col` and `s.grid`
instead of fixed pixel positions. Use `s.portrait` to stack things in tall
frames. Keep text sizes relative to the frame, for example `s.W * 0.05`.
The `compare` layout in `explainroo docs pictures` shows one way.
[examples/merge-vs-rebase](https://github.com/vincentsch/explainroo/tree/main/examples/merge-vs-rebase)
works in `9:16` and in `youtube`.

For every size, run `check --size <size>` and look at
`sheet --size <size>`. Fix cut-off text and overlaps. Then run
`render --size <size>` for each size.

`--size tiktok` adds `-tiktok` to every file a command writes, like
`out/video-tiktok.mp4`, `out/stills-tiktok/` and `out/sheet-intro-tiktok.jpg`.
A ratio uses a hyphen, like `video-9-16.mp4`. `--no-watermark` turns the
watermark off for one run and adds `-no-watermark` the same way.
`render --out` still sets the file name you choose.

## Settings for one size

`"sizes"` in `video.json` gives one size settings of its own. A block can set
`captions`, `cover`, `pace` and `watermark`, with the same values as at the top
of the file. Here TikTok gets bold captions, a quicker pace and a cover on the
hook title, and the 16:9 version stays as it is:

```json
{
  "size": "16:9",
  "captions": "auto",
  "sizes": {
    "tiktok": { "captions": "bold", "pace": 1.2, "cover": "hook@0.5" }
  }
}
```

`explainroo render videos/<name> --size tiktok` and a TikTok package use the
block, and `explainroo render videos/<name>` doesn't. A block counts wherever
its size is used: as `size` in `video.json`, with `--size`, and in `package`.
A package looks for the block of its platform's size first, like `linkedin` for
LinkedIn, see `explainroo docs publishing`. A block adds nothing to file names.

A block follows its exact size name. `youtube` and `16:9` give the same frame,
and still a block for `16:9` doesn't apply to `--size youtube`. The settings
come in this order, and a later one wins:

1. The top of `video.json`.
2. The block of the language in `"languages"`.
3. The block of the size in `"sizes"`.
4. The flags of the run, like `--no-watermark`, and the rules of the platform.
   A TikTok package never has a watermark, whatever its block says.

A size whose block sets another pace has narration of its own. It builds in
`build/pace-<pace>/`, like `build/pace-1.2/`, next to the normal build. A
language other than the main one uses `build/<lang>/pace-<pace>/`. So switching
between sizes never makes narration again. A paid voice buys the narration at
that pace once, and then uses it from `history/voice/`.
`explainroo voice videos/<name> --size tiktok` makes or repairs the narration of
that size. A command that continues a paid request at that pace has the
`--size` in it. `verify` without a size reads the normal build, so for a video
of such a size it listens to the whole file at once instead of scene by scene.

## Pace

`pace` makes the whole video quicker or slower. At 1.3 the voice speaks about
30% faster. The voice model does not speed up exactly, so check the length
`voice` reports. The pauses, the time before and after each scene, the transitions and
every animation also get 30% shorter. Word and marker cues follow the voice.
So if you tie pictures to words, the rhythm stays right at any pace. Times in
seconds are real seconds of the scene, like `s.t` and `s.cue()`. So
`at: s.cue('word') + 0.3` means 0.3 seconds after the word at any pace. A
fixed time like `at: 4` does not move with the pace. That is one more reason
to use cues. 1 is the normal pace. 1.15 to 1.3 suits social media and viewers
who know the topic. Above 1.4 the video gets hard to follow. `speed` changes
only the voice. Its default is 0.9 for Kokoro and 1 for the other sources.

## The watermark

Every video gets a small "explainroo.com" in the bottom right corner. On
Shorts, TikTok and Reels it sits in the top right corner, because the app
covers the bottom one. The user can turn it off with `"watermark": false` in
`video.json`, or change it to their own text. If the user asks about it, tell
them it is their choice, and that keeping it helps more people find this free
project. A TikTok package has no watermark, because TikTok forbids one on posts
from apps.
