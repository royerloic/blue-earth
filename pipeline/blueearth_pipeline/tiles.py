"""Close-zoom imagery: Blue Marble 500 m (July) → EAC quadtree tiles for levels 4–5.

Tile (level L, face f, row j, col i) covers EAC s ∈ [i, i+1]/2^L, t ∈ [j, j+1]/2^L of face f,
TILE² pixels; level 5 ≈ 0.6 km/px. Deep-ocean tiles (no land, nothing shallower than
KEEP_DEPTH) are skipped; the app falls back to the global textures there. Tiles are WebP with
alpha = present-day land mask (Natural Earth land minus lakes) encoded as 200…255, for sharp
coastlines.

    uv run python -m blueearth_pipeline.tiles
"""

from __future__ import annotations

import base64
import json
import multiprocessing as mp
import sys
import time
from pathlib import Path

import numpy as np
import rasterio.transform
from PIL import Image
from scipy.ndimage import map_coordinates

from . import dem
from .cube import FACE_BASIS
from .download import fetch

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parents[2] / "public" / "data" / "tiles" / "07"
TILE = 512
LEVELS = (4, 5)
MAX = max(LEVELS)
MASK_ALPHA_MIN = 200
KEEP_DEPTH = -60.0  # keep tiles with any cell shallower than this (land, shelves, lagoons)
PX_PER_DEG = 240  # 500 m source: 21600 px per 90°
W, H = 360 * PX_PER_DEG, 180 * PX_PER_DEG

