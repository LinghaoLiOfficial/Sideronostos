"""Real PostgreSQL access and temporal guards; the short weather fixture is synthetic."""

import os
from datetime import date

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.agri_data.schemas import SelectionInput
from sideronostos_backend.modules.agri_data.service import AgriDataService
from sideronostos_backend.modules.database.base import Base

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def session():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL database required")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Not a test database")
    engine = create_async_engine(url)
    tables = [t for t in Base.metadata.sorted_tables if t.name.startswith("agri_data_")]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.drop_all(sync, tables=tables))
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def test_selection_owner_is_checked_before_reading_data(session):
    service = AgriDataService()
    result = await service.create_selection(
        session,
        "owner-a",
        SelectionInput(
            kind="point", revision=3, geometry={"type": "Point", "coordinates": [-93.5, 42]}
        ),
    )
    assert result["revision"] == 3 and result["area_ha"] is None
    with pytest.raises(HTTPException) as error:
        await service.facts(session, "owner-b", result["id"])
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        await service.get_selection(session, "owner-a", result["id"], expected_revision=2)
    assert error.value.status_code == 409


async def test_future_dates_and_private_releases_cannot_leak_historical_values(session):
    service = AgriDataService()
    point = await service.create_selection(
        session,
        "owner-a",
        SelectionInput(
            kind="point", revision=1, geometry={"type": "Point", "coordinates": [-93.5, 42]}
        ),
    )
    data = {
        "latitude": 42,
        "longitude": -93.5,
        "start": "2025-01-01",
        "end": "2025-01-02",
        "recipe": "test-only",
        "source_kind": "synthetic_test",
        "days": [
            {"date": "2025-01-01", "rain_mm": 4.0, "et0_mm": 2.0, "tmin_c": 0.0, "tmax_c": 8.0},
            {"date": "2025-01-02", "rain_mm": None, "et0_mm": None, "tmin_c": 0.0, "tmax_c": 8.0},
        ],
    }
    session.add(
        ScienceRelease(
            id="private",
            owner_user_id="owner-b",
            product="NASA_POWER_DAILY",
            status="published",
            manifest_sha256="a" * 64,
            data=data,
        )
    )
    session.add(
        ScienceRelease(
            id="public",
            product="NASA_POWER_DAILY",
            status="published",
            manifest_sha256="b" * 64,
            data=data,
        )
    )
    await session.commit()
    future = await service.facts(
        session, "owner-a", point["id"], start=date(2027, 1, 1), end=date(2027, 1, 2)
    )
    assert future["facts"] == [] and any(
        v["reason"] == "outside_time_coverage" for v in future["unavailable"]
    )
    actual = await service.facts(
        session, "owner-a", point["id"], start=date(2025, 1, 1), end=date(2025, 1, 2)
    )
    assert all(f["source"]["release_id"] == "public" for f in actual["facts"])
    rain = next(f for f in actual["facts"] if f["metric"] == "rainfall_total")
    assert rain["value"] is None and rain["coverage"]["valid_days"] == 1
    assert rain["coverage"]["expected_days"] == 2


async def test_layer_manifest_preserves_catalog_identity_and_owner_scope(session):
    service = AgriDataService()
    session.add(
        ScienceRelease(
            id="owned-smap",
            owner_user_id="owner-a",
            product="SPL3SMP_E",
            status="published",
            manifest_sha256="c" * 64,
            data={
                "passes": {"AM": {}, "PM": {}},
                "start": "2026-11-07",
                "end": "2026-11-07",
                "bounds": [-180, -85, 180, 85],
                "grid_spacing_label": "9 km grid",
                "limitations": ["Surface moisture only"],
                "recipe": "test-only",
            },
        )
    )
    await session.commit()
    catalog = await service.layers(session, "owner-a")
    for item in catalog:
        manifest = await service.layer_manifest(session, "owner-a", item["id"])
        for key in ("id", "release_id", "title", "pass", "start", "end", "unit", "source"):
            assert manifest.get(key) == item[key], key
    assert await service.layers(session, "owner-b") == []
    with pytest.raises(HTTPException) as error:
        await service.layer_manifest(session, "owner-b", "owned-smap:am")
    assert error.value.status_code == 404
