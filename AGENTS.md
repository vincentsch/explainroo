# explainroo for coding agents

Run explainroo with `npx --yes explainroo`. `--yes` stops `npx` from waiting
on its install question. In a source checkout, run `node bin/explainroo.js`
instead. The command examples below shorten this to plain `explainroo`, so type
the full form when you run them. Running through `npx` does not install a
permanent `explainroo` command on `PATH`.

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
no API key for local voices or recordings. Paid voices, AI images, AI clips and
posting need a key or a login.

The full documentation for people is at https://www.explainroo.com/docs/.

## Before you start

You only need to clone explainroo to change explainroo itself. Run this once,
in any folder:

```bash
npx --yes explainroo doctor --fetch
```

`doctor` checks Node, ffmpeg and Chrome, and the extra programs some
languages need. It also downloads the English speech models, about 400 MB,
the first time only. Each part is `ready`, `missing` with how to get it, or
`not needed` for this setup. `doctor videos/<name>` checks what that
project's languages and voices need. Commands that work on a video take the
project folder first, and every command accepts `--json`.

`explainroo docs` prints this file. A few topics have their own page.
`explainroo docs --list` lists them, and `explainroo docs <topic>` prints one.

### When to ask the user

Decide the normal things yourself, like the look, the length, the voice, the
layout and the wording. Ask only when you cannot go on without an answer.
When you ask, put everything you need in one message. Typical reasons to ask:

- The topic is unclear, or you need a fact you cannot check.
- The user chose AI images, clips or a paid voice and has no key for it. Run
  `explainroo connect openrouter`, `elevenlabs` or `cartesia` and show the
  user what it prints.
- The user wants a post and has no login. Run `explainroo connect youtube`,
  `buffer` or `blotato` and show the user what it prints.
- The user wants something explainroo cannot do, like video shot with a
  camera.

Explainroo makes the whole video for free. When the user asks for something
that can use an outside service, run `explainroo services <step> --json` and
tell the user the options, free ones first. Say which cost money and which are
paid partners. Let the user choose. Never pick a paid service for them and
never call a partner the best.

### Where keys go

`explainroo connect <service>` sets up a key. It says what the service costs and
what data leaves the computer, tests the key, and saves it only if the test
passes. In a terminal it asks with a hidden prompt. With no terminal it prints
the steps and two ways to finish: the user runs it in their own terminal, or the
key comes in on stdin with `--key-stdin`. A key never goes on the command line.

A key is a line like `OPENROUTER_API_KEY=...` in a `.env` file. `connect` saves it
in the settings folder, so every project can use it. In a source checkout it uses
the `.env` in that folder, and `--project <dir>` uses that project's `.env`.
`doctor` prints the settings file as `keys file`. It is the first of these that
applies:

- `$EXPLAINROO_CONFIG/.env`, when that is set
- On Windows, `%APPDATA%\explainroo\.env`
- `$XDG_CONFIG_HOME/explainroo/.env`, when that is set
- `~/.config/explainroo/.env`

explainroo uses the first value it finds. It looks in the environment, then
`.env` in the project folder, then `.env` in a source checkout, then the
settings folder. New projects list `.env` in their `.gitignore`. An older
project may not, so check before you put a key there. Never print a key, and
never put it in a script, a commit or a log.

## Making a video, step by step

1. **Learn the subject.** Read the code, docs or pages the user points to.
   Write down the facts you will use. Never make up numbers, quotes or claims.
   If a number matters and you cannot check it, leave it out.

2. **Create the project.**

   ```bash
   explainroo init videos/<name> --theme paper --title "..."
   ```

   A project can go in any folder. The examples here use `videos/<name>`. Each
   project's `.gitignore` covers its own output. Pick the look that fits the
   audience: `paper` (friendly, hand drawn, the default), `clean`
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
   explainroo voice videos/<name>
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

6. **Make images, if the video needs them and the user agrees.** Icons and diagrams cover most
   technical topics. Everyday how-to topics like cooking, cars or gardening
   work better with pictures. See "Images" below.

7. **Write `scenes.js`.** Write one function per scene. Tie every picture to
   the narration with `at: 'word'` or `at: '#marker'`. The scene API is at
   the end of this file.

