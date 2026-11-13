"""Farmer choices and incomplete evidence-bearing drafts, never MILP coefficients."""

import math
from datetime import date, timedelta
from typing import Annotated, Any, Literal, Self

from pydantic import Field, StrictBool, model_validator

from ..requests import BaselineSeason, Scenario
from ..schemas import Contract
from .contracts import Identifier, ObjectiveWeights
from .model import MAX_FIELDS, Period
from .profiles import Key
from .readiness import EvidenceSource, RecordedValue

OptionalMetric = Literal["profit", "rotation", "soil", "risk"]
FieldParameter = Literal[
    "field_capacity",
    "wilting_point",
    "depth_m",
    "ph",
    "salinity_ds_m",
    "drainage",
    "slope_deg",
    "mechanical_access",
    "effective_rain_fraction",
    "history_reviewed",
    "history_state",
    "history_absence_reason",
    "initial_water_policy",
    "management_reviewed",
    "baseline_confirmed",
]


class FieldChoice(Contract):
    id: Identifier
    expected_version: int = Field(strict=True, ge=1)


class CapacityInput(Contract):
    amount: RecordedValue
    remediable: StrictBool | None = None
    gap_unit_cost: RecordedValue | None = None
    remedy: RecordedValue | None = None


class ResourceCalendar(Contract):
    kind: Literal["water", "machine"]
    machine_type: Key | None = None
    field_ids: list[Identifier] = Field(max_length=MAX_FIELDS)
    water_basis: Literal["net", "gross"] | None = None
    irrigation_efficiency: RecordedValue | None = None
    default: CapacityInput
    overrides: dict[date, RecordedValue] = Field(default_factory=dict, max_length=1096)

    @model_validator(mode="after")
    def consistent_kind(self) -> Self:
        if len(set(self.field_ids)) != len(self.field_ids):
            raise ValueError("Duplicate resource field membership")
        if self.kind == "machine" and (
            self.water_basis is not None or self.irrigation_efficiency is not None
        ):
            raise ValueError("Water conversion cannot be applied to machine hours")
        if self.kind == "water" and self.machine_type is not None:
            raise ValueError("A water system cannot be a machine")
        return self


class PeriodLimitInput(Contract):
    kind: Literal["seed", "market"]
    crop_id: Key
    period_id: Identifier
    limit: CapacityInput


class FarmResources(Contract):
    daily: dict[Key, ResourceCalendar] = Field(default_factory=dict, max_length=100)
    period_limits: list[PeriodLimitInput] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def unique_limits(self) -> Self:
        keys = [(p.kind, p.crop_id, p.period_id) for p in self.period_limits]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate period limit")
        return self


class FieldConditions(Contract):
    values: dict[FieldParameter, RecordedValue] = Field(default_factory=dict)
    forbidden_crop_ids: list[Key] = Field(default_factory=list, max_length=100)
    water_system_id: Key | None = None
    bare_limit: CapacityInput | None = None
    bare_limit_disabled: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unambiguous_bare_limit(self) -> Self:
        if self.bare_limit is not None and self.bare_limit_disabled is not None:
            raise ValueError("Bare cap and a disabled-cap reason are mutually exclusive")
        return self


class PlanningDraft(Contract):
    model_version: Literal["rotation-milp-v3.0"] = "rotation-milp-v3.0"
    profile_id: Key
    fields: list[FieldChoice] = Field(min_length=1, max_length=MAX_FIELDS)
    start: date
    end: date
    allowed_crop_ids: list[Key] = Field(min_length=1, max_length=20)
    periods: list[Period] = Field(min_length=1, max_length=36)
    field_conditions: dict[Identifier, FieldConditions] = Field(
        default_factory=dict, max_length=MAX_FIELDS
    )
    farm_resources: dict[Identifier, FarmResources] = Field(
        default_factory=dict, max_length=MAX_FIELDS
    )
    sources: dict[Key, EvidenceSource] = Field(default_factory=dict, max_length=200)
    baseline: list[BaselineSeason] = Field(default_factory=list, max_length=60)
    weights: ObjectiveWeights | None = None
    disabled_metrics: dict[OptionalMetric, Annotated[str, Field(min_length=1, max_length=1000)]] = (
        Field(default_factory=dict)
    )
    scenario: Scenario = Field(default_factory=Scenario)
    accept_engineering_assumptions: StrictBool = False

    @model_validator(mode="after")
    def bounded(self) -> Self:
        _validate_record_values(self.model_dump())
        if not 0 <= (self.end - self.start).days <= 1095 or not 2000 <= self.start.year <= 2197:
            raise ValueError("Planning horizon must be ordered and at most three years")
        field_ids = {f.id for f in self.fields}
        if len(field_ids) != len(self.fields) or len(set(self.allowed_crop_ids)) != len(
            self.allowed_crop_ids
        ):
            raise ValueError("Duplicate field or crop selection")
        if not set(self.field_conditions) <= field_ids:
            raise ValueError("Operating conditions refer to unselected fields")
        if any(key != source.id for key, source in self.sources.items()):
            raise ValueError("Source identity mismatch")
        if len({p.id for p in self.periods}) != len(self.periods):
            raise ValueError("Duplicate period")
        cursor = self.start
        for period in sorted(self.periods, key=lambda p: p.start):
            if period.start != cursor or period.end < period.start:
                raise ValueError("Periods must cover every planning day without gaps or overlap")
            cursor = period.end + timedelta(days=1)
        if cursor != self.end + timedelta(days=1):
            raise ValueError("Periods must cover the complete planning horizon")
        if any(
            b.field_id not in field_ids
            or b.crop_id not in self.allowed_crop_ids
            or not self.start <= b.sow_date <= self.end
            for b in self.baseline
        ):
            raise ValueError("Baseline must use selected fields/crops and dates within the horizon")
        keys = [(b.field_id, b.crop_id, b.sow_date) for b in self.baseline]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate baseline season")
        for farm in self.farm_resources.values():
            if any(
                not self.start <= day <= self.end
                for r in farm.daily.values()
                for day in r.overrides
            ):
                raise ValueError("Capacity exception lies outside the planning horizon")
            if any(
                p.period_id not in {p.id for p in self.periods}
                or p.crop_id not in self.allowed_crop_ids
                for p in farm.period_limits
            ):
                raise ValueError("Period limit uses unknown period or unselected crop")
        return self


class RunRequest(PlanningDraft):
    idempotency_key: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


def _validate_record_values(value: Any) -> None:
    """Public records are bounded JSON scalars; readiness still checks semantic types."""
    if isinstance(value, dict):
        if {"value", "unit", "source_ids"} <= value.keys():
            scalar = value["value"]
            if scalar is not None and (
                not isinstance(scalar, (str, bool, int, float))
                or isinstance(scalar, float)
                and not math.isfinite(scalar)
                or isinstance(scalar, str)
                and len(scalar) > 2000
            ):
                raise ValueError("Recorded values must be finite numbers, booleans or short text")
        for item in value.values():
            _validate_record_values(item)
    elif isinstance(value, list):
        for item in value:
            _validate_record_values(item)
