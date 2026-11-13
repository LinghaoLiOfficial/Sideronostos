"""Owned farm synchronization against a dedicated real PostgreSQL database.

Catches duplicate writes, cross-owner reads, stale overwrites and geometry mismatches.
Coordinates/areas below are synthetic test geometry, not agricultural evidence.
"""

import asyncio
import copy
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal, require_verified_user
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.field_shift.router import router

pytestmark = pytest.mark.asyncio


def polygon(left=-93.5, right=-93.498):
    return {
        "type": "Polygon",
        "coordinates": [[[left, 42], [right, 42], [right, 42.001], [left, 42.001], [left, 42]]],
    }


def field(local_id="left", left=-93.5, right=-93.499):
    return {
        "local_id": local_id,
        "field": {
            "name": local_id,
            "area_ha": 0.92,
            "latitude": 42.0005,
            "longitude": (left + right) / 2,
            "soil_texture": "loam",
            "irrigation_available": True,
            "profile_id": "temperate-demo",
            "history": [],
            "geometry": polygon(left, right),
        },
    }


def request_body():
    return {
        "idempotency_key": uuid4().hex,
        "farm": {
            "local_id": uuid4().hex,
            "name": "Synthetic farm",
            "geometry": polygon(),
            "partition_revision": "partition-1",
        },
        "fields": [field(), field("right", -93.499, -93.498)],
    }


@pytest_asyncio.fixture
async def api():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL required")
    if not url.rsplit("/", 1)[-1].endswith("_test"):
        raise RuntimeError("Use a dedicated _test database")
    engine = create_async_engine(url)
    tables = [t for t in Base.metadata.sorted_tables if t.name.startswith("field_shift_")]
    async with engine.begin() as connection:
        await connection.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    app = create_app(modules=(ModuleSpec(name="field_shift", routers=(router,)),))
    identity = {"id": str(uuid4())}

    async def principal():
        return AuthPrincipal(identity["id"], "farm@example.test", "Farmer", datetime.now(UTC))

    async def session():
        async with factory() as value:
            yield value

    app.dependency_overrides[require_verified_user] = principal
    app.dependency_overrides[get_session] = session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, identity
    await engine.dispose()


async def test_parallel_retry_returns_one_farm_and_one_set_of_fields(api):
    client, _ = api
    body = request_body()
    responses = await asyncio.gather(
        *[client.post("/field-shift/farms/sync", json=body) for _ in range(2)]
    )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    result = responses[0].json()
    assert result["complete"] and len(result["items"]) == 2
    assert all(i["status"] == "synced" for i in result["items"])
    fields = (await client.get("/field-shift/fields")).json()["items"]
    assert len(fields) == 2
    assert all(f["farm_id"] == result["farm"]["id"] for f in fields)
    assert all(f["partition_revision"] == "partition-1" for f in fields)
    assert all(0.91 < f["area_ha"] < 0.93 for f in fields)
    restored = await client.get("/field-shift/farms/" + result["farm"]["id"])
    assert restored.status_code == 200
    assert {f["id"] for f in restored.json()["fields"]} == {f["id"] for f in fields}


async def test_reused_key_with_different_payload_conflicts(api):
    client, _ = api
    body = request_body()
    assert (await client.post("/field-shift/farms/sync", json=body)).status_code == 200
    body["fields"][0]["field"]["name"] = "Changed"
    assert (await client.post("/field-shift/farms/sync", json=body)).status_code == 409
    assert len((await client.get("/field-shift/fields")).json()["items"]) == 2


async def test_partial_errors_can_retry_without_duplicating_successes(api):
    client, _ = api
    body = request_body()
    body["fields"][1]["field"]["soil_texture"] = "invented"
    response = await client.post("/field-shift/farms/sync", json=body)
    assert response.status_code == 200
    result = response.json()
    assert not result["complete"]
    assert [i["status"] for i in result["items"]] == ["synced", "invalid"]
    assert len((await client.get("/field-shift/fields")).json()["items"]) == 1
    # A fresh attempt retains the successful local identity; no expected version
    # is needed to acknowledge an identical already-created field.
    body["idempotency_key"] = uuid4().hex
    body["fields"][1]["field"]["soil_texture"] = "loam"
    retried = (await client.post("/field-shift/farms/sync", json=body)).json()
    assert retried["complete"]
    assert retried["items"][0]["field"]["id"] == result["items"][0]["field"]["id"]
    assert len((await client.get("/field-shift/fields")).json()["items"]) == 2


async def test_other_owner_cannot_read_farm_or_update_linked_field(api):
    client, identity = api
    body = request_body()
    result = (await client.post("/field-shift/farms/sync", json=body)).json()
    identity["id"] = str(uuid4())
    assert (await client.get("/field-shift/farms")).json() == {"items": []}
    assert (await client.get("/field-shift/farms/" + result["farm"]["id"])).status_code == 404
    # Same local IDs under another owner do not attach another account's records.
    own = await client.post("/field-shift/farms/sync", json=body)
    assert own.status_code == 200
    assert own.json()["farm"]["id"] != result["farm"]["id"]
    assert own.json()["items"][0]["field"]["id"] != result["items"][0]["field"]["id"]


