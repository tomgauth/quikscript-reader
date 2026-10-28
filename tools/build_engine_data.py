"""Build the Senior Quikscript engine data (v2, rune model).

Join rules come from Abbots Morton Spaceport (MIT): the per-letter rune files
(glyph_data/runes/*.yaml) for the 45 letters and ligatures they cover, and
glyph_data/quikscript.yaml for the few letters without a rune file. These
transcribe Kingsley Read's Quikscript Manual.
Outlines come from Abbots Morton Experiment (Apache 2.0), the font the Transcriber uses.
"""
import json, sys, copy, io, glob, os
import numpy as np
import yaml, cairosvg
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
import pathops

GLYPH_DATA, FONT, OUT = sys.argv[1:4]
EXTRA = sys.argv[4] if len(sys.argv) > 4 else None  # optional JSON of hand-drawn shapes

CP = {
    'qsPea': 'E650', 'qsBay': 'E651', 'qsTea': 'E652', 'qsDay': 'E653', 'qsKey': 'E654', 'qsGay': 'E655',
    'qsThaw': 'E656', 'qsThey': 'E657', 'qsFee': 'E658', 'qsVie': 'E659', 'qsSee': 'E65A', 'qsZoo': 'E65B',
    'qsShe': 'E65C', 'qsJai': 'E65D', 'qsCheer': 'E65E', 'qsJay': 'E65F', 'qsYe': 'E660', 'qsWay': 'E661',
    'qsHe': 'E662', 'qsWhy': 'E663', 'qsIng': 'E664', 'qsMay': 'E665', 'qsNo': 'E666', 'qsLow': 'E667',
    'qsRoe': 'E668', 'qsLoch': 'E669', 'qsLlan': 'E66A', 'qsExcite': 'E66B', 'qsExam': 'E66C',
    'qsIt': 'E670', 'qsEat': 'E671', 'qsEt': 'E672', 'qsEight': 'E673', 'qsAt': 'E674', 'qsI': 'E675',
    'qsAh': 'E676', 'qsAwe': 'E677', 'qsOx': 'E678', 'qsOy': 'E679', 'qsUtter': 'E67A', 'qsOut': 'E67B',
    'qsOwe': 'E67C', 'qsFoot': 'E67D', 'qsOoze': 'E67E',
}
HNAME = {'baseline': 0, 'x-height': 500, 'top': 880, 'y6': 600, 'none': None}
YPIX = {0: 0, 5: 500, 6: 600, 8: 880, 9: 900}
CLIP_UPPER = (430, 2000)
CLIP_LOWER = (-2000, 60)

# Which outline draws each stance. Anything not listed uses the letter's base glyph.
# Value: glyph name, (glyph name, clip), or None when no outline exists yet (stance unusable).
STANCE_GLYPH = {
    ('qsNo', 'flipped'): 'noqs.alt',
    ('qsUtter', 'alternate'): 'utterqs.alt',
    ('qsPea', 'half'): 'peaqs.half',
    ('qsHe', 'half'): 'heqs.half',
    ('qsTea', 'half'): ('uniE652', CLIP_UPPER),
    ('qsDay', 'half'): ('uniE653', CLIP_LOWER),
    ('qsZoo', 'half'): ('uniE65B', CLIP_LOWER),
    ('qsWay', 'half'): ('uniE661', CLIP_LOWER),
    ('qsWhy', 'half'): ('uniE663', CLIP_LOWER),
    ('qsMay', 'grounded-loop'): 'mayqs.2b',
    ('qsOut', 'swept-up'): 'outqs.init',
    ('qsDay_qsUtter', 'full'): 'uniE653E67A',
    ('qsDay_qsUtter', 'half'): None,
    # ligatures drawn by tools/draw_ligatures.py (AME outlines + strokes, after Spaceport's ductus)
    ('qsThey_qsUtter', 'sole'): 'lig.they_utter',
    ('qsWay_qsUtter', 'sole'): 'lig.way_utter',
    ('qsVie_qsUtter', 'sole'): 'lig.vie_utter',
    ('qsSee_qsUtter', 'sole'): 'lig.see_utter',
    ('qsJay_qsUtter', 'sole'): 'lig.jay_utter',
    ('qsJai_qsUtter', 'sole'): 'lig.jai_utter',
    ('qsOut_qsTea', 'sole'): 'lig.out_tea',
}
# ligatures with an outline (others are not formed yet)
LIG_OK = {'qsDay_qsUtter', 'qsThey_qsUtter', 'qsWay_qsUtter', 'qsVie_qsUtter', 'qsSee_qsUtter',
          'qsJay_qsUtter', 'qsJai_qsUtter', 'qsOut_qsTea'}
