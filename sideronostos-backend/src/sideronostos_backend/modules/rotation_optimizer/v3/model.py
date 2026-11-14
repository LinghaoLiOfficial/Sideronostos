"""Frozen, precomputed v3 MILP inputs. These are never accepted as public coefficients."""

from datetime import date, timedelta
from typing import Annotated, Literal, Self

from pydantic import Field, StrictBool, model_validator

from ..schemas import Contract
from .contracts import Fraction, Identifier, Nonnegative, Number, ObjectiveWeights, Positive

Metric = Literal["profit", "water", "rotation", "soil", "risk", "bare"]
METRICS: tuple[Metric, ...] = ("profit", "water", "rotation", "soil", "risk", "bare")
MAX_FIELDS, MAX_CANDIDATES, MAX_EDGES = 10, 240, 1200


class HistoricalCrop(Contract):
    crop_id: Identifier
    species_id: Identifier
    family: Identifier
    end_latest: date
    turnaround_days: int = Field(strict=True, ge=0, le=365)
    precision: Literal["day", "month", "year"]


class PlanningField(Contract):
    id: Identifier
    farm_id: Identifier
    area_ha: Annotated[float, Field(strict=True, gt=0, le=100000)]
    irrigation_available: StrictBool
    water_system_id: Identifier | None
    history: list[HistoricalCrop]


class Suitability(Contract):
    sow: StrictBool
    soil: StrictBool
    terrain: StrictBool
    climate: StrictBool
    management: StrictBool

    @property
    def eligible(self) -> bool:
        return all(self.model_dump().values())


class Candidate(Contract):
    id: Identifier
    field_id: Identifier
    crop_id: Identifier  # cultivar/seed identity
    species_id: Identifier  # adjacency compares species, not two cultivars of one crop
    family: Identifier
    sow_date: date
    harvest_date: date
    turnaround_days: int = Field(strict=True, ge=0, le=365)
    water_mm: list[Nonnegative]
    cover_mask: list[StrictBool]
    seed_kg_ha: Nonnegative
    yield_kg_ha: Nonnegative
    profit_usd_ha: Number | None
    soil_score: Fraction | None
    risk_score: Fraction | None
    machine_hours_ha: dict[Identifier, dict[date, Nonnegative]]
    suitability: Suitability
    baseline_confirmed: StrictBool

    @property
    def occupied_until(self) -> date:
        return self.harvest_date + timedelta(days=self.turnaround_days)

    @model_validator(mode="after")
    def shape(self) -> Self:
        growth = (self.harvest_date - self.sow_date).days + 1
        if growth < 1 or growth > 365 or len(self.water_mm) != growth:
            raise ValueError("Water must cover every growing day")
        if len(self.cover_mask) != growth + self.turnaround_days:
            raise ValueError("Cover must span occupancy, with explicit uncovered turnaround days")
        for schedule in self.machine_hours_ha.values():
            if any(not self.sow_date <= day <= self.occupied_until for day in schedule):
                raise ValueError("Machine demand falls outside candidate occupancy")
        return self


class Period(Contract):
    id: Identifier
    start: date
    end: date


class Capacity(Contract):
    capacity: Nonnegative
    remediable: StrictBool
    gap_unit_cost: Positive | None
    remedy: str | None = Field(max_length=1000)
    evidence_ids: list[Identifier] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def enforce_hard_prohibitions(self) -> Self:
        if self.remediable and (self.gap_unit_cost is None or not (self.remedy or "").strip()):
            raise ValueError("Remediable capacity requires positive gap cost and a proposed remedy")
        if not self.remediable and self.gap_unit_cost is not None:
            raise ValueError("Hard prohibition cannot have a soft gap cost")
        return self


class DailyResource(Contract):
    id: Identifier
    farm_id: Identifier
    kind: Literal["water", "machine"]
    field_ids: list[Identifier] = Field(min_length=1, max_length=MAX_FIELDS)
    days: dict[date, Capacity]


class PeriodResource(Contract):
    id: Identifier
    farm_id: Identifier
    kind: Literal["seed", "market"]
    crop_id: Identifier
    period_id: Identifier
    limit: Capacity


class RotationBenefit(Contract):
    before: Identifier
    after: Identifier
    score: Number
    evidence_ids: list[Identifier] = Field(min_length=1)


