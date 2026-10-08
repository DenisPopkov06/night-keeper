"""Детализированные пропсы кладбища: геометрия, процедурные текстуры, запекание, экспорт .glb.

Строит пропсы с нуля от night_keeper_base.blend (фаски, UV), делает процедурные материалы
(камень/глина, трещины, мох, грязь, гравировка), запекает albedo / normal / ORM,
пишет текстуры в assets_src/textures_src/, экспортирует .glb в public/models/props/
по пресету night_keeper_glb и сохраняет props_cemetery.blend.

Запуск (из корня репозитория):
    blender --background --factory-startup --python assets_src/blender/bake_props.py

Отладка одного пропса:  set NK_ONLY=gravestone_slab_a
Тексты надписей и параметры внешнего вида — в словаре PROPS ниже.
"""
import ast
import math
import os
import re

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE_BLEND = os.path.join(HERE, "night_keeper_base.blend")
OUT_BLEND = os.path.join(HERE, "props_cemetery.blend")
PRESET = os.path.join(HERE, "night_keeper_glb_preset.py")
TEX_DIR = os.path.join(REPO, "assets_src", "textures_src")
OUT_DIR = os.path.join(REPO, "public", "models", "props")
TMP = os.path.join(os.environ.get("TEMP", HERE), "nk_bake")
FONT = r"C:\Windows\Fonts\times.ttf"  # Times New Roman: есть кириллица и «†»
FONT_BOLD = r"C:\Windows\Fonts\timesbd.ttf"
ONLY = [n for n in os.environ.get("NK_ONLY", "").split(",") if n]

# size — сторона текстуры (стандарт: 1024, мелочь — 512); text.center/size — прямоугольник
# надписи на лицевой стороне (-Y) в метрах: (x, z) центра и (ширина, высота).
PROPS = {
    "gravestone_cross_a": dict(
        kind="stone", size=1024, x=-2.4, crack=0.8, moss=0.9, moss_h=0.32,
        colors=((0.12, 0.12, 0.13), (0.23, 0.22, 0.21)),
        text=dict(lines=["ПОКОЙСЯ С МИРОМ"], center=(0.0, 0.075), size=(0.50, 0.075), font=FONT_BOLD),
    ),
    "gravestone_arch_a": dict(
        kind="stone", size=1024, x=-1.2, crack=1.0, moss=0.7, moss_h=0.30,
        colors=((0.13, 0.13, 0.14), (0.24, 0.23, 0.22)),
        text=dict(lines=["R.I.P.", "ELEANOR", "MARSH", "1858 – 1911"], center=(0.0, 0.62),
                  size=(0.42, 0.40), font=FONT_BOLD),
    ),
    "gravestone_slab_a": dict(
        kind="stone", size=1024, x=1.2, crack=1.1, moss=0.8, moss_h=0.28,
        colors=((0.11, 0.12, 0.12), (0.21, 0.21, 0.20)),
        text=dict(lines=["†", "ИВАН", "ПЕТРОВИЧ", "СМОЛИН", "1871 – 1934"], center=(0.0, 0.43),
                  size=(0.50, 0.52), font=FONT_BOLD),
    ),
    "vase_clay_01": dict(
        kind="clay", size=512, x=2.4, crack=0.7, moss=0.0, moss_h=0.1,
        colors=((0.34, 0.16, 0.08), (0.48, 0.25, 0.13)), text=None,
    ),
}


def log(*a):
    print("NK:", *a, flush=True)


# ----------------------------------------------------------------------------- геометрия
def box(bm, cx, cy, cz, sx, sy, sz):
    bmesh.ops.create_cube(bm, size=1.0,
                          matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((sx, sy, sz, 1.0)))


def extrude_profile(bm, pts, depth):
    """Контур в плоскости XZ, выдавленный по Y на depth (центр по Y = 0)."""
    verts = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=top)


def make_object(name, bm, col):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)  # origin = центр основания
    col.objects.link(obj)
    return obj


