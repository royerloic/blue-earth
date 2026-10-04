"""Builds the per-tier globe data into public/data/<tier>/ plus public/data/manifest.json.

    uv run python -m blueearth_pipeline.build [low medium]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from . import dem
from .download import fetch
from .encode import encode_color, encode_half
from .resample import add_gutter, to_faces
from .sources import MONTHS, SOURCES

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parents[2] / "public" / "data"
GUTTER = 4
TIERS = {
    "low": {"display": 512, "sim": 256},
    "medium": {"display": 1024, "sim": 512},
}
DATA_VERSION = 1


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def image(key: str, mode: str) -> np.ndarray:
    return np.asarray(Image.open(fetch(key)).convert(mode))


def to_u8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(x), 0, 255).astype(np.uint8)


def terrain_layers(layers: dict[str, np.ndarray], gutter: int) -> np.ndarray:
    """(6, m, m, 4): B, E (= F − B), L (lake level or NO_LAKE), I (ice thickness)."""
    stacked = np.stack([layers[k] for k in "BELI"], -1)
    return add_gutter(stacked, gutter) if gutter else stacked


def main(tiers: list[str]) -> None:
    log("loading sources")
    surface = dem.load_etopo("etopo_surface")
    bed = dem.load_etopo("etopo_bed")
    land_eq = dem.ne_raster("ne_land")
    water_eq = dem.inland_water_mask(dem.ne_raster("ne_lakes"), land_eq)
    albedo_src = {m: image(f"bmng_{m:02d}", "RGB") for m in MONTHS}
    night_src = image("black_marble", "RGB")
    clouds_src = image("clouds", "L")

    manifest = {"version": DATA_VERSION, "gutter": GUTTER, "tiers": {}, "credits": sorted({s["credit"] for s in SOURCES.values()})}
    for tier in tiers:
        cfg = TIERS[tier]
        n, ns = cfg["display"], cfg["sim"]
        out = OUT / tier
        out.mkdir(parents=True, exist_ok=True)
        files: dict[str, object] = {}

        log(f"{tier}: terrain {n}, sim {ns}")
        disp = dem.build(n, surface, bed, water_eq, land_eq)
        # B is resampled with a real gutter; derived fields get nearest-neighbour gutters.
        terr = terrain_layers(disp, GUTTER)
        terr[..., 0] = to_faces(surface, n, GUTTER)
        encode_half(terr, out / "terrain.ktx2")
        files["terrain"] = "terrain.ktx2"
        encode_half(terrain_layers(dem.build(ns, surface, bed, water_eq, land_eq), 0), out / "sim.ktx2")
        files["sim"] = "sim.ktx2"

        log(f"{tier}: albedo")
        files["albedo"] = {}
        for m, src in albedo_src.items():
            name = f"albedo-{m:02d}.ktx2"
            encode_color(to_u8(to_faces(src, n, GUTTER)), out / name)
            files["albedo"][f"{m:02d}"] = name  # type: ignore[index]
        log(f"{tier}: night lights, clouds")
        encode_color(to_u8(to_faces(night_src, n, GUTTER)), out / "night.ktx2")
        files["night"] = "night.ktx2"
        encode_color(to_u8(to_faces(clouds_src, n, GUTTER))[..., None], out / "clouds.ktx2", srgb=False)
        files["clouds"] = "clouds.ktx2"

        sizes = {p.name: p.stat().st_size for p in out.glob("*.ktx2")}
        manifest["tiers"][tier] = {"display": n, "sim": ns, "files": files, "bytes": sum(sizes.values())}
        log(f"{tier}: {sum(sizes.values()) / 1e6:.1f} MB " + ", ".join(f"{k} {v / 1e6:.2f}" for k, v in sorted(sizes.items())))

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    log("done")


if __name__ == "__main__":
    main(sys.argv[1:] or list(TIERS))
