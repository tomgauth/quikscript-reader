"""Draw the Senior ligatures that Abbots Morton Experiment lacks, in its style.

Each ligature is built from the AME outlines of its letters plus 70-unit strokes,
following the ductus written in Abbots Morton Spaceport's rune files
(glyph_data/runes/qs*_qs*.yaml and glyph_data/quikscript.yaml).

usage: python3 draw_ligatures.py FONT OUT_JSON PREVIEW_PNG [SPACEPORT_GLYPH_DATA]
"""
import sys, json, os, math
import pathops, cairosvg, yaml
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen

FONT, OUT, PREVIEW = sys.argv[1:4]
GD = sys.argv[4] if len(sys.argv) > 4 else None
f = TTFont(FONT)
gs = f.getGlyphSet()
W = 70  # AME stroke weight


def glyph(name, dx=0, dy=0):
    rp = DecomposingRecordingPen(gs)
    gs[name].draw(rp)
    p = pathops.Path()
    rp.replay(p.getPen())
    if dx or dy:
        p = p.transform(1, 0, 0, 1, dx, dy)
    return pathops.simplify(p)


def rect(x0, y0, x1, y1):
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo((x0, y0)); pen.lineTo((x1, y0)); pen.lineTo((x1, y1)); pen.lineTo((x0, y1)); pen.closePath()
    return p


def poly(pts):
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo(pts[0])
    for q in pts[1:]:
        pen.lineTo(q)
    pen.closePath()
    return p


def stroke(cmds, join='round', width=W):
    """cmds: [('M',x,y), ('L',x,y), ('C',x1,y1,x2,y2,x,y), ('Q',x1,y1,x,y)] -> filled outline"""
    p = pathops.Path()
    for c in cmds:
        if c[0] == 'M': p.moveTo(*c[1:])
        elif c[0] == 'L': p.lineTo(*c[1:])
        elif c[0] == 'C': p.cubicTo(*c[1:])
        elif c[0] == 'Q': p.quadTo(*c[1:])
    j = {'round': pathops.LineJoin.ROUND_JOIN, 'miter': pathops.LineJoin.MITER_JOIN}[join]
    p.stroke(width, pathops.LineCap.BUTT_CAP, j, 12)
    p.convertConicsToQuads()
    return pathops.simplify(p)


def union(*ps):
    out = ps[0]
    for p in ps[1:]:
        out = pathops.op(out, p, pathops.PathOp.UNION)
    return out


def minus(a, b):
    return pathops.op(a, b, pathops.PathOp.DIFFERENCE)


def back(p, d, n):
    """point n units back from p along unit direction d"""
    return (p[0] - d[0] * n, p[1] - d[1] * n)


def unit(dx, dy):
    l = math.hypot(dx, dy)
    return (dx / l, dy / l)


def crown(p0, d, x_end, k1=170, k2=150, y=500, overlap=40):
    """Utter's rising arm: from p0 heading d, bending into a horizontal stroke at y ending at x_end"""
    s = back(p0, d, overlap)
    return [('M', *s), ('L', *p0), ('C', p0[0] + d[0] * k1, p0[1] + d[1] * k1, x_end - k2, y, x_end, y)]


SHAPES = {}

# ·Way+Utter: the ·Way diagonal rises as usual, then bends into ·Utter's crown at the x-height.
d_way = unit(400, 900)
SHAPES['lig.way_utter'] = union(
    pathops.op(glyph('uniE661'), rect(-500, -900, 1500, 100), pathops.PathOp.INTERSECTION),
    stroke(crown((57 + 500 / 900 * 400, 100), d_way, 600)),
)

# ·Why+Utter: the same with ·Why's long diagonal.
d_why = unit(352, 792)
SHAPES['lig.why_utter'] = union(
    pathops.op(glyph('uniE663'), rect(-500, -900, 1500, 100), pathops.PathOp.INTERSECTION),
    stroke(crown((194 + 392 / 792 * 352, 100), d_why, 690)),
)

# ·Vie+Utter: the right lip of ·Vie's cup keeps climbing as the ·Utter arm.
SHAPES['lig.vie_utter'] = union(glyph('uniE659'), glyph('uniE67A', dx=304))

# ·They+Utter: down into ·They's hook, then up out of the descender to ·Utter's crown.
they = minus(glyph('uniE657'), rect(250, -700, 900, -300))
SHAPES['lig.they_utter'] = union(
    they,
    stroke([('M', 200, -428), ('C', 300, -430, 345, -395, 372, -320),
            ('L', 440, -130), ('C', 495, 30, 560, 500, 760, 500)]),
)

# ·Jay+Utter: ·Jay as drawn in AME, but its rising arm keeps climbing, bends upward and ends in ·Utter's crown.
u = unit(406, 353)  # direction of AME's ·Jay arm
n = (-u[1], u[0])
p0 = (556 - 200 * u[0], 0 - 200 * u[1])  # a point on the arm's centreline, 200 before its end
A = (p0[0] + 40 * n[0], p0[1] + 40 * n[1]); B = (p0[0] - 40 * n[0], p0[1] - 40 * n[1])
cut = poly([A, B, (B[0] + 300 * u[0], B[1] + 300 * u[1]), (A[0] + 300 * u[0], A[1] + 300 * u[1])])
SHAPES['lig.jay_utter'] = union(
    minus(glyph('uniE65F'), cut),
    stroke([('M', p0[0] - 30 * u[0], p0[1] - 30 * u[1]), ('L', *p0),
            ('C', p0[0] + 150 * u[0], p0[1] + 150 * u[1], 575, 90, 590, 200),
            ('C', 604, 300, 650, 500, 800, 500)]),
)

