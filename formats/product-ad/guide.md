# Product ad

An ad of 15 to 30 seconds for a feed, square by default. It has one job: make
the right person want to try the product. It has four short scenes.

| Scene | Job |
| --- | --- |
| `hook` | A question the buyer says yes to, with a picture of the problem, on the first frame |
| `product` | The product's name and what it does, in one line |
| `benefits` | Three benefits, each in a few words |
| `offer` | One action and the address, on the brand color |

## Writing

- Keep it between 15 and 30 seconds. `"targetSeconds": 20` in `video.json`
  sets the length, and `voice` and `check` warn when the video runs longer.
- The voice starts at 0 seconds with the question, because many people watch
  ads without sound at first. Bold captions carry the words then.
- Write about 40 to 70 words in all, in short sentences.
- Use only facts the user gives you. Never make up a price, an offer or a
  number. Ask for the real ones.
- One offer and one address at the end. Say the address with
  `{example.com|example dot com}`.

## The helpers in format.js

- `hookQuestion(s, text, { icon, color })` shows the question and a picture
  of the problem at 0 seconds. A `\n` breaks the question into lines.
- `productShot(s, { name, icon, line, at, lineAt })` shows the product's mark
  in a tile, its name and one line.
- `benefits(s, [{ text, at }])` shows up to three rows with check marks.
- `offer(s, { name, action, url, at })` fills the frame with the brand color
  and shows the action.

Use a screenshot of the product with `s.image('assets/app.png', { frame:
'phone' })` in the product scene when the user has one. Put the brand's
colors, fonts and logo in `"brand"` in `video.json`, from
`explainroo capture`.

## Sizes

Square suits most feeds. Set `"size"` to `linkedin` for 4:5, or to `reels` or
`tiktok` for a tall ad. The helpers place everything from `s.safe`, so they
fit each size.
