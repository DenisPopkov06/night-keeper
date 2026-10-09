"""Ночное небо с луной: одна equirect-панорама 4096×2048 → public/textures/sky_night.jpg.

Синтез на numpy (Blender пишет JPEG): градиент неба с отсветом у горизонта, звёзды с цветом и «лучами» у ярких,
слабый Млечный путь, рваные облака (подсвечены луной с краёв), луна с кратерами и морями + ореол, дальние холмы,
зубчатая кромка леса и силуэт часовни. Ниже горизонта — цвет тумана игры (FOG_RGB), чтобы дальний край земли
растворялся в небе без шва.

Подключение в игре (одна строка у бэкенда, scene.background не затрагивается туманом):
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
Системы координат — как в three.js (y вверх). Луна стоит в направлении MOON_POS — это LIGHTING_CONFIG.moonPosition
из src/render/Lighting.ts, так что свет и диск на небе совпадают; сменили позицию луны — поменяйте здесь и перегенерируйте.

Туман игры, под который нарисован горизонт (LIGHTING_CONFIG): fogColor 0x1c2c4c, fogNear 5, fogFar 62.

Запуск:  blender --background --factory-startup --python assets_src/blender/sky_texture.py
"""
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import zone_textures as ZT  # noqa: E402  (pnoise, sstep)

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "public", "textures", "sky_night.jpg")
W, H = 4096, 2048                      # 0.088° на пиксель
MOON_POS = (15.0, 25.0, 10.0)          # = LIGHTING_CONFIG.moonPosition
MOON_R_DEG = 3.6                       # угловой радиус диска (стилизованно крупный: реальная луна ≈ 0.25°)
FOG_RGB = np.array([28, 44, 76], np.float32) / 255.0   # рекомендуемый LIGHTING_CONFIG.fogColor = 0x1c2c4c: дальний лес тает в дымке неба


def rgb(r, g, b):
    return np.array([r, g, b], np.float32) / 255.0


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


# ============================================================================ направления
def grid():
    lon = ((np.arange(W, dtype=np.float32) + 0.5) / W - 0.5) * 2 * np.pi
    el = ((1.0 - (np.arange(H, dtype=np.float32) + 0.5) / H) - 0.5) * np.pi
    cos_e = np.cos(el)[:, None]
    d = np.stack([cos_e * np.cos(lon)[None, :], np.sin(el)[:, None] * np.ones((1, W), np.float32),
                  cos_e * np.sin(lon)[None, :]], axis=-1)           # three.js: u = atan2(z, x), v = asin(y)
    return lon, el, d


# ============================================================================ луна
def moon_albedo(mw=1024, mh=512, seed=5):
    """Карта луны (equirect): кремовая поверхность, тёмные моря, ~260 кратеров с ободком. Значения — отображаемые sRGB."""
    rng = np.random.default_rng(seed)
    lon = ((np.arange(mw) + 0.5) / mw - 0.5) * 2 * np.pi
    lat = (0.5 - (np.arange(mh) + 0.5) / mh) * np.pi
    P = np.stack([np.cos(lat)[:, None] * np.cos(lon)[None, :], np.sin(lat)[:, None] * np.ones((1, mw)),
                  np.cos(lat)[:, None] * np.sin(lon)[None, :]], axis=-1)
    base = np.broadcast_to(np.array([0.93, 0.88, 0.76], np.float32), (mh, mw, 3)).copy()
    lum = 1.0 + 0.05 * ZT.pnoise(0, 1.6, (1, 1), seed, (mh, mw))[..., None]
    seas = ZT.sstep(0.35, 0.95, ZT.pnoise(0, 2.6, (1, 1), seed + 1, (mh, mw)))
    base = base * lum
    base = base * (1 - 0.34 * seas[..., None]) + np.array([0.50, 0.50, 0.50], np.float32) * (0.34 * seas[..., None]) * np.array([1.0, 0.98, 0.92], np.float32)
    h = np.zeros((mh, mw), np.float32)
    for _ in range(260):
        c = rng.normal(size=3)
        c /= np.linalg.norm(c)
        r = math.radians(0.8 + 12.0 * rng.random() ** 3)
        ang = np.arccos(np.clip(P @ c, -1, 1))
        near = ang < r * 1.6
        if not near.any():
            continue
        a = ang[near]
        h[near] += 0.14 * np.exp(-((a - r) / (0.16 * r)) ** 2) - 0.07 * (1 - ZT.sstep(0.55 * r, r, a)) * (a < r)
    return np.clip(base + h[..., None] * 0.9, 0, 1)


