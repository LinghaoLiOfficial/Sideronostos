"""Live coverage/service audit and conservative download planning."""

from __future__ import annotations

from typing import Any

import httpx

from .appeears import API, PRODUCT_LAYERS
from .budget import StorageBudget
from .cmr import COLLECTIONS, CMRClient, granule_size
from .config import PipelineConfig
from .manifest import atomic_json


def audit(config: PipelineConfig) -> dict[str, Any]:
    cmr = CMRClient()
    products: dict[str, Any] = {}
    for key in ("gpm", "smap", "hlsl30", "hlss30", "ecostress_lst_v2", "ecostress_et_v2"):
        result = cmr.granules(
            COLLECTIONS[key], start=config.start, end=config.end, bbox=config.bbox, page_size=2000
        )
        products[key] = {
            "collection_id": COLLECTIONS[key].concept_id,
            "short_name": COLLECTIONS[key].short_name,
            "version": COLLECTIONS[key].version,
            "hits": result["hits"],
            "returned": len(result["items"]),
            "reported_full_granule_bytes": sum(granule_size(item) or 0 for item in result["items"]),
            "query_url": result["query_url"],
        }
    for key in ("srtm", "grace"):
        result = cmr.granules(
            COLLECTIONS[key],
            start=config.start if key == "grace" else None,
            end=config.end if key == "grace" else None,
            bbox=config.bbox if key == "srtm" else None,
            page_size=100,
        )
        products[key] = {
            "collection_id": COLLECTIONS[key].concept_id,
            "short_name": COLLECTIONS[key].short_name,
            "version": COLLECTIONS[key].version,
            "hits": result["hits"],
            "returned": len(result["items"]),
            "reported_full_granule_bytes": sum(granule_size(item) or 0 for item in result["items"]),
            "query_url": result["query_url"],
        }
    public_products = httpx.get(f"{API}/product", timeout=60).json()
    rows = public_products if isinstance(public_products, list) else public_products.get("data", [])
    supported = {str(row.get("ProductAndVersion")) for row in rows}
    required = sorted({layer["product"] for layers in PRODUCT_LAYERS.values() for layer in layers})
    payload = {
        "schema": "sideronostos-nasa-availability-v1",
        "window": {
            "start": config.start.isoformat(),
            "end": config.end.isoformat(),
            "days": config.expected_days,
        },
        "bbox": list(config.bbox),
        "products": products,
        "appeears": {
            "required_products": required,
            "supported": {name: name in supported for name in required},
        },
        "requirements": {
            "power": "1096 complete daily records required at fetch/prepare time",
            "gpm": {"expected_daily_granules": config.expected_days, "hard_required": True},
            "smap": "monthly valid rate >= 70%; otherwise missing",
            "hls": "at least one Fmask-valid observation per month; gaps are reported",
            "ecostress": "sparse validation only; no continuity requirement; V002 only",
            "grace": "missing months remain missing; no extrapolation",
            "srtm": "static",
        },
    }
    atomic_json(config.root / "audit" / "availability.json", payload)
    if products["gpm"]["hits"] != config.expected_days:
        raise RuntimeError("GPM Final Daily does not completely cover the configured window")
    if not all(name in supported for name in required):
        raise RuntimeError("One or more required AppEEARS products are unavailable")
    return payload


def plan(
    config: PipelineConfig, budget: StorageBudget, availability: dict[str, Any]
) -> dict[str, Any]:
    reservations = dict(config.product_budgets)
    budget.check(additional_bytes=0)
    static_sizes = {
        key: int(availability["products"][key]["reported_full_granule_bytes"])
        for key in ("srtm", "grace")
    }
    for key, size in static_sizes.items():
        budget.check(additional_bytes=size, product=key)
    payload = {
        "schema": "sideronostos-nasa-download-plan-v1",
        "window": [config.start.isoformat(), config.end.isoformat()],
        "strategy": {
            "power": "point JSON",
            "gpm": "1096 OPeNDAP AOI precipitation subsets; never global granules",
            "smap": "four AppEEARS centroid point series",
            "hls": "AppEEARS AOI band/Fmask subsets",
            "ecostress": "AppEEARS AOI V002 sparse scenes",
            "srtm": "approximately two full tiles, then AOI crop",
            "grace": "one global Mascon NetCDF",
        },
        "product_budget_bytes": reservations,
        "hard_limit_bytes": config.hard_limit_bytes,
        "minimum_free_bytes": config.min_free_bytes,
        "known_static_download_bytes": static_sizes,
        "unknown_bundle_policy": (
            "AppEEARS bundle inventory is checked before any bundle file download"
        ),
    }
    atomic_json(config.root / "audit" / "download-plan.json", payload)
    return payload
