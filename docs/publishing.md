# Posting and sharing

`explainroo package` makes a folder with everything needed to post a video on
one platform. You upload it yourself, or a posting tool does. `explainroo share`
uploads a finished video to explainroo.com and gives back a page link. It is the
only command that uploads a video, and it runs only when you ask for it.

## Package a video for a platform

```bash
explainroo package videos/<name> --platform tiktok
```

| Platform | Size | Watermark |
| --- | --- | --- |
| `youtube` | `youtube`, 1920 x 1080 | as set in `video.json` |
| `shorts` | `shorts`, 1080 x 1920 | as set in `video.json` |
| `tiktok` | `tiktok`, 1080 x 1920 | off |
| `reels` | `reels`, 1080 x 1920 | as set in `video.json` |
| `linkedin` | `linkedin`, 1080 x 1350 | as set in `video.json` |
| `x` | `square`, 1080 x 1080, or another with `--size` | as set in `video.json` |

When the project's own size gives the same frame and the same free area, the
package keeps it. So a project in `16:9` goes to YouTube as it is, and the
video that `render` made can be used.

The folder is `out/package/<platform>/`:

| File | What it holds |
| --- | --- |
| `video.mp4` | the video at the platform's size |
| `post.json` | everything settled for this platform, see below |
| `description.txt` | the words for the platform's text box, ready to paste |
| `video.srt` and `video.vtt` | captions, when the video has narration |
| `video.cover.jpg` | the cover picture |
| `video.chapters.txt` | chapters, on YouTube only, when scenes name them |
| `credits.txt` | one credit per line |
| `report.json` | the `verify` report of `video.mp4` |

YouTube has its own field for the title. So on YouTube and Shorts,
`description.txt` holds the description with the hashtags. On the other
platforms it holds `text`.

Package one platform at a time. Two runs at once in one project get in each
other's way.

## Why the TikTok file has no watermark

TikTok's [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
say that apps and integrations "should not superimpose or otherwise include any
brand name, logo, watermark, other promotional branding, link or promotional
text, on or in any content which is shared to TikTok". explainroo is such an
app, so the TikTok file has no "explainroo.com" in its corner. The same rule is
why credits never go into the text of a post by themselves.

Without the watermark, `s.safe` starts a little higher on TikTok. To look at the
frames as they will be packaged, run:

```bash
explainroo check videos/<name> --size tiktok --no-watermark
explainroo still videos/<name> --size tiktok --no-watermark
```

## The words: post.json

Write `post.json` next to `video.json`. Every field is optional.

```json
{
  "title": "How DNS finds a website",
  "description": "Your browser asks a resolver for the address of a site. This video shows each step it takes.",
  "hashtags": ["#dns", "#networking"],
  "platforms": {
    "tiktok": { "description": "How your browser finds a website, step by step." }
  }
}
```

Each field is settled in this order, and a later one wins:

1. The built-in default.
2. `post.json`.
3. The block for this platform under `platforms` in `post.json`.
4. The flags `--title`, `--description` and `--hashtags` on `package`.

| Field | Default | What it is |
| --- | --- | --- |
| `title` | the video's title | the title, on platforms that have a field for it |
| `description` | empty | a few plain sentences about the video. `package` warns until there is one |
| `hashtags` | none | a list like `["#dns", "networking"]`. Each is stored with its `#` |
| `ai_label` | from the project | whether the post says that AI made part of it, see below |
| `credits` | from the project | more credits, added to the ones explainroo writes |
| `made_for_kids` | `false` | YouTube asks this for every video |
| `category` | `"27"` | YouTube's category id. 27 is Education |

`--hashtags` takes words like `"dns networking"` or `"#dns,#networking"`.

The `post.json` in the folder also has `text`. It is what a service gets when it
has one text field. It is the description, or the title when there is no
description, followed by the hashtags it doesn't already contain. On YouTube the
chapters go at the end of the description first. The title is never added to a
description, so nothing appears twice.

### Limits

`package` warns when a title or a text is longer than a platform takes, or a
video is longer than it allows. It never stops on these. Platforms change them,
and these were read on 2026-11-07:

| Platform | Title | Text | Video |
| --- | --- | --- | --- |
| YouTube | 100 characters | 5,000 bytes of description | over 15 minutes only from verified accounts |
| Shorts | 100 characters | 5,000 bytes of description | up to 3 minutes |
| TikTok | none | 2,200 characters | up to 10 minutes from posting tools |
| Reels | none | 2,200 characters and 5 hashtags | Reels over 3 minutes are not shown to new viewers |
| LinkedIn | none | 3,000 characters | up to 15 minutes |
| X | none | 280 characters | up to 2 minutes 20 seconds without Premium |

## The AI label and the credits

`ai_label` is `true` when the voice is synthetic, or when the project bought AI
clips or images. `ai_reasons` in the folder's `post.json` says why, like
`"voice: Kokoro"` or `"clip: google/veo-3.1-lite"`. A video with a recorded
voice and no AI files gets `false`. Set `ai_label` in `post.json` to change it
either way.

The credits name these:

- The voice
- The music, with the `credit` from `video.json` for a music file
- The model of each bought clip and image
- "Made with explainroo"

Add more with `credits` in `post.json`. Credits stay in `post.json` and
`credits.txt`. They never go into the description by themselves.

Both read the project record, so a clip or an image that you bought still
counts when no scene uses it. Change it in `post.json` if that is wrong.

## What package checks

- **The setup it ships.** `check` runs at the platform's size, with or without
  the watermark as the file will be. An error stops the package with the same
  messages as `check`, and says which size failed. A layout with fixed positions
  for `16:9` can fail at a tall size, so place things from `s.safe`. Warnings
  are listed and kept in `post.json`.
- **The video.** A video you already rendered is copied when it is this exact
  video. It has to be a final MP4 of the whole video at full scale, with the
  same size and watermark. It also has to come from the same project and the
  same version of explainroo, with its file unchanged since. A draft, a
  `--scale` render and a `--from` or `--to` render never count. Otherwise
  `package` renders. For TikTok,
  `render --size tiktok --no-watermark` makes the very file it needs.
- **The file.** `verify` runs on the packaged file, unless this exact file was
  verified before. Its report goes in the folder, and its result goes in
  `post.json`. Fix any error before you post.

Never upload `draft.mp4`. After you upload, look at the platform's lower quality
copy as well as its full-size copy.

## Share a link

```bash
explainroo share videos/<name>                    # out/video.mp4
explainroo share videos/<name> --platform tiktok  # the TikTok package
explainroo share videos/<name> --file out/video.webm
```

`share` uploads one video to explainroo.com and prints a page link that anyone
with the link can watch. It also prints a link to the file itself, which posting
tools such as Buffer need. The video file and its title leave your computer, and
only when you run this command. The service takes MP4 and WebM files. A draft is
never picked by itself, because it is half the size. `--file` can still send
one. `--title` replaces the title.

The hosted service is coming. Until it runs, `share` says so and makes no link.

A link shared without an account expires, and `share` prints when. It also
prints a claim link. Open it to add the video to an account, and then the link
does not expire. Anyone with the claim link can take the video, so keep it to
yourself. explainroo keeps it in `history/private/`, which git leaves out. With a
key from an account in `EXPLAINROO_CLOUD_KEY`, the link belongs to that account
and does not expire.

Sharing the same file again prints the link it already has and uploads nothing.
`--new` uploads it again.

| What happens | What `share` says | Run it again |
| --- | --- | --- |
| Nothing answers at the address | The video was not sent | Yes |
| The address has no service yet, like a 404 or a web page | No share link was made | Yes |
| The connection drops during the upload, it takes too long, or the server fails | The server may have received the video | Only with `--new` |
| The key is wrong | No share link was made, and it never uploads without the key | Yes, after you fix the key |
| The server refuses the file | The server's reason | Yes, after you change the file |
| Too many uploads | When to try again | Yes, later |
| The server could not check the file in time | Nothing was published | Yes, later |

`EXPLAINROO_CLOUD_URL` replaces the address, for example for a test server. It
is read from the environment only, and never from a `.env` file.
