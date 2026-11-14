"""Daily IMERG Final AOI extraction through GES DISC OPeNDAP."""

from __future__ import annotations

import csv
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import requests
from pydap.client import open_url  # type: ignore[import-untyped]

from .auth import earthdata_credentials
from .cmr import COLLECTIONS, CMRClient, related_urls
from .config import PipelineConfig
from .manifest import RunManifest, sha256_file

GEDISC_EULA_URL = "https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ"


def _opendap_url(item: dict[str, Any]) -> str:
    urls = related_urls(item)
    candidates = [url for url in urls if "opendap" in url.lower() and "doc" not in url.lower()]
    if not candidates:
        raise RuntimeError(f"No OPeNDAP URL for {item.get('meta', {}).get('concept-id')}")
    return candidates[0].split("?", 1)[0]


def _dap4_url(url: str) -> str:
    if not url.startswith("https://"):
        raise ValueError("GES DISC OPeNDAP URL must use HTTPS")
    return url.replace("https://", "dap4://", 1)


def _date(item: dict[str, Any]) -> date:
    value = item["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date()


def _indices(config: PipelineConfig) -> tuple[slice, slice, np.ndarray, np.ndarray]:
    west, south, east, north = config.bbox
    lon0 = max(0, math.floor((west + 179.95) / 0.1))
    lon1 = min(3599, math.ceil((east + 179.95) / 0.1))
    lat0 = max(0, math.floor((south + 89.95) / 0.1))
    lat1 = min(1799, math.ceil((north + 89.95) / 0.1))
    lons = -179.95 + np.arange(lon0, lon1 + 1) * 0.1
    lats = -89.95 + np.arange(lat0, lat1 + 1) * 0.1
    return slice(lon0, lon1 + 1), slice(lat0, lat1 + 1), lons, lats


def fetch_gpm(config: PipelineConfig, manifest: RunManifest) -> Path:
    output = config.root / "processed" / "gpm-daily-aoi.csv"
    if output.exists():
        return output
    search = CMRClient().granules(
        COLLECTIONS["gpm"], start=config.start, end=config.end, bbox=config.bbox, page_size=2000
    )
    if search["hits"] != config.expected_days or len(search["items"]) != config.expected_days:
        raise RuntimeError(
            f"GPM completeness failed: expected {config.expected_days}, got {search['hits']}"
        )
    lon_slice, lat_slice, lons, lats = _indices(config)
    output.parent.mkdir(parents=True, exist_ok=True)
    part = output.with_suffix(".csv.part")
    completed_dates: set[date] = set()
    if part.exists() and part.stat().st_size:
        try:
            with part.open(newline="") as existing:
                completed_dates = {
                    date.fromisoformat(row["date"])
                    for row in csv.DictReader(existing)
                    if row.get("date")
                }
        except (KeyError, ValueError, csv.Error):
            completed_dates = set()
    ordered = [
        item for item in sorted(search["items"], key=_date) if _date(item) not in completed_dates
    ]

    def read_day(item: dict[str, Any]) -> tuple[date, str, str, np.ndarray]:
        session = requests.Session()
        session.auth = earthdata_credentials()
        stamp, url = _date(item), _opendap_url(item)
        try:
            dap4_url = _dap4_url(url)
            dataset = open_url(dap4_url, session=session, timeout=120)
        except Exception as error:
            detail = str(error)
            if "EULA Acceptance Failure" in detail or "approve_app" in detail or "403" in detail:
                raise RuntimeError(
                    "GES DISC denied IMERG OPeNDAP access (HTTP 403). Check that the "
                    "Earthdata account holder has approved the GES DISC application terms at "
                    f"{GEDISC_EULA_URL}; no GPM science file was downloaded."
                ) from error
            raise
        values = np.asarray(dataset["precipitation"][0, lon_slice, lat_slice].data).squeeze()
        if values.shape != (len(lons), len(lats)):
            values = values.reshape((len(lons), len(lats)))
        return stamp, url, str(item.get("meta", {}).get("concept-id")), values

    batch_size = 48
    stream_context = part.open("a" if part.exists() and part.stat().st_size else "w", newline="")
    with stream_context as stream:
        writer = csv.DictWriter(stream, fieldnames=["date", "longitude", "latitude", "rain_mm"])
        if not completed_dates:
            writer.writeheader()
        stream.flush()
        for offset in range(0, len(ordered), batch_size):
            batch = ordered[offset : offset + batch_size]
            results: dict[date, tuple[str, str, np.ndarray]] = {}
            try:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    futures = [pool.submit(read_day, item) for item in batch]
                    for future in as_completed(futures):
                        stamp, url, granule_id, values = future.result()
                        results[stamp] = (url, granule_id, values)
            except Exception as error:
                detail = str(error)
                if "403" in detail or "EULA" in detail or "approve_app" in detail:
                    reason = (
                        "GES DISC denied IMERG OPeNDAP access (HTTP 403). Check that the "
                        "Earthdata account holder has approved the GES DISC application terms at "
                        f"{GEDISC_EULA_URL}; no GPM science file was downloaded."
                    )
                    manifest.failure(stage="gpm-opendap", reason=reason)
                    raise RuntimeError(reason) from error
                raise
            for stamp in sorted(results):
                url, granule_id, values = results[stamp]
                for i, longitude in enumerate(lons):
                    for j, latitude in enumerate(lats):
                        value = float(values[i, j])
                        writer.writerow(
                            {
                                "date": stamp.isoformat(),
                                "longitude": round(float(longitude), 5),
                                "latitude": round(float(latitude), 5),
                                "rain_mm": (value if math.isfinite(value) and value >= 0 else ""),
                            }
                        )
                manifest.add(
                    {
                        "key": f"gpm:{stamp.isoformat()}",
                        "provider": "NASA GES DISC",
                        "collection_id": COLLECTIONS["gpm"].concept_id,
                        "granule_id": granule_id,
                        "product": "GPM_3IMERGDF.07",
                        "date": stamp.isoformat(),
                        "url": url,
                        "acquisition": "OPeNDAP AOI/variable subset",
                        "protocol": "DAP4",
                        "variable": "precipitation",
                        "units": "mm/day",
                    }
                )
            stream.flush()
    part.replace(output)
    manifest.add(
        {
            "key": "gpm-daily-aoi",
            "provider": "NASA GES DISC",
            "path": str(output),
            "size": output.stat().st_size,
            "sha256": sha256_file(output),
            "expected_days": config.expected_days,
            "complete_days": config.expected_days,
            "qa": "finite nonnegative precipitation; no interpolation or zero fill",
        }
    )
    return output
