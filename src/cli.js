// explainroo command line.
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, ProjectError, THEMES, MUSIC_STYLES, FORMATS, resolveSize, normalizeConfig, scriptName, checkClipBudget, checkLanguage, noKokoroVoice, DEFAULTS_VERSIONS } from './project.js';
import { layoutAreas } from '../engine/layout.js';
import { levenshtein, suggest } from '../engine/util.js';
import { normWord, ScriptError } from './script.js';
import { prepare, makeState, outdatedLine, outdatedRenders, VERSION } from './pipeline.js';
import { render } from './render.js';
import { exportPlayer } from './export.js';
import { check, formatVerify, NEARLY_LISTED, NEARLY_SHORT, nearlyText, untimed, stills, sheet, unconfirmedLine, unconfirmedWords, verify } from './qa.js';
import { startServer, ROOT } from './server.js';
import { VOICES, LANGUAGES, voiceLanguage, loadTTS, TTS_SAMPLE_RATE } from './models.js';
import { phonemize, generateSpeech } from './phonemes.js';
import { writeWav } from './wav.js';
import { doctor, formatDoctor } from './doctor.js';
import { generateImage, jobRequest, imageLog, imageSpend, oldImageLog, IMAGE_MODELS } from './images.js';
import { buyClip, clipJobRequest, clipRequest, formatClip, quoteClip } from './ai-clips.js';
import { capture } from './capture.js';
import { formatInspect, formatRecord, inspect, record } from './record.js';
import { clean, formatClean } from './clean.js';
import { connect } from './connect.js';
import { CONNECTORS } from './connectors/index.js';
import { hideSecrets } from './errors.js';
import { formatHistory, historyReport, selfCommand } from './history.js';
import { boughtCharacters, speechConnector } from './paid-speech.js';
import { allOf, formatServices, findService, findStep, needsKey, SERVICES, STEPS, stepNames, stepServices } from './services.js';
import { clipPricesToday, showsClipPrices } from './price-list.js';
import { narrationTime, speechKeys } from './voice.js';
import { estimateLength, estimateLine, targetNotes } from './timeline.js';
import { formatSet, setSetting } from './set.js';
import { findEnv } from './env.js';
import { formatPackage, packageOverrides, packageVideo } from './package.js';
import { PLATFORMS } from './post.js';
import { bareWord } from './align.js';
import { formatShare, share } from './share.js';
import { formatPublish, publish } from './publish.js';
import { COMMAND_HELP, commandFlags, commandHelp } from './help.js';
import { checkVideo, formatVideoCheck, isVideoFile, VIDEO_FILE } from './video-check.js';
import { applyCut, formatCut, writeCut } from './cut.js';
import { LIKENESS_FLAGS, avatarList, consentRule, formatAvatars, formatPresenter, makePresenter } from './presenter.js';
import { addFormat, addPlan, findFormat, formatAdded, formatEntry, formatList, formatPlan, listFormats, startFromFormat } from './formats.js';

// Paid voices that can list what a key may use, each with its own flag.
const LISTS_VOICES = CONNECTORS.filter((c) => c.voices);

const HELP = `explainroo ${VERSION}: narrated explainer videos from code

Usage: explainroo <command> [project] [options]

Make a video
  init <dir>            create a project (--theme, --size, --pace, --language en|es|fr|it|pt-br|hi|ja|zh, --voice, --title).
                        German works with a paid voice or a recording, see "explainroo docs languages"
                        --format product-launch starts from a format: its guide, scene helpers, settings and example
  formats [format]      list the formats, or print the guide of one. "formats add <git address>" shows what it
                        will run, and installs the format with --yes (--commit id takes that commit)
  set <project> <key> <value>  write one setting into video.json, after the same check every command
                        runs. A dotted key like sizes.shorts.pace sets one size's setting, the value is
                        JSON when it reads as JSON, and null takes the key out
  voice [project]       make the narration and word timings (--force makes every scene again,
                        --new buys again only the paid sentences with no good saved answer, --size makes
                        the narration of a size whose block in "sizes" sets its own pace). --estimate
                        prints how long the video will be about from the script, and makes nothing
  words [project] [scenes]  each spoken word of the scenes named, or of all, with its start time, for choosing cues
  preview [project]     live preview in your browser, reloads on save (--port, --size, --no-watermark)
  still [project] [t…]  PNG stills: "12.5", "scene", "scene@2.4" (default: end of every scene; --size,
                        --no-watermark, --transparent)
  sheet [project]       contact sheet of the whole video (--scene id, --every s, --size, --no-watermark).
                        --times 3,12.5,intro@2 makes out/sheet-times.jpg of just those moments, written
                        like the times of still
  check [project]       find layout, timing and pronunciation problems (--view-width pixels, --size, --no-watermark).
                        check <video.mp4> checks any video file: blank, frozen and silent stretches, loudness,
                        true peak and text too small to read (--script file compares the speech with it)
  render [project]      write the video with subtitles, chapters and a cover (--format mp4|gif|webm|mov,
                        --transparent, --size, --no-watermark, --draft, --quality final|fast, --from s, --to s,
                        --workers n, --out file). A final draws 6 samples per frame for motion blur, and
                        --quality fast makes a final without it
  verify [project]      check the video: loudness, black frames, narration (--file). verify <video.mp4> checks
                        any video file, like check <video.mp4>
  export [project]      write a web player folder (--out dir, default: out/player/; --size, --no-watermark)
  clean [project]       list and take out what build/ holds that the next run makes again, like the frames
                        of clips and recordings, and say how much room that frees (--dry-run). The narration stays

Edit your own recording
  cut <video>           write <name>.cut.md, the words of the recording with their times (--language, --force,
                        --min-gap seconds shows shorter pauses and sounds). Delete words and pauses in it, then
                        cut <video> --apply writes <name>.cut.mp4 (--out; --dry-run tries it and writes nothing)

Post a video
  package [project]     write a folder for one platform: the sized video, its words, captions, cover, AI label
                        and credits (--platform youtube|shorts|tiktok|reels|linkedin|x, --title, --description,
                        --hashtags, --size for x, --workers n). The words come from post.json, see "docs publishing"
  share [project]       upload a finished video to explainroo.com and get a page link, once that service runs
                        (--platform name shares a package, --file, --title, --new uploads again). Only share
                        and publish upload a video
  publish [project]     post a package through YouTube, Buffer or Blotato (--via youtube|buffer|blotato,
                        --platform name, --privacy private|unlisted|public, --media-url, --channel id for Buffer,
                        --account id for Blotato). --dry-run shows the exact post and posts nothing. A real
                        run needs a typed yes, or --yes when there is no terminal. --new posts again.
                        --draft saves the post as a draft in Buffer. A video link has to lead to a file of
                        the package's size, unless you add --media-url-unchecked

Product demos
  capture [project] <url>  save screenshots, wording, colors, fonts and logo of a live site, with its text
                        and a list of its images (--mobile).
                        --name pricing saves to assets/capture/<site>/pricing/, so several pages of one site
                        stay side by side
  record <project> <name>  run recordings/<name>.json in a browser of its own and save the video with a log
                        of every step in assets/recordings/, for s.recording in a scene. Every run starts
                        with an empty browser profile, and --keep-profile keeps cookies and stored data for
                        the next run, for a site that needs a login. "record <project> --inspect <url>" lists
                        what a step can click or type into, with a text and a selector for each (--viewport).
                        --all adds headings, sections and images, and --text "<words>" lists what holds them

Images (optional, costs money, needs an OpenRouter key from "explainroo connect openrouter")
  image [project] <name> "<what to draw>"   save an illustration as assets/<name>.png
                        (--model best|cheap, --aspect 16:9, --ref assets/a.png,assets/b.png, --no-style)
                        The same request returns the file it already bought (--new buys it again,
                        --resume <id> runs a job from history again)
  images [project]      list generated images and what they cost

AI video clips (optional, costs money, uses the same OpenRouter key as images)
  clip [project] "<what it shows>" --seconds 6 --max-cost 2   buy a short clip as assets/clips/<name>.mp4
                        (--aspect 16:9, --model cheap|quality, --resolution 720p, --audio, --name <name>,
                        --no-wait returns right after the request). --budget 0.40, or "clipBudget" in
                        video.json, is the most all clips of the project may cost, and then --max-cost is optional
                        --dry-run shows the price and spends nothing. It needs no key and no project, and
                        without a project it prices 16:9 at 720p without sound unless the flags say otherwise
                        The same command never buys twice (--new buys it again, --resume <id> continues a job)

AI presenters (optional, costs money, needs a presenter service; none is built in yet)
  presenter [project] <scene> --avatar <id> --max-cost 1   make a clip of an AI presenter who speaks the
                        narration of a scene, as assets/presenters/<scene>.mp4 for s.presenter (--name, --dry-run,
                        --new). --avatars lists the service's avatars. No real person's face or voice without the
                        service's consent flow, and every package then gets the AI label

Outside services (optional)
  services [step]       list the choices for each step, free ones first (--project dir). For clips it
                        shows today's prices from OpenRouter's public list, which it reads at most once a day
                        Steps: ${STEPS.map((s) => s.id).join(', ')}. The command names ${STEPS.filter((s) => s.command).map((s) => s.command).join(' and ')} also work
  connect <service>     set a service up: test its key and save it (--key-stdin, --project dir), or sign in
                        through the browser and finish with --callback-url '<address>'
  history [project]     open paid jobs and the command that continues each one, then what was spent and rendered

Reference
  voices [project]      list Kokoro voices (--language es for one language, --provider ${LISTS_VOICES.map((c) => c.id).join('|')} for the
                        voices your key may use)
  say "text"            hear a Kokoro voice (--voice am_michael, --speed 1, --out sample.wav)
  themes                list looks
  sizes                 list sizes for YouTube, Shorts, TikTok, Reels, Instagram and LinkedIn. For each it
                        shows the content area with the watermark and without it, also with bold captions
  icons <word…>         search the 1,800+ built-in icons
  doctor [project]      check ffmpeg, Chrome, Playwright's ffmpeg for record, espeak-ng, misaki and models: each is
                        ready, not needed or missing. With a project, for its languages and voices. Before there
                        is a project, --language es checks what that language needs (--fetch downloads the models
                        it needs and Playwright's ffmpeg, and on Debian and Ubuntu it sets up espeak-ng without
                        root when a language needs it)
  docs [topic] [section]  print the start page for coding agents, one topic, or one section of a topic by its
                        heading (--list shows the topics, --sections the sections of a topic with their size)
  version               print the version (--version works too)

"explainroo <command> --help" prints the options of one command and an example.

Options: --size <size> and --no-watermark override video.json for preview, still, sheet, check, render and export.
         --platform <name> on check, still, sheet, render and verify sets the size, its block and the watermark rule
         that "package --platform <name>" uses.
         Their outputs get a suffix, like video-tiktok.mp4, player-tiktok/ or video-no-watermark.mp4. --out still wins.
         "sizes" in video.json sets captions, cover, pace, watermark and targetSeconds for one size, see "docs sizes".
         --lang es picks the version from script.es.md, for voice, preview, still, sheet, check, render, verify,
         export, package, share and publish. It builds into build/es/ and writes to out/es/.
         --json for machine-readable output. The project defaults to the current folder.
Docs: "explainroo docs" (for coding agents) and https://www.explainroo.com/docs/`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !BOOL.has(a.slice(2))) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else if (a === '-h') flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}
const BOOL = new Set(['json', 'keep-profile', 'all', 'record', 'apply', 'avatars', 'draft', 'estimate', 'transparent', 'force', 'fetch', 'help', 'version', 'quiet', 'open', 'no-style', 'mobile', 'list', 'sections', 'new', 'key-stdin', 'audio', 'dry-run', 'no-wait', 'no-watermark', 'yes', 'media-url-unchecked', ...LISTS_VOICES.map((c) => c.id), 'verbose']);

