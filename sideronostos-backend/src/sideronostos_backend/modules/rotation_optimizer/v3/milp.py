"""Daily v3 Gurobi model: one path per field, hard rules and two objective priorities."""

from dataclasses import dataclass
from datetime import date, timedelta
from itertools import combinations
from typing import Any

import gurobipy as gp
from gurobipy import GRB

from .model import Capacity, Problem


@dataclass
class BuiltModel:
    model: gp.Model
    selected: dict[str, gp.Var]
    water: dict[tuple[str, date], gp.Var]
    gap_cost: gp.LinExpr
    score: gp.LinExpr
    gaps: dict[str, gp.Var]


def build_model(problem: Problem, env: gp.Env) -> BuiltModel:
    model = gp.Model("rotation-v3", env=env)
    fields = {field.id: field for field in problem.fields}
    x = {c.id: model.addVar(vtype=GRB.BINARY, name=f"x:{c.id}") for c in problem.candidates}
    transitions = {}
    for field in problem.fields:
        candidates = [c for c in problem.candidates if c.field_id == field.id]
        starts = {c.id: model.addVar(vtype=GRB.BINARY, name=f"start:{c.id}") for c in candidates}
        ends = {c.id: model.addVar(vtype=GRB.BINARY, name=f"end:{c.id}") for c in candidates}
        arcs = {
            (a.id, b.id): model.addVar(vtype=GRB.BINARY, name=f"after:{a.id}:{b.id}")
            for a in candidates
            for b in candidates
            if a.occupied_until < b.sow_date and a.species_id != b.species_id
        }
        transitions.update(arcs)
        model.addConstr(gp.quicksum(starts.values()) == 1, name=f"single_start:{field.id}")
        model.addConstr(gp.quicksum(ends.values()) == 1, name=f"single_end:{field.id}")
        model.addConstr(
            gp.quicksum(x[c.id] for c in candidates) >= 1, name=f"crop_required:{field.id}"
        )
        for c in candidates:
            model.addConstr(x[c.id] <= int(c.suitability.eligible), name=f"suitability:{c.id}")
            model.addConstr(
                starts[c.id] + gp.quicksum(v for (a, b), v in arcs.items() if b == c.id) == x[c.id]
            )
            model.addConstr(
                ends[c.id] + gp.quicksum(v for (a, b), v in arcs.items() if a == c.id) == x[c.id]
            )
            if not field.irrigation_available and any(v > 1e-8 for v in c.water_mm):
                model.addConstr(x[c.id] == 0, name=f"no_irrigation:{c.id}")
            for previous in field.history:
                days = (c.sow_date - previous.end_latest).days - previous.turnaround_days - 1
                if days < 0 or (
                    previous.family == c.family and days < problem.family_gaps[c.family]
                ):
                    model.addConstr(x[c.id] == 0, name=f"history:{c.id}:{previous.crop_id}")
            if field.history:
                latest = max(h.end_latest for h in field.history)
                if any(
                    h.end_latest == latest and h.species_id == c.species_id for h in field.history
                ):
                    model.addConstr(starts[c.id] == 0, name=f"historical_adjacency:{c.id}")
        for day in {c.sow_date for c in candidates}:
            model.addConstr(
                gp.quicksum(x[c.id] for c in candidates if c.sow_date <= day <= c.occupied_until)
                <= 1,
                name=f"occupancy:{field.id}:{day}",
            )
        for a, b in combinations(sorted(candidates, key=lambda c: c.sow_date), 2):
            if (
                a.family == b.family
                and (b.sow_date - a.harvest_date).days - a.turnaround_days - 1
                < problem.family_gaps[a.family]
            ):
                model.addConstr(x[a.id] + x[b.id] <= 1, name=f"family_gap:{a.id}:{b.id}")

    # Minimal NIR is an exact elimination of dominated over-irrigation: every active
    # water unit has a strictly negative secondary objective and nonnegative resource
    # burden. Equality preserves all optimal schedules of the documented >= model.
    water: dict[tuple[str, date], gp.Var] = {}
    for field in problem.fields:
        cs = [c for c in problem.candidates if c.field_id == field.id]
        active_days = {
            c.sow_date + timedelta(days=i) for c in cs for i, mm in enumerate(c.water_mm) if mm > 0
        }
        for day in active_days:
            variable = model.addVar(lb=0, name=f"water:{field.id}:{day}")
            model.addConstr(
                variable
                == gp.quicksum(
                    c.water_mm[(day - c.sow_date).days] * x[c.id]
                    for c in cs
                    if c.sow_date <= day <= c.harvest_date
                ),
                name=f"nir:{field.id}:{day}",
            )
            water[field.id, day] = variable
    gaps: dict[str, gp.Var] = {}
    gap_cost = gp.LinExpr()

    def capacity(identifier: str, used: gp.LinExpr, limit: Capacity) -> None:
        if used.size() == 0 and used.getConstant() <= limit.capacity:
            return
        if limit.remediable:
            slack = model.addVar(lb=0, name=f"gap:{identifier}")
            gaps[identifier] = slack
            assert limit.gap_unit_cost is not None
            gap_cost.add(slack, limit.gap_unit_cost)
            model.addConstr(used <= limit.capacity + slack, name=f"capacity:{identifier}")
        else:
            model.addConstr(used <= limit.capacity, name=f"hard_capacity:{identifier}")

    for daily in problem.daily_resources:
        for day, limit in daily.days.items():
            if daily.kind == "water":
                used = gp.quicksum(
                    10 * fields[fid].area_ha * water[fid, day]
                    for fid in daily.field_ids
                    if (fid, day) in water
                )
            else:
                used = gp.quicksum(
                    fields[c.field_id].area_ha
                    * c.machine_hours_ha.get(daily.id, {}).get(day, 0)
                    * x[c.id]
                    for c in problem.candidates
                    if c.field_id in daily.field_ids
                    and c.machine_hours_ha.get(daily.id, {}).get(day, 0) > 0
                )
            capacity(f"{daily.kind}:{daily.id}:{day}", used, limit)
    periods = {p.id: p for p in problem.periods}
    for supply in problem.period_resources:
        period = periods[supply.period_id]
        cs = [
            c
            for c in problem.candidates
            if fields[c.field_id].farm_id == supply.farm_id
            and c.crop_id == supply.crop_id
            and period.start
            <= (c.sow_date if supply.kind == "seed" else c.harvest_date)
            <= period.end
        ]
        used = gp.quicksum(
            fields[c.field_id].area_ha
            * (c.seed_kg_ha if supply.kind == "seed" else c.yield_kg_ha)
            * x[c.id]
            for c in cs
        )
        capacity(f"{supply.kind}:{supply.id}", used, supply.limit)
    count = (problem.end - problem.start).days + 1
    bare = {
        field.id: count
        - gp.quicksum(
            sum(c.cover_mask) * x[c.id] for c in problem.candidates if c.field_id == field.id
        )
        for field in problem.fields
    }
    for fid, limit in problem.bare_limits.items():
        capacity(f"bare:{fid}", bare[fid], limit)
    raw: dict[str, Any] = {
        "water": gp.quicksum(10 * fields[fid].area_ha * value for (fid, _), value in water.items()),
        "bare": gp.quicksum(fields[fid].area_ha * value for fid, value in bare.items()),
        "profit": gp.quicksum(
            fields[c.field_id].area_ha * c.profit_usd_ha * x[c.id]
            for c in problem.candidates
            if c.profit_usd_ha is not None
        ),
        "soil": gp.quicksum(
            fields[c.field_id].area_ha * c.soil_score * x[c.id]
            for c in problem.candidates
            if c.soil_score is not None
        ),
        "risk": gp.quicksum(
            fields[c.field_id].area_ha * c.risk_score * x[c.id]
            for c in problem.candidates
            if c.risk_score is not None
        ),
        "rotation": gp.quicksum(
            b.score * transitions[b.before, b.after] for b in problem.rotation_benefits
        ),
    }
    score = gp.quicksum(
        getattr(problem.weights, metric)
        * raw[metric]
        / scale
        * (-1 if metric in ("water", "risk", "bare") else 1)
        for metric, scale in problem.scales.items()
    )
    model.ModelSense = GRB.MAXIMIZE
    model.setObjectiveN(
        -gap_cost, 0, priority=2, abstol=0, reltol=0, name="minimize_resource_gap_cost"
    )
    model.setObjectiveN(
        score, 1, priority=1, abstol=0, reltol=0, name="maximize_normalized_six_metric_score"
    )
    model.update()
    return BuiltModel(model, x, water, gap_cost, score, gaps)
