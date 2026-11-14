"""Small full-file Earthdata products: SRTM tiles and GRACE Mascon."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import earthaccess

from .auth import earthdata_auth
from .budget import StorageBudget
from .cmr import COLLECTIONS, CMRClient, granule_size
from .config import PipelineConfig
from .manifest import RunManifest, sha256_file


def _download_results(
    *,
    config: PipelineConfig,
    key: str,
    results: list[Any],
    destination: Path,
    budget: StorageBudget,
    manifest: RunManifest,
) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    existing = {path.name: path for path in destination.iterdir() if path.is_file()}
    links: list[tuple[Any, str]] = []
    for result in results:
        data_links = result.data_links(access="external")
        if not data_links:
            raise RuntimeError(f"Earthaccess result has no external data link: {result}")
        links.append((result, data_links[0]))
    needed = [pair for pair in links if Path(pair[1].split("?", 1)[0]).name not in existing]
    # CMR size was already checked by plan; check free space immediately before earthaccess writes.
    budget.check(product=key)
    downloaded = (
        earthaccess.download([result for result, _ in needed], local_path=destination)
        if needed
        else []
    )
    paths = sorted({*existing.values(), *(Path(path) for path in downloaded)})
    for path in paths:
        if not path.exists() or path.stat().st_size == 0:
            raise RuntimeError(f"Earthdata download is missing or empty: {path}")
        result = next(
            (item for item, url in links if Path(url.split("?", 1)[0]).name == path.name),
            None,
        )
        meta = result.get("meta", {}) if isinstance(result, dict) else {}
        manifest.add(
            {
                "key": f"{key}:{path.name}",
                "provider": "NASA Earthdata",
                "collection_id": COLLECTIONS[key].concept_id,
                "granule_id": meta.get("concept-id"),
                "granule_native_id": meta.get("native-id"),
                "url": next(
                    (url for item, url in links if item is result),
                    None,
                ),
                "path": str(path),
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
                "resume": "earthaccess-managed",
            }
        )
    budget.check(product=key)
    return paths


def fetch_srtm(config: PipelineConfig, budget: StorageBudget, manifest: RunManifest) -> list[Path]:
    earthdata_auth()
    cmr = CMRClient().granules(
        COLLECTIONS["srtm"], start=None, end=None, bbox=config.bbox, page_size=100
    )
    total = sum(granule_size(item) or 0 for item in cmr["items"])
    budget.check(additional_bytes=total, product="srtm")
    results = earthaccess.search_data(
        concept_id=COLLECTIONS["srtm"].concept_id, bounding_box=config.bbox
    )
    if len(results) != cmr["hits"]:
        raise RuntimeError("SRTM earthaccess and CMR result counts differ")
    return _download_results(
        config=config,
        key="srtm",
        results=list(results),
        destination=config.root / "raw" / "srtm",
        budget=budget,
        manifest=manifest,
    )


def fetch_grace(config: PipelineConfig, budget: StorageBudget, manifest: RunManifest) -> list[Path]:
    earthdata_auth()
    cmr = CMRClient().granules(
        COLLECTIONS["grace"], start=config.start, end=config.end, bbox=None, page_size=10
    )
    total = sum(granule_size(item) or 0 for item in cmr["items"])
    budget.check(additional_bytes=total, product="grace")
    results = earthaccess.search_data(
        concept_id=COLLECTIONS["grace"].concept_id,
        temporal=(config.start.isoformat(), config.end.isoformat()),
    )
    if not results:
        raise RuntimeError("GRACE collection query returned no file")
    return _download_results(
        config=config,
        key="grace",
        results=list(results),
        destination=config.root / "raw" / "grace",
        budget=budget,
        manifest=manifest,
    )
