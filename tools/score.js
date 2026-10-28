// Score the engine against the Manual test corpus.
// node score.js data.json expect.json [--fails N] [--filter Fam]
const fs = require('fs');
const QS = require('../extension/engine/qs-senior.js');
QS.load(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const args = process.argv.slice(4);
const showFails = args.includes('--fails') ? +args[args.indexOf('--fails') + 1] : 0;
const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;

const H = { x: 500, b: 0, t: 880, '6': 600 };

function tokenize(s) {
  const toks = [];
  const re = /\s*(~[xbt6]~|\|\?\||\||\?|\\\S|◊\w+|·[^\s~|?]+)/gu;
  let m;
  while ((m = re.exec(s))) toks.push(m[1]);
  return toks;
}

function parseLetter(t) {
  // ·Day+Utter.half  ·-ing  ·No.alt  ·Day+?Utter
  let body = t.slice(1);
  const parts = body.split('.');
  const namePart = parts[0];
  const mods = parts.slice(1);
  const names = namePart.split(/\+\??\|?/);
  const maybeLig = /\+[?|]/.test(namePart);
  const fams = names.map(n => n === '-ing' ? 'qsIng' : 'qs' + n.replace(/'/g, ''));
  return { fams, mods, lig: names.length > 1, maybeLig };
}

function words(expect) {
  const toks = tokenize(expect);
  const out = [];
  let cur = null, pendingRel = null;
  const flush = () => { if (cur && cur.letters.length) out.push(cur); cur = null; };
  for (const t of toks) {
    if (t.startsWith('\\') || t.startsWith('◊')) { flush(); pendingRel = null; continue; }
    if (t.startsWith('·')) {
      const L = parseLetter(t);
      if (!cur) cur = { letters: [], rels: [] };
      else cur.rels.push(pendingRel || 'join');
      cur.letters.push(L);
      pendingRel = null;
      continue;
    }
    if (!cur) continue;
    pendingRel = { '~x~': 'x', '~b~': 'b', '~t~': 't', '~6~': '6', '|': 'break', '|?|': 'break', '?': 'maybe' }[t];
  }
  flush();
  return out;
}

let relTotal = 0, relOk = 0, varTotal = 0, varOk = 0, wordTotal = 0, wordOk = 0, ligTotal = 0, ligOk = 0;
const fails = [];
const famErr = {};
for (const c of cases) {
  for (const w of words(c.expect)) {
    const fams = w.letters.flatMap(l => l.fams);
    if (filter && !fams.includes(filter)) continue;
    if (fams.some(f => !QS.data.families[f])) continue;
    const shaped = QS.shapeWord(fams);
    // expand shaped back to letter tokens
    const out = []; // per token: {st, joinAfter}
    let k = 0;
    let ok = true;
    const problems = [];
    const shapedFams = shaped.map(s => s.fam);
    // map each token to shaped indices
    let si = 0;
    const tokMap = [];
    for (const L of w.letters) {
      const s = shaped[si];
      const isLig = s && QS.data.families[s.fam].sequence;
      if (L.lig) {
        ligTotal++;
        if (isLig) { ligOk++; tokMap.push({ s, si }); si++; }
        else { if (!L.maybeLig) { problems.push(`no ligature ${L.fams.join('+')}`); } tokMap.push({ s: shaped[si + L.fams.length - 1], si: si + L.fams.length - 1, first: s }); si += L.fams.length; }
      } else if (isLig) {
        // engine ligated two separate tokens: mark and skip second token
        problems.push(`unexpected ligature ${s.fam}`); ok = false;
        tokMap.push({ s, si }); si++;
      } else { tokMap.push({ s, si }); si++; }
    }
    if (problems.some(p => p.startsWith('unexpected'))) { wordTotal++; fails.push({ e: c.expect, fams, got: shaped, problems }); continue; }
    // relations between consecutive tokens
    for (let i = 0; i < w.rels.length; i++) {
      const rel = w.rels[i];
      if (rel === 'maybe') continue;
      const a = tokMap[i], b = tokMap[i + 1];
      if (!a || !a.s || !b) continue;
      const got = a.s.join;
      relTotal++;
      let good;
      if (rel === 'join') good = got != null;
      else if (rel === 'break') good = got == null;
      else good = got === H[rel];
      if (good) relOk++; else {
        ok = false;
        problems.push(`${a.s.fam.slice(2)}→${(b.first || b.s).fam.slice(2)}: want ${rel}, got ${got == null ? 'break' : got}`);
        const key = a.s.fam.slice(2) + '→' + (b.first || b.s).fam.slice(2);
        famErr[key] = (famErr[key] || 0) + 1;
      }
    }
    // variants
    w.letters.forEach((L, i) => {
      const t = tokMap[i]; if (!t || !t.s) return;
      const traits = t.s.st.traits || [];
      for (const m of L.mods) {
        const neg = m.startsWith('!'); const name = neg ? m.slice(1) : m;
        if (name !== 'alt' && name !== 'half') continue;
        varTotal++;
        const has = traits.includes(name);
        if (has !== neg) varOk++; else { ok = false; problems.push(`${L.fams.join('+').replace(/qs/g, '')}: want ${m}, got ${t.s.st.id}`); }
      }
    });
    wordTotal++;
    if (ok && !problems.length) wordOk++; else fails.push({ e: c.expect, fams, got: shaped, problems });
  }
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
console.log(`words ${wordOk}/${wordTotal} (${pct(wordOk, wordTotal)})  joins ${relOk}/${relTotal} (${pct(relOk, relTotal)})  variants ${varOk}/${varTotal} (${pct(varOk, varTotal)})  ligatures ${ligOk}/${ligTotal}`);
const top = Object.entries(famErr).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log('most frequent join errors:', top.map(([k, v]) => `${k}×${v}`).join('  '));
for (const f of fails.slice(0, showFails)) {
  console.log('\n' + f.e.replace(/\s+/g, ' '));
  console.log('  got: ' + f.got.map(s => s.fam.slice(2) + (s.st.id === 'prop' ? '' : '.' + s.st.id) + (s.join == null ? ' |' : s.join === 0 ? ' ~b~' : s.join === 500 ? ' ~x~' : ` ~${s.join}~`)).join(' '));
  console.log('  ' + f.problems.join('; '));
}