def sample_equirect(img, lon, lat):
    mh, mw = img.shape[:2]
    fx = (lon / (2 * np.pi) + 0.5) * mw - 0.5
    fy = (0.5 - lat / np.pi) * mh - 0.5
    x0, y0 = np.floor(fx).astype(int), np.clip(np.floor(fy).astype(int), 0, mh - 2)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
    x0 %= mw
    x1 = (x0 + 1) % mw
    return (img[y0, x0] * (1 - tx) + img[y0, x1] * tx) * (1 - ty) + (img[y0 + 1, x0] * (1 - tx) + img[y0 + 1, x1] * tx) * ty


# ============================================================================ сборка
def main():
    lon, el, d = grid()
    m = np.array(MOON_POS, np.float32)
    m /= np.linalg.norm(m)
    moon_lon, moon_el = math.atan2(m[2], m[0]), math.asin(m[1])
    cos_ang = np.clip(d @ m, -1, 1)
    ang = np.arccos(cos_ang)                                           # угол до центра луны
    e_deg = np.degrees(el)[:, None]                                    # (H,1)
    log = lambda s: print("NK sky:", s, flush=True)

    # --- небо: градиент от зенита к горизонту + светлая «подушка» над горизонтом у луны
    zen, hor = rgb(5, 8, 22), FOG_RGB
    t = np.clip(e_deg / 90.0, 0, 1) ** 0.45
    sky = (zen * t + hor * (1 - t))[:, None, :] * np.ones((1, W, 1), np.float32)       # (H,W,3)
    dl = wrap(lon - moon_lon)[None, :]
    glow = np.exp(-(dl / 0.9) ** 2) * np.exp(-np.clip(e_deg, 0, None) / 16.0)
    sky += glow[..., None] * rgb(34, 44, 70)
    log("gradient")

    # --- звёзды
    rng = np.random.default_rng(3)
    stars = np.zeros((H, W, 3), np.float32)
    n = 3200
    s_lon = rng.uniform(-np.pi, np.pi, n)
    s_el = np.arcsin(rng.uniform(np.sin(np.radians(-1.0)), 1.0, n))
    bright = 0.12 + 0.88 * rng.random(n) ** 5
    tint = rng.choice(3, n, p=[0.55, 0.30, 0.15])
    cols = np.where(tint[:, None] == 0, [0.82, 0.90, 1.0], np.where(tint[:, None] == 1, [1.0, 0.96, 0.86], [0.70, 0.80, 1.0]))
    px = (s_lon / (2 * np.pi) + 0.5) * W - 0.5
    py = (0.5 - s_el / np.pi) * H - 0.5
    sig_y = 0.55 + 0.55 * bright
    sig_x = np.minimum(sig_y / np.maximum(np.cos(s_el), 0.35), 2.6)
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    for oy in range(-3, 5):
        for ox in range(-3, 5):
            wgt = bright * np.exp(-((ix + ox - px) ** 2) / (2 * sig_x ** 2) - ((iy + oy - py) ** 2) / (2 * sig_y ** 2))
            yy, xx = np.clip(iy + oy, 0, H - 1), (ix + ox) % W
            for c in range(3):
                np.add.at(stars[..., c], (yy, xx), wgt * cols[:, c])
    for k in np.nonzero(bright > 0.82)[0]:                              # лучи у самых ярких
        y, x = iy[k], ix[k]
        for off in range(1, 9):
            f = bright[k] * 0.35 * math.exp(-off / 3.2)
            for yy, xx in ((y, (x + off) % W), (y, (x - off) % W), (min(max(y + off, 0), H - 1), x), (min(max(y - off, 0), H - 1), x)):
                stars[yy, xx] += f * cols[k].astype(np.float32)
    # Млечный путь: слабая полоса вдоль большого круга, с тёмными прожилками
    nmw = np.array([0.30, 0.42, -0.55], np.float32)
    nmw /= np.linalg.norm(nmw)
    band = np.exp(-((d @ nmw) / 0.11) ** 2)
    mw_n = ZT.pnoise(0, 2.4, (1.5, 1.0), 9, (H, W)).astype(np.float32)
    mw = band * np.clip(0.55 + 0.35 * mw_n, 0, 1) * (1 - 0.55 * ZT.sstep(0.9, 1.7, ZT.pnoise(0, 2.2, (1.5, 1.0), 10, (H, W)).astype(np.float32)))
    sky += mw[..., None] * rgb(60, 72, 110) * 0.55
    log("stars")

    # --- облака: вытянутые по горизонтали, ниже зенита; вокруг луны разрежены
    cn = ZT.pnoise(0, 2.7, (4.0, 1.0), 3, (H, W)).astype(np.float32)
    fine = ZT.pnoise(0, 2.0, (2.0, 1.0), 4, (H, W)).astype(np.float32)
    dens = ZT.sstep(0.35, 1.7, cn + 0.12 * fine)
    alt = ZT.sstep(1.5, 12.0, e_deg) * (1 - ZT.sstep(48.0, 78.0, e_deg))
    dens = dens * alt * (0.18 + 0.82 * ZT.sstep(math.radians(MOON_R_DEG * 2.4), math.radians(26), ang))
    lit = np.exp(-ang / math.radians(32)) * (1 - dens) ** 1.5
    cloud_rgb = rgb(13, 18, 32)[None, None, :] + lit[..., None] * (rgb(104, 122, 160) - rgb(13, 18, 32)) * 0.9
    sky = sky * (1 - dens[..., None] * 0.9) + cloud_rgb * dens[..., None] * 0.9
    stars *= (1 - np.clip(dens * 1.4, 0, 1))[..., None]
    stars *= ZT.sstep(0.0, 10.0, e_deg)[..., None]                       # у горизонта звёзды гаснут
    stars *= ZT.sstep(math.radians(MOON_R_DEG * 1.3), math.radians(12), ang)[..., None]   # и в ореоле луны
    sky += stars
    log("clouds")

    # --- ореол и диск луны
    halo = 0.30 / (1 + (ang / math.radians(MOON_R_DEG * 1.7)) ** 2) + 0.10 * np.exp(-ang / math.radians(22))
    sky += halo[..., None] * rgb(150, 175, 235) * (1 - 0.65 * dens[..., None])
    up = np.array([0, 1, 0], np.float32)
    e1 = np.cross(m, up)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(e1, m)
    mr = math.radians(MOON_R_DEG)
    ys, xs = np.nonzero(ang < mr * 1.15)
    dd = d[ys, xs]
    a, b = (dd @ e1) / math.sin(mr), (dd @ e2) / math.sin(mr)
    r2 = a * a + b * b
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    moon = sample_equirect(moon_albedo(), np.arctan2(a, np.maximum(z, 1e-3)), np.arcsin(np.clip(b, -1, 1)))
    shade = (0.62 + 0.46 * z ** 0.55)[:, None]
    moon = np.clip(moon * shade * 1.12, 0, 1)
    cover = ZT.sstep(1.0, 0.975, np.sqrt(r2))[:, None] * (1 - 0.55 * dens[ys, xs])[:, None]
    sky[ys, xs] = sky[ys, xs] * (1 - cover) + moon * cover
    log("moon")

    # --- земля, дальние холмы, кромка леса, часовня (всё — функции долготы, как силуэт)
    def noise1(seed, beta, n=W):
        r = np.random.default_rng(seed)
        spec = np.fft.rfft(r.standard_normal(n))
        f = np.maximum(np.fft.rfftfreq(n), 1.0 / n)
        out = np.fft.irfft(spec / f ** (beta / 2), n)
        return (out - out.mean()) / (out.std() + 1e-9)

    far_h = 2.4 + 2.0 * np.clip(noise1(21, 2.6) * 0.7 + 0.5, 0, 2.2)                  # градусы над горизонтом
    chapel = math.radians(70) + moon_lon
    cx = int(((wrap(chapel) / (2 * np.pi)) + 0.5) * W)
    cols_i = np.arange(W)
    dx_deg = np.degrees(wrap((cols_i - cx) * 2 * np.pi / W))
    far_h = far_h + 4.6 * (np.abs(dx_deg) < 0.55) + 2.4 * ((dx_deg > 0.55) & (dx_deg < 2.1)) \
        + np.clip(6.8 - 8.5 * np.abs(dx_deg), 0, None) * (np.abs(dx_deg) < 0.8)                # башня + неф + шпиль
    tree_h = 0.6 + 0.8 * np.clip(noise1(22, 2.0) * 0.5 + 0.5, 0, 1.6)
    trng = np.random.default_rng(23)
    for _ in range(1500):                                                              # зубцы деревьев
        tx, th, tw = trng.integers(0, W), trng.uniform(0.5, 2.1), trng.uniform(0.22, 0.60)
        idx = (np.arange(-int(tw / 0.088) - 1, int(tw / 0.088) + 2) + tx) % W
        off = (np.arange(-int(tw / 0.088) - 1, int(tw / 0.088) + 2)) * 0.088
        tree_h[idx] = np.maximum(tree_h[idx], th * np.clip(1 - np.abs(off) / tw, 0, 1) + 0.9)

    el_row = np.degrees(el)[:, None]
    far_mask = ZT.sstep(0.06, -0.06, el_row - far_h[None, :])           # 1 — под гребнем дальних холмов
    tree_mask = ZT.sstep(0.05, -0.05, el_row - tree_h[None, :])
    ground_mask = ZT.sstep(0.2, -0.2, el_row)
    far_col = rgb(18, 28, 50)                                              # дальние холмы чуть темнее дымки горизонта
    sky = sky * (1 - far_mask[..., None]) + (far_col + glow[..., None] * rgb(14, 18, 28)) * far_mask[..., None]
    tree_col = rgb(12, 18, 32)
    sky = sky * (1 - tree_mask[..., None]) + tree_col * tree_mask[..., None]
    # окошко часовни
    wy = int((0.5 - math.radians(2.7 + 3.0) / np.pi) * H)
    sky[wy - 1:wy + 1, cx - 1:cx + 1] = rgb(214, 140, 52)
    # ниже горизонта — цвет тумана: земля вдали сливается с небом
    below = ZT.sstep(0.0, -2.5, el_row)
    sky = sky * (1 - below[..., None]) + FOG_RGB * below[..., None]
    sky = np.where((el_row < -2.5)[..., None], FOG_RGB, sky)
    log("silhouettes")

    # --- 8 бит без полос: треугольный дизеринг ±1.5/255
    rnd = np.random.default_rng(1)
    sky = np.clip(sky + (rnd.random((H, W, 1), np.float32) + rnd.random((H, W, 1), np.float32) - 1.0) * (1.5 / 255.0), 0, 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img = bpy.data.images.new("nk_sky_night", W, H, alpha=False)
    img.colorspace_settings.name = "sRGB"
    data = np.ones((H, W, 4), np.float32)
    data[..., :3] = np.flipud(sky)
    img.pixels.foreach_set(data.ravel())
    img.filepath_raw = OUT
    img.file_format = "JPEG"
    img.save()
    log(f"saved {OUT} {os.path.getsize(OUT) // 1024} KB; moon at lon={math.degrees(moon_lon):.1f} el={math.degrees(moon_el):.1f}")


if __name__ == "__main__":
    main()
