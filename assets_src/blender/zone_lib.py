"""Зона «Старое кладбище»: детальная геометрия по шагам (build_ground(), build_fence(), ...).

Вызывается из окна Blender (через MCP) по одному шагу — прогресс виден вживую — и целиком
через build_all(). Все меши строятся в мировых координатах, origin объектов = (0, 0, 0).
Бесшовные текстуры (tile_*, sign_gate_a) создаёт zone_textures.py.

Карта зоны (Blender, метры; glTF: x, y_up=z, z=-y): земля ±20, ограда по ±19.5, въезд на юге
(y=-19.5, проём между столбами ±1.75), главная тропа x=0 от ворот на север, поперечная y=4.
"""
import math
import os
import random
import re
import ast

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.environ.get("NK_ASSETS", r"D:\dev\denisovLoh\assets_src\blender")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(REPO, "assets_src", "textures_src")
OUT_GLB = os.path.join(REPO, "public", "models", "zone_old_cemetery.glb")
PRESET = os.path.join(HERE, "night_keeper_glb_preset.py")
ZONE = 19.5          # ограда
HALF = 20.0          # земля
GATE_X = 1.75        # воротные столбы


# ============================================================================ материалы
def _image(name, colorspace):
    img = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
    img.reload()
    img.colorspace_settings.name = colorspace
    return img


def _gltf_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def _fresh(name, culling):
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = culling
    m.node_tree.nodes.clear()
    return m


def tile_material(name, tile, culling=True, vcolor=False):
    """PBR из набора {tile}_albedo/normal/orm.jpg; vcolor — умножить albedo на цвет вершин (атрибут «Color»)."""
    m = _fresh(name, culling)
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf, out = N.new("ShaderNodeBsdfPrincipled"), N.new("ShaderNodeOutputMaterial")
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    alb = N.new("ShaderNodeTexImage")
    alb.image = _image(f"{tile}_albedo.jpg", "sRGB")
    color = alb.outputs["Color"]
    if vcolor:
        vc = N.new("ShaderNodeVertexColor")
        vc.layer_name = "Color"
        mx = N.new("ShaderNodeMix")
        mx.data_type, mx.blend_type = "RGBA", "MULTIPLY"
        mx.inputs[0].default_value = 1.0
        L.new(alb.outputs["Color"], mx.inputs[6])
        L.new(vc.outputs["Color"], mx.inputs[7])
        color = mx.outputs[2]
    L.new(color, bsdf.inputs["Base Color"])
    nm = N.new("ShaderNodeNormalMap")
    nimg = N.new("ShaderNodeTexImage")
    nimg.image = _image(f"{tile}_normal.jpg", "Non-Color")
    L.new(nimg.outputs["Color"], nm.inputs["Color"])
    L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    sep, orm = N.new("ShaderNodeSeparateColor"), N.new("ShaderNodeTexImage")
    orm.image = _image(f"{tile}_orm.jpg", "Non-Color")
    L.new(orm.outputs["Color"], sep.inputs["Color"])
    L.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    L.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = N.new("ShaderNodeGroup")
    grp.node_tree = _gltf_group()
    L.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    return m


def flat_material(name, rgb=(1, 1, 1), rough=0.8, metal=0.0, emission=None, culling=True, vcolor=False):
    """Материал без текстур (цвет/металл/свечение); rgb — линейный."""
    m = _fresh(name, culling)
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf, out = N.new("ShaderNodeBsdfPrincipled"), N.new("ShaderNodeOutputMaterial")
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if vcolor:
        vc = N.new("ShaderNodeVertexColor")
        vc.layer_name = "Color"
        L.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    m.diffuse_color = (*rgb, 1.0)
    return m


