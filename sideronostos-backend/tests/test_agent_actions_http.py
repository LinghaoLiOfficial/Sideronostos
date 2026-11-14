"""Real PostgreSQL action journey against an explicitly dedicated test database."""

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.agri_data.models import RegionSelection, ScienceRelease
from sideronostos_backend.modules.agri_data.router import router as agri_data_router
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal, require_verified_user
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.farm_assistant.models import AssistantAction, Conversation
from sideronostos_backend.modules.farm_assistant.router import router
from sideronostos_backend.modules.field_shift.models import FieldRecord
from sideronostos_backend.modules.field_shift.router import router as field_shift_router
from sideronostos_backend.modules.field_shift.service import FieldShiftService
from sideronostos_backend.modules.knowledge.models import KBRelease

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def api():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set FIELD_SHIFT_TEST_DATABASE_URL to a dedicated PostgreSQL database")
    if "test" not in (make_url(url).database or ""):
        raise RuntimeError("Action tests require a database name containing 'test'")
    engine = create_async_engine(url)
    table_names = {
        "knowledge_releases",
        "assistant_conversations",
        "assistant_actions",
        "field_shift_farms",
        "field_shift_fields",
        "agri_data_selections",
        "agri_data_releases",
    }
    tables = [table for table in Base.metadata.sorted_tables if table.name in table_names]
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner = str(uuid4())
    identity = {"id": owner}
    conversation_id = str(uuid4())
    selection_id = str(uuid4())
    async with factory() as session:
        for fixed_id in ("agent-test-smap", "agent-test-weather"):
            previous = await session.get(ScienceRelease, fixed_id)
            if previous is not None:
                await session.delete(previous)
        await session.flush()
        release = KBRelease(
            id="agent-test-kb-" + uuid4().hex,
            status="published",
            manifest_sha256="a" * 64,
            embedding_model="synthetic-no-provider",
            embedding_dimensions=2,
            embedding_namespace="test",
            recipe="test-only",
            report={},
        )
        session.add(release)
        await session.flush()
        session.add(
            Conversation(
                id=conversation_id,
                owner_user_id=owner,
                preset="field_management",
                bot_id="field-guide",
                language="en",
                detail="brief",
                kb_release_id=release.id,
                next_sequence=1,
            )
        )
        session.add(
            RegionSelection(
                id=selection_id,
                owner_user_id=owner,
                revision=2,
                kind="point",
                data={
                    "geometry": {"type": "Point", "coordinates": [-93.5, 42]},
                    "center": [-93.5, 42],
                    "area_ha": None,
                },
            )
        )
        session.add(
            ScienceRelease(
                id="agent-test-smap",
                owner_user_id=owner,
                product="SPL3SMP_E",
                status="published",
                manifest_sha256="b" * 64,
                data={
                    "start": "2025-01-01",
                    "end": "2025-01-02",
                    "bounds": [-94, 41, -93, 43],
                    "passes": {"AM": {"asset": "synthetic.npz", "asset_sha256": "c" * 64}},
                    "grid_spacing_label": "synthetic test grid",
                    "limitations": ["test data"],
                    "recipe": "test-only",
                },
            )
        )
        session.add(
            ScienceRelease(
                id="agent-test-weather",
                owner_user_id=owner,
                product="NASA_POWER_DAILY",
                status="published",
                manifest_sha256="d" * 64,
                data={
                    "start": "2025-01-01",
                    "end": "2025-01-01",
                    "latitude": 42,
                    "longitude": -93.5,
                    "recipe": "test-only",
                    "source_kind": "synthetic_test",
                    "days": [{"date": "2025-01-01", "rain_mm": 4.0, "et0_mm": 2.0}],
                },
            )
        )
        await session.commit()

    app = create_app(modules=(ModuleSpec(name="farm_assistant", routers=(router,)),))
    app.include_router(field_shift_router)
    app.include_router(agri_data_router)

    @app.post("/rotation-optimizer/mock-job", operation_id="start_mock_job", status_code=202)
    async def start_mock_job():
        return {"id": "job-1"}

    async def principal():
        return AuthPrincipal(identity["id"], "farmer@example.test", "Farmer", datetime.now(UTC))

    async def db_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[require_verified_user] = principal
    app.dependency_overrides[get_session] = db_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, factory, identity, conversation_id, selection_id
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.drop_all(sync, tables=tables))
    await engine.dispose()


