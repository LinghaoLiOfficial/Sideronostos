"""Exercise every registered operation through farmer chat against the local test API.

Zero-input reads execute the real business route. Other operations must stop at
missing-input collection; this script never confirms a write or invents fixtures.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8018")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    target = urlsplit(args.base_url)
    if target.scheme != "http" or target.hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Only the local test API is allowed")
    rows = []
    async with httpx.AsyncClient(base_url=args.base_url, timeout=60) as client:
        identity = (await client.get("/users/me")).json()
        if identity.get("email") != "smoke-farmer@example.test":
            parser.error("The API is not the synthetic test app")
        created = await client.post(
            "/farm-assistant/conversations",
            json={"preset": "general", "bot_id": "general-guide", "language": "en"},
        )
        created.raise_for_status()
        first_id = created.json()["id"]
        catalog = await client.get(f"/farm-assistant/conversations/{first_id}/operations")
        catalog.raise_for_status()
        tools = catalog.json()["items"]
        for index, tool in enumerate(tools):
            conversation_id = first_id
            if index:
                created = await client.post(
                    "/farm-assistant/conversations",
                    json={"preset": "general", "bot_id": "general-guide", "language": "en"},
                )
                created.raise_for_status()
                conversation_id = created.json()["id"]
            reply = await client.post(
                f"/farm-assistant/conversations/{conversation_id}/messages",
                json={
                    "client_message_id": "matrix-" + uuid4().hex,
                    "text": f"Please run {tool['operation_id']}",
                    "context": {"page": "map", "revision": 1},
                },
            )
            reply.raise_for_status()
            response = reply.json()
            task = (response.get("response") or {}).get("task") or {}
            expected = "needs_input" if tool["required_inputs"] else "completed"
            rows.append(
                {
                    "operation_id": tool["operation_id"],
                    "method": tool["method"],
                    "path": tool["path"],
                    "expected_status": expected,
                    "actual_status": task.get("status"),
                    "selected_operation": task.get("operation_id"),
                    "missing_inputs": task.get("missing_inputs"),
                    "href": task.get("href"),
                    "business_status_code": (task.get("execution") or {}).get("status_code"),
                    "passed": task.get("operation_id") == tool["operation_id"]
                    and task.get("status") == expected,
                }
            )
    args.output.write_text(
        json.dumps(
            {
                "environment": (
                    "synthetic local account, real HTTP and business routers; "
                    "no write confirmed"
                ),
                "total": len(rows),
                "passed": sum(row["passed"] for row in rows),
                "items": rows,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"{sum(row['passed'] for row in rows)}/{len(rows)} "
        "operation selection and input-boundary checks passed"
    )
    for row in rows:
        if not row["passed"]:
            print(row["operation_id"], row["actual_status"], row["business_status_code"])


if __name__ == "__main__":
    asyncio.run(main())
