from datetime import date

import pytest

from sideronostos_backend.modules.field_shift.schemas import FieldInput
from sideronostos_backend.modules.rotation_optimizer.requests import RunRequest, resolve_history


def body(**changes):
    return {
        "idempotency_key": "request-1",
        "profile_id": "iowa-benchmark-20261112-v1",
        "fields": [{"id": "field-a", "expected_version": 1, "history_reviewed": True}],
        "start": "2027-01-01",
        "end": "2029-12-31",
        "allowed_crop_ids": ["maize", "pea"],
        "farm_limits": {
            str(y): {"water_m3": 50000, "cost_usd": 10000, "labor_days": 100}
            for y in range(2027, 2030)
        },
        "accept_benchmark_assumptions": True,
        **changes,
    }


def test_public_request_cannot_supply_coefficients_or_ownership():
    assert RunRequest.model_validate(body()).start == date(2027, 1, 1)
    for changes in (
        {"owner_user_id": "someone"},
        {"candidates": []},
        {"end": "2033-01-01"},
        {"farm_limits": {}},
        {"fields": [{"id": "f", "expected_version": 1, "history_reviewed": False}]},
        {"accept_benchmark_assumptions": False},
    ):
        with pytest.raises(ValueError):
            RunRequest.model_validate(body(**changes))


def test_history_preserves_precision_resolves_families_and_deduplicates_link():
    from sideronostos_backend.modules.rotation_optimizer.profiles import get_profile

    p = get_profile("iowa-benchmark-20261112-v1")
    field = FieldInput(
        name="f",
        area_ha=2,
        latitude=42,
        longitude=-93.5,
        soil_texture="loam",
        irrigation_available=True,
        profile_id="temperate-demo",
        history=[{"year": 2025, "crop_id": "wheat"}],
        history_events=[
            {
                "id": "event",
                "crop_id": "wheat",
                "profile_id": p.id,
                "precision": "month",
                "end_year": 2025,
                "end_month": 7,
                "linked_legacy_year": 2025,
            }
        ],
    )
    history = resolve_history(field, p, date(2027, 1, 1))
    assert len(history) == 1
    assert history[0].family == "Poaceae" and history[0].end_latest == date(2025, 7, 31)
    assert history[0].precision == "month"
    field.history_events = []
    assert resolve_history(field, p, date(2027, 1, 1))[0].end_latest == date(2025, 12, 31)
    field.history[0].crop_id = "invented"
    with pytest.raises(ValueError, match="catalogue"):
        resolve_history(field, p, date(2027, 1, 1))


@pytest.mark.parametrize(
    "window", [("04-31", "05-01"), ("4-2", "05-01"), ("05-02", "05-01"), ("02-29", "03-01")]
)
def test_sowing_calendar_errors_rejected_before_job_submission(window):
    with pytest.raises(ValueError, match="Sowing"):
        RunRequest.model_validate(body(sow_windows={"maize": window}))
