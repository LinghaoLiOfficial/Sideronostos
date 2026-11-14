"""Dedicated HTTP app for the opt-in browser smoke test.

Only the identity is synthetic. The assistant, knowledge, and business routers
use their real handlers and a PostgreSQL database whose name includes 'test'.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.agri_data.router import router as agri_data_router
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal, require_verified_user
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.farm_assistant.router import router as assistant_router
from sideronostos_backend.modules.field_shift.router import router as field_shift_router
from sideronostos_backend.modules.rotation_optimizer.router import router as rotation_router

database_url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL", "")
if not database_url:
    raise RuntimeError("Set FIELD_SHIFT_TEST_DATABASE_URL to a dedicated PostgreSQL test database")
if "test" not in (make_url(database_url).database or ""):
    raise RuntimeError("Live assistant smoke requires a dedicated database name containing 'test'")

engine = create_async_engine(database_url)
session_factory = async_sessionmaker(engine, expire_on_commit=False)
owner_id = str(uuid4())
app = create_app(modules=(ModuleSpec(name="farm_assistant", routers=(assistant_router,)),))
app.state.session_factory = session_factory
app.include_router(field_shift_router)
app.include_router(agri_data_router)
app.include_router(rotation_router)


async def smoke_principal():
    return AuthPrincipal(owner_id, "smoke-farmer@example.test", "Smoke farmer", datetime.now(UTC))


async def smoke_session():
    async with session_factory() as session:
        yield session


app.dependency_overrides[require_verified_user] = smoke_principal
app.dependency_overrides[get_session] = smoke_session


@app.get("/users/me")
async def smoke_user():
    return {
        "id": owner_id,
        "email": "smoke-farmer@example.test",
        "display_name": "Smoke farmer",
        "email_verified": True,
    }
