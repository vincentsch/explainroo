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

The speech model often ends a word a little early, before its last sound, like
the "s" of "settings". So cut reads the sound after each word itself, and the
word keeps whatever follows it without a gap, up to 0.4 seconds. A `[sound]`
that still starts right after a word says so, like
`[sound 0.30s @6.70 may hold the end of "settings"]`. Listen to it before you
delete it, because it may be the end of that word.

`--min-gap 0.3` shows pauses from 0.3 seconds and shorter, quieter sounds, like
a short "uh" between two words. Without it, a pause is 0.6 seconds or more.

For a recording in another language, add `--language es`. cut doesn't write
over a cut list that is already there, because it may hold your edits.
`--force` writes it again from the recording. When you edited the list, it
first moves it to `talk.cut.old.md`, or `talk.cut.old-2.md` when that is
there, and says so.

## Edit it

- Delete a word to cut it out. Delete a whole line to cut the sentence.
- Delete a `[pause]` to shorten it to 0.25 seconds. To keep more of it, change
  its seconds, like `[pause 0.5s @4.14]`.
- Delete a `[sound]` to cut it out. To keep part of it, change its seconds,
  like `[sound 0.25s @6.52]`, which keeps the first 0.25 seconds.
- To fix where a word starts, change its time. A word may move between the
  end of the word before it and its own end, and after a pause or a sound
  only later. The speech model sometimes puts
  the start of a word too early, inside the word before it. When you deleted
  that word, a bit of it stays in the cut, and moving the kept word's time
  later puts the join where the word really starts, like `first@8.08` in place
  of `first@7.84`. A time outside that range stops with the range, like
  `"first@8.30" can move between 7.84 and 8.24`.
- Leave everything else as it is. The cut only takes things out, and it keeps
  the order of the recording. A pause or a sound keeps its time, and only its
  seconds change. When a word has no time, or a time outside its range, cut
  stops and names the line.

## Apply it

```bash
explainroo cut talk.mp4 --apply
```

This writes `talk.cut.mp4`, or the file that `--out` names. At each join the
sound goes to the quietest moment close to the word and crossfades over 30 ms,
so a join doesn't click. After a deleted word, it looks for that moment only
between the end of the deleted word and the start of the kept one, so it never
reaches into the word you cut. At a word whose time you changed, the join is
at that time. The picture cuts at the frame closest to the join.

cut lists every join: where it is in the cut, and where the recording stops
and starts again there, both as planned from the word times and as they
landed, with the word after the join and its line in the cut list:

```text
  4.53 s in the cut: stops at 5.32 s (planned 5.43), starts at 8.08 s (planned 8.08), before first@8.08 on line 17
```

The sound is leveled toward -14 LUFS with its peak held at -1 dBTP, like a video
that explainroo renders. When the peak limit holds it quieter, cut says so,
and it always says the loudness it reached.

Then the speech model listens to the cut and says how much of the kept words
it heard. It names a kept word that it didn't hear, because a join may cut into
it. When you deleted a word or a `[sound]` right next to it, it names that as
the likely cause, so you know what to keep. It also names a word it heard that
the list cut out, which may be left from that word. Each time is given in the
cut and in the recording, so you can find it in the cut list. Listen at those
times. The speech model times words to about a tenth of a second, so a cut in
fast speech can keep a bit of the word next to it. When it hears something
right after a join that follows a deleted word, the join may sit in that word,
and cut names the time to move later and its line.

To try a cut list first, add `--dry-run`:

```bash
explainroo cut talk.mp4 --apply --dry-run
```

It reports the joins, the new length and the words it didn't hear, the same way,
and writes no file.

Then check the cut like any other video, and look at its picture:

```bash
explainroo verify talk.cut.mp4
explainroo sheet talk.cut.mp4
```

`verify` checks the sound and finds black or frozen stretches, but it can't
tell whether the picture is the right one. `sheet` writes `talk.cut.sheet.jpg`,
a frame every few seconds with its time, so open it and look. `still
talk.cut.mp4 4.5` writes the frame at 4.5 seconds, to see a join up close.

For a video that isn't an explainroo project, small text is only a hint. Text
in your recording, like a clock or a terminal, may be fine where it is.
