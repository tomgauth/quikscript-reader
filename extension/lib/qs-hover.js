// Quikscript Reader: the card shown when the mouse rests on a Quikscript word.
// It shows the American IPA, a translation (Chrome's on-device translator) and the English word.
(function (root) {
  'use strict';
  if (root.QSHover) return;

  let settings = { hover: true, hoverIpa: true, hoverTr: true, trLang: 'fr' };
  let host = null, card = null, cur = null, showTimer = null, token = 0;
  const memo = new Map();
  const translators = new Map();   // target language -> Translator
  let trProblem = null;   // 'download' | 'unavailable' | null

  // ── translation ──────────────────────────────────────────────
  async function translateHere(text, lang) {
    if (typeof Translator === 'undefined') return { error: 'no-api' };
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
  async function translate(word, lang = settings.trLang || 'fr') {
    const key = lang + ':' + word.toLowerCase();
    if (memo.has(key)) return memo.get(key);
    const p = (async () => {
      const sk = 'tr:' + key;
      try { const got = await chrome.storage.local.get(sk); if (got[sk]) return { text: got[sk] }; } catch (e) {}
      let r = await translateHere(word, lang);
      if (r.error === 'no-api') {
        // content scripts may not see the API: ask the extension's own page to translate
        try { r = (await chrome.runtime.sendMessage({ type: 'qs-translate', text: word, lang })) || { error: 'unavailable' }; }
        catch (e) { r = { error: 'unavailable' }; }
      }
      if (r.text) { try { await chrome.storage.local.set({ [sk]: r.text }); } catch (e) {} }
      return r;
    })();
    memo.set(key, p);
    const r = await p;
    if (!r.text) memo.delete(key);
    trProblem = r.error || null;
    return r;
  }

  // ── the card ─────────────────────────────────────────────────
  function ensureCard() {
    if (host && host.isConnected) return;
    host = document.createElement('qsr-tip');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>
      .c { position: fixed; min-width: 90px; max-width: 280px; padding: 8px 12px 9px; border-radius: 10px;
        background: #1f2a3a; color: #f4efe4; box-shadow: 0 6px 20px rgba(0,0,0,.28);
        font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center;
        opacity: 0; transform: translateY(3px); transition: opacity .12s, transform .12s; }
      .c.on { opacity: 1; transform: none; }
      .ipa { font: 20px/1.25 "Charis SIL", "Doulos SIL", "Gentium Plus", "Lucida Grande", "Times New Roman", serif; letter-spacing: .01em; }
      .tr { margin-top: 3px; font-size: 14px; color: #ffd9a8; }
      .tr.wait { color: #9aa6b8; }
      .tr.err { color: #9aa6b8; font-size: 11.5px; }
      .en { margin-top: 4px; font-size: 11.5px; color: #9aa6b8; letter-spacing: .02em; }
      .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: #33445e; color: #c9d5e6; font-size: 10.5px; }
      [hidden] { display: none; }
    </style><div class="c" role="tooltip"><div class="ipa"></div><div class="tr"></div><div class="en"></div></div>`;
    card = sh.querySelector('.c');
    (document.body || document.documentElement).appendChild(host);
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = r.left + r.width / 2 - cw / 2;
    x = Math.max(8, Math.min(x, innerWidth - cw - 8));
    let y = r.top - ch - 8;
    if (y < 8) y = r.bottom + 8;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  async function show(el) {
    const word = el.getAttribute('data-en');
    if (!word) return;
    const my = ++token;
    ensureCard();
    const ipaEl = card.querySelector('.ipa'), trEl = card.querySelector('.tr'), enEl = card.querySelector('.en');
    ipaEl.hidden = !settings.hoverIpa;
    trEl.hidden = !settings.hoverTr;
    // Senior abbreviations (the, of, and…) are written shorter than they sound: say so
    const abbr = typeof QSCore !== 'undefined' && QSCore.isAbbr && QSCore.isAbbr(word);
    enEl.textContent = settings.hover ? word : '';
    if (abbr) enEl.appendChild(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'Senior shortcut' }));
    enEl.hidden = !(settings.hover || abbr);
    ipaEl.textContent = settings.hoverIpa ? '…' : '';
    trEl.className = 'tr wait';
    trEl.textContent = settings.hoverTr ? '…' : '';
    place(el);
    card.classList.add('on');
    if (settings.hoverIpa) {
      try { await QSBoot.loadIpa(); } catch (e) {}
      if (my !== token) return;
      const r = QSCore.ipa(word);
      ipaEl.textContent = r.ipa ? `/${r.ipa}/` : '';
      ipaEl.title = r.source === 'guess' ? 'Guessed pronunciation (word not in the dictionary)' : '';
      if (r.source === 'guess') ipaEl.textContent = '~ ' + ipaEl.textContent;
      place(el);
    }
    if (settings.hoverTr) {
      const r = await translate(word);
      if (my !== token) return;
      if (r.text) { trEl.className = 'tr'; trEl.textContent = r.text; }
      else {
        trEl.className = 'tr err';
        trEl.textContent = r.error === 'download'
          ? 'Translation: download the language once from the extension button'
          : 'Translation not available in this Chrome';
      }
      place(el);
    }
  }

  function hide() {
    token++;
    clearTimeout(showTimer);
    if (card) card.classList.remove('on');
  }

  function onOver(e) {
    if (!(settings.hover || settings.hoverIpa || settings.hoverTr)) return;
    const w = e.target && e.target.closest ? e.target.closest('qsr-w') : null;
    if (w === cur) return;
    cur = w;
    hide();
    if (w) showTimer = setTimeout(() => { if (cur === w) show(w); }, 140);
  }

  let attached = false;
  function attach() {
    if (attached) return;
    attached = true;
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
  }
  function detach() {
    attached = false;
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    hide();
    cur = null;
    if (host) host.remove();
    host = null;
  }
  function setSettings(s) { settings = { ...settings, ...s }; }

  root.QSHover = { attach, detach, setSettings, translate, get problem() { return trProblem; } };
})(globalThis);
