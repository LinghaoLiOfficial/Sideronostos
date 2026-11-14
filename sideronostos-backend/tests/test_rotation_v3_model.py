import importlib
import importlib.util

import pytest
from rotation_v3_helpers import candidate, cap, day, problem

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def model():
    assert importlib.util.find_spec(ROOT + ".model") is not None, (
        "v3 daily model contract is missing"
    )
    return importlib.import_module(ROOT + ".model")


def test_versioned_problem_preserves_farm_and_daily_resource_identity():
    m = model()
    p = m.Problem.model_validate(problem())
    assert p.version == "rotation-milp-v3.0"
    assert p.fields[0].farm_id == "farm"
    assert p.candidates[0].occupied_until == day(2)
    assert len(p.daily_resources[0].days) == 6
    assert p.scales["water"] == 100


@pytest.mark.parametrize(
    "change",
    [
        {"periods": [dict(id="p", start=day(1), end=day(5))]},
        {
            "periods": [
                dict(id="p", start=day(0), end=day(3)),
                dict(id="q", start=day(3), end=day(5)),
            ]
        },
        {"scales": dict(profit=100, water=0, soil=10, risk=10, bare=12)},
        {
            "fields": [
                dict(
                    id="f",
                    farm_id="farm",
                    area_ha=2,
                    irrigation_available=True,
                    water_system_id=None,
                    history=[],
                )
            ]
        },
        {"bare_limits": {}, "bare_limit_disabled": {}},
    ],
)
def test_incomplete_time_resources_and_objective_units_are_rejected(change):
    with pytest.raises(ValueError):
        model().Problem.model_validate(problem(**change))


def test_missing_daily_capacity_is_not_an_unlimited_or_zero_resource():
    body = problem()
    del body["daily_resources"][0]["days"][day(1)]
    with pytest.raises(ValueError):
        model().Problem.model_validate(body)


def test_every_candidate_needs_period_seed_and_market_capacity():
    body = problem()
    body["period_resources"] = body["period_resources"][:-1]
    with pytest.raises(ValueError):
        model().Problem.model_validate(body)


def test_hard_prohibitions_cannot_be_softened_with_zero_penalty():
    with pytest.raises(ValueError):
        model().Capacity.model_validate(cap(0, cost=0))
    hard = model().Capacity.model_validate(cap(0, soft=False))
    assert hard.gap_unit_cost is None and not hard.remediable


def test_unavailable_metric_cannot_have_positive_weight_or_fabricated_zero():
    body = problem()
    body["candidates"][0]["soil_score"] = None
    with pytest.raises(ValueError):
        model().Problem.model_validate(body)
    body["weights"]["soil"] = 0
    body["weights"]["water"] += 0.1
    body["disabled_metrics"]["soil"] = "No calibrated soil contribution values"
    body["scales"].pop("soil")
    p = model().Problem.model_validate(body)
    assert p.candidates[0].soil_score is None


def test_cover_must_span_occupancy_and_no_baseline_is_an_input_conflict():
    with pytest.raises(ValueError):
        model().Problem.model_validate(problem(candidates=[candidate("a", cover_mask=[True])]))
    with pytest.raises(ValueError):
        model().Problem.model_validate(
            problem(candidates=[candidate("a", baseline_confirmed=False)])
        )


def test_cross_farm_resource_links_and_unknown_machine_demands_fail_closed():
    body = problem()
    body["daily_resources"][0]["farm_id"] = "someone-else"
    with pytest.raises(ValueError):
        model().Problem.model_validate(body)
    body = problem()
    body["candidates"][0]["machine_hours_ha"] = {"unknown": {day(0): 1}}
    with pytest.raises(ValueError):
        model().Problem.model_validate(body)


def test_a_field_cannot_draw_from_two_implicit_water_resources():
    from copy import deepcopy

    body = problem()
    extra = deepcopy(body["daily_resources"][0])
    extra["id"] = "second-water"
    body["daily_resources"].append(extra)
    with pytest.raises(ValueError, match="water"):
        model().Problem.model_validate(body)
