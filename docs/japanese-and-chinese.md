# Japanese and Chinese

Japanese and Chinese need Python 3 with misaki, the pronunciation library
Kokoro's voices were trained with. Install what the language needs:

```bash
python3 -m pip install "misaki[ja]"   # Japanese
python3 -m unidic download            # Japanese dictionary, about 526 MB
python3 -m pip install "misaki[zh]"   # Chinese
```

On Windows, write `python` instead of `python3`. If misaki is in a virtual
environment, set `EXPLAINROO_PYTHON` to that environment's Python.
ElevenLabs and recordings need neither.

Write the narration as usual, without spaces between words. explainroo
finds the words itself, so cue words and markers work: `at: '解析'` matches
the word 解析, and a phrase like `at: '名前の解析'` works too. A cue must
match whole words. Put a `[#marker]` where you need a moment inside a word.
Sentences end with `。`, `！` or `？`.

Latin words such as API or JavaScript are read in English. For a Japanese
reading, write it out: `{API|エーピーアイ}`. Numbers can stay in digits,
including decimals like 365.2422. The Japanese reader sometimes picks the
wrong reading for a word, such as ついたち for 一日 (write `1日` for
いちにち) or こよみ for 暦 in グレゴリオ暦 (write `{グレゴリオ暦|グレゴリオれき}`).
When the speech check flags a word, compare what it heard with the script
before you change anything.

Whisper often writes a word with other characters that sound the same, so
the speech check compares sounds. Japanese is compared by its kana reading,
so 世紀 heard as 正規 still counts. Chinese is compared by pinyin without
tones, and Traditional and Simplified characters count as the same. So do
not reword a sentence only because Whisper chose other characters. Captions
and subtitles join words without spaces, with up to 18 characters per
subtitle line, and never break inside a word. Keep the shown text of an
override short.

The looks' fonts have no Japanese or Chinese characters. The first `voice`,
`still` or `render` downloads Noto Sans JP or Noto Sans SC, regular and bold,
about 33 MB, and checks the files. They are saved in
`~/.cache/explainroo/fonts/` (or `$EXPLAINROO_CACHE/fonts/`) and used in
every look, in captions and in app screens. After that first download,
`EXPLAINROO_OFFLINE=1` works. A web player made with `export` keeps only
the characters the video shows, so its fonts stay small.
