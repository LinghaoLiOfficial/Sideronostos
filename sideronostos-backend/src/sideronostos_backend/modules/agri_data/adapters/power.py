"""NASA POWER Daily JSON -> daily observations; offline only, UTC release."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

from ..recipes import ET0_RECIPE, fao56_et0, finite_number

PARAMETERS = {
    "T2M_MIN": ("tmin_c", "C", -100, 70),
    "T2M_MAX": ("tmax_c", "C", -100, 70),
    "T2MDEW": ("tdew_c", "C", -100, 70),
    "WS2M": ("wind_2m_ms", "m/s", 0, 100),
    "PS": ("pressure_kpa", "kPa", 10, 120),
    "PRECTOTCORR": ("rain_mm", "mm/day", 0, 3000),
    "ALLSKY_SFC_SW_DWN": ("shortwave", "MJ/m^2/day", 0, 100),
}


def parse_power(
    payload: dict[str, Any], *, latitude: float, longitude: float, start: date, end: date
) -> dict[str, Any]:
    lat, lon = finite_number(latitude, "latitude"), finite_number(longitude, "longitude")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or end < start:
        raise ValueError("Invalid requested extent")
    try:
        header = payload["header"]
        coords = payload["geometry"]["coordinates"]
        if (
            abs(finite_number(coords[0], "longitude") - lon) > 0.001
            or abs(finite_number(coords[1], "latitude") - lat) > 0.001
        ):
            raise ValueError("POWER response location mismatch")
        elevation = finite_number(coords[2], "elevation")
        if (
            header.get("time_standard") != "UTC"
            or str(header["start"]) != start.strftime("%Y%m%d")
            or str(header["end"]) != end.strftime("%Y%m%d")
        ):
            raise ValueError("POWER response time window mismatch")
        units = payload["parameters"]
        for key, (_, unit, _, _) in PARAMETERS.items():
            got = units[key]["units"]
            allowed = {unit, "kW-hr/m^2/day"} if key == "ALLSKY_SFC_SW_DWN" else {unit}
            if got not in allowed:
                raise ValueError(f"Unsupported POWER units for {key}")
        values = payload["properties"]["parameter"]
        if any(key not in values for key in PARAMETERS):
            raise ValueError("Missing requested POWER variable")
    except (KeyError, IndexError, TypeError) as error:
        raise ValueError("Malformed POWER response") from error
    fill = header.get("fill_value", -999)
    days: list[dict[str, Any]] = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        stamp = day.strftime("%Y%m%d")
        row: dict[str, Any] = {"date": day.isoformat(), "missing": []}
        for key, (field, _, low, high) in PARAMETERS.items():
            try:
                val = finite_number(values[key].get(stamp), key)
                if val == fill or not low <= val <= high:
                    raise ValueError("Invalid value")
                row[field] = val
            except (ValueError, TypeError, AttributeError):
                row[field] = None
                row["missing"].append(key)
        if row["tmin_c"] is not None and row["tmax_c"] is not None:
            if row["tmin_c"] > row["tmax_c"]:
                row["tmin_c"] = row["tmax_c"] = None
                row["missing"].extend(["T2M_MIN", "T2M_MAX"])
        row["et0_mm"] = None
        row["et0_missing_reason"] = "missing_input"
        names = ("tmin_c", "tmax_c", "tdew_c", "wind_2m_ms", "pressure_kpa", "shortwave")
        if all(row[name] is not None for name in names):
            try:
                row["et0_mm"] = fao56_et0(
                    day=day,
                    latitude=lat,
                    elevation_m=elevation,
                    **{name: row[name] for name in names},
                    shortwave_unit=units["ALLSKY_SFC_SW_DWN"]["units"],
                )
                row["et0_missing_reason"] = None
            except ValueError:
                row["et0_missing_reason"] = "invalid_or_unsupported_input"
        days.append(row)
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return {
        "product": "NASA_POWER_DAILY",
        "recipe": ET0_RECIPE,
        "latitude": lat,
        "longitude": lon,
        "elevation_m": elevation,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_standard": "UTC",
        "data_kind": "observed_historical",
        "support_scope": "regional_background",
        "source_kind": "reanalysis_and_satellite_inputs",
        "content_sha256": digest,
        "units": {key: units[key]["units"] for key in PARAMETERS},
        "days": days,
        "expected_days": len(days),
        "complete_days": sum(not d["missing"] and d["et0_mm"] is not None for d in days),
    }
