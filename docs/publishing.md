# Posting and sharing

`explainroo package` makes a folder with everything needed to post a video on
one platform. You upload it yourself, or a posting tool does. `explainroo share`
uploads a finished video to explainroo.com and gives back a page link.
`explainroo publish` posts a package through YouTube, Buffer or Blotato.
`share` and `publish` are the only commands that upload a video, and they run
only when you ask for them.

The parts about the package and about posting in general come first. Then each
route has a part of its own: YouTube, Buffer, Blotato and share. Print only the
part you need. `explainroo docs publishing --sections` lists them, and
`explainroo docs publishing buffer` prints the one about Buffer.

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

When `"sizes"` in `video.json` has a block for the platform's size, the
package uses that size and its block. So the `linkedin` block counts for a
LinkedIn package, also in an `instagram` project. Without such a block, a
project whose own size gives the same frame and the same free area keeps its
size. So a project in `16:9` goes to YouTube as it is, and the video that
`render` made can be used. The rules of the platform come last, so a TikTok
package has no watermark, whatever its block says.

The folder is `out/package/<platform>/`:

| File | What it holds |
| --- | --- |
| `video.mp4` | the video at the platform's size |
| `post.json` | everything settled for this platform, see below |
| `description.txt` | the words for the platform's text box, ready to paste |
| `video.srt` and `video.vtt` | captions, when the video has narration |
| `video.cover.jpg` | the cover picture, without captions. With `"cover": "auto"` it is the fullest frame of the first scene, see `explainroo docs settings`. A new `cover` needs no new render, so the package keeps the video and writes only the cover |
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
text, on or in any content which is shared to TikTok". A TikTok package is
made to be posted by such an app, so its file has no "explainroo.com" in the
corner. The same rule is why credits never go into the text of a post by
themselves.

Without the watermark, `s.safe` starts a little higher on TikTok.
`explainroo formats` prints both areas. To look at the frames as they will be
packaged, run:

```bash
explainroo check videos/<name> --size tiktok --no-watermark
explainroo still videos/<name> --size tiktok --no-watermark
```

For settings that only the TikTok version should have, like bold captions, a
quicker pace or another cover, add a `tiktok` block under `"sizes"` in
`video.json`. `explainroo docs sizes` shows one.

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
chapters go at the end of the description, before the hashtags. The title is never added to a
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

Both read the project record, so a clip or an image that you bought counts
for the label and the credits even when no scene uses it. If the label is then
wrong, set `ai_label` in `post.json`.

## What package checks

- **The layout at the platform's size.** `check` runs at the platform's size, with or without
  the watermark as the file will be. An error stops the package with the same
  messages as `check`, and says which size failed. A layout with fixed positions
  for `16:9` can fail at a tall size, so place things from `s.safe`. Warnings
  are listed and kept in `post.json`.
- **The video.** A video you already rendered is copied when it is this exact
  video. It has to be a final MP4 of the whole video at full scale, with the
  same size and watermark. It also has to come from the same project, the same
  settings and the same version of explainroo, with its file unchanged since. A
  draft, a `--scale` render and a `--from` or `--to` render never count. A
  `render --quality fast` counts only when `video.json` has
  `"motionBlur": false`, because the package of any other project has motion
  blur. Otherwise `package` renders, and it names the render command whose file
  it could copy next time. Its JSON has that command in `source.command`.
- **The file.** `verify` runs on the packaged file, unless this exact file was
  verified before. Its report goes in the folder, and its result goes in
  `post.json`. Fix any error before you post.

Never upload `draft.mp4`. After you upload, look at the platform's lower quality
copy as well as its full-size copy.

### Look at a platform's version first

Render the platform's version with the setup of its package, look at it, and
then package it. The package copies that file instead of rendering the video
again, and it says `copied from` with the file's name. For TikTok:

```bash
explainroo render videos/<name> --size tiktok --no-watermark
explainroo package videos/<name> --platform tiktok
```

The other platforms keep the watermark that `video.json` sets, so leave out
`--no-watermark` for them. A project whose own size suits the platform needs no
`--size`, like a `16:9` project for YouTube. When `package` renders anyway, the
command it names is the one to run next time.

## Post a package

This part holds what all three routes share. The parts on YouTube, Buffer and
Blotato that follow have the sign-in and what is different on each.

```bash
explainroo publish videos/<name> --via youtube --dry-run                    # the youtube package
explainroo publish videos/<name> --via buffer --platform tiktok --dry-run
explainroo publish videos/<name> --via blotato --platform reels --dry-run
```

`publish` posts the package that `explainroo package` made. It never renders.
It stops when the package is missing, when `video.mp4` changed since, or when
`verify` found errors in it. Without `--platform`, YouTube takes the `youtube`
package. Buffer and Blotato take the one package they can post, and list them
when there are more.

It has no scheduler and no queue. A post goes out when the command runs, unless
`--draft` saves it as a draft in Buffer. `publish` refuses any flag it doesn't
know, like a time for the post.

### Nothing goes out without a yes

