"""Exact compact formulation for annual candidate sets with at most one season per year."""

from dataclasses import dataclass
from itertools import combinations
from typing import Any

import gurobipy as gp
from gurobipy import GRB

from .coefficients import resources
from .schemas import Problem

FORMULATION = "annual-layered-state-v1"


@dataclass(frozen=True)
class AnnualStructure:
    eligible: bool
    reason: str | None
    years: tuple[int, ...]
    crops: tuple[str, ...]
    families: tuple[str, ...]
    temporal_conflicts: tuple[tuple[str, str], ...]
    grouped_family_conflicts: tuple[tuple[str, int, int, str], ...]
    family_conflicts: tuple[tuple[str, str], ...]


def annual_structure(problem: Problem) -> AnnualStructure:
    years = tuple(range(problem.start.year, problem.end.year + 1))
    crops = tuple(sorted({candidate.crop_id for candidate in problem.candidates}))
    families = tuple(sorted({candidate.family for candidate in problem.candidates}))
    temporal: set[tuple[str, str]] = set()
    family: set[tuple[str, str]] = set()
    grouped: set[tuple[str, int, int, str]] = set()
    for field in problem.fields:
        candidates = sorted(
            (candidate for candidate in problem.candidates if candidate.field_id == field.id),
            key=lambda candidate: candidate.sow_date,
        )
        if any(
            candidate.sow_date.year != candidate.harvest_date.year
            or candidate.occupied_until.year != candidate.sow_date.year
            for candidate in candidates
        ):
            return AnnualStructure(
                False, "candidate_crosses_calendar_year", years, crops, families, (), (), ()
            )
        for first, second in combinations(candidates, 2):
            if first.sow_date.year == second.sow_date.year:
                if first.occupied_until < second.sow_date and first.crop_id != second.crop_id:
                    return AnnualStructure(
                        False,
                        "multiple_seasons_possible_in_year",
                        years,
                        crops,
                        families,
                        (),
                        (),
                        (),
                    )
                continue
            if first.occupied_until >= second.sow_date:
                temporal.add((first.id, second.id))
        for family_id in families:
            for first_year, second_year in combinations(years, 2):
                first_values = [
                    candidate
                    for candidate in candidates
                    if candidate.family == family_id and candidate.sow_date.year == first_year
                ]
                second_values = [
                    candidate
                    for candidate in candidates
                    if candidate.family == family_id and candidate.sow_date.year == second_year
                ]
                if not first_values or not second_values:
                    continue
                conflicts = {
                    (first.id, second.id)
                    for first in first_values
                    for second in second_values
                    if (
                        (second.sow_date - first.harvest_date).days
                        - first.turnaround_days
                        - 1
                    )
                    < problem.family_gaps[family_id]
                }
                if len(conflicts) == len(first_values) * len(second_values):
                    grouped.add((field.id, first_year, second_year, family_id))
                else:
                    family.update(conflicts)
    return AnnualStructure(
        True,
        None,
        years,
        crops,
        families,
        tuple(sorted(temporal)),
        tuple(sorted(grouped)),
        tuple(sorted(family)),
    )


def annual_size_estimate(problem: Problem, structure: AnnualStructure) -> dict[str, int]:
    if not structure.eligible:
        raise ValueError("Annual formulation is not eligible")
    field_count = len(problem.fields)
    year_count = len(structure.years)
    crop_count = len(structure.crops)
    family_count = len(structure.families)
    variables = len(problem.candidates) + field_count * (
        year_count
        + year_count * crop_count
        + (year_count + 1) * crop_count
        + family_count
    )
    history = sum(len(field.history) * len(problem.candidates) for field in problem.fields)
    irrigation = sum(
        1
        for field in problem.fields
        for candidate in problem.candidates
        if candidate.field_id == field.id
        and not field.irrigation_available
        and any(value > 1e-7 for value in candidate.water_mm)
    )
    constraints = (
        field_count * year_count
        + field_count * crop_count
        + field_count * year_count * crop_count * 6
        + sum(1 for field in problem.fields if field.require_crop)
        + len(structure.temporal_conflicts)
        + len(structure.grouped_family_conflicts)
        + len(structure.family_conflicts)
        + field_count * (year_count * crop_count + family_count)
        + history
        + irrigation
        + 3 * year_count * (field_count + 1)
    )
    return {"variables": variables, "constraints": constraints}


