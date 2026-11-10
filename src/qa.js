// Quality tools for the agent: layout checks, stills, contact sheets and a
// verification pass over the rendered video.
import fs from 'node:fs';
import path from 'node:path';
import { prepare, withEngine } from './pipeline.js';
import { dbtp, probe, loudness, ffmpeg, PEAK_CEILING } from './ffmpeg.js';
import { transcribeWords } from './models.js';
import { readWav } from './wav.js';
import { alignSpeech, bareWord, editDistance, expand, nearList, similar } from './align.js';
import { signWords } from './math-words.js';
import { hasPhonemizer } from './phonemes.js';
import { normWord } from './script.js';
import { givenForms, heardEntry, heardForms, heardInstead, heardQuote, readVoice, sameHeard, sceneHeard, unusedForms, unusedFormText, withHeard } from './voice.js';
import { estimateLength, targetNotes } from './timeline.js';
import { buildChapters, chapterHints, youtubeFrame } from './chapters.js';
import { coverTime } from './render.js';
import { languageIssues, outputPath, ProjectError, scriptName } from './project.js';
import { recordVersion, relativeFile, sha256File } from './history.js';
import { allOf } from './services.js';
import { decodedSound } from './server.js';

// "2 words only nearly matched: Soundroo (heard "Soundru"), Codex (heard "codecs")",
// and "1 word sounded the same: piece (heard "peace")" for words heard as
// another word with the same sound. Two words heard as one show together, like
// See costs (heard "Seacosts"). The same word heard the same way counts once,
// with how often, or with its times in the video when the entries have them,
// like Tides at 12.4 s (heard "Tide").
export function nearlyText(nearly) {
  const groups = { near: { seen: new Map(), words: 0 }, alike: { seen: new Map(), words: 0 } };
  for (let i = 0; i < nearly.length; i++) {
    const n = nearly[i];
    const next = nearly[i + 1];
    const pair = n.joined && next?.joined && next.heard === n.heard && next.scene === n.scene;
    const word = pair ? `${n.word} ${next.word}` : n.word;
    const group = groups[n.alike ? 'alike' : 'near'];
    const key = `${word}\u0000${n.heard ?? ''}`;
    const entry = group.seen.get(key) ?? { word, heard: n.heard, count: 0, times: [] };
    entry.count++;
    if (typeof n.time === 'number') entry.times.push(n.time);
    group.seen.set(key, entry);
    group.words += pair ? 2 : 1;
    if (pair) i++;
  }
  const at = (times) => {
    const shown = times.slice(0, 3).map((t) => `${t.toFixed(1)} s`);
    const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
    return ` at ${list}${times.length > 3 ? ` and ${times.length - 3} more times` : ''}`;
  };
  const list = ({ seen }) => {
    const shown = [...seen.values()].slice(0, 8).map((e) => {
      const heard = e.heard ? ` (heard "${e.heard}")` : '';
      if (e.times.length === e.count) return `${e.word}${at(e.times)}${heard}`;
      return `${e.word}${heard}${e.count > 1 ? ` ${e.count} times` : ''}`;
    });
    return `${shown.join(', ')}${seen.size > 8 ? `, and ${seen.size - 8} more` : ''}`;
  };
  const count = (n) => `${n} word${n === 1 ? '' : 's'}`;
  return [
    ...(groups.near.words ? [`${count(groups.near.words)} only nearly matched: ${list(groups.near)}`] : []),
    ...(groups.alike.words ? [`${count(groups.alike.words)} sounded the same: ${list(groups.alike)}`] : []),
  ].join('; ');
}

// Up to this many words that only nearly matched are listed with their times.
// More are listed by name, and --verbose adds their times.
export const NEARLY_LISTED = 2;

// The near matches as check and verify print them: the list with its advice,
// or, for more than NEARLY_LISTED words without `verbose`, the words without
// their times.
export function nearlyLine(nearly, verbose = false, heard = true, forms = null) {
  if (verbose || nearly.length <= NEARLY_LISTED) return `${nearlyText(nearly)}. ${nearlyAdvice(nearly, heard, forms)}`;
  return `${nearlyText(untimed(nearly))}. ${nearlyShort(nearly, heard, forms)}`;
}

export const NEARLY_SHORT = 'No fix is needed unless one of them sounds wrong when you listen, and --verbose adds their times';

// NEARLY_SHORT with the line for video.json that stops naming the words.
export function nearlyShort(nearly, heard = true, forms = null) {
  const line = heard ? nearlyHeard(nearly, forms) : '';
  return line ? `${NEARLY_SHORT}. ${line}` : NEARLY_SHORT;
}

// The "heard" line for video.json that accepts the near matches as they were
// heard, so check and verify stop naming them, or '' when none can go there.
// Two words heard as one get a line under both words, like "ape lo": ["apelo"].
// With `forms`, from heardForms(), each word lists every form of the run.
export function nearlyHeard(nearly, forms = null) {
  const seen = new Map();
  for (let i = 0; i < nearly.length; i++) {
    const n = nearly[i];
    const next = nearly[i + 1];
    if (n.joined && next?.joined && next.heard === n.heard && next.scene === n.scene) {
      const word = `${n.word} ${next.word}`;
      if (n.heard && !seen.has(word)) seen.set(word, { word, heard: bareWord(n.heard) });
      i++;
    } else if (!n.joined && n.heard && !seen.has(n.word)) seen.set(n.word, { word: n.word, heard: bareWord(n.heard) });
  }
  if (!seen.size) return '';
  const one = seen.size === 1;
  return `If ${one ? 'it is' : 'they are'} said right, add this to video.json, and check and verify stop naming ${one ? 'it' : 'them'}: ${heardEntry([...seen.values()], forms)}`;
}

// The near matches without their times, so the same word heard the same way
// shows once, with how often.
export function untimed(nearly) {
  return nearly.map(({ time, ...n }) => n);
}

// What to do about words that only nearly matched or sounded the same: nothing,
// unless they sound wrong at the times the list gives.
// With `heard`, it also gives the line for video.json that accepts them.
export function nearlyAdvice(nearly, heard = true, forms = null) {
  const one = nearly.length === 1 || (nearly.length === 2 && nearly[0].joined && nearly[1].joined);
  const timed = nearly.some((n) => typeof n.time === 'number');
  const line = heard ? nearlyHeard(nearly, forms) : '';
  return `No fix is needed unless ${one ? 'it sounds' : 'one of them sounds'} wrong when you listen${timed ? ` at ${one ? 'that time' : 'those times'}` : ''}.${line ? ` ${line}` : ''}`;
}

