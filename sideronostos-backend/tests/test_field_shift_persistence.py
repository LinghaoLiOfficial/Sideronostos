"""Real PostgreSQL checks for ownership, optimistic edits and immutable saved evidence.

Run against an explicitly dedicated test database with FIELD_SHIFT_TEST_DATABASE_URL.
Only the field_shift_* tables are recreated; never point this at the application database.
"""

import asyncio
import calendar
import os
from datetime import UTC, datetime, timedelta
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
from sideronostos_backend.modules.field_shift.schemas import Environment, EnvironmentMonth

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def api():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set FIELD_SHIFT_TEST_DATABASE_URL to a dedicated PostgreSQL test database")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError(
            "Field Shift integration tests require a database name containing 'test'"
        )
    engine = create_async_engine(url)
    tables = [
        table for table in Base.metadata.sorted_tables if table.name.startswith("field_shift_")
    ]
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.drop_all(sync, tables=tables))
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    app = create_app(modules=(ModuleSpec(name="field_shift", routers=(router,)),))
    identity = {"id": str(uuid4())}

    async def principal():
        return AuthPrincipal(identity["id"], "farmer@example.test", "Farmer", datetime.now(UTC))

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


def field_input(**changes):
    return {
        "name": "North field",
        "area_ha": 4,
        "latitude": 42,
        "longitude": -93,
        "soil_texture": "loam",
        "irrigation_available": True,
        "profile_id": "temperate-demo",
        "history": [{"year": 2025, "crop_id": "wheat"}],
        **changes,
    }


async def test_field_edits_are_durable_owner_scoped_and_version_checked(api):
    client, identity = api
    response = await client.post("/field-shift/fields", json=field_input())
    assert response.status_code == 201
    original = response.json()
    assert original["version"] == 1
    detail = await client.get(f"/field-shift/fields/{original['id']}")
    assert detail.json()["history"] == [{"year": 2025, "crop_id": "wheat"}]

    changed = await client.patch(
        f"/field-shift/fields/{original['id']}",
        json={**field_input(name="Renamed field"), "expected_version": 1},
    )
    assert changed.status_code == 200
    assert changed.json()["version"] == 2
    stale = await client.patch(
        f"/field-shift/fields/{original['id']}",
        json={**field_input(name="Stale edit"), "expected_version": 1},
    )
    assert stale.status_code == 409
    assert (await client.get(f"/field-shift/fields/{original['id']}")).json()[
        "name"
    ] == "Renamed field"

    identity["id"] = str(uuid4())
    assert (await client.get("/field-shift/fields")).json() == {"items": []}
    assert (await client.get(f"/field-shift/fields/{original['id']}")).status_code == 404
    foreign_edit = await client.patch(
        f"/field-shift/fields/{original['id']}", json={**field_input(), "expected_version": 2}
    )
    assert foreign_edit.status_code == 404


async def test_simultaneous_field_edits_cannot_overwrite_each_other(api):
    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}"
    responses = await asyncio.gather(
        *(
            client.patch(path, json={**field_input(name=name), "expected_version": 1})
            for name in ("First tab", "Second tab")
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winning_name = next(
        response.json()["name"] for response in responses if response.status_code == 200
    )
    final = (await client.get(path)).json()
    assert final["name"] == winning_name
    assert final["version"] == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"profile_id": "unknown"},
        {"history": [{"year": 2025, "crop_id": "unknown"}]},
        {"history": [{"year": 2025, "crop_id": "wheat"}, {"year": 2025, "crop_id": "maize"}]},
        {"latitude": 91},
        {"area_ha": 0},
        {"name": "   "},
        {"owner_user_id": "forged"},
    ],
)
async def test_invalid_field_data_never_persists(api, changes):
    client, _ = api
    response = await client.post("/field-shift/fields", json=field_input(**changes))
    assert response.status_code == 422
    assert (await client.get("/field-shift/fields")).json() == {"items": []}


def planning_input(**changes):
    return {
        "start_year": 2027,
        "baseline_crop_ids": ["maize", "maize", "maize"],
        "allowed_crop_ids": ["maize", "soybean", "wheat", "sunflower", "pea", "potato"],
        "max_irrigation_mm": 1000,
        "max_cost_usd_ha": 5000,
        "max_labor_days_ha": 100,
        "weights": {"water": 3, "cover": 2, "diversity": 4, "cost": 2},
        "scenario": {"rainfall_change_pct": 0, "temperature_change_c": 0},
        "accept_demo_assumptions": True,
        "expected_field_version": 1,
        **changes,
    }


