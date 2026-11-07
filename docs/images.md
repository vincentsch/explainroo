# Images

explainroo can make illustrations with AI image models through OpenRouter.
This is optional. It costs money on the user's OpenRouter account, roughly 7
to 13 cents per image at the time of writing.

If the user wants images and there is no key, run
`explainroo connect openrouter` and show the user what it prints. The same key
makes AI video clips, and `explainroo docs clips` says how.
`explainroo docs settings` says where the key goes.

```bash
explainroo image videos/<name> cables "Two cars parked nose to nose with their hoods open, jumper cables between the batteries"
explainroo images videos/<name>    # what was made and what it cost
```

This saves `assets/cables.png`. Use it in a scene with
`s.image('assets/cables.png', { w: 1100, frame: 'card', at: 'cables' })`.

The same command again returns the same file and spends nothing. Changing the name,
the prompt or a setting makes a new image, and `--new` buys this one again. A
purchase never deletes a file: the old `assets/cables.png` moves to
`history/replaced/`, and asking for its request again brings it back. A request
that failed or got no answer may have cost money, so it needs `--new`.

- `--model best` (default) uses OpenAI GPT Image 2. It does what you ask and
  is worth the price for most images.
- `--model cheap` uses Google Gemini 3.1 Flash Image. It costs about half,
  but it often ignores parts of the prompt.
- `--aspect` sets the shape of the image: `16:9` (default for landscape
  videos), `9:16`, `1:1`, `4:3`, `3:2` and their portrait forms.
- `--ref assets/a.png` sends an earlier image along, so a person or object
  keeps the same look. Separate several files with commas.
- Every image gets a default style (flat, soft colors, no text). Set your own
  in `video.json` with `"images": { "style": "...", "model": "best" }`, or
  turn the style off with `--no-style`.

**Always open every image and check it.** Image models get details wrong:
extra fingers, cables on the wrong terminal, text that looks like writing but
is not. If anything is wrong, change the prompt and make the image again.
Keep text out of images. Put words on screen with `s.text` instead. Use
images for things icons cannot show, and keep one style through the whole
video.
