"""Capacity budgets use the same candidates and transitions as the production MILP."""

from datetime import date, timedelta

from sideronostos_backend.modules.rotation_optimizer.capacity import CapacityLimits, capacity_report
from sideronostos_backend.modules.rotation_optimizer.prepare import generate_candidates
from sideronostos_backend.modules.rotation_optimizer.profiles import get_profile
from sideronostos_backend.modules.rotation_optimizer.schemas import PlanningField
from sideronostos_backend.modules.rotation_optimizer.settings import RotationSettings


def fixture(field_count: int = 4):
    profile = get_profile("iowa-benchmark-20261114-v2")
    start, end = date(2022, 1, 1), date(2024, 12, 31)
    weather = {
        start + timedelta(days=offset): {
            "tmin_c": 12,
            "tmax_c": 25,
            "rain_mm": 2,
            "et0_mm": 4,
        }
        for offset in range((end - start).days + 1)
    }
    fields = [
        PlanningField(id=f"field-{index}", area_ha=32, irrigation_available=True)
        for index in range(field_count)
    ]
    request = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "allowed_crop_ids": [crop.id for crop in profile.crops],
    }
    return profile, fields, weather, request


def report(field_count: int, limits: CapacityLimits):
    profile, fields, weather, request = fixture(field_count)
    prepared = generate_candidates(
        profile=profile,
        fields=fields,
        start=date.fromisoformat(request["start"]),
        end=date.fromisoformat(request["end"]),
        weather=weather,
        allowed_crop_ids=request["allowed_crop_ids"],
        max_candidates=limits.max_candidates,
        truncate_on_limit=True,
    )
    return capacity_report(
        profile=profile,
        fields=fields,
        prepared=prepared,
        request=request,
        limits=limits,
    )


def test_versioned_default_profile_uses_seven_day_sampling() -> None:
    assert get_profile("iowa-benchmark-20261112-v1").sowing_step_days == 14
    assert get_profile("iowa-benchmark-20261114-v2").sowing_step_days == 7
    assert RotationSettings().default_profile_id == "iowa-benchmark-20261114-v2"


def test_four_and_ten_field_capacity_matches_shared_graph_recipe() -> None:
    limits = CapacityLimits(max_candidates=2000, max_transition_edges=50000)
    four = report(4, limits)
    assert four["candidate_count"] == 180
    assert four["transition_edge_count"] == 1800
    assert four["within_capacity"]
    ten = report(10, limits)
    assert ten["candidate_count"] == 450
    assert ten["transition_edge_count"] == 4500
    assert ten["within_capacity"]


def test_preflight_identifies_candidate_and_transition_dimensions() -> None:
    candidate = report(4, CapacityLimits(max_candidates=20, max_transition_edges=50000))
    assert candidate["candidate_count"] == 21
    assert candidate["candidate_count_truncated"]
    assert candidate["transition_edge_count"] is None
    assert [item["dimension"] for item in candidate["violations"]] == ["candidates"]

    transition = report(4, CapacityLimits(max_candidates=2000, max_transition_edges=100))
    assert transition["candidate_count"] == 180
    assert transition["transition_edge_count"] == 101
    assert transition["transition_edge_count_truncated"]
    assert [item["dimension"] for item in transition["violations"]] == [
        "transition_edges"
    ]


def test_capacity_limits_are_environment_settings(monkeypatch) -> None:
    monkeypatch.setenv("ROTATION_MAX_CANDIDATES", "3210")
    monkeypatch.setenv("ROTATION_MAX_TRANSITION_EDGES", "65432")
    settings = RotationSettings()
    assert settings.max_candidates == 3210
    assert settings.max_transition_edges == 65432