@pytest.fixture
def weather(monkeypatch):
    from sideronostos_backend.modules.field_shift import service

    calls = []

    async def fetch(latitude, longitude, reference_year=2025):
        calls.append((latitude, longitude, reference_year))
        return Environment(
            status="live",
            source_name="Recorded test weather",
            source_url=None,
            reference_year=reference_year,
            fetched_at=datetime.now(UTC),
            spatial_resolution="Regional test fixture",
            fingerprint=f"weather-{len(calls)}",
            months=[
                EnvironmentMonth(
                    month=m,
                    rainfall_mm=50,
                    tmin_c=10,
                    tmax_c=25,
                    reference_et_mm=100,
                    valid_days=calendar.monthrange(2025, m)[1],
                    expected_days=calendar.monthrange(2025, m)[1],
                )
                for m in range(1, 13)
            ],
            limitations=[],
            evidence=[],
        )

    monkeypatch.setattr(service, "fetch_environment", fetch, raising=False)
    return calls


async def test_environment_cache_is_durable_refreshable_and_bound_to_location(api, weather):
    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}/environment"
    first = await client.get(path)
    assert first.status_code == 200
    assert first.json()["status"] == "live"
    cached = (await client.get(path)).json()
    assert cached["status"] == "cached"
    assert cached["fingerprint"] == "weather-1"
    assert len(weather) == 1
    refreshed = (await client.get(path, params={"refresh": "true"})).json()
    assert refreshed["fingerprint"] == "weather-2"
    await client.patch(
        f"/field-shift/fields/{item['id']}",
        json={**field_input(latitude=43), "expected_version": 1},
    )
    moved = (await client.get(path)).json()
    assert moved["fingerprint"] == "weather-3"
    assert weather[-1] == (43, -93, 2025)


async def test_demo_cache_stays_explicit_and_retries_after_a_short_lifetime(
    api, weather, monkeypatch
):
    from sideronostos_backend.modules.field_shift import service

    client, _ = api
    now = datetime(2026, 11, 12, tzinfo=UTC)
    monkeypatch.setattr(service, "utcnow", lambda: now)
    external_fetch = service.fetch_environment

    async def unavailable_provider(*args):
        result = await external_fetch(*args)
        return result.model_copy(update={"status": "demo", "fetched_at": None})

    monkeypatch.setattr(service, "fetch_environment", unavailable_provider)
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}/environment"
    assert (await client.get(path)).json()["status"] == "demo"
    assert (await client.get(path)).json()["status"] == "demo"
    assert len(weather) == 1
    now += timedelta(minutes=6)
    assert (await client.get(path)).json()["status"] == "demo"
    assert len(weather) == 2


@pytest.mark.parametrize("fallback_status", ["demo", "unavailable"])
async def test_failed_refresh_preserves_matching_real_observations(
    api, weather, monkeypatch, fallback_status
):
    from sideronostos_backend.modules.field_shift import service

    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}/environment"
    observed = (await client.get(path)).json()
    external_fetch = service.fetch_environment

    async def failed_provider(*args):
        result = await external_fetch(*args)
        return result.model_copy(
            update={
                "status": fallback_status,
                "fetched_at": None,
                "fingerprint": "synthetic-new",
                "limitations": ["Provider failed"],
            }
        )

    monkeypatch.setattr(service, "fetch_environment", failed_provider)
    refreshed = (await client.get(path, params={"refresh": "true"})).json()
    assert refreshed["status"] == "cached"
    assert refreshed["fingerprint"] == observed["fingerprint"]
    assert refreshed["fetched_at"] == observed["fetched_at"]
    assert refreshed["months"] == observed["months"]
    assert len(refreshed["limitations"]) > len(observed["limitations"])
    assert (await client.get(path)).json() == refreshed

    # Old real observations must never become a fallback for a different location.
    await client.patch(
        f"/field-shift/fields/{item['id']}",
        json={**field_input(latitude=43), "expected_version": 1},
    )
    moved = (await client.get(path)).json()
    assert moved["status"] == fallback_status
    assert moved["fingerprint"] == "synthetic-new"


