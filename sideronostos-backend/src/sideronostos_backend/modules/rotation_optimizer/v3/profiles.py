"""Server-owned regional releases for the daily model; v2 releases are unchanged.

All executable leaves have a unit and source. A grouped origin supplies provenance
for its descendants; more specific origins override it. Values are never duplicated
in a separate provenance table, so an audit cannot silently describe another value.
"""

import hashlib
import json
import math
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, model_validator

from ..schemas import Contract
from .contracts import Canopy, Fraction, Nonnegative, Number, ObjectiveWeights, Phenology, Positive
from .model import METRICS, Metric
from .readiness import EvidenceSource, RecordedValue

ROOT = Path(__file__).parent / "data" / "profiles"
Key = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]


class SoilLimits(Contract):
    ph_min: Annotated[float, Field(strict=True, ge=0, le=14)]
    ph_max: Annotated[float, Field(strict=True, ge=0, le=14)]
    min_depth_m: Positive
    max_salinity_ds_m: Nonnegative
    allowed_drainage: list[Literal["poor", "moderate", "well"]] = Field(min_length=1)
    max_slope_deg: Annotated[float, Field(strict=True, ge=0, le=90)]

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.ph_min > self.ph_max or len(set(self.allowed_drainage)) != len(
            self.allowed_drainage
        ):
            raise ValueError("Invalid soil suitability rules")
        return self


class ClimateRules(Contract):
    heat_c: Number
    frost_c: Number
    excess_rain_mm: Positive
    max_heat_fraction: Fraction
    max_frost_fraction: Fraction
    max_excess_fraction: Fraction
    min_daylight_h: Annotated[float, Field(strict=True, ge=0, le=24)]
    max_daylight_h: Annotated[float, Field(strict=True, ge=0, le=24)]

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.frost_c >= self.heat_c or self.min_daylight_h > self.max_daylight_h:
            raise ValueError("Invalid climate thresholds")
        return self


class SoilComponents(Contract):
    nitrogen: Fraction
    organic_matter: Fraction
    roots: Fraction
    erosion: Fraction


class SoilWeights(SoilComponents):
    @model_validator(mode="after")
    def normalized(self) -> Self:
        if not math.isclose(sum(self.model_dump().values()), 1, abs_tol=1e-9):
            raise ValueError("Soil component weights must sum to one")
        return self


class RiskWeights(Contract):
    heat: Fraction
    frost: Fraction
    irrigation_dependence: Fraction
    excess_rain: Fraction

    @model_validator(mode="after")
    def normalized(self) -> Self:
        if not math.isclose(sum(self.model_dump().values()), 1, abs_tol=1e-9):
            raise ValueError("Risk component weights must sum to one")
        return self


class Economics(Contract):
    price_usd_kg: Nonnegative
    cost_usd_ha: Nonnegative


class Operation(Contract):
    machine: Key
    anchor: Literal["sow", "harvest"]
    offset_days: int = Field(strict=True, ge=0, le=365)
    hours_ha: Positive


class CropProfile(Contract):
    name: str = Field(min_length=1, max_length=150)
    species_id: Key
    family: Key
    sow_windows: list[tuple[str, str]] = Field(min_length=1, max_length=12)
    phenology: Phenology
    canopy: Canopy
    soil: SoilLimits
    climate: ClimateRules
    seed_kg_ha: Positive
    yield_kg_ha: Positive
    economics: Economics | None
    soil_components: SoilComponents | None
    soil_weights: SoilWeights | None
    risk_weights: RiskWeights | None
    operations: list[Operation] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def coherent(self) -> Self:
        previous = ""
        for first, last in self.sow_windows:
            for item in (first, last):
                parsed = date.fromisoformat("2001-" + item)
                if parsed.strftime("%m-%d") != item:
                    raise ValueError("Sowing dates must use canonical MM-DD")
            if first > last or first <= previous:
                raise ValueError("Split cross-year windows into ordered, nonoverlapping segments")
            previous = last
        if (self.soil_components is None) != (self.soil_weights is None):
            raise ValueError("Soil score needs both component values and weights")
        if self.canopy.residue_cover_days > self.phenology.turnaround_days:
            raise ValueError("Residue cover cannot extend beyond declared occupancy")
        if any(
            op.anchor == "harvest" and op.offset_days > self.phenology.turnaround_days
            for op in self.operations
        ):
            raise ValueError("Postharvest operation must fit the turnaround period")
        return self


class HistoryIdentity(Contract):
    species_id: Key
    family: Key
    turnaround_days: int = Field(strict=True, ge=0, le=365)


