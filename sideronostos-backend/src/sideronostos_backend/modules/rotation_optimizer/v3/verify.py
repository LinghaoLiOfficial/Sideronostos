"""Independent calendar/resource oracle; no MILP expressions or coefficient helpers."""

from datetime import timedelta
from itertools import combinations
from typing import Any

from .model import Capacity, Problem

TOLERANCE = 1e-6


def verify_selection(problem: Problem, selected_ids: list[str]) -> dict[str, Any]:
    catalogue = {c.id: c for c in problem.candidates}
    fields = {f.id: f for f in problem.fields}
    violations = []
    if len(selected_ids) != len(set(selected_ids)):
        violations.append("duplicate_candidate")
    if not set(selected_ids) <= catalogue.keys():
        violations.append("unknown_candidate")
    chosen = [catalogue[key] for key in set(selected_ids) if key in catalogue]
    count = (problem.end - problem.start).days + 1
    dates = [problem.start + timedelta(days=i) for i in range(count)]
    water = {f.id: {day: 0.0 for day in dates} for f in problem.fields}
    bare = {f.id: count for f in problem.fields}
    paths = []
    benefits = {(b.before, b.after): b.score for b in problem.rotation_benefits}
    rotation = 0.0
    for field in problem.fields:
        sequence = sorted(
            (c for c in chosen if c.field_id == field.id), key=lambda c: (c.sow_date, c.id)
        )
        if not sequence:
            violations.append(f"field_requires_crop:{field.id}")
        if sequence and field.history:
            latest = max(h.end_latest for h in field.history)
            if any(
                h.end_latest == latest and h.species_id == sequence[0].species_id
                for h in field.history
            ):
                violations.append(f"historical_adjacency:{field.id}")
        for candidate in sequence:
            if not candidate.suitability.eligible:
                violations.append(f"unsuitable:{candidate.id}")
            if not field.irrigation_available and any(v > TOLERANCE for v in candidate.water_mm):
                violations.append(f"no_irrigation:{candidate.id}")
            for historical in field.history:
                gap = (
                    (candidate.sow_date - historical.end_latest).days
                    - historical.turnaround_days
                    - 1
                )
                if gap < 0 or (
                    historical.family == candidate.family
                    and gap < problem.family_gaps[candidate.family]
                ):
                    violations.append(f"historical_gap:{candidate.id}:{historical.crop_id}")
            for offset, amount in enumerate(candidate.water_mm):
                water[field.id][candidate.sow_date + timedelta(days=offset)] += amount
            bare[field.id] -= sum(candidate.cover_mask)
        for first, second in combinations(sequence, 2):
            if first.occupied_until >= second.sow_date:
                violations.append(f"occupancy:{first.id}:{second.id}")
            if first.family == second.family:
                gap = (second.sow_date - first.harvest_date).days - first.turnaround_days - 1
                if gap < problem.family_gaps[first.family]:
                    violations.append(f"family_gap:{first.id}:{second.id}")
        for first, second in zip(sequence, sequence[1:], strict=False):
            if first.species_id == second.species_id:
                violations.append(f"species_adjacency:{first.id}:{second.id}")
            if "rotation" not in problem.disabled_metrics:
                if (first.id, second.id) not in benefits:
                    violations.append(f"missing_transition_score:{first.id}:{second.id}")
                else:
                    rotation += benefits[first.id, second.id]
        paths.append({"field_id": field.id, "candidate_ids": [c.id for c in sequence]})

    resources: list[dict[str, Any]] = []
    gap_cost = 0.0

    def resource(identifier: str, kind: str, used: float, limit: Capacity, unit: str) -> None:
        nonlocal gap_cost
        gap = max(0.0, used - limit.capacity)
        if gap <= TOLERANCE:
            gap = 0.0
        if gap and not limit.remediable:
            violations.append(f"hard_capacity:{identifier}")
        cost = gap * limit.gap_unit_cost if limit.gap_unit_cost is not None else 0.0
        gap_cost += cost
        resources.append(
            {
                "id": identifier,
                "kind": kind,
                "used": used,
                "capacity": limit.capacity,
                "gap": gap,
                "unit": unit,
                "gap_unit_cost": limit.gap_unit_cost,
                "gap_cost": cost,
                "remediable": limit.remediable,
                "remedy": limit.remedy,
                "evidence_ids": limit.evidence_ids,
            }
        )

    for daily in problem.daily_resources:
        for day in dates:
            if daily.kind == "water":
                used = sum(10 * fields[fid].area_ha * water[fid][day] for fid in daily.field_ids)
            else:
                used = sum(
                    fields[c.field_id].area_ha * c.machine_hours_ha.get(daily.id, {}).get(day, 0)
                    for c in chosen
                    if c.field_id in daily.field_ids
                )
            resource(
                f"{daily.kind}:{daily.id}:{day}",
                daily.kind,
                used,
                daily.days[day],
                "m3" if daily.kind == "water" else "hours",
            )
    periods = {p.id: p for p in problem.periods}
    for supply in problem.period_resources:
        period = periods[supply.period_id]
        used = 0.0
        for candidate in chosen:
            field = fields[candidate.field_id]
            event = candidate.sow_date if supply.kind == "seed" else candidate.harvest_date
            if (
                field.farm_id == supply.farm_id
                and candidate.crop_id == supply.crop_id
                and period.start <= event <= period.end
            ):
                used += field.area_ha * (
                    candidate.seed_kg_ha if supply.kind == "seed" else candidate.yield_kg_ha
                )
        resource(f"{supply.kind}:{supply.id}", supply.kind, used, supply.limit, "kg")
    for fid, limit in problem.bare_limits.items():
        resource(f"bare:{fid}", "bare", bare[fid], limit, "days")
    metrics: dict[str, float | None] = {
        "profit": None
        if "profit" in problem.disabled_metrics
        else sum(
            fields[c.field_id].area_ha * c.profit_usd_ha
            for c in chosen
            if c.profit_usd_ha is not None
        ),
        "water": sum(
            fields[fid].area_ha * 10 * sum(series.values()) for fid, series in water.items()
        ),
        "rotation": None if "rotation" in problem.disabled_metrics else rotation,
        "soil": None
        if "soil" in problem.disabled_metrics
        else sum(
            fields[c.field_id].area_ha * c.soil_score for c in chosen if c.soil_score is not None
        ),
        "risk": None
        if "risk" in problem.disabled_metrics
        else sum(
            fields[c.field_id].area_ha * c.risk_score for c in chosen if c.risk_score is not None
        ),
        "bare": sum(fields[fid].area_ha * value for fid, value in bare.items()),
    }
    normalized = {}
    for metric, scale in problem.scales.items():
        value = metrics[metric]
        if value is not None:
            normalized[metric] = value / scale
    score = sum(
        getattr(problem.weights, metric)
        * value
        * (-1 if metric in ("water", "risk", "bare") else 1)
        for metric, value in normalized.items()
    )
    diagnostic = any(row["gap"] > 0 for row in resources)
    return {
        "valid": not violations,
        "violations": sorted(set(violations)),
        "paths": paths,
        "metrics": metrics,
        "normalized": normalized,
        "score": score,
        "gap_cost": gap_cost,
        "resources": resources,
        "diagnostic": diagnostic,
        "resource_feasible": not violations and not diagnostic,
        "water_mm": {
            fid: {day.isoformat(): mm for day, mm in series.items()}
            for fid, series in water.items()
        },
        "recipe": "independent-daily-calendar-resource-verifier-v3.0",
        "scope": (
            "frozen coefficients; scientific preprocessing and local calibration "
            "are separate checks"
        ),
    }
