"""Versioned server-owned agronomy; benchmark assumptions stay visible in every run."""

import hashlib
import json
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, HttpUrl, model_validator

from .schemas import Contract, CropV2, References, Weights

ROOT = Path(__file__).parent / "data" / "profiles"


class ParameterSource(Contract):
    kind: Literal["reference", "benchmark_assumption"]
    title: str
    url: HttpUrl | None = None
    applicability: str
    limitations: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def cited_reference(self) -> Self:
        if self.kind == "reference" and self.url is None:
            raise ValueError("A reference source needs a URL")
        return self


class ProfileV2(Contract):
    id: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    name: str
    scope: Literal["benchmark_not_locally_calibrated"]
    region: str
    weather_release_id: str
    weather_center: tuple[float, float]
    weather_radius_km: float = Field(gt=0, le=100)
    crops: list[CropV2] = Field(min_length=1, max_length=20)
    history_catalogue: dict[str, str]
    history_turnaround_days: int = Field(ge=0, le=365)
    family_gaps: dict[str, int]
    sowing_step_days: int = Field(ge=1, le=30)
    effective_rain_fraction: float = Field(ge=0, le=1)
    default_weights: Weights
    references: References
    parameter_origins: dict[str, str]
    sources: dict[str, ParameterSource]
    limitations: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def references_resolve(self) -> Self:
        ids = {crop.id for crop in self.crops}
        if len(ids) != len(self.crops):
            raise ValueError("Duplicate crop IDs")
        required = {
            "family_gaps",
            "sowing_step_days",
            "effective_rain_fraction",
            "references",
            "default_weights",
            "weather_radius_km",
            "history_catalogue",
            "history_turnaround_days",
        }
        if not required <= self.parameter_origins.keys():
            raise ValueError("Every profile parameter requires a source")
        origins = set(self.parameter_origins.values())
        for crop in self.crops:
            origins.update(crop.parameter_origins.values())
            if self.history_catalogue.get(crop.id) != crop.family:
                raise ValueError("Crop family differs from the history catalogue")
        if not origins <= self.sources.keys():
            raise ValueError("An executable parameter refers to an unknown source")
        if any(days < 0 or days > 1095 for days in self.family_gaps.values()):
            raise ValueError("Family gaps exceed supported limits")
        if not set(self.history_catalogue.values()) <= self.family_gaps.keys():
            raise ValueError("History family has no interval rule")
        return self


def get_profile(identifier: str) -> ProfileV2:
    paths = {path.stem: path for path in ROOT.glob("*.json")}
    if identifier not in paths:
        raise ValueError("Unknown rotation profile release")
    return ProfileV2.model_validate_json(paths[identifier].read_text())


def profile_hash(profile: ProfileV2) -> str:
    return hashlib.sha256(
        json.dumps(profile.model_dump(mode="json"), sort_keys=True).encode()
    ).hexdigest()


def list_profiles() -> list[dict[str, object]]:
    result = []
    for path in sorted(ROOT.glob("*.json")):
        profile = get_profile(path.stem)
        result.append({**profile.model_dump(mode="json"), "sha256": profile_hash(profile)})
    return result
