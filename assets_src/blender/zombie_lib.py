"""Зомби (враждебный моб) по арт-листу: сутулый, худой, рваная одежда, голые рёбра, оскал, голодный взгляд.

Модель — иерархия жёстких частей с шарнирами в суставах (таз → торс → голова / плечи → предплечья; таз → бёдра → голени),
цвета — вершинами, глаза — отдельный светящийся материал. Анимация — один зацикленный клип «walk» (шаркающая походка),
который игра проигрывает сама (SceneManager.startAnimations). origin — на земле между ступнями, лицом к −Y Blender (+Z glTF).

Вызывается из окна Blender по шагам (прогресс виден вживую):
    import sys, importlib; sys.path.insert(0, r"D:\\dev\\denisovLoh\\assets_src\\blender")
    import zombie_lib as ZL; importlib.reload(ZL); ZL.build_zombie(); ZL.animate_walk(); ZL.export()
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import zone_lib as Z

NAME = "zombie_walker_a"
DISPLAY_POS = (-4.5, -27.0, 0.0)          # место в сцене props_kit.blend (в .glb не попадает)

# ---- цвета (линейные): бледная серо-зелёная кожа, синеватая куртка, бурые штаны, тёмные ботинки
SKIN, GRAY, BRUISE, WOUND, BONE = (0.13, 0.20, 0.10), (0.20, 0.22, 0.17), (0.12, 0.10, 0.15), (0.21, 0.03, 0.03), (0.45, 0.42, 0.33)
JACKET, JACKET2, PANTS, PANTS2, BOOT = (0.040, 0.055, 0.078), (0.070, 0.062, 0.050), (0.085, 0.060, 0.042), (0.060, 0.045, 0.034), (0.034, 0.025, 0.020)
HAIR, DARK = (0.10, 0.095, 0.085), (0.008, 0.008, 0.008)
HEAD_SCALE = 1.18                          # голова крупнее нормы — читается издалека


def mix(a, b, k):
    k = min(max(k, 0.0), 1.0)
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


def _n(x, y, z, k=1.0):
    """Дешёвый детерминированный «шум» −1…1 для пятен на коже и ткани."""
    return math.sin(x * 31 + k) * math.sin(y * 27 + 2 * k) * math.sin(z * 23 + 3 * k)


def skin(p, k=1.0):
    x, y, z = p
    c = SKIN
    n = _n(x, y, z, k)
    if n > 0.3:
        c = mix(c, GRAY, (n - 0.3) * 2.5)
    m = _n(x * 1.7, y * 1.3, z * 1.9, k + 5)
    if m > 0.5:
        c = mix(c, BRUISE, (m - 0.5) * 3)
    w = _n(x * 2.3, y * 2.1, z * 2.7, k + 9)
    if w > 0.7:
        c = mix(c, WOUND, (w - 0.7) * 5)
    return c


def cloth(p, base, alt, k=1.0):
    x, y, z = p
    n = _n(x * 1.4, y * 1.4, z * 1.4, k)
    c = mix(base, alt, 0.5 + 0.8 * n)
    s = _n(x * 2.1, y * 1.8, z * 2.2, k + 4)
    if s > 0.62:
        c = mix(c, (0.07, 0.02, 0.015), (s - 0.62) * 4)               # бурые пятна
    return c


# ============================================================================ примитивы
def _lay(bm):
    return bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")


def paint(bm, faces, color, rnd=None, mi=None):
    """Цвет вершин: color — (x, y, z) → rgb либо готовый rgb; у каждой грани лёгкий разброс яркости."""
    lay = _lay(bm)
    for f in faces:
        j = rnd.uniform(0.9, 1.1) if rnd else 1.0
        if mi is not None:
            f.material_index = mi
        for lp in f.loops:
            c = color(lp.vert.co) if callable(color) else color
            lp[lay] = (*[min(1.0, v * j) for v in c], 1.0)


def loft(bm, rnd, rings, seg, color, caps=(True, True), mi=None):
    """Тело по сечениям: rings — [(z, rx, ry, cx, cy)], эллиптические кольца по seg вершин. Возвращает вершины колец."""
    rv = [[bm.verts.new((cx + rx * math.cos(k * math.tau / seg), cy + ry * math.sin(k * math.tau / seg), z))
           for k in range(seg)] for z, rx, ry, cx, cy in rings]
    faces = [bm.faces.new((rv[i][k], rv[i][(k + 1) % seg], rv[i + 1][(k + 1) % seg], rv[i + 1][k]))
             for i in range(len(rings) - 1) for k in range(seg)]
    if caps[0]:
        faces.append(bm.faces.new(rv[0][::-1]))
    if caps[1]:
        faces.append(bm.faces.new(rv[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    paint(bm, faces, color, rnd, mi)
    return rv


def hem(rnd, verts, amp):
    """Рваный подол: вершины кольца поочерёдно сдвигаются вверх/вниз."""
    for i, v in enumerate(verts):
        v.co.z += rnd.uniform(0.3, 1.0) * amp * (1 if i % 2 else -0.35)


def blob(bm, rnd, c, size, color, sub=1, jitter=0.10, mi=None):
    mat = Matrix.Translation(c) @ Matrix.Rotation(rnd.random() * 6.28, 4, "Z") @ Matrix.Diagonal((*size, 1.0))
    res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0, matrix=mat)
    for v in res["verts"]:
        v.co += Vector((rnd.uniform(-1, 1) * size[0], rnd.uniform(-1, 1) * size[1], rnd.uniform(-1, 1) * size[2])) * jitter
    paint(bm, Z._faces_of(res["verts"]), color, rnd, mi)


def box(bm, rnd, c, size, color, rot=(0, 0, 0), mi=None):
    mat = (Matrix.Translation(c) @ Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y")
           @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Diagonal((*size, 1.0)))
    paint(bm, Z._faces_of(bmesh.ops.create_cube(bm, size=1.0, matrix=mat)["verts"]), color, rnd, mi)


def spike(bm, rnd, a, b, r0, r1, color, seg=4, mi=None):
    """Конус между точками a и b (пальцы-когти, пряди волос, обломки костей)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    M = Matrix.Translation((a + b) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    paint(bm, Z._faces_of(bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=d.length, matrix=M)["verts"]),
          color, rnd, mi)


