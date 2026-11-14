"""Real NASA POWER Temporal Daily acquisition."""

from __future__ import annotations

import json

import httpx

from ..adapters.power import PARAMETERS, parse_power
from .config import PipelineConfig
from .manifest import RunManifest, atomic_json

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"


def fetch_power(
    config: PipelineConfig, manifest: RunManifest, client: httpx.Client
) -> dict[str, object]:
    raw_path = config.root / "raw" / "power" / "daily.json"
    parsed_path = config.root / "processed" / "power-daily.json"
    params: dict[str, str | float] = {
        "parameters": ",".join(PARAMETERS),
        "community": "AG",
        "longitude": config.longitude,
        "latitude": config.latitude,
        "start": config.start.strftime("%Y%m%d"),
        "end": config.end.strftime("%Y%m%d"),
        "format": "JSON",
        "time-standard": "UTC",
    }
    if raw_path.exists():
        payload = json.loads(raw_path.read_text())
        request_url = POWER_URL
    else:
        response = client.get(POWER_URL, params=params, timeout=120)
        response.raise_for_status()
        payload = response.json()
        atomic_json(raw_path, payload)
        request_url = str(response.request.url)
    parsed = parse_power(
        payload,
        latitude=config.latitude,
        longitude=config.longitude,
        start=config.start,
        end=config.end,
    )
    atomic_json(parsed_path, parsed)
    manifest.add(
        {
            "key": "power-daily",
            "provider": "NASA POWER",
            "product": "Temporal Daily Point",
            "url": request_url,
            "start": config.start.isoformat(),
            "end": config.end.isoformat(),
            "path": str(raw_path),
            "content_sha256": parsed["content_sha256"],
            "complete_days": parsed["complete_days"],
            "expected_days": parsed["expected_days"],
        }
    )
    return parsed
