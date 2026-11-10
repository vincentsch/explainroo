# Presenters

A presenter is a person on screen who talks next to the product. Explainroo
can play one of two kinds:

| Choice | Cost | What leaves the computer |
| --- | --- | --- |
| The user films themselves | free | nothing |
| An AI presenter from a presenter service | paid per second at the service | the narration of the scene, as sound, and the avatar's id |

Offer the free choice first, like every outside service. `explainroo services
presenters` lists both.

## Film yourself

The user records themselves saying the narration of a scene, with a camera
or a phone, and puts the file in `assets/`. Play it with its sound:

```js
s.clip('assets/me.mp4', { x: s.safe.right - s.safe.w * 0.15, y: s.cy, w: s.safe.w * 0.28, h: s.safe.h * 0.74, fit: 'cover', frame: 'card', volume: 1 });
```

When the recording is the narration of the whole video, read
`explainroo docs voices` about `"provider": "recording"`.

## The consent rule

Explainroo never makes a real person's face or voice without the consent flow
of the presenter service. That rule has no setting to turn it off.

- An avatar with a real person's face needs that person's verified consent
  for their face, from the service's own consent flow.
- Narration from a recording is a real person's voice. With it, the avatar
  needs verified consent for that voice too. A made-up voice like Kokoro
  works with any made-up avatar.
- Explainroo sends no photo and no voice sample of its own. A person who
  wants a presenter of themselves goes through the service's consent flow,
  and the service then lists that avatar with the consent as verified.

`presenter` refuses anything else before a request goes out, so a refusal
costs nothing. When the user asks for a presenter of a real person, tell them
about the consent flow. Never try to get around it.

## The AI label

Every platform asks to label realistic AI people. Once a presenter clip is
made, every package of the video gets the AI label, with the presenter named
in its reasons and its credits. `"ai_label": false` in `post.json` can't turn
it off, and `package` says so. The package's `post.json` also has
`"ai_presenter": true`, and `publish` always sends the label for it. `s.presenter`
puts a small "AI presenter" label under the clip, and `label: false` leaves it
out. Keep it when the platform has no AI label of its own.

## Make an AI presenter

No presenter service is built in yet, so this needs a service that the user
picked, which speaks the API below. Its address goes in
`EXPLAINROO_PRESENTER_URL`, and its key in `PRESENTER_API_KEY`.

```bash
explainroo voice videos/<name>
explainroo presenter videos/<name> --avatars
explainroo presenter videos/<name> intro --avatar ava --dry-run
explainroo presenter videos/<name> intro --avatar ava --max-cost 1
```

- `--avatars` lists the service's avatars, each as a made-up or a real
  person, with its consent and its price. It marks the ones the rule refuses
  for this project.
- The presenter speaks the narration of one scene, so run `voice` first.
  `--dry-run` shows what goes out and what it costs, and buys nothing.
- `--max-cost` is the most the clip may cost in US dollars. A clip that costs
  more is not bought. When the service gives no price for the avatar, the
  cost is unknown, so `presenter` buys nothing, and `--dry-run` says so.
- The clip is saved as `assets/presenters/<scene>.mp4`, or under `--name`.
  The same command never buys it twice. `--new` buys it again. When the
  service takes long, the same command fetches the clip later and buys
  nothing.

Show it in the scene:

```js
intro(s) {
  s.ui.backdrop();
  s.ui.browser(s.safe.left, s.safe.top, s.safe.w * 0.64, s.safe.h * 0.8, { url: 'acme.example', at: 0 });
  s.presenter('intro');
},
```

`s.presenter(name, options)` plays the clip without its sound from where the
scene's narration starts, so the lips follow the voice of the video. It
stands at the right of a wide frame and at the bottom of a tall one, in a
card it fills. It takes the layout and frame options of `s.clip`: `x`, `y`,
`w`, `h`, `fit`, `frame`, `at` and `out`. `label` sets the text under the
card. Leave the right third free in a wide frame, or the lower half in a
tall one.

## The API a presenter service offers

A service that wants to work with explainroo offers these four requests. Each
one takes the key as `Authorization: Bearer <key>`.

| Request | Answer |
| --- | --- |
| `GET /v1/avatars` | `{ "avatars": [{ "id", "name", "likeness", "consent", "usd_per_second" }] }` |
| `POST /v1/videos` with `{ "avatar", "consent_id", "audio", "aspect" }` | `{ "id", "status" }` |
| `GET /v1/videos/<id>` | `{ "status": "processing" \| "done" \| "failed", "url", "cost_usd", "error" }` |
| `GET <url>` | the MP4 |

- `likeness` is `"synthetic"` for a made-up person and `"real"` for a real
  person's face.
- `consent` is `{ "status": "verified" | "pending" | "none", "id", "covers" }`,
  where `covers` lists `"face"` and `"voice"`.
- `usd_per_second` is the price in US dollars. explainroo buys no clip of an
  avatar without one.
- `audio` is the scene's narration, a WAV file in base64. `aspect` is
  `16:9`, `9:16` or `1:1`.
- The service checks consent too, and answers 451 when it is missing.

`src/connectors/presenter.js` holds explainroo's side, and
`explainroo docs connectors` says how a service is added.