# ligatures defined only in quikscript.yaml: drawn outline, extra entry heights (None = as in the yaml)
LIG_Q = {'qsDay_qsEat': ('lig.day_eat', [500]), 'qsSee_qsEat': ('lig.see_eat', None), 'qsWhy_qsUtter': ('lig.why_utter', None)}
# stances drawn with the base glyph although Read's shape differs a little
APPROX = {('qsAt', 'falling'), ('qsI', 'smaller-loop'), ('qsEight', 'smaller-loop'), ('qsFee', 'reversed-loop'),
          ('qsSee', 'curled-over'), ('qsSee', 'straighter'), ('qsSee', 'straightest'), ('qsVie', 'swept-out'),
          ('qsYe', 'climbing-loop')}

f = TTFont(FONT)
gs = f.getGlyphSet()
hmtx = f['hmtx']
extra_shapes = json.load(open(EXTRA)) if EXTRA and os.path.exists(EXTRA) else {}


def glyph_path(name, clip):
    if name in extra_shapes:
        return extra_shapes[name]['d']
    rp = DecomposingRecordingPen(gs)
    gs[name].draw(rp)
    p = pathops.Path()
    rp.replay(p.getPen())
    if clip:
        r = pathops.Path()
        pen = r.getPen()
        y0, y1 = clip
        pen.moveTo((-2000, y0)); pen.lineTo((4000, y0)); pen.lineTo((4000, y1)); pen.lineTo((-2000, y1)); pen.closePath()
        p = pathops.op(p, r, pathops.PathOp.INTERSECTION)
    sp = SVGPathPen(None)
    p.draw(sp)
    return sp.getCommands()


SC = 0.1
X0, Y0, W, H = -200, -700, 1800, 1900


def raster(d):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(W*SC)}" height="{int(H*SC)}" '
           f'viewBox="{X0} {-(Y0+H)} {W} {H}"><g transform="scale(1,-1)"><path d="{d}" fill="#000"/></g></svg>')
    png = cairosvg.svg2png(bytestring=svg.encode())
    return np.array(Image.open(io.BytesIO(png)).convert('RGBA'))[:, :, 3] > 100


def col2x(c): return X0 + (c + 0.5) / SC
def y2row(y): return int(((Y0 + H) - y) * SC)


SLICE = 50
SLICES = list(range(-650, 1150, SLICE))


def band_edges(a, y, win=30):
    r0, r1 = y2row(y + win), y2row(y - win)
    band = a[max(r0, 0):max(r1, 0)]
    cols = np.where(band.any(axis=0))[0] if band.size else []
    if not len(cols):
        return None
    return [round(col2x(cols[0]) - 0.5 / SC), round(col2x(cols[-1]) + 0.5 / SC)]


glyphs = {}


def need(name, clip):
    key = name + (f'@{clip[0]}_{clip[1]}' if clip else '')
    if key in glyphs:
        return key
    d = glyph_path(name, clip)
    a = raster(d)
    prof = []
    for ys in SLICES:
        r0, r1 = y2row(ys + SLICE), y2row(ys)
        band = a[max(r0, 0):max(r1, 0)]
        cols = np.where(band.any(axis=0))[0] if band.size else []
        prof.append([round(col2x(cols[0])), round(col2x(cols[-1]))] if len(cols) else None)
    ink = np.where(a.any(axis=0))[0]
    rows = np.where(a.any(axis=1))[0]
    bbox = [round(col2x(ink[0])), round((Y0 + H) - (rows[-1] + 1) / SC), round(col2x(ink[-1])), round((Y0 + H) - rows[0] / SC)]
    bands = {}
    for y in (0, 500, 600, 880):
        e = band_edges(a, y, 40 if y > 700 else 30)
        if e: bands[str(y)] = e
    adv = hmtx[name][0] if name in hmtx.metrics else (bbox[2] + 40)
    glyphs[key] = {'d': d, 'adv': adv, 'prof': prof, 'bbox': bbox, 'bands': bands}
    return key


# ── selectors / policies ─────────────────────────────────────────────
QY = yaml.safe_load(open(os.path.join(GLYPH_DATA, 'quikscript.yaml')))
CTX = QY.get('context_sets') or {}


def ctx_families(name, depth=0):
    out = []
    for s in CTX.get(name) or []:
        if isinstance(s, dict) and 'context_set' in s:
            out += ctx_families(s['context_set'], depth + 1)
        elif isinstance(s, dict) and 'family' in s:
            fm = s['family']; out += fm if isinstance(fm, list) else [fm]
    return out