def geometry(name, col):
    bm = bmesh.new()
    if name == "gravestone_cross_a":  # крест на цоколе, 1.05 м
        box(bm, 0, 0, 0.075, 0.62, 0.34, 0.15)
        extrude_profile(bm, [(-0.10, 0.15), (0.10, 0.15), (0.10, 0.72), (0.28, 0.72), (0.28, 0.90),
                             (0.10, 0.90), (0.10, 1.05), (-0.10, 1.05), (-0.10, 0.90), (-0.28, 0.90),
                             (-0.28, 0.72), (-0.10, 0.72)], 0.13)
    elif name == "gravestone_arch_a":  # арка на цоколе, 1.00 м
        box(bm, 0, 0, 0.06, 0.74, 0.30, 0.12)
        arch = [(-0.30, 0.12), (0.30, 0.12)] + [
            (0.30 * math.cos(math.radians(a)), 0.70 + 0.30 * math.sin(math.radians(a)))
            for a in range(0, 181, 20)]
        extrude_profile(bm, arch, 0.12)
    elif name == "gravestone_slab_a":  # плита со срезанными углами, 0.85 м
        extrude_profile(bm, [(-0.35, 0), (0.35, 0), (0.35, 0.77), (0.27, 0.85), (-0.27, 0.85),
                             (-0.35, 0.77)], 0.14)
    elif name == "vase_clay_01":  # токарный профиль, 16 граней, 0.285 м
        prof = [(0.0, 0.0), (0.060, 0.0), (0.085, 0.02), (0.100, 0.06), (0.112, 0.11), (0.113, 0.14),
                (0.100, 0.18), (0.075, 0.215), (0.052, 0.238), (0.050, 0.250), (0.066, 0.272),
                (0.070, 0.285), (0.056, 0.285), (0.046, 0.262), (0.040, 0.245), (0.0, 0.245)]
        vs = [bm.verts.new((r, 0, z)) for r, z in prof]
        for a, b in zip(vs, vs[1:]):
            bm.edges.new((a, b))
        bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), cent=(0, 0, 0), axis=(0, 0, 1),
                       dvec=(0, 0, 0), angle=math.tau, space=Matrix(), steps=16, use_merge=True,
                       use_normal_flip=False, use_duplicate=False)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    obj = make_object(name, bm, col)
    if PROPS[name]["kind"] == "stone":  # фаски: ребро ловит свет, не «бумажный» край
        mod = obj.modifiers.new("nk_bevel", "BEVEL")
        mod.width, mod.segments = 0.012, 2
        mod.limit_method, mod.angle_limit = "ANGLE", math.radians(35)
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in obj.data.polygons:
            p.use_smooth = False
    else:  # гладкое затенение, резкими остаются только рёбра острее 40° (кромка горла, донышко)
        sm = bmesh.new()
        sm.from_mesh(obj.data)
        for f in sm.faces:
            f.smooth = True
        for e in sm.edges:
            ang = e.calc_face_angle(None)
            e.smooth = ang is None or ang <= math.radians(40)
        sm.to_mesh(obj.data)
        sm.free()
    return obj


def unwrap(obj):
    vl = bpy.context.view_layer
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    vl.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if PROPS[obj.name]["kind"] == "clay":
        # тело вращения: цилиндрическая развёртка одним куском, без швов-«кусков» smart_project
        bpy.ops.uv.cylinder_project(direction="ALIGN_TO_OBJECT", align="POLAR_ZX", scale_to_bounds=True)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.015)
        bpy.ops.uv.pack_islands(margin=0.012, rotate=True)  # плотнее заполнить атлас
    bpy.ops.object.mode_set(mode="OBJECT")


