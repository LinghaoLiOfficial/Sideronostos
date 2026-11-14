"""Small exact cases for daily constraints and lexicographic resource priorities."""

import importlib
import importlib.util

import pytest
from rotation_v3_helpers import candidate, cap, day, problem

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def modules():
    assert importlib.util.find_spec(ROOT + ".solver") is not None, "v3 daily MILP solver is missing"
    return tuple(
        importlib.import_module(ROOT + "." + name) for name in ("model", "solver", "verify")
    )


def solve(body):
    m, s, _ = modules()
    return s.solve(m.Problem.model_validate(body), time_limit=10)


def test_zero_gap_precedes_arbitrarily_better_profit():
    a = candidate("a", profit_usd_ha=1000000, water_mm=[2, 0])
    b = candidate("b", profit_usd_ha=1)
    body = problem([a, b])
    body["daily_resources"][0]["days"][day(0)] = cap(0, cost=2)
    result = solve(body)
    assert result["status"] == "optimal"
    assert result["selected_ids"] == ["b"]
    assert result["verification"]["gap_cost"] == 0
    assert result["gap_optimality_proven"] is True


def test_all_five_resource_gaps_are_reported_with_units_and_remedies():
    body = problem(
        [candidate("a", water_mm=[2, 0], seed_kg_ha=3, machine_hours_ha={"m": {day(0): 2}})]
    )
    body["daily_resources"][0]["days"][day(0)] = cap(10, cost=2)
    body["daily_resources"][1]["days"][day(0)] = cap(1, cost=3)
    for r in body["period_resources"]:
        r["limit"] = cap(4, cost=5) if r["kind"] == "seed" else cap(15, cost=7)
    body["bare_limits"]["f"] = cap(3, cost=11)
    result = solve(body)
    v = result["verification"]
    assert result["status"] == "optimal" and v["valid"]
    assert v["diagnostic"] and not v["resource_feasible"]
    assert v["gap_cost"] == pytest.approx(125)
    positive = {row["kind"]: row for row in v["resources"] if row["gap"] > 1e-8}
    assert {k: r["gap"] for k, r in positive.items()} == pytest.approx(
        dict(water=30, machine=3, seed=2, market=5, bare=1)
    )
    assert {k: r["unit"] for k, r in positive.items()} == dict(
        water="m3", machine="hours", seed="kg", market="kg", bare="days"
    )
    assert all(row["remedy"] and row["evidence_ids"] for row in positive.values())
    assert v["metrics"] == dict(profit=20, water=40, rotation=None, soil=0.6, risk=0.2, bare=8)


def test_hard_capacity_is_infeasible_instead_of_a_soft_diagnostic():
    body = problem([candidate("a", water_mm=[2, 0])])
    body["daily_resources"][0]["days"][day(0)] = cap(0, soft=False)
    result = solve(body)
    assert result["status"] == "infeasible"
    assert not result["selected_ids"]


def test_same_species_cultivars_cannot_form_adjacent_rotations():
    body = problem([candidate("a", species_id="maize"), candidate("b", 3, species_id="maize")])
    result = solve(body)
    assert result["status"] == "optimal"
    assert len(result["selected_ids"]) == 1


def test_family_interval_is_checked_across_intervening_species():
    body = problem(
        [candidate("a", family="G"), candidate("b", 3, family="H"), candidate("c", 6, family="G")],
        end=day(8),
        family_gaps={"G": 4, "H": 0},
    )
    m, _, v = modules()
    p = m.Problem.model_validate(body)
    rejected = v.verify_selection(p, ["a", "b", "c"])
    assert not rejected["valid"] and any("family_gap" in x for x in rejected["violations"])
    result = solve(body)
    assert result["status"] == "optimal"
    assert not {"a", "c"} <= set(result["selected_ids"])
    # Exactly at occupied-end + family-gap + 1 is allowed.
    shifted = problem(
        [candidate("a", family="G"), candidate("b", 3, family="H"), candidate("c", 7, family="G")],
        end=day(9),
        family_gaps={"G": 4, "H": 0},
    )
    assert v.verify_selection(m.Problem.model_validate(shifted), ["a", "b", "c"])["valid"]


def test_recent_history_uses_latest_possible_end_and_species_adjacency():
    body = problem([candidate("a"), candidate("b")])
    body["fields"][0]["history"] = [
        dict(
            crop_id="old-a",
            species_id="a",
            family="a",
            end_latest=day(-1),
            turnaround_days=0,
            precision="year",
        )
    ]
    assert solve(body)["selected_ids"] == ["b"]


def test_verifier_rejects_unknown_duplicate_overlapping_and_missing_field_selections():
    m, _, v = modules()
    p = m.Problem.model_validate(problem([candidate("a"), candidate("b")]))
    for ids in [["unknown"], ["a", "a"], ["a", "b"], []]:
        assert not v.verify_selection(p, ids)["valid"]


