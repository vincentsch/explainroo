# Voices

Kokoro runs on this computer and needs no key. Pick a voice with
`explainroo voices`. A string in `video.json` keeps using Kokoro:

```json
"voice": "af_heart"
```

`{ "provider": "kokoro", "id": "af_heart" }` means the same thing.

ElevenLabs has its own voices and can clone one. It costs money on the user's
account and receives the script text. If the user wants it and there is no
key, run `explainroo connect elevenlabs` and show the user what it prints.
`explainroo docs settings` says where the key goes.

```bash
explainroo voices videos/<name> --provider elevenlabs
explainroo voices videos/<name> --provider elevenlabs --json
```

The list shows the names, ids and labels available to that key. Use an id
in `video.json`:

```json
"voice": { "provider": "elevenlabs", "id": "JBFqnCBsd6RMkjVDRZzb", "model": "eleven_multilingual_v2" }
```

`model` is optional and defaults to `eleven_multilingual_v2`. The voice
command reports the characters used.
ElevenLabs uses `speed` times `pace`, limited to 0.7 through 1.2.
The voice command tells you when it uses that limit.

Cartesia's Sonic voices cost money on the user's account, and Cartesia gets
the script text. It reads everything between two pauses at once. Set it up with
`explainroo connect cartesia`, list voices with `explainroo voices --provider
cartesia --language es` and use one as `{ "provider": "cartesia", "id": "..." }`.
`model` defaults to `sonic-3.6`. Speed times pace is limited to 0.6 to 1.5.

Paid speech is bought request by request, and each answer is saved in `history/voice/`.
Moving a marker, changing `{shown|...}` or deleting `build/` buys nothing, and
editing a sentence buys only that sentence. If a run stops while a request is out,
nobody can tell whether it was charged, so `voice` stops and explains. Then
`explainroo voice <project> --new` buys only those sentences again. `voice --force`
makes every scene again, so with a paid voice it buys every sentence again, and it
says so first. A size whose block in `"sizes"` sets its own pace has narration of
its own, which a paid voice buys once at that pace. A request at that pace
continues with its size, like `explainroo voice <project> --size tiktok --new`,
and `explainroo history` prints that command.

You can also record the narration yourself. Use a quiet room and read
script.md as written. Put one take for the whole video in `assets/`:

```json
"voice": { "provider": "recording", "src": "assets/narration.m4a" }
```

Or put one file per scene in a folder:

```json
"voice": { "provider": "recording", "src": "assets/narration/" }
```

Each scene with narration needs `<scene-id>.<ext>`, for example `intro.wav`.
Supported formats are wav, mp3, m4a, aac, flac, ogg and opus. Files must stay
inside `assets/`, with no `..` in the path.

One take is split into scenes using the words in script.md. Each cut keeps
about 0.15 seconds around the speech. Pauses within a scene stay as recorded.
The scene's `lead` and `hold` add the gaps between scenes. Recordings are
made mono and their volume is brought close to Kokoro's. Their sample rate
is kept up to 48 kHz. Changing `pace` or an explicit `speed` changes their
tempo without changing pitch.

`[pause]`, `sentenceGap` and `paragraphGap` do not add silence to recordings.
Markers `[#name]`, captions, cues and `{shown|spoken}` still work. If the
speech check reports a mismatch, make script.md say what was actually said.
Replacing a scene recording makes that scene again. Replacing a whole take
makes all its scenes again.

ElevenLabs, Cartesia and recordings work in every supported language,
German included. Kokoro has no German voice, so a German video needs one of
these three. Run `voice`, `check` and `render` as usual with any source.
`explainroo docs languages` lists the languages and says how German works.
