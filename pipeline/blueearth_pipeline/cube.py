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


def face_neighbors(n: int) -> np.ndarray:
    """4-neighbour table on the cube grid, shape (6·n·n, 4): [+s, −s, +t, −t] global cell ids
    (id = face·n² + t_row·n + s_col). Across face edges the neighbour is found by stepping one
    texel past the edge in EAC coordinates and mapping that direction back onto the cube."""
    ids = np.arange(6 * n * n, dtype=np.int64).reshape(6, n, n)
    out = np.empty((6, n, n, 4), dtype=np.int64)
    for face in range(6):
        jj, ii = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")  # jj: row (t), ii: col (s)
        for k, (di, dj) in enumerate([(1, 0), (-1, 0), (0, 1), (0, -1)]):
            ni, nj = ii + di, jj + dj
            inside = (ni >= 0) & (ni < n) & (nj >= 0) & (nj < n)
            res = np.where(inside, ids[face, np.clip(nj, 0, n - 1), np.clip(ni, 0, n - 1)], -1)
            oi, oj = ni[~inside], nj[~inside]
            if oi.size:
                a = np.tan((2 * (oi + 0.5) / n - 1) * np.pi / 4)
                b = np.tan((2 * (oj + 0.5) / n - 1) * np.pi / 4)
                major, s_axis, t_axis = FACE_BASIS[face]
                d = major + a[:, None] * s_axis + b[:, None] * t_axis
                f2, s2, t2 = direction_to_face_st(d / np.linalg.norm(d, axis=1, keepdims=True))
                i2 = np.clip((s2 * n).astype(np.int64), 0, n - 1)
                j2 = np.clip((t2 * n).astype(np.int64), 0, n - 1)
                res[~inside] = ids[f2, j2, i2]
            out[face, :, :, k] = res
    return out.reshape(-1, 4)


def texel_solid_angles(n: int) -> np.ndarray:
    """Solid angle (sr) of each texel of one face, shape (n, n); identical for all six faces."""
    edges = np.tan((2 * np.arange(n + 1) / n - 1) * np.pi / 4)
    # Exact solid angle of the gnomonic rectangle [x0,x1]×[y0,y1] at unit distance.
    f = lambda x, y: np.arctan2(x * y, np.sqrt(1 + x * x + y * y))  # noqa: E731
    x0, y0 = np.meshgrid(edges[:-1], edges[:-1])
    x1, y1 = np.meshgrid(edges[1:], edges[1:])
    return f(x1, y1) - f(x0, y1) - f(x1, y0) + f(x0, y0)
