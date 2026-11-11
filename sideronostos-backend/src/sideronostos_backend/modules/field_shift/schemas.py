"""Validated, serializable Field Shift contracts shared by API and decision engine."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from pydantic import Field as PydField

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
SoilTexture = Literal["unknown", "sand", "loam", "clay"]
NonNegative = Annotated[float, PydField(ge=0)]
Year = Annotated[int, PydField(strict=True, ge=1900, le=2200)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, from_attributes=True)


class Evidence(Contract):
    id: Identifier
    title: str
    url: str | None = None
    kind: Literal["rule", "observation", "estimate", "farmer_input", "demonstration"]
    detail: str


class Crop(Contract):
    id: Identifier
    name: Name
    family: Name
    sow_month: int = PydField(ge=1, le=12)
    sow_day: int = PydField(ge=1, le=31)
    duration_days: int = PydField(ge=1, le=366)
    kc: float = PydField(gt=0, le=2)
    estimated_cost_usd_ha: NonNegative
    estimated_labor_days_ha: NonNegative
    allowed_soils: list[Literal["sand", "loam", "clay"]] = PydField(min_length=1)
    source_ids: list[Identifier] = PydField(min_length=1)


class Rule(Contract):
    id: Identifier
    name: Name
    description: str
    kind: str
    parameters: dict[str, Any]


class Profile(Contract):
    id: Identifier
    name: Name
    version: str
    is_demo: bool
    description: str
    assumptions: list[str]
    crops: list[Crop] = PydField(min_length=1, max_length=15)
    rules: list[Rule]
    sources: list[Evidence]

    @model_validator(mode="after")
    def consistent_catalogue(self) -> "Profile":
        for records in (self.crops, self.rules, self.sources):
            ids = [record.id for record in records]
            if len(ids) != len(set(ids)):
                raise ValueError("Profile identifiers must be unique")
        known_sources = {s.id for s in self.sources}
        if any(not set(c.source_ids) <= known_sources for c in self.crops):
            raise ValueError("Crop source identifiers must exist in profile sources")
        return self


class HistoryEntry(Contract):
    year: Year
    crop_id: Identifier


class FieldInput(Contract):
    name: Name
    area_ha: float = PydField(gt=0, le=100000)
    latitude: float = PydField(ge=-90, le=90)
    longitude: float = PydField(ge=-180, le=180)
    soil_texture: SoilTexture
    irrigation_available: bool
    profile_id: Identifier
    history: list[HistoryEntry] = PydField(max_length=100)

    @model_validator(mode="after")
    def unique_history_years(self) -> "FieldInput":
        years = [entry.year for entry in self.history]
        if len(years) != len(set(years)):
            raise ValueError("Planting history must have unique years")
        return self


class Field(FieldInput):
    id: str
    version: int = PydField(ge=1)
    created_at: datetime
    updated_at: datetime


class EnvironmentMonth(Contract):
    month: int = PydField(ge=1, le=12)
    rainfall_mm: NonNegative | None
    tmin_c: float | None
    tmax_c: float | None
    reference_et_mm: NonNegative | None
    valid_days: int = PydField(ge=0, le=31)
    expected_days: int = PydField(ge=1, le=31)


class Environment(Contract):
    status: Literal["live", "cached", "demo", "unavailable"]
    source_name: str
    source_url: str | None
    reference_year: Year
    fetched_at: datetime | None
    spatial_resolution: str
    months: list[EnvironmentMonth]
    limitations: list[str]
    evidence: list[Evidence]
    fingerprint: str


class Weights(Contract):
    water: float = PydField(ge=0, le=5)
    cover: float = PydField(ge=0, le=5)
    diversity: float = PydField(ge=0, le=5)
    cost: float = PydField(ge=0, le=5)

    @model_validator(mode="after")
    def nonzero_weights(self) -> "Weights":
        if self.water + self.cover + self.diversity + self.cost <= 0:
            raise ValueError("At least one priority weight must be positive")
        return self


class Scenario(Contract):
    rainfall_change_pct: float = PydField(ge=-50, le=50)
    temperature_change_c: float = PydField(ge=-3, le=5)


class PlanningInputs(Contract):
    start_year: int = PydField(strict=True, ge=2000, le=2198)
    baseline_crop_ids: list[Identifier] = PydField(min_length=3, max_length=3)
    allowed_crop_ids: list[Identifier] = PydField(min_length=1, max_length=15)
    max_irrigation_mm: NonNegative
    max_cost_usd_ha: NonNegative
    max_labor_days_ha: NonNegative
    weights: Weights
    scenario: Scenario
    accept_demo_assumptions: bool

    @model_validator(mode="after")
    def unique_allowed_crops(self) -> "PlanningInputs":
        if len(self.allowed_crop_ids) != len(set(self.allowed_crop_ids)):
            raise ValueError("Allowed crop identifiers must be unique")
        return self


class PlanSeason(Contract):
    year: Year
    crop_id: str
    crop_name: str
    family: str
    sow_date: date
    harvest_date: date
    water_demand_mm: NonNegative
    irrigation_gap_mm: NonNegative
    cover_days: int = PydField(ge=0)
    cost_usd_ha: NonNegative
    labor_days_ha: NonNegative


class PlanMetrics(Contract):
    irrigation_gap_mm: NonNegative
    water_demand_mm: NonNegative
    cover_days: int = PydField(ge=0)
    diversity: int = PydField(ge=1, le=3)
    cost_usd_ha: NonNegative
    labor_days_ha: NonNegative


class Violation(Contract):
    rule_id: str
    message: str


class RotationOption(Contract):
    id: str
    label: str
    is_baseline: bool
    feasible: bool
    seasons: list[PlanSeason]
    metrics: PlanMetrics
    reasons: list[str]
    violations: list[Violation]
    evidence: list[Evidence]


class RejectionSummary(Contract):
    rule_id: str
    message: str
    count: int = PydField(ge=0)


class EngineResult(Contract):
    baseline: RotationOption
    alternatives: list[RotationOption]
    feasible_count: int = PydField(ge=0)
    rejected_count: int = PydField(ge=0)
    rejection_summary: list[RejectionSummary]
    limitations: list[str]
    elapsed_ms: NonNegative


class ProfileSummary(Contract):
    id: str
    name: str
    version: str
    is_demo: bool


class Analysis(EngineResult):
    id: str
    field_id: str
    field_version: int
    created_at: datetime
    profile: ProfileSummary
    profile_snapshot: Profile
    inputs: PlanningInputs
    environment: Environment


class SavedPlan(Contract):
    id: str
    title: Name
    notes: str
    created_at: datetime
    field_id: str
    field_name: str
    option: RotationOption
    analysis: Analysis
    field_snapshot: Field
