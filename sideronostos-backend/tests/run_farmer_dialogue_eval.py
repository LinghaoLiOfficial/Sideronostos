"""Send the frozen farmer-dialogue suite to the local test-only HTTP app.

The target must be a loopback URL. This exercises real assistant/knowledge
handlers and PostgreSQL with the synthetic identity supplied by live_assistant_app.
It is not a production-model quality evaluation.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

CASES = Path(__file__).parent / "fixtures" / "farmer_dialogue_v1.json"


async def evaluate_one(client: httpx.AsyncClient, case: dict, limit: asyncio.Semaphore) -> dict:
    async with limit:
        started = time.perf_counter()
        result = {
            "case": case,
            "conversation_id": None,
            "status": "request_failed",
            "answer": "",
            "response": None,
        }
        try:
            created = await client.post(
                "/farm-assistant/conversations",
                json={
                    "preset": case["preset"],
                    "bot_id": case["bot_id"],
                    "language": case["language"],
                    "detail": "brief",
                },
            )
            created.raise_for_status()
            conversation_id = created.json()["id"]
            result["conversation_id"] = conversation_id
            transcript = []
            nonce = uuid4().hex[:8]
            for question in case.get("turns", [case.get("question")]):
                question = question.replace("{{nonce}}", nonce)
                reply = await client.post(
                    f"/farm-assistant/conversations/{conversation_id}/messages",
                    json={
                        "client_message_id": "eval-" + uuid4().hex,
                        "text": question,
                        "context": {"page": "map", "revision": 1},
                    },
                )
                reply.raise_for_status()
                message = reply.json()
                for _ in range(40):
                    if message["status"] != "pending":
                        break
                    await asyncio.sleep(0.5)
                    checked = await client.get(
                        f"/farm-assistant/conversations/{conversation_id}/messages/{message['id']}"
                    )
                    checked.raise_for_status()
                    message = checked.json()
                transcript.append({
                    "question": question, "status": message["status"],
                    "answer": "\n".join(
                        paragraph["text"]
                        for paragraph in (message.get("response") or {}).get("paragraphs", [])
                    ),
                    "task": (message.get("response") or {}).get("task"),
                })
            result["transcript"] = transcript
            result["status"] = message["status"]
            result["message_id"] = message["id"]
            result["response"] = message.get("response")
            task = (message.get("response") or {}).get("task")
            result["task"] = task
            expected_status = case.get("expected_task_status")
            expected_operation = case.get("expected_operation_id")
            result["operation_check"] = (
                expected_status is None or (task or {}).get("status") == expected_status
            ) and (
                expected_operation is None or (task or {}).get("operation_id") == expected_operation
            )
            expected_turns = case.get("expected_turn_statuses")
            if expected_turns is not None:
                result["operation_check"] = result["operation_check"] and [
                    (turn.get("task") or {}).get("status") for turn in transcript
                ] == expected_turns
            result["answer"] = "\n".join(
                paragraph["text"]
                for paragraph in (message.get("response") or {}).get("paragraphs", [])
            )
            result["error_code"] = message.get("error_code")
        except (httpx.HTTPError, KeyError, ValueError) as error:
            result["error"] = str(error)
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8010")
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    target = urlsplit(args.base_url)
    if target.scheme != "http" or target.hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Evaluation is restricted to a local test-only HTTP server")
    suite = json.loads(args.cases.read_text())
    async with httpx.AsyncClient(base_url=args.base_url, timeout=60) as client:
        identity = await client.get("/users/me")
        identity.raise_for_status()
        if identity.json().get("email") != "smoke-farmer@example.test":
            parser.error("Target does not expose the synthetic test identity")
        # The product allows at most two in-flight replies per owner. Keep a
        # single synthetic farmer's evaluation turns sequential and comparable.
        limit = asyncio.Semaphore(1)
        results = await asyncio.gather(
            *(evaluate_one(client, case, limit) for case in suite["cases"])
        )
    output = {
        "suite_version": suite["version"],
        "environment": suite["environment"],
        "base_url": args.base_url,
        "results": results,
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    for result in results:
        label = f"{result['case']['id']}: {result['status']} ({result['latency_ms']} ms)"
        print(label, result["answer"][:180])


if __name__ == "__main__":
    asyncio.run(main())
