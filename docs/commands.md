# Commands

In these commands, `explainroo` is short for `npx --yes explainroo`, or for
`node bin/explainroo.js` in a source checkout. Commands that work on a video
take the project folder first, and every command accepts `--json`.
`explainroo <command> --help` prints the usage of one command, its options and
an example.

| Command | What it does |
|---|---|
| `init <dir>` | creates a project (`--theme`, `--size`, `--pace`, `--language`, `--voice`, `--title`) |
| `voice [project]` | makes the narration and the word times, saved per scene so only changed scenes are made again (`--estimate` prints how long the video will be about and makes nothing, `--force` makes every scene again, `--new` buys again only paid sentences with no good answer, `--size` makes the narration of a size whose block in `"sizes"` sets its own pace, `--lang`) |
| `words [project] [scene]` | prints each spoken word of a scene, or of every scene, with its start time in seconds into the scene, and the markers. A word spoken more than once shows its cue, like `fills#2` (`--size`, `--lang`, `--json`) |
| `preview [project]` | a live preview in the browser that reloads when you save (`--size`, `--no-watermark`) |
| `still [project] [times]` | PNG pictures at `12.5`, `scene`, `scene@2.4` or `scene@end` (`--size`, `--platform`, `--no-watermark`, `--transparent` keeps alpha) |
| `sheet [project]` | one image with many frames of the video or of one scene (`--scene`, `--every`, `--size`, `--platform`, `--no-watermark`). `--times 3,12.5,intro@2` makes `out/sheet-times.jpg` of just those moments, in that order. It takes every time that `still` takes. With `--size tiktok` the file is `out/sheet-times-tiktok.jpg` |
| `check [project]` | finds layout, timing and pronunciation problems (`--size`, `--platform`, `--no-watermark`) |
| `render [project]` | the video plus subtitle files, chapters and a cover (`--format mp4`, `gif`, `webm` or `mov`, `--transparent`, `--size`, `--platform`, `--no-watermark`, `--draft`, `--quality final` or `fast`, `--from`, `--to`, `--workers`, `--out`). Its last line says how long it took before the first frame, for the frames and after them, and a step that takes longer than 2 seconds says what it is |
| `verify [project]` | checks the finished MP4, WebM or MOV: loudness, true peak, black frames, silence, clear voice (`--file` picks another file) |
| `export [project]` | writes a web player folder (`--out dir`, `--size`, `--no-watermark`, `--json`), by default `out/player/`, or `out/player-tiktok/` with `--size tiktok` |
| `package [project]` | a folder to post on one platform (`--platform`, `--title`, `--description`, `--hashtags`, `--size` for x, `--workers`) |
| `share [project]` | uploads a video to explainroo.com for a page link, once that service runs. Until then it sends nothing and says so (`--platform`, `--file`, `--title`, `--new`) |
| `publish [project]` | posts a package after a typed yes or `--yes` (`--via`, `--platform`, `--privacy`, `--media-url`, `--media-url-unchecked`, `--channel`, `--account`, `--draft` for Buffer, `--dry-run`, `--new`) |
| `capture [project] <url>` | saves screenshots, wording, colors, the font files the page loaded and logos from a live site, with the page's text and a list of its images in `capture.json` (`--mobile`, `--json`). `--name pricing` saves to `assets/capture/<site>/pricing/`, so several pages of one site stay side by side |
| `image [project] <name> "<prompt>"` | makes an illustration with OpenRouter (`--new` buys it again, `--resume <id>` runs a job from `history` again) |
| `images [project]` | lists the images and what they cost |
| `clip [project] "<prompt>"` | buys a short AI video clip with OpenRouter (`--seconds`, `--max-cost`, `--budget`, `--dry-run`, `--aspect`, `--model`, `--resolution`, `--audio`, `--name`, `--no-wait`, `--new`, `--resume <id>`). `--dry-run` shows the price, what the model takes and what is left of the budget, also without a project. `--budget 0.40`, or `"clipBudget"` in `video.json`, is the most all clips of the project may cost |
| `services [step]` | lists the choices for each step, free ones first, with what each costs and what data leaves (`--json`, `--project`). The steps are `voice`, `timing`, `images`, `clips`, `music`, `sharing` and `posting`, and `publish` and `share` work as names for the last two. For clips it shows today's prices from OpenRouter's public list, which it reads at most once a day, or the range with `EXPLAINROO_OFFLINE=1` |
| `connect <service>` | sets a service up: tests its key or signs in through the browser, and saves it (`--key-stdin`, `--callback-url`, `--project`) |
| `history [project]` | prints open paid jobs with the command that continues each one, then spend, then rendered versions. Times are in this computer's time zone, with the zone, and `--json` keeps them in UTC |
| `voices`, `say "text"` | lists Kokoro voices with their languages (`--language es`, `ja` or `zh` filters voices), or makes a sample in the chosen voice's language |
| `voices [project] --provider <id>` | lists the names, ids and labels available to the key of `elevenlabs` or `cartesia` (`--language`, `--json`) |
| `themes`, `formats`, `icons <word>` | lists the looks, lists the sizes with each one's content area with and without the watermark, searches the 1,854 icons. `icons` prints one match per line. When nothing matches, it prints up to five close names and says what else works: draw it with `s.draw`, or make a picture with `explainroo image`, which costs money |
| `doctor [project]` | checks Node, ffmpeg, Chrome, the models, and espeak-ng and Python with misaki for other languages, for one project when given. Before there is a project, `--language es` checks one language, and `--language es,fr` several (`--fetch` downloads only English models). It also prints the settings file, where `EXPLAINROO_ESPEAK` can be set once, the folder explainroo runs from and where its examples are |
| `docs [topic] [section]` | prints the start page, one topic, or one section of a topic, named by its heading or by a word only its heading has (`--list` lists the topics, `--sections` lists the sections of a topic with their size) |
| `version` | prints the version (`--version` also works) |

`--platform <name>` on `check`, `still`, `sheet` and `render` sets the size,
its block in `"sizes"` and the watermark rule that `package --platform <name>`
uses, so you look at exactly what the package will show. TikTok has no
watermark, and the other platforms keep the one in `video.json`.

The extra files share the video's name, also with `--out`: `video.srt`,
`video.vtt`, `video.cover.jpg` and `video.chapters.txt`. A GIF has no sound,
runs at 15 frames per second and is at most 960 pixels on its long side.
`render` prints the width and height of the file it writes. A draft is half
the size, made even, so a 1080 x 1350 video gives a 540 x 676 draft.

A final draws 6 samples per frame for motion blur, which makes it several times
slower than a draft. `render` says so before the frames. Once this computer has
made a final of the same kind, with the same samples and `--workers`, `render`
also says about how long it takes, like "about 1 min 40 s: 1,400 frames at about
14 a second here". It keeps the speed of the last one in `render-speed.json` in
the cache folder, `~/.cache/explainroo/` or `EXPLAINROO_CACHE`. Before the
first final there is no estimate. `--quality fast` makes
a final without motion blur: full size, with the final encoder settings and one
sample per frame. It writes `out/video.mp4` like any final, and the record says
that motion blur was off. `package` copies such a file only when `video.json`
has `"motionBlur": false`. `--quality fast` and `--draft` can't go together.
With `--out`, the file ending must match the format. A render of part of the
video (`--from`, `--to`) skips the chapters and the cover. A video without
narration gets no subtitle files.

To put a diagram or a lower third over camera footage, render with an alpha
channel: `render --transparent --format mov` or `--format webm`. Run
`explainroo docs transparent-video` first.
