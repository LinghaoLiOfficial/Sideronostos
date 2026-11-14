"""Exercise every rotation operation through chat and its real synthetic business route."""

import json
from uuid import uuid4

import pytest
from agent_execution_evidence import record as record_execution
from agent_execution_evidence import save as save_execution
from rotation_v3_application_helpers import weather
from test_rotation_v3_api import api as _api

from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.agri_data.nasa_release import NASA_BUNDLE_PRODUCT
from sideronostos_backend.modules.farm_assistant.models import Conversation
from sideronostos_backend.modules.farm_assistant.module_tools import ModuleToolExecutor
from sideronostos_backend.modules.farm_assistant.router import router as assistant_router
from sideronostos_backend.modules.jobs.models import Job
from sideronostos_backend.modules.knowledge.models import KBRelease
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job

api = _api
pytestmark = pytest.mark.asyncio


def _chunks(body: dict, limit: int = 1850) -> list[dict]:
    """Split a complete v3 draft across chat turns without exceeding message limits."""
    parts: list[dict] = []
    current: dict = {}
    # Keep a required identifier last so the Bot does not execute a partial draft.
    ordered = [(key, value) for key, value in body.items() if key != "profile_id"]
    if "profile_id" in body:
        ordered.append(("profile_id", body["profile_id"]))
    for key, value in ordered:
        candidate = {**current, key: value}
        if current and len(json.dumps({"body": candidate})) > limit:
            parts.append(current)
            current = {key: value}
        else:
            current = candidate
    if current:
        parts.append(current)
    assert all(len(json.dumps({"body": part})) <= limit for part in parts)
    return parts