def mats(force=False):
    """Все материалы зоны. Уже созданные переиспользуются (иначе у готовых мешей слетают слоты)."""
    spec = {
        "grass": ("mat_tile_grass", lambda n: tile_material(n, "tile_grass", vcolor=True)),
        "path": ("mat_tile_path", lambda n: tile_material(n, "tile_path")),
        "wood": ("mat_tile_wood", lambda n: tile_material(n, "tile_wood")),
        "bark": ("mat_tile_bark", lambda n: tile_material(n, "tile_bark")),
        "stone": ("mat_tile_stone", lambda n: tile_material(n, "tile_stone")),
        "sign": ("mat_sign_gate_a", lambda n: tile_material(n, "sign_gate_a")),
        "foliage": ("mat_foliage", lambda n: flat_material(n, rough=0.9, vcolor=True)),
        "blades": ("mat_grass_blades", lambda n: flat_material(n, rough=0.9, vcolor=True, culling=False)),
        "metal": ("mat_iron", lambda n: flat_material(n, (0.025, 0.025, 0.03), rough=0.55, metal=0.7)),
        "glass": ("mat_lantern_glass", lambda n: flat_material(n, (1.0, 0.45, 0.1), rough=0.3,
                                                              emission=((1.0, 0.45, 0.12), 6.0))),
    }
    return {k: (None if force else bpy.data.materials.get(n)) or mk(n) for k, (n, mk) in spec.items()}


# ============================================================================ примитивы
def collection():
    return bpy.data.collections["Collection"]


def clear(*prefixes):
    for o in list(bpy.data.objects):
        if any(o.name.startswith(p) for p in prefixes):
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if me is not None and me.users == 0:
                bpy.data.meshes.remove(me)


def _faces_of(verts):
    return list({f for v in verts for f in v.link_faces})


def box_uv(faces, bm, tile=1.0, off=(0.0, 0.0)):
    """Мировая проекция по доминирующей оси нормали; повтор текстуры каждые tile метров."""
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        f.normal_update()
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            x, y, z = lp.vert.co
            u, v = (x, y) if ax == 2 else ((x, z) if ax == 1 else (y, z))
            lp[uv].uv = (u / tile + off[0], v / tile + off[1])


def cyl_uv(faces, bm, cx, cy, tile=1.0):
    """Цилиндрическая проекция вокруг вертикальной оси (cx, cy), без разрывов на шве."""
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        f.normal_update()
        c = f.calc_center_median()
        tc = math.atan2(c.y - cy, c.x - cx)
        for lp in f.loops:
            x, y, z = lp.vert.co
            th = math.atan2(y - cy, x - cx)
            d = (th - tc + math.pi) % (2 * math.pi) - math.pi
            r = max(math.hypot(x - cx, y - cy), 0.05)
            lp[uv].uv = ((tc + d) * max(r, 0.2) / tile, z / tile)


def add_box(bm, c, s, M=None, tile=1.0, off=(0, 0), mi=0, uv=True):
    """Бокс с центром c (локальные координаты, M — матрица положения), размером s."""
    M = M or Matrix.Identity(4)
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=M @ Matrix.Translation(c) @ Matrix.Diagonal((*s, 1)))
    faces = _faces_of(res["verts"])
    for f in faces:
        f.material_index = mi
    if uv:
        box_uv(faces, bm, tile, off)
    return faces


def add_cone(bm, c, r1, r2, depth, seg=8, M=None, mi=0, tile=1.0, cyl=None, rz=0.0):
    """Усечённый конус/цилиндр с осью вдоль Z локальной системы; c — центр."""
    M = M or Matrix.Identity(4)
    mat = M @ Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z")
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=mat)
    faces = _faces_of(res["verts"])
    for f in faces:
        f.material_index = mi
    if cyl:
        cyl_uv(faces, bm, cyl[0], cyl[1], tile)
    else:
        box_uv(faces, bm, tile)
    return faces


def add_prism(bm, pts, depth, M, tile=1.0, off=(0, 0), mi=0):
    """Контур pts=(x,z) в плоскости XZ, выдавленный по Y на depth; M — положение в мире."""
    a = [bm.verts.new(M @ Vector((x, -depth / 2, z))) for x, z in pts]
    b = [bm.verts.new(M @ Vector((x, depth / 2, z))) for x, z in pts]
    faces = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = mi
    box_uv(faces, bm, tile, off)
    return faces


