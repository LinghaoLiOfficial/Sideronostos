"""Independent arithmetic and provider-contract tests; fixtures are synthetic."""

import importlib
import importlib.util
from datetime import date

import pytest


def load_recipes():
    module = "sideronostos_backend.modules.agri_data"
    assert importlib.util.find_spec(module) is not None, "Science recipes are not implemented"
    return importlib.import_module(module + ".recipes")


def test_daily_gdd_preserves_explicit_one_sided_recipe():
    recipes = load_recipes()
    # An extreme cold day distinguishes the original draft from double clipping.
    assert recipes.gdd(-20, -10, 10, 30, recipe="draft_one_sided_v1") == 0
    assert recipes.gdd(35, 40, 10, 30, recipe="draft_one_sided_v1") == 22.5
    assert recipes.gdd(35, 40, 10, 30, recipe="bounded_both_v1") == 20
    assert recipes.gdd(10, 20, 10, 30, recipe="bounded_both_v1") == 5


@pytest.mark.parametrize("tmin,tmax", [(20, 10), (float("nan"), 20), (True, 20)])
def test_gdd_rejects_invalid_temperatures(tmin, tmax):
    recipes = load_recipes()
    with pytest.raises(ValueError):
        recipes.gdd(tmin, tmax, 10, 30, recipe="bounded_both_v1")


def test_radiation_units_do_not_change_et0():
    recipes = load_recipes()
    args = dict(
        day=date(2025, 7, 6),
        latitude=42,
        elevation_m=310,
        tmin_c=15,
        tmax_c=27,
        tdew_c=12,
        wind_2m_ms=2,
        pressure_kpa=98,
    )
    a = recipes.fao56_et0(**args, shortwave=6, shortwave_unit="kW-hr/m^2/day")
    b = recipes.fao56_et0(**args, shortwave=21.6, shortwave_unit="MJ/m^2/day")
    assert 3 < a < 7
    assert a == pytest.approx(b, abs=1e-10)


def test_et0_cannot_use_missing_or_mislabelled_radiation():
    recipes = load_recipes()
    args = dict(
        day=date(2025, 7, 6),
        latitude=42,
        elevation_m=310,
        tmin_c=15,
        tmax_c=27,
        tdew_c=12,
        wind_2m_ms=2,
        pressure_kpa=98,
    )
    with pytest.raises(ValueError):
        recipes.fao56_et0(**args, shortwave=-999, shortwave_unit="MJ/m^2/day")
    with pytest.raises(ValueError):
        recipes.fao56_et0(**args, shortwave=6, shortwave_unit="unknown")


def test_seven_day_change_needs_fourteen_days():
    recipes = load_recipes()
    assert recipes.window_change([0.2] * 7, days=7) is None
    assert recipes.window_change([0.2] * 7 + [0.22] * 7, days=7) == pytest.approx(0.02)
    assert recipes.window_change([None] + [0.2] * 6 + [0.22] * 7, days=7) is None


def test_fao56_published_daily_example_18():
    # FAO-56 chapter 4 example 18, rounded intermediate inputs: 3.9 mm/day.
    # 12.08 C dewpoint represents the example's 1.409 kPa actual vapour pressure.
    recipes = load_recipes()
    result = recipes.fao56_et0(
        day=date(2025, 7, 6),
        latitude=50.8,
        elevation_m=100,
        tmin_c=12.3,
        tmax_c=21.5,
        tdew_c=12.08,
        wind_2m_ms=2.078,
        pressure_kpa=100.1,
        shortwave=22.07,
        shortwave_unit="MJ/m^2/day",
    )
    assert result == pytest.approx(3.9, abs=0.05)


def power_sample():
    return {
        "header": {
            "start": "20250706",
            "end": "20250707",
            "fill_value": -999,
            "time_standard": "UTC",
        },
        "geometry": {"coordinates": [-93.5, 42, 310]},
        "parameters": {
            k: {"units": u}
            for k, u in [
                ("T2M_MIN", "C"),
                ("T2M_MAX", "C"),
                ("T2MDEW", "C"),
                ("WS2M", "m/s"),
                ("PS", "kPa"),
                ("PRECTOTCORR", "mm/day"),
                ("ALLSKY_SFC_SW_DWN", "MJ/m^2/day"),
            ]
        },
        "properties": {
            "parameter": {
                k: {"20250706": v, "20250707": v}
                for k, v in [
                    ("T2M_MIN", 15),
                    ("T2M_MAX", 27),
                    ("T2MDEW", 12),
                    ("WS2M", 2),
                    ("PS", 98),
                    ("PRECTOTCORR", 2),
                    ("ALLSKY_SFC_SW_DWN", 21.6),
                ]
            }
        },
    }


def power_adapter():
    load_recipes()
    assert importlib.util.find_spec("sideronostos_backend.modules.agri_data.adapters") is not None
    return importlib.import_module("sideronostos_backend.modules.agri_data.adapters.power")


def parse_sample(payload):
    return power_adapter().parse_power(
        payload, latitude=42, longitude=-93.5, start=date(2025, 7, 6), end=date(2025, 7, 7)
    )


def test_daily_power_retains_nulls_and_does_not_call_missing_rain_zero():
    payload = power_sample()
    del payload["properties"]["parameter"]["PRECTOTCORR"]["20250707"]
    result = parse_sample(payload)
    assert len(result["days"]) == 2
    assert result["days"][0]["rain_mm"] == 2
    assert result["days"][1]["rain_mm"] is None
    assert result["days"][1]["et0_mm"] is not None
    assert result["complete_days"] == 1
    assert result["days"][1]["missing"] == ["PRECTOTCORR"]


@pytest.mark.parametrize("fault", ["timezone", "units", "position", "bool_position", "period"])
def test_power_rejects_wrong_request_identity(fault):
    payload = power_sample()
    if fault == "timezone":
        payload["header"]["time_standard"] = "LST"
    if fault == "units":
        payload["parameters"]["PS"]["units"] = "Pa"
    if fault == "position":
        payload["geometry"]["coordinates"][1] = 40
    if fault == "bool_position":
        payload["geometry"]["coordinates"][1] = True
    if fault == "period":
        payload["header"]["start"] = "20250705"
    with pytest.raises(ValueError):
        parse_sample(payload)


def test_power_et0_missing_input_remains_unavailable():
    payload = power_sample()
    payload["properties"]["parameter"]["T2MDEW"]["20250706"] = -999
    result = parse_sample(payload)
    assert result["days"][0]["et0_mm"] is None
    assert result["days"][0]["rain_mm"] == 2
    assert result["days"][0]["missing"] == ["T2MDEW"]