// The time in the video of each near match of a scene, from the scene's words in
// the timeline, in the order of the script.
function nearTimes(nearly, sc) {
  let from = 0;
  return nearly.map((n) => {
    const k = sc ? sc.words.findIndex((w, i) => i >= from && bareWord(w.text) === n.word) : -1;
    if (k === -1) return n;
    from = k + 1;
    return { ...n, time: Math.round((sc.start + sc.words[k].start) * 10) / 10 };
  });
}

// Each word the speech check could not confirm, with its time in the video.
// `offset` is where the transcribed piece starts. `alone` says for each word
// whether the check of the narration alone confirmed it, and such a word has
// `mix: true`: the music or the sounds may cover it.
export function missedWords(words, aligned, offset, scene, alone = null) {
  return aligned.words.flatMap((a, k) => (a.matched ? [] : [{
    ...(scene ? { scene } : {}), word: bareWord(words[k].display ?? words[k].spoken), time: Math.round((offset + a.start) * 100) / 100, ...(a.heard ? { heard: a.heard } : {}), ...(alone?.[k] ? { mix: true } : {}),
  }]));
}

// Two words heard as one, like "Point it" heard as "pointed": a word the final
// mix couldn't confirm next to a near match whose heard form covers both words
// at least as well as the near match alone. The music doesn't cover such a word,
// so it gets no advice about the music. Each pair is { scene, words, word, near,
// heard, time, at }, with `mix: true` when the narration alone confirmed `word`,
// and `at` the places of both words in `aligned`.
export function heardAsOne(words, aligned, offset, scene, alone = null) {
  const pairs = [];
  const used = new Set();
  const said = (k) => normWord(words[k].spoken);
  const shown = (k) => bareWord(words[k].display ?? words[k].spoken);
  aligned.words.forEach((a, k) => {
    if (!a.nearly || !a.heard || used.has(k)) return;
    const heard = normWord(a.heard);
    for (const j of [k + 1, k - 1]) {
      if (!aligned.words[j] || aligned.words[j].matched || used.has(j)) continue;
      const [first, second] = j > k ? [k, j] : [j, k];
      const both = said(first) + said(second);
      if (!similar(both, heard) || editDistance(both, heard) > editDistance(said(k), heard)) continue;
      used.add(k);
      used.add(j);
      pairs.push({ ...(scene ? { scene } : {}), words: `${shown(first)} ${shown(second)}`, word: shown(j), near: shown(k), heard: bareWord(a.heard),
        time: Math.round((offset + aligned.words[first].start) * 100) / 100, ...(alone?.[j] ? { mix: true } : {}), at: [first, second] });
      return;
    }
  });
  return pairs;
}

// The alignment without the pairs of heardAsOne, so their words are neither
// near matches nor unconfirmed words of their own.
function withoutPairs(aligned, pairs) {
  const taken = new Set(pairs.flatMap((p) => p.at));
  return taken.size ? { ...aligned, words: aligned.words.map((a, k) => (taken.has(k) ? { ...a, matched: true, nearly: false } : a)) } : aligned;
}

// What verify says about two words heard as one. The check of the narration
// alone judges the voice.
export function togetherText(p) {
  const head = `"${p.words}" at ${p.time.toFixed(1)} s was probably heard as one word, "${p.heard}", in the final mix, so the music is not what hides "${p.word}" and needs no change`;
  return p.mix
    ? `${head}. The narration alone confirmed "${p.word}", so the voice says it. Listen at that time to be sure`
    : `${head}. The narration alone didn't confirm "${p.word}" either, so see what voice says about it`;
}

// Whether the check of the narration alone confirmed each word of a scene, from
// the scene's voice, or null when it can't say.
function confirmedAlone(project, id, words) {
  const info = withHeard(readVoice(project, id), project.config.language, project.heard);
  if (!Array.isArray(info?.words) || info.words.length !== words.length) return null;
  return info.words.map((w, k) => !!w.matched && w.text === words[k].display);
}

// The music's volume when video.json gives none, and the lowest volume the
// advice goes to.
const MUSIC_VOLUME = 0.5;
const QUIETEST = 0.2;

// A number, sign or maths word, like "two", "minus" or "halves". Whisper often
// writes such words in another way in the final mix, so quieter music may not
// bring them back.
export function mathWord(word, language = 'en') {
  const signs = signWords(language);
  const tokens = expand(word, language);
  return tokens.length > 0 && tokens.every((t) => /^\d+(?:[.,]\d+)?$/.test(t) || signs.has(t));
}

// A number, an amount or a maths word, like "12", "$5", "50%" or "half".
// Heard another way, it may say something else, so it never counts as close.
export function amountWord(word, language = 'en') {
  return /[\p{N}$€£¥%]/u.test(word) || mathWord(word, language);
}

// Whether a heard form sounds close to the word: it starts with the same
// letter and differs in at most half of its letters, like "Brugley" for
// "Brewly". Words of fewer than four letters never do.
export function soundsClose(word, heard) {
  const a = normWord(word).replace(/\s+/g, '');
  const b = String(heard).split(/\s+/).map(normWord).join('');
  const len = Math.max(a.length, b.length);
  return len >= 4 && a[0] === b[0] && editDistance(a, b) / len <= 0.5;
}

// What verify says about words the narration alone confirmed and the final
// mix heard as a form that sounds close, with the line for "heard" that has
// every form of the run, from heardForms().
export function closeText(list, forms) {
  const one = list.length === 1;
  const shown = list.slice(0, 12).map((u) => `"${u.word}" at ${u.time.toFixed(1)} s (heard "${u.heard}")`);
  const more = list.length > 12 ? `, and ${list.length - 12} more` : '';
  const words = [...new Map(list.map((u) => [normWord(u.word), { word: u.word, heard: bareWord(u.heard) }])).values()];
  return `the speech check heard ${list.length} word${one ? '' : 's'} in the final mix as a form that sounds close: ${shown.join(', ')}${more}. The narration alone confirmed ${one ? 'it' : 'them'}, so the voice says ${one ? 'it' : 'them'} and the speech check only spells ${one ? 'it' : 'them'} another way over the music. Quieter music won't change that. Listen at ${one ? 'that time' : 'those times'} to be sure. If ${one ? 'it is' : 'they are'} said right, add this to video.json, and verify stops naming ${one ? 'it' : 'them'}: ${heardEntry(words, forms)}`;
}

