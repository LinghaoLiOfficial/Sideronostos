"""Calendar coefficients for the solver; growing days exclude turnaround."""

from datetime import timedelta

from .schemas import Candidate, PlanningField


def resources(candidate: Candidate, field: PlanningField) -> dict[int, dict[str, float]]:
    years: dict[int, dict[str, float]] = {}
    n = len(candidate.water_mm)
    for i, mm in enumerate(candidate.water_mm):
        year = (candidate.sow_date + timedelta(days=i)).year
        r = years.setdefault(
            year, {"water_m3": 0, "cost_usd": 0, "labor_days": 0, "cover_ha_days": 0}
        )
        r["water_m3"] += mm * field.area_ha * 10
        r["cost_usd"] += candidate.cost_usd_ha * field.area_ha / n
        r["labor_days"] += candidate.labor_days_ha * field.area_ha / n
        r["cover_ha_days"] += field.area_ha
    return years
