"""Opt-in synthetic three-turn field and real rotation-worker browser demo."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.modules.jobs.models import Job
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8018")
    parser.add_argument("--frontend-url", default="http://127.0.0.1:4188")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    target = urlsplit(args.base_url)
    if target.scheme != "http" or target.hostname not in {"localhost", "127.0.0.1"}:
        parser.error("Only a local synthetic API is allowed")
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL", "")
    if not url or "test" not in (make_url(url).database or ""):
        parser.error("A dedicated PostgreSQL test database is required")
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with httpx.AsyncClient(base_url=args.base_url, timeout=45) as client:
            identity = (await client.get("/users/me")).json()
            if identity.get("email") != "smoke-farmer@example.test":
                parser.error("The API does not expose the synthetic test identity")

            async def conversation(preset: str, bot_id: str) -> str:
                created = await client.post("/farm-assistant/conversations", json={
                    "preset": preset, "bot_id": bot_id, "language": "en",
                })
                created.raise_for_status()
                return created.json()["id"]

            async def ask(conversation_id: str, text: str, page: str) -> dict:
                reply = await client.post(
                    f"/farm-assistant/conversations/{conversation_id}/messages",
                    json={
                        "client_message_id": "live-rotation-" + uuid4().hex,
                        "text": text,
                        "context": {"page": page, "revision": 1},
                    },
                )
                reply.raise_for_status()
                return reply.json()["response"]["task"]

            field_conversation = await conversation("field_management", "field-guide")
            first = await ask(field_conversation, "Please add a field for me.", "map")
            assert first["status"] == "needs_input"
            name = "Rotation screenshot field " + uuid4().hex[:8]
            proposed = await ask(
                field_conversation,
                f"Call it {name}. It is 2 hectares at latitude 42 and longitude -93.5. "
                "Soil is loam, irrigation is available, no planting history. "
                "Use the temperate demo crop settings.",
                "map",
            )
            assert proposed["status"] == "awaiting_confirmation"
            saved = await ask(field_conversation, "Yes, create the field.", "map")
            assert saved["status"] == "completed"
            field_id = parse_qs(urlsplit(saved["href"]).query)["field"][0]

            rotation_conversation = await conversation("rotation", "rotation-guide")
            body = {
                "profile_id": "iowa-benchmark-20261112-v1",
                "fields": [{
                    "id": field_id, "expected_version": 1, "history_reviewed": True,
                }],
                "start": "2027-01-01", "end": "2027-12-31",
                "allowed_crop_ids": ["maize", "pea"],
                "farm_limits": {"2027": {
                    "water_m3": 50000, "cost_usd": 10000, "labor_days": 100,
                }},
                "accept_benchmark_assumptions": True,
            }
            proposed = await ask(
                rotation_conversation,
                "Please run create_rotation_optimizer_runs_post "
                + json.dumps({"body": body}),
                "rotation",
            )
            assert proposed["status"] == "awaiting_confirmation"
            pending = await ask(rotation_conversation, "Confirm", "rotation")
            assert pending["status"] == "pending"
            run = pending["execution"]["result"]
            async with factory() as session:
                job = await session.get(Job, run["job_id"])
                payload = job.payload
            published = await run_job(factory, job.id, payload)
            assert published["published"]
            refreshed = await client.get(pending["refresh_url"])
            refreshed.raise_for_status()
            complete = refreshed.json()
            assert complete["status"] == "completed"
            preview = await client.get(complete["preview_url"])
            preview.raise_for_status()
            assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")
            preview_path = args.output.parent / "rotation-real-result-private-preview.png"
            preview_path.write_bytes(preview.content)
            option_id = complete["execution"]["result"]["result"]["options"][0]["id"]
            save = await ask(
                rotation_conversation,
                "Please run save_rotation_optimizer_plans_post "
                + json.dumps({"body": {
                    "run_id": run["id"], "option_id": option_id,
                    "title": "Farmer rotation plan", "notes": "Saved from chat",
                }}),
                "rotation",
            )
            assert save["status"] == "awaiting_confirmation"
            saved_plan = await ask(rotation_conversation, "Confirm", "rotation")
            assert saved_plan["status"] == "completed"
            saved_preview = await client.get(saved_plan["preview_url"])
            saved_preview.raise_for_status()
            assert saved_preview.content.startswith(b"\x89PNG\r\n\x1a\n")
            saved_preview_path = args.output.parent / "rotation-saved-plan-private-preview.png"
            saved_preview_path.write_bytes(saved_preview.content)
            output = {
                "environment": "synthetic verified farmer and 365-day historical weather fixture",
                "field_name": name,
                "field_url": args.frontend_url + saved["href"],
                "rotation_status": complete["execution"]["result"]["status"],
                "rotation_url": args.frontend_url + complete["href"],
                "rotation_detail_url": args.frontend_url + complete["result_page_url"],
                "preview_path": str(preview_path),
                "saved_plan_url": args.frontend_url + saved_plan["href"],
                "saved_plan_preview_path": str(saved_preview_path),
            }
            args.output.write_text(json.dumps(output, indent=2) + "\n")
            print(json.dumps(output, indent=2))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