# ============================================================================ части тела (геометрия — вокруг шарнира, вниз по −Z)
def part_pelvis(rnd):
    bm = bmesh.new()
    pants = lambda p: cloth(p, PANTS, PANTS2, 2)
    loft(bm, rnd, [(-0.13, 0.150, 0.095, 0, 0), (-0.05, 0.168, 0.102, 0, 0), (0.04, 0.158, 0.098, 0, 0)], 10, pants)
    box(bm, rnd, (0, 0, 0.035), (0.34, 0.215, 0.026), DARK)                           # ремень
    box(bm, rnd, (0, -0.108, 0.035), (0.04, 0.012, 0.03), (0.15, 0.13, 0.08))          # пряжка
    return bm


def part_torso(rnd):
    bm = bmesh.new()

    def col(p):
        x, y, z = p
        torn = y < -0.05 and 0.07 < z < 0.43 and abs(x) < 0.115 + 0.035 * math.sin(z * 42)       # рубашка порвана спереди
        if torn:
            return skin(p, 2)
        c = cloth(p, JACKET, JACKET2, 3)
        return mix(c, skin(p, 2), 0.7) if (y > 0.04 and z < 0.12 and _n(x, y, z, 6) > 0.1) else c   # прорехи на спине

    loft(bm, rnd, [(0.0, 0.150, 0.096, 0, 0), (0.12, 0.162, 0.101, 0, 0), (0.28, 0.168, 0.106, 0, 0.004),
                   (0.44, 0.180, 0.114, 0, 0), (0.53, 0.186, 0.112, 0, 0), (0.60, 0.100, 0.080, 0, 0)], 10, col)
    for z in (0.17, 0.215, 0.26, 0.305, 0.345):                                          # рёбра в прорехе
        w = 0.125 - 0.012 * abs(z - 0.26) * 10
        box(bm, rnd, (0, -0.108 + 0.002 * abs(z - 0.26) * 10, z), (w, 0.014, 0.011), BONE, rot=(0.12, 0, 0))
    box(bm, rnd, (0, -0.112, 0.25), (0.018, 0.012, 0.20), BONE)                          # грудина
    for sx in (-1, 1):                                                                      # распахнутые лацканы рваной куртки
        box(bm, rnd, (sx * 0.128, -0.112, 0.32), (0.085, 0.016, 0.52), lambda p: cloth(p, JACKET, JACKET2, 16), rot=(0.10, sx * 0.20, sx * 0.08))
        for k in range(3):                                                                  # лохмотья на нижней кромке лацкана
            x0 = sx * (0.10 + 0.035 * k)
            spike(bm, rnd, (x0, -0.116, 0.07), (x0 + sx * 0.012, -0.122, -0.04 - 0.02 * k), 0.022, 0.004, cloth((x0, 0, 0.05), JACKET, JACKET2, 17), 3)
    box(bm, rnd, (0, 0.01, 0.585), (0.15, 0.13, 0.04), lambda p: cloth(p, JACKET, JACKET2, 18), rot=(-0.2, 0, 0))   # воротник
    rv = loft(bm, rnd, [(0.0, 0.158, 0.103, 0, 0), (-0.11, 0.172, 0.112, 0, 0.003)], 10,
              lambda p: cloth(p, JACKET, JACKET2, 7), caps=(False, False))                # подол куртки — рваный
    hem(rnd, rv[1], 0.05)
    return bm


