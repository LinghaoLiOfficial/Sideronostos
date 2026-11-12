"""Deterministic candidate preparation; sampling and exclusions are part of the snapshot."""

from collections import Counter
from datetime import date, timedelta
from typing import Any

from .candidates import make_candidate
from .profiles import ProfileV2
from .schemas import Candidate, PlanningField

CANDIDATE_RECIPE = "gdd-duration-bounded-kc-grid-v1"


def generate_candidates(
    *,
    profile: ProfileV2,
    fields: list[PlanningField],
    start: date,
    end: date,
    weather: dict[date, dict[str, Any]],
    allowed_crop_ids: list[str],
    max_candidates: int = 240,
    sow_windows: dict[str, tuple[str, str]] | None = None,
) -> dict[str, Any]:
    crops = {crop.id: crop for crop in profile.crops}
    if not allowed_crop_ids or not set(allowed_crop_ids) <= crops.keys():
        raise ValueError("Unknown crop or empty crop selection")
    if len(set(allowed_crop_ids)) != len(allowed_crop_ids):
        raise ValueError("Duplicate crop selection")
    windows = sow_windows or {}
    if not set(windows) <= set(allowed_crop_ids):
        raise ValueError("Sowing window references an unselected crop")
    for identifier, (first, last) in windows.items():
        crop = crops[identifier]
        date.fromisoformat(f"2001-{first}")
        date.fromisoformat(f"2001-{last}")
        if not crop.sow_start_mmdd <= first <= last <= crop.sow_end_mmdd:
            raise ValueError("Sowing windows may only narrow the published profile window")
    candidates: list[Candidate] = []
    traces: dict[str, Any] = {}
    rejected: list[dict[str, str]] = []
    for field in fields:
        for crop_id in allowed_crop_ids:
            crop = crops[crop_id]
            first, last = windows.get(crop_id, (crop.sow_start_mmdd, crop.sow_end_mmdd))
            for year in range(start.year, end.year + 1):
                day = date.fromisoformat(f"{year}-{first}")
                stop = min(end, date.fromisoformat(f"{year}-{last}"))
                while day <= stop:
                    if day >= start:
                        generated = make_candidate(
                            field_id=field.id,
                            crop=crop,
                            sow=day,
                            end=end,
                            weather=weather,
                            effective_rain_fraction=profile.effective_rain_fraction,
                        )
                        candidate = generated["candidate"]
                        if candidate is None:
                            rejected.append(
                                {
                                    "field_id": field.id,
                                    "crop_id": crop_id,
                                    "sow_date": day.isoformat(),
                                    "reason": generated["reason"],
                                }
                            )
                        else:
                            candidates.append(candidate)
                            traces[candidate.id] = generated["trace"]
                            if len(candidates) > max_candidates:
                                raise ValueError(
                                    "Generated candidate limit exceeded; "
                                    "reduce fields, crops or dates"
                                )
                    day += timedelta(days=profile.sowing_step_days)
    return {
        "candidates": candidates,
        "traces": traces,
        "rejected": rejected,
        "rejected_by_reason": dict(Counter(row["reason"] for row in rejected)),
        "sampling_step_days": profile.sowing_step_days,
        "recipe": CANDIDATE_RECIPE,
        "optimality_scope": "generated_candidate_set",
    }
