"""Compile a bounded, explicit candidate set; exclusions never become silent truncation."""

from collections import Counter
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any, cast

from ...field_shift.schemas import Field as FieldSnapshot
from .coefficients import COEFFICIENT_RECIPE, candidate_id, make_candidate
from .contracts import PRECOMPUTE_VERSION
from .inputs import PlanningDraft
from .model import MAX_CANDIDATES, MAX_EDGES, Candidate, PlanningField, Problem, RotationBenefit
from .preflight import assess_inputs, resolve_history
from .preparation_verify import verify_preparation
from .profiles import ProfileV3, parameter_records
from .resources import compile_resources
from .weather import prepare_weather

MAX_SAMPLED_STARTS = 5000


def prepare_problem(
    *,
    draft: PlanningDraft,
    profile: ProfileV3,
    fields: list[FieldSnapshot],
    raw_weather: dict[str, Any],
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    report = assess_inputs(draft, profile, fields)
    checked_weather = prepare_weather(raw_weather, profile, draft)
    result: dict[str, Any] = {
        "ready": False,
        "stage": "data_preflight",
        "problem": None,
        "errors": [],
        "readiness": report,
        "weather": {k: v for k, v in checked_weather.items() if k != "days"},
        "rejected": [],
        "traces": {},
        "baseline_ids": [],
        "version": PRECOMPUTE_VERSION,
        "coefficient_recipe": COEFFICIENT_RECIPE,
        "sampling": {
            "step_days": profile.sowing_step_days,
            "includes_confirmed_baseline_dates": True,
            "scope": "generated_candidate_set",
        },
    }
    if not report["ready"] or not checked_weather["ready"]:
        return result
    weather = {date.fromisoformat(k): v for k, v in checked_weather["days"].items()}
    result["stage"] = "candidate_preparation"
    by_id = {f.id: f for f in fields}
    planning = [
        PlanningField(
            id=f.id,
            farm_id=cast(str, f.farm_id),
            area_ha=f.area_ha,
            irrigation_available=f.irrigation_available,
            water_system_id=draft.field_conditions[f.id].water_system_id,
            history=resolve_history(f, profile, draft.start),
        )
        for f in fields
    ]
    baseline = {(b.field_id, b.crop_id, b.sow_date) for b in draft.baseline}
    starts: set[tuple[str, str, date]] = set(baseline)
    for f in fields:
        for crop_id in draft.allowed_crop_ids:
            for year in range(draft.start.year, draft.end.year + 1):
                for first, last in profile.crops[crop_id].sow_windows:
                    day = date.fromisoformat(f"{year}-{first}")
                    stop = date.fromisoformat(f"{year}-{last}")
                    while day <= stop:
                        if draft.start <= day <= draft.end:
                            starts.add((f.id, crop_id, day))
                        day += timedelta(days=profile.sowing_step_days)
    result["sampling"]["attempted_starts"] = len(starts)
    if len(starts) > MAX_SAMPLED_STARTS:
        result["errors"] = ["sampled_start_limit_exceeded"]
        return result
    resources = compile_resources(draft)
    candidates: list[Candidate] = []
    planning_by_id = {f.id: f for f in planning}
    for fid, crop_id, sow in sorted(starts):
        if cancelled and cancelled():
            result["errors"] = ["cancelled"]
            return result
        item = make_candidate(
            draft=draft,
            profile=profile,
            field=by_id[fid],
            planning_field=planning_by_id[fid],
            crop_id=crop_id,
            sow=sow,
            weather=weather,
            daily_resources=resources["daily_resources"],
            period_resources=resources["period_resources"],
            baseline=(fid, crop_id, sow) in baseline,
        )
        c = item["candidate"]
        if c is None:
            result["rejected"].append(
                {
                    "field_id": fid,
                    "crop_id": crop_id,
                    "sow_date": sow.isoformat(),
                    "reasons": item["reasons"],
                    "confirmed_baseline": (fid, crop_id, sow) in baseline,
                }
            )
        else:
            candidates.append(c)
            result["traces"][c.id] = item["trace"]
            if len(candidates) > MAX_CANDIDATES:
                result["errors"] = ["candidate_limit_exceeded"]
                return result
    result["rejected_by_reason"] = dict(
        Counter(reason for r in result["rejected"] for reason in r["reasons"])
    )
    included = {c.id for c in candidates}
    for fid, crop_id, sow in sorted(baseline):
        cid = candidate_id(fid, crop_id, sow)
        if cid in included:
            result["baseline_ids"].append(cid)
        else:
            result["errors"].append(
                {
                    "code": "confirmed_baseline_unavailable",
                    "field_id": fid,
                    "crop_id": crop_id,
                    "sow_date": sow.isoformat(),
                }
            )
    for f in fields:
        if not any(c.field_id == f.id for c in candidates):
            result["errors"].append({"code": "field_has_no_candidate", "field_id": f.id})
    if result["errors"]:
        return result
    arcs = [
        (a, b)
        for a in candidates
        for b in candidates
        if a.field_id == b.field_id
        and a.occupied_until < b.sow_date
        and a.species_id != b.species_id
    ]
    if len(arcs) > MAX_EDGES:
        result["errors"] = ["candidate_graph_limit_exceeded"]
        return result
    transitions = []
    records = parameter_records(profile)
    if "rotation" not in draft.disabled_metrics and profile.transition_scores is not None:
        transitions = [
            RotationBenefit(
                before=a.id,
                after=b.id,
                score=profile.transition_scores[a.crop_id][b.crop_id],
                evidence_ids=[
                    "profile:" + sid
                    for sid in records[f"transition_scores.{a.crop_id}.{b.crop_id}"].source_ids
                ],
            )
            for a, b in arcs
        ]
    problem = Problem(
        start=draft.start,
        end=draft.end,
        fields=planning,
        candidates=candidates,
        family_gaps=profile.family_gaps,
        periods=draft.periods,
        **resources,
        weights=draft.weights or profile.default_weights,
        scales={k: v for k, v in profile.scales.items() if k not in draft.disabled_metrics},
        disabled_metrics={k: v for k, v in draft.disabled_metrics.items()},
        rotation_benefits=transitions,
    )
    proof = verify_preparation(
        problem=problem,
        draft=draft,
        profile=profile,
        fields=fields,
        raw_weather=raw_weather,
        traces=result["traces"],
    )
    result["verification"] = proof
    if not proof["valid"]:
        result["errors"] = ["coefficient_verification_failed"]
        return result
    result.update(
        ready=True,
        stage="prepared",
        problem=problem,
        candidate_count=len(candidates),
        edge_count=len(arcs),
    )
    return result