def part_head(rnd):
    bm = bmesh.new()
    loft(bm, rnd, [(0.0, 0.040, 0.042, 0, 0), (0.12, 0.040, 0.044, 0, 0.004)], 8, lambda p: skin(p, 3), caps=(False, False))   # шея
    sk = lambda p: bone_patch(p)
    loft(bm, rnd, [(0.115, 0.056, 0.068, 0, -0.012), (0.15, 0.078, 0.090, 0, 0), (0.20, 0.087, 0.099, 0, 0.0),
                   (0.26, 0.082, 0.095, 0, 0.005), (0.305, 0.056, 0.066, 0, 0.010), (0.325, 0.022, 0.026, 0, 0.012)], 10, sk)
    for sx in (-1, 1):
        blob(bm, rnd, (sx * 0.037, -0.082, 0.205), (0.031, 0.024, 0.031), DARK)                        # глазницы
        blob(bm, rnd, (sx * 0.037, -0.094, 0.206), (0.0135, 0.010, 0.0135), (1, 1, 1), mi=1)           # светящиеся зрачки
        blob(bm, rnd, (sx * 0.088, 0.004, 0.185), (0.012, 0.028, 0.034), skin((sx, 1, 1), 3))          # уши
    for k in range(5):                                                                                  # верхние зубы по дуге
        a = (k - 2) * 0.30
        box(bm, rnd, (math.sin(a) * 0.045, -0.058 - 0.015 * math.cos(a), 0.130), (0.011, 0.008, 0.020), BONE)
    spike(bm, rnd, (0, -0.092, 0.182), (0, -0.108, 0.150), 0.018, 0.004, DARK)                       # нос — провал
    box(bm, rnd, (0, -0.052, 0.128), (0.080, 0.045, 0.030), (0.03, 0.005, 0.005))                       # тёмный провал рта
    box(bm, rnd, (0, -0.093, 0.255), (0.095, 0.012, 0.014), (0.07, 0.05, 0.05), rot=(0, 0.1, 0))      # нахмуренные брови
    for k in range(11):                                                                                # клочья волос
        a = k * 0.62 + rnd.uniform(-0.2, 0.2)
        r, z = 0.07 + 0.012 * rnd.random(), 0.27 + 0.03 * rnd.random()
        p = (math.sin(a) * r, math.cos(a) * r * 0.9 + 0.01, z)
        if p[1] < -0.04:
            continue
        spike(bm, rnd, p, (p[0] * 1.35, p[1] * 1.5 + 0.04, p[2] - rnd.uniform(0.07, 0.18)), 0.012, 0.003, HAIR, 3)
    bmesh.ops.scale(bm, vec=(HEAD_SCALE,) * 3, verts=bm.verts)
    return bm


def bone_patch(p):
    """Череп: серо-зелёная кожа, на висках и лбу — проплешины и раны до кости."""
    c = skin(p, 3)
    x, y, z = p
    t = _n(x * 2.6, y * 2.2, z * 3.0, 11)
    return mix(c, BONE, (t - 0.45) * 4) if t > 0.45 else c


