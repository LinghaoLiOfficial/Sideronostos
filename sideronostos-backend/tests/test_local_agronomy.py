import os
from datetime import datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.rotation_optimizer.local_knowledge import LocalKnowledgeService
from sideronostos_backend.modules.rotation_optimizer.models import LocalAgronomyVersion

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def setup():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL database required")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Test database required")
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync: Base.metadata.drop_all(
                sync, tables=[LocalAgronomyVersion.__table__]
            )
        )
    await engine.dispose()


async def test_bootstrap_owner_isolation_conflict_and_publish(setup):
    service = LocalKnowledgeService()
    first_owner, second_owner = str(uuid4()), str(uuid4())
    async with setup() as session:
        first = await service.catalogue(session, first_owner)
        second = await service.catalogue(session, second_owner)
        assert first["active"]["revision"] == 1
        assert first["draft"]["id"] != second["draft"]["id"]
        changed = {**first["draft"]["profile"], "name": "My local agronomy"}
        saved = await service.save_draft(
            session,
            first_owner,
            changed,
            datetime.fromisoformat(first["draft"]["updated_at"]),
        )
        assert saved["profile"]["name"] == "My local agronomy"
        with pytest.raises(HTTPException) as stale:
            await service.save_draft(
                session,
                first_owner,
                changed,
                datetime.fromisoformat(first["draft"]["updated_at"]),
            )
        assert stale.value.status_code == 409
        published = await service.publish(
            session, first_owner, datetime.fromisoformat(saved["updated_at"])
        )
        assert published["active"]["revision"] == 2
        assert published["active"]["profile"]["name"] == "My local agronomy"
        assert published["draft"]["status"] == "draft"


async def test_draft_rejects_removed_referenced_source_and_system_field_change(setup):
    service = LocalKnowledgeService()
    owner = str(uuid4())
    async with setup() as session:
        catalogue = await service.catalogue(session, owner)
        body = catalogue["draft"]["profile"]
        body = {**body, "sources": {}}
        with pytest.raises(HTTPException) as invalid:
            await service.save_draft(
                session, owner, body, datetime.fromisoformat(catalogue["draft"]["updated_at"])
            )
        assert invalid.value.status_code == 422
        body = {**catalogue["draft"]["profile"], "weather_radius_km": 99}
        with pytest.raises(HTTPException) as managed:
            await service.save_draft(
                session, owner, body, datetime.fromisoformat(catalogue["draft"]["updated_at"])
            )
        assert managed.value.status_code == 422
