# How to write the narration

Unless the user asks for another style, write the way a person explains
something to a friend at a table.

- Use regular, down-to-earth English and everyday words. Explain things in
  simple terms. If you need a technical word, say what it means the first
  time.
- Keep sentences short, about 8 to 18 words, one idea each.
- Say who does what: "The browser asks a resolver."
- Every sentence adds a fact. Cut half sentences that repeat something.
- Do not use em dashes or dashes between phrases. Use a comma or a new
  sentence.
- Leave out slogans and punchlines ("Just code."), "not X, but Y" twists,
  colon reveals, chains of three short sentences, metaphors, and filler words
  like "just", "simply", "really", "actually" and "exactly".
- Do not tell the viewer to do obvious things ("Let's dive in", "Stay tuned").
- End with a plain sentence that sums up the main point.

## Length and pace

- Aim for 45 to 120 seconds unless the user says otherwise. At the default
  speed the voice says about 13 letters a second, which is 165 to 200 words a
  minute in English, depending on how long the words are. A number takes
  longer than its digits suggest, because "1972" is said as "nineteen
  seventy-two". Some voices are slower, like `am_michael`, or faster, like
  `af_jessica`. In Japanese the voice says about 300 characters a minute, and
  in Chinese about 230.
- On top of the speech, each scene adds its lead and its hold, 0.35 and 0.7
  seconds by default, so 1.05 seconds. Each new sentence in a scene adds a
  pause of 0.3 seconds, and a new paragraph adds 0.55. The end of the video
  adds 1.4 seconds. So 105 words in 6 scenes make about 45 seconds, and a
  finished video has about 130 to 155 words a minute.
- Before the narration exists, `voice` and `check` print an estimate, like
  "about 45 s (43 to 47 s): 105 words of speech at about 180 a minute take
  35.0 s. The 6 scenes add 1.05 s each for their lead and hold, and the pauses
  between sentences add 2.1 s. The end of the video adds 1.4 s." The figures
  come from the settings of your video. The voice nearly always lands in the
  range, so aim the middle a little under a target. `explainroo voice videos/<name> --estimate`
  prints only the estimate, with what it means for `targetSeconds`, and makes
  nothing. When it is too long, cut words before you make the voice.
- For an exact length, set `"targetSeconds": 40` in `video.json`. It counts
  for every size, also a quicker one, unless the block of a size under
  `"sizes"` sets its own, or `null` for none. When the video comes out
  shorter, the missing time goes evenly into the holds of its scenes, so it
  ends at 40 seconds. When that adds more than 3 seconds to each scene, or
  when the video runs more than half a second longer, `voice` and `check` say
  so and name the longest scenes. Without `targetSeconds`, a video is as long as its narration.
- Start with the question or problem. Explain it in small steps. Give one
  concrete example, then sum up.
- One idea per scene, usually 1 to 3 sentences (4 to 15 seconds).
- Lists read aloud ("A, B, C and D") only work when each item appears on
  screen.

## Other languages

The rules above count in every language, but the filler words they name are
English. Leave out the same kind of word in the language of the video. The
estimate counts about 13 letters a second for every language with an
alphabet, so how many words fit in a minute depends on how long its words
are. For ordinary narration at the default speed, that is about:

| Language | Words a minute | Filler words to leave out |
| --- | --- | --- |
| English | 165 to 200 | just, simply, really, actually |
| Spanish | 175 | realmente, simplemente, básicamente |
| French | 160 | vraiment, simplement, juste |
| Italian | 180 | davvero, semplicemente, praticamente |
| Brazilian Portuguese | 185 | realmente, simplesmente, basicamente |
| German | 135 | eigentlich, einfach, wirklich |

For Hindi the estimate counts 150 words a minute, for Japanese 300 characters
and for Chinese 230. `voice --estimate` gives the figure for your own script.

## Script syntax

```markdown
# Title of the video

## scene-id {hold=1.5}
Narration for this scene. [#marker] A marker names a moment you can animate on.
[pause 0.6] adds silence. {SQL|sequel} shows "SQL" in captions but says "sequel".
*Stars* mark a keyword that bold captions show in color. Nobody hears them.
> Lines starting with > are notes for you and are not spoken.
```

- `## scene-id` starts a scene. The id must match a function in `scenes.js`.
- Put a `[#marker]` wherever a picture should change. Every sentence should
  trigger at least one picture. After `voice`, `explainroo words
  videos/<name>` lists the spoken words of every scene with their start times
  and the markers between them, so you can pick a word as a cue. Add a scene's
  name to list only that scene.
- Use `{shown|spoken}` for anything the voice may misread: acronyms
  spelled out letter by letter, with commas (`{CLI|C, L, I}`), versions (`{v2.1|version two point one}`), symbols and
  domains (`{example.com|example dot com}`, otherwise the voice says "example
  comm"). The speech check counts the word when it hears either form, so
  "example.com" confirms `{example.com|example dot com}`. It also counts what
  sounds the same as the spoken form, so "SoundRue.com" confirms
  `{soundroo.com|sound roo dot com}`. When `voice` still can't confirm a
  word that already has one, try another spoken spelling.
- When the check hears a name the way it is said, but written another way,
  like "Reg X 101" for regex101, accept that form in `video.json`:
  `"heard": { "regex101": ["reg x 101", "regex 101"] }`. A transcript with one
  of the forms where the script has the word confirms it fully, in `voice`,
  `check` and `verify`, without making the voice again. When `voice` hears a
  word the same way twice in a row, it prints the line to add. When a word
  comes up several times and is heard as the same other spelling each time,
  `voice` and `check` print it too.
- The speech check also counts a word heard as another word with the same
  sound, like "peace" for "piece", and two words heard as one, like
  "Seacosts" for "See costs". A word with hyphens counts when its parts are
  heard as separate words, like "well known" for "well-known". `check` lists
  them with the words that only nearly matched, each with its time in the
  video, or by name alone when there are more than two (`--verbose` adds the
  times). `{shown|spoken}` can't change how they are heard, and they need no
  fix unless one sounds wrong when you listen at that time.
- A word with an apostrophe, like "un'ape" or "l'eau", is confirmed fully
  when its letters are heard with a space or joined, like "un ape" or
  "unape". This works in every language.
- Punctuation that stands on its own, like the space before "?" in French, is
  not a word. It stays in the captions next to its word, and the speech check
  and the cues never wait for it.
- A scene can have these settings in the braces after its id: `hold`
  (seconds after the voice, default 0.7), `min` (the shortest the scene can
  be, in seconds), `lead` (seconds before the voice, default 0.35) and
  `transition` (`fade`, `slide`, `push`, `wipe`, `zoom`, `brush`, `cut`).
- A scene without narration lasts `min` seconds (default 3).
- `chapter="How the resolver finds it"` in a scene's braces starts a
  chapter at that scene. It lasts until the next chapter. Titles have 1 to
  60 characters. If the first scene names no chapter, the first chapter is
  the video title. YouTube shows chapters only when there are at least 3
  and each lasts 10 seconds or more. `check` gives hints about that for a
  16:9 landscape frame, like `16:9`, `youtube` or `1280x720`, and for a
  YouTube package. `voice --estimate`, and `voice` or `check` before they
  make the narration, say from the length estimate which chapters will likely
  be under 10 seconds.
