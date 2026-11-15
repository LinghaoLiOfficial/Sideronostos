"""CPU-only execution from a frozen snapshot. No network, database or LLM calls."""

from collections.abc import Callable
from time import monotonic
from typing import Any

from .candidates import make_candidate
from .capacity import (
    LEGACY_MAX_CANDIDATES,
    LEGACY_MAX_TRANSITION_EDGES,
    CapacityLimits,
    capacity_report,
    prepare_snapshot_candidates,
)
from .requests import RunRequest
from .schemas import Candidate, Problem
from .scientific_verify import verify_scientific_candidates
from .solver import solve
from .verify import verify_selection


def option_snapshot(
    identifier: str,
    label: str,
    problem: Problem,
    selected: list[str],
    solver_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verification = verify_selection(problem, selected)
    crops = {c.id: c for c in problem.candidates}
    seasons = []
    for cid in sorted(selected, key=lambda key: (crops[key].field_id, crops[key].sow_date)):
        candidate = crops[cid]
        seasons.append(
            {
                **candidate.model_dump(mode="json", exclude={"water_mm"}),
                "occupied_until": candidate.occupied_until.isoformat(),
                "water_gap_mm": sum(candidate.water_mm),
                "growing_days": len(candidate.water_mm),
            }
        )
    return {
        "id": identifier,
        "label": label,
        "seasons": seasons,
        "feasible": verification["valid"],
        "verification": verification,
        "solver": solver_result,
    }


def execute_snapshot(
    snapshot: dict[str, Any], *, time_limit: float = 30, cancelled: Callable[[], bool] | None = None
) -> dict[str, Any]:
    if snapshot.get("schema") == "rotation-input-v3.0":
        from .v3.execution import execute_snapshot as execute_v3

        return execute_v3(snapshot, time_limit=time_limit, cancelled=cancelled)
    request = RunRequest.model_validate(snapshot["request"])
    raw_limits = snapshot.get("capacity") or {
        "max_candidates": LEGACY_MAX_CANDIDATES,
        "max_transition_edges": LEGACY_MAX_TRANSITION_EDGES,
    }
    limits = CapacityLimits(
        max_candidates=int(raw_limits["max_candidates"]),
        max_transition_edges=int(raw_limits["max_transition_edges"]),
    )
    profile, fields, weather, prepared = prepare_snapshot_candidates(snapshot, limits)
    capacity = capacity_report(
        profile=profile,
        fields=fields,
        prepared=prepared,
        request=snapshot["request"],
        limits=limits,
    )
    capacity["profile_sha256"] = snapshot.get("provenance", {}).get("profile_sha256")
    if not capacity["within_capacity"]:
        return {
            "status": "failed",
            "error_code": "rotation_capacity_exceeded",
            "capacity": capacity,
        }
    problem = Problem(
        start=request.start,
        end=request.end,
        fields=fields,
        candidates=prepared["candidates"],
        family_gaps=profile.family_gaps,
        farm_limits=request.farm_limits,
        field_limits=request.field_limits,
        weights=request.weights or profile.default_weights,
        references=profile.references,
    )
    effective_limit = min(request.solver_time_limit_seconds, time_limit)
    results: list[dict[str, Any]] = []
    excluded: list[list[str]] = []
    deadline = monotonic() + effective_limit
    for _ in range(request.max_options):
        remaining = deadline - monotonic()
        if results and remaining <= 0.05:
            break
        result = solve(
            problem,
            time_limit=max(0.05, remaining),
            cancelled=cancelled,
            exclude_sets=excluded,
            max_transition_edges=limits.max_transition_edges,
        )
        results.append(result)
        selected_ids = result.get("selected_ids") or []
        if not selected_ids or result["status"] in ("cancelled", "failed", "infeasible"):
            break
        excluded.append(selected_ids)
    first = results[0]
    options = []
    for index, result in enumerate(results):
        if result["solution_count"] and result["status"] not in ("cancelled", "failed"):
            selected = [c for c in problem.candidates if c.id in result["selected_ids"]]
            scientific = verify_scientific_candidates(profile, selected, weather)
            if not scientific["valid"]:
                return {
                    "status": "failed",
                    "error_code": "scientific_verification_failed",
                    "scientific_verification": scientific,
                }
            option = option_snapshot(
                f"option-{index + 1}",
                f"Option {index + 1}",
                problem,
                result["selected_ids"],
                result,
            )
            option["scientific_verification"] = scientific
            options.append(option)
    crop_map = {crop.id: crop for crop in profile.crops}
    baseline_candidates: list[Candidate] = []
    baseline_errors = []
    for entry in request.baseline:
        crop = crop_map.get(entry.crop_id)
        if crop is None:
            baseline_errors.append({"field_id": entry.field_id, "reason": "unknown_baseline_crop"})
            continue
        generated = make_candidate(
            field_id=entry.field_id,
            crop=crop,
            sow=entry.sow_date,
            end=request.end,
            weather=weather,
            effective_rain_fraction=profile.effective_rain_fraction,
        )
        if generated["candidate"] is None:
            baseline_errors.append(
                {
                    "field_id": entry.field_id,
                    "crop_id": entry.crop_id,
                    "sow_date": entry.sow_date.isoformat(),
                    "reason": generated["reason"],
                }
            )
        else:
            baseline_candidates.append(generated["candidate"])
    baseline = None
    if request.baseline:
        baseline_problem = problem.model_copy(update={"candidates": baseline_candidates})
        baseline = option_snapshot(
            "baseline", "Your baseline", baseline_problem, [c.id for c in baseline_candidates]
        )
        baseline["input_errors"] = baseline_errors
        baseline["complete"] = not baseline_errors
        baseline["feasible"] = baseline["feasible"] and not baseline_errors
        baseline["scientific_verification"] = verify_scientific_candidates(
            profile, baseline_candidates, weather
        )
    return {
        "status": "cancelled" if cancelled and cancelled() else first["status"],
        "options": options,
        "baseline": baseline,
        "solver_attempts": results,
        "candidate_count": len(problem.candidates),
        "transition_edge_count": capacity["transition_edge_count"],
        "capacity": capacity,
        "candidate_recipe": prepared["recipe"],
        "sampling_step_days": prepared["sampling_step_days"],
        "rejected_by_reason": prepared["rejected_by_reason"],
        "rejected_candidates": prepared["rejected"],
        "problem": problem.model_dump(mode="json"),
        "candidate_traces": prepared["traces"],
        "weather_basis": (
            "scenario"
            if request.scenario.temperature_change_c or request.scenario.rainfall_change_pct
            else "observed_historical"
            if request.data_release_id
            else "historical_replay"
        ),
        "scenario_recipe": (
            "add-temperature-scale-rainfall-recompute-et0-v1"
            if request.data_release_id
            else "month-day-repeat-feb28-v1"
        ),
        "data_release_id": request.data_release_id,
        "solver_time_limit_seconds": effective_limit,
        "solver_total_runtime_seconds": sum(
            float(result.get("runtime_seconds", 0)) for result in results
        ),
        "options_requested": request.max_options,
        "options_generated": len(options),
        "evidence_only": snapshot.get("provenance", {})
        .get("data_release", {})
        .get("evidence_only", [])
        if snapshot.get("provenance", {}).get("data_release")
        else [],
        "limitations": profile.limitations,
        "objective_definition": {
            "weights": problem.weights.model_dump(),
            "references": problem.references.model_dump(),
            "scope": "generated_candidate_set",
            "is_profit_prediction": False,
        },
    }