def build_annual_model(
    problem: Problem, env: gp.Env, structure: AnnualStructure
) -> tuple[gp.Model, dict[str, Any]]:
    if not structure.eligible:
        raise ValueError("Annual formulation is not eligible")
    model = gp.Model("rotation-v2-annual", env=env)
    x = {
        candidate.id: model.addVar(vtype=GRB.BINARY, name=f"x:{candidate.id}")
        for candidate in problem.candidates
    }
    field_map = {field.id: field for field in problem.fields}
    candidate_map = {candidate.id: candidate for candidate in problem.candidates}
    coeff = {
        candidate.id: resources(candidate, field_map[candidate.field_id])
        for candidate in problem.candidates
    }
    diversity: list[Any] = []
    for field in problem.fields:
        candidates = [
            candidate for candidate in problem.candidates if candidate.field_id == field.id
        ]
        by_year = {
            year: [candidate for candidate in candidates if candidate.sow_date.year == year]
            for year in structure.years
        }
        q = {
            year: model.addVar(vtype=GRB.BINARY, name=f"year:{field.id}:{year}")
            for year in structure.years
        }
        crop = {
            (year, crop_id): model.addVar(
                vtype=GRB.BINARY, name=f"crop:{field.id}:{year}:{crop_id}"
            )
            for year in structure.years
            for crop_id in structure.crops
        }
        family_year = {
            (year, family_id): gp.quicksum(
                crop[year, crop_id]
                for crop_id in structure.crops
                if any(
                    candidate.crop_id == crop_id and candidate.family == family_id
                    for candidate in candidates
                )
            )
            for year in structure.years
            for family_id in structure.families
        }
        last = {
            (index, crop_id): model.addVar(
                vtype=GRB.BINARY, name=f"last:{field.id}:{index}:{crop_id}"
            )
            for index in range(len(structure.years) + 1)
            for crop_id in structure.crops
        }
        latest = max(field.history, key=lambda item: item.end_latest) if field.history else None
        for crop_id in structure.crops:
            model.addConstr(
                last[0, crop_id] == int(latest is not None and latest.crop_id == crop_id),
                name=f"initial_crop:{field.id}:{crop_id}",
            )
        for index, year in enumerate(structure.years):
            values = by_year[year]
            model.addConstr(
                q[year] == gp.quicksum(x[candidate.id] for candidate in values),
                name=f"one_season:{field.id}:{year}",
            )
            for crop_id in structure.crops:
                z = crop[year, crop_id]
                model.addConstr(
                    z
                    == gp.quicksum(
                        x[candidate.id]
                        for candidate in values
                        if candidate.crop_id == crop_id
                    ),
                    name=f"crop_choice:{field.id}:{year}:{crop_id}",
                )
                model.addConstr(
                    z + last[index, crop_id] <= 1,
                    name=f"different_next_crop:{field.id}:{year}:{crop_id}",
                )
                following = last[index + 1, crop_id]
                preceding = last[index, crop_id]
                model.addConstr(following >= z)
                model.addConstr(following >= preceding - q[year])
                model.addConstr(following <= z + preceding)
                model.addConstr(following <= z + 1 - q[year])
        if field.require_crop:
            model.addConstr(
                gp.quicksum(x[candidate.id] for candidate in candidates) >= 1,
                name=f"required_crop:{field.id}",
            )
        for candidate in candidates:
            if not field.irrigation_available and any(value > 1e-7 for value in candidate.water_mm):
                model.addConstr(x[candidate.id] == 0, name=f"no_irrigation:{candidate.id}")
            for history in field.history:
                gap = (
                    (candidate.sow_date - history.end_latest).days
                    - history.turnaround_days
                    - 1
                )
                if gap < 0 or (
                    history.family == candidate.family
                    and gap < problem.family_gaps[candidate.family]
                ):
                    model.addConstr(
                        x[candidate.id] == 0,
                        name=f"history:{candidate.id}:{history.crop_id}",
                    )
        for first_id, second_id in structure.temporal_conflicts:
            if candidate_map[first_id].field_id == field.id:
                model.addConstr(x[first_id] + x[second_id] <= 1)
        for first_id, second_id in structure.family_conflicts:
            if candidate_map[first_id].field_id == field.id:
                model.addConstr(x[first_id] + x[second_id] <= 1)
        for field_id, first_year, second_year, family_id in structure.grouped_family_conflicts:
            if field_id == field.id:
                model.addConstr(
                    family_year[first_year, family_id] + family_year[second_year, family_id]
                    <= 1,
                    name=(
                        f"family_gap_group:{field.id}:{first_year}:{second_year}:{family_id}"
                    ),
                )
        for family in structure.families:
            family_used = model.addVar(
                vtype=GRB.BINARY, name=f"family:{field.id}:{family}"
            )
            members = [
                family_year[year, family]
                for year in structure.years
            ]
            for member in members:
                model.addConstr(family_used >= member)
            model.addConstr(family_used <= gp.quicksum(members))
            diversity.append(family_used * field.area_ha)
        for year, cap in problem.field_limits.get(field.id, {}).items():
            for metric, limit in cap.model_dump().items():
                model.addConstr(
                    gp.quicksum(
                        coeff[candidate.id].get(year, {}).get(metric, 0) * x[candidate.id]
                        for candidate in candidates
                    )
                    <= limit,
                    name=f"field_resource:{field.id}:{year}:{metric}",
                )
    for year, cap in problem.farm_limits.items():
        for metric, limit in cap.model_dump().items():
            model.addConstr(
                gp.quicksum(
                    coeff[candidate.id].get(year, {}).get(metric, 0) * x[candidate.id]
                    for candidate in problem.candidates
                )
                <= limit,
                name=f"farm_resource:{year}:{metric}",
            )

    def total(metric: str) -> Any:
        return gp.quicksum(
            sum(value[metric] for value in coeff[candidate.id].values()) * x[candidate.id]
            for candidate in problem.candidates
        )

    weights, references = problem.weights, problem.references
    model.setObjective(
        weights.cover * total("cover_ha_days") / references.cover
        + weights.diversity * gp.quicksum(diversity) / references.diversity
        - weights.water * total("water_m3") / references.water
        - weights.cost * total("cost_usd") / references.cost,
        GRB.MAXIMIZE,
    )
    model.update()
    return model, x
