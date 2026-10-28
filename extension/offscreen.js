// Hidden extension page: translates words from English with Chrome's on-device Translator API.
const translators = new Map();

async function translate(text, lang) {
  if (typeof Translator === 'undefined') return { error: 'unavailable' };
  try {
    if (!translators.has(lang)) {
      const av = await Translator.availability({ sourceLanguage: 'en', targetLanguage: lang });
      if (av === 'unavailable') return { error: 'unavailable' };
      if (av !== 'available') return { error: 'download' };
      translators.set(lang, await Translator.create({ sourceLanguage: 'en', targetLanguage: lang }));
    }
    return { text: await translators.get(lang).translate(text) };
  } catch (e) {
    return { error: 'download' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'qs-translate' || msg.target !== 'offscreen') return;
  translate(msg.text, msg.lang || 'fr').then(reply);
  return true;
});
