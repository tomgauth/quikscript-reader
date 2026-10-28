const DEFAULTS = { scale: 1, style: 'senior', hover: true, hoverIpa: true, hoverTr: true, trLang: 'fr', interlinear: false, animate: false, penSpeed: 1 };
const $ = id => document.getElementById(id);

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

function paintToggle(on) {
  const b = $('toggle');
  b.classList.toggle('on', on);
  b.textContent = on ? 'Back to English' : 'Switch page to Quikscript';
}

async function init() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $('scale').value = s.scale;
  $('scale-v').textContent = Math.round(s.scale * 100) + '%';
  for (const k of ['hover', 'hoverIpa', 'hoverTr', 'interlinear', 'animate']) {
    $(k).checked = !!s[k];
    $(k).addEventListener('change', () => chrome.storage.sync.set({ [k]: $(k).checked }));
  }
  QSTranslateUI.fillSelect($('trLang'), s.trLang);
  $('trLang').addEventListener('change', () => {
    chrome.storage.sync.set({ trLang: $('trLang').value });
    QSTranslateUI.paintStatus($('tr-status'), $('trLang').value);
  });
  $('st-senior').setAttribute('aria-pressed', s.style === 'senior');
  $('st-junior').setAttribute('aria-pressed', s.style === 'junior');

  const tab = await activeTab();
  const state = tab ? await chrome.runtime.sendMessage({ type: 'qs-popup-state', tabId: tab.id }) : { unavailable: true };
  if (state && state.unavailable) {
    $('toggle').disabled = true;
    $('note').hidden = false;
    $('note').textContent = "Chrome doesn't let extensions change this page (chrome:// pages, the Web Store, PDFs).";
  }
  paintToggle(!!(state && state.on));

  $('toggle').addEventListener('click', async () => {
    $('toggle').disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'qs-popup-toggle', tabId: tab.id });
    $('toggle').disabled = false;
    paintToggle(!!(res && res.on));
    if (res && res.error) { $('note').hidden = false; $('note').textContent = 'Not possible on this page: ' + res.error; }
  });
  $('dictation').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'qs-open-dictation' });
    window.close();
  });

  $('scale').addEventListener('input', () => { $('scale-v').textContent = Math.round($('scale').value * 100) + '%'; });
  $('scale').addEventListener('change', () => chrome.storage.sync.set({ scale: +$('scale').value }));
  for (const style of ['senior', 'junior']) {
    $('st-' + style).addEventListener('click', () => {
      $('st-senior').setAttribute('aria-pressed', style === 'senior');
      $('st-junior').setAttribute('aria-pressed', style === 'junior');
      chrome.storage.sync.set({ style });
    });
  }
  QSTranslateUI.paintStatus($('tr-status'), s.trLang);
}
init();