def hval(v):
    if v is None: return None
    if isinstance(v, int): return YPIX.get(v, v * 100)
    if v in HNAME: return HNAME[v]
    return v  # 'live'


def norm_sel(s):
    """Normalize a neighbour selector."""
    if s is None: return None
    if isinstance(s, str): return {'family': [s]}
    if isinstance(s, list):
        return {'any': [norm_sel(x) for x in s]}
    o = {}
    for k, v in s.items():
        if k == 'family':
            o['family'] = v if isinstance(v, list) else [v]
        elif k == 'except':
            o['except'] = [norm_sel(x) for x in v]
        elif k == 'then':
            o['then'] = norm_sel(v)
        elif k == 'is':
            o['is'] = v
        elif k == 'class':
            o['class'] = v
        elif k in ('stance', 'bitmap'):
            o['stance'] = v
        elif k == 'joined_at':
            o['joined_at'] = hval(v)
        elif k == 'context_set':
            o['family'] = ctx_families(v)
        elif k in ('exit_y', 'entry_y'):
            o[k] = hval(v)
        elif k == 'traits':
            o['traits'] = v
    return o


def norm_scope(lst):
    if not lst: return None
    return [norm_sel(x) for x in lst]


def norm_policy(p, kind):
    o = {'kind': kind}
    w = p.get('when') or {}
    if w.get('feature'):
        return None  # stylistic-set behaviour, off by default
    when = {}
    for side in ('left', 'right'):
        if side in w: when[side] = norm_sel(w[side])
    if 'self' in w:
        when['self'] = {k: hval(v) for k, v in w['self'].items()}
    o['when'] = when
    cell = p.get('cell') or {}
    for k in ('entry', 'exit'):
        if k in p: cell[k] = p[k]
    o['cell'] = {k: hval(v) for k, v in cell.items()}
    if 'stance' in p: o['stance'] = p['stance']
    if p.get('mode') == 'absolute': o['absolute'] = True
    return o


families = {}
report = []


def glyph_for(fam, stance, traits):
    key = STANCE_GLYPH.get((fam, stance), 'default')
    if key is None:
        return None, False
    if key == 'default':
        if fam in CP:
            return need('uni' + CP[fam], None), (fam, stance) in APPROX
        return None, False
    if isinstance(key, tuple):
        return need(key[0], key[1]), False
    return need(key, None), False


def anchor_ok(gkey, h):
    return gkey and str(h) in glyphs[gkey]['bands']


# rune files
for fn in sorted(glob.glob(os.path.join(GLYPH_DATA, 'runes', '*.yaml'))):
    y = yaml.safe_load(open(fn))
    fam = y['rune']
    if y.get('sequence') and fam not in LIG_OK:
        continue
    pol = y.get('policy') or {}
    order = pol.get('order') or list((y.get('stances') or {}).keys())
    stances = []
    for sn, st in (y.get('stances') or {}).items():
        traits = st.get('traits') or []
        g, approx = glyph_for(fam, sn, traits)
        if not g: continue
        surf = st.get('surface') or {}
        ents, exs = [], []
        for hn, v in (surf.get('entries') or {}).items():
            h = HNAME.get(hn)
            if h is None or not anchor_ok(g, h): continue
            ents.append({'h': h, 'from': norm_scope((v or {}).get('from'))})
        for hn, v in (surf.get('exits') or {}).items():
            h = HNAME.get(hn)
            if h is None or not anchor_ok(g, h): continue
            exs.append({'h': h, 'toward': norm_scope((v or {}).get('toward'))})
        o = {'id': sn, 'traits': traits, 'glyph': g, 'entries': ents, 'exits': exs,
             'order': order.index(sn) if sn in order else len(order)}
        pr = surf.get('pairings') or {}
        if pr.get('only'): o['only'] = [[hval(x.get('entry', 'none')), hval(x.get('exit', 'none'))] for x in pr['only']]
        if pr.get('never'): o['never'] = [[hval(x.get('entry', 'none')), hval(x.get('exit', 'none'))] for x in pr['never']]
        if surf.get('require'): o['require'] = surf['require']
        if approx: o['approx'] = True
        stances.append(o)
    rec = {'cp': CP.get(fam), 'rune': True, 'stances': stances,
           'refuse': [x for x in (norm_policy(p, 'refuse') for p in pol.get('refuse') or []) if x],
           'prefer': [x for x in (norm_policy(p, 'prefer') for p in pol.get('prefer') or []) if x]}
    if y.get('sequence'): rec['sequence'] = y['sequence']
    families[fam] = rec

# letters without a rune file: quikscript.yaml stances
FAMQ = QY['glyph_families']


