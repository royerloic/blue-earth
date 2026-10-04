"""KTX2 encoding of 6-layer EAC face arrays via KTX-Software's `ktx create`."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import OpenEXR
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
KTX = Path(os.environ.get("KTX", ROOT / ".tools/bin/ktx"))
ENV = {**os.environ, "DYLD_LIBRARY_PATH": str(ROOT / ".tools/lib"), "LD_LIBRARY_PATH": str(ROOT / ".tools/lib")}


def _ktx(args: list[str]) -> None:
    subprocess.run([str(KTX), "create", *args], check=True, env=ENV, stdout=subprocess.DEVNULL)


def encode_color(faces: np.ndarray, out: Path, *, srgb: bool = True, quality: int = 192) -> None:
    """faces: (6, m, m, C) uint8, C = 1 or 3 → Basis ETC1S array with mipmaps."""
    with tempfile.TemporaryDirectory() as td:
        pngs = []
        for f in range(6):
            p = Path(td) / f"{f}.png"
            img = faces[f] if faces.shape[-1] == 3 else faces[f, ..., 0]
            Image.fromarray(img).save(p)
            pngs.append(str(p))
        fmt = ("R8G8B8_SRGB" if srgb else "R8G8B8_UNORM") if faces.shape[-1] == 3 else "R8_UNORM"
        tf = [] if faces.shape[-1] == 3 and srgb else ["--assign-tf", "linear"]
        _ktx(["--format", fmt, *tf, "--encode", "basis-lz", "--qlevel", str(quality), "--layers", "6",
              "--generate-mipmap", *pngs, str(out)])


def encode_half(faces: np.ndarray, out: Path) -> None:
    """faces: (6, m, m, 4) float → RGBA16F + zstd array (no mipmaps)."""
    assert faces.shape[-1] == 4
    with tempfile.TemporaryDirectory() as td:
        exrs = []
        for f in range(6):
            p = Path(td) / f"{f}.exr"
            ch = {c: np.ascontiguousarray(faces[f, ..., k].astype(np.float16)) for k, c in enumerate("RGBA")}
            OpenEXR.File({"type": OpenEXR.scanlineimage}, ch).write(str(p))
            exrs.append(str(p))
        _ktx(["--format", "R16G16B16A16_SFLOAT", "--zstd", "20", "--layers", "6", *exrs, str(out)])


def have_ktx() -> bool:
    return KTX.exists() or shutil.which("ktx") is not None