# ·J'ai+Utter: down through the descender curl; the stroke climbs out past the baseline to the crown.
jai = minus(glyph('uniE65D'), poly([(468, 110), (447, 27), (419, -49), (400, -100), (900, -100), (900, 110)]))
SHAPES['lig.jai_utter'] = union(
    jai,
    stroke([('M', 230, -85), ('L', 300, -40), ('C', 390, 10, 470, 120, 515, 250), ('C', 555, 370, 600, 500, 760, 500)]),
)

# ·See+Utter: ·See as usual; ·Utter retraces the lower spine and breaks out to the crown.
SHAPES['lig.see_utter'] = union(
    glyph('uniE65A'),
    stroke([('M', 272, 200), ('C', 300, 300, 370, 500, 560, 500)]),
)

# ·Out+Tea: ·Out's bowl and loop; the loop's left side runs straight up as ·Tea.
SHAPES['lig.out_tea'] = union(glyph('uniE67B'), rect(365, 380, 435, 900))

# ·Day+Eat: ·Day's stem; the foot rises as ·Eat's diagonal and drops to the baseline.
SHAPES['lig.day_eat'] = union(
    rect(40, -411, 110, 535),
    stroke([('M', 75, -400), ('L', 420, 610), ('L', 420, -35)], join='miter'),
)

# ·See+Eat: ·See as usual; ·Eat's diagonal leaves the spine and drops to the baseline.
SHAPES['lig.see_eat'] = union(
    glyph('uniE65A'),
    stroke([('M', 272, 200), ('L', 475, 610), ('L', 475, -35)], join='miter'),
)


def d_of(p):
    sp = SVGPathPen(None)
    p.draw(sp)
    import re
    return re.sub(r'-?\d+\.\d+', lambda m: ('%.1f' % float(m.group())).rstrip('0').rstrip('.'), sp.getCommands())


out = {k: {'d': d_of(pathops.simplify(v))} for k, v in SHAPES.items()}
json.dump(out, open(OUT, 'w'))

# ── preview: AME letters | our ligature | Spaceport's pixel drawing ──
PARTS = {
    'lig.way_utter': ('qsWay_qsUtter', ['uniE661', 'uniE67A']), 'lig.why_utter': ('qsWhy_qsUtter', ['uniE663', 'uniE67A']),
    'lig.vie_utter': ('qsVie_qsUtter', ['uniE659', 'uniE67A']), 'lig.they_utter': ('qsThey_qsUtter', ['uniE657', 'uniE67A']),
    'lig.jay_utter': ('qsJay_qsUtter', ['uniE65F', 'uniE67A']), 'lig.jai_utter': ('qsJai_qsUtter', ['uniE65D', 'uniE67A']),
    'lig.see_utter': ('qsSee_qsUtter', ['uniE65A', 'uniE67A']), 'lig.out_tea': ('qsOut_qsTea', ['uniE67B', 'uniE652']),
    'lig.day_eat': ('qsDay_qsEat', ['uniE653', 'uniE671']), 'lig.see_eat': ('qsSee_qsEat', ['uniE65A', 'uniE671']),
}


def bitmap_of(fam):
    if not GD:
        return None, 0
    p = os.path.join(GD, 'runes', fam + '.yaml')
    if os.path.exists(p):
        d = yaml.safe_load(open(p))
        st = next(iter(d['stances'].values()))
        return st.get('bitmap'), st.get('y_offset', 0)
    q = yaml.safe_load(open(os.path.join(GD, 'quikscript.yaml')))['glyph_families'].get(fam)
    if q:
        return q['prop'].get('bitmap'), q['prop'].get('y_offset', 0)
    return None, 0


def guides():
    g = ''.join(f'<line x1="-150" x2="1100" y1="{y}" y2="{y}" stroke="#eee" stroke-width="3"/>' for y in range(-500, 1001, 100))
    return g + '<line x1="-150" x2="1100" y1="0" y2="0" stroke="#bbb" stroke-width="6"/><line x1="-150" x2="1100" y1="500" y2="500" stroke="#bbb" stroke-width="6" stroke-dasharray="20 15"/>'


cells = []
CW, CH = 1250, 1650
for r, (name, (fam, parts)) in enumerate(PARTS.items()):
    oy = r * CH + 1150
    x = 150
    for gname in parts:
        sp = SVGPathPen(gs); gs[gname].draw(sp)
        cells.append(f'<g transform="translate({x},{oy}) scale(1,-1)">{guides()}<path d="{sp.getCommands()}" fill="#888"/></g>')
        x += CW * 0.75
    cells.append(f'<g transform="translate({x},{oy}) scale(1,-1)">{guides()}<path d="{out[name]["d"]}" fill="#111"/></g>')
    x += CW
    bm, yo = bitmap_of(fam)
    if bm:
        s = 100
        for i, row in enumerate(bm):
            for j, ch in enumerate(row):
                if ch == '#':
                    yb = (len(bm) - 1 - i + yo) * s
                    cells.append(f'<rect x="{x + j * 70}" y="{oy - yb - s}" width="66" height="{s - 4}" fill="#3b5b8c"/>')
    cells.append(f'<text x="40" y="{oy + 430}" font-size="110" font-family="sans-serif" fill="#333">{fam[2:].replace("_qs", " + ")}</text>')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CW * 4} {len(PARTS) * CH + 200}"><rect width="100%" height="100%" fill="#fff"/>{"".join(cells)}</svg>'
cairosvg.svg2png(bytestring=svg.encode(), write_to=PREVIEW, output_width=1400)
print('wrote', len(out), 'shapes')
