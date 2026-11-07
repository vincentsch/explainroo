# Adding a service

A service is an outside company's API that a step of making a video can use. It
takes three things to add one: an entry in a data file, one small file of code,
and one test against a fake server. Anyone can send one as a pull request.
Nothing about payment is implied, and a service from another company runs on the
user's own key or login.

## 1. The data entry

Add an entry to `src/services.json`. The website can read the same file later.

```json
{
  "id": "elevenlabs",
  "step": "voice",
  "name": "ElevenLabs",
  "about": "A company that turns text into speech. It has its own voices and can clone one. It speaks every language explainroo has, German included.",
  "free": false,
  "partner": false,
  "status": "available",
  "cost": "Paid per character on your ElevenLabs account.",
  "data_leaves": "The narration text goes to ElevenLabs.",
  "setup": {
    "env": ["ELEVENLABS_API_KEY"],
    "url": "https://elevenlabs.io",
    "steps": ["Make an account at elevenlabs.io.", "..."],
    "use": "Run \"explainroo voices --provider elevenlabs\" to see the voices."
  },
  "voice": { "keys": ["id", "model"], "defaults": { "model": "eleven_multilingual_v2" } }
}
```

- `step` is `voice`, `timing`, `images`, `clips`, `music`, `sharing` or `posting`.
- `free` means it costs no money at all to use. Within a step, free entries come
  first, and every step starts with a free entry.
- `status` is `available`, or `coming` when the code works but the service does
  not run yet.
- Write `about` for someone who has never heard of the company.
- `voice` only appears on a voice provider. It lists the settings `video.json`
  may give, and `normalizeConfig` checks them.
- `connector` is for a second entry that uses the same account and key as another
  one. `openrouter-video` has `"connector": "openrouter"`, and needs no file of its own.
- `setup.login` is `"oauth"` for a service that signs in through the browser
  instead of taking a key. `setup.env` then lists the lines a login saves.

## 2. The connector

Add one file in `src/connectors/`, and one line in `src/connectors/index.js`. No
connector is ever loaded from a project folder, because a connector runs with the
user's keys.

```js
const connector = {
  id: 'elevenlabs',                        // the same id as the data entry
  name: 'ElevenLabs',
  baseUrl: 'https://api.elevenlabs.io',
  key(dir) {},                             // finds the key with findEnv, or throws a ProjectError that names "explainroo connect"
  async test(key) {},                      // checks a key without spending money, and throws a ProjectError if it fails
  async speak(project, scene, text, { previous, next }) {},   // what the service does, here 24 kHz { audio, sampling_rate }
  speed(wanted) {},                        // the speed this service will use
  speedRange: [0.7, 1.2],
  async voices(dir, { language }) {},      // optional: adds "voices --provider elevenlabs"
};
export default connector;
```

A voice reads one sentence per request. One that reads several sentences in one
go has `chunks: 'pauses'`, so each request runs from one pause or paragraph to
the next. A voice that is told the language has `language(code)`, which turns
explainroo's language code into the service's. The language is then part of each
request and of the key it is saved under. `src/connectors/cartesia.js` does both.

A service that signs in through the browser has no `key`. It has these instead:

- `signIn`: the sign-in address, the token address, the redirect address and the
  scopes
- `login(dir)`, which says whether a login is saved
- `test(accessToken)`
- `loginLines(tokens)`, the lines a new login saves

`src/oauth.js` holds the two steps of the sign-in and the refreshing of tokens,
and `src/connectors/youtube.js` and `src/connectors/buffer.js` use it.

Build each address with `serviceUrl(connector)` from `src/services.js`. It lets
`EXPLAINROO_ELEVENLABS_URL` replace the base address. That variable is read from
the environment only and never from a `.env` file, so a stranger's project can't
send a user's key somewhere else.

Call `rememberSecret` from `src/errors.js` on every key you read. A key must never
appear in an error message, in the record or in `--json` output.

Throw a `ServiceError` when a paid request ends without a result. Its outcome goes
in the project record and decides what happens next:

| Outcome | When | Next time |
| --- | --- | --- |
| `refused` | The service said no (401, 402, a bad request), or nothing was sent. It cost nothing | The same command tries again |
| `failed` | The service answered with an error after the work may have started | The command stops and asks for `--new` |
| `lost` | No answer came back, so nobody can tell what it cost | The command stops and asks for `--new` |

A connector never sends a paid request again after a timeout or a dropped
connection, because the first one may have been charged. One more try after a
clear 5xx answer is fine.

## 3. The test

Add the service's routes to `ROUTES` in `test/helpers/fake-services.js`, and test
the connector through the real command line. `test/connected-cli.test.js` shows
how, with a counter on every paid request. Run `npm test` and `npm run test:pack`.

Tests never reach the real network. The test guard stops every request that is
not to this computer.

## Rules for buying

Anything that costs money goes through the project record in `src/history.js`.
`decide` says what to do with a request: buy it, use what was bought, or stop and
explain. `createJob` claims the request with an exclusive open before anything is
sent, so of two commands running at once, only one can buy. `src/images.js` is the
short example to copy, and `src/ai-clips.js` shows a job that keeps running at the
service. A new kind of job also says where its output may be, in `outputPlaces`,
and how it continues, in `CONTINUE`.
