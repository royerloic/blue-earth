"""Raw dataset sources. SHA-256 digests are pinned in sources.lock.json on first download
(trust on first use) and verified on every later run, so silent upstream changes are caught."""

NASA = "https://assets.science.nasa.gov/content/dam/science/esd/eo"
ETOPO = "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s"
MONTHS = {1: "january", 4: "april", 7: "july", 10: "october"}

SOURCES: dict[str, dict[str, str]] = {
    "etopo_surface": {
        "url": f"{ETOPO}/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif",
        "credit": "NOAA NCEI ETOPO 2022 (doi:10.25921/fd45-gt74)",
    },
    "etopo_bed": {
        "url": f"{ETOPO}/60s_bed_elev_gtif/ETOPO_2022_v1_60s_N90W180_bed.tif",
        "credit": "NOAA NCEI ETOPO 2022 (doi:10.25921/fd45-gt74)",
    },
    **{
        f"bmng_{m:02d}": {
            "url": f"{NASA}/images/bmng/bmng-base/{name}/world.2004{m:02d}.3x5400x2700.jpg",
            "credit": "NASA Earth Observatory, Blue Marble Next Generation (R. Stöckli)",
        }
        for m, name in MONTHS.items()
    },
    **{
        f"bmng_hi_{m:02d}": {
            "url": f"{NASA}/images/bmng/bmng-base/{name}/world.2004{m:02d}.3x21600x10800.jpg",
            "credit": "NASA Earth Observatory, Blue Marble Next Generation (R. Stöckli)",
        }
        for m, name in MONTHS.items()
    },
    # 500 m Blue Marble (July): 8 tiles of 90°×90° (A–D west→east, 1 north / 2 south).
    **{
        f"bmng500_07_{t}": {
            "url": f"{NASA}/images/bmng/bmng-base/july/world.200407.3x21600x21600.{t}.jpg",
            "credit": "NASA Earth Observatory, Blue Marble Next Generation (R. Stöckli)",
        }
        for t in ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"]
    },
    "black_marble": {
        "url": f"{NASA}/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg",
        "credit": "NASA Earth Observatory / GSFC, Black Marble 2016 (M. Román et al.)",
    },
    "clouds": {
        "url": f"{NASA}/content-feature/bluemarble/images/cloud_combined_2048.jpg",
        "credit": "NASA Earth Observatory, The Blue Marble (2002) cloud composite",
    },
    "ne_land": {
        "url": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
        "credit": "Natural Earth (public domain)",
    },
    "ne_lakes": {
        "url": "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip",
        "credit": "Natural Earth (public domain)",
    },
}
