"""Daily deterministic preprocessing, explicit dry initial state and water units.

The water recipe applies NASA-modeling.md's minimal NIR recursion after rebasing the
previous depletion to the current rooting volume. Newly explored soil is explicitly
assumed at wilting point, so growing roots do not manufacture free water. This is an
independent, conservative scenario, not a continuous multiseason water simulation.
"""

from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import Any

from ...agri_data.recipes import finite_number, gdd
from .contracts import Canopy, InitialWater, Phenology, SoilWater

WATER_RECIPE = "minimal-nir-dry-initial-and-root-expansion-v1"
STAGE_RECIPE = "relative-duration-midpoint-linear-kc-root-v1"


def maturity(
    crop: Phenology,
    sow: date,
    end: date,
    weather: Mapping[date, Mapping[str, Any]],
) -> dict[str, Any]:
    if end < sow:
        return {"reason": "outside_horizon", "harvest_date": None}
    accumulated = 0.0
    trace = []
    for offset in range(min(crop.max_growing_days, (end - sow).days + 1)):
        day = sow + timedelta(days=offset)
        row = weather.get(day, {})
        if row.get("tmin_c") is None or row.get("tmax_c") is None:
            return {"reason": "missing_weather", "date": day, "harvest_date": None}
        daily = gdd(row["tmin_c"], row["tmax_c"], crop.base_c, crop.upper_c, recipe=crop.gdd_recipe)
        accumulated += daily
        trace.append({"date": day, "gdd": daily, "cumulative_gdd": accumulated})
        if accumulated >= crop.maturity_gdd:
            occupied_until = day + timedelta(days=crop.turnaround_days)
            if occupied_until > end:
                return {"reason": "turnaround_outside_horizon", "harvest_date": None}
            return {
                "reason": None,
                "harvest_date": day,
                "occupied_until": occupied_until,
                "growing_days": offset + 1,
                "gdd_total": accumulated,
                "gdd_recipe": crop.gdd_recipe,
                "days": trace,
            }
    return {
        "reason": "phenology_duration_limit"
        if (end - sow).days + 1 > crop.max_growing_days
        else "maturity_unreached",
        "harvest_date": None,
        "gdd_total": accumulated,
    }


def growth_stages(
    canopy: Canopy, *, growing_days: int, turnaround_days: int
) -> list[dict[str, float]]:
    if growing_days < 1 or turnaround_days < 0 or canopy.residue_cover_days > turnaround_days:
        raise ValueError("Invalid growth duration or residue cover outside occupancy")
    initial, development, middle, late = canopy.stage_fractions
    k0, km, ke = canopy.kc
    result = []
    for offset in range(growing_days):
        progress = (offset + 0.5) / growing_days
        if progress <= initial:
            stage, kc = 0, k0
        elif progress <= initial + development:
            stage, kc = 1, k0 + (km - k0) * (progress - initial) / development
        elif progress <= initial + development + middle:
            stage, kc = 2, km
        else:
            stage, kc = 3, km + (ke - km) * (progress - initial - development - middle) / late
        root_fraction = max(0.0, min(1.0, (progress - initial) / development))
        root = canopy.root_initial_m + root_fraction * (canopy.root_max_m - canopy.root_initial_m)
        result.append(
            {"kc": kc, "root_depth_m": root, "depletion_fraction": canopy.depletion_fraction[stage]}
        )
    return result


def cover_days(canopy: Canopy, *, growing_days: int, turnaround_days: int) -> list[bool]:
    if growing_days < 1 or turnaround_days < canopy.residue_cover_days:
        raise ValueError("Cover cannot extend outside candidate occupancy")
    return [
        (i + 0.5) / growing_days >= canopy.cover_start_fraction for i in range(growing_days)
    ] + [i < canopy.residue_cover_days for i in range(turnaround_days)]


