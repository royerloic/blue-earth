"""Downloads raw datasets into data/raw/ and verifies them against sources.lock.json."""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from .sources import SOURCES

PIPELINE = Path(__file__).resolve().parents[1]
RAW = PIPELINE / "data" / "raw"
LOCK = PIPELINE / "sources.lock.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def raw_path(key: str) -> Path:
    return RAW / Path(SOURCES[key]["url"]).name


def fetch(key: str) -> Path:
    """Returns the local path of a source, downloading and verifying it if needed."""
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    path = raw_path(key)
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        print(f"downloading {key}: {SOURCES[key]['url']}", file=sys.stderr)
        urllib.request.urlretrieve(SOURCES[key]["url"], tmp)
        tmp.rename(path)
    digest = sha256(path)
    pinned = lock.get(key, {}).get("sha256")
    if pinned is None:
        lock[key] = {"url": SOURCES[key]["url"], "sha256": digest, "bytes": path.stat().st_size}
        LOCK.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    elif pinned != digest:
        raise RuntimeError(f"{key}: SHA-256 mismatch (pinned {pinned[:12]}…, got {digest[:12]}…). Upstream changed?")
    return path


if __name__ == "__main__":
    for k in sys.argv[1:] or SOURCES:
        print(k, fetch(k))
