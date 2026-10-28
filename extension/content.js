// Quikscript Reader content script: swaps English words for joined Quikscript and back.
(() => {
  if (window.__qsReader) return;
  const R = (window.__qsReader = { on: false });

  const DEFAULTS = QSBoot.DEFAULTS;
  const SKIP = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,canvas,iframe,object,title,[contenteditable=""],[contenteditable="true"],qsr-run,qsr-w,qsr-tip';
  let settings = { ...DEFAULTS };
  let observer = null;
  const runs = new Set();
  const svgCache = new Map();
  let queue = [];
  let qi = 0;
  let scheduled = false;

  async function readSettings() {
    try { settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }; } catch (e) { settings = { ...DEFAULTS }; }
    QSHover.setSettings(settings);
  }

  // ── style ───────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('qsr-style')) return;
    const s = document.createElement('style');
    s.id = 'qsr-style';
    s.textContent = `
      qsr-w { display: inline-block; white-space: nowrap; line-height: 1; position: relative; }
      qsr-w > svg { display: inline-block; }
      html.qsr-interlinear qsr-w { margin-top: 0.9em; min-width: calc(var(--qsr-n, 4) * 0.3em + 0.15em); text-align: center; }
      html.qsr-interlinear qsr-w::before {
        content: attr(data-en); position: absolute; left: 50%; transform: translateX(-50%);
        top: -1.15em; font: 400 0.52em/1 system-ui, -apple-system, sans-serif; opacity: .6; white-space: nowrap; pointer-events: none;
      }
      #qsr-toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; padding: 7px 12px; border-radius: 999px;
        background: #1f2a3a; color: #fff; font: 500 13px/1.2 system-ui, -apple-system, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25);
        opacity: 0; transition: opacity .2s; pointer-events: none; }
      #qsr-toast.show { opacity: 1; }`;
    (document.head || document.documentElement).appendChild(s);
  }

  function toast(text, ms = 1600) {
    let t = document.getElementById('qsr-toast');
    if (!t) { t = document.createElement('div'); t.id = 'qsr-toast'; document.documentElement.appendChild(t); }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    if (ms) toast.timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ── words ───────────────────────────────────────────────────
  const parser = new DOMParser();
  const toNode = markup => document.importNode(parser.parseFromString(markup, 'image/svg+xml').documentElement, true);
  function famsOf(word) {
    return QSCore.word(word).names.map(n => QSCore.BY_NAME[n].fam);
  }
  function svgFor(word, name) {
    const key = word.toLowerCase() + (name ? '·' : '');
    let el = svgCache.get(key);
    if (!el) {
      el = toNode(QSSenior.renderWord(famsOf(word), {
        junior: settings.style === 'junior', nameDot: name, heightEm: 1.55 * settings.scale,
      }));
      el.setAttribute('aria-hidden', 'true');
      svgCache.set(key, el);
    }
    return el.cloneNode(true);
  }
  function animatedSvgFor(word, name) {
    const el = toNode(QSSenior.renderWordAnimated(famsOf(word), { nameDot: name, heightEm: 1.55 * settings.scale }));
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function wordEl(word, name, animated) {
    const el = document.createElement('qsr-w');
    el.appendChild(animated ? animatedSvgFor(word, name) : svgFor(word, name));
    el.setAttribute('data-en', word);
    el.setAttribute('aria-label', word);
    el.style.setProperty('--qsr-n', String(word.length));
    return el;
  }

  function onScreen(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > -50 && r.top < innerHeight + 50 && r.width > 0;
  }

  let wave = 0;   // words being written right now on the page, to stagger them
  function convert(node) {
    if (!node.isConnected || !node.parentNode) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const text = node.nodeValue;
    if (!/[A-Za-z]/.test(text)) return;
    const animate = settings.animate && settings.style !== 'junior' && onScreen(parent);
    const frag = document.createDocumentFragment();
    const fresh = [];
    for (const t of QSCore.tokenize(text)) {
      if (t.text != null) frag.appendChild(document.createTextNode(t.text));
      else {
        const el = wordEl(t.word, t.name, animate);
        if (animate) fresh.push(el);
        frag.appendChild(el);
      }
    }
    const wrap = document.createElement('qsr-run');
    wrap.appendChild(frag);
    wrap.__qsOrig = node;
    node.parentNode.replaceChild(wrap, node);
    runs.add(wrap);
    // the pen writes the visible words in a wave, a little after one another
    fresh.forEach(el => {
      const delay = Math.min(wave, 60) * 90;
      wave++;
      QSSenior.play(el.firstElementChild, { speed: 7000 * settings.penSpeed, delay }).done.then(() => { wave = Math.max(0, wave - 1); });
    });
  }

  function collect(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { queue.push(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.closest(SKIP)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (/[A-Za-z]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let n;
    while ((n = walker.nextNode())) queue.push(n);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(pump);
  }
  function pump() {
    scheduled = false;
    if (!R.on) { queue = []; qi = 0; return; }
    const t0 = performance.now();
    while (qi < queue.length && performance.now() - t0 < 12) convert(queue[qi++]);
    if (qi < queue.length) schedule(); else { queue = []; qi = 0; }
  }

  function observe() {
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') {
          if (m.target.parentElement && !m.target.parentElement.closest('qsr-run')) queue.push(m.target);
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'QSR-RUN' || n.tagName === 'QSR-W' || n.tagName === 'QSR-TIP' || n.id === 'qsr-toast' || n.id === 'qsr-style')) continue;
          collect(n);
        }
      }
      if (qi < queue.length) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ── on / off ────────────────────────────────────────────────
  async function enable() {
    if (R.on) return;
    toast('Quikscript…', 0);
    await QSBoot.load();
    await readSettings();
    injectStyle();
    document.documentElement.classList.toggle('qsr-interlinear', !!settings.interlinear);
    R.on = true;
    wave = 0;
    collect(document.body);
    schedule();
    observe();
    QSHover.attach();
    toast('Quikscript (Alt+Q to switch back)');
  }

  function disable() {
    if (!R.on) return;
    R.on = false;
    if (observer) observer.disconnect();
    observer = null;
    queue = []; qi = 0;
    for (const w of runs) if (w.isConnected && w.__qsOrig) w.replaceWith(w.__qsOrig);
    runs.clear();
    document.documentElement.classList.remove('qsr-interlinear');
    QSHover.detach();
    toast('English');
  }

  async function rerender() {
    if (!R.on) return;
    disable();
    svgCache.clear();
    await enable();
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'qs-toggle') return;
    (async () => {
      const want = msg.force != null ? msg.force : !R.on;
      try { if (want) await enable(); else disable(); } catch (e) { toast('Quikscript: something went wrong, see the console'); console.error('[Quikscript Reader]', e); }
      reply({ on: R.on });
    })();
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const keys = Object.keys(changes).filter(k => k in DEFAULTS);
    if (!keys.length) return;
    // hover settings only change the card; anything else redraws the page
    if (keys.every(k => k === 'hover' || k === 'hoverIpa' || k === 'hoverTr' || k === 'trLang')) {
      for (const k of keys) settings[k] = changes[k].newValue;
      QSHover.setSettings(settings);
      return;
    }
    rerender();
  });
})();
