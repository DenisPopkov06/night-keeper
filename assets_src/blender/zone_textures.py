"""Текстуры зоны «Старое кладбище» (синтез на numpy): уникальная земля, тайлы, табличка ворот.

Земля — ОДНА уникальная карта 2048² на всю зону (ground_old_cemetery_*, ≈2 см/пиксель, без повторов):
трава, проплешины, подстилка, холмики у надгробий (по layout.json), тропы. Тайлы дерево/кора/камень —
albedo / normal / ORM (JPEG) в assets_src/textures_src/ с префиксом tile_. Шум периодический (FFT), поэтому швов при повторе нет. Табличка ворот —
отдельная текстура 1024x256 с надписью (шрифт Times New Roman Bold, кириллица).

Запуск:  blender --background --factory-startup --python assets_src/blender/zone_textures.py
Цвета заданы как отображаемые sRGB (то, что видно на картинке).
"""
import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake_props  # noqa: E402  (render_text_mask, TMP, FONT_BOLD)

TEX_DIR = bake_props.TEX_DIR
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(bake_props.TMP, exist_ok=True)

SIGN_LINES = ["СТАРОЕ КЛАДБИЩЕ"]
SIGN_SIZE_M = (1.7, 0.425)  # лицевая сторона таблички; 4:1 -> 1024x256


# ----------------------------------------------------------------------------- шум
def pnoise(n, beta=2.0, aniso=(1.0, 1.0), seed=0, shape=None):
    """Периодический шум 1/f^beta, нулевое среднее, единичная дисперсия. aniso>1 сглаживает по оси сильнее."""
    h, w = shape or (n, n)
    r = np.random.default_rng(seed)
    spec = np.fft.fft2(r.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * aniso[1]
    fx = np.fft.fftfreq(w)[None, :] * aniso[0]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    spec = spec / f ** (beta / 2.0)
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    return (out - out.mean()) / (out.std() + 1e-9)


def voronoi(n, count, seed=0):
    """Периодический вороной: расстояния до ближайшей (d1) и второй (d2) точки, индекс ближайшей."""
    r = np.random.default_rng(seed)
    pts = r.random((count, 2)) * n
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    d1 = np.full((n, n), 1e9, np.float32)
    d2 = d1.copy()
    idx = np.zeros((n, n), np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xs - px)
        dx = np.minimum(dx, n - dx)
        dy = np.abs(ys - py)
        dy = np.minimum(dy, n - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, i, idx)
        d1 = np.minimum(d1, d)
    return d1, d2, idx


def lerp(c0, c1, t):
    return np.array(c0)[None, None, :] * (1 - t[..., None]) + np.array(c1)[None, None, :] * t[..., None]


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def n01(x, k=0.22):
    return np.clip(0.5 + k * x, 0, 1)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5  # ось 0 = V (вверх)
    nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5


# ----------------------------------------------------------------------------- запись
def down(a, k):
    """Уменьшение в k раз усреднением блоков."""
    if k == 1:
        return a
    h, w = a.shape[:2]
    return a.reshape(h // k, k, w // k, k, *a.shape[2:]).mean(axis=(1, 3))


def save_set(name, albedo, height, rough, ao, normal_strength, orm_stride=1, normal_stride=1):
    h, w = height.shape
    k = orm_stride
    maps = {
        "albedo": np.clip(albedo, 0, 1),
        "normal": down(normal_from_height(height, normal_strength), normal_stride),
        "orm": down(np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1), np.zeros_like(height)], axis=-1), k),
    }
    for kind, rgb in maps.items():
        hh, ww = rgb.shape[:2]
        img = bpy.data.images.new(f"nk_{name}_{kind}", ww, hh, alpha=False)
        img.colorspace_settings.name = "sRGB" if kind == "albedo" else "Non-Color"
        data = np.ones((hh, ww, 4), np.float32)
        data[..., :3] = rgb
        img.pixels.foreach_set(data.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, f"{name}_{kind}.jpg")
        img.file_format = "JPEG"
        img.save()
        bpy.data.images.remove(img)
    print("NK: tex", name, f"{w}x{h}", flush=True)
    return maps["albedo"]


