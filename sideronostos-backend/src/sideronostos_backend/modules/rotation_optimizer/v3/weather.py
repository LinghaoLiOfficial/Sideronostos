"""Validate a published raw-variable weather snapshot before deterministic replay."""

import re
from datetime import date, timedelta
from typing import Any

from ...agri_data.adapters.power import PARAMETERS
from ...agri_data.recipes import ET0_RECIPE, finite_number
from ..candidates import replay_weather
from .inputs import PlanningDraft
from .profiles import ProfileV3


def prepare_weather(
    raw: dict[str, Any], profile: ProfileV3, draft: PlanningDraft
) -> dict[str, Any]:
    issues: set[str] = set()
    invalid_dates: list[str] = []
    warnings = ["not_future_forecast", "regional_background_not_field_station"]
    if raw.get("release_id") != profile.weather_release_id:
        issues.add("weather_release_identity_mismatch")
    if any(
        not re.fullmatch(r"[a-fA-F0-9]{64}", str(raw.get(key, "")))
        for key in ("manifest_sha256", "content_sha256")
    ):
        issues.add("weather_provenance_missing")
    if raw.get("data_kind") != "observed_historical":
        issues.add("weather_not_historical")
    if raw.get("recipe") != ET0_RECIPE:
        issues.add("weather_recipe_unsupported")
    try:
        if (
            abs(finite_number(raw.get("longitude"), "longitude") - profile.weather_center[0])
            > 0.001
            or abs(finite_number(raw.get("latitude"), "latitude") - profile.weather_center[1])
            > 0.001
        ):
            issues.add("weather_release_location_mismatch")
    except ValueError:
        issues.add("weather_release_location_mismatch")
    expected_time = (
        "UTC" if profile.weather_day_policy == "utc_daily_proxy_v1" else profile.timezone
    )
    if raw.get("time_standard") != expected_time:
        issues.add("weather_day_mismatch")
    if profile.weather_day_policy == "utc_daily_proxy_v1":
        warnings.append("utc_aggregate_not_local_day")
        if not draft.accept_engineering_assumptions:
            issues.add("weather_day_proxy_unaccepted")
    units = raw.get("units")
    if not isinstance(units, dict):
        units = {}
    for key, (_, unit, _, _) in PARAMETERS.items():
        allowed = {unit, "kW-hr/m^2/day"} if key == "ALLSKY_SFC_SW_DWN" else {unit}
        if units.get(key) not in allowed:
            issues.add("weather_unit_mismatch")
    rows = raw.get("days")
    if not isinstance(rows, list):
        rows = []
    try:
        first, last = date.fromisoformat(raw["start"]), date.fromisoformat(raw["end"])
        expected = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)}
        dates = [r["date"] for r in rows]
        if (
            first != date(first.year, 1, 1)
            or last != date(first.year, 12, 31)
            or len(dates) != len(set(dates))
            or set(dates) != expected
        ):
            raise ValueError("Complete historical year required")
    except (ValueError, KeyError, TypeError):
        issues.add("weather_calendar_incomplete")
    for row in rows:
        try:
            for _, (name, _, low, high) in PARAMETERS.items():
                if not low <= finite_number(row.get(name), name) <= high:
                    raise ValueError("Raw variable outside adapter range")
            if row["tmin_c"] > row["tmax_c"] or row["tdew_c"] > row["tmax_c"] or row.get("missing"):
                raise ValueError("Inconsistent or QA-rejected weather")
        except (ValueError, TypeError, AttributeError):
            invalid_dates.append(
                str(row.get("date", "unknown")) if isinstance(row, dict) else "unknown"
            )
    if invalid_dates:
        issues.add("weather_daily_invalid")
    replay = {}
    if not issues:
        try:
            replay = replay_weather(raw, draft.start, draft.end, **draft.scenario.model_dump())
            if any(r.get("et0_mm") is None for r in replay.values()):
                issues.add("weather_et0_unavailable")
        except (ValueError, KeyError, TypeError, OverflowError):
            issues.add("weather_replay_invalid")
    return {
        "ready": not issues,
        "issues": sorted(issues),
        "warnings": warnings,
        "invalid_dates": invalid_dates,
        "calendar_policy": profile.weather_day_policy,
        "agricultural_timezone": profile.timezone,
        "source_time_standard": raw.get("time_standard"),
        "release_id": raw.get("release_id"),
        "manifest_sha256": raw.get("manifest_sha256"),
        "source_kind": raw.get("source_kind"),
        "source_start": raw.get("start"),
        "source_end": raw.get("end"),
        "basis": "scenario"
        if draft.scenario.temperature_change_c or draft.scenario.rainfall_change_pct
        else "historical_replay",
        "days": {day.isoformat(): row for day, row in replay.items()} if not issues else {},
    }
