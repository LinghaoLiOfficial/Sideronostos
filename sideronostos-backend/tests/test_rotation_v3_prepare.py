"""Compile sourced farmer inputs into actual-day candidate and resource coefficients."""

import importlib
import importlib.util
from datetime import date

import pytest
from rotation_v3_application_helpers import PROFILE, draft, field, record, weather

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def prepare(payload=None, fields=None, raw=None):
    assert importlib.util.find_spec(ROOT + ".prepare") is not None, (
        "v3 candidate preparation is missing"
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    return importlib.import_module(ROOT + ".prepare").prepare_problem(
        draft=PlanningDraft.model_validate(payload or draft()),
        profile=get_profile(PROFILE),
        fields=fields or [field()],
        raw_weather=raw or weather(),
    )


def test_preparation_expands_daily_resources_and_retains_confirmed_off_grid_baseline():
    p = draft()
    p["baseline"][0]["sow_date"] = "2027-04-21"
    result = prepare(p)
    assert result["ready"], result.get("errors")
    problem = result["problem"]
    baseline = next(c for c in problem.candidates if c.id in result["baseline_ids"])
    assert baseline.sow_date == date(2027, 4, 21)
    assert baseline.baseline_confirmed
    assert len(problem.daily_resources[0].days) == 365
    assert len(problem.period_resources) == 4
    assert all(c.suitability.eligible for c in problem.candidates)
    assert result["verification"]["valid"]
    assert result["sampling"]["includes_confirmed_baseline_dates"]


def test_actual_sow_and_harvest_operations_and_all_six_coefficients():
    result = prepare()
    p = result["problem"]
    c = next(c for c in p.candidates if c.crop_id == "maize")
    assert c.machine_hours_ha["tractor-1"] == {c.sow_date: 1.0}
    assert c.machine_hours_ha["harvester-1"] == {c.harvest_date: 1.5}
    assert c.profit_usd_ha == pytest.approx(600.0)
    assert c.soil_score == pytest.approx(0.5)
    assert 0 <= c.risk_score <= 1
    assert len(c.water_mm) == (c.harvest_date - c.sow_date).days + 1
    assert len(c.cover_mask) == len(c.water_mm) + 14
    assert (
        result["traces"][c.id]["growth"]["trace"]["initial_condition"]["policy"]
        == "independent_wilting_point_v1"
    )
    assert (
        result["traces"][c.id]["risk"]["interpretation"]
        == "historical exposure and irrigation dependence, not yield-loss probability"
    )


def test_gross_water_is_converted_once_and_date_exception_overrides_default():
    p = draft()
    w = p["farm_resources"]["farm-1"]["daily"]["water-1"]
    w["water_basis"] = "gross"
    w["irrigation_efficiency"] = record(0.6)
    w["overrides"] = {"2027-01-02": record(200.0, "m3/day")}
    result = prepare(p)
    assert result["ready"]
    water_resource = next(r for r in result["problem"].daily_resources if r.kind == "water")
    assert water_resource.days[date(2027, 1, 1)].capacity == 600
    assert water_resource.days[date(2027, 1, 2)].capacity == 120
    assert water_resource.days[date(2027, 1, 3)].capacity == 600


@pytest.mark.parametrize(
    "mutation,reason",
    [
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["ph"].update(value=9.0),
            "soil_unsuitable",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["slope_deg"].update(value=20.0),
            "terrain_unsuitable",
        ),
        (
            lambda p: p["field_conditions"]["field-1"]["values"]["mechanical_access"].update(
                value=False
            ),
            "mechanical_access_unavailable",
        ),
        (
            lambda p: p["field_conditions"]["field-1"].update(forbidden_crop_ids=["maize"]),
            "baseline_crop_prohibited",
        ),
        (
            lambda p: p["farm_resources"]["farm-1"]["daily"]["tractor-1"]["default"][
                "amount"
            ].update(value=0),
            "hard_machine_capacity",
        ),
        (
            lambda p: p["farm_resources"]["farm-1"]["period_limits"][0]["limit"]["amount"].update(
                value=0
            ),
            "hard_seed_capacity",
        ),
    ],
)
def test_hard_limits_and_unsuitable_confirmed_baseline_block_before_solver(mutation, reason):
    p = draft()
    mutation(p)
    result = prepare(p)
    assert not result["ready"]
    assert result["problem"] is None
    assert reason in str(result)


def test_soft_zero_capacity_keeps_candidates_and_sourced_remedies():
    p = draft()
    c = p["farm_resources"]["farm-1"]["daily"]["tractor-1"]["default"]
    c.update(
        amount=record(0.0, "h/day"),
        remediable=True,
        gap_unit_cost=record(30.0, "USD/h"),
        remedy=record("Hire contractor after confirmation", "text"),
    )
    result = prepare(p)
    assert result["ready"]
    cap = result["problem"].daily_resources[1].days[date(2027, 4, 20)]
    assert cap.remediable and cap.capacity == 0 and cap.gap_unit_cost == 30
    assert cap.evidence_ids == ["input:farmer"]


def test_missing_inputs_never_reach_scientific_preparation_or_solver():
    p = draft()
    p["field_conditions"]["field-1"]["values"].pop("field_capacity")
    result = prepare(p)
    assert not result["ready"] and result["problem"] is None
    assert result["stage"] == "data_preflight"