// What a command adds when it refuses a flag. A flag publish ignored could
// change what a person thinks is posted, like a time for a post, when it goes
// out right away.
const FLAG_NOTES = {
  still: 'Times go after the project, like: explainroo still videos/<name> intro@2.4',
  publish: 'It has no scheduler, so a post goes out when the command runs. Nothing was sent.',
};

// Every command refuses a flag it doesn't take, so a typo or a flag of another
// command never falls back to a default without a word. connect has a rule of
// its own, because what is on its line may be a key.
export function unknownFlag(cmd, flags) {
  if (cmd === 'connect' || !Object.hasOwn(COMMAND_HELP, cmd)) return null;
  const takes = commandFlags(cmd);
  const flag = Object.keys(flags).find((f) => !takes.includes(f));
  if (flag === undefined) return null;
  const listed = takes.filter((f) => !['quiet', 'help', 'version'].includes(f));
  // The closest flag, when it is only a typo or a part away.
  const close = listed.map((f) => ({ f, d: Math.min(f.length, flag.length) >= 4 && (f.includes(flag) || flag.includes(f)) ? 0 : levenshtein(flag, f) }))
    .sort((a, b) => a.d - b.d)[0];
  const near = close && close.d <= (flag.length >= 4 ? 2 : 1);
  const takesWhat = listed.length > 1 ? `It takes ${listed.map((f) => `--${f}`).join(', ')}.` : 'It takes only --json.';
  return [`${cmd} does not take --${flag}.`, near ? `Did you mean --${close.f}?` : '', takesWhat, FLAG_NOTES[cmd] ?? ''].filter(Boolean).join(' ');
}