class ProfileV3(Contract):
    id: Key
    name: str = Field(min_length=1, max_length=200)
    scope: Literal["benchmark_not_locally_calibrated", "locally_calibrated"]
    region_id: Key
    region: str
    timezone: str
    weather_day_policy: Literal["utc_daily_proxy_v1", "require_local_daily"]
    weather_release_id: Key
    weather_center: tuple[Number, Number]  # longitude, latitude
    weather_radius_km: Annotated[float, Field(strict=True, gt=0, le=100)]
    crops: dict[Key, CropProfile] = Field(min_length=1, max_length=20)
    history_catalogue: dict[Key, HistoryIdentity] = Field(min_length=1, max_length=100)
    compatible_history_profile_ids: list[Key] = Field(max_length=30)
    family_gaps: dict[Key, Annotated[int, Field(strict=True, ge=0, le=7300)]]
    sowing_step_days: int = Field(strict=True, ge=1, le=30)
    default_weights: ObjectiveWeights
    scales: dict[Metric, Positive]
    transition_scores: dict[Key, dict[Key, Number]] | None
    parameter_origins: dict[str, list[Key]]
    sources: dict[Key, EvidenceSource]
    limitations: list[str] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def coherent(self) -> Self:
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("Unknown agricultural timezone") from error
        lon, lat = self.weather_center
        if not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Invalid weather coordinates")
        if set(self.scales) != set(METRICS):
            raise ValueError("Published profile must declare six positive reference scales")
        for crop_id, crop in self.crops.items():
            historic = self.history_catalogue.get(crop_id)
            if (
                historic is None
                or historic.species_id != crop.species_id
                or historic.family != crop.family
            ):
                raise ValueError("Crop identity differs from the history catalogue")
        if not {h.family for h in self.history_catalogue.values()} <= self.family_gaps.keys():
            raise ValueError("History family has no minimum interval")
        if self.transition_scores is not None:
            if set(self.transition_scores) != set(self.crops) or any(
                set(scores)
                != {b for b, c in self.crops.items() if c.species_id != self.crops[a].species_id}
                for a, scores in self.transition_scores.items()
            ):
                raise ValueError("Transition scores must cover all distinct-species crop pairs")
        if self.scope == "locally_calibrated" and any(
            s.kind == "engineering_assumption" for s in self.sources.values()
        ):
            raise ValueError("Engineering assumptions cannot be labelled locally calibrated")
        if any(s.id != key for key, s in self.sources.items()):
            raise ValueError("Source identity mismatch")
        if self.scope == "locally_calibrated" and self.weather_day_policy != "require_local_daily":
            raise ValueError("Calibrated profile requires local agricultural daily weather")
        parameter_records(self)  # fail publication before consumers can use unsourced values
        return self


def _leaves(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        return {
            path: leaf
            for key, item in value.items()
            for path, leaf in _leaves(item, f"{prefix}.{key}".lstrip(".")).items()
        }
    if isinstance(value, (list, tuple)):
        return {
            path: leaf
            for i, item in enumerate(value)
            for path, leaf in _leaves(item, f"{prefix}.{i}").items()
        }
    return {} if value is None else {prefix: value}


def parameter_records(profile: ProfileV3) -> dict[str, RecordedValue]:
    payload = profile.model_dump(
        exclude={
            "id",
            "name",
            "scope",
            "region_id",
            "region",
            "timezone",
            "weather_release_id",
            "sources",
            "parameter_origins",
            "limitations",
        }
    )
    leaves = {k: v for k, v in _leaves(payload).items() if not k.endswith(".name")}
    for prefix, origins in profile.parameter_origins.items():
        if (
            not origins
            or not set(origins) <= profile.sources.keys()
            or not any(p == prefix or p.startswith(prefix + ".") for p in leaves)
        ):
            raise ValueError("Unknown parameter or source in profile origins")
    units = {
        "base_c": "degC",
        "upper_c": "degC",
        "heat_c": "degC",
        "frost_c": "degC",
        "maturity_gdd": "degC day",
        "root_initial_m": "m",
        "root_max_m": "m",
        "min_depth_m": "m",
        "max_salinity_ds_m": "dS/m",
        "max_slope_deg": "degree",
        "excess_rain_mm": "mm/day",
        "min_daylight_h": "hour",
        "max_daylight_h": "hour",
        "seed_kg_ha": "kg/ha",
        "yield_kg_ha": "kg/ha",
        "price_usd_kg": "USD/kg",
        "cost_usd_ha": "USD/ha",
        "hours_ha": "h/ha",
        "weather_radius_km": "km",
        "ph_min": "pH",
        "ph_max": "pH",
    }
    scale_units = {
        "profit": "USD",
        "water": "m3",
        "rotation": "score",
        "soil": "score ha",
        "risk": "score ha",
        "bare": "ha day",
    }
    records = {}
    for path, value in leaves.items():
        prefixes = [
            key for key in profile.parameter_origins if path == key or path.startswith(key + ".")
        ]
        if not prefixes:
            raise ValueError(f"Missing parameter source: {path}")
        key = path.split(".")[-1]
        unit = units.get(key, "1")
        if key.endswith("_days") or path.startswith("family_gaps."):
            unit = "day"
        if path.startswith("weather_center."):
            unit = "degree"
        if path.startswith("scales."):
            unit = scale_units[key]
        if ".sow_windows." in path:
            unit = "MM-DD"
        if isinstance(value, str) and unit == "1":
            unit = "category"
        records[path] = RecordedValue(
            value=value, unit=unit, source_ids=profile.parameter_origins[max(prefixes, key=len)]
        )
    return records


def get_profile(identifier: str) -> ProfileV3:
    paths = {path.stem: path for path in ROOT.glob("*.json")}
    if identifier not in paths:
        raise ValueError("Unknown daily rotation profile release")
    profile = ProfileV3.model_validate_json(paths[identifier].read_text())
    if profile.id != identifier:
        raise ValueError("Profile release filename and identity differ")
    return profile


def profile_hash(profile: ProfileV3) -> str:
    return hashlib.sha256(
        json.dumps(profile.model_dump(mode="json"), sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def list_profiles() -> list[dict[str, Any]]:
    return [
        {
            **p.model_dump(mode="json"),
            "sha256": profile_hash(p),
            "parameter_records": {
                k: v.model_dump(mode="json") for k, v in parameter_records(p).items()
            },
        }
        for path in sorted(ROOT.glob("*.json"))
        for p in [get_profile(path.stem)]
    ]
