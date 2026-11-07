// One function per scene in script.md. Each function draws one frame of its
// scene, and s.t is the time in seconds since the scene started. Give elements
// an `at` time (seconds, a spoken word or "#marker") and the look animates
// them in. Run "npx --yes explainroo docs scene-api" to read the full scene API.

export default {
  hook(s) {
    s.title('{{title}}', { y: s.safe.y + s.safe.h * 0.38 });
    s.icon('mouse-pointer-click', { y: s.safe.y + s.safe.h * 0.7, size: 130, at: '#click', color: 'accent' });
  },

  steps(s) {
    // s.safe is the part of the frame that is free for content. Wide videos
    // show the steps side by side, tall ones stack them.
    const tall = s.H > s.W;
    s.text('Three steps', { font: 'display', size: 76, y: s.safe.y + 50, at: 0 });
    const spots = tall
      ? s.col(3, { y: s.safe.y + s.safe.h * 0.6, height: s.safe.h * 0.66 }).map((y) => ({ x: s.cx, y }))
      : s.row(3, { width: Math.min(1180, s.safe.w - 260) }).map((x) => ({ x, y: s.cy }));
    s.box('Find the server', { id: 'find', ...spots[0], icon: 'search', color: 'blue', at: '#one' });
    s.box('Ask for the page', { id: 'ask', ...spots[1], icon: 'send', color: 'green', at: '#two' });
    s.box('Draw it', { id: 'draw', ...spots[2], icon: 'paintbrush', color: 'purple', at: '#three' });
    s.arrow('find', 'ask', { at: s.cue('Then') - 0.4 });
    s.arrow('ask', 'draw', { at: s.cue('Finally') - 0.4 });
  },

  outro(s) {
    s.number(3, { suffix: ' steps', y: s.safe.y + s.safe.h * 0.42, at: 0.2 });
    s.subtitle('in less time than a blink', { at: '#fast', y: s.safe.y + s.safe.h * 0.62 });
  },
};
