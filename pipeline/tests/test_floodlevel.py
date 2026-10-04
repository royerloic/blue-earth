import numpy as np

from blueearth_pipeline.cube import face_neighbors, texel_solid_angles
from blueearth_pipeline.floodlevel import priority_flood


def grid_neighbors(h, w):
    ids = np.arange(h * w).reshape(h, w)
    out = np.full((h, w, 4), -1)
    out[:, :-1, 0] = ids[:, 1:]
    out[:, 1:, 1] = ids[:, :-1]
    out[:-1, :, 2] = ids[1:, :]
    out[1:, :, 3] = ids[:-1, :]
    return out.reshape(-1, 4)


def test_enclosed_basin_floods_at_rim_height():
    # Deep ocean on the left; a basin (floor −50) behind a rim of height 10; land at 30 beyond.
    b = np.full((5, 12), 30.0)
    b[:, :3] = -3000
    b[:, 3] = 5  # beach
    b[:, 4] = 10  # rim
    b[1:4, 5:9] = -50  # basin
    b[:, 9] = 12
    f = priority_flood(b.ravel(), grid_neighbors(5, 12), (b < -2000).ravel()).reshape(5, 12)
    assert np.all(f[:, :3] == -3000)
    assert np.all(f[1:4, 5:9] == 10)  # basin connects once the sea tops the rim
    assert f[2, 3] == 5
    assert np.all(f >= b)


def test_face_neighbors_are_symmetric_and_complete():
    n = 16
    nb = face_neighbors(n)
    assert nb.min() >= 0
    # Every adjacency is mutual (each cell appears in its neighbours' lists).
    for c in range(nb.shape[0]):
        for m in nb[c]:
            assert c in nb[m]


def test_texel_solid_angles_sum_to_sphere():
    assert abs(6 * texel_solid_angles(64).sum() - 4 * np.pi) < 1e-9
