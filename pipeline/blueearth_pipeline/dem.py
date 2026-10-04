"""Elevation layers on the cube: surface B, flood excess E = F − B, lake level L, ice I."""

from __future__ import annotations

import io
import zipfile

import numpy as np
import rasterio
import rasterio.features
import shapefile
from numba import njit

from .cube import face_neighbors
from .download import fetch
from .floodlevel import priority_flood
from .resample import to_faces

NO_LAKE = -10000.0  # sentinel lake level
OCEAN_SEED_DEPTH = -2000.0  # cells deeper than this seed the world ocean


def load_etopo(key: str) -> np.ndarray:
    with rasterio.open(fetch(key)) as ds:
        a = ds.read(1).astype(np.float32)
        if ds.nodata is not None:
            a[a == ds.nodata] = 0
    return a


def ne_raster(key: str, width: int = 8640) -> np.ndarray:
    """A Natural Earth 10m polygon layer rasterised to an equirect bool mask (width × width/2)."""
    with zipfile.ZipFile(fetch(key)) as z:
        names = z.namelist()
        get = lambda ext: io.BytesIO(z.read(next(n for n in names if n.endswith(ext))))  # noqa: E731
        sf = shapefile.Reader(shp=get(".shp"), shx=get(".shx"), dbf=get(".dbf"))
        shapes = [s.__geo_interface__ for s in sf.shapes()]
    h = width // 2
    transform = rasterio.transform.from_bounds(-180, -90, 180, 90, width, h)
    return rasterio.features.rasterize(((g, 1) for g in shapes), out_shape=(h, width), transform=transform, dtype=np.uint8) > 0


@njit(cache=True)
def _label(mask, nbr):
    lab = np.full(mask.shape[0], -1, np.int64)
    stack = np.empty(mask.shape[0], np.int64)
    k = 0
    for c in range(mask.shape[0]):
        if not mask[c] or lab[c] >= 0:
            continue
        top = 0
        stack[top] = c
        lab[c] = k
        while top >= 0:
            x = stack[top]
            top -= 1
            for j in range(nbr.shape[1]):
                m = nbr[x, j]
                if mask[m] and lab[m] < 0:
                    lab[m] = k
                    top += 1
                    stack[top] = m
        k += 1
    return lab, k


def inland_water_mask(lakes_eq: np.ndarray, land_eq: np.ndarray) -> np.ndarray:
    """Equirect float mask of water per Natural Earth: lakes, plus holes in the land layer
    (the Caspian is a hole in ne_10m_land, not a lake)."""
    return (lakes_eq | ~land_eq).astype(np.float32)


SHORE_PERCENTILE = 10


def lake_levels(b: np.ndarray, water: np.ndarray, nbr: np.ndarray, f: np.ndarray, pct: float = SHORE_PERCENTILE) -> np.ndarray:
    """Per-cell inland water level. Inland water = NE water cells not connected to the ocean
    at S = 0 (F > 0); components touching ocean cells are coastal artefacts and dropped. The
    level is a low percentile of the elevation of each component's shoreline ring."""
    lake = water & (f > 0)
    lab, k = _label(lake, nbr)
    touches_ocean = np.zeros(k, bool)
    nb_ocean = (f[nbr] <= 0).any(axis=1)
    np.logical_or.at(touches_ocean, lab[lake & nb_ocean], True)
    level = np.full(b.shape, NO_LAKE, np.float32)
    ring_owner = np.where(lake[nbr], lab[nbr], -1)  # (N, 4): lake id of each lake neighbour
    shore = ~lake
    owners = ring_owner[shore]
    heights = np.repeat(b[shore][:, None], nbr.shape[1], 1)
    ok = owners >= 0
    owners, heights = owners[ok], heights[ok]
    order = np.argsort(owners, kind="stable")
    owners, heights = owners[order], heights[order]
    starts = np.searchsorted(owners, np.arange(k))
    ends = np.searchsorted(owners, np.arange(k), side="right")
    lvl = np.array([np.percentile(heights[s:e], pct) if e > s else NO_LAKE for s, e in zip(starts, ends)], np.float32)
    lvl[touches_ocean] = NO_LAKE
    inside = lab >= 0
    level[inside] = lvl[lab[inside]]
    return level


PROTECTED_LOWLAND_FLOOD = 2.0  # m: below-sea-level land (polders, dikes) floods at S > this


def build(n: int, surface: np.ndarray, bed: np.ndarray, water_eq: np.ndarray, land_eq: np.ndarray) -> dict[str, np.ndarray]:
    """All elevation layers on an n×n-per-face cube grid, each shaped (6, n, n)."""
    b = to_faces(surface, n)
    ice = np.maximum(b - to_faces(bed, n), 0)
    nbr = face_neighbors(n)
    bf = b.ravel().astype(np.float64)
    f = priority_flood(bf, nbr, bf < OCEAN_SEED_DEPTH)
    # Land per Natural Earth that the DEM connects to the sea below 0 m (Netherlands, …)
    # is dike-protected today: keep it dry until the sea rises a little.
    land = to_faces(land_eq.astype(np.float32), n).ravel() > 0.5
    f = np.where(land & (f <= 0), PROTECTED_LOWLAND_FLOOD, f)
    water = to_faces(water_eq, n).ravel() > 0.5
    lvl = lake_levels(bf, water, nbr, f)
    return {
        "B": b,
        "E": (f - bf).reshape(b.shape).astype(np.float32),
        "L": lvl.reshape(b.shape),
        "I": ice.astype(np.float32),
    }
