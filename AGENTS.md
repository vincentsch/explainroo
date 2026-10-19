# explainroo for coding agents

This file tells you, the coding agent, how to make a video with explainroo.
The user usually gives you a topic, and maybe a length or a style. You write
the words and the pictures. explainroo makes the video.

explainroo turns two files into an MP4 video with narration. `script.md`
holds what the voice says. `scenes.js` draws what the viewer sees. Every
drawing can appear on a word the voice says. A voice model (Kokoro) reads
the script on this computer, or the narration comes from ElevenLabs or your
own recording. Whisper listens to the narration and writes down when each
word is spoken. Chrome draws the frames in the background.
explainroo adds music and sound effects, and ffmpeg makes the MP4. You need
no API key for local voices or recordings. ElevenLabs and AI images need
keys.

The full documentation for people is at https://www.explainroo.com/docs/.

## Before you start

Maybe the user pasted the prompt from the README or from explainroo.com, and
you are not in an explainroo folder yet. Then clone it into the current
folder first. If the user named another place, use that.

```bash
git clone https://github.com/vincentsch/explainroo.git
cd explainroo
```

Run this once in the explainroo folder:

```bash
npm install
node bin/explainroo.js doctor --fetch
```

`doctor` checks Node, ffmpeg and Chrome, and the extra programs some
languages need. It also downloads the English speech models, about 400 MB,
the first time only. Other languages fetch their speech check model on first
use. If the user ran `npm link`, you
can write `explainroo` instead of `node bin/explainroo.js` in the commands
below. Commands that work on a video take the project folder first, and every
command accepts `--json`.

### When to ask the user

Decide the normal things yourself, like the look, the length, the voice, the
layout and the wording. Ask only when you cannot go on without an answer.
When you ask, put everything you need in one message. Typical reasons to ask:

- The topic is unclear, or you need a fact you cannot check.
- The user wants AI images and there is no OpenRouter key (see Images).
- The user wants ElevenLabs and there is no ElevenLabs key (see Voices).
- The user wants something explainroo cannot do, like video shot with a
  camera.

## Making a video, step by step

1. **Learn the subject.** Read the code, docs or pages the user points to.
   Write down the facts you will use. Never make up numbers, quotes or claims.
   If a number matters and you cannot check it, leave it out.

2. **Create the project.**

   ```bash
   node bin/explainroo.js init videos/<name> --theme paper --title "..."
   ```

   Projects go in `videos/`. Git ignores that folder. Pick the look that fits
   the audience: `paper` (friendly, hand drawn, the default), `clean`
   (products and business), `chalk` (teaching), `blueprint` (engineering),
   `midnight` (developer tools) or `editorial` (essays, history, money and
   other thoughtful topics). Pick the size for the place the video goes,
   for example `--size tiktok` or `--size linkedin`. The sizes are listed in
   "Sizes for each platform" below. Add `--pace 1.2` when the user wants a
   quicker video.

3. **Write `script.md`.** The narration comes first. It sets the timing for
   everything else. See "How to write the narration" below.

4. **Make the voice.**

   ```bash
   node bin/explainroo.js voice videos/<name>
   ```

   The command prints how long each scene is and how many words the speech
   check confirmed. If a word is not confirmed, the voice probably said it
   wrong. Fix it with `{shown|spoken}` in the script and run the command
   again. For a recording, make script.md say what was actually said.
   Only the scenes you changed are made again. `check`, `still`, `sheet`,
   `render` and `preview` also make missing narration, so start them after
   `voice` has finished, not at the same time.

5. **Plan the pictures.** For each scene, decide what is on screen when each
   marker or important word is spoken. Decide where each thing sits and what
   leaves the screen. Keep things in the same place from scene to scene.
   Answer four questions for each scene. What is the one thing the viewer
   should look at? Which relationship does the layout show: an order, a
   comparison, the parts of a whole or a cause? What appears and what leaves
   on each cue? What stays in the same place in the next scene? "Layouts that
   work" below has four layouts to start from.

6. **Make images, if the video needs them.** Icons and diagrams cover most
   technical topics. Everyday how-to topics like cooking, cars or gardening
   work better with pictures. See "Images" below.

7. **Write `scenes.js`.** Write one function per scene. Tie every picture to
   the narration with `at: 'word'` or `at: '#marker'`. The scene API is at
   the end of this file.

8. **Check.**

   ```bash
   node bin/explainroo.js check videos/<name>
   ```

   Fix every error and every warning. You decide what to do with the hints.

9. **Look at the frames.** You cannot watch the video, so this is how you see
   it.

   ```bash
   node bin/explainroo.js still videos/<name>                 # the end of each scene
   node bin/explainroo.js still videos/<name> intro@2.5 12.0  # any moment
   node bin/explainroo.js sheet videos/<name> --scene intro   # one scene over time
   node bin/explainroo.js sheet videos/<name>                 # the whole video
   ```

   Open the images and judge them like a viewer would. Is the text big
   enough? Is anything cut off or on top of something else? Is half the frame
   empty? Does the sheet show something new every few seconds? Fix what is
   wrong and look again.

   For Reddit and other feeds, also run `check videos/<name> --view-width
   854`. It warns when visible text shrinks below 16px in that player.
   This is a size check, not a guarantee about platform compression. Show
   only the current query or result, use bigger type, and zoom into details.
   Review a still at `--scale 0.4448` too (about 480p for a 1080p video).
   Never upload `draft.mp4`. After uploading, check the platform's lower
   quality copy as well as its full-size copy.

10. **Make the video and check the file.**

    ```bash
    node bin/explainroo.js render videos/<name> --draft   # quick half-size version
    node bin/explainroo.js render videos/<name>           # final video
    node bin/explainroo.js verify videos/<name>
    ```

    `render` also writes subtitle files (`.srt` and `.vtt`) and a cover
    image (`.cover.jpg`) next to the video. When scenes name chapters, it
    writes `.chapters.txt` for the YouTube description and adds the chapters
    to the MP4. `--format gif` makes a silent GIF instead, for a README or a
    post. `verify` checks the MP4. It measures the loudness and looks for
    black frames and silence. It also runs the speech check on the finished
    sound to make sure the voice is still clear over the music.

11. **Tell the user** where the video and its subtitle files, chapters and
    cover are, how long the video is, what verify said, and what you could
    not check.

## How to write the narration

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

Length and pace:

- Aim for 45 to 120 seconds unless the user says otherwise. A finished video
  has about 150 words a minute, pauses included. In Japanese it is about 270
  characters a minute, and in Chinese about 200.
- Start with the question or problem. Explain it in small steps. Give one
  concrete example, then sum up.
- One idea per scene, usually 1 to 3 sentences (4 to 15 seconds).
- Lists read aloud ("A, B, C and D") only work when each item appears on
  screen.

Script syntax:

```markdown
# Title of the video

## scene-id {hold=1.5}
Narration for this scene. [#marker] A marker names a moment you can animate on.
[pause 0.6] adds silence. {SQL|sequel} shows "SQL" in captions but says "sequel".
> Lines starting with > are notes for you and are not spoken.
```

- `## scene-id` starts a scene. The id must match a function in `scenes.js`.
- Put a `[#marker]` wherever a picture should change. Every sentence should
  trigger at least one picture.
