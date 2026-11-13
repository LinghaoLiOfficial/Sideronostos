"""Climate contract checks; generated weather below is test data, not NASA evidence."""

import calendar
import importlib
import importlib.util
import math
from datetime import date

import httpx
import pytest


def test_climate_adapter_is_available():
    assert (
        importlib.util.find_spec("sideronostos_backend.modules.field_shift.environment") is not None
    )


@pytest.fixture
def adapter():
    name = "sideronostos_backend.modules.field_shift.environment"
    assert importlib.util.find_spec(name) is not None, "Climate adapter is not implemented"
    return importlib.import_module(name)


def power_payload(year=2025):
    values = {key: {} for key in ("T2M_MIN", "T2M_MAX", "PRECTOTCORR")}
    for month in range(1, 13):
        for day in range(1, calendar.monthrange(year, month)[1] + 1):
            stamp = date(year, month, day).strftime("%Y%m%d")
            for key, value in zip(values, (10.0, 20.0, 2.0), strict=True):
                values[key][stamp] = value
    return {
        "header": {
            "fill_value": -999,
            "start": f"{year}0101",
            "end": f"{year}1231",
            "time_standard": "UTC",
        },
        "geometry": {"coordinates": [-93.5, 42, 310]},
        "parameters": {
            "T2M_MIN": {"units": "C"},
            "T2M_MAX": {"units": "C"},
            "PRECTOTCORR": {"units": "mm/day"},
        },
        "properties": {"parameter": values},
    }


def test_monthly_aggregation_preserves_totals_units_and_provenance(adapter):
    result = adapter.aggregate_power(power_payload(), 42, -93.5, 2025)
    assert result.status == "live"
    assert len(result.months) == 12
    assert result.months[0].rainfall_mm == 62
    assert result.months[1].rainfall_mm == 56
    assert result.months[0].tmin_c == 10
    assert result.months[0].tmax_c == 20
    assert result.months[0].valid_days == 31
    assert {e.kind for e in result.evidence} >= {"observation", "estimate"}
    assert result.fetched_at is not None
    assert "20250101" in result.source_url


@pytest.mark.parametrize("bad", [-999, None, float("nan"), -1])
def test_bad_precipitation_does_not_become_zero_or_partial_month_total(adapter, bad):
    payload = power_payload()
    payload["properties"]["parameter"]["PRECTOTCORR"]["20250104"] = bad
    result = adapter.aggregate_power(payload, 42, -93.5, 2025)
    assert result.months[0].rainfall_mm is None
    assert result.months[0].valid_days == 30
    assert result.months[0].tmin_c == 10
    assert result.months[1].rainfall_mm == 56
    assert any("缺测" in item for item in result.limitations)


def test_missing_or_reversed_temperatures_produce_null_et(adapter):
    payload = power_payload()
    del payload["properties"]["parameter"]["T2M_MIN"]["20250201"]
    payload["properties"]["parameter"]["T2M_MAX"]["20250301"] = 1
    result = adapter.aggregate_power(payload, 42, -93.5, 2025)
    assert result.months[1].tmin_c is None
    assert result.months[1].reference_et_mm is None
    assert result.months[2].reference_et_mm is None
    assert result.months[2].valid_days == 30


def test_fingerprint_depends_on_data_location_not_fetch_timestamp(adapter):
    payload = power_payload()
    a = adapter.aggregate_power(payload, 42, -93.5, 2025)
    b = adapter.aggregate_power(payload, 42, -93.5, 2025)
    assert a.fingerprint == b.fingerprint
    payload["properties"]["parameter"]["PRECTOTCORR"]["20250101"] = 3
    assert adapter.aggregate_power(payload, 42, -93.5, 2025).fingerprint != a.fingerprint


@pytest.mark.parametrize("fault", ["units", "dates", "location", "empty"])
def test_wrong_provider_contract_is_rejected(adapter, fault):
    payload = power_payload()
    if fault == "units":
        payload["parameters"]["T2M_MIN"]["units"] = "F"
    elif fault == "dates":
        payload["header"]["start"] = "20240101"
    elif fault == "location":
        payload["geometry"]["coordinates"] = [0, 0]
    else:
        payload["properties"]["parameter"] = {}
    with pytest.raises(ValueError):
        adapter.aggregate_power(payload, 42, -93.5, 2025)


