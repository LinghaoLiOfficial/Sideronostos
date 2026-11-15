"""Weather is raw-variable checked and time-aligned before daily v3 preparation."""

import importlib
import importlib.util

import pytest
from rotation_v3_application_helpers import PROFILE, draft, weather

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def assess(raw=None, profile=None):
    assert importlib.util.find_spec(ROOT + ".weather") is not None, (
        "v3 weather preflight is missing"
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    m = importlib.import_module(ROOT + ".weather")
    return m.prepare_weather(
        raw or weather(), profile or get_profile(PROFILE), PlanningDraft.model_validate(draft())
    )


def test_replay_is_derived_from_raw_variables_with_explicit_utc_proxy():
    result = assess()
    assert result["ready"]
    assert len(result["days"]) == 365
    assert result["days"]["2027-01-01"]["et0_mm"] > 0
    assert result["calendar_policy"] == "utc_daily_proxy_v1"
    assert result["basis"] == "historical_replay"
    assert "not_future_forecast" in result["warnings"]
    assert "utc_aggregate_not_local_day" in result["warnings"]


@pytest.mark.parametrize(
    "change,reason",
    [
        (lambda w: w["units"].update(PRECTOTCORR="m/day"), "weather_unit_mismatch"),
        (lambda w: w["days"][0].update(rain_mm=-1), "weather_daily_invalid"),
        (lambda w: w["days"][0].update(tmax_c=None), "weather_daily_invalid"),
        (lambda w: w["days"][0].update(tmax_c=True), "weather_daily_invalid"),
        (lambda w: w["days"][0].update(missing=["T2M_MAX"]), "weather_daily_invalid"),
        (lambda w: w["days"].pop(), "weather_calendar_incomplete"),
        (lambda w: w["days"].append(w["days"][0]), "weather_calendar_incomplete"),
        (lambda w: w.update(latitude=20.0), "weather_release_location_mismatch"),
        (lambda w: w.update(time_standard="LST"), "weather_day_mismatch"),
        (lambda w: w.update(manifest_sha256="bad"), "weather_provenance_missing"),
        (lambda w: w.update(release_id="other"), "weather_release_identity_mismatch"),
    ],
)
def test_unusable_weather_fails_closed_without_fake_coefficients(change, reason):
    raw = weather()
    change(raw)
    result = assess(raw)
    assert not result["ready"]
    assert reason in result["issues"]
    assert result["days"] == {}


@pytest.mark.parametrize(
    "change",
    [
        lambda w: w.update(units=[]),
        lambda w: w["days"].__setitem__(0, None),
        lambda w: w.update(data_kind="forecast"),
    ],
)
def test_malformed_or_nonhistorical_release_is_reported_without_exception(change):
    raw = weather()
    change(raw)
    assert not assess(raw)["ready"]
