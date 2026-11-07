# Videos in other languages

Set `language` in `video.json` to `en`, `es`, `fr`, `it`, `pt-br`, `hi`,
`ja`, `zh` or `de`. English is the default. `pt-br` means Brazilian Portuguese,
`zh` Mandarin Chinese and `de` German. You can also start with
`explainroo init videos/my-video --language es`. German works with a paid
voice or a recording, and the section on German below says how to set it up.

No other language works yet, with any voice. When the user asks for one,
tell them before you start.

When `voice` is left out, the language picks its Kokoro voice. German has no
Kokoro voice, so it always needs a voice in `video.json`.

| Language | Default voice |
|---|---|
| English (`en`) | `af_heart` |
| Spanish (`es`) | `ef_dora` |
| French (`fr`) | `ff_siwis` |
| Italian (`it`) | `if_sara` |
| Brazilian Portuguese (`pt-br`) | `pf_dora` |
| Hindi (`hi`) | `hf_alpha` |
| Japanese (`ja`) | `jf_alpha` |
| Mandarin Chinese (`zh`) | `zf_xiaobei` |

Run `explainroo voices --language es` to see voices for one language.
A Kokoro voice must match the video's language. If a project already has
`voice` set, change it too, or remove it to use the default.

Write the narration in that language as a person would say it. Do not
translate English word for word. The writing rules in `explainroo docs writing`
apply in spirit.
Cue words and `[#markers]` work the same. `at: 'qué'` matches "Qué".
Hindi sentences can end with `।`. Captions and subtitle files keep the
written text. The looks include a Hindi font, so no system font is needed.

Spanish, French, Italian, Portuguese and Hindi need the espeak-ng program.
Install it on Linux
with `sudo apt install espeak-ng`, or on macOS with `brew install espeak-ng`.
On Windows, use the installer from the
[espeak-ng releases page](https://github.com/espeak-ng/espeak-ng/releases).
If the program is in another place, set `EXPLAINROO_ESPEAK` to its binary.
English, Japanese, Chinese, paid voices and recordings do not need it.

The first speech check in another language downloads multilingual Whisper
small. `doctor --fetch` still fetches only the English models. `verify`
uses the video's language to check the finished sound too.

If a symbol, short form or word sounds wrong, use `{shown|spoken}` in
`script.md` and run `voice` again. Put the pronunciation in the same
language. The speech check accepts digits for numbers. Outside English and
German, it does not try to match spelled numbers to digits. Write the digits,
or use an override whose spoken text has digits when that helps the check.

In Hindi, the speech check confirms fewer words than in the other languages,
because the speech model knows Hindi less well. A few unconfirmed words are
normal there. Fix a word when it stays unconfirmed in several scenes, or
when the user hears it wrong.

## German

Kokoro has no German voice. A German video speaks with ElevenLabs, Cartesia or
the user's own recording. ElevenLabs and Cartesia cost money, and the user
chooses, so run `explainroo services voice` and show the user the options. Then
set `language` and one of these voices in `video.json`:

```json
"language": "de",
"voice": { "provider": "recording", "src": "assets/narration.m4a" }
```

```json
"language": "de",
"voice": { "provider": "elevenlabs", "id": "<voice id>" }
```

```json
"language": "de",
"voice": { "provider": "cartesia", "id": "<voice id>" }
```

`explainroo voices --provider cartesia --language de` lists Cartesia's German
voices. `explainroo voices --provider elevenlabs --language de` lists the
voices of the ElevenLabs key, and its default model `eleven_multilingual_v2`
reads German with each of them. Cartesia is told the language in each request.
A recording can be one take or one file per scene, as `explainroo docs voices`
describes.

`init` can only set up a Kokoro voice, so `init --language de` stops and
creates nothing. Create the project without `--language`, then set `language`
and `voice`. Wherever German would need Kokoro, explainroo stops with a
message that shows these lines. It stops in these places:

- `init --language de`
- `voices --language de` without `--provider`
- every command on a project whose German version has no voice of its own, or
  a Kokoro voice

Never choose a Kokoro voice of another language for German.

German narration needs neither espeak-ng nor misaki. Word timing and the
speech check use the multilingual Whisper model, and `doctor videos/<name>`
says whether it is there.

The speech check reads German the way a voice says it:

| Written | Read as |
| --- | --- |
| numbers in one word, like "zweiundvierzig" or "dreihundertzwölf" | the number, with or without "ein" before "hundert" and "tausend" |
| years, like 1990 | "neunzehnhundertneunzig" or "eintausendneunhundertneunzig" |
| ordinals, like "3." or "19." | "dritte", "dritten", "neunzehnten" and the other endings |
| decimals and thousands, like "3,5" and "1.000" | "drei Komma fünf" and "tausend" |
| "Mio.", "Mrd.", "%" and "€" | "Millionen", "Milliarden", "Prozent" and "Euro" |
| "z. B.", "d. h.", "u. a.", "usw.", "bzw.", "ca.", "etc.", "Nr." and "Dr." | "zum Beispiel", "das heißt", "unter anderem", "und so weiter", "beziehungsweise", "circa", "et cetera", "Nummer" and "Doktor" |
| "km", "kg", "km/h" and "°C" | "Kilometer", "Kilogramm", "Kilometer pro Stunde" and "Grad Celsius" |

"ß" and "ss" count as the same. A number only matches the same number, so
"3,5" never matches "35", and "Millionen" never matches "Milliarden". Another
short form, or an unusual reading of a number, shows as a word the speech
check could not confirm. Write it with `{shown|spoken}` then, like
`{Abb.|Abbildung}`.

A sentence ends at its period, also in German. A period inside a sentence
doesn't end it in these cases:

- An ordinal after an article or after "am", "im", "zum", "zur", "vom" or
  "beim", or before a month, like "am 3. Mai" or "der 29. Februar".
- "z. B.", "d. h.", "u. a.", "bzw.", "ca.", "Nr." and "Dr.".
- "usw." and "etc." before a word in lowercase.

Every other period ends the sentence, so "Die Anzahl ist 3. Danach steigt
sie." stays two sentences. Where the rule gets it wrong, write `{3.|dritten}`
or add a `[pause]`.

[examples/leap-years-de](https://github.com/vincentsch/explainroo/tree/main/examples/leap-years-de)
is a German video made from a recording.

For a German version of a video in another language, add `script.de.md` and
give German its own voice under `"languages"`:

```json
"languages": { "de": { "voice": { "provider": "recording", "src": "assets/narration-de.m4a" } } }
```

## One video in several languages

`script.md` is the main language, from `language`. Each `script.<lang>.md`
adds one, like `script.es.md`. One `scenes.js` draws them all. Put on-screen
text in `strings.json` and `strings.<lang>.json` and read it with `s.str('key')`.
Nested groups become dotted keys like `'intro.title'`. Word cues differ between
languages, so give each script the same `[#markers]`.

Add `--lang es` to the commands from `voice` to `publish`. Spanish builds in
`build/es/` and writes to `out/es/`. `"languages": { "es": { ... } }` holds
settings for one language, and a language without its own voice uses its
default. German has no default, so it needs a voice there. `package` reads
`post.es.json` if there is one.

## Japanese and Chinese

Japanese and Chinese need Python 3 with misaki and more setup, and they are
written and checked differently. Before you make a video in either language,
run `explainroo docs japanese-and-chinese` and follow it.
