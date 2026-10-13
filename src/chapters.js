// Chapters share the scene boundaries used by the video.
export function buildChapters(timeline, title) {
  const named = timeline.scenes.filter((s) => s.attrs?.chapter !== undefined);
  if (!named.length) return [];
  if (named[0] !== timeline.scenes[0]) named.unshift({ ...timeline.scenes[0], attrs: { chapter: title } });
  return named.map((s, i) => ({ title: s.attrs.chapter, start: s.start, end: named[i + 1]?.start ?? timeline.duration, scene: s.id }));
}

export function chapterHints(chapters) {
  if (!chapters.length) return [];
  const issues = [];
  if (chapters.length < 3) issues.push({ level: 'hint', scene: null, t: null, message: `the video has ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}, and YouTube shows chapters only when there are at least 3 chapters. Name chapters in more scenes, or leave them out.` });
  for (const c of chapters) {
    if (c.end - c.start < 10) issues.push({ level: 'hint', scene: c.scene, t: null, message: `chapter "${c.title}" lasts ${(c.end - c.start).toFixed(1)}s, and YouTube shows chapters only when each lasts at least 10 seconds. Start it at another scene or join it with the next one.` });
  }
  return issues;
}

export function toChaptersText(chapters) {
  return chapters.map((c) => {
    const seconds = Math.floor(c.start);
    const minutes = Math.floor(seconds / 60);
    const pad = (n) => String(n).padStart(2, '0');
    const time = seconds >= 3600 ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
    return `${time} ${c.title}\n`;
  }).join('');
}

export function toChapterMetadata(chapters) {
  const escape = (text) => String(text).replace(/[\\=;#\n]/g, '\\$&');
  return ';FFMETADATA1\n' + chapters.map((c) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start * 1000)}\nEND=${Math.round(c.end * 1000)}\ntitle=${escape(c.title)}\n`).join('');
}
