// Lays scenes end to end. A scene lasts for its lead-in, its narration and a
// short hold; scenes without narration last `min` seconds (default 3).
// `pace` shortens every lead-in, hold and transition (the voice is already
// faster). All times are snapped to the frame grid.

export const TRANSITION_SECONDS = 0.7;

export function buildTimeline(project, voices) {
  const { config, script } = project;
  const fps = config.fps;
  const pace = config.pace || 1;
  const snap = (t) => Math.round(t * fps) / fps;
  const scenes = [];
  const voiceSpans = [];
  let t = 0;
  script.scenes.forEach((scene, index) => {
    const v = voices[scene.id] || { duration: 0, words: [], marks: {}, chunks: [] };
    const a = scene.attrs;
    const lead = v.duration ? (a.lead ?? config.lead) / pace : 0;
    const isLast = index === script.scenes.length - 1;
    const hold = ((a.hold ?? config.hold) + (isLast ? config.end : 0)) / pace;
    let dur = v.duration ? lead + v.duration + hold : ((a.min ?? 3) + (isLast ? config.end : 0)) / pace;
    if (a.min) dur = Math.max(dur, a.min / pace);
    dur = Math.max(snap(dur), 1);
    const start = snap(t);
    const transition = index === 0 ? 'none' : (a.transition || config.transition);
    scenes.push({
      id: scene.id,
      index,
      start,
      dur,
      lead,
      text: scene.text,
      transition,
      voice: v.duration ? { url: `build/voice/${scene.id}.wav`, start: start + lead, dur: v.duration } : null,
      words: v.words.map((w) => ({ text: w.text, start: lead + w.start, end: lead + w.end })),
      marks: Object.fromEntries(Object.entries(v.marks || {}).map(([k, m]) => [k, lead + m])),
      attrs: a,
    });
    for (const c of v.chunks || []) voiceSpans.push({ start: start + lead + c.start, end: start + lead + c.end });
    t = start + dur;
  });
  return {
    fps,
    ...(['ja', 'zh'].includes(config.language) ? { language: config.language } : {}),
    width: config.width,
    height: config.height,
    duration: snap(t),
    frames: Math.round(snap(t) * fps),
    transitionSeconds: TRANSITION_SECONDS / pace,
    pace,
    scenes,
    voiceSpans,
  };
}
