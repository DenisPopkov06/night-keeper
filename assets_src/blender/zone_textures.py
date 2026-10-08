"""Бесшовные текстуры зоны «Старое кладбище» (синтез на numpy) + табличка ворот.

Тайлы: трава, тропа, дерево, кора, камень — albedo / normal / ORM (JPEG) в assets_src/textures_src/
с префиксом tile_. Шум периодический (FFT), поэтому швов при повторе нет. Табличка ворот —
отдельная текстура 1024x256 с надписью (шрифт Times New Roman Bold, кириллица).

Запуск:  blender --background --factory-startup --python assets_src/blender/zone_textures.py
Цвета заданы как отображаемые sRGB (то, что видно на картинке).
"""
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
def save_set(name, albedo, height, rough, ao, normal_strength):
    h, w = height.shape
    maps = {
        "albedo": np.clip(albedo, 0, 1),
        "normal": normal_from_height(height, normal_strength),
        "orm": np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1), np.zeros_like(height)], axis=-1),
    }
    for kind, rgb in maps.items():
        img = bpy.data.images.new(f"nk_{name}_{kind}", w, h, alpha=False)
        img.colorspace_settings.name = "sRGB" if kind == "albedo" else "Non-Color"
        data = np.ones((h, w, 4), np.float32)
        data[..., :3] = rgb
        img.pixels.foreach_set(data.ravel())
        img.filepath_raw = os.path.join(TEX_DIR, f"{name}_{kind}.jpg")
        img.file_format = "JPEG"
        img.save()
        bpy.data.images.remove(img)
    print("NK: tex", name, f"{w}x{h}", flush=True)
    return maps["albedo"]


# ----------------------------------------------------------------------------- тайлы
def tile_grass(n=1024):
    low, mid, fine = pnoise(n, 3.0, seed=1), pnoise(n, 2.0, seed=2), pnoise(n, 1.2, seed=3)
    streak = pnoise(n, 1.6, aniso=(1, 7), seed=4)
    col = lerp((0.10, 0.17, 0.075), (0.19, 0.29, 0.10), n01(0.8 * low + 0.5 * mid, 0.30))
    col = col * (1 + 0.14 * streak[..., None] + 0.07 * fine[..., None])
    dirt = sstep(0.68, 0.82, n01(pnoise(n, 3.0, seed=5), 0.3))[..., None] * 0.45
    col = col * (1 - dirt) + np.array((0.25, 0.18, 0.10)) * dirt
    h = 0.5 + 0.20 * streak + 0.12 * fine
    return save_set("tile_grass", col, h, np.full((n, n), 0.95), 0.82 + 0.4 * (h - 0.5), 5.0)


def tile_path(n=1024):
    d1, d2, idx = voronoi(n, 150, seed=11)
    rr = np.random.default_rng(12)
    r0 = 0.5 * n / np.sqrt(150)
    size = rr.uniform(0.40, 0.78, 150) * r0
    tone = rr.uniform(0.0, 1.0, 150)
    peb = d1 < size[idx]
    dome = np.clip(1 - d1 / size[idx], 0, 1) ** 0.6
    soil_t = n01(pnoise(n, 2.2, seed=13), 0.3)
    soil = lerp((0.24, 0.17, 0.11), (0.33, 0.24, 0.16), soil_t)
    stone = lerp((0.36, 0.33, 0.30), (0.52, 0.49, 0.45), tone[idx])
    col = np.where(peb[..., None], stone * (0.8 + 0.3 * dome[..., None]), soil)
    fine = pnoise(n, 1.2, seed=14)
    col = col * (1 + 0.10 * fine[..., None])
    h = np.where(peb, 0.45 + 0.55 * dome, 0.30 + 0.05 * fine)
    ao = np.where(peb, 0.95, 0.65)
    return save_set("tile_path", col, h, np.where(peb, 0.8, 0.95), ao, 7.0)


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
    grass = tile_grass()
    path = tile_path()
    wood_alb, wood_col = tile_wood()
    bark = tile_bark()
    stone = tile_stone()
    sign_texture(wood_col)
    contact_sheet([grass, path, wood_alb, bark, stone])
    print("NK: done", flush=True)
