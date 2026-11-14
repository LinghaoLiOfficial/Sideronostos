"""Offline publication and validation for acquired NASA benchmark bundles."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
from datetime import date, timedelta
from pathlib import Path
from typing import Any

NASA_BUNDLE_PRODUCT = "NASA_ROTATION_BUNDLE"
CORE_PRODUCTS = ("power", "gpm", "srtm")
EVIDENCE_PRODUCTS = ("smap", "hls", "ecostress", "grace")


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _daily_weather(source: Path, start: date, end: date) -> list[dict[str, Any]]:
    power_path = source / "processed" / "power-daily.csv"
    gpm_path = source / "processed" / "gpm-daily-aoi.csv"
    srtm_path = source / "processed" / "srtm-summary.json"
    if not all(path.is_file() for path in (power_path, gpm_path, srtm_path)):
        raise ValueError("POWER, GPM and SRTM prepared inputs are required")
    rain: dict[date, list[float]] = {}
    with gpm_path.open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("rain_mm"):
                rain.setdefault(date.fromisoformat(row["date"]), []).append(float(row["rain_mm"]))
    numeric = (
        "tmin_c",
        "tmax_c",
        "tdew_c",
        "wind_2m_ms",
        "pressure_kpa",
        "shortwave",
        "et0_mm",
    )
    rows: dict[date, dict[str, Any]] = {}
    with power_path.open(newline="") as stream:
        for row in csv.DictReader(stream):
            day = date.fromisoformat(row["date"])
            values = rain.get(day, [])
            rows[day] = {
                "date": day.isoformat(),
                **{name: float(row[name]) if row.get(name) else None for name in numeric},
                "rain_mm": sum(values) / len(values) if values else None,
                "weather_basis": "observed_historical",
                "temperature_source": "NASA POWER Temporal Daily Point",
                "rainfall_source": "GPM_3IMERGDF.07 AOI mean",
                "et0_recipe": "fao56-daily-dewpoint-v1 with SRTM mean elevation",
            }
    expected = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    required = (*numeric, "rain_mm")
    missing = [
        day.isoformat()
        for day in expected
        if day not in rows or any(rows[day].get(name) is None for name in required)
    ]
    if missing:
        raise ValueError(f"Core NASA daily inputs are incomplete; first missing day: {missing[0]}")
    return [rows[day] for day in expected]


def build_nasa_release(source: Path) -> tuple[dict[str, Any], dict[str, Path]]:
    config = json.loads((source / "config.json").read_text())
    start, end = date.fromisoformat(config["start"]), date.fromisoformat(config["end"])
    layer_manifest_path = source / "layers" / "layer-manifest.json"
    layer_manifest = json.loads(layer_manifest_path.read_text())
    daily = _daily_weather(source, start, end)
    power_json = json.loads((source / "processed" / "power-daily.json").read_text())
    srtm = json.loads((source / "processed" / "srtm-summary.json").read_text())
    assets: dict[str, Path] = {}
    layers: list[dict[str, Any]] = []
    for record in layer_manifest.get("layers", []):
        path = Path(record["path"])
        if not path.is_file():
            continue
        name = f"layers/{path.name}"
        assets[name] = path
        import numpy as np
        import rasterio  # type: ignore[import-untyped]

        with rasterio.open(path) as dataset:
            values = dataset.read(1, masked=True).compressed()
        display_min, display_max = (
            (float(np.percentile(values, 2)), float(np.percentile(values, 98)))
            if values.size
            else (0.0, 1.0)
        )
        if display_max <= display_min:
            display_max = display_min + 1.0
        layers.append(
            {
                **{key: value for key, value in record.items() if key != "path"},
                "asset": name,
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
                "unit": record.get("units", record.get("unit", "unknown")),
                "display_min": display_min,
                "display_max": display_max,
                "spatial_support": record.get(
                    "native_resolution", "native product information scale"
                ),
            }
        )
    raw_assets = {
        "processed/power-daily.csv": source / "processed" / "power-daily.csv",
        "processed/gpm-daily-aoi.csv": source / "processed" / "gpm-daily-aoi.csv",
    }
    assets.update(raw_assets)
    products = {
        "power": {
            "model_usable": True,
            "expected_days": len(daily),
            "valid_days": len(daily),
            "product_version": "NASA POWER Daily API",
            "variables": [
                "T2M_MIN",
                "T2M_MAX",
                "T2MDEW",
                "WS2M",
                "PS",
                "ALLSKY_SFC_SW_DWN",
            ],
            "qa": "All required variables finite for every UTC calendar day",
            "official_url": "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
        },
        "gpm": {
            "model_usable": True,
            "expected_days": len(daily),
            "valid_days": len(daily),
            "product_version": "GPM IMERG Final Daily V07",
            "variables": ["precipitation"],
            "qa": "Final Daily; finite nonnegative AOI cells; daily AOI mean",
            "native_resolution": "0.1 degree",
            "official_url": "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary",
        },
        "srtm": {
            "model_usable": True,
            "mean_elevation_m": srtm["mean_elevation_m"],
            "product_version": "SRTMGL1.003",
            "variables": ["elevation", "slope", "aspect"],
            "qa": "Valid elevation cells clipped to the release AOI",
            "native_resolution": "1 arc-second",
            "official_url": "https://lpdaac.usgs.gov/products/srtmgl1v003/",
        },
    }
    availability = layer_manifest.get("availability", {})
    for product in EVIDENCE_PRODUCTS:
        products[product] = {
            "model_usable": False,
            "evidence_only": True,
            "availability": availability.get(product, "available_if_listed_in_layers"),
            "qa": "See per-layer QA and availability; missing observations remain missing",
        }
    manifest = {
        "schema": "sideronostos-nasa-rotation-release-v1",
        "product": NASA_BUNDLE_PRODUCT,
        "recipe": "power-gpm-srtm-historical-benchmark-v1",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_standard": "UTC",
        "bounds": config["bbox"],
        "crs": "EPSG:4326",
        "center": [config["longitude"], config["latitude"]],
        "applicability": "iowa_engineering_benchmark_only",
        "data_kind": "observed_historical",
        "source_run_created_at": json.loads((source / "run-manifest.json").read_text()).get(
            "created_at"
        )
        if (source / "run-manifest.json").is_file()
        else None,
        "model_usable": True,
        "complete_days": len(daily),
        "expected_days": (end - start).days + 1,
        "weather": {
            "product": "NASA_POWER_DAILY_WITH_GPM",
            "latitude": power_json["latitude"],
            "longitude": power_json["longitude"],
            "elevation_m": srtm["mean_elevation_m"],
            "units": power_json["units"],
            "days": daily,
        },
        "products": products,
        "layers": layers,
        "evidence_only": list(EVIDENCE_PRODUCTS),
        "limitations": [
            "Historical engineering benchmark; not a future weather forecast.",
            "SMAP, HLS, ECOSTRESS and GRACE are evidence only and do not affect the MILP.",
            "Regional NASA observations do not replace local agronomy or field sensors.",
        ],
        "assets": {
            name: {"size": path.stat().st_size, "sha256": sha256_file(path)}
            for name, path in sorted(assets.items())
        },
    }
    return manifest, assets


def copy_release_assets(assets: dict[str, Path], destination: Path) -> None:
    for name, source in assets.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if sha256_file(target) != sha256_file(source):
                raise ValueError("A different NASA asset exists under this release ID")
            continue
        temporary = target.with_suffix(target.suffix + ".copying")
        shutil.copyfile(source, temporary)
        temporary.replace(target)
