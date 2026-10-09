"""Детали зоны по отдельности: дерево, фонарь, забор, дом, ворота, бабочка, венки, цветы, ... — каждая в своём .glb.
Надгробия (целые, разрушенные, наклонённые) и вазу запекает bake_props.py; сюда они подтягиваются для просмотра — import_graves().

Сцена: assets_src/blender/props_kit.blend (создаётся из night_keeper_base.blend — new_kit_file()).
Каждая модель — один объект, имя = objectId (соглашение в src/data/objects.catalog.ts), origin — центр
основания на земле; в сцене модели выложены рядами только для просмотра, в .glb origin всегда (0, 0, 0).
Экспорт: public/models/props/<objectId>.glb, пресет night_keeper_glb (Draco, JPEG q85).

Геометрию строят те же функции zone_lib, что и зону, — отдельная модель совпадает с той, что стоит на карте.
Вызывается из окна Blender (через MCP) по шагам — прогресс виден вживую:

    import sys, importlib; sys.path.insert(0, r"D:\\dev\\denisovLoh\\assets_src\\blender")
    import props_kit; importlib.reload(props_kit); props_kit.build_trees(); ...; props_kit.export_all()

Направление: «перед» модели (дверь дома, лицо таблички) смотрит на −Y Blender = +Z glTF.
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import zone_lib as Z

KIT_BLEND = os.path.join(Z.HERE, "props_kit.blend")
BASE_BLEND = os.path.join(Z.HERE, "night_keeper_base.blend")
OUT_DIR = os.path.join(Z.REPO, "public", "models", "props")

# objectId → место в сцене для просмотра (x, y, z); в .glb не попадает
DISPLAY = {
    "tree_oak_a": (-14.0, 7.0, 0), "tree_oak_b": (-6.0, 7.0, 0), "tree_leafy_c": (0.5, 7.0, 0), "tree_dead_a": (6.0, 7.0, 0),
    "house_keeper_a": (-12.0, -3.5, 0), "gate_stone_a": (-4.5, -3.5, 0), "lamp_post_a": (1.5, -3.5, 0),
    "fence_wood_a": (5.8, -3.5, 0), "fence_wood_b": (9.0, -3.5, 0),
    "bench_wood_a": (-12.0, -9.0, 0), "crate_wood_a": (-9.6, -9.0, 0), "barrel_wood_a": (-8.2, -9.0, 0),
    "pot_clay_a": (-7.0, -9.0, 0), "pedestal_cross_a": (-5.4, -9.0, 0), "rock_mossy_a": (-3.2, -9.0, 0),
    "rock_mossy_b": (-1.2, -9.0, 0), "grass_tuft_a": (0.2, -9.0, 0), "flowers_wild_a": (1.3, -9.0, 0),
    "lantern_iron_a": (2.6, -9.0, 1.3), "butterfly_blue_a": (3.8, -9.0, 1.0),
    "wreath_fresh_a": (-1.6, -22.0, 0), "wreath_flower_a": (0.0, -22.0, 0), "wreath_withered_a": (1.6, -22.0, 0),
    "flowers_daisy_a": (-1.6, -24.0, 0), "flowers_bluebell_a": (0.0, -24.0, 0), "flowers_poppy_a": (1.6, -24.0, 0),
}
ANIMATED = {"butterfly_blue_a"}
# надгробия и ваза запекает bake_props.py (процедурные текстуры → albedo/normal/orm) и сам экспортирует в .glb;
# здесь они только выложены для просмотра (импорт — import_graves()), в export_all() не входят
GRAVES = {
    "gravestone_cross_a": (-2.7, -15.0), "gravestone_arch_a": (-0.9, -15.0), "gravestone_slab_a": (0.9, -15.0),
    "vase_clay_01": (2.7, -15.0),
    "gravestone_cross_broken_a": (-2.7, -17.2), "gravestone_slab_broken_a": (-0.9, -17.2),
    "gravestone_rubble_a": (0.9, -17.2), "gravestone_arch_broken_a": (2.7, -17.2),
    "gravestone_cross_tilted_a": (-1.8, -19.4), "gravestone_arch_tilted_a": (0.0, -19.4),
    "gravestone_headstone_tilted_a": (1.8, -19.4),
}
PROPS_BLEND = os.path.join(Z.HERE, "props_cemetery.blend")


# ============================================================================ служебное
def new_kit_file():
    """Пустая сцена набора из базового файла (единицы, свет, ref-фигура 1.7 м) → props_kit.blend."""
    bpy.ops.wm.open_mainfile(filepath=BASE_BLEND)
    bpy.context.scene.render.fps = 24
    bpy.ops.wm.save_as_mainfile(filepath=KIT_BLEND, compress=False, relative_remap=True)
    return {"kit": KIT_BLEND, "objects": [o.name for o in bpy.data.objects]}


def to_origin(obj, T):
    """Модель построена в зоне с положением T → переносим геометрию в начало координат."""
    obj.data.transform(T.inverted())
    obj.data.update()
    return obj


def join(name, names):
    """Склеивает объекты зоны (дом из стен, крыши, двери, ...) в одну модель; слоты материалов объединяются."""
    objs = [bpy.data.objects[n] for n in names]
    with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    o = objs[0]
    o.name = o.data.name = name
    return o


def place(obj):
    obj.location = DISPLAY[obj.name]
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ============================================================================ модели из зоны
def build_trees(M=None):
    """Три лиственных дерева (дуб a, дуб b поменьше, лиственное c) и сухое — как на карте."""
    M = M or Z.mats()
    Z.build_trees(M)
    out = {}
    for name, (cx, cy) in [(n, p) for n, p, _, _ in Z.TREES] + [("tree_dead_a", Z.DEAD_TREE)]:
        out[name] = place(to_origin(bpy.data.objects[name], Matrix.Translation((cx, cy, 0))))
    return out


def build_lamp(M=None):
    """Фонарный столб с подвесным фонарём; origin — центр каменного основания."""
    M = M or Z.mats()
    Z.build_lamp(M)
    o = to_origin(bpy.data.objects["lamp_post_a"], Matrix.Translation((*Z.LAMP_POS, 0)))
    return {"lamp_post_a": place(o)}


def build_lantern(M=None):
    """Подвесной фонарь отдельно (без столба): origin — точка подвеса над кольцом, фонарь висит вниз на 0.68 м."""
    M = M or Z.mats()
    Z.clear("lantern_iron_")
    bm = bmesh.new()
    Z._lantern(bm, Vector((0, 0, 0)), s=1.0, mi_iron=0, mi_glass=1, mi_flame=2, mi_candle=3)
    o, _ = Z.finish("lantern_iron_a", bm, [M["iron"], M["glass"], M["flame"], M["candle"]])
    return {"lantern_iron_a": place(o)}


def build_house(M=None):
    """Сторожка целиком: фундамент, стены, крыша, труба, дверь, окна, крыльцо, фонарь у двери (без брусчатки и света).
    origin — центр фундамента; дверь на −Y."""
    M = M or Z.mats()
    Z.build_house(M)
    Z.build_house_details(M)
    Z.clear("house_patio_")
    o = join("house_keeper_a", ["house_walls_a", "house_foundation_a", "house_roof_a", "house_chimney_a",
                                "house_door_a", "house_windows_a", "house_porch_a", "house_lantern_a"])
    h = Z.HOUSE
    to_origin(o, Matrix.Translation((h["cx"], (h["y0"] + h["y1"]) / 2, 0)))
    return {"house_keeper_a": place(o)}


def build_gate(M=None):
    """Ворота: два каменных столба, балка с цепями и табличка «СТАРОЕ КЛАДБИЩЕ»; origin — центр проёма (3.5 м)."""
    M = M or Z.mats()
    Z.build_gate(M)
    o = join("gate_stone_a", ["gate_pillar_01", "gate_pillar_02", "gate_beam_a", "gate_sign_a"])
    to_origin(o, Matrix.Translation((0, -Z.ZONE, 0)))
    return {"gate_stone_a": place(o)}


def build_bench(M=None):
    M = M or Z.mats()
    Z.build_bench(M)
    (x, y), rot = Z.BENCH_T
    T = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(rot), 4, "Z")
    return {"bench_wood_a": place(to_origin(bpy.data.objects["bench_wood_a"], T))}


def build_pedestal(M=None):
    M = M or Z.mats()
    Z.build_pedestal(M)
    T = Matrix.Translation((*Z.PEDESTAL, 0)) @ Matrix.Rotation(math.radians(12), 4, "Z")
    return {"pedestal_cross_a": place(to_origin(bpy.data.objects["pedestal_cross_a"], T))}


# ============================================================================ модели по одной штуке
FENCE_STEP = 2.4     # пролёт забора, как в зоне; секции ставятся в ряд с шагом 2.4 м по X (соседние делят столб)


def build_fence(M=None):
    """Секция забора: два столба и две жерди на болтах (a); покосившаяся — жердь сорвалась с болта, нижняя лежит (b).
    origin — середина пролёта, жерди вдоль X."""
    M = M or Z.mats()
    Z.clear("fence_wood_a", "fence_wood_b")
    out = {}
    for name, broken in (("fence_wood_a", False), ("fence_wood_b", True)):
        bm = bmesh.new()
        S = Matrix.Translation((-FENCE_STEP / 2, 0, 0))
        for i, hgt in enumerate((1.36, 1.32)):
            lean = Matrix.Rotation(-0.07, 4, "Y") if broken and i == 1 else Matrix.Identity(4)
            Z._fence_post(bm, S @ Matrix.Translation((i * FENCE_STEP, 0, 0)) @ lean, hgt)
        R = S @ Matrix.Translation((0, 0.105, 1.05))                       # верхняя: у сломанной висит на одном болте
        R = R @ Matrix.Rotation(0.22 if broken else 0.0, 4, "Y") @ Matrix.Translation((FENCE_STEP / 2, 0, 0))
        Z._fence_rail(bm, R, FENCE_STEP, off=(0.31, 0.62))
        if broken:                                                         # нижняя упала на землю
            R = (Matrix.Translation((0.1, 0.42, 0.03)) @ Matrix.Rotation(0.12, 4, "Z")
                 @ Matrix.Rotation(math.pi / 2, 4, "X"))
        else:
            R = S @ Matrix.Translation((FENCE_STEP / 2, 0.105, 0.55))
        Z._fence_rail(bm, R, FENCE_STEP, off=(0.77, 0.18))
        o, _ = Z.finish(name, bm, [M["wood"], M["planks"], M["iron"]])
        out[name] = place(o)
    return out


def build_small(M=None):
    """Ящик, бочка, горшок с ручками, мшистые камни (валун и россыпь), пучок травы, полевые цветы."""
    M = M or Z.mats()
    Z.clear("crate_wood_", "barrel_wood_", "pot_clay_", "rock_mossy_", "grass_tuft_", "flowers_wild_")
    out = {}
    bm = bmesh.new()
    Z._crate(bm, 0, 0, 0, 0.66, 0, M)
    out["crate_wood_a"] = place(Z.finish("crate_wood_a", bm, [M["planks"], M["wood"]])[0])
    bm = bmesh.new()
    Z._barrel(bm, 0, 0)
    out["barrel_wood_a"] = place(Z.finish("barrel_wood_a", bm, [M["planks"], M["iron"]])[0])
    bm = bmesh.new()
    Z._pot(bm, 0, 0, 1.0, 0.5)
    out["pot_clay_a"] = place(Z.finish("pot_clay_a", bm, [M["clay"]])[0])

    for name, seed, stones in (("rock_mossy_a", 55, [(0, 0, 0.85, 2)]),
                               ("rock_mossy_b", 56, [(0, 0, 0.34, 1), (0.42, 0.2, 0.22, 1), (-0.3, 0.34, 0.17, 1)])):
        rnd = random.Random(seed)
        bm = bmesh.new()
        lay = bm.loops.layers.float_color.new("Color")
        for x, y, r, sub in stones:
            Z._rock(bm, lay, rnd, x, y, r, sub)
        out[name] = place(Z.finish(name, bm, [M["stone_vc"]])[0])

    rnd = random.Random(3)
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Color")
    for x, y, kind, s in ((0, 0, "green", 1.2), (0.13, 0.07, "light", 0.9), (-0.1, 0.1, "dry", 0.8)):
        Z._tuft(bm, lay, rnd, x, y, kind, s)
    out["grass_tuft_a"] = place(Z.finish("grass_tuft_a", bm, [M["blades"]])[0])

    rnd = random.Random(9)
    bm = bmesh.new()
    lay = bm.loops.layers.float_color.new("Color")
    for k in range(9):
        a, d = k * 2.4, 0.04 + 0.05 * (k % 4)
        Z._flower(bm, lay, rnd, math.cos(a) * d, math.sin(a) * d, Z.FLOWER_PALETTE[0 if k % 3 else 2])
    out["flowers_wild_a"] = place(Z.finish("flowers_wild_a", bm, [M["blades"]])[0])
    return out


# ============================================================================ венки и цветы
def build_flora(M=None):
    """Три венка (свежий, цветочный, увядший) и три пучка цветов (ромашки, колокольчики, маки); геометрия — props_flora.py."""
    import props_flora
    M = M or Z.mats()
    Z.clear("wreath_", "flowers_daisy_", "flowers_bluebell_", "flowers_poppy_")
    out = {}
    for name, bm in (("wreath_fresh_a", props_flora.wreath("fresh")), ("wreath_flower_a", props_flora.wreath("flower")),
                     ("wreath_withered_a", props_flora.wreath("withered")), ("flowers_daisy_a", props_flora.daisies()),
                     ("flowers_bluebell_a", props_flora.bluebells()), ("flowers_poppy_a", props_flora.poppies())):
        out[name] = place(Z.finish(name, bm, [M["blades"]])[0])
    return out


def import_graves():
    """Надгробия и вазу — из props_cemetery.blend (с запечёнными материалами) в эту сцену, в ряды для просмотра."""
    Z.clear(*GRAVES)
    with bpy.data.libraries.load(PROPS_BLEND, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in GRAVES]
    for o in dst.objects:
        Z.collection().objects.link(o)
        o.location = (*GRAVES[o.name], 0)
    return {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in dst.objects}


# ============================================================================ бабочка
WING = 0.075                # длина крыла, м (размах ≈ 0.16 м)
WING_SECTOR = (-112.0, 104.0)  # сектор крыла от поперечной оси, ° (+ — к голове)
WING_TEX = "butterfly_blue_a_albedo.jpg"


def wing_radius(th):
    """Контур крыла в полярных координатах от корня (th в градусах; numpy или float):
    переднее крыло (вперёд-наружу), заднее (назад) и выемка между ними."""
    return 0.25 + 0.8 * np.exp(-((th - 35.0) / 38.0) ** 2) + 0.55 * np.exp(-((th + 50.0) / 35.0) ** 2)


def wing_uv(wx, wy):
    """Координаты крыла (в длинах крыла, y — к голове) → UV текстуры крыла."""
    return (wx + 0.15) / 1.3, (wy + 1.05) / 2.15


def wing_texture(size=512):
    """Текстура крыла морфо: тёмный корень → ярко-синее поле с бликом → чёрная кайма с белыми точками; тёмные жилки."""
    rows, cols = np.mgrid[0:size, 0:size] + 0.5
    wx, wy = cols / size * 1.3 - 0.15, rows / size * 2.15 - 1.05
    th = np.degrees(np.arctan2(wy, wx))
    t = np.hypot(wx, wy) / wing_radius(th)

    def lerp(a, b, k):
        return a + (np.asarray(b) - a) * k[..., None]

    def smooth(a, b, x):
        k = np.clip((x - a) / (b - a), 0, 1)
        return k * k * (3 - 2 * k)

    col = lerp(np.broadcast_to(np.array([0.05, 0.06, 0.14]), (size, size, 3)), [0.12, 0.42, 0.92], smooth(0.1, 0.45, t))
    glow = np.exp(-((t - 0.55) / 0.18) ** 2) * np.exp(-((th - 30.0) / 30.0) ** 2) * 0.55
    col = lerp(col, [0.5, 0.8, 1.0], glow)
    d = np.abs(((th / 13.0) % 1.0) - 0.5)                                  # радиальные жилки
    vein = np.exp(-((0.5 - d) / 0.07) ** 2) * smooth(0.12, 0.25, t) * (1 - smooth(0.7, 0.8, t))
    col = col * (1 - 0.55 * vein)[..., None]
    col = lerp(col, [0.025, 0.025, 0.04], smooth(0.79, 0.86, t))        # кайма
    for a in np.arange(-82.0, 83.0, 14.0):                                # белые точки в кайме (не у тельца)
        r = float(wing_radius(a)) * 0.925
        cx, cy = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
        spot = 1 - smooth(0.018, 0.028, np.hypot(wx - cx, wy - cy))
        col = lerp(col, [0.92, 0.95, 1.0], spot)
    img = bpy.data.images.get(WING_TEX) or bpy.data.images.new(WING_TEX, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    data = np.ones((size, size, 4), np.float32)
    data[..., :3] = np.clip(col, 0, 1)
    img.pixels.foreach_set(data.ravel())
    img.filepath_raw = os.path.join(Z.TEX, WING_TEX)
    img.file_format = "JPEG"
    img.save()
    return img


def wing_material(img):
    """Крыло: albedo-текстура, двусторонний (у плоского крыла видны обе стороны)."""
    m = Z._fresh("mat_butterfly_blue_a_wing", False)
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf, out, tex = N.new("ShaderNodeBsdfPrincipled"), N.new("ShaderNodeOutputMaterial"), N.new("ShaderNodeTexImage")
    tex.image = img
    L.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.55
    return m


def _wing(name, side, mat, parent):
    """Крыло веером от корня: 30 лучей × 3 кольца, лёгкий изгиб вверх к краю; side=+1 — по +X, −1 — по −X."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    n, rings = 30, (0.4, 0.75, 1.0)
    root = bm.verts.new((0, 0, 0))
    grid = []
    for i in range(n + 1):
        th = WING_SECTOR[0] + (WING_SECTOR[1] - WING_SECTOR[0]) * i / n
        R = float(wing_radius(th))
        col = []
        for t in rings:
            wx, wy = R * t * math.cos(math.radians(th)), R * t * math.sin(math.radians(th))
            col.append(bm.verts.new((side * wx * WING, -wy * WING, 0.09 * (R * t) ** 2 * WING)))
        grid.append(col)
    faces = []
    for i in range(n):
        faces.append(bm.faces.new((root, grid[i][0], grid[i + 1][0])))
        for j in range(len(rings) - 1):
            faces.append(bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])))
    for f in faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        for lp in f.loops:
            x, y, _ = lp.vert.co
            lp[uv].uv = wing_uv(side * x / WING, -y / WING)
    o, _ = Z.finish(name, bm, [mat])
    o.parent = parent
    o.location = (side * 0.005, -0.004, 0.004)
    return o


