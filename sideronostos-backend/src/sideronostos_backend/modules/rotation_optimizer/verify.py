"""Rebuild selected calendars independently of MILP variables and coefficients."""

from datetime import timedelta
from typing import Any

from .schemas import Problem


def verify_selection(problem: Problem, selected_ids: list[str]) -> dict[str, Any]:
    violations: list[str] = []
    known = {c.id: c for c in problem.candidates}
    if len(set(selected_ids)) != len(selected_ids) or not set(selected_ids) <= known.keys():
        return {"valid": False, "violations": ["unknown_or_duplicate_candidate"]}
    chosen = [known[cid] for cid in selected_ids]
    farm: dict[str, dict[str, float]] = {}
    field_years: dict[str, dict[str, dict[str, float]]] = {}
    totals = {
        "water_m3": 0.0,
        "cost_usd": 0.0,
        "labor_days": 0.0,
        "cover_ha_days": 0.0,
        "diversity_ha_families": 0.0,
    }
    for field in problem.fields:
        seq = sorted((c for c in chosen if c.field_id == field.id), key=lambda c: c.sow_date)
        if field.require_crop and not seq:
            violations.append(f"required_crop:{field.id}")
        per_year: dict[str, dict[str, float]] = {}
        field_years[field.id] = per_year
        totals["diversity_ha_families"] += field.area_ha * len({c.family for c in seq})
        for i, c in enumerate(seq):
            if c.sow_date < problem.start or c.occupied_until > problem.end:
                violations.append(f"horizon:{c.id}")
            if not field.irrigation_available and any(mm > 1e-7 for mm in c.water_mm):
                violations.append(f"irrigation_unavailable:{c.id}")
            if i and (seq[i - 1].occupied_until >= c.sow_date or seq[i - 1].crop_id == c.crop_id):
                violations.append(f"sequence:{c.id}")
            for prior in seq[:i]:
                if prior.family == c.family:
                    gap = (c.sow_date - prior.harvest_date).days - prior.turnaround_days - 1
                    if gap < problem.family_gaps[c.family]:
                        violations.append(f"family_gap:{prior.id}:{c.id}")
            for h in field.history:
                days = (c.sow_date - h.end_latest).days - h.turnaround_days - 1
                if days < 0 or (h.family == c.family and days < problem.family_gaps[c.family]):
                    violations.append(f"history:{c.id}")
            if i == 0 and field.history:
                latest = max(field.history, key=lambda h: h.end_latest)
                if latest.crop_id == c.crop_id:
                    violations.append(f"historical_adjacency:{c.id}")
            n = (c.harvest_date - c.sow_date).days + 1
            for offset in range(n):
                year = str((c.sow_date + timedelta(days=offset)).year)
                r = per_year.setdefault(
                    year,
                    {"water_m3": 0.0, "cost_usd": 0.0, "labor_days": 0.0, "cover_ha_days": 0.0},
                )
                r["water_m3"] += 10 * field.area_ha * c.water_mm[offset]
                r["cost_usd"] += field.area_ha * c.cost_usd_ha / n
                r["labor_days"] += field.area_ha * c.labor_days_ha / n
                r["cover_ha_days"] += field.area_ha
        for year, r in per_year.items():
            for metric, value in r.items():
                totals[metric] += value
                f = farm.setdefault(
                    year,
                    {"water_m3": 0.0, "cost_usd": 0.0, "labor_days": 0.0, "cover_ha_days": 0.0},
                )
                f[metric] += value
            cap = problem.field_limits.get(field.id, {}).get(int(year))
            if cap:
                for metric, limit in cap.model_dump().items():
                    if r[metric] > limit + 1e-6:
                        violations.append(f"field_resource:{field.id}:{year}:{metric}")
    for farm_year, cap in problem.farm_limits.items():
        for metric, limit in cap.model_dump().items():
            if farm.get(str(farm_year), {}).get(metric, 0) > limit + 1e-6:
                violations.append(f"farm_resource:{farm_year}:{metric}")
    w, ref = problem.weights, problem.references
    objective = (
        w.cover * totals["cover_ha_days"] / ref.cover
        + w.diversity * totals["diversity_ha_families"] / ref.diversity
        - w.water * totals["water_m3"] / ref.water
        - w.cost * totals["cost_usd"] / ref.cost
    )
    return {
        "valid": not violations,
        "violations": sorted(set(violations)),
        "totals": totals,
        "field_years": field_years,
        "farm_years": farm,
        "objective": objective,
    }