def field_arguments(**changes):
    return {
        "name": "North field",
        "area_ha": 4,
        "latitude": 42,
        "longitude": -93.5,
        "soil_texture": "loam",
        "irrigation_available": True,
        "profile_id": "temperate-demo",
        "history": [],
        **changes,
    }


async def test_module_operations_are_catalogued_by_conversation_and_executed_idempotently(api):
    client, factory, identity, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/operations"
    catalog = await client.get(path)
    assert catalog.status_code == 200
    tools = catalog.json()["items"]
    assert any(tool["operation_id"] == "list_profiles_field_shift_profiles_get" for tool in tools)
    create = next(
        tool for tool in tools
        if tool["operation_id"] == "create_field_field_shift_fields_post"
    )
    assert "body.name" in create["required_inputs"]
    assert "body.area_ha" in create["required_inputs"]

    result = await client.post(path, json={
        "operation_id": "list_profiles_field_shift_profiles_get",
        "path_params": {},
        "query_params": {},
        "body": None,
        "idempotency_key": "module-list-profiles-1",
    })
    assert result.status_code == 200
    assert result.json()["status"] == "succeeded"
    assert "list_profiles_field_shift_profiles_get" not in result.json()["text"]
    assert result.json()["result"]["items"]
    assert result.json()["href"] == "/field-shift"
    history = await client.get(path + "/history")
    assert history.status_code == 200
    assert history.json()["items"][0]["outcome"] == result.json()
    replay = await client.post(path, json={
        "operation_id": "list_profiles_field_shift_profiles_get",
        "path_params": {},
        "query_params": {},
        "body": None,
        "idempotency_key": "module-list-profiles-1",
    })
    assert replay.json() == result.json()
    conflict = await client.post(path, json={
        "operation_id": "create_field_field_shift_fields_post",
        "path_params": {},
        "query_params": {},
        "body": field_arguments(name="Different field"),
        "idempotency_key": "module-list-profiles-1",
    })
    assert conflict.status_code == 409


async def test_specialty_bot_cannot_bypass_its_remote_sensing_scope_via_generic_operations(api):
    client, factory, identity, _, _ = api
    async with factory() as session:
        release = await session.scalar(select(KBRelease).limit(1))
        specialist = Conversation(
            id=str(uuid4()), owner_user_id=identity["id"], preset="remote_sensing",
            bot_id="remote-soil", language="en", detail="brief",
            kb_release_id=release.id, next_sequence=1,
        )
        session.add(specialist)
        await session.commit()
    path = f"/farm-assistant/conversations/{specialist.id}/operations"
    assert (await client.get(path)).json()["items"] == []
    attempt = await client.post(path, json={
        "operation_id": "layers_agri_data_layers_get",
        "path_params": {}, "query_params": {}, "body": None,
        "idempotency_key": "specialist-scope-1",
    })
    assert attempt.status_code == 422


async def test_module_operation_reports_required_inputs_before_execution(api):
    client, _, _, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/operations"
    response = await client.post(path, json={
        "operation_id": "get_field_field_shift_fields__field_id__get",
        "path_params": {},
        "query_params": {},
        "body": None,
        "idempotency_key": "module-missing-path-1",
    })
    assert response.status_code == 200
    assert response.json()["status"] == "needs_input"
    assert response.json()["missing_inputs"] == ["field_id"]


async def test_empty_module_list_is_explained_as_empty_data(api):
    client, _, _, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/operations"
    response = await client.post(path, json={
        "operation_id": "list_fields_field_shift_fields_get",
        "path_params": {}, "query_params": {}, "body": None,
        "idempotency_key": "module-empty-fields-1",
    })
    assert response.json()["status"] == "succeeded"
    assert response.json()["result"]["items"] == []
    assert "No records" in response.json()["text"]


async def test_accepted_module_job_reports_progress_without_claiming_completion(api):
    client, factory, _, conversation_id, _ = api
    async with factory() as session:
        conversation = await session.get(Conversation, conversation_id)
        conversation.preset = "rotation"
        conversation.bot_id = "rotation-guide"
        await session.commit()
    path = f"/farm-assistant/conversations/{conversation_id}/operations"
    request = {
        "operation_id": "start_mock_job", "path_params": {}, "query_params": {},
        "body": None, "idempotency_key": "module-start-job-1",
    }
    result = await client.post(path, json=request)
    assert result.status_code == 200
    assert result.json()["status"] == "pending"
    assert result.json()["status_code"] == 202
    assert result.json()["href"] == "/field-shift/rotation?run=job-1"
    assert (await client.post(path, json=request)).json() == result.json()


