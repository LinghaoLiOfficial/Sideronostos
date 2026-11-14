"""Real Gurobi adapter. No fallback to enumeration or fabricated solver statuses."""

import math
from collections.abc import Callable
from typing import Any

import gurobipy as gp

from .milp import build_model
from .schemas import Problem
from .verify import verify_selection


def classify_status(status: int, solution_count: int) -> str:
    if status == gp.GRB.OPTIMAL:
        return "optimal" if solution_count else "failed"
    if status == gp.GRB.INFEASIBLE:
        return "infeasible"
    if status == gp.GRB.TIME_LIMIT:
        return "timeout_feasible" if solution_count else "timeout_no_solution"
    if status == gp.GRB.INTERRUPTED:
        return "cancelled"
    return (
        "feasible_not_proven"
        if solution_count and status in (7, 8, 10, 13, 15, 16, 17)
        else "failed"
    )


def solve(
    problem: Problem,
    *,
    time_limit: float = 30,
    cancelled: Callable[[], bool] | None = None,
    exclude: list[str] | None = None,
    exclude_sets: list[list[str]] | None = None,
    max_transition_edges: int | None = None,
) -> dict[str, Any]:
    if not math.isfinite(time_limit) or not 0 < time_limit <= 120:
        raise ValueError("Invalid solver time limit")
    if exclude is not None and not set(exclude) <= {c.id for c in problem.candidates}:
        raise ValueError("Excluded selection contains unknown candidate")
    excluded = ([exclude] if exclude is not None else []) + (exclude_sets or [])
    if any(not set(selection) <= {c.id for c in problem.candidates} for selection in excluded):
        raise ValueError("Excluded selection contains unknown candidate")
    base: dict[str, Any] = {
        "status": "failed",
        "selected_ids": [],
        "objective": None,
        "bound": None,
        "gap": None,
        "raw_status": None,
        "solution_count": 0,
        "solver": "gurobi",
        "solver_version": list(gp.gurobi.version()),
        "model_version": problem.version,
        "optimality_scope": "generated_candidate_set",
        "time_limit_seconds": time_limit,
        "excluded_combination": exclude,
        "excluded_combinations": excluded,
    }
    if cancelled and cancelled():
        return {**base, "status": "cancelled"}
    try:
        with gp.Env(empty=True) as env:
            env.setParam("OutputFlag", 0)
            env.start()
            model, variables, transition_edges = build_model(
                problem, env, max_transition_edges=max_transition_edges
            )
            with model:
                model.Params.TimeLimit = time_limit
                model.Params.Threads = 1
                model.Params.Seed = 0
                model.Params.MIPGap = 1e-6
                for index, selection in enumerate(excluded):
                    ids = set(selection)
                    model.addConstr(
                        gp.quicksum(1 - v if k in ids else v for k, v in variables.items()) >= 1,
                        name=f"exclude_prior_combination:{index}",
                    )

                def callback(m: gp.Model, where: int) -> None:
                    del where
                    if cancelled and cancelled():
                        m.terminate()

                model.optimize(callback if cancelled else None)
                status = classify_status(model.Status, model.SolCount)
                base.update(
                    status=status,
                    raw_status=model.Status,
                    solution_count=model.SolCount,
                    runtime_seconds=model.Runtime,
                    variable_count=model.NumVars,
                    constraint_count=model.NumConstrs,
                    transition_edge_count=transition_edges,
                    mip_gap_tolerance=1e-6,
                )
                if status == "infeasible":
                    # Do not run an unbounded IIS pass after the solve deadline.
                    base["infeasibility_explanation"] = (
                        "No schedule meets the supplied model constraints."
                    )
                if model.SolCount and status not in ("cancelled", "failed"):
                    selected = sorted(k for k, v in variables.items() if v.X > 0.5)
                    verification = verify_selection(problem, selected)
                    if not verification["valid"] or not math.isclose(
                        verification["objective"], model.ObjVal, abs_tol=1e-6, rel_tol=1e-6
                    ):
                        return {
                            **base,
                            "status": "failed",
                            "error_code": "verification_failed",
                            "verification": verification,
                        }
                    base.update(
                        selected_ids=selected,
                        objective=model.ObjVal,
                        bound=model.ObjBound if math.isfinite(model.ObjBound) else None,
                        gap=model.MIPGap if math.isfinite(model.MIPGap) else None,
                        verification=verification,
                    )
    except gp.GurobiError as error:
        base.update(status="failed", error_code=f"gurobi_{error.errno}")
    return base
