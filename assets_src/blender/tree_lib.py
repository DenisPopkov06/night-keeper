"""Дуб на локации: густая крона из гранёных листовых «осколков» (как угловатая листва на арт-листе), без текстуры листвы.

Крона — несколько сотен плоских ромбов с цветом вершин (ромб = 2 треугольника, со сгибом по жилке — 4): рваный силуэт,
снизу видна листва и ветки, а не мешок из камней. Внутри — тёмные комья, чтобы крона не просвечивала насквозь.
Материал листвы — двусторонний на цветах вершин (zone_lib: mats()["crown"]); кора — тайловая текстура (zone_lib.add_cone).
"""
import math

import bmesh
from mathutils import Matrix, Vector

UPZ = Vector((0, 0, 1))


def mixc(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


def _faces_of(verts):
    return list({f for v in verts for f in v.link_faces})


def _face(bm, lay, pts, cols, mi):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    for lp, c in zip(f.loops, cols):
        lp[lay] = (*c, 1.0)
    f.material_index = mi
    return f


def rvec(rnd, amp=1.0):
    return Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amp


def runit(rnd):
    while True:
        v = rvec(rnd)
        if 0.05 < v.length <= 1.0:
            return v.normalized()


def shard(bm, lay, p, d, ln, w, c0, c1, fold, mi):
    """Ромб: основание p, направление d, длина ln, полуширина w на 45% длины, цвет c0 → c1 к кончику;
    fold > 0 — сгиб по жилке (4 треугольника, объёмнее)."""
    d = Vector(d).normalized()
    side = d.cross(UPZ)
    if side.length < 1e-3:
        side = d.cross(Vector((1, 0, 0)))
    side.normalize()
    tip, mid = p + d * ln, p + d * (ln * 0.45)
    left, right = mid - side * w, mid + side * w
    cm = mixc(c0, c1, 0.5)
    if fold > 0:
        m = mid + side.cross(d).normalized() * (w * fold)
        for pts, cols in (((p, left, m), (c0, cm, cm)), ((p, m, right), (c0, cm, cm)),
                          ((left, tip, m), (cm, c1, cm)), ((m, tip, right), (cm, c1, cm))):
            _face(bm, lay, pts, cols, mi)
    else:
        _face(bm, lay, (p, right, tip, left), (c0, cm, c1, cm), mi)


def blob(bm, lay, rnd, c, size, c0, c1, mi, jitter=0.14):
    """Гранёный ком (икосаэдр с шумом вершин; size — полуоси) с цветом вершин по высоте."""
    mat = Matrix.Translation(c) @ Matrix.Rotation(rnd.random() * 6.28, 4, "Z") @ Matrix.Diagonal((*size, 1.0))
    res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=mat)
    for v in res["verts"]:
        v.co += Vector((rnd.uniform(-1, 1) * size[0], rnd.uniform(-1, 1) * size[1], rnd.uniform(-1, 1) * size[2])) * jitter
    z0, z1 = c.z - size[2], c.z + size[2]
    for f in _faces_of(res["verts"]):
        f.material_index = mi
        for lp in f.loops:
            k = min(max((lp.vert.co.z - z0) / (z1 - z0), 0.0), 1.0)
            lp[lay] = (*mixc(c0, c1, k), 1.0)


def _leaf_colors(rnd, k):
    """Цвета листвы по относительной высоте k (0 — низ кроны, 1 — верх): снизу темнее, сверху светлее, редко жёлтые."""
    dark, light = (0.016, 0.044, 0.019), (0.062, 0.140, 0.034)
    c1 = mixc(dark, light, min(max(k * 0.85 + rnd.uniform(-0.12, 0.16), 0.0), 1.0))
    if rnd.random() < 0.07:
        c1 = (0.10, 0.15, 0.03)
    return mixc(c1, (0.008, 0.022, 0.011), 0.40), c1