function num(v, name) {
  if (v === undefined) return undefined;
  if (v === true) throw new ProjectError(`--${name} needs a value`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ProjectError(`--${name} must be a number`);
  return n;
}

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  const json = !!flags.json;
  const log = json || flags.quiet ? () => {} : lineLog(process.stderr);
  // What must be said also with --json, such as money about to be spent.
  const notice = (m) => process.stderr.write(`${m}\n`);
  const print = (human, data) => {
    if (json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else if (human) process.stdout.write(human + '\n');
  };

  if (cmd === 'version' || flags.version) {
    print(VERSION, { version: VERSION });
    return 0;
  }
  if (!cmd || cmd === 'help' || flags.help) {
    // "still --help" and "help still" print the help of that command.
    const name = cmd === 'help' ? pos[0] : cmd;
    process.stdout.write(`${name && Object.hasOwn(COMMAND_HELP, name) ? commandHelp(name) : HELP}\n`);
    return 0;
  }

  try {
    const refused = unknownFlag(cmd, flags);
    if (refused) throw new ProjectError(refused);
    switch (cmd) {
      case 'init': return init(pos[0], flags, print);
      case 'set': {
        if (pos.length !== 3) throw new ProjectError('usage: explainroo set <project> <key> <value>, like: explainroo set videos/<name> targetSeconds 40. A dotted key like sizes.shorts.pace sets a setting of one size, and null takes a key out.');
        const r = setSetting(pos[0], pos[1], pos[2]);
        print(formatSet(r), r);
        return 0;
      }
      case 'presenter': {
        // explainroo sends no face or voice of its own, so these get the consent rule.
        const likeness = LIKENESS_FLAGS.find((f) => flags[f] !== undefined);
        if (likeness) throw new ProjectError(`presenter takes no --${likeness}. ${consentRule()} Pick one of the service's avatars with --avatar.`);
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const project = loadProject(isProject ? pos.shift() : undefined);
        if (flags.avatars) {
          const list = await avatarList(project);
          print(formatAvatars(list), { avatars: list });
          return 0;
        }
        if (pos.length !== 1) throw new ProjectError('usage: explainroo presenter [project] <scene> --avatar <id> --max-cost <usd> [--name <name>] [--dry-run] [--new], or explainroo presenter [project] --avatars');
        const r = await makePresenter(project, { scene: pos[0], avatar: textFlag(flags, 'avatar'), name: textFlag(flags, 'name'), maxCost: num(flags['max-cost'], 'max-cost'), dryRun: !!flags['dry-run'], fresh: !!flags.new, log });
        print(formatPresenter(r), r);
        return 0;
      }
      case 'capture': {
        if (pos.length < 1 || pos.length > 2) throw new ProjectError('usage: explainroo capture [project] <url> [--name <name>] [--mobile] [--json]');
        const r = await capture(pos.length === 2 ? pos[0] : undefined, pos.at(-1), { mobile: !!flags.mobile, name: textFlag(flags, 'name') });
        const families = r.fonts.families.map((f) => f.family).join(', ') || 'none found';
        const onFirst = r.images.filter((i) => i.firstScreen).length;
        const page = `page: ${r.text.body.length.toLocaleString('en-US')} characters of text${r.text.bodyCut ? ', the first 30 KB,' : ''} and ${r.images.length} image${r.images.length === 1 ? '' : 's'} (${onFirst} on the first screen) in capture.json`;
        print(`saved:\n${r.files.map((f) => '  ' + f).join('\n')}\naccent: ${r.colors.accent ? `${r.colors.accent}${r.colors.accentFrom === 'theme-color' ? ' (from the theme-color tag)' : ''}` : 'none found'}\nfonts: ${families}\nlogo: ${r.logo.picked || 'none found'}\n${page}\n${r.notes.join('\n')}\nPaste into video.json:\n${JSON.stringify(r.suggestion, null, 2)}\nOpen the screenshots and check them before you use them.`, r);
        return 0;
      }
      case 'record': {
        if (flags.inspect !== undefined) {
          const url = textFlag(flags, 'inspect');
          if (pos.length !== 1) throw new ProjectError('usage: explainroo record <project> --inspect <url> [--all] [--text "<words>"] [--viewport 1280x720] [--keep-profile] [--json]. It lists what a step can click or type into, and records nothing.');
          if (flags.all && flags.text !== undefined) throw new ProjectError('--text lists only the elements that hold its words, so leave out --all');
          const r = await inspect(pos[0], url, { viewport: viewportFlag(flags), keepProfile: !!flags['keep-profile'], all: !!flags.all, holding: flags.text === undefined ? null : textFlag(flags, 'text'), log });
          print(formatInspect(r), r);
          return 0;
        }
        if (flags.viewport !== undefined) throw new ProjectError('--viewport goes with --inspect. A recording takes its viewport from recordings/<name>.json.');
        if (flags.all || flags.text !== undefined) throw new ProjectError(`--${flags.all ? 'all' : 'text'} goes with --inspect <url>, which lists what is on a page.`);
        if (pos.length !== 2) throw new ProjectError('usage: explainroo record <project> <name> [--keep-profile] [--json], or explainroo record <project> --inspect <url>. The script is recordings/<name>.json in the project.');
        const r = await record(pos[0], pos[1], { log, keepProfile: !!flags['keep-profile'] });
        print(formatRecord(r), r);
        return 0;
      }
      case 'voice': {
        // A size whose block sets its own pace has narration of its own, so --size picks it.
        const project = loadProject(pos[0], { size: textFlag(flags, 'size'), ...langOverride(flags) });
        // The length from the script alone, before any speech is made or bought.
        if (flags.estimate) {
          const e = estimateLength(project);
          const none = project.config.voice.provider === 'recording' ? 'A recording has its own length, so there is no estimate.' : `${scriptName(project)} has no narration yet, so there is no estimate.`;
          print(e ? `${estimateLine(e)}\nNothing was made.` : none, { estimate: e });
          return 0;
        }
        const paid = speechConnector(project.config);
        const before = paid ? boughtCharacters(project.dir) : 0;
        let estimate = null;
        const { voices, timeline } = await prepare(project, { log, notice, force: !!flags.force, fresh: !!flags.new, onEstimate: (e) => { estimate = e; } });
        const characters = paid ? boughtCharacters(project.dir) - before : 0;
        const recorded = project.config.voice.provider === 'recording';
        const rows = project.script.scenes.map((s) => {
          const v = voices[s.id];
          return { scene: s.id, voice: v.duration, narration: narrationTime(v), confirmed: v.matchRate, unconfirmed: v.unmatched, heard: unconfirmedWords(project, v), marks: v.marks,
            ...(recorded && v.matchRate < 0.85 ? { message: `The recording does not match ${scriptName(project)} here. Make ${scriptName(project)} say what was actually said.` } : {}) };
        });
        // How long the voice speaks, and the narration with its pauses. A recording has its pauses in it.
        const length = (r) => (recorded ? `${r.voice.toFixed(1).padStart(5)} s of the recording` : `${r.narration.toFixed(1).padStart(5)} s of narration (${r.voice.toFixed(1)} s with pauses)`);
        const mismatch = recorded && rows.some((r) => r.confirmed < 0.85)
          ? `\nThe recording does not match ${scriptName(project)} in those scenes. Make ${scriptName(project)} say what was actually said.` : '';
        const wanted = project.config.speed * project.config.pace;
        const speed = paid ? paid.speed(wanted) : wanted;
        const speedNote = paid && speed !== wanted ? `\n${paid.name} speed ${wanted.toFixed(2)} is outside ${paid.speedRange.join(' to ')}; using ${speed}.` : '';
        const usage = paid ? `\n${paid.name}: ${characters} characters used` : '';
        // The target this size used and where it came from. It lengthens the
        // holds, or a note says how far over the video runs.
        const { target } = timeline;
        const from = { top: 'from video.json', block: `from the ${project.config.size} block in "sizes"` }[project.targetFrom];
        const added = target ? ` (targetSeconds ${target.seconds} ${from}${target.added ? `, which added ${target.added.toFixed(1)} s to the hold of each scene` : ''})`
          : project.targetFrom === 'off' ? ` (no targetSeconds: the ${project.config.size} block in "sizes" turns it off)` : '';
        const notes = targetNotes(timeline, estimateLength(project)?.perMinute);
        // A finished render of another size that says an older script.
        const outdated = outdatedRenders(project);
        const after = [...notes.map((n) => `${n.level.toUpperCase().padEnd(5)} ${n.message}`), ...outdated.map(outdatedLine)].map((line) => `\n${line}`).join('');
        // Each word it couldn't confirm, with what it heard there and what to do.
        const heardLines = (r) => r.heard.slice(0, 6).map((u) => `\n${unconfirmedLine(u)}`).join('');
        print(rows.map((r) => `${r.scene.padEnd(18)} ${length(r)}  ${Math.round(r.confirmed * 100)}% confirmed${r.unconfirmed.length ? '  unconfirmed: ' + r.unconfirmed.slice(0, 6).join(', ') : ''}${heardLines(r)}`).join('\n') + `\ntotal ${timeline.duration.toFixed(1)}s${added}` + mismatch + usage + speedNote + after, {
          scenes: rows, duration: timeline.duration, ...(paid ? { characters, speed, ...(speed !== wanted ? { requested_speed: wanted } : {}) } : {}),
          ...(estimate ? { estimate } : {}), ...(target ? { target: { ...target, from: project.targetFrom } } : {}), ...(notes.length ? { notes } : {}), ...(outdated.length ? { outdated } : {}),
        });
        return 0;
      }
      case 'words': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const project = loadProject(isProject ? pos.shift() : undefined, { size: textFlag(flags, 'size'), ...langOverride(flags) });
        const r = await spokenWords(project, pos, { log, notice });
        print(formatWords(r), r);
        return 0;
      }
      case 'preview': return await preview(pos[0], flags, log);
      case 'still': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const { project } = runProject(isProject ? pos.shift() : undefined, flags);
        const list = await stills(project, pos, { log, scale: num(flags.scale, 'scale') ?? 1, transparent: !!flags.transparent });
        print(list.map((s) => `${s.label.padEnd(24)} ${s.file}${s.note ? `  (${s.note})` : ''}`).join('\n'), { stills: list });
        return 0;
      }
      case 'sheet': {
        const { project } = runProject(pos[0], flags);
        const r = await sheet(project, { scene: flags.scene, every: num(flags.every, 'every'), times: timesFlag(flags), cols: num(flags.cols, 'cols'), log });
        const marked = r.marked.length ? `, ${r.marked.length} marked "camera moving" or "drawing in" under the frame` : '';
        print(`${r.file} (${r.frames} frames${marked})`, r);
        return 0;
      }
      case 'check': {
        if (videoArg(pos[0])) return await videoFileCheck('check', pos, flags, log, print);
        videoOnly('check', flags, ['script', 'language']);
        const { project, platform } = runProject(pos[0], flags);
        const r = await check(project, { log, step: num(flags.step, 'step') ?? 0.25, viewWidth: num(flags['view-width'], 'view-width') ?? null, platform });
        const errors = r.issues.filter((i) => i.level === 'error').length;
        const shown = shownIssues(r.issues, !!flags.verbose);
        const human = r.issues.length
          ? shown.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.scene ?? ''}${i.t !== null && i.t !== undefined ? ' @' + i.t + 's' : ''}: ${i.message}`).join('\n') + `\n${errors} error(s), ${shown.length - errors} other finding(s) in ${r.scenes} scenes (${r.duration.toFixed(1)}s)`
          : `no problems found in ${r.scenes} scenes (${r.duration.toFixed(1)}s)`;
        print(human, r);
        return errors ? 1 : 0;
      }
      case 'render': {
        const { project, platform, watermarkNote } = runProject(pos[0], flags, qualityOverride(flags));
        const watermark = watermarkLine(project, flags, platform, watermarkNote);
        notice(watermark);
        const r = await render(project, { log, draft: !!flags.draft, transparent: !!flags.transparent, from: num(flags.from, 'from'), to: num(flags.to, 'to'), workers: num(flags.workers, 'workers'), scale: num(flags.scale, 'scale'), out: textFlag(flags, 'out'), format: textFlag(flags, 'format') });
        print([r.out, r.subtitles?.srt, r.subtitles?.vtt, r.chapters, r.cover].filter(Boolean).map((f) => path.relative(process.cwd(), f) || f).join('\n'), { ...r, watermark });
        return 0;
      }
      case 'package': {
        const r = await packageVideo(pos[0], { lang: textFlag(flags, 'lang'), platform: textFlag(flags, 'platform'), size: textFlag(flags, 'size'), title: textFlag(flags, 'title'), description: textFlag(flags, 'description'), hashtags: textFlag(flags, 'hashtags'), workers: num(flags.workers, 'workers'), log });
        print(formatPackage(r), r);
        return r.ok ? 0 : 1;
      }
      case 'share': {
        const project = loadProject(pos[0], langOverride(flags));
        const r = await share(project, { platform: textFlag(flags, 'platform'), file: textFlag(flags, 'file'), title: textFlag(flags, 'title'), fresh: !!flags.new, log });
        print(formatShare(r), r);
        return 0;
      }
      case 'publish': {
        if (pos.length > 1) throw new ProjectError('usage: explainroo publish [project] --via youtube|buffer|blotato [--platform tiktok] [--dry-run] [--yes]. Nothing was sent.');
        const project = loadProject(pos[0], langOverride(flags));
        const r = await publish(project, { via: textFlag(flags, 'via'), platform: textFlag(flags, 'platform'), privacy: textFlag(flags, 'privacy'), mediaUrl: textFlag(flags, 'media-url'), mediaUnchecked: !!flags['media-url-unchecked'], channel: textFlag(flags, 'channel'), account: textFlag(flags, 'account'), draft: !!flags.draft, dryRun: !!flags['dry-run'], yes: !!flags.yes, fresh: !!flags.new, log, notice });
        if (r.confirmed === false) {
          if (json) print(null, r);
          else process.stderr.write(`error: ${r.error}\n`);
          return 1;
        }
        print(formatPublish(r), r);
        return r.stage === 'failed' ? 1 : 0;
      }
      case 'cut': {
        if (pos.length !== 1) throw new ProjectError('usage: explainroo cut <video> [--language en] [--min-gap seconds] [--force], then edit <name>.cut.md and run: explainroo cut <video> --apply [--dry-run] [--out file]');
        if (flags['dry-run'] && !flags.apply) throw new ProjectError('--dry-run goes with --apply: explainroo cut <video> --apply --dry-run tries the cut list and writes no file');
        const r = flags.apply
          ? await applyCut(pos[0], { out: textFlag(flags, 'out') ?? null, dryRun: !!flags['dry-run'], log })
          : await writeCut(pos[0], { language: textFlag(flags, 'language') ?? 'en', force: !!flags.force, minGap: textFlag(flags, 'min-gap') ?? null, log });
        print(formatCut(r), r);
        return 0;
      }
      case 'clean': {
        const r = clean(pos[0], { dryRun: !!flags['dry-run'] });
        print(formatClean(r), r);
        return 0;
      }
      case 'export': {
        const project = loadProject(pos[0], runOverrides(flags));
        const r = await exportPlayer(project, { log, out: textFlag(flags, 'out') });
        print(`${r.out} (${r.duration.toFixed(1)}s)`, r);
        return 0;
      }
      case 'verify': {
        if (videoArg(pos[0])) return await videoFileCheck('verify', pos, flags, log, print);
        videoOnly('verify', flags, ['script', 'language', 'view-width', 'step']);
        const { project } = runProject(pos[0], flags);
        const r = await verify(project, { file: textFlag(flags, 'file'), log });
        print(formatVerify(r, { verbose: !!flags.verbose }), r);
        return r.issues.some((i) => i.level === 'error') ? 1 : 0;
      }
      case 'image': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        const project = loadProject(isProject ? pos.shift() : undefined);
        const [name, ...rest] = pos;
        const resume = textFlag(flags, 'resume');
        const request = resume !== undefined ? jobRequest(project, resume) : {
          name,
          prompt: rest.join(' '),
          model: flags.model,
          aspect: flags.aspect,
          refs: flags.ref ? String(flags.ref).split(',').map((x) => x.trim()).filter(Boolean) : [],
          style: flags['no-style'] ? false : flags.style,
        };
        const r = await generateImage(project, { ...request, fresh: !!flags.new, log });
        const lines = r.reused
          ? [`${r.file}  already bought on ${r.time.slice(0, 10)} (job ${r.job}), so nothing was spent. To buy it again, add --new.`]
          : [`${r.file}  ${r.model}  ${r.cost_usd !== null ? '$' + r.cost_usd.toFixed(4) : 'cost unknown'}  (images so far: $${r.total_usd.toFixed(4)})`];
        if (r.newer_attempt) lines.push(`A newer try, job ${r.newer_attempt}, has no good answer, so this is the earlier one.`);
        for (const m of r.moved) lines.push(m.to ? `The file that was at ${m.from} moved to ${m.to}.${m.known ? ' Asking for its request again brings it back.' : ''}` : `The link that was at ${m.from} is gone. What it pointed at was not touched.`);
        if (!r.reused) lines.push('Open the image and check it before you use it.');
        print(lines.join('\n'), r);
        return 0;
      }
      case 'clip': {
        const isProject = pos[0] && fs.existsSync(path.join(pos[0], 'video.json'));
        // Outside a project only a dry run works, because a clip is bought into a project.
        const project = (isProject || fs.existsSync('video.json')) ? loadProject(isProject ? pos.shift() : undefined) : null;
        const resume = textFlag(flags, 'resume');
        const fromRequest = ['seconds', 'aspect', 'model', 'resolution', 'audio', 'name'].filter((flag) => flags[flag] !== undefined);
        if (!project && resume !== undefined) throw new ProjectError('--resume continues a job from the record of a project, and there is no video.json here. Put the project folder first: explainroo clip videos/<name> --resume <id>');
        if (resume !== undefined && (pos.length || fromRequest.length)) throw new ProjectError(`--resume takes the whole request from the job, so leave out ${pos.length ? 'the prompt' : `--${fromRequest[0]}`}.`);
        if (resume === undefined && pos.length !== 1) throw new ProjectError('usage: explainroo clip [project] "<what the clip shows>" --seconds 6 --max-cost 2 [--budget 0.40] [--dry-run] [--aspect 16:9] [--model cheap|quality] [--resolution 720p] [--audio] [--name <name>] [--no-wait] [--new] [--resume <id>]. Put the prompt in quotes, and check the project folder.');
        if (!project && !flags['dry-run']) throw new ProjectError('there is no video.json here, and a clip is bought into a project. Without a project only --dry-run works, and it shows the price. Make a project with "explainroo init videos/<name>", then put its folder first: explainroo clip videos/<name> "<what it shows>" --seconds 6 --max-cost 2');
        const request = resume !== undefined ? clipJobRequest(project, resume) : clipRequest(project, { prompt: pos[0], seconds: num(flags.seconds, 'seconds'), aspect: textFlag(flags, 'aspect'), model: textFlag(flags, 'model'), resolution: textFlag(flags, 'resolution'), audio: !!flags.audio, name: textFlag(flags, 'name') });
        const maxCost = num(flags['max-cost'], 'max-cost');
        if (maxCost !== undefined && !(maxCost > 0)) throw new ProjectError('--max-cost must be an amount in US dollars above 0, like 2 or 0.50');
        // One budget for all clips of the project. --budget wins over "clipBudget" in video.json.
        const flagBudget = num(flags.budget, 'budget');
        if (flagBudget !== undefined) checkClipBudget(flagBudget, '--budget');
        const budget = flagBudget ?? project?.clipBudget ?? null;
        const budgetFrom = flagBudget !== undefined ? '--budget' : 'video.json';
        const r = project
          ? await buyClip(project, request, { fresh: !!flags.new, maxCost, budget, budgetFrom, dryRun: !!flags['dry-run'], noWait: !!flags['no-wait'], log, notice })
          : await quoteClip(request, { maxCost, budget });
        print(formatClip(r), r);
        return 0;
      }
      case 'images': {
        const project = loadProject(pos[0]);
        const list = imageLog(project);
        const total = imageSpend(project);
        print(list.length ? list.map((e) => `${e.time.slice(0, 16)}  ${e.file.padEnd(28)} ${e.model.padEnd(32)} ${e.cost_usd !== null ? '$' + e.cost_usd.toFixed(4) : '?'}${e.status && e.status !== 'done' ? `  ${e.status}` : ''}`).join('\n') + `\n${list.length} image request(s), $${total.toFixed(4)}` : 'no images generated yet', { images: list, total_usd: total, models: IMAGE_MODELS });
        return 0;
      }
      case 'voices': {
        const language = textFlag(flags, 'language');
        if (language !== undefined) checkLanguage(language);
        const provider = textFlag(flags, 'provider');
        if (provider !== undefined && provider !== 'kokoro' && !LISTS_VOICES.some((c) => c.id === provider)) throw new ProjectError(`--provider must be kokoro, ${LISTS_VOICES.map((c) => c.id).join(' or ')}`);
        // A flag named after the provider is the older way to say --provider.
        const paid = provider !== undefined ? LISTS_VOICES.find((c) => c.id === provider) : LISTS_VOICES.find((c) => flags[c.id]);
        if (!paid && language !== undefined && !LANGUAGES[language]) throw new ProjectError(noKokoroVoice(language, 'voices'));
        if (paid) {
          const voices = await paid.voices(path.resolve(pos[0] || '.'), { language });
          print(voices.map((v) => `${v.name}  ${v.id}  ${Object.entries(v.labels).map(([k, x]) => `${k}: ${x}`).join(', ')}`).join('\n'), { voices });
        } else {
          const voices = Object.fromEntries(Object.entries(VOICES).filter(([id]) => language === undefined || voiceLanguage(id) === language));
          print(Object.entries(voices).map(([k, v]) => `${k.padEnd(12)} ${voiceLanguage(k).padEnd(6)} ${v}`).join('\n') + `\nUse ${LISTS_VOICES.map((c) => `voices --provider ${c.id} for ${c.name}`).join(', ')}, or set voice to { "provider": "recording", "src": "assets/narration.wav" } in video.json.`, { voices, languages: Object.fromEntries(Object.keys(voices).map(id => [id, voiceLanguage(id)])) });
        }
        return 0;
      }
      case 'say': return await say(pos.join(' '), flags, log, print);
      case 'themes': {
        const desc = {
          paper: 'hand-drawn marker on warm paper; brush transitions; warm music',
          clean: 'crisp flat product style, cards and soft shadows; slide transitions; upbeat music',
          chalk: 'chalk on a green board with hatched fills; brush transitions; calm music',
          blueprint: 'white technical drafting on blueprint blue with a grid; wipe transitions; tech music',
          midnight: 'dark developer look with glowing accents; zoom transitions; tech music',
          editorial: 'serif headlines and fine lines on warm paper, like a magazine; fade transitions; calm music',
          studio: 'light and calm, white cards with a band of color, list items on cards; fade transitions; upbeat music',
        };
        print(THEMES.map((t) => `${t.padEnd(10)} ${desc[t]}`).join('\n') + `\n\nCustom looks: set theme in video.json to a relative .json file that extends a built-in look.\nmusic styles: ${MUSIC_STYLES.join(', ')}`, { themes: desc, music: MUSIC_STYLES });
        return 0;
      }
      case 'formats': return formats(pos, flags, print);
      case 'sizes': {
        // The free area for content with the defaults (captions as "auto"
        // decides), and with bold captions, the same box scenes get as s.safe
        // and check measures: with the watermark, as "check --size <name>" uses
        // it, and without, as "--no-watermark" and a TikTok package use it. The
        // caption band is below it and not part of it.
        const content = (settings) => {
          const cfg = normalizeConfig(settings);
          const { safe } = layoutAreas(cfg, cfg.width, cfg.height);
          return { x: safe.x, y: safe.y, w: safe.w, h: safe.h };
        };
        const info = Object.entries(FORMATS).map(([name, f]) => ({
          name, width: f.size[0], height: f.size[1], use: f.use, captions: normalizeConfig({ size: name }).captions,
          content: content({ size: name }), content_without_watermark: content({ size: name, watermark: false }),
          content_bold_captions: content({ size: name, captions: 'bold' }), content_bold_captions_without_watermark: content({ size: name, captions: 'bold', watermark: false }),
        }));
        const area = (a) => `${a.w}x${a.h} at ${a.x},${a.y}`;
        const areas = (on, off) => (area(on) === area(off) ? `${area(on)} with or without the watermark` : `${area(on)} with the watermark, ${area(off)} without it`);
        const rows = info.map((r) => `${r.name.padEnd(10)} ${`${r.width}x${r.height}`.padEnd(10)} ${r.use}\n${''.padEnd(22)}content area ${areas(r.content, r.content_without_watermark)}${r.captions ? ', captions below it' : ', no captions'}\n${''.padEnd(22)}with bold captions ${areas(r.content_bold_captions, r.content_bold_captions_without_watermark)}`);
        print(rows.join('\n') + '\n\nThe content area is s.safe. The caption band sits below it and is not part of it. On shorts, tiktok, reels and vertical, check warns about anything outside it.\nAlso: 16:9, 9:16, 1:1, 4:5 or WIDTHxHEIGHT. Set it with "size" in video.json or --size on init, preview, still, sheet, check, render or export. "check --size <name>" uses the area with the watermark, and "check --size <name> --no-watermark" the one without it. "check --platform <name>" uses the area of that package, so "check --platform tiktok" uses the one without the watermark.', { sizes: info });
        return 0;
      }
      case 'icons': return icons(pos, print);
      case 'doctor': {
        const language = textFlag(flags, 'language');
        const r = await doctor({ project: pos[0] === undefined ? null : loadProject(pos[0]), language: language ?? null, fetch: !!flags.fetch, log, notice });
        print(formatDoctor(r), r);
        return r.ok ? 0 : 1;
      }
      case 'docs': return docs(pos[0], pos.slice(1), flags, print);
      case 'services': return await services(pos[0], flags, print);
      case 'connect': return await connect(pos, flags, { print, log, notice });
      case 'history': {
        const project = loadProject(pos[0]);
        const { current, unbuilt } = allSpeechKeys(project);
        const report = historyReport(project.dir, { current: (job) => job.kind !== 'speech' || current.has(job.key), needed: (job) => unbuilt.has(job.key), otherSpend: oldImageLog(project) });
        print(formatHistory(report), report);
        return 0;
      }
      default:
        process.stderr.write(`unknown command "${cmd}"\n\n${HELP}\n`);
        return 2;
    }
  } catch (e) {
    const message = hideSecrets(e.message);
    if (e instanceof ProjectError || e instanceof ScriptError) {
      if (json) print(null, { error: message });
      else process.stderr.write(`error: ${message}\n`);
      return 1;
    }
    if (json) print(null, { error: message, stack: hideSecrets(e.stack) });
    else process.stderr.write(`error: ${message}\n`);
    if (process.env.EXPLAINROO_DEBUG) process.stderr.write(`${hideSecrets(e.stack)}\n`);
    return 1;
  }
}

// The paid sentences of every language of the video, at the pace of each size
// that has one of its own, so that a sentence of one language or size never looks
// like a leftover from an older script. A language or size whose settings don't
// load has no sentences to continue yet.
function allSpeechKeys(project) {
  const current = new Set();
  const unbuilt = new Set();
  // The project's own size, each size with a block, and a size without one, which
  // speaks at the pace of the language. Each pace has its own voice folder.
  const plain = [...Object.keys(FORMATS), '16:9', '9:16', '1:1', '4:5'].find((size) => !project.sizeBlocks.includes(size));
  const sizes = project.sizeBlocks.length ? [undefined, ...project.sizeBlocks, plain] : [undefined];
  for (const lang of project.languages) {
    const seen = new Set();
    for (const size of sizes) {
      let version;
      try {
        version = lang === project.language && size === undefined ? project : loadProject(project.dir, { lang, size });
      } catch (e) {
        if (e instanceof ProjectError || e instanceof ScriptError) continue;
        throw e;
      }
      if (seen.has(version.paths.voice)) continue;
      seen.add(version.paths.voice);
      const keys = speechKeys(version);
      keys.current.forEach((key) => current.add(key));
      keys.unbuilt.forEach((key) => unbuilt.add(key));
    }
  }
  return { current, unbuilt };
}

// Writes each message as a line. On a terminal, log.update shows a line that the
// next message replaces, for progress that changes in place.
function lineLog(stream) {
  let open = false;
  const log = (m) => {
    stream.write(`${open ? '\r\x1b[K' : ''}${m}\n`);
    open = false;
  };
  if (stream.isTTY) {
    log.update = (m) => {
      stream.write(`\r\x1b[K${m}`);
      open = true;
    };
  }
  return log;
}

// A text flag given without a value (for example "--title" at the end of the
// line) parses as true. Name the flag instead of failing deep in string code.
function textFlag(flags, name) {
  if (flags[name] === true) throw new ProjectError(`--${name} needs a value`);
  return flags[name];
}

// A video file named where check and verify take a project. One that isn't
// there stops with its name, rather than with a project that isn't found.
function videoArg(arg) {
  if (typeof arg !== 'string' || !VIDEO_FILE.test(arg)) return false;
  if (!isVideoFile(arg)) throw new ProjectError(`${arg} does not exist`);
  return true;
}

// The flags check and verify take for a video file without a project.
const VIDEO_FLAGS = new Set(['script', 'language', 'view-width', 'step', 'verbose', 'json', 'quiet']);

// What check prints of its findings: the hints about words that only nearly
// matched, one per scene, become one line that names the words without their
// times when there are more than NEARLY_LISTED words, unless --verbose. Its
// JSON has them all.
export function shownIssues(issues, verbose) {
  const near = issues.filter((i) => i.key === 'nearly');
  const words = near.reduce((n, i) => n + i.words, 0);
  if (verbose || words <= NEARLY_LISTED) return issues;
  const at = issues.indexOf(near[0]);
  const rest = issues.filter((i) => i.key !== 'nearly');
  const where = near.length === 1 ? `scene ${near[0].scene}` : `${near.length} scenes`;
  const listed = near.every((i) => i.nearly) ? `${nearlyText(untimed(near.flatMap((i) => i.nearly)))}, in the speech check of ${where}` : `${words} words only nearly matched in the speech check of ${where}`;
  rest.splice(at, 0, { level: 'hint', scene: null, t: null, message: `${listed}. ${NEARLY_SHORT}` });
  return rest;
}

// The flags check and verify take only for a video file. A project has its own
// script and language.
function videoOnly(cmd, flags, names) {
  const flag = names.find((f) => flags[f] !== undefined);
  const example = { script: 'script.txt', language: 'es', 'view-width': '400', step: '2' };
  if (flag) throw new ProjectError(`--${flag} is for a video file, like: explainroo ${cmd} video.mp4 --${flag} ${example[flag]}. With a project, ${cmd} uses the project's own script and settings.`);
}

// check and verify of any video file: the same findings, read from the file.
async function videoFileCheck(cmd, pos, flags, log, print) {
  if (pos.length > 1) throw new ProjectError(`usage: explainroo ${cmd} <video> [--script <file>] [--language en] [--view-width <px>] [--step <s>]`);
  const other = Object.keys(flags).find((flag) => !VIDEO_FLAGS.has(flag));
  if (other) throw new ProjectError(`--${other} works with a project. For a video file, ${cmd} takes ${[...VIDEO_FLAGS].filter((f) => f !== 'quiet').map((f) => `--${f}`).join(', ')}.`);
  const r = await checkVideo(pos[0], { script: textFlag(flags, 'script') ?? null, language: textFlag(flags, 'language') ?? 'en', viewWidth: num(flags['view-width'], 'view-width') ?? null, step: num(flags.step, 'step') ?? null, log });
  print(formatVideoCheck(r, { verbose: !!flags.verbose }), r);
  return r.passed ? 0 : 1;
}

// The settings of video.json that --size and --no-watermark replace for one run,
// and the language that --lang picks.
function runOverrides(flags) {
  return { size: textFlag(flags, 'size'), watermark: flags['no-watermark'] ? false : undefined, ...langOverride(flags) };
}

function langOverride(flags) {
  return { lang: textFlag(flags, 'lang') };
}

// The project of one run of check, still, sheet or render, and the platform it
// is for. --platform sets what "package --platform <name>" uses: the size, its
// block in "sizes" and the watermark rule, so a run shows what the package will.
function runProject(dir, flags, extra = {}) {
  const platform = textFlag(flags, 'platform');
  if (platform === undefined) return { project: loadProject(dir, { ...runOverrides(flags), ...extra }), platform: null };
  if (!Object.hasOwn(PLATFORMS, platform)) throw new ProjectError(`there is no platform "${platform}". The platforms are ${allOf(Object.keys(PLATFORMS))}.`);
  if (flags['no-watermark']) throw new ProjectError(`--platform ${platform} sets the watermark the way its package does, so leave out --no-watermark`);
  const own = loadProject(dir, langOverride(flags));
  const overrides = packageOverrides(own, platform, textFlag(flags, 'size'));
  // The platform's rule takes away a watermark the project has, so say why.
  const watermarkNote = overrides.watermark === false && own.config.watermark !== false ? `watermark: off, because ${PLATFORMS[platform].name} asks apps that post to it not to add one` : null;
  return { project: loadProject(own.dir, { ...overrides, ...langOverride(flags), ...extra }), platform, watermarkNote };
}

// The one line render prints about the watermark: on, off by a setting or
// --no-watermark, or off because of the platform's rule.
export function watermarkLine(project, flags, platform, platformNote) {
  if (platformNote) return platformNote;
  const mark = project.config.watermark;
  if (mark !== false) {
    const same = platform ? `, as the ${PLATFORMS[platform].name} package has it` : '';
    return `watermark: on, "${mark}"${same}. "watermark": false in video.json turns it off`;
  }
  if (flags['no-watermark']) return 'watermark: off, because of --no-watermark';
  return 'watermark: off, because "watermark" is false in video.json';
}

// The spoken words of the scenes, or of the ones named, with their times in
// seconds into the scene, the times a cue like at: 'word' gives. A word spoken
// more than once in a scene has the cue that names its time, like "fills#2".
async function spokenWords(project, only = [], { log, notice }) {
  const ids = project.script.scenes.map((s) => s.id);
  const unknown = [...new Set(only.filter((id) => !ids.includes(id)))];
  if (unknown.length) throw new ProjectError(`there is no scene ${unknown.map((id) => `"${id}"`).join(' or ')} in ${scriptName(project)}. Its scenes are: ${ids.join(', ')}`);
  const { timeline } = await prepare(project, { log, notice });
  const round = (v) => Math.round(v * 100) / 100;
  const scenes = timeline.scenes.filter((s) => !only.length || only.includes(s.id)).map((sc) => {
    const seen = new Map();
    const total = new Map();
    for (const w of sc.words) total.set(normWord(w.text), (total.get(normWord(w.text)) ?? 0) + 1);
    const words = sc.words.map((w) => {
      const key = normWord(w.text);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const cue = bareWord(w.text);
      return { text: w.text, start: round(w.start), end: round(w.end), cue: total.get(key) > 1 ? `${cue}#${n}` : cue };
    });
    return { scene: sc.id, start: round(sc.start), duration: round(sc.dur), words, marks: Object.fromEntries(Object.entries(sc.marks).map(([k, v]) => [k, round(v)])) };
  });
  return { scenes };
}

function formatWords(r) {
  return r.scenes.map((s) => {
    const head = `${s.scene}: ${s.start.toFixed(1)} s to ${(s.start + s.duration).toFixed(1)} s of the video. The times are seconds into the scene, as at: 'word' uses them.`;
    if (!s.words.length) return `${head}\n  no narration`;
    // A marker comes before the word it starts on.
    const rows = [
      ...Object.entries(s.marks).map(([name, t]) => ({ t, line: `${t.toFixed(2).padStart(7)}  [#${name}]` })),
      ...s.words.map((w) => ({ t: w.start, line: `${w.start.toFixed(2).padStart(7)}  ${w.text}${w.cue.toLowerCase() !== w.text.toLowerCase() ? `  (cue "${w.cue}")` : ''}` })),
    ].sort((a, b) => a.t - b.t);
    return [head, ...rows.map((x) => x.line)].join('\n');
  }).join('\n\n');
}

// --times 3,12.5,intro@2: the times that still takes, separated by commas.
// --viewport 1280x720, as { width, height }.
function viewportFlag(flags) {
  const value = textFlag(flags, 'viewport');
  if (value === undefined) return undefined;
  const m = /^(\d+)x(\d+)$/.exec(value);
  if (!m) throw new ProjectError('--viewport must be like 1280x720');
  return { width: Number(m[1]), height: Number(m[2]) };
}

function timesFlag(flags) {
  const value = textFlag(flags, 'times');
  if (value === undefined) return undefined;
  const times = String(value).split(',').map((x) => x.trim()).filter(Boolean);
  if (!times.length) throw new ProjectError('--times needs at least one time, like --times 3,12.5,intro@2');
  return times;
}

// --quality fast makes a final without motion blur. That is the same video as one
// with "motionBlur": false in video.json, so it is that setting for one run, and
// its render identity says so.
function qualityOverride(flags) {
  const quality = textFlag(flags, 'quality');
  if (quality === undefined || quality === 'final') return {};
  if (quality !== 'fast') throw new ProjectError(`--quality must be final or fast, not "${quality}"`);
  if (flags.draft) throw new ProjectError('--quality fast makes a final without motion blur, and a draft is already fast. Leave out one of them.');
  return { motionBlur: false };
}

function init(dir, flags, print) {
  if (!dir) throw new ProjectError('usage: explainroo init <dir> [--format product-launch] [--theme studio] [--size youtube|tiktok|linkedin|...] [--pace 1.2] [--language es] [--voice af_heart] [--title "..."]');
  const target = path.resolve(dir);
  if (fs.existsSync(path.join(target, 'video.json'))) throw new ProjectError(`${target} already has a video.json`);
  const format = flags.format === undefined ? null : findFormat(textFlag(flags, 'format') ?? '');
  const base = format?.settings ?? {};
  const theme = textFlag(flags, 'theme') || base.theme || 'studio';
  if (!THEMES.includes(theme) && theme !== base.theme) throw new ProjectError(`theme must be one of ${THEMES.join(', ')}`);
  const language = textFlag(flags, 'language') ?? base.language ?? 'en';
  checkLanguage(language);
  // init sets a Kokoro voice, so it can't set up a language that Kokoro doesn't speak.
  if (!LANGUAGES[language]) throw new ProjectError(noKokoroVoice(language, 'init'));
  const voice = textFlag(flags, 'voice') || (typeof base.voice === 'string' && voiceLanguage(base.voice) === language ? base.voice : LANGUAGES[language]);
  if (!VOICES[voice]) throw new ProjectError(`voice "${voice}" does not exist. Run "explainroo voices".`);
  const title = textFlag(flags, 'title') || path.basename(target).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const tpl = path.join(ROOT, 'templates', 'starter');
  const size = textFlag(flags, 'size') || base.size || '16:9';
  resolveSize(size);
  // A new project gets the defaults of this version. A project without the line
  // keeps the look of the version it was made with. A format keeps the defaults
  // its helpers were made for.
  const config = format
    ? { ...base, title, theme, size, voice, defaults: base.defaults ?? DEFAULTS_VERSIONS.at(-1) }
    : { title, theme, size, voice, music: true, captions: 'auto', defaults: DEFAULTS_VERSIONS.at(-1) };
  if (flags.language !== undefined) config.language = language;
  if (flags.pace !== undefined) config.pace = num(flags.pace, 'pace');
  normalizeConfig(config, format?.dir ?? '.');
  if (format) {
    startFromFormat(format, target, config);
    fs.writeFileSync(path.join(target, '.gitignore'), 'build/\nout/\n.env\nhistory/private/\nhistory/locks/\n');
    const english = language !== 'en' ? `\nThe example script is in English. Write script.md in ${language}, with the same scene names.` : '';
    const example = base.title ? `, a video about "${base.title}". Replace it with your own topic` : '. Replace it with your own topic';
    // A tall format without a platform's size fits no app exactly.
    const sized = flags.size === undefined && size === 'vertical'
      ? `\nThe size is "vertical", a tall frame for no app in particular. For one app, set its size, so pictures and captions keep clear of its buttons: ${selfCommand()} set ${dir} size tiktok (or shorts, or reels).`
      : '';
    print(`created ${target} from the format ${format.name} ${format.version} by ${format.author}${english}${sized}\nscript.md and scenes.js hold the format's example${example}, and keep the helpers that scenes.js imports from format.js. Its guide is in format.md:\n\n${format.guide.trim()}\n\nnext: write the narration in script.md, then run "${selfCommand()} voice ${dir}". After that, change the scenes in scenes.js and run "${selfCommand()} check ${dir}".`,
      { dir: target, format: formatEntry(format), guide: format.guide });
    return 0;
  }
  // Create the folder only after every setting checks out, so a bad flag
  // leaves nothing behind.
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(target, 'video.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'script.md'), fs.readFileSync(path.join(tpl, 'script.md'), 'utf8').replace('{{title}}', title));
  fs.writeFileSync(path.join(target, 'scenes.js'), fs.readFileSync(path.join(tpl, 'scenes.js'), 'utf8').replace(/\{\{title\}\}/g, title.replace(/'/g, "\\'")));
  // history/ goes into git, apart from what acts like a secret and the locks,
  // which belong to the runs on this computer.
  fs.writeFileSync(path.join(target, '.gitignore'), 'build/\nout/\n.env\nhistory/private/\nhistory/locks/\n');
  print(`created ${target}\nnext: write the narration in script.md, then run "${selfCommand()} voice ${dir}". After that, draw each scene in scenes.js and run "${selfCommand()} check ${dir}".`, { dir: target });
  return 0;
}

// "formats" lists them, "formats <name>" prints one guide, and "formats add"
// shows what it will run and installs only with --yes.
function formats(pos, flags, print) {
  if (pos[0] === 'add') {
    if (pos.length !== 2) throw new ProjectError('usage: explainroo formats add <git address> [--commit <commit>] [--yes]');
    const commit = flags.commit === undefined ? undefined : textFlag(flags, 'commit') ?? '';
    if (!flags.yes) {
      const plan = addPlan(pos[1], { commit });
      print(formatPlan(plan), { installed: false, plan });
      return 0;
    }
    const r = addFormat(pos[1], { commit });
    print(formatAdded(r), { installed: true, format: r });
    return 0;
  }
  if (pos.length > 1) throw new ProjectError('usage: explainroo formats [format], or explainroo formats add <git address>');
  if (pos[0]) {
    const f = findFormat(pos[0]);
    const entry = formatEntry(f);
    print(`${f.name} ${f.version} by ${f.author}: ${f.description}\n${f.dir}\n\n${f.guide.trim()}`, { format: entry, guide: f.guide });
    return 0;
  }
  const list = listFormats().map(formatEntry);
  print(formatList(list), { formats: list });
  return 0;
}

async function preview(dir, flags, log) {
  let project = loadProject(dir, runOverrides(flags));
  let { timeline } = await prepare(project, { log });
  let state = makeState(project, timeline);
  let lastError = null;
  const server = await startServer({ projectDir: project.dir, getState: () => (lastError ? { ...state, error: lastError } : state), port: num(flags.port, 'port') ?? 4400 });
  log(`preview: ${server.url}  (Ctrl+C to stop)`);
  const stamp = () => {
    // The script and strings of the language shown, which --lang picks.
    const files = [path.join(project.dir, 'video.json'), project.paths.script, project.paths.strings];
    // Read the current path too, so creating a missing look file clears its error.
    try {
      const { theme } = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      if (typeof theme === 'string' && theme.endsWith('.json')) files.push(path.resolve(project.dir, theme));
    } catch {}
    return files.map((f) => { try { const st = fs.statSync(f); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return `${f}:missing`; } }).join('|');
  };
  let last = stamp();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const now = stamp();
    busy = true;
    try {
      if (now !== last) {
        last = now;
        log('script, strings, settings or look changed, updating project');
        project = loadProject(project.dir, project.overrides);
        ({ timeline } = await prepare(project, { log }));
        lastError = null;
      }
      state = makeState(project, timeline);
    } catch (e) {
      lastError = e.message;
      log(`error: ${e.message}`);
    } finally {
      busy = false;
    }
  }, 700);
  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  clearInterval(timer);
  await server.close();
  return 0;
}

async function say(text, flags, log, print) {
  if (!text) throw new ProjectError('usage: explainroo say "text to speak" [--voice af_heart] [--speed 1] [--out sample.wav]');
  const voice = textFlag(flags, 'voice') || 'af_heart';
  if (!VOICES[voice]) throw new ProjectError(`voice "${voice}" does not exist. Run "explainroo voices".`);
  const tts = await loadTTS({ log });
  const language = voiceLanguage(voice);
  const phonemes = language === 'en' ? undefined : (await phonemize([text], language))[0];
  const audio = await generateSpeech(tts, text, { language, voice, speed: num(flags.speed, 'speed') ?? 1, phonemes });
  const out = path.resolve(textFlag(flags, 'out') || `${voice}.wav`);
  writeWav(out, audio.audio, audio.sampling_rate || TTS_SAMPLE_RATE);
  print(out, { file: out, voice });
  return 0;
}

function icons(words, print) {
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'icons', 'lucide-tags.json'), 'utf8'));
  const { aliases = {} } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'icons', 'lucide.json'), 'utf8'));
  for (const [alias, target] of Object.entries(aliases)) all[target] = [...(all[target] || []), alias.replace(/-/g, ' ')];
  const q = words.map((w) => w.toLowerCase());
  const wanted = q.join('-');
  if (!q.length) {
    print(`${Object.keys(all).length} icons. Search with: explainroo icons <word…>`, { count: Object.keys(all).length });
    return 0;
  }
  const scored = Object.entries(all)
    .map(([name, tags]) => {
      let score = 0;
      for (const w of q) {
        if (name === w) score += 10;
        else if (name.split('-').includes(w)) score += 6;
        else if (name.includes(w)) score += 3;
        if (tags.some((t) => t === w)) score += 4;
        else if (tags.some((t) => t.includes(w))) score += 1;
      }
      return { name, score, tags };
    })
    .filter((x) => x.score > 0)
    // An icon whose name is exactly the words comes first.
    .sort((a, b) => (b.name === wanted) - (a.name === wanted) || b.score - a.score || a.name.localeCompare(b.name));
  const total = scored.length;
  scored.splice(40);
  const asked = words.join(' ');
  // A word that is a name, a part of one, a tag or a word of a tag. "bee" is only
  // inside "beef" and "beer", which is no match.
  const whole = (name, tags) => q.some((w) => name === w || name.split('-').includes(w) || tags.some((t) => t === w || t.split(/[\s-]+/).includes(w)));
  if (!scored.some((x) => whole(x.name, x.tags))) {
    // The names that have the word inside them, or else close spellings.
    const close = scored.length ? scored.slice(0, 5).map((x) => x.name) : suggest(q.join('-'), Object.keys(all), 5);
    const instead = 'No icon shows it. Draw it with s.draw, or make a picture with "explainroo image", which costs money.';
    print(`no icon matches "${asked}". Close names: ${close.join(', ')}\n${instead}`, { icons: [], close, instead });
    return 0;
  }
  // One icon per line, and the words it is also found by after it, so the tags
  // don't read as more icons.
  const lines = scored.map((x) => {
    const notes = [...(x.name === wanted ? ['exact name'] : []), ...(x.tags.length ? [`also found by: ${x.tags.slice(0, 6).join(', ')}`] : [])];
    return `  ${x.name}${notes.length ? `  (${notes.join('; ')})` : ''}`;
  });
  const head = total === 1 ? `1 icon matches "${asked}":` : total > scored.length ? `${total} icons match "${asked}". These are the ${scored.length} best:` : `${total} icons match "${asked}", best first:`;
  const exact = scored[0]?.name === wanted ? wanted : null;
  print([head, ...lines].join('\n'), { icons: scored.map((x) => x.name), exact });
  return 0;
}

