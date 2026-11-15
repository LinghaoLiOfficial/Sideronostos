"""Input readiness uses server requirements, owned versions and explicit units."""

import importlib
import importlib.util
from copy import deepcopy

import pytest
from rotation_v3_application_helpers import PROFILE, draft, field

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def check(payload=None, fields=None):
    assert importlib.util.find_spec(ROOT + ".preflight") is not None, (
        "v3 application preflight is missing"
    )
    m = importlib.import_module(ROOT + ".preflight")
    inputs = importlib.import_module(ROOT + ".inputs")
    profiles = importlib.import_module(ROOT + ".profiles")
    return m.assess_inputs(
        inputs.PlanningDraft.model_validate(payload or draft()),
        profiles.get_profile(PROFILE),
        fields or [field()],
    )


def issues(result):
    return {reason for row in result["items"] for reason in row["issues"]}


def test_complete_input_ready_but_distinct_from_candidate_and_solver_success():
    result = check()
    assert result["ready"]
    assert result["stage"] == "input_preflight"
    assert result["scope"] == "benchmark_not_locally_calibrated"
    assert result["field_versions"] == [
        {"id": "field-1", "version": 1, "farm_id": "farm-1", "partition_revision": "partition-1"}
    ]


def test_empty_operating_draft_reports_each_missing_domain_without_zero_defaults():
    p = draft()
    p["field_conditions"] = {}
    p["farm_resources"] = {}
    p["baseline"] = []
    result = check(p)
    assert not result["ready"]
    assert {
        "soil_water",
        "soil_suitability",
        "terrain",
        "management",
        "history",
        "baseline",
        "water_resources",
        "machine_resources",
        "seed_resources",
        "market_resources",
    } <= set(result["blocked_features"])
    row = next(r for r in result["items"] if r["path"] == "fields.field-1.field_capacity")
    assert row["value"] is None and "value_missing" in row["issues"]


@pytest.mark.parametrize(
    "change, reason",
    [
        (
            lambda p: p.update(accept_engineering_assumptions=False),
            "engineering_assumption_unaccepted",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["field_capacity"].update(
                value=0.1
            ),
            "invalid_soil_water",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["mechanical_access"].update(
                value="yes"
            ),
            "invalid_value",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["history_state"].update(
                value="unknown"
            ),
            "history_unknown",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["initial_water_policy"].update(
                value="measured_wet"
            ),
            "unsupported_initial_water_policy",
        ),
        (
            lambda p: p["sources"]["farmer"].update(applicable_end="2027-06-30"),
            "outside_time_scope",
        ),
        (lambda p: p["sources"]["farmer"].update(region_id="other-region"), "outside_region"),
        (
            lambda p: p["farm_resources"]["farm-1"]["daily"]["water-1"]["default"]["amount"].update(
                unit="mm"
            ),
            "unit_mismatch",
        ),
        (
            lambda p: p["farm_resources"]["farm-1"]["daily"]["water-1"].update(water_basis="gross"),
            "value_missing",
        ),
        (
            lambda p: p["field_conditions"]["field-1"].update(water_system_id="unknown"),
            "water_system_missing",
        ),
        (
            lambda p: p["farm_resources"]["farm-1"]["daily"]["tractor-1"].update(field_ids=[]),
            "machine_membership_missing",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["baseline_confirmed"].update(
                value=False
            ),
            "confirmation_required",
        ),
        (
            lambda p: p["farm_resources"]["farm-1"]["daily"]["water-1"]["default"].update(
                remediable=True
            ),
            "value_missing",
        ),
        (lambda p: p["farm_resources"]["farm-1"]["period_limits"].pop(), "value_missing"),
        (lambda p: p["fields"][0].update(expected_version=2), "field_version_changed"),
        (lambda p: p["baseline"][0].update(sow_date="2027-02-01"), "baseline_outside_sow_window"),
    ],
)
def test_missing_or_incoherent_evidence_blocks_inputs(change, reason):
    p = draft()
    change(p)
    result = check(p)
    assert not result["ready"]
    assert reason in issues(result)


