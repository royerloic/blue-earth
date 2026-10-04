# Data: sources, processing, attribution

Built by `pipeline/` (`uv run python -m blueearth_pipeline.build [low medium]`) into `public/data/`,
which is git-ignored and published separately (planned: `data-vN` GitHub Releases).
Raw downloads are pinned by SHA-256 in `pipeline/sources.lock.json`.

| Layer | Source | Licence / credit |
|---|---|---|
| Surface & bedrock elevation | NOAA NCEI **ETOPO 2022**, 60″ GeoTIFFs | Public domain; cite doi:10.25921/fd45-gt74 |
| Day albedo (Jan/Apr/Jul/Oct) | NASA **Blue Marble Next Generation** base map (no shaded relief), 5400×2700 | Public domain; credit NASA Earth Observatory (R. Stöckli) |
| Night lights | NASA **Black Marble 2016**, 3 km colour | Public domain; credit NASA Earth Observatory / GSFC |
| Clouds | NASA **The Blue Marble (2002)** cloud composite, 2048×1024 | Public domain; credit NASA Earth Observatory |
| Land & lakes | **Natural Earth** 10m land, lakes | Public domain |
| Classic 2004 | Original BlueEarth assets (`public/classic/`) | © Loic Royer; provenance of world.jpg to be confirmed |

## Layers per tier (EAC 6-layer arrays, 4-texel gutters on display textures)
| File | Format | Content |
|---|---|---|
| `terrain.ktx2` | RGBA16F + zstd | B surface elevation (m) · E = F − B, where F is the lowest sea level connecting the cell to the ocean (priority-flood) · L inland-water level (−10000 = none) · I ice thickness |
| `sim.ktx2` | same, simulation grid, no gutters | |
| `albedo-MM.ktx2` | Basis ETC1S, sRGB, mipmapped | |
| `night.ktx2`, `clouds.ktx2` | Basis ETC1S | |

Low tier: 512² display faces / 256² sim, ~5 MB. Medium tier: 1024² / 512², ~19 MB.

## Rules and known approximations
- **Water at sea level S:** ocean where F ≤ S; inland water where L > B.
- **Protected lowlands:** Natural Earth land that the DEM connects to the sea below 0 m (Dutch polders etc.) gets F = +2 m. Dikes are not in the DEM.
- **Inland water levels** come from a low (10th) percentile of shoreline elevation. Accuracy at the 512² sim grid: Caspian −28 m (true −28), Superior 196 (183), Victoria 1150 (1134), Baikal 425 (456), Titicaca 3832 (3812). Narrow rift lakes are worse: Tanganyika 870 (773).
- Ocean fraction at S = 0: 70.6% (expected ≈ 71%).
