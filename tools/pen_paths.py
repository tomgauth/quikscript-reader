"""Pen paths for every outline in the engine data.

For each glyph: rasterise the outline, thin it to a one-pixel skeleton, turn the skeleton
into a graph (endpoints, junctions, strokes between them), then compute the route a pen
would follow from each possible starting end to each possible finishing end, covering
every stroke once, going as straight as possible through junctions and crossings.

usage: python3 pen_paths.py qs-data.json out.json [sheet.png]
"""
import sys, json, io, math, itertools
import numpy as np
import cairosvg
from PIL import Image
from skimage.morphology import skeletonize

DATA, OUT = sys.argv[1:3]
SHEET = sys.argv[3] if len(sys.argv) > 3 else None
D = json.load(open(DATA))

S = 0.25          # pixels per font unit
X0, Y0, W, H = -300, -800, 1500, 2000   # raster window in font units


def raster(d):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(W*S)}" height="{int(H*S)}" '
           f'viewBox="{X0} {-(Y0+H)} {W} {H}"><g transform="scale(1,-1)"><path d="{d}" fill="#000"/></g></svg>')
    png = cairosvg.svg2png(bytestring=svg.encode())
    return np.array(Image.open(io.BytesIO(png)).convert('RGBA'))[:, :, 3] > 110


def px2u(r, c):
    return (X0 + (c + 0.5) / S, (Y0 + H) - (r + 0.5) / S)


NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def graph_from_skeleton(sk):
    pts = set(zip(*np.nonzero(sk)))
    def nbrs(p):
        return [(p[0] + a, p[1] + b) for a, b in NB if (p[0] + a, p[1] + b) in pts]
    deg = {p: len(nbrs(p)) for p in pts}
    # node pixels: endpoints and junctions; merge touching junction pixels into one node
    nodepix = [p for p in pts if deg[p] != 2]
    node_of = {}
    nodes = []
    for p in nodepix:
        if p in node_of:
            continue
        if deg[p] == 1:
            node_of[p] = len(nodes); nodes.append({'pix': [p], 'kind': 'end'}); continue
        # flood junction cluster
        stack, cl = [p], []
        node_of[p] = len(nodes)
        while stack:
            q = stack.pop(); cl.append(q)
            for n in nbrs(q):
                if deg[n] > 2 and n not in node_of:
                    node_of[n] = len(nodes); stack.append(n)
        nodes.append({'pix': cl, 'kind': 'junction'})
    for n in nodes:
        ys = [p[0] for p in n['pix']]; xs = [p[1] for p in n['pix']]
        n['rc'] = (sum(ys) / len(ys), sum(xs) / len(xs))
    # trace edges
    edges = []
    seen = set()
    for p in nodepix:
        for q in nbrs(p):
            if q in node_of and node_of[q] == node_of[p]:
                continue
            key = (p, q)
            if key in seen:
                continue
            chain = [p, q]
            prev, cur = p, q
            while cur not in node_of:
                nx = [n for n in nbrs(cur) if n != prev and n not in chain[-3:]]
                if not nx:
                    break
                # prefer 4-neighbours to avoid diagonal shortcuts skipping pixels
                nx.sort(key=lambda n: abs(n[0] - cur[0]) + abs(n[1] - cur[1]))
                prev, cur = cur, nx[0]
                chain.append(cur)
            if cur not in node_of:
                continue
            seen.add((chain[-1], chain[-2]))
            seen.add(key)
            a, b = node_of[p], node_of[cur]
            if len(chain) <= 2 and a == b:
                continue
            edges.append({'a': a, 'b': b, 'pix': chain})
    # pure cycles (no node at all): pick the topmost pixel as a node
    if not nodes and pts:
        top = min(pts)
        nodes.append({'pix': [top], 'kind': 'cycle', 'rc': top})
        chain = [top]
        prev, cur = None, top
        while True:
            nx = [n for n in nbrs(cur) if n != prev and n not in chain[1:]]
            if not nx or (len(chain) > 3 and top in nbrs(cur)):
                break
            prev, cur = cur, nx[0]
            chain.append(cur)
        chain.append(top)
        edges.append({'a': 0, 'b': 0, 'pix': chain})
    # dedupe edges traced from both ends
    uniq, keys = [], set()
    for e in edges:
        k = (min(e['a'], e['b']), max(e['a'], e['b']), frozenset(e['pix'][1:-1]))
        if k in keys:
            continue
        keys.add(k); uniq.append(e)
    return nodes, uniq