- Use `{shown|spoken}` for anything the voice may misread: acronyms
  (`{CLI|C L I}`), versions (`{v2.1|version two point one}`), symbols and
  domains (`{example.com|example dot com}`, otherwise the voice says "example
  comm").
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

## What makes the pictures good

- **Show it when it is said.** A picture appears as the voice mentions it.
  Use word cues.
- **Something changes every 2 to 4 seconds.** A new element, an arrow or a
  highlight. The camera adds its own moves. `check` points out long stretches
  where nothing new appears.
- **Short screen text.** Labels, numbers and key phrases of a few words. The
  whole narration never goes on screen. When the narration should be readable,
  turn on captions (`"captions": true`). Then do not also show the sentence
  the voice is saying as text.
- **Few things at once.** At most five or six elements. Take things off the
  screen with `out` before the next idea.
- **Big and readable.** Titles 80 to 110 px, labels 40 to 56 px, small text
  at least 32 px on a 1920 x 1080 canvas. Stay inside `s.safe`.
- **Same meaning, same color.** Give each thing one color and one place and
  keep them. Use the accent color for the one thing that matters most.
- **Real examples.** A command you can run, a number with its source or a
  picture of the real screen is better than three boxes with general words.
- **A clear last frame** that shows the main point.

### Layouts that work

These four layouts cover many scenes: one big number, a comparison, steps in
order, and one main thing with its parts. Start from the one that fits and
change the words, colors and cues. Each one also works in tall and square
frames.

```js
export default {
  // One big number with a short caption under it.
  number(s) {
    const u = Math.max(s.W, s.H) / 100;
    // The number also has to fit across a narrow, tall frame.
    const n = s.number(1000000, { y: s.cy - u * 2, size: Math.min(u * 10, s.safe.w / 6), at: '#number' });
    s.text('requests a day', { y: n.bottom + u * 3, size: u * 3.6, color: 'muted', at: '#caption' });
  },

  // Two things side by side, or stacked in a tall frame.
  compare(s) {
    const u = Math.max(s.W, s.H) / 100;
    const cells = s.grid(s.portrait ? 1 : 2, s.portrait ? 2 : 1, { gap: u * 4 });
    const sides = [
      { title: 'Callbacks', note: 'one function inside another', color: 'orange', at: '#left' },
      { title: 'async / await', note: 'reads from top to bottom', color: 'green', at: '#right' },
    ];
    sides.forEach(({ title, note, color, at }, i) => {
      const c = cells[i];
      const card = s.box(title, { x: c.x, y: c.y - u * 2, w: c.w * 0.8, size: u * 4, color, at });
      s.text(note, { x: c.x, y: card.bottom + u * 3, size: u * 2.8, color: 'muted', maxWidth: c.w * 0.85, at });
    });
  },

  // Steps in order, left to right, or top to bottom in a tall frame.
  steps(s) {
    const u = Math.max(s.W, s.H) / 100;
    const labels = ['Browser', 'Resolver', 'Address'];
    const xs = s.portrait ? labels.map(() => s.cx) : s.row(labels.length, { width: s.safe.w * 0.72 });
    const ys = s.portrait ? s.col(labels.length) : labels.map(() => s.cy);
    labels.forEach((label, i) => {
      const at = i ? `#step${i + 1}` : 0.3;
      s.box(label, { id: `step${i}`, x: xs[i], y: ys[i], size: u * 3.6, at });
      if (i) s.arrow(`step${i - 1}`, `step${i}`, { at });
    });
  },

  // One main thing with its parts around it. A tall frame has no room
  // beside it, so the parts sit in a row underneath.
  hub(s) {
    const u = Math.max(s.W, s.H) / 100;
    const parts = ['Email', 'Calendar', 'Files'];
    const hubY = s.portrait ? s.cy - s.safe.h * 0.18 : s.cy;
    const spots = s.portrait
      ? s.row(parts.length, { width: s.safe.w * 0.72 }).map((x) => ({ x, y: s.cy + s.safe.h * 0.16 }))
      : [-90, 30, 150].map((d) => ({ x: s.cx + Math.cos((d * Math.PI) / 180) * s.safe.w * 0.34, y: s.cy + Math.sin((d * Math.PI) / 180) * s.safe.h * 0.3 }));
    s.box('Login server', { id: 'hub', x: s.cx, y: hubY, size: u * 4, color: 'accent', at: '#hub' });
    parts.forEach((label, i) => {
      const at = `#spoke${i + 1}`;
      s.box(label, { id: `part${i}`, ...spots[i], size: u * (s.portrait ? 2.4 : 3.2), at });
      s.arrow('hub', `part${i}`, { at });
    });
  },
};
```

Text sizes come from the frame's long side, so they look about the same in
wide and tall frames. A big number also has to fit across a narrow frame.

### The camera

explainroo films each scene with a camera that follows the narration. It
opens on the picture. When a scene starts small, the camera starts close and
widens as new things need room. Something new that already fits the shot
needs no move. Now and then the camera moves in on what the voice talks
about, for example a new card and the one it relates to, when the viewer has
time to look. Then it follows new things at that distance. Near the end of
the scene it pulls back, so the last frame shows the whole idea. During each
scene it also pushes in very slowly.

While a shot holds, every card and label is either fully in the shot or out
of it. Arrows and lines may run off the edge. While the camera moves from
one shot to the next, things may pass the edge of the frame for a moment.
Shots stay clear of the captions and of the parts the app covers on Shorts,
TikTok and Reels.

Lay out each scene as one picture on the full frame, the way it should look
at the end, and let the camera find the close-ups:

- Put the next element near the one it follows, so one shot shows both.
- A scene that starts with one thing and grows gets the most camera moves.
  The camera starts close and widens with the picture.
- Keep a box with its label, or an icon with its caption, together as one
  unit. Things far apart get their own shots.
- Lines, arrows and things added inside an element already on screen, like
  a line in a chart, get no close-up of their own. Use `s.focus` when one
  should.
- When a scene goes on with the same picture, draw the carried elements with
  `at: -1` in the same places. The camera then goes on from where it
  stopped, and the two scenes fade into each other.

The camera measures every element, including what `s.draw` draws, and
follows the `at` and `out` times. It measures each element where it is at
the end of the scene. When something travels across the frame during a
scene, keep that scene's camera still with `s.camera([])`. Anything drawn straight on `s.ctx` counts
as one block that is there for the whole scene, so the camera keeps it whole
and cannot film it on its own. Use `s.draw` for a drawing that appears on a
cue. Highlighted code lines and terminal commands get close-ups of their own
when they are small in the shot. `s.focus` points the camera at any part of
the picture.

`s.camera([...])` in a scene takes over that scene's camera, and
`s.camera([])` keeps the scene still. `"camera": "still"` in `video.json`
turns the camera off for the whole video. `check` checks the layout as you
wrote it, without the camera. Stills, sheets and renders show the camera.

The final render adds motion blur to frames where something moves, like a
film camera. Drafts skip it. `"motionBlur": false` turns it off.

## Voices

Kokoro runs on this computer and needs no key. Pick a voice with
`explainroo voices`. A string in `video.json` keeps using Kokoro:

```json
"voice": "af_heart"
```

`{ "provider": "kokoro", "id": "af_heart" }` means the same thing.

ElevenLabs offers premium and cloned voices. It costs money on the user's
account and receives the script text. If the user wants it and there is no
key, ask them for an API key from elevenlabs.io. Set `ELEVENLABS_API_KEY` in
the environment, or save `ELEVENLABS_API_KEY=...` in a `.env` file in the
project folder or the explainroo folder. The environment takes priority,
then the project file. Never print the key, and never put it in a script,
a commit or a log. Keep `.env` out of git.

```bash
node bin/explainroo.js voices videos/<name> --elevenlabs
node bin/explainroo.js voices videos/<name> --elevenlabs --json
```

The list shows the names, ids and labels available to that key. Use an id
in `video.json`:

```json
"voice": { "provider": "elevenlabs", "id": "JBFqnCBsd6RMkjVDRZzb", "model": "eleven_multilingual_v2" }
```

`model` is optional and defaults to `eleven_multilingual_v2`. The voice
command reports the characters used. Each request is saved in
`build/voice/elevenlabs-usage.jsonl`, without the key or script text.
ElevenLabs uses `speed` times `pace`, limited to 0.7 through 1.2.
The voice command tells you when it uses that limit.

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

ElevenLabs narration and recordings work in every supported language.
Run `voice`, `check` and `render` as usual with any of the three sources.

## Videos in other languages

Set `language` in `video.json` to `en`, `es`, `fr`, `it`, `pt-br`, `hi`,
`ja` or `zh`. English is the default. `pt-br` means Brazilian Portuguese and
`zh` Mandarin Chinese. You can also start with
`explainroo init videos/my-video --language es`.

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
translate English word for word. The writing rules above apply in spirit.
Cue words and `[#markers]` work the same. `at: 'qué'` matches "Qué".
Hindi sentences can end with `।`. Captions and subtitle files keep the
written text. The looks include a Hindi font, so no system font is needed.

Spanish, French, Italian, Portuguese and Hindi need the espeak-ng program.
Install it on Linux
with `sudo apt install espeak-ng`, or on macOS with `brew install espeak-ng`.
On Windows, use the installer from the
[espeak-ng releases page](https://github.com/espeak-ng/espeak-ng/releases).
If the program is in another place, set `EXPLAINROO_ESPEAK` to its binary.
English, Japanese, Chinese, ElevenLabs and recordings do not need it.

### Japanese and Chinese

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

## Images

explainroo can make illustrations with AI image models through OpenRouter.
This is optional. It costs money on the user's OpenRouter account, roughly 7
to 13 cents per image at the time of writing.

If the user wants images and there is no key, ask them for an OpenRouter API
key (from openrouter.ai/keys). Save it in a `.env` file in the explainroo
folder as `OPENROUTER_API_KEY=...`, or set it as an environment variable. Git
ignores `.env`. Never print the key, and never put it in a script, a commit
or a log.

```bash
node bin/explainroo.js image videos/<name> cables "Two cars parked nose to nose with their hoods open, jumper cables between the batteries"
node bin/explainroo.js images videos/<name>    # what was made and what it cost
```

This saves `assets/cables.png`. Use it in a scene with
`s.image('assets/cables.png', { w: 1100, frame: 'card', at: 'cables' })`.

- `--model best` (default) uses OpenAI GPT Image 2. It does what you ask and
  is worth the price for most images.
- `--model cheap` uses Google Gemini 3.1 Flash Image. It costs about half,
  but it often ignores parts of the prompt.
- `--aspect` sets the shape of the image: `16:9` (default for landscape
  videos), `9:16`, `1:1`, `4:3`, `3:2` and their portrait forms.
- `--ref assets/a.png` sends an earlier image along, so a person or object
  keeps the same look. Separate several files with commas.
- Every image gets a default style (flat, soft colors, no text). Set your own
  in `video.json` with `"images": { "style": "...", "model": "best" }`, or
  turn the style off with `--no-style`.

**Always open every image and check it.** Image models get details wrong:
extra fingers, cables on the wrong terminal, text that looks like writing but
is not. If anything is wrong, change the prompt and make the image again.
Keep text out of images. Put words on screen with `s.text` instead. Use
images for things icons cannot show, and keep one style through the whole
video.

## Product demos

A product demo is the kind of video software companies make to show their
app. You rebuild the app's screens with `s.ui`, which has cards, fields,
buttons, dropdowns, toggles and status labels in the app's colors and fonts.
A mouse pointer clicks through the screens and types into the fields, and the
camera zooms in on what the voice talks about. `examples/unspar-demo` is a
complete one.

**Capture the live site first.**

```bash
node bin/explainroo.js capture videos/<name> https://example.com --mobile
```

`capture` opens the page in a fresh browser, without cookies or logins, and
saves what a demo needs in `assets/capture/<hostname>/`:

- `page.png` (the first screen) and `full.png` (the whole page, up to 8000
  pixels tall), at twice the pixel density, so they stay sharp when the
  camera zooms in. `--mobile` adds `mobile.png` and `mobile-full.png`.
- `capture.json` with the colors, fonts, logo candidates and the page's
  wording: headings, navigation, buttons and form labels. Copy the wording
  exactly. The live site is the source of truth for claims and wording.
- Up to three logo files, and the font files that come from Google Fonts, in
  the weights the page uses.

It prints a `brand` and `fonts` block to paste into `video.json`. Check it
against the screenshots. Fonts built into explainroo need no files. For other
fonts, get the files, check the license and copy the license file next to
them. Cookie banners and chat widgets can appear in the screenshots, as they
do for any visitor. Use a screenshot, or a part of one, without them.
Capturing the same site again replaces its folder.

You can also show a real screen recording with `s.clip` in a `browser`
frame. Use `s.camera` to zoom in on the detail the voice mentions.

**Keep it true.** A demo is advertising, so everything in it has to be right.

- Take the wording from the app itself: its templates and language files
  (for example `lang/en/*.php`, `locales/`, or the components). Copy labels,
  buttons and status names exactly.
- Show only features that exist and that customers can use. Leave out admin
  screens, debug views and plans that are not built yet.
- Example data must look like example data: `example.com`, a made up project,
  a made up article title. Never invent customers, numbers or results.
- Claims in the narration come from the product's live website. Show prices
  only if the website shows them.
- Ask the user if the website and the app say different things.

**Set up the brand** in `video.json`. Use the `clean` look.

```json
{
  "theme": "clean",
  "brand": {
    "accent": "#245cff",
    "background": "#f8f6f1",
    "font": "Figtree",
    "headline": "Instrument Serif",
    "logo": "assets/logo.svg"
  },
  "fonts": [
    { "family": "Figtree", "src": "assets/fonts/Figtree-600.woff2", "weight": 600 }
  ]
}
```

- `accent` is the main button color. Find it in the app's Tailwind config or
  CSS. `background` is the color behind the screens, `ink` the color of text
  drawn right on it.
- `font` is the app's font. Inter is built in; other fonts go in
  `assets/fonts/` and in `fonts` (`.woff2`, `.woff`, `.ttf` or `.otf`, one
  entry per weight, or `"weight": "100 900"` for a variable font, and
  `"style": "italic"`). Copy the font's license file next to it.
- `headline` is the font for big headlines. Instrument Serif is built in. If
  the brand has no serif, use its own font and pass `{ weight: 700,
  italic: false }` to `u.headline()`.
- `logo` is the product's logo from the app or website, best as SVG.

**Build a scene** in this order: background, camera, headline, screens,
cursor last so it stays on top.

```js
hook(s) {
  const u = s.ui;
  u.backdrop();
  u.floaters();
  s.camera([{ at: '#site', x: 900, y: 600, zoom: 1.3 }]);
  u.headline('Tell it what to *write about*', s.W / 2, 178, { size: 84, at: 0.15 });
  u.panel(410, 270, 1100, 600, { at: 0.3 }, (x, y, w, h) => {
    u.input(x + 56, y + 296, 560, 62, { label: 'Website URL', value: u.typed('https://example.com', '#site', 24), focus: 1, caret: true });
    u.button('Get ideas', x + 760, y + 516, 280, 60, { press: u.press('#go') });
  });
  u.cursor([
    { at: 0.5, x: 1500, y: 900 },
    { at: s.time('#site') - 0.7, x: 740, y: 596 },
    { at: '#site', click: true },
  ]);
}
```

Draw the headline after `s.camera()`, or the zoomed screens slide under it.
When the camera zooms in, either keep the headline fully in view (zoom up to
about 1.1) or zoom far enough that it leaves the frame (about 1.3 and more).
In between it gets cut in half.

Time every click to a `[#mark]` in the script, so it happens when the voice
says it. A cursor move starts at its `at` and arrives `dur` seconds later
(0.7 by default), so start the move a little more than `dur` before the
click. The first 0.7 seconds of a scene are covered by the transition from
the scene before, so put no clicks there.

The watermark sits in the bottom right corner. When the camera zooms in, it
can cover what is there, so keep important text out of that corner.

Use the product's name as plain text in the first frame. The first frame is
also the video's cover.

**`s.ui` reference.** Positions are in the frame (1920 wide for 16:9). Times
take seconds, spoken words or `"#marks"`, like everywhere else.

| Call | What it draws |
|---|---|
| `u.backdrop(color?)`, `u.floaters({ alpha, tint })` | the brand background, and faint cards drifting around the edges (`tint: 'white'` on a colored background) |
| `u.panel(x, y, w, h, { at, out, from, rise, sfx, fill, border, lift }, fn)` | a card that pops in at `at`; `fn(x, y, w, h)` draws inside it |
| `u.card(x, y, w, h, o)` | a card without an entrance |
| `u.browser(x, y, w, h, { url, at }, fn)` | a panel with a browser bar; `fn` gets the page area |
| `u.modal(x, y, w, h, { at, out }, fn)`, `u.over(fn)` | a dialog over a dimmed frame, and a layer for your own menus or popups; `check` does not report text in one layer as overlapping text in another |
| `u.toast(text, { at, out, icon, tone })` | a message that slides up, with a chime |
| `u.headline(text, x, y, { size, at, out, align, weight, italic, color, accent, tracking })` | big text that blurs in word by word; `*stars*` mark words in the `accent` color |
| `u.text(text, x, y, { size, weight, color, align, base, font, italic, tracking, alpha, maxW, check })`, `u.para(text, x, y, maxW, o)`, `u.eyebrow(text, x, y)` | text, wrapped text (`\n` starts a new line), and a small uppercase label; `font` is `'ui'`, `'headline'` or a family; `check: false` hides text from `check`; `u.measure(text, size, weight)` gives the width |
| `u.button(label, x, y, w, h, { variant, press, icon, loading, color, caps })` | `primary`, `secondary` or `ghost` |
| `u.input(x, y, w, h, { label, value, placeholder, focus, caret, icon })`, `u.textarea(x, y, w, h, o)` | a text field, and a taller one where the text wraps |
| `u.select(x, y, w, h, { label, value, open, options, hover, selected })` | a dropdown; returns the y of each option row |
| `u.toggle(x, y, on)`, `u.checkbox(x, y, on)`, `u.radio(x, y, on)` | `on` goes from 0 to 1, so it can animate |
| `u.chip(label, x, y, { selected })`, `u.chipWidth(label, o, selected)` | option chips; a selected chip grows by its check mark, so leave room |
| `u.pill(label, x, y, tone, { align, dot, pulse })` | a status badge: `gray`, `blue`, `yellow`, `green`, `red`, `purple` or `accent` |
| `u.spinner(x, y, r)`, `u.progress(x, y, w, p)`, `u.avatar(x, y, r, initials, { image })`, `u.icon(name, x, y, size, color)`, `u.lines(x, y, w, n)`, `u.logo(x, y, w)` | small parts; `lines` draws grey bars in place of body text |
| `u.pop(at, cx, cy, fn, { sfx })` | pops anything in around a point |
| `u.wipe(at, { color })` | the accent color spreads out until it fills the frame |
| `u.cursor(keys, { out })` | the mouse; a key `{ at, x, y, dur, arc }` moves it (`arc` bends the path, 0 is straight), `{ at, click: true }` clicks with a sound |
| `u.press(at)`, `u.typed(text, at, cps, { gain, sfx })`, `u.stream(text, at, wps)`, `u.count(to, at, dur)` | a button press (0 to 1 and back), text typed so far with typing sounds, text appearing word by word like an AI reply, a number counting up |
| `u.colors` | `accent`, `accentDark`, `accentTint`, `background`, `ink`, `text`, `soft`, `muted`, `faint`, `line`, `field`, `surface`, `panel`; `brand.colors` in `video.json` replaces the grays, for example `{ "text": "#141413", "line": "#e8e6dc" }` for a warm brand |

`check` sees the text of `s.ui` too. It reports text that runs off the frame
(not while the camera zooms in), text that is too small and text that
overlaps. A dropdown or dialog may cover what is under it. Look at stills at
the moments the camera is zoomed in, and check the cursor does not hide the
word it points at.

Panels and headlines from `s.ui` make no sound unless you pass `sfx`.
`check` does not see clipping: text you hide by clipping still counts, so
do not draw text that should not show. Try a product name with its plain
spelling first; only respell it when the speech check mishears it.

Many sounds under the voice make it hard to follow, and `verify` then
understands less of it. Keep long typing quiet (`u.typed(text, at, cps, {
gain: 0.25 })`) and give each moment one sound, not three.

A blur filter on every frame makes rendering slow. The kit blurs things once
and reuses them. Do the same if you add your own blur.

## Sizes for each platform

Set `size` to the place the video goes. `explainroo formats` lists the sizes.

| Size | Pixels | For |
|---|---|---|
| `youtube` (or `16:9`) | 1920 x 1080 | YouTube and other wide players |
| `shorts` | 1080 x 1920 | YouTube Shorts |
| `tiktok` | 1080 x 1920 | TikTok |
| `reels` | 1080 x 1920 | Instagram and Facebook Reels |
| `vertical` | 1080 x 1920 | one file for Shorts, TikTok and Reels |
| `instagram` | 1080 x 1350 | Instagram and Facebook feed posts |
| `linkedin` | 1080 x 1350 | the LinkedIn feed |
| `square` (or `1:1`) | 1080 x 1080 | square posts on X, LinkedIn and Facebook |

`9:16`, `4:5` and `WIDTHxHEIGHT` also work.

YouTube and LinkedIn take the `.srt` file as captions when you upload the
video.

Shorts, TikTok and Reels put their own buttons, the account name and the post
text on top of the video. With `shorts`, `tiktok`, `reels` and `vertical`,
explainroo keeps your content away from those spots. `s.safe` is the part the
app leaves free, and `s.cx` and `s.cy` are its center. The captions sit right
above the app's bottom band, and the watermark moves to the top right corner.
`check` warns about any text outside that area. Plain `9:16` has no such
margins, so use it only when the video is not meant for those apps.

Vertical videos have little room. Stack things instead of putting them side
by side, use fewer words on screen, and place everything from `s.safe`.
`explainroo formats` prints the content area of each size in pixels, for
example 745 x 746 on TikTok.

### Where the captions sit

Captions are on by default for vertical, 4:5 and square videos. On Shorts,
TikTok and Reels they sit right above the app's bottom band. On 4:5, square
and wide videos they sit at the bottom, above the watermark. On a plain
`9:16` video they sit about a quarter of the way up. In every case `s.safe`
ends above them. So anything placed inside `s.safe` stays clear of them, and
`check` warns about text in the caption band. Do not put the same sentence on
screen as text while the captions show it.

The first frame is often the cover picture on social apps. When the first
elements draw themselves in, frame one is empty. Give the title
`enter: 'none'` so it is there from the first frame, or pick another cover
frame in the app.

## One project, several sizes

Use `--size <size>` on `preview`, `still`, `sheet`, `check` and `render`
to use another size for one run. It leaves `video.json` alone. The narration
and word times are shared between sizes. Captions set to `"auto"` follow
the size you choose.

Place things from `s.safe`, `s.cx`, `s.cy`, `s.row`, `s.col` and `s.grid`
instead of fixed pixel positions. Use `s.portrait` to stack things in tall
frames. Keep text sizes relative to the frame, for example `s.W * 0.05`.
`examples/merge-vs-rebase` works in `9:16` and in `youtube`; its scenes.js
shows one way to do it.

```js
intro(s) {
  const cells = s.grid(s.portrait ? 1 : 2, s.portrait ? 2 : 1);
  ['Question', 'Answer'].forEach((label, i) => {
    const { x, y, w, h } = cells[i];
    s.box(label, { x, y, w: w * 0.8, h: h * 0.6,
      size: s.W * 0.05, at: i ? '#answer' : 0 });
  });
}
```

For every size, run `check --size <size>` and look at
`sheet --size <size>`. Fix cut-off text and overlaps. Then run
`render --size <size>` for each size.

`render --size tiktok` writes `out/video-tiktok.mp4` and matching subtitle,
cover and chapter files. With `--draft`, it writes `draft-tiktok.mp4`.
Stills go in `out/stills-tiktok/`. A sheet is `out/sheet-tiktok.jpg`, or
`out/sheet-intro-tiktok.jpg` with `--scene intro`. Ratios use a hyphen in
file names, for example `video-9-16.mp4`. Without `--size`, names stay the
same. `render --out` still sets the file name you choose.

## Pace

`pace` makes the whole video quicker or slower. At 1.3 the voice speaks about
30% faster. The voice model does not speed up exactly, so check the length
`voice` reports. The pauses, the time before and after each scene, the transitions and
every animation also get 30% shorter. Word and marker cues follow the voice.
So if you tie pictures to words, the rhythm stays right at any pace. Times in
seconds are real seconds of the scene, like `s.t` and `s.cue()`. So
`at: s.cue('word') + 0.3` means 0.3 seconds after the word at any pace. A
fixed time like `at: 4` does not move with the pace. That is one more reason
to use cues. 1 is the normal pace. 1.15 to 1.3 suits social media and viewers
who know the topic. Above 1.4 the video gets hard to follow. `speed` changes
only the voice. Its default is 0.9 for Kokoro and 1 for the other sources.

## The watermark

Every video gets a small "explainroo.com" in the bottom right corner. On
Shorts, TikTok and Reels it sits in the top right corner, because the app
covers the bottom one. The user can turn it off with `"watermark": false` in
`video.json`, or change it to their own text. If the user asks about it, tell
them it is their choice, and that keeping it helps more people find this free
project.

## Project files and settings

```
videos/<name>/
  video.json    look, size, language, voice, music, captions, watermark
  script.md     the narration, one "## scene-id" per scene
  scenes.js     one drawing function per scene
  assets/       images: screenshots, logos, generated illustrations
  build/        voice, timing and audio made by explainroo (safe to delete)
  out/          video.mp4, draft.mp4, stills/, sheets, report.json
```

`video.json` settings, all optional:

| Setting | Default | What it does |
|---|---|---|
| `title` | from the script | shown in the preview |
| `theme` | `paper` | a built-in look, or a relative path to a `.json` look file (see Custom looks) |
| `size` | `16:9` | a platform (`youtube`, `shorts`, `tiktok`, `reels`, `vertical`, `instagram`, `linkedin`, `square`), `16:9`, `9:16`, `1:1`, `4:5` or `WIDTHxHEIGHT` |
| `fps` | 30 | 24, 25, 30, 50 or 60 |
| `language` | `en` | narration language: `en`, `es`, `fr`, `it`, `pt-br`, `hi`, `ja` or `zh`; see Videos in other languages |
| `voice` | the language's voice | a Kokoro id or a provider object for Kokoro, ElevenLabs or a recording; English uses `af_heart`; see Voices |
| `speed` | 0.9 for Kokoro, 1 otherwise | voice speed only, 0.6 to 1.6; ElevenLabs limits speed times pace to 0.7 through 1.2 |
| `pace` | 1 | speed of the whole video (voice, pauses, animations), 0.7 to 1.6 |
| `music` | `true` | `true` (the look's style), `warm`, `upbeat`, `calm`, `tech`, `playful`, `{ "style", "volume" }` or `false` |
| `sfx` | `true` | sound effects: `true`, `"minimal"` or `false` |
| `captions` | `"auto"` | text of the narration at the bottom; auto turns it on for vertical and square videos |
| `cover` | `"auto"` | full-size JPEG, without captions, at the end of the first scene, or a still spec: `12.5`, `"intro"`, `"intro@2.4"`, `"intro@end"` |
| `transition` | `"auto"` | the look's default, or `fade`, `slide`, `wipe`, `zoom`, `brush`, `cut` |
| `camera` | `"auto"` | `"auto"` films each scene with a camera that follows the narration; `"still"` keeps every frame as written |
| `motionBlur` | `true` | motion blur on moving frames in the final render |
| `lead`, `hold`, `end` | 0.35, 0.7, 1.4 | seconds before the voice, after it, and extra at the very end |
| `sentenceGap`, `paragraphGap` | 0.3, 0.55 | pauses in generated narration; recordings keep their own pauses |
| `loudness` | -14 | target loudness in LUFS |
| `boil` | 0 | redraws per second of hand-drawn lines; 0 keeps them still |
| `watermark` | `"explainroo.com"` | small text in a corner, or `false` |
| `images` | none | `{ "model": "best" or "cheap", "style": "..." }` |
| `brand` | none | colors, fonts and logo for `s.ui`, see [Product demos](#product-demos) |
| `fonts` | none | the video's own font files, see [Product demos](#product-demos) |

The looks:

| Look | What it looks like | Transition | Music |
|---|---|---|---|
| `paper` | marker drawings on warm paper | brush | warm |
| `clean` | flat cards with soft shadows | slide | upbeat |
| `chalk` | chalk on a green board | brush | calm |
| `blueprint` | white drawings on blueprint blue | wipe | tech |
| `midnight` | dark background with glowing colors | zoom | tech |
| `editorial` | serif headlines and fine lines on warm paper, like a magazine | fade | calm |

### Custom looks

A look file gives a project its own colors, fonts and texture without
changing explainroo. Set `"theme": "../brand/acme-look.json"` in `video.json`.
The path is relative to the video folder, so a file outside it can give
several videos the same look.

```json
{
  "extends": "clean",
  "name": "acme",
  "bg": "#fbfaf7",
  "ink": "#1d1b16",
  "accent": "orange",
  "colors": { "orange": "#e8590c" },
  "background": "dots",
  "transition": "fade",
  "music": "calm"
}
```

`extends` names the built-in look to start from. Every other key is
optional and changes only what it lists: `name`, `dark`, `bg`, `ink`, `muted`,
`surface`, `accent`, `colors`, `fonts`, `background`, `stroke`, `radius`,
`transition`, `music`, `code`, `terminal` and `caption`. In the nested ones,
like `colors` or `caption`, list only the values you change. `name` defaults
to the file name and cannot be a built-in name. Set `"dark": true` when you
give a light look a dark `bg`, so fills and shadows suit it.

Use colors like `"#e8590c"`. `caption.bg` and `code.highlight` also accept
`rgba(...)`. `accent` names one of the ten colors: red, orange, yellow,
green, teal, blue, purple, pink, gray or ink.

`fonts` sets the `display`, `body`, `hand` and `mono` roles. Each takes a
`family` and a numeric `weight`, for example
`"body": { "family": "Inter", "weight": 500 }`. Families must be built in
or listed in `video.json` under `fonts`. The look file does not load fonts.

`background` picks a texture: `paper` (paper grain), `dots` (a dot grid),
`chalk` (board smudges), `grid` (drafting lines), `glow` (two glows) or
`plain` (one flat color). Each uses your `bg`. Leave it out to keep the base
texture. `transition` and `music` set the look's defaults. Settings in
`video.json` still win. `preview` picks up look edits, and `check` warns
when `ink` or `muted` has too little contrast against `bg`.

## Commands

| Command | What it does |
|---|---|
| `init <dir>` | creates a project (`--theme`, `--size`, `--pace`, `--language`, `--voice`, `--title`) |
| `voice [project]` | makes the narration and the word times, saved per scene so only changed scenes are made again |
| `preview [project]` | a live preview in the browser that reloads when you save (`--size`) |
| `still [project] [times]` | PNG pictures at `12.5`, `scene`, `scene@2.4` or `scene@end` (`--size`, `--transparent` keeps alpha) |
| `sheet [project]` | one image with many frames of the video or of one scene (`--scene`, `--every`, `--size`) |
| `check [project]` | finds layout, timing and pronunciation problems (`--size`) |
| `render [project]` | the video plus subtitle files, chapters and a cover (`--format mp4`, `gif`, `webm` or `mov`, `--transparent`, `--size`, `--draft`, `--from`, `--to`, `--workers`, `--out`) |
| `verify [project]` | checks the finished MP4, WebM or MOV: loudness, black frames, silence, clear voice (`--file` picks another file) |
| `export [project]` | writes a web player folder (`--out dir`, `--json`), by default `out/player/` |
| `capture [project] <url>` | saves screenshots, wording, colors, fonts and logos from a live site (`--mobile`, `--json`) |
| `image [project] <name> "<prompt>"` | makes an illustration with OpenRouter |
| `images [project]` | lists the images and what they cost |
| `voices`, `say "text"` | lists Kokoro voices with their languages (`--language es`, `ja` or `zh` filters voices), or makes a sample in the chosen voice's language |
| `voices [project] --elevenlabs` | lists the names, ids and labels available to the key (`--json` also works) |
| `themes`, `formats`, `icons <word>` | lists the looks and the sizes, searches the 1,854 icons |
| `doctor` | checks Node, ffmpeg, Chrome, the models, and espeak-ng and Python with misaki for other languages (`--fetch` downloads only English models) |

The extra files share the video's name, also with `--out`: `video.srt`,
`video.vtt`, `video.cover.jpg` and `video.chapters.txt`. A GIF has no sound,
runs at 15 frames per second and is at most 960 pixels on its long side.
With `--out`, the file ending must match the format. A render of part of the
video (`--from`, `--to`) skips the chapters and the cover. A video without
narration gets no subtitle files.

### Transparent video for editors

To put a diagram or a lower third over camera footage, render with an alpha
channel: `render --transparent --format mov` for video editors (ProRes 4444)
or `--format webm` for the web (VP9). The look's background texture is left
out. Everything the scene paints stays, including `s.bg()` and
`s.ui.backdrop()`, and cards, captions and the watermark keep their own
backgrounds. Keep elements readable on footage: use cards or the `bg` option
of text.

The files are `out/video.mov` or `out/video.webm` (`draft.*` with
`--draft`), and the cover stays an opaque JPEG. `slide`, `wipe` and `brush`
transitions become `fade` in a transparent video. Check frames with
`still --transparent`, which keeps the alpha, and the file with
`verify --file out/video.mov`, which skips the black-frame check for
transparent video. Without `--transparent`, WebM and MOV are ordinary opaque
videos.

## Web player

Use `export` for a video on a docs site or in an iframe. The canvas draws
at the screen's resolution, so text stays sharp when the player grows.
The folder has its own engine, fonts, assets, soundtrack, cover and subtitles.
It needs no explainroo server. The voice is made first if needed.

```bash
node bin/explainroo.js export videos/my-video
```

Serve `out/player/` with any static web server. Opening `index.html` as a
local file does not work. Copy the folder to your site, keeping its files
together. It works in a subfolder too.

For a 1920 x 1080 video, embed it like this. Change the aspect ratio to
match your video's width and height.

```html
<div style="aspect-ratio: 1920 / 1080; width: 100%">
  <iframe src="/videos/my-video/index.html" title="My video"
    style="width: 100%; height: 100%; border: 0"
    allow="autoplay; fullscreen" allowfullscreen></iframe>
</div>
```

`index.html?autoplay=1&muted=1` starts muted playback, subject to the
browser's autoplay rules. `index.html?t=12.5` starts at 12.5 seconds.
Click the picture to play or pause. Space or K does the same. The arrow
keys seek five seconds. F opens fullscreen, and M mutes the sound.
CC shows text captions above the controls. It starts off and remembers
your choice in the browser. Captions drawn in the canvas stay as they are.

Clips use the browser's video decoder. Use a format the browser can play.
Their timing can differ a little from the MP4. Math formulas are included
as typeset paths. Project modules must use relative local imports. Dotfiles,
JSON and text files from the project are kept out of the export.

The MP4 remains the file to upload to video platforms.

## Scene API

Each scene function draws one frame. explainroo calls it for every frame with
a fresh `s`, so everything in the scene depends only on the time. Do not keep
values between calls and do not use timers. Give each element an `at` time,
and the look animates it in. Give it an `out` time, and the look animates it
out.

```js
export default {
  intro(s) {
    s.title('How DNS works', { at: 0 });
    s.icon('globe', { y: 700, at: 'browser' });
  },
};
```

The canvas is 1920 x 1080 for 16:9. It is 1080 x 1920 for the vertical sizes,
1080 x 1080 for square, and 1080 x 1350 for `instagram`, `linkedin` and 4:5.
Positions are in pixels, counted from the top left corner. `x` and `y` are
the center of an element unless the method says otherwise.

### Time

| Member | Meaning |
|---|---|
| `s.t` | seconds since the scene started |
| `s.T` | seconds since the video started |
| `s.dur` | length of the scene in seconds |
| `s.voice` | `{ start, end }` of the narration in the scene |
| `s.words` | the spoken words: `{ text, start, end }` in scene seconds |
| `s.cue(word, n = 1)` | when the n-th time a word or phrase is spoken starts |
| `s.cueEnd(word, n = 1)` | when it ends |
| `s.mark(name)` | the time of a `[#name]` marker |
| `s.time(v)` | turns a number, a word or `"#marker"` into seconds |
| `s.pace` | the video's pace (1 is normal) |
| `s.p(at, dur = 0.6, ease = 'inOut')` | 0 to 1 progress for your own animation |
| `s.since(at)`, `s.between(a, b)` | seconds since a time, or whether now is between two times |
| `s.video` | `{ duration, frames, fps, width, height, scenes }` of the whole video |

Every `at` and `out` accepts seconds (`2.4`), a spoken word (`'resolver'`) or
a marker (`'#ask'`). Word cues ignore case and punctuation. A phrase works
too. A wrong word or marker stops with an error that lists the closest words.

An easing sets how a movement speeds up and slows down. The easing names are
`linear`, `in`, `out`, `inOut`, `outBack`, `outElastic`, `outQuart` and
`inOutSine`. `s.ease.out(p)`, `s.lerp(a, b, p)` and `s.clamp(v, lo, hi)` are
there for your own math.

### Layout

| Member | Meaning |
|---|---|
| `s.W`, `s.H`, `s.cx`, `s.cy` | canvas size and its center (on Shorts, TikTok and Reels the center of `s.safe`) |
| `s.portrait` | true when the frame is taller than wide |
| `s.safe` | `{ x, y, w, h, left, top, right, bottom }`: the area for content (a 7% margin, or the part a platform leaves free) |
| `s.row(n, { width, x })` | n x positions spread over a width |
| `s.col(n, { height, y })` | n y positions spread over a height, centered in `s.safe` |
| `s.grid(cols, rows, { x, y, w, h, gap })` | cells `{ x, y, w, h }`, row by row, filling `s.safe` |
| `s.get(id)` | size and position of an element drawn earlier with that `id` |

Most elements return `{ x, y, w, h, left, right, top, bottom }`, so you can
place the next thing below or beside them.

### Options most elements take

| Option | Meaning |
|---|---|
| `at`, `out` | when it appears and when it leaves |
| `enter` | `draw`, `write`, `type`, `words`, `sync`, `pop`, `rise`, `fade`, `zoom`, `drop`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `none` |
| `exit` | `fade`, `pop`, `rise`, `drop`, `slide-left`, `slide-right`, `none` |
| `dur` | length of the entrance in seconds (shortened by the pace) |
| `outDur` | length of the exit in seconds (0.45) |

`out` is when the exit starts, so an element is still fading while the next
one comes in. To swap one label for another in the same place, give the old
one `exit: 'none'` and the new one the same time as its `at`.
| `id` | a name for arrows, `annotate` and `s.get` |
| `color` | a color name (`blue`, `accent`, `ink`, `muted`, ...) or any CSS color |
| `opacity`, `scale`, `rotate` | extra changes, `rotate` in degrees |
| `float` | pixels of slow drift that keeps a still element alive |
| `sfx` | the sound on entrance, or `false` |

In `paper`, `chalk` and `blueprint`, shapes are drawn line by line and text
is written out. In `clean` and `midnight`, shapes pop and text rises. In
`editorial`, shapes fade in and text rises. Use
`at: -1` for things that were already on screen in the previous scene. They
are there from the start and make no sound.

### Text

```js
s.title('How DNS works', { at: 0 });                     // display font, 104 px, at 44% height
s.subtitle('the phone book of the internet', { at: 1 }); // 46 px, muted, at 60% height
s.text('Every site has an *address*', { y: 300, size: 64, at: 'address' });
s.note('about 20 ms', { x: 1400, y: 820, at: 3 });        // 32 px, muted
```

`s.text(str, options)` takes these options: `x`, `y`, `size` (48), `font`
(`display`, `body`, `hand`, `mono`), `weight` or `bold: true`, `align`
(`left` means x is the left edge), `valign` (`top` means y is the top),
`maxWidth`, `lineHeight`, `color`, `mark` (color of `*starred*` words), `bg`
(a card behind the text), `padding`, `radius`, `border`. Text can also enter
with `write`, `type` (with `cps`), `words` and `sync`. `sync` shows each word
as the voice says it. Words in `*stars*` get the accent color. `\n` starts a
new line.

### Math

```js
s.math('E = mc^2', { y: 420, size: 96, at: 'energy' });
s.math(String.raw`\int_0^1 x^2\,dx = \tfrac{1}{3}`, { x: 960, y: 700, size: 72, color: 'accent', at: '#integral', id: 'area' });
```

`s.math(tex, options)` draws a TeX formula. Options: `x`, `y` (the center),
`size` (72), `color` (ink), `align` (`center` or `left`, where x is the left
edge), `display` (true for display style), and the common element options.
It returns a box like text. Its `id` works with arrows and `s.annotate`.
In `paper`, `chalk` and `blueprint`, the outlines draw first, then fill in.
Other looks use their text entrance. You can also use `fade`, `pop` or `rise`.

Double each backslash in a regular JS string, for example `'\\frac{1}{2}'`.
`String.raw` keeps backslashes as written, as in the second example above.
Only fixed TeX strings work. Always call `s.math`, and use `at` and `out` for
timing. `check` reports formulas that change with `s.t` or appear only later.
Formulas are typeset on this computer and cached in `build/math/`.

### Shapes and arrows

```js
s.box('Resolver', { id: 'res', x: 960, y: 540, icon: 'server', color: 'blue', at: 'resolver' });
s.circle({ id: 'you', x: 400, y: 540, r: 90, label: 'You', at: 0.5 });
s.arrow('you', 'res', { label: 'asks', at: 'asks' });
s.arrow([300, 900], [1600, 900], { bend: 0.3, dashed: true, at: 5 });
s.line([[200, 800], [900, 700]], { color: 'accent', at: 2 });
s.path('M0 0 C 200 -150 400 150 600 0', { x: 660, y: 540, at: 3 });
```

`s.box(label, options)` is a card that fits its label. Options: `w`, `h`,
`minW`, `minH`, `size`, `font`, `icon`, `iconSize`, `iconColor`, `color`
(outline and a light fill), `fill`, `stroke`, `width`, `dashed`,
`border: false`, `radius`, `shape: 'ellipse'`, `textColor`, `fillStyle`
(hand-drawn looks: `solid`, `hachure`, `cross-hatch`, `zigzag`, `dots`).
`s.circle({ r, label })` takes the same options.

`s.line(points, options)` and `s.path(d, options)` take `color`, `width`,
`dashed`, `fill` and `glow`. `s.path` also takes `fillStyle`, and
`single: true` draws a hand-drawn path with one stroke instead of two.

`s.arrow(from, to, options)` draws an arrow. `from` and `to` are `[x, y]`,
`{ x, y }` or the `id` of an element drawn earlier. With an `id`, the arrow
stops at the edge of that element. Options: `bend` (about -1 to 1), `head`
(`end`, `start`, `both`, `none`), `label`, `labelSize`, `labelColor`,
`labelFont` (the handwritten font by default; `'body'` suits `clean`),
`labelOffset`, `gap`, `dashed`, `width`, `headSize`. `s.connect` does the
same.

### Icons, images and video clips

```js
s.icon('database', { x: 1500, y: 540, size: 140, color: 'purple', at: 'database' });
s.icon('lock', { bg: 'circle', color: 'green', label: 'Encrypted', at: 4 });
s.image('assets/app.png', { w: 1100, frame: 'browser', url: 'app.example.com', at: 0.5 });
s.image('assets/cables.png', { w: 1000, frame: 'card', at: 'cables', kenburns: true });
```

The 1,854 icons come from Lucide. Search them with `explainroo icons <word>`.
Old Lucide names work too. Icon options: `size` (120), `color`, `weight` (2),
`bg` (`true`, `'circle'`, `'square'` or a color), `bgScale`, `label`,
`labelSize`, `labelColor`, `labelFont`.

`s.image(src, options)` draws a file from `assets/`. Options: `w` and/or `h`
(the image keeps its shape), `fit` (`cover` or `contain`), `radius`, `frame`
(`none`, `card`, `browser`, `window`, `phone`), `url` (for the browser frame),
`border`, `shadow: false`, `kenburns: true` for a slow zoom.

`s.clip(src, options)` draws a video from `assets/`. It takes the same
layout, frame and timing options as `s.image` and returns the same box.
Use `.mp4`, `.mov`, `.webm` or `.m4v` files.

```js
s.clip('assets/signup.mp4', { w: 1200, frame: 'browser', url: 'app.example.com', at: 'signup' });
s.clip('assets/demo.mov', { x: 1400, y: 540, h: 600, from: 12.5, speed: 1.5, at: '#demo', out: 9 });
```

- `from` (0) is the second in the clip where playback starts.
- `speed` (1) goes from 0.25 to 4. Playback starts at `at`.
- `loop` (false) repeats the whole clip. Otherwise it holds the last frame.
  `check` gives a hint when that freeze lasts more than a second.
- `volume` (0) goes from 0 to 1. Sound plays only at `speed: 1`.
  It stops at `out`, the clip's end or the scene's end. Loops repeat the
  sound too. Music ducks under clip sound as it does under the voice.

Frames are extracted once at the project's fps and saved in `build/clips/`.
They are at most 1920 pixels wide. Renders, stills and sheets use these
frames. The preview may show a nearby frame while the right one loads.
`s.video` still holds the whole video's duration, frames, fps and size.
Playback starts at `at`, so `at: -1` starts a clip one second into it. To
show a clip from its first frame when the scene starts, use
`at: 0, enter: 'none'`. `check` cannot read text inside a clip, so look at
stills of those moments.

### Pointing things out

```js
s.text('It is *not* magic', { id: 'claim', y: 400, at: 0 });
s.annotate('claim', { type: 'underline', at: 'magic' });
s.annotate({ x: 960, y: 700, w: 400, h: 90 }, { type: 'circle', color: 'red', at: 3 });
```

`s.annotate(target, options)` marks an element or a box. `type` is
`underline`, `circle`, `box`, `highlight`, `strike`, `cross` or `bracket`.
Options: `color`, `padding`, `width`, `dur`.

### Lists, numbers and charts

```js
s.list(['Browser cache', 'Resolver', 'Root server'], { x: 360, y: 280, at: 'first', stagger: 1.1 });
s.number(1500000, { suffix: ' requests', at: 'million', y: 480 });
s.bars([{ label: '2023', value: 19 }, { label: '2024', value: 31 }], { at: 1, suffix: 'k' });
s.lineChart([3, 5, 4, 8, 13, 21], { labels: ['M', 'T', 'W', 'T', 'F', 'S'], at: 1 });
s.pie([{ label: 'Images', value: 55 }, { label: 'Other', value: 45 }], { donut: 0.55, at: 1 });
```

- `s.list(items, options)`: items are text or `{ text, at, icon, color, out }`.
  `x` is the left edge and `y` the top. Options: `size` (50), `width`, `gap`,
  `bullet` (`dot`, `dash`, `number`, `check`, `arrow` or an icon name),
  `bulletColor`, `at` (a start time or a list of times), `stagger` (0.7),
  `enter`.
- `s.number(value, options)` counts up with ticking sounds. Options: `from`,
  `dur` (1.4), `prefix`, `suffix`, `decimals`, `separator`, `group: false`,
  plus the text options.
- `s.bars(data, options)`: items are `{ label, value, color, at }`. A bar
  with its own `at` grows when that word is spoken. Options: `x`, `y`, `w`,
  `h`, `max`, `stagger`, `growDur`, `values: false`, `prefix`, `suffix`,
  `format(v)`, `labelSize`, `valueSize`, `fillStyle`.
- `s.lineChart(values, options)`: `x`, `y`, `w`, `h`, `min`, `max`,
  `labels`, `dots: false`, `area: false`, `color`, `dur`.
- `s.pie(data, options)`: `x`, `y`, `r`, `donut` (0 to 0.8), `labels: false`,
  `labelOffset`, `dur`.

### Code and terminal

```js
s.code("const res = await fetch(url);", { lang: 'js', title: 'app.js', at: 0.5 });
s.terminal(['$ npm install', 'added 42 packages in 3s'], { at: 1 });
```

`s.code(source, options)` shows code. Options: `x` and `y` (the center of
the window), `lang` (`js`, `ts`, `py`,
`go`, `rust`, `php`, `sh`, `sql`, `json`, `md`), `size` (32), `w`, `title`
(or `false`), `lineNumbers: false`, `reveal` (`type`, `lines`, `none`),
`cps`, `lineDelay`, `highlight` (line numbers) and `highlightAt`. `check`
reports lines that are wider than the window.

Use steps to show a change, a refactor or a fix:

```js
s.code([
  { code: 'const total = items.length;', at: 0.5 },
  { code: 'const total = items\n  .filter((i) => i.active)\n  .length;', at: 'filter', highlight: [2] },
  { code: 'const activeCount = items\n  .filter((i) => i.active)\n  .length;', at: '#rename' },
], { lang: 'js', title: 'stats.js' });
```

Parts that stay slide to their new place, removed parts fade out and new
parts fade in. Each later step starts at its own `at`, and the change takes
`morphDur` seconds (0.8, shortened by `pace`). The element's `at` defaults to
the first step's. `reveal` applies to the first step only. A step's
`highlight` replaces the earlier one. The window is as wide as the widest
step, up to 86% of the frame, unless you set `w`, and its height follows the
line count. `check` checks the lines of every step.

`s.terminal(lines, options)` shows a terminal. Lines that start with `$ ` are
typed as commands. Other lines are output. A line can also be `{ cmd, at }`
or `{ out, at, color }`. Options: `w`, `size`, `rows`, `title`, `prompt`,
`cps` (22), `outputDelay`, `lineGap`.

### Camera, groups and your own drawing

- `s.camera([{ at, x, y, zoom, dur, rotate }])` moves the view by hand
  instead of the automatic camera (see The camera). Call it first in the
  scene function. `s.camera([])` keeps the scene still.
- `s.focus(target, { at, out })` points the automatic camera at an element
  or a region on a cue, for example one row of a table. `target` is an `id`
  drawn earlier, `{ x, y, w, h }` (center and size) or `[x, y, w, h]`. It
  draws nothing. Highlighted code lines and terminal commands get a
  close-up on their own when they are small in the shot.
- `s.group({ x, y, scale, rotate, at, out, enter }, () => { ... })` moves a
  set of elements together. Inside the group, positions count from `x`, `y`.
- `s.draw({ x, y, at, out }, (ctx, life) => { ... })` gives you the canvas 2D
  context, so you can draw anything the other methods cannot. `life.p` is the
  entrance progress from 0 to 1, and `life.local` the seconds since `at`, for
  motion that keeps going. `s.ctx` is also available.
- `s.burst({ x, y, at, count, colors })` fires confetti.
- `s.bg(color)` paints over the background.
- `s.rand(i)`, `s.noise(x)` and `s.wiggle(amount, speed)` give random values
  that come out the same every time you render.

### Sound

Elements make a sound when they enter. The look picks the sound. Drawn lines
scribble, cards pop, arrows whoosh, list items play rising notes, numbers
tick, typing clicks, and scenes change with a swipe. `sfx: false` silences
one element. `"sfx": "minimal"` in `video.json` keeps only the transitions
and the sounds you add yourself.

`s.sfx(name, at, { gain, dur, pitch })` adds a sound: `pop`, `click`,
`whoosh`, `swipe`, `tick`, `type`, `ding`, `chime`, `thud`, `scribble`,
`chalk`, `rise`, `sparkle`, `blip`, `error`. `dur` sets the length of `type`,
`scribble`, `chalk` and `rise` (`rise` ends at `at + dur`). The music is made
to fit the video, and it gets quieter while the voice speaks.

### Colors and fonts

For product demos in a brand's own colors and fonts, see
[Product demos](#product-demos).

Color names: `accent`, `ink`, `muted`, `bg`, `surface`, `red`, `orange`,
`yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`. Each look has its
own version of each color, so scenes keep working when you change the look.
`s.color(name)` returns the CSS color and `s.tint(name)` the light fill. The
font roles are `display`, `body`, `hand` and `mono`.

## Things that break

- Calling an element only sometimes, like `if (s.t > 3) s.box(...)`. Always
  call it, and use `at` and `out` for the timing. The sound effects and the
  checks depend on this.
- Changing the TeX in `s.math` over time. Use fixed strings for each formula,
  and give each one its own `at` and `out`.
- An arrow or annotation that points to an `id` drawn later in the function.
- `s.camera()` after other elements. It has to come first.
- An `at` later than the end of the scene. Make the scene longer with
  `{hold=2}` or `{min=6}` in the script.
- Random values from anything other than `s.rand()`, `s.noise()` or
  `Math.random()` inside the scene function. Only those three come out the
  same on every render.
- Text in AI images. Put words on screen with `s.text`.
- A cue word that is spoken twice. `at: 'writes'` means the first time. Use
  `s.cue('writes', 2)` or a `[#marker]` for a later one. `check` lists such
  words as hints.
- Apostrophes in cue words. Cues ignore punctuation, so "visitor's" is heard
  as "visitors". `at: 'visitor'` then waits for the next plain "visitor".
  Use a `[#marker]` there.
- Elements inside `s.group`. Each one makes its sound at its own `at`, even
  while the group is still hidden. Give them the group's `at`, or
  `sfx: false`.
- Words that sound like other words. The speech check hears "won" as "one"
  and "plain" as "plane", and `{shown|spoken}` cannot fix that. Reword the
  sentence. For acronyms that are spelled out letter by letter, write
  `{API|A, P, I}`. Do not write `A.P.I.`, because the voice reads the dots
  like a web address.
- Growing a shape by changing `w` or `h` over time in the hand-drawn looks.
  The outline is drawn fresh every frame, so it wobbles. Animate `scale`
  instead.
- A scene change in the middle of one diagram. The default transition of
  `clean` slides the whole frame. Give scenes that share a diagram
  `{transition=fade}` or `{transition=cut}`.
- Arrows from an icon that has a label. The `id` of an icon covers the icon
  only, not its label, so an arrow that leaves downward crosses the label.
- Colored text in `paper` and `clean`. Green, orange and red are light enough
  for shapes but often too light for text. `check` warns about low contrast.
  It suggests a readable color and shows its contrast ratio.
- Long video clips fill `build/clips/` with frames. Trim footage to the part
  you show before you add it. Deleting `build/clips/` is safe.
- Screen recordings often have a variable frame rate. explainroo converts
  them to the project's fps, so a frame can repeat or drop. Record at a fixed
  frame rate when the motion matters.
- Exact geometry in `paper`, `chalk` and `blueprint`. Their outlines are
  hand drawn, so a circle's edge wanders a little from its radius. When a
  line has to meet an outline exactly, like a radius that ends on the
  circle, draw both with `s.draw`.
- A render that stops with a closed browser or `EPIPE` on a busy computer.
  Run it again with fewer pages, for example `render --workers 2`.

`check` looks at text and math formulas. It finds text off the frame, too
close to the edge (3.5%), too small, with low contrast (against the page, or
against the text's own `bg`), on top of other text, or under the captions.
It does not see shapes, arrows and icons, or drawings made with `s.draw`.
Look at the stills for those.

## Working on explainroo itself

- `src/` is the part that runs in Node: script, voice, word timing, timeline,
  server, rendering, checks and images. `engine/` is the part that runs in
  the browser page: the scene API (`stage.js`), drawing (`pen.js`), looks,
  transitions, captions and audio (`engine/audio/`).
- Run `npm test` after changes. After engine changes, also render the videos
  in `examples/` and look at their stills and sheets.
- `dev/audio-lab.mjs` renders every music style and sound and measures them.
- `npm run build:icons` rebuilds the icons from `lucide-static`, and
  `npm run build:fonts` downloads the fonts again.