def test_missing_irrigation_does_not_gain_a_water_system_from_optimizer():
    p = draft()
    p["field_conditions"]["field-1"]["water_system_id"] = None
    p["farm_resources"]["farm-1"]["daily"].pop("water-1")
    result = prepare(p, fields=[field().model_copy(update={"irrigation_available": False})])
    assert not result["ready"]
    assert "irrigation_unavailable" in str(result)


def test_disabled_optional_metrics_remain_null_but_yield_is_still_required():
    p = draft()
    p["disabled_metrics"] = {
        "profit": "No local price confidence",
        "rotation": "No locally calibrated transition score",
        "soil": "No calibrated contribution score",
        "risk": "No calibrated risk weights",
    }
    p["weights"] = {
        "profit": 0.0,
        "rotation": 0.0,
        "soil": 0.0,
        "risk": 0.0,
        "water": 0.5,
        "bare": 0.5,
    }
    result = prepare(p)
    assert result["ready"]
    model = result["problem"]
    assert set(model.scales) == {"water", "bare"}
    assert not model.rotation_benefits
    assert all(
        c.profit_usd_ha is None
        and c.soil_score is None
        and c.risk_score is None
        and c.yield_kg_ha > 0
        for c in model.candidates
    )


def test_candidate_limit_is_an_explicit_error_not_partial_truncation(monkeypatch):
    assert importlib.util.find_spec(ROOT + ".prepare") is not None, "v3 preparation is missing"
    m = importlib.import_module(ROOT + ".prepare")
    monkeypatch.setattr(m, "MAX_CANDIDATES", 1)
    result = prepare()
    assert not result["ready"] and result["problem"] is None
    assert "candidate_limit_exceeded" in str(result)


@pytest.mark.parametrize(
    "member,value",
    [
        ("profit_usd_ha", 999999.0),
        ("seed_kg_ha", 0.0001),
        ("yield_kg_ha", 0.0001),
        ("soil_score", 0.99),
        ("risk_score", 0.99),
        ("baseline_confirmed", False),
    ],
)
def test_independent_coefficient_verifier_detects_corruption(member, value):
    assert importlib.util.find_spec(ROOT + ".preparation_verify") is not None, (
        "coefficient verifier is missing"
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    m = importlib.import_module(ROOT + ".preparation_verify")
    result = prepare()
    problem = result["problem"]
    c = next(c for c in problem.candidates if c.id in result["baseline_ids"])
    changed = c.model_copy(update={member: value})
    damaged = problem.model_copy(
        update={"candidates": [changed if x.id == c.id else x for x in problem.candidates]}
    )
    proof = m.verify_preparation(
        problem=damaged,
        draft=PlanningDraft.model_validate(draft()),
        profile=get_profile(PROFILE),
        fields=[field()],
        raw_weather=weather(),
        traces=result["traces"],
    )
    assert not proof["valid"]


def test_independent_verifier_rejects_inflated_resource_capacity():
    assert importlib.util.find_spec(ROOT + ".preparation_verify") is not None, (
        "coefficient verifier is missing"
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    m = importlib.import_module(ROOT + ".preparation_verify")
    result = prepare()
    problem = result["problem"]
    resource = problem.daily_resources[0]
    days = dict(resource.days)
    first = min(days)
    days[first] = days[first].model_copy(update={"capacity": 999999.0})
    bad = resource.model_copy(update={"days": days})
    problem = problem.model_copy(update={"daily_resources": [bad, *problem.daily_resources[1:]]})
    proof = m.verify_preparation(
        problem=problem,
        draft=PlanningDraft.model_validate(draft()),
        profile=get_profile(PROFILE),
        fields=[field()],
        raw_weather=weather(),
        traces=result["traces"],
    )
    assert not proof["valid"] and any("capacity" in v for v in proof["violations"])


def test_unknown_soil_texture_is_missing_input_not_automatic_suitability():
    result = prepare(fields=[field().model_copy(update={"soil_texture": "unknown"})])
    assert not result["ready"] and "soil_texture_missing" in str(result)


def test_aspect_and_terrain_position_are_required_site_evidence():
    p = draft()
    values = p["field_conditions"]["field-1"]["values"]
    values.pop("aspect", None)
    values.pop("terrain_position", None)
    result = prepare(p)
    assert not result["ready"] and result["stage"] == "data_preflight"


def test_depression_is_rejected_by_the_declared_engineering_site_rule():
    p = draft()
    p["field_conditions"]["field-1"]["values"]["terrain_position"] = record(
        "depression", "category"
    )
    result = prepare(p)
    assert not result["ready"] and "terrain_unsuitable" in str(result)


@pytest.mark.parametrize(
    "member,value", [("recipe", "unrelated-v9"), ("economics", None), ("soil_components", None)]
)
def test_independent_verifier_rejects_mislabelled_coefficient_evidence(member, value):
    from sideronostos_backend.modules.rotation_optimizer.v3.inputs import PlanningDraft
    from sideronostos_backend.modules.rotation_optimizer.v3.preparation_verify import (
        verify_preparation,
    )
    from sideronostos_backend.modules.rotation_optimizer.v3.profiles import get_profile

    result = prepare()
    first = next(iter(result["traces"]))
    result["traces"][first][member] = value
    proof = verify_preparation(
        problem=result["problem"],
        draft=PlanningDraft.model_validate(draft()),
        profile=get_profile(PROFILE),
        fields=[field()],
        raw_weather=weather(),
        traces=result["traces"],
    )
    assert not proof["valid"]
