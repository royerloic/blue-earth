"""Writes tests/fixtures/okada-dc3d.json: vertical surface displacement from Okada's DC3D
(okada_wrapper) for random rectangular faults, in Okada's fault frame (see src/sim/okada.ts)."""

import json
from pathlib import Path

import numpy as np
from okada_wrapper import dc3dwrapper

rng = np.random.default_rng(42)
nu = 0.25
alpha = 1 / (2 * (1 - nu))  # (λ+μ)/(λ+2μ) for λ = μ·2ν/(1−2ν)
cases = []
for _ in range(200):
    L, W = rng.uniform(5, 100), rng.uniform(5, 60)
    dip = float(rng.choice([rng.uniform(3, 89), 90.0, 45.0]))
    d = W * np.sin(np.radians(dip)) + rng.uniform(0.5, 30)  # bottom edge deep enough for a buried top
    x, y = rng.uniform(-80, 180), rng.uniform(-120, 120)
    U = rng.uniform(-5, 5, 3)
    ok, u, _ = dc3dwrapper(alpha, [x, y, 0.0], d, dip, [0.0, L], [0.0, W], list(U))
    assert ok == 0
    cases.append(dict(x=x, y=y, d=d, dip=dip, L=L, W=W, U=list(map(float, U)), uz=float(u[2])))
out = Path(__file__).resolve().parents[2] / "tests/fixtures/okada-dc3d.json"
out.write_text(json.dumps(cases))
print(f"{len(cases)} cases -> {out}")
