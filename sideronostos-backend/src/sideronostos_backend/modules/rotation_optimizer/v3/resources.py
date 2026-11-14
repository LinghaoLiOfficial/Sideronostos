"""Expand sourced daily defaults/exceptions and period limits into frozen capacities."""

import hashlib
from datetime import timedelta
from typing import Any

from .inputs import CapacityInput, PlanningDraft
from .model import Capacity, DailyResource, PeriodResource
from .readiness import RecordedValue


def capacity(
    cap: CapacityInput,
    *,
    amount: RecordedValue | None = None,
    efficiency: RecordedValue | None = None,
) -> Capacity:
    if cap.remediable is None:
        raise ValueError("Resource remedy policy has not passed readiness")
    amount = amount or cap.amount
    factor = float(efficiency.value) if efficiency is not None else 1.0
    origins = {
        key
        for item in (amount, cap.gap_unit_cost, cap.remedy, efficiency)
        if item is not None
        for key in item.source_ids
    }
    return Capacity(
        capacity=float(amount.value) * factor,
        remediable=cap.remediable,
        gap_unit_cost=float(cap.gap_unit_cost.value)
        if cap.remediable and cap.gap_unit_cost
        else None,
        remedy=str(cap.remedy.value) if cap.remediable and cap.remedy else None,
        evidence_ids=["input:" + key for key in sorted(origins)],
    )


def period_resource_id(farm: str, kind: str, crop: str, period: str) -> str:
    return "period-" + hashlib.sha256(f"{farm}\0{kind}\0{crop}\0{period}".encode()).hexdigest()[:24]


def compile_resources(draft: PlanningDraft) -> dict[str, Any]:
    dates = [draft.start + timedelta(days=i) for i in range((draft.end - draft.start).days + 1)]
    daily = []
    periodic = []
    for farm_id, farm in sorted(draft.farm_resources.items()):
        for identifier, resource in farm.daily.items():
            efficiency = resource.irrigation_efficiency if resource.water_basis == "gross" else None
            daily.append(
                DailyResource(
                    id=identifier,
                    farm_id=farm_id,
                    kind=resource.kind,
                    field_ids=resource.field_ids,
                    days={
                        day: capacity(
                            resource.default,
                            amount=resource.overrides.get(day),
                            efficiency=efficiency,
                        )
                        for day in dates
                    },
                )
            )
        for limit in farm.period_limits:
            periodic.append(
                PeriodResource(
                    id=period_resource_id(farm_id, limit.kind, limit.crop_id, limit.period_id),
                    farm_id=farm_id,
                    kind=limit.kind,
                    crop_id=limit.crop_id,
                    period_id=limit.period_id,
                    limit=capacity(limit.limit),
                )
            )
    return {
        "daily_resources": daily,
        "period_resources": periodic,
        "bare_limits": {
            fid: capacity(c.bare_limit)
            for fid, c in draft.field_conditions.items()
            if c.bare_limit is not None
        },
        "bare_limit_disabled": {
            fid: c.bare_limit_disabled
            for fid, c in draft.field_conditions.items()
            if c.bare_limit_disabled is not None
        },
    }
