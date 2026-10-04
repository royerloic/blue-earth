import numpy as np

from blueearth_pipeline.cube import direction_to_face_st, face_directions


def test_round_trip():
    n = 64
    for face in range(6):
        d = face_directions(face, n)
        f, s, t = direction_to_face_st(d)
        assert np.all(f == face)
        c = (np.arange(n) + 0.5) / n
        ss, tt = np.meshgrid(c, c)
        assert np.max(np.abs(s - ss)) < 1e-12
        assert np.max(np.abs(t - tt)) < 1e-12


def test_faces_cover_sphere_area():
    # Sum of solid angles of all texels ~ 4π (numerical quadrature on the gnomonic plane).
    n = 256
    total = 0.0
    for _ in range(6):
        c = (np.arange(n) + 0.5) / n
        al = (2 * c - 1) * np.pi / 4
        a, b = np.meshgrid(np.tan(al), np.tan(al))
        # dΩ = da db / (1 + a² + b²)^{3/2};  da = sec²(α) dα, dα = (π/2)/n
        dal = (np.pi / 2) / n
        jac = (1 / np.cos(al)) ** 2 * dal
        ja, jb = np.meshgrid(jac, jac)
        total += np.sum(ja * jb / (1 + a**2 + b**2) ** 1.5)
    assert abs(total - 4 * np.pi) < 1e-4


def test_cell_area_ratio():
    # Equiangular cells keep edge lengths nearly uniform (~1.07×) but corner cells are skewed,
    # so cell AREA varies ~1.3× centre/corner and ~1.41× max/min: this sets dx_min ≈ 0.75·dx0 for the CFL.
    n = 256
    c = (np.arange(n) + 0.5) / n
    al = (2 * c - 1) * np.pi / 4
    a, b = np.meshgrid(np.tan(al), np.tan(al))
    jac = (1 / np.cos(al)) ** 2
    ja, jb = np.meshgrid(jac, jac)
    area = ja * jb / (1 + a**2 + b**2) ** 1.5
    assert 1.25 < area[n // 2, n // 2] / area[0, 0] < 1.35  # centre vs corner
    assert 1.38 < area.max() / area.min() < 1.44  # largest cells sit at edge midpoints
