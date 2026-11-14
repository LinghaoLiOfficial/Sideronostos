"""Actual Gurobi end-to-end execution from a frozen daily-v3 input snapshot."""

import importlib
import importlib.util

from rotation_v3_application_helpers import PROFILE, draft, field, weather

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def snapshot():
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import (
        get_profile,
        profile_hash,
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.service import fingerprint

    profile = get_profile(PROFILE)
    request = {
        **draft(),
        "idempotency_key": "synthetic-execution-1",
        "model_version": "rotation-milp-v3.0",
    }
    result = {
        "schema": "rotation-input-v3.0",
        "request": request,
        "fields": [field().model_dump(mode="json")],
        "farms": [{"id": "farm-1", "version": 1, "data": {"partition_revision": "partition-1"}}],
        "profile": profile.model_dump(mode="json"),
        "weather": weather(),
        "provenance": {
            "profile_id": profile.id,
            "profile_sha256": profile_hash(profile),
            "weather_sha256": "a" * 64,
        },
    }
    result["readiness"] = {"ready": True, "fingerprint": fingerprint(result)}
    return result


def execute(value=None, **kwargs):
    assert importlib.util.find_spec(ROOT + ".execution") is not None, "v3 job execution is missing"
    return importlib.import_module(ROOT + ".execution").execute_snapshot(
        value or snapshot(), time_limit=5, **kwargs
    )


def test_full_snapshot_yields_verified_baseline_and_distinct_options():
    result = execute()
    assert result["status"] == "optimal", result
    assert result["model_version"] == "rotation-milp-v3.0"
    assert len(result["options"]) == 2
    first, second = result["options"]
    assert {s["id"] for s in first["seasons"]} != {s["id"] for s in second["seasons"]}
    assert all(
        o["scientific_verification"]["valid"] and o["verification"]["valid"]
        for o in result["options"]
    )
    assert set(first["verification"]["metrics"]) == {
        "profit",
        "water",
        "rotation",
        "soil",
        "risk",
        "bare",
    }
    assert result["baseline"]["complete"] and result["baseline"]["feasible"]
    assert result["weather_basis"] == "historical_replay"
    assert first["execution_label"] == "engineering_benchmark"
    assert result["alternatives"]["scope"] == "generated_candidate_set"


def test_execution_rejects_changed_snapshot_instead_of_reloading_live_fields():
    value = snapshot()
    value["fields"][0]["area_ha"] = 200.0
    result = execute(value)
    assert result["status"] == "failed" and result["error_code"] == "snapshot_integrity_mismatch"
    assert not result.get("options")


def test_cancelled_execution_cannot_publish_options():
    result = execute(cancelled=lambda: True)
    assert result["status"] == "cancelled"
    assert result["options"] == []


def test_soft_resource_gaps_are_saved_as_diagnostics_not_implementation_claims():
    from rotation_v3_application_helpers import record

    from sideronostos_backend.modules.rotation_optimizer.v3.service import fingerprint

    value = snapshot()
    value.pop("readiness")
    cap = value["request"]["farm_resources"]["farm-1"]["daily"]["tractor-1"]["default"]
    cap.update(
        amount=record(0.0, "h/day"),
        remediable=True,
        gap_unit_cost=record(30.0, "USD/h"),
        remedy=record("Confirmed availability still required", "text"),
    )
    value["readiness"] = {"ready": True, "fingerprint": fingerprint(value)}
    result = execute(value)
    assert result["status"] == "optimal"
    option = result["options"][0]
    assert option["feasible"] and option["verification"]["diagnostic"]
    assert not option["verification"]["resource_feasible"]
    assert option["execution_label"] == "diagnostic_requires_remedies"
    assert option["verification"]["gap_cost"] == 60.0


def test_legacy_dispatch_recognizes_v3_frozen_version():
    from sideronostos_backend.modules.rotation_optimizer.execution import execute_snapshot

    result = execute_snapshot(snapshot(), time_limit=5)
    assert result["model_version"] == "rotation-milp-v3.0"
    assert result["status"] == "optimal"


def test_alternative_preferences_find_a_real_profit_water_tradeoff():
    result = execute()
    first = result["options"][0]["verification"]["metrics"]
    alternatives = [o["verification"]["metrics"] for o in result["options"][1:]]
    # In this sourced fixture peas save water; maize has higher estimated profit.
    assert any(o["profit"] > first["profit"] and o["water"] > first["water"] for o in alternatives)
    assert any(o["non_dominated_among_generated"] for o in result["options"][1:])


def test_real_weather_search_finds_soil_tradeoff_beyond_water_and_profit():
    import json
    from pathlib import Path

    from sideronostos_backend.modules.rotation_optimizer.v3.service import fingerprint

    value = snapshot()
    value.pop("readiness")
    # A checked-in public NASA release, not a network call or generated result fixture.
    path = (
        Path(__file__).resolve().parents[2]
        / "output/evidence/fields-bot-v3/power-iowa-2025-prepared.json"
    )
    raw = json.loads(path.read_text())
    value["weather"] = {**value["weather"], **raw}
    value["readiness"] = {"ready": True, "fingerprint": fingerprint(value)}
    result = execute(value)
    first = result["options"][0]["verification"]["metrics"]
    # With this historical weather, maize wins water and profit, but peas improve
    # the explicitly assumed soil contribution. The latter is a real model tradeoff.
    assert any(
        o["verification"]["metrics"]["soil"] > first["soil"] and o["non_dominated_among_generated"]
        for o in result["options"][1:]
    ), result["alternatives"]