async def test_module_operation_catalog_is_owner_bound(api):
    client, _, identity, conversation_id, _ = api
    identity["id"] = str(uuid4())
    response = await client.get(f"/farm-assistant/conversations/{conversation_id}/operations")
    assert response.status_code == 404


async def test_field_action_resumes_persists_and_retries_once(api):
    client, factory, identity, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/actions"
    first = await client.post(
        path,
        json={
            "action": "field.create",
            "arguments": {"name": "North field"},
            "idempotency_key": "field-key-1",
        },
    )
    assert first.status_code == 200
    assert first.json()["status"] == "needs_input"
    assert "area_ha" in first.json()["missing_fields"]
    history = await client.get(path)
    assert history.status_code == 200
    assert history.json()["items"][0]["idempotency_key"] == "field-key-1"
    assert history.json()["items"][0]["outcome"]["status"] == "needs_input"
    rest = {key: value for key, value in field_arguments().items() if key != "name"}
    second = await client.post(
        path, json={"action": "field.create", "arguments": rest, "idempotency_key": "field-key-1"}
    )
    assert second.status_code == 200
    result = second.json()
    assert result["status"] == "succeeded"
    field_id = result["result"]["id"]
    assert result["href"] == f"/field-shift?field={field_id}&step=field"
    replay = await client.post(
        path, json={"action": "field.create", "arguments": rest, "idempotency_key": "field-key-1"}
    )
    assert replay.status_code == 200 and replay.json()["result"]["id"] == field_id
    conflict = await client.post(
        path,
        json={
            "action": "field.create",
            "arguments": {"name": "Changed"},
            "idempotency_key": "field-key-1",
        },
    )
    assert conflict.status_code == 409
    added_input = await client.post(
        path,
        json={
            "action": "field.create",
            "arguments": {"unexpected": "new input"},
            "idempotency_key": "field-key-1",
        },
    )
    assert added_input.status_code == 409
    async with factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(FieldRecord)
                .where(FieldRecord.id == field_id, FieldRecord.owner_user_id == identity["id"])
            )
            == 1
        )
        record = await session.scalar(
            select(AssistantAction).where(
                AssistantAction.conversation_id == conversation_id,
                AssistantAction.idempotency_key == "field-key-1",
            )
        )
        assert record is not None
        assert [event["status"] for event in record.audit_events] == [
            "started",
            "needs_input",
            "succeeded",
            "replayed",
        ]
        assert record.payload_hash and record.outcome["result"]["id"] == field_id
    persisted = await client.get(path + "/field-key-1")
    assert persisted.status_code == 200 and persisted.json()["result"]["id"] == field_id
    history = await client.get(path)
    assert history.json()["items"][0]["outcome"]["result"]["id"] == field_id
    identity["id"] = str(uuid4())
    assert (await client.get(path + "/field-key-1")).status_code == 404
    assert (
        await client.post(
            path,
            json={
                "action": "field.create",
                "arguments": field_arguments(),
                "idempotency_key": "foreign-key",
            },
        )
    ).status_code == 404


async def test_remote_layer_and_fact_only_report_confirmed_owner_data(api):
    client, factory, identity, conversation_id, selection_id = api
    async with factory() as session:
        row = await session.get(Conversation, conversation_id)
        row.preset = "remote_sensing"
        row.bot_id = "remote-water"
        await session.commit()
    path = f"/farm-assistant/conversations/{conversation_id}/actions"
    layer = await client.post(
        path,
        json={
            "action": "remote_sensing.layer",
            "arguments": {"layer_id": "agent-test-smap:am"},
            "idempotency_key": "layer-key-1",
        },
    )
    assert layer.status_code == 200
    assert layer.json()["status"] == "succeeded"
    assert layer.json()["href"] == "/field-shift/map?layer=agent-test-smap%3Aam"
    fact = await client.post(
        path,
        json={
            "action": "remote_sensing.fact",
            "arguments": {
                "selection_id": selection_id,
                "metric": "rainfall_total",
                "start": "2025-01-01",
                "end": "2025-01-01",
                "expected_revision": 2,
            },
            "idempotency_key": "fact-key-1",
        },
    )
    assert fact.status_code == 200
    assert fact.json()["status"] == "succeeded"
    assert fact.json()["result"]["value"] == 4.0
    assert (
        fact.json()["href"]
        == f"/field-shift/map?selection={selection_id}&obsStart=2025-01-01&obsEnd=2025-01-01"
    )
    identity["id"] = str(uuid4())
    assert (await client.get(path + "/fact-key-1")).status_code == 404


