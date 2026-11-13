"""Freeze synthetic farmer contexts from REAL published science and real Gurobi runs.

All temporary DB rows live inside one rollback-only transaction. No job is dispatched.
Controlled timeout/failed states are explicitly labelled; they are not real solver outcomes.
"""

import argparse
import asyncio
import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException

from ....core import installed_models  # noqa: F401
from ....core.config import get_settings
from ...agri_data.models import RegionSelection
from ...agri_data.schemas import validate_geometry
from ...agri_data.service import AgriDataService
from ...database.session import create_engine, create_session_factory
from ...field_shift.models import FieldRecord
from ...field_shift.schemas import FieldInput, HistoryEntry
from ...jobs.models import Job, JobStatus
from ...rotation_optimizer.execution import execute_snapshot
from ...rotation_optimizer.models import OptimizationRun
from ...rotation_optimizer.profiles import get_profile, profile_hash
from ...rotation_optimizer.requests import RunRequest, resolve_history
from ..context import freeze_context
from ..schemas import ContextRef

CASES = Path(__file__).with_name("cases-v1.json")
OWNER = str(uuid5(NAMESPACE_URL, "field-shift-evaluation-owner-v1"))
STAMP = datetime(2026, 11, 12, tzinfo=UTC)


def ident(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, "field-shift-frozen-evaluation-v1/" + name))


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


