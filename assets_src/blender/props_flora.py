"""Венки и цветы для props_kit: низкополигональные модели на цветах вершин (материал blades — двусторонний, без текстур).

Все функции возвращают bmesh с цветовым слоем «Color» (линейные цвета), материал подставляет props_kit.
Венки стоят на хвостах ленты, «лицом» к −Y Blender (+Z glTF), диаметр кольца ≈ 0.38 м, origin — на земле под ними.
Цветы — пучки на земле, origin — центр основания.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

import zone_lib as Z

UP = Vector((0, 0, 1))
FRONT = Vector((0, -1, 0))


# ============================================================================ примитивы
def _mix(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def _jit(c, rnd, amt=0.14):
    j = rnd.uniform(1 - amt, 1 + amt)
    return tuple(min(1.0, v * j) for v in c)


def _lay(bm):
    return bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")


def _face(bm, lay, pts, cols):
    """Грань по точкам (Vector); cols — цвет каждой вершины."""
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    for lp, c in zip(f.loops, cols):
        lp[lay] = (*c, 1.0)
    return f


def _frame(n):
    """Две оси в плоскости, перпендикулярной n."""
    n = n.normalized()
    a = n.cross(UP)
    if a.length < 1e-3:
        a = n.cross(Vector((1, 0, 0)))
    a.normalize()
    return a, n.cross(a).normalized()


def _leaf(bm, lay, p, d, ln, w, c0, c1, fold=0.3):
    """Листок из 4 треугольников со сгибом по жилке: p — основание, d — направление, ln/w — длина и полуширина."""
    side = d.cross(FRONT)
    if side.length < 1e-3:
        side = d.cross(Vector((1, 0, 0)))
    side.normalize()
    up = side.cross(d).normalized()
    B, T = p, p + d * ln
    C = p + d * ln * 0.45 + up * (w * fold)
    L, R = p + d * ln * 0.42 - side * w, p + d * ln * 0.42 + side * w
    cm = _mix(c0, c1, 0.5)
    for pts, cols in (((B, L, C), (c0, cm, cm)), ((B, C, R), (c0, cm, cm)),
                      ((L, T, C), (cm, c1, cm)), ((C, T, R), (cm, c1, cm))):
        _face(bm, lay, pts, cols)


def _blade(bm, lay, base, d, ln, w, droop, c0, c1):
    """Длинный узкий лист (трава, листья цветов): 3 звена, сужается к кончику и свисает дугой."""
    d = d.normalized()
    side = d.cross(UP)
    side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
    ring = []
    for k in range(4):
        t = k / 3
        c = base + d * ln * t - UP * (droop * ln * t * t)
        hw = w * (1 - t) ** 0.8 * (1.0 if k else 0.7)
        ring.append((c - side * hw, c + side * hw))
    for k in range(3):
        ca, cb = _mix(c0, c1, k / 3), _mix(c0, c1, (k + 1) / 3)
        if k < 2:
            _face(bm, lay, (ring[k][0], ring[k][1], ring[k + 1][1], ring[k + 1][0]), (ca, ca, cb, cb))
        else:
            _face(bm, lay, (ring[k][0], ring[k][1], ring[k + 1][0]), (ca, ca, c1))


def _stem(bm, lay, pts, r, c0, c1):
    """Стебель — трёхгранная призма вдоль ломаной pts (радиус r, к вершине сужается), цвет от c0 (низ) к c1 (верх)."""
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        a, b = _frame(d)
        rr = r * (1.0 - 0.35 * i / (n - 1))
        rings.append([p + (a * math.cos(t) + b * math.sin(t)) * rr for t in (0, math.tau / 3, 2 * math.tau / 3)])
    for i in range(n - 1):
        ca, cb = _mix(c0, c1, i / (n - 1)), _mix(c0, c1, (i + 1) / (n - 1))
        for k in range(3):
            _face(bm, lay, (rings[i][k], rings[i][(k + 1) % 3], rings[i + 1][(k + 1) % 3], rings[i + 1][k]),
                  (ca, ca, cb, cb))


def _head(bm, lay, c, nrm, r, petals, col, col_in, col_mid, rnd, cup=0.18, width=0.5):
    """Головка цветка: petals лепестков-«ромбиков» радиусом r (чуть чашей — края приподняты) и диск-серединка."""
    a, b = _frame(nrm)
    n = nrm.normalized()
    ph = rnd.uniform(0, math.tau)
    for k in range(petals):
        t = ph + k * math.tau / petals
        d = a * math.cos(t) + b * math.sin(t)
        s = d.cross(n).normalized()
        w = r * width
        tip = c + d * r + n * (r * cup)
        mid = c + d * r * 0.55 + n * (r * cup * 0.3)
        _face(bm, lay, (c + d * 0.12 * r, mid + s * w, tip, mid - s * w), (col_in, col, col, col))
    top = c + n * (r * 0.2)
    ring = [c + (a * math.cos(k * math.tau / 6) + b * math.sin(k * math.tau / 6)) * r * 0.22 + n * (r * 0.1)
            for k in range(6)]
    for k in range(6):
        _face(bm, lay, (ring[k], ring[(k + 1) % 6], top), (col_mid, col_mid, col_mid))


# ============================================================================ венки
GREEN = ((0.010, 0.045, 0.010), (0.075, 0.21, 0.030))
DRY = ((0.045, 0.028, 0.010), (0.19, 0.115, 0.040))
WREATHS = {
    "fresh": dict(seed=11, leaf=GREEN, leaves=46, flowers=9, petals=6, r=0.034, droop=0.0,
                  palette=[((0.72, 0.70, 0.62), (0.60, 0.50, 0.28)), ((0.70, 0.62, 0.40), (0.58, 0.42, 0.06))],
                  ribbon=((0.36, 0.33, 0.27), (0.20, 0.18, 0.14)), tattered=False),
    "flower": dict(seed=12, leaf=GREEN, leaves=40, flowers=15, petals=5, r=0.038, droop=0.0,
                   palette=[((0.50, 0.025, 0.02), (0.30, 0.01, 0.01)), ((0.20, 0.08, 0.36), (0.40, 0.30, 0.08)),
                            ((0.10, 0.20, 0.52), (0.60, 0.50, 0.10)), ((0.58, 0.16, 0.24), (0.55, 0.40, 0.05)),
                            ((0.64, 0.46, 0.04), (0.35, 0.20, 0.02)), ((0.72, 0.70, 0.62), (0.60, 0.50, 0.28))],
                   ribbon=((0.46, 0.03, 0.03), (0.22, 0.015, 0.015)), tattered=False),
    "withered": dict(seed=13, leaf=DRY, leaves=38, flowers=6, petals=5, r=0.030, droop=0.8,
                     palette=[((0.19, 0.095, 0.035), (0.08, 0.04, 0.02)), ((0.24, 0.16, 0.075), (0.10, 0.06, 0.03))],
                     ribbon=((0.18, 0.125, 0.07), (0.09, 0.065, 0.04)), tattered=True),
}
WREATH_R = 0.19            # радиус кольца по центру жгута, м
WREATH_LIFT = 0.13         # кольцо поднято так, чтобы хвосты ленты касались земли


def _bow(bm, lay, K, col, col_dark, rnd, tattered):
    """Бант на нижней точке венка: узел, две петли и два хвоста с «ласточкиным» вырезом (у увядшего — рваные, короче)."""
    for sx in (-1, 1):
        E = K + Vector((sx * 0.056, -0.004, 0.014))
        pts = []
        for k in range(8):
            t = math.pi + k * math.tau / 8                      # обход эллипса, начиная с точки у узла
            x = 0.05 * math.cos(t)
            pts.append(E + Vector((sx * x, 0, 0.026 * math.sin(t) + 0.3 * x)))   # петля чуть задрана наружу
        for k in range(1, 7):
            _face(bm, lay, (K, pts[k], pts[k + 1]), (col_dark, col, col))
    tail = 0.09 if tattered else 0.13
    for sx in (-1, 1):
        j = rnd.uniform(-0.01, 0.01) if tattered else 0.0
        ti, to = K + Vector((sx * 0.006, 0, -0.004)), K + Vector((sx * 0.040, 0, -0.012))
        bo = K + Vector((sx * (0.062 + j), -0.004, -tail - (0.02 * rnd.random() if tattered else 0)))
        notch = K + Vector((sx * 0.040, -0.004, -tail + (0.045 if tattered else 0.030)))
        bi = K + Vector((sx * 0.014, -0.004, -tail - 0.012 - (0.03 * rnd.random() if tattered else 0)))
        _face(bm, lay, (ti, to, bo, notch, bi), (col_dark, col_dark, col, col, col))
    k0 = K + Vector((0, -0.006, 0))                              # узел
    ring = [K + Vector((math.cos(t) * 0.016, -0.006, math.sin(t) * 0.014)) for t in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
    for k in range(4):
        _face(bm, lay, (ring[k], ring[(k + 1) % 4], k0), (col_dark, col_dark, col))


def wreath(kind):
    """Венок: жгут-тор, листья веером по кольцу, цветы-звёздочки, бант с хвостами. kind: fresh | flower | withered."""
    cfg = WREATHS[kind]
    rnd = random.Random(cfg["seed"])
    bm = bmesh.new()
    lay = _lay(bm)
    C = Vector((0, 0, WREATH_R + WREATH_LIFT))
    base = Z.add_torus(bm, Matrix.Translation(C), WREATH_R, 0.024, seg=20, ring=5, mi=0)
    Z.paint(bm, base, (0.025, 0.03, 0.012))
    c0, c1 = cfg["leaf"]
    for i in range(cfg["leaves"]):
        a = i / cfg["leaves"] * math.tau + rnd.uniform(-0.05, 0.05)
        rad = Vector((math.cos(a), 0, math.sin(a)))
        tan = Vector((-math.sin(a), 0, math.cos(a)))
        p = C + rad * (WREATH_R + rnd.uniform(-0.022, 0.022)) + Vector((0, rnd.uniform(-0.024, 0.01), 0))
        beta = math.radians(rnd.uniform(15, 55))
        d = (tan * (1 if i % 2 else -1) * math.cos(beta) + rad * math.sin(beta) * rnd.choice((1, -1))
             + Vector((0, rnd.uniform(-0.3, 0.1), 0))).normalized()
        cc0, cc1 = _jit(c0, rnd), _jit(c1, rnd)
        if cfg["droop"] and rnd.random() < 0.35:                  # у увядшего часть листьев серо-бурая
            cc1 = _mix(cc1, (0.16, 0.14, 0.10), 0.6)
        _leaf(bm, lay, p, d, rnd.uniform(0.07, 0.11), rnd.uniform(0.018, 0.026), cc0, cc1)
    lo, hi = -90 + 30, -90 + 360 - 30                            # цветы — кроме нижней точки, там бант
    for i in range(cfg["flowers"]):
        a = math.radians(lo + (hi - lo) * (i + rnd.uniform(0.1, 0.9)) / cfg["flowers"])
        rad = Vector((math.cos(a), 0, math.sin(a)))
        p = C + rad * (WREATH_R + rnd.uniform(-0.01, 0.015)) + Vector((0, -0.035, 0))
        nrm = Vector((rad.x * 0.4, -1, rad.z * 0.4 - cfg["droop"] * 0.9))
        col, col_in = cfg["palette"][i % len(cfg["palette"])]
        _head(bm, lay, p, nrm, cfg["r"] * rnd.uniform(0.85, 1.15), cfg["petals"], _jit(col, rnd, 0.08), col_in, col_in, rnd)
    _bow(bm, lay, C + Vector((0, -0.045, -WREATH_R)), *cfg["ribbon"], rnd, cfg["tattered"])
    return bm


# ============================================================================ цветы
STEM = ((0.012, 0.05, 0.010), (0.035, 0.125, 0.022))
LEAF = ((0.010, 0.040, 0.008), (0.050, 0.150, 0.025))


def _clump_base(rnd, i, n, spread=0.03):
    a = i * math.tau / n + rnd.uniform(-0.3, 0.3)
    out = Vector((math.cos(a), math.sin(a), 0))
    return out, out * spread


def _basal(bm, lay, rnd, count, ln, w, droop=0.25):
    for k in range(count):
        a = k * math.tau / count + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, rnd.uniform(0.35, 0.7)))
        _blade(bm, lay, Vector((math.cos(a) * 0.01, math.sin(a) * 0.01, 0)), d, ln * rnd.uniform(0.7, 1.1), w,
               droop, _jit(LEAF[0], rnd), _jit(LEAF[1], rnd))


def daisies():
    """Полевые цветы: 5 ромашек (белые лепестки, жёлтая серединка), листья по стеблю и прикорневые."""
    rnd = random.Random(21)
    bm = bmesh.new()
    lay = _lay(bm)
    for i in range(5):
        out, base = _clump_base(rnd, i, 5)
        lean, h = rnd.uniform(0.04, 0.10), rnd.uniform(0.28, 0.46)
        pts = [base, base + out * lean * 0.3 + UP * h * 0.4, base + out * lean * 0.7 + UP * h * 0.75, base + out * lean + UP * h]
        _stem(bm, lay, pts, 0.0042, *STEM)
        _head(bm, lay, pts[-1], out * 0.5 + UP, 0.042, 9, (0.72, 0.70, 0.64), (0.55, 0.50, 0.35), (0.62, 0.42, 0.02),
              rnd, cup=0.10, width=0.30)
        for t in (0.35, 0.6):
            _blade(bm, lay, pts[1] if t < 0.5 else pts[2], out + UP * 0.5, 0.075, 0.009, 0.4, *LEAF)
    _basal(bm, lay, rnd, 7, 0.20, 0.014)
    return bm


def bluebells():
    """Колокольчики: 3 дугой изогнутых побега, на верхней части — свисающие пятигранные колокольчики; прикорневые листья."""
    rnd = random.Random(22)
    bm = bmesh.new()
    lay = _lay(bm)
    for i in range(3):
        out, base = _clump_base(rnd, i, 3, 0.025)
        h, arc = rnd.uniform(0.40, 0.54), rnd.uniform(0.07, 0.12)
        pts = [base, base + out * arc * 0.1 + UP * h * 0.4, base + out * arc * 0.4 + UP * h * 0.75, base + out * arc + UP * h * 0.95]
        _stem(bm, lay, pts, 0.0038, *STEM)
        for k in range(5):
            t = 0.38 + k * 0.12
            seg = min(int(t * 3), 2)
            P = pts[seg].lerp(pts[seg + 1], t * 3 - seg)
            az = k * 2.4 + i
            side = Vector((math.cos(az), math.sin(az), 0))
            attach = P + side * 0.022 - UP * 0.008                    # короткая ножка
            _stem(bm, lay, [P, attach], 0.0022, STEM[1], STEM[1])
            _bell(bm, lay, attach, (side * 0.45 - UP).normalized(), 0.034 * (1.0 - k * 0.06))
    _basal(bm, lay, rnd, 6, 0.26, 0.016, droop=0.35)
    return bm


def _bell(bm, lay, P, axis, s):
    """Колокольчик: пять граней, расширяется к кромке (лепестки по краю чуть отогнуты); axis — вниз от точки подвеса."""
    a, b = _frame(axis)
    n = 5
    rings = []
    for pos, rad, col in ((0.0, 0.0035, (0.07, 0.03, 0.22)), (0.45, 0.011 * s / 0.034, (0.16, 0.07, 0.38)),
                          (1.0, 0.017 * s / 0.034, (0.34, 0.22, 0.62))):
        rings.append(([P + axis * (s * pos) + (a * math.cos(k * math.tau / n) + b * math.sin(k * math.tau / n)) * rad
                       for k in range(n)], col))
    for r in range(2):
        (r0, c0), (r1, c1) = rings[r], rings[r + 1]
        for k in range(n):
            _face(bm, lay, (r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]), (c0, c0, c1, c1))
    cap, ccol = rings[0]
    for k in range(n):
        _face(bm, lay, (cap[k], cap[(k + 1) % n], P - axis * 0.004), (ccol, ccol, ccol))


def poppies():
    """Маки: 4 цветка на стеблях (красные чашечки с тёмной серединкой), одна склонившаяся почка, прикорневая розетка."""
    rnd = random.Random(23)
    bm = bmesh.new()
    lay = _lay(bm)
    for i in range(4):
        out, base = _clump_base(rnd, i, 4)
        lean, h = rnd.uniform(0.04, 0.09), rnd.uniform(0.30, 0.48)
        pts = [base, base + out * lean * 0.3 + UP * h * 0.4, base + out * lean * 0.7 + UP * h * 0.75, base + out * lean + UP * h]
        _stem(bm, lay, pts, 0.0045, (0.012, 0.045, 0.010), (0.03, 0.10, 0.02))
        _head(bm, lay, pts[-1], out * 0.6 + UP, 0.05, 4, (0.52, 0.03, 0.02), (0.10, 0.008, 0.008), (0.012, 0.012, 0.012),
              rnd, cup=0.35, width=0.75)
        _blade(bm, lay, pts[1], out + UP * 0.4, 0.07, 0.012, 0.3, *LEAF)
    out, base = _clump_base(rnd, 5, 6, 0.05)                                      # почка на склонившемся стебле
    pts = [base, base + UP * 0.2, base + out * 0.05 + UP * 0.31, base + out * 0.075 + UP * 0.28]
    _stem(bm, lay, pts, 0.004, (0.012, 0.045, 0.010), (0.04, 0.10, 0.02))
    res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0,
                                     matrix=Matrix.Translation(pts[-1] - UP * 0.012) @ Matrix.Diagonal((0.014, 0.014, 0.022, 1)))
    Z.paint(bm, Z._faces_of(res["verts"]), (0.06, 0.12, 0.03))
    _basal(bm, lay, rnd, 6, 0.17, 0.026, droop=0.3)
    return bm