def part_jaw(rnd):
    bm = bmesh.new()
    loft(bm, rnd, [(0.0, 0.050, 0.060, 0, -0.030), (-0.030, 0.040, 0.050, 0, -0.050), (-0.058, 0.022, 0.030, 0, -0.062)], 8,
         lambda p: skin(p, 4))
    for k in range(5):                                                                                  # нижние зубы
        a = (k - 2) * 0.30
        box(bm, rnd, (math.sin(a) * 0.043, -0.043 - 0.022 * math.cos(a), 0.012), (0.010, 0.008, 0.017), BONE)
    box(bm, rnd, (0, -0.02, 0.0), (0.07, 0.07, 0.012), (0.10, 0.02, 0.02))                              # нёбо/язык — тёмно-красное
    bmesh.ops.scale(bm, vec=(HEAD_SCALE,) * 3, verts=bm.verts)
    return bm


def part_upper_arm(rnd, side):
    bm = bmesh.new()
    sleeve = lambda p: cloth(p, JACKET, JACKET2, 8) if p[2] > -0.17 + 0.03 * math.sin(p[0] * 90 + p[1] * 70) else skin(p, 5 + side)
    loft(bm, rnd, [(0.0, 0.054, 0.054, 0, 0), (-0.12, 0.049, 0.049, 0, 0), (-0.30, 0.040, 0.040, 0, 0)], 8, sleeve)
    blob(bm, rnd, (0, 0, 0.0), (0.060, 0.058, 0.060), lambda p: cloth(p, JACKET, JACKET2, 9))           # плечо
    for k in range(6):                                                                                  # рваная кромка рукава
        a = k * math.tau / 6 + rnd.uniform(-0.2, 0.2)
        spike(bm, rnd, (math.cos(a) * 0.048, math.sin(a) * 0.048, -0.16), (math.cos(a) * 0.052, math.sin(a) * 0.052, -0.16 - rnd.uniform(0.05, 0.11)),
              0.016, 0.004, cloth((a, 0, -0.2), JACKET, JACKET2, 19), 3)
    return bm


def part_forearm(rnd, side):
    bm = bmesh.new()
    rv = loft(bm, rnd, [(0.0, 0.038, 0.038, 0, 0), (-0.14, 0.036, 0.034, 0, 0), (-0.28, 0.029, 0.027, 0, 0)], 8, lambda p: skin(p, 12 + side))
    blob(bm, rnd, (0, 0, 0.0), (0.043, 0.041, 0.043), lambda p: skin(p, 13))                            # локоть
    box(bm, rnd, (0, 0, -0.305), (0.068, 0.030, 0.075), lambda p: skin(p, 14))                          # ладонь
    for i, fx in enumerate((-0.024, -0.008, 0.008, 0.024)):                                              # длинные скрюченные пальцы
        ln = 0.085 + 0.012 * (1 - abs(i - 1.5))
        spike(bm, rnd, (fx, 0, -0.335), (fx * 1.4, -0.030, -0.335 - ln), 0.011, 0.004, mix(SKIN, BONE, 0.35), 4)
    spike(bm, rnd, (0.030 * (1 if side else -1), 0, -0.29), (0.050 * (1 if side else -1), -0.030, -0.335), 0.012, 0.004, mix(SKIN, BONE, 0.35), 4)  # большой палец
    return bm


def part_thigh(rnd, side):
    bm = bmesh.new()
    loft(bm, rnd, [(0.0, 0.086, 0.086, 0, 0), (-0.20, 0.078, 0.078, 0, 0), (-0.43, 0.058, 0.058, 0, 0)], 8,
         lambda p: skin(p, 25 + side) if (p[1] < -0.035 and p[2] < -0.31 and _n(p[0], p[1], p[2], 3) > -0.2) else cloth(p, PANTS, PANTS2, 20 + side))
    return bm