// The instructions ship with the package, so an agent that runs the tool
// through npx, with no folder to open, can read them here. `words` after the
// topic name one section of it.
function docs(topic, words, flags, print) {
  const dir = path.join(ROOT, 'docs');
  const topics = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  if (flags.list) {
    print(topics.join('\n'), { topics });
    return 0;
  }
  if (topic !== undefined && !topics.includes(topic)) throw new ProjectError(`there is no docs topic "${topic}". The topics are: ${topics.join(', ')}`);
  const file = topic === undefined ? path.join(ROOT, 'AGENTS.md') : path.join(dir, `${topic}.md`);
  const text = fs.readFileSync(file, 'utf8');
  if ((flags.sections || words.length) && topic === undefined) throw new ProjectError('the start page has no sections to print one by one. Name a topic, like "explainroo docs publishing --sections".');
  if (flags.sections) {
    const sections = docSections(text).map(({ heading, slug, bytes, parts }) => ({ heading, slug, bytes, subsections: parts.map((p) => p.heading) }));
    if (!sections.length) {
      print(`${topic} has no sections. It is ${(Buffer.byteLength(text) / 1000).toFixed(1)} KB, so print it whole with "explainroo docs ${topic}".`, { topic, file, sections });
      return 0;
    }
    const width = Math.max(...sections.map((x) => x.slug.length));
    const lines = [`The sections of ${topic}. Print one with "explainroo docs ${topic} <section>", or with a word of its heading that no other section has:`];
    for (const x of sections) lines.push(`  ${x.slug.padEnd(width)}  ${(x.bytes / 1000).toFixed(1).padStart(4)} KB  ${x.heading}`);
    print(lines.join('\n'), { topic, file, sections });
    return 0;
  }
  if (words.length) {
    const section = findSection(topic, text, words.join(' '));
    print(section.text.trimEnd(), { topic, section: section.heading, slug: section.slug, file, text: section.text });
    return 0;
  }
  print(text.trimEnd(), { topic: topic ?? null, file, text });
  return 0;
}