def test_hargreaves_uses_equivalent_evaporation_units_and_finite_poles(adapter):
    # FAO56 equations 21/52: July Ra near 40 MJ/m2/day at 42N;
    # convert Ra with 0.408 before Hargreaves, giving roughly 4.5 mm/day.
    value = adapter.estimate_reference_et(7, 15, 25, 42, 2025)
    assert 135 < value < 150
    assert adapter.estimate_reference_et(7, 17, 27, 42, 2025) > value
    assert math.isfinite(adapter.estimate_reference_et(7, 15, 25, 90, 2025))
    assert adapter.estimate_reference_et(1, -30, -20, 90, 2025) == 0
    with pytest.raises(ValueError):
        adapter.estimate_reference_et(7, 25, 15, 42, 2025)


def test_demo_et_uses_same_requested_latitude_as_the_engine(adapter):
    result = adapter.demo_environment(-25, 10, 2025, "test failure")
    july = result.months[6]
    assert july.reference_et_mm == adapter.estimate_reference_et(
        7, july.tmin_c, july.tmax_c, -25, 2025
    )


def test_malformed_parameter_arrays_are_rejected(adapter):
    payload = power_payload()
    payload["properties"]["parameter"]["T2M_MIN"] = []
    with pytest.raises(ValueError):
        adapter.aggregate_power(payload, 42, -93.5, 2025)


@pytest.mark.asyncio
async def test_real_adapter_request_has_explicit_dates_and_utc(adapter):
    def handler(request):
        assert request.url.params["time-standard"] == "UTC"
        assert request.url.params["start"] == "20250101"
        assert request.url.params["longitude"] == "-93.5"
        return httpx.Response(200, json=power_payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await adapter.fetch_environment(42, -93.5, 2025, client=client)
    assert result.status == "live"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "http", "malformed"])
async def test_provider_failure_is_explicit_synthetic_fallback(adapter, failure):
    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("provider timeout", request=request)
        if failure == "http":
            return httpx.Response(503)
        return httpx.Response(200, json={"bad": "shape"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await adapter.fetch_environment(42, -93.5, 2025, client=client)
    assert result.status == "demo"
    assert result.fetched_at is None
    assert result.source_url is None
    assert len(result.months) == 12
    assert all(m.valid_days == 0 for m in result.months)
    assert any(e.kind == "demonstration" for e in result.evidence)
    assert any("当前位置" in x for x in result.limitations)


@pytest.mark.asyncio
async def test_invalid_coordinates_do_not_trigger_synthetic_fallback(adapter):
    with pytest.raises(ValueError):
        await adapter.fetch_environment(91, 0, 2025)


@pytest.mark.parametrize(
    "coordinates,latitude,longitude",
    [
        ([float("nan"), 42], 42, -93.5),
        ([-93.5, float("nan")], 42, -93.5),
        ([float("inf"), 42], 42, -93.5),
        ([-93.5, float("-inf")], 42, -93.5),
        ([False, 42], 42, 0),
        ([-93.5, True], 1, -93.5),
        (["-93.5", 42], 42, -93.5),
        ([-93.5, "42"], 42, -93.5),
        ([-93.5], 42, -93.5),
        ([], 42, -93.5),
        (None, 42, -93.5),
        ({"longitude": -93.5, "latitude": 42}, 42, -93.5),
        ([[1], 42], 42, -93.5),
        ([181, 42], 42, -93.5),
        ([-93.5, -91], 42, -93.5),
    ],
)
def test_provider_coordinates_must_be_finite_numbers_in_a_valid_coordinate_array(
    adapter, coordinates, latitude, longitude
):
    # NaN comparison and Python's bool-is-int behavior must never verify location.
    payload = power_payload()
    payload["geometry"]["coordinates"] = coordinates
    with pytest.raises(ValueError):
        adapter.aggregate_power(payload, latitude, longitude, 2025)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "geometry",
    [
        None,
        [],
        {},
        {"coordinates": []},
        {"coordinates": [False, 42]},
        {"coordinates": ["west", 42]},
    ],
)
async def test_malformed_provider_geometry_returns_explicit_demo_fallback(adapter, geometry):
    payload = power_payload()
    payload["geometry"] = geometry

    def handler(request):
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await adapter.fetch_environment(42, 0, 2025, client=client)
    assert result.status == "demo"
    assert result.fetched_at is None
    assert all(month.valid_days == 0 for month in result.months)
