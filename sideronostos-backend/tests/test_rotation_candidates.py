"""Calendar boundaries and historical replay; synthetic fixtures explicitly marked."""

import importlib
import importlib.util
from datetime import date, timedelta

import pytest


def modules():
    root = "sideronostos_backend.modules.rotation_optimizer"
    assert importlib.util.find_spec(root + ".candidates") is not None, (
        "Candidate generation missing"
    )
    return importlib.import_module(root + ".candidates"), importlib.import_module(root + ".schemas")


def crop():
    return {
        "id": "pea",
        "name": "Benchmark pea",
        "family": "Fabaceae",
        "base_c": 10,
        "upper_c": 30,
        "gdd_required": 15,
        "gdd_recipe": "bounded_both_v1",
        "max_growing_days": 365,
        "turnaround_days": 2,
        "sow_start_mmdd": "07-01",
        "sow_end_mmdd": "07-03",
        "kc": [1, 1, 1],
        "stage_fractions": [0.2, 0.3, 0.3, 0.2],
        "cost_usd_ha": 100,
        "labor_days_ha": 2,
        "parameter_origins": {
            k: "BENCHMARK"
            for k in [
                "family",
                "base_c",
                "upper_c",
                "gdd_required",
                "gdd_recipe",
                "max_growing_days",
                "turnaround_days",
                "sow_start_mmdd",
                "sow_end_mmdd",
                "kc",
                "stage_fractions",
                "cost_usd_ha",
                "labor_days_ha",
            ]
        },
    }


def weather():
    return {
        date(2025, 7, 1) + timedelta(days=i): {
            "tmin_c": 10,
            "tmax_c": 20,
            "et0_mm": 5,
            "rain_mm": 2,
        }
        for i in range(12)
    }


def test_threshold_day_is_inclusive_and_turnaround_is_not_cover():
    c, s = modules()
    cp = s.CropV2.model_validate(crop())
    result = c.make_candidate(
        field_id="f",
        crop=cp,
        sow=date(2025, 7, 1),
        end=date(2025, 7, 10),
        weather=weather(),
        effective_rain_fraction=0.8,
    )
    assert result["candidate"].harvest_date == date(2025, 7, 3)
    assert result["candidate"].occupied_until == date(2025, 7, 5)
    assert result["candidate"].water_mm == pytest.approx([3.4, 3.4, 3.4])
    assert result["trace"]["gdd_total"] == 15
    assert result["trace"]["growing_days"] == 3


def test_missing_day_does_not_create_false_maturity():
    c, s = modules()
    w = weather()
    del w[date(2025, 7, 2)]
    result = c.make_candidate(
        field_id="f",
        crop=s.CropV2.model_validate(crop()),
        sow=date(2025, 7, 1),
        end=date(2025, 7, 10),
        weather=w,
        effective_rain_fraction=0.8,
    )
    assert result["candidate"] is None
    assert result["reason"] == "missing_weather"


def test_turnaround_past_horizon_and_unreached_maturity_are_rejected():
    c, s = modules()
    cp = s.CropV2.model_validate(crop())
    r = c.make_candidate(
        field_id="f",
        crop=cp,
        sow=date(2025, 7, 1),
        end=date(2025, 7, 4),
        weather=weather(),
        effective_rain_fraction=0.8,
    )
    assert r["candidate"] is None and r["reason"] == "turnaround_outside_horizon"
    cp = cp.model_copy(update={"gdd_required": 10000})
    r = c.make_candidate(
        field_id="f",
        crop=cp,
        sow=date(2025, 7, 1),
        end=date(2025, 7, 10),
        weather=weather(),
        effective_rain_fraction=0.8,
    )
    assert r["candidate"] is None and r["reason"] == "maturity_unreached"


def test_parameter_provenance_cannot_be_omitted():
    _, s = modules()
    body = crop()
    del body["parameter_origins"]["gdd_required"]
    with pytest.raises(ValueError):
        s.CropV2.model_validate(body)


def test_historical_replay_labels_synthetic_leap_day():
    c, _ = modules()
    source = {
        "start": "2025-01-01",
        "latitude": 42,
        "elevation_m": 310,
        "units": {"ALLSKY_SFC_SW_DWN": "MJ/m^2/day"},
        "days": [
            {
                "date": "2025-02-28",
                "tmin_c": 0,
                "tmax_c": 10,
                "tdew_c": 0,
                "wind_2m_ms": 2,
                "pressure_kpa": 98,
                "shortwave": 10,
                "rain_mm": 2,
                "et0_mm": 1,
                "missing": [],
            }
        ],
    }
    r = c.replay_weather(source, date(2028, 2, 28), date(2028, 2, 29))
    assert r[date(2028, 2, 29)]["source_date"] == "2025-02-28"
    assert r[date(2028, 2, 29)]["synthetic_calendar_day"] is True
    assert r[date(2028, 2, 29)]["weather_basis"] == "historical_replay"
    assert r[date(2028, 2, 28)]["synthetic_calendar_day"] is False


def test_growth_duration_cap_cannot_accumulate_across_unbounded_seasons():
    c, s = modules()
    body = crop()
    body["max_growing_days"] = 4
    body["parameter_origins"]["max_growing_days"] = "BENCHMARK"
    body["gdd_required"] = 100
    result = c.make_candidate(
        field_id="f",
        crop=s.CropV2.model_validate(body),
        sow=date(2025, 7, 1),
        end=date(2025, 7, 10),
        weather=weather(),
        effective_rain_fraction=0.8,
    )
    assert result["candidate"] is None
    assert result["reason"] == "phenology_duration_limit"