// The anchor GitHub gives a heading, which is also what names a section here.
const headingSlug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

// The "## " sections of a page, each with its "### " parts, outside fenced code.
// The text before the first one is the page's own opening, and no section.
export function docSections(text) {
  const sections = [];
  let fenced = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const level = fenced ? 0 : /^(##|###) /.exec(line)?.[1].length ?? 0;
    if (level === 2) sections.push({ heading: line.slice(3).trim(), lines: [line], parts: [] });
    else if (sections.length) {
      const current = sections.at(-1);
      if (level === 3) current.parts.push({ heading: line.slice(4).trim(), lines: [] });
      current.lines.push(line);
      current.parts.at(-1)?.lines.push(line);
    }
  }
  return sections.map((x) => {
    const body = `${x.lines.join('\n').trimEnd()}\n`;
    return { heading: x.heading, slug: headingSlug(x.heading), text: body, bytes: Buffer.byteLength(body), parts: x.parts.map((p) => ({ heading: p.heading, slug: headingSlug(p.heading), text: `${p.lines.join('\n').trimEnd()}\n` })) };
  });
}

// A section by its heading, written in any case, or by words of the heading that
// only one section has. A "### " part of a section counts when no section does.
function findSection(topic, text, asked) {
  const sections = docSections(text);
  const wanted = headingSlug(asked);
  const words = wanted.split('-').filter(Boolean);
  const pick = (list) => {
    const exact = list.filter((x) => x.slug === wanted);
    if (exact.length) return exact;
    const found = list.filter((x) => words.length && words.every((w) => x.slug.split('-').includes(w)));
    // "package" means the section whose heading starts with it.
    const first = found.filter((x) => x.slug === wanted || x.slug.startsWith(`${wanted}-`));
    return first.length === 1 ? first : found;
  };
  for (const list of [sections, sections.flatMap((x) => x.parts)]) {
    const found = pick(list);
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new ProjectError(`more than one section of ${topic} has "${asked}": ${found.map((x) => x.slug).join(', ')}. Use more words of the heading.`);
  }
  throw new ProjectError(`${topic} has no section "${asked}". Its sections are: ${sections.map((x) => x.slug).join(', ')}. "explainroo docs ${topic} --sections" lists them with their size.`);
}

// Each entry is listed under every step it serves, with that step's words. The
// clips step also shows today's prices, which never make services fail.
async function services(name, flags, print) {
  const step = name === undefined ? undefined : findStep(name)?.id;
  if (name !== undefined && !step) throw new ProjectError(`there is no step "${name}". ${stepNames()}`);
  const steps = STEPS.filter((s) => step === undefined || s.id === step);
  const dir = path.resolve(textFlag(flags, 'project') ?? '.');
  const connected = (id) => {
    const service = findService(id);
    return needsKey(service) ? service.setup.env.every((name) => !!findEnv(name, dir)) : undefined;
  };
  const clipPrices = steps.some((s) => s.id === 'clips') ? await clipPricesToday() : null;
  const prices = (service) => (clipPrices && showsClipPrices(service) ? clipPrices : undefined);
  const list = steps.flatMap((s) => stepServices(s.id)).map((s) => ({ ...s, ...(needsKey(s) ? { connected: connected(s.id) } : {}), ...(prices(s) ? { prices: prices(s) } : {}) }));
  print(formatServices(steps, SERVICES, { connected, command: selfCommand(), prices }), { steps, services: list });
  return 0;
}