// Whether verify may tell the user to lower the music: it is at the default
// volume or above, and not yet at the quietest the advice goes to.
const canLower = (music) => Boolean(music) && (music.volume ?? MUSIC_VOLUME) >= MUSIC_VOLUME && (music.volume ?? MUSIC_VOLUME) > QUIETEST;

// The advice for words that the narration alone confirmed and the final mix
// didn't: music.volume 3 dB lower, which is 0.71 times the volume, and never
// under 0.2. Number and maths words don't count, and music that is already
// quieter than the default gets no lower volume: listening comes next. A word
// that is in the list once with `mix` and once without is named with its time,
// so the advice never says the narration confirmed a word where it didn't, and
// the words the narration didn't confirm are sent to what voice says.
export function mixAdvice(list, music, language = 'en') {
  const covered = list.filter((u) => u.mix);
  if (!covered.length || !music) return '';
  const name = (u) => (u.time !== undefined && list.some((o) => !o.mix && o.word === u.word) ? `"${u.word}" at ${u.time.toFixed(1)} s` : `"${u.word}"`);
  const which = covered.length === list.length ? (list.length === 1 ? 'it' : 'them') : covered.slice(0, 3).map(name).join(', ');
  const one = covered.length === 1;
  const others = list.length - covered.length;
  const rest = others ? `. The narration alone didn't confirm the other ${others === 1 ? 'word' : `${others} words`}, so see what voice says about ${others === 1 ? 'it' : 'them'}` : '';
  const masked = covered.filter((u) => !mathWord(u.word, language));
  if (!masked.length) {
    return `. The narration alone confirmed ${which}. ${one ? 'It is a number or maths word' : 'They are number or maths words'}, which the speech check often hears written another way in the final mix, so quieter music may not help. Listen at ${one ? 'that time' : 'those times'} to be sure${rest}`;
  }
  const now = music.volume ?? MUSIC_VOLUME;
  if (!canLower(music)) {
    return `. The narration alone confirmed ${which}. The music is already at ${now}, quieter than the default ${MUSIC_VOLUME}, so listen at ${one ? 'that time' : 'those times'} before you lower it more${rest}`;
  }
  const lower = Math.max(QUIETEST, Math.floor(now * Math.pow(10, -3 / 20) * 100) / 100);
  return `. The narration alone confirmed ${which}, so the music may cover ${one ? 'it' : 'them'}: set music.volume in video.json to ${lower}, from ${now}, which is ${dbQuieter(now, lower)} dB quieter${rest}`;
}

const dbQuieter = (from, to) => Math.round(20 * Math.log10(from / to));

// The near matches of a transcribed piece of the video, with their times in it.
// `offset` is where the piece starts.
export function timedNear(words, aligned, offset) {
  const times = aligned.words.filter((a) => a.nearly).map((a) => Math.round((offset + a.start) * 10) / 10);
  return nearList(words, aligned.words).map((n, i) => ({ ...n, time: times[i] }));
}

// A transcript cut at a whole word, for a scene whose words have no place in it.
function cutTranscript(text, length = 200) {
  if (text.length <= length) return `"${text}"`;
  const cut = text.slice(0, length + 1).replace(/\s+\S*$/, '');
  return `"${cut || text.slice(0, length)}…"`;
}

// The shown and spoken text of an override without the punctuation after it,
// which the script writes after the braces.
function override(word) {
  const after = /[.,;:!?…)\]"'’”]+$/u;
  const end = after.exec(word.text)?.[0];
  return end && word.spoken.endsWith(end) ? { shown: word.text.slice(0, -end.length), spoken: word.spoken.slice(0, -end.length) } : { shown: word.text, spoken: word.spoken };
}

// What to do about words the voice check couldn't confirm. A word that already
// has {shown|spoken} needs another spoken spelling, so that advice isn't repeated.
// `others` says whether a word without an override wasn't confirmed either.
function unconfirmedAdvice(overridden, others, script) {
  const general = `If the voice says a word wrong, write it as {shown|spoken} in ${script}. If it is said right and only heard wrong, reword the sentence.`;
  if (!overridden.length) return general;
  const said = overridden.map(({ word, heard }) => {
    const { shown, spoken } = override(word);
    return `{${shown}|${spoken}} was ${heard ? `heard as "${heard}"` : 'not heard as written'}`;
  });
  const one = overridden.length === 1;
  // Letters with spaces, like {AES|A E S}, are often read as a word. With commas
  // the voice says each letter.
  const spaced = overridden.map(({ word }) => override(word)).find(({ spoken }) => /^\p{L}(?: \p{L})+$/u.test(spoken.trim()));
  const instead = spaced
    ? `Write the letters with commas, like {${spaced.shown}|${spaced.spoken.trim().split(' ').join(', ')}}, or reword the sentence.`
    : `Try a different spoken spelling, like {${override(overridden[0].word).shown}|another spelling}, or reword the sentence.`;
  const ask = `${said.join(', and ')}, so ${one ? 'the override' : 'the overrides'} didn't help. ${instead}`;
  return others ? `${ask} If the voice says another word wrong, write it as {shown|spoken} in ${script}.` : ask;
}