def to_units(nodes, edges):
    for n in nodes:
        n['xy'] = px2u(*n['rc'])
    for e in edges:
        pts = [px2u(r, c) for r, c in e['pix']]
        pts[0] = nodes[e['a']]['xy']; pts[-1] = nodes[e['b']]['xy']
        e['pts'] = smooth(pts)
        e['len'] = plen(e['pts'])


def smooth(pts, k=3):
    if len(pts) < 5:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        lo, hi = max(0, i - k), min(len(pts), i + k + 1)
        xs = [p[0] for p in pts[lo:hi]]; ys = [p[1] for p in pts[lo:hi]]
        out.append((sum(xs) / len(xs), sum(ys) / len(ys)))
    out.append(pts[-1])
    return rdp(out, 2.5)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        d = abs(ab[0] * (p - a)[1] - ab[1] * (p - a)[0]) / L if L > 0 else np.hypot(*(p - a))
        if d > best:
            best, idx = d, i
    if best > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def plen(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def prune(nodes, edges, min_len=48):
    """Drop short spurs (endpoint to junction) left by thinning at corners and stroke ends."""
    changed = True
    while changed:
        changed = False
        deg = [0] * len(nodes)
        for e in edges:
            deg[e['a']] += 1; deg[e['b']] += 1
        for e in sorted(edges, key=lambda e: e['len']):
            ends = [x for x in (e['a'], e['b']) if deg[x] == 1]
            other = [x for x in (e['a'], e['b']) if deg[x] >= 3]
            if ends and other and e['len'] < min_len:
                edges.remove(e); changed = True
                break
    # contract short links between two junctions: a crossing thinned into two T-junctions
    while True:
        deg = [0] * len(nodes)
        for e in edges:
            deg[e['a']] += 1; deg[e['b']] += 1
        short = next((e for e in sorted(edges, key=lambda e: e['len'])
                      if e['a'] != e['b'] and deg[e['a']] >= 3 and deg[e['b']] >= 3 and e['len'] < 75), None)
        if short is None:
            break
        a, b = short['a'], short['b']
        mid = ((nodes[a]['xy'][0] + nodes[b]['xy'][0]) / 2, (nodes[a]['xy'][1] + nodes[b]['xy'][1]) / 2)
        nodes[a]['xy'] = mid
        edges.remove(short)
        for e in edges:
            if e['a'] == b: e['a'] = a
            if e['b'] == b: e['b'] = a
            if e['a'] == a: e['pts'] = [mid] + e['pts'][1:]
            if e['b'] == a: e['pts'] = e['pts'][:-1] + [mid]
            e['len'] = plen(e['pts'])
    # merge degree-2 nodes created by pruning
    while True:
        deg = [0] * len(nodes)
        for e in edges:
            deg[e['a']] += 1; deg[e['b']] += 1
        m = next((i for i in range(len(nodes)) if deg[i] == 2 and not any(e['a'] == e['b'] == i for e in edges)), None)
        if m is None:
            break
        es = [e for e in edges if m in (e['a'], e['b'])]
        if len(es) != 2:
            break
        e1, e2 = es
        p1 = e1['pts'] if e1['b'] == m else e1['pts'][::-1]
        a1 = e1['a'] if e1['b'] == m else e1['b']
        p2 = e2['pts'] if e2['a'] == m else e2['pts'][::-1]
        b2 = e2['b'] if e2['a'] == m else e2['a']
        edges.remove(e1); edges.remove(e2)
        pts = rdp(p1 + p2[1:], 2.5)
        edges.append({'a': a1, 'b': b2, 'pts': pts, 'len': plen(pts)})
    used = sorted({e['a'] for e in edges} | {e['b'] for e in edges})
    remap = {o: i for i, o in enumerate(used)}
    nodes = [nodes[o] for o in used]
    for e in edges:
        e['a'], e['b'] = remap[e['a']], remap[e['b']]
    return nodes, edges


def extend_ends(nodes, edges, by=34):
    deg = [0] * len(nodes)
    for e in edges:
        deg[e['a']] += 1; deg[e['b']] += 1
    for e in edges:
        for side in ('a', 'b'):
            n = e[side]
            if deg[n] != 1:
                continue
            pts = e['pts'] if side == 'b' else e['pts'][::-1]
            # tangent over the last ~40 units
            q = pts[-1]
            k = len(pts) - 2
            while k > 0 and math.dist(pts[k], q) < 40:
                k -= 1
            p = pts[k]
            dx, dy = q[0] - p[0], q[1] - p[1]
            L = math.hypot(dx, dy) or 1
            nq = (q[0] + dx / L * by, q[1] + dy / L * by)
            pts = pts + [nq]
            e['pts'] = pts if side == 'b' else pts[::-1]
            nodes[n]['xy'] = nq
    for e in edges:
        e['len'] = plen(e['pts'])


def direction(pts, at_start, span=60):
    """unit direction of travel leaving the start (at_start) or arriving at the end."""
    seq = pts if at_start else pts[::-1]
    q = seq[0]
    k = 1
    while k < len(seq) - 1 and math.dist(seq[k], q) < span:
        k += 1
    dx, dy = seq[k][0] - q[0], seq[k][1] - q[1]
    L = math.hypot(dx, dy) or 1
    return (dx / L, dy / L) if at_start else (-dx / L, -dy / L)


def route(nodes, edges, start, end=None, spurs=frozenset()):
    """Pen route covering every edge once: straightest continuation at junctions,
    bridges (and the edge into the chosen end) taken last, pen lifts when stuck.
    Spurs (short dead ends at sharp corners) are drawn out and back."""
    unused = set(range(len(edges)))
    strokes = []          # list of polylines
    cur, cur_pts, heading = start, [], None

    def oriented(ei, frm):
        e = edges[ei]
        if e['a'] == frm and e['b'] == frm:
            return [e['pts'], e['pts'][::-1]]
        return [e['pts']] if e['a'] == frm else [e['pts'][::-1]]

    def other(ei, frm):
        e = edges[ei]
        return e['b'] if e['a'] == frm else e['a']

    def reachable_all(frm, rem):
        # can every remaining edge still be reached from frm? (bridge test)
        rem = [i for i in rem if i not in spurs]
        if not rem:
            return True
        adj = {}
        for i in rem:
            e = edges[i]
            adj.setdefault(e['a'], []).append(e['b']); adj.setdefault(e['b'], []).append(e['a'])
        if frm not in adj:
            return False
        seen, st = {frm}, [frm]
        while st:
            x = st.pop()
            for y in adj.get(x, []):
                if y not in seen:
                    seen.add(y); st.append(y)
        return all(edges[i]['a'] in seen for i in rem)

    while unused:
        cands = [ei for ei in unused if cur in (edges[ei]['a'], edges[ei]['b'])]
        if not cands:
            # retrace already drawn strokes to the nearest node that still has strokes (as a pen would),
            # or lift the pen when that is too far
            targets = {edges[i]['a'] for i in unused} | {edges[i]['b'] for i in unused}
            dist, prev = {cur: 0.0}, {}
            todo = [(0.0, cur)]
            import heapq
            while todo:
                dcur, x = heapq.heappop(todo)
                if dcur > dist.get(x, 1e18):
                    continue
                for i, e in enumerate(edges):
                    if e['a'] == e['b'] or x not in (e['a'], e['b']) or i in spurs:
                        continue
                    y = e['b'] if e['a'] == x else e['a']
                    nd = dcur + e['len']
                    if nd < dist.get(y, 1e18):
                        dist[y] = nd; prev[y] = (x, i); heapq.heappush(todo, (nd, y))
            reach = [t for t in targets if t in dist and t != cur]
            if reach:
                t = min(reach, key=lambda t: dist[t])
                if dist[t] <= 600:
                    chain, y = [], t
                    while y != cur:
                        x, i = prev[y]
                        chain.append(edges[i]['pts'] if edges[i]['b'] == y else edges[i]['pts'][::-1])
                        y = x
                    for seg in reversed(chain):
                        cur_pts = cur_pts + seg[1:] if cur_pts else list(seg)
                    heading = direction(chain[0], False)
                    cur = t
                    continue
            # pen lift to the nearest node that still has strokes
            here = cur_pts[-1] if cur_pts else nodes[cur]['xy']
            if cur_pts:
                strokes.append(cur_pts); cur_pts = []
            best = min({edges[i]['a'] for i in unused} | {edges[i]['b'] for i in unused},
                       key=lambda n: (0 if end is None or n != end else 1, math.dist(nodes[n]['xy'], here)))
            cur, heading = best, None
            continue
        scored = []
        for ei in cands:
            for pts in oriented(ei, cur):
                if ei in spurs:
                    pts = pts + pts[::-1][1:]
                nxt = other(ei, cur) if ei not in spurs else cur
                rem = unused - {ei}
                bridge = 0 if reachable_all(nxt, rem) else 1
                into_end = 1 if (end is not None and nxt == end and rem) else 0
                d = direction(pts, True)
                turn = 0 if heading is None else math.acos(max(-1, min(1, d[0] * heading[0] + d[1] * heading[1])))
                if heading is None and len(cands) > 1:
                    # starting at a junction or on a loop: prefer going up and right, like handwriting
                    turn = -0.2 * d[0]
                scored.append((into_end, bridge, turn, ei, pts))
        scored.sort(key=lambda s: s[:3])
        _, _, _, ei, pts = scored[0]
        unused.discard(ei)
        cur_pts = (cur_pts + pts[1:]) if cur_pts else list(pts)
        heading = direction(pts, False)
        if ei not in spurs:
            cur = other(ei, cur) if edges[ei]['a'] != edges[ei]['b'] else cur
    if cur_pts:
        strokes.append(cur_pts)
    return strokes


def path_d(strokes):
    out = []
    for s in strokes:
        out.append('M' + ' '.join(f'{p[0]:.0f} {p[1]:.0f}' for p in s[:1]) + 'L' + ' '.join(f'{p[0]:.0f} {p[1]:.0f}' for p in s[1:]))
    return ''.join(out)


USE = {}
for fam, f in D['families'].items():
    for st in f['stances']:
        USE.setdefault(st['glyph'], []).append(st)

# where a letter written on its own begins, from Spaceport's ductus, when the geometry cannot guess it
DEFAULT_START = {
    'uniE661': 'bottom', 'uniE661@-2000_60': 'bottom', 'lig.way_utter': 'bottom',   # Way rises from the descender
    'uniE663': 'left', 'lig.why_utter': 'left',                                    # Why: tick first
    'uniE65A': 'bottom',                                                           # See starts at its baseline foot
    'lig.see_utter': 'top', 'lig.see_eat': 'top',                                  # the See ligatures start at the crest
    'uniE65C': 'top', 'uniE656': 'top', 'uniE662': 'top', 'heqs.half': 'top',      # She, Thaw, He from the top
    'uniE668': 'top', 'uniE652': 'top', 'uniE652@430_2000': 'top',                 # Roe at the x-height, Tea top down
    'uniE660': 'left',                                                             # Ye: left, above the x-height
}
# one-ended letters whose free end is where the pen finishes (May, Vie)
FINISH_AT_END = {'uniE665', 'uniE659', 'lig.vie_utter'}
NEAR = 170


def pick(points, rule):
    if rule == 'bottom': return min(range(len(points)), key=lambda i: points[i][1])
    if rule == 'top': return max(range(len(points)), key=lambda i: points[i][1])
    if rule == 'left': return min(range(len(points)), key=lambda i: points[i][0])
    return None


result = {}
sheet = []
for key, g in D['glyphs'].items():
    a = raster(g['d'])
    sk = skeletonize(a)
    nodes, edges = graph_from_skeleton(sk)
    to_units(nodes, edges)
    nodes, edges = prune(nodes, edges)
    extend_ends(nodes, edges)
    deg = [0] * len(nodes)
    for e in edges:
        deg[e['a']] += 1; deg[e['b']] += 1
    ends = [i for i in range(len(nodes)) if deg[i] == 1]
    # anchors where this outline is entered or left
    anchors = []
    for st in USE.get(key, []):
        for x in st['entries']:
            if str(x['h']) in g['bands']: anchors.append((g['bands'][str(x['h'])][0], x['h']))
        for x in st['exits']:
            if str(x['h']) in g['bands']: anchors.append((g['bands'][str(x['h'])][1], x['h']))
    def near_anchor(n):
        return any(math.dist(nodes[n]['xy'], an) < 110 for an in anchors)
    edge_of = {n: next(i for i, e in enumerate(edges) if n in (e['a'], e['b'])) for n in ends}
    cand = sorted((edges[edge_of[n]]['len'], n) for n in ends if not near_anchor(n))
    spur_ends = []
    for L, n in cand:
        if len(ends) - len(spur_ends) <= 2 or L > 450:
            break
        other_end = edges[edge_of[n]]['a'] if edges[edge_of[n]]['b'] == n else edges[edge_of[n]]['b']
        if deg[other_end] < 3:
            continue
        spur_ends.append(n)
    spurs = frozenset(edge_of[n] for n in spur_ends)
    true_ends = [n for n in ends if n not in spur_ends]
    pts = [nodes[n]['xy'] for n in true_ends]
    # start and end per join height
    start_for, end_for = {}, {}
    for h, (l, r) in g['bands'].items():
        if true_ends:
            i = min(range(len(true_ends)), key=lambda i: math.dist(pts[i], (l, int(h))))
            if math.dist(pts[i], (l, int(h))) < NEAR: start_for[h] = i
            j = min(range(len(true_ends)), key=lambda i: math.dist(pts[i], (r, int(h))))
            if math.dist(pts[j], (r, int(h))) < NEAR: end_for[h] = j
    ent = [(g['bands'][str(x['h'])][0], x['h']) for st in USE.get(key, []) for x in st['entries'] if str(x['h']) in g['bands']]
    exi = [(g['bands'][str(x['h'])][1], x['h']) for st in USE.get(key, []) for x in st['exits'] if str(x['h']) in g['bands']]
    if not true_ends:
        default = 0
    elif key in DEFAULT_START:
        default = pick(pts, DEFAULT_START[key])
    elif ent:
        default = min(range(len(pts)), key=lambda i: math.dist(pts[i], ent[0]))
    elif exi:
        default = max(range(len(pts)), key=lambda i: math.dist(pts[i], exi[0]))
    else:
        default = max(range(len(pts)), key=lambda i: pts[i][1] - pts[i][0])
    starts = true_ends or [0]
    routes = {}
    for si, sn in enumerate(starts):
        for t in true_ends + [None]:
            if t == sn:
                continue
            st = route(nodes, edges, sn, t, spurs)
            routes[f'{si}>{true_ends.index(t) if t is not None else "*"}'] = {
                'd': path_d(st), 'len': round(sum(plen(x) for x in st)), 'lifts': len(st) - 1}
            if t is None:   # the same route backwards, for letters entered away from their ends
                rv = [x[::-1] for x in st[::-1]]
                routes[f'*>{si}'] = {'d': path_d(rv), 'len': round(sum(plen(x) for x in rv)), 'lifts': len(rv) - 1}
    default_key = f'*>{default}' if key in FINISH_AT_END else f'{default}>*'
    result[key] = {'start': start_for, 'end': end_for, 'default': default_key,
                   'routes': {k: [v['d'], v['len']] for k, v in routes.items()}}
    sheet.append((key, g, nodes, edges, true_ends, routes, default))
    print(f"{key:20} ends={len(true_ends)} spurs={len(spurs)} default={default} "
          + ' '.join(f"{k}:{v['len']}{'^'+str(v['lifts']) if v['lifts'] else ''}" for k, v in routes.items()))

json.dump(result, open(OUT, 'w'), separators=(',', ':'))

if SHEET:
    cols = 8; cw, ch = 1100, 1700
    cells = []
    for i, (key, g, nodes, edges, ends, routes, default) in enumerate(sheet):
        x = (i % cols) * cw + 200; y = (i // cols) * ch + 1150
        r0 = routes[f'*>{default}' if key in FINISH_AT_END else f'{default}>*']
        cells.append(f'<g transform="translate({x},{y}) scale(1,-1)"><path d="{g["d"]}" fill="#ddd"/>'
                     f'<path d="{r0["d"]}" fill="none" stroke="#c33" stroke-width="14" marker-end="url(#ar)"/>'
                     + ''.join(f'<circle cx="{nodes[n]["xy"][0]}" cy="{nodes[n]["xy"][1]}" r="26" fill="{"#2a2" if k == default else "#36c"}"/>' for k, n in enumerate(ends))
                     + '</g>'
                     f'<text x="{x-150}" y="{y+520}" font-size="90" font-family="sans-serif">{key}</text>')
    rows = (len(sheet) + cols - 1) // cols
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {cols*cw} {rows*ch}"><defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" '
           f'markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#c33"/></marker></defs>'
           f'<rect width="100%" height="100%" fill="#fff"/>{"".join(cells)}</svg>')
    cairosvg.svg2png(bytestring=svg.encode(), write_to=SHEET, output_width=2400)

if '--spurs' in sys.argv:
    for key, g, nodes, edges, ends, routes, default in sheet:
        deg = [0] * len(nodes)
        for e in edges:
            deg[e['a']] += 1; deg[e['b']] += 1
        sp = [(round(e['len']), [round(v) for v in nodes[e['a'] if deg[e['a']] == 1 else e['b']]['xy']]) for e in edges if (deg[e['a']] == 1) != (deg[e['b']] == 1)]
        if len(ends) > 2 or any(l < 250 for l, _ in sp):
            print(key, sorted(sp))
