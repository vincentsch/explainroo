// The help of each command, for "explainroo <command> --help" and
// "explainroo help <command>": its usage, what it does, its options and one
// example. The general help in cli.js lists every command on one or two lines.
import { CONNECTORS } from './connectors/index.js';
import { LIKENESS_FLAGS } from './presenter.js';

// The paid voices that can list what a key may use, from their connectors.
const VOICE_LISTS = CONNECTORS.filter((c) => c.voices).map((c) => c.id);

const SIZE = ['--size <size>', 'another size than the one in video.json, like tiktok, 9:16 or 1080x1350'];
const PLATFORM = ['--platform <name>', 'the size, its block in "sizes" and the watermark rule that "package --platform <name>" uses'];
const WATERMARK = ['--no-watermark', 'leave out the watermark'];
const VERBOSE = ['--verbose', 'list every word that only nearly matched, with its times, also when there are more than two'];
const LANG = ['--lang <lang>', 'the version of the video in that language, from script.<lang>.md'];
const JSON_OUT = ['--json', 'machine-readable output'];

export const COMMAND_HELP = {
  init: {
    usage: 'init <dir> [options]',
    about: 'Creates a project: video.json, a script.md and a scenes.js with the same scene names, and an assets folder.',
    options: [['--format <format>', 'start from a format: its settings, its example script and scenes, its scene helpers in format.js and its guide in format.md. "explainroo formats" lists them'], ['--title "<title>"', 'the title of the video'], ['--theme <look>', 'studio (the default), paper, clean, chalk, blueprint, midnight or editorial'], ['--size <size>', 'like 16:9, tiktok or linkedin'], ['--pace <n>', 'speed of the whole video, 0.7 to 1.6'], ['--language <code>', 'en, es, fr, it, pt-br, hi, ja or zh'], ['--voice <id>', 'a Kokoro voice, see "explainroo voices"']],
    example: 'init videos/how-dns-works --theme chalk --title "How DNS works"',
  },
  set: {
    usage: 'set <project> <key> <value> [options]',
    about: 'Writes one setting into video.json and keeps the rest of the file as it is. The value is JSON when it reads as JSON, like 40, false or {"pace": 1.2}, and text otherwise. null takes the key out. A dotted key like sizes.shorts.pace sets a setting of one size. The settings get the same check as every command first, so a mistake changes nothing.',
    options: [JSON_OUT],
    example: 'set videos/how-dns-works targetSeconds 40',
  },
  voice: {
    usage: 'voice [project] [options]',
    about: 'Makes the narration and the word timings of every scene that changed, and checks what the speech model heard.',
    options: [['--estimate', 'print how long the video will be about, and what that means for targetSeconds, and make nothing'], ['--force', 'make every scene again'], ['--new', 'buy again only the paid sentences with no good saved answer'], ['--size <size>', 'the narration of a size whose block in "sizes" sets its own pace'], LANG, JSON_OUT],
    example: 'voice videos/how-dns-works',
  },
  words: {
    usage: 'words [project] [scene…] [options]',
    about: 'Prints each spoken word of the scenes you name with its start time, in seconds into the scene, as a cue like at: \'word\' uses it. Without a scene it prints every scene.',
    options: [['--size <size>', 'the timings of a size whose block in "sizes" sets its own pace'], LANG, JSON_OUT],
    example: 'words videos/how-dns-works intro resolver',
  },
  preview: {
    usage: 'preview [project] [options]',
    about: 'Opens a live preview in your browser that reloads when you save.',
    options: [['--port <n>', 'the port, 4400 by default'], SIZE, WATERMARK, LANG],
    example: 'preview videos/how-dns-works',
  },
  still: {
    usage: 'still [project] [time…] [options]',
    about: 'Writes PNG stills of moments of the video. A time is seconds ("12.5"), a scene ("intro") or a moment in a scene ("intro@2.4", "intro@end"). Without times it takes the end of every scene.',
    options: [SIZE, PLATFORM, WATERMARK, ['--transparent', 'a transparent background'], ['--scale <n>', 'smaller stills, like 0.5'], LANG, JSON_OUT],
    example: 'still videos/how-dns-works intro@2.4 resolver@end',
  },
  sheet: {
    usage: 'sheet [project] [options]',
    about: 'Writes a contact sheet of the whole video, or of one scene, as a JPEG.',
    options: [['--scene <id>', 'one scene'], ['--every <s>', 'seconds between frames'], ['--times <list>', 'only these moments, like 3,12.5,intro@2'], ['--cols <n>', 'frames in a row'], SIZE, PLATFORM, WATERMARK, LANG, JSON_OUT],
    example: 'sheet videos/how-dns-works --scene intro',
  },
  check: {
    usage: 'check [project] [options], or check <video.mp4> [options]',
    about: 'Finds layout, timing and pronunciation problems without rendering. It exits with 1 when it finds an error. With a video file in place of the project, it checks any video, made with explainroo or not: black, blank and frozen stretches, silence, loudness and true peak, and text too small to read in frames 1 second apart.',
    options: [['--view-width <px>', 'also judge text at this player width'], ['--step <s>', 'seconds between the moments it looks at, 0.25 by default, and for a video file 1'], ['--script <file>', 'for a video file, compare the speech with this text'], ['--language <code>', 'for a video file, the language of the speech, en by default'], SIZE, PLATFORM, WATERMARK, VERBOSE, LANG, JSON_OUT],
    example: 'check videos/how-dns-works --platform tiktok',
  },
  render: {
    usage: 'render [project] [options]',
    about: 'Writes the video, with subtitles, chapters and a cover next to it.',
    options: [['--draft', 'a quick, smaller video to watch'], ['--quality final|fast', 'fast leaves out the motion blur of a final'], ['--format mp4|gif|webm|mov', 'the file type'], ['--transparent', 'a transparent background, for webm and mov'], ['--from <s>, --to <s>', 'only part of the video'], ['--workers <n>', 'pages that draw at the same time'], ['--scale <n>', 'a smaller video, like 0.5'], ['--out <file>', 'where to write it'], SIZE, PLATFORM, WATERMARK, LANG, JSON_OUT],
    example: 'render videos/how-dns-works',
  },
  verify: {
    usage: 'verify [project] [options], or verify <video.mp4> [options]',
    about: 'Checks a finished video: loudness, true peak, black frames, silence and how much of the narration the speech model understands. With a video file in place of the project, it checks any video, like check <video.mp4>.',
    options: [['--file <file>', 'another video file than out/video.mp4'], [PLATFORM[0], 'check the file that render --platform <name> wrote'], [SIZE[0], 'check the file that render --size <size> wrote'], [WATERMARK[0], 'check the file that render --no-watermark wrote'], ['--script <file>', 'for a video file, compare the speech with this text'], ['--language <code>', 'for a video file, the language of the speech, en by default'], ['--view-width <px>', 'for a video file, also judge text at this player width'], ['--step <s>', 'for a video file, seconds between the frames it reads, 1 by default'], VERBOSE, LANG, JSON_OUT],
    example: 'verify videos/how-dns-works',
  },
  cut: {
    usage: 'cut <video> [options], then cut <video> --apply',
    about: 'Edits your own recording by its words. The speech model listens to it and writes <name>.cut.md next to it: one sentence a line, each word with its time, with [pause] for quiet stretches and [sound] for sound without words. Delete words, pauses and sounds in it. Then --apply writes <name>.cut.mp4, with the sound crossfaded at every join. See "explainroo docs cut".',
    options: [['--apply', 'cut the video as the list says'], ['--out <file>', 'with --apply, where to write it'], ['--language <code>', 'the language of the speech, en by default'], ['--force', 'write the list again from the recording, over your edits'], ['--min-gap <seconds>', 'show pauses and sounds from this length, 0.6 s by default'], ['--dry-run', 'with --apply, try the list and write no file'], JSON_OUT],
    example: 'cut talk.mp4',
  },
  export: {
    usage: 'export [project] [options]',
    about: 'Writes a folder with a web player of the video, out/player/ by default.',
    options: [['--out <dir>', 'where to write it'], SIZE, WATERMARK, LANG, JSON_OUT],
    example: 'export videos/how-dns-works',
  },
  clean: {
    usage: 'clean [project] [options]',
    about: 'Lists and takes out what build/ holds that the next run makes again by itself, like the frames of clips and recordings, and says how much room that frees. The narration in build/voice/ stays.',
    options: [['--dry-run', 'list it and take out nothing'], JSON_OUT],
    example: 'clean videos/how-dns-works',
  },
  package: {
    usage: 'package [project] --platform <name> [options]',
    about: 'Writes out/package/<platform>/ with everything for one platform: the sized video, its words, captions, cover, AI label and credits. It checks the exact setup first and reuses a render that is this exact video.',
    options: [['--platform <name>', 'youtube, shorts, tiktok, reels, linkedin or x'], ['--title, --description, --hashtags', 'words that win over post.json'], ['--size <size>', 'for x, which takes any size'], ['--workers <n>', 'pages that draw at the same time'], LANG, JSON_OUT],
    example: 'package videos/how-dns-works --platform tiktok',
  },
  share: {
    usage: 'share [project] [options]',
    about: 'Uploads a finished video to explainroo.com and prints a page link, once that service runs. Until then it sends nothing and says so.',
    options: [['--platform <name>', 'share the package of that platform'], ['--file <file>', 'another video file'], ['--title "<title>"', 'the title of the page'], ['--new', 'upload again'], LANG, JSON_OUT],
    example: 'share videos/how-dns-works --platform youtube',
  },
  publish: {
    usage: 'publish [project] --via youtube|buffer|blotato [options]',
    about: 'Posts a package under your name. It shows the exact post first, and a real run needs a typed yes, or --yes when there is no terminal.',
    options: [['--via <service>', 'youtube, buffer or blotato'], ['--platform <name>', 'the package to post'], ['--dry-run', 'show the post and send nothing'], ['--yes', 'post without asking, where there is no terminal'], ['--privacy <p>', 'private, unlisted or public on YouTube'], ['--media-url <url>', 'a public link to the video, for Buffer and Blotato'], ['--media-url-unchecked', 'post the link without checking that it leads to a file of the package\'s size'], ['--channel <id>', 'the Buffer channel'], ['--account <id>', 'the Blotato account'], ['--draft', 'save it as a draft in Buffer'], ['--new', 'post again'], LANG, JSON_OUT],
    example: 'publish videos/how-dns-works --via youtube --dry-run',
  },
  capture: {
    usage: 'capture [project] <url> [options]',
    about: 'Saves screenshots, wording, colors, fonts, logo, text and a list of images of a live site.',
    options: [['--name <name>', 'save to assets/capture/<site>/<name>/, for several pages of one site'], ['--mobile', 'a phone-sized page'], JSON_OUT],
    example: 'capture videos/my-demo https://example.com',
  },
  record: {
    usage: 'record <project> <name> [options], or record <project> --inspect <url>',
    about: 'Runs the steps of recordings/<name>.json in a browser of its own and saves the video as assets/recordings/<name>.webm, with the time and the box of every step in assets/recordings/<name>.log.json. s.recording(\'<name>\') plays it in a scene with a cursor, click rings and zooms. When a step can\'t find its element, or something covers it, it stops with the step number and a picture of the page. Every run starts with an empty browser profile.',
    options: [['--keep-profile', 'keep cookies and stored data for the next run, for a site that needs a login'], ['--inspect <url>', 'open the page and list every visible element to click or type into, with a text and a selector a step can use and its box. It records nothing'], ['--all', 'with --inspect, also list headings, sections and images, for zoom and scroll steps'], ['--text "<words>"', 'with --inspect, list only the elements that hold these words, the smallest first and then the larger ones around it'], ['--viewport <w>x<h>', 'with --inspect, the size of the window, 1920x1080 by default. Use the viewport of the script'], JSON_OUT],
    example: 'record videos/my-demo new-invoice',
  },
  image: {
    usage: 'image [project] <name> "<what to draw>" [options]',
    about: 'Buys an illustration through OpenRouter and saves it as assets/<name>.png. This costs money. The same request returns the file it already bought.',
    options: [['--model best|cheap', 'the image model'], ['--aspect <ratio>', 'like 16:9'], ['--ref <files>', 'pictures to follow, like assets/a.png,assets/b.png'], ['--style "<words>"', 'the style of this image, in place of "style" in video.json'], ['--no-style', 'without the project\'s style'], ['--new', 'buy it again'], ['--resume <id>', 'run a job from history again'], JSON_OUT],
    example: 'image videos/how-dns-works server-room "a rack of servers in a cool room"',
  },
  images: {
    usage: 'images [project] [options]',
    about: 'Lists the images the project bought and what they cost.',
    options: [JSON_OUT],
    example: 'images videos/how-dns-works',
  },
  clip: {
    usage: 'clip [project] "<what it shows>" --seconds <n> [options]',
    about: 'Buys a short AI video clip through OpenRouter as assets/clips/<name>.mp4. This costs money, so it needs --max-cost or a budget. It checks the price against that cap before it buys. The final cost is known only after the job, and it can come out a little higher. A budget works the same way. Each clip counts at its price until its job is done and then at what it cost, so all clips together can come out a little above the budget. --dry-run shows the price and spends nothing.',
    options: [['--seconds <n>', 'the length, one the model takes'], ['--max-cost <usd>', 'the cap for this clip, checked against the price before it buys'], ['--budget <usd>', 'what all clips of the project may cost together, checked against each price before it buys'], ['--dry-run', 'show the price and spend nothing'], ['--aspect <ratio>', '16:9 or 9:16'], ['--model cheap|quality', 'or an OpenRouter model id'], ['--resolution <r>', 'like 720p'], ['--audio', 'with sound'], ['--name <name>', 'the file name'], ['--no-wait', 'return right after the request'], ['--new', 'buy it again'], ['--resume <id>', 'continue a job'], JSON_OUT],
    example: 'clip videos/bees "Bees on a honeycomb, close up" --seconds 4 --dry-run',
  },
  services: {
    usage: 'services [step] [options]',
    about: 'Lists the choices for each step, free ones first, with what each costs and what leaves your computer.',
    options: [['--project <dir>', 'show which keys that project has'], JSON_OUT],
    example: 'services clips',
  },
  connect: {
    usage: 'connect <service> [options]',
    about: 'Sets a service up: tests its key and saves it, or signs in through the browser.',
    options: [['--key-stdin', 'read the key from standard input'], ['--project <dir>', 'save the key for one project'], ['--callback-url <address>', 'finish a browser sign-in'], JSON_OUT],
    example: 'connect openrouter --key-stdin',
  },
  history: {
    usage: 'history [project] [options]',
    about: 'Lists open paid jobs with the command that continues each one, then what was spent and rendered.',
    options: [JSON_OUT],
    example: 'history videos/how-dns-works',
  },
  voices: {
    usage: 'voices [project] [options]',
    about: 'Lists the Kokoro voices, or the voices your key may use at a paid service.',
    options: [['--language <code>', 'the voices of one language'], ['--provider <name>', VOICE_LISTS.join(' or ')], JSON_OUT],
    example: 'voices --language es',
  },
  say: {
    usage: 'say "<text>" [options]',
    about: 'Speaks a text with a Kokoro voice into a WAV file, to hear a voice.',
    options: [['--voice <id>', 'af_heart by default'], ['--speed <n>', '1 by default'], ['--out <file>', 'the WAV file']],
    example: 'say "Hello there" --voice am_michael',
  },
  themes: { usage: 'themes [options]', about: 'Lists the looks and the music styles.', options: [JSON_OUT], example: 'themes' },
  presenter: {
    usage: 'presenter [project] <scene> --avatar <id> --max-cost <usd> [options], or presenter [project] --avatars',
    about: 'Makes a clip of an AI presenter who speaks the narration of one scene, through a presenter service the user picked, and saves it as assets/presenters/<scene>.mp4 for s.presenter. No service is built in yet: EXPLAINROO_PRESENTER_URL names one and PRESENTER_API_KEY holds its key. It refuses a real person\'s face or voice without the service\'s consent flow, before anything is sent. Every package of the video then gets the AI label.',
    options: [['--avatars', 'list the service\'s avatars with their consent and price'], ['--avatar <id>', 'the avatar that speaks'], ['--max-cost <usd>', 'the most the clip may cost'], ['--name <name>', 'the file name, the scene id by default'], ['--dry-run', 'show what goes out and what it costs, and buy nothing'], ['--new', 'buy the clip again'], JSON_OUT],
    example: 'presenter videos/acme-launch intro --avatar ava --dry-run',
  },
  formats: {
    usage: 'formats [format] [options], or formats add <git address> [options]',
    about: 'Lists the formats, built in and installed, or prints the guide of one. A format is a ready way of making one kind of video. "formats add" prints the git commands it will run and installs nothing without --yes. Installing runs no code from the format.',
    options: [['--commit <id>', 'with add: install the format as it is at this commit'], ['--yes', 'with add: install it'], JSON_OUT],
    example: 'formats add https://github.com/<user>/<repo>.git --commit 3f2a9c1',
  },
  sizes: { usage: 'sizes [options]', about: 'Lists the sizes, with the content area of each with and without the watermark, also with bold captions. The content area is s.safe, and the caption band is not part of it.', options: [JSON_OUT], example: 'sizes' },
  icons: { usage: 'icons <word…> [options]', about: 'Searches the built-in icons, one match per line.', options: [JSON_OUT], example: 'icons database' },
  doctor: {
    usage: 'doctor [project] [options]',
    about: 'Checks ffmpeg, Chrome, Playwright\'s ffmpeg for record, espeak-ng, misaki and the models: each is ready, not needed or missing. It also prints the settings file and the folder explainroo runs from.',
    options: [['--language <codes>', 'before there is a project, what these languages need, like es or es,fr'], ['--fetch', 'download the models that setup needs, and on Debian and Ubuntu set up espeak-ng without root when a language needs it. For a project with recordings it also gets Playwright\'s ffmpeg'], ['--record', 'also check Playwright\'s ffmpeg for record, and with --fetch download it. record otherwise downloads it the first time'], JSON_OUT],
    example: 'doctor --fetch --language es',
  },
  docs: {
    usage: 'docs [topic] [section] [options]',
    about: 'Prints the start page for coding agents, one topic, or one section of a topic by its heading.',
    options: [['--list', 'the topics'], ['--sections', 'the sections of a topic with their size'], JSON_OUT],
    example: 'docs scene-api --sections',
  },
  version: { usage: 'version', about: 'Prints the version. --version works too.', options: [JSON_OUT], example: 'version' },
};

// Flags a command takes that its help doesn't list: the older way to name a
// paid voice list, and the likeness flags presenter refuses with its consent
// rule. --json, --quiet and --help work with every command.
const MORE_FLAGS = { voices: VOICE_LISTS, presenter: LIKENESS_FLAGS };
const EVERY_COMMAND = ['json', 'quiet', 'help', 'version'];

// The flags of a command, from the options of its help.
export function commandFlags(name) {
  const listed = COMMAND_HELP[name].options.flatMap(([flag]) => [...flag.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]));
  return [...new Set([...listed, ...(MORE_FLAGS[name] ?? []), ...EVERY_COMMAND])];
}

// The help of one command, as text.
export function commandHelp(name, command = 'explainroo') {
  const h = COMMAND_HELP[name];
  const width = Math.max(...h.options.map(([flag]) => flag.length));
  return [
    `Usage: ${command} ${h.usage}`,
    '',
    h.about,
    ...(h.options.length ? ['', 'Options:', ...h.options.map(([flag, words]) => `  ${flag.padEnd(width)}  ${words}`)] : []),
    '',
    'Example:',
    `  ${command} ${h.example}`,
  ].join('\n');
}
