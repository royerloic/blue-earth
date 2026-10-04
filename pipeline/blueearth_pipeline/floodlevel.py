"""Flood level F: the lowest sea level at which a cell becomes connected to the world ocean.

Computed with priority-flood (Barnes et al. 2014) over an arbitrary neighbour graph:
F(c) = max(B(c), min over paths to the ocean of the highest B on the path).
Enclosed basins (Caspian, Dead Sea, Qattara) therefore stay dry until the sea tops their rim.
"""

from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def _push(hk, hv, size, k, v):
    i = size
    hk[i] = k
    hv[i] = v
    while i > 0:
        p = (i - 1) >> 1
        if hk[p] <= hk[i]:
            break
        hk[p], hk[i] = hk[i], hk[p]
        hv[p], hv[i] = hv[i], hv[p]
        i = p
    return size + 1


@njit(cache=True)
def _pop(hk, hv, size):
    k, v = hk[0], hv[0]
    size -= 1
    hk[0] = hk[size]
    hv[0] = hv[size]
    i = 0
    while True:
        l = 2 * i + 1
        r = l + 1
        m = i
        if l < size and hk[l] < hk[m]:
            m = l
        if r < size and hk[r] < hk[m]:
            m = r
        if m == i:
            break
        hk[m], hk[i] = hk[i], hk[m]
        hv[m], hv[i] = hv[i], hv[m]
        i = m
    return k, v, size


@njit(cache=True)
def priority_flood(b: np.ndarray, nbr: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """b: (N,) elevations; nbr: (N, K) neighbour ids (−1 = none); seeds: (N,) bool ocean seeds."""
    n = b.shape[0]
    f = np.full(n, np.inf, dtype=np.float64)
    done = np.zeros(n, dtype=np.bool_)
    hk = np.empty(n, dtype=np.float64)
    hv = np.empty(n, dtype=np.int64)
    size = 0
    for c in range(n):
        if seeds[c]:
            f[c] = b[c]
            done[c] = True
            size = _push(hk, hv, size, b[c], c)
    while size > 0:
        k, c, size = _pop(hk, hv, size)
        for j in range(nbr.shape[1]):
            m = nbr[c, j]
            if m < 0 or done[m]:
                continue
            done[m] = True
            f[m] = max(b[m], k)
            size = _push(hk, hv, size, f[m], m)
    return f
