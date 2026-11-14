"""Shared candidate-graph capacity accounting for preflight and MILP execution."""

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any

from .candidates import historical_weather, replay_weather
from .prepare import generate_candidates
from .profiles import ProfileV2
from .schemas import Candidate, PlanningField

LEGACY_MAX_CANDIDATES = 240
LEGACY_MAX_TRANSITION_EDGES = 1200
PREFLIGHT_RECIPE = "rotation-capacity-preflight-v1"


@dataclass(frozen=True)
class CapacityLimits:
    max_candidates: int
    max_transition_edges: int

    def as_dict(self) -> dict[str, int]:
        return {
            "max_candidates": self.max_candidates,
            "max_transition_edges": self.max_transition_edges,
        }


def compatible_arcs(candidates: Iterable[Candidate]) -> list[tuple[Candidate, Candidate]]:
    values = list(candidates)
    return [
        (first, second)
        for first in values
        for second in values
        if first.occupied_until < second.sow_date and first.crop_id != second.crop_id
    ]


def transition_edge_count(
    candidates: Iterable[Candidate], *, limit: int | None = None
) -> tuple[int, bool]:
    by_field: dict[str, list[Candidate]] = {}
    for candidate in candidates:
        by_field.setdefault(candidate.field_id, []).append(candidate)
    count = 0
    for values in by_field.values():
        for first in values:
            for second in values:
                if first.occupied_until < second.sow_date and first.crop_id != second.crop_id:
                    count += 1
                    if limit is not None and count > limit:
                        return count, True
    return count, False


def capacity_violations(
    *,
    candidate_count: int,
    candidate_count_truncated: bool,
    transition_edges: int | None,
    transition_edges_truncated: bool,
    limits: CapacityLimits,
    field_count: int,
    crop_count: int,
    year_count: int,
    sampling_step_days: int,
) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    factors = {
        "field_count": field_count,
        "crop_count": crop_count,
        "year_count": year_count,
        "sampling_step_days": sampling_step_days,
    }
    if candidate_count_truncated or candidate_count > limits.max_candidates:
        violations.append(
            {
                "dimension": "candidates",
                "count": candidate_count,
                "limit": limits.max_candidates,
                "truncated": candidate_count_truncated,
                "factors": factors,
                "message": (
                    "Candidate capacity is exceeded by the selected fields, crops, years "
                    "and sowing dates."
                ),
                "suggestion": "Reduce fields, crops or years, or narrow the sowing windows.",
            }
        )
    if transition_edges is not None and (
        transition_edges_truncated or transition_edges > limits.max_transition_edges
    ):
        violations.append(
            {
                "dimension": "transition_edges",
                "count": transition_edges,
                "limit": limits.max_transition_edges,
                "truncated": transition_edges_truncated,
                "factors": factors,
                "message": (
                    "Transition capacity is exceeded by compatible season-to-season "
                    "combinations within fields."
                ),
                "suggestion": "Narrow sowing windows or reduce crops, fields or planning years.",
            }
        )
    return violations


def rejected_count(prepared: dict[str, Any]) -> int:
    return sum(Counter(row["reason"] for row in prepared["rejected"]).values())


def prepare_snapshot_candidates(
    snapshot: dict[str, Any], limits: CapacityLimits
) -> tuple[ProfileV2, list[PlanningField], dict[date, dict[str, Any]], dict[str, Any]]:
    request = snapshot["request"]
    profile = ProfileV2.model_validate(snapshot["profile"])
    fields = [PlanningField.model_validate(value) for value in snapshot["planning_fields"]]
    start = date.fromisoformat(str(request["start"]))
    end = date.fromisoformat(str(request["end"]))
    scenario = request.get("scenario") or {}
    weather = (
        historical_weather(snapshot["weather"], start, end, **scenario)
        if request.get("data_release_id")
        else replay_weather(snapshot["weather"], start, end, **scenario)
    )
    prepared = generate_candidates(
        profile=profile,
        fields=fields,
        start=start,
        end=end,
        weather=weather,
        allowed_crop_ids=list(request["allowed_crop_ids"]),
        sow_windows=request.get("sow_windows") or {},
        max_candidates=limits.max_candidates,
        truncate_on_limit=True,
    )
    return profile, fields, weather, prepared


def capacity_report(
    *,
    profile: ProfileV2,
    fields: list[PlanningField],
    prepared: dict[str, Any],
    request: dict[str, Any],
    limits: CapacityLimits,
) -> dict[str, Any]:
    candidate_count = len(prepared["candidates"])
    candidate_truncated = bool(prepared["candidate_count_truncated"])
    edges: int | None = None
    edges_truncated = False
    if not candidate_truncated:
        edges, edges_truncated = transition_edge_count(
            prepared["candidates"], limit=limits.max_transition_edges
        )
    start = date.fromisoformat(str(request["start"]))
    end = date.fromisoformat(str(request["end"]))
    violations = capacity_violations(
        candidate_count=candidate_count,
        candidate_count_truncated=candidate_truncated,
        transition_edges=edges,
        transition_edges_truncated=edges_truncated,
        limits=limits,
        field_count=len(fields),
        crop_count=len(request["allowed_crop_ids"]),
        year_count=end.year - start.year + 1,
        sampling_step_days=profile.sowing_step_days,
    )
    return {
        "recipe": PREFLIGHT_RECIPE,
        "profile_id": profile.id,
        "sampling_step_days": profile.sowing_step_days,
        "candidate_count": candidate_count,
        "candidate_count_truncated": candidate_truncated,
        "rejected_candidate_count": rejected_count(prepared),
        "transition_edge_count": edges,
        "transition_edge_count_truncated": edges_truncated,
        "limits": limits.as_dict(),
        "within_capacity": not violations,
        "violations": violations,
    }


def analyze_snapshot_capacity(snapshot: dict[str, Any], limits: CapacityLimits) -> dict[str, Any]:
    profile, fields, _weather, prepared = prepare_snapshot_candidates(snapshot, limits)
    return capacity_report(
        profile=profile,
        fields=fields,
        prepared=prepared,
        request=snapshot["request"],
        limits=limits,
    )