def part_shin(rnd, side):
    bm = bmesh.new()
    cut = -0.20
    col = lambda p: cloth(p, PANTS, PANTS2, 30 + side) if (p[2] > cut + 0.04 * math.sin(p[0] * 80 + p[1] * 60) and not (p[1] < -0.03 and p[2] > -0.07)) else skin(p, 15 + side)
    loft(bm, rnd, [(0.0, 0.058, 0.058, 0, 0), (-0.2, 0.051, 0.051, 0, 0), (-0.36, 0.042, 0.042, 0, 0)], 8, col, caps=(True, False))
    for k in range(7):                                                                                  # рваные штанины
        a = k * math.tau / 7 + rnd.uniform(-0.2, 0.2)
        spike(bm, rnd, (math.cos(a) * 0.052, math.sin(a) * 0.052, cut + 0.01), (math.cos(a) * 0.055, math.sin(a) * 0.055, cut - rnd.uniform(0.05, 0.10)), 0.016, 0.004, cloth((a, 0, -0.2), PANTS, PANTS2, 22), 3)
    rv = loft(bm, rnd, [(-0.30, 0.050, 0.050, 0, 0), (-0.43, 0.056, 0.062, 0, -0.004)], 8, lambda p: cloth(p, BOOT, (0.05, 0.04, 0.03), 40),
              caps=(False, True))                                                                       # голенище ботинка
    blob(bm, rnd, (0, 0, 0.0), (0.058, 0.056, 0.058), lambda p: cloth(p, PANTS, PANTS2, 41))             # колено
    box(bm, rnd, (0, -0.052, -0.465), (0.092, 0.22, 0.075), lambda p: cloth(p, BOOT, (0.05, 0.04, 0.03), 42))   # ступня
    box(bm, rnd, (0, -0.158, -0.482), (0.082, 0.07, 0.04), lambda p: cloth(p, BOOT, (0.05, 0.04, 0.03), 43), rot=(0.18, 0, 0))   # носок
    box(bm, rnd, (0, -0.052, -0.503), (0.094, 0.225, 0.014), DARK)                                         # подошва
    return bm


# ============================================================================ сборка
REST = {   # покой: углы (рад) вокруг X (вперёд = минус), Y, Z; смещение шарнира относительно родителя
    "pelvis": ((0, 0, 0.900), (0.0, 0, 0)),
    "torso": ((0, 0, 0.020), (0.42, 0, 0)),
    "head": ((0, 0, 0.600), (0.36, 0, 0.12)),
    "jaw": ((0, -0.002, 0.118 * 1.18), (0.40, 0, 0)),
    "upper_l": ((0.214, 0, 0.500), (-0.50, 0, -0.10)),
    "upper_r": ((-0.214, 0, 0.500), (-0.58, 0, 0.12)),
    "fore_l": ((0, 0, -0.300), (-0.78, 0, 0)),
    "fore_r": ((0, 0, -0.300), (-0.90, 0, 0)),
    "thigh_l": ((0.100, 0, -0.060), (-0.20, 0, 0.05)),
    "thigh_r": ((-0.100, 0, -0.060), (0.12, 0, -0.05)),
    "shin_l": ((0, 0, -0.430), (0.30, 0, 0)),
    "shin_r": ((0, 0, -0.430), (0.22, 0, 0)),
}
PARENT = {"pelvis": NAME, "torso": "pelvis", "head": "torso", "jaw": "head", "upper_l": "torso", "upper_r": "torso",
          "fore_l": "upper_l", "fore_r": "upper_r", "thigh_l": "pelvis", "thigh_r": "pelvis", "shin_l": "thigh_l", "shin_r": "thigh_r"}