async def test_remote_specialist_action_scope_is_enforced_before_journaling(api):
    client, factory, identity, conversation_id, selection_id = api
    async with factory() as session:
        row = await session.get(Conversation, conversation_id)
        row.preset = "remote_sensing"
        row.bot_id = "remote-weather"
        await session.commit()
    path = f"/farm-assistant/conversations/{conversation_id}/actions"
    soil = await client.post(
        path,
        json={
            "action": "remote_sensing.fact",
            "arguments": {"selection_id": selection_id, "metric": "surface_soil_moisture"},
            "idempotency_key": "weather-soil-denied",
        },
    )
    assert soil.status_code == 422
    smap_layer = await client.post(
        path,
        json={
            "action": "remote_sensing.layer",
            "arguments": {"layer_id": "agent-test-smap:am"},
            "idempotency_key": "weather-layer-denied",
        },
    )
    assert smap_layer.status_code == 422
    rain = await client.post(
        path,
        json={
            "action": "remote_sensing.fact",
            "arguments": {"selection_id": selection_id, "metric": "rainfall_total"},
            "idempotency_key": "weather-rain-allowed",
        },
    )
    assert rain.status_code == 200 and rain.json()["status"] == "succeeded"
    async with factory() as session:
        keys = (
            await session.scalars(
                select(AssistantAction.idempotency_key).where(
                    AssistantAction.conversation_id == conversation_id
                )
            )
        ).all()
        assert keys == ["weather-rain-allowed"]
    identity["id"] = str(uuid4())
    assert (
        await client.post(
            path,
            json={
                "action": "remote_sensing.fact",
                "arguments": {"selection_id": selection_id, "metric": "rainfall_total"},
                "idempotency_key": "foreign-weather-key",
            },
        )
    ).status_code == 404


async def test_crash_after_field_insert_rolls_back_action_and_field(api, monkeypatch):
    client, factory, identity, conversation_id, _ = api
    original = FieldShiftService.create_field

    async def interrupted_create(self, session, user_id, body, **kwargs):
        await original(self, session, user_id, body, **kwargs)
        raise RuntimeError("simulated crash after field insert")

    monkeypatch.setattr(FieldShiftService, "create_field", interrupted_create)
    with pytest.raises(RuntimeError, match="simulated crash"):
        await client.post(
            f"/farm-assistant/conversations/{conversation_id}/actions",
            json={
                "action": "field.create",
                "arguments": field_arguments(),
                "idempotency_key": "crash-key",
            },
        )
    async with factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(FieldRecord)
                .where(FieldRecord.owner_user_id == identity["id"])
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AssistantAction)
                .where(AssistantAction.conversation_id == conversation_id)
            )
            == 0
        )


async def test_concurrent_retries_create_one_field(api):
    client, factory, identity, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/actions"
    body = {
        "action": "field.create",
        "arguments": field_arguments(),
        "idempotency_key": "concurrent-key",
    }
    first, second = await asyncio.gather(client.post(path, json=body), client.post(path, json=body))
    assert first.status_code == second.status_code == 200
    field_id = first.json()["result"]["id"]
    assert second.json()["result"]["id"] == field_id
    async with factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(FieldRecord)
                .where(
                    FieldRecord.owner_user_id == identity["id"],
                    FieldRecord.id == field_id,
                )
            )
            == 1
        )


async def test_invalid_field_is_corrected_without_a_duplicate(api):
    client, factory, identity, conversation_id, _ = api
    path = f"/farm-assistant/conversations/{conversation_id}/actions"
    invalid = await client.post(
        path,
        json={
            "action": "field.create",
            "arguments": field_arguments(latitude=91),
            "idempotency_key": "correctable-key",
        },
    )
    assert invalid.status_code == 200
    assert invalid.json()["status"] == "failed"
    assert invalid.json()["href"] is None
    corrected = await client.post(
        path,
        json={
            "action": "field.create",
            "arguments": {"latitude": 42},
            "idempotency_key": "correctable-key",
        },
    )
    assert corrected.status_code == 200
    assert corrected.json()["status"] == "succeeded"
    async with factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(FieldRecord)
                .where(
                    FieldRecord.owner_user_id == identity["id"],
                    FieldRecord.id == corrected.json()["result"]["id"],
                )
            )
            == 1
        )
