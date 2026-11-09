# Sizes for each platform

Set `size` to the place the video goes. `explainroo sizes` lists the sizes.

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
explainroo keeps your content away from those spots. The captions sit right
above the app's bottom band, and the watermark moves to the top right corner.
`s.safe` is the content area, and `s.cx` and `s.cy` are its center. `check`
warns about text, shapes and arrows outside it. With `"defaults": "0.6"`
only text has to stay in it: pictures and backgrounds may fill `s.full`, the
whole frame, behind the captions and the app's buttons. Plain `9:16` has no
such margins, so use it only when the video is not meant for those apps.

Vertical videos have little room. Stack things instead of putting them side
by side, use fewer words on screen, and place words from `s.safe`.
`explainroo docs short-video` has a kit for the parts these videos share, like a
hook title on the first frame.

## The content area

The content area is the part the app leaves free, without the caption band and
without the strip the watermark takes at the top. The caption band sits below
the content area and is not part of it. Bold captions are one line, so their
band is shorter and the content area taller. Without captions, the content
area reaches down to the app's own text.

These are the content areas of the tall app sizes in pixels, as width x height
at the top left corner, with the watermark and without it. `explainroo sizes`
prints the same numbers, and `check` names the area in its warnings, like
"outside the tiktok content area (119,240 to 864,1103, 745x863)".

| Size | Captions | With the watermark | Without the watermark |
|---|---|---|---|
| `shorts` | normal | 885 x 679 at 65,352 | 885 x 743 at 65,288 |
| `shorts` | bold | 885 x 732 at 65,352 | 885 x 796 at 65,288 |
| `shorts` | none | 885 x 896 at 65,352 | 885 x 960 at 65,288 |
| `tiktok` | normal | 745 x 746 at 119,304 | 745 x 810 at 119,240 |
| `tiktok` | bold | 745 x 799 at 119,304 | 745 x 863 at 119,240 |
| `tiktok` | none | 745 x 963 at 119,304 | 745 x 1027 at 119,240 |
| `reels` | normal | 896 x 698 at 65,333 | 896 x 762 at 65,269 |
| `reels` | bold | 896 x 751 at 65,333 | 896 x 815 at 65,269 |
| `reels` | none | 896 x 915 at 65,333 | 896 x 979 at 65,269 |
| `vertical` | normal | 745 x 679 at 119,352 | 745 x 743 at 119,288 |
| `vertical` | bold | 745 x 732 at 119,352 | 745 x 796 at 119,288 |
| `vertical` | none | 745 x 896 at 119,352 | 745 x 960 at 119,288 |

A TikTok package has no watermark. With `"captions": "bold"` in its block, its
content area is 745 x 863 at 119,240. `check --size tiktok` measures the area
with the watermark, `check --size tiktok --no-watermark` the one without it,
and `check --platform tiktok` the one a TikTok package has.

## Where the captions sit

Captions are on by default for vertical, 4:5 and square videos.
`"captions": "auto"` means no captions on a 16:9 video. On Shorts,
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
With `"auto"` and `"defaults": "0.5"`, every size takes the frame of the first
scene with the most elements fully arrived, where a frame with a shape, icon,
image or clip comes first, and the earliest of those. Code that types itself
or shows its lines, a terminal with lines still to come, a number that counts
and text that writes itself have arrived only once they are done. A project without
`"defaults"` takes the end of the first scene, or 1.0 second into it on
Shorts, TikTok and Reels. A cover you set yourself, like `"hook@2.5"`, always
wins. `check` gives a hint when the cover shows only text on an empty
background, and with `"defaults": "0.5"` when it shows something half typed or
counted. The cover leaves out the
captions, also when the video has them. A new `cover` needs no new render:
`package` keeps the finished video and writes only the new cover image.
`render` does the same when its video is otherwise the same, and says so.

## One project, several sizes

Use `--size <size>` on `preview`, `still`, `sheet`, `check`, `render` and
`export` to use another size for one run. It leaves `video.json` alone. The narration
and word times are shared between sizes, unless a size has a pace of its own
(see below). Captions set to `"auto"` follow the size you choose.

Place things from `s.safe`, `s.cx`, `s.cy`, `s.row`, `s.col` and `s.grid`
instead of fixed pixel positions. Use `s.portrait` to stack things in tall
frames. Keep text sizes relative to the frame, for example `s.W * 0.05`.
The `compare` layout in `explainroo docs pictures` shows one way.

When a scene needs a picture of its own in tall frames, draw it in the same
scene function when `s.portrait` is true. The cues and markers stay the same:

```js
steps(s) {
  const { top, h } = s.safe;
  if (s.portrait) {
    s.box('Ask', { id: 'a', y: top + h * 0.25, at: 'ask' });
    s.box('Answer', { id: 'b', y: top + h * 0.75, at: 'answer' });
  } else {
    s.box('Ask', { id: 'a', x: 600, y: 540, at: 'ask' });
    s.box('Answer', { id: 'b', x: 1320, y: 540, at: 'answer' });
  }
  s.arrow('a', 'b', { at: 'answer' });
},
```

`"captions": "auto"` follows the size too, so the 16:9 video has no captions
and the tall one has them, unless `"captions"` says otherwise.
[examples/merge-vs-rebase](https://github.com/vincentsch/explainroo/tree/main/examples/merge-vs-rebase)
works in `9:16` and in `youtube`. The examples also come with the package,
and `explainroo doctor` prints their folder.

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
`captions`, `cover`, `pace`, `watermark` and `targetSeconds`, with the same
values as at the top of the file. Here TikTok gets bold captions, a quicker pace
and a cover of its own, and the 16:9 version stays as it is:

```json
{
  "size": "16:9",
  "captions": "auto",
  "sizes": {
    "tiktok": { "captions": "bold", "pace": 1.2, "cover": "hook@2.5" }
  }
}
```

`explainroo render videos/<name> --size tiktok` and a TikTok package use the
block, and `explainroo render videos/<name>` doesn't.

`"targetSeconds"` at the top of `video.json` counts for every size, also one
whose block sets a quicker `pace`. So with `"targetSeconds": 45` and a TikTok
block with `"pace": 1.15`, the TikTok version gets longer holds until it runs
45 seconds too. To give a size a length of its own, set `"targetSeconds": 40`
in its block, or `null` there for no target at all. `voice` prints the target
it used for the size, and where it came from. A block counts wherever
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
`--size` in it. Check such a video with `verify --size tiktok`, which finds
`out/video-tiktok.mp4` and reads the scene times of that size's build.

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