async def test_stale_field_version_does_not_overwrite_newer_edit(api):
    client, _ = api
    body = request_body()
    original = (await client.post("/field-shift/farms/sync", json=body)).json()
    saved = original["items"][0]["field"]
    edit = {**body["fields"][0]["field"], "name": "Newer tab", "expected_version": 1}
    assert (await client.patch("/field-shift/fields/" + saved["id"], json=edit)).status_code == 200
    body["idempotency_key"] = uuid4().hex
    body["fields"][0]["expected_version"] = 1
    body["fields"][0]["field"]["name"] = "Stale tab"
    result = (await client.post("/field-shift/farms/sync", json=body)).json()
    assert result["items"][0]["status"] == "conflict"
    current = (await client.get("/field-shift/fields/" + saved["id"])).json()
    assert current["name"] == "Newer tab" and current["farm_id"] == original["farm"]["id"]


async def test_changed_partition_requires_farm_version_and_preserves_old_fields(api):
    client, _ = api
    body = request_body()
    original = (await client.post("/field-shift/farms/sync", json=body)).json()
    body["idempotency_key"] = uuid4().hex
    body["farm"]["partition_revision"] = "partition-2"
    denied = await client.post("/field-shift/farms/sync", json=body)
    assert denied.status_code == 409
    body["farm"]["expected_version"] = original["farm"]["version"]
    changed = await client.post("/field-shift/farms/sync", json=body)
    assert changed.status_code == 200
    assert changed.json()["farm"]["version"] == 2
    assert changed.json()["items"][0]["field"]["id"] != original["items"][0]["field"]["id"]
    old_id = original["items"][0]["field"]["id"]
    assert (await client.get("/field-shift/fields/" + old_id)).status_code == 200
    active = (await client.get("/field-shift/farms/" + original["farm"]["id"])).json()
    assert len(active["fields"]) == 2
    assert all(f["partition_revision"] == "partition-2" for f in active["fields"])


@pytest.mark.parametrize("mutation", ["area", "center", "outside", "overlap"])
async def test_geometry_mismatch_is_reported_per_field(api, mutation):
    client, _ = api
    body = request_body()
    first = body["fields"][0]["field"]
    if mutation == "area":
        first["area_ha"] = 100
    elif mutation == "center":
        first["longitude"] = -90
    elif mutation == "outside":
        body["fields"][0] = field("outside", -93.6, -93.599)
    else:
        body["fields"][1]["field"]["geometry"] = copy.deepcopy(first["geometry"])
        body["fields"][1]["field"]["longitude"] = first["longitude"]
    response = await client.post("/field-shift/farms/sync", json=body)
    assert response.status_code == 200
    assert not response.json()["complete"]
    assert any(i["status"] == "invalid" for i in response.json()["items"])


async def test_polygon_holes_remain_excluded_from_area_and_saved_geometry(api):
    client, _ = api
    body = request_body()
    hole = [
        [-93.4998, 42.0002],
        [-93.4996, 42.0002],
        [-93.4996, 42.0004],
        [-93.4998, 42.0004],
        [-93.4998, 42.0002],
    ]
    body["fields"][0]["field"]["geometry"]["coordinates"].append(hole)
    body["fields"][0]["field"]["area_ha"] = 0.8832
    response = await client.post("/field-shift/farms/sync", json=body)
    assert response.status_code == 200
    assert response.json()["complete"]
    saved = response.json()["items"][0]["field"]
    assert len(saved["geometry"]["coordinates"]) == 2
    assert 0.88 < saved["area_ha"] < 0.89


async def test_legacy_edit_endpoint_cannot_bypass_managed_geometry_checks(api):
    client, _ = api
    body = request_body()
    result = (await client.post("/field-shift/farms/sync", json=body)).json()
    saved = result["items"][0]["field"]
    for change in ({"geometry": None}, {"area_ha": 100}, {"longitude": -90}):
        response = await client.patch(
            "/field-shift/fields/" + saved["id"],
            json={
                **body["fields"][0]["field"],
                **change,
                "expected_version": 1,
            },
        )
        assert response.status_code == 422
    current = (await client.get("/field-shift/fields/" + saved["id"])).json()
    assert current["version"] == 1


async def test_legacy_edit_cannot_overlap_a_sibling_managed_field(api):
    client, _ = api
    body = request_body()
    result = (await client.post("/field-shift/farms/sync", json=body)).json()
    response = await client.patch(
        "/field-shift/fields/" + result["items"][0]["field"]["id"],
        json={
            **body["fields"][1]["field"],
            "expected_version": 1,
        },
    )
    assert response.status_code == 422


async def test_partition_metadata_survives_cross_device_restore(api):
    client, _ = api
    body = request_body()
    body["farm"]["partition"] = {
        "method": "regular-grid",
        "orientation": "cardinal",
        "requested_count": 2,
        "generated_count": 2,
        "grid_rows": 1,
        "grid_columns": 2,
        "boundary_source": "drawn",
    }
    response = await client.post("/field-shift/farms/sync", json=body)
    assert response.status_code == 200
    restored = await client.get("/field-shift/farms/" + response.json()["farm"]["id"])
    assert restored.json()["partition"] == body["farm"]["partition"]


async def test_account_context_guard_rejects_a_request_after_login_switch(api):
    client, identity = api
    old_owner = identity["id"]
    identity["id"] = str(uuid4())
    headers = {"X-Workspace-Owner": old_owner}
    assert (await client.get("/field-shift/farms", headers=headers)).status_code == 409
    result = await client.post("/field-shift/farms/sync", json=request_body(), headers=headers)
    assert result.status_code == 409
    assert (await client.get("/field-shift/farms")).json() == {"items": []}
