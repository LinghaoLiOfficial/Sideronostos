"""Owned v3 assistant comparison against real saved runs; no provider calls."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from test_rotation_v3_api import api as api
from test_rotation_v3_persistence import publish_weather

from sideronostos_backend.modules.farm_assistant.context import freeze_context
from sideronostos_backend.modules.farm_assistant.schemas import ContextRef
from sideronostos_backend.modules.field_shift.models import FieldRecord
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job

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
