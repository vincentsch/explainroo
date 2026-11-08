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

- Aim for 45 to 120 seconds unless the user says otherwise. A finished video
  has about 150 words a minute, pauses included. In Japanese it is about 270
  characters a minute, and in Chinese about 200.
- Start with the question or problem. Explain it in small steps. Give one
  concrete example, then sum up.
- One idea per scene, usually 1 to 3 sentences (4 to 15 seconds).
- Lists read aloud ("A, B, C and D") only work when each item appears on
  screen.

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
  trigger at least one picture.
- Use `{shown|spoken}` for anything the voice may misread: acronyms
  (`{CLI|C L I}`), versions (`{v2.1|version two point one}`), symbols and
  domains (`{example.com|example dot com}`, otherwise the voice says "example
  comm"). The speech check counts the word when it hears either form, so
  "example.com" confirms `{example.com|example dot com}`.
- The speech check also counts a word heard as another word with the same
  sound, like "peace" for "piece", and two words heard as one, like
  "Seacosts" for "See costs". `check` lists them with the words that only
  nearly matched. `{shown|spoken}` can't change how they are heard, and they
  need no fix.
- A scene can have these settings in the braces after its id: `hold`
  (seconds after the voice, default 0.7), `min` (the shortest the scene can
  be, in seconds), `lead` (seconds before the voice, default 0.35) and
  `transition` (`fade`, `slide`, `wipe`, `zoom`, `brush`, `cut`).
- A scene without narration lasts `min` seconds (default 3).
- `chapter="How the resolver finds it"` in a scene's braces starts a
  chapter at that scene. It lasts until the next chapter. Titles have 1 to
  60 characters. If the first scene names no chapter, the first chapter is
  the video title. YouTube shows chapters only when there are at least 3
  and each lasts 10 seconds or more.
