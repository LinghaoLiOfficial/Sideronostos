"""Replay archived outputs against current local guards, with no provider or DB access.

This measures rejection/binding behavior, never new generation or semantic quality.
"""

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..model_view import model_view
from ..schemas import ModelAnswer, generation_schema
from ..validation import bind_answer


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replay(report_path: Path, fixtures_path: Path) -> dict[str, Any]:
    report = json.loads(report_path.read_text())
    fixtures = json.loads(fixtures_path.read_text())
    if report.get("schema") != "rotation-evaluation-run-v1":
        raise ValueError("Unsupported archived report schema")
    if report.get("fixtures_sha256") != digest(fixtures_path):
        raise ValueError("Fixture hash does not match archived run")
    if not report.get("case_sha256") or report["case_sha256"] != fixtures.get("case_sha256"):
        raise ValueError("Fixture/case identity mismatch")
    rows: list[dict[str, Any]] = []
    for recorded in report["results"]:
        row: dict[str, Any] = {
            "attempt_id": recorded["attempt_id"],
            "case_id": recorded["case_id"],
            "original_status": recorded["status"],
        }
        rows.append(row)
        raw = recorded.get("raw_model_answer")
        evidence = recorded.get("evidence")
        if raw is None or evidence is None:
            row.update(status="not_replayable", reason="No archived parsed output or evidence")
            continue
        context = fixtures["contexts"][recorded["case_id"]]["context"]
        view = model_view(recorded["question"], context, evidence)
        visible_ids = {fact["id"] for fact in view["facts"]}
        visible_facts = [fact for fact in evidence["facts"] if fact["id"] in visible_ids]
        schema = generation_schema(
            [fact["id"] for fact in view["facts"] if fact["render_reference"]]
        )
        try:
            schema.model_validate(raw)
            answer = ModelAnswer.model_validate(raw)
        except ValidationError as error:
            row.update(
                status="rejected",
                stage="schema",
                reason="Archived output violates current generation schema",
                errors=[
                    {"type": item["type"], "location": list(item["loc"])} for item in error.errors()
                ],
            )
            continue
        try:
            bound = bind_answer(
                answer,
                visible_facts,
                evidence["knowledge"],
                allowed_actions=view["context"]["allowed_actions"],
                can_claim_optimal=context["can_claim_optimal"],
            )
        except ValueError as error:
            row.update(status="rejected", stage="binding", reason=str(error))
            continue
        row.update(
            status="accepted",
            bound_fact_ids=sorted(
                {
                    ref
                    for paragraph in bound["paragraphs"]
                    for ref in paragraph["evidence_ids"]
                    if ref in visible_ids
                }
            ),
        )
    module = Path(__file__).parents[1]
    files = {
        name: digest(module / name) for name in ("model_view.py", "schemas.py", "validation.py")
    }
    return {
        "schema": "rotation-offline-replay-v1",
        "created_at": datetime.now(UTC).isoformat(),
        "report": {"name": report_path.name, "sha256": digest(report_path)},
        "fixtures": {"name": fixtures_path.name, "sha256": digest(fixtures_path)},
        "original_pipeline": report.get("pipeline", {}).get("source_sha256"),
        "original_model": report.get("pipeline", {}).get("model"),
        "validation_files": files,
        "case_sha256": report["case_sha256"],
        "provider_calls": 0,
        "semantic_quality": "NOT_EVALUATED",
        "decision": "offline_diagnostics_only",
        "limitations": [
            "Uses archived final parsed outputs and evidence with the current context projection.",
            "Does not run retrieval, generation, repair, database access or provider transport.",
            "Accepted output is not proof of source entailment or farmer comprehension.",
            "Rejected output does not prove a new model attempt would correct it.",
            "Missing provider output is not counted as a pass; original scores remain unchanged.",
        ],
        "summary": {
            "attempts": len(rows),
            **{
                status: sum(row["status"] == status for row in rows)
                for status in ("accepted", "rejected", "not_replayable")
            },
        },
        "rows": rows,
    }


def write_report(report: dict[str, Any], output: Path) -> None:
    # Exclusive creation prevents an audit command from silently replacing evidence.
    with output.open("x") as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = replay(args.report, args.fixtures)
    write_report(result, args.output)
    print(json.dumps({"output": str(args.output), **result["summary"], "provider_calls": 0}))


if __name__ == "__main__":
    main()
