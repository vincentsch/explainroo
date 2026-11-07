# AI video clips

`explainroo clip` buys a short video clip that an AI model makes from a text
prompt. It goes through OpenRouter, on the same key as images. The clip lands in
`assets/clips/` as an MP4 and plays through `s.clip`.

Clips cost money, so the user decides. Run `explainroo services clips --json` and
tell the user the options, free ones first. Their own footage is free.

## What clips are good and bad at

Clips are good for short shots of the real world, such as a street, food, weather
or hands. They also work for a mood, or for a moment between two ideas.

Clips are bad at these things:

- **Readable text and numbers.** Letters and digits come out wrong.
- **Diagrams, app screens and logos.** The model draws something that looks close,
  and a viewer may believe it.
- **The same character across clips.** Each clip is made on its own, so a person or
  an object looks different in the next one.
- **Timing to a word.** You can start a clip on a word, but nothing inside the clip
  follows the voice.

When the content must be exact, use drawings and screenshots instead. Do not ask
for real people.

On the default model a clip costs more than an image, and
a failed try may cost money too. Use one where a drawing can't do the job.

## See the price first

```bash
explainroo clip videos/<name> "A busy street at dusk in the rain" --seconds 6 --dry-run
```

This prints the model, the length, the size and the price, and spends nothing. It
needs no key and no cap, because OpenRouter's list of models and prices is public.
Show the price to the user and ask how much they want to spend. Then pass that
amount in US dollars as the cap:

```bash
explainroo clip videos/<name> "A busy street at dusk in the rain" --seconds 6 --max-cost 2
```

A run that buys needs `--max-cost`. When the price is above the cap, or can't be
worked out, the command stops before any request goes out. The price is an
estimate. The real cost goes in the record after the job, and the command says so
if it came out above the cap.

The file is `assets/clips/<name>.mp4`, and the command prints the line to use:

```js
s.clip('assets/clips/a-busy-street-at-dusk-435f.mp4', { w: s.safe.w, h: s.safe.h, fit: 'cover', at: 0 });
```

Put the word the clip should start on in `at`. Open a still of that scene with
`explainroo still` and check the clip before you keep it. `check` can't read
anything inside a clip.

| Option | What it does |
| --- | --- |
| `--seconds` | The length, which the model must list. Required. |
| `--max-cost` | The most it may cost, in US dollars. Required when it buys. |
| `--dry-run` | Shows the price and spends nothing. |
| `--aspect` | `16:9` by default for a wide project, and `9:16` for anything else. `fit: 'cover'` crops either one to a square or 4:5 frame. |
| `--model` | `cheap` (the default) is `google/veo-3.1-lite`, and `quality` is `google/veo-3.1`. A full OpenRouter id works too. |
| `--resolution` | `720p` by default. The model must list it. |
| `--audio` | Asks for sound. Sound is off by default, because `s.clip` plays silent unless you set `volume`, and sound often costs more. |
| `--name` | The file name. By default it is a short name from the prompt. |
| `--no-wait` | Returns right after the request. The same command looks at the job again later. |
| `--new` | Buys it again, as a new attempt. It needs a cap. While the last try of the same request is still running, it picks that one up instead. |
| `--resume <id>` | Continues a job with the short id that `explainroo history` prints. |

The length, the aspect and the resolution are checked against the model's own list
before anything is spent, and the error says what is allowed. A model with no price
per second can't be used, and the error suggests another one.

## How the price is worked out

The tool reads OpenRouter's list each time, because a price saved in the npm
package would get out of date. A model lists several rates, and four steps pick one. A later step never
undoes an earlier one.

1. **What it makes.** Only rates for text to video count, and not the ones for images
   or video going in.
2. **Sound.** A request with sound only uses a rate that says so, or a plain rate if
   the model never mentions sound. It never uses a silent rate. A silent request
   prefers a silent rate, then a plain one, then one with sound, which can only
   overstate the price. A model that can't turn its sound off counts as sound.
3. **Size.** A rate for the exact size wins over one with no size. A rate for another
   size never applies.
4. **Minimum.** The price is the rate times the seconds, or the model's minimum charge
   if that is larger.

## If something goes wrong

A job has a record in `history/` from before the request goes out, and the job id is
saved right after the answer. explainroo never sends the request a second time on
its own. So the command can stop at any point, for example when an agent's command
times out, and running it again is safe.

| What happened | What to do | Can it cost more? |
| --- | --- | --- |
| The command stopped or timed out while the job was running | Run the same command again, even if it has `--new`, or `clip <project> --resume <id>` | No. It only reads the job and downloads the file. |
| Another run is sending the same request right now | The command says so. Run the same command again a minute later, without `--new`. It picks up that job. | No |
| It waited about ten minutes and the job is still running | The same | No |
| The same command runs again after the file is there | It returns the file | No |
| The request went out and no answer was saved | The command stops and says so. It may or may not have gone through, and your OpenRouter activity page shows what was charged. `--new` buys it again. | Yes, with `--new` |
| The job failed, was cancelled or expired, or the file is gone from OpenRouter | The record says so. `--new` buys it again. | Yes, with `--new`. The failed try may have cost money too. |
| The file failed the check (no video, or the wrong length) | It is kept in `history/failed-check/`. `--new` buys it again. | Yes, with `--new` |
| OpenRouter refused (no credit, a bad key) | Fix that and run the same command. | No. The refused request cost nothing. |

OpenRouter keeps a finished file for a short time and doesn't say how long, so don't
leave a job for days before you fetch it. `explainroo history` lists every clip job
with its file and cost, and open jobs with the command that continues each one.

Two prompts can use the same `--name`. The older file moves to `history/replaced/`,
and asking for it again brings it back for free.

## What leaves this computer

The prompt goes to OpenRouter and to the company that runs the model. Video jobs are
not covered by OpenRouter's zero data retention, because the provider has to keep the
result for a short time so that you can fetch it. Your API key stays in your `.env`
file and goes only to OpenRouter.
