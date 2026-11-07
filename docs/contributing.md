# Working on explainroo itself

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
- The instructions for coding agents are `AGENTS.md` and the topics in
  `docs/`. `AGENTS.md` is the start page that `explainroo docs` prints, and
  `skills/explainroo/SKILL.md` carries the same text below its front matter.
  A test checks that the two match. The start page stays under 12,000 bytes
  and each topic under 24,000, so details go in a topic, and the start page
  names it in its list of topics.
