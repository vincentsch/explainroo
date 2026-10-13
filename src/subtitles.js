// Subtitle cues use the shown words and their times from the voice timeline.
import { clingsToPrevious } from '../engine/captions.js';

const sentenceEnd = /[.!?…।]["'’”)\]]*$/;
const punctuation = /[,;:.!?…।]["'’”)\]]*$/;

function lines(words, language = 'en') {
  const cjk = ['ja', 'zh'].includes(language);
  const clings = clingsToPrevious(language);
  const limit = cjk ? 18 : 42;
  const separator = cjk ? '' : ' ';
  const text = words.map((w) => w.text).join(separator);
  if (text.length <= limit) return text;
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).map((w) => w.text).join(separator);
    const b = words.slice(i).map((w) => w.text).join(separator);
    if (a.length > limit || b.length > limit) continue;
    // Break after punctuation, unless that leaves a word or two alone on a line.
    const atPunctuation = (cjk ? /[,;:.!?…।。！？、，；：]["'’”)\]」』）]*$/ : punctuation).test(words[i - 1].text) && Math.min(a.length, b.length) >= (cjk ? 5 : 12);
    const glued = !atPunctuation && clings(words[i].text, words[i - 1].text) ? 40 : 0;
    const score = (atPunctuation ? 30 : 0) - Math.abs(a.length - b.length) - glued;
    if (!best || score > best.score) best = { score, text: `${a}\n${b}` };
  }
  return best?.text ?? null;
}

export function subtitleCues(timeline, { from = 0, to = Infinity } = {}) {
  const language = timeline.language || 'en';
  const cjk = ['ja', 'zh'].includes(language);
  const limit = cjk ? 18 : 42;
  const endSentence = cjk ? /[.!?…।。！？]["'’”)\]」』）]*$/ : sentenceEnd;
  const atPunctuation = cjk ? /[,;:.!?…।。！？、，；：]["'’”)\]」』）]*$/ : punctuation;
  const clings = clingsToPrevious(language);
  const cues = [];
  for (const scene of timeline.scenes) {
    const words = scene.words || [];
    let i = 0;
    while (i < words.length) {
      if (words[i].text.length > limit) throw new Error(`subtitle word "${words[i].text}" is longer than ${limit} characters. Shorten its shown text in script.md.`);
      let j = i + 1;
      while (j < words.length) {
        if (endSentence.test(words[j - 1].text) || words[j].start - words[j - 1].end > 0.6 + 1e-9) break;
        if (words[j].end + 0.25 - words[i].start > 6 || lines(words.slice(i, j + 1), language) === null) {
          let k = j - 1;
          while (k > i && !atPunctuation.test(words[k - 1].text)) k--;
          if (k > i) j = k;
          // Without punctuation, start the next cue at a word of its own.
          else while (j - 1 > i && clings(words[j].text, words[j - 1].text)) j--;
          break;
        }
        j++;
      }
      const start = scene.start + words[i].start;
      const end = Math.min(scene.start + words[j - 1].end + 0.25, start + 6, scene.start + (scene.dur ?? Infinity));
      cues.push({ start, end, text: lines(words.slice(i, j), language) });
      i = j;
    }
  }
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
  return cues.filter((c) => c.end > from && c.start < to).map((c) => ({
    ...c, start: Math.max(c.start, from) - from, end: Math.min(c.end, to) - from,
  }));
}

function timestamp(seconds, separator) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${timestamp(c.start, ',')} --> ${timestamp(c.end, ',')}\n${c.text}\n\n`).join('');
}

export function toVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => `${timestamp(c.start, '.')} --> ${timestamp(c.end, '.')}\n${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n\n`).join('');
}