# ----------------------------------------------------------------------------- тайлы
# ----------------------------------------------------------------------------- земля зоны (уникальная)
GN = 2048   # сторона карты земли, пикселей
GM = 40.0   # сторона зоны, м  → ≈2 см на пиксель
LAYOUT = os.path.join(bake_props.REPO, "src", "levels", "zone_old_cemetery", "layout.json")
TREES = [(-11.0, 8.0, 6.0), (12.0, -7.0, 5.0), (13.0, 13.0, 3.4)]  # Blender x, y, радиус подстилки, м


def fft_up(a, n_out):
    """Идеальное (по спектру) увеличение периодического поля без блочности."""
    n = a.shape[0]
    if n >= n_out:
        return a
    spec = np.fft.fftshift(np.fft.fft2(a))
    pad = np.zeros((n_out, n_out), complex)
    s0 = (n_out - n) // 2
    pad[s0:s0 + n, s0:s0 + n] = spec
    return np.real(np.fft.ifft2(np.fft.ifftshift(pad))) * (n_out / n) ** 2


def field(feature_m, seed, beta=2.4):
    """Гладкое поле с характерным размером ~feature_m метров на всю карту земли (нулевое среднее, σ=1)."""
    n = int(np.clip(GM / feature_m * 5, 16, GN))
    n -= n % 2
    a = fft_up(pnoise(n, beta, seed=seed), GN)
    return (a - a.mean()) / (a.std() + 1e-9)


def window(cx, cy, r):
    """Срез карты вокруг точки (метры): (срез по строкам, срез по столбцам, X, Y в метрах)."""
    px = GM / GN
    x0, x1 = int(max(0, (cx - r + GM / 2) / px)), int(min(GN, (cx + r + GM / 2) / px + 1))
    y0, y1 = int(max(0, (cy - r + GM / 2) / px)), int(min(GN, (cy + r + GM / 2) / px + 1))
    xs = (np.arange(x0, x1) + 0.5) * px - GM / 2
    ys = (np.arange(y0, y1) + 0.5) * px - GM / 2
    wx, wy = np.meshgrid(xs, ys)
    return slice(y0, y1), slice(x0, x1), wx, wy