def _flap(obj, side):
    """Взмах: крыло поднимается на 68° и опускается на −8°, кадры 0–6 (0.25 с при 24 fps, с нуля — без паузы
    при зацикливании) → дорожка NLA «flap». Одноимённые дорожки двух крыльев экспорт склеивает в одну
    glTF-анимацию «flap» (режим NLA_TRACKS)."""
    obj.animation_data_clear()
    for frame, deg in ((0, -8.0), (3, 68.0), (6, -8.0)):
        obj.rotation_euler = (0, -side * math.radians(deg), 0)
        obj.keyframe_insert("rotation_euler", index=1, frame=frame)
    ad = obj.animation_data
    act = ad.action
    old = bpy.data.actions.get(f"flap_{obj.name}")
    if old and old != act:                                                 # от прошлой сборки
        bpy.data.actions.remove(old)
    act.name = f"flap_{obj.name}"
    track = ad.nla_tracks.new()
    track.name = "flap"
    track.strips.new("flap", 0, act)
    ad.action = None
    obj.rotation_euler = (0, 0, 0)


def build_butterfly(M=None):
    """Бабочка-морфо: тельце (грудь, брюшко, голова, усики с булавами) и два крыла-потомка с анимацией взмаха.
    origin — центр груди; голова на −Y (вперёд в glTF)."""
    M = M or Z.mats()
    Z.clear("butterfly_blue_a")
    body = Z.flat_material("mat_butterfly_body", (0.018, 0.016, 0.02), rough=0.9)
    bm = bmesh.new()
    for c, s in (((0, -0.004, 0), (0.0085, 0.012, 0.0085)), ((0, 0.021, -0.002), (0.0055, 0.022, 0.0055)),
                 ((0, -0.019, 0.001), (0.0062, 0.0062, 0.0062))):          # грудь, брюшко, голова
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*s, 1)))
    for sx in (-1, 1):                                                     # усики
        a, b = Vector((sx * 0.002, -0.023, 0.004)), Vector((sx * 0.011, -0.046, 0.02))
        d = b - a
        Mt = Matrix.Translation((a + b) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        Z.add_cone(bm, (0, 0, 0), 0.0009, 0.0007, d.length, seg=4, M=Mt)
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0022, matrix=Matrix.Translation(b))
    o, _ = Z.finish("butterfly_blue_a", bm, [body], smooth=True)
    wing = wing_material(wing_texture())
    for side, nm in ((1, "l"), (-1, "r")):                                 # левое крыло — +X (бабочка смотрит на −Y)
        _flap(_wing(f"butterfly_blue_a_wing_{nm}", side, wing, o), side)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, 6
    tris = place(o) + sum(len(p.vertices) - 2 for c in o.children for p in c.data.polygons)
    return {"butterfly_blue_a": tris}


# ============================================================================ всё и экспорт
STEPS = [build_trees, build_house, build_gate, build_lamp, build_lantern, build_fence, build_bench, build_pedestal,
         build_small, build_flora, build_butterfly]


def build_all():
    M = Z.mats()
    out = {}
    for fn in STEPS:
        out.update(fn(M))
    return out


def export(name):
    """Один объект (с потомками) → public/models/props/<name>.glb; на время экспорта модель в начале координат."""
    o = bpy.data.objects[name]
    loc = o.location.copy()
    o.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for x in (o, *o.children_recursive):
        x.select_set(True)
    bpy.context.view_layer.objects.active = o
    s = Z.export_settings()
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    if "export_vertex_color" in props.keys():
        s["export_vertex_color"] = "MATERIAL"
    s["use_selection"] = True
    s["export_animations"] = name in ANIMATED
    if name in ANIMATED:
        s["export_animation_mode"] = "NLA_TRACKS"
    path = os.path.join(OUT_DIR, name + ".glb")
    try:
        bpy.ops.export_scene.gltf(filepath=path, **s)
    finally:
        o.location = loc
    return os.path.getsize(path) // 1024


def export_all():
    return {name: export(name) for name in DISPLAY}
