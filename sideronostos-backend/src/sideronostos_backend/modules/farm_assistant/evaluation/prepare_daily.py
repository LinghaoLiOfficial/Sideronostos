"""Freeze daily evaluation inputs from owned real runs, without model/provider calls.

Only the timeout context is a controlled negative fixture. Compact redundant solver
proof payloads only after checking identical model projections for every frozen case.
"""

import argparse
import asyncio
import copy
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from ....core import installed_models  # noqa: F401
from ....core.config import get_settings
from ...agri_data.models import RegionSelection
from ...database.session import create_engine, create_session_factory
from ...field_shift.models import FieldRecord
from ..context import append_run_facts, freeze_context
from ..model_view import model_view
from ..schemas import ContextRef, FieldRef, SelectionRef

CASES = Path(__file__).with_name("cases-v4-daily.json")


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def compact_context(context: dict[str, Any]) -> dict[str, Any]:
    compact = copy.deepcopy(context)
    for entry in (compact.get("run"), (compact.get("comparison") or {}).get("run")):
        if not entry:
            continue
        result = entry.get("result") or {}
        result.pop("solver_attempts", None)
        result.pop("weather", None)
        for option in [*result.get("options", []), result.get("baseline")]:
            if not option:
                continue
            option["verification"].pop("resources", None)
            if option.get("solver"):
                option["solver"].pop("verification", None)
        preparation = result.get("preparation")
        if preparation:
            for key in ("readiness", "weather", "rejected"):
                preparation.pop(key, None)
    return compact


async def prepare(args: argparse.Namespace) -> dict[str, Any]:
    payload = json.loads(CASES.read_text())
    case_hash = hashlib.sha256(CASES.read_bytes()).hexdigest()
    if case_hash != CASES.with_suffix(".sha256").read_text().split()[0]:
        raise ValueError("Frozen daily cases changed")
    engine = create_engine(get_settings())
    contexts: dict[str, Any] = {}
    gates: dict[str, bool] = {}
    snapshots: dict[str, Any] = {}
    try:
        async with create_session_factory(engine)() as session:
            primary_ref = ContextRef(
                page="rotation", revision=1, run_id=args.run, option_id="option-1"
            )
            primary = await freeze_context(session, args.owner, primary_ref, "zh")
            field_id = primary["run"]["field_snapshots"][0]["id"]
            field = await session.scalar(
                select(FieldRecord).where(
                    FieldRecord.id == field_id, FieldRecord.owner_user_id == args.owner
                )
            )
            if field is None:
                raise ValueError("Owned current field is unavailable")
            selection = await session.scalar(
                select(RegionSelection).where(
                    RegionSelection.id == args.selection,
                    RegionSelection.owner_user_id == args.owner,
                )
            )
            if selection is None:
                raise ValueError("Owned selection is unavailable")
            refs = {
                "primary": primary_ref,
                "alternatives": primary_ref.model_copy(update={"option_id": None}),
                "unselected": primary_ref.model_copy(update={"option_id": None}),
                "baseline": primary_ref.model_copy(update={"option_id": "baseline"}),
                "diagnostic": primary_ref.model_copy(update={"run_id": args.diagnostic}),
                "failed": ContextRef(page="rotation", revision=1, run_id=args.failed),
                "timeout": ContextRef(page="rotation", revision=1, run_id=args.failed),
                "comparison": primary_ref.model_copy(
                    update={"compare_run_id": args.diagnostic, "compare_option_id": "option-1"}
                ),
                "dirty": ContextRef(
                    **{
                        **primary_ref.model_dump(),
                        "draft": {"dirty": True, "changed_fields": ["farm_limits"]},
                    }
                ),
                "field": ContextRef(
                    page="rotation",
                    revision=1,
                    fields=[FieldRef(id=field.id, expected_version=field.version)],
                ),
                "map": ContextRef(
                    page="map",
                    revision=1,
                    run_id=args.run,
                    option_id="option-1",
                    selection=SelectionRef(id=selection.id, revision=selection.revision),
                ),
            }
            for case in payload["cases"]:
                kind = case["context_fixture"]
                language = (
                    "zh" if any("\u3400" <= c <= "\u9fff" for c in case["question"]) else "en"
                )
                context = await freeze_context(session, args.owner, refs[kind], language)
                fixture_kind = "real owned API/Temporal/Gurobi engineering snapshot"
                if kind == "timeout":
                    # No authoritative DB record is altered and no stale metrics survive.
                    context["run"]["status"] = "timeout_no_solution"
                    context["run"]["result"] = None
                    context["run"]["selected_option_id"] = None
                    context["facts"] = [
                        f for f in context["facts"] if not f["key"].startswith("current.")
                    ]
                    append_run_facts(context["facts"], context["run"], "current", language)
                    context["can_claim_optimal"] = False
                    fixture_kind = "controlled timeout-without-incumbent from real owned failed run"
                compact = compact_context(context)
                evidence = {"facts": context["facts"], "knowledge": []}
                if model_view(case["question"], context, evidence) != model_view(
                    case["question"], compact, evidence
                ):
                    raise ValueError("Compaction changed the model-visible context")
                contexts[case["id"]] = {
                    "context": compact,
                    "fixture_kind": fixture_kind,
                    "full_context_sha256": digest(context),
                    "compact_context_sha256": digest(compact),
                    "projection_identical": True,
                }
                if context.get("run"):
                    entry = context["run"]
                    snapshots[kind] = {
                        "id": entry["id"],
                        "status": entry["status"],
                        "request_sha256": digest(entry["request"]),
                        "profile_sha256": entry["provenance"]["profile_sha256"],
                        "weather_sha256": entry["provenance"]["weather_sha256"],
                    }
            for name in ("primary", "diagnostic", "failed", "field", "map", "comparison"):
                try:
                    await freeze_context(session, "unrelated-owner", refs[name], "zh")
                except HTTPException as error:
                    gates[name] = error.status_code == 404
                else:
                    gates[name] = False
            try:
                await freeze_context(
                    session,
                    args.owner,
                    ContextRef(
                        page="rotation",
                        revision=1,
                        fields=[FieldRef(id=field.id, expected_version=field.version + 1)],
                    ),
                    "zh",
                )
            except HTTPException as error:
                gates["field_version"] = error.status_code == 409
            else:
                gates["field_version"] = False
            if not all(gates.values()):
                raise ValueError("Owner or version hard gate failed")
            await session.rollback()
    finally:
        await engine.dispose()
    return {
        "schema": "rotation-evaluation-fixtures-v1",
        "case_sha256": case_hash,
        "created_at": datetime.now(UTC).isoformat(),
        "owner_gate_results": gates,
        "run_snapshots": snapshots,
        "contexts": contexts,
        "limitations": [
            "Engineering inputs and historical-weather replay, not a selected farm pilot.",
            "No model or embedding calls during freezing.",
            "Timeout is controlled; other run results came from actual queued execution.",
            "Redundant solver/resource payloads compacted only after identical "
            "model projection checks.",
            "Original full run exports/DB retain complete proofs; numeric facts are unchanged.",
            "Case author and reviewer are implementation agents, "
            "not independent farmers/agronomists.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("owner", "run", "diagnostic", "failed", "selection"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("Use a new fixture path; frozen fixtures are immutable")
    result = asyncio.run(prepare(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "contexts": len(result["contexts"]),
                "owner_gates": result["owner_gate_results"],
                "case_sha256": result["case_sha256"],
                "fixture_sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
