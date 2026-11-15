"""v3 preflight runs through the real API and dedicated PostgreSQL ownership state."""

import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from rotation_v3_application_helpers import draft, field, weather
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal, require_verified_user
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.field_shift.models import FarmRecord, FieldRecord
from sideronostos_backend.modules.field_shift.router import router as field_router
from sideronostos_backend.modules.rotation_optimizer.router import router

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def api():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL required")
    if not url.rsplit("/", 1)[-1].endswith("_test"):
        raise RuntimeError("Dedicated test database required")
    engine = create_async_engine(url)
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    identity = {"id": str(uuid4())}
    fid = str(uuid4())
    farmid = str(uuid4())
    body = json.loads(json.dumps(draft()).replace("field-1", fid).replace("farm-1", farmid))
    async with factory() as s:
        existing = await s.get(ScienceRelease, "power-iowa-2025-v1")
        if existing:
            await s.delete(existing)
            await s.flush()
        s.add(
            FarmRecord(
                id=farmid,
                owner_user_id=identity["id"],
                local_id=uuid4().hex,
                data={"partition_revision": "partition-1"},
            )
        )
        await s.flush()
        data = field().model_dump(
            mode="json",
            exclude={
                "id",
                "farm_id",
                "partition_revision",
                "local_id",
                "version",
                "created_at",
                "updated_at",
            },
        )
        s.add(
            FieldRecord(
                id=fid,
                owner_user_id=identity["id"],
                farm_id=farmid,
                partition_revision="partition-1",
                local_id=uuid4().hex,
                data=data,
            )
        )
        await s.commit()
    app = create_app(
        modules=(
            ModuleSpec(name="rotation_optimizer", routers=(router,)),
            ModuleSpec(name="field_shift", routers=(field_router,)),
        )
    )

    async def principal():
        return AuthPrincipal(identity["id"], "test@example.test", "Test farmer", datetime.now(UTC))

    async def session():
        async with factory() as s:
            yield s

    app.dependency_overrides[require_verified_user] = principal
    app.dependency_overrides[get_session] = session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, identity, body, factory, fid, farmid
    await engine.dispose()


async def test_v3_catalog_is_separate_and_no_weather_is_an_explicit_block(api):
    client, _, body, _, _, _ = api
    profiles = await client.get("/rotation-optimizer/v3/profiles")
    assert profiles.status_code == 200
    assert profiles.json()["items"][0]["id"] == body["profile_id"]
    old = await client.get("/rotation-optimizer/profiles")
    assert old.status_code == 200 and old.json()["items"][0]["id"] == "iowa-benchmark-20261112-v1"
    response = await client.post("/rotation-optimizer/v3/readiness", json=body)
    assert response.status_code == 200
    result = response.json()
    assert not result["ready"] and "weather" in result["blocked_features"]
    assert result["weather"]["issues"] == ["weather_release_unavailable"]
    assert result["field_versions"][0]["version"] == 1


async def test_published_weather_is_checked_and_fingerprinted_without_mutation(api):
    client, _, body, factory, fid, farmid = api
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
    result = (await client.post("/rotation-optimizer/v3/readiness", json=body)).json()
    assert result["ready"]
    assert result["stage"] == "data_preflight"
    assert len(result["fingerprint"]) == 64
    assert result["weather"]["basis"] == "historical_replay"
    assert "days" not in result["weather"]
    assert result["farm_versions"] == [
        {"id": farmid, "version": 1, "partition_revision": "partition-1"}
    ]
    async with factory() as s:
        assert (await s.get(FieldRecord, fid)).version == 1
        row = await s.get(ScienceRelease, raw["release_id"])
        row.data = {**raw, "time_standard": "LST"}
        await s.commit()
    invalid = (await client.post("/rotation-optimizer/v3/readiness", json=body)).json()
    assert not invalid["ready"]
    assert "weather_day_mismatch" in invalid["weather"]["issues"]
    assert result["fingerprint"] != invalid["fingerprint"]


async def test_foreign_and_archived_fields_never_supply_optimizer_context(api):
    client, identity, body, factory, fid, farmid = api
    actual = identity["id"]
    identity["id"] = str(uuid4())
    assert (await client.post("/rotation-optimizer/v3/readiness", json=body)).status_code == 404
    identity["id"] = actual
    async with factory() as s:
        farm = await s.get(FarmRecord, farmid)
        farm.data = {"partition_revision": "partition-2"}
        farm.version += 1
        await s.commit()
    response = await client.post("/rotation-optimizer/v3/readiness", json=body)
    assert response.status_code == 409
    assert "partition" in response.json()["error"]["message"]


async def test_captured_owner_guard_and_field_version_guard(api):
    client, _, body, _, _, _ = api
    response = await client.post(
        "/rotation-optimizer/v3/readiness",
        json=body,
        headers={"X-Workspace-Owner": "another-owner"},
    )
    assert response.status_code == 409
    body["fields"][0]["expected_version"] = 2
    result = (await client.post("/rotation-optimizer/v3/readiness", json=body)).json()
    assert not result["ready"] and "field_identity" in result["blocked_features"]
