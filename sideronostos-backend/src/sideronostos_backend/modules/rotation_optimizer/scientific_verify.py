"""Recompute selected scientific coefficients from frozen crop/weather inputs.

Intentionally independent of candidates.make_candidate/stage_kc and solver variables.
This checks the declared approximation, not local agronomic validity.
"""

import math
from datetime import date, timedelta
from typing import Any

from .profiles import ProfileV2
from .schemas import Candidate


def verify_scientific_candidates(
    profile: ProfileV2, candidates: list[Candidate], weather: dict[date, dict[str, Any]]
) -> dict[str, Any]:
    crops = {crop.id: crop for crop in profile.crops}
    violations: list[str] = []
    checked: list[dict[str, Any]] = []
    for candidate in candidates:
        identifier = candidate.id
        crop = crops.get(candidate.crop_id)
        if crop is None:
            violations.append(f"unknown_crop:{identifier}")
            continue
        count = (candidate.harvest_date - candidate.sow_date).days + 1
        if count < 1 or count > crop.max_growing_days or len(candidate.water_mm) != count:
            violations.append(f"growth_duration:{identifier}")
            continue
        if not crop.sow_start_mmdd <= candidate.sow_date.strftime("%m-%d") <= crop.sow_end_mmdd:
            violations.append(f"sowing_window:{identifier}")
        if candidate.family != crop.family or candidate.turnaround_days != crop.turnaround_days:
            violations.append(f"crop_identity_or_turnaround:{identifier}")
        if not math.isclose(
            candidate.cost_usd_ha, crop.cost_usd_ha, abs_tol=1e-9
        ) or not math.isclose(candidate.labor_days_ha, crop.labor_days_ha, abs_tol=1e-9):
            violations.append(f"cost_or_labor:{identifier}")
        accumulated = 0.0
        recomputed_water = 0.0
        first_maturity: date | None = None
        complete = True
        for index in range(count):
            day = candidate.sow_date + timedelta(days=index)
            row = weather.get(day, {})
            inputs = [row.get(name) for name in ("tmin_c", "tmax_c", "rain_mm", "et0_mm")]
            if any(
                isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
                for v in inputs
            ):
                violations.append(f"weather_missing:{identifier}:{day}")
                complete = False
                break
            # Runtime validation above excludes None; retain a numeric type for the oracle.
            low, high, rain, et0 = (float(v) for v in inputs if isinstance(v, (float, int)))
            if low > high or rain < 0 or et0 < 0:
                violations.append(f"weather_invalid:{identifier}:{day}")
                complete = False
                break
            if crop.gdd_recipe == "bounded_both_v1":
                low = min(crop.upper_c, max(crop.base_c, low))
                high = min(crop.upper_c, max(crop.base_c, high))
            else:
                low = max(crop.base_c, low)
                high = min(crop.upper_c, high)
            accumulated += max(0, (low + high) / 2 - crop.base_c)
            if first_maturity is None and accumulated >= crop.gdd_required:
                first_maturity = day
            fraction = (index + 0.5) / count
            initial, development, middle, late = crop.stage_fractions
            k0, km, ke = crop.kc
            if fraction <= initial:
                kc = k0
            elif fraction <= initial + development:
                kc = k0 + (km - k0) * (fraction - initial) / development
            elif fraction <= initial + development + middle:
                kc = km
            else:
                kc = km + (ke - km) * (fraction - initial - development - middle) / late
            water = max(0, kc * et0 - profile.effective_rain_fraction * rain)
            recomputed_water += water
            if not math.isclose(water, candidate.water_mm[index], rel_tol=1e-8, abs_tol=1e-7):
                violations.append(f"water_coefficient:{identifier}:{day}")
        if complete and first_maturity != candidate.harvest_date:
            violations.append(f"first_maturity_day:{identifier}")
        checked.append(
            {
                "candidate_id": identifier,
                "gdd_total": accumulated,
                "first_maturity": first_maturity.isoformat() if first_maturity else None,
                "recomputed_water_mm": recomputed_water,
                "complete": complete,
            }
        )
    return {
        "valid": not violations,
        "violations": sorted(set(violations)),
        "candidates": checked,
        "recipe": "independent-crop-weather-verifier-v1",
        "scope": "declared benchmark formulas, not local agronomic validation",
    }
