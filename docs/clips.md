# AI video clips

`explainroo clip` buys a short video clip that an AI model makes from a text
prompt. It goes through OpenRouter, on the same key as images. The clip lands in
`assets/clips/` as an MP4 and plays through `s.clip`. The same command run again
never buys twice, so it is safe after a crash or a timeout.

Clips cost money, so the user decides. Run `explainroo services clips --json` and
tell the user the options, free ones first. Their own footage is free. The list
also shows today's price per second of the cheap and the quality model, and the
lengths each one takes. When the user has already chosen clips and given a
budget, use them and don't ask again.

If the user chose clips and has no key, run `explainroo connect openrouter` and
show the user what it prints. One OpenRouter key makes images and clips, so a key
that already makes images needs nothing more.

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
Its `Takes:` line lists the lengths, aspects and resolutions the model takes, and
`explainroo services clips` lists them for the cheap and the quality model. On
2026-11-08 both took 4, 6 or 8 seconds.

The dry run also works without a project. Run it without the project folder,
somewhere that has no `video.json`:

```bash
explainroo clip "A busy street at dusk in the rain" --seconds 6 --dry-run
```

Without a project the price is for 16:9 at 720p without sound, unless the flags
say otherwise. In a project the aspect follows the project's frame, and the dry
run also says whether the record already has this clip. A dry run writes nothing, with or without a project. Buying needs a
project, because the clip goes into its `assets/clips/` and its record.

Show the price to the user and ask how much they want to spend, unless they
already said. Then pass that amount in US dollars as the cap:

```bash
explainroo clip videos/<name> "A busy street at dusk in the rain" --seconds 6 --max-cost 2
```

A run that buys needs `--max-cost`, or a budget for all clips. When the price is
above the cap, or can't be worked out, the command stops before any request goes
out. The price is an estimate. The real cost goes in the record after the job, and
the command says so if it came out above the cap.

When the user gives one amount for all the clips of a video, put it in
`video.json` as `"clipBudget": 0.40`, or pass `--budget 0.40` to `clip`. `--budget`
wins over `video.json`. Before each purchase, explainroo adds the clip's cap to
what the clips in the project's record already cost. When the sum is over the
budget, it stops before anything is sent and says how much is left. With a budget,
`--max-cost` is optional, and then the cap is what is left. A try whose cost isn't
known yet, like a job that is still running, counts at its estimate. The dry run
shows what is left and whether the clip fits:

```bash
explainroo clip videos/<name> "A busy street at dusk in the rain" --seconds 6 --dry-run --budget 0.40
```

The file is `assets/clips/<name>.mp4`, and the command prints two lines to use.
The first fills the whole frame, edge to edge, and the second fills the free area
inside the safe margins:

```js
s.clip('assets/clips/a-busy-street-at-dusk-435f.mp4', { full: true, at: 0 });
s.clip('assets/clips/a-busy-street-at-dusk-435f.mp4', { w: s.safe.w, h: s.safe.h, fit: 'cover', at: 0 });
```

Put the word the clip should start on in `at`. A clip shorter than its scene
holds its last frame until the scene ends. `speed: 'fit'` plays it slower or
faster, so that it ends with the scene, and `check` warns about any freeze
longer than 0.3 seconds. Open a still of that scene with `explainroo still`
and check the clip before you keep it. `check` can't read anything inside a
clip.

| Option | What it does |
| --- | --- |
| `--seconds` | The length, one that the model takes. Required. |
| `--max-cost` | The most it may cost, in US dollars. Required when it buys, unless there is a budget. |
| `--budget` | The most all clips of the project may cost together, in US dollars. It wins over `"clipBudget"` in `video.json`. |
| `--dry-run` | Shows the price and spends nothing. It works without a project too. |
| `--aspect` | `16:9` by default for a wide project and without a project, and `9:16` for any other project. `fit: 'cover'` crops either one to a square or 4:5 frame. |
| `--model` | `cheap` (the default) is `google/veo-3.1-lite`, and `quality` is `google/veo-3.1`. A full OpenRouter id works too. |
| `--resolution` | `720p` by default. The model must list it. |
| `--audio` | Asks for sound. Sound is off by default, because `s.clip` plays silent unless you set `volume`, and sound often costs more. |
| `--name` | The file name. By default it is a short name from the prompt. |
| `--no-wait` | Returns right after the request. The same command looks at the job again later. |
| `--new` | Buys it again, as a new attempt. It needs a cap. While the last try of the same request is still running, it picks that one up instead. |
| `--resume <id>` | Continues a job with the short id that `explainroo history` prints. |

The length, the aspect and the resolution are checked against the model's own list
before anything is spent, and the error says what is allowed. The dry run's JSON has
them in `takes`. When OpenRouter's list leaves one of them out for the cheap or the
quality model, explainroo's own table fills it in, and `takes.from` says `table`. A
model with no price per second can't be used, and the error suggests another one.

## How the price is worked out

`clip` reads OpenRouter's list each time, for a dry run and again right before it
buys, because a price saved in the npm package would get out of date. A model lists
several rates, and four steps pick one. A later step never undoes an earlier one.

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

`services clips` works out the price per second of the cheap and the quality model
from the same list in the same way, at 720p without sound. Under each model it says
what the model takes. It keeps the list it read
for a day in `~/.cache/explainroo/prices/`, or in `prices/` under `EXPLAINROO_CACHE`.
So its prices can be a day old, and it shows the date it read them. It shows the
range from 2026-11-07 instead in two cases, and it says which one:

- `EXPLAINROO_OFFLINE=1` is set. Then it asks for nothing.
- The list could not be read within a few seconds.

A model the list has no price for gets the range too. With the range, what each
model takes comes from explainroo's own table. A dry run always gives the quote for
the exact clip.

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

A dry run and `services` only ask OpenRouter for its public list of video models
and their prices. That request has no prompt and no key. `services` sends it at most
once a day, and only when it lists clips.