def test_sourced_zero_capacity_is_valid_input_not_claim_of_feasible_plan():
    p = draft()
    p["farm_resources"]["farm-1"]["daily"]["water-1"]["default"]["amount"]["value"] = 0
    assert check(p)["ready"]


def test_resource_cannot_include_another_farm_or_duplicate_water_assignment():
    p = draft()
    p["farm_resources"]["farm-1"]["daily"]["tractor-1"]["field_ids"] = ["foreign"]
    assert "invalid_resource_membership" in issues(check(p))
    p = draft()
    p["farm_resources"]["farm-1"]["daily"]["water-2"] = deepcopy(
        p["farm_resources"]["farm-1"]["daily"]["water-1"]
    )
    assert "ambiguous_water_system" in issues(check(p))


def test_required_features_cannot_be_disabled_or_coefficient_injected():
    assert importlib.util.find_spec(ROOT + ".inputs") is not None, "v3 inputs are missing"
    cls = importlib.import_module(ROOT + ".inputs").PlanningDraft
    for key, value in [
        ("enabled_features", []),
        ("candidates", []),
        ("disabled_metrics", {"water": "skip"}),
    ]:
        p = draft()
        p[key] = value
        with pytest.raises(ValueError):
            cls.model_validate(p)


def test_region_and_farm_membership_checks_are_server_side():
    f = field().model_copy(update={"longitude": 10.0})
    assert "outside_weather_coverage" in issues(check(fields=[f]))
    f = field().model_copy(update={"farm_id": None})
    assert "farm_association_missing" in issues(check(fields=[f]))


def test_legacy_history_preserves_year_precision_and_rejects_unknown_catalogue():
    from datetime import date

    from sideronostos_backend.modules.field_shift.schemas import HistoryEntry
    from sideronostos_backend.modules.rotation_optimizer.v3.preflight import resolve_history
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    p = get_profile(PROFILE)
    f = field().model_copy(
        update={
            "profile_id": "iowa-benchmark-20261112-v1",
            "history": [HistoryEntry(year=2025, crop_id="oat")],
        }
    )
    result = resolve_history(f, p, date(2027, 1, 1))
    assert result[0].end_latest == date(2025, 12, 31)
    assert result[0].precision == "year"
    assert result[0].species_id == "avena-sativa"
    with pytest.raises(ValueError, match="history_catalogue_incompatible"):
        resolve_history(f.model_copy(update={"profile_id": "unknown"}), p, date(2027, 1, 1))


@pytest.mark.parametrize("bad", [float("inf"), float("nan"), {"nested": float("nan")}, [1, 2]])
def test_public_draft_rejects_non_json_or_structured_scalar_values(bad):
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft

    payload = draft()
    payload["field_conditions"]["field-1"]["values"]["ph"]["value"] = bad
    with pytest.raises(ValueError):
        PlanningDraft.model_validate(payload)


def test_long_valid_resource_identity_still_produces_a_readiness_report():
    p = draft()
    resources = p["farm_resources"]["farm-1"]["daily"]
    name = "w" * 80
    resources[name] = resources.pop("water-1")
    p["field_conditions"]["field-1"]["water_system_id"] = name
    resources[name]["overrides"] = {
        "2027-03-01": {"value": 0, "unit": "m3/day", "source_ids": ["farmer"]}
    }
    assert check(p)["ready"]


def test_fully_qualified_long_resource_path_is_bounded_as_a_path_not_an_id():
    import json

    farmid = "12345678-1234-1234-1234-123456789012"
    p = json.loads(json.dumps(draft()).replace("farm-1", farmid))
    resources = p["farm_resources"][farmid]["daily"]
    name = "w" * 80
    resources[name] = resources.pop("water-1")
    p["field_conditions"]["field-1"]["water_system_id"] = name
    resources[name]["overrides"] = {
        "2027-03-01": {"value": 0, "unit": "m3/day", "source_ids": ["farmer"]}
    }
    assert check(p, fields=[field().model_copy(update={"farm_id": farmid})])["ready"]