# Shared (fork) globals.
IMG: np.ndarray
LAND: np.ndarray
ETOPO: np.ndarray


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def load_sources() -> None:
    global IMG, LAND, ETOPO
    IMG = np.empty((H, W, 3), np.uint8)
    for c, col in enumerate("ABCD"):
        for r in (1, 2):
            key = f"bmng500_07_{col}{r}"
            log(f"loading {key}")
            a = np.asarray(Image.open(fetch(key)).convert("RGB"))
            IMG[(r - 1) * H // 2 : r * H // 2, c * W // 4 : (c + 1) * W // 4] = a
    log("rasterising land mask at 500 m")
    import io
    import zipfile

    import rasterio.features
    import shapefile

    def shapes(key):
        with zipfile.ZipFile(fetch(key)) as z:
            n = z.namelist()
            get = lambda ext: io.BytesIO(z.read(next(x for x in n if x.endswith(ext))))  # noqa: E731
            return [s.__geo_interface__ for s in shapefile.Reader(shp=get(".shp"), shx=get(".shx"), dbf=get(".dbf")).shapes()]

    tr = rasterio.transform.from_bounds(-180, -90, 180, 90, W, H)
    LAND = rasterio.features.rasterize(((g, 1) for g in shapes("ne_land")), out_shape=(H, W), transform=tr, dtype=np.uint8)
    lakes = rasterio.features.rasterize(((g, 1) for g in shapes("ne_lakes")), out_shape=(H, W), transform=tr, dtype=np.uint8)
    LAND &= 1 - lakes
    del lakes
    ETOPO = dem.load_etopo("etopo_surface")


def tile_dirs(face: int, level: int, i: int, j: int, n: int) -> np.ndarray:
    """Directions of an n×n grid of sample centres covering the tile."""
    span = 1.0 / 2**level
    c = (np.arange(n) + 0.5) / n
    s = (i + c) * span
    t = (j + c) * span
    a = np.tan((2 * s - 1) * np.pi / 4)
    b = np.tan((2 * t - 1) * np.pi / 4)
    A, Bm = np.meshgrid(a, b)
    major, sa, ta = FACE_BASIS[face]
    d = major + A[..., None] * sa + Bm[..., None] * ta
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def sample(src: np.ndarray, d: np.ndarray, px_per_deg: float, order: int) -> np.ndarray:
    """Samples an equirect array (H, W[, C]) at directions d, cropping (with lon wrap) first."""
    h, w = src.shape[:2]
    lon = np.degrees(np.arctan2(d[..., 1], d[..., 0]))
    lat = np.degrees(np.arcsin(np.clip(d[..., 2], -1, 1)))
    x = (lon + 180) * px_per_deg - 0.5
    y = np.clip((90 - lat) * px_per_deg - 0.5, 0, h - 1)
    if x.max() - x.min() > w / 2:  # crosses the dateline (or a pole)
        x = np.where(x < w / 2, x + w, x)
    x0, x1 = int(np.floor(x.min())) - 1, int(np.ceil(x.max())) + 2
    y0, y1 = int(np.floor(y.min())), int(np.ceil(y.max())) + 2
    cols = np.arange(x0, x1) % w
    crop = src[y0 : min(y1, h)][:, cols]
    xs, ys = x - x0, y - y0
    if crop.ndim == 2:
        return map_coordinates(crop.astype(np.float32), [ys, xs], order=order, mode="nearest")
    return np.stack([map_coordinates(crop[..., k].astype(np.float32), [ys, xs], order=order, mode="nearest") for k in range(crop.shape[2])], -1)


def build_l5(job: tuple[int, int, int]):
    """One level-5 tile → (rgba uint8 or None if skipped, keep flag)."""
    face, j, i = job
    # Keep test on a coarse grid of ETOPO (1.85 km) + the land mask.
    dc = tile_dirs(face, MAX, i, j, 48)
    keep = sample(ETOPO, dc, 60, 0).max() > KEEP_DEPTH
    d = tile_dirs(face, MAX, i, j, TILE * 2)
    rgb = sample(IMG, d, PX_PER_DEG, 1).reshape(TILE, 2, TILE, 2, 3).mean(axis=(1, 3))
    land = sample(LAND, d, PX_PER_DEG, 0).reshape(TILE, 2, TILE, 2).mean(axis=(1, 3))
    # Alpha = 200 (water) … 255 (land): browsers premultiply canvas pixels, so alpha 0 would
    # destroy the ocean colours; ≥ 200 keeps RGB within ~1 level (see src/render/globe/tileCache.ts).
    alpha = MASK_ALPHA_MIN + (255 - MASK_ALPHA_MIN) * land
    rgba = np.concatenate([np.clip(rgb + 0.5, 0, 255), alpha[..., None]], -1).astype(np.uint8)
    return face, j, i, rgba, keep


def save(rgba: np.ndarray, level: int, face: int, j: int, i: int) -> int:
    p = OUT / str(level) / str(face) / f"{j}_{i}.webp"
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(p, "WEBP", quality=80, alpha_quality=100, method=4)
    return p.stat().st_size


def main() -> None:
    load_sources()
    n5 = 2**MAX
    keep = {lv: np.zeros(6 * 4**lv, bool) for lv in LEVELS}
    total = 0
    ctx = mp.get_context("fork")
    for face in range(6):
        log(f"face {face}: {n5 * n5} level-{MAX} tiles")
        tiles = np.zeros((n5, n5, TILE, TILE, 4), np.uint8)
        k5 = np.zeros((n5, n5), bool)
        with ctx.Pool(max(1, mp.cpu_count() - 2)) as pool:
            for f, j, i, rgba, kp in pool.imap_unordered(build_l5, [(face, j, i) for j in range(n5) for i in range(n5)], chunksize=4):
                tiles[j, i] = rgba
                k5[j, i] = kp
        for j in range(n5):
            for i in range(n5):
                if k5[j, i]:
                    total += save(tiles[j, i], MAX, face, j, i)
                    keep[MAX][face * n5 * n5 + j * n5 + i] = True
        # Level 4 from 2×2 children (kept if any child is).
        n4 = n5 // 2
        for j in range(n4):
            for i in range(n4):
                if not k5[2 * j : 2 * j + 2, 2 * i : 2 * i + 2].any():
                    continue
                q = tiles[2 * j : 2 * j + 2, 2 * i : 2 * i + 2].astype(np.float32)
                mosaic = np.concatenate([np.concatenate([q[0, 0], q[0, 1]], 1), np.concatenate([q[1, 0], q[1, 1]], 1)], 0)
                small = mosaic.reshape(TILE, 2, TILE, 2, 4).mean(axis=(1, 3))
                total += save(np.clip(small + 0.5, 0, 255).astype(np.uint8), 4, face, j, i)
                keep[4][face * n4 * n4 + j * n4 + i] = True
        log(f"face {face}: kept {k5.sum()} L{MAX} tiles, total {total / 1e6:.0f} MB so far")
    index = {
        "month": "07",
        "tile": TILE,
        "levels": list(LEVELS),
        "format": "webp",
        "credit": "NASA Earth Observatory, Blue Marble Next Generation 500 m (July 2004); land mask: Natural Earth",
        # Bitsets over tile ids (face·4^L + j·2^L + i), LSB first, base64.
        "tiles": {str(lv): base64.b64encode(np.packbits(keep[lv], bitorder="little").tobytes()).decode() for lv in LEVELS},
        "count": {str(lv): int(keep[lv].sum()) for lv in LEVELS},
        "bytes": total,
    }
    (OUT.parent / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    log(f"done: {sum(index['count'].values())} tiles, {total / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
