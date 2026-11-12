"""Deterministic recipes. Reference: FAO-56 chapters 3–4; no LLM arithmetic."""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import date

ET0_RECIPE = "fao56-daily-dewpoint-v1"


def finite_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def gdd(tmin: float, tmax: float, base: float, upper: float, *, recipe: str) -> float:
    lo, hi, b, u = [finite_number(v, "temperature") for v in (tmin, tmax, base, upper)]
    if lo > hi or b >= u or lo < -100 or hi > 70:
        raise ValueError("Invalid temperature order or crop thresholds")
    if recipe == "draft_one_sided_v1":
        lo, hi = max(lo, b), min(hi, u)
    elif recipe == "bounded_both_v1":
        lo, hi = max(b, min(lo, u)), max(b, min(hi, u))
    else:
        raise ValueError("Unknown GDD recipe")
    return max(0.0, (lo + hi) / 2 - b)


def saturation_pressure(t: float) -> float:
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def fao56_et0(
    *,
    day: date,
    latitude: float,
    elevation_m: float,
    tmin_c: float,
    tmax_c: float,
    tdew_c: float,
    wind_2m_ms: float,
    pressure_kpa: float,
    shortwave: float,
    shortwave_unit: str,
) -> float:
    """Daily reference ET, mm/day; G=0, grass albedo=.23, dewpoint humidity.

    Rso near zero is unsupported rather than assigning fake polar-night radiation.
    Rs/Rso is clipped to [0.3,1] for the cloudiness factor (FAO-56 chapter 3).
    The clipped cloud factor and nonnegative ET are explicit recipe choices.
    """
    vals = (latitude, elevation_m, tmin_c, tmax_c, tdew_c, wind_2m_ms, pressure_kpa, shortwave)
    for v in vals:
        finite_number(v, "ET0 input")
    if not (
        -90 <= latitude <= 90
        and -500 <= elevation_m <= 9000
        and -100 <= tmin_c <= tmax_c <= 70
        and -100 <= tdew_c <= tmax_c
        and 0 <= wind_2m_ms <= 100
        and 10 <= pressure_kpa <= 120
        and shortwave >= 0
    ):
        raise ValueError("ET0 input outside supported physical range")
    factors = {
        "kW-hr/m^2/day": 3.6,
        "kWh/m2/day": 3.6,
        "kWh/m²/day": 3.6,
        "MJ/m^2/day": 1.0,
        "MJ/m²/day": 1.0,
        "W/m^2": 0.0864,
    }
    if shortwave_unit not in factors:
        raise ValueError("Unrecognized radiation unit")
    rs = shortwave * factors[shortwave_unit]
    t = (tmin_c + tmax_c) / 2
    es = (saturation_pressure(tmin_c) + saturation_pressure(tmax_c)) / 2
    ea = saturation_pressure(tdew_c)
    if ea > es + 0.05:
        raise ValueError("Dewpoint inconsistent with daily temperatures")
    delta = 4098 * saturation_pressure(t) / (t + 237.3) ** 2
    gamma = 0.000665 * pressure_kpa
    j = day.timetuple().tm_yday
    phi = math.radians(latitude)
    dr = 1 + 0.033 * math.cos(2 * math.pi * j / 365)
    declination = 0.409 * math.sin(2 * math.pi * j / 365 - 1.39)
    ws = math.acos(max(-1, min(1, -math.tan(phi) * math.tan(declination))))
    ra = (
        24
        * 60
        / math.pi
        * 0.0820
        * dr
        * (
            ws * math.sin(phi) * math.sin(declination)
            + math.cos(phi) * math.cos(declination) * math.sin(ws)
        )
    )
    rso = (0.75 + 0.00002 * elevation_m) * ra
    if rso < 0.01:
        raise ValueError("Polar-night radiation needs a separate validated recipe")
    cloud = 1.35 * max(0.3, min(1, rs / rso)) - 0.35
    rnl = 4.903e-9 * ((tmax_c + 273.16) ** 4 + (tmin_c + 273.16) ** 4) / 2
    rnl *= (0.34 - 0.14 * math.sqrt(ea)) * cloud
    rn = 0.77 * rs - rnl
    et = 0.408 * delta * rn + gamma * 900 / (t + 273) * wind_2m_ms * max(0, es - ea)
    return max(0, et / (delta + gamma * (1 + 0.34 * wind_2m_ms)))


def window_change(values: Sequence[float | None], *, days: int) -> float | None:
    if days < 1:
        raise ValueError("Window days must be positive")
    if len(values) < 2 * days:
        return None
    recent = values[-2 * days :]
    if any(v is None for v in recent):
        return None
    clean = [finite_number(v, "window value") for v in recent]
    return sum(clean[days:]) / days - sum(clean[:days]) / days
