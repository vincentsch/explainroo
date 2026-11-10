# Formats

A format is a ready way of making one kind of video. It brings a short guide
for you, scene helpers, settings for `video.json` and a whole example video.
Start from the format that fits the brief, then change the words and the
pictures.

## The formats that come with explainroo

| Format | For | Size and look |
| --- | --- | --- |
| `product-launch` | a launch video of about a minute: name and promise, the problem, the app at work, three features, where to get it | 16:9, `studio` |
| `narrated-explainer` | one idea in about a minute: a question, how it works, one number, why it matters, what to remember | 16:9, `paper` |
| `vertical-short` | a short of 20 to 60 seconds for Shorts, TikTok and Reels, with the hook in the first second | `vertical`, `midnight`, bold captions |
| `product-ad` | an ad of 15 to 30 seconds for a feed: a question, the product, three benefits, one offer | square, `studio`, bold captions |

`explainroo formats` lists them with the formats you installed, and
`explainroo formats <format>` prints the guide of one.

## Start a video from a format

```bash
explainroo init videos/<name> --format product-launch --title "Acme Notes"
```

`init` writes these into the new folder:

- `video.json` with the format's settings, and your flags on top of them, like
  `--size linkedin`
- `script.md` and `scenes.js` with the format's example, so the project is a
  whole video from the start
- `format.js` with the helpers, which `scenes.js` imports
- `format.md` with the guide, which `init` also prints

Read the guide, then write the narration for the user's topic. Keep the scene
names in `script.md` and `scenes.js` the same, and replace the example's words
and pictures. A format never makes up facts for you. The example's product and
its claims are made up, so none of them may stay in the user's video.

The helpers place words from `s.safe`, so most scenes also work in another
size. In a tall frame, `vertical-short` also fills the part below the
captions from `s.full`. Look at stills after you change the size.

## Install a format from Git

Anyone can publish a format as a Git repository. Install one with its address:

```bash
explainroo formats add https://github.com/<user>/<repo>.git
```

Without `--yes`, `formats add` installs nothing. It prints the git commands it
will run and where the format goes. Show that to the user, and run the same
command with `--yes` only after the user agreed. `--commit 3f2a9c1` installs
the format as it is at that commit. Without it, `formats add` takes the newest
commit and keeps it, so the format doesn't change under you later.

Git runs with its hooks off, so nothing in the repository runs while it
installs. `formats add` then checks the folder and refuses one that:

- has no `format.json`, `guide.md`, `video.json`, `script.md` or `scenes.js`
- has a guide of 4 KB or more
- has a symbolic link, even to a file in the format
- sets a voice that costs money
- has the name of a built-in format

The format goes into the cache, in the `formats` folder next to the models.
Installing it again replaces it.

Nothing from a format runs until you make a project from it. Its `format.js`
and `scenes.js` then run in the page that draws the frames, like any
`scenes.js`. `formats add` names those files. Read them before you use a
format from someone you don't know.

## Make and publish your own format

A format is a folder that is also a project, so its example renders as it is:

```
my-format/
  format.json   name, description, author and version
  guide.md      the guide for the agent, under 4 KB
  format.js     scene helpers that scenes.js imports
  video.json    the settings a new video starts with
  script.md     the example narration
  scenes.js     the example scenes, which import './format.js'
  assets/       files the example uses, if any
```

`format.json` looks like this:

```json
{
  "name": "recipe-card",
  "description": "A recipe in one minute: the dish, what you need, the steps and the result.",
  "author": "Jane Doe",
  "version": "1.0.0"
}
```

The name uses small letters, digits and `-`. Keep the description under 200
characters.

Some rules make a format work well for everyone:

- Write the guide for an agent that has never seen the format. Say what each
  scene is for and how to use each helper. Keep it under 4 KB.
- Place words from `s.safe`, with sizes from a hundredth of its short side,
  like the formats that come with explainroo. With `"defaults": "0.6"`,
  pictures in a tall frame may fill the rest of `s.full`.
- Show the subject on the first frame with `at: -1`, because feeds show the
  first frame as the cover.
- Use the free voice in `video.json`. The user picks a paid service.
- Run `explainroo voice`, `explainroo check` and `explainroo render` on the
  folder itself. The example passes `check` without errors or warnings.
- Leave `build/`, `out/` and `history/` out of the repository.

Push the folder to a public Git repository, with a license that lets others
use it. Tell people to install it with `explainroo formats add <address>`.

The author gets credit. `explainroo formats` shows the author of each format,
and `init` writes `post.json` with a line like "Format: recipe-card by Jane
Doe", so every package of a video made from it names the author in its credits.