def ground_unique():
    px = GM / GN
    c = (np.arange(GN) + 0.5) * px - GM / 2
    X, Y = np.meshgrid(c, c)  # строка 0 = y -20 (V=0), столбец 0 = x -20 (U=0)

    big, mid, small = field(9.0, 101), field(3.2, 102), field(0.9, 103)
    fine = pnoise(GN, 1.15, seed=104)
    streak_v = pnoise(GN, 1.5, aniso=(1, 6), seed=105)
    streak_h = pnoise(GN, 1.5, aniso=(6, 1), seed=106)
    pick = n01(field(1.5, 107), 0.35)
    streak = streak_v * pick + streak_h * (1 - pick)  # травинки лежат в разные стороны

    # --- трава: от густой тёмной до жухлой, крупными пятнами
    t = n01(0.65 * mid + 0.35 * big + 0.15 * small, 0.30)
    col = lerp((0.075, 0.130, 0.055), (0.165, 0.250, 0.085), t)
    dry = sstep(0.55, 0.80, n01(field(7.0, 108), 0.3))[..., None] * 0.55
    col = col * (1 - dry) + np.array((0.235, 0.220, 0.105)) * dry
    damp = sstep(0.60, 0.85, n01(field(4.5, 109), 0.3))
    col = col * (1 - 0.18 * damp[..., None])
    col = col * (1 + 0.09 * fine[..., None] + 0.08 * streak[..., None])
    height = 0.5 + 0.075 * fine + 0.09 * streak + 0.06 * field(0.3, 113)

    # --- проплешины голой земли
    soil_m = sstep(0.74, 0.84, n01(0.8 * field(2.4, 110) + 0.55 * field(0.55, 111), 0.25)) * (0.55 + 0.45 * n01(field(5.0, 115), 0.3))
    soil = lerp((0.19, 0.135, 0.085), (0.30, 0.215, 0.135), n01(field(0.9, 112), 0.3)) * (1 + 0.10 * fine[..., None])
    col = col * (1 - 0.92 * soil_m[..., None]) + soil * 0.92 * soil_m[..., None]
    height -= 0.06 * soil_m

    # --- подстилка из листьев под деревьями + голая земля у корней
    lit_speck, lit_tone = field(0.16, 120, 1.8), field(0.35, 125)
    for tx, ty, tr in TREES:
        sy, sx, wx, wy = window(tx, ty, tr * 1.6)
        r = np.hypot(wx - tx, wy - ty)
        fall = np.exp(-(r / (tr * 0.75)) ** 2)
        speck = sstep(0.54, 0.68, n01(lit_speck[sy, sx], 0.3))
        m = np.clip(fall * (0.45 + 1.1 * speck), 0, 1)[..., None]
        leaf = lerp((0.21, 0.125, 0.05), (0.38, 0.25, 0.09), n01(lit_tone[sy, sx], 0.3))
        col[sy, sx] = col[sy, sx] * (1 - 0.8 * m) + leaf * 0.8 * m
        bare = (np.exp(-(r / 0.95) ** 2) * 0.9)[..., None]
        col[sy, sx] = col[sy, sx] * (1 - bare) + np.array((0.15, 0.105, 0.07)) * bare
        height[sy, sx] -= 0.03 * fall

    # --- у ограды: сорняк погуще и темнее
    inside = GM / 2 - 0.5 - np.maximum(np.abs(X), np.abs(Y))
    weeds = sstep(1.1, 0.0, inside) * (0.55 + 0.45 * n01(field(0.45, 114), 0.3))
    col = col * (1 - 0.45 * weeds[..., None]) + np.array((0.055, 0.105, 0.04)) * 0.45 * weeds[..., None]

    # --- холмики перед надгробиями (по layout.json): земля, редкие всходы
    graves = [o for o in json.load(open(LAYOUT, encoding="utf-8"))["objects"] if o["objectId"].startswith("gravestone")]
    mound_m = np.zeros((GN, GN), np.float32)
    edge_n, mound_tone, sprout = field(0.35, 130), field(0.12, 131, 1.6), field(0.1, 132, 1.6)
    for o in graves:
        gx, gy = o["position"]["x"], -o["position"]["z"]
        a = math.radians(o["rotationY"])
        fx, fy = math.sin(a), -math.cos(a)           # куда «смотрит» надгробие (Blender: y = -z)
        cx, cy = gx + fx * 1.05, gy + fy * 1.05
        sy, sx, wx, wy = window(cx, cy, 1.6)
        u = (wx - cx) * fx + (wy - cy) * fy
        v = -(wx - cx) * fy + (wy - cy) * fx
        d = (np.abs(u) / 0.98) ** 2.6 + (np.abs(v) / 0.44) ** 2.6 - 1 + 0.30 * edge_n[sy, sx]
        mound_m[sy, sx] = np.maximum(mound_m[sy, sx], 1 - sstep(-0.25, 0.20, d))
    mcol = lerp((0.20, 0.15, 0.095), (0.30, 0.225, 0.14), n01(mound_tone, 0.3))
    spr = sstep(0.62, 0.74, n01(sprout, 0.3))[..., None]
    mcol = mcol * (1 - 0.7 * spr) + np.array((0.12, 0.19, 0.07)) * 0.7 * spr
    col = col * (1 - 0.88 * mound_m[..., None]) + mcol * 0.88 * mound_m[..., None]
    height += 0.05 * mound_m

    # --- тропы (та же геометрия, что в zone_lib: главная от ворот на север и поперечная)
    i = (Y + 19.6) / 0.6
    xc = 0.4 * np.sin(i * 0.35)
    w = (2.5 + 0.25 * np.sin(i * 0.5)) * (1 - 0.9 * sstep(46, 60, i))
    sd_main = np.where((i < -1) | (i > 61), 9.0, np.abs(X - xc) - w / 2)
    j = (X + 12) / 0.6
    yc = 4 + 0.3 * np.sin(j * 0.4)
    wc = np.maximum(2.0 * np.minimum(np.minimum(j / 4, (40 - j) / 4 + 0.15), 1.0) + 0.25, 0)
    sd_cross = np.where((j < -1) | (j > 41), 9.0, np.abs(Y - yc) - wc / 2)
    sd = np.minimum(sd_main, sd_cross) + 0.20 * field(0.9, 140) + 0.06 * field(0.25, 141)
    pm = 1 - sstep(-0.10, 0.14, sd)                  # маска тропы с неровным краем
    fringe = sstep(0.0, 0.5, sd) * (1 - sstep(0.5, 0.9, sd))
    core = np.clip(-sd, 0, 1)
    pc = lerp((0.30, 0.225, 0.15), (0.40, 0.30, 0.20), n01(field(0.7, 142), 0.3))
    pc = pc * (1 - 0.10 * core[..., None] + 0.06 * (1 - core[..., None])) * (1 + 0.10 * field(1.6, 147)[..., None])
    peb = sstep(0.64, 0.70, n01(0.9 * field(0.16, 143) + 0.25 * pnoise(GN, 0.9, seed=144), 0.26))
    pebcol = lerp((0.36, 0.33, 0.29), (0.57, 0.54, 0.49), n01(field(0.4, 145), 0.3))
    gap = sstep(0.45, 0.60, n01(field(0.12, 146), 0.3))
    col = col * (1 - 0.25 * fringe[..., None])
    col = col * (1 - pm[..., None]) + pc * (1 - 0.18 * gap[..., None]) * pm[..., None]
    pp = (peb * pm * 0.9)[..., None]
    col = col * (1 - pp) + pebcol * pp
    height = height * (1 - 0.6 * pm) + 0.30 * pm + 0.35 * peb * pm

    # --- редкие полевые цветы (мелкие крапинки на траве)
    fl = sstep(2.55, 2.95, field(0.07, 150, 1.0)) * (1 - pm) * (1 - soil_m) * (1 - mound_m)
    ftone = n01(field(2.0, 151), 0.5)
    fcol = lerp((0.62, 0.60, 0.45), (0.55, 0.45, 0.62), ftone)
    col = col * (1 - 0.9 * fl[..., None]) + fcol * 0.9 * fl[..., None]

    # --- виньетка к краям, чтобы зона «тонула» в темноте
    edge2 = np.clip((GM / 2 - np.maximum(np.abs(X), np.abs(Y))) / 7, 0, 1)
    col = col * (0.62 + 0.38 * edge2)[..., None]

    rough = 0.94 - 0.05 * pm - 0.04 * soil_m
    ao = 0.90 - 0.10 * soil_m - 0.08 * damp - 0.12 * weeds - 0.08 * pm * gap
    save_set("ground_old_cemetery", col, height, rough, ao, 5.5, orm_stride=4, normal_stride=2)
    return np.clip(col, 0, 1)


