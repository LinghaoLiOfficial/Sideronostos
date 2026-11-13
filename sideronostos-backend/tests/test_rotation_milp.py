"""Real Gurobi tests; small synthetic mathematics fixtures, not farm evidence."""

import importlib
import importlib.util

import pytest


def implementation():
    root = "sideronostos_backend.modules.rotation_optimizer"
    assert importlib.util.find_spec(root) is not None, "v2 MILP is not implemented"
    return (
        importlib.import_module(root + ".schemas"),
        importlib.import_module(root + ".solver"),
        importlib.import_module(root + ".verify"),
    )


def instance():
    return {
        "start": "2025-01-01",
        "end": "2025-01-10",
        "fields": [{"id": "f", "area_ha": 2, "irrigation_available": True, "require_crop": True}],
        "candidates": [
            {
                "id": "a",
                "field_id": "f",
                "crop_id": "pea",
                "family": "Fabaceae",
                "sow_date": "2025-01-01",
                "harvest_date": "2025-01-03",
                "turnaround_days": 1,
                "water_mm": [1, 1, 1],
                "cost_usd_ha": 10,
                "labor_days_ha": 1,
            },
            {
                "id": "b",
                "field_id": "f",
                "crop_id": "oat",
                "family": "Poaceae",
                "sow_date": "2025-01-05",
                "harvest_date": "2025-01-08",
                "turnaround_days": 1,
                "water_mm": [2, 2, 2, 2],
                "cost_usd_ha": 10,
                "labor_days_ha": 1,
            },
            {
                "id": "c",
                "field_id": "f",
                "crop_id": "maize",
                "family": "Poaceae",
                "sow_date": "2025-01-02",
                "harvest_date": "2025-01-07",
                "turnaround_days": 1,
                "water_mm": [1] * 6,
                "cost_usd_ha": 5,
                "labor_days_ha": 1,
            },
        ],
        "family_gaps": {"Fabaceae": 0, "Poaceae": 0},
        "weights": {"cover": 1, "diversity": 0, "water": 0, "cost": 0},
        "references": {"cover": 1, "diversity": 1, "water": 1, "cost": 1},
    }


def test_milp_finds_best_connected_calendar_and_verifier_rejects_forged_selection():
    s, solver, verify = implementation()
    p = s.Problem.model_validate(instance())
    r = solver.solve(p)
    assert r["status"] == "optimal"
    assert set(r["selected_ids"]) == {"a", "b"}
    assert r["objective"] == pytest.approx(14)
    assert r["bound"] == pytest.approx(14)
    assert r["gap"] == 0
    v = verify.verify_selection(p, r["selected_ids"])
    assert v["valid"] and v["totals"]["water_m3"] == 220
    assert not verify.verify_selection(p, ["a", "c"])["valid"]
    assert not verify.verify_selection(p, ["invented"])["valid"]


def test_no_irrigation_is_hard_constraint_not_a_weight():
    s, solver, _ = implementation()
    body = instance()
    body["fields"][0]["irrigation_available"] = False
    result = solver.solve(s.Problem.model_validate(body))
    assert result["status"] == "infeasible"
    assert result["selected_ids"] == [] and result["objective"] is None


def test_shared_farm_resource_changes_solution_across_fields():
    s, solver, _ = implementation()
    body = instance()
    body["fields"].append(
        {"id": "g", "area_ha": 1, "irrigation_available": True, "require_crop": True}
    )
    body["candidates"].append({**body["candidates"][0], "id": "g-a", "field_id": "g"})
    body["farm_limits"] = {"2025": {"water_m3": 160, "cost_usd": 1000, "labor_days": 100}}
    result = solver.solve(s.Problem.model_validate(body))
    assert set(result["selected_ids"]) == {"c", "g-a"}
    assert result["objective"] == pytest.approx(15)


def test_history_and_all_selected_pairs_enforce_family_interval():
    s, solver, verify = implementation()
    body = instance()
    body["fields"][0]["history"] = [
        {
            "crop_id": "pea",
            "family": "Fabaceae",
            "end_latest": "2024-12-31",
            "turnaround_days": 0,
            "precision": "day",
        }
    ]
    body["family_gaps"]["Fabaceae"] = 3
    result = solver.solve(s.Problem.model_validate(body))
    assert result["selected_ids"] == ["c"]
    assert not verify.verify_selection(s.Problem.model_validate(body), ["a"])["valid"]


def test_optional_fallow_and_timeout_without_incumbent_are_not_fake_optimal():
    s, solver, _ = implementation()
    body = instance()
    body["fields"][0]["require_crop"] = False
    body["weights"] = {"cover": 0, "diversity": 0, "water": 1, "cost": 1}
    result = solver.solve(s.Problem.model_validate(body))
    assert result["selected_ids"] == [] and result["status"] == "optimal"
    assert solver.classify_status(9, 0) == "timeout_no_solution"
    assert solver.classify_status(9, 1) == "timeout_feasible"
    assert solver.classify_status(3, 0) == "infeasible"
    assert solver.classify_status(11, 1) == "cancelled"


def test_cross_year_resources_split_on_actual_days():
    s, solver, verify = implementation()
    body = instance()
    body["start"] = "2024-12-30"
    body["end"] = "2025-01-03"
    body["candidates"] = [
        {
            **body["candidates"][0],
            "sow_date": "2024-12-30",
            "harvest_date": "2025-01-02",
            "water_mm": [1, 1, 1, 1],
            "turnaround_days": 1,
        }
    ]
    body["farm_limits"] = {
        "2024": {"water_m3": 40, "cost_usd": 10, "labor_days": 1},
        "2025": {"water_m3": 40, "cost_usd": 10, "labor_days": 1},
    }
    p = s.Problem.model_validate(body)
    result = solver.solve(p)
    assert result["status"] == "optimal"
    v = verify.verify_selection(p, ["a"])
    assert v["farm_years"]["2024"]["water_m3"] == 40
    assert v["farm_years"]["2025"]["cost_usd"] == 10
    body["farm_limits"]["2025"]["water_m3"] = 39
    assert solver.solve(s.Problem.model_validate(body))["status"] == "infeasible"


@pytest.mark.parametrize("water_limit", [0, 60, 100, 120, 219, 220, 1000])
def test_small_instance_matches_independent_exhaustive_oracle(water_limit):
    from itertools import combinations

    s, solver, _ = implementation()
    body = instance()
    body["fields"][0]["require_crop"] = False
    body["farm_limits"] = {"2025": {"water_m3": water_limit, "cost_usd": 1000, "labor_days": 100}}
    # Independent hand-derived candidate table: occupied interval, water, cover.
    table = {"a": (1, 4, 60, 6), "b": (5, 9, 160, 8), "c": (2, 8, 120, 12)}
    objectives = []
    for mask in range(8):
        ids = [cid for i, cid in enumerate(table) if mask & (1 << i)]
        if any(
            max(table[a][0], table[b][0]) <= min(table[a][1], table[b][1])
            for a, b in combinations(ids, 2)
        ):
            continue
        if sum(table[cid][2] for cid in ids) > water_limit:
            continue
        objectives.append(sum(table[cid][3] for cid in ids))
    result = solver.solve(s.Problem.model_validate(body))
    assert result["status"] == "optimal"
    assert result["objective"] == max(objectives)
