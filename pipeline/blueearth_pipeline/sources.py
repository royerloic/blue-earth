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
