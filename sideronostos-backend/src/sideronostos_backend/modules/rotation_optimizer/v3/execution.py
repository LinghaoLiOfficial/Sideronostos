"""Frozen v3 preparation, globally bounded real solves and independently checked options."""

import math
from collections.abc import Callable
from time import monotonic
from typing import Any

from fastapi.encoders import jsonable_encoder

from ...field_shift.schemas import Field as FieldSnapshot
from .contracts import MODEL_VERSION, PRECOMPUTE_VERSION, ObjectiveWeights
from .inputs import RunRequest
from .model import Problem
from .prepare import prepare_problem
from .profiles import ProfileV3, profile_hash
from .service import fingerprint
from .solver import solve
from .verify import verify_selection


def option_snapshot(
    identifier: str,
    label: str,
    problem: Problem,
    selected: list[str],
    *,
    profile: ProfileV3,
    scientific: dict[str, Any],
    solver: dict[str, Any] | None = None,
) -> dict[str, Any]:
    proof = verify_selection(problem, selected)
    chosen = {c.id: c for c in problem.candidates if c.id in selected}
    seasons = [
        {
            **c.model_dump(mode="json", exclude={"water_mm"}),
            "occupied_until": c.occupied_until.isoformat(),
            "water_gap_mm": sum(c.water_mm),
            "growing_days": len(c.water_mm),
        }
        for c in sorted(chosen.values(), key=lambda c: (c.field_id, c.sow_date, c.id))
    ]
    execution_label = (
        "invalid_baseline"
        if not proof["valid"]
        else "diagnostic_requires_remedies"
        if proof["diagnostic"]
        else "engineering_benchmark"
        if profile.scope == "benchmark_not_locally_calibrated"
        else "resource_feasible_scenario"
    )
    return {
        "id": identifier,
        "label": label,
        "model_version": MODEL_VERSION,
        "seasons": seasons,
        "complete": True,
        "feasible": proof["valid"],
        "execution_label": execution_label,
        "verification": proof,
        "scientific_verification": scientific,
        "solver": solver,
        "objective_definition": {
            "weights": problem.weights.model_dump(),
            "scales": problem.scales,
            "disabled_metrics": problem.disabled_metrics,
            "priority": ["minimize_resource_gap_cost", "maximize_normalized_six_metric_score"],
        },
    }


