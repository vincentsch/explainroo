# Music and sound files

Every video gets music made on your computer, and each look has its own style. That
music is free. This page is for when you want your own file or your own original
music. `explainroo services music --json` lists the choices.

## The built-in music

`"music": true` plays the look's own style. These are the styles of the looks:

| Look | Style |
| --- | --- |
| `paper` | `warm` |
| `clean` | `upbeat` |
| `chalk` | `calm` |
| `blueprint` | `tech` |
| `midnight` | `tech` |
| `editorial` | `calm` |
| `studio` | `upbeat` |

To change only the volume, write a block without a style. It keeps the look's
music:

```json
"music": { "volume": 0.35 }
```

`explainroo set videos/<name> music.volume 0.35` writes that block for you. A
block can also name a style, like `{ "style": "calm", "volume": 0.35 }`. `volume`
goes from 0 to 1, and 0.5 is the default.

## Your own music file

```json
"music": { "src": "assets/track.mp3", "volume": 0.5, "credit": "Morning by Example Artist, CC BY 4.0" }
```

- `src` is a wav, mp3, m4a, aac, flac, ogg or opus file inside `assets/`.
- `volume` goes from 0 to 1, and 0.5 is the default. It means the same as for the
  built-in music. explainroo measures the file and brings it to the level of the
  built-in music, so a loud pop track at 0.5 sits well under the voice.
- The music is lowered while the voice speaks, the same way as the built-in music.
- Music shorter than the video loops. Add `"loop": false` to play it once.
- Music longer than the video fades out at the end.
- It stays in stereo.
- `credit` says who made it. The video doesn't show it, so put it where viewers
  will see it, for example in the video's description.

Use `style` or `src`, not both. Only use music the user is allowed to use. A file
does not follow `pace`, because it plays at its own speed.

## A sound on a word

`s.sound` plays a file on a cue, for a jingle or a noise that `s.sfx` doesn't have.

```js
s.sound('assets/door.mp3', { at: 'door', out: 2.5, volume: 0.5 });
```

It takes the same files as `music`. It follows the same rules as other elements, so
always call it, and use `at` and `out` for the timing. `volume` goes from 0 to 1, and
0.5 is the default. It is a plain level on the file, which isn't measured the way
music is.

It starts at `at`. It stops at `out`, at the end of the file or at the end of the
scene, whichever comes first. It is lowered while the voice speaks, so put a sound
that matters in a pause.

`"sfx": false` turns off the built-in effects only. A file you asked for with
`s.sound` still plays.

`check` tells you when a music or sound file is missing or can't be read. `verify`
tells you when the music or a sound makes the voice hard to understand. If it does,
lower `volume`.

## Original music with Soundroo

[Soundroo](https://www.soundroo.com) is a free, open-source way to make original
music. You write the music as a score, a small JSON file with the tempo, the
instruments and the notes. Its engine renders that to a WAV file on your computer.
It needs no account and no key, and nothing leaves your computer unless you run its
own share command.

It needs Node 22 or newer, which is newer than explainroo needs. Clone it outside
your video project, and read its instructions first. They say how to write a score.

```bash
git clone https://github.com/vincentsch/soundroo.git
cd soundroo
node bin/soundroo.js doctor
```

Then make a library, add your score and render it:

```bash
node bin/soundroo.js init library/my-music --title "Music for my video"
node bin/soundroo.js add library/my-music/my-track.json --library library/my-music
node bin/soundroo.js render --all --library library/my-music --json
```

The report names the WAV file, which is in `library/my-music/tracks/my-track/renders/`.
Copy it into your video project's `assets/` folder and use it like any other file:

```json
"music": { "src": "assets/my-track.wav", "credit": "Made with Soundroo" }
```

Soundroo's music has no singing. You can't hear the music yourself, so ask the
user how it sounds.
