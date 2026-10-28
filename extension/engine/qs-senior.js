/*
 * qs-senior.js
 * Senior Quikscript joining engine: picks a shape for every letter of a word so that
 * as many letters as possible join, the way Kingsley Read's Manual writes them, then
 * lays the word out and draws it as SVG.
 *
 * Rules: Abbots Morton Spaceport glyph data (MIT), a transcription of the Manual.
 * Outlines: Abbots Morton Experiment (Apache-2.0).
 * Works in browsers, Chrome extensions and Node (no DOM needed).
 */
(function (root) {
  'use strict';

  const YMAP = { 0: 0, 5: 500, 6: 600, 8: 880, 9: 900 };
  const STROKE = 70;          // AME stroke thickness, also the connector thickness
  const CLEAR_JOIN = 70;      // ink-to-ink clearance next to a join
  const CLEAR_LIFT = 115;     // ink-to-ink clearance where the pen lifts inside a word
  const OVER = 8;             // overlap so joined strokes look continuous
  const BAND = 75;            // slices this close to the join height may touch

  let D = null;
  let CP2FAM = {};
  let LIGS = [];
  let SLICES = [];

  function load(data) {
    D = data;
    CP2FAM = {};
    SLICES = data.slices;
    for (const [fam, f] of Object.entries(data.families)) {
      f.stances.forEach((s, i) => { s.index = i; s.fam = fam; });
      if (f.cp) CP2FAM[f.cp] = fam;
    }
    LIGS = Object.entries(data.families)
      .filter(([, f]) => f.sequence && f.stances.length)
      .map(([fam, f]) => ({ fam, seq: f.sequence }));
    return api;
  }

  // ── selectors ─────────────────────────────────────────────────
  // A ligature counts as its last letter for left-facing lists (who comes before me),
  // as in Spaceport's rebuild design.
  function famIn(list, fam, leftFacing) {
    if (list.includes(fam)) return true;
    if (leftFacing) {
      const seq = D.families[fam] && D.families[fam].sequence;
      if (seq && list.includes(seq[seq.length - 1])) return true;
    }
    return false;
  }
  function stanceIs(st, name) {
    if (st.id === name) return true;
    const t = st.traits || [];
    if (name === 'half') return t.includes('half');
    if (name === 'full') return !t.includes('half');
    if (name === 'flipped' || name === 'alternate' || name === 'alt') return t.includes('alt');
    return false;
  }
  // sel: neighbour selector; k: neighbour index; dir: -1 looking left, +1 looking right
  // cell: the neighbour's cell when known; jn: height of the junction between self and that neighbour
  function selMatch(sel, fams, k, dir, cell, jn) {
    if (!sel) return true;
    if (sel.any) return sel.any.some(s => selMatch(s, fams, k, dir, cell, jn));
    const inRange = k >= 0 && k < fams.length;
    if (sel.is === 'boundary') return !inRange;
    if (sel.joined_at !== undefined) {
      if (sel.joined_at === 'live') { if (jn == null) return false; }
      else if (jn !== sel.joined_at) return false;
    }
    if (!inRange) return !(sel.family || sel.class || sel.then || sel.stance);
    const fam = fams[k];
    const left = dir < 0;
    if (sel.family && !famIn(sel.family, fam, left)) return false;
    if (sel.class && !famIn(D.classes[sel.class] || [], fam, left)) return false;
    if (sel.except && sel.except.some(e => selMatch(e, fams, k, dir, cell, jn))) return false;
    if (sel.then && !selMatch(sel.then, fams, k + dir, dir, undefined, undefined)) return false;
    if (cell) {
      if (sel.stance && !stanceIs(cell.st, sel.stance)) return false;
      if (sel.traits && !sel.traits.every(t => (cell.st.traits || []).includes(t))) return false;
      if (sel.exit_y !== undefined && cell.ex !== sel.exit_y) return false;
      if (sel.entry_y !== undefined && cell.en !== sel.entry_y) return false;
    }
    return true;
  }
  const anyMatch = (list, fams, k, dir, cell, jn) => list.some(s => selMatch(s, fams, k, dir, cell, jn));

  // policy conditions for the letter at i in cell c, with neighbour cells cl / cr when known
  function whenHolds(w, fams, i, c, cl, cr) {
    if (w.self) {
      for (const k of ['entry', 'exit']) {
        if (!(k in w.self)) continue;
        const want = w.self[k], have = k === 'entry' ? c.en : c.ex;
        if (want === 'live') { if (have == null) return false; } else if (have !== want) return false;
      }
    }
    if (w.left && !selMatch(w.left, fams, i - 1, -1, cl, c.en)) return false;
    if (w.right && !selMatch(w.right, fams, i + 1, 1, cr, c.ex)) return false;
    return true;
  }
  function preferSat(p, c) {
    if ('entry' in p.cell && c.en !== p.cell.entry) return false;
    if ('exit' in p.cell && c.ex !== p.cell.exit) return false;
    if (p.stance && !stanceIs(c.st, p.stance)) return false;
    return true;
  }

  // ── cells: one shape plus the height it is joined at on each side (or none) ──
  const cellCache = {};
  function cellsFor(fam) {
    if (cellCache[fam]) return cellCache[fam];
    const f = D.families[fam];
    const out = [];
    if (f) for (const st of f.stances) {
      const ens = [null, ...st.entries.map(e => e.h)];
      const exs = [null, ...st.exits.map(e => e.h)];
      for (const en of ens) for (const ex of exs) {
        if (st.only && !st.only.some(([a, b]) => a === en && b === ex)) continue;
        if (st.never && st.never.some(([a, b]) => a === en && b === ex)) continue;
        if (st.require) {
          if (st.require.includes('entry') && en == null) continue;
          if (st.require.includes('exit') && ex == null) continue;
        }
        const enRow = st.entries.find(e => e.h === en), exRow = st.exits.find(e => e.h === ex);
        out.push({ st, en, ex, from: enRow && enRow.from, toward: exRow && exRow.toward, base: -st.order * 0.01 - (st.approx ? 0.05 : 0) });
      }
    }
    return (cellCache[fam] = out);
  }

  // ── ligatures ─────────────────────────────────────────────────
  function ligate(fams) {
    const out = [];
    for (let i = 0; i < fams.length; i++) {
      const lig = LIGS.find(l => l.seq.every((f, k) => fams[i + k] === f));
      if (lig) { out.push(lig.fam); i += lig.seq.length - 1; } else out.push(fams[i]);
    }
    return out;
  }

  const JOIN = 100, PREFER = 1, ABSOLUTE = 10000;

  // junction between a (at i-1) and b (at i); z is the cell at i-2 (or null)
  // returns -Infinity when impossible, else the score it adds
  function junction(fams, i, z, a, b) {
    const famA = fams[i - 1], famB = fams[i];
    const FA = D.families[famA], FB = D.families[famB];
    // stance-level selection rules (letters without a rune file)
    if (b.st.after && !anyMatch(b.st.after, fams, i - 1, -1, a)) return -Infinity;
    if (b.st.not_after && anyMatch(b.st.not_after, fams, i - 1, -1, a)) return -Infinity;
    if (a.st.before && !anyMatch(a.st.before, fams, i, 1, b)) return -Infinity;
    if (a.st.not_before && anyMatch(a.st.not_before, fams, i, 1, b)) return -Infinity;
    if (a.ex == null && b.en == null) return 0;
    if (a.ex == null || a.ex !== b.en) return -Infinity;
    const h = a.ex;
    // neighbour scopes only name letters that have rune files; others are always welcome
    if (a.toward && FB.rune && !anyMatch(a.toward, fams, i, 1, b, h)) return -Infinity;
    if (b.from && FA.rune && !anyMatch(b.from, fams, i - 1, -1, a, h)) return -Infinity;
    for (const p of FA.refuse || []) {
      const hasEx = 'exit' in p.cell, hasEn = 'entry' in p.cell;
      if (hasEn && !hasEx) continue;
      if (hasEx && p.cell.exit !== h) continue;
      if (p.stance && !stanceIs(a.st, p.stance)) continue;
      if (!hasEx && !hasEn && !p.when.right) continue;
      if (whenHolds(p.when, fams, i - 1, a, z, b)) return -Infinity;
    }
    for (const p of FB.refuse || []) {
      const hasEx = 'exit' in p.cell, hasEn = 'entry' in p.cell;
      if (hasEx && !hasEn) continue;
      if (hasEn && p.cell.entry !== h) continue;
      if (p.stance && !stanceIs(b.st, p.stance)) continue;
      if (!hasEx && !hasEn && !p.when.left) continue;
      if (whenHolds(p.when, fams, i, b, a, undefined)) return -Infinity;
    }
    return JOIN;
  }

  function preferScore(fams, i, c, cl, cr) {
    const F = D.families[fams[i]];
    let s = 0;
    for (const p of F.prefer || []) {
      if (!whenHolds(p.when, fams, i, c, cl, cr)) continue;
      if (preferSat(p, c)) s += p.absolute ? ABSOLUTE : PREFER;
    }
    return s;
  }

  // ── shape choice: second-order Viterbi over cells ─────────────
  function shapeWord(famsIn, opts = {}) {
    let fams = (opts.ligatures === false ? famsIn.slice() : ligate(famsIn)).filter(f => D.families[f]);
    const n = fams.length;
    if (!n) return [];
    const C = fams.map(f => cellsFor(f));
    // state: (index of cell at i-1 or -1, index of cell at i) -> {score, back}
    let layer = new Map();
    C[0].forEach((b, bi) => {
      if (b.en != null) return;
      layer.set(-1 * 1000 + bi, { score: b.base, prev: null, a: -1, b: bi });
    });
    const layers = [layer];
    for (let i = 1; i < n; i++) {
      const next = new Map();
      for (const [, st] of layers[i - 1]) {
        const z = st.a >= 0 ? C[i - 2][st.a] : null;
        const a = C[i - 1][st.b];
        for (let bi = 0; bi < C[i].length; bi++) {
          const b = C[i][bi];
          const j = junction(fams, i, z, a, b);
          if (j === -Infinity) continue;
          // the letter at i-1 now has both neighbours known
          const sc = st.score + j + b.base + preferScore(fams, i - 1, a, z, b);
          const key = st.b * 1000 + bi;
          const cur = next.get(key);
          if (!cur || sc > cur.score) next.set(key, { score: sc, prev: st, a: st.b, b: bi });
        }
      }
      layers.push(next);
      if (!next.size) break;
    }
    let best = null;
    if (layers.length === n) {
      for (const [, st] of layers[n - 1]) {
        const c = C[n - 1][st.b];
        if (c.ex != null) continue;
        const z = st.a >= 0 ? C[n - 2][st.a] : null;
        const sc = st.score + preferScore(fams, n - 1, c, z, null);
        if (!best || sc > best.score) best = { score: sc, st };
      }
    }
    let chosen;
    if (best) {
      chosen = new Array(n);
      for (let i = n - 1, s = best.st; i >= 0; i--, s = s.prev) chosen[i] = C[i][s.b];
    } else {
      // nothing fits the rules: write the letters unjoined
      chosen = fams.map(f => cellsFor(f).find(c => c.en == null && c.ex == null) || cellsFor(f)[0]);
    }
    return chosen.map((c, i) => ({ fam: fams[i], st: c.st, en: c.en, ex: c.ex, join: i < n - 1 && c.ex != null ? c.ex : null }));
  }

  // ── layout ────────────────────────────────────────────────────
  function layout(shaped) {
    const sky = SLICES.map(() => -Infinity);
    const items = [], conns = [];
    let prevX = 0, prevG = null, right = -Infinity, left = Infinity;
    shaped.forEach((s, i) => {
      const g = D.glyphs[s.st.glyph];
      let x;
      if (i === 0) {
        x = -g.bbox[0];
      } else {
        const jh = shaped[i - 1].join;
        let minX = -Infinity;
        g.prof.forEach((p, k) => {
          if (!p || sky[k] === -Infinity) return;
          const y0 = SLICES[k], y1 = y0 + D.slice;
          const nearJoin = jh != null && y1 > jh - BAND && y0 < jh + BAND;
          if (nearJoin) return;
          minX = Math.max(minX, sky[k] + (jh != null ? CLEAR_JOIN : CLEAR_LIFT) - p[0]);
        });
        // never start a letter far to the left of the previous one
        minX = Math.max(minX, prevX + prevG.bbox[0] + (prevG.bbox[2] - prevG.bbox[0]) * 0.35 - g.bbox[0]);
        if (jh != null) {
          const ex = prevX + prevG.bands[jh][1];
          const en = g.bands[jh][0];
          x = Math.max(ex - en - OVER, minX);
          if (x + en > ex - OVER + 1) {
            conns.push({ x1: ex - OVER, x2: x + en + OVER, y: jh });
            items[items.length - 1].conn = conns.length - 1;
          }
        } else {
          x = minX;
        }
      }
      g.prof.forEach((p, k) => { if (p) sky[k] = Math.max(sky[k], x + p[1]); });
      items.push({ glyph: s.st.glyph, x, en: s.en, ex: s.ex });
      left = Math.min(left, x + g.bbox[0]);
      right = Math.max(right, x + g.bbox[2]);
      prevX = x; prevG = g;
    });
    return { items, conns, left: items.length ? left : 0, right: items.length ? right : 0 };
  }

  function layoutJunior(fams) {
    let x = 0; const items = [];
    for (const fam of fams) {
      const f = D.families[fam];
      const name = 'uni' + (f && f.cp);
      const g = D.glyphs[name];
      if (!g) continue;
      items.push({ glyph: name, x });
      x += g.adv;
    }
    return { items, conns: [], left: 0, right: x };
  }

  // ── drawing ───────────────────────────────────────────────────
  const TOP = 1000, BOTTOM = 520, PAD = 40;
  function svg(lay, opts = {}) {
    const dot = !!opts.nameDot;
    const dotW = dot ? 230 : 0;
    const x0 = lay.left - PAD - dotW;
    const w = (lay.right - lay.left) + 2 * PAD + dotW;
    const hEm = opts.heightEm || 1.6;
    const wEm = (w / (TOP + BOTTOM)) * hEm;
    let body = '';
    for (const it of lay.items) body += `<path transform="translate(${r(it.x)} 0)" d="${D.glyphs[it.glyph].d}"/>`;
    for (const c of lay.conns) body += `<rect x="${r(c.x1)}" y="${c.y - STROKE / 2}" width="${r(c.x2 - c.x1)}" height="${STROKE}"/>`;
    if (dot) body += `<circle cx="${r(lay.left - dotW / 2 - 10)}" cy="250" r="45"/>`;
    const fill = opts.color || 'currentColor';
    const va = -(BOTTOM / (TOP + BOTTOM)) * hEm;
    const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x0)} ${-TOP} ${r(w)} ${TOP + BOTTOM}" ` +
      `style="height:${hEm}em;width:${wEm.toFixed(3)}em;vertical-align:${va.toFixed(3)}em;overflow:visible" ` +
      `fill="${fill}" role="img"${opts.label ? ` aria-label="${esc(opts.label)}"` : ''}>${title}<g transform="scale(1,-1)">${body}</g></svg>`;
  }
  // ── writing it out with a pen ──────────────────────────────────
  // Pen paths (tools/pen_paths.py): for each outline, the centre line of the stroke in the
  // order a pen draws it, for each way of entering and leaving the letter.
  let PENS = null;
  function loadPens(p) { PENS = p; return api; }
  function penRoute(glyph, en, ex) {
    const P = PENS && PENS[glyph];
    if (!P) return null;
    const s = en != null ? P.start[en] : undefined;
    const t = ex != null ? P.end[ex] : undefined;
    let key;
    if (s != null) key = (t != null && t !== s) ? `${s}>${t}` : `${s}>*`;
    else if (t != null) {
      const d0 = P.default.split('>')[0];
      key = (d0 !== '*' && +d0 !== t && P.routes[`${d0}>${t}`]) ? `${d0}>${t}` : `*>${t}`;
    } else key = P.default;
    const r = P.routes[key] || P.routes[P.default];
    return r ? { d: r[0], len: r[1] } : null;
  }

  let uid = 0;
  const PEN_W = 104;   // mask stroke: wider than the 70-unit ink so curves are fully covered
  // Same drawing as svg(), with every letter and connector hidden behind a mask that a pen
  // stroke reveals along the letter's centre line. Call play() on the element to write it.
  function svgAnimated(lay, opts = {}) {
    const id = 'qa' + (++uid).toString(36);
    const dot = !!opts.nameDot;
    const dotW = dot ? 230 : 0;
    const x0 = lay.left - PAD - dotW;
    const w = (lay.right - lay.left) + 2 * PAD + dotW;
    const hEm = opts.heightEm || 1.6;
    const wEm = (w / (TOP + BOTTOM)) * hEm;
    let defs = '', body = '', n = 0;
    // route: pen centre line; tr: transform shared by the route and the ink it reveals
    const piece = (route, len, inner, tr) => {
      const mid = `${id}-${n++}`;
      const ta = tr ? ` transform="${tr}"` : '';
      defs += `<mask id="${mid}" maskUnits="userSpaceOnUse" x="-4000" y="-4000" width="12000" height="9000">` +
        `<path class="qs-pen"${ta} d="${route}" data-len="${Math.round(len)}" fill="none" stroke="#fff" stroke-width="${PEN_W}" ` +
        `stroke-linecap="butt" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1"/></mask>`;
      body += `<g mask="url(#${mid})">${inner}</g>`;
    };
    if (dot) body += `<circle class="qs-dot" opacity="0" cx="${r(lay.left - dotW / 2 - 10)}" cy="250" r="45"/>`;
    lay.items.forEach(it => {
      const g = D.glyphs[it.glyph];
      const pr = penRoute(it.glyph, it.en, it.ex);
      const tr = `translate(${r(it.x)} 0)`;
      const ink = `<path${` transform="${tr}"`} d="${g.d}"/>`;
      if (pr) piece(pr.d, pr.len, ink, tr);
      else piece(`M${r(g.bbox[0] - 40)} 250H${r(g.bbox[2] + 40)}`, g.bbox[2] - g.bbox[0], ink, tr);   // no pen data: wipe left to right
      if (it.conn != null) {
        const c = lay.conns[it.conn];
        piece(`M${r(c.x1 - 20)} ${c.y}H${r(c.x2 + 20)}`, c.x2 - c.x1,
          `<rect x="${r(c.x1)}" y="${c.y - STROKE / 2}" width="${r(c.x2 - c.x1)}" height="${STROKE}"/>`, '');
      }
    });
    const fill = opts.color || 'currentColor';
    const va = -(BOTTOM / (TOP + BOTTOM)) * hEm;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="qs-anim" viewBox="${r(x0)} ${-TOP} ${r(w)} ${TOP + BOTTOM}" ` +
      `style="height:${hEm}em;width:${wEm.toFixed(3)}em;vertical-align:${va.toFixed(3)}em;overflow:visible" ` +
      `fill="${fill}" role="img"${opts.label ? ` aria-label="${esc(opts.label)}"` : ''}>` +
      `<defs>${defs}</defs><g transform="scale(1,-1)">${body}</g></svg>`;
  }

  // Write an svgAnimated() element with the pen. speed: font units per second.
  // Returns {done: Promise, setRate(r), finish()}.
  function play(el, opts = {}) {
    const speed = opts.speed || 3200;
    const pens = [...el.querySelectorAll('.qs-pen')];
    const anims = [];
    let t = opts.delay || 0;
    const dot = el.querySelector('.qs-dot');
    if (dot && dot.animate) anims.push(dot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: t, fill: 'both' }));
    for (const p of pens) {
      const len = +p.dataset.len || 300;
      const dur = Math.max(60, (len / speed) * 1000);
      if (p.animate) anims.push(p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: dur, delay: t, fill: 'both', easing: 'linear' }));
      else p.setAttribute('stroke-dashoffset', '0');
      t += dur;
    }
    const total = t;
    const unmask = () => {
      // show the exact outlines once written
      el.querySelectorAll('[mask]').forEach(g => g.removeAttribute('mask'));
      if (dot) dot.setAttribute('opacity', '1');
      el.querySelector('defs') && el.querySelector('defs').remove();
      anims.forEach(a => { try { a.cancel(); } catch (e) {} });
    };
    const done = anims.length
      ? Promise.all(anims.map(a => a.finished)).then(unmask, () => {})
      : Promise.resolve().then(unmask);
    return {
      done, total,
      setRate(rate) { anims.forEach(a => { try { a.playbackRate = rate; } catch (e) {} }); },
      finish() { anims.forEach(a => { try { a.finish(); } catch (e) {} }); },
    };
  }

  function renderWordAnimated(fams, opts = {}) {
    const shaped = shapeWord(fams, opts);
    return svgAnimated(layout(shaped), opts);
  }

  const r = v => Math.round(v * 10) / 10;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // convenience: codepoints (as 'E666' strings or characters) -> families
  function famsFromCodepoints(cps) {
    return cps.map(c => {
      const hex = typeof c === 'number' ? c.toString(16).toUpperCase() : (c.length === 1 ? c.codePointAt(0).toString(16).toUpperCase() : c);
      return CP2FAM[hex];
    }).filter(Boolean);
  }

  function renderWord(fams, opts = {}) {
    if (opts.junior) return svg(layoutJunior(fams), opts);
    const shaped = shapeWord(fams, opts);
    return svg(layout(shaped), opts);
  }

  const api = { load, loadPens, penRoute, shapeWord, layout, layoutJunior, svg, svgAnimated, play, renderWord, renderWordAnimated,
    famsFromCodepoints, get data() { return D; } };
  root.QSSenior = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