def build_zombie(M=None):
    """Создаёт (заново) пустышку-корень и 12 частей с шарнирами; возвращает число треугольников."""
    M = M or Z.mats()
    for o in list(bpy.data.objects):
        if o.name == NAME or o.name.startswith(NAME + "_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):                                                  # осиротевшие меши прошлых сборок
        if me.name.startswith(NAME + "_") and me.users == 0:
            bpy.data.meshes.remove(me)
    eyes = bpy.data.materials.get("mat_zombie_eyes") or Z.flat_material(
        "mat_zombie_eyes", (0.9, 0.85, 0.3), rough=0.5, emission=((0.95, 0.88, 0.30), 4.0))
    rnd = random.Random(66)
    makers = {"pelvis": part_pelvis, "torso": part_torso, "head": part_head, "jaw": part_jaw,
              "upper_l": lambda r: part_upper_arm(r, 1), "upper_r": lambda r: part_upper_arm(r, 0),
              "fore_l": lambda r: part_forearm(r, 1), "fore_r": lambda r: part_forearm(r, 0),
              "thigh_l": lambda r: part_thigh(r, 1), "thigh_r": lambda r: part_thigh(r, 0),
              "shin_l": lambda r: part_shin(r, 1), "shin_r": lambda r: part_shin(r, 0)}
    root = bpy.data.objects.new(NAME, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.3
    root.location = DISPLAY_POS
    root.scale = (0.93,) * 3                                                    # рост с вытянутой головой ≈ 1.75 м
    Z.collection().objects.link(root)
    tris = 0
    objs = {NAME: root}
    for key, mk in makers.items():
        o, t = Z.finish(f"{NAME}_{key}", mk(rnd), [M["backdrop"], eyes])
        tris += t
        o.parent = objs[PARENT[key]]
        loc, rot = REST[key]
        o.location = loc
        o.rotation_mode = "XYZ"
        o.rotation_euler = rot
        objs[key] = o
    bpy.context.view_layer.update()
    return {"tris": tris, "parts": len(makers)}


def part(key):
    return bpy.data.objects[f"{NAME}_{key}"]


def pose(angles):
    """Покадровая поза для просмотра: {часть: (rx, ry, rz)} поверх покоя; без аргументов — вернуть покой."""
    for key, (loc, rot) in REST.items():
        o = part(key)
        o.location = loc
        o.rotation_euler = (angles or {}).get(key, rot)
    bpy.context.view_layer.update()


def attack_pose():
    """Поза «атака» с арт-листа: корпус вперёд, руки выброшены вперёд, голова вытянута, рот раскрыт."""
    pose({"torso": (0.50, 0, 0.0), "head": (0.42, 0, 0.10), "jaw": (0.55, 0, 0), "upper_l": (-1.30, 0, -0.15),
          "upper_r": (-1.15, 0, 0.18), "fore_l": (-0.35, 0, 0), "fore_r": (-0.55, 0, 0), "thigh_l": (-0.55, 0, 0.05),
          "thigh_r": (0.35, 0, -0.05), "shin_l": (0.25, 0, 0), "shin_r": (0.75, 0, 0)})


# ============================================================================ анимация: шаркающая походка, цикл 32 кадра (1.33 с)
def animate_walk():
    """Клип «walk»: ноги по очереди, руки качаются навстречу, корпус и голова болтаются, таз чуть подпрыгивает."""
    fps = bpy.context.scene.render.fps
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, 32
    keys = [(k * 4, k * math.tau / 8) for k in range(9)]                                                # 0, 4, …, 32 (последний = первому)
    for key, (loc, rot) in REST.items():
        o = part(key)
        o.animation_data_clear()
        for frame, ph in keys:
            s, c = math.sin(ph), math.cos(ph)
            r = list(rot)
            if key in ("thigh_l", "thigh_r"):
                sg = 1 if key == "thigh_l" else -1
                r[0] = rot[0] - sg * 0.50 * s
            elif key in ("shin_l", "shin_r"):
                sg = 1 if key == "shin_l" else -1
                r[0] = rot[0] + 0.15 + 0.60 * max(0.0, sg * math.sin(ph + 1.2))
            elif key in ("upper_l", "upper_r"):
                sg = 1 if key == "upper_l" else -1
                r[0] = rot[0] + sg * 0.28 * s
            elif key in ("fore_l", "fore_r"):
                sg = 1 if key == "fore_l" else -1
                r[0] = rot[0] - 0.12 * sg * math.sin(ph + 1.0)
            elif key == "torso":
                r[0], r[2] = rot[0] + 0.03 * math.sin(2 * ph), -0.10 * s
            elif key == "head":
                r[0], r[2] = rot[0] + 0.05 * math.sin(2 * ph + 0.8), rot[2] + 0.14 * math.sin(ph + 0.9)
            elif key == "jaw":
                r[0] = rot[0] + 0.10 + 0.10 * math.sin(2 * ph + 0.4)
            elif key == "pelvis":
                r[2] = 0.07 * s
            o.rotation_euler = r
            o.keyframe_insert("rotation_euler", frame=frame)
            if key == "pelvis":
                o.location = (0, 0, loc[2] - 0.022 * abs(c))
                o.keyframe_insert("location", frame=frame)
        ad = o.animation_data
        act = ad.action
        old = bpy.data.actions.get(f"walk_{o.name}")
        if old and old != act:
            bpy.data.actions.remove(old)
        act.name = f"walk_{o.name}"
        track = ad.nla_tracks.new()
        track.name = "walk"
        track.strips.new("walk", 0, act)
        ad.action = None
    pose(None)
    return {"frames": 32, "fps": fps}


def export():
    import props_kit
    return props_kit.export(NAME)
