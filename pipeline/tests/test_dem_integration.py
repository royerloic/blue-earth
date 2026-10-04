"""Integration checks on real data; skipped when the raw datasets are not downloaded."""

import numpy as np
import pytest

from blueearth_pipeline.cube import direction_to_face_st, texel_solid_angles
from blueearth_pipeline.download import raw_path

pytestmark = pytest.mark.skipif(
    not all(raw_path(k).exists() for k in ["etopo_surface", "etopo_bed", "ne_land", "ne_lakes"]),
    reason="raw datasets not downloaded (uv run python -m blueearth_pipeline.download)",
)
N = 256


@pytest.fixture(scope="module")
def layers():
    from blueearth_pipeline import dem

    land = dem.ne_raster("ne_land")
    water = dem.inland_water_mask(dem.ne_raster("ne_lakes"), land)
    return dem.build(N, dem.load_etopo("etopo_surface"), dem.load_etopo("etopo_bed"), water, land)


def cell(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    f, s, t = direction_to_face_st(np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]))
    return int(f), int(t * N), int(s * N)


def test_ocean_covers_71_percent_at_present_sea_level(layers):
    w = np.broadcast_to(texel_solid_angles(N), (6, N, N))
    ocean = (layers["B"] + layers["E"]) <= 0
    assert abs((w * ocean).sum() / w.sum() - 0.71) < 0.01


def test_enclosed_basins_and_protected_lowlands(layers):
    f = layers["B"] + layers["E"]
    assert f[cell(42, 51)] > 0  # Caspian floor is not connected to the ocean at S = 0
    assert abs(layers["L"][cell(42, 51)] - (-28)) < 10  # Caspian surface ≈ −28 m
    assert 0 < f[cell(52.3, 5.0)] <= 2.0  # Netherlands polders stay dry until +2 m
    assert layers["I"][cell(72, -40)] > 2000  # Greenland ice sheet
