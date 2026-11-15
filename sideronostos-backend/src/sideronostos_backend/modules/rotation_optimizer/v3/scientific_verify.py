"""Recompute daily crop/water coefficients without calling their production builders."""

import math
from collections.abc import Mapping
from datetime import date, timedelta
from typing import Any

from .contracts import Canopy, InitialWater, Phenology, SoilWater


def _matches(actual: Any, expected: float) -> bool:
    return (
        not isinstance(actual, bool)
        and isinstance(actual, (float, int))
        and math.isfinite(actual)
        and math.isclose(actual, expected, abs_tol=1e-6, rel_tol=1e-8)
    )


def verify_growth(
    *,
    phenology: Phenology,
    canopy: Canopy,
    soil: SoilWater,
    initial: InitialWater,
    sow: date,
    end: date,
    weather: Mapping[date, Mapping[str, Any]],
    effective_rain_fraction: float,
    result: Mapping[str, Any],
) -> dict[str, Any]:
    violations = []
    try:
        harvest = date.fromisoformat(str(result["harvest_date"]))
        occupied = date.fromisoformat(str(result["occupied_until"]))
    except (ValueError, KeyError):
        return {"valid": False, "violations": ["missing_or_invalid_candidate_dates"]}
    count = (harvest - sow).days + 1
    if (
        not 1 <= count <= phenology.max_growing_days
        or occupied != harvest + timedelta(days=phenology.turnaround_days)
        or occupied > end
    ):
        return {"valid": False, "violations": ["growth_duration_or_turnaround"]}
    if initial.policy != "independent_wilting_point_v1" or not initial.confirmed:
        violations.append("initial_condition")
    trace = result.get("trace", {})
    if result.get("reason") is not None or result.get("growing_days") != count:
        violations.append("preparation_state_or_duration")
    if trace.get("initial_condition") != initial.model_dump():
        violations.append("initial_metadata")
    if trace.get("soil_water") != soil.model_dump():
        violations.append("soil_metadata")
    if not _matches(trace.get("effective_rain_fraction"), effective_rain_fraction):
        violations.append("effective_rain_metadata")
    phenology_trace = trace.get("phenology_days", [])
    if len(phenology_trace) != count:
        violations.append("phenology_trace_length")
    if (
        trace.get("water_recipe") != "minimal-nir-dry-initial-and-root-expansion-v1"
        or trace.get("stage_recipe") != "relative-duration-midpoint-linear-kc-root-v1"
    ):
        violations.append("recipe_mismatch")
    if result.get("gdd_recipe") != phenology.gdd_recipe:
        violations.append("gdd_recipe_mismatch")
    expected_cover = [(i + 0.5) / count >= canopy.cover_start_fraction for i in range(count)] + [
        i < canopy.residue_cover_days for i in range(phenology.turnaround_days)
    ]
    if result.get("cover_mask") != expected_cover:
        violations.append("cover_coefficient")
    water_values = result.get("water_mm", [])
    water_trace = trace.get("water_days", [])
    if len(water_values) != count or len(water_trace) != count:
        violations.append("water_series_length")
    cumulative = 0.0
    first_maturity = None
    depletion = 0.0
    previous_taw = 0.0
    water_total = 0.0
    for i in range(count):
        day = sow + timedelta(days=i)
        row = weather.get(day, {})
        raw = [row.get(key) for key in ("tmin_c", "tmax_c", "rain_mm", "et0_mm")]
        if any(
            isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
            for v in raw
        ):
            violations.append(f"weather_missing:{day}")
            continue
        low, high, rain, et0 = (float(v) for v in raw if isinstance(v, (float, int)))
        if low > high or min(rain, et0) < 0:
            violations.append(f"weather_invalid:{day}")
            continue
        if phenology.gdd_recipe == "draft_one_sided_v1":
            low = max(low, phenology.base_c)
            high = min(high, phenology.upper_c)
        else:
            low = min(phenology.upper_c, max(phenology.base_c, low))
            high = min(phenology.upper_c, max(phenology.base_c, high))
        daily_gdd = max(0, (low + high) / 2 - phenology.base_c)
        cumulative += daily_gdd
        if i < len(phenology_trace) and (
            str(phenology_trace[i].get("date")) != day.isoformat()
            or not _matches(phenology_trace[i].get("gdd"), daily_gdd)
            or not _matches(phenology_trace[i].get("cumulative_gdd"), cumulative)
        ):
            violations.append(f"phenology_trace:{day}")
        if first_maturity is None and cumulative >= phenology.maturity_gdd:
            first_maturity = day
        initial_fraction, development_fraction, middle_fraction, late_fraction = (
            canopy.stage_fractions
        )
        progress = (i + 0.5) / count
        k0, km, ke = canopy.kc
        if progress <= initial_fraction:
            stage, kc = 0, k0
        elif progress <= initial_fraction + development_fraction:
            stage, kc = 1, k0 + (km - k0) * (progress - initial_fraction) / development_fraction
        elif progress <= initial_fraction + development_fraction + middle_fraction:
            stage, kc = 2, km
        else:
            stage, kc = (
                3,
                km
                + (ke - km)
                * (progress - initial_fraction - development_fraction - middle_fraction)
                / late_fraction,
            )
        fraction = min(1, max(0, (progress - initial_fraction) / development_fraction))
        root = min(
            soil.depth_m,
            canopy.root_initial_m + (canopy.root_max_m - canopy.root_initial_m) * fraction,
        )
        taw = (soil.field_capacity - soil.wilting_point) * root * 1000
        raw_limit = canopy.depletion_fraction[stage] * taw
        expansion = 0 if i == 0 else taw - previous_taw
        previous = taw if i == 0 else depletion + expansion
        etc = kc * et0
        effective_rain = rain * effective_rain_fraction
        balance = previous + etc - effective_rain
        prior = max(0, balance)
        nir = max(0, prior - raw_limit)
        depletion = prior - nir
        water_total += nir
        if i < len(water_values) and not _matches(water_values[i], nir):
            violations.append(f"nir:{day}")
        expected = {
            "root_depth_m": root,
            "kc": kc,
            "et0_mm": et0,
            "rain_mm": rain,
            "etc_mm": etc,
            "effective_rain_mm": effective_rain,
            "taw_mm": taw,
            "raw_mm": raw_limit,
            "root_expansion_depletion_mm": expansion,
            "depletion_before_mm": previous,
            "depletion_pre_irrigation_mm": prior,
            "nir_mm": nir,
            "depletion_after_mm": depletion,
            "drainage_mm": max(0, -balance),
        }
        if i < len(water_trace):
            if water_trace[i].get("recipe") != "minimal-nir-dry-initial-and-root-expansion-v1":
                violations.append(f"trace:recipe:{day}")
            for key, value in expected.items():
                if not _matches(water_trace[i].get(key), value):
                    violations.append(f"trace:{key}:{day}")
            if (
                water_trace[i].get("initial_policy") != initial.policy
                or water_trace[i].get("initial_evidence_id") != initial.evidence_id
            ):
                violations.append(f"trace:initial_condition:{day}")
        previous_taw = taw
    if first_maturity != harvest:
        violations.append("first_maturity_day")
    if not _matches(result.get("gdd_total"), cumulative):
        violations.append("gdd_total")
    return {
        "valid": not violations,
        "violations": sorted(set(violations)),
        "first_maturity": first_maturity.isoformat() if first_maturity else None,
        "water_mm": water_total,
        "recipe": "independent-phenology-root-water-verifier-v3.0",
        "scope": (
            "frozen weather and declared agronomy, not local calibration "
            "or continuous multiseason simulation"
        ),
    }
