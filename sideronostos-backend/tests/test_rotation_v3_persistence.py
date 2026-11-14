"""Real PostgreSQL submission, worker execution and immutable v3 plan persistence."""

import asyncio
from uuid import uuid4

import pytest
from rotation_v3_application_helpers import weather
from test_rotation_v3_api import api as _api

from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.field_shift.models import FieldRecord
from sideronostos_backend.modules.rotation_optimizer.jobs import run_job

api = _api
pytestmark = pytest.mark.asyncio


async def publish_weather(factory):
    raw = weather()
    async with factory() as s:
        s.add(
            ScienceRelease(
                id=raw["release_id"],
                product="NASA_POWER_DAILY",
                status="published",
                manifest_sha256=raw["manifest_sha256"],
                data=raw,
            )
        )
        await s.commit()


async def test_v3_submission_is_idempotent_and_saved_plan_keeps_original_inputs(api):
    client, identity, body, factory, fid, farmid = api
    await publish_weather(factory)
    body["idempotency_key"] = uuid4().hex
    responses = await asyncio.gather(
        *[client.post("/rotation-optimizer/v3/runs", json=body) for _ in range(2)]
    )
    assert [r.status_code for r in responses] == [202, 202]
    run = responses[0].json()
    assert run["id"] == responses[1].json()["id"]
    assert run["request"]["model_version"] == "rotation-milp-v3.0"
    assert run["field_snapshots"][0]["farm_id"] == farmid
    async with factory() as s:
        f = await s.get(FieldRecord, fid)
        f.data = {**f.data, "area_ha": 20}
        f.version += 1
        await s.commit()
    completed = await run_job(
        factory, run["job_id"], {"run_id": run["id"], "owner_user_id": identity["id"]}
    )
    assert completed["published"] and completed["status"] == "optimal", completed
    result = (await client.get("/rotation-optimizer/runs/" + run["id"])).json()
    assert result["field_snapshots"][0]["area_ha"] == 2
    assert result["result"]["baseline"]["verification"]["metrics"]["profit"] == 1200
    saved = await client.post(
        "/rotation-optimizer/plans",
        json={"run_id": run["id"], "option_id": "option-1", "title": "Verified v3 fixture"},
    )
    assert saved.status_code == 201, saved.text
    plan = saved.json()
    assert plan["schema"] == "rotation-saved-v3.0"
    assert plan["input_snapshot"]["fields"][0]["version"] == 1
    assert plan["input_snapshot"]["farms"][0]["id"] == farmid
    reopened = await client.get("/rotation-optimizer/plans/" + plan["id"])
    assert reopened.json() == plan
    repeated = await client.post("/rotation-optimizer/v3/runs", json=body)
    assert repeated.json()["id"] == run["id"]
    body["scenario"] = {"rainfall_change_pct": -10, "temperature_change_c": 0}
    assert (await client.post("/rotation-optimizer/v3/runs", json=body)).status_code == 409


async def test_unready_request_creates_no_job_and_account_guard_precedes_writes(api):
    client, identity, body, _, _, _ = api
    body["idempotency_key"] = uuid4().hex
    denied = await client.post(
        "/rotation-optimizer/v3/runs", json=body, headers={"X-Workspace-Owner": "wrong"}
    )
    assert denied.status_code == 409
    unready = await client.post("/rotation-optimizer/v3/runs", json=body)
    assert unready.status_code == 422
    assert unready.json()["error"]["details"]["code"] == "planning_data_not_ready"
    assert (await client.get("/rotation-optimizer/runs")).json()["items"] == []


async def test_v3_compare_uses_six_metrics_and_the_selected_options_weights(api):
    client, identity, body, factory, _, _ = api
    await publish_weather(factory)
    runs = []
    for water_weight in [0.2, 0.3]:
        body["idempotency_key"] = uuid4().hex
        body["weights"] = {
            "profit": 0.45 - water_weight,
            "water": water_weight,
            "rotation": 0.1,
            "soil": 0.15,
            "risk": 0.15,
            "bare": 0.15,
        }
        response = await client.post("/rotation-optimizer/v3/runs", json=body)
        assert response.status_code == 202, response.text
        run = response.json()
        runs.append(run)
        assert (
            await run_job(
                factory, run["job_id"], {"run_id": run["id"], "owner_user_id": identity["id"]}
            )
        )["published"]
    response = await client.post(
        "/rotation-optimizer/compare",
        json={
            "first_run_id": runs[0]["id"],
            "second_run_id": runs[1]["id"],
            "first_option_id": "option-1",
            "second_option_id": "option-1",
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert set(result["delta"]) == {"profit", "water", "rotation", "soil", "risk", "bare"}
    assert not result["score_comparable"]


async def test_comparison_preserves_unknown_optional_metrics_as_null(api):
    client, identity, body, factory, _, _ = api
    await publish_weather(factory)
    body["disabled_metrics"] = {"profit": "No local price confidence"}
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
        body["scenario"] = {"rainfall_change_pct": rainfall, "temperature_change_c": 0}
        response = await client.post("/rotation-optimizer/v3/runs", json=body)
        assert response.status_code == 202, response.text
        run = response.json()
        runs.append(run)
        assert (
            await run_job(
                factory, run["job_id"], {"run_id": run["id"], "owner_user_id": identity["id"]}
            )
        )["published"]
    response = await client.post(
        "/rotation-optimizer/compare",
        json={
            "first_run_id": runs[0]["id"],
            "second_run_id": runs[1]["id"],
            "first_option_id": "option-1",
            "second_option_id": "option-1",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["delta"]["profit"] is None
    assert response.json()["unavailable_metrics"] == ["profit"]