def paint(bm, faces, rgb, key="Color"):
    lay = bm.loops.layers.float_color.get(key) or bm.loops.layers.float_color.new(key)
    for f in faces:
        for lp in f.loops:
            lp[lay] = (*rgb, 1.0)


def paint_all(bm, rgb, key="Color"):
    paint(bm, list(bm.faces), rgb, key)


def finish(name, bm, materials, smooth=False):
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    collection().objects.link(o)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    return o, tris


# ============================================================================ просмотр
def focus(center=(0, 0, 0), dist=60, yaw=-28, pitch=58):
    win = bpy.context.window_manager.windows[0]
    area = max((a for a in win.screen.areas if a.type == "VIEW_3D"), key=lambda a: a.width * a.height)
    sp = area.spaces[0]
    sp.shading.type = "MATERIAL"
    sp.clip_end = 400
    r3d = sp.region_3d
    r3d.view_perspective = "PERSP"
    r3d.view_location = Vector(center)
    r3d.view_distance = dist
    r3d.view_rotation = Euler((math.radians(pitch), 0, math.radians(yaw))).to_quaternion()
    for a in win.screen.areas:
        a.tag_redraw()


# ============================================================================ шаги
def build_ground(M=None):
    """Земля 40×40: сетка 2 м, трава (tile 6 м), вертексные цвета ломают повтор текстуры."""
    M = M or mats()
    clear("ground_")
    rnd = random.Random(3)
    bm = bmesh.new()
    n = 20
    grid = [[bm.verts.new((-HALF + 2 * i, -HALF + 2 * j, 0.0)) for j in range(n + 1)] for i in range(n + 1)]
    faces = []
    for i in range(n):
        for j in range(n):
            faces.append(bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    box_uv(faces, bm, tile=6.0)
    lay = bm.loops.layers.float_color.new("Color")
    for f in faces:
        for lp in f.loops:
            x, y, _ = lp.vert.co
            # плавное макро-варьирование (без случайности на вершину — иначе видна клетчатость сетки)
            v = (0.88 + 0.10 * math.sin(x * 0.19 + 1.3) * math.cos(y * 0.15 + 0.4)
                 + 0.07 * math.sin(x * 0.071 + y * 0.113 + 2.0) + 0.05 * math.cos(x * 0.31 - y * 0.27))
            edge = min(1.0, (HALF - max(abs(x), abs(y))) / 6.0)      # к краю темнее
            k = max(0.40, v * (0.65 + 0.35 * edge))
            warm = 0.5 + 0.5 * math.sin(x * 0.11 - y * 0.09 + 0.7)   # где-то суше, где-то зеленее
            lp[lay] = (k * (0.95 + 0.12 * warm), k, k * (0.90 - 0.05 * warm), 1.0)
    for f in faces:
        f.material_index = 0
    o, t = finish("ground_old_cemetery", bm, [M["grass"]])
    return {"ground": t}


def _strip(name, pts, widths, z, mat, tile, seed):
    """Лента тропы по ломаной с неровными краями."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    rows = []
    for i, (p, w) in enumerate(zip(pts, widths)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        d = Vector((b[0] - a[0], b[1] - a[1], 0)).normalized()
        nrm = Vector((-d.y, d.x, 0))
        jl, jr = rnd.uniform(-0.22, 0.22), rnd.uniform(-0.22, 0.22)
        c = Vector((p[0], p[1], z))
        rows.append((bm.verts.new(c + nrm * (w / 2 + jl)), bm.verts.new(c - nrm * (w / 2 + jr))))
    faces = [bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0])) for i in range(len(rows) - 1)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        if f.normal.z < 0:
            f.normal_flip()
    box_uv(faces, bm, tile=tile)
    return finish(name, bm, [mat])


def build_paths(M=None):
    """Тропы: главная от ворот на север и поперечная; края неровные, чуть выше травы."""
    M = M or mats()
    clear("path_main_", "path_cross_")
    main_pts = [(0.4 * math.sin(i * 0.35), -HALF + 0.4 + i * 0.6) for i in range(61)]
    main_w = [2.5 + 0.25 * math.sin(i * 0.5) - (0.7 * max(0, i - 54) / 6) for i in range(61)]
    _, t1 = _strip("path_main_01", main_pts, main_w, 0.02, M["path"], 2.0, 1)
    cross_pts = [(-12 + i * 0.6, 4.0 + 0.3 * math.sin(i * 0.4)) for i in range(41)]
    cross_w = [2.0 * min(1.0, i / 4, (40 - i) / 4 + 0.15) + 0.25 for i in range(41)]
    _, t2 = _strip("path_cross_01", cross_pts, cross_w, 0.025, M["path"], 2.0, 2)
    return {"path_main": t1, "path_cross": t2}


def build_path_stones(M=None, count=80):
    """Плоские камни вдоль краёв троп — один меш."""
    M = M or mats()
    clear("path_stones_")
    rnd = random.Random(9)
    bm = bmesh.new()
    for _ in range(count):
        if rnd.random() < 0.65:   # вдоль главной тропы
            y = rnd.uniform(-18.5, 15.5)
            x = 0.4 * math.sin((y + HALF - 0.4) / 0.6 * 0.35) + rnd.choice((-1, 1)) * rnd.uniform(0.7, 1.6)
        else:                      # вдоль поперечной
            x = rnd.uniform(-11, 11)
            y = 4.0 + 0.3 * math.sin((x + 12) / 0.6 * 0.4) + rnd.choice((-1, 1)) * rnd.uniform(0.6, 1.4)
        rx, ry, rz = rnd.uniform(0.09, 0.22), rnd.uniform(0.07, 0.17), rnd.uniform(0.03, 0.07)
        mat = (Matrix.Translation((x, y, rz * 0.55)) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z")
               @ Matrix.Diagonal((rx, ry, rz, 1)))
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=mat)
        for v in res["verts"]:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.012
        box_uv(_faces_of(res["verts"]), bm, tile=1.0, off=(rnd.random(), rnd.random()))
    o, t = finish("path_stones_a", bm, [M["stone"]])
    return {"path_stones": t}


def build_fence(M=None):
    """Деревянная штакетная ограда: столбы с навершиями, 2 перекладины, штакеты с остриями, часть сломана."""
    M = M or mats()
    clear("fence_")
    rnd = random.Random(5)
    segs = {
        "fence_wood_01": ((-ZONE, ZONE), (ZONE, ZONE)),                   # север
        "fence_wood_02": ((ZONE, -ZONE), (ZONE, ZONE)),                   # восток
        "fence_wood_03": ((-ZONE, -ZONE), (-ZONE, ZONE)),                 # запад
        "fence_wood_04": ((-ZONE, -ZONE), (-GATE_X - 0.25, -ZONE)),       # юг слева от ворот
        "fence_wood_05": ((GATE_X + 0.25, -ZONE), (ZONE, -ZONE)),         # юг справа
    }
    stats = {}
    for name, (p0, p1) in segs.items():
        d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0))
        L = d.length
        S = Matrix.Translation((p0[0], p0[1], 0)) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, "Z")
        bm = bmesh.new()
        bays = max(1, round(L / 3.0))
        step = L / bays
        for i in range(bays + 1):                                         # столбы
            lean = Matrix.Rotation(rnd.uniform(-0.03, 0.03), 4, "X") @ Matrix.Rotation(rnd.uniform(-0.03, 0.03), 4, "Y")
            P = S @ Matrix.Translation((i * step, 0, 0)) @ lean
            add_box(bm, (0, 0, 0.78), (0.15, 0.15, 1.56), P, tile=1.0)
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.13, radius2=0.0, depth=0.17,
                                        matrix=P @ Matrix.Translation((0, 0, 1.56 + 0.085)) @ Matrix.Rotation(math.pi / 4, 4, "Z"))
            box_uv(_faces_of(res["verts"]), bm, 1.0)
        for i in range(bays):                                             # перекладины
            for z in (0.36, 0.96):
                add_box(bm, ((i + 0.5) * step, 0.07, z + rnd.uniform(-0.02, 0.02)), (step, 0.05, 0.075), S, tile=1.0)
        x = 0.16
        while x < L - 0.1:                                                # штакеты
            k = (x / step) % 1.0
            near_post = min(k, 1 - k) * step < 0.11
            if not near_post and rnd.random() > 0.05:                     # 5% выпали
                broken = rnd.random() < 0.05
                h = rnd.uniform(1.12, 1.30) * (0.55 if broken else 1.0)
                tip = 0.0 if broken else 0.10
                pts = [(-0.05, 0.0), (0.05, 0.0), (0.05, h)] + ([] if broken else [(0.0, h + tip)]) + [(-0.05, h)]
                P = (S @ Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(rnd.uniform(-0.05, 0.05), 4, "X")
                     @ Matrix.Rotation(rnd.uniform(-0.03, 0.03), 4, "Y"))
                add_prism(bm, pts, 0.03, P, tile=0.5, off=(rnd.random(), 0.0))
            x += 0.2
        o, t = finish(name, bm, [M["wood"]])
        stats[name] = t
    return stats


def build_gate(M=None):
    """Каменные столбы с навершиями, балка и подвесная табличка «СТАРОЕ КЛАДБИЩЕ» (читается с обеих сторон)."""
    M = M or mats()
    clear("gate_")
    y = -ZONE
    stats = {}
    for k, sx in enumerate((-GATE_X, GATE_X), 1):
        bm = bmesh.new()
        T = Matrix.Translation((sx, y, 0))
        add_box(bm, (0, 0, 1.25), (0.5, 0.5, 2.5), T, tile=1.0)
        add_box(bm, (0, 0, 0.12), (0.64, 0.64, 0.24), T, tile=1.0)          # цоколь
        add_box(bm, (0, 0, 2.56), (0.66, 0.66, 0.12), T, tile=1.0)          # плита-оголовок
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.40, radius2=0.0, depth=0.3,
                                    matrix=T @ Matrix.Translation((0, 0, 2.62 + 0.15)) @ Matrix.Rotation(math.pi / 4, 4, "Z"))
        box_uv(_faces_of(res["verts"]), bm, 1.0)
        _, t = finish(f"gate_pillar_0{k}", bm, [M["stone"]])
        stats[f"gate_pillar_0{k}"] = t
    bm = bmesh.new()                                                       # балка и цепи
    add_box(bm, (0, y, 2.25), (2 * GATE_X, 0.14, 0.17), tile=1.0)
    for cx in (-0.7, 0.7):
        add_box(bm, (cx, y, 2.075), (0.025, 0.025, 0.26), tile=1.0, mi=1)
    _, t = finish("gate_beam_a", bm, [M["wood"], M["metal"]])
    stats["gate_beam_a"] = t
    bm = bmesh.new()                                                       # табличка 1.7×0.425, UV = вся лицевая сторона
    w, h, th, zc = 1.7, 0.425, 0.03, 1.74
    uv = bm.loops.layers.uv.verify()
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, y, zc)) @ Matrix.Diagonal((w, th, h, 1)))
    for f in _faces_of(res["verts"]):
        f.normal_update()
        n = f.normal
        for lp in f.loops:
            x, _, z = lp.vert.co
            u, v = (x + w / 2) / w, (z - (zc - h / 2)) / h
            if abs(n.y) > 0.5:
                lp[uv].uv = (u if n.y < 0 else 1 - u, v)               # с обеих сторон текст читается
            else:
                lp[uv].uv = (0.01 + 0.02 * u, 0.1 + 0.8 * v)           # торцы — чистое дерево
    _, t = finish("gate_sign_a", bm, [M["sign"]])
    stats["gate_sign_a"] = t
    return stats


def _foliage_color(rnd, t):
    """Цвет грани листвы (линейный): t∈[0,1] — высота внутри кроны; сверху светлее."""
    lo, hi = Vector((0.010, 0.040, 0.020)), Vector((0.050, 0.140, 0.035))
    c = lo.lerp(hi, min(1.0, max(0.0, t * 0.85 + rnd.uniform(-0.12, 0.12))))
    return tuple(c * rnd.uniform(0.9, 1.1))


def _crown(bm, rnd, base, blobs, scale=1.0):
    faces_all = []
    zs = [b[2] * scale + base.z for b in blobs]
    zmin, zmax = min(zs) - 1.0, max(zs) + 1.0
    for dx, dy, dz, rx, ry, rz in blobs:
        c = base + Vector((dx, dy, dz)) * scale
        mat = Matrix.Translation(c) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z") @ Matrix.Diagonal((rx * scale, ry * scale, rz * scale, 1))
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0, matrix=mat)
        for v in res["verts"]:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.20 * scale
        faces = _faces_of(res["verts"])
        for f in faces:
            f.material_index = 1
            f.normal_update()
        paint(bm, [f for f in faces], (0, 0, 0))
        lay = bm.loops.layers.float_color.get("Color")
        for f in faces:
            t = (f.calc_center_median().z - zmin) / (zmax - zmin)
            col = _foliage_color(rnd, t)
            for lp in f.loops:
                lp[lay] = (*col, 1.0)
        faces_all += faces
    return faces_all


def build_trees(M=None):
    """Два лиственных дерева из граней (как на референсе) и сухое дерево."""
    M = M or mats()
    clear("tree_")
    stats = {}
    crown = [(0, 0, 5.3, 1.8, 1.8, 1.35), (1.4, 0.3, 4.4, 1.4, 1.3, 1.05), (-1.3, -0.4, 4.6, 1.5, 1.4, 1.15),
             (0.4, 1.3, 4.3, 1.3, 1.2, 0.95), (-0.3, -1.4, 4.2, 1.3, 1.2, 0.95), (0.2, 0.1, 6.4, 1.05, 1.05, 0.95),
             (1.6, -1.1, 5.0, 1.05, 0.95, 0.85), (-1.5, 1.0, 5.2, 1.0, 1.0, 0.9)]
    for name, pos, scale, seed in (("tree_oak_a", (-11.0, 8.0), 1.0, 41), ("tree_oak_b", (12.0, -7.0), 0.8, 42)):
        rnd = random.Random(seed)
        bm = bmesh.new()
        base = Vector((pos[0], pos[1], 0))
        T = Matrix.Translation(base) @ Matrix.Diagonal((scale, scale, scale, 1))
        cx, cy = pos
        add_cone(bm, (0, 0, 1.75), 0.40, 0.20, 3.5, seg=8, M=T, tile=1.0, cyl=(cx, cy), rz=rnd.uniform(0, 1))
        add_cone(bm, (0, 0, 0.22), 0.66, 0.40, 0.45, seg=8, M=T, tile=1.0, cyl=(cx, cy))
        for az, tilt, ln in ((20, 38, 2.1), (150, 44, 1.9), (260, 34, 2.2)):
            B = T @ Matrix.Translation((0, 0, 2.6)) @ Matrix.Rotation(math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "Y")
            add_cone(bm, (0, 0, ln / 2), 0.17, 0.07, ln, seg=6, M=B, tile=1.0)
        for f in bm.faces:
            f.material_index = 0
        _crown(bm, rnd, base, crown, scale)
        _, t = finish(name, bm, [M["bark"], M["foliage"]])
        stats[name] = t
    # сухое дерево
    rnd = random.Random(43)
    bm = bmesh.new()
    cx, cy = 13.0, 13.0
    T = Matrix.Translation((cx, cy, 0))
    add_cone(bm, (0, 0, 2.6), 0.34, 0.14, 5.2, seg=10, M=T, cyl=(cx, cy), rz=0.4)
    add_cone(bm, (0, 0, 0.2), 0.58, 0.34, 0.4, seg=10, M=T, cyl=(cx, cy))
    for z0, az, tilt, ln, r in [(2.4, 20, 52, 2.4, 0.14), (3.1, 140, 46, 2.1, 0.12), (3.7, 250, 40, 2.3, 0.11),
                                (4.2, 70, 28, 1.6, 0.08), (3.4, 320, 62, 1.5, 0.08), (4.8, 200, 18, 1.2, 0.06),
                                (5.0, 330, 30, 1.0, 0.05)]:
        B = T @ Matrix.Translation((0, 0, z0)) @ Matrix.Rotation(math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "Y")
        add_cone(bm, (0, 0, ln / 2), r, r * 0.22, ln, seg=6, M=B, tile=1.0)
        for tz, taz, ttilt in ((0.55, 40, 50), (0.8, -50, 40)):          # веточки
            Bt = B @ Matrix.Translation((0, 0, ln * tz)) @ Matrix.Rotation(math.radians(taz), 4, "Z") @ Matrix.Rotation(math.radians(ttilt), 4, "Y")
            add_cone(bm, (0, 0, ln * 0.2), r * 0.35, 0.012, ln * 0.4, seg=4, M=Bt, tile=1.0)
    _, t = finish("tree_dead_a", bm, [M["bark"]])
    stats["tree_dead_a"] = t
    return stats


def build_lamp(M=None):
    """Деревянный фонарный столб с кронштейном и подвесным фонарём (светящееся стекло)."""
    M = M or mats()
    clear("lamp_")
    bm = bmesh.new()
    T = Matrix.Translation((3.5, -10.0, 0))
    add_box(bm, (0, 0, 0.15), (0.34, 0.34, 0.3), T, tile=1.0)                       # основание
    add_box(bm, (0, 0, 1.8), (0.2, 0.2, 3.3), T, tile=1.0)                          # столб
    add_box(bm, (-0.5, 0, 3.22), (1.1, 0.12, 0.13), T, tile=1.0)                    # кронштейн к тропе (-X)
    add_box(bm, (-0.25, 0, 2.95), (0.62, 0.09, 0.09), T @ Matrix.Rotation(math.radians(0), 4, "Y"), tile=1.0)
    brace = T @ Matrix.Translation((-0.28, 0, 2.95)) @ Matrix.Rotation(math.radians(-42), 4, "Y")
    add_box(bm, (0, 0, 0), (0.55, 0.08, 0.08), brace, tile=1.0)
    lx = -1.0                                                                       # фонарь висит на конце кронштейна
    add_box(bm, (lx, 0, 3.05), (0.02, 0.02, 0.22), T, tile=1.0, mi=1)                # подвес
    add_box(bm, (lx, 0, 2.62), (0.30, 0.30, 0.04), T, tile=1.0, mi=1)                # дно
    for sx in (-0.13, 0.13):
        for sy in (-0.13, 0.13):
            add_box(bm, (lx + sx, sy, 2.82), (0.03, 0.03, 0.38), T, tile=1.0, mi=1)  # стойки
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.26, radius2=0.03, depth=0.2,
                                matrix=T @ Matrix.Translation((lx, 0, 3.12)) @ Matrix.Rotation(math.pi / 4, 4, "Z"))
    for f in _faces_of(res["verts"]):
        f.material_index = 1
    add_box(bm, (lx, 0, 2.82), (0.22, 0.22, 0.34), T, uv=False, mi=2)               # стекло (светится)
    _, t = finish("lamp_post_a", bm, [M["wood"], M["metal"], M["glass"]])
    return {"lamp_post_a": t, "light_at_blender": (3.5 + lx, -10.0, 2.82)}


def build_bench(M=None):
    """Скамья: сиденье из трёх досок, спинка из двух, боковые рамы."""
    M = M or mats()
    clear("bench_")
    bm = bmesh.new()
    T = Matrix.Translation((-4.5, -6.0, 0)) @ Matrix.Rotation(math.radians(12), 4, "Z")
    for dy in (-0.16, 0.0, 0.16):
        add_box(bm, (0, dy, 0.46), (1.7, 0.14, 0.045), T, tile=1.0, off=(dy, 0))
    for dz in (0.76, 0.94):
        add_box(bm, (0, 0.27, dz), (1.7, 0.04, 0.14), T @ Matrix.Rotation(math.radians(-8), 4, "X"), tile=1.0)
    for sx in (-0.75, 0.75):
        add_box(bm, (sx, 0.0, 0.22), (0.07, 0.5, 0.44), T, tile=1.0)                 # боковая рама
        add_box(bm, (sx, 0.26, 0.72), (0.07, 0.05, 0.6), T @ Matrix.Rotation(math.radians(-8), 4, "X"), tile=1.0)
    add_box(bm, (0, 0.2, 0.18), (1.5, 0.04, 0.05), T, tile=1.0)                      # поперечина
    _, t = finish("bench_wood_a", bm, [M["wood"]])
    return {"bench_wood_a": t}


def build_grass(M=None, tufts=420, seed=17):
    """Пучки травы: острые листья, тёмный низ и светлые кончики; 4 меша по четвертям зоны."""
    M = M or mats()
    clear("grass_tufts_")
    rnd = random.Random(seed)
    bms = {q: bmesh.new() for q in range(4)}
    placed = 0
    while placed < tufts:
        x, y = rnd.uniform(-18.8, 18.8), rnd.uniform(-18.8, 18.8)
        if abs(x - 0.4 * math.sin((y + 19.6) / 0.6 * 0.35)) < 1.9:                   # не на главной тропе
            continue
        if abs(y - 4.0) < 1.7 and abs(x) < 12.5:                                     # не на поперечной
            continue
        if abs(x) < 2.6 and y < -17.5:                                               # не в проёме ворот
            continue
        q = (0 if x < 0 else 1) + (0 if y < 0 else 2)
        bm = bms[q]
        lay = bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")
        scale = rnd.uniform(0.7, 1.3)
        for _ in range(rnd.randint(5, 8)):
            a = rnd.uniform(0, 6.28)
            ox, oy = x + math.cos(a) * rnd.uniform(0, 0.08), y + math.sin(a) * rnd.uniform(0, 0.08)
            h, w = rnd.uniform(0.16, 0.36) * scale, rnd.uniform(0.035, 0.055)
            bend = rnd.uniform(0.04, 0.13) * scale
            d = Vector((math.cos(a), math.sin(a), 0))
            side = Vector((-d.y, d.x, 0)) * w
            p0, p1, p2 = Vector((ox, oy, 0)) - side, Vector((ox, oy, 0)) + side, Vector((ox, oy, 0)) + d * bend
            p2.z = h
            vs = [bm.verts.new(p0), bm.verts.new(p1), bm.verts.new(p2)]
            f = bm.faces.new(vs)
            low, tip = (0.010, 0.035, 0.008), (0.075, 0.20, 0.035)
            for lp, c in zip(f.loops, (low, low, tip)):
                lp[lay] = (*c, 1.0)
        placed += 1
    stats = {}
    for q, bm in bms.items():
        _, t = finish(f"grass_tufts_0{q + 1}", bm, [M["blades"]], smooth=False)
        stats[f"grass_tufts_0{q + 1}"] = t
    return stats


STEPS = [build_ground, build_paths, build_path_stones, build_fence, build_gate, build_trees, build_lamp,
         build_bench, build_grass]


def build_all():
    M = mats()
    out = {}
    for fn in STEPS:
        out[fn.__name__] = fn(M)
    return out


# ============================================================================ экспорт
def export_settings():
    s = {}
    for line in open(PRESET, encoding="utf-8"):
        m = re.match(r"^op\.(\w+)\s*=\s*(.+)$", line.strip())
        if m:
            s[m.group(1)] = ast.literal_eval(m.group(2))
    return s


def export_zone():
    bpy.ops.object.select_all(action="DESELECT")
    s = export_settings()
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    if "export_vertex_color" in props.keys():
        s["export_vertex_color"] = "MATERIAL"
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, **s)
    return os.path.getsize(OUT_GLB) // 1024
