"""Evidence-aware readiness, not a replacement for typed scientific validation.

Callers supply server-owned requirements/features. A client cannot disable mandatory
model requirements. Unknown inputs remain null in reports and never become capacities.
"""

import math
from collections.abc import Mapping, Sequence, Set
from datetime import date
from typing import Any, Literal, Self

from pydantic import Field, StrictBool, model_validator

from ..schemas import Contract
from .contracts import Identifier


class EvidenceSource(Contract):
    id: Identifier
    kind: Literal[
        "farmer_record",
        "expert_reference",
        "observation",
        "model_estimate",
        "engineering_assumption",
    ]
    title: str = Field(min_length=1, max_length=300)
    locator: str = Field(min_length=1, max_length=1000)
    region_id: Identifier
    observed_start: date | None = None
    observed_end: date | None = None
    applicable_start: date | None = None
    applicable_end: date | None = None
    quality: Literal["confirmed", "estimated", "missing", "rejected"]
    confirmed: StrictBool
    limitations: list[str] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def ordered_ranges(self) -> Self:
        for first, last in [
            (self.observed_start, self.observed_end),
            (self.applicable_start, self.applicable_end),
        ]:
            if (first is None) != (last is None) or (first and last and last < first):
                raise ValueError("Source date ranges require two ordered endpoints")
        return self


class RecordedValue(Contract):
    # This is an incomplete user draft, not a scientific coefficient. Validation and
    # usable-value extraction happen only after assessing the server's requirements.
    value: Any = None
    unit: str = Field(min_length=1, max_length=40)
    source_ids: list[Identifier] = Field(default_factory=list, max_length=20)
    missing_reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def missing_explained(self) -> Self:
        if self.value is None and not (self.missing_reason or "").strip():
            raise ValueError("Missing values require a reason")
        if self.value is not None and self.missing_reason:
            raise ValueError("A supplied value cannot simultaneously be missing")
        return self


class Requirement(Contract):
    path: Identifier
    unit: str
    value_kind: Literal["number", "text", "boolean"]
    minimum: float | None = None
    maximum: float | None = None
    features: list[Identifier] = Field(min_length=1)
    enforce_applicability_dates: bool = False


def valid_value(value: Any, requirement: Requirement) -> bool:
    if requirement.value_kind == "boolean":
        return isinstance(value, bool)
    if requirement.value_kind == "text":
        return isinstance(value, str) and bool(value.strip())
    return (
        not isinstance(value, bool)
        and isinstance(value, (float, int))
        and math.isfinite(value)
        and (requirement.minimum is None or value >= requirement.minimum)
        and (requirement.maximum is None or value <= requirement.maximum)
    )


def assess_readiness(
    *,
    requirements: Sequence[Requirement],
    values: Mapping[str, RecordedValue],
    sources: Mapping[str, EvidenceSource],
    region_id: str,
    start: date,
    end: date,
    enabled_features: Set[str],
    accept_engineering_assumptions: bool,
) -> dict[str, Any]:
    if end < start or len({r.path for r in requirements}) != len(requirements):
        raise ValueError("Readiness needs an ordered horizon and unique requirements")
    items = []
    blocked: set[str] = set()
    for requirement in requirements:
        record = values.get(requirement.path)
        value = record.value if record else None
        issues = []
        warnings = []
        origins = []
        engineering = False
        enabled = set(requirement.features) & enabled_features
        if value is None:
            issues.append("value_missing")
        elif not valid_value(value, requirement):
            issues.append("invalid_value")
        if record and record.unit != requirement.unit:
            issues.append("unit_mismatch")
        if record is None or not record.source_ids:
            issues.append("source_missing")
        for source_id in record.source_ids if record else []:
            source = sources.get(source_id)
            if source is None or source.id != source_id:
                issues.append("source_missing")
                continue
            origins.append(source.model_dump(mode="json"))
            if not source.confirmed:
                issues.append("confirmation_required")
            if source.quality in ("missing", "rejected"):
                issues.append("quality_rejected")
            if source.quality == "estimated":
                warnings.append("estimated_not_measured")
            if source.region_id != region_id and not (
                source.region_id == "global" and source.kind == "expert_reference"
            ):
                issues.append("outside_region")
            if requirement.enforce_applicability_dates and (
                source.applicable_start is None
                or source.applicable_end is None
                or source.applicable_start > start
                or source.applicable_end < end
            ):
                issues.append("outside_time_scope")
            if source.kind == "engineering_assumption":
                engineering = True
                warnings.append("not_field_calibrated")
                if not accept_engineering_assumptions:
                    issues.append("engineering_assumption_unaccepted")
        if enabled and issues:
            blocked.update(enabled)
        # Invalid infinities cannot be emitted in a JSON API response.
        if isinstance(value, float) and not math.isfinite(value):
            value = None
        items.append(
            {
                "path": requirement.path,
                "value": value,
                "unit": record.unit if record else requirement.unit,
                "expected_unit": requirement.unit,
                "sources": origins,
                "missing_reason": record.missing_reason if record else "No value supplied",
                "status": "not_enabled" if not enabled else "blocked" if issues else "ready",
                "issues": sorted(set(issues)),
                "warnings": sorted(set(warnings)),
                "engineering_assumption": engineering,
                "blocks": sorted(enabled) if issues else [],
            }
        )
    return {
        "schema": "rotation-readiness-v3.0",
        "ready": not blocked,
        "blocked_features": sorted(blocked),
        "items": items,
    }
