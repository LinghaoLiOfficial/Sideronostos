"""A chat turn submits and completes the real rotation worker on synthetic data."""

import json
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select
from test_rotation_persistence import setup  # noqa: F401 - imported fixture

from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal, require_verified_user
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.farm_assistant.models import Conversation
from sideronostos_backend.modules.farm_assistant.router import router as assistant_router
from sideronostos_backend.modules.jobs.models import Job
from sideronostos_backend.modules.knowledge.models import KBRelease
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job
from sideronostos_backend.modules.rotation_optimizer.models import OptimizationRun
from sideronostos_backend.modules.rotation_optimizer.router import router as rotation_router

pytestmark = pytest.mark.asyncio


async def test_rotation_bot_confirms_real_run_waits_for_worker_and_exports_csv(
    setup, monkeypatch  # noqa: F811
):
    factory, owner, _, request = setup
    conversation_id = str(uuid4())
    release_id = "agent-rotation-kb-" + uuid4().hex
    async with factory() as session:
        session.add(KBRelease(
            id=release_id, status="published", manifest_sha256="a" * 64,
            embedding_model="synthetic-no-provider", embedding_dimensions=2,
            embedding_namespace="test", recipe="test-only", report={},
        ))
        await session.flush()
        session.add(Conversation(
            id=conversation_id, owner_user_id=owner, preset="rotation",
            bot_id="rotation-guide", language="en", detail="brief",
            kb_release_id=release_id, next_sequence=1,
        ))
        await session.commit()
    app = create_app(modules=(ModuleSpec(name="farm_assistant", routers=(assistant_router,)),))
    app.include_router(rotation_router)
    app.state.session_factory = factory

    async def principal():
        return AuthPrincipal(owner, "rotation-farmer@example.test", "Farmer", datetime.now(UTC))

    async def session_provider():
        async with factory() as session:
            yield session

    app.dependency_overrides[require_verified_user] = principal
    app.dependency_overrides[get_session] = session_provider
    path = f"/farm-assistant/conversations/{conversation_id}/messages"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        async def ask(turn: int, text: str):
            reply = await client.post(path, json={
                "client_message_id": f"real-rotation-chat-{turn}",
                "text": text, "context": {"page": "map", "revision": 1},
            })
            assert reply.status_code == 200
            return reply.json()["response"]

        proposed = await ask(
            1, "Please run create_rotation_optimizer_runs_post "
            + json.dumps({"body": request.model_dump(mode="json")}),
        )
        assert proposed["task"]["status"] == "awaiting_confirmation"
        async with factory() as session:
            assert await session.scalar(
                select(func.count()).select_from(OptimizationRun).where(
                    OptimizationRun.owner_user_id == owner
                )
            ) == 0
        accepted = await ask(2, "Confirm")
        task = accepted["task"]
        assert task["status"] == "pending"
        assert task["preview_url"] is None
        run_id = task["execution"]["result"]["id"]
        job_id = task["execution"]["result"]["job_id"]
        refresh = task["refresh_url"]
        assert (await client.get(refresh)).json()["status"] == "pending"
        async with factory() as session:
            job = await session.get(Job, job_id)
            payload = job.payload
        worker_result = await run_job(factory, job_id, payload)
        assert worker_result["published"]
        completed = await client.get(refresh)
        assert completed.status_code == 200
        final = completed.json()
        assert final["status"] == "completed"
        assert final["preview_url"] and final["result_page_url"]
        assert final["href"] == final["result_page_url"]
        captured = []

        async def capture(target, authorization):
            captured.append(target)
            return b"\x89PNG\r\n\x1a\nsynthetic-preview"

        monkeypatch.setattr(
            "sideronostos_backend.modules.farm_assistant.preview.capture_result_page", capture
        )
        preview = await client.get(final["preview_url"])
        assert preview.status_code == 200
        assert captured == [final["result_page_url"]]
        result_data = await client.get(
            f"/farm-assistant/conversations/{conversation_id}/results/{task['id']}"
        )
        assert result_data.status_code == 200
        assert result_data.json()["result"]["status"] == "optimal"

        exported = await ask(
            3, "Please run export_csv_rotation_optimizer_runs__run_id__export_csv_get "
            + json.dumps({"path_params": {"run_id": run_id}}),
        )
        export_task = exported["task"]
        assert export_task["status"] == "completed"
        assert export_task["execution"]["content_type"].startswith("text/csv")
        assert "run_id,option_id,field_id" in export_task["execution"]["result"]
