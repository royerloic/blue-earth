"""M0 spike d+e (faces carry a GUTTER-texel border): build EAC cube textures from an equirectangular image and encode as KTX2.

Outputs (public/spike/):
  albedo-array-etc1s.ktx2  6-layer 2D array, Basis ETC1S
  albedo-array-uastc.ktx2  6-layer 2D array, UASTC + zstd
  height-array-r16f.ktx2   6-layer 2D array, R16_SFLOAT + zstd (synthetic heights, metres)
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import OpenEXR
from PIL import Image
from scipy.ndimage import map_coordinates

from .cube import direction_to_lonlat, face_directions

ROOT = Path(__file__).resolve().parents[2]
KTX = ROOT / ".tools/bin/ktx"
ENV = {**os.environ, "DYLD_LIBRARY_PATH": str(ROOT / ".tools/lib")}


def sample_equirect(img: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Bilinear sample of an equirect image (H, W, C) at ECEF directions d (..., 3)."""
    h, w = img.shape[:2]
    lon, lat = direction_to_lonlat(d)
    x = (lon + np.pi) / (2 * np.pi) * w - 0.5
    y = (np.pi / 2 - lat) / np.pi * h - 0.5
    out = [map_coordinates(img[..., c], [y, x], order=1, mode="wrap") for c in range(img.shape[2])]
    return np.stack(out, -1)


GUTTER = 4


def build_faces(img: np.ndarray, n: int, ss: int = 2, gutter: int = GUTTER) -> list[np.ndarray]:
    faces = []
    m = n + 2 * gutter
    for f in range(6):
        v = sample_equirect(img, face_directions(f, n, ss, gutter))
        faces.append(v.reshape(m, ss, m, ss, -1).mean(axis=(1, 3)))  # box-filter supersamples
    return faces


def ktx(*args: str) -> None:
    subprocess.run([str(KTX), "create", *args], check=True, env=ENV)


def main(src: str, out: str, n: int = 512) -> None:
    out_dir = Path(out)
    tmp = out_dir / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    img = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
    faces = build_faces(img, n)
    pngs = []
    for f, face in enumerate(faces):
        p = tmp / f"albedo-{f}.png"
        Image.fromarray(np.clip(face + 0.5, 0, 255).astype(np.uint8)).save(p)
        pngs.append(str(p))

    ktx("--format", "R8G8B8_SRGB", "--encode", "basis-lz", "--layers", "6", "--generate-mipmap",
        *pngs, str(out_dir / "albedo-array-etc1s.ktx2"))
    ktx("--format", "R8G8B8_SRGB", "--encode", "uastc", "--zstd", "18", "--layers", "6",
        "--generate-mipmap", *pngs, str(out_dir / "albedo-array-uastc.ktx2"))

    # Synthetic heights in metres: luminance mapped to [-6000, 3000].
    exrs = []
    for f, face in enumerate(faces):
        hgt = (face.mean(-1) / 255.0 * 9000.0 - 6000.0).astype(np.float16)
        p = tmp / f"height-{f}.exr"
        OpenEXR.File({"type": OpenEXR.scanlineimage}, {"R": hgt}).write(str(p))
        exrs.append(str(p))
    ktx("--format", "R16_SFLOAT", "--zstd", "18", "--layers", "6", *exrs,
        str(out_dir / "height-array-r16f.ktx2"))
    for p in out_dir.glob("*.ktx2"):
        print(f"{p.name}: {p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:3], n=int(sys.argv[3]) if len(sys.argv) > 3 else 512)