async def prepare() -> dict[str, Any]:
    cases = json.loads(CASES.read_text())["cases"]
    expected = CASES.with_suffix(".sha256").read_text().split()[0]
    if hashlib.sha256(CASES.read_bytes()).hexdigest() != expected:
        raise ValueError("Frozen case set changed")
    engine = create_engine(get_settings())
    profile = get_profile("iowa-benchmark-20261112-v1")
    contexts: dict[str, Any] = {}
    runs: dict[str, dict[str, Any]] = {}
    gate_results: dict[str, bool] = {}
    try:
        async with create_session_factory(engine)() as session:
            # Never commit this session. Actual published weather and SMAP assets are read only.
            weather = await AgriDataService().weather(session, OWNER, profile.weather_release_id)
            fields: list[dict[str, Any]] = []
            for name, area, longitude in [
                ("North benchmark", 8, -93.5),
                ("South benchmark", 5, -93.48),
            ]:
                field = FieldInput(
                    name=name,
                    area_ha=area,
                    latitude=42,
                    longitude=longitude,
                    soil_texture="loam",
                    irrigation_available=True,
                    profile_id="temperate-demo",
                    history=[HistoryEntry(year=2025, crop_id="maize")],
                )
                data = {
                    **field.model_dump(mode="json"),
                    "id": ident(name),
                    "version": 1,
                    "created_at": STAMP.isoformat(),
                    "updated_at": STAMP.isoformat(),
                }
                fields.append(data)
                session.add(
                    FieldRecord(
                        id=data["id"],
                        owner_user_id=OWNER,
                        version=1,
                        data=field.model_dump(mode="json"),
                        created_at=STAMP,
                        updated_at=STAMP,
                    )
                )
            await session.flush()
            request: dict[str, Any] = {
                "idempotency_key": "frozen-base-v1",
                "profile_id": profile.id,
                "fields": [
                    {"id": f["id"], "expected_version": 1, "history_reviewed": True} for f in fields
                ],
                "start": "2027-01-01",
                "end": "2029-12-31",
                "allowed_crop_ids": ["maize", "oat", "pea"],
                "farm_limits": {
                    str(y): {"water_m3": 50000, "cost_usd": 10000, "labor_days": 100}
                    for y in range(2027, 2030)
                },
                "accept_benchmark_assumptions": True,
                "baseline": [
                    {"field_id": f["id"], "crop_id": "maize", "sow_date": f"{year}-04-20"}
                    for f in fields
                    for year in range(2027, 2030)
                ],
            }
            for name in ("base", "budget", "scenario", "weights", "infeasible"):
                raw = deepcopy(request)
                raw["idempotency_key"] = "frozen-" + name + "-v1"
                if name == "budget":
                    for caps in raw["farm_limits"].values():
                        caps["cost_usd"] = 4000
                if name == "scenario":
                    raw["scenario"] = {"rainfall_change_pct": -20}
                if name == "weights":
                    raw["weights"] = {"cover": 1, "diversity": 1, "water": 3, "cost": 1}
                if name == "infeasible":
                    for caps in raw["farm_limits"].values():
                        caps.update(water_m3=0, cost_usd=0, labor_days=0)
                body = RunRequest.model_validate(raw)
                planning = []
                for f in fields:
                    source = FieldInput.model_validate(
                        {
                            k: v
                            for k, v in f.items()
                            if k not in ("id", "version", "created_at", "updated_at")
                        }
                    )
                    planning.append(
                        {
                            "id": f["id"],
                            "area_ha": f["area_ha"],
                            "irrigation_available": True,
                            "require_crop": True,
                            "history": [
                                h.model_dump(mode="json")
                                for h in resolve_history(source, profile, body.start)
                            ],
                        }
                    )
                snapshot = {
                    "request": body.model_dump(mode="json"),
                    "fields": fields,
                    "planning_fields": planning,
                    "profile": profile.model_dump(mode="json"),
                    "weather": weather,
                    "provenance": {
                        "profile_id": profile.id,
                        "profile_sha256": profile_hash(profile),
                        "weather_release_id": weather["release_id"],
                        "weather_sha256": weather["manifest_sha256"],
                        "benchmark_scope": profile.scope,
                        "limitations": profile.limitations,
                        "sources": {
                            k: v.model_dump(mode="json") for k, v in profile.sources.items()
                        },
                        "parameter_origins": profile.parameter_origins,
                    },
                }
                result = await asyncio.to_thread(execute_snapshot, snapshot, time_limit=30)
                if name == "infeasible":
                    assert result["status"] == "infeasible"
                else:
                    assert result["options"] and all(
                        o["feasible"] and o["scientific_verification"]["valid"]
                        for o in result["options"]
                    )
                runs[name] = {
                    "input": snapshot,
                    "result": result,
                    "fixture_kind": "real_solver_real_weather_synthetic_fields",
                }
                print(
                    json.dumps(
                        {
                            "prepared_run": name,
                            "status": result["status"],
                            "options": len(result.get("options", [])),
                        }
                    ),
                    flush=True,
                )
            for name, status in [("timeout", "timeout_feasible"), ("failed", "failed")]:
                controlled = deepcopy(runs["base"])
                controlled["fixture_kind"] = "controlled_state_fixture_not_actual_solver_outcome"
                controlled["result"]["status"] = status
                if name == "timeout":
                    for option in controlled["result"]["options"]:
                        option["solver"]["status"] = status
                        option["solver"]["gap"] = 0.2
                else:
                    controlled["result"] = {
                        "status": "failed",
                        "options": [],
                        "error_code": "worker_interrupted",
                    }
                runs[name] = controlled
            for name, entry in runs.items():
                job_id = ident("job-" + name)
                run_id = ident("run-" + name)
                session.add(
                    Job(
                        id=job_id,
                        job_type="evaluation.never-dispatched",
                        payload={},
                        payload_hash=digest({}),
                        idempotency_key="eval-" + run_id,
                        created_by=OWNER,
                        status=JobStatus.SUCCEEDED,
                        created_at=STAMP,
                        updated_at=STAMP,
                    )
                )
                await session.flush()
                session.add(
                    OptimizationRun(
                        id=run_id,
                        owner_user_id=OWNER,
                        idempotency_key="eval-" + run_id,
                        payload_hash=digest(entry["input"]),
                        job_id=job_id,
                        status=entry["result"]["status"],
                        input_snapshot=entry["input"],
                        result=entry["result"],
                        created_at=STAMP,
                        updated_at=STAMP,
                    )
                )
            geometries: dict[str, dict[str, Any]] = {
                "qa_missing": {"type": "Point", "coordinates": [-93.5, 42]},
                "smap_valid": {
                    "type": "Point",
                    "coordinates": [-97.04875516698723, 42.99556197415486],
                },
                "outside_weather": {"type": "Point", "coordinates": [114, 32]},
                "polygon": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-93.51, 42], [-93.49, 42], [-93.49, 42.01], [-93.51, 42.01], [-93.51, 42]]
                    ],
                },
            }
            for name, geometry in geometries.items():
                session.add(
                    RegionSelection(
                        id=ident("selection-" + name),
                        owner_user_id=OWNER,
                        revision=1,
                        kind="point" if geometry["type"] == "Point" else "polygon",
                        data=validate_geometry(geometry),
                        created_at=STAMP,
                    )
                )
            await session.flush()
            for case in cases:
                category = case["category"]
                number = int(case["id"].rsplit("-", 1)[1])
                ref: dict[str, Any] = {
                    "page": "rotation"
                    if category in ("explain_current", "compare_runs")
                    else "map",
                    "revision": 1,
                }
                fixture_kind = "empty_context"
                if category in ("explain_current", "compare_runs"):
                    ref.update(run_id=ident("run-base"), option_id="option-1")
                    fixture_kind = runs["base"]["fixture_kind"]
                if category == "explain_current":
                    if number == 7:
                        ref["option_id"] = "baseline"
                    if number in (10, 11):
                        name = "infeasible" if number == 10 else "timeout"
                        ref["run_id"] = ident("run-" + name)
                        fixture_kind = runs[name]["fixture_kind"]
                        if number == 10:
                            ref.pop("option_id")
                    if number in (15, 16):
                        ref.pop("run_id")
                        ref.pop("option_id")
                        ref["page"] = "map"
                        ref["selection"] = {
                            "id": ident(
                                "selection-" + ("smap_valid" if number == 15 else "polygon")
                            ),
                            "revision": 1,
                        }
                        ref["dates"] = {"start": "2026-11-07", "end": "2026-11-07"}
                        fixture_kind = "real_local_smap"
                if category == "compare_runs":
                    other = "weights" if number == 6 else "scenario" if number == 8 else "budget"
                    ref.update(compare_run_id=ident("run-" + other), compare_option_id="option-1")
                if category == "guide" and number in (3, 4, 7):
                    ref.update(
                        run_id=ident("run-base"),
                        option_id="option-1",
                        draft={
                            "dirty": True,
                            "changed_fields": ["scenario" if number == 7 else "farm_limits"],
                        },
                    )
                if category == "missing":
                    if number in (2, 3):
                        ref.update(run_id=ident("run-base"))
                    if number == 3:
                        ref["option_id"] = "option-1"
                    if number in (4, 5, 6):
                        ref["selection"] = {
                            "id": ident(
                                "selection-" + ("outside_weather" if number == 4 else "qa_missing")
                            ),
                            "revision": 1,
                        }
                        ref["dates"] = {"start": "2026-11-07", "end": "2026-11-07"}
                    if number == 7:
                        ref["run_id"] = ident("run-failed")
                        fixture_kind = runs["failed"]["fixture_kind"]
                    if number == 8:
                        ref.update(
                            run_id=ident("run-base"),
                            option_id="option-1",
                            draft={"dirty": True, "changed_fields": ["farm_limits"]},
                        )
                context = await freeze_context(session, OWNER, ContextRef.model_validate(ref), "zh")
                contexts[case["id"]] = {"context": context, "fixture_kind": fixture_kind}
            gate_refs: list[tuple[str, dict[str, Any]]] = [
                ("run", {"run_id": ident("run-base")}),
                ("field", {"fields": [{"id": fields[0]["id"], "expected_version": 1}]}),
                ("selection", {"selection": {"id": ident("selection-qa_missing"), "revision": 1}}),
            ]
            for kind, ref in gate_refs:
                try:
                    await freeze_context(
                        session,
                        "unrelated-owner",
                        ContextRef.model_validate({"page": "map", "revision": 1, **ref}),
                        "zh",
                    )
                except HTTPException as error:
                    gate_results[kind] = error.status_code == 404
                else:
                    gate_results[kind] = False
            assert all(gate_results.values())
            # Explicit rollback ensures no evaluation fields, selections, jobs or runs survive.
            await session.rollback()
    finally:
        await engine.dispose()
    return {
        "schema": "rotation-evaluation-fixtures-v1",
        "case_sha256": expected,
        "created_at": STAMP.isoformat(),
        "owner_gate_results": gate_results,
        "profile_sha256": profile_hash(profile),
        "weather_sha256": weather["manifest_sha256"],
        "runs": {
            name: {
                "fixture_kind": entry["fixture_kind"],
                "request": entry["input"]["request"],
                "result": {
                    k: v
                    for k, v in entry["result"].items()
                    if k not in ("problem", "candidate_traces")
                },
            }
            for name, entry in runs.items()
        },
        "contexts": contexts,
        "limitations": [
            "Synthetic benchmark farms, not a business pilot.",
            "Failed/timeout states are controlled fixtures, "
            "not real worker or solver timing evidence.",
            "Authorization gates use real DB ownership checks; "
            "this is not browser or Temporal acceptance.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("Use a new fixture path; frozen fixtures are immutable")
    result = asyncio.run(prepare())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "fixtures": len(result["contexts"]),
                "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
                "owner_gates": result["owner_gate_results"],
            }
        )
    )


if __name__ == "__main__":
    main()
