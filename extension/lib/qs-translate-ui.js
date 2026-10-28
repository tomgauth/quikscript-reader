// Quikscript Reader: shared bits for the translation settings (popup and dictation page).
(function (root) {
  'use strict';
  if (root.QSTranslateUI) return;
  const LANGS = [
    ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'],
    ['ru', 'Russian'], ['tr', 'Turkish'], ['hu', 'Hungarian'], ['pl', 'Polish'], ['nl', 'Dutch'],
  ];
  const name = code => (LANGS.find(l => l[0] === code) || [code, code])[1];

  function fillSelect(sel, value) {
    sel.innerHTML = '';
    for (const [code, label] of LANGS) sel.appendChild(new Option(label, code, false, code === value));
  }

  // Chrome's on-device translator: each language model downloads once, after a click.
  async function paintStatus(box, lang) {
    box.className = box.className.replace(/\bok\b/g, '').trim();
    box.textContent = '';
    if (typeof Translator === 'undefined') {
      box.textContent = 'Translation needs Chrome 138 or later, on desktop.';
      return;
    }
    let av = 'unavailable';
    try { av = await Translator.availability({ sourceLanguage: 'en', targetLanguage: lang }); } catch (e) {}
    if (av === 'available') { box.classList.add('ok'); box.textContent = `${name(lang)} translation ready (runs on your computer).`; return; }
    if (av === 'unavailable') { box.textContent = `Chrome can't translate English to ${name(lang)} here.`; return; }
    box.append(av === 'downloading' ? `${name(lang)} model downloading… ` : `Translation needs Chrome's ${name(lang)} model. `);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'small';
    b.textContent = av === 'downloading' ? 'Check' : 'Download';
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Downloading…';
      try {
        const t = await Translator.create({
          sourceLanguage: 'en', targetLanguage: lang,
          monitor(m) { m.addEventListener('downloadprogress', e => { b.textContent = Math.round(e.loaded * 100) + '%'; }); },
        });
        await t.translate('hello');
      } catch (e) {}
      paintStatus(box, lang);
    });
    box.append(b);
  }

  root.QSTranslateUI = { LANGS, name, fillSelect, paintStatus };
})(globalThis);