def tile_wood(n=512):
    g = pnoise(n, 2.0, aniso=(1, 9), seed=21)             # волокна вдоль V
    fine = pnoise(n, 1.4, aniso=(1.5, 5), seed=22)
    rings = 0.5 + 0.5 * np.sin((np.arange(n)[None, :] / n * 9 + 0.9 * g) * 2 * np.pi)
    t = n01(0.7 * g + 0.5 * fine, 0.3) * 0.7 + rings * 0.3
    col = lerp((0.19, 0.12, 0.075), (0.33, 0.215, 0.13), t)
    col = col * (1 + 0.10 * fine[..., None])
    h = 0.5 + 0.2 * g + 0.15 * rings
    return save_set("tile_wood", col, h, np.full((n, n), 0.82), 0.85 + 0.3 * (h - 0.5), 4.0), col


def tile_bark(n=512):
    g = pnoise(n, 2.0, aniso=(1.3, 6), seed=31)
    ridge = 1 - np.abs(n01(g, 0.3) * 2 - 1)                # борозды
    fine = pnoise(n, 1.3, seed=32)
    col = lerp((0.14, 0.10, 0.08), (0.34, 0.27, 0.20), np.clip(ridge ** 1.3 + 0.1 * fine, 0, 1))
    h = ridge + 0.1 * fine
    return save_set("tile_bark", col, h, np.full((n, n), 0.92), 0.55 + 0.5 * ridge, 9.0)


