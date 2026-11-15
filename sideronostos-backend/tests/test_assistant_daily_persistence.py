"""Owned v3 assistant comparison against real saved runs; no provider calls."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_assistant_persistence import conversation
from test_rotation_v3_api import api as api
from test_rotation_v3_persistence import publish_weather

from sideronostos_backend.modules.farm_assistant.context import freeze_context
from sideronostos_backend.modules.farm_assistant.models import AssistantMessage
from sideronostos_backend.modules.farm_assistant.schemas import (
    ContextRef,
    MessageCreate,
    PreferenceInput,
)
from sideronostos_backend.modules.farm_assistant.service import AssistantService
from sideronostos_backend.modules.field_shift.models import FieldRecord
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job
from sideronostos_backend.modules.rotation_optimizer.models import SavedOptimizationPlan
from sideronostos_backend.modules.rotation_optimizer.service import RotationService

pytestmark = pytest.mark.asyncio


async def test_owned_daily_comparison_uses_frozen_fields_and_nullable_metrics(api):
    client, identity, body, factory, fid, _ = api
    await publish_weather(factory)
    body["disabled_metrics"] = {"profit": "Local price not established"}
    body["weights"] = {
        "profit": 0,
        "water": 0.4,
        "rotation": 0.1,
        "soil": 0.15,
        "risk": 0.15,
        "bare": 0.2,
    }
    runs = []
    for rainfall in [0, -10]:
        body["idempotency_key"] = uuid4().hex
        body["scenario"] = {"temperature_change_c": 0, "rainfall_change_pct": rainfall}
        response = await client.post("/rotation-optimizer/v3/runs", json=body)
        assert response.status_code == 202, response.text
        run = response.json()
        await run_job(
            factory, run["job_id"], {"run_id": run["id"], "owner_user_id": identity["id"]}
        )
        runs.append(run)
    reference = ContextRef(
        page="rotation",
        revision=1,
        run_id=runs[0]["id"],
        option_id="option-1",
        compare_run_id=runs[1]["id"],
        compare_option_id="option-1",
    )
    async with factory() as session:
        field = await session.get(FieldRecord, fid)
        field.data = {**field.data, "name": "Edited after computation", "area_ha": 99}
        field.version += 1
        await session.commit()
        context = await freeze_context(session, identity["id"], reference, "en")
        assert context["fields"][0]["area_ha"] == 2
        assert context["fields"][0]["version"] == 1
        assert context["comparison"]["delta"]["profit"] is None
        assert set(context["comparison"]["delta"]) == {
            "profit",
            "water",
            "rotation",
            "soil",
            "risk",
            "bare",
        }
        fact = next(f for f in context["facts"] if f["key"] == "comparison.delta.profit")
        assert fact["value"] is None
        with pytest.raises(HTTPException) as denied:
            await freeze_context(session, "other-owner", reference, "en")
        assert denied.value.status_code == 404


async def test_saved_plan_binding_checks_owner_ids_and_freezes_the_saved_snapshot(api):
    client, identity, body, factory, fid, _ = api
    await publish_weather(factory)
    body["idempotency_key"] = uuid4().hex
    response = await client.post("/rotation-optimizer/v3/runs", json=body)
    assert response.status_code == 202, response.text
    run = response.json()
    await run_job(factory, run["job_id"], {"run_id": run["id"], "owner_user_id": identity["id"]})
    async with factory() as session:
        saved = await RotationService().save_plan(
            session, identity["id"], run["id"], "option-1", "Saved engineering plan", "Frozen note"
        )
        reference = ContextRef(page="map", revision=2, plan_id=saved["id"])
        field = await session.get(FieldRecord, fid)
        field.version += 1
        field.data = {**field.data, "name": "Later edit", "area_ha": 99}
        await session.commit()
        context = await freeze_context(session, identity["id"], reference, "en")
        assert context["reference"]["plan_id"] == saved["id"]
        assert context["reference"]["run_id"] == run["id"]
        assert context["reference"]["option_id"] == "option-1"
        assert context["fields"][0]["version"] == 1
        assert context["fields"][0]["area_ha"] == 2
        assert context["saved_plan"]["title"] == "Saved engineering plan"
        assert context["saved_plan"]["created_at"] == saved["created_at"]
        assert any(f["source"].get("plan_id") == saved["id"] for f in context["facts"])
        chat = await conversation(factory, identity["id"])
        service = AssistantService()
        await service.set_preferences(
            session, identity["id"], PreferenceInput(language="en", detail="brief"), chat["id"]
        )
        message, work = await service.start_message(
            session,
            identity["id"],
            chat["id"],
            MessageCreate(
                client_message_id=uuid4().hex,
                text="Explain the saved plan sources",
                context=reference,
            ),
        )
        assert work
        await service.set_preferences(
            session, identity["id"], PreferenceInput(language="zh", detail="brief"), chat["id"]
        )
        message_id = message.id
        async with factory() as reopened:
            persisted = await reopened.get(AssistantMessage, message_id)
            assert persisted.context_snapshot["language"] == "en"
            assert persisted.context_snapshot["reference"]["plan_id"] == saved["id"]
            assert persisted.context_snapshot["fields"][0]["version"] == 1
            fact = next(
                f
                for f in persisted.context_snapshot["facts"]
                if f["key"] == "saved_plan.created_at"
            )
            source = await service.source(
                reopened, identity["id"], chat["id"], message_id, fact["id"]
            )
            assert source["source"]["plan_id"] == saved["id"]
        for owner, changes, status in [
            ("other-owner", {}, 404),
            (identity["id"], {"plan_id": str(uuid4())}, 404),
            (identity["id"], {"run_id": str(uuid4())}, 409),
            (identity["id"], {"run_id": run["id"], "option_id": "wrong-option"}, 409),
        ]:
            with pytest.raises(HTTPException) as denied:
                await freeze_context(session, owner, reference.model_copy(update=changes), "en")
            assert denied.value.status_code == status
        with pytest.raises(HTTPException) as stale:
            await freeze_context(
                session,
                identity["id"],
                ContextRef(page="map", revision=3, fields=[{"id": fid, "expected_version": 1}]),
                "en",
            )
        assert stale.value.status_code == 409
        record = await session.get(SavedOptimizationPlan, saved["id"])
        record.data = {**record.data, "option": {**record.data["option"], "feasible": False}}
        await session.commit()
        with pytest.raises(HTTPException) as changed_snapshot:
            await freeze_context(session, identity["id"], reference, "en")
        assert changed_snapshot.value.status_code == 409
