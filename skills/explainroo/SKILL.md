---
name: explainroo
description: Make an explainer video (MP4) with a voice-over using explainroo. The voice is made on this computer and no API key is needed. Use when the user asks for an explainer, how-to, walkthrough, launch or tutorial video, an animated diagram with a voice-over, or a short for YouTube, Reels or TikTok.
---

# Make an explainer video with explainroo

explainroo makes an MP4 video from two files: a script with the words the
voice says, and a small JavaScript file that draws the pictures. A voice
model on this computer reads the script. explainroo writes down when each
word is spoken, Chrome draws the frames, and explainroo adds music and sound
effects.

## Set it up

It needs Node.js 20.11 or newer, ffmpeg, and Chrome or Chromium. You do not
need to clone anything. Run this once. It checks the computer and downloads
the speech models the first time, about 400 MB.

```bash
npx --yes explainroo doctor --fetch
```

## Read the instructions

```bash
npx --yes explainroo docs
```

This prints the steps, the writing rules, the settings and the Scene API,
which is the list of everything `scenes.js` can draw. Read it before you
start. In those instructions, `explainroo` is short for
`npx --yes explainroo`.

## Make the video

Create the project where the user wants it, for example `./video`:

```bash
npx --yes explainroo init video --theme paper --title "..."
```

Then follow the steps from `docs`. When the video is done, tell the user
where `video/out/video.mp4` is, how long it is, and what
`npx --yes explainroo verify video` said.