class Problem(Contract):
    version: Literal["rotation-milp-v3.0"] = "rotation-milp-v3.0"
    start: date
    end: date
    fields: list[PlanningField] = Field(min_length=1, max_length=MAX_FIELDS)
    candidates: list[Candidate] = Field(min_length=1, max_length=MAX_CANDIDATES)
    family_gaps: dict[Identifier, Annotated[int, Field(strict=True, ge=0, le=7300)]]
    periods: list[Period] = Field(min_length=1, max_length=1096)
    daily_resources: list[DailyResource] = Field(max_length=100)
    period_resources: list[PeriodResource] = Field(max_length=20000)
    bare_limits: dict[Identifier, Capacity]
    bare_limit_disabled: dict[Identifier, str]
    weights: ObjectiveWeights
    scales: dict[Metric, Positive]
    disabled_metrics: dict[Metric, str]
    rotation_benefits: list[RotationBenefit] = Field(max_length=MAX_EDGES)

    @model_validator(mode="after")
    def coherent(self) -> Self:
        days_count = (self.end - self.start).days + 1
        if not 1 <= days_count <= 1096:
            raise ValueError("Horizon must be ordered and at most three years")
        days = {self.start + timedelta(days=i) for i in range(days_count)}
        fields = {f.id: f for f in self.fields}
        candidates = {c.id: c for c in self.candidates}
        if len(fields) != len(self.fields) or len(candidates) != len(self.candidates):
            raise ValueError("Duplicate field or candidate identity")
        periods = sorted(self.periods, key=lambda p: p.start)
        if len({p.id for p in periods}) != len(periods):
            raise ValueError("Duplicate period identity")
        cursor = self.start
        for period in periods:
            if period.start != cursor or period.end < period.start:
                raise ValueError("Periods must partition every planning day without gaps/overlap")
            cursor = period.end + timedelta(days=1)
        if cursor != self.end + timedelta(days=1):
            raise ValueError("Periods do not span the horizon")
        daily = {r.id: r for r in self.daily_resources}
        if len(daily) != len(self.daily_resources):
            raise ValueError("Duplicate daily resource identity")
        for resource in self.daily_resources:
            if set(resource.days) != days:
                raise ValueError("Daily capacities must explicitly cover the complete horizon")
            if len(set(resource.field_ids)) != len(resource.field_ids) or any(
                fid not in fields or fields[fid].farm_id != resource.farm_id
                for fid in resource.field_ids
            ):
                raise ValueError("Resource field membership must stay within its farm")
        period_ids = {p.id for p in periods}
        farm_ids = {f.farm_id for f in self.fields}
        keys = set()
        for period_resource in self.period_resources:
            key = (
                period_resource.farm_id,
                period_resource.kind,
                period_resource.crop_id,
                period_resource.period_id,
            )
            if (
                key in keys
                or period_resource.period_id not in period_ids
                or period_resource.farm_id not in farm_ids
            ):
                raise ValueError("Unknown or duplicate period period_resource")
            keys.add(key)
        if len({r.id for r in self.period_resources}) != len(self.period_resources):
            raise ValueError("Duplicate period resource identity")
        if (
            set(self.bare_limits) & set(self.bare_limit_disabled)
            or (set(self.bare_limits) | set(self.bare_limit_disabled)) != set(fields)
            or any(not reason.strip() for reason in self.bare_limit_disabled.values())
        ):
            raise ValueError("Each field needs a bare cap or an explicit disabled-cap reason")
        if any(cap.capacity > days_count for cap in self.bare_limits.values()):
            raise ValueError("Bare cap exceeds planning days")
        if set(self.disabled_metrics) & {"water", "bare"} or any(
            not reason.strip() or getattr(self.weights, metric) != 0
            for metric, reason in self.disabled_metrics.items()
        ):
            raise ValueError("Disabled objectives require zero weight and an explicit reason")
        if set(self.scales) != set(METRICS) - set(self.disabled_metrics):
            raise ValueError("Each available metric needs one strictly positive scale")
        for field in self.fields:
            water = daily.get(field.water_system_id or "")
            if field.irrigation_available:
                if not water or water.kind != "water" or field.id not in water.field_ids:
                    raise ValueError("Irrigated field needs its own declared water-system capacity")
            elif field.water_system_id is not None:
                raise ValueError("Rainfed field cannot silently acquire an irrigation system")
            memberships = [
                r.id for r in self.daily_resources if r.kind == "water" and field.id in r.field_ids
            ]
            if memberships != ([field.water_system_id] if field.irrigation_available else []):
                raise ValueError(
                    "Each field must have exactly its declared water resource membership"
                )
            for history in field.history:
                if history.end_latest >= self.start or history.family not in self.family_gaps:
                    raise ValueError("History must predate horizon and use a declared family rule")
            if not any(
                c.field_id == field.id and c.baseline_confirmed and c.suitability.eligible
                for c in self.candidates
            ):
                raise ValueError(
                    "Every field needs at least one confirmed suitable baseline candidate"
                )
        for c in self.candidates:
            if c.field_id not in fields or c.family not in self.family_gaps:
                raise ValueError("Candidate references unknown field or family")
            if c.sow_date < self.start or c.occupied_until > self.end:
                raise ValueError("Candidate including turnaround falls outside horizon")
            field = fields[c.field_id]
            for resource_id in c.machine_hours_ha:
                machine = daily.get(resource_id)
                if not machine or machine.kind != "machine" or c.field_id not in machine.field_ids:
                    raise ValueError("Candidate requires an undeclared machine resource")
            for kind, event_day in [("seed", c.sow_date), ("market", c.harvest_date)]:
                period_id = next(p.id for p in periods if p.start <= event_day <= p.end)
                if (field.farm_id, kind, c.crop_id, period_id) not in keys:
                    raise ValueError("Candidate needs explicit seed and market period capacities")
            for metric, value in [
                ("profit", c.profit_usd_ha),
                ("soil", c.soil_score),
                ("risk", c.risk_score),
            ]:
                if metric not in self.disabled_metrics and value is None:
                    raise ValueError("Unavailable metric cannot be used or presented as zero")
        arcs = {
            (a.id, b.id)
            for a in self.candidates
            for b in self.candidates
            if a.field_id == b.field_id
            and a.occupied_until < b.sow_date
            and a.species_id != b.species_id
        }
        if len(arcs) > MAX_EDGES:
            raise ValueError(
                "candidate_graph_too_large: narrow the explicitly sampled candidate set"
            )
        benefits = {(b.before, b.after) for b in self.rotation_benefits}
        if len(benefits) != len(self.rotation_benefits) or not benefits <= arcs:
            raise ValueError("Unknown or duplicate rotation transition")
        if "rotation" not in self.disabled_metrics and benefits != arcs:
            raise ValueError("Each possible transition needs a sourced score when enabled")
        return self
