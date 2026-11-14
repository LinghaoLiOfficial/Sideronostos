"""Synthetic benchmark AOI generation in an area-preserving local CRS."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import Polygon, mapping, shape  # type: ignore[import-untyped]
from shapely.ops import transform  # type: ignore[import-untyped]

LOCAL_CRS = "EPSG:26915"
WGS84 = "EPSG:4326"


def generate_fields(longitude: float = -93.5, latitude: float = 42.0) -> dict[str, Any]:
    to_local = Transformer.from_crs(WGS84, LOCAL_CRS, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(LOCAL_CRS, WGS84, always_xy=True).transform
    cx, cy = to_local(longitude, latitude)
    width, height, gap = 800.0, 400.0, 20.0
    features = []
    for row in range(2):
        for column in range(2):
            x0 = cx + (column - 1) * (width + gap / 2) + gap / 2
            y0 = cy + (row - 1) * (height + gap / 2) + gap / 2
            polygon = Polygon(
                [(x0, y0), (x0 + width, y0), (x0 + width, y0 + height), (x0, y0 + height)]
            )
            identifier = f"field-{row * 2 + column + 1}"
            features.append(
                {
                    "type": "Feature",
                    "id": identifier,
                    "properties": {
                        "field_id": identifier,
                        "area_ha": polygon.area / 10_000,
                        "synthetic": True,
                        "purpose": "Iowa engineering benchmark; not a cadastral boundary",
                    },
                    "geometry": mapping(transform(to_wgs84, polygon)),
                }
            )
    result = {
        "type": "FeatureCollection",
        "name": "synthetic-iowa-four-fields",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }
    validate_fields(result)
    return result


def validate_fields(collection: dict[str, Any]) -> None:
    features = collection.get("features", [])
    if len(features) != 4:
        raise ValueError("AOI must contain four fields")
    to_local = Transformer.from_crs(WGS84, LOCAL_CRS, always_xy=True).transform
    polygons = [shape(feature["geometry"]) for feature in features]
    if any(not polygon.is_valid or polygon.is_empty for polygon in polygons):
        raise ValueError("AOI contains invalid geometry")
    if any(polygons[i].intersection(polygons[j]).area > 1e-12 for i in range(4) for j in range(i)):
        raise ValueError("AOI fields overlap")
    for polygon in polygons:
        area = transform(to_local, polygon).area / 10_000
        if not 31.9 <= area <= 32.1:
            raise ValueError(f"Unexpected field area: {area}")


def write_fields(path: Path, *, longitude: float = -93.5, latitude: float = 42.0) -> dict[str, Any]:
    payload = generate_fields(longitude, latitude)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return payload
