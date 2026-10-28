// Quikscript Reader: injects the engine into the current tab on demand and toggles it,
// opens the dictation page, and translates words for pages that cannot reach Chrome's translator.
const FILES = ['engine/qs-core.js', 'engine/qs-senior.js', 'lib/qs-boot.js', 'lib/qs-hover.js', 'content.js'];

async function ensureInjected(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!window.__qsReader,
  }).catch(() => [{}]);
  if (!result) await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
}

async function toggle(tabId, force) {
  try {
    await ensureInjected(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { type: 'qs-toggle', force });
    await chrome.action.setBadgeText({ tabId, text: res && res.on ? 'QS' : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#3b5b8c' });
    return res;
  } catch (e) {
    // chrome:// pages, the Web Store and PDFs cannot be scripted
    return { on: false, error: String(e && e.message || e) };
  }
}

async function openDictation() {
  const url = chrome.runtime.getURL('dictation.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ── translation through an offscreen page (content scripts may not see the Translator API) ──
let offscreenReady = null;
async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('no offscreen');
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const has = chrome.runtime.getContexts
        ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0
        : false;
      if (!has) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_PARSER'],
          justification: "Translate single words with Chrome's on-device translator for the hover card.",
        });
      }
    })();
    offscreenReady.catch(() => { offscreenReady = null; });
  }
  return offscreenReady;
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-dictation') { openDictation(); return; }
  if (command !== 'toggle-quikscript') return;
  const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (t) toggle(t.id);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === 'qs-popup-toggle') {
    toggle(msg.tabId, msg.force).then(reply);
    return true;
  }
  if (msg.type === 'qs-popup-state') {
    chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: () => !!(window.__qsReader && window.__qsReader.on) })
      .then(([r]) => reply({ on: !!(r && r.result) }))
      .catch(() => reply({ on: false, unavailable: true }));
    return true;
  }
  if (msg.type === 'qs-open-dictation') {
    openDictation().then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === 'qs-translate' && !msg.target) {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ type: 'qs-translate', target: 'offscreen', text: msg.text, lang: msg.lang }))
      .then(r => reply(r || { error: 'unavailable' }))
      .catch(() => reply({ error: 'unavailable' }));
    return true;
  }
});
