"""Single-path candidate MILP, fixed-scale linear objective and hard constraints."""

from itertools import combinations
from typing import Any

import gurobipy as gp
from gurobipy import GRB

from .coefficients import resources
from .schemas import Problem


def build_model(problem: Problem, env: gp.Env) -> tuple[gp.Model, dict[str, Any]]:
    model = gp.Model("rotation-v2", env=env)
    x = {c.id: model.addVar(vtype=GRB.BINARY, name=f"x:{c.id}") for c in problem.candidates}
    field_map = {f.id: f for f in problem.fields}
    coeff = {c.id: resources(c, field_map[c.field_id]) for c in problem.candidates}
    diversity: list[Any] = []
    edges_count = 0
    for f in problem.fields:
        cs = [c for c in problem.candidates if c.field_id == f.id]
        u = model.addVar(vtype=GRB.BINARY, name=f"u:{f.id}")
        if f.require_crop:
            model.addConstr(u == 1, name=f"required_crop:{f.id}")
        starts = {c.id: model.addVar(vtype=GRB.BINARY) for c in cs}
        ends = {c.id: model.addVar(vtype=GRB.BINARY) for c in cs}
        arcs = [
            (a, b)
            for a in cs
            for b in cs
            if a.occupied_until < b.sow_date and a.crop_id != b.crop_id
        ]
        edges_count += len(arcs)
        if edges_count > 1200:
            model.dispose()
            raise ValueError("candidate_graph_too_large: narrow windows or increase sampling step")
        y = {(a.id, b.id): model.addVar(vtype=GRB.BINARY) for a, b in arcs}
        model.addConstr(gp.quicksum(starts.values()) == u, name=f"single_start:{f.id}")
        model.addConstr(gp.quicksum(ends.values()) == u, name=f"single_end:{f.id}")
        for c in cs:
            model.addConstr(x[c.id] <= u)
            model.addConstr(
                starts[c.id] + gp.quicksum(v for (a, b), v in y.items() if b == c.id) == x[c.id]
            )
            model.addConstr(
                ends[c.id] + gp.quicksum(v for (a, b), v in y.items() if a == c.id) == x[c.id]
            )
            if not f.irrigation_available and any(mm > 1e-7 for mm in c.water_mm):
                model.addConstr(x[c.id] == 0, name=f"no_irrigation:{c.id}")
            for h in f.history:
                gap = (c.sow_date - h.end_latest).days - h.turnaround_days - 1
                if gap < 0 or (h.family == c.family and gap < problem.family_gaps[c.family]):
                    model.addConstr(x[c.id] == 0, name=f"history:{c.id}:{h.crop_id}")
            if f.history and max(f.history, key=lambda h: h.end_latest).crop_id == c.crop_id:
                model.addConstr(starts[c.id] == 0, name=f"historical_adjacency:{c.id}")
        # Active sets change at starts/ends; starts suffice to catch all overlaps.
        for day in sorted({c.sow_date for c in cs}):
            model.addConstr(
                gp.quicksum(x[c.id] for c in cs if c.sow_date <= day <= c.occupied_until) <= 1,
                name=f"occupancy:{f.id}:{day}",
            )
        for a, b in combinations(sorted(cs, key=lambda c: c.sow_date), 2):
            if a.family == b.family:
                gap = (b.sow_date - a.harvest_date).days - a.turnaround_days - 1
                if gap < problem.family_gaps[a.family]:
                    model.addConstr(x[a.id] + x[b.id] <= 1, name=f"family_gap:{a.id}:{b.id}")
        for family in sorted({c.family for c in cs}):
            z = model.addVar(vtype=GRB.BINARY, name=f"family:{f.id}:{family}")
            ids = [c.id for c in cs if c.family == family]
            for cid in ids:
                model.addConstr(z >= x[cid])
            model.addConstr(z <= gp.quicksum(x[cid] for cid in ids))
            diversity.append(z * f.area_ha)
        for year, cap in problem.field_limits.get(f.id, {}).items():
            for metric, limit in cap.model_dump().items():
                model.addConstr(
                    gp.quicksum(coeff[c.id].get(year, {}).get(metric, 0) * x[c.id] for c in cs)
                    <= limit,
                    name=f"field_resource:{f.id}:{year}:{metric}",
                )
    for year, cap in problem.farm_limits.items():
        for metric, limit in cap.model_dump().items():
            model.addConstr(
                gp.quicksum(
                    coeff[c.id].get(year, {}).get(metric, 0) * x[c.id] for c in problem.candidates
                )
                <= limit,
                name=f"farm_resource:{year}:{metric}",
            )

    def total(metric: str) -> Any:
        return gp.quicksum(
            sum(r[metric] for r in coeff[c.id].values()) * x[c.id] for c in problem.candidates
        )

    w, r = problem.weights, problem.references
    model.setObjective(
        w.cover * total("cover_ha_days") / r.cover
        + w.diversity * gp.quicksum(diversity) / r.diversity
        - w.water * total("water_m3") / r.water
        - w.cost * total("cost_usd") / r.cost,
        GRB.MAXIMIZE,
    )
    model.update()
    return model, x