Run it with `--dry-run` first. The dry run reads your account and channels when
you are signed in, prints the exact post and sends nothing. It works without a
login too, and then says what is missing. `--dry-run --json` prints the request
itself, and a real run sends that same request.

Read the plan as the person whose name the post goes out under. It shows:

- the file, with its size and hash
- the account and the channel
- the title and the text, with the hashtags
- the privacy
- the AI label, and whether that place takes it
- "made for kids", which only YouTube takes
- the link to the video, when the service needs one, and the size of the file there
- that it is a draft, with `--draft`

A real run prints the same plan first. In a terminal, you have to type `yes`.
Without a terminal it needs `--yes`, and without that it prints the plan, sends
nothing and fails. A coding agent shows the plan to the user and adds `--yes`
only after the user said yes.

### Which package goes where

This is the whole list. Any other pair stops before anything is uploaded or sent.

| Package | `--via youtube` | `--via buffer` | `--via blotato` |
| --- | --- | --- | --- |
| `youtube`, `shorts` | yes | a YouTube channel | a YouTube account |
| `tiktok` | no | a TikTok channel | a TikTok account |
| `reels` | no | an Instagram channel, as a reel shared to the feed | an Instagram account, as a reel |
| `linkedin` | no | a LinkedIn channel | your own LinkedIn profile |
| `x` | no | an X channel | an X account |

YouTube gets the title in its own field and the description with the hashtags
as the text. `--via youtube` also sends `category` and `made_for_kids`. Every
other place has one text field, and it gets `text` from the package. `publish`
never adds the credits to a post.

When your Buffer or Blotato account has one channel or account on that network,
`publish` takes it. When it has more, the plan lists them, and `--channel <id>`
for Buffer or `--account <id>` for Blotato picks one. Buffer channels that are
locked or disconnected are never offered.

### Privacy

| Where it goes | Without `--privacy` | `--privacy` |
| --- | --- | --- |
| YouTube on all three routes | `private` | `private`, `unlisted` or `public` |
| TikTok through Blotato | private, only you can see it | `private` or `public`. `unlisted` is refused |
| TikTok, Instagram, LinkedIn and X through Buffer, and Instagram, LinkedIn and X through Blotato | public right away, because there is no such setting | refused |

A value a place can't honour is refused before anything is sent, and never
ignored. The plan says when a post goes public right away. Posts to
YouTube don't notify your subscribers.

### Where the video comes from

YouTube gets the file from your computer. Buffer needs a public https link to
the file, and Blotato takes the file or a link. The part of each route says
more.

Before a post that uses a link, `publish` asks the link for the size of its
file. It sends a HEAD request, and asks for the first byte when the host
refuses HEAD. When the size differs from `video.mp4`, or the host doesn't say
it, `publish` stops and sends nothing, because the service would post whatever
the link leads to. The plan shows what it found as `Link size`. If you are sure
that the link is right, `--media-url-unchecked` posts it without this check.

### Signing in

Each route signs in with `explainroo connect` and the name of the service. The
part of each route has the steps.

The link from `connect` is never opened for you. The address you paste back
holds a code that works once, and only with what `connect` saved on this
computer, so it is safe on a command line, unlike a key.

### When something goes wrong

Each post has a job in `history/` with a stage, so `publish` knows what went
out. Running the same command again reads the stage:

| Stage | What happened | Running it again |
| --- | --- | --- |
| `planned` | You approved it, and the post never went out | goes on after a yes, with the request you approved |
| `media_uploaded` | Blotato has the file, and the post never went out | goes on after a yes, without uploading again |
| `sending` | The post went out, and no answer was saved | stops, because the post may exist. Look at the channel, then `--new` posts again |
| `accepted` | The service took the post | reads the status and posts nothing |
| `finished` | The post is there | prints the status and the link, and posts nothing |
| `failed` | The service says the post failed | stops. `--new` posts again |

A request that makes a post is never sent again by itself, because nobody can
tell whether the first one worked. Reading a status may try again. Uploading
the file to Blotato again is safe, because that makes no post. When a service
says it has had too many requests, `publish` stops and says when to try again.

The same file can't go to the same channel twice by accident. Two channels are
two places, so the same file can go to each of them once. `--new` posts the
same file to the same place again on purpose.

### After the post

`publish` reads the status back and prints it with the link.

## YouTube

**YouTube** gets the file from your computer, as an upload that can go on
after a break.

**YouTube** uses a Google client that you make in your own Google Cloud project:

1. Open console.cloud.google.com and make a project, or pick one of yours.
2. Turn on the YouTube Data API v3 for that project.
3. Set up the OAuth consent screen, and add your own Google account as a test
   user.
4. Under Credentials, make an OAuth client ID of the type Desktop app, and copy
   its client id and client secret.
5. Run `explainroo connect youtube` and paste them when it asks. Without a
   terminal, send them on stdin as two lines with `--key-stdin`, the id first.

Then it prints a link. Open it, sign in and approve. The browser then goes to
`http://127.0.0.1:8976/callback` and shows an error page, because nothing runs
there. That is expected. Copy the whole address from the address bar and run:

```bash
explainroo connect youtube --callback-url '<the address>'
```

