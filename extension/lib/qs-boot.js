// Quikscript Reader: loads the engine data once per page (content script or extension page).
(function (root) {
  'use strict';
  if (root.QSBoot) return;
  const url = p => chrome.runtime.getURL(p);
  const gunzip = r => new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
  function toMap(text) {
    const m = new Map();
    for (const line of text.split('\n')) {
      const t = line.indexOf('\t');
      if (t > 0) m.set(line.slice(0, t), line.slice(t + 1));
    }
    return m;
  }
  let ready = null, ipaReady = null;
  function load() {
    if (!ready) {
      ready = (async () => {
        const [data, tr, nrl, dictText, pens] = await Promise.all([
          fetch(url('data/qs-data.json')).then(r => r.json()),
          fetch(url('data/transformation.json')).then(r => r.json()),
          fetch(url('data/nrl.json')).then(r => r.json()),
          fetch(url('data/dict.txt.gz')).then(gunzip),
          fetch(url('data/pen-paths.json')).then(r => r.json()),
        ]);
        QSSenior.load(data);
        QSSenior.loadPens(pens);
        const dict = toMap(dictText);
        QSCore.init({ transformation: tr, nrl, dict: w => dict.get(w) });
      })();
      ready.catch(() => { ready = null; });
    }
    return ready;
  }
  // the IPA dictionary is only needed for the hover card
  function loadIpa() {
    if (!ipaReady) {
      ipaReady = fetch(url('data/ipa.txt.gz')).then(gunzip).then(t => {
        const m = toMap(t);
        QSCore.setIpaDict(w => m.get(w));
      });
      ipaReady.catch(() => { ipaReady = null; });
    }
    return ipaReady;
  }
  const DEFAULTS = { scale: 1, style: 'senior', hover: true, hoverIpa: true, hoverTr: true, trLang: 'fr', interlinear: false, animate: false, penSpeed: 1 };
  root.QSBoot = { load, loadIpa, DEFAULTS };
})(globalThis);