def root_water_balance(
    *,
    soil: SoilWater,
    initial: InitialWater,
    et0_mm: Sequence[float],
    rain_mm: Sequence[float],
    kc: Sequence[float],
    root_depth_m: Sequence[float],
    depletion_fraction: Sequence[float],
    effective_rain_fraction: Sequence[float],
) -> list[dict[str, Any]]:
    sequences = (et0_mm, rain_mm, kc, root_depth_m, depletion_fraction, effective_rain_fraction)
    if not et0_mm or any(len(values) != len(et0_mm) for values in sequences):
        raise ValueError("Every water input must cover each growing day")
    result = []
    depletion = 0.0
    last_taw = 0.0
    water_per_m = 1000 * (soil.field_capacity - soil.wilting_point)
    for i, values in enumerate(zip(*sequences, strict=True)):
        et0, rain, coefficient, depth, fraction, efficiency = [
            finite_number(value, "daily water input") for value in values
        ]
        if min(et0, rain, coefficient) < 0 or not 0 < fraction <= 1 or not 0 <= efficiency <= 1:
            raise ValueError("Invalid daily water coefficient")
        if depth <= 0:
            raise ValueError("Rooting depth must be positive")
        depth = min(depth, soil.depth_m)
        taw = water_per_m * depth
        if taw < last_taw - 1e-9:
            raise ValueError("Root contraction requires a different validated water recipe")
        raw = fraction * taw
        expansion = taw - last_taw if i else 0.0
        before = depletion + expansion if i else taw
        demand = coefficient * et0
        effective_rain = efficiency * rain
        unbounded = before + demand - effective_rain
        pre_irrigation = max(0.0, unbounded)
        irrigation = max(0.0, pre_irrigation - raw)
        depletion = pre_irrigation - irrigation
        result.append(
            {
                "et0_mm": et0,
                "rain_mm": rain,
                "kc": coefficient,
                "effective_rain_mm": effective_rain,
                "etc_mm": demand,
                "root_depth_m": depth,
                "taw_mm": taw,
                "raw_mm": raw,
                "depletion_before_mm": before,
                "root_expansion_depletion_mm": expansion,
                "depletion_pre_irrigation_mm": pre_irrigation,
                "nir_mm": irrigation,
                "depletion_after_mm": depletion,
                "drainage_mm": max(0.0, -unbounded),
                "initial_policy": initial.policy,
                "initial_evidence_id": initial.evidence_id,
                "recipe": WATER_RECIPE,
            }
        )
        last_taw = taw
    return result


def prepare_growth(
    *,
    phenology: Phenology,
    canopy: Canopy,
    soil: SoilWater,
    initial: InitialWater,
    sow: date,
    end: date,
    weather: Mapping[date, Mapping[str, Any]],
    effective_rain_fraction: float,
) -> dict[str, Any]:
    """Bundle validated maturity, stage, cover and water coefficients with their trace."""
    if not 0 <= finite_number(effective_rain_fraction, "effective rain fraction") <= 1:
        raise ValueError("Invalid effective rain fraction")
    growth = maturity(phenology, sow, end, weather)
    if growth["reason"] is not None:
        return growth
    count = growth["growing_days"]
    rows = []
    for i in range(count):
        day = sow + timedelta(days=i)
        row = weather.get(day, {})
        if row.get("et0_mm") is None or row.get("rain_mm") is None:
            return {"reason": "missing_weather", "date": day, "harvest_date": None}
        rows.append(row)
    stages = growth_stages(canopy, growing_days=count, turnaround_days=phenology.turnaround_days)
    water = root_water_balance(
        soil=soil,
        initial=initial,
        et0_mm=[row["et0_mm"] for row in rows],
        rain_mm=[row["rain_mm"] for row in rows],
        kc=[row["kc"] for row in stages],
        root_depth_m=[row["root_depth_m"] for row in stages],
        depletion_fraction=[row["depletion_fraction"] for row in stages],
        effective_rain_fraction=[effective_rain_fraction] * count,
    )
    return {
        **{key: value for key, value in growth.items() if key != "days"},
        "water_mm": [row["nir_mm"] for row in water],
        "cover_mask": cover_days(
            canopy, growing_days=count, turnaround_days=phenology.turnaround_days
        ),
        "trace": {
            "phenology_days": growth["days"],
            "water_days": water,
            "water_recipe": WATER_RECIPE,
            "stage_recipe": STAGE_RECIPE,
            "initial_condition": initial.model_dump(),
            "soil_water": soil.model_dump(),
            "effective_rain_fraction": effective_rain_fraction,
            "limitations": [
                "Independent dry-initial candidates, not continuous multiseason water balance.",
                "New rooting volume is assumed at wilting point; all replenishment is charged.",
                "No capillary-rise credit or off-season carry-over; excess effective rain drains.",
                (
                    "Minimum net root-zone irrigation under the declared no-stress threshold, "
                    "not gross diversion."
                ),
            ],
        },
    }