That checks the sign-in, reads your channel and saves the login. While your
Google project is in testing status, Google ends the login after 7 days. Then
run `connect youtube` again to sign in. On 2026-11-07 a Google project could upload
100 videos a day through the API.

When a YouTube upload breaks off, `publish` asks YouTube how much arrived and
goes on from there, in the same run or the next one. Asking does not start a
second upload. The upload address is kept in `history/private/`, which git leaves out.
When YouTube no longer knows the upload, `publish` stops, and `--new` starts a
new one.

After the post, `publish` reads the status back and prints it with the link.
On YouTube that is the upload status, the privacy and the processing. YouTube
gets no cover and no
captions from `publish`. They are in the package folder, as `video.cover.jpg`
and `video.srt`, for you to add in YouTube Studio.

## Buffer

**Buffer** has no upload, so it needs a public https link to this exact
file. Pass your own with `--media-url`. Once the hosted service runs,
`explainroo share <project> --platform tiktok` can make one, and `publish`
takes the link from it. A link to `out/video.mp4` doesn't count for a TikTok
package, because the package has its own file. Buffer fetches the video from
the link when it posts it, so the link has to stay up until then. The plan
warns when the link expires within a day.

**Buffer** signs in with a public client that comes with explainroo, so you
don't make one yourself. A public client has no secret. Run
`explainroo connect buffer`. It prints a link and works the same way as
YouTube, with `connect buffer --callback-url '<the address>'` at the end. Here
the browser goes to `https://localhost:8976/callback`.

Buffer gives a new refresh token each time the login is renewed and ends the
whole login when an old one comes back. `publish` saves each new one before it
uses it, so don't put an older copy of the `.env` file back.

To sign in with a Buffer client of your own, put its client id in
`BUFFER_CLIENT_ID`, in the settings `.env` or in the environment. Make it a
public client with the redirect address `https://localhost:8976/callback`, and
allow these permissions:

- `account:read`
- `posts:read`
- `posts:write`

The login then saves the client id next to its tokens, because only that client
can renew it.

### Save a draft in Buffer

```bash
explainroo publish videos/<name> --via buffer --platform tiktok --draft --dry-run
```

`--draft` saves the post as a draft in your Buffer, and nothing is published.
When you want it to go out, open Buffer and schedule it there. `publish` reads
the draft back and prints its status, which is `draft`. Only `--via buffer`
takes `--draft`, and the other routes refuse it.

A draft counts as the post of this file to that channel. A second `publish` of
the same package sends nothing, with or without `--draft`. `--new --draft`
saves another draft, and `--new` alone posts the file.

A run that stopped before anything went out goes on only with the same choice.
After a post that was to go out right away stopped, a run with `--draft`
stops before it sends anything, and after a draft stopped, a run without
`--draft` does the same. `--new` starts a fresh one.

The link to the video has to work until Buffer posts the draft, after you
schedule it.

## Blotato

**Blotato** gets the file uploaded to its own storage first, unless you pass
`--media-url`. Blotato's reference says such links must be on its own
domain, and another page says any public link works. Without `--media-url` it
works either way.

**Blotato** uses an API key. Creating one ends Blotato's free trial and starts
its paid Starter plan, so decide that first. Then run
`explainroo connect blotato`. Some keys end in `=`, and that is part of the key.

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

Sharing the same file again from this project folder prints the link it already
has and uploads nothing. `--new` uploads it again. A copy of the project made
with git has no `history/private/`, so its first `share` uploads the video
again.

| What happens | What `share` says | Run it again |
| --- | --- | --- |
| Nothing answers at the address | The video was not sent | Yes |
| The connection fails its security check | The video was not sent | Yes, once the address or the network is fixed |
| The address has no service yet, like a 404 or a web page | No share link was made | Yes |
| The connection drops during the upload, it takes too long, or the server fails | The server may have received the video | Only with `--new` |
| The key is wrong, or the server wants one | No share link was made, and it never uploads without the key | Yes, after you fix the key |
| The server refuses the file | The server's reason | Yes, after you change the file |
| Too many uploads | When to try again | Yes, later |
| The server could not check the file in time | Nothing was published | Yes, later |

`EXPLAINROO_CLOUD_URL` replaces the address, for example for a test server. It
is read from the environment only, and never from a `.env` file.

## Test servers

For a test server, these replace the addresses. They are read from the
environment only, and never from a `.env` file.

| Variable | Replaces |
| --- | --- |
| `EXPLAINROO_YOUTUBE_URL` | `https://www.googleapis.com` |
| `EXPLAINROO_YOUTUBE_AUTH_URL` | `https://oauth2.googleapis.com` |
| `EXPLAINROO_BUFFER_URL` | `https://api.buffer.com` |
| `EXPLAINROO_BUFFER_AUTH_URL` | `https://auth.buffer.com` |
| `EXPLAINROO_BLOTATO_URL` | `https://backend.blotato.com/v2` |
| `EXPLAINROO_MEDIA_CHECK_URL` | the host of a video link, for its size check. The host and the path of the link go after this address |