def test_cancel_and_no_license_are_honest_failures(monkeypatch):
    m, s, _ = modules()
    p = m.Problem.model_validate(problem())
    assert s.solve(p, cancelled=lambda: True)["status"] == "cancelled"

    def unavailable(*args, **kwargs):
        raise s.gp.GurobiError(10009, "synthetic test unavailable")

    monkeypatch.setattr(s.gp, "Env", unavailable)
    result = s.solve(p)
    assert result["status"] == "failed" and result["error_code"] == "gurobi_10009"
    assert not result["selected_ids"]


def test_small_enumerated_oracle_couples_two_fields_by_daily_shared_resources():
    from itertools import product

    cs = [
        candidate("f1-early", crop="c", profit_usd_ha=12, water_mm=[1, 0]),
        candidate("f1-late", 1, crop="c", profit_usd_ha=8, water_mm=[1, 0]),
        candidate("f2-early", crop="c", field_id="g", profit_usd_ha=15, water_mm=[1, 0]),
        candidate("f2-late", 1, crop="c", field_id="g", profit_usd_ha=5, water_mm=[1, 0]),
    ]
    body = problem(cs, end=day(3))
    body["fields"][0]["area_ha"] = 1
    body["fields"].append(dict(body["fields"][0], id="g"))
    for r in body["daily_resources"]:
        r["field_ids"] = ["f", "g"]
        r["days"] = {
            day(i): cap(10, cost=2) if r["kind"] == "water" else cap(1, cost=3) for i in range(4)
        }
    for r in body["period_resources"]:
        r["limit"] = cap(1, cost=5) if r["kind"] == "seed" else cap(15, cost=7)
    body["bare_limits"] = {"f": cap(1, cost=11), "g": cap(1, cost=11)}
    # Independent enumeration: the two options overlap within each field, so exactly
    # one per field. No production verifier or coefficient function is used here.
    oracle = []
    for a, b in product(cs[:2], cs[2:]):
        counts = [sum(c["sow_date"] == day(i) for c in (a, b)) for i in range(4)]
        gap = sum(max(0, n * 10 - 10) * 2 + max(0, n - 1) * 3 for n in counts) + 5 + 35 + 22
        profit = a["profit_usd_ha"] + b["profit_usd_ha"]
        score = 0.3 * profit / 100 - 0.2 * 20 / 100 + 0.1 * 0.6 / 10 - 0.1 * 0.2 / 10 - 0.3 * 4 / 12
        oracle.append((gap, -score, sorted([a["id"], b["id"]])))
    expected = min(oracle)
    result = solve(body)
    assert result["status"] == "optimal"
    assert result["selected_ids"] == expected[2] == ["f1-late", "f2-early"]
    assert result["gap_cost"] == expected[0] == 62
    assert result["score"] == pytest.approx(-expected[1])


def test_rotation_benefit_counts_only_direct_successors_not_all_selected_pairs():
    body = problem([candidate("a"), candidate("b", 3), candidate("c", 6)], end=day(8))
    body["weights"].update(profit=0, rotation=0.3)
    body["disabled_metrics"] = {}
    body["scales"]["rotation"] = 100
    body["rotation_benefits"] = [
        dict(before=a, after=b, score=s, evidence_ids=["fixture"])
        for a, b, s in [("a", "b", 1), ("a", "c", 100), ("b", "c", 2)]
    ]
    m, _, v = modules()
    p = m.Problem.model_validate(body)
    assert v.verify_selection(p, ["a", "b", "c"])["metrics"]["rotation"] == 3
    result = solve(body)
    assert result["selected_ids"] == ["a", "c"]
    assert result["verification"]["metrics"]["rotation"] == 100


def test_real_solver_tiny_deadline_never_claims_a_proven_optimum_without_one():
    m, s, _ = modules()
    p = m.Problem.model_validate(problem())
    result = s.solve(p, time_limit=1e-9)
    assert result["status"] in ("timeout_no_solution", "timeout_feasible", "optimal")
    if result["status"] != "optimal":
        assert not result["gap_optimality_proven"]
        assert not result["score_optimality_proven"]
    if result["status"] == "timeout_no_solution":
        assert not result["selected_ids"]


def test_alternative_search_cannot_degrade_the_fixed_resource_gap_priority():
    from rotation_v3_helpers import candidate, cap, problem

    from sideronostos_backend.modules.rotation_optimizer.v3.model import Problem
    from sideronostos_backend.modules.rotation_optimizer.v3.solver import solve

    p = problem(
        candidates=[candidate("a", water_mm=[1.0, 1.0]), candidate("b", water_mm=[2.0, 2.0])]
    )
    for limit in p["daily_resources"][0]["days"].values():
        limit.update(cap(0.0, soft=True, cost=1.0))
    model = Problem.model_validate(p)
    first = solve(model, time_limit=5)
    assert first["gap_cost"] == 40.0
    other = solve(model, time_limit=5, exclude=first["selected_ids"], max_gap_cost=40.0)
    assert other["status"] == "infeasible" and not other["selected_ids"]
