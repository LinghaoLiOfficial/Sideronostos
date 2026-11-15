import math
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pyproj import Geod
from shapely.geometry import Polygon  # type: ignore[import-untyped]
from shapely.geometry.polygon import orient  # type: ignore[import-untyped]

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


def validate_geometry(value: Any, *, allow_holes: bool = False) -> dict[str, Any]:
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
    max_rings, max_vertices = (20, 2000) if allow_holes else (1, 201)
    if not isinstance(rings, list) or not 1 <= len(rings) <= max_rings:
        raise ValueError(f"Use between one and {max_rings} polygon rings")
    if any(not isinstance(ring, list) or len(ring) < 4 for ring in rings):
        raise ValueError("Each polygon ring needs at least three vertices and closure")
    if sum(len(ring) for ring in rings) > max_vertices:
        raise ValueError(f"Polygon exceeds {max_vertices} coordinate positions")
    normalized = [[_position(point) for point in ring] for ring in rings]
    if any(ring[0] != ring[-1] for ring in normalized):
        raise ValueError("Polygon ring must be explicitly closed")
    longitudes = [point[0] for ring in normalized for point in ring]
    if max(longitudes) - min(longitudes) > 180:
        raise ValueError("Split selections that cross the antimeridian")
    polygon = Polygon(normalized[0], normalized[1:])
    if not polygon.is_valid or polygon.is_empty or polygon.area == 0:
        raise ValueError("Polygon must have a valid non-intersecting area")
    area, _ = GEOD.geometry_area_perimeter(orient(polygon, sign=1.0))
    hectares = abs(area) / 10000
    if not 0 < hectares <= MAX_AREA_HA:
        raise ValueError("Selected area exceeds the supported regional extent")
    center = polygon.representative_point()
    return {
        "geometry": {"type": "Polygon", "coordinates": normalized},
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