async def test_inflight_weather_cannot_be_attached_to_an_edited_field(api, weather, monkeypatch):
    from sideronostos_backend.modules.field_shift import service

    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}"
    entered, release = asyncio.Event(), asyncio.Event()
    external_fetch = service.fetch_environment

    async def delayed_fetch(*args):
        entered.set()
        await asyncio.wait_for(release.wait(), timeout=5)
        return await external_fetch(*args)

    monkeypatch.setattr(service, "fetch_environment", delayed_fetch)
    loading = asyncio.create_task(client.get(f"{path}/environment"))
    await asyncio.wait_for(entered.wait(), timeout=5)
    try:
        edit = await client.patch(path, json={**field_input(latitude=43), "expected_version": 1})
        assert edit.status_code == 200
    finally:
        release.set()
    assert (await loading).status_code == 409
    retry = await client.get(f"{path}/environment")
    assert retry.status_code == 200
    assert weather[-1] == (43, -93, 2025)


async def test_saved_analysis_uses_server_metrics_and_keeps_immutable_evidence(api, weather):
    client, identity = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}"
    response = await client.post(f"{path}/analyses", json=planning_input())
    assert response.status_code == 201
    analysis = response.json()
    assert analysis["field_version"] == 1
    assert analysis["profile_snapshot"]["version"] == analysis["profile"]["version"]
    assert analysis["profile_snapshot"]["rules"]
    assert analysis["baseline"]["feasible"] is False
    assert analysis["alternatives"]
    option = analysis["alternatives"][0]
    assert option["feasible"] is True
    assert len(option["seasons"]) == 3
    assert (await client.get(f"/field-shift/analyses/{analysis['id']}")).json() == analysis

    forged = await client.post(
        f"{path}/analyses", json={**planning_input(), "metrics": {"cost": 0}}
    )
    assert forged.status_code == 422
    save_body = {
        "analysis_id": analysis["id"],
        "option_id": option["id"],
        "title": "My rotation",
        "notes": "Discuss with the cooperative",
    }
    saves = await asyncio.gather(
        *(client.post("/field-shift/plans", json=save_body) for _ in range(2))
    )
    assert [r.status_code for r in saves] == [201, 201]
    saved = saves[0].json()
    assert saves[1].json()["id"] == saved["id"]
    assert len((await client.get("/field-shift/plans")).json()["items"]) == 1
    assert saved["option"] == option
    assert saved["analysis"] == analysis
    assert saved["field_snapshot"]["name"] == "North field"

    await client.patch(
        path, json={**field_input(name="Later edit", latitude=43), "expected_version": 1}
    )
    await client.get(f"{path}/environment", params={"refresh": "true"})
    reloaded = (await client.get(f"/field-shift/plans/{saved['id']}")).json()
    assert reloaded == saved
    stale = await client.post(f"{path}/analyses", json=planning_input())
    assert stale.status_code == 409

    identity["id"] = str(uuid4())
    assert (await client.get(f"/field-shift/analyses/{analysis['id']}")).status_code == 404
    assert (await client.get(f"/field-shift/plans/{saved['id']}")).status_code == 404
    assert (await client.post("/field-shift/plans", json=save_body)).status_code == 404
    assert (await client.get("/field-shift/plans")).json() == {"items": []}


async def test_scenario_recomputes_without_mutating_the_previous_analysis(api, weather):
    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    path = f"/field-shift/fields/{item['id']}/analyses"
    first = (await client.post(path, json=planning_input())).json()
    dry_response = await client.post(
        path, json=planning_input(scenario={"rainfall_change_pct": -50, "temperature_change_c": 2})
    )
    assert dry_response.status_code == 201
    dry = dry_response.json()
    assert dry["id"] != first["id"]
    assert (
        dry["baseline"]["metrics"]["irrigation_gap_mm"]
        > first["baseline"]["metrics"]["irrigation_gap_mm"]
    )
    assert dry["environment"]["fingerprint"] == first["environment"]["fingerprint"]
    assert (await client.get(f"/field-shift/analyses/{first['id']}")).json() == first


async def test_invalid_or_infeasible_options_cannot_be_saved(api, weather):
    client, _ = api
    item = (await client.post("/field-shift/fields", json=field_input())).json()
    analysis = (
        await client.post(f"/field-shift/fields/{item['id']}/analyses", json=planning_input())
    ).json()
    for option_id in ("forged-option", analysis["baseline"]["id"]):
        response = await client.post(
            "/field-shift/plans",
            json={
                "analysis_id": analysis["id"],
                "option_id": option_id,
                "title": "Invalid",
                "notes": "",
            },
        )
        assert response.status_code == 422
    assert (await client.get("/field-shift/plans")).json() == {"items": []}