# ----------------------------------------------------------------------------- маска надписи
def render_text_mask(lines, size_wh, font_path, out_path, px=1024):
    """Белый текст на чёрном, ортокамера сверху: картинка = прямоугольник w×h на лицевой стороне."""
    w, h = size_wh
    sc = bpy.data.scenes.new("nk_mask")
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = px, max(64, round(px * h / w))
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (1, 1, 1)
    sc.display.shading.show_object_outline = False
    sc.display.render_aa = "8"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    world = bpy.data.worlds.new("nk_mask_world")
    world.color = (0, 0, 0)
    sc.world = world
    cam_d = bpy.data.cameras.new("nk_mask_cam")
    cam_d.type, cam_d.ortho_scale, cam_d.sensor_fit = "ORTHO", w, "HORIZONTAL"
    cam = bpy.data.objects.new("nk_mask_cam", cam_d)
    cam.location = (0, 0, 5)
    sc.collection.objects.link(cam)
    sc.camera = cam
    curve = bpy.data.curves.new("nk_mask_text", "FONT")
    curve.body = "\n".join(lines)
    curve.font = bpy.data.fonts.load(font_path)
    curve.align_x, curve.align_y, curve.size, curve.space_line = "CENTER", "CENTER", 0.05, 1.2
    obj = bpy.data.objects.new("nk_mask_text", curve)
    sc.collection.objects.link(obj)
    sc.view_layers[0].update()
    dx, dy = max(obj.dimensions.x, 1e-6), max(obj.dimensions.y, 1e-6)
    curve.size *= min(w * 0.92 / dx, h * 0.92 / dy)  # вписать с запасом по краям
    sc.view_layers[0].update()
    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    for o in (obj, cam):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.curves.remove(curve)
    bpy.data.cameras.remove(cam_d)
    bpy.data.scenes.remove(sc)
    bpy.data.worlds.remove(world)
    img = bpy.data.images.load(out_path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    return img


# ----------------------------------------------------------------------------- процедурный материал
def build_bake_material(name, cfg, mask_img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, Lk = nt.nodes, nt.links
    N.clear()

    def put(sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            Lk.new(v, sock)
        elif v is not None:
            sock.default_value = v

    def noise(vec, scale, detail=6, rough=0.55):
        n = N.new("ShaderNodeTexNoise")
        n.noise_dimensions = "3D"
        put(n.inputs["Vector"], vec)
        put(n.inputs["Scale"], scale)
        put(n.inputs["Detail"], detail)
        put(n.inputs["Roughness"], rough)
        return n

    def mapping(vec, loc=(0, 0, 0), scale=(1, 1, 1)):
        n = N.new("ShaderNodeMapping")
        put(n.inputs["Vector"], vec)
        n.inputs["Location"].default_value = loc
        n.inputs["Scale"].default_value = scale
        return n.outputs["Vector"]

    def math_(op, a, b=None, clamp=False):
        n = N.new("ShaderNodeMath")
        n.operation, n.use_clamp = op, clamp
        put(n.inputs[0], a)
        put(n.inputs[1], b)
        return n.outputs[0]

    def maprange(v, a0, a1, b0, b1, clamp=True):
        n = N.new("ShaderNodeMapRange")
        n.clamp = clamp
        put(n.inputs["Value"], v)
        for key, val in (("From Min", a0), ("From Max", a1), ("To Min", b0), ("To Max", b1)):
            n.inputs[key].default_value = val
        return n.outputs["Result"]

    def mix(fac, a, b, blend="MIX"):
        n = N.new("ShaderNodeMix")
        n.data_type, n.blend_type, n.clamp_factor = "RGBA", blend, True
        put(n.inputs[0], fac)
        put(n.inputs[6], a if isinstance(a, bpy.types.NodeSocket) else (*a, 1.0))
        put(n.inputs[7], b if isinstance(b, bpy.types.NodeSocket) else (*b, 1.0))
        return n.outputs[2]

    def ramp(fac, c0, c1):
        n = N.new("ShaderNodeValToRGB")
        n.color_ramp.elements[0].color = (*c0, 1.0)
        n.color_ramp.elements[1].color = (*c1, 1.0)
        put(n.inputs["Fac"], fac)
        return n.outputs["Color"]

    def sepxyz(vec):
        n = N.new("ShaderNodeSeparateXYZ")
        put(n.inputs["Vector"], vec)
        return n.outputs["X"], n.outputs["Y"], n.outputs["Z"]

    co = N.new("ShaderNodeTexCoord").outputs["Object"]
    cx, cy, cz = sepxyz(co)
    n_big = noise(co, 2.2, 8, 0.6).outputs["Factor"]
    n_mid = noise(mapping(co, (5, 3, 7)), 9, 6, 0.55).outputs["Factor"]
    n_fine = noise(co, 70, 3, 0.5).outputs["Factor"]

    # --- базовый цвет: два тона по крупному шуму + мелкое зерно
    c = ramp(n_big, *cfg["colors"])
    c = mix(1.0, c, maprange(n_fine, 0.0, 1.0, 0.78, 1.18, clamp=False), "MULTIPLY")

    # --- трещины: рёбра вороного, исказённые шумом, только на части поверхности
    jitter = noise(co, 4, 3, 0.5)
    vm = N.new("ShaderNodeVectorMath")
    vm.operation = "SCALE"
    Lk.new(jitter.outputs["Color"], vm.inputs[0])
    vm.inputs[3].default_value = 0.10
    va = N.new("ShaderNodeVectorMath")
    va.operation = "ADD"
    Lk.new(co, va.inputs[0])
    Lk.new(vm.outputs["Vector"], va.inputs[1])
    vor = N.new("ShaderNodeTexVoronoi")
    vor.voronoi_dimensions, vor.feature = "3D", "DISTANCE_TO_EDGE"
    Lk.new(mapping(va.outputs["Vector"], (1.3, 2.1, 0.7)), vor.inputs["Vector"])
    vor.inputs["Scale"].default_value = 3.6 if cfg["kind"] == "stone" else 6.0
    vor.inputs["Randomness"].default_value = 1.0
    line = maprange(vor.outputs["Distance"], 0.0, 0.03, 1.0, 0.0)
    region = maprange(n_mid, 0.47, 0.60, 0.0, 1.0)
    crack = math_("MULTIPLY", math_("MULTIPLY", line, region), cfg["crack"], clamp=True)

    # --- грязь у основания и мох
    dirt = math_("MULTIPLY", maprange(cz, 0.0, 0.14, 1.0, 0.0), 0.55)
    zmask = maprange(cz, 0.0, cfg["moss_h"], 1.0, 0.0)
    moss = maprange(math_("ADD", math_("MULTIPLY", zmask, 0.85), math_("MULTIPLY", n_mid, 0.65)),
                    0.62, 0.88, 0.0, 1.0)  # пятнами, а не ровной полосой
    moss = math_("MULTIPLY", moss, cfg["moss"])

    # --- надпись: плоская проекция маски на лицевую сторону (-Y)
    text = None
    if cfg["text"] and mask_img:
        t = cfg["text"]
        (tx, tz), (tw, th) = t["center"], t["size"]
        comb = N.new("ShaderNodeCombineXYZ")
        Lk.new(cx, comb.inputs["X"])
        Lk.new(cz, comb.inputs["Y"])
        mp = mapping(comb.outputs["Vector"], (0.5 - tx / tw, 0.5 - tz / th, 0), (1 / tw, 1 / th, 1))
        tex = N.new("ShaderNodeTexImage")
        tex.image, tex.extension, tex.interpolation = mask_img, "CLIP", "Linear"
        Lk.new(mp, tex.inputs["Vector"])
        _, ny, _ = sepxyz(N.new("ShaderNodeNewGeometry").outputs["Normal"])
        facing = maprange(math_("MULTIPLY", ny, -1.0), 0.5, 0.9, 0.0, 1.0)
        text = math_("MULTIPLY", tex.outputs["Color"], facing, clamp=True)

    # --- декор вазы: тёмные пояски глазури
    band = None
    if cfg["kind"] == "clay":
        def stripe(z0, half):
            return maprange(math_("ABSOLUTE", math_("SUBTRACT", cz, z0)), half * 0.5, half, 1.0, 0.0)
        band = math_("ADD", stripe(0.095, 0.014), math_("ADD", stripe(0.165, 0.014), stripe(0.268, 0.010)),
                     clamp=True)

    # --- сборка цвета
    c = mix(dirt, c, (0.07, 0.06, 0.05))
    if cfg["moss"] > 0:
        c = mix(math_("MULTIPLY", moss, 0.75), c, (0.09, 0.16, 0.05))
    if band is not None:
        c = mix(math_("MULTIPLY", band, 0.9), c, (0.16, 0.07, 0.04))
    c = mix(math_("MULTIPLY", crack, 0.85), c, (0.025, 0.025, 0.025))
    if text is not None:
        c = mix(math_("MULTIPLY", text, 0.8), c, (0.05, 0.05, 0.05))

    # --- рельеф: зерно, трещины и гравировка вдавлены, пояски вазы чуть выступают
    height = math_("MULTIPLY", n_fine, 0.35)
    height = math_("SUBTRACT", height, math_("MULTIPLY", crack, 1.2))
    if text is not None:
        height = math_("SUBTRACT", height, math_("MULTIPLY", text, 1.6))
    if band is not None:
        height = math_("ADD", height, math_("MULTIPLY", band, 0.8))
    bump = N.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.0025  # высота 1.0 = 2.5 мм
    Lk.new(height, bump.inputs["Height"])

    base_r = 0.78 if cfg["kind"] == "stone" else 0.62
    rough = math_("ADD", base_r, math_("ADD", math_("MULTIPLY", n_fine, 0.18),
                                       math_("MULTIPLY", moss, 0.12)), clamp=True)
    if band is not None:
        rough = math_("SUBTRACT", rough, math_("MULTIPLY", band, 0.25), clamp=True)

    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.0
    Lk.new(c, bsdf.inputs["Base Color"])
    Lk.new(rough, bsdf.inputs["Roughness"])
    Lk.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = N.new("ShaderNodeOutputMaterial")
    Lk.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


# ----------------------------------------------------------------------------- запекание
def bake_pass(obj, mat, kind, size, colorspace):
    nt = mat.node_tree
    for o in bpy.data.objects:  # bake работает с выбранным/активным объектом
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    img = bpy.data.images.new(f"nk_{obj.name}_{kind}", size, size, alpha=False)
    img.colorspace_settings.name = colorspace
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    sc = bpy.context.scene
    sc.cycles.samples = 48 if kind == "AO" else 8
    bpy.ops.object.bake(type=kind)
    nt.nodes.remove(node)
    return img


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def save_jpeg(img, path):
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save()


def make_orm(ao, rough, size, name):
    orm = bpy.data.images.new(name, size, size, alpha=False)
    orm.colorspace_settings.name = "Non-Color"
    data = np.ones((size * size, 4), dtype=np.float32)
    data[:, 0] = pixels(ao)[:, 0]     # R = ambient occlusion
    data[:, 1] = pixels(rough)[:, 0]  # G = roughness
    data[:, 2] = 0.0                  # B = metalness (камень и глина — не металл)
    orm.pixels.foreach_set(data.ravel())
    return orm


def bake_prop(obj, cfg):
    name = obj.name
    sc = bpy.context.scene
    size = cfg["size"]
    os.makedirs(TEX_DIR, exist_ok=True)
    mask = None
    if cfg["text"]:
        mask = render_text_mask(cfg["text"]["lines"], cfg["text"]["size"], cfg["text"]["font"],
                                os.path.join(TMP, f"{name}_mask.png"))
    bake_mat = build_bake_material(f"bake_{name}", cfg, mask)
    obj.data.materials.clear()
    obj.data.materials.append(bake_mat)

    albedo = bake_pass(obj, bake_mat, "DIFFUSE", size, "sRGB")
    rough = bake_pass(obj, bake_mat, "ROUGHNESS", size, "Non-Color")
    normal = bake_pass(obj, bake_mat, "NORMAL", size, "Non-Color")
    ao = bake_pass(obj, bake_mat, "AO", size, "Non-Color")
    orm = make_orm(ao, rough, size, f"nk_{name}_orm")

    paths = {k: os.path.join(TEX_DIR, f"{name}_{k}.jpg") for k in ("albedo", "normal", "orm")}
    save_jpeg(albedo, paths["albedo"])
    save_jpeg(normal, paths["normal"])
    save_jpeg(orm, paths["orm"])
    for im in (albedo, rough, normal, ao, orm):
        bpy.data.images.remove(im)
    if mask:
        bpy.data.images.remove(mask)
    bpy.data.materials.remove(bake_mat)
    return paths


# ----------------------------------------------------------------------------- финальный материал
def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def final_material(name, paths):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True  # замкнутые меши: без doubleSided в glTF
    nt = m.node_tree
    N, Lk = nt.nodes, nt.links
    N.clear()

    def image_node(path, colorspace):
        n = N.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path, check_existing=False)
        n.image.colorspace_settings.name = colorspace
        return n

    bsdf = N.new("ShaderNodeBsdfPrincipled")
    out = N.new("ShaderNodeOutputMaterial")
    Lk.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    Lk.new(image_node(paths["albedo"], "sRGB").outputs["Color"], bsdf.inputs["Base Color"])
    nmap = N.new("ShaderNodeNormalMap")
    Lk.new(image_node(paths["normal"], "Non-Color").outputs["Color"], nmap.inputs["Color"])
    Lk.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    sep = N.new("ShaderNodeSeparateColor")
    Lk.new(image_node(paths["orm"], "Non-Color").outputs["Color"], sep.inputs["Color"])
    Lk.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    Lk.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = N.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    Lk.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    return m


# ----------------------------------------------------------------------------- пресет и экспорт
def update_preset():
    """Текстуры в .glb — JPEG q85 (PNG слишком тяжёл для веба). Пишем и в репозиторий, и в конфиг Blender."""
    lines = [ln for ln in open(PRESET, encoding="utf-8").read().splitlines()
             if not ln.startswith(("op.export_image_format", "op.export_jpeg_quality"))]
    lines += ["op.export_image_format = 'JPEG'", "op.export_jpeg_quality = 85"]
    text = "\n".join(lines) + "\n"
    open(PRESET, "w", encoding="utf-8", newline="\n").write(text)
    user_dir = bpy.utils.user_resource("SCRIPTS", path="presets/operator/export_scene.gltf", create=True)
    open(os.path.join(user_dir, "night_keeper_glb.py"), "w", encoding="utf-8", newline="\n").write(text)
    settings = {}
    for ln in lines:
        mm = re.match(r"^op\.(\w+)\s*=\s*(.+)$", ln.strip())
        if mm:
            settings[mm.group(1)] = ast.literal_eval(mm.group(2))
    return settings


def main():
    os.makedirs(TMP, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=BASE_BLEND)
    bpy.context.preferences.filepaths.save_version = 0
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    bk = sc.render.bake
    bk.target, bk.use_selected_to_active, bk.use_clear = "IMAGE_TEXTURES", False, True
    bk.margin, bk.margin_type, bk.normal_space = 16, "EXTEND", "TANGENT"
    bk.use_pass_direct, bk.use_pass_indirect, bk.use_pass_color = False, False, True
    settings = update_preset()

    col = bpy.data.collections["Collection"]
    names = [n for n in PROPS if not ONLY or n in ONLY]
    objs = {}
    for n in names:
        objs[n] = geometry(n, col)
        unwrap(objs[n])
        log(n, "tris:", sum(len(p.vertices) - 2 for p in objs[n].data.polygons))

    for n in names:  # пропсы по одному в начале координат, остальные не участвуют в запекании
        for o in objs.values():
            o.hide_render = o.name != n
        paths = bake_prop(objs[n], PROPS[n])
        objs[n].data.materials.clear()
        objs[n].data.materials.append(final_material(f"mat_{n}", paths))
        log(n, "baked", {k: os.path.getsize(v) // 1024 for k, v in paths.items()}, "KB")
    for o in objs.values():
        o.hide_render = False

    vl = bpy.context.view_layer
    for n in names:
        bpy.ops.object.select_all(action="DESELECT")
        objs[n].select_set(True)
        vl.objects.active = objs[n]
        out = os.path.join(OUT_DIR, n + ".glb")
        bpy.ops.export_scene.gltf(filepath=out, use_selection=True, **settings)
        log(n, "exported", os.path.getsize(out) // 1024, "KB")

    for n in names:  # в сцене — ряд для просмотра
        objs[n].location = (PROPS[n]["x"], 0, 0)
    sc.render.engine = "BLENDER_EEVEE"
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=False, relative_remap=True)
    log("saved", OUT_BLEND)


main()
