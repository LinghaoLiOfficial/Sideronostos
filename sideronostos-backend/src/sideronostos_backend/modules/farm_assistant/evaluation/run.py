"""Real frozen evaluation. Observation retains outputs; it never changes model behavior.
Successful schema validation is not semantic correctness. Review is separate.
"""

import argparse
import asyncio
import hashlib
import json
import statistics
import subprocess
import time
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import urlsplit

from ....core import installed_models  # noqa: F401
from ....core.config import get_settings
from ...ai.provider import StructuredInvocationError, invoke_structured_model
from ...ai.settings import get_ai_settings
from ...database.session import create_engine, create_session_factory
from ...knowledge.store import active_release
from .. import pipeline
from ..prompts import VERSION
from ..settings import get_assistant_settings

CASES = Path(__file__).with_name("cases-v1.json")
MODULES = Path(__file__).parents[2]


def digest_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pipeline_manifest() -> dict[str, Any]:
    settings = get_ai_settings().for_task("farm_assistant")
    files = {
        str(p.relative_to(MODULES)): digest_file(p)
        for module in ("farm_assistant", "knowledge", "ai", "agri_data", "rotation_optimizer")
        for p in sorted((MODULES / module).rglob("*.py"))
        if "evaluation" not in p.parts
    }
    return {
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "source_sha256": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
        "files": files,
        "prompt_version": VERSION,
        "model": settings.model,
        "provider_host": urlsplit(settings.base_url).netloc,
        "configuration": {
            k: getattr(settings, k)
            for k in (
                "temperature",
                "omit_temperature",
                "reasoning_effort",
                "max_tokens",
                "read_timeout_seconds",
                "max_retries",
            )
        },
        "response_format": "strict_json_schema",
        "software": {
            p: version(p)
            for p in ("langchain-openai", "openai", "pydantic", "pgvector", "gurobipy")
        },
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups = {}
    for category in sorted({r["category"] for r in rows}):
        parts = [r for r in rows if r["category"] == category]
        groups[category] = {
            "attempts": len(parts),
            "completed": sum(r["status"] == "complete" for r in parts),
            "failed_ids": [r["attempt_id"] for r in parts if r["status"] != "complete"],
        }
    eligible = {r["case_id"]: r["retrieval_hit"] for r in rows if r["retrieval_hit"] is not None}
    latencies = sorted(r["latency_ms"] for r in rows)
    return {
        "attempts": len(rows),
        "unique_cases": len({r["case_id"] for r in rows}),
        "completed": sum(r["status"] == "complete" for r in rows),
        "categories": groups,
        "case_level_relevant_source_recall_at_8": sum(eligible.values()) / len(eligible)
        if eligible
        else None,
        "retrieval_eligible_cases": len(eligible),
        "retrieval_misses": [key for key, hit in eligible.items() if not hit],
        "latency_p50_ms": statistics.median(latencies) if latencies else None,
        "latency_p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]
        if latencies
        else None,
        "provider_reported_chat_cost_usd": sum(
            r.get("provider_reported_chat_cost_usd") or 0 for r in rows
        ),
        "embedding_tokens": sum(r.get("embedding_tokens", 0) for r in rows),
        "answer_tokens": sum((r.get("usage") or {}).get("total_tokens", 0) for r in rows),
        "semantic_clarity_and_support": "REQUIRES_REVIEW",
        "decision": "hold",
    }


def observed_metrics(responses: list[dict[str, Any]]) -> dict[str, Any]:
    recorded = [
        {
            "parsed": r["parsed"],
            "usage": r["raw"].usage_metadata,
            "cost": (r["raw"].response_metadata.get("token_usage") or {}).get("cost"),
            "attempts": r["attempts"],
        }
        for r in responses
    ]
    return {
        "provider_responses": recorded,
        "raw_model_answer": recorded[-1]["parsed"] if recorded else None,
        "usage": {
            k: sum((r["usage"] or {}).get(k, 0) for r in recorded)
            for k in ("input_tokens", "output_tokens", "total_tokens")
        },
        "provider_reported_chat_cost_usd": sum(r["cost"] or 0 for r in recorded),
        "provider_cost_complete": bool(recorded) and all(r["cost"] is not None for r in recorded),
    }


async def run(args: argparse.Namespace) -> None:
    case_path = getattr(args, "cases", CASES)
    payload = json.loads(case_path.read_text())
    cases = payload["cases"]
    expected = case_path.with_suffix(".sha256").read_text().split()[0]
    if digest_file(case_path) != expected:
        raise ValueError("Frozen case set changed")
    fixture = json.loads(args.fixtures.read_text())
    if fixture["case_sha256"] != expected:
        raise ValueError("Fixture/case mismatch")
    if args.split == "test" and not args.dev_review:
        raise ValueError("Held-out run requires --dev-review artifact")
    if args.dev_review:
        review = json.loads(args.dev_review.read_text())
        if review.get("decision") != "promote_to_held_out":
            raise ValueError("Development review has not approved held-out evaluation")
    cases = [c for c in cases if args.split == "regression" or c["split"] == args.split]
    frozen = pipeline_manifest()
    rows: list[dict[str, Any]] = []
    report = {
        "schema": "rotation-evaluation-run-v1",
        "started_at": datetime.now(UTC).isoformat(),
        "case_set_version": payload["version"],
        "case_sha256": expected,
        "split": args.split,
        "case_file": str(case_path),
        "not_independent_test": args.split == "regression",
        "fixtures_sha256": digest_file(args.fixtures),
        "pipeline": frozen,
        "authorization": fixture["owner_gate_results"],
        "limitations": [
            "Model quality only; not browser/worker acceptance.",
            "Recall counts one relevant-source hit per annotated case; "
            "alternative source IDs are OR labels. Passage support needs semantic review.",
            "Controlled failure/timeout fixtures are labelled in the fixture artifact.",
            "Costs exclude unreported failed requests; embedding cost can be estimated separately.",
        ],
        "results": rows,
    }
    observed: dict[str, Any] = {}
    original = invoke_structured_model

    async def observe(*a: Any, **kw: Any) -> dict[str, Any]:
        result = await original(*a, **kw)
        observed.setdefault("responses", []).append(result)
        return result

    observer = patch.object(pipeline, "invoke_structured_model", observe)
    observer.start()
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            release = await active_release(session)
            report["kb_release"] = {
                "id": release.id,
                "sha256": release.manifest_sha256,
                "embedding_namespace": release.embedding_namespace,
            }
        for case in cases:
            for repeat in range(case["repeat"]):
                if pipeline_manifest()["source_sha256"] != frozen["source_sha256"]:
                    raise ValueError("Pipeline changed during evaluation")
                observed.clear()
                context = fixture["contexts"][case["id"]]["context"]
                start = time.perf_counter()
                row: dict[str, Any] = {
                    "attempt_id": f"{case['id']}/{repeat + 1}",
                    "case_id": case["id"],
                    "category": case["category"],
                    "original_split": case["split"],
                    "question": case["question"],
                    "fixture_kind": fixture["contexts"][case["id"]]["fixture_kind"],
                    "retrieval_hit": None,
                    "status": "failed",
                    "semantic_review": None,
                }
                evidence = None
                try:
                    async with asyncio.timeout(get_assistant_settings().deadline_seconds):
                        async with create_session_factory(engine)() as session:
                            evidence = await pipeline.collect_evidence(
                                session, case["question"], context, release
                            )
                        expected_sources = set(case["expected_source_any"])
                        row["retrieval_hit"] = (
                            bool(
                                expected_sources
                                & {k["source"]["id"] for k in evidence["knowledge"]}
                            )
                            if expected_sources
                            else None
                        )
                        row["evidence"] = evidence
                        answer = await pipeline.generate_answer(
                            case["question"],
                            context,
                            evidence,
                            language="zh"
                            if any("\u3400" <= ch <= "\u9fff" for ch in case["question"])
                            else "en",
                            detail="brief",
                            history=[],
                        )
                        row.update(status="complete", answer=answer)
                except Exception as error:
                    row["error_type"] = type(error).__name__
                    row["error"] = (
                        str(error)
                        if isinstance(error, (ValueError, StructuredInvocationError, TimeoutError))
                        else "Invocation failed"
                    )
                    if isinstance(error, StructuredInvocationError):
                        row["provider_attempts"] = error.attempts
                row.update(observed_metrics(observed.get("responses", [])))
                row["embedding_tokens"] = evidence["embedding_tokens"] if evidence else 0
                row["latency_ms"] = round((time.perf_counter() - start) * 1000)
                rows.append(row)
                report["summary"] = summarize(rows)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
                print(
                    json.dumps(
                        {
                            k: row.get(k)
                            for k in (
                                "attempt_id",
                                "status",
                                "retrieval_hit",
                                "error",
                                "latency_ms",
                            )
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
    finally:
        observer.stop()
        await engine.dispose()
    report["finished_at"] = datetime.now(UTC).isoformat()
    report["summary"] = summarize(rows)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report["summary"], ensure_ascii=False), flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--fixtures", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--split", choices=["dev", "test", "regression"], default="dev")
    p.add_argument("--cases", type=Path, default=CASES)
    p.add_argument("--dev-review", type=Path)
    args = p.parse_args()
    if args.output.exists():
        raise SystemExit("Use a new result path; evaluation evidence is immutable")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