def execute_snapshot(
    snapshot: dict[str, Any], *, time_limit: float = 30, cancelled: Callable[[], bool] | None = None
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema": "rotation-result-v3.0",
        "model_version": MODEL_VERSION,
        "precompute_version": PRECOMPUTE_VERSION,
        "status": "failed",
        "options": [],
        "baseline": None,
    }
    if cancelled and cancelled():
        return {**result, "status": "cancelled"}
    if not math.isfinite(time_limit) or not 0 < time_limit <= 120:
        raise ValueError("Invalid v3 solver deadline")
    if snapshot.get("schema") != "rotation-input-v3.0" or snapshot.get("readiness", {}).get(
        "fingerprint"
    ) != fingerprint({k: v for k, v in snapshot.items() if k != "readiness"}):
        return {**result, "error_code": "snapshot_integrity_mismatch"}
    request = RunRequest.model_validate(snapshot["request"])
    profile = ProfileV3.model_validate(snapshot["profile"])
    if profile_hash(profile) != snapshot["provenance"]["profile_sha256"]:
        return {**result, "error_code": "profile_integrity_mismatch"}
    fields = [FieldSnapshot.model_validate(f) for f in snapshot["fields"]]
    prepared = prepare_problem(
        draft=request,
        profile=profile,
        fields=fields,
        raw_weather=snapshot["weather"],
        cancelled=cancelled,
    )
    if cancelled and cancelled() or "cancelled" in prepared["errors"]:
        return {**result, "status": "cancelled"}
    if not prepared["ready"]:
        blocked_result: dict[str, Any] = jsonable_encoder(
            {
                **result,
                "error_code": "preparation_blocked",
                "preparation": {
                    k: v for k, v in prepared.items() if k not in ("problem", "traces")
                },
            }
        )
        return blocked_result
    problem: Problem = prepared["problem"]
    deadline = monotonic() + 2 * time_limit
    first = solve(problem, time_limit=time_limit, cancelled=cancelled)
    attempts = [first]
    options = []
    if first.get("selected_ids") and first["status"] not in ("failed", "cancelled"):
        options.append(
            option_snapshot(
                "option-1",
                "Your selected priorities",
                problem,
                first["selected_ids"],
                profile=profile,
                scientific=prepared["verification"],
                solver=first,
            )
        )
        options[0]["preference_id"] = "requested"
        targets = [
            metric
            for metric in ("water", "profit", "rotation", "soil", "risk", "bare")
            if metric not in problem.disabled_metrics
        ]
        for index, target in enumerate(targets):
            remaining = deadline - monotonic()
            if remaining <= 0 or cancelled and cancelled():
                break
            original = problem.weights.model_dump()
            rest = sum(v for k, v in original.items() if k != target)
            weights = (
                {k: 0.95 if k == target else 0.05 * v / rest for k, v in original.items()}
                if rest > 0
                else original
            )
            alternate = problem.model_copy(update={"weights": ObjectiveWeights(**weights)})
            attempt = solve(
                alternate,
                time_limit=min(time_limit, remaining / (len(targets) - index + 1)),
                cancelled=cancelled,
                max_gap_cost=first["gap_cost"],
            )
            attempt["preference_id"] = target + "_emphasis"
            attempts.append(attempt)
            already_seen = any(
                set(attempt.get("selected_ids", [])) == {season["id"] for season in o["seasons"]}
                for o in options
            )
            if (
                attempt.get("selected_ids")
                and attempt["status"] not in ("failed", "cancelled")
                and not already_seen
            ):
                option = option_snapshot(
                    "option-" + str(len(options) + 1),
                    target.title() + " emphasis",
                    alternate,
                    attempt["selected_ids"],
                    profile=profile,
                    scientific=prepared["verification"],
                    solver=attempt,
                )
                option["preference_id"] = target + "_emphasis"
                options.append(option)
        remaining = deadline - monotonic()
        if len(options) < 2 and remaining > 0 and not (cancelled and cancelled()):
            distinct = solve(
                problem,
                time_limit=min(time_limit, remaining),
                cancelled=cancelled,
                exclude=first["selected_ids"],
                max_gap_cost=first["gap_cost"],
            )
            distinct["preference_id"] = "distinct_fallback"
            attempts.append(distinct)
            if distinct.get("selected_ids") and distinct["status"] not in ("failed", "cancelled"):
                option = option_snapshot(
                    "option-2",
                    "Next distinct feasible schedule",
                    problem,
                    distinct["selected_ids"],
                    profile=profile,
                    scientific=prepared["verification"],
                    solver=distinct,
                )
                option["preference_id"] = "distinct_fallback"
                options.append(option)
    if cancelled and cancelled() or any(a["status"] == "cancelled" for a in attempts):
        return {**result, "status": "cancelled", "solver_attempts": attempts}
    baseline = option_snapshot(
        "baseline",
        "Your confirmed baseline",
        problem,
        prepared["baseline_ids"],
        profile=profile,
        scientific=prepared["verification"],
    )
    for option in options:
        own = option["verification"]
        dominated = False
        for other in options:
            if other["id"] == option["id"]:
                continue
            theirs = other["verification"]
            if theirs["gap_cost"] > own["gap_cost"] + 1e-6:
                continue
            a = own["metrics"]
            b = theirs["metrics"]
            signs = {
                k: -1 if k in ("water", "risk", "bare") else 1
                for k, v in a.items()
                if v is not None
            }
            if all(sign * b[k] >= sign * a[k] - 1e-6 for k, sign in signs.items()) and (
                theirs["gap_cost"] < own["gap_cost"] - 1e-6
                or any(sign * b[k] > sign * a[k] + 1e-6 for k, sign in signs.items())
            ):
                dominated = True
        option["non_dominated_among_generated"] = not dominated
    second_status = attempts[1]["status"] if len(attempts) > 1 else "not_attempted"
    result.update(
        status=first["status"],
        options=options,
        baseline=baseline,
        solver_attempts=attempts,
        candidate_count=prepared["candidate_count"],
        edge_count=prepared["edge_count"],
        sampling=prepared["sampling"],
        candidate_recipe=prepared["coefficient_recipe"],
        rejected_candidates=prepared["rejected"],
        rejected_by_reason=prepared["rejected_by_reason"],
        candidate_traces=prepared["traces"],
        problem=problem.model_dump(mode="json"),
        scientific_verification=prepared["verification"],
        weather_basis=prepared["weather"]["basis"],
        weather=prepared["weather"],
        limitations=profile.limitations,
        objective_definition=baseline["objective_definition"],
        alternatives={
            "scope": "generated_candidate_set",
            "distinct_options": len(options),
            "second_search_status": second_status,
            "searches": [
                {"preference_id": a.get("preference_id", "requested"), "status": a["status"]}
                for a in attempts
            ],
            "gap_ceiling": first.get("gap_cost"),
            "gap_ceiling_is_proven_minimum": first["gap_optimality_proven"],
            "reason": None
            if len(options) > 1
            else "No distinct option found within the same gap ceiling and solve budget",
            "interpretation": (
                "Requested priorities plus declared 95% emphasis for each available metric; "
                "dominance covers generated options, not a complete global Pareto frontier"
            ),
        },
    )
    if first.get("error_code"):
        result["error_code"] = first["error_code"]
    encoded_result: dict[str, Any] = jsonable_encoder(result)
    return encoded_result