async def test_rotation_guide_executes_all_nineteen_real_routes_through_chat(api):
    client, identity, daily, factory, field_id, _ = api
    app = client._transport.app
    app.include_router(assistant_router)
    app.state.session_factory = factory
    release_id = "agent-nasa-bundle-" + uuid4().hex[:12]
    conversation_id = str(uuid4())
    async with factory() as session:
        raw = weather()
        session.add(ScienceRelease(
            id=raw["release_id"], product="NASA_POWER_DAILY", status="published",
            manifest_sha256=raw["manifest_sha256"], data=raw,
        ))
        session.add(ScienceRelease(
            id=release_id, product=NASA_BUNDLE_PRODUCT, status="published",
            manifest_sha256="b" * 64,
            data={
                "schema": "synthetic-nasa-bundle", "product": NASA_BUNDLE_PRODUCT,
                "recipe": "test-only", "start": "2025-01-01", "end": "2025-12-31",
                "bounds": [-94, 41, -93, 43], "crs": "EPSG:4326",
                "center": [-93.5, 42], "applicability": "synthetic_test",
                "model_usable": False, "complete_days": 0, "expected_days": 365,
                "products": {}, "layers": [], "evidence_only": True,
                "limitations": ["Synthetic catalogue fixture; not a NASA acquisition"],
            },
        ))
        kb = KBRelease(
            id="agent-rotation-matrix-kb-" + uuid4().hex,
            status="published", manifest_sha256="a" * 64,
            embedding_model="synthetic-no-provider", embedding_dimensions=2,
            embedding_namespace="test", recipe="test-only", report={},
        )
        session.add(kb)
        await session.flush()
        session.add(Conversation(
            id=conversation_id, owner_user_id=identity["id"], preset="rotation",
            bot_id="rotation-guide", language="en", detail="brief",
            kb_release_id=kb.id, next_sequence=1,
        ))
        await session.commit()

    path = f"/farm-assistant/conversations/{conversation_id}/messages"
    observed: set[str] = set()
    evidence: dict[str, dict] = {}

    async def send(text: str):
        reply = await client.post(path, json={
            "client_message_id": "rotation-matrix-" + uuid4().hex,
            "text": text, "context": {"page": "rotation", "revision": 1},
        })
        assert reply.status_code == 200, (text[:100], reply.text[:200])
        return reply.json()["response"]["task"]

    async def execute(operation_id: str, *, body=None, path_params=None):
        parts = _chunks(body) if isinstance(body, dict) else [None]
        task = None
        for index, part in enumerate(parts):
            payload = {"path_params": path_params or {}}
            if part is not None:
                payload["body"] = part
            text = (f"Please run {operation_id} " if index == 0 else "") + json.dumps(payload)
            task = await send(text)
        assert task is not None
        assert task["operation_id"] == operation_id
        if operation_id in {
            "preflight_rotation_optimizer_preflight_post",
            "daily_readiness_rotation_optimizer_v3_readiness_post",
            "compare_rotation_optimizer_compare_post",
        }:
            assert task["status"] == "completed", operation_id
        if task["status"] == "awaiting_confirmation":
            task = await send("Confirm")
        assert task["status"] in {"completed", "pending"}, (operation_id, task)
        assert task["execution"]["status"] in {"succeeded", "pending"}
        observed.add(operation_id)
        record_execution(evidence, operation_id, task)
        return task

    async def work(task):
        result = task["execution"]["result"]
        async with factory() as session:
            job = await session.get(Job, result["job_id"])
            payload = job.payload
        published = await run_job(factory, result["job_id"], payload)
        assert published["published"]
        refreshed = await client.get(task["refresh_url"])
        assert refreshed.status_code == 200
        assert refreshed.json()["status"] == "completed"
        evidence[task["operation_id"]]["final_workflow_status"] = "completed"
        return refreshed.json()["execution"]["result"]

    await execute("profiles_rotation_optimizer_profiles_get")
    await execute("daily_profiles_rotation_optimizer_v3_profiles_get")
    releases = await execute("data_releases_rotation_optimizer_data_releases_get")
    assert any(item["id"] == release_id for item in releases["execution"]["result"]["items"])
    await execute("data_release_rotation_optimizer_data_releases__release_id__get",
                  path_params={"release_id": release_id})
    await execute(
        "data_release_availability_rotation_optimizer_data_releases__release_id__availability_get",
        path_params={"release_id": release_id},
    )
    await execute("runs_rotation_optimizer_runs_get")
    await execute("plans_rotation_optimizer_plans_get")
    preflight = {
        "profile_id": "iowa-benchmark-20261112-v1",
        "fields": [{"id": field_id, "expected_version": 1}],
        "start": "2027-01-01", "end": "2027-12-31",
        "allowed_crop_ids": ["maize", "pea"],
    }
    await execute("preflight_rotation_optimizer_preflight_post", body=preflight)
    await execute("daily_readiness_rotation_optimizer_v3_readiness_post", body=daily)
    v2 = {
        **preflight,
        "fields": [{"id": field_id, "expected_version": 1, "history_reviewed": True}],
        "farm_limits": {"2027": {"water_m3": 50000, "cost_usd": 10000, "labor_days": 100}},
        "accept_benchmark_assumptions": True,
    }
    first = await execute("create_rotation_optimizer_runs_post", body=v2)
    first_result = await work(first)
    run_id = first_result["id"]
    await execute("get_rotation_optimizer_runs__run_id__get", path_params={"run_id": run_id})
    await execute("export_rotation_optimizer_runs__run_id__export_get",
                  path_params={"run_id": run_id})
    csv = await execute("export_csv_rotation_optimizer_runs__run_id__export_csv_get",
                        path_params={"run_id": run_id})
    assert csv["execution"]["content_type"].startswith("text/csv")
    option_id = first_result["result"]["options"][0]["id"]
    saved = await execute("save_rotation_optimizer_plans_post", body={
        "run_id": run_id, "option_id": option_id,
        "title": "Synthetic rotation", "notes": "Chat matrix",
    })
    await execute("plan_rotation_optimizer_plans__plan_id__get",
                  path_params={"plan_id": saved["execution"]["result"]["id"]})
    second = await execute("create_rotation_optimizer_runs_post", body=v2)
    second_result = await work(second)
    await execute("compare_rotation_optimizer_compare_post", body={
        "first_run_id": run_id, "second_run_id": second_result["id"],
        "first_option_id": option_id,
        "second_option_id": second_result["result"]["options"][0]["id"],
    })
    third = await execute("create_rotation_optimizer_runs_post", body=v2)
    third_id = third["execution"]["result"]["id"]
    await execute("cancel_rotation_optimizer_runs__run_id__cancel_post",
                  path_params={"run_id": third_id})
    retried = await execute("retry_rotation_optimizer_runs__run_id__retry_post",
                            path_params={"run_id": third_id})
    await work(retried)
    daily_run = await execute("create_daily_rotation_optimizer_v3_runs_post", body=daily)
    await work(daily_run)
    assert observed == {
        tool.operation_id for tool in ModuleToolExecutor(app).tools_for("rotation")
    }
    save_execution("rotation", evidence)
