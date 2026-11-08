// The explainroo launch video. Every reveal is tied to a spoken word or a
// [#marker] from script.md.

export default {
  hook(s) {
    s.icon('bot', { y: 330, size: 210, color: 'ink', at: 0, enter: 'none', float: 4 });
    s.note('a coding agent', { y: 480, size: 40, at: 'agent' });
    const xs = s.row(3, { width: 1100 });
    const items = [
      ['video model', 'clapperboard', '#nomodel'],
      ['API keys', 'key-round', '#nokeys'],
      ['editing', 'scissors', '#noedit'],
    ];
    items.forEach(([label, icon, at], i) => {
      s.box(label, { id: `no${i}`, x: xs[i], y: 700, icon, w: 330, at, out: '#code', outDur: 0.3, exit: 'pop', size: 46 });
      s.annotate(`no${i}`, { type: 'cross', color: 'red', at: s.time(at) + 0.55, out: '#code', outDur: 0.3, dur: 0.45 });
    });
    s.icon('code-xml', { x: 560, y: 700, size: 150, color: 'accent', at: s.mark('code') + 0.35 });
    s.text('drawn with *JavaScript*', { font: 'display', size: 84, x: 660, y: 700, align: 'left', at: s.mark('code') + 0.5 });
  },

  files(s) {
    s.title('explainroo', { y: 140, size: 110, at: 0 });
    s.note('free and open source', { y: 235, size: 38, at: 'open' });
    s.icon('bot', { id: 'agent', x: 330, y: 610, size: 190, at: '#writes', label: 'your agent', labelSize: 40 });
    s.code('## hook\nA coding agent made this video with explainroo.\n[#code] Everything you see is drawn with JavaScript.', {
      id: 'script', lang: 'md', title: 'script.md', x: 1170, y: 440, w: 1120, size: 31, at: '#script', reveal: 'lines', lineDelay: 0.25,
    });
    s.code("hook(s) {\n  s.icon('bot', { at: 0 });\n  s.icon('code-xml', { at: '#code' });\n}", {
      id: 'scenes', lang: 'js', title: 'scenes.js', x: 1170, y: 800, w: 1120, size: 31, at: '#scenes', reveal: 'lines', lineDelay: 0.25,
    });
    s.arrow('agent', 'script', { at: s.mark('script') - 0.2, bend: -0.15 });
    s.arrow('agent', 'scenes', { at: s.mark('scenes') - 0.2, bend: 0.15 });
  },

  voice(s) {
    const y = 330;
    s.box('script.md', { id: 'file', x: 330, y, icon: 'file-text', w: 330, at: 0.2 });
    s.box('Kokoro', { id: 'tts', x: 960, y, icon: 'audio-lines', color: 'blue', w: 330, at: 'Kokoro' });
    s.arrow('file', 'tts', { at: s.cue('Kokoro') - 0.3 });
    s.icon('laptop', { x: 960, y: 555, size: 70, color: 'blue', at: '#local', enter: 'pop' });
    s.note('runs on your computer', { x: 960, y: 630, size: 36, at: s.mark('local') + 0.2 });
    s.box('Whisper', { id: 'asr', x: 1590, y, icon: 'ear', color: 'purple', w: 330, at: 'Whisper' });
    s.arrow('tts', 'asr', { at: s.cue('Whisper') - 0.3 });

    // A real word timeline: the words of the last sentence, placed at the
    // times Whisper measured for them.
    const from = s.cue('writes');
    const words = s.words.filter((w) => w.start >= from - 0.01);
    const t0 = words[0].start;
    const t1 = words[words.length - 1].end;
    const x0 = 250;
    const x1 = 1670;
    const lineY = 860;
    s.line([[x0 - 30, lineY], [x1 + 60, lineY]], { color: 'muted', at: s.mark('whisper') + 0.4, width: 3 });
    words.forEach((w, i) => {
      const x = x0 + ((w.start - t0) / (t1 - t0)) * (x1 - x0);
      s.line([[x, lineY - 14], [x, lineY + 14]], { color: 'purple', at: w.start, width: 4, sfx: false });
      s.text(w.text.replace(/[.,]$/, ''), { x, y: i % 2 ? lineY + 58 : lineY - 52, size: 36, align: 'left', at: w.start, enter: 'pop', sfx: false });
      s.note(`${w.start.toFixed(2)}s`, { x, y: i % 2 ? lineY + 100 : lineY - 94, size: 24, align: 'left', at: w.start + 0.1, enter: 'fade', color: 'purple', sfx: false });
    });
  },

  sync(s) {
    s.text('Word cues', { font: 'display', size: 84, y: 160, at: 0.1 });
    s.icon('image', { id: 'pic', x: 700, y: 540, size: 170, color: 'blue', at: 'picture', out: '#code', bg: 'circle' });
    s.icon('speech', { id: 'said', x: 1220, y: 540, size: 170, color: 'accent', at: 'mentions', out: '#code', bg: 'circle' });
    s.arrow('pic', 'said', { head: 'both', dashed: true, label: 'at the same time', labelSize: 34, at: s.cue('mentions') + 0.25, out: '#code', color: 'muted' });
    s.code("s.icon('database', {\n  at: 'database',\n});", { x: 640, y: 560, w: 860, size: 44, title: 'scenes.js', at: '#code', reveal: 'type', cps: 34 });
    const db = s.icon('database', { id: 'db', x: 1450, y: 560, size: 260, color: 'purple', at: 'database', enter: 'pop', bg: 'circle', bgScale: 1.45 });
    s.note('appears when the voice says it', { x: db.x, y: db.bottom + 60, size: 38, at: 'appears' });
    s.burst({ x: 1450, y: 560, at: 'database', count: 36, power: 900 });
  },

  draw(s) {
    s.icon('app-window', { x: 420, y: 470, size: 300, color: 'ink', at: 0.2, label: 'headless Chrome', labelSize: 40 });
    const looks = [
      ['paper', '#f7f3ea', '#26221d', '#df5a3f'],
      ['clean', '#ffffff', '#111827', '#3b6cf6'],
      ['chalk', '#233d31', '#f2f0e6', '#f6e27f'],
      ['blueprint', '#12508f', '#f1f7ff', '#ffd866'],
      ['midnight', '#0b1020', '#e8eef8', '#22d3ee'],
    ];
    const xs = s.row(5, { x: 1310, width: 820 });
    looks.forEach(([name, bg, ink, accent], i) => {
      s.box(name, { x: xs[i], y: 400, w: 190, h: 130, fill: bg, stroke: accent, textColor: ink, size: 34, at: s.mark('looks') + i * 0.22, enter: 'pop', sfx: i ? 'blip' : 'pop' });
    });
    s.note('five looks', { x: 1310, y: 520, size: 36, at: s.mark('looks') + 1.2 });
    s.icon('music', { x: 1110, y: 760, size: 120, color: 'accent', at: 'music', label: 'music' });
    s.icon('audio-waveform', { x: 1510, y: 760, size: 120, color: 'blue', at: 'effects', label: 'sound effects' });
  },

  eyes(s) {
    s.icon('bot', { id: 'agent', x: 300, y: 560, size: 190, at: 0.1 });
    s.icon('eye-off', { x: 300, y: 340, size: 90, color: 'muted', at: 'watch', out: '#give', exit: 'pop' });
    s.icon('eye', { x: 300, y: 340, size: 100, color: 'accent', at: s.mark('give') + 0.3, enter: 'pop' });
    const x = 830;
    s.box('Still pictures', { id: 'stills', x, y: 300, icon: 'image', w: 400, at: '#stills', color: 'blue' });
    s.box('Contact sheets', { id: 'sheets', x, y: 540, icon: 'layout-grid', w: 400, at: '#sheets', color: 'green' });
    s.box('A check', { id: 'check', x, y: 780, icon: 'list-checks', w: 400, at: '#check', color: 'red' });
    s.arrow('agent', 'stills', { at: s.mark('stills') - 0.2, bend: -0.12 });
    s.arrow('agent', 'sheets', { at: s.mark('sheets') - 0.2 });
    s.arrow('agent', 'check', { at: s.mark('check') - 0.2, bend: 0.12 });
    s.list(
      [
        { text: 'cut off text', at: 'cut' },
        { text: 'bad timing', at: 'timing' },
        { text: 'misread words', at: 'wrong' },
      ],
      { x: 1160, y: 690, size: 44, bullet: 'x', bulletColor: 'red', gap: 18, width: 600 },
    );
  },

  render(s) {
    const v = s.video;
    s.terminal(
      [
        { cmd: 'explainroo render examples/explainroo-intro', at: 0.3 },
        { out: `rendering ${v.duration.toFixed(1)}s (${v.frames} frames at ${v.fps} fps, ${v.width}x${v.height})`, at: 2.0, color: 'muted' },
        { out: 'wrote examples/explainroo-intro/out/video.mp4', at: 3.1, color: 'green' },
      ],
      { y: 520, w: 1400, size: 38, rows: 4, cps: 30, at: 0 },
    );
  },

  outro(s) {
    const t = s.title('explainroo', { y: 390, size: 150, at: 0.1 });
    s.annotate({ x: t.x, y: t.y, w: t.w, h: t.h }, { type: 'underline', color: 'accent', at: 'free' });
    s.subtitle('free and open source', { y: 560, at: 'free' });
    s.text('github.com/vincentsch/explainroo', { font: 'mono', size: 46, y: 760, bg: true, border: 'ink', at: '#try' });
    s.burst({ x: 960, y: 390, at: 'free', count: 40 });
  },
};
