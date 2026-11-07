# Commands

In these commands, `explainroo` is short for `npx --yes explainroo`, or for
`node bin/explainroo.js` in a source checkout. Commands that work on a video
take the project folder first, and every command accepts `--json`.

| Command | What it does |
|---|---|
| `init <dir>` | creates a project (`--theme`, `--size`, `--pace`, `--language`, `--voice`, `--title`) |
| `voice [project]` | makes the narration and the word times, saved per scene so only changed scenes are made again (`--force` makes every scene again, `--new` buys again only paid sentences with no good answer) |
| `preview [project]` | a live preview in the browser that reloads when you save (`--size`, `--no-watermark`) |
| `still [project] [times]` | PNG pictures at `12.5`, `scene`, `scene@2.4` or `scene@end` (`--size`, `--no-watermark`, `--transparent` keeps alpha) |
| `sheet [project]` | one image with many frames of the video or of one scene (`--scene`, `--every`, `--size`, `--no-watermark`) |
| `check [project]` | finds layout, timing and pronunciation problems (`--size`, `--no-watermark`) |
| `render [project]` | the video plus subtitle files, chapters and a cover (`--format mp4`, `gif`, `webm` or `mov`, `--transparent`, `--size`, `--no-watermark`, `--draft`, `--from`, `--to`, `--workers`, `--out`) |
| `verify [project]` | checks the finished MP4, WebM or MOV: loudness, true peak, black frames, silence, clear voice (`--file` picks another file) |
| `export [project]` | writes a web player folder (`--out dir`, `--json`), by default `out/player/` |
| `package [project]` | a folder to post on one platform (`--platform`, `--title`, `--description`, `--hashtags`, `--size` for x, `--workers`) |
| `share [project]` | uploads a video to explainroo.com for a page link, once that service runs (`--platform`, `--file`, `--title`, `--new`) |
| `publish [project]` | posts a package after a typed yes or `--yes` (`--via`, `--platform`, `--privacy`, `--media-url`, `--channel`, `--account`, `--dry-run`, `--new`) |
| `capture [project] <url>` | saves screenshots, wording, colors, fonts and logos from a live site (`--mobile`, `--json`) |
| `image [project] <name> "<prompt>"` | makes an illustration with OpenRouter (`--new` buys it again, `--resume <id>` runs a job from `history` again) |
| `images [project]` | lists the images and what they cost |
| `clip [project] "<prompt>"` | buys a short AI video clip with OpenRouter (`--seconds`, `--max-cost`, `--dry-run`, `--aspect`, `--model`, `--resolution`, `--audio`, `--name`, `--no-wait`, `--new`, `--resume <id>`). `--dry-run` shows the price, also without a project |
| `services [step]` | lists the choices for each step, free ones first, with what each costs and what data leaves (`--json`, `--project`). For clips it shows today's prices from OpenRouter's public list, which it reads at most once a day, or the range with `EXPLAINROO_OFFLINE=1` |
| `connect <service>` | sets a service up: tests its key or signs in through the browser, and saves it (`--key-stdin`, `--callback-url`, `--project`) |
| `history [project]` | prints open paid jobs with the command that continues each one, then spend, then rendered versions |
| `voices`, `say "text"` | lists Kokoro voices with their languages (`--language es`, `ja` or `zh` filters voices), or makes a sample in the chosen voice's language |
| `voices [project] --provider <id>` | lists the names, ids and labels available to the key of `elevenlabs` or `cartesia` (`--language`, `--json`) |
| `themes`, `formats`, `icons <word>` | lists the looks and the sizes, searches the 1,854 icons |
| `doctor [project]` | checks Node, ffmpeg, Chrome, the models, and espeak-ng and Python with misaki for other languages, for one project when given (`--fetch` downloads only English models) |
| `docs [topic]` | prints the start page, or one topic (`--list` lists the topics) |
| `version` | prints the version (`--version` also works) |

The extra files share the video's name, also with `--out`: `video.srt`,
`video.vtt`, `video.cover.jpg` and `video.chapters.txt`. A GIF has no sound,
runs at 15 frames per second and is at most 960 pixels on its long side.
With `--out`, the file ending must match the format. A render of part of the
video (`--from`, `--to`) skips the chapters and the cover. A video without
narration gets no subtitle files.

To put a diagram or a lower third over camera footage, render with an alpha
channel: `render --transparent --format mov` or `--format webm`. Run
`explainroo docs transparent-video` first.
