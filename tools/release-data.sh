#!/usr/bin/env bash
# Packages public/data (built by the pipeline) into per-tier tarballs for a GitHub Release.
#   tools/release-data.sh            -> dist-data/blue-earth-data-<tier>.tar + manifest.json
#   tools/release-data.sh --publish  -> also creates/updates the release data-v<version> (needs gh + repo)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('public/data/manifest.json'))['version'])")
OUT=dist-data
rm -rf "$OUT" && mkdir -p "$OUT"
cp public/data/manifest.json "$OUT/"
for dir in public/data/*/; do
  tier=$(basename "$dir")
  # KTX2 files are already compressed; plain tar keeps extraction fast.
  tar -cf "$OUT/blue-earth-data-$tier.tar" -C public/data "$tier"
done
ls -la "$OUT"
if [[ "${1:-}" == "--publish" ]]; then
  TAG="data-v$VERSION"
  gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "Globe data v$VERSION" \
    --notes "Built by pipeline/ (see docs/DATA.md for sources and attribution)."
  gh release upload "$TAG" "$OUT"/* --clobber
fi