def oak(bm, lay, rnd, cx, cy, s, add_cone):
    """Дуб: ствол с расширением (уходит в землю), пять сучьев с ответвлениями; крона — ≈400 листовых осколков у концов
    веток, по оболочке и свисающих снизу, плюс тёмные внутренние комья. Кора — material 0, листва — material 1."""
    T = Matrix.Translation((cx, cy, 0)) @ Matrix.Diagonal((s, s, s, 1))
    add_cone(bm, (0, 0, 1.8), 0.42, 0.24, 3.6, seg=9, M=T, tile=1.0, cyl=(cx, cy), rz=rnd.uniform(0, 1))
    add_cone(bm, (0, 0, 0.10), 0.72, 0.40, 0.70, seg=9, M=T, tile=1.0, cyl=(cx, cy))      # расширение, уходит в землю на 0.25 м
    tips = []
    az0 = rnd.uniform(0, 72)
    for k in range(5):
        az, tilt, ln, z0 = az0 + k * 72 + rnd.uniform(-14, 14), rnd.uniform(32, 54), rnd.uniform(2.5, 3.4), rnd.uniform(2.6, 3.4)
        B = Matrix.Translation((0, 0, z0)) @ Matrix.Rotation(math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "Y")
        add_cone(bm, (0, 0, ln / 2), 0.17, 0.07, ln, seg=6, M=T @ B, tile=1.0)
        tips.append(B @ Vector((0, 0, ln)))
        for sgn in (-1, 1):
            Bs = (B @ Matrix.Translation((0, 0, ln * 0.55)) @ Matrix.Rotation(math.radians(sgn * rnd.uniform(28, 42)), 4, "Z")
                  @ Matrix.Rotation(math.radians(rnd.uniform(20, 34)), 4, "Y"))
            sl = rnd.uniform(1.3, 1.9)
            add_cone(bm, (0, 0, sl / 2), 0.09, 0.03, sl, seg=5, M=T @ Bs, tile=1.0)
            tips.append(Bs @ Vector((0, 0, sl)))
    C, R = Vector((0, 0, 5.3)), (2.7, 2.7, 1.9)
    for _ in range(6):                                                                   # тёмное нутро кроны
        pos = C + Vector((rnd.uniform(-1.3, 1.3), rnd.uniform(-1.3, 1.3), rnd.uniform(-0.8, 0.8)))
        blob(bm, lay, rnd, T @ pos, (1.9 * s, 1.9 * s, 1.5 * s), (0.009, 0.022, 0.011), (0.024, 0.056, 0.024), 1)

    def leaf(p, d, ln, fold):
        c0, c1 = _leaf_colors(rnd, (p.z - (C.z - R[2])) / (2 * R[2]))
        shard(bm, lay, T @ p, (T.to_3x3() @ d), ln * s, ln * s * rnd.uniform(0.24, 0.36), c0, c1, fold, 1)

    for tip in tips:                                                                     # пучки у концов веток
        for n in range(16):
            p = tip + rvec(rnd, 0.62)
            out = p - C
            out.z *= 1.3
            leaf(p, out.normalized() + rvec(rnd, 0.8) + Vector((0, 0, -0.12)), rnd.uniform(0.85, 1.5), 0.25 if n % 2 else 0.0)
    for _ in range(130):                                                                 # оболочка кроны
        u = runit(rnd)
        r = rnd.uniform(0.68, 1.0)
        leaf(C + Vector((u.x * R[0] * r, u.y * R[1] * r, u.z * R[2] * r)), u + rvec(rnd, 0.7), rnd.uniform(0.9, 1.5), 0.0)
    for _ in range(55):                                                                  # свисающие снизу
        u = runit(rnd)
        u.z = -abs(u.z) * 0.8 - 0.25
        u.normalize()
        r = rnd.uniform(0.75, 1.0)
        leaf(C + Vector((u.x * R[0] * r, u.y * R[1] * r, u.z * R[2] * r)), Vector((u.x, u.y, u.z * 1.3)) + rvec(rnd, 0.5),
             rnd.uniform(0.9, 1.4), 0.0)