def merge(a, b):
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k in ('anchors', 'select'):
            for kk, vv in v.items():
                if vv is None: out[k].pop(kk, None)
                else: out[k][kk] = vv
        elif v is None:
            out.pop(k, None)
        else:
            out[k] = copy.deepcopy(v)
    return out


def alist(v):
    if v is None: return []
    return v if isinstance(v[0], list) else [v]


for fam, cp in CP.items():
    if fam in families: continue
    fd = FAMQ.get(fam) or {}
    prop = fd.get('prop') or {}
    raw = {'prop': {'anchors': prop.get('anchors') or {}}}
    for sn, st in (fd.get('stances') or {}).items():
        if isinstance(st, dict) and not st.get('gate_feature_behind') and not st.get('replaces_family_feature'):
            raw[sn] = st

    def resolve(sn, seen=()):
        st = raw[sn]
        base = {}
        inh = st.get('inherits')
        if inh:
            for p in (inh if isinstance(inh, list) else [inh]):
                if p in raw and p not in seen: base = merge(base, resolve(p, seen + (sn,)))
        return merge(base, {k: v for k, v in st.items() if k != 'inherits'})

    g = need('uni' + cp, None)
    stances = []
    for i, sn in enumerate(raw):
        st = resolve(sn)
        a = st.get('anchors') or {}
        ents = [{'h': YPIX[p[1]], 'from': None} for p in alist(a.get('entry')) if p[1] in YPIX and anchor_ok(g, YPIX[p[1]])]
        exs = [{'h': YPIX[p[1]], 'toward': None} for p in alist(a.get('exit')) if p[1] in YPIX and anchor_ok(g, YPIX[p[1]])]
        o = {'id': sn, 'traits': st.get('traits') or [], 'glyph': g, 'entries': ents, 'exits': exs, 'order': i}
        sel = st.get('select') or {}
        for k in ('after', 'not_after', 'before', 'not_before'):
            v = sel.get(k)
            if v is not None: o[k] = [norm_sel(x) for x in (v if isinstance(v, list) else [v])]
        if st.get('shape') and st.get('shape') not in ('mono', 'prop'): o['approx'] = True
        stances.append(o)
    families[fam] = {'cp': cp, 'stances': stances, 'refuse': [], 'prefer': []}

# ligatures that only quikscript.yaml describes
for fam, (gname, extra_entries) in LIG_Q.items():
    fd = FAMQ.get(fam)
    if not fd or not (EXTRA and gname in extra_shapes): continue
    g = need(gname, None)
    a = (fd.get('prop') or {}).get('anchors') or {}
    ent_h = [YPIX[p[1]] for p in alist(a.get('entry')) if p[1] in YPIX] + (extra_entries or [])
    exs = [{'h': YPIX[p[1]], 'toward': None} for p in alist(a.get('exit')) if p[1] in YPIX and anchor_ok(g, YPIX[p[1]])]
    ents = [{'h': h, 'from': None} for h in dict.fromkeys(ent_h) if anchor_ok(g, h)]
    families[fam] = {'cp': None, 'sequence': fd['sequence'], 'refuse': [], 'prefer': [],
                     'stances': [{'id': 'prop', 'traits': [], 'glyph': g, 'entries': ents, 'exits': exs, 'order': 0}]}

# capability classes used by policies
classes = {
    'can-exit-at-baseline': sorted(f for f, r in families.items() if any(any(x['h'] == 0 for x in s['exits']) for s in r['stances'])),
    'can-enter-at-x-height': sorted(f for f, r in families.items() if any(any(x['h'] == 500 for x in s['entries']) for s in r['stances'])),
    'talls': ctx_families('talls'),
}

for fam, cp in CP.items():
    need('uni' + cp, None)
for x in ('uniE66E', 'uniE66F'):
    need(x, None)

for fam, r in families.items():
    report.append(f"{fam:15} " + ' | '.join(
        f"{s['id']}{'~' if s.get('approx') else ''}:{[e['h'] for e in s['entries']]}>{[e['h'] for e in s['exits']]}" for s in r['stances'])
        + f"  (refuse {len(r['refuse'])}, prefer {len(r['prefer'])})")

json.dump({'version': 2, 'glyphs': glyphs, 'families': families, 'classes': classes, 'slices': SLICES, 'slice': SLICE,
           'source': {'rules': 'Abbots Morton Spaceport glyph data (MIT), transcribing the Quikscript Manual',
                      'outlines': 'Abbots Morton Experiment (Apache-2.0)'}},
          open(OUT, 'w'), separators=(',', ':'))
print('\n'.join(report))
print('glyphs', len(glyphs), 'families', len(families))
