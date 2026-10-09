"""Зона «Старое кладбище»: детальная геометрия по шагам (build_ground(), build_fence(), ...).

Земля и тропы — ОДНА уникальная текстура на всю зону (zone_textures.ground_unique): без тайлов и повторов.

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
import json

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


def unlit_material(name, rgb, alpha=None):
    """Неосвещаемый материал (glTF KHR_materials_unlit → MeshBasicMaterial): стекло, свеча, пламя фонаря.
    Точечный свет стоит прямо внутри фонаря — освещаемые поверхности в 10 см от него пересвечиваются в белое.
    Схема узлов — та, что экспортёр glTF узнаёт как unlit: [Transparent | LightPath-трюк(Emission)] по alpha."""
    m = _fresh(name, True)
    N, L = m.node_tree.nodes, m.node_tree.links
    out, emit, lp = N.new("ShaderNodeOutputMaterial"), N.new("ShaderNodeEmission"), N.new("ShaderNodeLightPath")
    emit.inputs["Color"].default_value = (*rgb, 1.0)
    cam = N.new("ShaderNodeMixShader")
    L.new(lp.outputs["Is Camera Ray"], cam.inputs[0])
    L.new(N.new("ShaderNodeBsdfTransparent").outputs[0], cam.inputs[1])
    L.new(emit.outputs[0], cam.inputs[2])
    shader = cam.outputs[0]
    if alpha is not None:
        mix = N.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = alpha
        L.new(N.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
        L.new(shader, mix.inputs[2])
        shader = mix.outputs[0]
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        else:
            m.blend_method = "BLEND"
    L.new(shader, out.inputs["Surface"])
    m.diffuse_color = (*rgb, 1.0 if alpha is None else alpha)
    return m


def mats(force=False):
    """Все материалы зоны. Уже созданные переиспользуются (иначе у готовых мешей слетают слоты)."""
    spec = {
        "ground": ("mat_ground_old_cemetery", lambda n: tile_material(n, "ground_old_cemetery")),
        "wood": ("mat_tile_wood", lambda n: tile_material(n, "tile_wood")),
        "bark": ("mat_tile_bark", lambda n: tile_material(n, "tile_bark")),
        "stone": ("mat_tile_stone", lambda n: tile_material(n, "tile_stone")),
        "sign": ("mat_sign_gate_a", lambda n: tile_material(n, "sign_gate_a")),
        "foliage": ("mat_foliage", lambda n: flat_material(n, rough=0.9, vcolor=True)),
        "blades": ("mat_grass_blades", lambda n: flat_material(n, rough=0.9, vcolor=True, culling=False)),
        "metal": ("mat_iron", lambda n: flat_material(n, (0.025, 0.025, 0.03), rough=0.55, metal=0.7)),
        "planks": ("mat_tile_planks", lambda n: tile_material(n, "tile_planks")),
        "shingles": ("mat_tile_shingles", lambda n: tile_material(n, "tile_shingles")),
        "stone_wall": ("mat_tile_stone_wall", lambda n: tile_material(n, "tile_stone_wall")),
        "cobble": ("mat_tile_cobble", lambda n: tile_material(n, "tile_cobble")),
        "iron": ("mat_tile_metal", lambda n: tile_material(n, "tile_metal")),
        "leaves": ("mat_tile_leaves", lambda n: tile_material(n, "tile_leaves", vcolor=True)),
        "clay": ("mat_tile_clay", lambda n: tile_material(n, "tile_clay")),
        "stone_vc": ("mat_tile_stone_moss", lambda n: tile_material(n, "tile_stone", vcolor=True)),
        "window": ("mat_window_glow", lambda n: flat_material(n, (1.0, 0.55, 0.2), rough=0.4,
                                                              emission=((1.0, 0.52, 0.18), 1.8))),
        "glass": ("mat_lantern_glass", lambda n: unlit_material(n, (1.0, 0.5, 0.14), alpha=0.5)),  # янтарное
        "flame": ("mat_candle_flame", lambda n: unlit_material(n, (1.0, 0.86, 0.5))),
        "candle": ("mat_candle_wax", lambda n: unlit_material(n, (0.85, 0.66, 0.42))),
    }
    return {k: (None if force else bpy.data.materials.get(n)) or mk(n) for k, (n, mk) in spec.items()}


# ============================================================================ примитивы
def collection():
    return bpy.data.collections["Collection"]


def clear(*prefixes):
    for o in list(bpy.data.objects):
        if any(o.name.startswith(p) for p in prefixes):
            data, kind = o.data, o.type
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if kind == "MESH":
                    bpy.data.meshes.remove(data)
                elif kind == "LIGHT":
                    bpy.data.lights.remove(data)


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
LAYOUT = os.path.join(REPO, "src", "levels", "zone_old_cemetery", "layout.json")
# препятствия (Blender x, y, радиус свободной зоны, м): фонарь, скамья, деревья, воротные столбы
OBSTACLES = [(3.5, -10.0, 0.9), (-4.5, -6.0, 1.3), (-11.0, 8.0, 0.8), (12.0, -7.0, 0.8), (13.0, 13.0, 0.7),
             (-GATE_X, -ZONE, 0.9), (GATE_X, -ZONE, 0.9), (7.4, 17.3, 0.9), (-2.6, 6.6, 1.0)]
HOUSE_YARD = (-4.6, 4.6, 11.7, 19.0)     # дом, крыльцо, брусчатка, ящики и бочки — сюда ничего не сажаем


def in_yard(x, y):
    x0, x1, y0, y1 = HOUSE_YARD
    return x0 < x < x1 and y0 < y < y1


def _smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def layout_objects():
    return json.load(open(LAYOUT, encoding="utf-8"))["objects"]


def graves():
    """Надгробия из layout.json в координатах Blender: (x, y, направление «лица» fx, fy)."""
    out = []
    for o in layout_objects():
        if o["objectId"].startswith("gravestone"):
            a = math.radians(o["rotationY"])
            out.append((o["position"]["x"], -o["position"]["z"], math.sin(a), -math.cos(a)))
    return out


def path_sd(x, y):
    """Приближённое расстояние (м) до тропы, <0 внутри. Формулы те же, что в zone_textures.ground_unique."""
    i = (y + 19.6) / 0.6
    xc = 0.4 * math.sin(i * 0.35)
    w = 2.5 + 0.25 * math.sin(i * 0.5)
    sd_main = 9.0 if i < -1 else max(abs(x - xc) - w / 2, y - 13.2)        # упирается в крыльцо дома
    j = (x + 12) / 0.6
    yc = 4 + 0.3 * math.sin(j * 0.4)
    wc = max(2.0 * min(j / 4, (40 - j) / 4 + 0.15, 1.0) + 0.25, 0)
    sd_cross = 9.0 if (j < -1 or j > 41) else abs(y - yc) - wc / 2
    return min(sd_main, sd_cross)


def blocked(x, y, grave_r=1.3, path_margin=0.5, gs=None):
    """Занято ли место: тропа, надгробие/холмик, дерево, фонарь, скамья, ограда."""
    if abs(x) > 18.6 or abs(y) > 18.6 or path_sd(x, y) < path_margin or in_yard(x, y):
        return True
    if any(math.hypot(x - ox, y - oy) < r for ox, oy, r in OBSTACLES):
        return True
    for gx, gy, fx, fy in (gs if gs is not None else graves()):
        if math.hypot(x - gx, y - gy) < grave_r or math.hypot(x - (gx + fx * 1.05), y - (gy + fy * 1.05)) < grave_r:
            return True
    return False


def build_ground(M=None):
    """Земля 40×40: плоская сетка 2 м; UV = мировые координаты на ВСЮ зону → одна уникальная текстура, без повторов."""
    M = M or mats()
    clear("ground_", "path_main_", "path_cross_")
    bm = bmesh.new()
    n = 20
    grid = [[bm.verts.new((-HALF + 2 * i, -HALF + 2 * j, 0.0)) for j in range(n + 1)] for i in range(n + 1)]
    faces = [bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
             for i in range(n) for j in range(n)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        if f.normal.z < 0:
            f.normal_flip()
        f.material_index = 0
        for lp in f.loops:
            x, y, _ = lp.vert.co
            lp[uv].uv = ((x + HALF) / (2 * HALF), (y + HALF) / (2 * HALF))
    _, t = finish("ground_old_cemetery", bm, [M["ground"]])
    return {"ground": t}


def build_path_stones(M=None, count=230):
    """Камни у краёв троп и на них: от мелкой гальки до булыжников, разный поворот и форма."""
    M = M or mats()
    clear("path_stones_")
    rnd = random.Random(9)
    bm = bmesh.new()
    placed = tries = 0
    while placed < count and tries < count * 60:
        tries += 1
        if rnd.random() < 0.62:                                    # вдоль главной
            y = rnd.uniform(-18.6, 15.0)
            x = 0.4 * math.sin(((y + 19.6) / 0.6) * 0.35) + rnd.gauss(0, 1.15)
        else:                                                      # вдоль поперечной
            x = rnd.uniform(-11.5, 11.5)
            y = 4.0 + 0.3 * math.sin(((x + 12) / 0.6) * 0.4) + rnd.gauss(0, 1.0)
        sd = path_sd(x, y)
        if sd > 0.9 or sd < -1.5 or in_yard(x, y) or any(math.hypot(x - ox, y - oy) < r for ox, oy, r in OBSTACLES):
            continue
        r = rnd.choices([0.05, 0.09, 0.15, 0.24, 0.36], weights=[34, 30, 20, 12, 4])[0] * rnd.uniform(0.8, 1.25)
        rx, ry, rz = r, r * rnd.uniform(0.6, 1.0), r * rnd.uniform(0.28, 0.5)
        mat = (Matrix.Translation((x, y, rz * 0.45)) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z")
               @ Matrix.Diagonal((rx, ry, rz, 1)))
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=mat)
        for v in res["verts"]:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))) * r * 0.18
        box_uv(_faces_of(res["verts"]), bm, tile=1.0, off=(rnd.random(), rnd.random()))
        placed += 1
    _, t = finish("path_stones_a", bm, [M["stone"]])
    return {"path_stones": t, "count": placed}


def build_mounds(M=None):
    """Земляные холмики перед надгробиями (по layout.json). UV мировые, как у земли: сливаются с нарисованным грунтом."""
    M = M or mats()
    clear("grave_mounds_")
    rnd = random.Random(21)
    bm = bmesh.new()
    count = 0
    for gx, gy, fx, fy in graves():
        sc = rnd.uniform(0.92, 1.08)
        theta = math.atan2(-fx, fy)                               # локальная ось Y → направление «лица»
        mat = (Matrix.Translation((gx + fx * 1.05, gy + fy * 1.05, 0.0)) @ Matrix.Rotation(theta, 4, "Z")
               @ Matrix.Diagonal((0.44 * sc, 0.98 * sc, 0.14 * sc, 1)))
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0, matrix=mat)
        for v in res["verts"]:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.02
        low = [f for f in _faces_of(res["verts"]) if f.calc_center_median().z < -0.01]
        bmesh.ops.delete(bm, geom=low, context="FACES")           # нижняя половина под землёй не нужна
        count += 1
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.material_index = 0
        for lp in f.loops:
            x, y, _ = lp.vert.co
            lp[uv].uv = ((x + HALF) / (2 * HALF), (y + HALF) / (2 * HALF))
    _, t = finish("grave_mounds_a", bm, [M["ground"]], smooth=True)
    return {"grave_mounds": t, "count": count}


def _fence_post(bm, P, hgt):
    """Столб забора высотой hgt с пирамидальным навершием; P — положение основания."""
    add_box(bm, (0, 0, hgt / 2), (0.16, 0.16, hgt), P, tile=1.0)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.15, radius2=0.0, depth=0.24,
                                matrix=P @ Matrix.Translation((0, 0, hgt + 0.12)) @ Matrix.Rotation(math.pi / 4, 4, "Z"))
    box_uv(_faces_of(res["verts"]), bm, 1.0)


def _fence_rail(bm, R, step, off=(0, 0)):
    """Жердь длиной на пролёт step с болтом на каждом конце; R — центр жерди."""
    add_box(bm, (0, 0, 0), (step + 0.14, 0.05, 0.2), R, tile=1.0, mi=1, off=off)
    for ex in (-step / 2, step / 2):
        add_box(bm, (ex, 0.035, 0), (0.035, 0.03, 0.035), R, tile=1.0, mi=2)


def build_fence(M=None):
    """Забор из жердей (арт-лист): столбы с пирамидальными навершиями, две широкие жерди на болтах; часть просела или выпала."""
    M = M or mats()
    clear("fence_")
    rnd = random.Random(5)
    segs = {
        "fence_wood_01": ((-ZONE, ZONE), (ZONE, ZONE)),
        "fence_wood_02": ((ZONE, -ZONE), (ZONE, ZONE)),
        "fence_wood_03": ((-ZONE, -ZONE), (-ZONE, ZONE)),
        "fence_wood_04": ((-ZONE, -ZONE), (-GATE_X - 0.25, -ZONE)),
        "fence_wood_05": ((GATE_X + 0.25, -ZONE), (ZONE, -ZONE)),
    }
    stats = {}
    for name, (p0, p1) in segs.items():
        d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0))
        L = d.length
        S = Matrix.Translation((p0[0], p0[1], 0)) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, "Z")
        bm = bmesh.new()
        bays = max(1, round(L / 2.4))
        step = L / bays
        for i in range(bays + 1):                                          # столбы
            lean = Matrix.Rotation(rnd.uniform(-0.035, 0.035), 4, "X") @ Matrix.Rotation(rnd.uniform(-0.03, 0.03), 4, "Y")
            P = S @ Matrix.Translation((i * step, 0, 0)) @ lean
            _fence_post(bm, P, rnd.uniform(1.28, 1.42))
        for i in range(bays):                                              # жерди
            for z in (0.55, 1.05):
                if rnd.random() < 0.05:
                    continue                                               # выпала
                sag = rnd.uniform(-0.03, 0.03) if rnd.random() < 0.88 else rnd.uniform(0.10, 0.18) * rnd.choice((-1, 1))
                R = S @ Matrix.Translation(((i + 0.5) * step, 0.105, z)) @ Matrix.Rotation(sag, 4, "Y")
                _fence_rail(bm, R, step, off=(rnd.random(), rnd.random()))
        _, stats[name] = finish(name, bm, [M["wood"], M["planks"], M["iron"]])
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


def _leaf_crown(bm, rnd, center, rxy, rz, blobs, size):
    """Крона из комков листвы: текстура листьев + оттенок по высоте (низ темнее) через цвет вершин."""
    lay = bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")
    for _ in range(blobs):
        while True:
            v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
            if 0.05 < v.length <= 1:
                break
        v = v.normalized() * (0.45 + 0.55 * v.length)                     # комки ближе к поверхности кроны
        c = center + Vector((v.x * rxy, v.y * rxy, v.z * rz))
        s = size * rnd.uniform(0.75, 1.25)
        mat = (Matrix.Translation(c) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z")
               @ Matrix.Diagonal((s, s * rnd.uniform(0.85, 1.1), s * rnd.uniform(0.75, 0.95), 1)))
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0, matrix=mat)
        for vv in res["verts"]:
            vv.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.10 * s
        faces = _faces_of(res["verts"])
        box_uv(faces, bm, tile=0.9, off=(rnd.random(), rnd.random()))
        hz = min(1.0, max(0.0, (c.z - (center.z - rz)) / (2 * rz)))
        base = 0.58 + 0.42 * hz
        tint = (base * rnd.uniform(0.88, 1.0), base, base * rnd.uniform(0.85, 1.0))
        for f in faces:
            f.material_index = 1
            j = rnd.uniform(0.9, 1.0)
            for lp in f.loops:
                lp[lay] = (tint[0] * j, tint[1] * j, tint[2] * j, 1.0)


TREES = (("tree_oak_a", (-11.0, 8.0), 1.0, 41), ("tree_oak_b", (12.0, -7.0), 0.85, 42),
         ("tree_leafy_c", (7.4, 17.3), 0.7, 44))                      # имя, (x, y), масштаб, seed
DEAD_TREE = (13.0, 13.0)


def build_trees(M=None):
    """Лиственные деревья с текстурой листвы (арт-лист) и сухое дерево. Корни, ветви, кора."""
    M = M or mats()
    clear("tree_")
    stats = {}
    for name, (cx, cy), scale, seed in TREES:
        rnd = random.Random(seed)
        bm = bmesh.new()
        T = Matrix.Translation((cx, cy, 0)) @ Matrix.Diagonal((scale, scale, scale, 1))
        add_cone(bm, (0, 0, 1.8), 0.42, 0.22, 3.6, seg=9, M=T, tile=1.0, cyl=(cx, cy), rz=rnd.uniform(0, 1))
        add_cone(bm, (0, 0, 0.10), 0.72, 0.40, 0.70, seg=9, M=T, tile=1.0, cyl=(cx, cy))   # расширение ствола, уходит в землю на 0.25 м
        for az, tilt, ln in ((25, 40, 2.2), (150, 46, 2.0), (265, 36, 2.3), (80, 22, 1.6)):   # ветви в крону
            B = (T @ Matrix.Translation((0, 0, 2.9)) @ Matrix.Rotation(math.radians(az), 4, "Z")
                 @ Matrix.Rotation(math.radians(tilt), 4, "Y"))
            add_cone(bm, (0, 0, ln / 2), 0.16, 0.06, ln, seg=6, M=B, tile=1.0)
        for f in bm.faces:
            f.material_index = 0
        _leaf_crown(bm, rnd, Vector((cx, cy, 5.1 * scale)), 2.5 * scale, 1.75 * scale, 17, 1.15 * scale)
        _, stats[name] = finish(name, bm, [M["bark"], M["leaves"]])
    rnd = random.Random(43)                                                # сухое дерево
    bm = bmesh.new()
    cx, cy = DEAD_TREE
    T = Matrix.Translation((cx, cy, 0))
    add_cone(bm, (0, 0, 2.6), 0.34, 0.14, 5.2, seg=10, M=T, cyl=(cx, cy), rz=0.4)
    add_cone(bm, (0, 0, 0.08), 0.66, 0.325, 0.66, seg=10, M=T, cyl=(cx, cy))             # уходит в землю на 0.25 м
    for z0, az, tilt, ln, r in [(2.4, 20, 52, 2.4, 0.14), (3.1, 140, 46, 2.1, 0.12), (3.7, 250, 40, 2.3, 0.11),
                                (4.2, 70, 28, 1.6, 0.08), (3.4, 320, 62, 1.5, 0.08), (4.8, 200, 18, 1.2, 0.06),
                                (5.0, 330, 30, 1.0, 0.05)]:
        B = T @ Matrix.Translation((0, 0, z0)) @ Matrix.Rotation(math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "Y")
        add_cone(bm, (0, 0, ln / 2), r, r * 0.22, ln, seg=6, M=B, tile=1.0)
        for tz, taz, ttilt in ((0.55, 40, 50), (0.8, -50, 40)):
            Bt = B @ Matrix.Translation((0, 0, ln * tz)) @ Matrix.Rotation(math.radians(taz), 4, "Z") @ Matrix.Rotation(math.radians(ttilt), 4, "Y")
            add_cone(bm, (0, 0, ln * 0.2), r * 0.35, 0.012, ln * 0.4, seg=4, M=Bt, tile=1.0)
    _, stats["tree_dead_a"] = finish("tree_dead_a", bm, [M["bark"]])
    return stats


def add_torus(bm, M, R, r, seg=10, ring=4, mi=0):
    """Тор в локальной плоскости XZ (ось — локальная Y): кольцо, крюк, звено цепи."""
    verts = []
    for i in range(seg):
        a = i / seg * math.tau
        row = []
        for j in range(ring):
            b = j / ring * math.tau
            d = R + r * math.cos(b)
            row.append(bm.verts.new(M @ Vector((d * math.cos(a), r * math.sin(b), d * math.sin(a)))))
        verts.append(row)
    faces = []
    for i in range(seg):
        for j in range(ring):
            f = bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring], verts[i][(j + 1) % ring]))
            f.material_index = mi
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    box_uv(faces, bm, 0.5)
    return faces


def _pyramid(bm, M, r_bottom, r_top, depth, mi):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=r_bottom, radius2=r_top, depth=depth,
                                matrix=M @ Matrix.Rotation(math.pi / 4, 4, "Z"))
    faces = _faces_of(res["verts"])
    for f in faces:
        f.material_index = mi
    box_uv(faces, bm, 0.5)


def _lantern(bm, top, s=1.0, rot=0.0, mi_iron=1, mi_glass=2, mi_flame=3, mi_candle=4):
    """Классический подвесной фонарь (арт-лист): кольцо, пирамидальная крыша с карнизом, железная рама,
    4 стекла, свеча с пламенем, поддон с каплей. top — точка подвеса; высота фонаря ≈ 0.68·s, центр стекла −0.41·s."""
    T = Matrix.Translation(top) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Diagonal((s, s, s, 1))
    add_torus(bm, T @ Matrix.Translation((0, 0, -0.035)), 0.032, 0.008, seg=10, ring=4, mi=mi_iron)   # кольцо
    add_cone(bm, (0, 0, -0.08), 0.022, 0.012, 0.03, seg=6, M=T, mi=mi_iron, tile=0.5)                 # навершие
    _pyramid(bm, T @ Matrix.Translation((0, 0, -0.17)), 0.22, 0.035, 0.15, mi_iron)                   # крыша
    add_box(bm, (0, 0, -0.255), (0.31, 0.31, 0.022), T, tile=0.5, mi=mi_iron)                         # карниз
    for sx in (-0.12, 0.12):
        for sy in (-0.12, 0.12):
            add_box(bm, (sx, sy, -0.41), (0.024, 0.024, 0.31), T, tile=0.5, mi=mi_iron)               # стойки
    for z in (-0.27, -0.55):
        for cx_, cy_, sx_, sy_ in ((0, 0.12, 0.26, 0.022), (0, -0.12, 0.26, 0.022), (0.12, 0, 0.022, 0.26), (-0.12, 0, 0.022, 0.26)):
            add_box(bm, (cx_, cy_, z), (sx_, sy_, 0.022), T, tile=0.5, mi=mi_iron)                     # рамки
    for cx_, cy_, sx_, sy_ in ((0, 0.116, 0.22, 0.006), (0, -0.116, 0.22, 0.006), (0.116, 0, 0.006, 0.22), (-0.116, 0, 0.006, 0.22)):
        add_box(bm, (cx_, cy_, -0.41), (sx_, sy_, 0.27), T, uv=False, mi=mi_glass)                     # стёкла
    add_cone(bm, (0, 0, -0.505), 0.024, 0.024, 0.07, seg=8, M=T, mi=mi_candle, tile=0.5)              # свеча
    add_cone(bm, (0, 0, -0.448), 0.014, 0.0, 0.045, seg=6, M=T, mi=mi_flame, tile=0.5)                # пламя
    _pyramid(bm, T @ Matrix.Translation((0, 0, -0.60)), 0.06, 0.19, 0.08, mi_iron)                    # поддон
    add_cone(bm, (0, 0, -0.66), 0.028, 0.008, 0.04, seg=6, M=T, mi=mi_iron, tile=0.5)                 # капля


def _chain(bm, M, links, link_len=0.055, mi=1):
    """Цепь вниз от точки M: звенья-торы, каждое повёрнуто на 90° относительно соседнего."""
    for k in range(links):
        Mk = (M @ Matrix.Translation((0, 0, -link_len * (k + 0.5))) @ Matrix.Rotation(math.pi / 2 * (k % 2), 4, "Z")
              @ Matrix.Diagonal((1, 1, 1.45, 1)))
        add_torus(bm, Mk, 0.02, 0.0055, seg=8, ring=4, mi=mi)
    return links * link_len


LAMP_POS = (3.5, -10.0)                 # столб у тропы (Blender x, y)
BENCH_T = ((-4.5, -6.0), 12.0)          # скамья: (x, y), поворот°


def build_lamp(M=None):
    """Фонарный столб по арт-листу: столб на каменном основании с навершием, кронштейн с подкосом,
    железная накладка на болтах, крюк, цепь и классический фонарь со свечой."""
    M = M or mats()
    clear("lamp_")
    bm = bmesh.new()
    T = Matrix.Translation((*LAMP_POS, 0))
    add_box(bm, (0, 0, 0.17), (0.4, 0.4, 0.34), T, tile=1.0, mi=5)                                    # основание (камень)
    add_box(bm, (0, 0, 1.77), (0.22, 0.22, 3.06), T, tile=1.0)                                        # столб
    _pyramid(bm, T @ Matrix.Translation((0, 0, 3.38)), 0.2, 0.02, 0.16, 0)                            # навершие
    add_box(bm, (-0.52, 0, 3.05), (1.2, 0.14, 0.14), T, tile=1.0)                                     # кронштейн к тропе
    a, b = Vector((-0.11, 0, 2.42)), Vector((-0.66, 0, 2.99))                                         # подкос
    d = b - a
    Mb = T @ Matrix.Translation((a + b) / 2) @ d.to_track_quat("X", "Z").to_matrix().to_4x4()
    add_box(bm, (0, 0, 0), (d.length + 0.08, 0.1, 0.1), Mb, tile=1.0)
    add_box(bm, (-0.126, 0, 2.98), (0.03, 0.26, 0.34), T, tile=0.5, mi=1)                             # железная накладка
    for oy in (-0.08, 0.08):
        for oz in (-0.11, 0.11):
            add_box(bm, (-0.147, oy, 2.98 + oz), (0.02, 0.04, 0.04), T, tile=0.5, mi=1)               # болты
    hook = T @ Matrix.Translation((-1.02, 0, 2.95))
    add_torus(bm, hook, 0.03, 0.007, seg=10, ring=4, mi=1)                                             # крюк
    drop = _chain(bm, hook @ Matrix.Translation((0, 0, -0.03)), 3)
    top = T @ Vector((-1.02, 0, 2.92 - drop))
    _lantern(bm, top, s=1.0, mi_iron=1, mi_glass=2, mi_flame=3, mi_candle=4)
    _, t = finish("lamp_post_a", bm, [M["wood"], M["iron"], M["glass"], M["flame"], M["candle"], M["stone"]])
    return {"lamp_post_a": t, "lantern_center": tuple(round(v, 3) for v in (top + Vector((0, 0, -0.41))))}


LANTERN_POS = (2.48, -10.0, 2.345)     # центр стекла фонаря на столбе (Blender); в glTF = (2.48, 2.345, 10)
LANTERN_COLOR = (1.0, 0.55, 0.22)       # тёплый свет свечи/масляной лампы
LANTERN_POWER = 65.0                    # в экспорте RAW это число = PointLight.intensity в three.js (без пересчёта в канделы)


def build_lantern_light():
    """Тёплый точечный свет в фонаре. Уходит в .glb как KHR_lights_punctual — игра создаёт PointLight сама."""
    clear("lantern_light_")
    data = bpy.data.lights.get("lantern_light_a") or bpy.data.lights.new("lantern_light_a", "POINT")
    data.color = LANTERN_COLOR
    data.energy = LANTERN_POWER
    data.shadow_soft_size = 0.08
    obj = bpy.data.objects.new("lantern_light_a", data)
    obj.location = LANTERN_POS
    collection().objects.link(obj)
    return {"lantern_light_a": LANTERN_POS, "intensity": LANTERN_POWER}


def build_bench(M=None):
    """Скамья: сиденье из трёх досок, спинка из двух, боковые рамы."""
    M = M or mats()
    clear("bench_")
    bm = bmesh.new()
    T = Matrix.Translation((*BENCH_T[0], 0)) @ Matrix.Rotation(math.radians(BENCH_T[1]), 4, "Z")
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


GRASS_KINDS = {                      # (низ, кончик) — линейные цвета вершин
    "green": ((0.010, 0.032, 0.008), (0.060, 0.170, 0.030)),
    "light": ((0.014, 0.045, 0.010), (0.100, 0.240, 0.040)),
    "dry": ((0.030, 0.025, 0.010), (0.160, 0.120, 0.040)),
}


def _tuft(bm, lay, rnd, x, y, kind, scale):
    """Пучок из 5-9 травинок-треугольников вокруг (x, y); цвет вершин — от низа к кончику (GRASS_KINDS)."""
    low, tip = GRASS_KINDS[kind]
    for _ in range(rnd.randint(5, 9)):
        a = rnd.uniform(0, 6.28)
        ox, oy = x + math.cos(a) * rnd.uniform(0, 0.09), y + math.sin(a) * rnd.uniform(0, 0.09)
        h, w = rnd.uniform(0.16, 0.34) * scale, rnd.uniform(0.032, 0.055)
        bend = rnd.uniform(0.04, 0.13) * scale
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0)) * w
        p2 = Vector((ox, oy, 0)) + d * bend
        p2.z = h
        f = bm.faces.new([bm.verts.new(Vector((ox, oy, 0)) - side), bm.verts.new(Vector((ox, oy, 0)) + side), bm.verts.new(p2)])
        jitter = rnd.uniform(0.85, 1.15)
        for lp, c in zip(f.loops, (low, low, tip)):
            lp[lay] = (c[0] * jitter, c[1] * jitter, c[2] * jitter, 1.0)


def build_grass(M=None, tufts=560, seed=17):
    """Пучки травы трёх видов (зелёная, светлая, сухая), разной высоты; гуще у ограды и пятнами; 4 меша по четвертям."""
    M = M or mats()
    clear("grass_tufts_")
    rnd = random.Random(seed)
    gs = graves()
    bms = {q: bmesh.new() for q in range(4)}
    placed = tries = 0
    while placed < tufts and tries < tufts * 40:
        tries += 1
        x, y = rnd.uniform(-18.8, 18.8), rnd.uniform(-18.8, 18.8)
        if path_sd(x, y) < 0.05 or (abs(x) < 2.6 and y < -17.5) or in_yard(x, y):   # не на тропе, в воротах, во дворе
            continue
        clump = max(0.0, math.sin(x * 0.37 + 1.3) * math.cos(y * 0.29 + 0.4))
        near_fence = max(abs(x), abs(y)) > 17.2
        if rnd.random() > 0.30 + 0.7 * clump + (0.35 if near_fence else 0.0):
            continue
        if any(math.hypot(x - (gx + fx * 1.05), y - (gy + fy * 1.05)) < 0.5 for gx, gy, fx, fy in gs) and rnd.random() < 0.7:
            continue                                                  # на холмиках реже
        kind = rnd.choices(["green", "light", "dry"], weights=[6, 3, 2])[0]
        tall = rnd.random() < 0.16
        q = (0 if x < 0 else 1) + (0 if y < 0 else 2)
        bm = bms[q]
        lay = bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")
        scale = rnd.uniform(0.7, 1.3) * (1.9 if tall else 1.0)
        _tuft(bm, lay, rnd, x, y, kind, scale)
        placed += 1
    stats = {}
    for q, bm in bms.items():
        _, t = finish(f"grass_tufts_0{q + 1}", bm, [M["blades"]])
        stats[f"grass_tufts_0{q + 1}"] = t
    return stats


FLOWER_PALETTE = [(0.60, 0.58, 0.45), (0.70, 0.66, 0.50), (0.38, 0.26, 0.55), (0.62, 0.50, 0.08), (0.55, 0.55, 0.60)]


def _flower(bm, lay, rnd, x, y, petal):
    """Цветок: стебель-треугольник и пятилепестковая звёздочка с жёлтой серединкой (цвета вершин)."""
    h = rnd.uniform(0.22, 0.42)
    lean = Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), 0))
    base, top = Vector((x, y, 0)), Vector((x, y, h)) + lean
    w = 0.006
    stem = bm.faces.new([bm.verts.new(base - Vector((w, 0, 0))), bm.verts.new(base + Vector((w, 0, 0))), bm.verts.new(top)])
    for lp, c in zip(stem.loops, ((0.010, 0.040, 0.008), (0.010, 0.040, 0.008), (0.03, 0.10, 0.02))):
        lp[lay] = (*c, 1.0)
    center = bm.verts.new(top + Vector((0, 0, 0.012)))
    ring = [bm.verts.new(top + Vector((math.cos(k * math.tau / 5), math.sin(k * math.tau / 5), 0)) * Vector((0.034, 0.034, 1)))
            for k in range(5)]
    for k in range(5):
        f = bm.faces.new((center, ring[k], ring[(k + 1) % 5]))
        for lp in f.loops:
            lp[lay] = (0.62, 0.48, 0.05, 1.0) if lp.vert == center else (*petal, 1.0)


def build_flowers(M=None, clusters=9):
    """Полевые цветы небольшими россыпями (белые, кремовые, сиреневые, жёлтые) — вертексные цвета."""
    M = M or mats()
    clear("flowers_")
    rnd = random.Random(33)
    gs = graves()
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Color")
    palette = FLOWER_PALETTE
    count = tries = 0
    while count < clusters * 18 and tries < 5000:
        tries += 1
        if tries % 40 == 1:                                           # новый центр россыпи
            cx, cy = rnd.uniform(-17, 17), rnd.uniform(-17, 17)
            petal = rnd.choice(palette)
        x, y = cx + rnd.gauss(0, 0.9), cy + rnd.gauss(0, 0.9)
        if blocked(x, y, grave_r=1.0, path_margin=0.4, gs=gs):
            continue
        _flower(bm, lay, rnd, x, y, petal)
        count += 1
    _, t = finish("flowers_a", bm, [M["blades"]])
    return {"flowers_a": t, "count": count}


def _rock(bm, lay, rnd, x, y, r, subdiv):
    """Валун радиуса r (сплюснутая икосфера с шумом), мох на верхних гранях — цветом вершин."""
    mat = (Matrix.Translation((x, y, r * 0.15)) @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, "Z")
           @ Matrix.Diagonal((r, r * rnd.uniform(0.7, 1.0), r * rnd.uniform(0.55, 0.75), 1)))
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0, matrix=mat)
    for v in res["verts"]:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * r * 0.16
    faces = _faces_of(res["verts"])
    box_uv(faces, bm, tile=1.0, off=(rnd.random(), rnd.random()))
    amount = rnd.uniform(0.6, 1.0)
    for f in faces:
        f.normal_update()
        t = min(1.0, max(0.0, (f.normal.z - 0.35) / 0.35)) * amount
        c = (0.86 + (0.50 - 0.86) * t, 0.86 + (0.78 - 0.86) * t, 0.86 + (0.40 - 0.86) * t)
        for lp in f.loops:
            lp[lay] = (*c, 1.0)


def build_rocks(M=None):
    """Мшистые валуны (арт-лист): крупный камень и 2-3 мелких рядом; мох на верхних гранях — цветом вершин."""
    M = M or mats()
    clear("rocks_")
    rnd = random.Random(55)
    gs = graves()
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Color")
    spots = [(-17.2, -17.2), (17.2, -17.2), (17.4, 16.4), (-17.0, 17.4), (-15.0, 3.0), (15.5, 3.5), (-7.5, -14.5),
             (-9.0, 11.5), (9.5, -12.0), (-6.6, 17.8), (15.8, -2.0)]
    n = 0
    for sx, sy in spots:
        for k in range(rnd.choice((3, 4, 4))):
            x, y = sx + rnd.uniform(-1.0, 1.0), sy + rnd.uniform(-1.0, 1.0)
            if blocked(x, y, grave_r=1.1, path_margin=0.6, gs=gs) and max(abs(x), abs(y)) < 18.3:
                continue
            r = rnd.uniform(0.55, 0.95) if k == 0 else rnd.uniform(0.14, 0.34)
            _rock(bm, lay, rnd, x, y, r, 2 if k == 0 else 1)
            n += 1
    _, t = finish("rocks_a", bm, [M["stone_vc"]])
    return {"rocks_a": t, "count": n}


def build_twigs(M=None):
    """Сучья и ветки на земле: у деревьев и россыпью; одна толстая упавшая ветвь у сухого дерева."""
    M = M or mats()
    clear("twigs_")
    rnd = random.Random(77)
    gs = graves()
    bm = bmesh.new()
    def stick(x, y, ln, r, az):
        B = (Matrix.Translation((x, y, r * 0.8)) @ Matrix.Rotation(az, 4, "Z") @ Matrix.Rotation(math.radians(rnd.uniform(86, 90)), 4, "Y"))
        add_cone(bm, (0, 0, ln / 2), r, r * 0.55, ln, seg=5, M=B, tile=1.0)
    for tx, ty, tr in ((-11.0, 8.0, 3.8), (12.0, -7.0, 3.2), (13.0, 13.0, 3.0)):
        for _ in range(5):
            a, d = rnd.uniform(0, 6.28), rnd.uniform(0.9, tr)
            x, y = tx + math.cos(a) * d, ty + math.sin(a) * d
            if not blocked(x, y, grave_r=0.9, path_margin=0.3, gs=gs):
                stick(x, y, rnd.uniform(0.4, 1.3), rnd.uniform(0.014, 0.03), rnd.uniform(0, 6.28))
    stick(9.9, 10.6, 2.2, 0.06, 2.0)                                  # упавшая ветвь неподалёку от сухого дерева (не у ствола — иначе похожа на корень)
    for _ in range(6):
        x, y = rnd.uniform(-17, 17), rnd.uniform(-17, 17)
        if not blocked(x, y, grave_r=0.9, path_margin=0.3, gs=gs):
            stick(x, y, rnd.uniform(0.3, 0.9), rnd.uniform(0.012, 0.022), rnd.uniform(0, 6.28))
    _, t = finish("twigs_a", bm, [M["bark"]])
    return {"twigs_a": t}


# ============================================================================ арт-лист v2: дом, двор, детали
HOUSE = dict(cx=0.0, y0=13.8, y1=17.8, w=5.0, wall_h=2.4, base_h=0.6, pitch=38.0, overhang=0.45)
PATCH = (-1.6, 1.6, 11.9, 13.05)           # брусчатая площадка перед крыльцом (x0, x1, y0, y1)
CRATES = [(-3.55, 15.2, 0.0, 0.66, 8), (-3.45, 16.1, 0.0, 0.60, -12), (-3.55, 15.22, 0.66, 0.46, 27),
          (-4.0, 17.25, 0.0, 0.56, 40)]   # x, y, z, размер, поворот°
BARRELS = [(3.45, 15.3, False, 0), (3.6, 16.2, False, 30), (3.1, 17.35, True, 70)]  # x, y, лежит?, поворот°
PEDESTAL = (-2.6, 6.6)


def new_faces(bm, before):
    return [f for f in bm.faces if f not in before]


def lathe(bm, prof, segments, center):
    """Тело вращения вокруг вертикальной оси в точке center; prof — (r, z). Возвращает новые грани."""
    before = set(bm.faces)
    cx, cy, cz = center
    vs = [bm.verts.new((cx + r, cy, cz + z)) for r, z in prof]
    es = [bm.edges.new((a, b)) for a, b in zip(vs, vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(cx, cy, cz), axis=(0, 0, 1), dvec=(0, 0, 0), angle=math.tau,
                   space=Matrix(), steps=segments, use_merge=True, use_normal_flip=False, use_duplicate=False)
    faces = new_faces(bm, before)
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.remove_doubles(bm, verts=verts, dist=0.0002)
    faces = [f for f in faces if f.is_valid]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def cyl_uv2(faces, bm, cx, cy, tile=1.0, swap=False, r_ref=0.3):
    """Цилиндрическая развёртка вокруг вертикали (cx, cy); swap — доски вдоль высоты (клёпки бочки)."""
    uv = bm.loops.layers.uv.verify()
    for f in faces:
        c = f.calc_center_median()
        tc = math.atan2(c.y - cy, c.x - cx)
        for lp in f.loops:
            x, y, z = lp.vert.co
            th = tc + (math.atan2(y - cy, x - cx) - tc + math.pi) % math.tau - math.pi
            a, b = th * r_ref / tile, z / tile
            lp[uv].uv = (b, a) if swap else (a, b)


def build_house(M=None):
    """Сторожка: каменный фундамент, дощатые стены с угловыми столбами, двускатная крыша, труба."""
    M = M or mats()
    clear("house_")
    h = HOUSE
    cx, y0, y1, W, H, B = h["cx"], h["y0"], h["y1"], h["w"], h["wall_h"], h["base_h"]
    D, cy = y1 - y0, (y0 + y1) / 2
    stats = {}
    bm = bmesh.new()                                                     # фундамент
    add_box(bm, (cx, cy, B / 2), (W + 0.2, D + 0.2, B), tile=1.0)
    _, stats["house_foundation_a"] = finish("house_foundation_a", bm, [M["stone_wall"]])

    bm = bmesh.new()                                                     # стены
    add_box(bm, (cx, cy, B + H / 2), (W, D, H), tile=1.0)
    for sx in (-W / 2, W / 2):
        for sy in (y0, y1):
            add_box(bm, (cx + sx, sy, B + H / 2), (0.22, 0.22, H + 0.02), tile=1.0, mi=1)
    for sy in (y0 - 0.03, y1 + 0.03):
        add_box(bm, (cx, sy, B + H - 0.09), (W + 0.16, 0.14, 0.18), tile=1.0, mi=1)
    run = D / 2
    rise = run * math.tan(math.radians(h["pitch"]))
    top = B + H
    for sx in (-W / 2, W / 2):                                           # фронтоны
        G = Matrix.Translation((cx + sx, cy, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
        add_prism(bm, [(-run, top), (run, top), (0.0, top + rise)], 0.12, G, tile=1.0)
    _, stats["house_walls_a"] = finish("house_walls_a", bm, [M["planks"], M["wood"]])

    bm = bmesh.new()                                                     # крыша
    p = math.radians(h["pitch"])
    run_o = run + h["overhang"]
    L = run_o / math.cos(p)
    ridge = top + rise
    eave = top - h["overhang"] * math.tan(p)
    zc = (ridge + eave) / 2
    for side in (-1, 1):                                                 # -1 перед (юг), +1 зад
        th = -side * p
        nrm = Vector((0, side * math.sin(p), math.cos(p)))
        ctr = Vector((cx, cy + side * run_o / 2, zc)) + nrm * 0.07
        Mr = Matrix.Translation(ctr) @ Matrix.Rotation(th, 4, "X")
        add_box(bm, (0, 0, 0), (W + 0.7, L, 0.14), Mr, tile=1.0)
    add_box(bm, (cx, cy, ridge + 0.07), (W + 0.75, 0.26, 0.16), tile=1.0, mi=1)   # конёк
    _, stats["house_roof_a"] = finish("house_roof_a", bm, [M["shingles"], M["wood"]])

    bm = bmesh.new()                                                     # труба
    add_box(bm, (cx + 1.4, cy + 0.8, (top + ridge + 0.9) / 2), (0.62, 0.62, ridge + 0.9 - top), tile=1.0)
    add_box(bm, (cx + 1.4, cy + 0.8, ridge + 0.95), (0.78, 0.78, 0.12), tile=1.0)
    _, stats["house_chimney_a"] = finish("house_chimney_a", bm, [M["stone_wall"]])
    return stats


def build_house_details(M=None):
    """Дверь с петлями, окна со светом, ступени крыльца, фонарь у двери; брусчатка перед крыльцом."""
    M = M or mats()
    clear("house_door_", "house_windows_", "house_porch_", "house_lantern_", "house_patio_")
    h = HOUSE
    cx, y0, y1, W, B = h["cx"], h["y0"], h["y1"], h["w"], h["base_h"]
    stats = {}
    uvl = None
    bm = bmesh.new()                                                     # дверь
    faces = add_box(bm, (cx, y0 - 0.035, B + 0.975), (0.95, 0.07, 1.95), tile=1.0)
    uvl = bm.loops.layers.uv.verify()
    for f in faces:                                                      # доски двери вертикально
        for lp in f.loops:
            u, v = lp[uvl].uv
            lp[uvl].uv = (v, u)
    for sx in (-0.53, 0.53):
        add_box(bm, (cx + sx, y0 - 0.05, B + 1.02), (0.11, 0.1, 2.08), tile=1.0, mi=1)
    add_box(bm, (cx, y0 - 0.05, B + 2.08), (1.2, 0.1, 0.13), tile=1.0, mi=1)
    for z in (0.38, 1.55):
        add_box(bm, (cx - 0.2, y0 - 0.08, B + z), (0.52, 0.02, 0.06), tile=1.0, mi=2)
    add_box(bm, (cx + 0.33, y0 - 0.09, B + 1.0), (0.04, 0.04, 0.16), tile=1.0, mi=2)
    _, stats["house_door_a"] = finish("house_door_a", bm, [M["planks"], M["wood"], M["iron"]])

    bm = bmesh.new()                                                     # окна: рама, крестовина, тёплое стекло
    wins = [(cx - 1.6, y0, "front"), (cx + 1.6, y0, "front"), (cx + W / 2, (y0 + y1) / 2, "side")]
    for wx, wy, kind in wins:
        R = Matrix.Translation((wx, wy, 0)) @ (Matrix.Rotation(math.pi / 2, 4, "Z") if kind == "side" else Matrix.Identity(4))
        zc = B + 1.4
        for f in add_box(bm, (0, 0.012 * (-1), zc), (0.74, 0.03, 0.74), R, uv=False, mi=1):
            pass
        for ox, sz in ((-0.42, (0.1, 0.1, 0.94)), (0.42, (0.1, 0.1, 0.94))):
            add_box(bm, (ox, 0.04 * (-1), zc), sz, R, tile=1.0)
        for oz in (-0.42, 0.42):
            add_box(bm, (0, 0.04 * (-1), zc + oz), (0.94, 0.1, 0.1), R, tile=1.0)
        add_box(bm, (0, 0.05 * (-1), zc), (0.05, 0.06, 0.74), R, tile=1.0)
        add_box(bm, (0, 0.05 * (-1), zc), (0.74, 0.06, 0.05), R, tile=1.0)
        add_box(bm, (0, 0.09 * (-1), zc - 0.5), (1.04, 0.16, 0.06), R, tile=1.0)
    _, stats["house_windows_a"] = finish("house_windows_a", bm, [M["wood"], M["window"]])

    bm = bmesh.new()                                                     # крыльцо: две ступени
    add_box(bm, (cx, y0 - 0.1 - 0.175, 0.2), (1.6, 0.35, 0.4), tile=1.0)
    add_box(bm, (cx, y0 - 0.1 - 0.525, 0.1), (1.6, 0.35, 0.2), tile=1.0)
    _, stats["house_porch_a"] = finish("house_porch_a", bm, [M["stone_wall"]])

    bm = bmesh.new()                                                     # фонарь у двери (как на столбе, меньше)
    lx = cx - 0.95
    add_box(bm, (lx, y0 - 0.025, 2.62), (0.16, 0.03, 0.22), tile=0.5)                     # накладка на стене
    add_box(bm, (lx, y0 - 0.22, 2.68), (0.035, 0.42, 0.035), tile=0.5)                   # кронштейн
    pa, pb = Vector((lx, y0 - 0.03, 2.45)), Vector((lx, y0 - 0.26, 2.66))                 # подкос
    dv = pb - pa
    add_box(bm, (0, 0, 0), (dv.length + 0.04, 0.025, 0.025),
            Matrix.Translation((pa + pb) / 2) @ dv.to_track_quat("X", "Z").to_matrix().to_4x4(), tile=0.5)
    add_torus(bm, Matrix.Translation((lx, y0 - 0.40, 2.66)), 0.022, 0.005, seg=8, ring=4, mi=0)   # крюк
    _lantern(bm, Vector((lx, y0 - 0.40, 2.64)), s=0.72, mi_iron=0, mi_glass=1, mi_flame=2, mi_candle=3)
    _, stats["house_lantern_a"] = finish("house_lantern_a", bm, [M["iron"], M["glass"], M["flame"], M["candle"]])

    bm = bmesh.new()                                                     # брусчатка перед крыльцом
    x0, x1, py0, py1 = PATCH
    rnd = random.Random(12)
    nx, ny = 8, 3
    grid = [[bm.verts.new((x0 + (x1 - x0) * i / nx + (rnd.uniform(-0.08, 0.08) if 0 < i < nx else 0),
                           py0 + (py1 - py0) * j / ny + (rnd.uniform(-0.12, 0.12) if j == 0 else 0), 0.018))
             for j in range(ny + 1)] for i in range(nx + 1)]
    faces = [bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])) for i in range(nx) for j in range(ny)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        if f.normal.z < 0:
            f.normal_flip()
    box_uv(faces, bm, tile=1.0)
    _, stats["house_patio_a"] = finish("house_patio_a", bm, [M["cobble"]])
    return stats


def build_house_lights():
    """Тёплый свет: фонарь у двери и отсвет из окон (уходят в .glb как KHR_lights_punctual)."""
    clear("house_light_")
    h = HOUSE
    out = {}
    for name, pos, power, color in (("house_light_lantern", (h["cx"] - 0.95, h["y0"] - 0.40, 2.345), 30.0, LANTERN_COLOR),
                                    ("house_light_window", (h["cx"] + 1.6, h["y0"] - 0.7, 1.9), 10.0, (1.0, 0.6, 0.28))):
        data = bpy.data.lights.get(name) or bpy.data.lights.new(name, "POINT")
        data.color, data.energy, data.shadow_soft_size = color, power, 0.1
        obj = bpy.data.objects.new(name, data)
        obj.location = pos
        collection().objects.link(obj)
        out[name] = power
    return out


def _crate(bm, x, y, z, s, rot, M):
    T = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(rot), 4, "Z")
    add_box(bm, (0, 0, s / 2), (s * 0.94, s * 0.94, s * 0.94), T, tile=1.0)
    b = s * 0.09
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(bm, (sx * (s - b) / 2, sy * (s - b) / 2, s / 2), (b, b, s), T, tile=1.0, mi=1)
    for z0 in (b / 2, s - b / 2):
        for sx in (-1, 1):
            add_box(bm, (sx * (s - b) / 2, 0, z0), (b, s, b), T, tile=1.0, mi=1)
            add_box(bm, (0, sx * (s - b) / 2, z0), (s, b, b), T, tile=1.0, mi=1)
    for sy in (-1, 1):                                                   # диагональ на двух гранях
        D = T @ Matrix.Translation((0, sy * s * 0.48, s / 2)) @ Matrix.Rotation(math.radians(45) * sy, 4, "Y")
        add_box(bm, (0, 0, 0), (b * 0.9, b * 0.6, s * 1.2), D, tile=1.0, mi=1)


def build_crates(M=None):
    """Деревянные ящики у западной стены дома (один стоит на другом)."""
    M = M or mats()
    clear("crates_")
    bm = bmesh.new()
    for x, y, z, s, rot in CRATES:
        _crate(bm, x, y, z, s, rot, M)
    _, t = finish("crates_a", bm, [M["planks"], M["wood"]])
    return {"crates_a": t}


BARREL_PROFILE = [(0.0, 0.0), (0.26, 0.0), (0.30, 0.2), (0.315, 0.43), (0.30, 0.66), (0.26, 0.86), (0.0, 0.86)]


def _barrel(bm, x, y, lying=False, rot=0.0):
    """Бочка: клёпки (доски вдоль высоты, слот 0) и три железных обруча (слот 1); lying — на боку."""
    before = set(bm.faces)
    faces = lathe(bm, BARREL_PROFILE, 14, (0, 0, 0))
    for f in faces:
        f.material_index = 0
    cyl_uv2(faces, bm, 0, 0, tile=1.0, swap=True, r_ref=0.3)
    for zb, rb in ((0.12, 0.292), (0.43, 0.322), (0.74, 0.292)):
        add_cone(bm, (0, 0, zb), rb, rb, 0.05, seg=14, mi=1, tile=1.0)
    part = new_faces(bm, before)
    verts = list({v for f in part for v in f.verts})
    Mt = Matrix.Translation((x, y, 0.315 if lying else 0)) @ Matrix.Rotation(math.radians(rot), 4, "Z")
    if lying:
        Mt = Mt @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((0, 0, -0.43))
    bmesh.ops.transform(bm, matrix=Mt, verts=verts)


def build_barrels(M=None):
    """Бочки у восточной стены: клёпки (доски вдоль высоты), железные обручи, одна лежит на боку."""
    M = M or mats()
    clear("barrels_")
    bm = bmesh.new()
    for x, y, lying, rot in BARRELS:
        _barrel(bm, x, y, lying, rot)
    _, t = finish("barrels_a", bm, [M["planks"], M["iron"]])
    return {"barrels_a": t}


POT_PROFILE = [(0.0, 0.0), (0.09, 0.0), (0.13, 0.07), (0.16, 0.19), (0.145, 0.31), (0.085, 0.39), (0.07, 0.45),
               (0.09, 0.49), (0.075, 0.5), (0.0, 0.47)]


def _pot(bm, x, y, s=1.0, a0=0.0, tilt=0.0):
    """Глиняный горшок масштаба s с двумя ручками дугой (a0 — их направление); tilt — наклон, °."""
    before = set(bm.faces)
    faces = lathe(bm, [(r * s, z * s) for r, z in POT_PROFILE], 12, (x, y, 0))
    cyl_uv2(faces, bm, x, y, tile=0.6, r_ref=0.15 * s)
    for side in (0, math.pi):
        a = a0 + side
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [Vector((x, y, 0)) + d * (0.075 * s) + Vector((0, 0, 0.43 * s)),
               Vector((x, y, 0)) + d * (0.16 * s) + Vector((0, 0, 0.41 * s)),
               Vector((x, y, 0)) + d * (0.15 * s) + Vector((0, 0, 0.29 * s))]
        for p0, p1 in zip(pts, pts[1:]):
            v = p1 - p0
            Mh = Matrix.Translation((p0 + p1) / 2) @ v.to_track_quat("Z", "Y").to_matrix().to_4x4()
            add_cone(bm, (0, 0, 0), 0.016 * s, 0.016 * s, v.length + 0.01, seg=5, M=Mh, tile=0.6)
    if tilt:
        part = new_faces(bm, before)
        bmesh.ops.rotate(bm, cent=(x, y, 0), matrix=Matrix.Rotation(math.radians(tilt), 3, "X"),
                         verts=list({v for f in part for v in f.verts}))


def build_pots(M=None):
    """Глиняные горшки с ручками: у крыльца, у ящиков и бочек, несколько — у надгробий."""
    M = M or mats()
    clear("pots_")
    rnd = random.Random(31)
    gs = graves()
    spots = [(1.35, 12.55), (-1.45, 12.45), (-2.95, 14.6), (2.85, 15.95)]
    vases = [(o["position"]["x"], -o["position"]["z"]) for o in layout_objects() if o["objectId"].startswith("vase")]
    for gx, gy, fx, fy in rnd.sample(gs, len(gs)):
        if len(spots) >= 9:
            break
        px, py = gx + fx * 0.5 - fy * 0.42, gy + fy * 0.5 + fx * 0.42  # сбоку перед надгробием
        if any(math.hypot(px - vx, py - vy) < 0.8 for vx, vy in vases) or path_sd(px, py) < 0.4:
            continue
        spots.append((px, py))
    bm = bmesh.new()
    for k, (x, y) in enumerate(spots):
        s = rnd.uniform(0.75, 1.15)
        a0 = rnd.uniform(0, math.tau)
        tilt = rnd.uniform(6, 14) if k % 3 == 2 else 0.0                # часть горшков слегка наклонена
        _pot(bm, x, y, s, a0, tilt)
    _, t = finish("pots_a", bm, [M["clay"]], smooth=False)
    return {"pots_a": t, "count": len(spots)}


def build_pedestal(M=None):
    """Каменное основание креста у перекрёстка: две ступени, тумба и обломок креста."""
    M = M or mats()
    clear("pedestal_")
    x, y = PEDESTAL
    bm = bmesh.new()
    T = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(12), 4, "Z")
    add_box(bm, (0, 0, 0.11), (0.95, 0.95, 0.22), T, tile=1.0)
    add_box(bm, (0, 0, 0.32), (0.74, 0.74, 0.2), T, tile=1.0)
    add_box(bm, (0, 0, 0.78), (0.46, 0.46, 0.72), T, tile=1.0)
    add_box(bm, (0, 0, 1.16), (0.56, 0.56, 0.06), T, tile=1.0)
    stub = T @ Matrix.Translation((0, 0, 1.36)) @ Matrix.Rotation(math.radians(7), 4, "Y")
    add_box(bm, (0, 0, 0), (0.17, 0.14, 0.36), stub, tile=1.0)
    _, t = finish("pedestal_cross_a", bm, [M["stone"]])
    return {"pedestal_cross_a": t}


# ============================================================================ атмосфера: за оградой
# Игровой туман — 5…40 м, цвет (10, 13, 20): всё за ~40 м сливается с небом (sky_texture.py), ближе — тёмные
# силуэты леса в дымке. Поэтому лес стоит от 22 м, а рельеф за оградой уходит вверх, как котловина.
FOREST_FROM = 22.5            # лес начинается за этим расстоянием (по Чебышёву) от центра зоны
FOREST_TO = 58.0
ROAD_X = lambda y: 0.9 * math.sin(y * 0.06)          # дорога от ворот на юг: ось по x в зависимости от y
MOON_POS_GLTF = (15.0, 25.0, 10.0)                   # = LIGHTING_CONFIG.moonPosition (src/render/Lighting.ts), координаты glTF
MOON_COLOR = (0.55, 0.68, 1.0)
MOON_POWER = 1.0


def _noise2(x, y):
    return 0.5 + 0.5 * math.sin(x * 0.11 + 1.7) * math.cos(y * 0.13 + 0.6) + 0.25 * math.sin(x * 0.29 + y * 0.23)


def outer_height(x, y):
    """Рельеф за оградой: у ограды ровно, дальше мягкие холмы (до ~1.7 м к 46 м); у дороги на юге остаётся ровно."""
    d = max(abs(x), abs(y))
    h = _smooth(22.0, 46.0, d) * (0.4 + 1.3 * _noise2(x, y))
    if y < -19.0:
        h *= 0.2 + 0.8 * _smooth(3.0, 8.0, abs(x - ROAD_X(y)))
    return h


def _forest_floor(x, y):
    """Цвет земли за оградой (линейный): тёмный мох с пятнами и земляная дорога, уходящая от ворот."""
    n = 0.5 + 0.5 * math.sin(x * 0.7 + y * 0.45) * math.cos(y * 0.6 - x * 0.3)
    moss = (0.014 + 0.012 * n, 0.024 + 0.014 * n, 0.012 + 0.006 * n)
    if y < -19.0:
        road = 1.0 - _smooth(1.0, 2.2, abs(x - ROAD_X(y)))
        dirt = (0.046 + 0.01 * n, 0.036 + 0.008 * n, 0.026 + 0.006 * n)
        return tuple(moss[i] * (1 - road) + dirt[i] * road for i in range(3))
    return moss


def build_terrain_outer(M=None):
    """Земля за оградой: сетка 3 м от −60 до 60 (без внутреннего квадрата), цвета вершин, котловина к краям."""
    M = M or mats()
    clear("terrain_outer")
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Color")
    n, step, lo = 40, 3.0, -60.0
    verts = {}
    def vert(i, j):
        if (i, j) not in verts:
            x, y = lo + i * step, lo + j * step
            d = max(abs(x), abs(y))
            verts[(i, j)] = bm.verts.new((x, y, outer_height(x, y) - 0.03 * (1.0 - _smooth(21.0, 24.0, d))))
        return verts[(i, j)]
    faces = []
    for i in range(n):
        for j in range(n):
            cx, cy = lo + (i + 0.5) * step, lo + (j + 0.5) * step
            if abs(cx) < 18.0 and abs(cy) < 18.0:
                continue
            faces.append(bm.faces.new((vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1))))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        if f.normal.z < 0:
            f.normal_flip()
        for lp in f.loops:
            c = _forest_floor(lp.vert.co.x, lp.vert.co.y)
            lp[lay] = (*c, 1.0)
    _, t = finish("terrain_outer", bm, [M["foliage"]])
    return {"terrain_outer": t}


def _vc_cone(bm, lay, c, r1, r2, depth, seg, rot, c0, c1):
    """Конус/цилиндр вдоль Z с цветом вершин по высоте (c0 — снизу, c1 — сверху)."""
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth,
                                matrix=Matrix.Translation(c) @ Matrix.Rotation(rot, 4, "Z"))
    z0 = c[2] - depth / 2
    for f in _faces_of(res["verts"]):
        for lp in f.loops:
            k = min(max((lp.vert.co.z - z0) / depth, 0.0), 1.0)
            col = tuple(c0[i] + (c1[i] - c0[i]) * k for i in range(3))
            lp[lay] = (*col, 1.0)


def _spruce(bm, lay, rnd, x, y, z, s):
    """Ель: тонкий ствол и четыре яруса семигранных конусов (тёмный сине-зелёный), все цвета — вершинами."""
    j = rnd.uniform(0.7, 1.3)
    _vc_cone(bm, lay, (x, y, z + 1.2 * s), 0.30 * s, 0.12 * s, 3.2 * s, 6, rnd.random() * 6.28, (0.018, 0.013, 0.010), (0.024, 0.017, 0.012))
    for k in range(4):
        r = (1.75 - 0.38 * k) * s
        h = 2.8 * s
        jj = j * rnd.uniform(0.9, 1.1)
        lo = (0.010 * jj, 0.024 * jj, 0.024 * jj)
        hi = (0.021 * jj, 0.050 * jj, 0.044 * jj)
        _vc_cone(bm, lay, (x, y, z + (1.5 + 1.7 * k) * s + h / 2), r, 0.0, h, 7, rnd.random() * 6.28, lo, hi)


def _bare_tree(bm, lay, rnd, x, y, z, s):
    """Голое дерево: кривой ствол и пять веток-конусов; тёмно-бурое."""
    j = rnd.uniform(0.8, 1.25)
    lo, hi = (0.020 * j, 0.015 * j, 0.012 * j), (0.032 * j, 0.024 * j, 0.018 * j)
    _vc_cone(bm, lay, (x, y, z + 3.2 * s), 0.30 * s, 0.07 * s, 6.8 * s, 6, rnd.random() * 6.28, lo, hi)
    for k in range(5):
        az, tilt, ln = rnd.uniform(0, 360), rnd.uniform(38, 68), rnd.uniform(2.0, 3.4) * s
        base = Vector((x, y, z + rnd.uniform(3.0, 5.8) * s))
        B = Matrix.Translation(base) @ Matrix.Rotation(math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(tilt), 4, "Y")
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.12 * s, radius2=0.03 * s, depth=ln,
                                    matrix=B @ Matrix.Translation((0, 0, ln / 2)))
        for f in _faces_of(res["verts"]):
            for lp in f.loops:
                lp[lay] = (*lo, 1.0)


def build_forest(M=None, count=250, seed=61):
    """Лес за оградой: ели и голые деревья (Poisson-разброс от 22.5 м до 58 м), на рельефе terrain_outer.
    Ровный коридор — дорога от ворот на юг. Восемь секторов по азимуту — восемь мешей (отсечение по обзору)."""
    M = M or mats()
    clear("forest_ring_")
    rnd = random.Random(seed)
    bms = [bmesh.new() for _ in range(8)]
    lays = [b.loops.layers.float_color.new("Color") for b in bms]
    placed = []
    tries = 0
    while len(placed) < count and tries < 12000:
        tries += 1
        x, y = rnd.uniform(-FOREST_TO, FOREST_TO), rnd.uniform(-FOREST_TO, FOREST_TO)
        if max(abs(x), abs(y)) < FOREST_FROM:
            continue
        if y < -19.0 and abs(x - ROAD_X(y)) < 4.2:
            continue                                                     # дорога от ворот
        if any((x - px) ** 2 + (y - py) ** 2 < 4.2 ** 2 for px, py in placed):
            continue
        placed.append((x, y))
    stats = {"trees": len(placed)}
    for x, y in placed:
        sec = int(((math.atan2(y, x) + math.pi) / math.tau) * 8) % 8
        z = outer_height(x, y) - 0.25
        if rnd.random() < 0.13:
            _bare_tree(bms[sec], lays[sec], rnd, x, y, z, rnd.uniform(0.9, 1.4))
        else:
            _spruce(bms[sec], lays[sec], rnd, x, y, z, rnd.uniform(0.75, 1.3))
    for k, bm in enumerate(bms):
        _, t = finish(f"forest_ring_0{k + 1}", bm, [M["foliage"]])
        stats[f"forest_ring_0{k + 1}"] = t
    return stats


def build_moon_light():
    """Лунный свет прямо в зоне: направленный, холодный, без теней (тени даёт луна из Lighting.ts — то же направление).
    Уходит в .glb как KHR_lights_punctual; игра создаёт DirectionalLight сама. Позиция — по тому же направлению, что и диск на небе."""
    clear("moon_light")
    gx, gy, gz = MOON_POS_GLTF
    pos = Vector((gx, -gz, gy)) * 4.0                                    # glTF (x, y, z) → Blender (x, −z, y)
    data = bpy.data.lights.get("moon_light") or bpy.data.lights.new("moon_light", "SUN")
    data.color, data.energy, data.angle = MOON_COLOR, MOON_POWER, math.radians(1.0)
    obj = bpy.data.objects.new("moon_light", data)
    obj.location = pos
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = (-pos).normalized().to_track_quat("-Z", "Y")
    collection().objects.link(obj)
    return {"moon_light": tuple(round(v, 1) for v in pos), "intensity": MOON_POWER}


STEPS = [build_ground, build_path_stones, build_mounds, build_fence, build_gate, build_trees, build_lamp,
         build_lantern_light, build_bench, build_house, build_house_details, build_house_lights, build_crates,
         build_barrels, build_pots, build_pedestal, build_grass, build_flowers, build_rocks, build_twigs,
         build_terrain_outer, build_forest, build_moon_light]


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
    s["export_lights"] = True        # свет фонаря едет в .glb (в общем пресете света нет — у пропсов его нет)
    if "export_import_convert_lighting_mode" in props.keys():
        s["export_import_convert_lighting_mode"] = "RAW"   # без пересчёта Вт→кд: значение в Blender = intensity в игре
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, **s)
    return os.path.getsize(OUT_GLB) // 1024
