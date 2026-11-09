# Cutting your own recording

`explainroo cut <video>` edits a video that you recorded yourself, like a talk
to the camera or a screen recording with your voice. You cut it by its words,
and it needs no project. The speech model runs on this computer, so nothing
leaves it.

## Make the cut list

```bash
explainroo cut talk.mp4
```

The speech model listens to the video and writes `talk.cut.md` next to it.
Each line is one sentence, and each word has its time in seconds:

```text
[pause 1.21s @0.00] Hi,@1.21 I@1.73 am@1.80 going@1.94 to@2.10 show@2.22 you@2.46 how@2.66 it@2.88 works.@3.08
[pause 1.29s @4.14] First@5.43 you@5.60 open@5.82 the@6.10 settings.@6.26
[sound 0.82s @6.52] I'm@7.34 sorry@7.52 first@7.84 you@8.24 open@8.54 the@8.84 main@8.96 page.@9.16
```

A `[pause]` is a quiet stretch of 0.6 seconds or more. A `[sound]` is sound
without words between two words, like "um" or a cough. The speech model
leaves those out of its words, so cut shows them this way.

For a recording in another language, add `--language es`. cut doesn't write
over a cut list that is already there, because it may hold your edits.
`--force` writes it again from the recording.

## Edit it

- Delete a word to cut it out. Delete a whole line to cut the sentence.
- Delete a `[pause]` to shorten it to 0.25 seconds. To keep more of it, change
  its seconds, like `[pause 0.5s @4.14]`.
- Delete a `[sound]` to cut it out.
- Leave everything else as it is. The cut only takes things out, and it keeps
  the order of the recording. When a word has no time, or a time that isn't in
  the recording, cut stops and names the line.

## Apply it

```bash
explainroo cut talk.mp4 --apply
```

This writes `talk.cut.mp4`, or the file that `--out` names. At each join the
sound goes to the quietest moment close to the word and crossfades over 30 ms,
so a join doesn't click. The picture cuts at the frame closest to that moment.
The sound is leveled to -14 LUFS with its peak held at -1 dBTP, like a video
that explainroo renders.

Then the speech model listens to the cut and says how much of the kept words
it heard. It names a kept word that it didn't hear, because a join may cut into
it. It also names a word it heard that the list cut out, which may be left from
that word. Listen at those times. The speech model times words to about a tenth
of a second, so a cut in fast speech can keep a bit of the word next to it.

Then check the cut like any other video:

```bash
explainroo verify talk.cut.mp4
```