def tile_stone(n=512):
    d1, d2, _ = voronoi(n, 40, seed=41)
    base = n01(pnoise(n, 2.4, seed=42), 0.3)
    col = lerp((0.38, 0.38, 0.39), (0.58, 0.57, 0.54), base)
    crack = 1 - sstep(0.0, 4.0, d2 - d1)
    region = sstep(0.45, 0.60, n01(pnoise(n, 3.0, seed=43), 0.3))
    col = col * (1 - 0.7 * (crack * region)[..., None])
    moss = sstep(0.62, 0.78, n01(pnoise(n, 2.6, seed=44), 0.3))[..., None] * 0.7
    col = col * (1 - moss) + np.array((0.18, 0.29, 0.11)) * moss
    fine = pnoise(n, 1.2, seed=45)
    col = col * (1 + 0.08 * fine[..., None])
    h = 0.55 + 0.1 * base + 0.06 * fine - 0.45 * crack * region
    return save_set("tile_stone", col, h, np.full((n, n), 0.9), 0.8 + 0.3 * (h - 0.5), 6.0)


# ----------------------------------------------------------------------------- табличка
def sign_texture(wood_col):
    w, h = 1024, 256
    mask_img = bake_props.render_text_mask(SIGN_LINES, SIGN_SIZE_M, bake_props.FONT_BOLD,
                                           os.path.join(bake_props.TMP, "sign_mask.png"), px=w)
    m = np.empty(mask_img.size[0] * mask_img.size[1] * 4, np.float32)
    mask_img.pixels.foreach_get(m)
    mask = m.reshape(mask_img.size[1], mask_img.size[0], 4)[..., 0]
    bpy.data.images.remove(mask_img)
    base = np.concatenate([wood_col[:h], wood_col[:h]], axis=1)       # 512x2 -> 1024 по ширине
    base = base * 0.85
    chip = sstep(0.30, 0.60, n01(pnoise(None, 1.6, seed=51, shape=(h, w)), 0.35))
    paint = (mask * chip)[..., None]
    col = base * (1 - paint) + np.array((0.78, 0.74, 0.62)) * paint   # выцветшая белая краска
    grain = pnoise(None, 2.0, aniso=(1, 6), seed=52, shape=(h, w))
    height = 0.5 + 0.12 * grain + 0.35 * paint[..., 0]
    save_set("sign_gate_a", col, height, np.full((h, w), 0.85), 0.85 + 0.2 * (height - 0.5), 5.0)


def contact_sheet(parts):
    cells = [p[::4, ::4] for p in parts]
    hmax = max(c.shape[0] for c in cells)
    row = np.concatenate([np.pad(c, ((0, hmax - c.shape[0]), (0, 4), (0, 0))) for c in cells], axis=1)
    img = bpy.data.images.new("nk_sheet", row.shape[1], row.shape[0], alpha=False)
    data = np.ones((*row.shape[:2], 4), np.float32)
    data[..., :3] = row
    img.pixels.foreach_set(data.ravel())
    img.filepath_raw = os.path.join(bake_props.TMP, "tiles_sheet.png")
    img.file_format = "PNG"
    img.save()


if __name__ == "__main__":
    ground = ground_unique()
    wood_alb, wood_col = tile_wood()
    bark = tile_bark()
    stone = tile_stone()
    sign_texture(wood_col)
    contact_sheet([ground, wood_alb, bark, stone])
    print("NK: done", flush=True)
