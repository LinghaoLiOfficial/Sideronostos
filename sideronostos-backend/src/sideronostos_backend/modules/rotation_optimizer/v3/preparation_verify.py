"""Independent source-to-coefficient audit; does not call candidate/resource builders."""

import calendar
import math
from datetime import date, timedelta
from typing import Any

from ...field_shift.schemas import Field as FieldSnapshot
from .contracts import InitialWater, SoilWater
from .inputs import CapacityInput, PlanningDraft
from .model import Capacity, Problem
from .profiles import ProfileV3, parameter_records
from .readiness import RecordedValue
from .scientific_verify import verify_growth
from .weather import prepare_weather


def close(actual: Any, expected: float | None) -> bool:
    if expected is None:
        return actual is None
    return (
        not isinstance(actual, bool)
        and isinstance(actual, (float, int))
        and math.isfinite(actual)
        and math.isclose(actual, expected, rel_tol=1e-8, abs_tol=1e-6)
    )


def verify_preparation(
    *,
    problem: Problem,
    draft: PlanningDraft,
    profile: ProfileV3,
    fields: list[FieldSnapshot],
    raw_weather: dict[str, Any],
    traces: dict[str, Any],
) -> dict[str, Any]:
    violations = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            violations.append(message)

    check(problem.start == draft.start and problem.end == draft.end, "planning_horizon")
    check(problem.weights == (draft.weights or profile.default_weights), "objective_weights")
    check(problem.disabled_metrics == draft.disabled_metrics, "disabled_metrics")
    check(
        problem.scales
        == {k: v for k, v in profile.scales.items() if k not in draft.disabled_metrics},
        "objective_scales",
    )
    check(problem.family_gaps == profile.family_gaps, "family_rules")
    check(problem.periods == draft.periods, "resource_periods")
    field_map = {f.id: f for f in fields}
    check({f.id for f in problem.fields} == {f.id for f in draft.fields}, "selected_field_set")
    for f in problem.fields:
        original = field_map.get(f.id)
        if original is None:
            check(False, "unknown_field:" + f.id)
            continue
        conditions = draft.field_conditions[f.id]
        check(
            f.farm_id == original.farm_id
            and close(f.area_ha, original.area_ha)
            and f.irrigation_available == original.irrigation_available
            and f.water_system_id == conditions.water_system_id,
            "field_identity:" + f.id,
        )
        entries = []
        linked = {e.linked_legacy_year for e in original.history_events}
        for old in original.history:
            if old.year not in linked:
                entries.append((old.crop_id, date(old.year, 12, 31), "year"))
        for event in original.history_events:
            month = event.end_month if event.end_month is not None else 12
            last = (
                event.end_day
                if event.end_day is not None
                else calendar.monthrange(event.end_year, month)[1]
            )
            entries.append((event.crop_id, date(event.end_year, month, last), event.precision))
        expected = [
            {
                "crop_id": cid,
                "end_latest": end,
                "precision": precision,
                **profile.history_catalogue[cid].model_dump(),
            }
            for cid, end, precision in entries
        ]
        check([h.model_dump() for h in f.history] == expected, "history_identity:" + f.id)
    weather_proof = prepare_weather(raw_weather, profile, draft)
    if not weather_proof["ready"]:
        return {
            "valid": False,
            "violations": ["weather_source_invalid"],
            "recipe": "source-coefficient-audit-v3.0",
        }
    weather = {date.fromisoformat(k): v for k, v in weather_proof["days"].items()}
    baseline = {(b.field_id, b.crop_id, b.sow_date) for b in draft.baseline}
    for candidate in problem.candidates:
        key = candidate.id
        crop = profile.crops.get(candidate.crop_id)
        field = field_map.get(candidate.field_id)
        trace = traces.get(key, {})
        if crop is None or field is None:
            check(False, "unknown_candidate_identity:" + key)
            continue
        condition = draft.field_conditions[field.id]
        values: dict[str, Any] = {str(k): v.value for k, v in condition.values.items()}
        check(
            candidate.species_id == crop.species_id
            and candidate.family == crop.family
            and candidate.turnaround_days == crop.phenology.turnaround_days,
            "crop_identity:" + key,
        )
        check(
            candidate.baseline_confirmed
            == ((field.id, candidate.crop_id, candidate.sow_date) in baseline),
            "baseline_identity:" + key,
        )
        check(
            trace.get("field_version") == field.version
            and trace.get("profile_id") == profile.id
            and trace.get("crop_id") == candidate.crop_id,
            "trace_identity:" + key,
        )
        check(
            trace.get("operating_evidence") == condition.model_dump(mode="json"),
            "operating_evidence:" + key,
        )
        check(
            trace.get("recipe") == "sourced-site-growth-economics-exposure-operations-v3.0",
            "coefficient_recipe:" + key,
        )
        check(
            trace.get("economics") == (crop.economics.model_dump() if crop.economics else None)
            and trace.get("soil_components")
            == (crop.soil_components.model_dump() if crop.soil_components else None),
            "coefficient_evidence:" + key,
        )
        growth = trace.get("growth", {})
        initial = InitialWater(
            policy=values["initial_water_policy"],
            confirmed=True,
            evidence_id="input:" + condition.values["initial_water_policy"].source_ids[0],
        )
        soil = SoilWater(**{k: values[k] for k in ("field_capacity", "wilting_point", "depth_m")})
        growth_proof = verify_growth(
            phenology=crop.phenology,
            canopy=crop.canopy,
            soil=soil,
            initial=initial,
            sow=candidate.sow_date,
            end=draft.end,
            weather=weather,
            effective_rain_fraction=values["effective_rain_fraction"],
            result=growth,
        )
        check(growth_proof["valid"], "scientific_growth:" + key)
        check(
            str(growth.get("harvest_date")) == candidate.harvest_date.isoformat()
            and growth.get("cover_mask") == candidate.cover_mask,
            "growth_link:" + key,
        )
        check(
            len(candidate.water_mm) == len(growth.get("water_mm", []))
            and all(
                close(a, b)
                for a, b in zip(candidate.water_mm, growth.get("water_mm", []), strict=False)
            ),
            "water_link:" + key,
        )
        check(
            close(candidate.seed_kg_ha, crop.seed_kg_ha)
            and close(candidate.yield_kg_ha, crop.yield_kg_ha),
            "seed_yield:" + key,
        )
        profit = (
            None
            if "profit" in draft.disabled_metrics
            else crop.yield_kg_ha * crop.economics.price_usd_kg - crop.economics.cost_usd_ha
            if crop.economics
            else None
        )
        soil_score = (
            None
            if "soil" in draft.disabled_metrics
            else sum(
                v * getattr(crop.soil_weights, k)
                for k, v in crop.soil_components.model_dump().items()
            )
            if crop.soil_components and crop.soil_weights
            else None
        )
        check(close(candidate.profit_usd_ha, profit), "profit:" + key)
        check(close(candidate.soil_score, soil_score), "soil_score:" + key)
        count = (candidate.harvest_date - candidate.sow_date).days + 1
        rows = [weather[candidate.sow_date + timedelta(days=i)] for i in range(count)]
        et = sum(item["etc_mm"] for item in growth.get("trace", {}).get("water_days", []))
        risks = {
            "heat": sum(r["tmax_c"] > crop.climate.heat_c for r in rows) / count,
            "frost": sum(r["tmin_c"] < crop.climate.frost_c for r in rows) / count,
            "excess_rain": sum(r["rain_mm"] > crop.climate.excess_rain_mm for r in rows) / count,
            "irrigation_dependence": min(1.0, sum(candidate.water_mm) / et)
            if et > 0
            else float(any(candidate.water_mm)),
        }
        risk = (
            None
            if "risk" in draft.disabled_metrics
            else sum(v * getattr(crop.risk_weights, k) for k, v in risks.items())
            if crop.risk_weights
            else None
        )
        check(close(candidate.risk_score, risk), "risk_score:" + key)
        risk_trace = trace.get("risk", {})
        check(
            all(close(risk_trace.get("components", {}).get(k), v) for k, v in risks.items()),
            "risk_trace:" + key,
        )
        hours = []
        for i in range(count):
            ordinal = (candidate.sow_date + timedelta(days=i)).timetuple().tm_yday
            solar = 0.409 * math.sin(2 * math.pi * ordinal / 365 - 1.39)
            argument = -math.tan(field.latitude * math.pi / 180) * math.tan(solar)
            hours.append(24 / math.pi * math.acos(min(1.0, max(-1.0, argument))))
        check(
            close(risk_trace.get("min_daylight_h"), min(hours))
            and close(risk_trace.get("max_daylight_h"), max(hours)),
            "daylight_trace:" + key,
        )
        suitable = (
            any(a <= candidate.sow_date.strftime("%m-%d") <= b for a, b in crop.sow_windows)
            and field.soil_texture in crop.soil.allowed_textures
            and crop.soil.ph_min <= values["ph"] <= crop.soil.ph_max
            and values["depth_m"] >= crop.soil.min_depth_m
            and values["salinity_ds_m"] <= crop.soil.max_salinity_ds_m
            and values["drainage"] in crop.soil.allowed_drainage
            and values["slope_deg"] <= crop.soil.max_slope_deg
            and values["aspect"] in crop.soil.allowed_aspects
            and values["terrain_position"] in crop.soil.allowed_terrain_positions
            and values["mechanical_access"] is True
            and candidate.crop_id not in condition.forbidden_crop_ids
            and risks["heat"] <= crop.climate.max_heat_fraction
            and risks["frost"] <= crop.climate.max_frost_fraction
            and risks["excess_rain"] <= crop.climate.max_excess_fraction
            and min(hours) >= crop.climate.min_daylight_h
            and max(hours) <= crop.climate.max_daylight_h
        )
        check(suitable and candidate.suitability.eligible, "candidate_suitability:" + key)
        check(
            field.irrigation_available or not any(v > 1e-6 for v in candidate.water_mm),
            "irrigation_infrastructure:" + key,
        )
        expected_operations: dict[str, dict[date, float]] = {}
        for operation in crop.operations:
            identifiers = [
                rid
                for rid, r in draft.farm_resources[field.farm_id or ""].daily.items()
                if r.kind == "machine"
                and r.machine_type == operation.machine
                and field.id in r.field_ids
            ]
            if len(identifiers) != 1:
                check(False, "operation_resource:" + key)
                continue
            op_date = (
                candidate.sow_date if operation.anchor == "sow" else candidate.harvest_date
            ) + timedelta(days=operation.offset_days)
            schedule = expected_operations.setdefault(identifiers[0], {})
            schedule[op_date] = schedule.get(op_date, 0.0) + operation.hours_ha
        check(candidate.machine_hours_ha == expected_operations, "operation_calendar:" + key)
    daily = {r.id: r for r in problem.daily_resources}
    expected_ids = {key for f in draft.farm_resources.values() for key in f.daily}
    check(set(daily) == expected_ids, "daily_resource_set")
    days = [draft.start + timedelta(days=i) for i in range((draft.end - draft.start).days + 1)]

    def audit_capacity(
        actual: Capacity,
        source: CapacityInput,
        label: str,
        amount: RecordedValue | None = None,
        efficiency: RecordedValue | None = None,
    ) -> None:
        amount = amount or source.amount
        expected = float(amount.value) * (float(efficiency.value) if efficiency else 1.0)
        check(close(actual.capacity, expected), "capacity:" + label)
        check(actual.remediable == source.remediable, "remedy_policy:" + label)
        expected_cost = (
            source.gap_unit_cost.value if source.remediable and source.gap_unit_cost else None
        )
        expected_remedy = source.remedy.value if source.remediable and source.remedy else None
        check(
            close(actual.gap_unit_cost, expected_cost) and actual.remedy == expected_remedy,
            "gap_cost_remedy:" + label,
        )
        evidence = sorted(
            {
                "input:" + sid
                for row in (amount, source.gap_unit_cost, source.remedy, efficiency)
                if row is not None
                for sid in row.source_ids
            }
        )
        check(sorted(actual.evidence_ids) == evidence, "capacity_evidence:" + label)

    for fid, farm in draft.farm_resources.items():
        for key, r in farm.daily.items():
            if key not in daily:
                continue
            actual = daily[key]
            check(
                actual.farm_id == fid and actual.kind == r.kind and actual.field_ids == r.field_ids,
                "daily_membership:" + key,
            )
            check(set(actual.days) == set(days), "daily_dates:" + key)
            efficiency = r.irrigation_efficiency if r.water_basis == "gross" else None
            for day in days:
                if day in actual.days:
                    audit_capacity(
                        actual.days[day],
                        r.default,
                        key + ":" + day.isoformat(),
                        r.overrides.get(day),
                        efficiency,
                    )
    periodic = {(r.farm_id, r.kind, r.crop_id, r.period_id): r for r in problem.period_resources}
    expected_periods = {
        (fid, r.kind, r.crop_id, r.period_id): r.limit
        for fid, f in draft.farm_resources.items()
        for r in f.period_limits
    }
    check(set(periodic) == set(expected_periods), "period_resource_set")
    for period_key, period_input in expected_periods.items():
        if period_key in periodic:
            audit_capacity(periodic[period_key].limit, period_input, ":".join(period_key))
    check(
        set(problem.bare_limits)
        == {fid for fid, c in draft.field_conditions.items() if c.bare_limit is not None},
        "bare_limit_set",
    )
    check(
        problem.bare_limit_disabled
        == {
            fid: c.bare_limit_disabled
            for fid, c in draft.field_conditions.items()
            if c.bare_limit_disabled is not None
        },
        "bare_disabled",
    )
    for fid, bare_limit in problem.bare_limits.items():
        source = draft.field_conditions[fid].bare_limit
        if source:
            audit_capacity(bare_limit, source, "bare:" + fid)
    candidates = {c.id: c for c in problem.candidates}
    records = parameter_records(profile)
    for benefit in problem.rotation_benefits:
        a, b = candidates[benefit.before], candidates[benefit.after]
        score = (
            profile.transition_scores[a.crop_id][b.crop_id] if profile.transition_scores else None
        )
        path = f"transition_scores.{a.crop_id}.{b.crop_id}"
        evidence = ["profile:" + key for key in records[path].source_ids] if path in records else []
        check(
            close(benefit.score, score) and benefit.evidence_ids == evidence,
            "transition_score:" + benefit.before + ":" + benefit.after,
        )
    return {
        "valid": not violations,
        "violations": sorted(set(violations)),
        "candidate_count": len(problem.candidates),
        "recipe": "source-coefficient-audit-v3.0",
        "scope": (
            "frozen inputs, coefficients and scientific traces; not local agronomic calibration"
        ),
    }