8. **Check.**

   ```bash
   explainroo check videos/<name>
   ```

   Fix every error and every warning. You decide what to do with the hints.

9. **Look at the frames.** You cannot watch the video, so this is how you see
   it.

   ```bash
   explainroo still videos/<name>                 # the end of each scene
   explainroo still videos/<name> intro@2.5 12.0  # any moment
   explainroo sheet videos/<name> --scene intro   # one scene over time
   explainroo sheet videos/<name>                 # the whole video
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

10. **Make the video and check the file.**

    ```bash
    explainroo render videos/<name> --draft   # quick half-size version
    explainroo render videos/<name>           # final video
    explainroo verify videos/<name>
    ```

    `render` also writes subtitle files (`.srt` and `.vtt`) and a cover
    image (`.cover.jpg`) next to the video. When scenes name chapters, it
    writes `.chapters.txt` for the YouTube description and adds the chapters
    to the MP4. `--format gif` makes a silent GIF instead, for a README or a
    post. `verify` checks the MP4. It measures the loudness and looks for
    black frames and silence. `render` keeps the true peak at -1 dBTP or
    lower. `verify` warns above that and fails above 0 dBTP, where the sound
    clips. It also runs the speech check on the finished sound to make sure
    the voice is still clear over the music.

11. **Tell the user** where the video and its subtitle files, chapters and
    cover are, how long the video is, what verify said, and what you could
    not check. To post it, see "Posting a video" below.

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
*Stars* mark a keyword that bold captions show in color. Nobody hears them.
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
      // The note hangs from the card, so a note that wraps grows downward.
      const card = s.box(title, { x: c.x, y: c.y - u * 3, w: c.w * 0.8, size: u * 4, color, at });
      s.text(note, { x: c.x, y: card.bottom + u * 1.2, valign: 'top', size: u * 2.6, color: 'muted', maxWidth: c.w * 0.85, at });
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
of it. Arrows and lines may run off the edge, but their labels stay whole, and
so do the labels of charts. While the camera moves from
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
  a line in a chart, get no close-up of their own. Neither does an icon
  without a label or a box without words, because up close it shows nothing
  new. Give it a label, or use `s.focus` when one should get a close-up.
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

`"camera": "still"` in `video.json` turns the camera off for the whole video.
`check` checks the layout as you wrote it, without the camera. Stills, sheets
and renders show the camera.

The final render adds motion blur to frames where something moves, like a
film camera. Drafts skip it. `"motionBlur": false` turns it off.

## Voices

Kokoro runs on this computer and needs no key. Pick a voice with
`explainroo voices`. A string in `video.json` keeps using Kokoro:

```json
"voice": "af_heart"
```

`{ "provider": "kokoro", "id": "af_heart" }` means the same thing.

ElevenLabs has its own voices and can clone one. It costs money on the user's
account and receives the script text. If the user wants it and there is no
key, run `explainroo connect elevenlabs`, as "Where keys go" says.

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
says so first.

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

ElevenLabs, Cartesia and recordings work in every supported language.
Run `voice`, `check` and `render` as usual with any source.

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

### One video in several languages

`script.md` is the main language, from `language`. Each `script.<lang>.md`
adds one, like `script.es.md`. One `scenes.js` draws them all. Put on-screen
text in `strings.json` and `strings.<lang>.json` and read it with `s.str('key')`.
Nested groups become dotted keys like `'intro.title'`. Word cues differ between
languages, so give each script the same `[#markers]`.

Add `--lang es` to the commands from `voice` to `publish`. Spanish builds in
`build/es/` and writes to `out/es/`. `"languages": { "es": { ... } }` holds
settings for one language, and a language without its own voice uses its
default. `package` reads `post.es.json` if there is one.

### Japanese and Chinese

Japanese and Chinese need Python 3 with misaki and more setup, and they are
written and checked differently. Before you make a video in either language,
run `explainroo docs japanese-and-chinese` and follow it.

## Images

explainroo can make illustrations with AI image models through OpenRouter.
This is optional. It costs money on the user's OpenRouter account, roughly 7
to 13 cents per image at the time of writing.

If the user wants images and there is no key, run
`explainroo connect openrouter`, as "Where keys go" says.

```bash
explainroo image videos/<name> cables "Two cars parked nose to nose with their hoods open, jumper cables between the batteries"
explainroo images videos/<name>    # what was made and what it cost
```

This saves `assets/cables.png`. Use it in a scene with
`s.image('assets/cables.png', { w: 1100, frame: 'card', at: 'cables' })`.

The same command again returns the same file and spends nothing. Changing the name,
the prompt or a setting makes a new image, and `--new` buys this one again. A
purchase never deletes a file: the old `assets/cables.png` moves to
`history/replaced/`, and asking for its request again brings it back. A request
that failed or got no answer may have cost money, so it needs `--new`.

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

## AI video clips

`explainroo clip` buys a short AI video clip through OpenRouter, on the same key
as images. It costs money, and clips are bad at text, diagrams and showing the
same character twice. Ask the user, and run `explainroo docs clips` first.

```bash
explainroo clip videos/<name> "A busy street at dusk" --seconds 6 --dry-run     # the price, spends nothing
explainroo clip videos/<name> "A busy street at dusk" --seconds 6 --max-cost 2  # buys it if the price fits the cap
```

It saves `assets/clips/<name>.mp4` and prints the `s.clip` line to use. The same
command run again never buys twice, so it is safe after a crash or a timeout.

## Posting a video

`explainroo package videos/<name> --platform tiktok` writes `out/package/tiktok/`
with everything needed to post the video there. The platforms are `youtube`,
`shorts`, `tiktok`, `reels`, `linkedin` and `x`. Write the title, description
and hashtags in `post.json` next to `video.json`. Run
`explainroo docs publishing` first.

`explainroo share` uploads a finished video to explainroo.com for a page link.
That service is coming, and until it runs, `share` makes no link.
`explainroo publish videos/<name> --via youtube|buffer|blotato` posts a
package. They are the only commands that upload a video, so run them only when
the user asks. Run `publish` with `--dry-run` first and show the user the plan.
Add `--yes` only after the user said yes.

## Product demos

A product demo is the kind of video software companies make to show their
app. You rebuild the app's screens with `s.ui`, and a mouse pointer clicks
through them. When the user asks for one, run
`explainroo docs product-demos` first. It says how to capture the live site
and keep the video true, and it lists what `s.ui` can draw.

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
The `compare` layout above shows one way.
[examples/merge-vs-rebase](https://github.com/vincentsch/explainroo/tree/main/examples/merge-vs-rebase)
works in `9:16` and in `youtube`.

For every size, run `check --size <size>` and look at
`sheet --size <size>`. Fix cut-off text and overlaps. Then run
`render --size <size>` for each size.

`--size tiktok` adds `-tiktok` to every file a command writes, like
`out/video-tiktok.mp4`, `out/stills-tiktok/` and `out/sheet-intro-tiktok.jpg`.
A ratio uses a hyphen, like `video-9-16.mp4`. `--no-watermark` turns the
watermark off for one run and adds `-no-watermark` the same way.
`render --out` still sets the file name you choose.

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
project. A TikTok package has no watermark, because TikTok forbids one on posts
from apps.

## Project files and settings

```
videos/<name>/
  .gitignore    keeps build/, out/, .env and history/private/ out of git
  video.json    look, size, language, voice, music, captions, watermark
  script.md     the narration, one "## scene-id" per scene
  scenes.js     one drawing function per scene
  post.json     the words for package, optional
  assets/       images, generated illustrations, clips and sound files
  build/        voice, timing and audio made by explainroo (safe to delete,
                because paid speech and paid images stay in history/)
  out/          video.mp4, draft.mp4, stills/, sheets, report.json, package/
  history/      what was paid for and rendered, so keep it. A new session runs
                "explainroo history" to see open jobs and how to continue them
```

`video.json` settings, all optional:

| Setting | Default | What it does |
|---|---|---|
| `title` | from the script | shown in the preview |
| `theme` | `paper` | a built-in look, or a relative path to a `.json` look file (see Custom looks) |
| `size` | `16:9` | a platform (`youtube`, `shorts`, `tiktok`, `reels`, `vertical`, `instagram`, `linkedin`, `square`), `16:9`, `9:16`, `1:1`, `4:5` or `WIDTHxHEIGHT` |
| `fps` | 30 | 24, 25, 30, 50 or 60 |
| `language` | `en` | narration language: `en`, `es`, `fr`, `it`, `pt-br`, `hi`, `ja` or `zh`; see Videos in other languages |
| `voice` | the language's voice | a Kokoro id or a provider object for Kokoro, ElevenLabs, Cartesia or a recording; English uses `af_heart`; see Voices |
| `languages` | none | settings for one language, like `{ "es": { "voice": "ef_dora" } }`; see Videos in other languages |
| `speed` | 0.9 for Kokoro, 1 otherwise | voice speed only, 0.6 to 1.6; paid voices limit speed times pace, see Voices |
| `pace` | 1 | speed of the whole video (voice, pauses, animations), 0.7 to 1.6 |
| `music` | `true` | `true` (the look's style), `warm`, `upbeat`, `calm`, `tech`, `playful`, `{ "style", "volume" }`, `false`, or your own file as `{ "src", "volume", "credit", "loop" }`, see `explainroo docs music` |
| `sfx` | `true` | sound effects: `true`, `"minimal"` or `false` |
| `captions` | `"auto"` | text of the narration at the bottom; auto turns it on for vertical and square videos; `"bold"` shows 2 to 4 big words at a time, with numbers, money and `*starred*` words in color |
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
| `brand` | none | colors, fonts and logo for `s.ui`, see `explainroo docs product-demos` |
| `fonts` | none | the video's own font files, see `explainroo docs product-demos` |

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
| `voice [project]` | makes the narration and the word times, saved per scene so only changed scenes are made again (`--force` makes every scene again, `--new` buys again only paid sentences with no good answer) |
| `preview [project]` | a live preview in the browser that reloads when you save (`--size`, `--no-watermark`) |
| `still [project] [times]` | PNG pictures at `12.5`, `scene`, `scene@2.4` or `scene@end` (`--size`, `--no-watermark`, `--transparent` keeps alpha) |
| `sheet [project]` | one image with many frames of the video or of one scene (`--scene`, `--every`, `--size`, `--no-watermark`) |
| `check [project]` | finds layout, timing and pronunciation problems (`--size`, `--no-watermark`) |
| `render [project]` | the video plus subtitle files, chapters and a cover (`--format mp4`, `gif`, `webm` or `mov`, `--transparent`, `--size`, `--no-watermark`, `--draft`, `--from`, `--to`, `--workers`, `--out`) |
| `verify [project]` | checks the finished MP4, WebM or MOV: loudness, true peak, black frames, silence, clear voice (`--file` picks another file) |
| `export [project]` | writes a web player folder (`--out dir`, `--json`), by default `out/player/` |
| `package [project]` | a folder to post on one platform (`--platform`, `--title`, `--description`, `--hashtags`, `--size` for x, `--workers`) |
| `share [project]` | uploads a video to explainroo.com for a page link, once that service runs (`--platform`, `--file`, `--title`, `--new`) |
| `publish [project]` | posts a package after a typed yes or `--yes` (`--via`, `--platform`, `--privacy`, `--media-url`, `--channel`, `--account`, `--dry-run`, `--new`) |
| `capture [project] <url>` | saves screenshots, wording, colors, fonts and logos from a live site (`--mobile`, `--json`) |
| `image [project] <name> "<prompt>"` | makes an illustration with OpenRouter (`--new` buys it again, `--resume <id>` runs a job from `history` again) |
| `images [project]` | lists the images and what they cost |
| `clip [project] "<prompt>"` | buys a short AI video clip with OpenRouter (`--seconds`, `--max-cost`, `--dry-run`, `--aspect`, `--model`, `--resolution`, `--audio`, `--name`, `--no-wait`, `--new`, `--resume <id>`) |
| `services [step]` | lists the choices for each step, free ones first, with what each costs and what data leaves (`--json`, `--project`) |
| `connect <service>` | sets a service up: tests its key or signs in through the browser, and saves it (`--key-stdin`, `--callback-url`, `--project`) |
| `history [project]` | prints open paid jobs with the command that continues each one, then spend, then rendered versions |
| `voices`, `say "text"` | lists Kokoro voices with their languages (`--language es`, `ja` or `zh` filters voices), or makes a sample in the chosen voice's language |
| `voices [project] --provider <id>` | lists the names, ids and labels available to the key of `elevenlabs` or `cartesia` (`--language`, `--json`) |
| `themes`, `formats`, `icons <word>` | lists the looks and the sizes, searches the 1,854 icons |
| `doctor [project]` | checks Node, ffmpeg, Chrome, the models, and espeak-ng and Python with misaki for other languages, for one project when given (`--fetch` downloads only English models) |
| `docs [topic]` | prints this file, or one page from `docs/` (`--list` lists the pages) |
| `version` | prints the version (`--version` also works) |

The extra files share the video's name, also with `--out`: `video.srt`,
`video.vtt`, `video.cover.jpg` and `video.chapters.txt`. A GIF has no sound,
runs at 15 frames per second and is at most 960 pixels on its long side.
With `--out`, the file ending must match the format. A render of part of the
video (`--from`, `--to`) skips the chapters and the cover. A video without
narration gets no subtitle files.

To put a diagram or a lower third over camera footage, render with an alpha
channel: `render --transparent --format mov` or `--format webm`. Run
`explainroo docs transparent-video` first.

## Web player

`export` writes a web player for a docs site or an iframe, with its own
engine, fonts, soundtrack and subtitles. `explainroo docs web-player` says how
to serve and embed it. The MP4 remains the file to upload to video platforms.

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
| `id` | a name for arrows, `annotate` and `s.get` |
| `color` | a color name (`blue`, `accent`, `ink`, `muted`, ...) or any CSS color |
| `opacity`, `scale`, `rotate` | extra changes, `rotate` in degrees |
| `float` | pixels of slow drift that keeps a still element alive |
| `sfx` | the sound on entrance, or `false` |

`out` is when the exit starts, so an element is still fading while the next
one comes in. To swap one label for another in the same place, give the old
one `exit: 'none'` and the new one the same time as its `at`.

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

`s.str('key')` gives on-screen text from the strings file of the language
drawn, and `s.lang` its code.

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

### Short videos

`s.short` is a kit for Shorts, TikTok and Reels: a hook title that is there on
the first frame, stickers, a step pill, a payoff card and camera punch-ins.
Run `explainroo docs short-video` before you use it.

### Camera, groups and your own drawing

- `s.camera([{ at, x, y, zoom, dur, rotate }])` moves the view by hand
  instead of the automatic camera (see The camera). Call it first in the
  scene function. `s.camera([])` keeps the scene still.
- `s.focus(target, { at, out })` points the automatic camera at an element
  or a region on a cue, for example one row of a table. `target` is an `id`
  drawn earlier, `{ x, y, w, h }` (center and size) or `[x, y, w, h]`. It
  draws nothing.
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

`s.sound('assets/door.mp3', { at, out, volume })` plays your own file on a cue,
lowered under the voice. `"sfx": false` doesn't silence it.

### Colors and fonts

For product demos in a brand's own colors and fonts, run
`explainroo docs product-demos`.

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
close to the edge (3.5%), too small, with low contrast (against the page, a
background from `s.bg` or `s.short.backdrop`, or the text's own `bg`), on top
of other text, or under the captions.
It does not see shapes, arrows and icons, or drawings made with `s.draw`.
Look at the stills for those.

## Working on explainroo itself

- To change explainroo, clone it and install it:
  `git clone https://github.com/vincentsch/explainroo.git`, then `npm install`.
  Write `node bin/explainroo.js` in place of `explainroo`. Git ignores
  `videos/` in the checkout, so projects can go there.
- `src/` is the part that runs in Node: script, voice, word timing, timeline,
  server, rendering, checks and images. `engine/` is the part that runs in
  the browser page: the scene API (`stage.js`), drawing (`pen.js`), looks,
  transitions, captions and audio (`engine/audio/`).
- Run `npm test` after changes. After engine changes, also render the videos
  in [examples/](https://github.com/vincentsch/explainroo/tree/main/examples)
  and look at their stills and sheets.
- `npm run test:pack` installs the package in a temp folder and makes a real
  video from there. Run it after changes to the package or the command line.
- `dev/audio-lab.mjs` renders every music style and sound and measures them.
- `npm run build:icons` rebuilds the icons from `lucide-static`, and
  `npm run build:fonts` downloads the fonts again.
- To add an outside service, read `explainroo docs connectors`.