// A short everyday word, like "its", "the" or "and". A spelling hint can't change
// how it sounds. An acronym like "AI" or a word with digits is no such word.
export function shortWord(text) {
  const word = bareWord(text).replace(/['’]/g, '');
  const letters = Array.from(word);
  if (!letters.length || /\p{N}/u.test(word)) return false;
  if (letters.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return false;
  return letters.length <= 3 || (letters.length === 4 && word === word.toLowerCase());
}

// A saved word whose shown and spoken text differ, from {shown|spoken}.
const hasOverride = (word) => word.spoken !== undefined && word.spoken.replace(/\s+/g, ' ') !== word.text.replace(/\s+/g, ' ');

// Each word of a scene that the speech check couldn't confirm, with what was heard
// there, quoted as check quotes it, and what to do about it: another spoken
// spelling for a word with {shown|spoken}, rewording for a short everyday word or
// a word that was heard as a word that sounds alike where explainroo can't
// compare sounds, and else both: a spelling hint if the voice says it wrong, and
// rewording if it is said right and only heard wrong. Empty for a recording,
// which has advice of its own.
export function unconfirmedWords(project, v, every = new Map()) {
  if (project.config.voice.provider === 'recording' || !Array.isArray(v?.words)) return [];
  const { language } = project.config;
  const missed = v.words.map((word, k) => ({ word, k })).filter(({ word }) => !word.matched);
  if (!missed.length) return [];
  const instead = heardInstead(v, language);
  const script = scriptName(project);
  return missed.map(({ word, k }) => {
    const heard = instead[k] ?? null;
    const quote = heardQuote(v, language, [k]);
    let advice;
    if (hasOverride(word)) advice = unconfirmedAdvice([{ word, heard }], false, script);
    else if (heard && /\p{N}/u.test(word.text) && /\p{L}/u.test(heard) && !/\p{N}/u.test(heard)) advice = `It may be the number said as a word, which the speech check can't read here. If the voice says it right, write it as {${bareWord(word.text)}|${bareWord(heard)}} in ${script}.`;
    else if (heard && !hasPhonemizer(language) && soundsAlike(normWord(heard), normWord(word.text))) advice = `"${heard}" may sound the same, and in this language the speech check can't compare sounds, so {shown|spoken} can't help. Reword the sentence.`;
    else if (shortWord(word.text)) advice = `"${bareWord(word.text)}" is a short, common word, so a spelling hint can't change how it sounds. Reword the sentence.`;
    else if (every.has(normWord(word.text))) advice = `If the voice says it wrong, write it as {${bareWord(word.text)}|spoken spelling} in ${script}. ${everyTimeAdvice(every.get(normWord(word.text)))}`;
    else advice = `If the voice says it wrong, write it as {${bareWord(word.text)}|spoken spelling} in ${script}. If it is said right and only heard wrong, reword the sentence.`;
    const given = givenText(v, [k]);
    return { word: word.text, heard, quote, ...(given ? { given } : {}), advice };
  });
}

// The text the voice was given for the sentences of the words at `indexes`, after
// {shown|spoken}, quoted, so a reader can tell a wrong reading from a word that
// was only heard wrong. Null when the voice has no sentences saved.
export function givenText(v, indexes) {
  if (!Array.isArray(v?.chunks) || !Array.isArray(v.words)) return null;
  const sentences = [...new Set(indexes.map((k) => {
    const w = v.words[k];
    // The last sentence that starts before the word, the one it is in.
    return w ? v.chunks.findLast((c) => c.start <= w.start + 0.01) ?? v.chunks[0] : null;
  }).filter(Boolean))];
  if (!sentences.length) return null;
  return sentences.map((c) => cutTranscript(c.text)).join(' and ');
}

// The words of the narration that the speech check heard as the same other
// spelling each time they come up, at least twice, like "Tabslip" as "Tap Lip", as
// a map from the word to { word, heard }. A short everyday word is left out:
// "heard" would accept its other spelling anywhere.
export function heardEveryTime(project, voices) {
  const { language } = project.config;
  const seen = new Map();
  for (const sc of project.script.scenes) {
    const v = voices[sc.id];
    if (!Array.isArray(v?.words)) continue;
    const instead = v.words.some((w) => !w.matched) ? heardInstead(v, language) : {};
    v.words.forEach((w, k) => {
      const key = normWord(w.text);
      if (!key) return;
      const entry = seen.get(key) ?? { word: bareWord(w.text), heard: [], times: 0 };
      entry.times++;
      if (!w.matched && instead[k]) entry.heard.push(instead[k]);
      seen.set(key, entry);
    });
  }
  return new Map([...seen].filter(([key, e]) => e.times >= 2 && e.heard.length === e.times && !shortWord(e.word) && e.heard.every((h) => sameHeard(h, e.heard[0])) && spelling(key, e.heard[0]))
    .map(([key, e]) => [key, { word: e.word, heard: e.heard[0] }]));
}

// Whether what was heard is another way to write the word: close to it, like
// "Tap Lip" for "Tabslip", or written with digits or signs, like "5/2" for
// "halves". A different word, like "station" for "Gravitation", is none.
function spelling(word, heard) {
  return /[\p{N}\p{S}/]/u.test(heard) || soundsAlike(heard.split(/\s+/).map(normWord).join(''), word);
}

// What to do about a word heard as the same other spelling each time.
function everyTimeAdvice({ word, heard }) {
  return `It was heard as "${heard}" each time. If it is said right, add this to video.json, and the check accepts it: ${heardEntry([{ word, heard }])}`;
}

// Two spellings close enough to sound alike, also when they are short, like "Rad" and "Rat".
const soundsAlike = (a, b) => similar(a, b) || (a.length > 1 && b.length > 1 && Math.max(a.length, b.length) <= 3 && editDistance(a, b) <= 1);

// One line for each word voice couldn't confirm.
export function unconfirmedLine(u) {
  const given = u.given ? `the voice was given ${u.given}, and ` : '';
  return `  "${bareWord(u.word)}": ${given}${u.quote ? `it heard ${u.quote}` : given ? 'it heard nothing there' : 'nothing was heard there'}. ${u.advice}`;
}

// What check says about the speech check of each scene, from the narration that
// voice made: the words it couldn't confirm and what to do about them, and the
// words that only nearly matched. `speech` has one entry per narrated scene.
export function speechFindings(project, voices, timeline = null) {
  const issues = [];
  const placed = new Map((timeline?.scenes ?? []).map((sc) => [sc.id, sc]));
  const speech = [];
  const script = scriptName(project);
  const recording = project.config.voice.provider === 'recording';
  const every = recording ? new Map() : heardEveryTime(project, voices);
  // Every form each word was heard as, in all scenes, for the line for "heard".
  const forms = heardForms(...project.script.scenes.map((sc) => sceneHeard(voices[sc.id], project.config.language)), givenForms(project.heard));
  for (const sc of project.script.scenes) {
    const v = voices[sc.id];
    const suspicious = v ? v.unmatched.filter((w) => w.replace(/[^\p{L}\p{M}\p{N}]/gu, '').length > 3) : [];
    // A word that already has {shown|spoken} counts at any length, like {SQL|sequel},
    // because its override didn't help.
    const unconfirmed = Array.isArray(v?.words) ? v.words.map((word, k) => ({ word, k })).filter(({ word }) => !word.matched) : [];
    const missed = recording ? [] : unconfirmed;
    const overridden = missed.filter(({ word }) => hasOverride(word));
    if (v && v.duration && (v.matchRate < 0.9 || suspicious.length || overridden.length)) {
      // In the order of the script, the long words and every word with an override.
      const listed = overridden.length ? missed.filter(({ word }) => hasOverride(word) || suspicious.includes(word.text)).slice(0, 8) : null;
      const shown = listed ? listed.filter(({ word }) => hasOverride(word)) : [];
      // What was heard in place of each listed override.
      const instead = shown.length ? heardInstead(v, project.config.language) : {};
      const names = listed ? listed.map(({ word }) => word.text) : suspicious.slice(0, 8);
      // The transcript where the named words should be, four words on each side.
      const named = listed ?? unconfirmed.filter(({ word }) => suspicious.includes(word.text)).slice(0, 8);
      const quote = heardQuote(v, project.config.language, (named.length ? named : unconfirmed.slice(0, 3)).map(({ k }) => k)) ?? cutTranscript(v.transcript);
      // Words without an override heard as the same other spelling each time get the line for "heard".
      const same = recording ? [] : [...new Map(missed.filter(({ word }) => !hasOverride(word) && every.has(normWord(word.text))).map(({ word }) => [normWord(word.text), every.get(normWord(word.text))])).values()];
      const advice = recording
        ? `The recording does not match ${script} here. Make ${script} say what was actually said.`
        : unconfirmedAdvice(shown.map(({ word, k }) => ({ word, heard: instead[k] })), missed.some(({ word }) => !hasOverride(word)), script) + same.map((e) => ` "${e.word}" ${everyTimeAdvice(e).replace(/^It /, '')}`).join('');
      const given = recording ? null : givenText(v, (named.length ? named : unconfirmed.slice(0, 3)).map(({ k }) => k));
      issues.push({ level: 'warn', scene: sc.id, t: null, message: `the voice check could not confirm ${names.length ? names.map((w) => `"${w}"`).join(', ') : `${Math.round((1 - v.matchRate) * 100)}% of the words`}. ${given ? `The voice was given ${given}. ` : ''}It heard: ${quote}. ${advice}` });
    }
    if (v && v.duration > 40) issues.push({ level: 'hint', scene: sc.id, t: null, message: `the narration runs ${v.duration.toFixed(0)}s; long scenes are easier to follow when split` });
    if (v && v.duration) {
      const nearly = nearTimes(v.nearly ?? [], placed.get(sc.id));
      speech.push({ scene: sc.id, matchRate: v.matchRate, nearly });
      if (nearly.length) issues.push({ level: 'hint', scene: sc.id, t: null, key: 'nearly', words: nearly.length, nearly, heard: formsOf(nearly, forms), message: `understood ${Math.round(v.matchRate * 100)}%, ${nearlyText(nearly)}. ${nearlyAdvice(nearly, true, forms)}` });
    }
  }
  // Forms of "heard" that matched nothing, for words the run still doesn't confirm.
  for (const u of unusedForms(voices, project.config.language, project.heard)) issues.push({ level: 'hint', scene: null, t: null, key: 'heard', word: u.word, forms: u.forms, message: unusedFormText(u) });
  return { issues, speech };
}

// The forms of the words in `nearly`, from heardForms(), as { word: [forms] }.
export function formsOf(nearly, forms) {
  const out = {};
  for (const n of nearly) {
    const have = forms.get(normWord(n.word));
    if (!n.joined && have?.length) out[n.word] = have;
  }
  return out;
}

// `platform` is the platform of a package being made. Chapter hints are about
// YouTube, so they show for a YouTube package, or without a package for a
// YouTube size.
export async function check(project, { log = () => {}, step = 0.25, viewWidth = null, platform = null } = {}) {
  if (viewWidth !== null && (!Number.isFinite(viewWidth) || viewWidth <= 0)) throw new Error("--view-width must be a positive number");
  // How long the video will be about, when check is the step that makes the narration.
  let estimate = null;
  const { voices, timeline } = await prepare(project, { log, onEstimate: (e) => { estimate = e; } });
  const youtube = platform ? platform === 'youtube' : youtubeFrame(project.config);
  const issues = youtube ? chapterHints(buildChapters(timeline, project.script.title || project.config.title)) : [];
  const { issues: spoken, speech } = speechFindings(project, voices, timeline);
  issues.push(...spoken);
  issues.push(...targetNotes(timeline, estimateLength(project)?.perMinute).map((n) => ({ ...n, scene: null, t: null })));
  if (project.languages) issues.push(...languageIssues(project));
  if (project.config.music?.src) {
    try {
      await decodedSound(project.dir, project.config.music.src);
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      issues.push({ level: 'error', scene: null, t: null, message: `music: ${e.message}` });
    }
  }
  // The cover's moment. One at a scene that isn't there is an error, which
  // would stop render.
  let cover = null;
  try {
    cover = coverTime(project.config, timeline);
  } catch (e) {
    issues.push({ level: 'error', scene: null, t: null, message: `cover: ${e.message}` });
  }
  const pageIssues = await withEngine(project, timeline, { scale: 0.5, log }, async (page) => [
    ...(await page.evaluate(([s, w]) => window.explainroo.check(s, w), [step, viewWidth])),
    ...(await page.evaluate(() => window.explainroo.soundFileIssues())),
    ...(cover ? [await page.evaluate(([T, auto]) => window.explainroo.coverIssue(T, auto), [cover.T, !!cover.auto])].filter(Boolean) : []),
    ...(cover ? [await page.evaluate((T) => window.explainroo.coverCropIssue(T), cover.T)].filter(Boolean) : []),
    ...[await page.evaluate(() => window.explainroo.firstFrameIssue())].filter(Boolean),
  ]);
  issues.push(...pageIssues);
  const order = { error: 0, warn: 1, hint: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { issues, duration: timeline.duration, scenes: timeline.scenes.length, speech, ...(estimate ? { estimate } : {}) };
}

// Specs: "12.5" (seconds into the video), "scene" (end of the scene, when it
// is fully built), "scene@2.4" (seconds into the scene), "scene@end".
export function resolveTimes(timeline, specs) {
  const byId = new Map(timeline.scenes.map((s) => [s.id, s]));
  const endOf = (sc) => sc.start + Math.max(0, sc.dur - 0.3);
  if (!specs.length) return timeline.scenes.map((sc) => ({ T: endOf(sc), label: `${sc.id}@end` }));
  return specs.map((spec) => {
    if (typeof spec === 'number' || /^\d+(\.\d+)?$/.test(spec)) {
      const T = Math.min(Number(spec), timeline.duration - 1 / timeline.fps);
      return { T, label: `t${T.toFixed(2)}` };
    }
    const [id, at] = spec.split('@');
    const sc = byId.get(id);
    if (!sc) throw new Error(`no scene "${id}". Scenes: ${[...byId.keys()].join(', ')}`);
    if (!at || at === 'end') return { T: endOf(sc), label: `${id}@end` };
    if (at === 'start') return { T: sc.start, label: `${id}@start` };
    const local = Number(at);
    if (!Number.isFinite(local)) throw new Error(`"${spec}": use scene@seconds, for example ${id}@1.5`);
    // Keep the time as written, so "ask@7.0" saves as ask@7.0.png.
    return { T: sc.start + Math.min(local, sc.dur - 0.01), label: `${id}@${at}` };
  });
}

export async function stills(project, specs, { log = () => {}, scale = 1, transparent = false } = {}) {
  const { timeline } = await prepare(project, { log });
  const dir = path.relative(project.dir, outputPath(project, 'stills')).split(path.sep).join('/');
  const list = resolveTimes(timeline, specs).map((x) => ({ ...x, path: `${dir}/${x.label.replace(/[^\w@.-]/g, '_')}.png` }));
  const notes = await withEngine(project, timeline, { scale, transparent, log }, (page) => page.evaluate((l) => window.explainroo.stills(l), list));
  // A still caught in a camera move, or while something draws itself in, says so.
  return list.map((x, i) => ({ time: Math.round(x.T * 100) / 100, label: x.label, file: path.join(project.dir, x.path), ...(notes[i] ? { note: notes[i] } : {}) }));
}

// `times` takes what still takes, like ["3", "intro@2"], and shows just those
// moments, in that order, in a sheet of its own.
const LARGE_FRAME = 640;

// `large` makes frames 640 pixels wide, 3 to a row, big enough to read labels.
export async function sheet(project, { scene = null, every = null, times: moments = null, cols = null, large = false, log = () => {} } = {}) {
  if (moments && (scene || (every !== null && every !== undefined))) throw new ProjectError(`--times picks the moments itself, so it can't go with --${scene ? 'scene' : 'every'}. Leave out one of them.`);
  // An unknown scene stops before any narration is made.
  const ids = project.script.scenes.map((s) => s.id);
  if (scene && !ids.includes(scene)) throw new ProjectError(`there is no scene "${scene}" in ${scriptName(project)}. Its scenes are: ${ids.join(', ')}`);
  const { timeline } = await prepare(project, { log });
  let times = [];
  let labels = [];
  const file = path.relative(project.dir, outputPath(project, moments ? 'sheet-times' : scene ? `sheet-${scene}` : 'sheet', '.jpg')).split(path.sep).join('/');
  if (moments) {
    const list = resolveTimes(timeline, moments);
    times = list.map((x) => x.T);
    labels = list.map((x) => x.label);
  } else if (scene) {
    const sc = timeline.scenes.find((s) => s.id === scene);
    const step = every ?? Math.max(0.25, Math.min(1, sc.dur / 16));
    for (let t = 0; t < sc.dur - 0.01; t += step) {
      times.push(sc.start + t);
      labels.push(`${sc.id} ${t.toFixed(2)}s`);
    }
    times.push(sc.start + sc.dur - 0.05);
    labels.push(`${sc.id} end`);
  } else {
    const step = every ?? Math.max(0.5, Math.min(3, timeline.duration / 30));
    for (let T = 0; T < timeline.duration; T += step) {
      const sc = [...timeline.scenes].reverse().find((s) => T >= s.start) || timeline.scenes[0];
      times.push(T);
      labels.push(`${sc.id} ${(T - sc.start).toFixed(1)}s`);
    }
  }
  const c = cols ?? Math.min(times.length, large ? 3 : times.length > 20 ? 6 : times.length > 9 ? 5 : 4);
  const thumb = large ? LARGE_FRAME : timeline.width >= timeline.height ? 320 : 200;
  // The page draws at half size, or larger when a large frame needs it.
  const scale = large ? Math.min(1, Math.max(0.5, LARGE_FRAME / timeline.width)) : 0.5;
  const { notes } = await withEngine(project, timeline, { scale, log }, (page) => page.evaluate((o) => window.explainroo.sheet(o), { times, labels, cols: c, thumb, path: file }));
  // The frames caught in a camera move, or while something draws itself in.
  const marked = notes.flatMap((note, i) => (note ? [{ time: Math.round(times[i] * 100) / 100, label: labels[i], note }] : []));
  return { file: path.join(project.dir, file), frames: times.length, ...(moments ? { times: times.map((T, i) => ({ time: Math.round(T * 100) / 100, label: labels[i] })) } : {}), marked };
}

// Why verify has no video: the file it looked for, and the videos that are in
// out/, which render wrote with other flags.
function missingVideo(project, video, named) {
  if (named) return `${video} does not exist`;
  const out = project.paths.out;
  const there = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /\.(mp4|webm|mov)$/i.test(f) && fs.statSync(path.join(out, f)).isFile()).sort() : [];
  if (!there.length) return `${video} does not exist. Run "explainroo render" first.`;
  return `${video} does not exist, but ${path.relative(project.dir, out) || out}/ has ${allOf(there)}. verify looks for the file that render writes with the same --platform, --size and --no-watermark, so give it those flags, or name a file with --file.`;
}

// The report goes to `report`, and by default to out/report.json, also for a
// file given with --file. `transcribe` replaces Whisper in tests.
export async function verify(project, { file = null, report: reportFile = null, log = () => {}, transcribe = transcribeWords } = {}) {
  const video = path.resolve(file || outputPath(project, 'video', '.mp4'));
  if (path.extname(video).toLowerCase() === '.gif') throw new Error('verify checks MP4, WebM and MOV files. Pass a video with --file.');
  if (!fs.existsSync(video)) throw new Error(missingVideo(project, video, !!file));
  const issues = [];
  const info = await probe(video);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format.duration);
  if (!v) issues.push({ level: 'error', message: 'the file has no video stream' });
  if (!a) issues.push({ level: 'error', message: 'the file has no audio stream' });
  const loud = a ? await loudness(video) : null;
  if (loud && loud.integrated !== null && Math.abs(loud.integrated - project.config.loudness) > 1.5) {
    issues.push({ level: 'warn', message: `loudness is ${loud.integrated} LUFS, target is ${project.config.loudness}` });
  }
  if (loud?.truePeak > 0) {
    issues.push({ level: 'error', message: `the true peak is ${dbtp(loud.truePeak)}, above 0 dBTP, so the sound is clipping. Render the video again with this version of explainroo, which holds the peak at ${dbtp(PEAK_CEILING)}. If it still clips, lower "loudness" in video.json.` });
  } else if (loud?.truePeak > PEAK_CEILING) {
    issues.push({ level: 'warn', message: `the true peak is ${dbtp(loud.truePeak)}, above the ceiling of ${dbtp(PEAK_CEILING)}` });
  }

  const alpha = v && (String(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE) === '1' || /^(yuva|rgba|bgra|gbrap|argb|abgr)/.test(v.pix_fmt || ''));
  let blacks = [];
  if (alpha) issues.push({ level: 'hint', message: 'black-frame detection is skipped because the video has alpha' });
  else if (v) {
    blacks = await blackSegments(video);
  }
  for (const [s, e] of blacks) issues.push({ level: 'warn', message: `black frames from ${s.toFixed(2)}s to ${e.toFixed(2)}s` });

  let silences = [];
  if (a) {
    silences = await silentStretches(video, duration);
    for (const [s, e] of silences) issues.push({ level: 'hint', message: `near silence from ${s.toFixed(1)}s to ${e.toFixed(1)}s` });
  }

  // Can the narration be understood over the music and effects? Each scene
  // is transcribed on its own: Whisper sometimes drops a whole 30 second
  // chunk of a long file ("(bell dings)"), and per scene the report can say
  // where the voice is hard to follow.
  let speech = null;
  let music = null;
  if (a) {
    const wav = path.join(project.paths.build, 'verify-16k.wav');
    await ffmpeg(['-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const { samples } = readWav(wav);
    log('checking that the narration is understandable in the final mix');
    const tlFile = path.join(project.paths.build, 'timeline.json');
    const timeline = fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, 'utf8')) : null;
    const spokenWords = (sc) => sc.units.filter((u) => u.type === 'word').map((u) => ({ spoken: u.spoken, display: u.display }));
    const byId = new Map(project.script.scenes.map((sc) => [sc.id, sc]));
    const sameScenes = timeline && timeline.scenes.length === project.script.scenes.length && timeline.scenes.every((t) => byId.has(t.id)) && Math.abs(timeline.duration - duration) < 1;
    if (sameScenes) {
      const texts = [];
      const scenes = [];
      const nearly = [];
      const unconfirmed = [];
      const together = [];
      let total = 0;
      let matched = 0;
      for (const t of timeline.scenes) {
        const words = spokenWords(byId.get(t.id));
        if (!words.length) continue;
        const from = Math.max(0, Math.floor(t.start * 16000));
        const to = Math.min(samples.length, Math.ceil((t.start + t.dur) * 16000));
        const heard = await transcribe(samples.subarray(from, to), { log, language: project.config.language });
        texts.push(heard.text);
        const aligned = await alignSpeech(words, heard.words, t.dur, project.config.language, { accept: project.heard });
        const rate = aligned.matchRate;
        const alone = confirmedAlone(project, t.id, words);
        const pairs = heardAsOne(words, aligned, from / 16000, t.id, alone);
        const rest = withoutPairs(aligned, pairs);
        const near = timedNear(words, rest, from / 16000);
        scenes.push({ id: t.id, matchRate: Math.round(rate * 1000) / 1000, nearly: near });
        nearly.push(...near.map((n) => ({ scene: t.id, ...n })));
        unconfirmed.push(...missedWords(words, rest, from / 16000, t.id, alone));
        together.push(...pairs.map(({ at, ...p }) => p));
        total += words.length;
        matched += rate * words.length;
        if (rate < 0.8) issues.push({ level: 'warn', message: `scene "${t.id}": only ${Math.round(rate * 100)}% of the narration was understood in the final mix; it heard "${heard.text.slice(0, 120)}"` });
      }
      const rate = total ? matched / total : 1;
      speech = { matchRate: Math.round(rate * 1000) / 1000, transcript: texts.join(' '), scenes, nearly, unconfirmed, together };
      if (project.config.music && timeline.voiceSpans?.length) music = musicLevel(samples, 16000, timeline.voiceSpans, duration);
    } else {
      // The whole file at once, so a word that only nearly matched has no scene.
      const heard = await transcribe(samples, { log, language: project.config.language });
      const script = project.script.scenes.flatMap(spokenWords);
      const aligned = await alignSpeech(script, heard.words, duration, project.config.language, { accept: project.heard });
      const pairs = heardAsOne(script, aligned, 0, null);
      const rest = withoutPairs(aligned, pairs);
      speech = { matchRate: Math.round(aligned.matchRate * 1000) / 1000, transcript: heard.text, nearly: timedNear(script, rest, 0), unconfirmed: missedWords(script, rest, 0, null), together: pairs.map(({ at, ...p }) => p) };
    }
    for (const p of speech.together) issues.push({ level: p.mix ? 'hint' : 'warn', message: togetherText(p) });
    // A word the narration alone confirmed, heard in the mix as a form that
    // sounds close, is the speech check spelling it another way: a hint. A
    // number or an amount heard wrong changes the meaning, so it stays a warning.
    const close = speech.unconfirmed.filter((u) => u.mix && u.heard && soundsClose(u.word, u.heard) && !amountWord(u.word, project.config.language));
    const missed = speech.unconfirmed.filter((u) => !close.includes(u));
    // Every form each word was heard as in the mix, then the forms of "heard".
    const forms = heardForms(speech.nearly, speech.unconfirmed, givenForms(project.heard));
    speech.heard = formsOf([...speech.nearly, ...speech.unconfirmed], forms);
    if (close.length) issues.push({ level: 'hint', message: closeText(close, forms) });
    if (missed.length) issues.push({ level: 'warn', message: unconfirmedText(missed) + mixAdvice(missed, project.config.music, project.config.language) });
    if (speech.matchRate < 0.85) issues.push({ level: 'warn', message: `only ${Math.round(speech.matchRate * 100)}% of the script was understood in the final mix; ${canLower(project.config.music) ? 'lower music.volume or check pronunciation' : 'listen to it and check pronunciation'}` });
    fs.rmSync(wav, { force: true });
  }
  const sha256 = sha256File(video);
  const report = {
    file: video,
    sha256,
    duration: Math.round(duration * 100) / 100,
    video: v ? { width: v.width, height: v.height, fps: v.r_frame_rate, codec: v.codec_name } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
    loudness: loud,
    blackSegments: blacks,
    silences,
    speech,
    ...(project.config.music ? { music } : {}),
    issues,
    ...verdictOf(issues),
  };
  const target = path.resolve(reportFile || path.join(project.paths.out, 'report.json'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  recordVersion(project.dir, {
    event: 'verify',
    time: new Date().toISOString(),
    file: relativeFile(project.dir, video),
    sha256,
    ok: !issues.some((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warn').length,
    loudness: loud?.integrated ?? null,
    understood: speech?.matchRate ?? null,
    report: relativeFile(project.dir, target),
  });
  return report;
}

// How loud the music is in a video with narration: its level in the pauses of
// the narration and how far under the voice it sits, both in dB, as
// { pauses, under }, or { heard: false } when no music can be heard there.
// `spans` are the times the voice speaks, from the timeline. A pause counts
// from 0.15 s after the voice to 0.15 s before it speaks again, without the
// music's fade in and out, and a short sound effect in a pause doesn't count.
// Null when the narration has no pause long enough to measure.
export const MUSIC_UNHEARD_DB = -60;
export function musicLevel(samples, rate, spans, duration) {
  const BLOCK = Math.round(rate * 0.05);
  const merged = [];
  for (const sp of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end);
    else merged.push({ ...sp });
  }
  const pauses = [];
  let from = 1.5;
  for (const sp of [...merged, { start: duration - 0.5 + 0.15, end: Infinity }]) {
    const a = from;
    const b = sp.start - 0.15;
    if (b - a >= 0.2) pauses.push([a, b]);
    from = Math.max(from, sp.end + 0.15);
  }
  const blocks = (list) => list.flatMap(([a, b]) => {
    const out = [];
    for (let i = Math.max(0, Math.floor(a * rate)); i + BLOCK <= Math.min(samples.length, b * rate); i += BLOCK) {
      let sum = 0;
      for (let k = i; k < i + BLOCK; k++) sum += samples[k] * samples[k];
      out.push(sum / BLOCK);
    }
    return out;
  });
  const quiet = blocks(pauses);
  const loud = blocks(merged.map((sp) => [sp.start, sp.end]));
  if (quiet.length < 10 || !loud.length) return null;
  const db = (power) => 10 * Math.log10(Math.max(power, 1e-12));
  const middle = [...quiet].sort((a, b) => a - b)[Math.floor(quiet.length / 2)];
  const kept = quiet.filter((p) => p <= middle * 4);
  const music = db(kept.reduce((n, p) => n + p, 0) / kept.length);
  const voice = db(loud.reduce((n, p) => n + p, 0) / loud.length);
  if (music < MUSIC_UNHEARD_DB) return { heard: false };
  return { heard: true, pauses: Math.round(music), under: Math.round(voice - music) };
}

// What verify says about the music of a report, or '' for a video without music.
export function musicLine(r) {
  if (!r || !('music' in r)) return '';
  const { music } = r;
  if (!music) return 'music: not measured, because the narration has no pause long enough';
  if (!music.heard) return 'music: none can be heard in the pauses of the narration';
  return `music: about ${music.under} dB under the voice, at ${music.pauses} dB in the pauses of the narration`;
}

// The stretches of black frames of a video, as [start, end] in seconds.
export async function blackSegments(video) {
  const { stderr } = await ffmpeg(['-nostats', '-i', video, '-vf', 'blackdetect=d=0.4:pix_th=0.08', '-an', '-f', 'null', '-']);
  return [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

// The stretches of near silence of 2.5 seconds or more, as [start, end].
export async function silentStretches(video, duration) {
  const { stderr } = await ffmpeg(['-nostats', '-i', video, '-af', 'silencedetect=n=-50dB:d=2.5', '-vn', '-f', 'null', '-']);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? duration]);
}

// "the speech check could not confirm 2 words in the final mix: "key" at 12.3 s
// (heard "can"), "needed" at 12.6 s". Up to 12 words, then how many more.
export function unconfirmedText(list) {
  const shown = list.slice(0, 12).map((u) => `"${u.word}" at ${u.time.toFixed(1)} s${u.heard ? ` (heard "${u.heard}")` : ''}`);
  const more = list.length > 12 ? `, and ${list.length - 12} more` : '';
  return `the speech check could not confirm ${list.length} word${list.length === 1 ? '' : 's'} in the final mix: ${shown.join(', ')}${more}`;
}

// Whether a video passed verify: "passed", "passed with 2 warnings", or "failed:
// 1 problem" when it found an error. Hints count for neither.
export function verdictOf(issues) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  const verdict = errors ? `failed: ${errors} problem${errors === 1 ? '' : 's'}` : warnings ? `passed with ${warnings} warning${warnings === 1 ? '' : 's'}` : 'passed';
  return { passed: !errors, verdict };
}

// What verify prints: the file, the narration understood with the words that
// only nearly matched, each finding, and the verdict last.
export function formatVerify(r, { verbose = false } = {}) {
  // The line for "heard" has every form each word was heard as in the mix.
  const forms = r.speech?.heard ? new Map(Object.entries(r.speech.heard).map(([word, list]) => [normWord(word), list])) : null;
  const nearly = r.speech?.nearly?.length ? `, ${nearlyLine(r.speech.nearly, verbose, true, forms)}` : '';
  return [
    `${r.file}: ${r.duration}s, ${r.video ? `${r.video.width}x${r.video.height}` : 'no video'}, loudness ${r.loudness?.integrated ?? '?'} LUFS, true peak ${dbtp(r.loudness?.truePeak)}`,
    r.speech ? `narration understood: ${Math.round(r.speech.matchRate * 100)}%${nearly}` : '',
    musicLine(r),
    ...r.issues.map((i) => `${i.level.toUpperCase().padEnd(5)} ${i.message}`),
    r.verdict ?? verdictOf(r.issues).verdict,
  ].filter(Boolean).join('\n');
}
