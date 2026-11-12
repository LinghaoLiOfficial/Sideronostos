import math
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pyproj import Geod
from shapely.geometry import Polygon  # type: ignore[import-untyped]

GEOD = Geod(ellps="WGS84")
MAX_AREA_HA = 50_000_000


def _position(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("Use [longitude, latitude] coordinates")
    if any(
        isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
        for v in value
    ):
        raise ValueError("Coordinates must be finite numbers")
    longitude, latitude = map(float, value)
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError("Coordinates are outside longitude/latitude bounds")
    return [longitude, latitude]


def validate_geometry(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"type", "coordinates"}:
        raise ValueError("Provide a GeoJSON Point or single-ring Polygon")
    if value["type"] == "Point":
        center = _position(value["coordinates"])
        return {
            "geometry": {"type": "Point", "coordinates": center},
            "center": center,
            "area_ha": None,
        }
    if value["type"] != "Polygon":
        raise ValueError("Only Point and Polygon are supported")
    rings = value["coordinates"]
    if (
        not isinstance(rings, list)
        or len(rings) != 1
        or not isinstance(rings[0], list)
        or not 4 <= len(rings[0]) <= 201
    ):
        raise ValueError("Use one closed ring with at most 200 vertices")
    ring = [_position(point) for point in rings[0]]
    if ring[0] != ring[-1]:
        raise ValueError("Polygon ring must be explicitly closed")
    if max(p[0] for p in ring) - min(p[0] for p in ring) > 180:
        raise ValueError("Split selections that cross the antimeridian")
    polygon = Polygon(ring)
    if not polygon.is_valid or polygon.is_empty or polygon.area == 0:
        raise ValueError("Polygon must have a valid non-intersecting area")
    area, _ = GEOD.geometry_area_perimeter(polygon)
    hectares = abs(area) / 10000
    if not 0 < hectares <= MAX_AREA_HA:
        raise ValueError("Selected area exceeds the supported regional extent")
    center = polygon.representative_point()
    return {
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "center": [center.x, center.y],
        "area_ha": hectares,
    }


class SelectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["point", "polygon", "viewport"]
    revision: int = Field(strict=True, ge=1, le=1_000_000)
    geometry: dict[str, Any]

    @model_validator(mode="after")
    def geometry_matches_kind(self) -> Self:
        normalized = validate_geometry(self.geometry)
        expected = "Point" if self.kind == "point" else "Polygon"
        if normalized["geometry"]["type"] != expected:
            raise ValueError("Selection kind does not match its geometry")
        self.geometry = normalized["geometry"]
        return self
