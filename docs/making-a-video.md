# Making a video, step by step

These are the steps from a brief to a finished video. In the commands,
`explainroo` is short for `npx --yes explainroo`, or for
`node bin/explainroo.js` in a source checkout. The start page, which
`npx --yes explainroo docs` prints, has the hard limits and when to ask the
user. Read it first.

1. **Learn the subject.** Read the code, docs or pages the user points to.
   Write down the facts you will use. Never make up numbers, quotes or claims.
   If a number matters and you cannot check it, leave it out.

2. **Create the project.**

   ```bash
   explainroo init videos/<name> --theme paper --size 16:9 --title "..."
   ```

   A project can go in any folder. The examples here use `videos/<name>`. Each
   project's `.gitignore` covers its own output. Pick the look that fits the
   audience: `paper` (friendly, hand drawn, the default), `clean`
   (products and business), `chalk` (teaching), `blueprint` (engineering),
   `midnight` (developer tools) or `editorial` (essays, history, money and
   other thoughtful topics). Pick the size for the place the video goes,
   for example `--size tiktok` or `--size linkedin`. `explainroo docs sizes`
   lists the sizes. Add `--pace 1.2` when the user wants a quicker video.

3. **Write `script.md`.** The narration comes first. It sets the timing for
   everything else. `explainroo docs writing` says how to write it.

4. **Make the voice.**

   ```bash
   explainroo voice videos/<name>
   ```

   The command prints how long the voice speaks in each scene, how long the
   scene's narration is with its pauses, and how many words the speech check
   confirmed. Each scene's line starts with its number, like "scene 4/6", and
   says about how long the rest will take. A long voice run can take longer
   than your tool waits for a command, so run it in the background if your
   tool can. If a word is not confirmed, the voice said it wrong, or the
   speech model heard it wrong. Under the scene, `voice` quotes what it heard
   there, with four words on each side, and says what to do. When the voice
   says a word wrong, fix it with `{shown|spoken}` in the script and run the
   command again. If the word already has `{shown|spoken}`, try another spoken
   spelling, or reword the sentence. A short word like "its" has no better
   spelling, so `voice` says to reword the sentence then. For a
   recording, make script.md say what was actually said. `check` also lists
   the words that only nearly matched, like "Soundroo" heard as "Soundru". It
   lists words that sounded the same, like "peace" for "piece", and two words
   heard as one. They count as understood, and names the speech model doesn't
   know often end up there. `check` and `verify` give each one its time in the
   video. No fix is needed unless it sounds wrong when you listen at that
   time.
   Before it makes the narration, `voice` prints how long the video will be
   about.
   Only the scenes you changed are made again. `check`, `still`, `sheet`,
   `render` and `preview` also make missing narration, so start them after
   `voice` has finished, not at the same time.

5. **Plan the pictures.** For each scene, decide what is on screen when each
   marker or important word is spoken. Decide where each thing sits and what
   leaves the screen. Keep things in the same place from scene to scene.
   Answer four questions for each scene. What is the one thing the viewer
   should look at? Which relationship does the layout show: an order, a
   comparison, the parts of a whole or a cause? What appears and what leaves
   on each cue? What stays in the same place in the next scene?
   `explainroo docs pictures` has four layouts to start from.

6. **Make images, if the video needs them and the user agrees.** Icons and
   diagrams cover most technical topics. Everyday how-to topics like cooking,
   cars or gardening work better with pictures. `explainroo docs images` says
   how to make them.

7. **Write `scenes.js`.** Write one function per scene. Tie every picture to
   the narration with `at: 'word'` or `at: '#marker'`. `explainroo docs scene-api`
   lists everything a scene can draw, and `explainroo docs troubleshooting`
   lists the mistakes that break a scene.

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
   explainroo sheet videos/<name> --times 3,intro@2.5,40  # moments to compare
   ```

   Open the images and judge them like a viewer would. Is the text big
   enough? Is anything cut off or on top of something else? Is half the frame
   empty? Does the sheet show something new every few seconds? Fix what is
   wrong and look again. A frame caught while the camera moves, or while
   something draws itself in, has "camera moving" or "drawing in" under it
   on the sheet. `still` prints the same next to the file. Such a frame can
   look cut off or empty and still be fine, so look at a moment after it.

   For Reddit and other feeds, also run `check videos/<name> --view-width
   854`. It warns when visible text shrinks below 16px in that player.
   This is a size check, not a guarantee about platform compression. Show
   only the current query or result, use bigger type, and zoom into details.
   Review a still at `--scale 0.4448` too (about 480p for a 1080p video).

10. **Make the video and check the file.**

    ```bash
    explainroo render videos/<name>           # final video
    explainroo verify videos/<name>
    ```

    `render --draft` makes a quick half-size version. Make one only when you
    will watch it, because `still` and `sheet` are the cheap way to see
    frames.

    `render` also writes subtitle files (`.srt` and `.vtt`) and a cover
    image (`.cover.jpg`) next to the video. When scenes name chapters, it
    writes `.chapters.txt` for the YouTube description and adds the chapters
    to the MP4. `--format gif` makes a silent GIF instead, for a README or a
    post. `verify` checks the MP4. It measures the loudness and looks for
    black frames and silence. `render` keeps the true peak at -1 dBTP or
    lower. `verify` warns above that and fails above 0 dBTP, where the sound
    clips. It also runs the speech check on the finished sound to make sure
    the voice is still clear over the music, and it lists the words that only
    nearly matched next to the percentage it understood, each with its time in
    the video. Each word it could not confirm is a warning with its time in
    the video. Its last line is the verdict: "passed", "passed with 2
    warnings" or "failed: 1 problem", and `--json` has it as `verdict`, with
    `passed` true or false.

11. **Tell the user** where the video and its subtitle files, chapters and
    cover are, how long the video is, what verify said, and what you could
    not check. To post it, read `explainroo docs publishing` first.
