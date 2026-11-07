# Videos in other languages

Set `language` in `video.json` to `en`, `es`, `fr`, `it`, `pt-br`, `hi`,
`ja` or `zh`. English is the default. `pt-br` means Brazilian Portuguese and
`zh` Mandarin Chinese. You can also start with
`explainroo init videos/my-video --language es`.

No other language works yet, with any voice. When the user asks for one,
tell them before you start.

When `voice` is left out, the language picks its Kokoro voice:

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
language. The speech check accepts digits for numbers. It does not try to
match spelled numbers to digits outside English. Write the digits, or use
an override whose spoken text has digits when that helps the check.

In Hindi, the speech check confirms fewer words than in the other languages,
because the speech model knows Hindi less well. A few unconfirmed words are
normal there. Fix a word when it stays unconfirmed in several scenes, or
when the user hears it wrong.

## One video in several languages

`script.md` is the main language, from `language`. Each `script.<lang>.md`
adds one, like `script.es.md`. One `scenes.js` draws them all. Put on-screen
text in `strings.json` and `strings.<lang>.json` and read it with `s.str('key')`.
Nested groups become dotted keys like `'intro.title'`. Word cues differ between
languages, so give each script the same `[#markers]`.

Add `--lang es` to the commands from `voice` to `publish`. Spanish builds in
`build/es/` and writes to `out/es/`. `"languages": { "es": { ... } }` holds
settings for one language, and a language without its own voice uses its
default. `package` reads `post.es.json` if there is one.

## Japanese and Chinese

Japanese and Chinese need Python 3 with misaki and more setup, and they are
written and checked differently. Before you make a video in either language,
run `explainroo docs japanese-and-chinese` and follow it.
