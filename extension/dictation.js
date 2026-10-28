// Quikscript dictation: speak English, watch it written in joined Senior Quikscript, stroke by stroke.
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const paper = $('paper'), scroller = $('scroll'), live = $('live');
  const DEFAULTS = { ...QSBoot.DEFAULTS, dictSize: 46, caption: true };
  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }; } catch (e) {}

  function toast(t, ms = 2200) {
    const el = $('toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), ms);
  }
  const status = t => { $('status').textContent = t; };

  await QSBoot.load();
  QSHover.setSettings(settings);
  QSHover.attach();
  QSBoot.loadIpa();

  // ── guide lines under the writing ─────────────────────────────
  function applySize() {
    document.documentElement.style.setProperty('--size', settings.dictSize + 'px');
    $('size').value = settings.dictSize;
    $('size-v').textContent = settings.dictSize + ' px';
    requestAnimationFrame(alignRules);
  }
  function alignRules() {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    paper.prepend(probe);
    const cs = getComputedStyle(paper);
    const padTop = parseFloat(cs.paddingTop);
    const lh = parseFloat(cs.lineHeight);
    const y = probe.offsetTop - padTop;
    probe.remove();
    paper.style.setProperty('--top', padTop + 'px');
    paper.style.setProperty('--base', ((y % lh) + lh) % lh + 'px');
  }
  addEventListener('resize', () => requestAnimationFrame(alignRules));

  // ── the pen ───────────────────────────────────────────────────
  // Words wait in a queue and are written one after the other. When speech runs ahead,
  // the pen speeds up a little for every word waiting, and slows back down in the pauses.
  const queue = [];
  let writing = null;
  const BASE = 2600;   // font units per second at speed 1
  const rate = () => Math.min(6, 1 + 0.55 * queue.length);
  function bump() { if (writing) writing.setRate(rate()); }
  async function pump() {
    if (pump.busy) return;
    pump.busy = true;
    while (queue.length) {
      const w = queue.shift();
      if (!w.isConnected) continue;
      const svg = w.querySelector('svg.qs-anim');
      if (!svg) continue;
      keepInView(w);
      writing = QSSenior.play(svg, { speed: BASE * settings.penSpeed });
      writing.setRate(rate());
      await writing.done;
      writing = null;
    }
    pump.busy = false;
  }
  function keepInView(el) {
    const r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    if (r.bottom > s.bottom - 40 || r.top < s.top) scroller.scrollTop += r.bottom - s.bottom + s.height * 0.35;
  }

  const parser = new DOMParser();
  function makeWord(word, name, animated) {
    const fams = QSCore.word(word).names.map(n => QSCore.BY_NAME[n].fam);
    const markup = animated
      ? QSSenior.renderWordAnimated(fams, { nameDot: name, heightEm: 1.55 })
      : QSSenior.renderWord(fams, { nameDot: name, heightEm: 1.55 });
    const el = document.createElement('qsr-w');
    el.setAttribute('data-en', word);
    el.setAttribute('aria-label', word);
    el.dataset.key = word + (name ? '·' : '');
    el.appendChild(document.importNode(parser.parseFromString(markup, 'image/svg+xml').documentElement, true));
    return el;
  }

  // ── segments: one per recognition result ──────────────────────
  // Each result keeps the words already drawn; when Chrome revises a word, only that word is rewritten.
  const segs = new Map();   // key -> {el, words: [qsr-w], text, final}
  let lastFinalAt = 0;
  const english = [];       // final English, in order, for copying

  function segFor(key) {
    let s = segs.get(key);
    if (!s) {
      if (lastFinalAt && Date.now() - lastFinalAt > 5000 && paper.lastChild) paper.appendChild(Object.assign(document.createElement('span'), { className: 'para' }));
      const el = document.createElement('span');
      el.className = 'seg';
      paper.appendChild(el);
      s = { el, words: [], text: '', final: false, idx: english.length };
      english.push('');
      segs.set(key, s);
      $('empty').hidden = true;
    }
    return s;
  }

  function updateSegment(key, text, final) {
    const s = segFor(key);
    if (s.final) return;
    s.text = text.trim();
    const toks = QSCore.tokenize(s.text).filter(t => t.word);
    // the last word of an unfinished result is still changing: wait for it
    const stable = final ? toks.length : Math.max(0, toks.length - 1);
    for (let k = 0; k < stable; k++) {
      const want = toks[k].word + (toks[k].name ? '·' : '');
      const old = s.words[k];
      if (old && old.dataset.key === want) continue;
      const el = makeWord(toks[k].word, toks[k].name, true);
      if (old) {
        const waiting = queue.indexOf(old);
        old.replaceWith(el);
        if (waiting >= 0) queue[waiting] = el;
        else QSSenior.play(el.querySelector('svg'), { speed: BASE * 3 });   // already written: quick rewrite
      } else {
        s.el.appendChild(el);
        s.el.appendChild(document.createTextNode(' '));
        queue.push(el);
      }
      s.words[k] = el;
    }
    // Chrome sometimes takes words back
    while (s.words.length > stable && (final || s.words.length > toks.length)) {
      const el = s.words.pop();
      const q = queue.indexOf(el);
      if (q >= 0) queue.splice(q, 1);
      if (el.nextSibling && el.nextSibling.nodeType === 3) el.nextSibling.remove();
      el.remove();
    }
    if (final) { s.final = true; english[s.idx] = s.text; lastFinalAt = Date.now(); }
    bump();
    pump();
  }

  // ── speech ────────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, session = 0;
  function showLive(finalText, heard) {
    if (!settings.caption) return;
    live.innerHTML = '';
    const a = document.createElement('span');
    a.textContent = finalText;
    const b = document.createElement('span');
    b.className = 'heard';
    b.textContent = heard ? ' ' + heard : '';
    live.append(a, b);
  }
  function startRec() {
    if (!SR) { toast("This Chrome has no speech recognition."); return; }
    rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const my = ++session;
    rec.onresult = e => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        updateSegment(`${my}:${i}`, r[0].transcript, r.isFinal);
        if (!r.isFinal) heard += r[0].transcript;
      }
      showLive(english.filter(Boolean).slice(-3).join(' '), heard);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setListening(false);
        toast('Chrome is blocking the microphone. Allow it with the mic icon in the address bar, or in chrome://settings/content/microphone.', 7000);
      } else if (e.error === 'audio-capture') {
        setListening(false);
        toast('No microphone found.', 4000);
      } else if (e.error === 'network') {
        setListening(false);
        toast("Chrome's speech recognition needs an internet connection.", 5000);
      } else {
        status('Microphone: ' + e.error);
      }
    };
    rec.onend = () => { if (listening) setTimeout(() => { if (listening) startRec(); }, 120); };
    try { rec.start(); } catch (e) {}
  }
  // ask for the microphone once, explicitly: extension pages show Chrome's prompt this way
  let micOk = false;
  async function ensureMic() {
    if (micOk || !navigator.mediaDevices) return true;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach(t => t.stop());
      micOk = true;
      return true;
    } catch (e) {
      toast('Chrome is blocking the microphone. Allow it with the mic icon in the address bar, or in chrome://settings/content/microphone.', 7000);
      return false;
    }
  }
  async function setListening(on) {
    if (on && !(await ensureMic())) on = false;
    listening = on;
    $('mic').setAttribute('aria-pressed', String(on));
    $('mic-label').textContent = on ? 'Listening' : 'Listen';
    status(on ? 'Listening. Speak English.' : 'Microphone off.');
    if (on) startRec();
    else if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
  }
  $('mic').addEventListener('click', () => setListening(!listening));
  addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, button')) return;
    if (e.code === 'Space') { e.preventDefault(); setListening(!listening); }
    if (e.key === 'Escape' && listening) setListening(false);
  });

  // typing works too
  let typed = 0;
  $('type').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('type-in').value.trim();
    if (!v) return;
    updateSegment(`t:${++typed}`, v, true);
    showLive(english.filter(Boolean).slice(-3).join(' '), '');
    $('type-in').value = '';
  });

  // ── tools ─────────────────────────────────────────────────────
  $('clear').addEventListener('click', () => {
    queue.length = 0;
    if (writing) writing.finish();
    paper.innerHTML = '';
    segs.clear();
    english.length = 0;
    lastFinalAt = 0;
    live.textContent = '';
    $('empty').hidden = false;
  });
  $('copy').addEventListener('click', async () => {
    const text = english.filter(Boolean).join(' ').trim();
    if (!text) { toast('Nothing to copy yet.'); return; }
    try { await navigator.clipboard.writeText(text); toast('English copied.'); } catch (e) { toast("Couldn't copy."); }
  });
  $('image').addEventListener('click', exportImage);
  $('settings-btn').addEventListener('click', () => {
    const open = $('settings').hidden;
    $('settings').hidden = !open;
    $('settings-btn').setAttribute('aria-expanded', String(open));
  });

  function bindRange(id, key, fmt, after) {
    const el = $(id);
    el.value = settings[key];
    $(id + '-v').textContent = fmt(settings[key]);
    el.addEventListener('input', () => { settings[key] = +el.value; $(id + '-v').textContent = fmt(settings[key]); after && after(); });
    el.addEventListener('change', () => chrome.storage.sync.set({ [key]: settings[key] }));
  }
  bindRange('speed', 'penSpeed', v => '× ' + (+v).toFixed(1));
  bindRange('size', 'dictSize', v => v + ' px', applySize);
  for (const k of ['caption', 'hoverIpa', 'hoverTr', 'hover']) {
    $(k).checked = !!settings[k];
    $(k).addEventListener('change', () => {
      settings[k] = $(k).checked;
      chrome.storage.sync.set({ [k]: settings[k] });
      QSHover.setSettings(settings);
      live.hidden = !settings.caption;
    });
  }
  live.hidden = !settings.caption;
  applySize();

  // translation language and Chrome's on-device model
  QSTranslateUI.fillSelect($('trLang'), settings.trLang);
  $('trLang').addEventListener('change', () => {
    settings.trLang = $('trLang').value;
    chrome.storage.sync.set({ trLang: settings.trLang });
    QSHover.setSettings(settings);
    QSTranslateUI.paintStatus($('tr-status'), settings.trLang);
  });
  QSTranslateUI.paintStatus($('tr-status'), settings.trLang);

  // ── image export: the page as it looks, guide lines included ──
  async function exportImage() {
    const words = [...paper.querySelectorAll('qsr-w')];
    if (!words.length) { toast('Nothing to export yet.'); return; }
    const cs = getComputedStyle(paper);
    const ink = getComputedStyle(document.body).color;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#f5efe2';
    const pr = paper.getBoundingClientRect();
    const scale = 2;
    const W = paper.clientWidth, H = Math.max(...words.map(w => w.getBoundingClientRect().bottom - pr.top)) + 60;
    const c = document.createElement('canvas');
    c.width = W * scale; c.height = H * scale;
    const g = c.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const lh = parseFloat(cs.lineHeight), top = parseFloat(paper.style.getPropertyValue('--top')) || 0;
    const base = parseFloat(paper.style.getPropertyValue('--base')) || 0, xh = settings.dictSize * 0.51;
    const rule = getComputedStyle(document.documentElement).getPropertyValue('--rule').trim();
    for (let y = top; y < H; y += lh) {
      g.fillStyle = rule; g.fillRect(0, y + base - 1, W, 1);
      g.globalAlpha = 0.5; g.fillRect(0, y + base - xh - 1, W, 1); g.globalAlpha = 1;
    }
    for (const w of words) {
      const svg = w.querySelector('svg');
      const r = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', r.width); clone.setAttribute('height', r.height);
      clone.setAttribute('fill', ink);
      clone.removeAttribute('style');
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      await new Promise(res => { const im = new Image(); im.onload = () => { g.drawImage(im, r.left - pr.left, r.top - pr.top, r.width, r.height); URL.revokeObjectURL(url); res(); }; im.onerror = res; im.src = url; });
    }
    c.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'quikscript-dictation.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  // test hook: lets an automated test feed recognition results
  window.__qsDictation = { updateSegment, queueLength: () => queue.length };
  if (!SR) status('This Chrome has no speech recognition. You can type a sentence at the bottom.');
})();
