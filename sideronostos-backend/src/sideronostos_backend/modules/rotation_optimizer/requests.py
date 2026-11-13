"""Public inputs contain farmer choices, never executable scientific coefficients."""

from datetime import date
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from ..field_shift.schemas import FieldInput
from .profiles import ProfileV2
from .schemas import Contract, HistoricalCrop, ResourceLimit, Weights

Identifier = Annotated[str, Field(min_length=1, max_length=100)]


class FieldChoice(Contract):
    id: Identifier
    expected_version: int = Field(strict=True, ge=1)
    require_crop: bool = True
    history_reviewed: bool


class Scenario(Contract):
    temperature_change_c: float = Field(default=0, ge=-3, le=5)
    rainfall_change_pct: float = Field(default=0, ge=-50, le=50)


class BaselineSeason(Contract):
    field_id: Identifier
    crop_id: Identifier
    sow_date: date


class RunRequest(Contract):
    idempotency_key: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    profile_id: Identifier
    fields: list[FieldChoice] = Field(min_length=1, max_length=10)
    start: date
    end: date
    allowed_crop_ids: list[Identifier] = Field(min_length=1, max_length=20)
    sow_windows: dict[str, tuple[str, str]] = Field(default_factory=dict)
    farm_limits: dict[int, ResourceLimit]
    field_limits: dict[str, dict[int, ResourceLimit]] = Field(default_factory=dict)
    weights: Weights | None = None
    scenario: Scenario = Field(default_factory=Scenario)
    baseline: list[BaselineSeason] = Field(default_factory=list, max_length=60)
    accept_benchmark_assumptions: bool

    @model_validator(mode="after")
    def complete_request(self) -> Self:
        if not 0 <= (self.end - self.start).days <= 1095 or not 2000 <= self.start.year <= 2197:
            raise ValueError("Planning horizon must be ordered and at most three years")
        for first, last in self.sow_windows.values():
            try:
                # A recurring window must be valid in every planning year, including non-leap years.
                dates = [date.fromisoformat(f"2001-{value}") for value in (first, last)]
                if first > last or any(
                    d.strftime("%m-%d") != value
                    for d, value in zip(dates, (first, last), strict=True)
                ):
                    raise ValueError("Unordered or noncanonical calendar window")
            except ValueError as error:
                raise ValueError("Sowing windows require ordered valid MM-DD dates") from error
        years = set(range(self.start.year, self.end.year + 1))
        ids = {field.id for field in self.fields}
        if len(ids) != len(self.fields) or len(set(self.allowed_crop_ids)) != len(
            self.allowed_crop_ids
        ):
            raise ValueError("Duplicate field or crop selection")
        if not self.accept_benchmark_assumptions or not all(
            f.history_reviewed for f in self.fields
        ):
            raise ValueError("Review each field history and acknowledge benchmark assumptions")
        if set(self.farm_limits) != years:
            raise ValueError("Provide explicit farm limits for every calendar year")
        if not set(self.field_limits) <= ids or any(
            not set(caps) <= years for caps in self.field_limits.values()
        ):
            raise ValueError("Unknown field or year in resource limits")
        if any(
            b.field_id not in ids or not self.start <= b.sow_date <= self.end for b in self.baseline
        ):
            raise ValueError("Baseline must use selected fields and dates inside the horizon")
        keys = {(b.field_id, b.crop_id, b.sow_date) for b in self.baseline}
        if len(keys) != len(self.baseline):
            raise ValueError("Duplicate baseline season")
        if self.weights and any(v > 5 for v in self.weights.model_dump().values()):
            raise ValueError("Preference weights must be between zero and five")
        return self


def resolve_history(field: FieldInput, profile: ProfileV2, start: date) -> list[HistoricalCrop]:
    crop_map = {crop.id: crop for crop in profile.crops}
    result: list[HistoricalCrop] = []
    links = {event.linked_legacy_year for event in field.history_events}
    entries: list[tuple[str, date, Literal["day", "month", "year"]]] = [
        (entry.crop_id, date(entry.year, 12, 31), "year")
        for entry in field.history
        if entry.year not in links
    ]
    for event in field.history_events:
        if event.profile_id != profile.id:
            raise ValueError("History catalogue version differs from the planning profile")
        entries.append((event.crop_id, event.latest_end(), event.precision))
    for crop_id, end, precision in entries:
        if crop_id not in profile.history_catalogue:
            raise ValueError(f"Historical crop is absent from the profile catalogue: {crop_id}")
        if end >= start:
            raise ValueError("Historical crop end must predate the planning horizon")
        crop = crop_map.get(crop_id)
        result.append(
            HistoricalCrop(
                crop_id=crop_id,
                family=profile.history_catalogue[crop_id],
                end_latest=end,
                turnaround_days=crop.turnaround_days if crop else profile.history_turnaround_days,
                precision=precision,
            )
        )
    return result
