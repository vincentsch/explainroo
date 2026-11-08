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
apply too, and its part "Other languages" gives the filler words and the pace
of each language.
Cue words and `[#markers]` work the same. `at: 'qué'` matches "Qué". A cue
also finds a word after an elided article or pronoun, so `at: 'ombre'` finds
"l'ombre". This works after `l'`, `d'`, `j'`, `m'`, `n'`, `s'`, `t'`, `c'`
and `qu'`, and after the Italian `un'` and `dell'`. Writing `at: "l'ombre"`
works too. Write French with its spaces before "?", "!", ":" and ";". That
punctuation is not a word, so the speech check doesn't wait for it.
Hindi sentences can end with `।`. Captions and subtitle files keep the
written text. The looks include a Hindi font, so no system font is needed.

Spanish, French, Italian, Portuguese and Hindi need the espeak-ng program.
Install it on Linux
with `sudo apt install espeak-ng`, or on macOS with `brew install espeak-ng`.
On Windows, use the installer from the
[espeak-ng releases page](https://github.com/espeak-ng/espeak-ng/releases).
If the program is in another place, set `EXPLAINROO_ESPEAK` to its binary.
English, Japanese, Chinese, paid voices and recordings do not need it.
Only making the voice and the speech check use espeak-ng, so `voice`,
`check`, `render` and `verify` need it when they make or check narration, and
`still`, `sheet` and `preview` never do. Before the project exists,
`explainroo doctor --language es` checks what Spanish needs.

To set `EXPLAINROO_ESPEAK` once, put the line in the settings file, the same
`.env` that holds keys: `EXPLAINROO_ESPEAK=/usr/local/bin/espeak-ng`.
`explainroo doctor` prints where that file is. A value set in the environment
still wins.

Without root, use a copy that is not installed for the whole system. On
Debian or Ubuntu, `explainroo doctor --fetch --language es` sets it up by
itself. It says what it does first: it downloads the packages with
`apt-get download`, unpacks them with `dpkg -x` into
`~/.cache/explainroo/espeak-ng`, writes a small script there that starts
espeak-ng, and puts `EXPLAINROO_ESPEAK` with that script in the settings file.

By hand, the same works like this. `apt-get download espeak-ng espeak-ng-data
libespeak-ng1 libpcaudio0 libsonic0` gets the packages, and `dpkg -x <file>
~/.cache/explainroo/espeak-ng/root` unpacks each of them. The library folder
depends on the processor, like `x86_64-linux-gnu` or `aarch64-linux-gnu`, so
let the script find it. espeak-ng reads only the first 159 characters of its
data path, so the script starts it from inside a longer one. Write this to
`~/.cache/explainroo/espeak-ng/espeak-ng` and make it executable with
`chmod +x`:

```sh
#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)
lib=$(dirname "$(find "$here/root/usr/lib" -name 'libespeak-ng.so*' | head -n 1)")
export LD_LIBRARY_PATH="$lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
data="$lib/espeak-ng-data"
if [ ${#data} -gt 150 ]; then cd "$data" || exit 1; data=.; fi
export ESPEAK_DATA_PATH="$data"
exec "$here/root/usr/bin/espeak-ng" "$@"
```

Then put `EXPLAINROO_ESPEAK=` and the full path of that script in the
settings file.

The first speech check in another language downloads multilingual Whisper
small, 252 MB. `doctor --fetch --language it` fetches it ahead, with
everything else Italian needs, and the English speech check model only when
English is among the languages. `verify`
uses the video's language to check the finished sound too.

If a symbol, short form or word sounds wrong, use `{shown|spoken}` in
`script.md` and run `voice` again. Put the pronunciation in the same
language. The speech check accepts digits for numbers. Outside English and
German, it does not try to match spelled numbers to digits. Write the digits,
or use an override whose spoken text has digits when that helps the check.

In the languages that use espeak-ng, the speech check also counts a word heard
as another word with the same sound, like "haya" for "halla", and lists it as
sounding the same. German has no phonemizer here, so there such a word stays
unconfirmed. Reword the sentence then.

In Hindi, the speech check confirms fewer words than in the other languages,
because the speech model knows Hindi less well. A few unconfirmed words are
normal there. Fix a word when it stays unconfirmed in several scenes, or
when the user hears it wrong.

## Units, symbols and numbers in the speech check

Whisper often writes "300 000 km/s" where the voice said "trescientos mil
kilómetros por segundo". So the speech check reads these units and symbols as
the words of the language before it compares:

- lengths: km, m, cm and mm
- speeds: km/h and km/s
- weights: kg and g
- times: s and ms
- symbols: %, °C, € and $

It knows them in the languages of this table, in the singular and the plural,
like "kilómetro" and "kilómetros".

| Language | km/h, km/s, % and °C read as |
| --- | --- |
| English | kilometers per hour, kilometers per second, percent, degrees Celsius |
| German | Kilometer pro Stunde, Kilometer pro Sekunde, Prozent, Grad Celsius |
| Spanish | kilómetros por hora, kilómetros por segundo, por ciento, grados Celsius |
| French | kilomètres par heure or kilomètres-heure, kilomètres par seconde, pour cent, degrés Celsius |
| Italian | chilometri orari or all'ora, chilometri al secondo, per cento, gradi Celsius |
| Portuguese | quilômetros por hora, quilômetros por segundo, por cento, graus Celsius |

"m", "mm", "g", "s" and "ms" count as units only right after a number, so a
letter on its own stays a letter.

Numbers count by their value, with thousands written the way the language
writes them:

| Language | Written the same as 300000 |
| --- | --- |
| English | 300,000 and 300 000 |
| Hindi | 3,00,000 and 300,000 |
| German, Spanish, French, Italian and Portuguese | 300.000 and 300 000 |

The space can also be a thin space or a no-break space. The decimal mark
stays, so "7,5" never matches "75". Zeros at the end of the decimals change
no value, so "1,50" matches "1,5", and "2.0" matches "2".

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
| "km", "kg", "km/h", "°C" and the other units above | "Kilometer", "Kilogramm", "Kilometer pro Stunde", "Grad Celsius" and so on |

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
is a German video made from a recording. The examples also come with the
package, and `explainroo doctor` prints their folder.

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
