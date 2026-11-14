"""Real Gurobi multiobjective solve; no simulated success or enumerator fallback."""

import math
from collections.abc import Callable
from typing import Any

import gurobipy as gp

from ..solver import classify_status
from .milp import build_model
from .model import Problem
from .verify import verify_selection


def solve(
    problem: Problem,
    *,
    time_limit: float = 30,
    cancelled: Callable[[], bool] | None = None,
    exclude: list[str] | None = None,
    max_gap_cost: float | None = None,
) -> dict[str, Any]:
    if not math.isfinite(time_limit) or not 0 < time_limit <= 120:
        raise ValueError("Solver deadline must be between zero and 120 seconds")
    if max_gap_cost is not None and (
        isinstance(max_gap_cost, bool) or not math.isfinite(max_gap_cost) or max_gap_cost < 0
    ):
        raise ValueError("Alternative gap-cost ceiling must be finite and nonnegative")
    if exclude is not None and not set(exclude) <= {c.id for c in problem.candidates}:
        raise ValueError("Excluded combination contains unknown candidates")
    result: dict[str, Any] = {
        "status": "failed",
        "selected_ids": [],
        "solution_count": 0,
        "solver": "gurobi",
        "solver_version": list(gp.gurobi.version()),
        "model_version": problem.version,
        "optimality_scope": "generated_candidate_set",
        "time_limit_seconds": time_limit,
        "gap_optimality_proven": False,
        "score_optimality_proven": False,
        "hierarchy": ["minimize_resource_gap_cost", "maximize_normalized_six_metric_score"],
        "objective_degradation_tolerance": 0,
        "excluded_combination": exclude,
        "max_gap_cost": max_gap_cost,
    }
    if cancelled and cancelled():
        return {**result, "status": "cancelled"}
    try:
        with gp.Env(empty=True) as env:
            env.setParam("OutputFlag", 0)
            env.start()
            built = build_model(problem, env)
            with built.model as model:
                model.Params.TimeLimit = time_limit
                model.Params.Threads = 1
                model.Params.Seed = 0
                model.Params.MIPGap = 0
                model.Params.MIPGapAbs = 0
                model.Params.FeasibilityTol = 1e-8
                model.Params.IntFeasTol = 1e-8
                if max_gap_cost is not None:
                    model.addConstr(built.gap_cost <= max_gap_cost, name="preserve_gap_priority")
                if exclude is not None:
                    prior = set(exclude)
                    model.addConstr(
                        gp.quicksum(
                            1 - v if key in prior else v for key, v in built.selected.items()
                        )
                        >= 1,
                        name="exclude_prior_combination",
                    )

                def callback(m: gp.Model, where: int) -> None:
                    del where
                    if cancelled and cancelled():
                        m.terminate()

                model.optimize(callback if cancelled else None)
                status = classify_status(model.Status, model.SolCount)
                if cancelled and cancelled():
                    status = "cancelled"
                result.update(
                    status=status,
                    raw_status=model.Status,
                    solution_count=model.SolCount,
                    runtime_seconds=model.Runtime,
                    variable_count=model.NumVars,
                    constraint_count=model.NumConstrs,
                )
                if not model.SolCount or status in ("cancelled", "failed"):
                    return result
                selected = sorted(key for key, var in built.selected.items() if var.X > 0.5)
                verification = verify_selection(problem, selected)
                valid = verification["valid"] and math.isclose(
                    built.score.getValue(), verification["score"], rel_tol=1e-7, abs_tol=1e-6
                )
                if max_gap_cost is not None and verification["gap_cost"] > max_gap_cost + 1e-6:
                    valid = False
                for (fid, day), var in built.water.items():
                    if not math.isclose(
                        var.X,
                        verification["water_mm"][fid][day.isoformat()],
                        abs_tol=1e-6,
                        rel_tol=1e-7,
                    ):
                        valid = False
                if status == "optimal" and not math.isclose(
                    built.gap_cost.getValue(), verification["gap_cost"], rel_tol=1e-7, abs_tol=1e-6
                ):
                    valid = False
                if not valid:
                    return {
                        **result,
                        "status": "failed",
                        "error_code": "independent_verification_failed",
                        "verification": verification,
                    }
                result.update(
                    selected_ids=selected,
                    verification=verification,
                    gap_cost=verification["gap_cost"],
                    score=verification["score"],
                    gap_optimality_proven=status == "optimal",
                    score_optimality_proven=status == "optimal",
                    gap_reporting=(
                        "minimum required gaps for the selected schedule; "
                        "unneeded incumbent slack removed"
                    ),
                )
    except gp.GurobiError as error:
        result.update(status="failed", error_code=f"gurobi_{error.errno}", selected_ids=[])
    return result
