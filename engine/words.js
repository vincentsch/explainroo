// The words the kits and the formats draw when a scene doesn't give its own,
// in every language a video can be in. s.kitWord(key) gives the word in the
// language of the version being drawn, and check names the right one when a
// video in another language shows the English word.

export const KIT_WORDS = {
  // s.short.step(): "STEP 2/4", drawn in capitals.
  step: { en: 'Step', es: 'Paso', fr: 'Étape', it: 'Passo', 'pt-br': 'Passo', hi: 'चरण', ja: 'ステップ', zh: '步骤', de: 'Schritt' },
  // The small label above a product's name in nameCard() of product-launch.
  new: { en: 'New', es: 'Nuevo', fr: 'Nouveau', it: 'Novità', 'pt-br': 'Novo', hi: 'नया', ja: '新登場', zh: '全新', de: 'Neu' },
  // The button of callToAction() in product-launch and offer() in product-ad.
  'try-free': { en: 'Try it for free', es: 'Pruébalo gratis', fr: 'Essayez gratuitement', it: 'Provalo gratis', 'pt-br': 'Experimente grátis', hi: 'मुफ़्त में आज़माएँ', ja: '無料で試す', zh: '免费试用', de: 'Kostenlos testen' },
};

// Where each word is drawn, and the option that sets it, for check's hint.
const WHERE = {
  step: (word) => `s.short.step(n, total, { word: '${word}' })`,
  new: (word) => `nameCard(s, name, promise, { eyebrow: '${word}' })`,
  'try-free': (word) => `callToAction(s, { action: '${word}' }) or offer(s, { action: '${word}' })`,
};

export const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', 'pt-br': 'Brazilian Portuguese', hi: 'Hindi', ja: 'Japanese', zh: 'Chinese', de: 'German' };

export function kitWord(key, language) {
  const words = KIT_WORDS[key];
  if (!words) throw new Error(`s.kitWord("${key}"): there is no such word. Words: ${Object.keys(KIT_WORDS).join(', ')}`);
  return words[language] ?? words.en;
}

// The kit word that a drawn text shows in English, as { key, text }, or null.
// "STEP 2/4" counts as the word "Step".
export function englishKitWord(text) {
  const shown = String(text).trim();
  const step = /^(\S+) \d+\/\d+$/.exec(shown);
  if (step && step[1].toLowerCase() === KIT_WORDS.step.en.toLowerCase()) return { key: 'step', text: shown };
  for (const [key, words] of Object.entries(KIT_WORDS)) {
    if (key !== 'step' && shown.toLowerCase() === words.en.toLowerCase()) return { key, text: shown };
  }
  return null;
}

// check's hint for an English kit word in a video in another language.
export function kitWordHint(found, language) {
  const word = kitWord(found.key, language);
  const shown = found.key === 'step' ? word.toUpperCase() : word;
  return `"${found.text}" is a default word in English, and this video is in ${LANGUAGE_NAMES[language] ?? language}. Set the word, like ${WHERE[found.key](shown)}`;
}
