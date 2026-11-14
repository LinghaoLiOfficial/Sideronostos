"""Date-based GDD maturity, declared stage Kc, and labelled historical replay."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ..agri_data.recipes import fao56_et0, finite_number, gdd
from .schemas import Candidate, CropV2


def replay_weather(
    source: dict[str, Any],
    start: date,
    end: date,
    *,
    temperature_change_c: float = 0,
    rainfall_change_pct: float = 0,
) -> dict[date, dict[str, Any]]:
    delta = finite_number(temperature_change_c, "temperature change")
    rain_change = finite_number(rainfall_change_pct, "rainfall change")
    if not -3 <= delta <= 5 or not -50 <= rain_change <= 50 or end < start:
        raise ValueError("Invalid replay scenario")
    indexed = {row["date"][5:]: row for row in source["days"]}
    if len(indexed) != len(source["days"]):
        raise ValueError("Replay requires one explicitly selected historical year")
    result: dict[date, dict[str, Any]] = {}
    for i in range((end - start).days + 1):
        day = start + timedelta(days=i)
        mmdd = day.strftime("%m-%d")
        synthetic = mmdd == "02-29" and mmdd not in indexed
        old = indexed.get("02-28" if synthetic else mmdd)
        if old is None:
            result[day] = {"date": day.isoformat(), "missing": ["historical_day"]}
            continue
        row = dict(old)
        row.update(
            date=day.isoformat(),
            source_date=old["date"],
            synthetic_calendar_day=synthetic,
            weather_basis="scenario" if delta or rain_change else "historical_replay",
            replay_recipe="month-day-repeat-feb28-v1",
        )
        # Preserve dewpoint depression under temperature shifts; not a climate forecast.
        for name in ("tmin_c", "tmax_c", "tdew_c"):
            if row.get(name) is not None:
                row[name] += delta
        if row.get("rain_mm") is not None:
            row["rain_mm"] *= 1 + rain_change / 100
        names = ("tmin_c", "tmax_c", "tdew_c", "wind_2m_ms", "pressure_kpa", "shortwave")
        row["et0_mm"] = None
        if all(row.get(name) is not None for name in names):
            try:
                row["et0_mm"] = fao56_et0(
                    day=day,
                    latitude=source["latitude"],
                    elevation_m=source["elevation_m"],
                    **{name: row[name] for name in names},
                    shortwave_unit=source["units"]["ALLSKY_SFC_SW_DWN"],
                )
            except ValueError:
                row["et0_missing_reason"] = "invalid_or_unsupported_scenario"
        result[day] = row
    return result


def historical_weather(
    source: dict[str, Any],
    start: date,
    end: date,
    *,
    temperature_change_c: float = 0,
    rainfall_change_pct: float = 0,
) -> dict[date, dict[str, Any]]:
    """Select an observed historical window and apply a labelled sensitivity scenario."""
    delta = finite_number(temperature_change_c, "temperature change")
    rain_change = finite_number(rainfall_change_pct, "rainfall change")
    if not -3 <= delta <= 5 or not -50 <= rain_change <= 50 or end < start:
        raise ValueError("Invalid historical scenario")
    indexed = {date.fromisoformat(row["date"]): row for row in source["days"]}
    result: dict[date, dict[str, Any]] = {}
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        old = indexed.get(day)
        if old is None:
            result[day] = {"date": day.isoformat(), "missing": ["historical_day"]}
            continue
        row = dict(old)
        row.update(
            weather_basis="scenario" if delta or rain_change else "observed_historical",
            scenario_recipe="add-temperature-scale-rainfall-recompute-et0-v1",
        )
        for name in ("tmin_c", "tmax_c", "tdew_c"):
            if row.get(name) is not None:
                row[name] += delta
        if row.get("rain_mm") is not None:
            row["rain_mm"] *= 1 + rain_change / 100
        names = ("tmin_c", "tmax_c", "tdew_c", "wind_2m_ms", "pressure_kpa", "shortwave")
        row["et0_mm"] = None
        if all(row.get(name) is not None for name in names):
            row["et0_mm"] = fao56_et0(
                day=day,
                latitude=source["latitude"],
                elevation_m=source["elevation_m"],
                **{name: row[name] for name in names},
                shortwave_unit=source["units"]["ALLSKY_SFC_SW_DWN"],
            )
        result[day] = row
    return result


def stage_kc(crop: CropV2, fraction: float) -> float:
    initial, development, middle, late = crop.stage_fractions
    k0, km, ke = crop.kc
    if fraction <= initial:
        return k0
    if fraction <= initial + development:
        return k0 + (km - k0) * (fraction - initial) / development
    if fraction <= initial + development + middle:
        return km
    return km + (ke - km) * (fraction - initial - development - middle) / late


def make_candidate(
    *,
    field_id: str,
    crop: CropV2,
    sow: date,
    end: date,
    weather: dict[date, dict[str, Any]],
    effective_rain_fraction: float,
) -> dict[str, Any]:
    if not 0 <= finite_number(effective_rain_fraction, "effective rain") <= 1:
        raise ValueError("Invalid effective rain fraction")
    total = 0.0
    trace: list[dict[str, Any]] = []
    harvest = None
    if end < sow:
        return {"candidate": None, "reason": "outside_horizon"}
    if not crop.sow_start_mmdd <= sow.strftime("%m-%d") <= crop.sow_end_mmdd:
        return {"candidate": None, "reason": "outside_sowing_window"}
    for offset in range(min((end - sow).days + 1, crop.max_growing_days)):
        day = sow + timedelta(days=offset)
        row = weather.get(day, {})
        if any(row.get(k) is None for k in ("tmin_c", "tmax_c", "rain_mm", "et0_mm")):
            return {"candidate": None, "reason": "missing_weather", "date": day.isoformat()}
        daily = gdd(row["tmin_c"], row["tmax_c"], crop.base_c, crop.upper_c, recipe=crop.gdd_recipe)
        total += daily
        trace.append(
            {
                "date": day.isoformat(),
                "gdd": daily,
                "cumulative_gdd": total,
                "source_date": row.get("source_date", day.isoformat()),
            }
        )
        if total >= crop.gdd_required:
            harvest = day
            break
    if harvest is None:
        return {
            "candidate": None,
            "reason": (
                "phenology_duration_limit"
                if (end - sow).days + 1 > crop.max_growing_days
                else "maturity_unreached"
            ),
            "gdd_total": total,
        }
    if harvest + timedelta(days=crop.turnaround_days) > end:
        return {"candidate": None, "reason": "turnaround_outside_horizon"}
    water: list[float] = []
    for i, item in enumerate(trace):
        day = date.fromisoformat(item["date"])
        row = weather[day]
        kc = stage_kc(crop, (i + 0.5) / len(trace))
        demand = row["et0_mm"] * kc
        gap = max(0.0, demand - row["rain_mm"] * effective_rain_fraction)
        water.append(gap)
        item.update(
            kc=kc,
            et0_mm=row["et0_mm"],
            rain_mm=row["rain_mm"],
            crop_demand_mm=demand,
            supplemental_gap_mm=gap,
        )
    candidate = Candidate(
        id=f"{field_id}:{crop.id}:{sow.isoformat()}",
        field_id=field_id,
        crop_id=crop.id,
        family=crop.family,
        sow_date=sow,
        harvest_date=harvest,
        turnaround_days=crop.turnaround_days,
        water_mm=water,
        cost_usd_ha=crop.cost_usd_ha,
        labor_days_ha=crop.labor_days_ha,
    )
    return {
        "candidate": candidate,
        "reason": None,
        "trace": {
            "gdd_total": total,
            "gdd_recipe": crop.gdd_recipe,
            "growing_days": len(trace),
            "days": trace,
            "water_recipe": "daily-positive-kc-et0-minus-effective-rain-v1",
            "stage_recipe": "relative-growing-duration-linear-kc-v1",
            "effective_rain_fraction": effective_rain_fraction,
            "limitations": [
                "No soil storage, runoff, drainage or irrigation efficiency model.",
                "Cost and labour are uniformly allocated over growing days.",
            ],
        },
    }
