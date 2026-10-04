"""Equirectangular (pixel-is-area, lon −180..180, lat 90..−90) → EAC cube faces."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import map_coordinates

from .cube import direction_to_face_st, direction_to_lonlat, face_directions


def box_reduce(img: np.ndarray, factor: int) -> np.ndarray:
    """Integer box-filter downsample (area average) of an (H, W[, C]) image."""
    if factor <= 1:
        return img
    h, w = (img.shape[0] // factor) * factor, (img.shape[1] // factor) * factor
    img = img[:h, :w]
    shape = (h // factor, factor, w // factor, factor) + img.shape[2:]
    return img.reshape(shape).mean(axis=(1, 3), dtype=np.float32)


def sample_equirect(img: np.ndarray, d: np.ndarray, order: int = 1) -> np.ndarray:
    """Samples an equirect image (H, W[, C]) at ECEF unit directions d (..., 3)."""
    h, w = img.shape[:2]
    lon, lat = direction_to_lonlat(d)
    x = (lon + np.pi) / (2 * np.pi) * w - 0.5
    y = (np.pi / 2 - lat) / np.pi * h - 0.5
    # Wrap longitude by padding one column each side; clamp latitude.
    if img.ndim == 2:
        img = img[..., None]
    pad = np.concatenate([img[:, -1:], img, img[:, :1]], axis=1)
    y = np.clip(y, 0, h - 1)
    out = [map_coordinates(pad[..., c], [y, x + 1], order=order, mode="nearest") for c in range(img.shape[2])]
    return np.stack(out, -1)


def to_faces(img: np.ndarray, n: int, gutter: int = 0, ss: int = 2, order: int = 1) -> np.ndarray:
    """Area-averaged EAC faces: (6, m, m[, C]) with m = n + 2·gutter.

    The source is first box-filtered so it has about ss samples per face texel at the
    equator, then each texel averages an ss×ss grid of bilinear samples."""
    factor = max(1, img.shape[1] // (4 * n * ss))
    src = box_reduce(img, factor)
    m = n + 2 * gutter
    faces = []
    for f in range(6):
        v = sample_equirect(src, face_directions(f, n, ss, gutter), order)
        faces.append(v.reshape(m, ss, m, ss, -1).mean(axis=(1, 3)))
    out = np.stack(faces)
    return out[..., 0] if img.ndim == 2 else out


def add_gutter(faces: np.ndarray, gutter: int) -> np.ndarray:
    """Extends (6, n, n[, C]) faces by `gutter` texels per side using nearest texels of the
    neighbouring faces (for derived fields that cannot be resampled from the source)."""
    n = faces.shape[1]
    m = n + 2 * gutter
    out = np.empty((6, m, m) + faces.shape[3:], faces.dtype)
    for f in range(6):
        fi, s, t = direction_to_face_st(face_directions(f, n, 1, gutter))
        i = np.clip((s * n).astype(int), 0, n - 1)
        j = np.clip((t * n).astype(int), 0, n - 1)
        out[f] = faces[fi, j, i]
    return out
