/*
 * qs-core.js
 * English (American) -> Quikscript letters.
 *  1. Senior word replacements from the Manual (the, of, and…)
 *  2. CMU Pronouncing Dictionary, pre-converted to Quikscript at build time
 *  3. NRL letter-to-sound rules for words the dictionary does not know
 * ARPABET -> Quikscript conversion rules come from the Transcriber (transformation.json).
 */
(function (root) {
  'use strict';

  // One storage character per letter (order = Quikscript codepoint order).
  const LETTERS = [
    ['pea', 'qsPea', 'E650'], ['bay', 'qsBay', 'E651'], ['tea', 'qsTea', 'E652'], ['day', 'qsDay', 'E653'],
    ['key', 'qsKey', 'E654'], ['gay', 'qsGay', 'E655'], ['thaw', 'qsThaw', 'E656'], ['they', 'qsThey', 'E657'],
    ['fee', 'qsFee', 'E658'], ['vie', 'qsVie', 'E659'], ['see', 'qsSee', 'E65A'], ['zoo', 'qsZoo', 'E65B'],
    ['she', 'qsShe', 'E65C'], ["j'ai", 'qsJai', 'E65D'], ['cheer', 'qsCheer', 'E65E'], ['jay', 'qsJay', 'E65F'],
    ['ye', 'qsYe', 'E660'], ['way', 'qsWay', 'E661'], ['he', 'qsHe', 'E662'], ['why', 'qsWhy', 'E663'],
    ['ing', 'qsIng', 'E664'], ['may', 'qsMay', 'E665'], ['no', 'qsNo', 'E666'], ['low', 'qsLow', 'E667'],
    ['roe', 'qsRoe', 'E668'], ['loch', 'qsLoch', 'E669'], ['llan', 'qsLlan', 'E66A'], ['excite', 'qsExcite', 'E66B'],
    ['exam', 'qsExam', 'E66C'], ['it', 'qsIt', 'E670'], ['eat', 'qsEat', 'E671'], ['et', 'qsEt', 'E672'],
    ['eight', 'qsEight', 'E673'], ['at', 'qsAt', 'E674'], ['i', 'qsI', 'E675'], ['ah', 'qsAh', 'E676'],
    ['awe', 'qsAwe', 'E677'], ['ox', 'qsOx', 'E678'], ['oy', 'qsOy', 'E679'], ['utter', 'qsUtter', 'E67A'],
    ['out', 'qsOut', 'E67B'], ['owe', 'qsOwe', 'E67C'], ['foot', 'qsFoot', 'E67D'], ['ooze', 'qsOoze', 'E67E'],
  ];
  const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr';
  const BY_NAME = {}, BY_CODE = {}, BY_FAM = {};
  LETTERS.forEach(([name, fam, cp], i) => {
    const e = { name, fam, cp, code: CODES[i], ch: String.fromCodePoint(parseInt(cp, 16)) };
    BY_NAME[name] = e; BY_CODE[CODES[i]] = e; BY_FAM[fam] = e;
  });

  let RULES = [], WORDS = {}, NRL = null, DICT = null;

  function init({ transformation, nrl, dict }) {
    if (transformation) {
      RULES = transformation.regexReplace.map(([pat, rep, kind, cond]) => {
        let re;
        if (kind === 'suffix') re = new RegExp('(?<=^| )' + pat + '$');
        else if (kind === 'prefix') re = new RegExp('^' + pat + '(?= |$)');
        else if (kind === 'plain') re = new RegExp('(?<=^| )' + pat + '(?= |$)', 'g');
        else if (kind === 'g') re = new RegExp(pat, 'g');
        else re = new RegExp(pat);
        return { re, rep, cond: cond ? new RegExp(cond) : null };
      });
      WORDS = {};
      for (const [w, opts] of transformation.wordReplace) WORDS[w] = opts[0].split(' ');
    }
    if (nrl) NRL = compileNRL(nrl);
    if (dict) DICT = dict;
    return api;
  }

  // ARPABET string + spelling -> letter names
  function fromArpabet(arpa, spelling) {
    let s = arpa.trim().replace(/\s+/g, ' ');
    const w = (spelling || '').toLowerCase();
    for (const r of RULES) {
      if (r.cond && !r.cond.test(w)) continue;
      s = s.replace(r.re, r.rep);
    }
    return s.split(' ').filter(t => BY_NAME[t]);
  }

  // ── NRL letter-to-sound rules ──────────────────────────────────
  function compileNRL(nrl) {
    const cls = nrl.classes;
    const conv = ctx => ctx.split('').map(ch => {
      if (cls[ch]) return cls[ch];
      if (/[A-Z']/.test(ch)) return ch;
      if (ch === ' ') return ' ';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const groups = {};
    for (const [g, rules] of Object.entries(nrl.groups)) {
      groups[g] = rules.map(r => {
        const m = r.match(/^(.*)\[(.*)\](.*)=\/(.*)\/$/);
        if (!m) return null;
        return { left: new RegExp(conv(m[1]) + '$'), match: m[2], right: new RegExp('^' + conv(m[3])), out: m[4].trim() };
      }).filter(Boolean);
    }
    return groups;
  }
  const NRL_MAP = { AX: 'AH0', NX: 'NG', WH: 'HH W', IX: 'IH0', AXR: 'ER0', UX: 'UW' };
  function lts(word) {
    if (!NRL) return '';
    const W = ' ' + word.toUpperCase().replace(/[^A-Z']/g, '') + ' ';
    const out = [];
    let i = 1;
    while (i < W.length - 1) {
      const ch = W[i];
      const group = NRL[ch] || NRL.PUNCT || [];
      let hit = null;
      for (const r of group) {
        if (!W.startsWith(r.match, i)) continue;
        if (!r.left.test(W.slice(0, i))) continue;
        if (!r.right.test(W.slice(i + r.match.length))) continue;
        hit = r; break;
      }
      if (hit) { if (hit.out && !hit.out.startsWith('<')) out.push(hit.out); i += Math.max(1, hit.match.length); }
      else i++;
    }
    return out.join(' ').split(/\s+/).filter(Boolean).map(t => NRL_MAP[t] || t).join(' ');
  }

  // ── words ─────────────────────────────────────────────────────
  const decode = codes => [...codes].map(c => BY_CODE[c]).filter(Boolean).map(e => e.name);
  const encode = names => names.map(n => BY_NAME[n] ? BY_NAME[n].code : '').join('');

  // returns {names:[...], source}
  function word(raw, opts = {}) {
    const w = raw.toLowerCase().replace(/[’‘]/g, "'");
    if (opts.senior !== false && WORDS[w]) return { names: WORDS[w], source: 'abbr' };
    if (DICT) {
      const hit = DICT(w);
      if (hit) return { names: decode(hit), source: 'dict' };
      // possessive or contraction the dictionary lacks
      const m = w.match(/^(.+?)'(s|d|ll|re|ve)$/);
      if (m) {
        const base = word(m[1], { senior: false });
        if (base.names.length) {
          const last = base.names[base.names.length - 1];
          const sib = ['see', 'zoo', 'she', "j'ai", 'cheer', 'jay'].includes(last);
          const unv = ['pea', 'tea', 'key', 'fee', 'thaw'].includes(last);
          const tail = { s: sib ? ['it', 'zoo'] : unv ? ['see'] : ['zoo'], d: ['day'], ll: ['low'], re: ['roe'], ve: ['vie'] }[m[2]];
          return { names: base.names.concat(tail), source: base.source };
        }
      }
    }
    const arpa = lts(w);
    return { names: fromArpabet(arpa, w), source: 'guess' };
  }

  // Split running text into words and other runs.
  // A word gets a namer dot when it is capitalised mid-sentence (Quikscript has no capitals).
  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  function tokenize(text) {
    const out = [];
    let last = 0, m, sentenceStart = true;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) {
      if (m.index > last) {
        const gap = text.slice(last, m.index);
        out.push({ text: gap });
        if (/[.!?:]\s*$|^\s*\n/.test(gap) || /[.!?]["'”’)]*\s*$/.test(gap)) sentenceStart = true;
      }
      const t = m[0];
      const cap = /^[A-Z]/.test(t) && !/^[A-Z]+$/.test(t.length > 1 ? t : 'x');
      out.push({ word: t, name: cap && !sentenceStart && t !== 'I' });
      sentenceStart = false;
      last = m.index + t.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    // Title Case runs (headings, menus): capitals say nothing about names there
    const ws = out.filter(t => t.word);
    const caps = ws.filter(t => /^[A-Z]/.test(t.word)).length;
    if ((ws.length >= 3 && caps / ws.length >= 0.7) || (ws.length === 2 && caps === 2 && !/[.!?,;:]/.test(text))) ws.forEach(t => { t.name = false; });
    return out;
  }

  // ── IPA (American) from ARPABET, with stress marks placed before the syllable ──
  const IPA_V = { AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u' };
  const IPA_C = { B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ',
    S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ' };
  const ONSETS = new Set(('p b t d k g f v θ ð s z ʃ ʒ h tʃ dʒ m n l ɹ w j pl bl kl ɡl fl sl pɹ bɹ tɹ dɹ kɹ ɡɹ fɹ θɹ ʃɹ ' +
    'tw dw kw ɡw sw θw pj bj kj ɡj mj fj vj hj sp st sk sm sn sf spl spɹ stɹ skɹ skw spj skj').split(' '));
  function arpaToIpa(arpa) {
    const ph = arpa.trim().split(/\s+/).map(t => NRL_MAP[t] || t).join(' ').split(/\s+/).filter(Boolean);
    const segs = ph.map(t => {
      const m = t.match(/^([A-Z]+)([012])?$/);
      if (!m) return null;
      if (IPA_V[m[1]]) {
        const st = m[2] == null ? null : +m[2];
        let v = IPA_V[m[1]];
        if (st === 0 && m[1] === 'AH') v = 'ə';
        if (st === 0 && m[1] === 'ER') v = 'ɚ';
        return { v, st };
      }
      return IPA_C[m[1]] ? { c: IPA_C[m[1]] } : null;
    }).filter(Boolean);
    const vowels = segs.filter(x => x.v).length;
    let out = '', pend = [];
    for (const x of segs) {
      if (x.c) { pend.push(x.c); continue; }
      let mark = '';
      if (vowels > 1 && x.st === 1) mark = 'ˈ';
      else if (vowels > 1 && x.st === 2) mark = 'ˌ';
      if (mark) {
        // maximal legal onset goes after the stress mark
        let k = pend.length;
        while (k > 0 && ONSETS.has(pend.slice(k - 1).join(''))) k--;
        if (!out && k > 0) k = 0;   // word-initial cluster stays together
        out += pend.slice(0, k).join('') + mark + pend.slice(k).join('');
      } else out += pend.join('');
      out += x.v; pend = [];
    }
    return out + pend.join('');
  }
  // IPA for a word: lookup (word -> ipa) from the IPA dictionary, else letter-to-sound rules
  let IPA_DICT = null;
  function ipa(raw) {
    const w = raw.toLowerCase().replace(/[’‘]/g, "'");
    if (IPA_DICT) {
      const hit = IPA_DICT(w);
      if (hit) return { ipa: hit, source: 'dict' };
    }
    return { ipa: arpaToIpa(lts(w)), source: 'guess' };
  }
  function setIpaDict(fn) { IPA_DICT = fn; }
  const isAbbr = raw => !!WORDS[raw.toLowerCase().replace(/[’‘]/g, "'")];

  const api = { init, fromArpabet, lts, word, tokenize, decode, encode, arpaToIpa, ipa, setIpaDict, isAbbr,
    LETTERS, BY_NAME, BY_FAM, CODES };
  root.QSCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
