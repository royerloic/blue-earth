"""Equiangular cube (EAC) mapping shared by the pipeline and the app (src/core/geo/cubeEAC.ts).

Faces follow the OpenGL / KTX cube-map convention (+X, -X, +Y, -Y, +Z, -Z), applied
directly to ECEF directions (x: lon 0, y: lon 90E, z: north). Texel (i, j) of an N×N face
has EAC coordinates s = (i + 0.5)/N, t = (j + 0.5)/N; row j = 0 is the first stored row.
"""

from __future__ import annotations

import numpy as np

# Per face: (major axis, axis of increasing s, axis of increasing t), from the GL spec table.
FACE_BASIS = np.array(
    [
        [[+1, 0, 0], [0, 0, -1], [0, -1, 0]],  # +X: sc = -z, tc = -y
        [[-1, 0, 0], [0, 0, +1], [0, -1, 0]],  # -X: sc = +z, tc = -y
        [[0, +1, 0], [+1, 0, 0], [0, 0, +1]],  # +Y: sc = +x, tc = +z
        [[0, -1, 0], [+1, 0, 0], [0, 0, -1]],  # -Y: sc = +x, tc = -z
        [[0, 0, +1], [+1, 0, 0], [0, -1, 0]],  # +Z: sc = +x, tc = -y
        [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],  # -Z: sc = -x, tc = -y
    ],
    dtype=np.float64,
)


def face_directions(face: int, n: int, supersample: int = 1, gutter: int = 0) -> np.ndarray:
    """Unit directions for texel centres (or a k×k sub-grid per texel).

    With `gutter` g > 0 the grid extends g texels past each face edge (EAC coordinates
    outside [0, 1] are still valid directions, landing on the neighbouring face), giving
    shape ((n+2g)*k, (n+2g)*k, 3). Gutters let bilinear/mip filtering run across face seams.
    """
    m = (n + 2 * gutter) * supersample
    c = (np.arange(m) + 0.5) / (n * supersample) - gutter / n  # EAC coordinate
    g = np.tan((2 * c - 1) * np.pi / 4)  # gnomonic coordinate in [-1, 1]
    a, b = np.meshgrid(g, g)  # a varies along columns (s), b along rows (t)
    major, s_axis, t_axis = FACE_BASIS[face]
    d = major + a[..., None] * s_axis + b[..., None] * t_axis
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def direction_to_lonlat(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """ECEF unit directions -> (lon, lat) in radians."""
    lon = np.arctan2(d[..., 1], d[..., 0])
    lat = np.arcsin(np.clip(d[..., 2], -1, 1))
    return lon, lat


def direction_to_face_st(d: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Inverse mapping: ECEF directions -> (face, s, t) with s, t in [0, 1]."""
    ad = np.abs(d)
    axis = np.argmax(ad, axis=-1)
    sign = np.take_along_axis(d, axis[..., None], -1)[..., 0] < 0
    face = axis * 2 + sign
    basis = FACE_BASIS[face]
    ma = np.take_along_axis(ad, axis[..., None], -1)[..., 0]
    a = np.einsum("...k,...k->...", d, basis[..., 1, :]) / ma
    b = np.einsum("...k,...k->...", d, basis[..., 2, :]) / ma
    s = (np.arctan(a) * 4 / np.pi + 1) / 2
    t = (np.arctan(b) * 4 / np.pi + 1) / 2
    return face, s, t
